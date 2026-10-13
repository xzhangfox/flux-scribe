import { Mp3Writer, SAMPLE_RATE, resample } from './mp3'
import { saveDraftPart, updateDraft, type Draft } from './drafts'

// Microphone → mono float frames (AudioWorklet) → MP3 encoded on the fly,
// so even a three-hour meeting never holds raw audio in memory (~14 MB an
// hour). Every few seconds the new MP3 bytes are also saved as a draft, so
// a closed tab or a crash loses at most those seconds. Exposes an
// AnalyserNode for the live waveform.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('scribe-tap', Tap)
`

const SAVE_EVERY_MS = 5000
const CONSTRAINTS: MediaStreamConstraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }

type WakeLock = { release: () => Promise<void> }

export class Recorder {
  analyser!: AnalyserNode
  /** Called when the microphone stops delivering sound (phone call, the
   *  page sent to the background on a phone) and when it's back. */
  onInterrupted: (interrupted: boolean) => void = () => {}
  private ctx?: AudioContext
  private stream?: MediaStream
  private source?: MediaStreamAudioSourceNode
  private node?: AudioWorkletNode
  private writer = new Mp3Writer()
  private parts: Uint8Array[] = []
  private paused = false
  private stopped = false
  private samples = 0
  private wakeLock: WakeLock | null = null
  private draft: Draft
  private saving: Promise<void> = Promise.resolve()
  private timer = 0
  private interrupted = false

  constructor() {
    this.draft = { id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), durationSec: 0, parts: 0 }
  }

  get draftId() {
    return this.draft.id
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS)
    if (this.stopped) return void this.stream.getTracks().forEach((t) => t.stop())
    // Ask for 16 kHz directly; browsers that ignore it get resampled below.
    try {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    } catch {
      this.ctx = new AudioContext()
    }
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.75
    this.node = new AudioWorkletNode(this.ctx, 'scribe-tap')
    const rate = this.ctx.sampleRate
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.paused || this.stopped) return
      const frame = resample(e.data, rate)
      this.samples += frame.length
      this.writer.write(frame)
    }
    this.connect()
    // A silent sink keeps the worklet pulling audio in every browser.
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    this.node.connect(sink).connect(this.ctx.destination)
    this.ctx.onstatechange = () => this.check()
    document.addEventListener('visibilitychange', this.onVisible)
    this.timer = window.setInterval(() => this.save(), SAVE_EVERY_MS)
    await this.holdScreen()
  }

  private connect() {
    this.source?.disconnect()
    this.source = this.ctx!.createMediaStreamSource(this.stream!)
    this.source.connect(this.analyser)
    this.source.connect(this.node!)
    const track = this.stream!.getAudioTracks()[0]
    if (track) {
      track.onended = () => this.check()
      track.onmute = () => this.check()
      track.onunmute = () => this.check()
    }
  }

  /** Whether sound is coming in; tells the page when that changes. */
  private check() {
    if (this.stopped) return
    const track = this.stream?.getAudioTracks()[0]
    const down = !track || track.readyState === 'ended' || track.muted || this.ctx?.state !== 'running'
    if (down !== this.interrupted) {
      this.interrupted = down
      this.onInterrupted(down)
    }
  }

  private onVisible = () => {
    if (document.hidden || this.stopped) {
      // Leaving the page: save what's recorded right away.
      if (document.hidden) this.save()
      return
    }
    void this.recover()
  }

  /** Back on screen: restart the microphone if it was cut off. iPhone
   *  needs a tap to resume audio — the page shows a button for that. */
  async recover() {
    if (this.stopped || !this.ctx) return
    try {
      const track = this.stream?.getAudioTracks()[0]
      if (!track || track.readyState === 'ended') {
        this.stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS)
        this.connect()
      }
      if (this.ctx.state !== 'running') await this.ctx.resume()
    } catch {
      /* stays interrupted; the button lets them try again */
    }
    await this.holdScreen()
    this.check()
  }

  private async holdScreen() {
    if (this.wakeLock || document.hidden) return
    try {
      this.wakeLock = (await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<WakeLock> } }).wakeLock?.request('screen')) ?? null
      ;(this.wakeLock as unknown as EventTarget | null)?.addEventListener?.('release', () => (this.wakeLock = null))
    } catch {
      this.wakeLock = null
    }
  }

  /** Appends the bytes encoded since the last save to the draft. */
  private save() {
    const bytes = this.writer.drain()
    if (!bytes.length) return
    this.parts.push(bytes)
    const draft = { ...this.draft, durationSec: this.seconds }
    this.draft = { ...draft, parts: draft.parts + 1 }
    this.saving = this.saving.then(() => saveDraftPart(draft, bytes)).catch(() => {})
  }

  get seconds() {
    return this.samples / SAMPLE_RATE
  }

  get isInterrupted() {
    return this.interrupted
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
  }

  private result?: Promise<{ blob: Blob; durationSec: number; draftId: string }>

  stop() {
    this.result ??= this.finish()
    return this.result
  }

  private async finish() {
    this.stopped = true
    this.release()
    const tail = this.writer.end()
    if (tail.length) {
      this.parts.push(tail)
      const draft = { ...this.draft, durationSec: this.seconds }
      this.draft = { ...draft, parts: draft.parts + 1 }
      this.saving = this.saving.then(() => saveDraftPart(draft, tail)).catch(() => {})
    } else this.saving = this.saving.then(() => updateDraft({ ...this.draft, durationSec: this.seconds })).catch(() => {})
    await this.saving
    await this.ctx?.close().catch(() => {})
    return { blob: new Blob(this.parts as BlobPart[], { type: 'audio/mpeg' }), durationSec: this.seconds, draftId: this.draft.id }
  }

  /** Stops without keeping anything. Safe at any point, including before
   *  start() has finished (the caller then cancels again once it resolves). */
  async cancel() {
    this.stopped = true
    this.release()
    await this.ctx?.close().catch(() => {})
    await this.saving
  }

  private release() {
    window.clearInterval(this.timer)
    document.removeEventListener('visibilitychange', this.onVisible)
    if (this.node) this.node.port.onmessage = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.wakeLock?.release().catch(() => {})
    this.wakeLock = null
  }
}
