// What's usable of a transcription answer that didn't end properly: the
// output limit cut it off mid-JSON, or the model got stuck repeating one
// line (it then repeats it until that limit). Everything up to the last
// whole segment is kept; the app sends the rest of the part again.

export interface RawTranscript {
  language: string
  speakers: { id: string; name: string }[]
  segments: { speaker: string; start: number; end: number; text: string }[]
}

/** The whole segments of a cut-off JSON answer, or null if there are none. */
export function salvage(text: string): RawTranscript | null {
  const at = text.indexOf('"segments"')
  const open = at < 0 ? -1 : text.indexOf('[', at)
  if (open < 0) return null
  const segments: RawTranscript['segments'] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') {
      if (depth++ === 0) start = i
    } else if (c === '}') {
      if (--depth === 0) {
        try {
          segments.push(JSON.parse(text.slice(start, i + 1)))
        } catch {
          /* a damaged object: skip it */
        }
      }
    } else if (c === ']' && depth === 0) break
  }
  if (!segments.length) return null
  let speakers: RawTranscript['speakers'] = []
  const list = /"speakers"\s*:\s*(\[[^\]]*\])/.exec(text)
  try {
    if (list) speakers = JSON.parse(list[1])
  } catch {
    /* labels are filled in from the segments */
  }
  return { language: /"language"\s*:\s*"([^"]*)"/.exec(text)?.[1] || '', speakers, segments }
}

/** Where a model got stuck: the first of three identical lines in a row from
 *  the same speaker, or -1. */
export function loopStart(segments: { speaker: string; text: string }[]) {
  for (let i = 0; i + 2 < segments.length; i++) {
    const a = segments[i]
    if (segments[i + 1].speaker === a.speaker && segments[i + 2].speaker === a.speaker && segments[i + 1].text === a.text && segments[i + 2].text === a.text) return i
  }
  return -1
}
