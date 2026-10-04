import { ThinkingLevel } from '@google/genai'
import { HttpError, MODEL, client, handle, isMock, readJson } from './_lib/gemini.js'
import { mockAnswer } from './_lib/mock.js'

// The meeting assistant: answers strictly from this meeting's transcript,
// citing the moments it draws on as [m:ss] so the app can link them.
interface Body {
  transcript: string
  messages: { role: 'user' | 'assistant'; content: string }[]
}

export const POST = handle(async (req) => {
  const { transcript, messages } = await readJson<Body>(req)
  if (!transcript?.trim()) throw new HttpError(400, 'Transcript is empty.')
  const history = (messages || []).filter((m) => m && typeof m.content === 'string' && m.content.trim()).slice(-12)
  if (!history.length || history[history.length - 1].role !== 'user') throw new HttpError(400, 'Ask a question first.')
  if (isMock()) return { reply: mockAnswer(history[history.length - 1].content) }
  const response = await client().models.generateContent({
    model: MODEL,
    contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content.slice(0, 4000) }] })),
    config: {
      systemInstruction: `You are the assistant for one recorded meeting. Answer using only the transcript below.
- Cite the moments you rely on as [m:ss] (or [h:mm:ss]) right after the statement they support.
- If the meeting didn't cover something, say so plainly — never guess.
- Refer to people by the names used in the transcript.
- Reply in the language of the user's question. Be concise; use short lists when helpful.

TRANSCRIPT:
${transcript.slice(0, 600_000)}`,
      temperature: 0.3,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  })
  if (!response.text) throw new HttpError(502, 'The assistant returned an empty reply.')
  return { reply: response.text }
})
