import { useRef } from 'react'
import type { MeetingSummary } from '../lib/types'
import { durationLabel } from '../lib/format'
import { IconMic, IconUpload } from './icons'

export function Library({ meetings, demo, onRecord, onUpload, onOpen }: { meetings: MeetingSummary[] | null; demo: boolean; onRecord: () => void; onUpload: (f: File) => void; onOpen: (id: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-10">
      {/* The one big action, front and centre. */}
      <section className="fade-up flex flex-col items-center pt-6 text-center sm:pt-10">
        <button onClick={onRecord} aria-label="Start recording" className="group relative grid h-40 w-40 place-items-center rounded-full sm:h-44 sm:w-44">
          <span className="breathe absolute inset-0 rounded-full bg-primary/25 blur-2xl" />
          <span className="absolute inset-3 rounded-full border border-primary/40" />
          <span className="relative grid h-28 w-28 place-items-center rounded-full bg-primary text-black shadow-[0_0_60px_rgba(var(--primary-rgb),0.55)] transition group-hover:scale-105 group-active:scale-95 sm:h-32 sm:w-32">
            <IconMic className="h-11 w-11" />
          </span>
        </button>
        <h1 className="mt-6 text-2xl font-bold tracking-tight sm:text-3xl">Record a meeting</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">Who said what, the minutes, and an assistant that knows the whole conversation.</p>
        <button onClick={() => fileRef.current?.click()} className="glass mt-5 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:border-primary/50 active:scale-95">
          <IconUpload className="h-4 w-4 text-primary" /> Upload a recording
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.flac"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onUpload(f)
            e.target.value = ''
          }}
        />
      </section>

      <section className="fade-up" style={{ animationDelay: '80ms' }}>
        {demo && (
          <p className="mb-4 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-xs leading-relaxed">
            <span className="font-bold text-primary">Guest demo.</span> Open the sample meeting to explore the transcript, minutes and Q&amp;A. Sign in with a Flux account to record your own.
          </p>
        )}
        <h2 className="mb-3 px-1 text-[11px] font-bold uppercase tracking-[0.2em] text-muted">{demo ? 'Sample meeting' : 'Your meetings'}</h2>
        {meetings === null ? null : meetings.length === 0 ? (
          <div className="glass rounded-3xl px-6 py-10 text-center text-sm text-muted">Nothing here yet — your recordings will appear here, kept on this device.</div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {meetings.map((m) => (
              <li key={m.id}>
                <button onClick={() => onOpen(m.id)} className="glass group w-full rounded-3xl p-4 text-left transition hover:border-primary/40 active:scale-[0.99]">
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-1 font-semibold group-hover:text-primary">{m.title}</p>
                    {m.status !== 'ready' && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${m.status === 'error' ? 'bg-danger/15 text-danger' : 'bg-primary/15 text-primary'}`}>
                        {m.status === 'error' ? 'Needs retry' : 'Processing'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted">
                    {new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {durationLabel(m.durationSec)}
                    {m.speakerCount ? ` · ${m.speakerCount} speaker${m.speakerCount > 1 ? 's' : ''}` : ''}
                  </p>
                  {m.summary && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{m.summary}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
