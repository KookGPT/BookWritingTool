// Locations terrain: the ground as a function of (x, y), built from the recipe's landforms. Each landform is compiled once
// into a closure with a bounding box, so a vertex only pays for the features near it. Landforms are shaped the way nature
// makes them: coasts have headlands of hard rock and bays of soft rock, cliffs with wave-cut platforms, stacks and arches;
// escarpments wander in spurs and re-entrants with talus at the foot; volcanoes have concave flanks and craters; mesas
// keep a cap rock over talus. Rivers, lakes and erosion work on the height grid afterwards (hydro.ts). Every steep face is
// also recorded as a wall line, so the renderer can give it real rock (rock.ts) instead of a stretched slope.
// Pure: node tests, the CLI and the worker run it. Recipe coordinates: metres, x east, y north.
import { fbm, hash, ridged, rng, simplex, type Noise3 } from '../world/noise.ts'
import type { LocationDoc, Structure, TerrainFeature } from './city.ts'
import { routeLine } from './hydro.ts'

export type XY = [number, number]
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
export const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
export const smax = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25 }
export const smin = (a: number, b: number, k: number) => -smax(-a, -b, k)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// ---------- geometry ----------
/** Distance to a polyline, how far along it the nearest point lies, and which side (+1 left of the direction of travel). */
export function pathNear(path: XY[], x: number, y: number) {
  let best = Infinity, along = 0, run = 0, side = 1
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, l = Math.sqrt(l2)
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2), d = Math.hypot(x - ax - dx * t, y - ay - dy * t)
    if (d < best) { best = d; along = run + t * l; side = dx * (y - ay) - dy * (x - ax) >= 0 ? 1 : -1 }
    run += l
  }
  return { d: best, s: along, side }
}
export const pathDist = (path: XY[], x: number, y: number) => pathNear(path, x, y).d
/** Where line rasters are allowed to reach (set per location: the map plus a margin), so lines that run far off the map
 * (coasts, ranges) do not make huge rasters. */
let REGION = 10000
export const setLineRegion = (half: number) => { REGION = half }
const FAR = { d: Infinity, s: 0, side: 1 }
interface LineIx { run: Float64Array; px: Float64Array; py: Float64Array; x0: number; y0: number; c: number; nx: number; ny: number; seg: Int32Array; coarse: number[]; cx: Float64Array; cy: Float64Array }
const lineCache = new WeakMap<XY[], LineIx>()
const segD2 = (px: Float64Array, py: Float64Array, i: number, x: number, y: number) => { const ax = px[i], ay = py[i], dx = px[i + 1] - ax, dy = py[i + 1] - ay, l2 = dx * dx + dy * dy || 1; let t = ((x - ax) * dx + (y - ay) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = x - ax - dx * t, ey = y - ay - dy * t; return ex * ex + ey * ey }
/** A raster of "which segment is nearest", made by marking the cells along the line and sweeping that outward twice
 * (forward, then backward, each cell trying its neighbours' segments), like a distance transform that remembers. */
function lineIndex(path: XY[]): LineIx {
  let ix = lineCache.get(path)
  if (ix) return ix
  const n = path.length, run = new Float64Array(n), px = new Float64Array(n), py = new Float64Array(n)
  for (let i = 0; i < n; i++) { px[i] = path[i][0]; py[i] = path[i][1]; if (i) run[i] = run[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]) }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
  for (let i = 0; i < n; i++) { bx0 = Math.min(bx0, px[i]); by0 = Math.min(by0, py[i]); bx1 = Math.max(bx1, px[i]); by1 = Math.max(by1, py[i]) }
  const pad = 2500, x0 = Math.max(bx0 - pad, -REGION), y0 = Math.max(by0 - pad, -REGION), x1 = Math.max(x0 + 1, Math.min(bx1 + pad, REGION)), y1 = Math.max(y0 + 1, Math.min(by1 + pad, REGION))
  const c = Math.max(6, Math.max(x1 - x0, y1 - y0) / 640), nx = Math.ceil((x1 - x0) / c) + 1, ny = Math.ceil((y1 - y0) / c) + 1
  const seg = new Int32Array(nx * ny).fill(-1), dist = new Float64Array(nx * ny).fill(Infinity)
  for (let s = 0; s < n - 1; s++) { // seed the cells along each segment
    const ax = px[s], ay = py[s], bx = px[s + 1], by = py[s + 1]
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - y0) / c) - 1), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) - y0) / c) + 1)
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - x0) / c) - 1), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) - x0) / c) + 1)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = segD2(px, py, s, x0 + i * c, y0 + j * c), k = j * nx + i; if (d < dist[k]) { dist[k] = d; seg[k] = s } }
  }
  const tryN = (k: number, q: number, x: number, y: number) => { const s = seg[q]; if (s < 0 || s === seg[k]) return; const d = segD2(px, py, s, x, y); if (d < dist[k]) { dist[k] = d; seg[k] = s } }
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < ny; j++) { const y = y0 + j * c; for (let i = 0; i < nx; i++) { const k = j * nx + i, x = x0 + i * c; if (i) tryN(k, k - 1, x, y); if (j) { tryN(k, k - nx, x, y); if (i) tryN(k, k - nx - 1, x, y); if (i < nx - 1) tryN(k, k - nx + 1, x, y) } } }
    for (let j = ny - 1; j >= 0; j--) { const y = y0 + j * c; for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i, x = x0 + i * c; if (i < nx - 1) tryN(k, k + 1, x, y); if (j < ny - 1) { tryN(k, k + nx, x, y); if (i < nx - 1) tryN(k, k + nx + 1, x, y); if (i) tryN(k, k + nx - 1, x, y) } } }
  }
  const coarse = simplifyIdx(path, 6) // beyond the raster, a simplified copy answers
  ix = { run, px, py, x0, y0, c, nx, ny, seg, coarse, cx: Float64Array.from(coarse, (i) => px[i]), cy: Float64Array.from(coarse, (i) => py[i]) }
  lineCache.set(path, ix)
  return ix
}
/** Nearest point on a long polyline: distance, how far along it, which side (+1 left of the direction of travel). */
export function pathNearFast(path: XY[], x: number, y: number, maxD: number) {
  if (path.length < 12) { const n = pathNear(path, x, y); return n.d <= maxD ? n : FAR }
  const ix = lineIndex(path), { px, py } = ix, last = path.length - 2, fi = Math.round((x - ix.x0) / ix.c), fj = Math.round((y - ix.y0) / ix.c)
  let best = Infinity, bs = -1
  const test = (s: number) => { if (s < 0 || s > last) return; const d = segD2(px, py, s, x, y); if (d < best) { best = d; bs = s } }
  if (fi >= 0 && fj >= 0 && fi < ix.nx && fj < ix.ny) {
    const reach = Math.max(3, Math.ceil(ix.c / 4))
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const i = fi + di, j = fj + dj; if (i < 0 || j < 0 || i >= ix.nx || j >= ix.ny) continue; const s0 = ix.seg[j * ix.nx + i]; if (s0 >= 0) for (let s = s0 - reach; s <= s0 + reach; s++) test(s) }
  } else {
    let cs = -1, cb = Infinity
    const cx = ix.cx, cy = ix.cy
    for (let q = 0; q < cx.length - 1; q++) { const d = segD2(cx, cy, q, x, y); if (d < cb) { cb = d; cs = q } }
    if (cs >= 0) for (let s = ix.coarse[cs]; s < ix.coarse[cs + 1]; s++) test(s)
  }
  if (bs < 0) return FAR
  for (const dir of [1, -1]) for (let s = bs + dir, k = 0; s >= 0 && s <= last && k < 2000; s += dir, k++) { const d2 = segD2(px, py, s, x, y); if (d2 < best) { best = d2; bs = s } else if (d2 > best * 1.02 + 4) break } // walk to the true nearest
  const d = Math.sqrt(best)
  if (d > maxD) return FAR
  const ax = px[bs], ay = py[bs], dx = px[bs + 1] - ax, dy = py[bs + 1] - ay, l2 = dx * dx + dy * dy || 1, t = clamp(((x - ax) * dx + (y - ay) * dy) / l2)
  return { d, s: ix.run[bs] + t * Math.sqrt(l2), side: dx * (y - ay) - dy * (x - ax) >= 0 ? 1 : -1 }
}
function simplifyIdx(p: XY[], tol: number): number[] {
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1
  const stack: [number, number][] = [[0, p.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!, [ax, ay] = p[a], [bx, by] = p[b], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1
    let bi = -1, bd = tol
    for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / l; if (d > bd) { bd = d; bi = i } }
    if (bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]) }
  }
  const out: number[] = []
  keep.forEach((k, i) => { if (k) out.push(i) })
  return out
}
export function inPoly(p: XY[], x: number, y: number) {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c
  return c
}
const rings = new WeakMap<XY[], XY[]>()
/** Signed distance to an area (negative inside): a polygon, or a circle that becomes an organic blob. */
export const areaDist = (f: { area?: XY[]; at?: XY; radius?: number }, x: number, y: number) => {
  if (!f.area) {
    const dx = x - f.at![0], dy = y - f.at![1], a = Math.atan2(dy, dx), k = (f.at![0] * 0.013 + f.at![1] * 0.007) % 6.283, r = f.radius ?? 300
    return Math.hypot(dx, dy) - r * (1 + 0.16 * Math.sin(3 * a + k) + 0.09 * Math.sin(5 * a + k * 2.3) + 0.05 * Math.sin(9 * a + k * 3.7))
  }
  let ring = rings.get(f.area)
  if (!ring) { ring = [...f.area, f.area[0]]; rings.set(f.area, ring) }
  return (inPoly(f.area, x, y) ? -1 : 1) * pathNearFast(ring, x, y, Infinity).d
}
export const polyLen = (p: XY[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0)
export const bboxOf = (d: { area?: XY[]; at?: XY; radius?: number; path?: XY[]; width?: number }): [number, number, number, number] => {
  const pts = d.area ?? d.path ?? [[d.at![0] - (d.radius ?? 300), d.at![1] - (d.radius ?? 300)], [d.at![0] + (d.radius ?? 300), d.at![1] + (d.radius ?? 300)]] as XY[], m = d.path ? (d.width ?? 100) * 2 : 0
  return [Math.min(...pts.map((p) => p[0])) - m, Math.min(...pts.map((p) => p[1])) - m, Math.max(...pts.map((p) => p[0])) + m, Math.max(...pts.map((p) => p[1])) + m]
}
/** Points every `step` metres along a polyline (the last point included). */
export function resample(path: XY[], step: number): XY[] {
  const out: XY[] = [path[0]]
  let carry = 0
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1], l = Math.hypot(bx - ax, by - ay)
    let t = step - carry
    while (t <= l) { out.push([ax + ((bx - ax) * t) / l, ay + ((by - ay) * t) / l]); t += step }
    carry = l - (t - step)
  }
  const e = path[path.length - 1], q = out[out.length - 1]
  if (Math.hypot(e[0] - q[0], e[1] - q[1]) > step * 0.25) out.push(e)
  return out
}
/** Unit normals (pointing left of the direction of travel) at each point of a polyline. */
export function normals(p: XY[]): XY[] {
  return p.map((_, i) => { const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l] as XY })
}
/** A polyline moved sideways by `off(i)` metres (positive = left). */
export const offsetPath = (p: XY[], off: (i: number) => number): XY[] => { const n = normals(p); return p.map((q, i) => [q[0] + n[i][0] * off(i), q[1] + n[i][1] * off(i)] as XY) }
/** Douglas-Peucker. */
export const simplify = (p: XY[], tol: number): XY[] => (p.length < 3 ? p : simplifyIdx(p, tol).map((i) => p[i]))
/** Moving average of a number list (window 2k+1). */
const smooth = (v: number[], k: number) => v.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - k); j <= Math.min(v.length - 1, i + k); j++) { s += v[j]; c++ } return s / c })

