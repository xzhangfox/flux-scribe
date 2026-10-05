import { mockAnswer, mockMinutes, mockTranscript } from '../../shared/demo-meeting'
import type { Meeting } from './types'

// Guest mode: a fully processed sample meeting (the same one the server's
// mock mode returns) to explore — transcript, speakers, minutes and Q&A —
// without an account and without a single API call.

export const DEMO_ID = 'demo-launch-sync'

/** Silent audio of the meeting's length, so the player, the timeline and
 *  the [m:ss] citations all work. 8 kHz, 8-bit mono WAV. */
function silence(seconds: number) {
  const rate = 8000
  const n = rate * seconds
  const buf = new ArrayBuffer(44 + n)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + n, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate, true)
  v.setUint16(32, 1, true)
  v.setUint16(34, 8, true)
  str(36, 'data')
  v.setUint32(40, n, true)
  new Uint8Array(buf, 44).fill(128)
  return new Blob([buf], { type: 'audio/wav' })
}

export function demoMeeting(): Meeting {
  const t = mockTranscript()
  const durationSec = 100
  return {
    id: DEMO_ID,
    title: mockMinutes().title,
    createdAt: Date.now() - 2 * 3600 * 1000,
    durationSec,
    audio: silence(durationSec),
    mimeType: 'audio/wav',
    context: 'Maya (PM), Leo (engineering), Priya (design)',
    status: 'ready',
    language: t.language,
    speakers: t.speakers,
    segments: t.segments,
    minutes: mockMinutes(),
    chat: [],
  }
}

export const demoAnswer = (question: string) => new Promise<string>((r) => setTimeout(() => r(mockAnswer(question)), 700))
