import assert from 'node:assert/strict'
import { DEFAULT_PARAMS, makePlanet, toDir, toLatLon, type World } from '../src/world/terrain.ts'
import { buildTile, faceDir, SEG, tileIndex } from '../src/world/tile.ts'

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
console.log('world: all checks passed')
