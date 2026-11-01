import assert from 'node:assert/strict'
import { DEFAULT_CAL } from '../src/calendar.ts'
import { lanes, layout } from '../src/timelineScale.ts'

const ev = (id: string, kind: 'party' | 'world', y: number, m = 1, d = 1) => ({ id, kind, date: { y, m, d } })
const c = DEFAULT_CAL

// order follows dates, gaps shrink with log scale
const { coord, max } = layout(c, [ev('b', 'party', 300), ev('a', 'party', 1), ev('w', 'world', 150)], [])
assert.ok(coord.a < coord.w && coord.w < coord.b)
assert.ok(coord.b - coord.w < 5 * 1 + 10) // 150 years apart stays within a few units, not hundreds
assert.equal(max, coord.b)

// same-side events are at least a unit apart; opposite sides may share a spot
const same = layout(c, [ev('p1', 'party', 1, 1, 1), ev('p2', 'party', 1, 1, 2), ev('w1', 'world', 1, 1, 1)], [])
assert.ok(same.coord.p2 - same.coord.p1 >= 1)
assert.ok(Math.abs(same.coord.w1 - same.coord.p1) < 1)

// period tied to an event snaps onto the card
const p = { id: 'x', start: { y: 1 }, end: { y: 2 }, startEvent: 'p2' }
const t = layout(c, [ev('p1', 'party', 1), ev('p2', 'party', 1, 5, 5)], [p])
assert.equal(t.coord['x:start'], t.coord.p2)

// overlapping periods take separate lanes; a later one reuses lane 0
const per = [
  { id: 'a', start: { y: 1 }, end: { y: 10 } },
  { id: 'b', start: { y: 5 }, end: { y: 8 } },
  { id: 'c', start: { y: 20 }, end: { y: 30 } },
]
const l = layout(c, [], per)
const ln = lanes(l.coord, per)
assert.deepEqual([ln.lane.a, ln.lane.b, ln.lane.c], [0, 1, 0])
assert.equal(ln.count, 2)
console.log('timelineScale: all checks passed')
