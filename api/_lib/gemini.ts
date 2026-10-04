import { GoogleGenAI } from '@google/genai'

// One model for every call, overridable per deployment. Flash handles
// audio natively (transcription and speaker separation in one pass) at a
// fraction of a cent per minute; minutes and Q&A run on the text
// transcript afterwards, which costs next to nothing.
export const MODEL = process.env.SCRIBE_MODEL || 'gemini-3.6-flash'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function client() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new HttpError(500, 'GEMINI_API_KEY is not configured on the server.')
  return new GoogleGenAI({ apiKey })
}

export const isMock = () => process.env.SCRIBE_MOCK === '1'

/** Parses a JSON request body, turning malformed input into a 400. */
export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'Request body must be JSON.')
  }
}

/** Wraps a handler: HttpErrors become their status, anything else a 502
 *  (the model call failed) — always as `{ error }` JSON. */
export function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      return Response.json(await fn(req))
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502
      const message = err instanceof Error ? err.message : String(err)
      console.error('[scribe]', status, message)
      return Response.json({ error: message }, { status })
    }
  }
}

/** Model text → JSON, tolerating a stray code fence. */
export function parseModelJson<T>(text: string | undefined): T {
  if (!text) throw new HttpError(502, 'The model returned an empty response.')
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(cleaned) as T
  } catch {
    throw new HttpError(502, 'The model returned malformed JSON — please try again.')
  }
}

export function clock(sec: number) {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
