import { createStore, del, entries, get, set } from 'idb-keyval'
import type { Meeting, MeetingSummary } from './types'

// Meetings live in this browser only (IndexedDB) — audio included. No
// account, no server copy: the recording leaves the device only for the
// transcription call itself.
const meetings = createStore('flux-scribe', 'meetings')

export const saveMeeting = (m: Meeting) => set(m.id, m, meetings)
export const getMeeting = (id: string) => get<Meeting>(id, meetings)
export const deleteMeeting = (id: string) => del(id, meetings)

export async function updateMeeting(id: string, patch: Partial<Meeting> | ((m: Meeting) => Partial<Meeting>)) {
  const m = await getMeeting(id)
  if (!m) return undefined
  const next = { ...m, ...(typeof patch === 'function' ? patch(m) : patch) }
  await saveMeeting(next)
  return next
}

export async function listMeetings(): Promise<MeetingSummary[]> {
  const all = await entries<string, Meeting>(meetings)
  return all
    .map(([, m]) => ({
      id: m.id,
      title: m.title,
      createdAt: m.createdAt,
      durationSec: m.durationSec,
      status: m.status,
      speakerCount: m.speakers.length,
      summary: m.minutes?.summary,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}
