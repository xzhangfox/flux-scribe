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

export type MeetingStatus = 'processing' | 'ready' | 'error'

export interface Meeting {
  id: string
  title: string
  createdAt: number
  durationSec: number
  audio: Blob
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
}

export type MeetingSummary = Pick<Meeting, 'id' | 'title' | 'createdAt' | 'durationSec' | 'status'> & { speakerCount: number; summary?: string }
