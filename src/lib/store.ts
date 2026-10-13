import { createStore, del, entries, get, set } from 'idb-keyval'
import type { Meeting, MeetingSummary } from './types'
import { DEMO_ID, demoMeeting } from './demo'

// Meetings live in this browser only (IndexedDB) — no server copy: the
// recording leaves the device only for transcription. The text (transcript,
// minutes, chat) and the audio are kept apart, so listing meetings never
// reads a recording, and a recording can be removed on its own to free
// space while the minutes stay. Guests get a separate demo library, so
// they never see the meetings of whoever signed in on this device before.
const real = { meetings: createStore('flux-scribe', 'meetings'), audio: createStore('flux-scribe-audio', 'audio') }
const demo = { meetings: createStore('flux-scribe-demo', 'meetings'), audio: createStore('flux-scribe-demo-audio', 'audio') }
let lib = real

export async function setDemoLibrary(on: boolean) {
  lib = on ? demo : real
  await migrate()
  if (on && !(await get(DEMO_ID, demo.meetings))) {
    const { meeting, audio } = demoMeeting()
    await set(DEMO_ID, audio, demo.audio)
    await set(DEMO_ID, meeting, demo.meetings)
  }
}

/** Meetings saved before the split kept their audio inline: move it out. */
async function migrate() {
  for (const [id, m] of await entries<string, Meeting & { audio?: Blob }>(lib.meetings)) {
    if (!(m.audio instanceof Blob)) continue
    const { audio, ...rest } = m
    await set(id, audio, lib.audio)
    await set(id, { ...rest, audioBytes: audio.size }, lib.meetings)
  }
}

export const getMeeting = (id: string) => get<Meeting>(id, lib.meetings)
export const saveMeeting = (m: Meeting) => set(m.id, m, lib.meetings)
export const getAudio = (id: string) => get<Blob>(id, lib.audio)

export async function addMeeting(m: Meeting, audio: Blob) {
  await set(m.id, audio, lib.audio)
  await saveMeeting({ ...m, audioBytes: audio.size })
  void keepStorage()
}

export async function deleteMeeting(id: string) {
  await del(id, lib.audio)
  await del(id, lib.meetings)
}

/** Frees the recording's space; transcript, minutes and chat stay. */
export async function removeAudio(id: string) {
  await del(id, lib.audio)
  return updateMeeting(id, { audioBytes: 0, audioRemoved: true })
}

export async function updateMeeting(id: string, patch: Partial<Meeting> | ((m: Meeting) => Partial<Meeting>)) {
  const m = await getMeeting(id)
  if (!m) return undefined
  const next = { ...m, ...(typeof patch === 'function' ? patch(m) : patch) }
  await saveMeeting(next)
  return next
}

export async function listMeetings(): Promise<MeetingSummary[]> {
  const all = await entries<string, Meeting>(lib.meetings)
  return all
    .map(([, m]) => ({
      id: m.id,
      title: m.title,
      createdAt: m.createdAt,
      durationSec: m.durationSec,
      status: m.status,
      stage: m.stage,
      audioBytes: m.audioBytes ?? 0,
      speakerCount: m.speakers.length,
      summary: m.minutes?.summary,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Asks the browser not to clear this site's data when space runs low
 *  (Safari otherwise may, after weeks without a visit). */
export async function keepStorage() {
  try {
    if (!(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.()
  } catch {
    /* not supported: nothing to do */
  }
}

export async function storageInfo(): Promise<{ used: number; quota: number; persisted: boolean } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    if (!e) return null
    return { used: e.usage ?? 0, quota: e.quota ?? 0, persisted: !!(await navigator.storage.persisted?.()) }
  } catch {
    return null
  }
}
