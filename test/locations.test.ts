import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCity, terrainOf, TREE, TSTRIDE, validate, type LocationDoc } from '../src/locations/city.ts'
import { PART, PSTRIDE, ROOF_PARTS } from '../src/locations/buildings.ts'
import { RoadIndex, planRoads } from '../src/locations/roads.ts'
import { MATS } from '../src/locations/kit.ts'
import { pathNear, pathNearFast, resample, type XY } from '../src/locations/terrain.ts'
import { carveRiver, makeLake } from '../src/locations/hydro.ts'
import { rng } from '../src/world/noise.ts'

// the showcase is the example the page opens with: it must stay clean
const show: LocationDoc = JSON.parse(readFileSync(new URL('../examples/showcase.json', import.meta.url), 'utf8'))
assert.deepEqual(validate(show), { errors: [], warnings: [] }, 'the showcase validates cleanly')
assert.ok(show.views!.length >= 10, 'the showcase has a tour')
assert.ok(validate({ ...show, structures: [{ id: 'x', kind: 'bridge', at: [0, 0] }] }).errors.length, 'a bridge needs to')
assert.ok(validate({ ...show, terrain: [{ id: 'x', kind: 'peak', at: [0, 0] }] }).errors.length, 'a peak needs a height')
assert.ok(validate({ ...show, culture: 'martian' as never }).errors.length, 'unknown culture')
assert.ok(validate({ ...show, terrain: [{ id: 'x', kind: 'fields', at: [0, 0], crop: 'rice-cakes' as never }] }).errors.length, 'unknown crop')
assert.ok(validate({ ...show, sea: undefined, terrain: [{ id: 'x', kind: 'coast', path: [[0, 0], [9, 9]] }] }).errors.length, 'a coast needs a sea level')
assert.ok(!validate({ ...show, terrain: [{ id: 'x', name: 'X', kind: 'river', path: [[0, 0], [0, -9000]] }] }).warnings.some((w) => w.includes('outside')), 'a river may run off the map')

// every uniform a material's shader code uses is declared for it (a missing one blanks the whole ground)
{
  const sh = await import('../src/locations/shaders.ts')
  const declared = (src: string) => new Set([...src.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]))
  for (const [name, code, head] of [['terrain', sh.TERRAIN + sh.TERRAIN_POST, sh.TERRAIN_FH], ['walls', sh.WALL, sh.WALL_FH], ['roofs', sh.ROOF, sh.ROOF_FH], ['trees', sh.TREE, sh.TREE_FH], ['rock', sh.ROCK + sh.ROCK_POST, '']] as const) {
    const have = declared(sh.HEAD + head)
    for (const [, u] of code.matchAll(/\b([tu][A-Z]\w*)\b/g)) assert.ok(have.has(u), `${name} shader uses ${u} without declaring it`)
  }
}

// the line index answers like a brute-force search, near and far
{
  const R = rng(5), line: XY[] = resample(Array.from({ length: 30 }, (_, i) => [i * 300 - 4500, Math.sin(i * 0.7) * 900] as XY), 7)
  for (let k = 0; k < 400; k++) {
    const x = (R() - 0.5) * 12000, y = (R() - 0.5) * 12000, a = pathNear(line, x, y), b = pathNearFast(line, x, y, Infinity)
    assert.ok(Math.abs(a.d - b.d) < 0.5 && (a.d < 1 || a.side === b.side), `nearest point on a long line (${a.d.toFixed(2)} vs ${b.d.toFixed(2)})`)
  }
}

// small and fast: a peak with a glacier, a coast, a lake, a river to the sea, farmland, one town per culture, every structure kind
const small: LocationDoc = {
  id: 's', name: 'S', seed: 'small', size: 3000, sea: 0,
  terrain: [
    { id: 'p', kind: 'peak', at: [0, 900], height: 1600, radius: 1100 },
    { id: 'g', kind: 'glacier', path: [[0, 1450], [150, 1000]], width: 120, height: 900 },
    { id: 'c', kind: 'coast', path: [[-1600, -1150], [0, -1250], [1600, -1150]], style: 'cliffs', height: 45 },
    { id: 'l', kind: 'lake', at: [950, -350], radius: 150 },
    { id: 'rv', kind: 'river', path: [[-1400, 1300], [-900, 600], [-1000, -1450]] },
    { id: 'v', kind: 'fields', at: [-650, -350], radius: 220, crop: 'vines' },
    { id: 'o', kind: 'fields', at: [550, 250], radius: 160, crop: 'orchard' },
    { id: 'st', kind: 'stack', at: [400, -1350], height: 30, radius: 12 },
  ],
  districts: [
    { id: 'd', at: [0, -300], radius: 380, culture: 'central', walls: true },
    { id: 'e', at: [-450, 450], radius: 250, culture: 'eastern' },
    { id: 'm', at: [700, 650], radius: 220, culture: 'mountain' },
    { id: 'med', at: [450, -850], radius: 220, culture: 'mediterranean' },
  ],
  structures: [{ id: 'c1', kind: 'cathedral', at: [0, 300], scale: 1 }, { id: 'b', kind: 'basilica', at: [-500, 0], scale: 0.5 }, { id: 'col', kind: 'colonnade', at: [500, 0], radius: 60 }, { id: 'dm', kind: 'dome', at: [-150, -650], scale: 0.5 }, { id: 't', kind: 'tower', at: [300, 500] }, { id: 'q', kind: 'plaza', at: [-300, 500] }, { id: 'u', kind: 'statue', at: [-600, -600] }, { id: 'r', kind: 'bridge', at: [-1200, -300], to: [-700, -350] }, { id: 'a', kind: 'aqueduct', path: [[600, -600], [1200, 0]] },
    { id: 'pa', kind: 'palace', at: [600, 600] }, { id: 'mo', kind: 'monastery', at: [-700, 900] }, { id: 'w', kind: 'wall', path: [[-400, -150], [-150, -450], [300, -420]] }, { id: 'h', kind: 'harbour', at: [300, -1150], facing: 180 }, { id: 'rd', kind: 'road', path: [[-1300, 0], [-200, -200]] }, { id: 'cn', kind: 'canal', path: [[-150, 150], [150, -150]], width: 10 }, { id: 'ch', kind: 'church', at: [-250, -150], culture: 'mediterranean' }],
}
assert.deepEqual(validate(small).errors, [])
const a = buildCity(small), b = buildCity(small)
assert.deepEqual(a.heights, b.heights, 'deterministic ground')
assert.deepEqual(a.parts, b.parts, 'deterministic buildings')
assert.ok(a.counts.buildings > 400, `towns fill with buildings (${a.counts.buildings})`)
for (const m of MATS) assert.ok(a.geo[m].pos.every(Number.isFinite) && a.geo[m].nor.every(Number.isFinite), `${m} has no NaN`)
assert.ok(a.parts.every(Number.isFinite), 'parts have no NaN')
assert.ok(a.geo.stone.pos.length > 100000, 'structures are detailed')
assert.ok(a.geo.rock.pos.length > 3000, 'the cliffs and the stack are real rock')
assert.ok(a.audit.length > 5 && a.audit.every((l) => /^(ok|warn|bad) /.test(l)), 'the realism audit runs')
assert.ok(!a.audit.some((l) => l.startsWith('bad')), `nothing is badly wrong:\n${a.audit.filter((l) => !l.startsWith('ok')).join('\n')}`)

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
assert.ok(avg(ws.slice(-200)) > avg(ws.slice(0, 200)) + 0.2, 'the high town is wealthier')

