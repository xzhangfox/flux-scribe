import { HttpError, readJson } from '../_lib/gemini.js'
import { sessionCookie, verifyFluxLogin } from '../_lib/auth.js'

// Sign in with a Flux account; sets the session cookie.
export async function POST(req: Request): Promise<Response> {
  try {
    const { email, password, remember } = await readJson<{ email?: string; password?: string; remember?: boolean }>(req)
    if (!email?.trim() || !password) throw new HttpError(400, 'Enter your email and password.')
    const user = await verifyFluxLogin(email, password)
    return Response.json({ user: { email: user.email, name: user.name } }, { headers: { 'Set-Cookie': sessionCookie(user, remember !== false) } })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof Error ? err.message : String(err)
    if (status >= 500) console.error('[scribe] login', message)
    return Response.json({ error: message }, { status })
  }
}
