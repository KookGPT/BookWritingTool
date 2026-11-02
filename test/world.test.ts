import assert from 'node:assert/strict'
import { DEFAULT_PARAMS, makePlanet, toDir, toLatLon, type World } from '../src/world/terrain.ts'
import { buildTile, faceDir, SEG, tileIndex } from '../src/world/tile.ts'
import { describe, validate } from '../src/world/describe.ts'
import { dirOf, inPolygon, makePath, pathDist } from '../src/world/geo.ts'

const w = (seed: string, oceanPct = 64): World => ({ id: 't', name: 't', generatorVersion: 1, seed, params: { ...DEFAULT_PARAMS, oceanPct } })

// same seed -> identical planet; different seed -> different planet
const a = makePlanet(w('alpha')), b = makePlanet(w('alpha')), c = makePlanet(w('beta'))
for (const [lat, lon] of [[0, 0], [45, 120], [-60, -30]]) {
  const d = toDir(lat, lon)
  assert.equal(a.elevation(...d), b.elevation(...d))
}
assert.notEqual(a.elevation(...toDir(10, 10)), c.elevation(...toDir(10, 10)))

// ocean share matches the slider (sampled on a different point set than the generator uses)
for (const pct of [30, 70]) {
  const p = makePlanet(w('gamma', pct))
  let wet = 0, n = 0
  for (let lat = -88; lat <= 88; lat += 4) for (let lon = -180; lon < 180; lon += 4) {
    const k = Math.cos(lat * Math.PI / 180); n += k
    if (p.elevation(...toDir(lat, lon)) < 0) wet += k
  }
  assert.ok(Math.abs(wet / n * 100 - pct) < 6, `ocean ${pct}% -> ${(wet / n * 100).toFixed(1)}%`)
}

// lat/lon round trip
const ll = toLatLon(...toDir(33.3, -71.2))
assert.ok(Math.abs(ll.lat - 33.3) < 1e-9 && Math.abs(ll.lon + 71.2) < 1e-9)

// cube faces cover the sphere: face centres are the six axes, edges of neighbouring faces meet
assert.deepEqual(faceDir(0, 0, 0).map(Math.round), [1, 0, 0])
assert.deepEqual(faceDir(5, 0, 0).map(Math.round), [0, 0, -1])
const e1 = faceDir(4, 1, 0), e2 = faceDir(0, -1, 0) // +Z face right edge == +X face left edge
assert.ok(Math.hypot(e1[0] - e2[0], e1[1] - e2[1], e1[2] - e2[2]) < 1e-12)

// tile buffers have the expected sizes and every index is in range
const t = buildTile(a, 2, 3, 1, 5)
const verts = (SEG + 1) ** 2 + 4 * (SEG + 1)
assert.equal(t.pos.length, verts * 3)
assert.ok(tileIndex().every((i) => i < verts))
assert.ok(t.col.every((v) => v >= 0 && v <= 1))
// sphere helpers
assert.ok(pathDist(dirOf([0, 5]), makePath([[0, 0], [0, 10]])).d < 1e-9)
assert.ok(Math.abs(pathDist(dirOf([0, 5]), makePath([[0, 0], [0, 10]])).t - 0.5) < 1e-9)
assert.ok(inPolygon(dirOf([0, 0]), [[5, -5], [5, 5], [-5, 5], [-5, -5]].map((p) => dirOf(p as [number, number]))))
assert.ok(!inPolygon(dirOf([20, 0]), [[5, -5], [5, 5], [-5, 5], [-5, -5]].map((p) => dirOf(p as [number, number]))))

// ops: a volcano at sea makes an island; ops are deterministic
const sea = w('alpha', 64)
let spot: [number, number] = [0, 0]
for (let lon = -180; lon < 180; lon += 3) if (a.elevation(...toDir(0, lon)) < -2000) { spot = [0, lon]; break }
const withVolcano: World = { ...sea, ops: [{ id: 'v1', kind: 'volcano', at: spot, height: 3000, radius: 40 }] }
const pv = makePlanet(withVolcano), top = pv.elevation(...toDir(spot[0] + 0.05, spot[1]))
assert.ok(top > 1500, `volcano summit ${top}`)
assert.equal(top, makePlanet(withVolcano).elevation(...toDir(spot[0] + 0.05, spot[1])))
assert.ok(pv.elevation(...toDir(spot[0], spot[1] + 20)) === a.elevation(...toDir(spot[0], spot[1] + 20)), 'ops leave far terrain alone')

