import { isTransient, transcribe, writeMinutes, type VoiceSample } from './api'
import { clock, transcriptText } from './format'
import { frameAt, frameSeconds, indexDuration, indexFrames, sliceFrames, type FrameIndex } from './frames'
import { decodeMono16k } from './encode'
import { SAMPLE_RATE } from './mp3'
import { deleteMeeting, getAudio, getMeeting, removeAudio, updateMeeting } from './store'
import { notify, setBusy, setIdle } from './activity'
import type { Job, Meeting, Segment, Speaker, Usage, VoiceRef } from './types'

// Runs (or resumes) a meeting's processing: transcription with speakers,
// then minutes. Up to ~20 minutes of audio goes to the model in one piece.
// Anything longer is cut into ~15-minute parts at natural pauses and
// transcribed part by part; each part after the first carries a few
// seconds of every voice already heard, so speaker labels hold across the
// whole meeting. Every finished part is saved straight away: a reload,
// a phone that put the page to sleep or a dropped connection costs at most
// the part in flight, and processing picks up where it stopped.
type Listener = (id: string) => void
const listeners = new Set<Listener>()
export const onMeetingChange = (fn: Listener) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
const emit = (id: string) => listeners.forEach((fn) => fn(id))

// Upload percentages change many times a second: kept in memory and sent
// to the meeting page only, never written to the database.
const live = new Map<string, string>()
const liveListeners = new Set<Listener>()
export const liveStage = (id: string) => live.get(id)
export const onLiveStage = (fn: Listener) => {
  liveListeners.add(fn)
  return () => void liveListeners.delete(fn)
}
function setLive(id: string, stage: string | undefined) {
  if (stage) live.set(id, stage)
  else live.delete(id)
  liveListeners.forEach((fn) => fn(id))
}

const running = new Map<string, AbortController>()
export const isRunning = (id: string) => running.has(id)

// Pace of this run, for the time-left estimate.
const pace = new Map<string, { at: number; parts: number }>()
export function etaSeconds(m: Meeting): number | null {
  const p = pace.get(m.id)
  if (!p || !m.job) return null
  const done = m.job.done - p.parts
  if (done < 1) return null
  return ((Date.now() - p.at) / done) * (m.job.cuts.length - 1 - m.job.done)
}

const PART_SEC = 15 * 60
const ONE_PASS_MAX = 20 * 60
const SEARCH_SEC = 60
const MIN_LAST_SEC = 7.5 * 60 // a shorter tail joins the part before (≤ ~22 min)
const MAX_REFS = 8
const REF_SEC = 8

class Cancelled extends Error {}

/** Stops any processing and deletes the meeting and its recording. */
export async function removeMeeting(id: string) {
  running.get(id)?.abort()
  await deleteMeeting(id)
  setLive(id, undefined)
  emit(id)
}

export async function removeRecording(id: string) {
  running.get(id)?.abort()
  await removeAudio(id)
  emit(id)
}

