import { createStore, del, entries, get, set } from 'idb-keyval'
import type { Meeting, MeetingSummary } from './types'
import { DEMO_ID, demoMeeting } from './demo'

// Meetings live in this browser only (IndexedDB) — audio included. No
// server copy: the recording leaves the device only for the transcription
// call itself. Guests get a separate demo library, so they never see the
// meetings of whoever signed in on this device before.
const library = createStore('flux-scribe', 'meetings')
const demoLibrary = createStore('flux-scribe-demo', 'meetings')
let meetings = library

export async function setDemoLibrary(on: boolean) {
  meetings = on ? demoLibrary : library
  if (on && !(await get(DEMO_ID, demoLibrary))) await set(DEMO_ID, demoMeeting(), demoLibrary)
}

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
