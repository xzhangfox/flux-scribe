import { Mp3Writer, SAMPLE_RATE, resample } from './mp3'

// Microphone → mono float frames (AudioWorklet) → MP3 encoded on the fly,
// so even a two-hour meeting never holds raw audio in memory. Exposes an
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

export class Recorder {
  analyser!: AnalyserNode
  private ctx?: AudioContext
  private stream?: MediaStream
  private node?: AudioWorkletNode
  private writer = new Mp3Writer()
  private paused = false
  private samples = 0
  private wakeLock: { release: () => Promise<void> } | null = null

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    // Ask for 16 kHz directly; browsers that ignore it get resampled below.
    try {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    } catch {
      this.ctx = new AudioContext()
    }
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.75
    this.node = new AudioWorkletNode(this.ctx, 'scribe-tap')
    const rate = this.ctx.sampleRate
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.paused) return
      const frame = resample(e.data, rate)
      this.samples += frame.length
      this.writer.write(frame)
    }
    source.connect(this.analyser)
    source.connect(this.node)
    // A silent sink keeps the worklet pulling audio in every browser.
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    this.node.connect(sink).connect(this.ctx.destination)
    try {
      this.wakeLock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null
    } catch {
      this.wakeLock = null
    }
  }

  get seconds() {
    return this.samples / SAMPLE_RATE
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
  }

  async stop(): Promise<{ blob: Blob; durationSec: number }> {
    await this.cancel()
    return { blob: this.writer.finish(), durationSec: this.seconds }
  }

  /** Safe at any point, including before start() has finished (the
   *  caller then cancels again once it resolves). */
  async cancel() {
    if (this.node) this.node.port.onmessage = null
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})
    this.wakeLock?.release().catch(() => {})
  }
}
