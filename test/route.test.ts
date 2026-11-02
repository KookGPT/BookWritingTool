import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generate, heightAt, pathLen, polyArea, smoothPath, itemShape } from '../src/flatworld/gen.ts'
import { fillRegion, route, simplify } from '../src/flatworld/route.ts'

const fw = JSON.parse(readFileSync(new URL('../examples/map-test-demo.json', import.meta.url), 'utf8'))
const g = generate(fw, 600)

// curves pass through their points
const pts: [number, number][] = [[0, 0], [100, 50], [200, 0], [300, 80]]
const c = smoothPath(pts, false)
assert.deepEqual(c[0], pts[0]); assert.deepEqual(c[c.length - 1], pts[3]); assert.ok(c.some((p) => Math.hypot(p[0] - 100, p[1] - 50) < 1e-9))
assert.equal(itemShape({ id: 'x', path: pts }).length, 4)
assert.equal(simplify([[0, 0], [1, 0.001], [2, 0]], 0.1).length, 2)

// a river route hugs the river: much closer to it than a straight line would be
const ael = g.rivers.find((r) => r.id === 'ael')!, a = ael.pts[10], b = ael.pts[ael.pts.length - 15]
const viaRiver = route(g, a, b, 'river')
const off = (p: [number, number]) => Math.min(...ael.pts.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])))
const mean = (ps: [number, number][]) => ps.reduce((s, p) => s + off(p), 0) / ps.length
const straight = Array.from({ length: 20 }, (_, n): [number, number] => [a[0] + (b[0] - a[0]) * n / 19, a[1] + (b[1] - a[1]) * n / 19])
assert.ok(mean(viaRiver) < mean(straight) * 0.6, `river route stays near the river (${mean(viaRiver).toFixed(1)} vs ${mean(straight).toFixed(1)} km)`)
assert.ok(pathLen(viaRiver) >= Math.hypot(a[0] - b[0], a[1] - b[1]))
assert.deepEqual(route(g, a, b, 'free'), [a, b])

// a ridge route climbs onto the Spine
const ridge = route(g, [-1350, 700], [-1060, -600], 'ridge')
assert.ok(ridge.filter((p) => heightAt(g, ...p) > 1500).length > ridge.length / 2, 'ridge route runs along the heights')

// fill: a wall splits Aldmere; filling one side stops at it, filling with no walls takes the whole land, water gives nothing
const half = fillRegion(g, [-600, 0], [[[-1060, 1200], [-1060, -1200]]])!, whole = fillRegion(g, [-600, 0], [])!
assert.ok(half && whole && polyArea(half) < polyArea(whole) * 0.85 && polyArea(half) > polyArea(whole) * 0.3, `${polyArea(half)} of ${polyArea(whole)}`)
assert.equal(fillRegion(g, [-1950, -1250], []), undefined)
// a border that stops a little short of the coast at both ends still seals
const short = fillRegion(g, [-1500, 0], [[[-1060, 940], [-1060, -880]]])!
assert.ok(polyArea(short) < polyArea(whole) * 0.6, `short wall seals: ${Math.round(polyArea(short))} of ${Math.round(polyArea(whole))}`)
console.log('route ok')
