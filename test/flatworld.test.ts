import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detailAt, generate, heightAt, surfaceAt, treesOf, validate, type FlatWorld } from '../src/flatworld/gen.ts'
import { planetKm, toSphere } from '../src/flatworld/sphere.ts'
import { apparentDeg, CONSTELLATIONS, moonAt, MOONS, northAxis, PLANETS, planetAt, seasonOf, sunDir, sunLatitude, TILT_DEG, YEAR_DAYS } from '../src/flatworld/solar.ts'

const demo: FlatWorld = JSON.parse(readFileSync(new URL('../examples/map-test-demo.json', import.meta.url), 'utf8'))
assert.deepEqual(validate(demo).errors, [])
assert.ok(validate({ ...demo, shape: 'cube' }).errors.length)
assert.ok(validate({ ...demo, features: [{ id: 'x', kind: 'range', at: [0, 0] }] }).errors.length) // a range needs a path

const g = generate(demo, 400), again = generate(demo, 400)
assert.deepEqual(g.height, again.height) // deterministic
const at = (x: number, y: number) => g.height[Math.round((g.H / 2 - y) / g.cell - 0.5) * g.w + Math.round((x + g.W / 2) / g.cell - 0.5)]
assert.ok(at(-700, 300) > 0, 'inside Aldmere is land')
assert.ok(at(-1950, -1250) < 0, 'the far corner is sea')
assert.ok(at(-1050, 0) > 2000, 'the Spine stands tall')
for (const r of g.rivers.filter((r) => !r.minor)) {
  assert.ok(r.ch.every((c, n) => !n || c <= r.ch[n - 1]), `${r.id} only runs downhill`)
  assert.ok(at(...r.pts[r.pts.length - 1]) < 0, `${r.id} reaches water`)
}
const trees = treesOf(g, demo.seed)
assert.ok(trees.far.some((t) => t.length > 0) && trees.near.kinds.some((k) => k.data.length > 0))

// the new ground: lakes sit above the sea, rivers get tributaries, climate and zones are used
const lake = g.lakes.find((l) => l.id === 'mirrow')
assert.ok(lake && lake.level > 0, 'Lake Mirrow has its own level above the sea')
assert.ok(g.rivers.some((r) => r.minor), 'big rivers grow tributaries')
assert.ok(g.zones.some((z) => z.kind === 'storm' && z.pts.length > 0), 'storm zone has rain points')
assert.ok(g.props.some((p) => p.kind === 'floating'), 'floating island placed')

// close-up detail: deterministic, bounded, and only where the ground is rough
assert.equal(detailAt(123.4, -56.7), detailAt(123.4, -56.7))
for (let n = 0; n < 200; n++) assert.ok(Math.abs(detailAt(n * 13.7, n * -7.3)) < 0.6)
assert.ok(Math.abs(surfaceAt(g, -1950, -1250) - heightAt(g, -1950, -1250)) < 1e-6, 'no detail on open sea')

// layers: kinds, geometry and fields are checked; ids are unique across features and items
const city = { id: 'c1', name: 'Port', at: [0, 0] as [number, number], size: 'city' as const }
assert.deepEqual(validate({ ...demo, layers: [{ id: 'L', name: 'Cities', kind: 'cities', items: [city] }] }).errors, [])
assert.ok(validate({ ...demo, layers: [{ id: 'L', name: 'Cities', kind: 'cities', items: [{ ...city, size: 'huge' as never }] }] }).errors.length)
assert.ok(validate({ ...demo, layers: [{ id: 'L', name: 'Borders', kind: 'borders', items: [city] }] }).errors.length) // a border needs a path
assert.ok(validate({ ...demo, layers: [{ id: 'aldmere', name: 'x', kind: 'roads', items: [] }] }).errors.length) // id taken by a feature

// every area feature gets a label anchor inside its drawn outline, and there are coast/river/crest snap points
for (const f of demo.features.filter((f) => f.area)) assert.ok(g.anchors[f.id], `${f.id} has an anchor`)
assert.ok(at(...g.anchors.aldmere) > 0, 'the Aldmere label sits on land')
assert.ok(g.snaps.length > 100)

