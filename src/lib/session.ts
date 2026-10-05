// Who is using the app: a signed-in Flux account (verified by the server,
// which holds the session in an HttpOnly cookie), a guest exploring the
// demo, or nobody yet.

export interface Account {
  email: string
  name: string
}
export type Auth = { kind: 'user'; account: Account } | { kind: 'guest' } | null

const GUEST_KEY = 'scribe_guest'
let guest = false
export const isGuest = () => guest

function setGuest(on: boolean) {
  guest = on
  try {
    if (on) localStorage.setItem(GUEST_KEY, '1')
    else localStorage.removeItem(GUEST_KEY)
  } catch {
    /* private mode: guest just won't be remembered */
  }
}

export async function currentAuth(): Promise<Auth> {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin' })
    const data = await res.json().catch(() => ({}))
    if (data.user) {
      setGuest(false)
      return { kind: 'user', account: data.user }
    }
  } catch {
    /* offline: fall through */
  }
  let wasGuest = false
  try {
    wasGuest = localStorage.getItem(GUEST_KEY) === '1'
  } catch {
    /* ignore */
  }
  guest = wasGuest
  return wasGuest ? { kind: 'guest' } : null
}

export async function signIn(email: string, password: string, remember: boolean): Promise<Auth> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, remember }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Sign-in failed (${res.status}).`)
  setGuest(false)
  return { kind: 'user', account: data.user }
}

export function enterGuest(): Auth {
  setGuest(true)
  return { kind: 'guest' }
}

export async function signOut() {
  setGuest(false)
  await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {})
}

/** Fired when the server rejects the session (expired or revoked). */
export const SIGNED_OUT = 'scribe:signed-out'
