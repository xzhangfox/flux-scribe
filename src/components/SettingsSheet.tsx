import { useEffect, useState } from 'react'
import { ThemePicker } from './ThemePicker'
import { OtherApps } from './OtherApps'
import { ShareAppButton } from './ShareAppButton'
import { IconX } from './icons'
import type { Auth } from '../lib/session'
import { keepStorage, storageInfo } from '../lib/store'
import { bytesLabel } from '../lib/format'

/** What Scribe keeps on this device, and whether the browser may clear it. */
function Storage() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof storageInfo>>>(null)
  useEffect(() => void storageInfo().then(setInfo), [])
  if (!info) return null
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Storage on this device</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {bytesLabel(info.used)} used{info.quota ? <span className="font-normal text-muted"> · {bytesLabel(info.quota)} available</span> : null}
        </p>
        {info.persisted ? (
          <span className="shrink-0 text-[11px] font-semibold text-primary">Protected</span>
        ) : (
          <button onClick={async () => { await keepStorage(); setInfo(await storageInfo()) }} className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-bold transition hover:border-primary/50 hover:text-primary">
            Keep safe
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        About 14 MB per hour recorded. Free space from the meeting list (Select) or a meeting's menu — removing just a recording keeps its transcript and minutes.
        {!info.persisted && ' "Keep safe" asks the browser never to clear Scribe\'s data on its own when space runs low.'}
      </p>
    </div>
  )
}

export function SettingsSheet({ auth, onClose, onSignOut }: { auth: Auth; onClose: () => void; onSignOut: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal aria-label="Settings">
      <div className="glass-strong fade-up w-full max-w-lg space-y-7 rounded-t-[28px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Settings</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted hover:bg-white/10 hover:text-white">
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <div className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">{auth?.kind === 'user' ? 'Signed in' : 'Guest demo'}</p>
            <p className="truncate text-sm font-semibold">{auth?.kind === 'user' ? auth.account.email : 'Read-only sample meeting'}</p>
          </div>
          <button onClick={onSignOut} className="shrink-0 rounded-full border border-white/10 px-4 py-2 text-xs font-bold transition hover:border-primary/50 hover:text-primary">
            {auth?.kind === 'user' ? 'Sign out' : 'Sign in'}
          </button>
        </div>
        {auth?.kind === 'user' && <Storage />}
        <ThemePicker />
        <ShareAppButton />
        <OtherApps />
        <p className="text-xs leading-relaxed text-muted">
          Recordings and transcripts are stored only in this browser. Audio is sent to Google Gemini once, for transcription (a long recording part by part), and deleted from it straight after.
        </p>
      </div>
    </div>
  )
}
