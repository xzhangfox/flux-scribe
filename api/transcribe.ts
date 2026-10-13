import { FileState, ThinkingLevel, Type, createPartFromUri, type Part } from '@google/genai'
import { HttpError, MODEL, clock, client, handle, isMock, parseModelJson, readJson, usageOf } from './_lib/gemini.js'
import { mockTranscript } from '../shared/demo-meeting.js'
import { requireUser } from './_lib/auth.js'

// Transcription with speaker separation. A recording up to ~20 minutes goes
// in one pass. A longer one comes part by part (~15 minutes each, cut at
// pauses by the app), and every part after the first carries a few seconds
// of each voice already heard, labelled — so the same person keeps the same
// label from the first minute to the third hour. Each part is a short call
// with a small answer: no output limit or timeout to hit, and a failure
// costs one part, not the meeting. Accuracy also comes from structured
// output, temperature 0, a little thinking for the diarization, the end of
// the previous part for continuity, and optional user context
// (participant names, topic, jargon).

interface VoiceSample {
  speaker: string
  name?: string
  data: string
  mimeType: string
}

interface Body {
  inline?: { data: string; mimeType: string }
  file?: { name: string; uri: string; mimeType: string }
  context?: string
  language?: string
  /** For a part of a long recording. */
  part?: { index: number; total: number; offset: number }
  /** Everyone identified so far ({ id, name }), and samples of their voices. */
  speakers?: { id: string; name: string }[]
  refs?: VoiceSample[]
  /** The last lines of the previous part. */
  previous?: string[]
}

const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aiff']

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    language: { type: Type.STRING, description: 'Main spoken language, BCP-47 (e.g. en, zh, es).' },
    speakers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: 'S1, S2… in order of first appearance.' },
          name: { type: Type.STRING, description: 'Real name only if stated or addressed in the audio; otherwise empty.' },
        },
        required: ['id', 'name'],
      },
    },
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: { type: Type.STRING },
          start: { type: Type.NUMBER, description: 'Seconds from the start of the audio.' },
          end: { type: Type.NUMBER, description: 'Seconds from the start of the audio.' },
          text: { type: Type.STRING },
        },
        required: ['speaker', 'start', 'end', 'text'],
      },
    },
  },
  required: ['language', 'speakers', 'segments'],
}

function prompt(b: Body, context: string, language: string) {
  const part = b.part && b.part.total > 1 ? b.part : null
  const known = (b.speakers || []).slice(0, 30)
  const next = known.reduce((n, s) => Math.max(n, Number(/^S(\d+)$/.exec(s.id)?.[1] || 0)), 0) + 1
  const lines = [
    `You are a meticulous meeting transcriptionist. Transcribe this entire recording, from the first word to the last.`,
  ]
  if (part)
    lines.push(
      '',
      `This recording is part ${part.index + 1} of ${part.total} of one long meeting, starting ${clock(part.offset)} into it. It may begin or end mid-sentence — transcribe what you hear. "start" and "end" are seconds from the beginning of THIS part, not of the meeting.`,
    )
  lines.push('', 'Speaker separation:')
  if (part && b.refs?.length)
    lines.push(
      '- Before the recording you were given voice samples of speakers already identified earlier in this meeting. Compare every voice with them: a voice that matches a sample keeps that sample\'s label. Do not transcribe the samples themselves.',
      `- Only a voice that matches none of the samples gets a new label: S${next}, then S${next + 1}…, in order of first appearance.`,
    )
  else lines.push('- Tell speakers apart by voice. Label them S1, S2, S3… in order of first appearance, and keep each label fixed for the whole recording.')
  if (part && known.length) lines.push(`- Speakers identified so far: ${known.map((s) => (s.name ? `${s.id} (${s.name})` : s.id)).join(', ')}.`)
  lines.push(
    '- Never merge two different voices into one label, and never split one voice into two labels.',
    '- Fill a speaker\'s "name" only when their name is clearly said in the audio (they introduce themselves, or someone addresses them — "Thanks, Maria"). Otherwise leave it empty. Never invent names.',
    '',
    'Transcript:',
    '- Keep the original spoken language(s) exactly — do not translate; preserve code-switching between languages.',
    '- Light clean-up only: drop filler words (um, uh, 嗯, 那个) and false starts, add punctuation. Do not paraphrase or summarize.',
    '- Start a new segment at every change of speaker, and at least every ~30 seconds within a long turn.',
    `- "start" and "end" are seconds from the beginning of the ${part ? 'part' : 'audio'}, accurate to about a second.`,
    '- Mark unintelligible speech as [inaudible]. Skip silence, music and background noise.',
  )
  if (language) lines.push('', `The meeting is expected to be mainly in: ${language}.`)
  if (context) lines.push('', `Context from the user (participants, topic, terminology) — use it to spell names and jargon correctly and to name speakers when the audio confirms who is who:\n${context}`)
  if (part && b.previous?.length) lines.push('', `For continuity, the previous part ended with:\n${b.previous.slice(-6).map((l) => l.slice(0, 400)).join('\n')}`)
  return lines.join('\n')
}

