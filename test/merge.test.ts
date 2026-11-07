import assert from 'node:assert/strict'
import { merge } from '../src/merge.ts'

const blobs: Record<string, string> = {}
const run = (local: Record<string, string>, remote: Record<string, string>, base: Record<string, string>) => {
  let n = 0
  return merge({
    local,
    lsha: Object.fromEntries(Object.entries(local).map(([p, c]) => [p, 's:' + c])),
    remote: Object.fromEntries(Object.entries(remote).map(([p, c]) => { blobs['s:' + c] = c; return [p, 's:' + c] })),
    base: Object.fromEntries(Object.entries(base).map(([p, c]) => [p, 's:' + c])),
    blob: async (sha) => blobs[sha],
    newId: () => 'new' + n++,
  })
}
const ch = (t: string) => JSON.stringify({ id: 'a', title: t })

// only local changed -> local wins
let r = await run({ 'chapters/a.json': ch('mine') }, { 'chapters/a.json': ch('old') }, { 'chapters/a.json': ch('old') })
assert.equal(r.out['chapters/a.json'], ch('mine'))

// only remote changed -> remote wins
r = await run({ 'chapters/a.json': ch('old') }, { 'chapters/a.json': ch('theirs') }, { 'chapters/a.json': ch('old') })
assert.equal(r.out['chapters/a.json'], ch('theirs'))

// both changed -> mine kept, theirs saved as a copy
r = await run({ 'chapters/a.json': ch('mine') }, { 'chapters/a.json': ch('theirs') }, { 'chapters/a.json': ch('old') })
assert.equal(r.conflicts, 1)
assert.equal(r.out['chapters/a.json'], ch('mine'))
assert.match(r.out['chapters/new0.json'], /theirs \(other device\)/)

// deleted locally, untouched remotely -> stays deleted
r = await run({}, { 'chapters/a.json': ch('old') }, { 'chapters/a.json': ch('old') })
assert.equal(Object.keys(r.out).length, 0)

// new on remote -> pulled
r = await run({}, { 'wiki/x.json': '{"id":"x","name":"Aria"}' }, {})
assert.ok(r.out['wiki/x.json'])

// stats merge takes the max per day
const st = (d: object) => JSON.stringify({ goal: 500, days: d })
r = await run({ 'stats.json': st({ d1: 100, d2: 5 }) }, { 'stats.json': st({ d1: 50, d3: 70 }) }, { 'stats.json': st({}) })
assert.deepEqual(JSON.parse(r.out['stats.json']).days, { d1: 100, d2: 5, d3: 70 })

// config merge unions custom types, mine wins on a clash
const cf = (t: object) => JSON.stringify({ types: t })
r = await run({ 'config.json': cf({ rune: ['a'] }) }, { 'config.json': cf({ rune: ['b'], clan: ['c'] }) }, { 'config.json': cf({}) })
assert.deepEqual(JSON.parse(r.out['config.json']).types, { rune: ['a'], clan: ['c'] })

// legacy ideas.json is split into per-item files
r = await run({}, { 'ideas.json': '[{"id":"i1","text":"hi"}]' }, {})
assert.ok(r.out['ideas/i1.json'] && !('ideas.json' in r.out))

console.log('merge: all checks passed')

// worlds merge per op / layer / layer item
{
  const { mergeWorld } = await import('../src/merge.ts')
  const base = { id: 'w', name: 'W', seed: 's', params: { oceanPct: 60, plates: 14 }, ops: [{ id: 'a', kind: 'lake', name: 'Old', at: [1, 1], radius: 5 }, { id: 'd', kind: 'lake', at: [2, 2], radius: 5 }],
    layers: [{ id: 'L', name: 'Cities', kind: 'cities', items: [{ id: 'c1', name: 'One', at: [1, 1] }, { id: 'c2', name: 'Two', at: [2, 2] }] }] }
  const mine = structuredClone(base) as typeof base, theirs = structuredClone(base) as typeof base
  mine.ops[0].name = 'Mine'; mine.ops.push({ id: 'm', kind: 'lake', at: [3, 3], radius: 5 } as never); mine.params.oceanPct = 70
  mine.layers[0].items[0].name = 'One!'
  theirs.ops = theirs.ops.filter((o) => o.id !== 'd') // they deleted d
  theirs.ops.push({ id: 't', kind: 'lake', at: [4, 4], radius: 5 } as never)
  theirs.params.plates = 20; theirs.name = 'Renamed'
  theirs.layers[0].items[1].name = 'Two!'; theirs.layers[0].items.push({ id: 'c3', name: 'Three', at: [3, 3] })
  ;(theirs.layers[0] as Record<string, unknown>).color = '#ff0000'
  const m = mergeWorld(base, mine, theirs) as typeof base
  assert.deepEqual(m.ops.map((o) => o.id), ['a', 'm', 't']) // d deleted by them, untouched by me
  assert.equal(m.ops[0].name, 'Mine')
  assert.deepEqual(m.params, { oceanPct: 70, plates: 20 })
  assert.equal(m.name, 'Renamed')
  assert.deepEqual(m.layers[0].items.map((i) => i.name), ['One!', 'Two!', 'Three'])
  assert.equal((m.layers[0] as Record<string, unknown>).color, '#ff0000')
  // same field edited on both sides: mine wins; an edit beats a delete
  mine.ops[0].name = 'Mine'; theirs.ops = [{ ...theirs.ops[0], name: 'Theirs' } as never]
  const m2 = mergeWorld(base, mine, theirs) as typeof base
  assert.equal(m2.ops.find((o) => o.id === 'a')!.name, 'Mine')
  const m3 = mergeWorld(base, { ...base, ops: [{ ...base.ops[1], radius: 9 }] }, { ...base, ops: [] }) as typeof base
  assert.deepEqual(m3.ops.map((o) => o.id), ['d'])
  // end to end through merge(): both devices changed the same world file
  const f = (w: unknown) => JSON.stringify(w), key = 'worlds/w.json'
  blobs['s:' + f(base)] = f(base)
  r = await run({ [key]: f(mine) }, { [key]: f(theirs) }, { [key]: f(base) })
  assert.deepEqual(JSON.parse(r.out[key]).ops.map((o: { id: string }) => o.id), ['a', 'm']) // theirs deleted d, mine added m
  assert.equal(r.conflicts, 0)
  assert.ok(!Object.keys(r.out).some((p) => p.includes('new')))
}

// Timeline items edited on both sides merge field by field: no "(other device)" copies.
{
  const ev = (o: object) => JSON.stringify({ id: 'e', title: 'T', summary: '', date: { y: 1 }, ...o })
  const key = 'events/e.json'
  blobs['s:' + ev({})] = ev({})
  let r2 = await run({ [key]: ev({ title: 'Mine' }) }, { [key]: ev({ summary: 'Theirs' }) }, { [key]: ev({}) })
  assert.equal(r2.conflicts, 0)
  assert.deepEqual(Object.keys(r2.out), [key])
  assert.deepEqual({ t: JSON.parse(r2.out[key]).title, s: JSON.parse(r2.out[key]).summary }, { t: 'Mine', s: 'Theirs' })
  // the same field changed on both sides: mine wins, still no copy
  r2 = await run({ [key]: ev({ title: 'Mine' }) }, { [key]: ev({ title: 'Theirs' }) }, { [key]: ev({}) })
  assert.equal(JSON.parse(r2.out[key]).title, 'Mine')
  assert.deepEqual(Object.keys(r2.out), [key])
}
