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