export async function processMeeting(id: string) {
  if (running.has(id)) return
  const ctrl = new AbortController()
  running.set(id, ctrl)
  const signal = ctrl.signal
  const check = () => {
    if (signal.aborted) throw new Cancelled()
  }
  /** Writes to the meeting; a meeting deleted meanwhile ends the run. */
  const write = async (patch: Partial<Meeting> | ((m: Meeting) => Partial<Meeting>)) => {
    check()
    const next = await updateMeeting(id, patch)
    if (!next) throw new Cancelled()
    emit(id)
    return next
  }
  const stage = (s: string) => {
    setLive(id, undefined)
    setBusy(id, s.replace(/^Transcribing part (\d+) of (\d+)$/, 'Transcribing $1/$2'))
    return write({ status: 'processing', stage: s, error: undefined })
  }
  const spend = (u?: Usage) => (cur: Meeting) => (u ? { usage: { input: (cur.usage?.input || 0) + u.input, output: (cur.usage?.output || 0) + u.output } } : {})

  let title = ''
  try {
    let m = await getMeeting(id)
    if (!m) return
    title = m.title
    if (!m.segments.length || m.job) {
      const audio = await getAudio(id)
      if (!audio) throw new Error("This meeting's recording was removed, so it can't be transcribed again.")
      m = await stage('Preparing audio')
      const ix = await indexAudio(audio, m.mimeType)
      let job = m.job
      if (!job) {
        const duration = ix ? indexDuration(ix) : m.durationSec
        job = { cuts: ix && duration > ONE_PASS_MAX ? await planCuts(audio, ix, duration, signal) : [0, duration], done: 0, refs: [] }
        m = await write({ job, segments: [], speakers: [], truncated: false })
      }
      const parts = job.cuts.length - 1
      pace.set(id, { at: Date.now(), parts: job.done })
      for (let k = job.done; k < parts; k++) {
        m = await stage(parts > 1 ? `Transcribing part ${k + 1} of ${parts}` : 'Transcribing & separating speakers')
        const from = ix && parts > 1 ? frameAt(ix, job.cuts[k]) : 0
        const to = ix && parts > 1 ? frameAt(ix, job.cuts[k + 1]) : 0
        const offset = ix ? from * frameSeconds(ix) : 0
        const blob = ix && parts > 1 ? sliceFrames(audio, ix, from, to) : audio
        const mimeType = ix?.mimeType || m.mimeType
        const refs = ix && parts > 1 ? voiceSamples(audio, ix, job.refs, m.speakers) : []
        const previous = m.segments.slice(-6).map((s) => `[${clock(s.start)}] ${s.speaker}: ${s.text}`)
        const label = parts > 1 ? `Part ${k + 1} of ${parts}` : ''
        const t = await retrying(
          () =>
            transcribe(blob, mimeType, { context: m!.context, title: m!.title, part: parts > 1 ? { index: k, total: parts, offset } : undefined, speakers: m!.speakers, refs, previous, signal }, (s, p) => {
              setLive(id, s === 'uploading' ? `${label ? `${label} · ` : ''}Uploading${p ? ` · ${Math.round(p * 100)}%` : ''}` : undefined)
            }),
          signal,
          (msg) => setLive(id, msg),
        )
        check()
        if (parts === 1 && !t.segments.length) throw new Error('No speech was found in this recording.')
        const length = ix && parts > 1 ? (to - from) * frameSeconds(ix) : Infinity
        let found = t.segments
        // Times should be within the part; if the model gave meeting times
        // instead, take the part's start back off.
        if (offset > 0 && found.length && found.every((s) => s.start >= offset - 2) && found.some((s) => s.start > length + 2))
          found = found.map((s) => ({ ...s, start: s.start - offset, end: s.end - offset }))
        const segments: Segment[] = found
          .filter((s) => s.start <= length + 2)
          .map((s) => ({ ...s, start: s.start + offset, end: Math.max(s.start, Math.min(s.end, length + 2)) + offset }))
        const current: Job = job
        const next: Job | undefined = k + 1 < parts ? { ...current, done: k + 1, refs: pickRefs(current.refs, segments) } : undefined
        m = await write((cur) => ({
          segments: [...cur.segments, ...segments],
          speakers: mergeSpeakers(cur.speakers, t.speakers),
          language: cur.language || t.language,
          truncated: cur.truncated || t.truncated,
          job: next,
          ...spend(t.usage)(cur),
        }))
        if (next) job = next
      }
      if (!m.segments.length) throw new Error('No speech was found in this recording.')
    }
    if (!m.minutes) {
      await stage('Writing the minutes')
      const { minutes, usage } = await retrying(() => writeMinutes(transcriptText(m!), signal), signal, (msg) => setLive(id, msg))
      m = await write((cur) => ({ minutes, title: cur.title.startsWith('Meeting ·') && minutes.title ? minutes.title : cur.title, ...spend(usage)(cur) }))
      title = m.title
    }
    await write({ status: 'ready', stage: undefined, error: undefined })
    notify('Minutes ready', title)
    setIdle(id, 'Minutes ready')
  } catch (err) {
    setIdle(id)
    if (err instanceof Cancelled || signal.aborted) return
    await updateMeeting(id, { status: 'error', stage: undefined, error: err instanceof Error ? err.message : String(err) })
  } finally {
    running.delete(id)
    pace.delete(id)
    setLive(id, undefined)
    emit(id)
  }
}

/** Resumes every meeting left mid-way (a reload, a page put to sleep). */
export async function resumeAll(list: { id: string; status: string }[]) {
  for (const m of list) if (m.status === 'processing' && !running.has(m.id)) void processMeeting(m.id)
}

async function indexAudio(audio: Blob, mimeType: string): Promise<FrameIndex | null> {
  const codec = mimeType === 'audio/mpeg' ? 'mp3' : mimeType === 'audio/aac' ? 'aac' : null
  if (!codec) return null
  try {
    return await indexFrames(audio, codec)
  } catch {
    return null
  }
}

/** Part boundaries every ~15 minutes, each moved to the quietest moment
 *  within a minute of it, so no word is cut in half. */
async function planCuts(audio: Blob, ix: FrameIndex, duration: number, signal: AbortSignal) {
  const cuts = [0]
  let target = PART_SEC
  while (duration - target > MIN_LAST_SEC) {
    if (signal.aborted) throw new Cancelled()
    const cut = await quietestNear(audio, ix, target)
    cuts.push(cut)
    target = cut + PART_SEC
  }
  cuts.push(duration)
  return cuts
}

