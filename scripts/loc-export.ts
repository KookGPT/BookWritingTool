// Dumps a built location for Blender: node scripts/loc-export.ts <location.json> <out dir>
// Writes scene.json (manifest) + scene.bin (raw little-endian arrays, offsets in the manifest).
// scripts/blender/build.py reads it. The recipe stays the source of truth; Blender is an output stage only.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { buildCity, type LocationDoc } from '../src/locations/city.ts'
import { MATS } from '../src/locations/kit.ts'
import { PART, PSTRIDE } from '../src/locations/buildings.ts'
import { partGeometries, rockGeo, treeGeometries } from '../src/locations/geometry.ts'
import { TSTRIDE } from '../src/locations/city.ts'

const [file, out] = process.argv.slice(2)
if (!file || !out) { console.log('usage: node scripts/loc-export.ts <location.json> <out dir>'); process.exit(1) }
const doc: LocationDoc = JSON.parse(readFileSync(file, 'utf8'))
console.log('building...')
const b = buildCity(doc, () => {})

const chunks: Uint8Array[] = []
let at = 0
type Ref = { off: number; len: number; type: string }
const put = (a: ArrayBufferView & { length: number }): Ref => {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), pad = (4 - (at % 4)) % 4
  if (pad) { chunks.push(new Uint8Array(pad)); at += pad }
  const ref = { off: at, len: a.length, type: a.constructor.name }
  chunks.push(bytes); at += bytes.length
  return ref
}
const geoOf = (g: any) => {
  const n = g.index ? g.toNonIndexed() : g
  return { pos: put(n.attributes.position.array as Float32Array), nor: put(n.attributes.normal.array as Float32Array), col: n.attributes.color ? put(n.attributes.color.array as Float32Array) : null, foliage: n.attributes.foliage ? put(n.attributes.foliage.array as Float32Array) : null }
}

const man: any = {
  id: doc.id, name: doc.name, size: b.size, N: b.N, sea: b.sea, minH: b.minH, maxH: b.maxH, snowline: b.snowline,
  hour: doc.hour ?? 17, season: doc.season ?? 'summer', climate: doc.climate, views: doc.views ?? [], counts: b.counts,
  PSTRIDE, TSTRIDE, PART,
  terrain: { heights: put(b.heights), colors: put(b.colors) },
  outer: { size: b.outer.size, n: b.outer.n, heights: put(b.outer.heights), colors: put(b.outer.colors) },
  geo: Object.fromEntries(MATS.filter((m) => b.geo[m].pos.length).map((m) => [m, { pos: put(b.geo[m].pos), nor: put(b.geo[m].nor), col: put(b.geo[m].col) }])),
  detail: b.detail.map((tier) => Object.fromEntries(MATS.filter((m) => tier[m].pos.length).map((m) => [m, { pos: put(tier[m].pos), nor: put(tier[m].nor), col: put(tier[m].col) }]))),
  parts: put(b.parts), partGeos: partGeometries().map(geoOf),
  trees: put(b.trees), treeGeos: treeGeometries().map((lv) => lv.map(geoOf)),
  rocks: put(b.rocks), rockGeo: geoOf(rockGeo()),
  lamps: put(b.lamps), chimneys: put(b.chimneys),
  water: put(b.water), rivers: { pos: put(b.rivers.pos) },
}
mkdirSync(out, { recursive: true })
writeFileSync(`${out}/scene.bin`, Buffer.concat(chunks))
writeFileSync(`${out}/scene.json`, JSON.stringify(man))
console.log(`wrote ${out}/scene.bin (${(at / 1e6).toFixed(1)} MB)`, b.counts)
