import { useCallback, useEffect, useState } from 'react'
import { Logo } from './components/Logo'
import { Library } from './components/Library'
import { RecorderView } from './components/RecorderView'
import { ContextSheet } from './components/ContextSheet'
import { MeetingView } from './components/MeetingView'
import { SettingsSheet } from './components/SettingsSheet'
import { IconSettings } from './components/icons'
import { addMeeting, listMeetings, setDemoLibrary } from './lib/store'
import { SIGNED_OUT, currentAuth, signOut, type Auth } from './lib/session'
import { NeedsAccount, SignIn } from './components/SignIn'
import { onMeetingChange, processMeeting, removeMeeting, resumeAll } from './lib/pipeline'
import { prepareUpload } from './lib/convert'
import { deleteDraft, draftAudio, listDrafts, type Draft } from './lib/drafts'
import { indexDuration, indexFrames } from './lib/frames'
import { askToNotify } from './lib/activity'
import type { MeetingSummary } from './lib/types'

type Route = { name: 'home' } | { name: 'record' } | { name: 'meeting'; id: string }

function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  if (h === 'record') return { name: 'record' }
  const m = h.match(/^m\/([\w-]+)$/)
  return m ? { name: 'meeting', id: m[1] } : { name: 'home' }
}
const go = (hash: string) => {
  location.hash = hash
}

interface Pending {
  blob: Blob
  mimeType: string
  durationSec: number
  title: string
  /** The recording's crash-safety draft, deleted once it's a meeting. */
  draftId?: string
}