// ---------- rock ----------
export const ROCKS: Record<string, string> = { chalk: '#e4e0d4', limestone: '#bdb5a2', sandstone: '#c4936a', redstone: '#a65a3e', granite: '#9e9a94', basalt: '#4c4a48', slate: '#5f6369', shale: '#7d7366', tuff: '#b8a98c', travertine: '#e8dcc4' }
export const rockHex = (r: string | undefined, dflt: string) => (r?.startsWith('#') ? r : ROCKS[r ?? ''] ?? ROCKS[dflt])
/** A steep face along a line: the renderer drapes real rock over it. `high` is the side the ground rises on (+1 left). */
export interface Wall { pts: XY[]; high: 1 | -1; rock: string; face: number; sea: boolean; strata: number }
/** A free-standing rock: sea stack, arch, spire, karst tower, hoodoo, basalt columns. Heights are altitudes. */
export interface Rock { kind: 'stack' | 'arch' | 'spire' | 'tower' | 'hoodoo' | 'columns'; at: XY; to?: XY; r: number; top: number; base: number; rock: string; seed: number; green: number }

// ---------- terrain ----------
export interface Glacier { path: XY[]; total: number; top: number; end: number; w: number; t: number; prof: number[]; step: number; id: string }
export interface Flat { at: XY; r: number; level: number; id: string }
export interface TerrainFn {
  h: (x: number, y: number) => number; base: (x: number, y: number, upto?: number) => number
  flats: Flat[]; glaciers: Glacier[]; fields: TerrainFeature[]; sea: number | null
  walls: Wall[]; rocks: Rock[]; cell: number
  /** Coast or sea floor: 1 on a beach (sand), for the colours. */
  beach: (x: number, y: number) => number
  /** Volcanic ground (0..1) and hot ground (0..1) for the colours and smoke. */
  volcanic: (x: number, y: number) => number
  vents: { at: XY; r: number; active: boolean; top: number }[]
}
/** Grid cells across a place: about 12 m on a big one, finer on smaller places (down to 1.5 m), so a small scene is sharp. */
export const gridN = (size: number) => { const n = size / clamp(size / 1000, 1.5, 12); return n > 1500 ? 2048 : n > 700 ? 1024 : 512 }
const SCALE: Partial<Record<Structure['kind'], number>> = { cathedral: 1.9, basilica: 1, dome: 1 }
/** Where a structure sits and how much flat ground it needs; arcades, walls, canals, harbours and roads need none. */
export function footprint(s: Structure): { r: number; back: number } | null {
  const k = s.scale ?? SCALE[s.kind] ?? 1
  switch (s.kind) {
    case 'cathedral': return { r: 42 * k, back: 34 * k }
    case 'basilica': return { r: 80 * k, back: 42 * k }
    case 'dome': return { r: 100 * k, back: 75 * k }
    case 'church': return { r: 26 * k, back: 18 * k }
    case 'palace': return { r: Math.hypot(s.width ?? 80, s.depth ?? 64) / 2 + 8, back: (s.depth ?? 64) / 2 }
    case 'monastery': return { r: 62, back: 33 }
    case 'colonnade': return { r: (s.radius ?? 120) + 26, back: 0 }
    case 'tower': return { r: (s.width ?? 12) + 4, back: 0 }
    case 'plaza': return { r: s.radius ?? 40, back: 0 }
    case 'market': return { r: Math.hypot(s.width ?? 40, s.depth ?? 60) / 2 + 3, back: 0 }
    case 'statue': return { r: (s.height ?? 20) * 0.3 + 2, back: 0 }
    default: return null
  }
}
export const STRUCTURE_SCALE = SCALE