async function waitUntilActive(name: string) {
  const ai = client()
  for (let i = 0; i < 90; i++) {
    const f = await ai.files.get({ name })
    if (f.state === FileState.ACTIVE) return
    if (f.state === FileState.FAILED) throw new HttpError(422, 'The audio file could not be processed.')
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new HttpError(504, 'The uploaded audio took too long to become ready.')
}

export const POST = handle(async (req) => {
  requireUser(req)
  const body = await readJson<Body>(req)
  if (!body.inline && !body.file) throw new HttpError(400, 'No audio was provided.')
  const context = (body.context || '').slice(0, 2000)
  const language = (body.language || '').slice(0, 40)
  const refs = (body.refs || []).slice(0, 10)
  if (refs.some((r) => typeof r.data !== 'string' || r.data.length > 600_000 || !AUDIO_TYPES.includes(r.mimeType))) throw new HttpError(400, 'Invalid voice sample.')
  if (isMock()) {
    const t = mockTranscript()
    return { ...t, usage: { input: 0, output: 0 } }
  }

  const ai = client()
  let audio: Part
  if (body.file) {
    if (!/^files\/[\w-]+$/.test(body.file.name)) throw new HttpError(400, 'Invalid file reference.')
    await waitUntilActive(body.file.name)
    audio = createPartFromUri(body.file.uri, body.file.mimeType)
  } else {
    audio = { inlineData: { data: body.inline!.data, mimeType: body.inline!.mimeType } }
  }

  const parts: Part[] = []
  if (body.part && body.part.total > 1 && refs.length) {
    parts.push({ text: 'VOICE SAMPLES — reference clips of speakers already identified in this meeting (not part of the recording):' })
    for (const r of refs) {
      parts.push({ text: `Voice sample of ${String(r.speaker).slice(0, 12)}${r.name ? ` (${String(r.name).slice(0, 60)})` : ''}:` })
      parts.push({ inlineData: { data: r.data, mimeType: r.mimeType } })
    }
    parts.push({ text: 'RECORDING TO TRANSCRIBE:' })
  }
  parts.push(audio, { text: prompt(body, context, language) })

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        temperature: 0,
        maxOutputTokens: 65536,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })
    const out = parseModelJson<{ language: string; speakers: { id: string; name: string }[]; segments: { speaker: string; start: number; end: number; text: string }[] }>(response.text)
    const segments = (out.segments || [])
      .filter((s) => s && typeof s.text === 'string' && s.text.trim())
      .map((s) => ({ speaker: String(s.speaker || 'S1'), start: Math.max(0, Number(s.start) || 0), end: Math.max(0, Number(s.end) || 0), text: s.text.trim() }))
      .sort((a, b) => a.start - b.start)
    // Every label used in the transcript gets a speaker entry.
    const ids = [...new Set(segments.map((s) => s.speaker))]
    const named = new Map((out.speakers || []).map((s) => [s.id, (s.name || '').trim()]))
    return {
      language: out.language || '',
      speakers: ids.map((id) => ({ id, name: named.get(id) || '' })),
      segments,
      truncated: response.candidates?.[0]?.finishReason === 'MAX_TOKENS',
      usage: usageOf(response),
    }
  } finally {
    // The audio's only needed for this one call — don't leave it on the
    // Files API (it would expire in 48h anyway).
    if (body.file) ai.files.delete({ name: body.file.name }).catch(() => {})
  }
})