// structures flatten their ground; houses keep out of them and out of the sea
const T = terrainOf(small)
assert.ok(Math.abs(T.h(0, 300) - T.flats.find((f) => f.id === 'c1')!.level) < 0.01)
for (const o of walls) {
  const x = a.parts[o + 1], y = -a.parts[o + 3]
  assert.ok(Math.hypot(x, y - 300) > 42, 'no house inside the cathedral')
  assert.ok(a.parts[o + 11] > 0.4, 'no house in the sea')
}
// the coast: cliffs as rock walls, a stack offshore, the sea below sea level
assert.ok(T.walls.some((w) => w.sea), 'the coast has sea cliffs')
assert.ok(T.rocks.some((r) => r.kind === 'stack'), 'there are sea stacks')
assert.ok(a.sea === 0 && a.minH < -10, 'the sea is deep')
let ice = 0
for (let k = 0; k < a.surf.length; k += 4) if (a.surf[k] > 128) ice++
assert.ok(ice > 30, `the glacier is ice (${ice} cells)`)
let orchard = 0
for (let k = 4; k < a.trees.length; k += TSTRIDE) if (a.trees[k] === TREE.orchard) orchard++
assert.ok(orchard > 20, `orchards are planted (${orchard})`)
assert.ok(a.fields.tex.some((v, i) => i % 4 === 3 && v > 0), 'fields are drawn')

// rivers never run uphill; lakes take the shape of the land
{
  const N = 256, size = 3000, c = size / N, w = N + 1, heights = new Float32Array(w * w)
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) heights[j * w + i] = T.h(-size / 2 + i * c, size / 2 - j * c)
  const g = { N, size, heights }, rv = carveRiver(g, { id: 'r', way: [[-1400, 1300], [-900, 600], [-1000, -1450]], width: 20, depth: 3, meander: 1, follow: true }, 0, () => null, 1)
  assert.ok(rv.prof.every((v, i) => !i || v <= rv.prof[i - 1] + 1e-9), 'the river only goes down')
  assert.ok(rv.prof[rv.prof.length - 1] <= 0.01, 'the river reaches the sea')
  const L = makeLake(g, 'l', [[950, -350]], 150, 20, undefined, 2)!
  assert.ok(L && L.cells.length > 20, 'a lake fills its basin')
  for (const k of L.cells) assert.ok(heights[k] < L.level, 'the lake floor is under the water')
}

// streets: main roads between town squares, each town's own streets; walls get gates where roads cross
assert.ok(a.counts.roads > 20, `streets (${a.counts.roads})`)
assert.ok(a.geo.road.pos.length > 0 && a.lamps.length > 0 && a.chimneys.length > 0 && a.trees.length > 0)
const roads = planRoads({ grid: { N: a.N, size: a.size, heights: a.heights }, seed: 1, hubs: [{ x: -1000, z: 0 }, { x: 1000, z: 0 }], links: [], force: [], blocked: () => false, districts: [] })
assert.ok(roads.length === 1 && roads[0].kind === 'main', 'two hubs, one main road')
for (let k = 1; k < roads[0].pts.length; k++) { const p = roads[0].pts[k - 1], q = roads[0].pts[k]; assert.ok(Math.abs(q[1] - p[1]) / Math.hypot(q[0] - p[0], q[2] - p[2]) < 0.4, 'main roads keep to walkable grades') }
const idx = new RoadIndex(15, 30)
idx.add(roads[0], 0)
assert.ok(idx.near(roads[0].pts[3][0], roads[0].pts[3][2]).d < 0, 'a point on the road is on the road')
console.log('locations ok')
