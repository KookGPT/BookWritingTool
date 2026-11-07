// Pure helpers for ordered lists (the Planning Timeline). No imports so they run under plain node for tests.
type Item = { id: string }

/** Move `id` next to `target` (before it, or after it). Unknown ids leave the list as it was. */
export function moveTo<T extends Item>(list: T[], id: string, target: string, after: boolean): T[] {
  const item = list.find((x) => x.id === id)
  const rest = list.filter((x) => x.id !== id)
  const i = rest.findIndex((x) => x.id === target)
  if (!item || i < 0 || id === target) return list
  return [...rest.slice(0, i + (after ? 1 : 0)), item, ...rest.slice(i + (after ? 1 : 0))]
}

/** Swap `id` with its neighbour one step left (-1) or right (1); at either end nothing moves. */
export function shift<T extends Item>(list: T[], id: string, dir: -1 | 1): T[] {
  const i = list.findIndex((x) => x.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Insert `item` so it ends up at index `at` (clamped). */
export const insertAt = <T>(list: T[], at: number, item: T): T[] => {
  const i = Math.max(0, Math.min(at, list.length))
  return [...list.slice(0, i), item, ...list.slice(i)]
}