// rivers fall from source to mouth
const land = (() => { for (let lat = -50; lat < 50; lat += 2) for (let lon = -180; lon < 180; lon += 2) if (a.elevation(...toDir(lat, lon)) > 1500) return [lat, lon] as [number, number]; return [0, 0] as [number, number] })()
const river: World = { ...sea, ops: [{ id: 'r1', kind: 'river', path: [land, [land[0] + 3, land[1] + 3]] }] }
const pr = makePlanet(river), course = pr.course(river.ops![0] as Extract<NonNullable<World['ops']>[number], { kind: 'river' }>)
const hs = course.filter((_, i) => i % 5 === 0).map((ll) => pr.elevation(...toDir(ll[0], ll[1]), 4))
assert.ok(hs[0] > hs[hs.length - 1], 'river ends lower than it starts')
assert.ok(hs.every((h, i) => i === 0 || h < hs[0] + 30), 'river bed never rises above its source')

// validation
assert.deepEqual(validate(withVolcano).errors, [])
assert.ok(validate({ ...sea, ops: [{ id: 'x', kind: 'teleporter' } as never] }).errors[0].includes('unknown kind'))
assert.ok(validate({ ...sea, ops: [{ id: 'x', kind: 'lake', at: [1, 1], radius: 5, path: null } as never] }).errors[0].includes('unknown field'))
assert.ok(validate({ ...sea, ops: [{ id: 'x', kind: 'range', path: [[1, 1]], height: 1, width: 1 }] }).errors[0].includes('path'))
assert.ok(describe(withVolcano).includes('volcano'))

console.log('world: all checks passed')

// layers: validation, picking (points/lines beat the area around them), polygon area
{
  const { pickFeature } = await import('../src/world/layers.ts')
  const { areaKm2 } = await import('../src/world/geo.ts')
  const lw: World = { ...w('layers'), ops: [{ id: 'r', kind: 'river', name: 'Ashrun', path: [[10, 0], [10, 10]] }], layers: [
    { id: 'L1', name: 'Cities', kind: 'cities', items: [{ id: 'c1', name: 'Varra', at: [5, 5] }] },
    { id: 'L2', name: 'Nations', kind: 'regions', items: [{ id: 'n1', name: 'Ash', area: [[0, 0], [0, 20], [20, 20], [20, 0]] }] },
  ] }
  assert.deepEqual(validate(lw).errors, [])
  const bad = validate({ ...lw, layers: [{ id: 'r', name: 'x', kind: 'nope' as never, items: [{ id: 'i', at: [5, 5], path: [[1, 1], [2, 2]] }] }] }).errors
  assert.ok(bad.some((e) => e.includes('duplicate id "r"')) && bad.some((e) => e.includes('unknown kind')) && bad.some((e) => e.includes('exactly one')), bad.join('\n'))
  const R = 6000, name = (p: [number, number]) => pickFeature(lw, p, 30, R)?.name
  assert.equal(name([5.1, 5]), 'Varra')
  assert.equal(name([10.1, 5]), 'Ashrun')
  assert.equal(name([15, 15]), 'Ash')
  assert.equal(name([40, 40]), undefined)
  assert.equal(pickFeature({ ...lw, layers: lw.layers!.map((l) => ({ ...l, hidden: true })) }, [5.1, 5], 30, R)?.name, undefined)
  // a 1°x1° square at the equator is about (2πR/360)² km²
  const a = areaKm2([[0, 0], [0, 1], [1, 1], [1, 0]], R), want = (2 * Math.PI * R / 360) ** 2
  assert.ok(Math.abs(a / want - 1) < 0.01, `${a} vs ${want}`)
}

