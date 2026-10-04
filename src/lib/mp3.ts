import { Mp3Encoder } from '@breezystack/lamejs'

// Speech-tuned MP3: 16 kHz mono at 32 kbps (~14 MB per hour). MP3 is one
// of the audio formats Gemini accepts directly (Chrome's own recorder
// produces WebM, which it doesn't document), and plays everywhere.
export const SAMPLE_RATE = 16000
const KBPS = 32
const BLOCK = 1152

export class Mp3Writer {
  private enc = new Mp3Encoder(1, SAMPLE_RATE, KBPS)
  private chunks: Uint8Array[] = []
  private pending = new Int16Array(0)

  /** Appends mono float samples (-1..1) at SAMPLE_RATE. */
  write(samples: Float32Array) {
    const pcm = new Int16Array(this.pending.length + samples.length)
    pcm.set(this.pending)
    for (let i = 0; i < samples.length; i++) {
      const v = Math.max(-1, Math.min(1, samples[i]))
      pcm[this.pending.length + i] = v < 0 ? v * 0x8000 : v * 0x7fff
    }
    const whole = pcm.length - (pcm.length % BLOCK)
    for (let i = 0; i < whole; i += BLOCK) {
      const out = this.enc.encodeBuffer(pcm.subarray(i, i + BLOCK))
      if (out.length) this.chunks.push(new Uint8Array(out))
    }
    this.pending = pcm.slice(whole)
  }

  finish(): Blob {
    if (this.pending.length) {
      const out = this.enc.encodeBuffer(this.pending)
      if (out.length) this.chunks.push(new Uint8Array(out))
    }
    const tail = this.enc.flush()
    if (tail.length) this.chunks.push(new Uint8Array(tail))
    return new Blob(this.chunks as BlobPart[], { type: 'audio/mpeg' })
  }
}

/** Linear-interpolation resample of one channel to SAMPLE_RATE. */
export function resample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === SAMPLE_RATE) return input
  const ratio = fromRate / SAMPLE_RATE
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(i0 + 1, input.length - 1)
    out[i] = input[i0] + (input[i1] - input[i0]) * (x - i0)
  }
  return out
}
