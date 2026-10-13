import { createStore, del, delMany, entries, get, getMany, set } from 'idb-keyval'

// A recording in progress, saved to IndexedDB every few seconds as it's
// encoded. If the tab is closed, crashes or the phone kills it, everything
// up to the last save comes back the next time Scribe opens.
const drafts = createStore('flux-scribe-drafts', 'drafts')

export interface Draft {
  id: string
  createdAt: number
  updatedAt: number
  durationSec: number
  parts: number
}

const partKey = (id: string, n: number) => `${id}#${n}`

export async function saveDraftPart(d: Draft, bytes: Uint8Array) {
  await set(partKey(d.id, d.parts), new Blob([bytes as BlobPart]), drafts)
  await set(d.id, { ...d, parts: d.parts + 1, updatedAt: Date.now() }, drafts)
}

export const updateDraft = (d: Draft) => set(d.id, { ...d, updatedAt: Date.now() }, drafts)

export async function listDrafts(): Promise<Draft[]> {
  const all = await entries<string, Draft | Blob>(drafts)
  return all
    .filter(([k, v]) => !String(k).includes('#') && !(v instanceof Blob))
    .map(([, v]) => v as Draft)
    .filter((d) => d.parts > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function draftAudio(id: string): Promise<Blob | null> {
  const d = await get<Draft>(id, drafts)
  if (!d?.parts) return null
  const parts = await getMany<Blob>(Array.from({ length: d.parts }, (_, n) => partKey(id, n)), drafts)
  return new Blob(parts.filter(Boolean) as BlobPart[], { type: 'audio/mpeg' })
}

export async function deleteDraft(id: string) {
  const d = await get<Draft>(id, drafts)
  if (d) await delMany(Array.from({ length: d.parts + 1 }, (_, n) => partKey(id, n)), drafts)
  await del(id, drafts)
}
