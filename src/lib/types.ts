export interface Speaker {
  id: string
  name: string
}

export interface Segment {
  speaker: string
  start: number
  end: number
  text: string
}

export interface ActionItem {
  task: string
  owner: string
  due: string
  done?: boolean
}

export interface Minutes {
  title: string
  summary: string
  keyPoints: string[]
  decisions: string[]
  actionItems: ActionItem[]
  topics: { title: string; start: number }[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Gemini tokens spent on a meeting, all calls together. */
export interface Usage {
  input: number
  output: number
}

/** A few seconds of one speaker's voice (meeting time), sent with each later
 *  part of a long recording so the same voice keeps the same label. */
export interface VoiceRef {
  speaker: string
  start: number
  end: number
}

/** Transcription of a long recording, part by part. Saved after every part,
 *  so an interruption only ever costs the part that was in flight. */
export interface Job {
  /** Part k spans cuts[k]..cuts[k + 1] seconds. */
  cuts: number[]
  done: number
  refs: VoiceRef[]
}

export type MeetingStatus = 'processing' | 'ready' | 'error'

export interface Meeting {
  id: string
  title: string
  createdAt: number
  durationSec: number
  /** The recording lives in its own store (see store.ts); this is its size,
   *  0 once the user has removed it to free space. */
  audioBytes: number
  audioRemoved?: boolean
  mimeType: string
  /** User-supplied context (participants, topic) passed to transcription. */
  context: string
  status: MeetingStatus
  stage?: string
  error?: string
  language?: string
  speakers: Speaker[]
  segments: Segment[]
  minutes?: Minutes
  chat: ChatMessage[]
  truncated?: boolean
  job?: Job
  usage?: Usage
}

export type MeetingSummary = Pick<Meeting, 'id' | 'title' | 'createdAt' | 'durationSec' | 'status' | 'stage' | 'audioBytes'> & { speakerCount: number; summary?: string }
