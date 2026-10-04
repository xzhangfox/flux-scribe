import { Mp3Writer, SAMPLE_RATE } from './mp3'

// Uploaded files: formats Gemini accepts as-is go straight through; anything
// else the browser can decode (m4a/iPhone Voice Memos, webm, mp4 video…)
// is converted to the same speech MP3 the recorder makes.
const NATIVE = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/aiff', 'audio/x-aiff']
const CANON: Record<string, string> = { 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-flac': 'audio/flac', 'audio/x-aiff': 'audio/aiff' }

export async function mediaDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<number>((resolve) => {
      const a = new Audio()
      a.preload = 'metadata'
      a.onloadedmetadata = () => {
        // Some encoders report Infinity until the end is seeked to.
        if (Number.isFinite(a.duration)) return resolve(a.duration)
        a.currentTime = 1e9
        a.ontimeupdate = () => resolve(Number.isFinite(a.duration) ? a.duration : 0)
      }
      a.onerror = () => resolve(0)
      a.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function prepareUpload(file: File, onProgress: (p: number) => void): Promise<{ blob: Blob; mimeType: string; durationSec: number }> {
  if (NATIVE.includes(file.type)) {
    const mimeType = CANON[file.type] || file.type
    return { blob: file, mimeType, durationSec: await mediaDuration(file) }
  }
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new Error("This file's audio couldn't be read. Try MP3, M4A, WAV or a video with sound.")
  } finally {
    ctx.close().catch(() => {})
  }
  // Downmix + resample in one offline render.
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const mono = (await offline.startRendering()).getChannelData(0)
  const writer = new Mp3Writer()
  const step = SAMPLE_RATE * 20
  for (let i = 0; i < mono.length; i += step) {
    writer.write(mono.subarray(i, i + step))
    onProgress(Math.min(1, (i + step) / mono.length))
    await new Promise((r) => setTimeout(r)) // keep the UI responsive
  }
  return { blob: writer.finish(), mimeType: 'audio/mpeg', durationSec: decoded.duration }
}
