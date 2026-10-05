import { FileState, ThinkingLevel, Type, createPartFromUri, type Part } from '@google/genai'
import { HttpError, MODEL, client, handle, isMock, parseModelJson, readJson } from './_lib/gemini.js'
import { mockTranscript } from '../shared/demo-meeting.js'
import { requireUser } from './_lib/auth.js'

// Transcription with speaker separation, in a single pass over the audio.
// Accuracy comes from: the full recording in one request (so speaker
// identities stay consistent across the whole meeting rather than being
// re-guessed per chunk), structured output, temperature 0, a little
// thinking budget for the diarization, and optional user context
// (participant names, topic, jargon) that the model can anchor on.

interface Body {
  inline?: { data: string; mimeType: string }
  file?: { name: string; uri: string; mimeType: string }
  context?: string
  language?: string
}

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

const PROMPT = (context: string, language: string) => `You are a meticulous meeting transcriptionist. Transcribe this entire recording, from the first word to the last.

Speaker separation:
- Tell speakers apart by voice. Label them S1, S2, S3… in order of first appearance, and keep each label fixed for the whole recording.
- Never merge two different voices into one label, and never split one voice into two labels.
- Fill a speaker's "name" only when their name is clearly said in the audio (they introduce themselves, or someone addresses them — "Thanks, Maria"). Otherwise leave it empty. Never invent names.

Transcript:
- Keep the original spoken language(s) exactly — do not translate; preserve code-switching between languages.
- Light clean-up only: drop filler words (um, uh, 嗯, 那个) and false starts, add punctuation. Do not paraphrase or summarize.
- Start a new segment at every change of speaker, and at least every ~30 seconds within a long turn.
- "start" and "end" are seconds from the beginning of the audio, accurate to about a second.
- Mark unintelligible speech as [inaudible]. Skip silence, music and background noise.
${language ? `\nThe meeting is expected to be mainly in: ${language}.` : ''}${context ? `\nContext from the user (participants, topic, terminology) — use it to spell names and jargon correctly and to name speakers when the audio confirms who is who:\n${context}` : ''}`

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
  if (isMock()) return mockTranscript()

  const ai = client()
  let audio: Part
  if (body.file) {
    if (!/^files\/[\w-]+$/.test(body.file.name)) throw new HttpError(400, 'Invalid file reference.')
    await waitUntilActive(body.file.name)
    audio = createPartFromUri(body.file.uri, body.file.mimeType)
  } else {
    audio = { inlineData: { data: body.inline!.data, mimeType: body.inline!.mimeType } }
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [audio, { text: PROMPT(context, language) }] }],
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
    }
  } finally {
    // The audio's only needed for this one call — don't leave it on the
    // Files API (it would expire in 48h anyway).
    if (body.file) ai.files.delete({ name: body.file.name }).catch(() => {})
  }
})
