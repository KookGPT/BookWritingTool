import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCity, terrainOf, TREE, TSTRIDE, validate, type LocationDoc } from '../src/locations/city.ts'
import { PART, PSTRIDE, ROOF_PARTS } from '../src/locations/buildings.ts'
import { RoadIndex, planRoads } from '../src/locations/roads.ts'
import { MATS } from '../src/locations/kit.ts'

// the showcase is the example the page opens with: it must stay clean
const show: LocationDoc = JSON.parse(readFileSync(new URL('../examples/showcase.json', import.meta.url), 'utf8'))
assert.deepEqual(validate(show), { errors: [], warnings: [] }, 'the showcase validates cleanly')
assert.ok(show.views!.length >= 10, 'the showcase has a tour')
assert.ok(validate({ ...show, structures: [{ id: 'x', kind: 'bridge', at: [0, 0] }] }).errors.length, 'a bridge needs to')
assert.ok(validate({ ...show, terrain: [{ id: 'x', kind: 'peak', at: [0, 0] }] }).errors.length, 'a peak needs a height')
assert.ok(validate({ ...show, culture: 'martian' as never }).errors.length, 'unknown culture')
assert.ok(validate({ ...show, terrain: [{ id: 'x', kind: 'fields', at: [0, 0], crop: 'rice' as never }] }).errors.length, 'unknown crop')
assert.ok(!validate({ ...show, terrain: [{ id: 'x', name: 'X', kind: 'river', path: [[0, 0], [0, -9000]] }] }).warnings.some((w) => w.includes('outside')), 'a river may run off the map')

// small and fast: a peak with a glacier, a lake, a river to the sea, farmland, one district per culture, every structure kind
const small: LocationDoc = {
  id: 's', name: 'S', seed: 'small', size: 3000, sea: 0,
  terrain: [
    { id: 'p', kind: 'peak', at: [0, 700], height: 1600, radius: 1100 },
    { id: 'g', kind: 'glacier', path: [[0, 1450], [150, 1000]], width: 120, height: 900 },
    { id: 'bay', kind: 'valley', path: [[-1500, -1350], [1500, -1350]], height: -20, width: 500, edge: 150 },
    { id: 'l', kind: 'lake', at: [950, -350], radius: 150 },
    { id: 'rv', kind: 'river', path: [[-1400, 1300], [-900, 600], [-1000, -1450]] },
    { id: 'v', kind: 'fields', at: [-650, -350], radius: 220, crop: 'vines' },
    { id: 'o', kind: 'fields', at: [550, 250], radius: 160, crop: 'orchard' },
  ],
  districts: [
    { id: 'd', at: [0, 0], radius: 380, culture: 'central' },
    { id: 'e', at: [-450, 600], radius: 250, culture: 'eastern' },
    { id: 'm', at: [700, 750], radius: 250, culture: 'mountain' },
    { id: 'med', at: [450, -850], radius: 280, culture: 'mediterranean' },
  ],
  structures: [{ id: 'c', kind: 'cathedral', at: [0, 300], scale: 1 }, { id: 'b', kind: 'basilica', at: [-500, 0], scale: 0.5 }, { id: 'col', kind: 'colonnade', at: [500, 0], radius: 60 }, { id: 'dm', kind: 'dome', at: [0, -500], scale: 0.5 }, { id: 't', kind: 'tower', at: [300, 500] }, { id: 'q', kind: 'plaza', at: [-300, 500] }, { id: 'u', kind: 'statue', at: [-600, -600] }, { id: 'r', kind: 'bridge', at: [-1200, -300], to: [-700, -350] }, { id: 'a', kind: 'aqueduct', path: [[600, -600], [1200, 0]] },
    { id: 'pa', kind: 'palace', at: [600, 600] }, { id: 'mo', kind: 'monastery', at: [-700, 900] }, { id: 'w', kind: 'wall', path: [[-400, -150], [-150, -450], [300, -420]] }, { id: 'h', kind: 'harbour', at: [300, -1200], facing: 180 }, { id: 'rd', kind: 'road', path: [[-1300, 0], [-200, -200]] }, { id: 'cn', kind: 'canal', path: [[-150, 150], [150, -150]], width: 10 }],
}
assert.deepEqual(validate(small).errors, [])
const a = buildCity(small), b = buildCity(small)
assert.deepEqual(a.heights, b.heights, 'deterministic ground')
assert.deepEqual(a.parts, b.parts, 'deterministic buildings')
assert.ok(a.counts.buildings > 500, `districts fill with buildings (${a.counts.buildings})`)
for (const m of MATS) assert.ok(a.geo[m].pos.every(Number.isFinite) && a.geo[m].nor.every(Number.isFinite), `${m} has no NaN`)
assert.ok(a.parts.every(Number.isFinite), 'parts have no NaN')
assert.ok(a.geo.stone.pos.length > 100000, 'structures are detailed')

