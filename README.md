# Flux Scribe

Record a meeting (or upload a recording) and get a speaker-separated transcript, minutes with decisions and action items, and an AI assistant you can ask about the meeting. Every answer cites timestamps you can jump to.

## How it keeps cost down

- The browser encodes recordings as 16 kHz mono 32 kbps MP3, which is about 14 MB per hour.
- Gemini hears the audio once, in a pass that does transcription and speaker diarization together.
- Minutes and Q&A only read the text transcript, which is much cheaper than re-sending audio. Q&A sends the transcript first and unchanged, so Gemini's implicit caching bills follow-up questions at the cached rate.
- Parts of 3 MB or less are sent inline. Larger ones go straight from the browser to the Gemini Files API through a resumable upload URL. The server never relays the bytes, and each file is deleted right after its transcription.
- Each meeting keeps a running total of the tokens it used (shown in the meeting's menu).

Rough token use (audio is 32 tokens a second):

| | 1 hour | 3 hours |
|---|---|---|
| Transcription, audio in | ~115k | ~350k (+~3% voice samples) |
| Transcription, text out | ~15–22k | ~45–65k |
| Minutes, in / out | ~15–20k / ≤16k | ~40–60k / ≤16k |
| Each question, in | ~the transcript | ~the transcript (cached after the first) |

## Long recordings (2–3 hours and more)

- **Parts.** Up to ~20 minutes goes in one pass. Longer recordings are cut into ~15-minute parts, each cut at the quietest moment within a minute of its planned time, so no word is split. Each part is a short call with a small answer, well inside the output limit and the 300 s function limit that a single three-hour pass would hit.
- **Same speaker, same label.** Every part after the first starts with a few seconds of each voice heard so far (up to 8), labelled, plus the last lines of the previous part. The model keeps those labels and only numbers truly new voices.
- **Resumable.** Each finished part is saved at once. A reload, a dropped connection or a phone that suspended the page costs at most the part in flight. Processing resumes automatically when the page is open again, and "Try again" continues from the failed part.
- **Background.** On a computer, recording and processing carry on in a background tab (the tab title shows progress, and a notification says when the minutes are ready). On a phone the screen is kept awake while Scribe is open. Phones pause web pages in the background, so the microphone pauses, everything recorded is kept, and processing waits and then continues.
- **Crash-safe recording.** The recorder saves to IndexedDB every 5 seconds. A closed tab or a crash shows up as a recovered recording in the library.
- **Uploads of any length** never decode the whole file:
  - MP3 and AAC (raw, or inside M4A/MP4/MOV: Voice Memos, Zoom, videos) are read frame by frame. At speech bitrates (≤72 kbps) they are kept as is, with M4A remuxed to ADTS.
  - Higher-bitrate audio and WAV are decoded in pieces and re-encoded to speech MP3 on every core.
  - Other formats (WebM, Ogg, FLAC, Apple Lossless) are decoded whole if they fit in memory.

## Storage

- Meetings live only in this browser, in IndexedDB. Text and audio are stored separately, so the list never loads a recording.
- **Free up space.** Delete meetings from the list (Select) or from a meeting's menu. "Remove recording" frees the audio and keeps the transcript, minutes and chat.
- **Keep it safe.** Scribe asks the browser to keep its data persistent (Settings → Storage), so the browser doesn't clear it when space runs low.

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
