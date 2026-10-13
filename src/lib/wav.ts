// WAV files, read in pieces: each piece becomes a small WAV of its own
// (the original format chunk, then that stretch of samples) for the
// browser to decode, so a three-hour WAV (two gigabytes) never has to be
// in memory.

export interface WavInfo {
  fmt: Uint8Array // the whole `fmt ` chunk, header included
  sampleRate: number
  blockAlign: number
  dataOffset: number
  frames: number
}

const tag = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])

export function parseWav(head: Uint8Array, fileSize: number): WavInfo | null {
  if (head.length < 12 || tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') return null
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength)
  let fmt: Uint8Array | null = null
  let p = 12
  while (p + 8 <= head.length) {
    const id = tag(head, p)
    const size = v.getUint32(p + 4, true)
    if (id === 'fmt ') fmt = head.slice(p, p + 8 + size)
    if (id === 'data') {
      if (!fmt || fmt.length < 24) return null
      const f = new DataView(fmt.buffer)
      const blockAlign = f.getUint16(20, true)
      if (!blockAlign) return null
      // Streamed WAVs leave the size at 0 or 0xFFFFFFFF; files over 4 GB overflow it.
      const bytes = size === 0 || size === 0xffffffff || p + 8 + size > fileSize ? fileSize - p - 8 : size
      return { fmt, sampleRate: f.getUint32(12, true), blockAlign, dataOffset: p + 8, frames: Math.floor(bytes / blockAlign) }
    }
    p += 8 + size + (size & 1)
  }
  return null
}

/** Sample frames [from, to) as a standalone WAV. */
export function wavSlice(file: Blob, w: WavInfo, from: number, to: number): Blob {
  const bytes = (to - from) * w.blockAlign
  const head = new Uint8Array(12 + w.fmt.length + 8)
  const v = new DataView(head.buffer)
  const put = (i: number, s: string) => [...s].forEach((c, k) => (head[i + k] = c.charCodeAt(0)))
  put(0, 'RIFF')
  v.setUint32(4, 4 + w.fmt.length + 8 + bytes, true)
  put(8, 'WAVE')
  head.set(w.fmt, 12)
  put(12 + w.fmt.length, 'data')
  v.setUint32(16 + w.fmt.length, bytes, true)
  return new Blob([head, file.slice(w.dataOffset + from * w.blockAlign, w.dataOffset + to * w.blockAlign)], { type: 'audio/wav' })
}
