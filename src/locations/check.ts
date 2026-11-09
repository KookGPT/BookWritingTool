// Locations realism audit: measurable rules that real places obey, checked on the built ground, water, towns and roads.
// Each finding is one line: "ok", "warn" or "bad", what was measured and, when it fails, what to change in the recipe.
// Pure. Run with `node scripts/loc.ts check <location.json>`; the browser build carries the same lines (built.audit).
import type { Road } from './roads.ts'
import type { River, Lake } from './hydro.ts'
import type { Town } from './town.ts'
import { glacierWidth, pathNearFast, type Glacier, type Wall } from './terrain.ts'

export interface AuditIn {
  N: number; size: number; heights: Float32Array; sea: number | null
  rivers: River[]; lakes: Lake[]; towns: Town[]; roads: Road[]; glaciers: Glacier[]; walls: Wall[]; volume?: boolean
  /** house walls: x, z, width, depth (world) */
  houses: number[]
}
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0)
export function audit(o: AuditIn): string[] {
  const { N, size, heights: h, sea } = o, w = N + 1, c = size / N, out: string[] = []
  const H = (x: number, z: number) => { const i = Math.max(0, Math.min(N, Math.round((x + size / 2) / c))), j = Math.max(0, Math.min(N, Math.round((z + size / 2) / c))); return h[j * w + i] }
  const say = (lvl: 'ok' | 'warn' | 'bad', msg: string) => out.push(`${lvl.padEnd(4)} ${msg}`)

  // terrain: no needles, no cliffs that are only a grid step (outside the rock walls), no huge dead-flat basins
  let spikes = 0, seams = 0, flat = 0, land = 0
  const nearWall = new Uint8Array(w * w)
  for (const wl of o.walls) for (const [x, y] of wl.pts) { const i = Math.round((x + size / 2) / c), j = Math.round((size / 2 - y) / c), rr = Math.ceil(wl.face / c) + 3; for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) { const a = (j + dj) * w + i + di; if (i + di >= 0 && i + di <= N && j + dj >= 0 && j + dj <= N) nearWall[a] = 1 } }
  for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
    const a = j * w + i, v = h[a]
    if (sea != null && v < sea) continue
    land++
    let hi = -Infinity, lo = Infinity, sl = 0
    for (const d of [1, -1, w, -w]) { hi = Math.max(hi, h[a + d]); lo = Math.min(lo, h[a + d]); sl = Math.max(sl, Math.abs(h[a + d] - v)) }
    if (v - hi > 25) spikes++
    if (sl / c > 3 && !nearWall[a] && !o.volume) seams++ // the volume ground turns every steep face into rock by itself
    if (hi - lo < 0.05) flat++
  }
  say(spikes > land * 0.0005 ? 'bad' : 'ok', `terrain: ${spikes} needle spikes (single cells 25 m above all neighbours)`)
  say(seams > land * 0.004 ? 'warn' : 'ok', `terrain: ${pct(seams, land)}% of the land is a vertical step with no rock face over it${seams > land * 0.004 ? ' (add a cliff/coast/gorge feature there, or soften it)' : ''}`)
  say(flat > land * 0.08 ? 'warn' : 'ok', `terrain: ${pct(flat, land)}% dead flat (filled hollows, terraces, squares)${flat > land * 0.08 ? '; real land is rarely this flat: lower erosion or reshape the basins' : ''}`)

  // the sea: every patch below sea level must reach the open sea
  if (sea != null) {
    const seen = new Uint8Array(w * w), st: number[] = []
    for (let i = 0; i <= N; i++) for (const a of [i, N * w + i, i * w, i * w + N]) if (h[a] < sea && !seen[a]) { seen[a] = 1; st.push(a) }
    while (st.length) { const a = st.pop()!, i = a % w, j = (a / w) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni > N || nj > N) continue; const b = nj * w + ni; if (!seen[b] && h[b] < sea) { seen[b] = 1; st.push(b) } } }
    for (const l of o.lakes) for (const a of l.cells) seen[a] = 1 // lakes and rivers cover their own hollows
    for (const r of o.rivers) for (let i = 0; i < r.path.length; i += 2) { const ii = Math.round((r.path[i][0] + size / 2) / c), jj = Math.round((size / 2 - r.path[i][1]) / c), rr = Math.ceil(r.wid[i] / c) + 1; for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) { const ni = ii + di, nj = jj + dj; if (ni >= 0 && nj >= 0 && ni <= N && nj <= N) seen[nj * w + ni] = 1 } }
    let stranded = 0
    for (let a = 0; a < h.length; a++) if (h[a] < sea && !seen[a]) stranded++
    say(stranded > 20 ? 'warn' : 'ok', `sea: ${stranded} cells below sea level cut off from the open sea${stranded > 20 ? ' (they show as sea water inland)' : ''}`)
  }

  // rivers follow their valleys: the banks must stand above the water (the ground as drawn: bilinear between vertices;
  // the nearest vertex on a steep reach is a step up or down the slope and reads metres off)
  const Hb = (x: number, y: number) => { const fx = (x + size / 2) / c, fy = (size / 2 - y) / c, i = Math.min(N - 1, Math.floor(fx)), j = Math.min(N - 1, Math.floor(fy)), tx = fx - i, ty = fy - j; return (h[j * w + i] * (1 - tx) + h[j * w + i + 1] * tx) * (1 - ty) + (h[(j + 1) * w + i] * (1 - tx) + h[(j + 1) * w + i + 1] * tx) * ty }
  const onMap = (x: number, y: number) => Math.abs(x) < size / 2 && Math.abs(y) < size / 2
  // ground under a lake or a plunge pool is under that water, not a bank the river spills over
  const lakeV = new Uint8Array(w * w)
  for (const l of o.lakes) for (const a of l.cells) lakeV[a] = 1
  const inLake = (x: number, y: number) => lakeV[Math.max(0, Math.min(N, Math.round((size / 2 - y) / c))) * w + Math.max(0, Math.min(N, Math.round((x + size / 2) / c)))] === 1
  const wetAt = (r: River, x: number, y: number) => inLake(x, y) || r.pools.some((p) => Math.hypot(p.at[0] - x, p.at[1] - y) < p.r)
  for (const r of o.rivers) {
    let perched = 0, n = 0, drops = 0
    for (let i = 0; i < r.path.length - 1; i += 4) {
      const [x, y] = r.path[i], [x2, y2] = r.path[i + 1], l = Math.hypot(x2 - x, y2 - y) || 1, nx = -(y2 - y) / l, ny = (x2 - x) / l, off = r.wid[i] * 0.6 + 12
      if (sea != null && r.prof[i] <= sea + 0.05) continue
      if (!onMap(x + off, y + off) || !onMap(x - off, y - off) || inLake(x, y)) continue // off the map it is not drawn; in a lake the lake takes over
      n++
      const bank = (s: number) => { const bx = x + nx * off * s, by = y + ny * off * s; return pathNearFast(r.path, bx, by, off * 0.8).d < off * 0.6 || wetAt(r, bx, by) ? Infinity : Hb(bx, by) } // a sample in another loop of the river is no bank
      if (bank(1) < r.prof[i] - 0.8 || bank(-1) < r.prof[i] - 0.8) perched++
      if (i >= 4 && r.prof[i - 4] - r.prof[i] > 8 && !(i >= 8 && r.prof[i - 8] - r.prof[i - 4] > 8)) drops++ // a cascade of steps is one fall
    }
    say(perched > n * 0.05 ? 'warn' : 'ok', `river ${r.id}: ${pct(perched, n)}% of its course has a bank below the water${perched > n * 0.05 ? ' (it runs along a slope or a ridge: let it follow its valley, or give it waypoints in the valley floor)' : ''}; ${drops} falls`)
  }

  // lakes: a natural shore is ragged, not a circle; and it holds its level
  for (const l of o.lakes) {
    const cells = new Set(l.cells)
    let edge = 0
    for (const a of l.cells) for (const d of [1, -1, w, -w]) if (!cells.has(a + d)) edge++
    const area = l.cells.length, compact = (4 * Math.PI * area) / (edge * edge || 1)
    say(compact > 0.8 ? 'warn' : 'ok', `lake ${l.id}: ${Math.round(area * c * c / 1e4)} ha, shore ${compact > 0.8 ? 'nearly circular (put it in a valley or give it a path)' : 'follows the land'}`)
  }

  // glaciers lie in their valleys: the ice must not stand above the ground beside it
  for (const g of o.glaciers) {
    let high = 0, n = 0
    for (let i = 4; i < g.path.length - 1; i += 6) {
      const [x, y] = g.path[i], [x2, y2] = g.path[i + 1], l = Math.hypot(x2 - x, y2 - y) || 1, nx = -(y2 - y) / l, ny = (x2 - x) / l
      const off = glacierWidth(g, i / g.path.length, x, y) * 1.7, mid = H(x, -y), side = Math.min(H(x + nx * off, -(y + ny * off)), H(x - nx * off, -(y - ny * off)))
      n++; if (mid > side + 25) high++
    }
    say(high > n * 0.15 ? 'bad' : 'ok', `glacier ${g.id}: ${pct(high, n)}% of the tongue stands above the ground beside it${high > n * 0.15 ? ' (follow the valley floor; lower or drop height)' : ''}`)
  }

  // towns: not circles; houses face streets; streets are dense enough to make blocks and mostly connect
  const idx = new Map<number, number[]>(), C = 20, key = (x: number, z: number) => Math.floor(x / C) * 100003 + Math.floor(z / C)
  o.roads.forEach((r, ri) => { for (const p of r.pts) { const k = key(p[0], p[2]); const l = idx.get(k); if (l) l.push(p[0], p[2], ri); else idx.set(k, [p[0], p[2], ri]) } })
  const nearRoad = (x: number, z: number, skip = -1) => { let b = Infinity; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const l = idx.get((Math.floor(x / C) + di) * 100003 + Math.floor(z / C) + dj); if (l) for (let q = 0; q < l.length; q += 3) if (l[q + 2] !== skip) b = Math.min(b, Math.hypot(l[q] - x, l[q + 1] - z)) } return b }
  for (const t of o.towns) {
    let area = 0, edge = 0
    const { gw, gh, cost, g } = t
    for (let k = 0; k < cost.length; k++) if (cost[k] <= 1) { area++; const i = k % gw, j = (k / gw) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= gw || nj >= gh || !(cost[nj * gw + ni] <= 1)) edge++ } }
    const compact = (4 * Math.PI * area) / (edge * edge || 1)
    let len = 0, ends = 0
    const streets = o.roads.filter((r) => r.kind !== 'main' && r.pts.length > 1 && t.zone(r.pts[0][0], r.pts[0][2]) < 1.05)
    for (const r of streets) { const ri = o.roads.indexOf(r); for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][2] - r.pts[i - 1][2]); for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) if (nearRoad(p[0], p[2], ri) > 8) ends++ }
    const km2 = (area * g * g) / 1e6, dens = len / 1000 / (km2 || 1)
    let houses = 0, orphans = 0
    for (let k = 0; k < o.houses.length; k += 4) { const x = o.houses[k], z = o.houses[k + 1]; if (t.zone(x, z) > 1) continue; houses++; if (nearRoad(x, z) > Math.max(o.houses[k + 2], o.houses[k + 3]) / 2 + 14) orphans++ }
    say(compact > 0.75 ? 'warn' : 'ok', `town ${t.id}: ${km2.toFixed(2)} km2, ${compact > 0.75 ? 'nearly round (towns follow valleys, roads and contours: check the terrain under it)' : 'shaped by its ground'}`)
    say(dens < 12 || dens > 60 ? 'warn' : 'ok', `town ${t.id}: ${dens.toFixed(0)} km of street per km2 (old towns: 15-45)${dens < 12 ? ' - too few streets, blocks too big' : dens > 60 ? ' - a maze' : ''}; ${pct(ends, streets.length * 2)}% dead ends`)
    const allow = t.steep ? 0.3 : 0.15 // cliff towns stack houses up the slope between their stairs
    say(orphans > houses * allow ? 'warn' : 'ok', `town ${t.id}: ${houses} houses, ${pct(orphans, houses)}% not on a street`)
  }

  // roads: walkable grades, never in the water
  let steep = 0, total = 0, wet = 0
  for (const r of o.roads) if (r.kind === 'main') for (let i = 1; i < r.pts.length; i++) {
    const p = r.pts[i - 1], q = r.pts[i], l = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1
    total += l; if (Math.abs(q[1] - p[1]) / l > 0.16) steep += l
    if (sea != null && q[1] < sea - 0.5) wet += l
  }
  say(steep > total * 0.05 ? 'warn' : 'ok', `roads: ${pct(steep, total)}% of main road length is steeper than 16%`)
  if (wet > 0) say('bad', `roads: ${Math.round(wet)} m of main road below sea level`)
  return out
}
