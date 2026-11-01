import { get, set } from 'idb-keyval'
import { uid } from './store'

// Local safety nets, kept out of the Book so they never bloat sync (pushed work is also versioned by git).
export interface Snap { t: number; body: string; label?: string }
const GAP = 5 * 60_000
const MAX = 50

export const history = (chapterId: string) => get<Snap[]>(`hist:${chapterId}`).then((h) => h ?? [])

// Called with the PRE-edit body, so a big accidental delete is always recoverable.
export async function snapshot(chapterId: string, body: string, label?: string) {
  if (!body) return
  const h = await history(chapterId)
  if (h[0]?.body === body) return
  if (!label && h[0] && Date.now() - h[0].t < GAP) return
  await set(`hist:${chapterId}`, [{ t: Date.now(), body, label }, ...h].slice(0, MAX))
}

export type Kind = 'chapters' | 'wiki' | 'ideas' | 'scenes' | 'maps'
export interface Trashed { id: string; kind: Kind; name: string; at: number; data: unknown }

export const getTrash = () => get<Trashed[]>('trash').then((t) => t ?? [])
export const setTrash = (t: Trashed[]) => set('trash', t)
export async function trashIt(kind: Kind, name: string, data: unknown) {
  await setTrash([{ id: uid(), kind, name, at: Date.now(), data }, ...(await getTrash())].slice(0, 100))
}
