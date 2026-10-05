import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { HttpError } from './gemini.js'

// Who may spend the Gemini quota. Every AI endpoint calls requireUser()
// first; there is no other way in.
//
// Accounts are the existing Flux accounts (same email and password), but
// checked here on the server, never in the browser. Because anyone can
// register a Flux account, an account must also be on SCRIBE_ALLOWED_EMAILS
// (comma-separated, or "*" for every Flux account). Unset means nobody:
// the server fails closed. Flux's shared guest account is never accepted —
// Scribe's guest mode is a client-side demo that makes no API calls.
//
// A signed-in user gets an HttpOnly, HMAC-signed session cookie. The
// signing secret is SCRIBE_SESSION_SECRET, or, if that isn't set, derived
// from GEMINI_API_KEY (server-only either way).

const COOKIE = 'scribe_session'
const DAY = 24 * 3600

const FLUX_SUPABASE_URL = process.env.FLUX_SUPABASE_URL || 'https://epcfxdvietzwyzccusyt.supabase.co'
// Flux's public (anon) key — the same one its web app ships to every browser.
const FLUX_SUPABASE_KEY =
  process.env.FLUX_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwY2Z4ZHZpZXR6d3l6Y2N1c3l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMzE3NTAsImV4cCI6MjA4NDcwNzc1MH0.dDGOuoDL7BKzzNxWFTfOwzMEwC_P8yt-lu9Meuwd-go'
const FLUX_GUEST_ID = 'flux_guest_demo_v1'

export interface Session {
  uid: string
  email: string
  name: string
  exp: number
}

function secret() {
  const s = process.env.SCRIBE_SESSION_SECRET || (process.env.GEMINI_API_KEY ? createHash('sha256').update(`flux-scribe-session:${process.env.GEMINI_API_KEY}`).digest('hex') : '')
  if (!s) throw new HttpError(500, 'Sign-in is not configured on the server.')
  return s
}

const b64 = (s: string) => Buffer.from(s).toString('base64url')
const sig = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url')

function safeEqual(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function isAllowed(email: string) {
  const list = (process.env.SCRIBE_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return list.includes('*') || list.includes(email.trim().toLowerCase())
}

/** The session cookie for `user`; remembered for 30 days, or for the
 *  browser session (with a 12-hour token) otherwise. */
export function sessionCookie(user: { uid: string; email: string; name: string }, remember: boolean) {
  const ttl = remember ? 30 * DAY : DAY / 2
  const body = b64(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + ttl } satisfies Session))
  return `${COOKIE}=${body}.${sig(body)}; Path=/; HttpOnly; Secure; SameSite=Lax${remember ? `; Max-Age=${ttl}` : ''}`
}

export const clearedCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

export function readSession(req: Request): Session | null {
  const raw = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  if (!raw) return null
  const [body, mac] = raw.split('.')
  if (!body || !mac || !safeEqual(mac, sig(body))) return null
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session
    // Revoking an email from the allowlist takes effect immediately.
    return s.exp > Date.now() / 1000 && isAllowed(s.email) ? s : null
  } catch {
    return null
  }
}

export function requireUser(req: Request): Session {
  const s = readSession(req)
  if (!s) throw new HttpError(401, 'Please sign in to use Flux Scribe.')
  return s
}

interface FluxUser {
  id: string
  email: string
  password: string
  name?: string
}

/** Checks a Flux email + password on the server. */
export async function verifyFluxLogin(email: string, password: string) {
  const res = await fetch(`${FLUX_SUPABASE_URL}/rest/v1/users?select=data&data->>email=eq.${encodeURIComponent(email.trim())}`, {
    headers: { apikey: FLUX_SUPABASE_KEY, Authorization: `Bearer ${FLUX_SUPABASE_KEY}` },
  })
  if (!res.ok) throw new HttpError(502, 'The account service is unavailable — please try again.')
  const rows = (await res.json()) as { data: FluxUser }[]
  const user = rows.map((r) => r.data).find((u) => u && u.email === email.trim())
  // Same work and the same answer whether the email exists or not.
  const ok = safeEqual(user?.password ?? `\u0000no-user:${Math.random()}`, password)
  if (!user || !ok || user.id === FLUX_GUEST_ID) throw new HttpError(401, 'Email or password is incorrect.')
  if (!isAllowed(user.email)) throw new HttpError(403, "This account doesn't have access to Flux Scribe yet. You can explore the demo as a guest.")
  return { uid: user.id, email: user.email, name: user.name || user.email.split('@')[0] }
}