/** A glacier is wide in its basin and narrows to its snout, with a gently lobed edge. */
export const glacierWidth = (g: Glacier, t: number, x: number, y: number) => g.w * (1.45 - 0.8 * Math.sqrt(t)) * (1 + 0.13 * Math.sin(x * 0.0061 + y * 0.0043) + 0.09 * Math.sin(x * 0.017 - y * 0.013) + 0.05 * Math.sin(x * 0.041 + y * 0.037))

interface Compiled { bb: [number, number, number, number]; fn: (h: number, x: number, y: number) => number }
const ALL: [number, number, number, number] = [-Infinity, -Infinity, Infinity, Infinity]

export function terrainOf(doc: LocationDoc): TerrainFn {
  const s = hash(doc.seed), n1 = simplex(s), n2 = simplex(s ^ 0x5151), n3 = simplex(s ^ 0x7a7a), base = doc.base ?? 500, relief = doc.relief ?? 500
  const cell = doc.size / gridN(doc.size), sea = doc.sea ?? null, rockDefault = doc.rock
  setLineRegion(doc.size / 2 + 1500)
  const feats = doc.terrain
  const glacierOf = new Map<TerrainFeature, Glacier>(), walls: Wall[] = [], rocks: Rock[] = [], beaches: ((x: number, y: number) => number)[] = []
  const vents: TerrainFn['vents'] = [], volc: ((x: number, y: number) => number)[] = []
  const compiled: Compiled[] = []
  // the background: a domain-warped ridged range, rougher where it is high
  const background = (x: number, y: number) => {
    const wx = x + fbm(n2, x / 3000, 1, y / 3000, 3) * 900, wy = y + fbm(n2, x / 3000, 5, y / 3000, 3) * 900
    const r = ridged(n1, wx / 5200, 0, wy / 5200, 6)
    return base + relief * (r * 1.15 - 0.35) + fbm(n1, x / 500, 9, y / 500, 4) * relief * 0.06 * (0.5 + r) + ridged(n2, x / 160, 13, y / 160, 3) * relief * 0.025 * (0.3 + r)
  }
  const hb = (x: number, y: number, upto = compiled.length): number => {
    let h = background(x, y)
    for (let fi = 0; fi < upto; fi++) {
      const c = compiled[fi], b = c.bb
      if (x < b[0] || y < b[1] || x > b[2] || y > b[3]) continue
      h = c.fn(h, x, y)
    }
    return h
  }
  const along1 = (n: Noise3, sv: number, scale: number, salt: number, oct = 3) => fbm(n, sv / scale, salt, salt * 0.37, oct) * 2 // roughly -1..1
  // cirques: high mountains were carved by the ice into armchair bowls under steep headwalls; where they meet, sharp
  // aretes are left, and a summit cut from three or four sides is a horn. Mostly on the shaded (north) sides.
  interface Cirque { x: number; y: number; r: number; floor: number; top: number }
  const cirqueCut = (cs: Cirque[], p: number, x: number, y: number) => {
    for (const c of cs) {
      const dx = x - c.x, dy = y - c.y
      if (Math.abs(dx) > c.r * 1.8 || Math.abs(dy) > c.r * 1.8) continue
      const d = Math.hypot(dx, dy) * (1 + 0.18 * fbm(n3, x / (c.r * 0.8), 91, y / (c.r * 0.8), 2))
      if (d > c.r * 1.7) continue
      p = smin(p, c.floor + (d / c.r) ** 1.8 * (c.top - c.floor), 50)
    }
    return p
  }
  const glacial = (H: number) => H - base > 1100 && H > 1600
  /** The headwall round the back of a cirque, facing `toward` (the summit or the crest) is bare rock. */
  const headwall = (c: Cirque, toward: number) => walls.push({ pts: Array.from({ length: 25 }, (_, k) => { const a = toward - 1.7 + (k / 24) * 3.4; return [c.x + Math.cos(a) * c.r * 0.95, c.y + Math.sin(a) * c.r * 0.95] as XY }), high: -1, rock: rockHex(rockDefault, 'granite'), face: Math.max(cell, c.r * 0.25), sea: false, strata: 0.8 })

  feats.forEach((f, fi) => {
    const sd0 = s ^ hash(f.id)
    const box = (pad: number): [number, number, number, number] => { const [x0, y0, x1, y1] = bboxOf(f); return [x0 - pad, y0 - pad, x1 + pad, y1 + pad] }
    const add = (bb: Compiled['bb'], fn: Compiled['fn']) => compiled.push({ bb, fn })
    const noop = () => add([0, 0, -1, -1], (h) => h) // keeps feature indices aligned with `upto`
    switch (f.kind) {
      case 'peak': case 'island': {
        if (!f.at || f.height == null) return noop()
        const r = f.radius ?? (f.kind === 'island' ? 900 : 1500), H = f.height, sh = f.sharp ?? (f.kind === 'island' ? 0.9 : 1.4), [cx, cy] = f.at
        const RC = rng(sd0 ^ 0xc1c), nc = 3 + Math.floor(RC() * 2), cs: Cirque[] = !glacial(H) ? [] : Array.from({ length: nc }, (_, k) => {
          const a = Math.PI / 2 + ((k + 0.5) / nc - 0.5) * 3.6 + (RC() - 0.5) * 0.5, d = r * (0.3 + RC() * 0.1), cr = r * (0.24 + RC() * 0.08)
          const c: Cirque = { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: cr, floor: base + (H - base) * (0.45 + RC() * 0.12), top: H }
          headwall(c, a + Math.PI)
          return c
        })
        return add([cx - r * 1.3, cy - r * 1.3, cx + r * 1.3, cy + r * 1.3], (h, x, y) => {
          // warp the radius by direction so no massif is a cone
          const wx = x + fbm(n3, x / (r * 0.9), 3, y / (r * 0.9), 3) * r * 0.45, wy = y + fbm(n3, x / (r * 0.9), 8, y / (r * 0.9), 3) * r * 0.45
          const d = Math.hypot(wx - cx, wy - cy)
          if (d >= r) return h
          const t = d / r, crag = ridged(n2, x / 650, 3, y / 650, 4) - 0.5, gully = ridged(n1, x / 260, 17, y / 260, 3) - 0.55
          const prof = f.kind === 'island' ? (1 - t * t) ** (1 + sh) : (1 - t) ** sh
          const p = lerp(h, H + (crag * 0.14 + gully * 0.07) * Math.max(0, H - base) * (1 - t) * (f.kind === 'island' ? 0.4 : 1), prof)
          return cs.length ? cirqueCut(cs, smax(h, p, 1 + 150 * (1 - t)), x, y) : smax(h, p, 1 + 150 * (1 - t))
        })
      }
      case 'ridge': {
        if (!f.path || f.height == null) return noop()
        const w = f.width ?? 900, H = f.height, total = polyLen(f.path)
        // cirques along both flanks, mostly the shaded one, a couple of kilometres apart
        const RC = rng(sd0 ^ 0xc1c), cs: Cirque[] = []
        const sp = resample(f.path, 1700)
        if (glacial(H)) for (let k = 1; k < sp.length - 1; k++) {
          if (RC() < 0.2) continue
          const p = sp[k], q = sp[k + 1], o = sp[k - 1], dx = q[0] - o[0], dy = q[1] - o[1], l = Math.hypot(dx, dy) || 1
          let sg = RC() < 0.5 ? 1 : -1
          if ((dx / l) * sg < 0 && RC() < 0.7) sg = -sg // the left flank faces north on an eastward ridge: prefer the shaded side
          const d = w * (0.32 + RC() * 0.12)
          const c: Cirque = { x: p[0] - (dy / l) * d * sg, y: p[1] + (dx / l) * d * sg, r: w * (0.26 + RC() * 0.08), floor: base + (H - base) * (0.42 + RC() * 0.12), top: H }
          cs.push(c); headwall(c, Math.atan2(p[1] - c.y, p[0] - c.x))
        }
        return add(box(w * 1.5), (h, x, y) => {
          const n = pathNear(f.path!, x + fbm(n3, x / 1800, 2, y / 1800, 2) * w * 0.4, y + fbm(n3, x / 1800, 6, y / 1800, 2) * w * 0.4)
          const ww = w * (0.75 + 0.5 * (along1(n3, n.s, 2600, 11) * 0.5 + 0.5))
          if (n.d >= ww) return h
          const t = n.d / ww, ends = sstep(0, ww * 0.8, n.s) * sstep(0, ww * 0.8, total - n.s)
          // the crest rises and falls in a few distinct summits and cols, not a row of equal teeth
          const crest = H * (0.8 + 0.2 * along1(n2, n.s, 1700, 7) + 0.07 * along1(n2, n.s, 520, 9)), gully = ridged(n1, x / 240, 19, y / 240, 3) - 0.55
          const p = lerp(h, crest + gully * (H - base) * 0.08 * (1 - t), ((1 - t) ** (f.sharp ?? 1.3)) * (0.35 + 0.65 * ends))
          return cs.length ? cirqueCut(cs, smax(h, p, 1 + 120 * (1 - t)), x, y) : smax(h, p, 1 + 120 * (1 - t))
        })
      }
      case 'valley': { // the floor falls from `height` at the start to `end` (default the same) at the end of the path
        if (!f.path || f.height == null) return noop()
        const w = f.width ?? 500, fl = f.edge ?? 0, h1 = f.end ?? f.height
        // no valley runs straight: its axis winds in long bends (about six widths), pinned at both ends
        const raw = resample(f.path, 20), rl = polyLen(raw) || 1, wob = f.meander ?? 1
        const offs = smooth(raw.map((_, i) => wob * w * 0.32 * along1(n2, i * 20, w * 6, 131 + fi) * sstep(0, w, i * 20) * sstep(0, w, rl - i * 20)), 3)
        const axis = offsetPath(raw, (i) => offs[i]), total = polyLen(axis) || 1
        return add(box(w * 3 + fl + w * 0.4), (h, x, y) => {
          const n = pathNearFast(axis, x, y, w * 3 + fl + 50)
          if (n.d === Infinity) return h
          if (n.d > w * 3 + fl) return h
          return smin(h, lerp(f.height!, h1, clamp(n.s / total)) + (Math.max(0, n.d - fl) / w) ** 2 * 900 + fbm(n2, x / 300, 2, y / 300, 2) * (fl ? 6 : 15), 90)
        })
      }
      case 'plateau': case 'mesa': {
        if (f.height == null || !(f.area || f.at)) return noop()
        const mesa = f.kind === 'mesa', e = f.edge ?? (mesa ? 30 : 150), cap = f.depth ?? (mesa ? Math.max(20, (f.height - base) * 0.35) : 0)
        if (mesa) walls.push({ pts: outline(f), high: ccw(outline(f)) ? 1 : -1, rock: rockHex(f.rock ?? rockDefault, 'sandstone'), face: Math.max(cell, cap * 0.25), sea: false, strata: 1 })
        return add(box(e + (mesa ? (f.height - base) * 2.5 : 0) + 50), (h, x, y) => {
          const sdv = areaDist(f, x, y) + (mesa ? fbm(n2, x / 160, 31, y / 160, 3) * 40 : 0)
          if (!mesa) return sdv < e ? lerp(h, f.height! + fbm(n2, x / 200, 4, y / 200, 2) * 4, sstep(e, 0, sdv)) : h
          // cap rock: a flat top that ends in a sheer face, then a talus slope down to the plain
          const top = f.height! + fbm(n2, x / 300, 4, y / 300, 2) * 3, apron = (f.height! - cap - h) * 2.2
          if (sdv <= 0) return Math.max(h, top)
          const fw = Math.max(cell, cap * 0.25)
          if (sdv < fw) return Math.max(h, lerp(top, top - cap, sstep(0, fw, sdv)))
          if (apron <= 0) return h
          return Math.max(h, lerp(top - cap, h, clamp((sdv - fw) / apron) ** 0.7)) // talus: steep under the cliff, flattening out
        })
      }
      case 'cliff': { // an escarpment: the low side drops, the edge wanders in spurs and re-entrants, talus gathers at the foot
        if (!f.path || f.path.length < 2) return noop()
        const wob = f.meander ?? 1, drop = f.drop ?? 120, ext = f.extent ?? 1600, lowLeft = f.side === 'left'
        const pts = resample(f.path, 8), offs = smooth(pts.map((_, i) => wob * (220 * along1(n2, i * 8, 900, 27 + fi) + 45 * along1(n3, i * 8, 170, 23 + fi))), 2)
        const edge = offsetPath(pts, (i) => offs[i]), total = polyLen(edge), fw = Math.max(cell * 0.9, drop * 0.12)
        walls.push({ pts: edge, high: lowLeft ? -1 : 1, rock: rockHex(f.rock ?? rockDefault, 'limestone'), face: fw, sea: false, strata: 1 })
        return add(ALL, (h, x, y) => {
          const n = pathNearFast(edge, x, y, ext + 100)
          if (n.d === Infinity || n.s < 1 || n.s > total - 1) return h
          const sd = n.d * n.side * (lowLeft ? 1 : -1) // positive on the low side
          if (sd < -fw) return h
          const ends = sstep(0, 220, n.s) * sstep(0, 220, total - n.s), fade = 1 - sstep(ext * 0.5, ext, sd)
          let dv = drop * sstep(-fw * 0.5, fw * 0.5, sd) * fade * ends
          if (sd > fw * 0.5) dv -= drop * 0.22 * Math.max(0, 1 - (sd - fw * 0.5) / (drop * 0.7)) ** 2 * ends * fade // talus apron
          return h - dv
        })
      }
      case 'coast': {
        if (!f.path || f.path.length < 2 || sea == null) return noop()
        const c = coastOf(f, fi)
        beaches.push(c.beach)
        return add(ALL, c.fn)
      }
      case 'gorge': {
        if (!f.path || f.path.length < 2) return noop()
        const w = f.width ?? 70, depth = f.depth ?? 160, path = resample(f.path, 6)
        for (const sg of [1, -1] as const) walls.push({ pts: offsetPath(path, () => sg * w * 0.36), high: sg, rock: rockHex(f.rock ?? rockDefault, 'limestone'), face: Math.max(4, w * 0.12), sea: false, strata: 0.6 })
        return add(box(w * 1.2), (h, x, y) => {
          const d = pathNearFast(path, x, y, w).d
          if (d > w) return h
          return h - depth * (1 - sstep(w * 0.26, w * 0.46, d + fbm(n2, x / 80, 25, y / 80, 3) * w * 0.12))
        })
      }
      case 'glacier': {
        if (!f.path || f.path.length < 2) return noop()
        const w = f.width ?? 380
        return add(box(w * 4), (h, x, y) => {
          const G = glacierAt(f, fi), n = pathNearFast(G.path, x, y, G.w * 3.6)
          if (n.d > G.w * 3.6) return h
          if (n.s >= G.total - 1) { const e = Math.hypot(x - G.path[G.path.length - 1][0], y - G.path[G.path.length - 1][1]) / G.w; return e < 1.4 ? h + 14 * Math.max(0, Math.sin(Math.PI * clamp((e - 0.5) / 0.8))) : h } // a terminal moraine round the snout
          const t = clamp(n.s / G.total), gw = glacierWidth(G, t, x, y)
          const kq = clamp(n.s / G.step, 0, G.prof.length - 1.001), bed = lerp(G.prof[Math.floor(kq)], G.prof[Math.floor(kq) + 1], kq % 1) + fbm(n2, x / 300, 21, y / 300, 2) * 4
          // ice thickness grows out of the basin and thins to nothing at the snout, so the tongue lies in its valley
          const thick = G.t * (0.5 + 0.5 * sstep(0, 500, n.s)) * (1 - sstep(G.total - 450, G.total + 20, n.s))
          // a U-shaped trough: the bed a little below the floor, walls rising straight out of the ice (steepest at the trimline)
          const q = n.d / gw, trough = q < 1 ? bed - G.t * 0.25 * (1 - q ** 4) : bed + ((n.d - gw) / (gw * 0.55)) ** 2 * 650
          h = smin(h, trough, 40)
          const head = n.s < G.w * 1.4 ? 1 - n.s / (G.w * 1.4) : 0 // the cirque: a bowl under a headwall at the glacier's head
          if (head > 0) h = smin(h, bed + 25 * head + (n.d / (gw * 1.25)) ** 2 * 450, 60)
          if (q < 1) h = Math.max(h, bed + thick * Math.sqrt(1 - q * q) - 2 * sstep(0.85, 1, q)) // a convex ice surface
          else if (q < 2.4) h = Math.max(h, bed + thick + 4 - (q - 1) ** 1.5 * gw * 0.09) + 9 * Math.sin(((q - 1) / 0.3) * Math.PI) * (q < 1.3 ? 0.4 + 0.6 * t : 0) // banks: the ice always lies in a channel, lateral moraines on its rim
          return h
        })
      }
      case 'fields': {
        if (!(f.area || f.at) || !(f.crop === 'vines' || f.crop === 'terraces' || f.crop === 'olives')) return noop()
        return add(box(50), (h, x, y) => { // terraces stepped into the slope
          const sdv = areaDist(f, x, y)
          if (sdv >= 40) return h
          const st = f.step ?? 3.5, q = h / st, t = q - Math.floor(q)
          return lerp(h, (Math.floor(q) + sstep(0.78, 1, t)) * st, sstep(40, -10, sdv))
        })
      }
      case 'volcano': {
        if (!f.at || f.height == null) return noop()
        const r = f.radius ?? 4000, H = f.height, [cx, cy] = f.at, cr = f.crater ?? r * (f.caldera ? 0.3 : 0.07), cd = f.depth ?? (f.caldera ? (H - base) * 0.35 : cr * 0.6)
        vents.push({ at: f.at, r: cr, active: !!f.active, top: H })
        if (f.caldera) walls.push({ pts: ring(f.at, cr * 1.02, 64, n2, sd0), high: -1, rock: rockHex(f.rock ?? rockDefault, 'basalt'), face: Math.max(cell, cd * 0.2), sea: false, strata: 1.4 })
        volc.push((x, y) => 1 - sstep(r * (f.active ? 0.4 : 0.25), r * (f.active ? 0.62 : 0.45), Math.hypot(x - cx, y - cy))) // bare ash on the upper cone; forest takes the old flanks
        const R = rng(sd0), cones = Array.from({ length: f.cones ?? 3 }, () => { const a = R() * Math.PI * 2, d = r * (0.35 + R() * 0.35); return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: r * (0.06 + R() * 0.06), h: (H - base) * (0.06 + R() * 0.08) } })
        return add([cx - r, cy - r, cx + r, cy + r], (h, x, y) => {
          const d = Math.hypot(x - cx, y - cy)
          if (d >= r) return h
          const t = d / r, a = Math.atan2(y - cy, x - cx)
          // concave flanks (lava and ash pile up steepest near the top), radial gullies (barrancos) cut by rain
          const prof = (Math.exp(-3.2 * t) - Math.exp(-3.2)) / (1 - Math.exp(-3.2))
          const gullies = (ridged(n2, Math.cos(a) * 9, Math.sin(a) * 9, d / 900, 3) - 0.5) * (H - base) * 0.05 * t * (1 - t) * 4
          let p = lerp(h, H + gullies, prof)
          for (const c of cones) { const dc = Math.hypot(x - c.x, y - c.y); if (dc < c.r) p += c.h * (1 - dc / c.r) ** 1.6 - (dc < c.r * 0.25 ? c.h * 0.4 * (1 - dc / (c.r * 0.25)) : 0) }
          // the crater: a rim, then a bowl (or a sheer-walled caldera with a flat floor)
          if (d < cr * 1.6) {
            const top = lerp(h, H, (Math.exp(-3.2 * cr / r) - Math.exp(-3.2)) / (1 - Math.exp(-3.2)))
            if (f.caldera) { const floor = top - cd + fbm(n2, x / 300, 41, y / 300, 2) * 8; p = d < cr ? floor + (d / cr) ** 6 * cd * 0.15 : Math.max(p, lerp(top, p, sstep(cr, cr * 1.6, d))) }
            else p = d < cr ? top - cd * (1 - (d / cr) ** 2) : Math.max(p, top + (1 - sstep(cr, cr * 1.6, d)) * cr * 0.08)
          }
          return smax(h, p, 1 + 80 * (1 - t))
        })
      }
      case 'crater': { // an explosion or impact crater: raised rim, bowl, maybe a lake (add a lake at its centre)
        if (!f.at) return noop()
        const r = f.radius ?? 400, depth = f.depth ?? r * 0.25, [cx, cy] = f.at
        return add([cx - r * 2, cy - r * 2, cx + r * 2, cy + r * 2], (h, x, y) => {
          const d = Math.hypot(x - cx, y - cy) * (1 + fbm(n2, x / r, 51, y / r, 2) * 0.12)
          if (d > r * 2) return h
          const rim = r * 0.12 * Math.exp(-(((d - r) / (r * 0.28)) ** 2))
          return d < r ? h + rim - depth * (1 - (d / r) ** 2) : h + rim
        })
      }
      case 'dunes': { // a sand sea: transverse ridges across the wind, crests that bend and break
        if (!(f.area || f.at)) return noop()
        const amp = f.height ?? 18, wl = f.step ?? 180, a = ((f.angle ?? 90) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a)
        beaches.push((x, y) => (areaDist(f, x, y) < 0 ? 1 : 0))
        return add(box(60), (h, x, y) => {
          const sdv = areaDist(f, x, y)
          if (sdv > 60) return h
          const u = x * ca + y * sa + fbm(n2, x / 700, 61, y / 700, 3) * wl * 1.2, v = -x * sa + y * ca, ph = (u / wl + fbm(n3, v / 900, 3, 0, 2)) % 1
          const dune = (ph < 0 ? ph + 1 : ph), prof = dune < 0.7 ? dune / 0.7 : (1 - dune) / 0.3 // gentle windward slope, steep slip face
          return h + amp * prof ** 1.5 * (0.6 + 0.4 * fbm(n2, v / 500, 5, u / 1500, 2) * 2) * sstep(60, -100, sdv)
        })
      }
      case 'canyon': { // a stepped canyon: rim, cliff bands and benches down to the river
        if (!f.path || f.path.length < 2) return noop()
        const w = f.width ?? 1200, depth = f.depth ?? 600, steps = Math.max(1, Math.round(f.step ?? 3)), path = resample(f.path, 10)
        const wig = (sv: number) => along1(n2, sv, 600, 70) * 0.05
        // the cliff band of step k lies where q = (k + 0.8) / (steps + 1); the walls follow it exactly
        for (let k = 0; k <= steps; k++) for (const sg of [1, -1] as const) walls.push({ pts: offsetPath(path, (i) => sg * (1 - (k + 0.8) / (steps + 1) + wig(i * 10)) * w * 0.5), high: sg, rock: rockHex(f.rock ?? rockDefault, 'redstone'), face: Math.max(cell, (depth / (steps + 1)) * 0.3), sea: false, strata: 1.5 })
        return add(box(w * 0.6), (h, x, y) => {
          const n = pathNearFast(path, x, y, w * 0.55)
          if (n.d === Infinity) return h
          const q = clamp(1 - n.d / (w * 0.5) + wig(n.s)), level = q * (steps + 1), k = Math.floor(level), t = level - k
          return h - depth * Math.min(1, (k + sstep(0.65, 0.95, t)) / (steps + 1))
        })
      }
      case 'fjord': { // a drowned glacial trough: a long sea inlet, deep and U-shaped, walled by sheer granite
        if (!f.path || f.path.length < 2 || sea == null) return noop()
        const w = f.width ?? 900, depth = f.depth ?? 220, path = resample(f.path, 10), total = polyLen(path)
        for (const sg of [1, -1] as const) walls.push({ pts: offsetPath(path, (i) => sg * w * (0.4 + 0.05 * along1(n2, i * 10, 700, 120 + fi))), high: sg, rock: rockHex(f.rock ?? rockDefault, 'granite'), face: Math.max(cell, w * 0.06), sea: true, strata: 0.5 })
        return add(box(w * 1.2), (h, x, y) => {
          const n = pathNearFast(path, x, y, w)
          if (n.d === Infinity) return h
          const q = n.d / (w * (0.4 + 0.05 * along1(n2, n.s, 700, 120 + fi))), head = sstep(total, total - w * 1.5, n.s) // shallower toward its head
          const floor = sea - depth * (0.35 + 0.65 * head), trough = q < 0.75 ? floor + (q / 0.75) ** 2 * (sea - floor) * 0.6 : lerp(floor + (sea - floor) * 0.6, h + 30, sstep(0.75, 1.05, q))
          return Math.min(h, trough)
        })
      }
      case 'geyser': { // a low sinter mound around a vent (the steam is drawn by the renderer)
        if (!f.at) return noop()
        const r = f.radius ?? 30, [cx, cy] = f.at
        vents.push({ at: f.at, r: 4, active: false, top: 0 })
        return add([cx - r, cy - r, cx + r, cy + r], (h, x, y) => { const d = Math.hypot(x - cx, y - cy); return d < r ? h + 4 * (1 - d / r) ** 2 - (d < 3 ? 2 : 0) : h })
      }
      case 'stack': case 'arch': case 'spire': case 'karst': case 'hoodoos': case 'columns': {
        rocksOf(f, sd0)
        if (f.kind !== 'columns' && f.kind !== 'karst') return noop()
        // karst plains sink between the towers; basalt columns raise a stepped pavement
        return add(box(40), (h, x, y) => {
          const sdv = areaDist(f, x, y)
          if (sdv > 40) return h
          return f.kind === 'karst' ? h - (f.depth ?? 15) * sstep(40, -60, sdv) : h + 2 * sstep(40, -10, sdv)
        })
      }
      default: return noop()
    }
  })

  // ----- coasts: hard rock juts out in headlands with cliffs, soft rock retreats into bays with beaches -----
  function coastOf(f: TerrainFeature, fi: number) {
    const H = f.height ?? 60, depth = f.depth ?? 45, bays = f.bays ?? 1, ext = f.extent ?? 900, step = 8, style = f.style ?? 'mixed'
    const bias = { cliffs: 0.28, rocky: 0.12, mixed: 0, beach: -0.55, fjord: 0.35 }[style] ?? 0
    // extend the ends off the map so the sea never stops in mid-air
    const P = f.path!, e0 = P[0], e1 = P[1], z0 = P[P.length - 1], z1 = P[P.length - 2], far = doc.size * 2
    const d0 = Math.hypot(e0[0] - e1[0], e0[1] - e1[1]) || 1, d1 = Math.hypot(z0[0] - z1[0], z0[1] - z1[1]) || 1
    const outA: XY = [e0[0] + ((e0[0] - e1[0]) / d0) * far, e0[1] + ((e0[1] - e1[1]) / d0) * far], outB: XY = [z0[0] + ((z0[0] - z1[0]) / d1) * far, z0[1] + ((z0[1] - z1[1]) / d1) * far]
    const pts = resample([outA, ...P, outB], step)
    const hardL = pts.map((_, i) => along1(n2, i * step, 1300, 90 + fi)), hard = pts.map((_, i) => clamp(0.5 + 0.55 * hardL[i] + 0.3 * along1(n3, i * step, 230, 93 + fi) + bias))
    // headlands where the rock is hard, bays where it is soft; coves at a smaller scale; never folding back on itself
    let offs = pts.map((_, i) => bays * (320 * hardL[i] + 75 * along1(n3, i * step, 300, 97 + fi) + 25 * along1(n1, i * step, 110, 99 + fi)))
    offs = smooth(offs, 2)
    for (let i = 1; i < offs.length; i++) offs[i] = clamp(offs[i], offs[i - 1] - step * 0.7, offs[i - 1] + step * 0.7)
    // sea on the right: a positive offset pushes the shore seaward (to the right)
    const shore = offsetPath(pts, (i) => -offs[i])
    // cliffs on hard rock, beaches in the soft bays, never both at once
    const Hc = smooth(hard.map((v, i) => H * sstep(0.42, 0.66, v) * (0.75 + 0.45 * (along1(n2, i * step, 500, 101 + fi) * 0.5 + 0.5))), 3)
    const beachW = smooth(hard.map((v) => 1 - sstep(0.2, 0.38, v)), 3), platW = hard.map((v) => 15 + 110 * v * v)
    const at = (sv: number, arr: number[]) => { const k = clamp(sv / step, 0, arr.length - 1.001), i = Math.floor(k); return lerp(arr[i], arr[i + 1], k - i) }
    // the rest of the sea: a lazily cached inside test on a simplified closure
    const closure = simplify([...shore, ...rightLoop(outA, outB, doc.size * 40)], 30) // closed far away round the sea side
    const sideCache = new Map<number, boolean>(), maxD = ext + 700
    const seaSide = (x: number, y: number) => { const k = Math.floor(x / 64) * 1000003 + Math.floor(y / 64); let v = sideCache.get(k); if (v == null) { v = inPoly(closure, x, y); sideCache.set(k, v) } return v }
    // the faces, for real rock; only where the cliff is tall enough to show
    const rock = rockHex(f.rock ?? rockDefault, style === 'fjord' ? 'granite' : 'limestone')
    // in the soft bays the sea has cut back further: a beach (up to 70 m) lies at the foot of the cliff, which stands
    // wherever the land behind is high; only low land runs down to its beach in a gentle slope
    const nrS = normals(shore), setB = beachW.map((v) => v * 70)
    const behind = shore.map((p, i) => (Math.abs(p[0]) < doc.size / 2 + 600 && Math.abs(p[1]) < doc.size / 2 + 600 ? hb(p[0] + nrS[i][0] * (setB[i] + 120), p[1] + nrS[i][1] * (setB[i] + 120), fi) - sea! : 0))
    const backH = smooth(behind.map((v, i) => Math.max(0, Math.min(v, H * 2.5)) * sstep(0.05, 0.4, beachW[i])), 3)
    let run: XY[] = [], runF = 0
    shore.forEach((p, i) => {
      const inMap = Math.abs(p[0]) < doc.size / 2 + 400 && Math.abs(p[1]) < doc.size / 2 + 400, ch = Math.max(Hc[i], backH[i] > 18 ? backH[i] : 0)
      if (ch > 7 && inMap) { run.push([p[0] + nrS[i][0] * setB[i], p[1] + nrS[i][1] * setB[i]]); runF = Math.max(runF, Math.max(cell * 0.9, ch * 0.14)) }
      else { if (run.length > 4) walls.push({ pts: run, high: 1, rock, face: runF, sea: true, strata: 1 }); run = []; runF = 0 }
    })
    if (run.length > 4) walls.push({ pts: run, high: 1, rock, face: runF, sea: true, strata: 1 })
    // sea stacks and the odd arch off the hardest headlands
    const R = rng(s ^ hash(f.id) ^ 0x57ac), dens = f.stacks ?? (style === 'cliffs' ? 1 : style === 'beach' ? 0 : 0.6)
    const nr = normals(shore)
    for (let i = 20; i < shore.length - 20; i++) {
      const p = shore[i], inMap = Math.abs(p[0]) < doc.size / 2 - 50 && Math.abs(p[1]) < doc.size / 2 - 50
      if (!inMap || hard[i] < 0.68 || Hc[i] < 12 || offs[i] < Math.max(...offs.slice(i - 20, i + 21)) - 1e-6) continue // the tip of a headland
      const n = R() < dens ? 1 + Math.floor(R() * 3 * dens) : 0
      for (let k = 0; k < n; k++) {
        const u = 22 + R() * 130, j = clamp(i + Math.round((R() - 0.5) * 10), 0, shore.length - 1), q = shore[j], at2: XY = [q[0] - nr[j][0] * u, q[1] - nr[j][1] * u]
        const top = sea! + Hc[i] * (0.4 + R() * 0.55), check = pathNearFast(shore, at2[0], at2[1], 400)
        if (check.d < 14 || check.side > 0) continue // a stack stands in the sea, clear of the shore
        if (k === 0 && R() < 0.25 * dens) rocks.push({ kind: 'arch', at: [q[0] - nr[j][0] * 6, q[1] - nr[j][1] * 6], to: at2, r: 9 + R() * 10, top, base: sea! - depth * 0.3, rock, seed: R() * 1e6, green: 1 })
        else rocks.push({ kind: 'stack', at: at2, r: 5 + R() * (u > 80 ? 22 : 14), top, base: sea! - depth * 0.3, rock, seed: R() * 1e6, green: top - sea! > 15 ? 1 : 0 })
      }
    }
    const stackBase = rocks.filter((r) => r.kind === 'stack' || r.kind === 'arch')
    const fn = (h: number, x: number, y: number) => {
      const n = pathNearFast(shore, x, y, maxD)
      if (n.d === Infinity) return seaSide(x, y) ? sea! - depth + fbm(n2, x / 900, 71, y / 900, 3) * depth * 0.4 : h
      const sv = n.s, sd = n.d * n.side // positive inland (left)
      const hc = at(sv, Hc), bw = at(sv, beachW), pw = at(sv, platW), set = at(sv, setB)
      if (sd >= 0) {
        // the land behind: raised to the cliff top near the sea (never lowered)
        const plateau = sea! + hc + sd * 0.025 + fbm(n2, x / 140, 73, y / 140, 2) * 2.5
        const land = h + Math.max(0, plateau - h) * (1 - sstep(ext * 0.35, ext, sd))
        const beachTop = sea! + 0.4 + sd * (0.03 + 0.03 * (1 - bw)) + fbm(n2, x / 60, 75, y / 60, 2) * 0.5
        // low land: a gentle slope down to the beach
        const ramp = lerp(land, Math.min(land, beachTop), bw * (1 - sstep(60, 260, sd)))
        // high land: the cliff, set back behind the bay's beach, rounded at the top
        const s2 = sd - set, fwv = Math.max(cell * 0.9, (land - sea!) * 0.14)
        let cliff = sd < set ? Math.min(land, beachTop) : land
        if (sd >= set && s2 < fwv && land - sea! > 3) { const t = s2 / fwv; cliff = lerp(set > 1 ? beachTop : sea! - 1.5, land, 1 - (1 - t) ** 2.2) }
        return lerp(ramp, cliff, Math.max(sstep(3, 8, hc), sstep(12, 24, land - sea!)))
      }
      const u = -sd, rough = fbm(n1, x / 35, 77, y / 35, 3)
      // a wave-cut platform below cliffs (rocks awash at its edge), a gently shelving shore below beaches, then the deep
      const cliffSea = u < pw ? sea! - 0.7 - 1.6 * (u / pw) + rough * 2.2 : sea! - 2.4 - (depth - 2.4) * sstep(pw, pw + 650, u) + rough * 4
      const beachSea = sea! + 0.4 - u * 0.022 - (depth * 0.6) * sstep(80, 1100, u)
      let v = lerp(cliffSea, beachSea, bw)
      for (const r of stackBase) { const dr = Math.hypot(x - r.at[0], y - r.at[1]); if (dr < r.r * 2.2) v = Math.max(v, lerp(sea! - 0.5, v, sstep(r.r * 0.8, r.r * 2.2, dr))) }
      return Math.min(v, h)
    }
    const beach = (x: number, y: number) => { const n = pathNearFast(shore, x, y, 260); if (n.d === Infinity) return 0; const set = at(n.s, setB); return at(n.s, beachW) * (1 - sstep(Math.max(set + 4, 80 * (1 - sstep(10, 40, set))), Math.max(set + 25, 240 * (1 - sstep(10, 40, set))), n.d * n.side)) }
    return { fn, beach }
  }
  /** Back around on the right-hand side, far away, to close the sea polygon. */
  function rightLoop(a: XY, b: XY, far: number): XY[] {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, rx = dy / l, ry = -dx / l
    return [[b[0] + rx * far, b[1] + ry * far], [a[0] + rx * far, a[1] + ry * far]]
  }
  function outline(f: TerrainFeature): XY[] {
    if (f.area) return resample([...f.area, f.area[0]], 8)
    const pts: XY[] = []
    for (let k = 0; k <= 160; k++) {
      const a = (k / 160) * Math.PI * 2, r = (f.radius ?? 300)
      // walk outward from the centre to the blob's edge
      let lo = 0, hi = r * 1.6
      for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (areaDist(f, f.at![0] + Math.cos(a) * m, f.at![1] + Math.sin(a) * m) < 0) lo = m; else hi = m }
      pts.push([f.at![0] + Math.cos(a) * lo, f.at![1] + Math.sin(a) * lo])
    }
    return pts
  }
  /** Counter-clockwise outlines have their inside on the left. */
  function ccw(o: XY[]) { let a = 0; for (let i = 0; i < o.length - 1; i++) a += o[i][0] * o[i + 1][1] - o[i + 1][0] * o[i][1]; return a > 0 }
  function ring(c: XY, r: number, n: number, nz: Noise3, salt: number): XY[] {
    return Array.from({ length: n + 1 }, (_, k) => { const a = (k / n) * Math.PI * 2, rr = r * (1 + 0.08 * nz(Math.cos(a) * 2, Math.sin(a) * 2, salt % 97)); return [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr] as XY })
  }
  /** Free-standing rocks: explicit stacks, arches and spires, or fields of karst towers, hoodoos and basalt columns. */
  function rocksOf(f: TerrainFeature, salt: number) {
    const R = rng(salt), rock = rockHex(f.rock ?? rockDefault, f.kind === 'columns' ? 'basalt' : f.kind === 'hoodoos' ? 'redstone' : 'limestone')
    const ground = (x: number, y: number) => hb(x, y, feats.indexOf(f))
    if (f.kind === 'stack' || f.kind === 'spire' || f.kind === 'arch') {
      if (!f.at) return
      const g = Math.min(ground(...f.at), sea ?? Infinity) - 3
      rocks.push({ kind: f.kind, at: f.at, to: f.to, r: f.radius ?? (f.kind === 'spire' ? 12 : 18), top: (f.height ?? 40) + (sea != null && f.kind !== 'spire' ? sea : g + 3), base: g, rock, seed: R() * 1e6, green: f.kind === 'spire' ? 0.3 : 1 })
      return
    }
    if (!(f.area || f.at)) return
    const [x0, y0, x1, y1] = bboxOf(f), dens = f.density ?? 1
    const spacing = f.kind === 'columns' ? 2.2 : f.kind === 'karst' ? 230 / Math.sqrt(dens) : 60 / Math.sqrt(dens)
    for (let y = y0; y < y1; y += spacing * (f.kind === 'columns' ? 0.87 : 1)) for (let x = x0; x < x1; x += spacing) {
      const odd = f.kind === 'columns' && Math.round((y - y0) / (spacing * 0.87)) % 2 ? spacing / 2 : 0
      const px = x + odd + (f.kind === 'columns' ? 0 : (R() - 0.5) * spacing * 0.8), py = y + (f.kind === 'columns' ? 0 : (R() - 0.5) * spacing * 0.8)
      const sdv = areaDist(f, px, py)
      if (sdv > 0 || (f.kind !== 'columns' && R() > 0.85)) continue
      const g = ground(px, py), edge = sstep(0, -60, sdv)
      if (f.kind === 'karst') { const ht = (f.height ?? 160) * (0.45 + R() * 0.7) * (0.4 + 0.6 * edge); rocks.push({ kind: 'tower', at: [px, py], r: ht * (0.22 + R() * 0.18), top: g + ht, base: Math.min(g, sea ?? g) - 4, rock, seed: R() * 1e6, green: 1 }) }
      else if (f.kind === 'hoodoos') { const ht = (f.height ?? 25) * (0.4 + R() * 0.8); rocks.push({ kind: 'hoodoo', at: [px, py], r: ht * 0.12 + 1, top: g + ht, base: g - 2, rock, seed: R() * 1e6, green: 0 }) }
      else { const ht = (f.height ?? 6) * (0.15 + 0.85 * (1 - Math.abs(fbm(n2, px / 40, 81, py / 40, 2)) * 2)) * edge; if (ht > 0.3) rocks.push({ kind: 'columns', at: [px, py], r: spacing * 0.55, top: Math.max(g, sea ?? -1e9) + ht, base: Math.min(g, sea ?? g) - 3, rock, seed: R() * 1e6, green: 0 }) }
    }
  }
  function glacierAt(f: TerrainFeature, fi: number): Glacier {
    let g = glacierOf.get(f)
    if (g) return g
    const top = f.level ?? hb(f.path![0][0], f.path![0][1], fi)
    // a glacier flows down the valley it finds between its waypoints (unless follow is false)
    const route = () => { const [x0, y0, x1, y1] = bboxOf({ path: f.path, width: 700 }); return routeLine((x, y) => hb(x, y, fi), [x0, y0, x1, y1], 30, f.path!, Math.max(500, polyLen(f.path!) * 0.12)) }
    let path = f.follow === false ? meanderPath(f.path!, (f.width ?? 380) * 0.5, 0.6, s ^ hash(f.id)) : route()
    const step = 20, raw: number[] = []
    // the bed follows the valley floor down (never rising), smoothed; if a snout altitude is given, the ice ends there
    let low = Infinity
    const pts = resample(path, step)
    for (const p of pts) { low = Math.min(low, hb(p[0], p[1], fi)); raw.push(low) }
    // ice flows gently: its bed falls along a smooth concave profile from the cirque to the snout altitude, carving its
    // trough into the mountain wherever the ground stands higher than that
    const foot = f.height ?? raw[raw.length - 1], cut = f.height != null ? raw.findIndex((v) => v < foot) : -1 // the ice ends where the valley drops below its snout
    if (cut > 8) { raw.length = cut; pts.length = cut }
    const head = raw[0] - 40, n = raw.length - 1
    const bed = raw.map((v, i) => Math.min(v, lerp(head, foot, (i / Math.max(1, n)) ** 0.8))).map((_, i, a) => { let s = 0, c = 0; for (let k = Math.max(0, i - 6); k <= Math.min(n, i + 6); k++) { s += a[k]; c++ } return s / c })
    path = pts
    g = { path, total: polyLen(path), top, end: bed[bed.length - 1], w: f.width ?? 380, t: f.depth ?? 70, prof: bed, step, id: f.id }
    glacierOf.set(f, g)
    return g
  }
  const flats: Flat[] = doc.structures.flatMap((st) => {
    const fp = footprint(st)
    if (!fp || !st.at) return []
    const at: XY = [st.at[0], st.at[1]]
    return [{ id: st.id, at, r: fp.r, level: st.level ?? hb(at[0], at[1]) }]
  })
  const glaciers = feats.flatMap((f, fi) => (f.kind === 'glacier' && f.path && f.path.length > 1 ? [glacierAt(f, fi)] : []))
  const h = (x: number, y: number) => {
    let v = hb(x, y)
    for (const f of flats) {
      const dx = x - f.at[0], dy = y - f.at[1], e = 30 + f.r * 0.4
      if (Math.abs(dx) > f.r + e || Math.abs(dy) > f.r + e) continue
      const d = Math.hypot(dx, dy)
      if (d < f.r + e) v = lerp(v, f.level, sstep(f.r + e, f.r, d))
    }
    return v
  }
  return {
    h, base: hb, flats, glaciers, fields: feats.filter((f) => f.kind === 'fields' && (f.area || f.at)), sea, walls, rocks, cell, vents,
    beach: (x, y) => { let b = 0; for (const fn of beaches) b = Math.max(b, fn(x, y)); return b },
    volcanic: (x, y) => { let v = 0; for (const fn of volc) v = Math.max(v, fn(x, y)); return v },
  }
}

/** Bend a line into gentle wiggles (glaciers), keeping its ends in place. */
export function meanderPath(path: XY[], width: number, amount: number, seed: number): XY[] {
  if (!amount) return path
  const n = simplex(seed), out: XY[] = [], total = polyLen(path)
  let run = 0
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1], l = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / l, uy = (by - ay) / l
    for (let t = 0; t < l; t += 20) {
      const sv = run + t, taper = sstep(0, 160, sv) * sstep(0, 160, total - sv)
      const off = fbm(n, sv / (width * 10 + 160), 0.5, 0.3, 3) * 2.2 * width * 3 * amount * taper
      out.push([ax + ux * t - uy * off, ay + uy * t + ux * off])
    }
    run += l
  }
  out.push(path[path.length - 1])
  return out
}
