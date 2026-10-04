import { useCallback, useEffect, useState } from 'react'
import { Logo } from './components/Logo'
import { Library } from './components/Library'
import { RecorderView } from './components/RecorderView'
import { ContextSheet } from './components/ContextSheet'
import { MeetingView } from './components/MeetingView'
import { SettingsSheet } from './components/SettingsSheet'
import { IconSettings } from './components/icons'
import { listMeetings, saveMeeting } from './lib/store'
import { onMeetingChange, processMeeting } from './lib/pipeline'
import { prepareUpload } from './lib/convert'
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
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute)
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [converting, setConverting] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(false)

  useEffect(() => {
    const on = () => setRoute(parseRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const refresh = useCallback(() => void listMeetings().then(setMeetings), [])
  useEffect(() => {
    refresh()
    return onMeetingChange(refresh)
  }, [refresh])
  useEffect(() => window.scrollTo(0, 0), [route])

  const stamp = () => `Meeting · ${new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`

  const create = async (title: string, context: string) => {
    if (!pending) return
    const id = crypto.randomUUID()
    await saveMeeting({
      id,
      title,
      createdAt: Date.now(),
      durationSec: pending.durationSec,
      audio: pending.blob,
      mimeType: pending.mimeType,
      context,
      status: 'processing',
      stage: 'Preparing audio',
      speakers: [],
      segments: [],
      chat: [],
    })
    setPending(null)
    refresh()
    go(`/m/${id}`)
    void processMeeting(id)
  }

  const upload = async (file: File) => {
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
        {route.name === 'home' && <Library meetings={meetings} onRecord={() => go('/record')} onUpload={upload} onOpen={(id) => go(`/m/${id}`)} />}
        {route.name === 'record' && (
          <RecorderView
            onCancel={() => go('/')}
            onDone={(blob, durationSec) => {
              go('/')
              setPending({ blob, mimeType: 'audio/mpeg', durationSec, title: stamp() })
            }}
          />
        )}
        {route.name === 'meeting' && <MeetingView key={route.id} id={route.id} onBack={() => go('/')} />}
        {error && route.name === 'home' && <p className="mt-6 text-center text-sm text-danger">{error}</p>}
      </main>

      {converting !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="glass-strong w-72 rounded-3xl p-6 text-center">
            <p className="font-semibold">Preparing audio…</p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(converting * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
      {pending && <ContextSheet durationSec={pending.durationSec} defaultTitle={pending.title} onSubmit={create} onDiscard={() => setPending(null)} />}
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  )
}
