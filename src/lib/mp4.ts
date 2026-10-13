import { ADTS_RATES, adtsHeader, mp3Frame, type FrameIndex } from './frames'

// The audio track of an MP4 / M4A / MOV (iPhone Voice Memos, Zoom, video
// recordings) taken out as a stream of frames, without decoding: AAC is
// rewrapped as ADTS, MP3 copied as is. Gemini reads both, the browser plays
// both, and a three-hour file takes seconds instead of a decode that would
// need gigabytes of memory. Anything else (Apple Lossless, Opus…) returns
// null and goes the decode-and-encode way.

interface Box {
  type: string
  start: number // payload start (after the header)
  end: number
}

function boxes(v: DataView, from: number, to: number): Box[] {
  const out: Box[] = []
  let p = from
  while (p + 8 <= to) {
    let size = v.getUint32(p)
    const type = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7))
    let head = 8
    if (size === 1) {
      size = Number(v.getBigUint64(p + 8))
      head = 16
    } else if (size === 0) size = to - p
    if (size < head || p + size > to) break
    out.push({ type, start: p + head, end: p + size })
    p += size
  }
  return out
}

const child = (v: DataView, b: Box | undefined, type: string) => (b ? boxes(v, b.start, b.end).find((x) => x.type === type) : undefined)
const path = (v: DataView, b: Box | undefined, ...types: string[]) => types.reduce((acc, t) => child(v, acc, t), b)

/** Finds the moov box by walking the top level (it may sit before or after
 *  the media data) and reads just that. */
async function readMoov(file: Blob): Promise<{ v: DataView; head: number } | null> {
  let p = 0
  while (p + 8 <= file.size) {
    const h = new DataView(await file.slice(p, p + 16).arrayBuffer())
    if (h.byteLength < 8) return null
    let size = h.getUint32(0)
    let head = 8
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7))
    if (size === 1) {
      size = h.byteLength >= 16 ? Number(h.getBigUint64(8)) : 0
      head = 16
    } else if (size === 0) size = file.size - p
    if (size < head) return null
    if (type === 'moov') return size > 256 * 1024 * 1024 ? null : { v: new DataView(await file.slice(p, p + size).arrayBuffer()), head }
    p += size
  }
  return null
}

/** MPEG-4 descriptor: tag, then a size in 1–4 bytes of 7 bits each. */
function descriptor(v: DataView, p: number, end: number) {
  if (p + 2 > end) return null
  const tag = v.getUint8(p++)
  let size = 0
  for (let i = 0; i < 4 && p < end; i++) {
    const b = v.getUint8(p++)
    size = (size << 7) | (b & 0x7f)
    if (!(b & 0x80)) break
  }
  return { tag, start: p, end: Math.min(end, p + size) }
}

interface AudioCodec {
  kind: 'aac' | 'mp3'
  profile: number // AAC object type of the core (1–4)
  rateIdx: number
  channels: number
}

/** The codec from an `esds` box: AAC (with its AudioSpecificConfig) or MP3. */
function fromEsds(v: DataView, esds: Box): AudioCodec | null {
  const es = descriptor(v, esds.start + 4, esds.end)
  if (!es || es.tag !== 0x03) return null
  let p = es.start + 2
  const flags = v.getUint8(p++)
  if (flags & 0x80) p += 2
  if (flags & 0x40) p += 1 + v.getUint8(p)
  if (flags & 0x20) p += 2
  const dc = descriptor(v, p, es.end)
  if (!dc || dc.tag !== 0x04) return null
  const oti = v.getUint8(dc.start)
  if (oti === 0x69 || oti === 0x6b) return { kind: 'mp3', profile: 0, rateIdx: 0, channels: 0 }
  if (oti !== 0x40 && oti !== 0x66 && oti !== 0x67 && oti !== 0x68) return null
  const dsi = descriptor(v, dc.start + 13, dc.end)
  if (!dsi || dsi.tag !== 0x05 || dsi.end - dsi.start < 2) return null
  // AudioSpecificConfig, read bit by bit.
  let bit = dsi.start * 8
  const bits = (n: number) => {
    let x = 0
    for (let i = 0; i < n; i++, bit++) x = (x << 1) | ((v.getUint8(bit >> 3) >> (7 - (bit & 7))) & 1)
    return x
  }
  const objectType = () => {
    const t = bits(5)
    return t === 31 ? 32 + bits(6) : t
  }
  const rate = () => {
    const i = bits(4)
    if (i !== 15) return i
    const hz = bits(24)
    return ADTS_RATES.indexOf(hz)
  }
  let profile = objectType()
  let rateIdx = rate()
  const channels = bits(4)
  if (profile === 5 || profile === 29) {
    // HE-AAC: ADTS carries the AAC-LC core at its own rate; decoders find
    // the SBR / PS extension on their own.
    rate()
    profile = objectType()
  }
  if (oti !== 0x40) profile = oti - 0x65 // MPEG-2 AAC Main / LC / SSR
  if (profile < 1 || profile > 4 || rateIdx < 0 || rateIdx >= ADTS_RATES.length || channels < 1 || channels > 7) return null
  return { kind: 'aac', profile, rateIdx, channels }
}

function findBox(v: DataView, from: number, to: number, type: string): Box | null {
  // Sample entries nest their boxes after a version-dependent fixed part
  // (and QuickTime may wrap `esds` in a `wave` box), so search for it.
  for (let p = from; p + 8 <= to; p++) {
    if (v.getUint8(p + 4) !== type.charCodeAt(0)) continue
    if (String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7)) !== type) continue
    const size = v.getUint32(p)
    if (size >= 8 && p + size <= to) return { type, start: p + 8, end: p + size }
  }
  return null
}