const stamp = (at = Date.now()) => `Meeting · ${new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute)
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [converting, setConverting] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(false)
  // undefined while checking the session; null = signed out.
  const [auth, setAuth] = useState<Auth | undefined>(undefined)
  const [needsAccount, setNeedsAccount] = useState(false)
  const guest = auth?.kind === 'guest'

  const applyAuth = useCallback(async (a: Auth) => {
    await setDemoLibrary(a?.kind === 'guest')
    setAuth(a)
    const list = await listMeetings()
    setMeetings(list)
    if (a?.kind !== 'user') return setDrafts([])
    setDrafts(await listDrafts())
    // Anything left mid-way by a reload or a closed tab carries on.
    void resumeAll(list)
  }, [])
  useEffect(() => {
    void currentAuth().then(applyAuth)
    const out = () => void applyAuth(null)
    window.addEventListener(SIGNED_OUT, out)
    return () => window.removeEventListener(SIGNED_OUT, out)
  }, [applyAuth])

  useEffect(() => {
    const on = () => setRoute(parseRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const refresh = useCallback(() => void listMeetings().then(setMeetings), [])
  useEffect(() => onMeetingChange(refresh), [refresh])
  useEffect(() => window.scrollTo(0, 0), [route])

  // Leaving the recorder without stopping keeps the recording as a draft.
  useEffect(() => {
    if (route.name === 'home' && auth?.kind === 'user') void listDrafts().then(setDrafts)
  }, [route.name, auth])

  // Back on the page, or back online: pick up anything that was paused
  // (phones suspend background pages mid-request).
  useEffect(() => {
    if (auth?.kind !== 'user') return
    const wake = () => !document.hidden && void listMeetings().then(resumeAll)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [auth])

  const create = async (title: string, context: string) => {
    if (!pending) return
    const id = crypto.randomUUID()
    // A long recording takes a few minutes: offer a notice when it's done.
    if (pending.durationSec >= 15 * 60) askToNotify()
    await addMeeting(
      {
        id,
        title,
        createdAt: Date.now(),
        durationSec: pending.durationSec,
        audioBytes: pending.blob.size,
        mimeType: pending.mimeType,
        context,
        status: 'processing',
        stage: 'Preparing audio',
        speakers: [],
        segments: [],
        chat: [],
      },
      pending.blob,
    )
    if (pending.draftId) await deleteDraft(pending.draftId)
    setDrafts((d) => d.filter((x) => x.id !== pending.draftId))
    setPending(null)
    refresh()
    go(`/m/${id}`)
    void processMeeting(id)
  }

  const discard = async () => {
    if (pending?.draftId) await deleteDraft(pending.draftId)
    setDrafts((d) => d.filter((x) => x.id !== pending?.draftId))
    setPending(null)
  }

  const recoverDraft = async (d: Draft) => {
    const blob = await draftAudio(d.id)
    if (!blob) return setDrafts((all) => all.filter((x) => x.id !== d.id))
    let durationSec = d.durationSec
    try {
      durationSec = indexDuration(await indexFrames(blob, 'mp3'))
    } catch {
      /* keep the saved estimate */
    }
    setPending({ blob, mimeType: 'audio/mpeg', durationSec, title: stamp(d.createdAt), draftId: d.id })
  }

  const upload = async (file: File) => {
    if (guest) return setNeedsAccount(true)
    setError('')
    setConverting(0)
    try {
      const { blob, mimeType, durationSec } = await prepareUpload(file, setConverting)
      setPending({ blob, mimeType, durationSec, title: file.name.replace(/\.[^.]+$/, '') || stamp() })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConverting(null)
    }
  }

  if (auth === undefined) return <div className="min-h-dvh" />
  if (auth === null) return <SignIn onAuth={(a) => void applyAuth(a)} />

  return (
    <div className="mx-auto min-h-dvh max-w-6xl px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
      <header className="mb-6 flex items-center justify-between py-2">
        <button onClick={() => go('/')} className="flex items-center gap-2.5" aria-label="Flux Scribe home">
          <Logo className="h-9 w-9" />
          <span className="text-left leading-tight">
            <span className="block text-lg font-bold tracking-tight">Flux Scribe</span>
            <span className="block text-[9px] font-bold uppercase tracking-[0.25em] text-primary">Meeting intelligence</span>
          </span>
        </button>
        <button onClick={() => setSettings(true)} aria-label="Settings" className="glass grid h-10 w-10 place-items-center rounded-full transition hover:border-primary/50 active:scale-95">
          <IconSettings className="h-5 w-5" />
        </button>
      </header>

      <main>
        {route.name === 'home' && (
          <Library
            meetings={meetings}
            demo={guest}
            drafts={drafts.filter((d) => d.id !== pending?.draftId)}
            onRecord={() => (guest ? setNeedsAccount(true) : go('/record'))}
            onUpload={upload}
            onOpen={(id) => go(`/m/${id}`)}
            onDelete={async (ids) => {
              for (const id of ids) await removeMeeting(id)
              refresh()
            }}
            onRecoverDraft={(d) => void recoverDraft(d)}
            onDiscardDraft={async (d) => {
              await deleteDraft(d.id)
              setDrafts((all) => all.filter((x) => x.id !== d.id))
            }}
          />
        )}
        {route.name === 'record' && !guest && (
          <RecorderView
            onCancel={() => go('/')}
            onDone={(blob, durationSec, draftId) => {
              go('/')
              setPending({ blob, mimeType: 'audio/mpeg', durationSec, title: stamp(), draftId })
            }}
          />
        )}
        {route.name === 'meeting' && <MeetingView key={route.id} id={route.id} onBack={() => go('/')} />}
        {error && route.name === 'home' && <p className="mt-6 text-center text-sm text-danger">{error}</p>}
      </main>

      {converting !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="glass-strong w-72 rounded-3xl p-6 text-center">
            <p className="font-semibold">Preparing audio… {Math.round(converting * 100)}%</p>
            <p className="mt-1 text-xs text-muted">On this device — nothing is uploaded yet.</p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(converting * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
      {pending && <ContextSheet durationSec={pending.durationSec} defaultTitle={pending.title} onSubmit={create} onDiscard={discard} />}
      {settings && (
        <SettingsSheet
          auth={auth}
          onClose={() => setSettings(false)}
          onSignOut={async () => {
            setSettings(false)
            await signOut()
            go('/')
            await applyAuth(null)
          }}
        />
      )}
      {needsAccount && (
        <NeedsAccount
          onClose={() => setNeedsAccount(false)}
          onSignIn={async () => {
            setNeedsAccount(false)
            await signOut()
            go('/')
            await applyAuth(null)
          }}
        />
      )}
    </div>
  )
}