// a disc world is sea outside its rim
const disc: FlatWorld = JSON.parse(readFileSync(new URL('../examples/map-test-disc.json', import.meta.url), 'utf8'))
assert.deepEqual(validate(disc).errors, [])
const d = generate(disc, 300)
assert.ok(d.disc && d.height[0] < 0 && d.edge === 'waterfall')
assert.ok(validate({ ...demo, climate: { north: 'boiling' } as never }).errors.length)
// the globe: north up, true distances, a planet-sized map fits without wrapping, discs stay round
const R = planetKm(39000, 19483, false)
assert.equal(R, 6371)
assert.deepEqual(toSphere(0, 0, R), [0, 0, 1])
const gc = (p: number[], q: number[]) => Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])) * R
assert.ok(Math.abs(gc(toSphere(0, 0, R), toSphere(5000, 0, R)) - 5000) < 1e-6) // along the equator
assert.ok(Math.abs(gc(toSphere(4000, 1000, R), toSphere(4000, 4000, R)) - 3000) < 1e-6) // north-south anywhere
assert.ok(Math.abs(Math.hypot(...toSphere(6500, -3750, R)) - 1) < 1e-12)
assert.ok(toSphere(0, 1000, R)[1] > 0 && toSphere(1000, 0, R)[0] > 0)
assert.ok(toSphere(-19500, 0, R)[2] < 0 && gc(toSphere(-19500, 0, R), toSphere(19500, 0, R)) > 1000) // the two ends don't overlap
const [a, b] = [toSphere(3000, 0, R, true), toSphere(0, 3000, R, true)]
assert.ok(Math.abs(a[2] - b[2]) < 1e-12 && Math.abs(gc(toSphere(0, 0, R, true), a) - 3000) < 1e-6)
assert.ok(planetKm(40000, 40000, false) * Math.PI >= 40000 && planetKm(40000, 40000, true) * Math.PI > 20000)
// a map made bigger: climate bands and warpSize keep the old ground where it was
assert.deepEqual(validate({ ...demo, warpSize: 900, climate: { wind: 'west', bands: [[-500, 'hot'], [500, 'frozen']] } }).errors, [])
assert.ok(validate({ ...demo, climate: { bands: [[5, 'hot'], [1, 'frozen']] } }).errors.length)
// the sky: the sun stands over the tropics at midsummer and midwinter and over the equator between them, and the seasons follow
assert.ok(Math.abs(sunLatitude(0) - TILT_DEG) < 1e-9 && Math.abs(sunLatitude(YEAR_DAYS / 2) + TILT_DEG) < 1e-9 && Math.abs(sunLatitude(YEAR_DAYS / 4)) < 1e-9)
assert.deepEqual([0, 0.25, 0.5, 0.75, 1, -0.25].map((y) => seasonOf(y * YEAR_DAYS)), ['Northern summer', 'Northern autumn', 'Northern winter', 'Northern spring', 'Northern summer', 'Northern spring'])
assert.ok(Math.abs(Math.hypot(...northAxis()) - 1) < 1e-12 && Math.abs(Math.hypot(...sunDir(7)) - 1) < 1e-12)
const m0 = moonAt(MOONS[0], 3), m1 = moonAt(MOONS[0], 3 + MOONS[0].days)
assert.ok(MOONS.length === 2 && Math.abs(Math.hypot(...m0) - MOONS[0].dist) < 1e-9 && Math.hypot(m0[0] - m1[0], m0[1] - m1[1], m0[2] - m1[2]) < 1e-9)
assert.ok(new Set(PLANETS.map((p) => p.id)).size === PLANETS.length && PLANETS.every((p) => Math.abs(Math.hypot(...planetAt(p, 5)) - p.a) < 1e-9))
assert.ok(apparentDeg(14, 0.1) <= 5.5 && apparentDeg(1, 100) >= 0.5 && CONSTELLATIONS.every((c) => c.lines.every((l) => l.length >= 2)))
console.log('flatworld ok')
