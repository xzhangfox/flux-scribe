import type { Meeting, Speaker } from './types'

export function clock(sec: number) {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "1:02:03" / "2:03" → seconds. */
export function parseClock(text: string): number | null {
  const parts = text.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function durationLabel(sec: number) {
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.round(sec / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

// Identity colours for speakers, in a fixed order (never cycled by rank):
// distinct hues that read on all four dark themes. Names are always shown
// beside them, so identity is never colour alone.
export const SPEAKER_COLORS = ['#e6b85c', '#5cc8e6', '#ef8fc9', '#7fd6a6', '#a99bf0', '#f29a5c', '#8fb4ff', '#c9d66b']

export function speakerColor(speakers: Speaker[], id: string) {
  const i = speakers.findIndex((s) => s.id === id)
  return SPEAKER_COLORS[(i < 0 ? 0 : i) % SPEAKER_COLORS.length]
}

export function speakerName(speakers: Speaker[], id: string) {
  const s = speakers.find((x) => x.id === id)
  if (s?.name) return s.name
  const n = id.replace(/^S/, '')
  return `Speaker ${n}`
}

/** The transcript as the model sees it for minutes and Q&A. */
export function transcriptText(m: Pick<Meeting, 'segments' | 'speakers'>) {
  return m.segments.map((s) => `[${clock(s.start)}] ${speakerName(m.speakers, s.speaker)}: ${s.text}`).join('\n')
}

export function toMarkdown(m: Meeting) {
  const lines = [`# ${m.title}`, '', `${new Date(m.createdAt).toLocaleString()} · ${durationLabel(m.durationSec)} · ${m.speakers.map((s) => speakerName(m.speakers, s.id)).join(', ')}`, '']
  if (m.minutes) {
    const mm = m.minutes
    lines.push('## Summary', '', mm.summary, '')
    if (mm.decisions.length) lines.push('## Decisions', '', ...mm.decisions.map((d) => `- ${d}`), '')
    if (mm.actionItems.length) lines.push('## Action items', '', ...mm.actionItems.map((a) => `- [${a.done ? 'x' : ' '}] ${a.task}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (${a.due})` : ''}`), '')
    if (mm.keyPoints.length) lines.push('## Key points', '', ...mm.keyPoints.map((k) => `- ${k}`), '')
  }
  lines.push('## Transcript', '')
  for (const s of m.segments) lines.push(`**${speakerName(m.speakers, s.speaker)}** [${clock(s.start)}]: ${s.text}`, '')
  return lines.join('\n')
}