async function quietestNear(audio: Blob, ix: FrameIndex, t: number) {
  const from = frameAt(ix, t - SEARCH_SEC)
  const to = frameAt(ix, t + SEARCH_SEC)
  try {
    const pcm = await decodeMono16k(await sliceFrames(audio, ix, from, to).arrayBuffer())
    const bin = SAMPLE_RATE / 10 // 100 ms
    const energy: number[] = []
    for (let i = 0; i + bin <= pcm.length; i += bin) {
      let e = 0
      for (let j = i; j < i + bin; j++) e += pcm[j] * pcm[j]
      energy.push(e)
    }
    const W = 6 // 0.6 s windows
    const sums: number[] = []
    for (let i = 0, sum = 0; i < energy.length; i++) {
      sum += energy[i] - (i >= W ? energy[i - W] : 0)
      if (i >= W - 1) sums.push(sum)
    }
    if (!sums.length) return t
    // Of the near-quietest moments, the one closest to the planned time
    // (so parts stay ~15 minutes rather than drifting early).
    const quiet = Math.min(...sums) * 2 + 1e-4
    const start = from * frameSeconds(ix)
    let best = -1
    for (let i = 0; i < sums.length; i++) {
      const at = start + (i + W / 2) / 10
      if (sums[i] <= quiet && (best < 0 || Math.abs(at - t) < Math.abs(start + (best + W / 2) / 10 - t))) best = i
    }
    return start + (best + W / 2) / 10
  } catch {
    return t // can't decode here: cut on time
  }
}

/** Labels already known keep their names (and the user's edits); a name
 *  found later fills one that was blank; new labels are added. */
function mergeSpeakers(known: Speaker[], found: Speaker[]): Speaker[] {
  const out = known.map((s) => ({ ...s }))
  for (const f of found) {
    const k = out.find((s) => s.id === f.id)
    if (!k) out.push({ ...f })
    else if (!k.name && f.name) k.name = f.name
  }
  return out
}

/** A sample for every speaker who hasn't got one: the middle of their
 *  longest turn in this part (the edges of a turn may hold someone else). */
function pickRefs(refs: VoiceRef[], segments: Segment[]): VoiceRef[] {
  const out = [...refs]
  for (const id of new Set(segments.map((s) => s.speaker))) {
    if (out.length >= MAX_REFS || out.some((r) => r.speaker === id)) continue
    const best = segments.filter((s) => s.speaker === id && s.end - s.start >= 3).sort((a, b) => b.end - b.start - (a.end - a.start))[0]
    if (!best) continue
    const mid = (best.start + best.end) / 2
    const half = Math.min(REF_SEC, best.end - best.start - 1) / 2
    out.push({ speaker: id, start: mid - half, end: mid + half })
  }
  return out
}

function voiceSamples(audio: Blob, ix: FrameIndex, refs: VoiceRef[], speakers: Speaker[]): VoiceSample[] {
  return refs.map((r) => ({
    speaker: r.speaker,
    name: speakers.find((s) => s.id === r.speaker)?.name || '',
    blob: sliceFrames(audio, ix, frameAt(ix, r.start), frameAt(ix, r.end)),
  }))
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

/** Resolves when the page is on screen and online again. */
function back(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const ok = () => !document.hidden && navigator.onLine !== false
    if (ok()) return resolve()
    const on = () => {
      if (!ok() && !signal.aborted) return
      document.removeEventListener('visibilitychange', on)
      window.removeEventListener('online', on)
      resolve()
    }
    document.addEventListener('visibilitychange', on)
    window.addEventListener('online', on)
    signal.addEventListener('abort', on, { once: true })
  })
}

/** Retries network failures and busy servers: waiting for the page to come
 *  back if it's in the background or offline (a phone pauses background
 *  pages), otherwise after 2 s, 8 s and 30 s. */
async function retrying<T>(fn: () => Promise<T>, signal: AbortSignal, say: (msg: string) => void): Promise<T> {
  for (let attempt = 0; ; ) {
    try {
      return await fn()
    } catch (e) {
      if (signal.aborted) throw new Cancelled()
      if (!isTransient(e)) throw e
      if (document.hidden || navigator.onLine === false) {
        say('Paused — waiting to come back online')
        await back(signal)
        continue
      }
      if (attempt >= 3) throw e
      say(`Connection trouble — retrying (${attempt + 1}/3)`)
      await sleep([2000, 8000, 30000][attempt++], signal)
    }
  }
}
