import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BSTRIDE, buildCity, terrainOf, validate, type LocationDoc } from '../src/locations/city.ts'
import { RoadIndex, planRoads } from '../src/locations/roads.ts'
import { MATS } from '../src/locations/kit.ts'

const doc: LocationDoc = JSON.parse(readFileSync(new URL('../examples/location-test.json', import.meta.url), 'utf8'))
assert.deepEqual(validate(doc).errors, [])
assert.deepEqual(validate(doc).warnings.filter((w) => !w.includes('give it a name')), [], 'the test range has no real warnings')
assert.ok(validate({ ...doc, structures: [{ id: 'x', kind: 'bridge', at: [0, 0] }] }).errors.length, 'a bridge needs to')
assert.ok(validate({ ...doc, terrain: [{ id: 'x', kind: 'peak', at: [0, 0] }] }).errors.length, 'a peak needs a height')

// small and fast: one peak, one district, every structure kind
const small: LocationDoc = {
  id: 's', name: 'S', seed: 'small', size: 3000, terrain: [{ id: 'p', kind: 'peak', at: [0, 0], height: 1600, radius: 1200 }, { id: 'l', kind: 'lake', at: [900, -900], radius: 150 }, { id: 'rv', kind: 'river', path: [[-1400, 1300], [-900, 600], [-1300, -1400]] }],
  districts: [{ id: 'd', at: [0, 0], radius: 900 }],
  structures: [{ id: 'c', kind: 'cathedral', at: [0, 300], scale: 1 }, { id: 'b', kind: 'basilica', at: [-500, 0], scale: 0.5 }, { id: 'o', kind: 'colonnade', at: [500, 0], radius: 60 }, { id: 'm', kind: 'dome', at: [0, -500], scale: 0.5 }, { id: 't', kind: 'tower', at: [300, 500] }, { id: 'q', kind: 'plaza', at: [-300, 500] }, { id: 'u', kind: 'statue', at: [-600, -600] }, { id: 'r', kind: 'bridge', at: [-1200, -1200], to: [-200, -1100] }, { id: 'a', kind: 'aqueduct', path: [[600, -600], [1200, 0]] },
    { id: 'pa', kind: 'palace', at: [600, 600] }, { id: 'mo', kind: 'monastery', at: [-700, 900] }, { id: 'w', kind: 'wall', path: [[-1000, -300], [-400, -900], [400, -1000]] }, { id: 'h', kind: 'harbour', at: [750, -900], facing: 120 }, { id: 'rd', kind: 'road', path: [[-1300, 0], [-200, -200]] }],
}
const a = buildCity(small), b = buildCity(small)
assert.deepEqual(a.heights, b.heights, 'deterministic ground')
assert.deepEqual(a.buildings, b.buildings, 'deterministic buildings')
assert.ok(a.counts.buildings > 500, `a district fills with buildings (${a.counts.buildings})`)
for (const m of MATS) assert.ok(a.geo[m].pos.every(Number.isFinite) && a.geo[m].nor.every(Number.isFinite), `${m} has no NaN`)
assert.ok(a.geo.stone.pos.length > 100000, 'structures are detailed')

// wealth follows altitude: buildings high up are richer than low ones
const ws: [number, number][] = []
for (let k = 0; k < a.buildings.length; k += BSTRIDE) ws.push([a.buildings[k + 7], a.buildings[k + 11]])
ws.sort((p, q) => p[0] - q[0])
const avg = (l: [number, number][]) => l.reduce((s, p) => s + p[1], 0) / l.length
assert.ok(avg(ws.slice(-200)) > avg(ws.slice(0, 200)) + 0.4, 'the high town is wealthier')

// structures flatten their ground; buildings keep out of them and out of the lake
const T = terrainOf(small)
assert.ok(Math.abs(T.h(0, 300) - T.flats.find((f) => f.id === 'c')!.level) < 0.01)
for (let k = 0; k < a.buildings.length; k += BSTRIDE) {
  const x = a.buildings[k], y = -a.buildings[k + 2]
  assert.ok(Math.hypot(x, y - 300) > 42, 'no house inside the cathedral')
  assert.ok(T.water(x, y) == null, 'no house in the lake')
}
// rivers never run uphill, and fall over the steep bits
const rv = T.rivers[0]
assert.ok(rv.prof.every((v, i) => !i || v <= rv.prof[i - 1] + 1e-9), 'the river only goes down')
assert.ok(a.rivers.pos.length > 0, 'the river is drawn')
// streets: main roads, contour lanes and stairs; no house on a street; walls get gates where roads cross
assert.ok(a.counts.roads > 20, `streets (${a.counts.roads})`)
assert.ok(a.geo.road.pos.length > 0 && a.lamps.length > 0 && a.chimneys.length > 0 && a.trees.length > 0)
const roads = planRoads({ grid: { N: a.N, size: a.size, heights: a.heights }, seed: 1, hubs: [{ x: -1000, z: 0 }, { x: 1000, z: 0 }], links: [], force: [], blocked: () => false, districts: [] })
assert.ok(roads.length === 1 && roads[0].kind === 'main', 'two hubs, one main road')
for (let k = 1; k < roads[0].pts.length; k++) { const p = roads[0].pts[k - 1], q = roads[0].pts[k]; assert.ok(Math.abs(q[1] - p[1]) / Math.hypot(q[0] - p[0], q[2] - p[2]) < 0.4, 'main roads keep to walkable grades') }
const idx = new RoadIndex(15, 30)
idx.add(roads[0], 0)
assert.ok(idx.near(roads[0].pts[3][0], roads[0].pts[3][2]).d < 0, 'a point on the road is on the road')
console.log('locations ok')
