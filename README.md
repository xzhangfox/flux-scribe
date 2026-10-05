# Flux Scribe

Record a meeting (or upload a recording) and get a speaker-separated transcript, minutes with decisions and action items, and an AI assistant you can ask about the meeting. Every answer cites timestamps you can jump to.

## How it keeps cost down

- The browser encodes audio as 16 kHz mono 32 kbps MP3, which is about 14 MB per hour.
- Gemini processes the audio once, in a single pass that does transcription and speaker diarization together.
- Minutes and Q&A only read the text transcript, which is much cheaper than re-sending audio.
- Clips of 3 MB or less are sent inline. Larger files go straight from the browser to the Gemini Files API through a resumable upload URL. The server never relays the bytes, and the file is deleted after transcription.
- Meetings are stored only in the browser, in IndexedDB.

## Access

Only signed-in users can reach the AI endpoints, so nobody else can spend the Gemini quota:

- **Sign in with a Flux account** (same email and password as Flux). The server checks the credentials and sets a signed, HttpOnly session cookie; every `/api/*` AI call is rejected without it.
- **`SCRIBE_ALLOWED_EMAILS`** decides which Flux accounts get in (comma-separated, or `*` for all). Unset means nobody — it fails closed. Removing an email takes effect immediately.
- **Guests** explore a read-only demo: a fully processed sample meeting with working Q&A, all on the device — no API calls. Their demo library is separate from the real one.

## Run

```bash
npm install
cp .env.example .env    # add GEMINI_API_KEY
npm run dev             # SCRIBE_MOCK=1 npm run dev to try it without a key
```

## Deploy

Import the repo into Vercel and set `GEMINI_API_KEY` and `SCRIBE_ALLOWED_EMAILS`. The functions in `api/` run on Vercel; `vercel.json` sets their time limits.
