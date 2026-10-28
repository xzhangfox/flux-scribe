import type { ChatMessage, Minutes, Segment, Speaker, Usage } from './types'
import { SIGNED_OUT, isGuest } from './session'
import { demoAnswer } from './demo'

export const GUEST_BLOCKED = 'Sign in with your Flux account to transcribe your own recordings.'

/** An API failure; `status` 0 means the network itself failed. */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Worth trying again: the network, rate limits, a busy or failed model. */
export const isTransient = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500)

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  // Guests never reach the AI endpoints (the server would refuse anyway).
  if (isGuest()) throw new Error(GUEST_BLOCKED)
  let res: Response
  try {
    res = await fetch(`/api/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new ApiError('Connection lost — check your network.', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) window.dispatchEvent(new Event(SIGNED_OUT))
  // (the platform's own error pages — a time limit, a body too large — aren't JSON)
  const plain = res.status === 504 ? 'The server took too long to answer.' : res.status === 413 ? 'This recording part was too large to send.' : `Request failed (${res.status}).`
  if (!res.ok) throw new ApiError(data.error || plain, res.status)
  return data as T
}

export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

// Small recordings ride inside the request; anything bigger goes straight
// from the browser to the Gemini Files API through a one-time upload URL
// the server opened (serverless request bodies cap out around 4.5 MB).
// Long recordings are cut into parts small enough to ride inline (see
// pipeline.ts), so they never need the upload at all.
const INLINE_MAX = 3 * 1024 * 1024
const BODY_MAX = 4 * 1024 * 1024
const B64 = 1.37 // base64, plus the rest of the JSON

/** Bytes of audio that can ride inline next to `refBytes` of voice samples. */
export const inlineRoom = (refBytes = 0) => Math.min(INLINE_MAX, (BODY_MAX - refBytes * B64) / B64)

function uploadDirect(url: string, blob: Blob, onProgress: (p: number) => void, signal?: AbortSignal) {
  return new Promise<{ name: string; uri: string; mimeType: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    signal?.addEventListener('abort', abort, { once: true })
    xhr.open('POST', url)
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0')
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort)
      try {
        const f = JSON.parse(xhr.responseText).file
        if (xhr.status >= 200 && xhr.status < 300 && f?.uri) resolve({ name: f.name, uri: f.uri, mimeType: f.mimeType })
        else reject(new ApiError(`Upload failed (${xhr.status}).`, xhr.status || 0))
      } catch {
        reject(new ApiError(`Upload failed (${xhr.status}).`, xhr.status || 0))
      }
    }
    xhr.onerror = () => reject(new ApiError('Upload failed — check your connection and try again.', 0))
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'))
    xhr.send(blob)
  })
}

export interface TranscriptResult {
  language: string
  speakers: Speaker[]
  segments: Segment[]
  truncated: boolean
  usage?: Usage
}

export interface VoiceSample {
  speaker: string
  name: string
  blob: Blob
}

export interface TranscribeOptions {
  context: string
  title: string
  part?: { index: number; total: number; offset: number }
  speakers?: Speaker[]
  refs?: VoiceSample[]
  previous?: string[]
  signal?: AbortSignal
}

export async function transcribe(blob: Blob, mimeType: string, opts: TranscribeOptions, onStage: (stage: 'uploading' | 'transcribing', progress?: number) => void): Promise<TranscriptResult> {
  const refs = await Promise.all((opts.refs || []).map(async (r) => ({ speaker: r.speaker, name: r.name, data: await toBase64(r.blob), mimeType: r.blob.type || mimeType })))
  const refBytes = refs.reduce((n, r) => n + r.data.length, 0)
  const extra = { context: opts.context, part: opts.part, speakers: opts.speakers, refs, previous: opts.previous }
  onStage('uploading', 0)
  if (blob.size <= INLINE_MAX && blob.size * B64 + refBytes < BODY_MAX) {
    const data = await toBase64(blob)
    onStage('transcribing')
    return post('transcribe', { inline: { data, mimeType }, ...extra }, opts.signal)
  }
  const { uploadUrl } = await post<{ uploadUrl: string }>('upload-url', { mimeType, size: blob.size, displayName: opts.title }, opts.signal)
  const file = uploadUrl.startsWith('mock://')
    ? { name: 'files/mock', uri: 'mock', mimeType }
    : await uploadDirect(uploadUrl, blob, (p) => onStage('uploading', p), opts.signal)
  onStage('transcribing')
  return post('transcribe', { file, ...extra }, opts.signal)
}

export async function writeMinutes(transcript: string, signal?: AbortSignal): Promise<{ minutes: Minutes; usage?: Usage }> {
  const { usage, ...minutes } = await post<Minutes & { usage?: Usage }>('minutes', { transcript }, signal)
  return { minutes, usage }
}

export const ask = (transcript: string, messages: ChatMessage[]): Promise<{ reply: string; usage?: Usage }> =>
  isGuest() ? demoAnswer(messages[messages.length - 1]?.content ?? '').then((reply) => ({ reply })) : post<{ reply: string; usage?: Usage }>('ask', { transcript, messages })