interface Track {
  codec: AudioCodec
  sizes: Uint32Array
  offsets: Float64Array // file offset of every sample
}

function soundTrack(moov: DataView, head: number): Track | null {
  const root: Box = { type: 'moov', start: head, end: moov.byteLength }
  for (const trak of boxes(moov, root.start, root.end).filter((b) => b.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia')
    const hdlr = child(moov, mdia, 'hdlr')
    if (!hdlr || String.fromCharCode(...[8, 9, 10, 11].map((i) => moov.getUint8(hdlr.start + i))) !== 'soun') continue
    const stbl = path(moov, mdia, 'minf', 'stbl')
    const stsd = child(moov, stbl, 'stsd')
    if (!stbl || !stsd) continue
    const entry = boxes(moov, stsd.start + 8, stsd.end)[0]
    if (!entry) continue
    let codec: AudioCodec | null = null
    if (entry.type === '.mp3') codec = { kind: 'mp3', profile: 0, rateIdx: 0, channels: 0 }
    else if (entry.type === 'mp4a') {
      const esds = findBox(moov, entry.start, entry.end, 'esds')
      codec = esds && fromEsds(moov, esds)
    }
    if (!codec) return null

    // Sample sizes.
    const stsz = child(moov, stbl, 'stsz')
    if (!stsz) return null
    const fixed = moov.getUint32(stsz.start + 4)
    const count = moov.getUint32(stsz.start + 8)
    if (!count) return null // fragmented MP4: no sample table to follow
    const sizes = new Uint32Array(count)
    for (let i = 0; i < count; i++) sizes[i] = fixed || moov.getUint32(stsz.start + 12 + i * 4)

    // Chunk offsets.
    const stco = child(moov, stbl, 'stco')
    const co64 = child(moov, stbl, 'co64')
    const co = stco || co64
    if (!co) return null
    const chunks = moov.getUint32(co.start + 4)
    const chunkAt = (i: number) => (stco ? moov.getUint32(co.start + 8 + i * 4) : Number(moov.getBigUint64(co.start + 8 + i * 8)))

    // Samples per chunk (runs), and so every sample's offset.
    const stsc = child(moov, stbl, 'stsc')
    if (!stsc) return null
    const runs = moov.getUint32(stsc.start + 4)
    const offsets = new Float64Array(count)
    let s = 0
    for (let r = 0; r < runs && s < count; r++) {
      const first = moov.getUint32(stsc.start + 8 + r * 12) - 1
      const per = moov.getUint32(stsc.start + 12 + r * 12)
      const last = r + 1 < runs ? moov.getUint32(stsc.start + 8 + (r + 1) * 12) - 1 : chunks
      for (let c = first; c < last && s < count; c++) {
        let off = chunkAt(c)
        for (let k = 0; k < per && s < count; k++) {
          offsets[s] = off
          off += sizes[s++]
        }
      }
    }
    if (s < count) return null
    return { codec, sizes, offsets }
  }
  return null
}

/** The audio of an MP4-family file as an ADTS or MP3 stream, with its frame
 *  index — or null if it has no audio this can take out as is. */
export async function mp4Audio(file: Blob, onProgress: (p: number) => void = () => {}): Promise<{ blob: Blob; index: FrameIndex } | null> {
  const moov = await readMoov(file)
  const track = moov && soundTrack(moov.v, moov.head)
  if (!track) return null
  const { codec, sizes, offsets } = track
  const n = sizes.length
  const head = codec.kind === 'aac' ? 7 : 0
  const out = new Float64Array(n + 1)
  const parts: Uint8Array[] = []
  let written = 0
  let rate = 0
  let spf = 1024

  // Read the samples in large runs (they sit in chunks, mostly back to back;
  // in a video they're interleaved with frames, which are skipped over).
  let i = 0
  while (i < n) {
    let j = i + 1
    let end = offsets[i] + sizes[i]
    while (j < n && offsets[j] >= end && offsets[j] - end < 512 * 1024 && offsets[j] + sizes[j] - offsets[i] < 8 * 1024 * 1024) {
      end = offsets[j] + sizes[j]
      j++
    }
    const src = new Uint8Array(await file.slice(offsets[i], end).arrayBuffer())
    if (src.length < end - offsets[i]) return null
    let total = 0
    for (let k = i; k < j; k++) total += sizes[k] + head
    const dst = new Uint8Array(total)
    let p = 0
    for (let k = i; k < j; k++) {
      const at = offsets[k] - offsets[i]
      if (codec.kind === 'aac') dst.set(adtsHeader(codec.profile, codec.rateIdx, codec.channels, sizes[k]), p)
      else if (!rate) {
        const f = mp3Frame(src, at)
        if (!f) return null
        rate = f.sampleRate
        spf = f.samplesPerFrame
      }
      dst.set(src.subarray(at, at + sizes[k]), p + head)
      out[k] = written + p
      p += sizes[k] + head
    }
    parts.push(dst)
    written += total
    i = j
    onProgress(i / n)
  }
  out[n] = written
  if (codec.kind === 'aac') rate = ADTS_RATES[codec.rateIdx]
  const mimeType = codec.kind === 'aac' ? 'audio/aac' : 'audio/mpeg'
  return {
    blob: new Blob(parts as BlobPart[], { type: mimeType }),
    index: { codec: codec.kind, mimeType, sampleRate: rate, samplesPerFrame: spf, offsets: out, count: n },
  }
}

/** Whether the first bytes are an MP4-family file (`ftyp` box first). */
export const isMp4 = (head: Uint8Array) => head.length >= 12 && String.fromCharCode(head[4], head[5], head[6], head[7]) === 'ftyp'
