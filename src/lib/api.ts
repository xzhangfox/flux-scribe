import type { ChatMessage, Minutes, Segment, Speaker } from './types'
import { SIGNED_OUT, isGuest } from './session'
import { demoAnswer } from './demo'

export const GUEST_BLOCKED = 'Sign in with your Flux account to transcribe your own recordings.'

async function post<T>(path: string, body: unknown): Promise<T> {
  // Guests never reach the AI endpoints (the server would refuse anyway).
  if (isGuest()) throw new Error(GUEST_BLOCKED)
  const res = await fetch(`/api/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) window.dispatchEvent(new Event(SIGNED_OUT))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`)
  return data as T
}

function toBase64(blob: Blob): Promise<string> {
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
const INLINE_MAX = 3 * 1024 * 1024

function uploadDirect(url: string, blob: Blob, onProgress: (p: number) => void) {
  return new Promise<{ name: string; uri: string; mimeType: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0')
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      try {
        const f = JSON.parse(xhr.responseText).file
        if (xhr.status >= 200 && xhr.status < 300 && f?.uri) resolve({ name: f.name, uri: f.uri, mimeType: f.mimeType })
        else reject(new Error(`Upload failed (${xhr.status}).`))
      } catch {
        reject(new Error(`Upload failed (${xhr.status}).`))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again.'))
    xhr.send(blob)
  })
}

export interface TranscriptResult {
  language: string
  speakers: Speaker[]
  segments: Segment[]
  truncated: boolean
}

export async function transcribe(
  blob: Blob,
  mimeType: string,
  opts: { context: string; title: string },
  onStage: (stage: 'uploading' | 'transcribing', progress?: number) => void,
): Promise<TranscriptResult> {
  if (blob.size <= INLINE_MAX) {
    onStage('uploading', 0)
    const data = await toBase64(blob)
    onStage('transcribing')
    return post('transcribe', { inline: { data, mimeType }, context: opts.context })
  }
  onStage('uploading', 0)
  const { uploadUrl } = await post<{ uploadUrl: string }>('upload-url', { mimeType, size: blob.size, displayName: opts.title })
  const file = uploadUrl.startsWith('mock://')
    ? { name: 'files/mock', uri: 'mock', mimeType }
    : await uploadDirect(uploadUrl, blob, (p) => onStage('uploading', p))
  onStage('transcribing')
  return post('transcribe', { file, context: opts.context })
}

export const writeMinutes = (transcript: string) => post<Minutes>('minutes', { transcript })

export const ask = (transcript: string, messages: ChatMessage[]) =>
  isGuest() ? demoAnswer(messages[messages.length - 1]?.content ?? '') : post<{ reply: string }>('ask', { transcript, messages }).then((r) => r.reply)
