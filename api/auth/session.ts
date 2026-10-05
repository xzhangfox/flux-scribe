import { clearedCookie, readSession } from '../_lib/auth.js'

// GET: who is signed in (or null). DELETE: sign out.
export function GET(req: Request): Response {
  const s = readSession(req)
  return Response.json({ user: s ? { email: s.email, name: s.name } : null }, { headers: { 'Cache-Control': 'no-store' } })
}

export function DELETE(): Response {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearedCookie() } })
}
