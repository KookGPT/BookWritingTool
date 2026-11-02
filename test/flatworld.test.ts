import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generate, terrainMesh, treesOf, validate, type FlatWorld } from '../src/flatworld/gen.ts'

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
for (const r of g.rivers) {
  assert.ok(r.ch.every((c, n) => !n || c <= r.ch[n - 1]), `${r.id} only runs downhill`)
  assert.ok(at(...r.pts[r.pts.length - 1]) < 0, `${r.id} reaches water`)
}
const m = terrainMesh(g)
assert.equal(m.pos.length, g.w * g.h * 3)
assert.ok(treesOf(g, demo.seed).some((t) => t.length > 0))

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
const d = generate({ ...demo, shape: 'disc', size: [4200, 4200] }, 300)
assert.ok(d.disc && d.height[0] < 0)
console.log('flatworld ok')
