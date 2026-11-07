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
const ORDERS = ['chapterOrder', 'sceneOrder', 'ideaOrder', 'threadOrder', 'planOrder']
const FIELDWISE = ['events', 'periods', 'plan', 'threads'] // small items: merge field by field instead of saving a copy
const labelField = (dir: string) => (dir === 'chapters' || dir === 'scenes' || dir === 'events' || dir === 'periods' || dir === 'plan' ? 'title' : dir === 'ideas' ? 'text' : 'name')

type Obj = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)

/** Field by field: what I changed since base wins, otherwise take theirs. */
const pick = (b: Obj | undefined, m: Obj, t: Obj): Obj => {
  const o: Obj = {}
  for (const k of new Set([...Object.keys(t), ...Object.keys(m)])) {
    const v = same(m[k], b?.[k]) ? t[k] : m[k]
    if (v !== undefined) o[k] = v
  }
  return o
}

/** Three-way merge of id-keyed lists: edits to different items combine; an item changed on both sides is merged by `item`. */
function mergeList(base: Obj[], mine: Obj[], theirs: Obj[], item = pick): Obj[] {
  const B = new Map(base.map((x) => [x.id, x])), T = new Map(theirs.map((x) => [x.id, x])), M = new Map(mine.map((x) => [x.id, x]))
  const out: Obj[] = []
  for (const m of mine) {
    const b = B.get(m.id), t = T.get(m.id)
    if (!t) { if (!(b && same(b, m))) out.push(m); continue } // deleted there: gone unless I edited it (or it is new here)
    out.push(same(m, t) ? m : b && same(m, b) ? t : b && same(t, b) ? m : item(b, m, t))
  }
  for (const t of theirs) if (!M.has(t.id) && !(B.has(t.id) && same(B.get(t.id), t))) out.push(t) // new there, or edited there but deleted here
  return out
}

/** Worlds merge per op, layer and layer item, so two devices editing different features never clobber each other. */
export function mergeWorld(base: Obj | undefined, mine: Obj, theirs: Obj): Obj {
  const o: Obj = { ...pick(base, mine, theirs), params: pick(base?.params, mine.params ?? {}, theirs.params ?? {}) }
  const layer = (b: Obj | undefined, m: Obj, t: Obj) => ({ ...pick(b, m, t), items: mergeList(b?.items ?? [], m.items ?? [], t.items ?? []) })
  const ops = mergeList(base?.ops ?? [], mine.ops ?? [], theirs.ops ?? [])
  const layers = mergeList(base?.layers ?? [], mine.layers ?? [], theirs.layers ?? [], layer)
  if (ops.length || mine.ops || theirs.ops) o.ops = ops
  if (layers.length || mine.layers || theirs.layers) o.layers = layers
  return o
}

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
    } else if (p.startsWith('worlds/')) {
      let base: Obj | undefined
      try { base = b ? JSON.parse(await i.blob(b)) : undefined } catch { /* base no longer fetchable: merge without it */ }
      out[p] = JSON.stringify(mergeWorld(base, a, z), null, 2)
    } else if (FIELDWISE.includes(p.split('/')[0])) {
      // Same small item edited on both sides: what I changed wins field by field, the rest comes from theirs. No copies.
      let base: Obj | undefined
      try { base = b ? JSON.parse(await i.blob(b)) : undefined } catch { /* base no longer fetchable: mine wins on every field that differs */ }
      out[p] = JSON.stringify(pick(base, a, z), null, 2)
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
