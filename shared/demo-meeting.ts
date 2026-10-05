// The sample meeting, shared by the guest demo (client) and the server's
// mock mode (SCRIBE_MOCK=1, for local development without an API key).
const LINES: [string, number, string][] = [
  ['S1', 0, "Okay, let's get started. Thanks everyone for joining — this is the Q4 launch sync for Flux Scribe."],
  ['S2', 7, 'Thanks, Maya. Quick update from engineering: speaker separation is done and the accuracy on our test set is around ninety-four percent.'],
  ['S1', 18, "That's great, Leo. What's left before we can ship the beta?"],
  ['S2', 23, 'Mainly the long-recording path. Anything over about an hour needs the direct upload, and I want another day of testing on slow networks.'],
  ['S3', 35, "From the design side, the transcript view is final. I'd like us to add one-tap speaker renaming before launch — people will want real names, not S1 and S2."],
  ['S1', 47, "Agreed, that's a must-have. Priya, can you have the renaming flow ready by Thursday?"],
  ['S3', 54, 'Yes, Thursday works.'],
  ['S2', 57, "One concern: cost. If every user records two hours a day, the audio pass adds up. I'd keep minutes and Q&A on the text transcript only."],
  ['S1', 69, "Makes sense. Let's decide that: audio is processed once, and everything after runs on the transcript."],
  ['S1', 77, 'So the beta goes out on the fifteenth. Leo owns the upload path, Priya owns renaming, and I will write the launch notes by Friday.'],
  ['S3', 88, 'Sounds good. Should we invite the pilot customers this week?'],
  ['S1', 93, "Next week — after the upload testing is done. Okay, that's everything. Thanks, all."],
]

export function mockTranscript() {
  return {
    language: 'en',
    speakers: [
      { id: 'S1', name: 'Maya' },
      { id: 'S2', name: 'Leo' },
      { id: 'S3', name: 'Priya' },
    ],
    segments: LINES.map(([speaker, start, text], i) => ({ speaker, start, end: LINES[i + 1]?.[1] ?? start + 6, text })),
    truncated: false,
  }
}

export function mockMinutes() {
  return {
    title: 'Q4 launch sync — Flux Scribe beta',
    summary:
      'The team reviewed readiness for the Flux Scribe beta. Speaker separation is complete at about 94% accuracy; the remaining work is the direct-upload path for recordings over an hour. Design asked for one-tap speaker renaming before launch, which was agreed. To control cost, audio will be processed once and all later features will run on the text transcript. The beta ships on the 15th.',
    keyPoints: ['Speaker separation is done (~94% on the test set).', 'Long recordings need the direct-upload path and more slow-network testing.', 'Transcript view design is final.'],
    decisions: ['Speaker renaming is a launch requirement.', 'Audio is processed once; minutes and Q&A run on the transcript.', 'The beta ships on the 15th; pilot customers are invited next week.'],
    actionItems: [
      { task: 'Finish and test the long-recording upload path', owner: 'Leo', due: 'Before the 15th' },
      { task: 'Ship one-tap speaker renaming', owner: 'Priya', due: 'Thursday' },
      { task: 'Write the launch notes', owner: 'Maya', due: 'Friday' },
    ],
    topics: [
      { title: 'Engineering status', start: 7 },
      { title: 'Design: speaker renaming', start: 35 },
      { title: 'Cost model', start: 57 },
      { title: 'Launch plan and owners', start: 77 },
    ],
  }
}

export function mockAnswer(question: string) {
  if (/cost|money|price|贵|成本/i.test(question)) return 'Leo raised cost as a concern [0:57]. The team decided the audio is processed only once, and minutes and Q&A run on the text transcript [1:09].'
  if (/who|owner|负责/i.test(question)) return '- **Leo** owns the long-recording upload path [1:17]\n- **Priya** ships speaker renaming by Thursday [0:47]\n- **Maya** writes the launch notes by Friday [1:17]'
  return 'The beta ships on the 15th [1:17]. Speaker separation is done at about 94% accuracy [0:07]; the remaining work is the direct-upload path for long recordings [0:23] and speaker renaming, due Thursday [0:47].'
}
