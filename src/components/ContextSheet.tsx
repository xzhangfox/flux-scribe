import { useState } from 'react'
import { durationLabel } from '../lib/format'
import { IconSparkle } from './icons'

// Optional, but the cheapest accuracy boost there is: participant names
// and jargon let the model spell them right and name the speakers.
export function ContextSheet({ durationSec, defaultTitle, onSubmit, onDiscard }: { durationSec: number; defaultTitle: string; onSubmit: (title: string, context: string) => void; onDiscard: () => void }) {
  const [title, setTitle] = useState(defaultTitle)
  const [context, setContext] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal aria-label="Before transcribing">
      <form
        className="glass-strong fade-up w-full max-w-lg space-y-5 rounded-t-[28px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-[28px]"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(title.trim() || defaultTitle, context.trim())
        }}
      >
        <div>
          <h2 className="text-lg font-bold">Ready to transcribe</h2>
          <p className="mt-1 text-sm text-muted">{durationLabel(durationSec)} of audio.</p>
        </div>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="glass mt-2 w-full rounded-2xl bg-transparent px-4 py-3 text-sm outline-none focus:border-primary/60" />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Who's speaking, and about what? <span className="normal-case tracking-normal">(optional)</span></span>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            placeholder="e.g. Maya (PM), Leo (engineering), Priya (design) — Q4 launch, Flux Scribe beta"
            className="glass mt-2 w-full resize-none rounded-2xl bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted/60 focus:border-primary/60"
          />
          <span className="mt-1.5 block text-xs text-muted">Names and terms here help get spellings and speakers right.</span>
        </label>
        <div className="flex gap-3">
          <button type="button" onClick={onDiscard} className="glass flex-1 rounded-2xl py-3 text-sm font-semibold text-muted hover:text-danger">Discard</button>
          <button type="submit" className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-bold text-black shadow-[0_0_30px_rgba(var(--primary-rgb),0.35)] active:scale-[0.98]">
            <IconSparkle className="h-4 w-4" /> Transcribe
          </button>
        </div>
      </form>
    </div>
  )
}
