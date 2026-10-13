import { SAMPLE_RATE } from './mp3'
import { frameSeconds, indexDuration, indexFrames, sniffFrames, type FrameIndex } from './frames'
import { isMp4, mp4Audio } from './mp4'
import { parseWav, wavSlice } from './wav'
import { decodeMono16k, encodeSpeech, fit } from './encode'

// Uploads, made ready for transcription and storage without ever holding a
// whole long recording in memory:
// - MP3 and AAC (raw, or inside M4A / MP4 / MOV — Voice Memos, Zoom, video)
//   are read frame by frame. At speech bitrates they're kept exactly as
//   they are: Gemini reads them, and they split into parts by byte ranges.
// - Above that (music-quality audio, video soundtracks) and for WAV, the
//   audio is decoded piece by piece and re-encoded as the recorder's speech
//   MP3 (16 kHz mono, ~14 MB an hour) on every core.
// - Anything else the browser can decode (WebM, Ogg, FLAC, Apple
//   Lossless…) is decoded whole, if it fits in memory, and encoded the same.

const KEEP_KBPS = 72
const SLICE_SEC = 120
const PRE_ROLL = 4 // frames decoded before each piece and dropped (decoder warm-up)

export interface Prepared {
  blob: Blob
  mimeType: string
  durationSec: number
}

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

export async function prepareUpload(file: File, onProgress: (p: number) => void): Promise<Prepared> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  if (isMp4(head)) {
    const r = await mp4Audio(file, (p) => onProgress(p * 0.1))
    if (r) return compact(r.blob, r.index, onProgress)
    return decodeWhole(file, onProgress)
  }
  const codec = sniffFrames(head)
  if (codec) {
    const index = await indexFrames(file, codec)
    return compact(file.slice(0, file.size, index.mimeType), index, onProgress)
  }
  const wav = parseWav(head, file.size)
  if (wav) {
    const per = SLICE_SEC * wav.sampleRate
    const slices = Math.ceil(wav.frames / per)
    const at = (frame: number) => Math.round((frame * SAMPLE_RATE) / wav.sampleRate)
    const blob = await encodeSpeech(
      slices,
      async (i) => {
        const from = i * per
        const to = Math.min(wav.frames, from + per)
        return fit(await decodeMono16k(await wavSlice(file, wav, from, to).arrayBuffer()), at(to) - at(from))
      },
      onProgress,
    )
    return { blob, mimeType: 'audio/mpeg', durationSec: wav.frames / wav.sampleRate }
  }
  return decodeWhole(file, onProgress)
}

/** MP3 / AAC frames: kept if compact, otherwise re-encoded piece by piece. */
async function compact(blob: Blob, index: FrameIndex, onProgress: (p: number) => void): Promise<Prepared> {
  const durationSec = indexDuration(index)
  const kept = { blob, mimeType: index.mimeType, durationSec }
  if ((blob.size * 8) / durationSec / 1000 <= KEEP_KBPS) return kept
  const per = Math.max(1, Math.round(SLICE_SEC / frameSeconds(index)))
  const slices = Math.ceil(index.count / per)
  const at = (frame: number) => Math.round(frame * frameSeconds(index) * SAMPLE_RATE)
  try {
    const mp3 = await encodeSpeech(
      slices,
      async (i) => {
        const from = i * per
        const to = Math.min(index.count, from + per)
        const pre = Math.min(from, PRE_ROLL)
        const pcm = await decodeMono16k(await blob.slice(index.offsets[from - pre], index.offsets[to]).arrayBuffer())
        return fit(pcm.subarray(at(from) - at(from - pre)), at(to) - at(from))
      },
      (p) => onProgress(0.1 + p * 0.9),
    )
    return { blob: mp3, mimeType: 'audio/mpeg', durationSec }
  } catch {
    // This browser can't decode it (or ran out of room): the frames are
    // still perfectly good for transcription, just larger to keep.
    return kept
  }
}

/** Everything else: one decode of the whole file, then encode. */
async function decodeWhole(file: File, onProgress: (p: number) => void): Promise<Prepared> {
  const tooLong = new Error('This recording is too long to convert in the browser in this format. Export it as MP3 or M4A and upload that — those of any length work.')
  const seconds = await mediaDuration(file)
  if (file.size > 700 * 1024 * 1024 || seconds * SAMPLE_RATE * 4 * 2 > 1.6e9) throw tooLong
  let pcm: Float32Array
  try {
    pcm = await decodeMono16k(await file.arrayBuffer())
  } catch (e) {
    if (e instanceof RangeError) throw tooLong
    throw new Error("This file's audio couldn't be read. Try MP3, M4A, WAV or a video with sound.")
  }
  const per = SLICE_SEC * SAMPLE_RATE
  const all = pcm
  const blob = await encodeSpeech(Math.ceil(all.length / per), async (i) => all.slice(i * per, (i + 1) * per), onProgress)
  return { blob, mimeType: 'audio/mpeg', durationSec: all.length / SAMPLE_RATE }
}
