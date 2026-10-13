import { useEffect, useRef, useState } from 'react'
import { Recorder } from '../lib/recorder'
import { deleteDraft } from '../lib/drafts'
import { clock } from '../lib/format'
import { IconPause, IconPlay, IconStop, IconTrash } from './icons'

// Live recording: a radial waveform ringing the timer, pause / resume,
// stop. Encoding to MP3 happens as you talk, so stopping is instant, and
// what's recorded is saved every few seconds: leaving this screen by
// accident (or the browser closing) keeps it as a recovered recording.
export function RecorderView({ onDone, onCancel }: { onDone: (blob: Blob, durationSec: number, draftId: string) => void; onCancel: () => void }) {
  const rec = useRef<Recorder | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'starting' | 'live' | 'paused' | 'error'>('starting')
  const [interrupted, setInterrupted] = useState(false)
  const [error, setError] = useState('')
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    let raf = 0
    let alive = true
    const r = new Recorder()
    rec.current = r
    r.onInterrupted = setInterrupted
    r.start()
      .then(() => {
        if (!alive) return void r.stop()
        setState('live')
        const c = canvas.current!
        const ctx = c.getContext('2d')!
        const data = new Uint8Array(r.analyser.frequencyBinCount)
        const draw = () => {
          raf = requestAnimationFrame(draw)
          setSecs(r.seconds)
          const dpr = Math.min(devicePixelRatio || 1, 2)
          const size = c.clientWidth
          if (c.width !== size * dpr) c.width = c.height = size * dpr
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, size, size)
          r.analyser.getByteFrequencyData(data)
          const cs = getComputedStyle(document.documentElement)
          const primary = cs.getPropertyValue('--primary').trim() || '#cba35c'
          const bars = 72
          const cx = size / 2
          const inner = size * 0.33
          ctx.strokeStyle = primary
          ctx.lineCap = 'round'
          for (let i = 0; i < bars; i++) {
            const v = data[Math.floor((i < bars / 2 ? i : bars - i) * 3) + 2] / 255
            const len = size * 0.02 + v * size * 0.14
            const a = (i / bars) * Math.PI * 2 - Math.PI / 2
            ctx.globalAlpha = 0.35 + v * 0.65
            ctx.lineWidth = Math.max(2, size * 0.011)
            ctx.beginPath()
            ctx.moveTo(cx + Math.cos(a) * inner, cx + Math.sin(a) * inner)
            ctx.lineTo(cx + Math.cos(a) * (inner + len), cx + Math.sin(a) * (inner + len))
            ctx.stroke()
          }
          ctx.globalAlpha = 1
        }
        draw()
      })
      .catch((e: Error) => {
        rec.current = null
        setState('error')
        setError(e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings and try again.' : 'No microphone could be opened on this device.')
        void r.cancel().then(() => deleteDraft(r.draftId))
      })
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener('beforeunload', warn)
      // Left without stopping or discarding (back button, a link): keep
      // what was recorded as a draft to recover from the library.
      if (rec.current) void rec.current.stop()
    }
  }, [])

  const stop = async () => {
    const r = rec.current
    if (!r) return
    rec.current = null
    const { blob, durationSec, draftId } = await r.stop()
    onDone(blob, durationSec, draftId)
  }

  const discard = async () => {
    const r = rec.current
    rec.current = null
    if (r) {
      await r.cancel()
      await deleteDraft(r.draftId)
    }
    onCancel()
  }

  return (
    <div className="fade-up flex min-h-[70vh] flex-col items-center justify-center text-center">
      <div className="relative aspect-square w-[min(80vw,380px)]">
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0 grid place-items-center">
          <div>
            <p className={`font-mono text-4xl font-semibold tabular-nums sm:text-5xl ${state === 'paused' || interrupted ? 'text-muted' : ''}`}>{clock(secs)}</p>
            <p className="mt-2 flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-muted">
              {state === 'live' && !interrupted && <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />}
              {state === 'starting' ? 'Starting…' : state === 'paused' ? 'Paused' : state === 'error' ? 'No microphone' : interrupted ? 'Mic interrupted' : 'Recording'}
            </p>
          </div>
        </div>
      </div>

      {interrupted && state !== 'error' && (
        <div className="glass mt-6 max-w-sm space-y-3 rounded-3xl border-primary/40 p-4">
          <p className="text-sm">The microphone was interrupted — by a call, another app, or Scribe leaving the screen. Everything up to now is saved.</p>
          <button onClick={() => void rec.current?.recover()} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-black active:scale-95">
            Continue recording
          </button>
        </div>
      )}

      {state === 'error' ? (
        <div className="mt-6 max-w-sm space-y-4">
          <p className="text-sm text-danger">{error}</p>
          <button onClick={onCancel} className="glass rounded-full px-5 py-2.5 text-sm font-semibold">Back</button>
        </div>
      ) : (
        <div className="mt-8 flex items-center gap-5">
          <button onClick={discard} aria-label="Discard recording" className="glass grid h-14 w-14 place-items-center rounded-full text-muted transition hover:text-danger active:scale-95">
            <IconTrash className="h-5 w-5" />
          </button>
          <button
            onClick={stop}
            disabled={state === 'starting'}
            aria-label="Stop and transcribe"
            className="grid h-20 w-20 place-items-center rounded-full bg-primary text-black shadow-[0_0_40px_rgba(var(--primary-rgb),0.5)] transition active:scale-95 disabled:opacity-50"
          >
            <IconStop className="h-8 w-8" />
          </button>
          <button
            onClick={() => {
              if (state === 'live') { rec.current?.pause(); setState('paused') } else if (state === 'paused') { rec.current?.resume(); setState('live') }
            }}
            disabled={state === 'starting'}
            aria-label={state === 'paused' ? 'Resume' : 'Pause'}
            className="glass grid h-14 w-14 place-items-center rounded-full transition active:scale-95 disabled:opacity-50"
          >
            {state === 'paused' ? <IconPlay className="h-5 w-5" /> : <IconPause className="h-5 w-5" />}
          </button>
        </div>
      )}
      <p className="mt-6 max-w-sm text-xs leading-relaxed text-muted">
        Saved on this device as you go — three hours is about 43 MB. On a computer you can switch to other tabs and apps. On a phone, keep Scribe on screen (it stays awake): phones pause the microphone for web pages in the background.
      </p>
    </div>
  )
}
