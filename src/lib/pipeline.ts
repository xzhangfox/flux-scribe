import { transcribe, writeMinutes } from './api'
import { transcriptText } from './format'
import { getMeeting, updateMeeting } from './store'

// Runs (or re-runs) a meeting's processing: transcription with speakers,
// then minutes. Progress is written to the meeting record itself, so the
// UI just observes it — and a reload mid-way leaves a meeting the user
// can simply retry, audio intact.
type Listener = (id: string) => void
const listeners = new Set<Listener>()
export const onMeetingChange = (fn: Listener) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
const emit = (id: string) => listeners.forEach((fn) => fn(id))

const running = new Set<string>()
export const isRunning = (id: string) => running.has(id)

export async function processMeeting(id: string) {
  if (running.has(id)) return
  const m = await getMeeting(id)
  if (!m) return
  running.add(id)
  const stage = async (s: string) => {
    await updateMeeting(id, { status: 'processing', stage: s, error: undefined })
    emit(id)
  }
  try {
    let current = m
    if (!m.segments.length) {
      await stage('Preparing audio')
      const t = await transcribe(m.audio, m.mimeType, { context: m.context, title: m.title }, (s, p) => {
        void stage(s === 'uploading' ? `Uploading${p ? ` · ${Math.round(p * 100)}%` : ''}` : 'Transcribing & separating speakers')
      })
      if (!t.segments.length) throw new Error('No speech was found in this recording.')
      current = (await updateMeeting(id, { segments: t.segments, speakers: t.speakers, language: t.language, truncated: t.truncated }))!
      emit(id)
    }
    if (!current.minutes) {
      await stage('Writing the minutes')
      const minutes = await writeMinutes(transcriptText(current))
      await updateMeeting(id, (cur) => ({ minutes, title: cur.title.startsWith('Meeting ·') && minutes.title ? minutes.title : cur.title }))
    }
    await updateMeeting(id, { status: 'ready', stage: undefined, error: undefined })
  } catch (err) {
    await updateMeeting(id, { status: 'error', stage: undefined, error: err instanceof Error ? err.message : String(err) })
  } finally {
    running.delete(id)
    emit(id)
  }
}
