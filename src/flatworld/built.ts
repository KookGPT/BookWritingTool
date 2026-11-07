// Builds flat worlds in a worker and keeps the last two in memory, shared by the Map and Globe tabs so neither rebuilds what the other made.
import type { FlatWorld } from './gen.ts'
import type { Built } from './scene.ts'

// Samples along the long side: 1536, or more for a map over 13000 km so a bigger map keeps the same km per sample. The two target machines are strong, phones would want ~900.
const resOf = (long: number) => Math.min(4800, Math.max(1536, Math.round(long / (13000 / 1536))))
const cache = new Map<string, Built>()

/** The story's world: the Globe always shows it and the Map opens on it. Test maps only come up if the book has no Eyaris. */
export const mainWorld = (worlds: FlatWorld[]) => worlds.find((w) => w.id === 'eyaris') ?? worlds[0]

/** What the ground depends on: names, notes and layers never rebuild it. */
export const specOf = (w: FlatWorld) => JSON.stringify({ ...w, name: '', note: '', layers: undefined, features: w.features.map(({ name: _n, note: _o, ...f }) => f) })

/** Calls `done` with the built world, straight away if it is cached. Returns a cancel for use as an effect cleanup. */
export function buildWorld(spec: string, done: (b: Built) => void, fail: (msg: string) => void) {
  const hit = cache.get(spec)
  if (hit) { done(hit); return }
  const w = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<{ built: Built }>) => {
    cache.delete(spec); cache.set(spec, e.data.built)
    if (cache.size > 2) cache.delete(cache.keys().next().value!)
    done(e.data.built); w.terminate()
  }
  w.onerror = (e) => fail(e.message)
  const fw: FlatWorld = JSON.parse(spec)
  w.postMessage({ fw, res: resOf(Math.max(...fw.size)), job: 0 })
  return () => w.terminate()
}
