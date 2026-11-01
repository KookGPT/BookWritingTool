// Pure three-way merge over book files (path -> content). No imports so it runs under plain node for tests.
export type Files = Record<string, string>
export type Shas = Record<string, string>

export interface MergeIn {
  local: Files // current local files
  lsha: Shas // sha of each local file
  remote: Shas // sha of each file on GitHub
  base: Shas // sha of each file at the last successful sync
  blob: (sha: string) => Promise<string> // downloads a remote file by sha
  newId: () => string
}

const LEGACY = ['ideas.json', 'scenes.json'] // old single-file layout, split into one file per item
const ORDERS = ['chapterOrder', 'sceneOrder', 'ideaOrder', 'threadOrder']
const labelField = (dir: string) => (dir === 'chapters' || dir === 'scenes' || dir === 'events' || dir === 'periods' ? 'title' : dir === 'ideas' ? 'text' : 'name')

export async function merge(i: MergeIn): Promise<{ out: Files; conflicts: number }> {
  const out: Files = {}
  let conflicts = 0
  const paths = new Set([...Object.keys(i.local), ...Object.keys(i.remote), ...Object.keys(i.base)])
  for (const p of LEGACY) paths.delete(p)

  for (const p of paths) {
    const l = i.lsha[p], r = i.remote[p], b = i.base[p]
    if (l === r) { if (l) out[p] = i.local[p]; continue }
    if (l === b) { if (r) out[p] = await i.blob(r); continue } // only remote changed (or deleted)
    if (r === b) { if (l) out[p] = i.local[p]; continue } // only local changed (or deleted)
    // both changed
    if (!l) { out[p] = await i.blob(r); continue } // deleted here, edited there: keep the edit
    if (!r) { out[p] = i.local[p]; continue } // edited here, deleted there: keep the edit
    const remote = await i.blob(r)
    const a = JSON.parse(i.local[p]), z = JSON.parse(remote)
    if (p === 'book.json') {
      const orders = Object.fromEntries(ORDERS.map((k) => [k, [...(a[k] ?? []), ...(z[k] ?? []).filter((x: string) => !(a[k] ?? []).includes(x))]]))
      out[p] = JSON.stringify({ ...z, ...a, ...orders }, null, 2)
    } else if (p === 'config.json') {
      out[p] = JSON.stringify({ ...z, ...a, types: { ...z.types, ...a.types } }, null, 2)
    } else if (p === 'stats.json') {
      const days: Record<string, number> = { ...z.days }
      for (const [d, n] of Object.entries<number>(a.days)) days[d] = Math.max(n, days[d] ?? 0)
      out[p] = JSON.stringify({ goal: a.goal, days }, null, 2)
    } else {
      // Same item edited on both devices: keep mine, keep theirs as a copy so nothing is lost.
      const dir = p.split('/')[0]
      out[p] = i.local[p]
      z.id = i.newId()
      z[labelField(dir)] = `${z[labelField(dir)]} (other device)`
      out[`${dir}/${z.id}.json`] = JSON.stringify(z, null, 2)
      conflicts++
    }
  }

  // Import items from the old single-file layout.
  for (const p of LEGACY) {
    if (!i.remote[p]) continue
    const dir = p.replace('.json', '')
    for (const it of JSON.parse(await i.blob(i.remote[p]))) out[`${dir}/${it.id}.json`] ??= JSON.stringify(it, null, 2)
  }
  return { out, conflicts }
}