// flat maps: every projection round-trips pixel <-> lat/lon, and painting fills the buffer
{
  const { makeProj, paintFlat, sampleFlat } = await import('../src/world/flat.ts')
  for (const name of ['equirect', 'mercator', 'robinson'] as const) {
    const p = makeProj(name, 400)
    for (const [lat, lon] of [[0, 0], [40, -120], [-55, 75], [70, 170]]) {
      const [x, y] = p.fwd(lat, lon), back = p.inv(x, y)!
      assert.ok(Math.abs(back[0] - lat) < 1e-6 && Math.abs(back[1] - lon) < 1e-6, `${name} ${lat},${lon} -> ${back}`)
    }
  }
  const pl = makePlanet(w('flat')), p = makeProj('equirect', 90), s = sampleFlat(pl, p), out = new Uint8ClampedArray(p.w * p.h * 4)
  // a zoomed view: same lat/lon round trip, and zooming in 4x moves points 4x further from the centre
  for (const name of ['equirect', 'mercator', 'robinson'] as const) {
    const fit = makeProj(name, 800, 500), z = makeProj(name, 800, 500, { x: fit.view.x + 0.3, y: fit.view.y + 0.1, s: fit.scale * 4 })
    const [x, y] = z.fwd(20, 30), back = z.inv(x, y)!
    assert.ok(Math.abs(back[0] - 20) < 1e-6 && Math.abs(back[1] - 30) < 1e-6, name)
    assert.equal(fit.inv(-5, -5), undefined) // off the map
  }
  for (const style of ['atlas', 'terrain', 'hypso', 'relief', 'dark', 'political'] as const) { out.fill(0); paintFlat(pl, p, s, { style, contour: 500 }, out); assert.ok(out.every((v, i) => i % 4 !== 3 || v === 255), style) }
}

// story: arcs, route legs, party position, time-aware layer items, calendar inverse
{
  const { arc, legs, partyAt } = await import('../src/world/story.ts')
  const { activeAt } = await import('../src/world/layers.ts')
  const { DEFAULT_CAL, fromOrdinal, ordinal } = await import('../src/calendar.ts')
  const a = arc([0, 0], [0, 90]); assert.equal(a.length, 46); assert.ok(a.every((p) => Math.abs(p[0]) < 1e-6))
  const stops = [{ id: 'a', title: 'A', at: [0, 0] as [number, number], day: 0 }, { id: 'b', title: 'B', at: [0, 90] as [number, number], day: 10 }, { id: 'c', title: 'C', at: [0, 90] as [number, number], day: 12 }]
  const L = legs(stops, 6000, 30)
  assert.equal(L.length, 1) // B -> C is the same place
  assert.ok(Math.abs(L[0].km - 6000 * Math.PI / 2) < 1 && L[0].tight && L[0].travelDays > 300)
  assert.equal(partyAt(stops, -1), undefined)
  assert.ok(Math.abs(partyAt(stops, 5)![1] - 45) < 1e-6 && partyAt(stops, 99)![1] === 90)
  for (const d of [0, 29, 30, 359, 360, 12345]) assert.equal(ordinal(DEFAULT_CAL, fromOrdinal(DEFAULT_CAL, d)), d)
  const layer = { id: 'L', name: 'N', kind: 'regions' as const, items: [{ id: 'x', name: 'Old', area: [[0, 0], [0, 1], [1, 1]] as [number, number][], to: { y: 5 } }, { id: 'y', name: 'New', at: [0, 0] as [number, number], from: { y: 5, m: 2 } }] }
  const at = (y: number) => activeAt([layer], y * 360, DEFAULT_CAL)[0].items.map((i) => i.id).join()
  assert.equal(at(3), 'x'); assert.equal(at(5), 'x'); assert.equal(at(6), 'y'); assert.equal(activeAt([layer], undefined, DEFAULT_CAL)[0].items.length, 2)
  assert.ok(validate({ ...w('t'), layers: [{ ...layer, items: [{ ...layer.items[1], from: { y: 'x' } as never }] }] }).errors.some((e) => e.includes('from must be a date')))
}
