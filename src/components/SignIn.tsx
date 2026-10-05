import { useState } from 'react'
import { Logo } from './Logo'
import { IconCheck } from './icons'
import { enterGuest, signIn, type Auth } from '../lib/session'

// Flux's sign-in, in Scribe's skin: a Flux account, or the guest demo.
export function SignIn({ onAuth }: { onAuth: (a: Auth) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      onAuth(await signIn(email, password, remember))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const label = 'mb-3 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted transition-colors group-focus-within:text-primary'
  const input = 'w-full border-b border-white/10 bg-transparent py-3 text-xl font-light outline-none transition placeholder:text-white/10 focus:border-primary'

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-6 py-10">
      <div className="breathe pointer-events-none absolute left-1/2 top-[18%] h-80 w-80 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="fade-up relative w-full max-w-md">
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo className="h-14 w-14" />
          <h1 className="mt-6 text-4xl font-light tracking-tighter sm:text-5xl">Sign In</h1>
          <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Flux Scribe · Use your Flux account</p>
        </div>

        <form onSubmit={submit} className="space-y-7">
          <div className="group">
            <label htmlFor="email" className={label}>Email address</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} placeholder="name@domain.com" />
          </div>
          <div className="group">
            <label htmlFor="password" className={label}>Password</label>
            <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} placeholder="••••••••" />
          </div>
          <button type="button" onClick={() => setRemember(!remember)} className="group flex items-center gap-3" aria-pressed={remember}>
            <span className={`grid h-6 w-6 place-items-center rounded-lg border transition ${remember ? 'border-primary bg-primary text-black' : 'border-white/15 group-hover:border-primary/50'}`}>
              {remember && <IconCheck className="h-4 w-4" />}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted group-hover:text-white">Keep me signed in</span>
          </button>

          {error && <p className="rounded-2xl border border-danger/25 bg-danger/10 p-4 text-xs font-semibold text-danger">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className={`flex h-16 w-full items-center justify-center gap-3 rounded-full text-xs font-bold uppercase tracking-[0.3em] transition ${busy ? 'cursor-wait bg-white/5 text-muted' : 'bg-primary text-black shadow-[0_15px_40px_rgba(var(--primary-rgb),0.3)] hover:scale-[1.02] active:scale-95'}`}
          >
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />}
            {busy ? 'Verifying' : 'Sign in'}
          </button>
        </form>

        <div className="my-9 flex items-center">
          <div className="h-px flex-1 bg-white/10" />
          <span className="px-5 text-[9px] font-bold uppercase tracking-[0.4em] text-muted">or</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <button
          onClick={() => onAuth(enterGuest())}
          disabled={busy}
          className="glass h-14 w-full rounded-full text-[11px] font-bold uppercase tracking-[0.3em] text-muted transition hover:border-primary/40 hover:text-white active:scale-95"
        >
          Explore the demo as a guest
        </button>
        <p className="mt-4 text-center text-xs leading-relaxed text-muted">The demo opens a sample meeting with its transcript, minutes and Q&amp;A. Recording and transcription need a Flux account.</p>
      </div>
    </div>
  )
}

/** Shown when a guest tries something that needs an account. */
export function NeedsAccount({ onSignIn, onClose }: { onSignIn: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal aria-label="Sign in required">
      <div className="glass-strong fade-up w-full max-w-sm rounded-t-[28px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <Logo className="mx-auto h-10 w-10" />
        <h2 className="mt-4 text-lg font-bold">Sign in to record</h2>
        <p className="mt-2 text-sm text-muted">Recording, uploads and transcription use your Flux account. The guest demo is read-only.</p>
        <button onClick={onSignIn} className="mt-6 h-12 w-full rounded-full bg-primary text-sm font-bold text-black transition active:scale-95">Sign in</button>
        <button onClick={onClose} className="mt-2 h-11 w-full rounded-full text-sm font-semibold text-muted hover:text-white">Keep exploring</button>
      </div>
    </div>
  )
}
