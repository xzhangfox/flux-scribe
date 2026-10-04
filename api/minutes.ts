import { ThinkingLevel, Type } from '@google/genai'
import { HttpError, MODEL, client, handle, isMock, parseModelJson, readJson } from './_lib/gemini.js'
import { mockMinutes } from './_lib/mock.js'

// Meeting minutes from the finished transcript — text in, so it costs a
// tiny fraction of the audio pass and can be regenerated freely.
const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'A short, specific meeting title (max ~8 words).' },
    summary: { type: Type.STRING, description: '3–5 sentence overview.' },
    keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
    decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
    actionItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { task: { type: Type.STRING }, owner: { type: Type.STRING }, due: { type: Type.STRING } },
        required: ['task', 'owner', 'due'],
      },
    },
    topics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { title: { type: Type.STRING }, start: { type: Type.NUMBER, description: 'Seconds — when the topic begins.' } },
        required: ['title', 'start'],
      },
    },
  },
  required: ['title', 'summary', 'keyPoints', 'decisions', 'actionItems', 'topics'],
}

export const POST = handle(async (req) => {
  const { transcript } = await readJson<{ transcript: string }>(req)
  if (!transcript?.trim()) throw new HttpError(400, 'Transcript is empty.')
  if (isMock()) return mockMinutes()
  const response = await client().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: transcript.slice(0, 600_000) }] }],
    config: {
      systemInstruction: `You write precise meeting minutes from a timestamped transcript ("[m:ss] Speaker: text").
Write in the transcript's main language. Be factual — include only what was actually said.
- decisions: things the group agreed or settled. Empty if none.
- actionItems: concrete follow-ups; owner = the speaker name as written in the transcript (or "" if unassigned); due = the deadline as stated (or "").
- topics: the agenda as it actually unfolded, in order, each with the second it began.`,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      temperature: 0.2,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  })
  return parseModelJson(response.text)
})
