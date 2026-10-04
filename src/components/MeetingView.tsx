import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, Meeting } from '../lib/types'
import { clock, durationLabel, parseClock, speakerColor, speakerName, toMarkdown, transcriptText } from '../lib/format'
import { getMeeting, updateMeeting, deleteMeeting } from '../lib/store'
import { isRunning, onMeetingChange, processMeeting } from '../lib/pipeline'
import { ask } from '../lib/api'
import { IconBack, IconCheck, IconCopy, IconDownload, IconEdit, IconPause, IconPlay, IconRetry, IconSearch, IconSend, IconSparkle, IconTrash } from './icons'

type Tab = 'minutes' | 'transcript' | 'ask'

export function MeetingView({ id, onBack }: { id: string; onBack: () => void }) {
  const [m, setM] = useState<Meeting | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab>('minutes')
  const audio = useRef<HTMLAudioElement>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const url = useMemo(() => (m?.audio ? URL.createObjectURL(m.audio) : ''), [m?.audio])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])

  useEffect(() => {
    let alive = true
    const load = () => getMeeting(id).then((x) => alive && setM(x ?? null))
    load()
    const off = onMeetingChange((changed) => changed === id && load())
    return () => {
      alive = false
      off()
    }
  }, [id])

  // A meeting left mid-processing by a reload just needs a nudge.
  useEffect(() => {
    if (m?.status === 'processing' && !isRunning(m.id)) void processMeeting(m.id)
  }, [m?.status, m?.id])

  const save = async (patch: Partial<Meeting>) => {
    const next = await updateMeeting(id, patch)
    if (next) setM(next)
  }

  const seek = (t: number) => {
    const a = audio.current
    if (!a) return
    a.currentTime = t
    void a.play()
  }

  if (m === undefined) return null
  if (m === null)
    return (
      <div className="py-24 text-center text-muted">
        This meeting doesn't exist on this device. <button className="text-primary underline" onClick={onBack}>Go back</button>
      </div>
    )

  const ready = m.status === 'ready'
  const transcriptPanel = <Transcript m={m} time={time} onSeek={seek} />
  const sidePanel = tab === 'ask' ? <Ask m={m} onSeek={seek} onChat={(chat) => save({ chat })} /> : <MinutesPanel m={m} onSeek={seek} onSave={save} />

  return (
    <div className="fade-up pb-32">
      <div className="mb-5 flex items-center gap-3">
        <button onClick={onBack} aria-label="All meetings" className="glass grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:border-primary/50 active:scale-95">
          <IconBack className="h-5 w-5" />
        </button>
        <EditableTitle value={m.title} onChange={(title) => save({ title })} />
        {ready && <ExportMenu m={m} onDelete={async () => { await deleteMeeting(m.id); onBack() }} />}
      </div>
      <p className="-mt-2 mb-5 pl-[52px] font-mono text-[11px] text-muted">
        {new Date(m.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {durationLabel(m.durationSec)}
        {m.language ? ` · ${m.language.toUpperCase()}` : ''}
      </p>

      {m.status === 'processing' && <Processing stage={m.stage} />}
      {m.status === 'error' && (
        <div className="glass mb-6 rounded-3xl p-6 text-center">
          <p className="font-semibold text-danger">Processing stopped</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{m.error}</p>
          <div className="mt-4 flex justify-center gap-3">
            <button onClick={() => processMeeting(m.id)} className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-black active:scale-95">
              <IconRetry className="h-4 w-4" /> Try again
            </button>
            <button onClick={async () => { await deleteMeeting(m.id); onBack() }} className="glass rounded-full px-5 py-2.5 text-sm font-semibold text-muted hover:text-danger">Delete</button>
          </div>
        </div>
      )}

      {m.segments.length > 0 && (
        <>
          <Speakers m={m} onRename={(speakerId, name) => {
            const old = speakerName(m.speakers, speakerId)
            const speakers = m.speakers.map((s) => (s.id === speakerId ? { ...s, name } : s))
            // Keep action-item owners in step with a rename.
            const minutes = m.minutes && { ...m.minutes, actionItems: m.minutes.actionItems.map((a) => (a.owner === old ? { ...a, owner: name || speakerName(speakers, speakerId) } : a)) }
            void save({ speakers, minutes })
          }} />
          {m.truncated && <p className="mb-4 rounded-2xl bg-primary/10 px-4 py-3 text-xs text-primary">This recording was very long — the transcript may stop before the end.</p>}

          {/* Phone: one panel at a time. Desktop: transcript beside minutes / ask. */}
          <div role="tablist" className="glass mb-4 grid grid-cols-3 gap-1 rounded-2xl p-1 lg:hidden">
            {(['minutes', 'transcript', 'ask'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-xl py-2.5 text-[11px] font-bold uppercase tracking-widest transition ${tab === t ? 'bg-primary text-black' : 'text-muted'}`}>
                {t === 'ask' ? 'Ask AI' : t === 'minutes' ? 'Minutes' : 'Transcript'}
              </button>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
            <section className={tab === 'transcript' ? '' : 'hidden lg:block'}>{transcriptPanel}</section>
            <section className={tab === 'transcript' ? 'hidden lg:block' : ''}>
              <div role="tablist" className="glass mb-4 hidden grid-cols-2 gap-1 rounded-2xl p-1 lg:grid">
                {(['minutes', 'ask'] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={(tab === 'transcript' ? 'minutes' : tab) === t} onClick={() => setTab(t)} className={`rounded-xl py-2.5 text-[11px] font-bold uppercase tracking-widest transition ${(tab === 'transcript' ? 'minutes' : tab) === t ? 'bg-primary text-black' : 'text-muted'}`}>
                    {t === 'ask' ? 'Ask AI' : 'Minutes'}
                  </button>
                ))}
              </div>
              <div className="lg:sticky lg:top-4">{sidePanel}</div>
            </section>
          </div>
        </>
      )}

      {/* Player, pinned to the bottom. */}
      <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="glass-strong mx-auto flex max-w-3xl items-center gap-3 rounded-[22px] px-3 py-2.5">
          <button
            onClick={() => (playing ? audio.current?.pause() : audio.current?.play())}
            aria-label={playing ? 'Pause' : 'Play'}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-black active:scale-95"
          >
            {playing ? <IconPause className="h-5 w-5" /> : <IconPlay className="h-5 w-5" />}
          </button>
          <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">{clock(time)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, m.durationSec)}
            step={0.5}
            value={Math.min(time, m.durationSec)}
            onChange={(e) => {
              const t = Number(e.target.value)
              if (audio.current) audio.current.currentTime = t
              setTime(t)
            }}
            aria-label="Seek"
            className="h-1 flex-1 cursor-pointer accent-[var(--primary)]"
          />
          <span className="w-12 shrink-0 font-mono text-[11px] tabular-nums text-muted">{clock(m.durationSec)}</span>
          <audio ref={audio} src={url} preload="metadata" onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        </div>
      </div>
    </div>
  )
}

function EditableTitle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  if (edit)
    return (
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEdit(false); if (v.trim() && v !== value) onChange(v.trim()) }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="min-w-0 flex-1 rounded-xl border border-primary/40 bg-transparent px-3 py-1.5 text-lg font-bold outline-none sm:text-2xl"
      />
    )
  return (
    <button onClick={() => setEdit(true)} className="group flex min-w-0 flex-1 items-center gap-2 text-left" title="Rename">
      <h1 className="truncate text-lg font-bold tracking-tight sm:text-2xl">{value}</h1>
      <IconEdit className="h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
    </button>
  )
}

const STAGES = ['Preparing audio', 'Uploading', 'Transcribing & separating speakers', 'Writing the minutes']
function Processing({ stage = 'Preparing audio' }: { stage?: string }) {
  const at = Math.max(0, STAGES.findIndex((s) => stage.startsWith(s)))
  return (
    <div className="glass mb-6 rounded-3xl p-6">
      <div className="flex items-center gap-4">
        <span className="relative grid h-12 w-12 place-items-center">
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <IconSparkle className="h-5 w-5 text-primary" />
        </span>
        <div>
          <p className="font-semibold">{stage}…</p>
          <p className="text-xs text-muted">Usually under a minute for a short meeting; longer recordings take a few.</p>
        </div>
      </div>
      <ol className="mt-5 grid grid-cols-4 gap-2">
        {STAGES.map((s, i) => (
          <li key={s} className="space-y-1.5">
            <div className={`h-1 rounded-full ${i < at ? 'bg-primary' : i === at ? 'animate-pulse bg-primary/70' : 'bg-white/10'}`} />
            <p className={`text-[10px] leading-tight ${i <= at ? 'text-white' : 'text-muted'}`}>{s}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Speakers({ m, onRename }: { m: Meeting; onRename: (id: string, name: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [v, setV] = useState('')
  const talk = useMemo(() => {
    const t: Record<string, number> = {}
    for (const s of m.segments) t[s.speaker] = (t[s.speaker] || 0) + Math.max(0, s.end - s.start)
    return t
  }, [m.segments])
  const total = Object.values(talk).reduce((a, b) => a + b, 0) || 1
  return (
    <div className="mb-5">
      <div className="flex flex-wrap gap-2">
        {m.speakers.map((s) => {
          const color = speakerColor(m.speakers, s.id)
          const name = speakerName(m.speakers, s.id)
          return editing === s.id ? (
            <form key={s.id} onSubmit={(e) => { e.preventDefault(); onRename(s.id, v.trim()); setEditing(null) }} className="glass flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5">
              <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-black" style={{ background: color }}>{(v || name).charAt(0).toUpperCase()}</span>
              <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => setEditing(null)} placeholder="Name" className="w-28 bg-transparent text-sm outline-none" />
              <button type="submit" onMouseDown={(e) => e.preventDefault()} aria-label="Save name" className="grid h-6 w-6 place-items-center rounded-full bg-primary text-black"><IconCheck className="h-3.5 w-3.5" /></button>
            </form>
          ) : (
            <button key={s.id} onClick={() => { setEditing(s.id); setV(s.name) }} title="Rename speaker" className="glass group flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition hover:border-primary/40">
              <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-black" style={{ background: color }}>{name.charAt(0).toUpperCase()}</span>
              <span className="text-sm font-semibold">{name}</span>
              <span className="font-mono text-[10px] text-muted">{Math.round(((talk[s.id] || 0) / total) * 100)}%</span>
              <IconEdit className="h-3.5 w-3.5 text-muted opacity-0 transition group-hover:opacity-100" />
            </button>
          )
        })}
      </div>
      {/* Share of talk time, one bar. */}
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/5">
        {m.speakers.map((s) => (
          <div key={s.id} style={{ width: `${((talk[s.id] || 0) / total) * 100}%`, background: speakerColor(m.speakers, s.id) }} className="h-full first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
    </div>
  )
}

function Transcript({ m, time, onSeek }: { m: Meeting; time: number; onSeek: (t: number) => void }) {
  const [q, setQ] = useState('')
  // Consecutive segments by the same speaker read as one turn.
  const turns = useMemo(() => {
    const out: { speaker: string; start: number; parts: { start: number; end: number; text: string }[] }[] = []
    for (const s of m.segments) {
      const last = out[out.length - 1]
      if (last && last.speaker === s.speaker) last.parts.push(s)
      else out.push({ speaker: s.speaker, start: s.start, parts: [s] })
    }
    return out
  }, [m.segments])
  const query = q.trim().toLowerCase()
  const shown = query ? turns.filter((t) => t.parts.some((p) => p.text.toLowerCase().includes(query)) || speakerName(m.speakers, t.speaker).toLowerCase().includes(query)) : turns
  return (
    <div className="glass rounded-3xl p-4 sm:p-5">
      <label className="mb-4 flex items-center gap-2 rounded-2xl bg-white/[0.04] px-3 py-2">
        <IconSearch className="h-4 w-4 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the transcript" className="w-full bg-transparent text-sm outline-none placeholder:text-muted/70" />
      </label>
      <ol className="space-y-4">
        {shown.map((t, i) => {
          const color = speakerColor(m.speakers, t.speaker)
          const end = t.parts[t.parts.length - 1].end
          const active = time >= t.start && time < Math.max(end, t.start + 0.5)
          return (
            <li key={`${t.start}-${i}`} className={`flex gap-3 rounded-2xl p-2 transition ${active ? 'bg-primary/10' : ''}`}>
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-black" style={{ background: color }}>
                {speakerName(m.speakers, t.speaker).charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-bold" style={{ color }}>{speakerName(m.speakers, t.speaker)}</span>
                  <button onClick={() => onSeek(t.start)} className="font-mono text-[11px] text-muted hover:text-primary">{clock(t.start)}</button>
                </div>
                <p className="mt-1 text-[15px] leading-relaxed">
                  {t.parts.map((p, j) => (
                    <span key={j} onClick={() => onSeek(p.start)} className={`cursor-pointer rounded transition hover:bg-white/5 ${time >= p.start && time < p.end ? 'text-primary' : ''}`}>
                      <Highlight text={p.text} q={query} />{' '}
                    </span>
                  ))}
                </p>
              </div>
            </li>
          )
        })}
        {!shown.length && <li className="py-6 text-center text-sm text-muted">No matches.</li>}
      </ol>
    </div>
  )
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-primary/30 text-white">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-3xl p-5">
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">{title}</h3>
      {children}
    </div>
  )
}

function MinutesPanel({ m, onSeek, onSave }: { m: Meeting; onSeek: (t: number) => void; onSave: (p: Partial<Meeting>) => void }) {
  const mm = m.minutes
  if (!mm)
    return (
      <div className="glass rounded-3xl p-6 text-center text-sm text-muted">
        {m.status === 'processing' ? 'Writing the minutes…' : 'No minutes yet.'}
      </div>
    )
  return (
    <div className="space-y-4">
      <Card title="Summary">
        <p className="text-[15px] leading-relaxed">{mm.summary}</p>
      </Card>
      {mm.actionItems.length > 0 && (
        <Card title="Action items">
          <ul className="space-y-2.5">
            {mm.actionItems.map((a, i) => (
              <li key={i} className="flex gap-3">
                <button
                  onClick={() => onSave({ minutes: { ...mm, actionItems: mm.actionItems.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) } })}
                  aria-label={a.done ? 'Mark not done' : 'Mark done'}
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${a.done ? 'border-primary bg-primary text-black' : 'border-white/25'}`}
                >
                  {a.done && <IconCheck className="h-3.5 w-3.5" />}
                </button>
                <div className="min-w-0">
                  <p className={`text-sm ${a.done ? 'text-muted line-through' : ''}`}>{a.task}</p>
                  {(a.owner || a.due) && (
                    <p className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                      {a.owner && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-semibold">{a.owner}</span>}
                      {a.due && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{a.due}</span>}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {mm.decisions.length > 0 && (
        <Card title="Decisions">
          <ul className="space-y-2">
            {mm.decisions.map((d, i) => (
              <li key={i} className="flex gap-2.5 text-sm"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{d}</li>
            ))}
          </ul>
        </Card>
      )}
      {mm.topics.length > 0 && (
        <Card title="Topics">
          <ol className="space-y-1">
            {mm.topics.map((t, i) => (
              <li key={i}>
                <button onClick={() => onSeek(t.start)} className="flex w-full items-baseline gap-3 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-white/5">
                  <span className="w-12 shrink-0 font-mono text-[11px] text-primary">{clock(t.start)}</span>
                  {t.title}
                </button>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {mm.keyPoints.length > 0 && (
        <Card title="Key points">
          <ul className="list-disc space-y-1.5 pl-5 text-sm marker:text-primary">
            {mm.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
          </ul>
        </Card>
      )}
    </div>
  )
}

// Renders an answer with [m:ss] citations as buttons that jump the audio.
function Cited({ text, onSeek }: { text: string; onSeek: (t: number) => void }) {
  const parts = text.split(/(\[\d{1,2}:\d{2}(?::\d{2})?\])/g)
  return (
    <>
      {parts.map((p, i) => {
        const t = /^\[(.+)\]$/.test(p) ? parseClock(p.slice(1, -1)) : null
        if (t === null) return <span key={i}>{p.replace(/\*\*(.+?)\*\*/g, '$1')}</span>
        return (
          <button key={i} onClick={() => onSeek(t)} className="mx-0.5 rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-[11px] text-primary hover:bg-primary/25">
            {p.slice(1, -1)}
          </button>
        )
      })}
    </>
  )
}

function Ask({ m, onSeek, onChat }: { m: Meeting; onSeek: (t: number) => void; onChat: (c: ChatMessage[]) => void }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const chat = m.chat
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [chat.length, busy])
  const names = m.speakers.map((s) => speakerName(m.speakers, s.id))
  const suggestions = ['What did we decide?', `What is ${names[1] || names[0] || 'each person'} responsible for?`, 'Were there any disagreements?', 'What questions were left open?']

  const send = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    const next: ChatMessage[] = [...chat, { role: 'user', content: question }]
    onChat(next)
    setInput('')
    setBusy(true)
    setErr('')
    try {
      const reply = await ask(transcriptText(m), next)
      onChat([...next, { role: 'assistant', content: reply }])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass flex h-[min(70vh,640px)] flex-col rounded-3xl">
      <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        {!chat.length && (
          <div className="py-4 text-center">
            <IconSparkle className="mx-auto h-7 w-7 text-primary" />
            <p className="mt-2 font-semibold">Ask about this meeting</p>
            <p className="mt-1 text-xs text-muted">Answers come only from the transcript, with links to the moments they cite.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs transition hover:border-primary/50 hover:text-primary">{s}</button>
              ))}
            </div>
          </div>
        )}
        {chat.map((c, i) => (
          <div key={i} className={`flex ${c.role === 'user' ? 'justify-end' : ''}`}>
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${c.role === 'user' ? 'bg-primary text-black' : 'bg-white/[0.06]'}`}>
              {c.role === 'user' ? c.content : <Cited text={c.content} onSeek={onSeek} />}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex gap-1.5 px-2 py-2">
            {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${i * 120}ms` }} />)}
          </div>
        )}
        {err && <p className="text-xs text-danger">{err}</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(input) }} className="flex items-center gap-2 border-t border-white/10 p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything about the meeting…" className="min-w-0 flex-1 rounded-2xl bg-white/[0.05] px-4 py-2.5 text-sm outline-none placeholder:text-muted/70 focus:bg-white/[0.08]" />
        <button type="submit" disabled={!input.trim() || busy} aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-black transition active:scale-95 disabled:opacity-40">
          <IconSend className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}

function ExportMenu({ m, onDelete }: { m: Meeting; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const md = () => toMarkdown(m)
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Export" className="glass grid h-10 w-10 place-items-center rounded-full transition hover:border-primary/50">
        <IconDownload className="h-4.5 w-4.5" />
      </button>
      {open && (
        <div className="glass-strong absolute right-0 top-12 z-40 w-52 overflow-hidden rounded-2xl p-1.5 text-sm" onMouseLeave={() => setOpen(false)}>
          <button className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-white/5" onClick={async () => { await navigator.clipboard.writeText(md()); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
            <IconCopy className="h-4 w-4 text-primary" /> {copied ? 'Copied!' : 'Copy as Markdown'}
          </button>
          <button
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-white/5"
            onClick={() => {
              const a = document.createElement('a')
              a.href = URL.createObjectURL(new Blob([md()], { type: 'text/markdown' }))
              a.download = `${m.title.replace(/[^\p{L}\p{N}]+/gu, '-')}.md`
              a.click()
              URL.revokeObjectURL(a.href)
              setOpen(false)
            }}
          >
            <IconDownload className="h-4 w-4 text-primary" /> Download .md
          </button>
          <button className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-danger hover:bg-danger/10" onClick={() => confirm('Delete this meeting and its recording?') && onDelete()}>
            <IconTrash className="h-4 w-4" /> Delete meeting
          </button>
        </div>
      )}
    </div>
  )
}
