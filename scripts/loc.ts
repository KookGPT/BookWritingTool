// Locations tools for Claude Code / the terminal. Same pure code as the app.
//   node scripts/loc.ts brief                       (the recipe format and the rules)
//   node scripts/loc.ts validate <location.json>
//   node scripts/loc.ts describe <location.json>    (heights at every feature, buildings per district)
//   node scripts/loc.ts preview  <location.json> [out.png] [--w 1200] [--region W,E,S,N]   (top-down, hill-shaded)
// <location.json> is one location as exported from the Locations page (or locations/<id>.json in the data repo).
import { readFileSync, writeFileSync } from 'node:fs'
import { png } from './png.ts'
import { brief, buildCity, describe, validate, type LocationDoc } from '../src/locations/city.ts'
import { PART, PSTRIDE } from '../src/locations/buildings.ts'

const args = process.argv.slice(2)
const flag = (k: string) => { const i = args.indexOf(k); return i < 0 ? undefined : args.splice(i, 2)[1] }
const width = Number(flag('--w') ?? 1200), region = flag('--region')?.split(',').map(Number)
const [cmd, file, out] = args
if (cmd === 'brief') { console.log(brief()); process.exit(0) }
if (!file) { console.log('commands: brief, validate, describe, preview'); process.exit(1) }
const doc: LocationDoc = JSON.parse(readFileSync(file, 'utf8'))
const v = validate(doc)
const stage = (s: string) => process.stderr.write(`  ${s}...
`)
for (const e of v.errors) console.log('error  ', e)
for (const e of v.warnings) console.log('warning', e)
if (v.errors.length) process.exit(1)
if (cmd === 'validate') console.log(v.warnings.length ? `${v.warnings.length} warnings` : 'ok')
else if (cmd === 'describe') console.log(describe(doc, buildCity(doc, stage)))
else if (cmd === 'preview') {
  const b = buildCity(doc, stage), half = b.size / 2, [W0, E0, S0, N0] = region ?? [-half, half, -half, half]
  const w = width, h = Math.round((width * (N0 - S0)) / (E0 - W0)), rgb = new Uint8Array(w * h * 3), n = b.N + 1, cell = b.size / b.N
  const at = (x: number, y: number) => { const i = Math.round((x + half) / cell), j = Math.round((half - y) / cell); return i >= 0 && i < n && j >= 0 && j < n ? j * n + i : -1 }
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = W0 + ((px + 0.5) / w) * (E0 - W0), y = N0 - ((py + 0.5) / h) * (N0 - S0), k = at(x, y), o = (py * w + px) * 3
    if (k < 0) continue
    const hx = b.heights[Math.min(k + 1, b.heights.length - 1)] - b.heights[Math.max(k - 1, 0)], hy = b.heights[Math.max(k - n, 0)] - b.heights[Math.min(k + n, b.heights.length - 1)]
    const shade = Math.max(0.35, Math.min(1.3, 1 + (-hx + hy) / (4 * cell)))
    let c = [b.colors[k * 3], b.colors[k * 3 + 1], b.colors[k * 3 + 2]].map((q) => q * shade)
    if (b.sea != null && b.heights[k] < b.sea) c = [40 + b.heights[k] * 0.3, 95 + b.heights[k] * 0.4, 130 + b.heights[k] * 0.3].map((q) => Math.max(20, q))
    rgb.set(c.map((q) => Math.max(0, Math.min(255, q))), o)
  }
  const dot = (x: number, z: number, r: number, c: number[]) => {
    const px = ((x - W0) / (E0 - W0)) * w, py = ((N0 + z) / (N0 - S0)) * h, rr = Math.max(0.5, (r / (E0 - W0)) * w)
    for (let j = Math.floor(py - rr); j <= py + rr; j++) for (let i = Math.floor(px - rr); i <= px + rr; i++) if (i >= 0 && j >= 0 && i < w && j < h && (i - px) ** 2 + (j - py) ** 2 <= rr * rr) rgb.set(c, (j * w + i) * 3)
  }
  for (let k = 0; k < b.water.length; k += 18) dot(b.water[k] + cell / 2, b.water[k + 2] + cell / 2, cell * 0.75, [60, 120, 140])
  for (let k = 0; k < b.rivers.pos.length; k += 9) dot(b.rivers.pos[k], b.rivers.pos[k + 2], 6, [70, 130, 160])
  { const p = b.geo.road.pos; for (let k = 0; k < p.length; k += 9) dot(p[k], p[k + 2], 1.6, [235, 225, 200]) }
  for (let k = 0; k < b.water.length; k += 9) dot(b.water[k], b.water[k + 2], cell * 0.6, [60, 120, 140])
  for (let k = 0; k < b.parts.length; k += PSTRIDE) { const t = b.parts[k]; if (t === PART.wall && b.parts[k + 12] < 50) dot(b.parts[k + 1], b.parts[k + 3], Math.max(b.parts[k + 5], b.parts[k + 7]) / 2, [Math.round(60 + b.parts[k + 13] * 180), 50, 50]); else if (t === PART.vine) dot(b.parts[k + 1], b.parts[k + 3], 0.8, [70, 90, 40]) }
  for (let k = 0; k < b.trees.length; k += 6) if (b.trees[k + 4] >= 5) dot(b.trees[k], b.trees[k + 2], 1.5, [60, 80, 40])
  for (const m of ['stone', 'roof', 'metal'] as const) { const p = b.geo[m].pos; for (let k = 0; k < p.length; k += 27) dot(p[k], p[k + 2], 1.5, [255, 255, 255]) }
  writeFileSync(out ?? 'preview.png', png(w, h, rgb))
  console.log(`wrote ${out ?? 'preview.png'}: ${w}x${h}, buildings dark red (slums) to light red (rich), roads cream, rivers blue, structures white; ${b.counts.buildings} buildings`)
} else { console.log(`unknown command ${cmd}`); process.exit(1) }
