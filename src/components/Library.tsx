import { useEffect, useRef, useState } from 'react'
import type { MeetingSummary } from '../lib/types'
import type { Draft } from '../lib/drafts'
import { bytesLabel, durationLabel } from '../lib/format'
import { ConfirmSheet } from './ConfirmSheet'
import { IconCheck, IconMic, IconTrash, IconUpload, IconWave } from './icons'

interface Props {
  meetings: MeetingSummary[] | null
  demo: boolean
  drafts: Draft[]
  onRecord: () => void
  onUpload: (f: File) => void
  onOpen: (id: string) => void
  onDelete: (ids: string[]) => Promise<void>
  onRecoverDraft: (d: Draft) => void
  onDiscardDraft: (d: Draft) => void
}

export function Library({ meetings, demo, drafts, onRecord, onUpload, onOpen, onDelete, onRecoverDraft, onDiscardDraft }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [discard, setDiscard] = useState<Draft | null>(null)
  const list = meetings ?? []

  // Drop selections of meetings that are gone; leave select mode when empty.
  useEffect(() => {
    setSelected((s) => new Set([...s].filter((id) => list.some((m) => m.id === id))))
    if (!list.length) setSelecting(false)
  }, [meetings])

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const chosen = list.filter((m) => selected.has(m.id))
  const freed = chosen.reduce((n, m) => n + (m.audioBytes || 0), 0)
  const total = list.reduce((n, m) => n + (m.audioBytes || 0), 0)
  const canEdit = !demo && list.length > 0

  return (
    <div className={`space-y-10 ${selecting ? 'pb-28' : ''}`}>
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
        <p className="mt-2 max-w-sm text-sm text-muted">Who said what, the minutes, and an assistant that knows the whole conversation — up to three hours and more.</p>
        <button onClick={() => fileRef.current?.click()} className="glass mt-5 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:border-primary/50 active:scale-95">
          <IconUpload className="h-4 w-4 text-primary" /> Upload a recording
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.flac,.mp4,.mov,.webm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onUpload(f)
            e.target.value = ''
          }}
        />
      </section>

      {drafts.map((d) => (
        <section key={d.id} className="fade-up glass flex flex-wrap items-center gap-3 rounded-3xl border-primary/40 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <IconWave className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Unfinished recording recovered</p>
            <p className="font-mono text-[11px] text-muted">
              {new Date(d.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {durationLabel(d.durationSec)} saved
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <button onClick={() => setDiscard(d)} className="glass flex-1 rounded-full px-4 py-2 text-xs font-bold text-muted hover:text-danger sm:flex-none">Discard</button>
            <button onClick={() => onRecoverDraft(d)} className="flex-1 rounded-full bg-primary px-4 py-2 text-xs font-bold text-black active:scale-95 sm:flex-none">Transcribe</button>
          </div>
        </section>
      ))}

      <section className="fade-up" style={{ animationDelay: '80ms' }}>
        {demo && (
          <p className="mb-4 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-xs leading-relaxed">
            <span className="font-bold text-primary">Guest demo.</span> Open the sample meeting to explore the transcript, minutes and Q&amp;A. Sign in with a Flux account to record your own.
          </p>
        )}
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
            {demo ? 'Sample meeting' : selecting ? `${chosen.length} selected` : 'Your meetings'}
            {!demo && !selecting && total > 0 && <span className="ml-2 font-mono normal-case tracking-normal" title="Recordings stored on this device">· {bytesLabel(total)}</span>}
          </h2>
          {canEdit &&
            (selecting ? (
              <div className="flex items-center gap-1">
                <button onClick={() => setSelected(chosen.length === list.length ? new Set() : new Set(list.map((m) => m.id)))} className="rounded-full px-3 py-1.5 text-xs font-bold text-primary hover:bg-white/5">
                  {chosen.length === list.length ? 'Select none' : 'Select all'}
                </button>
                <button onClick={() => { setSelecting(false); setSelected(new Set()) }} className="rounded-full px-3 py-1.5 text-xs font-bold text-muted hover:bg-white/5 hover:text-white">
                  Done
                </button>
              </div>
            ) : (
              <button onClick={() => setSelecting(true)} className="rounded-full px-3 py-1.5 text-xs font-bold text-muted transition hover:bg-white/5 hover:text-white">
                Select
              </button>
            ))}
        </div>
        {meetings === null ? null : meetings.length === 0 ? (
          <div className="glass rounded-3xl px-6 py-10 text-center text-sm text-muted">Nothing here yet — your recordings will appear here, kept on this device.</div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {meetings.map((m) => {
              const on = selected.has(m.id)
              return (
                <li key={m.id}>
                  <button
                    onClick={() => (selecting ? toggle(m.id) : onOpen(m.id))}
                    aria-pressed={selecting ? on : undefined}
                    className={`glass group flex w-full items-start gap-3 rounded-3xl p-4 text-left transition active:scale-[0.99] ${on ? 'border-primary/70 bg-primary/10' : 'hover:border-primary/40'}`}
                  >
                    {selecting && (
                      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${on ? 'border-primary bg-primary text-black' : 'border-white/30'}`}>
                        {on && <IconCheck className="h-3.5 w-3.5" />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="line-clamp-1 font-semibold group-hover:text-primary">{m.title}</span>
                        {m.status !== 'ready' && (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${m.status === 'error' ? 'bg-danger/15 text-danger' : 'bg-primary/15 text-primary'}`}>
                            {m.status === 'error' ? 'Needs retry' : (/part (\d+ of \d+)/i.exec(m.stage || '')?.[1]?.replace(' of ', '/') ?? 'Processing')}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block font-mono text-[11px] text-muted">
                        {new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {durationLabel(m.durationSec)}
                        {m.speakerCount ? ` · ${m.speakerCount} speaker${m.speakerCount > 1 ? 's' : ''}` : ''}
                        {selecting && m.audioBytes ? ` · ${bytesLabel(m.audioBytes)}` : ''}
                      </span>
                      {m.summary && <span className="mt-2 line-clamp-2 block text-xs leading-relaxed text-muted">{m.summary}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="glass-strong fade-up mx-auto flex max-w-xl items-center gap-3 rounded-[22px] p-2.5 pl-5">
            <p className="flex-1 text-xs text-muted">{chosen.length ? `Frees ${bytesLabel(freed)}` : 'Tap meetings to select them'}</p>
            <button
              disabled={!chosen.length}
              onClick={() => setConfirm(true)}
              className="flex items-center gap-2 rounded-2xl bg-danger px-5 py-3 text-sm font-bold text-white transition active:scale-95 disabled:opacity-40"
            >
              <IconTrash className="h-4 w-4" /> Delete{chosen.length ? ` ${chosen.length}` : ''}
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmSheet
          title={chosen.length === 1 ? 'Delete this meeting?' : `Delete ${chosen.length} meetings?`}
          body={`${chosen.length === 1 ? 'Its recording, transcript, minutes and chat' : 'Their recordings, transcripts, minutes and chats'} will be removed from this device. This can't be undone.`}
          action="Delete"
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false)
            await onDelete(chosen.map((m) => m.id))
            setSelected(new Set())
            setSelecting(false)
          }}
        />
      )}
      {discard && (
        <ConfirmSheet
          title="Discard this recording?"
          body={`The ${durationLabel(discard.durationSec)} recovered will be deleted. This can't be undone.`}
          action="Discard"
          onCancel={() => setDiscard(null)}
          onConfirm={() => {
            onDiscardDraft(discard)
            setDiscard(null)
          }}
        />
      )}
    </div>
  )
}
