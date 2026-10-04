# Flux Scribe

Record a meeting (or upload a recording) and get a speaker-separated transcript, minutes with decisions and action items, and an AI assistant you can ask about the meeting. Every answer cites timestamps you can jump to.

## How it keeps cost down

- The browser encodes audio as 16 kHz mono 32 kbps MP3, which is about 14 MB per hour.
- Gemini processes the audio once, in a single pass that does transcription and speaker diarization together.
- Minutes and Q&A only read the text transcript, which is much cheaper than re-sending audio.
- Clips of 3 MB or less are sent inline. Larger files go straight from the browser to the Gemini Files API through a resumable upload URL. The server never relays the bytes, and the file is deleted after transcription.
- Meetings are stored only in the browser, in IndexedDB.

## Run

```bash
npm install
cp .env.example .env    # add GEMINI_API_KEY
npm run dev             # SCRIBE_MOCK=1 npm run dev to try it without a key
```

## Deploy

Import the repo into Vercel and set `GEMINI_API_KEY`. The functions in `api/` run on Vercel; `vercel.json` sets their time limits.
