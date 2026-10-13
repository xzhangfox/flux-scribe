// Compressed audio as a list of frames: MP3 (what the recorder makes) and
// ADTS AAC (what M4A/MP4 uploads are remuxed to). Every frame stands on its
// own, so a long recording can be cut into parts, or a few seconds lifted
// out, by byte ranges alone, with no decoding and no re-encoding. Pure
// functions, so they run (and are tested) outside the browser too.

export type Codec = 'mp3' | 'aac'

export interface FrameIndex {
  codec: Codec
  mimeType: 'audio/mpeg' | 'audio/aac'
  sampleRate: number
  samplesPerFrame: number
  /** Byte offset of each frame; one extra entry marks the end of the last. */
  offsets: Float64Array
  count: number
}

interface Frame {
  len: number
  sampleRate: number
  samplesPerFrame: number
}

const MP3_RATES = [
  [11025, 12000, 8000], // MPEG 2.5
  [],
  [22050, 24000, 16000], // MPEG 2
  [44100, 48000, 32000], // MPEG 1
]
const MP3_KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const MP3_KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
export const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

/** An MP3 (MPEG audio layer III) frame header at b[i], or null. */
export function mp3Frame(b: Uint8Array, i: number): Frame | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null
  const version = (b[i + 1] >> 3) & 3
  const layer = (b[i + 1] >> 1) & 3
  const kbpsIdx = b[i + 2] >> 4
  const rateIdx = (b[i + 2] >> 2) & 3
  if (version === 1 || layer !== 1 || kbpsIdx === 0 || kbpsIdx === 15 || rateIdx === 3) return null
  const sampleRate = MP3_RATES[version][rateIdx]
  const v1 = version === 3
  const kbps = (v1 ? MP3_KBPS_V1 : MP3_KBPS_V2)[kbpsIdx]
  const samplesPerFrame = v1 ? 1152 : 576
  const len = Math.floor(((samplesPerFrame / 8) * kbps * 1000) / sampleRate) + ((b[i + 2] >> 1) & 1)
  return { len, sampleRate, samplesPerFrame }
}

/** An ADTS (AAC) frame header at b[i], or null. */
export function adtsFrame(b: Uint8Array, i: number): Frame | null {
  if (i + 7 > b.length || b[i] !== 0xff || (b[i + 1] & 0xf6) !== 0xf0) return null
  const rateIdx = (b[i + 2] >> 2) & 15
  if (rateIdx >= ADTS_RATES.length) return null
  const len = ((b[i + 3] & 3) << 11) | (b[i + 4] << 3) | (b[i + 5] >> 5)
  if (len < 7) return null
  return { len, sampleRate: ADTS_RATES[rateIdx], samplesPerFrame: 1024 * ((b[i + 6] & 3) + 1) }
}

/** The 7-byte ADTS header for one raw AAC frame. */
export function adtsHeader(profile: number, rateIdx: number, channels: number, payload: number) {
  const len = payload + 7
  return new Uint8Array([
    0xff,
    0xf1, // MPEG-4, layer 0, no CRC
    ((profile - 1) << 6) | (rateIdx << 2) | (channels >> 2),
    ((channels & 3) << 6) | (len >> 11),
    (len >> 3) & 0xff,
    ((len & 7) << 5) | 0x1f,
    0xfc,
  ])
}

/** Which codec, from the first bytes of a file (after any ID3 tag). */
export function sniffFrames(head: Uint8Array): Codec | null {
  const start = id3Size(head)
  for (let i = start; i < Math.min(head.length - 8, start + 8192); i++) {
    for (const [codec, parse] of [['mp3', mp3Frame], ['aac', adtsFrame]] as const) {
      const f = parse(head, i)
      // Two frames in a row: a real stream, not a stray 0xFF byte.
      if (f && parse(head, i + f.len)) return codec
    }
  }
  return null
}

export function id3Size(b: Uint8Array) {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
  return 10 + size + (b[5] & 0x10 ? 10 : 0)
}

/** Whether an MP3 frame is the Xing/Info header (no audio of its own). */
function isInfoFrame(b: Uint8Array, i: number, len: number) {
  const end = Math.min(i + Math.min(len, 64), b.length - 4)
  for (let j = i + 4; j < end; j++) {
    const s = String.fromCharCode(b[j], b[j + 1], b[j + 2], b[j + 3])
    if (s === 'Xing' || s === 'Info') return true
  }
  return false
}

const PIECE = 4 * 1024 * 1024

/** Every frame of an MP3 or ADTS blob, read in 4 MB pieces (a three-hour
 *  file never has to be in memory at once). */
export async function indexFrames(blob: Blob, codec: Codec): Promise<FrameIndex> {
  const parse = codec === 'mp3' ? mp3Frame : adtsFrame
  let offsets = new Float64Array(1 << 16)
  let count = 0
  let rate = 0
  let spf = 0
  // (an ID3 tag with cover art can be megabytes: start reading after it)
  let base = id3Size(new Uint8Array(await blob.slice(0, 10).arrayBuffer())) // file offset of buf[0]
  let buf = new Uint8Array(await blob.slice(base, base + PIECE).arrayBuffer())
  let i = 0
  let first = true
  while (base + i < blob.size) {
    // Keep at least one whole frame (max ~8 KB) ahead in the buffer.
    if (i + 8192 > buf.length && base + buf.length < blob.size) {
      const next = new Uint8Array(await blob.slice(base + buf.length, base + buf.length + PIECE).arrayBuffer())
      const merged = new Uint8Array(buf.length - i + next.length)
      merged.set(buf.subarray(i))
      merged.set(next, buf.length - i)
      base += i
      buf = merged
      i = 0
    }
    let f = parse(buf, i)
    if (f && rate && (f.sampleRate !== rate || f.samplesPerFrame !== spf)) f = null
    // Resynchronise after junk (tags, a damaged frame): a header must be
    // followed by another one to count.
    if (f && !rate && !parse(buf, i + f.len) && base + i + f.len < blob.size) f = null
    if (!f) {
      i++
      continue
    }
    if (first && codec === 'mp3' && isInfoFrame(buf, i, f.len)) {
      first = false
      i += f.len
      continue
    }
    first = false
    if (base + i + f.len > blob.size) break // a cut-off last frame
    rate = f.sampleRate
    spf = f.samplesPerFrame
    if (count + 2 > offsets.length) {
      const grown = new Float64Array(offsets.length * 2)
      grown.set(offsets)
      offsets = grown
    }
    offsets[count++] = base + i
    offsets[count] = base + i + f.len
    i += f.len
  }
  if (!count) throw new Error('No audio frames were found in this file.')
  return { codec, mimeType: codec === 'mp3' ? 'audio/mpeg' : 'audio/aac', sampleRate: rate, samplesPerFrame: spf, offsets: offsets.slice(0, count + 1), count }
}

export const frameSeconds = (ix: FrameIndex) => ix.samplesPerFrame / ix.sampleRate
export const indexDuration = (ix: FrameIndex) => ix.count * frameSeconds(ix)

/** The frame at (or just before) a time. */
export const frameAt = (ix: FrameIndex, sec: number) => Math.max(0, Math.min(ix.count, Math.round(sec / frameSeconds(ix))))

/** Frames [from, to) as their own playable blob. */
export const sliceFrames = (blob: Blob, ix: FrameIndex, from: number, to: number) =>
  blob.slice(ix.offsets[Math.max(0, from)], ix.offsets[Math.min(ix.count, to)], ix.mimeType)