// every part of every house: walls carry ground, floor height, wealth, seed, material, window
const walls: number[] = [], types = new Set<number>(), mats = new Set<number>(), wins = new Set<number>()
for (let o = 0; o < a.parts.length; o += PSTRIDE) {
  types.add(a.parts[o])
  if (a.parts[o] === PART.wall) { walls.push(o); mats.add(a.parts[o + 15]); wins.add(a.parts[o + 16]) }
}
assert.ok([...types].filter((t) => ROOF_PARTS.has(t)).length >= 5, `many roof shapes (${[...types].filter((t) => ROOF_PARTS.has(t))})`)
assert.ok(mats.size >= 5 && wins.size >= 4, `four cultures give many wall materials (${[...mats]}) and window styles (${[...wins]})`)
assert.ok(types.has(PART.vine), 'vineyards are planted')
assert.ok(types.has(PART.chimney) && types.has(PART.dome), 'chimneys and domes')

// wealth follows altitude: houses high up are richer than low ones
const ws = walls.map((o) => [a.parts[o + 11], a.parts[o + 13]]).sort((p, q) => p[0] - q[0])
const avg = (l: number[][]) => l.reduce((s, p) => s + p[1], 0) / l.length
assert.ok(avg(ws.slice(-200)) > avg(ws.slice(0, 200)) + 0.3, 'the high town is wealthier')

// structures flatten their ground; houses keep out of them and out of the water
const T = terrainOf(small)
assert.ok(Math.abs(T.h(0, 300) - T.flats.find((f) => f.id === 'c')!.level) < 0.01)
for (const o of walls) {
  const x = a.parts[o + 1], y = -a.parts[o + 3]
  assert.ok(Math.hypot(x, y - 300) > 42, 'no house inside the cathedral')
  const wl = T.water(x, y)
  assert.ok(wl == null || wl === small.sea, 'no house in a lake or river') // the shore is checked on the final ground below
  assert.ok(a.parts[o + 11] > 0.5, 'no house in the sea')
}
// rivers never run uphill; lakes, rivers and the sea are drawn; the glacier is ice
const rv = T.rivers[0]
assert.ok(rv.prof.every((v, i) => !i || v <= rv.prof[i - 1] + 1e-9), 'the river only goes down')
assert.ok(a.rivers.pos.length > 0 && a.water.length > 0, 'river ribbons and lake surfaces')
assert.ok(a.sea === 0 && a.minH < 0, 'the bay is below sea level')
let ice = 0
for (let k = 0; k < a.surf.length; k += 4) if (a.surf[k] > 128) ice++
assert.ok(ice > 50, `the glacier is ice (${ice} cells)`)
let orchard = 0
for (let k = 4; k < a.trees.length; k += TSTRIDE) if (a.trees[k] === TREE.orchard) orchard++
assert.ok(orchard > 20, `orchards are planted (${orchard})`)

// streets: main roads, contour lanes and stairs; walls get gates where roads cross
assert.ok(a.counts.roads > 20, `streets (${a.counts.roads})`)
assert.ok(a.geo.road.pos.length > 0 && a.lamps.length > 0 && a.chimneys.length > 0 && a.trees.length > 0)
const roads = planRoads({ grid: { N: a.N, size: a.size, heights: a.heights }, seed: 1, hubs: [{ x: -1000, z: 0 }, { x: 1000, z: 0 }], links: [], force: [], blocked: () => false, districts: [] })
assert.ok(roads.length === 1 && roads[0].kind === 'main', 'two hubs, one main road')
for (let k = 1; k < roads[0].pts.length; k++) { const p = roads[0].pts[k - 1], q = roads[0].pts[k]; assert.ok(Math.abs(q[1] - p[1]) / Math.hypot(q[0] - p[0], q[2] - p[2]) < 0.4, 'main roads keep to walkable grades') }
const idx = new RoadIndex(15, 30)
idx.add(roads[0], 0)
assert.ok(idx.near(roads[0].pts[3][0], roads[0].pts[3][2]).d < 0, 'a point on the road is on the road')
console.log('locations ok')
