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

// legacy ideas.json is split into per-item files
r = await run({}, { 'ideas.json': '[{"id":"i1","text":"hi"}]' }, {})
assert.ok(r.out['ideas/i1.json'] && !('ideas.json' in r.out))

console.log('merge: all checks passed')
