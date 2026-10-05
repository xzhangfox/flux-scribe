import { HttpError, client, handle, isMock, readJson } from './_lib/gemini.js'
import { requireUser } from './_lib/auth.js'

// Long recordings exceed a serverless request body (~4.5 MB on Vercel), so
// the browser uploads them straight to the Gemini Files API. This opens a
// resumable upload session server-side — the API key never leaves the
// server — and hands back the session's one-time upload URL.
const ALLOWED = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/aiff']
const MAX_BYTES = 400 * 1024 * 1024

export const POST = handle(async (req) => {
  requireUser(req)
  const { mimeType, size, displayName } = await readJson<{ mimeType: string; size: number; displayName?: string }>(req)
  if (!ALLOWED.includes(mimeType)) throw new HttpError(400, `Unsupported audio type: ${mimeType}`)
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) throw new HttpError(400, 'Audio must be between 1 byte and 400 MB.')
  if (isMock()) return { uploadUrl: 'mock://upload' }
  client() // validates the key is configured
  const res = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.GEMINI_API_KEY!,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: (displayName || 'meeting').slice(0, 120) } }),
  })
  const uploadUrl = res.headers.get('x-goog-upload-url')
  if (!res.ok || !uploadUrl) throw new HttpError(502, `Could not start the upload (${res.status}).`)
  return { uploadUrl }
})
