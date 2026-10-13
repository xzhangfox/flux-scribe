import { Mp3Writer } from './mp3'

// One MP3 encoder per worker: the pool in encode.ts hands each worker a
// stretch of the recording, piece by piece, so long files encode on every
// core at once without blocking the page.
const writer = new Mp3Writer()

self.onmessage = (e: MessageEvent<{ pcm?: Float32Array; end?: boolean }>) => {
  let bytes: Uint8Array
  if (e.data.end) bytes = writer.end()
  else {
    writer.write(e.data.pcm!)
    bytes = writer.drain()
  }
  ;(self as unknown as Worker).postMessage(bytes, [bytes.buffer])
}
