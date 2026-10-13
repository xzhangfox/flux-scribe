import { Mp3Writer, SAMPLE_RATE } from './mp3'

// Decoding (native, fast) and MP3 encoding (JavaScript, ~40× real time per
// core) for uploads that need converting. The recording is split into
// stretches, one per worker, each encoded as its own continuous stream;
// MP3 streams join end to end, so the pieces are simply concatenated.

let ctx: OfflineAudioContext | null = null

/** Any audio the browser can decode, as 16 kHz mono samples. */
export async function decodeMono16k(data: ArrayBuffer): Promise<Float32Array> {
  ctx ??= new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const buf = await ctx.decodeAudioData(data)
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice()
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / buf.numberOfChannels
  }
  return out
}

/** Exactly `n` samples: trimmed, or padded with silence. */
export function fit(pcm: Float32Array, n: number) {
  if (pcm.length === n) return pcm
  const out = new Float32Array(n)
  out.set(pcm.subarray(0, n))
  return out
}

/** Encodes `slices` pieces (fetched in order by `read`) to one speech MP3. */
export async function encodeSpeech(slices: number, read: (i: number) => Promise<Float32Array>, onProgress: (p: number) => void): Promise<Blob> {
  let done = 0
  const tick = () => onProgress(++done / slices)
  const cores = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, Math.ceil(slices / 4)))
  let workers: Worker[] = []
  try {
    workers = Array.from({ length: cores }, () => new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' }))
  } catch {
    workers = []
  }
  if (!workers.length) {
    // No workers: encode here, yielding to keep the page responsive.
    const w = new Mp3Writer()
    const parts: Uint8Array[] = []
    for (let i = 0; i < slices; i++) {
      w.write(await read(i))
      parts.push(w.drain())
      tick()
      await new Promise((r) => setTimeout(r))
    }
    parts.push(w.end())
    return new Blob(parts as BlobPart[], { type: 'audio/mpeg' })
  }
  const call = (w: Worker, msg: { pcm?: Float32Array; end?: boolean }) =>
    new Promise<Uint8Array>((resolve, reject) => {
      w.onmessage = (e) => resolve(e.data)
      w.onerror = (e) => reject(new Error(e.message || 'The audio encoder failed.'))
      w.postMessage(msg, msg.pcm ? [msg.pcm.buffer] : [])
    })
  try {
    const out = await Promise.all(
      workers.map(async (w, k) => {
        const from = Math.floor((k * slices) / workers.length)
        const to = Math.floor(((k + 1) * slices) / workers.length)
        const parts: Uint8Array[] = []
        for (let i = from; i < to; i++) {
          parts.push(await call(w, { pcm: await read(i) }))
          tick()
        }
        parts.push(await call(w, { end: true }))
        return parts
      }),
    )
    return new Blob(out.flat() as BlobPart[], { type: 'audio/mpeg' })
  } finally {
    workers.forEach((w) => w.terminate())
  }
}
