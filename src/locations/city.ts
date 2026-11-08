// Locations: a city-scale place built from a short recipe that Claude writes (the user names things).
// A location is seed + size + named terrain (peaks, ridges, valleys, cliffs, gorges, glaciers, rivers, lakes, the sea,
// plateaus, farmland) + districts (areas of one building culture, lined with streets and houses whose wealth follows
// altitude and nearness to great buildings) + structures (megastructure kits, walls, canals, harbours, roads). Main
// roads, erosion, forests by altitude and climate, farmsteads, chimneys and lamps are worked out from those.
// Everything is deterministic. Pure: node tests, the CLI and the worker run it.
// Recipe coordinates are metres from the centre, x east and y north; heights are altitudes in metres.
import { fbm, hash, ridged, rng, simplex } from '../world/noise.ts'
import { arcade, basilica, BRONZE, Builder, cathedral, cityWall, colonnade, domeChurch, harbour, lin, MARBLE, MATS, mix, monastery, palace, plaza, statue, tower, type Col, type Mat, type V } from './kit.ts'
import { carve, planRoads, RoadIndex, sampler, type Road } from './roads.ts'
import { CULTURES, farmstead, Occ, PART, placeAll, PSTRIDE, type Culture, type DistrictIn, type Out } from './buildings.ts'
import { erode } from './erode.ts'

export type XY = [number, number]
export const TERRAIN_KINDS = ['peak', 'ridge', 'valley', 'cliff', 'gorge', 'glacier', 'river', 'lake', 'plateau', 'fields'] as const
export const STRUCTURE_KINDS = ['cathedral', 'basilica', 'colonnade', 'dome', 'palace', 'monastery', 'tower', 'plaza', 'statue', 'bridge', 'aqueduct', 'wall', 'canal', 'harbour', 'road'] as const
export const MOOD_NAMES = ['morning', 'noon', 'golden', 'mist', 'dusk', 'night'] as const
export const WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'storm'] as const
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export const CROPS = ['mixed', 'wheat', 'vines', 'orchard', 'olives', 'pasture', 'lavender', 'terraces'] as const
export const CLIMATES = ['temperate', 'alpine', 'mediterranean'] as const
export type MoodName = typeof MOOD_NAMES[number]
export type Weather = typeof WEATHERS[number]
export type Season = typeof SEASONS[number]
export type Crop = typeof CROPS[number]
export type Climate = typeof CLIMATES[number]
export type { Culture }
export interface TerrainFeature {
  id: string; kind: typeof TERRAIN_KINDS[number]; name?: string; note?: string
  at?: XY; path?: XY[]; area?: XY[]
  height?: number // summit / crest / valley floor / plateau altitude / glacier tongue
  radius?: number; width?: number; level?: number; depth?: number; sharp?: number; edge?: number
  drop?: number; side?: 'left' | 'right'; extent?: number; meander?: number; crop?: Crop; angle?: number; step?: number
}
export interface District { id: string; name?: string; note?: string; area?: XY[]; at?: XY; radius?: number; density?: number; wealth?: number; steep?: boolean; culture?: Culture | 'mixed' }
export interface Structure {
  id: string; kind: typeof STRUCTURE_KINDS[number]; name?: string; note?: string
  at?: XY; to?: XY; path?: XY[]; facing?: number; scale?: number; height?: number; width?: number; depth?: number; radius?: number; span?: number
  level?: number; deck?: [number, number]; color?: string; roof?: string; statues?: boolean; centre?: 'fountain' | 'obelisk' | 'statue' | 'none'; gates?: XY[]
}
export interface View { name: string; at: [number, number, number]; heading: number; pitch: number; note?: string; hour?: number; weather?: Weather; season?: Season }
export interface LocationDoc {
  id: string; name: string; seed: string; size: number; note?: string
  base?: number; relief?: number; snowline?: number; sea?: number; climate?: Climate; culture?: Culture | 'mixed'; erosion?: number
  wealth?: [number, number]; roads?: boolean; forest?: number
  mood?: MoodName; hour?: number; weather?: Weather; season?: Season
  terrain: TerrainFeature[]; districts: District[]; structures: Structure[]; views?: View[]
}
/** Bump when the generator changes, so builds saved in the browser are redone. */
export const BUILD_VERSION = 8
export const TSTRIDE = 6 // trees: x y z scale kind shade
export const TREE = { broadleaf: 0, spruce: 1, pine: 2, cypress: 3, larch: 4, orchard: 5, bush: 6, olive: 7 } as const
const DEG = Math.PI / 180

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const smax = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25 }
const smin = (a: number, b: number, k: number) => -smax(-a, -b, k)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Distance to a polyline, how far along it the nearest point lies, and which side (+1 left of the direction of travel). */
function pathNear(path: XY[], x: number, y: number) {
  let best = Infinity, along = 0, run = 0, side = 1
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, l = Math.sqrt(l2)
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2), d = Math.hypot(x - ax - dx * t, y - ay - dy * t)
    if (d < best) { best = d; along = run + t * l; side = dx * (y - ay) - dy * (x - ax) >= 0 ? 1 : -1 }
    run += l
  }
  return { d: best, s: along, side }
}
const pathDist = (path: XY[], x: number, y: number) => pathNear(path, x, y).d
/** Long paths (meandering rivers) get a bucket index so "how near is it" only looks at nearby segments. */
const idxCache = new WeakMap<XY[], { cell: number; cells: Map<number, number[]>; run: number[] }>()
function pathNearFast(path: XY[], x: number, y: number, maxD: number) {
  if (path.length < 12) { const n = pathNear(path, x, y); return n.d <= maxD ? n : { d: Infinity, s: 0, side: 1 } }
  let ix = idxCache.get(path)
  if (!ix) {
    const cell = 150, cells = new Map<number, number[]>(), run = [0]
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1]
      run.push(run[i] + Math.hypot(bx - ax, by - ay))
      for (let j = Math.floor(Math.min(ay, by) / cell); j <= Math.floor(Math.max(ay, by) / cell); j++) for (let k = Math.floor(Math.min(ax, bx) / cell); k <= Math.floor(Math.max(ax, bx) / cell); k++) { const key = k * 100003 + j; const l = cells.get(key); if (l) l.push(i); else cells.set(key, [i]) }
    }
    ix = { cell, cells, run }
    idxCache.set(path, ix)
  }
  const reach = Math.ceil(maxD / ix.cell), ci = Math.floor(x / ix.cell), cj = Math.floor(y / ix.cell)
  let best = Infinity, along = 0, side = 1
  const seen = new Set<number>()
  for (let j = cj - reach; j <= cj + reach; j++) for (let k = ci - reach; k <= ci + reach; k++) for (const i of ix.cells.get(k * 100003 + j) ?? []) {
    if (seen.has(i)) continue
    seen.add(i)
    const [ax, ay] = path[i], [bx, by] = path[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2), d = Math.hypot(x - ax - dx * t, y - ay - dy * t)
    if (d < best) { best = d; along = ix.run[i] + t * Math.sqrt(l2); side = dx * (y - ay) - dy * (x - ax) >= 0 ? 1 : -1 }
  }
  return best <= maxD ? { d: best, s: along, side } : { d: Infinity, s: 0, side: 1 }
}
export function inPoly(p: XY[], x: number, y: number) {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c
  return c
}
const rings = new WeakMap<XY[], XY[]>()
/** Signed distance to an area (negative inside): a polygon or a circle. */
const areaDist = (f: { area?: XY[]; at?: XY; radius?: number }, x: number, y: number) => {
  if (!f.area) { // a circle given in the recipe becomes an organic blob, so no district or field looks drawn with compasses
    const dx = x - f.at![0], dy = y - f.at![1], a = Math.atan2(dy, dx), k = (f.at![0] * 0.013 + f.at![1] * 0.007) % 6.283, r = f.radius ?? 300
    return Math.hypot(dx, dy) - r * (1 + 0.16 * Math.sin(3 * a + k) + 0.09 * Math.sin(5 * a + k * 2.3) + 0.05 * Math.sin(9 * a + k * 3.7))
  }
  let ring = rings.get(f.area)
  if (!ring) { ring = [...f.area, f.area[0]]; rings.set(f.area, ring) }
  return (inPoly(f.area, x, y) ? -1 : 1) * pathDist(ring, x, y)
}
const polyLen = (p: XY[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0)
const bboxOf = (d: { area?: XY[]; at?: XY; radius?: number; path?: XY[]; width?: number }): [number, number, number, number] => {
  const pts = d.area ?? d.path ?? [[d.at![0] - (d.radius ?? 300), d.at![1] - (d.radius ?? 300)], [d.at![0] + (d.radius ?? 300), d.at![1] + (d.radius ?? 300)]] as XY[], m = d.path ? (d.width ?? 100) * 2 : 0
  return [Math.min(...pts.map((p) => p[0])) - m, Math.min(...pts.map((p) => p[1])) - m, Math.max(...pts.map((p) => p[0])) + m, Math.max(...pts.map((p) => p[1])) + m]
}
/** Points every `step` metres along a polyline. */
function resample(path: XY[], step: number): XY[] {
  const out: XY[] = [], total = polyLen(path)
  for (let sv = 0; sv <= total + 1e-6; sv += step) {
    let run = 0, p: XY = path[path.length - 1]
    for (let i = 0; i < path.length - 1; i++) { const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]); if (run + l >= sv) { const t = (sv - run) / (l || 1); p = [lerp(path[i][0], path[i + 1][0], t), lerp(path[i][1], path[i + 1][1], t)]; break } run += l }
    out.push(p)
  }
  return out
}

// ---------- structures: footprints ----------
const SCALE: Partial<Record<Structure['kind'], number>> = { cathedral: 1.9, basilica: 1, dome: 1 }
const GREAT = new Set(['cathedral', 'basilica', 'dome', 'palace', 'colonnade', 'monastery'])
/** Where a structure sits and how much flat ground it needs; arcades, walls, canals, harbours and roads need none. */
export function footprint(s: Structure): { r: number; back: number } | null {
  const k = s.scale ?? SCALE[s.kind] ?? 1
  switch (s.kind) {
    case 'cathedral': return { r: 42 * k, back: 34 * k }
    case 'basilica': return { r: 80 * k, back: 42 * k }
    case 'dome': return { r: 100 * k, back: 75 * k }
    case 'palace': return { r: Math.hypot(s.width ?? 80, s.depth ?? 64) / 2 + 8, back: (s.depth ?? 64) / 2 }
    case 'monastery': return { r: 62, back: 33 }
    case 'colonnade': return { r: (s.radius ?? 120) + 26, back: 0 }
    case 'tower': return { r: (s.width ?? 12) + 4, back: 0 }
    case 'plaza': return { r: s.radius ?? 40, back: 0 }
    case 'statue': return { r: (s.height ?? 20) * 0.3 + 2, back: 0 }
    default: return null
  }
}

// ---------- terrain ----------
export interface River { id: string; path: XY[]; width: number; prof: number[]; wid: number[]; step: number; pools: { at: XY; r: number; depth: number; lvl: number }[] }
export interface Glacier { path: XY[]; total: number; top: number; end: number; w: number; t: number; prof: number[]; step: number }
export interface TerrainFn {
  h: (x: number, y: number) => number; base: (x: number, y: number) => number; water: (x: number, y: number) => number | null
  lakes: { at: XY; r: number; level: number }[]; flats: { at: XY; r: number; level: number; id: string }[]; rivers: River[]; glaciers: Glacier[]; fields: TerrainFeature[]; sea: number | null
}
/** Bend a river's line into meanders (more where `amount` is higher), keeping its ends in place. */
function meanderPath(path: XY[], width: number, amount: number, seed: number): XY[] {
  if (!amount) return path
  const n = simplex(seed), out: XY[] = [], total = polyLen(path)
  let run = 0
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1], l = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / l, uy = (by - ay) / l
    for (let t = 0; t < l; t += 20) {
      const s = run + t, taper = sstep(0, 160, s) * sstep(0, 160, total - s)
      const off = fbm(n, s / (width * 10 + 160), 0.5, 0.3, 3) * 2.2 * width * 3 * amount * taper
      out.push([ax + ux * t - uy * off, ay + uy * t + ux * off])
    }
    run += l
  }
  out.push(path[path.length - 1])
  return out
}
/** A glacier is wide at its head and narrows to its snout, with a ragged edge. */
const glacierWidth = (g: Glacier, t: number, x: number, y: number) => g.w * (1.35 - 0.75 * t) * (1 + 0.12 * Math.sin(x * 0.011 + y * 0.007) + 0.08 * Math.sin(x * 0.031 - y * 0.023))
export function terrainOf(doc: LocationDoc): TerrainFn {
  const s = hash(doc.seed), n1 = simplex(s), n2 = simplex(s ^ 0x5151), base = doc.base ?? 500, relief = doc.relief ?? 500
  const feats = doc.terrain.filter((f) => TERRAIN_KINDS.includes(f.kind))
  const lakeLevel = new Map<TerrainFeature, number>(), riverOf = new Map<TerrainFeature, River>(), glacierOf = new Map<TerrainFeature, Glacier>()
  const hb = (x: number, y: number, upto = feats.length): number => {
    const wx = x + fbm(n2, x / 3000, 1, y / 3000, 3) * 900, wy = y + fbm(n2, x / 3000, 5, y / 3000, 3) * 900
    let h = base + relief * (ridged(n1, wx / 5200, 0, wy / 5200, 6) * 1.15 - 0.35) + fbm(n1, x / 500, 9, y / 500, 4) * relief * 0.06 + ridged(n2, x / 160, 13, y / 160, 3) * relief * 0.025
    const floor = base - relief * 0.45 // feature profiles end below the background, so their edges leave no step
    for (let fi = 0; fi < upto; fi++) {
      const f = feats[fi]
      if (f.kind === 'peak' && f.at && f.height != null) {
        const r = f.radius ?? 1500, d = Math.hypot(x - f.at[0], y - f.at[1])
        if (d >= r) continue
        const t = d / r, crag = ridged(n2, x / 650, 3, y / 650, 4) - 0.5, gully = ridged(n1, x / 260, 17, y / 260, 3) - 0.55
        const p = floor + (f.height - floor) * (1 - t) ** (f.sharp ?? 1.4) + (crag * 0.14 + gully * 0.07) * (f.height - base) * (1 - t)
        h = smax(h, p, 1 + 150 * (1 - t)) // the blend narrows to nothing at the edge, so no seam
      } else if (f.kind === 'ridge' && f.path && f.height != null) {
        const w = f.width ?? 900, d = pathDist(f.path, x, y)
        if (d >= w) continue
        const t = d / w, crest = 0.86 + 0.28 * ridged(n2, x / 900, 7, y / 900, 3), gully = ridged(n1, x / 240, 19, y / 240, 3) - 0.55
        h = smax(h, floor + (f.height - floor) * crest * (1 - t) ** (f.sharp ?? 1.3) + gully * (f.height - base) * 0.08 * (1 - t), 1 + 120 * (1 - t))
      } else if (f.kind === 'valley' && f.path && f.height != null) {
        const w = f.width ?? 500, fl = f.edge ?? 0, d = pathDist(f.path, x, y)
        if (d > w * 3 + fl) continue
        h = smin(h, f.height + (Math.max(0, d - fl) / w) ** 2 * 900 + fbm(n2, x / 300, 2, y / 300, 2) * (fl ? 6 : 15), 90) // a flat floor `edge` metres either side
      } else if (f.kind === 'cliff' && f.path && f.path.length > 1) { // an escarpment: everything on the low side drops
        const wob = f.meander ?? 1, n = pathNear(f.path, x, y), low = f.side === 'left' ? 1 : -1, sd = n.d * n.side * low + (fbm(n2, x / (900 * wob), 27, y / (900 * wob), 3) * 260 + fbm(n2, x / 160, 23, y / 160, 3) * 40) * wob
        if (sd < -60) continue
        const total = polyLen(f.path), ext = f.extent ?? 1600, atEnd = n.s < 1 || n.s > total - 1
        if (atEnd) continue // beyond either end there is no step (it has already faded to nothing), so no seam
        const ends = sstep(0, 220, n.s) * sstep(0, 220, total - n.s)
        h -= (f.drop ?? 120) * sstep(-3, 12, sd) * (1 - sstep(ext * 0.5, ext, sd)) * ends
      } else if (f.kind === 'gorge' && f.path && f.path.length > 1) { // a slot cut into the rock with near-vertical walls
        const w = f.width ?? 70, d = pathDist(f.path, x, y)
        if (d > w) continue
        h -= (f.depth ?? 160) * (1 - sstep(w * 0.2, w * 0.5, d + fbm(n2, x / 80, 25, y / 80, 3) * w * 0.3))
      } else if (f.kind === 'glacier' && f.path && f.path.length > 1) { // a U-shaped trough filled with a convex tongue of ice
        const G = glacierAt(f, fi), n = pathNearFast(G.path, x, y, G.w * 3.2)
        if (n.d > G.w * 3.2) continue
        const t = n.s / G.total, w = glacierWidth(G, t, x, y)
        const kq = clamp(n.s / G.step, 0, G.prof.length - 1.001), surf = lerp(G.prof[Math.floor(kq)], G.prof[Math.floor(kq) + 1], kq % 1) + fbm(n2, x / 300, 21, y / 300, 2) * 6
        h = smin(h, surf - 25 + (Math.max(0, n.d - w * 0.85) / (w * 1.1)) ** 2 * 1100, 50)
        if (n.d < w) h = Math.max(h, surf + G.t * 0.3 * (1 - (n.d / w) ** 2))
        else if (n.d < w * 1.3) h += 9 * Math.sin(((n.d - w) / (w * 0.3)) * Math.PI) // lateral moraines
      } else if (f.kind === 'river' && f.path && f.path.length > 1) {
        const rv = riverAt(f, fi), { d, s: along } = pathNearFast(rv.path, x, y, rv.width * 4), k = clamp(along / rv.step, 0, rv.prof.length - 1.001), w = lerp(rv.wid[Math.floor(k)], rv.wid[Math.ceil(k)], k % 1)
        if (d < w * 4) {
          const surf = profAt(rv, along), bed = surf - (f.depth ?? 4)
          h = smin(h, bed + Math.max(0, d / (w * 0.5)) ** 2 * ((f.depth ?? 4) + 2), 6)
        }
        for (const p of rv.pools) { const dp = Math.hypot(x - p.at[0], y - p.at[1]); if (dp < p.r) h = smin(h, p.lvl - p.depth * (1 - (dp / p.r) ** 2), 5) }
      } else if (f.kind === 'lake' && f.at) {
        const lv = levelOf(f, fi), d = Math.hypot(x - f.at[0], y - f.at[1]), r0 = f.radius ?? 400
        const r = r0 * (1 + 0.42 * fbm(n2, x / (r0 * 1.2), 11, y / (r0 * 1.2), 3) + 0.12 * fbm(n2, x / (r0 * 0.3), 15, y / (r0 * 0.3), 2)), q = d / r
        if (q < 1) h = smin(h, lv - (f.depth ?? 40) * (1 - q * q), 30)
        else if (q < 1.9) h = Math.max(h, lerp(lv + 1.5, h, sstep(1.3, 1.9, q))) // a moraine dam where the ground would let the water spill
      } else if (f.kind === 'plateau' && f.height != null && (f.area || f.at)) {
        const e = f.edge ?? 150, sd = areaDist(f, x, y)
        if (sd < e) h = lerp(h, f.height + fbm(n2, x / 200, 4, y / 200, 2) * 4, sstep(e, 0, sd))
      } else if (f.kind === 'fields' && (f.area || f.at) && (f.crop === 'vines' || f.crop === 'terraces' || f.crop === 'olives')) { // terraces stepped into the slope
        const sd = areaDist(f, x, y)
        if (sd < 40) { const st = f.step ?? 3.5, q = h / st, t = q - Math.floor(q); h = lerp(h, (Math.floor(q) + sstep(0.78, 1, t)) * st, sstep(40, -10, sd)) }
      }
    }
    return h
  }
  /** A lake's water altitude: as given, or the ground at its centre before it was dug. */
  function levelOf(f: TerrainFeature, fi: number) {
    if (f.level != null) return f.level
    let v = lakeLevel.get(f)
    if (v == null) { // below the lowest point of its rim, so the basin holds it
      const r0 = f.radius ?? 400
      let rim = Infinity
      for (let a = 0; a < 32; a++) rim = Math.min(rim, hb(f.at![0] + Math.cos((a / 16) * Math.PI) * r0 * 1.3, f.at![1] + Math.sin((a / 16) * Math.PI) * r0 * 1.3, fi))
      v = Math.min(hb(f.at![0], f.at![1], fi) - 3, rim - 4); lakeLevel.set(f, v)
    }
    return v
  }
  function glacierAt(f: TerrainFeature, fi: number): Glacier {
    let g = glacierOf.get(f)
    if (g) return g
    const top = f.level ?? hb(f.path![0][0], f.path![0][1], fi)
    const path = meanderPath(f.path!, (f.width ?? 380) * 0.5, 0.8, s ^ hash(f.id)), step = 20, raw: number[] = []
    // the ice follows the valley floor down (never rising), smoothed, ending at the snout altitude if one is given
    let low = Infinity
    for (const p of resample(path, step)) { low = Math.min(low, hb(p[0], p[1], fi)); raw.push(low) }
    const end = f.height ?? raw[raw.length - 1]
    const prof = raw.map((_, i) => { let a = 0, c = 0; for (let k = Math.max(0, i - 6); k <= Math.min(raw.length - 1, i + 6); k++) { a += raw[k]; c++ } return Math.max(end, a / c) })
    g = { path, total: polyLen(path), top, end, w: f.width ?? 380, t: f.depth ?? 70, prof, step }
    glacierOf.set(f, g)
    return g
  }
  /** A river's water surface along its (meandering) line: the ground before it, never rising downstream, so it falls
   * over cliffs, with plunge pools below the falls. It widens downstream. */
  function riverAt(f: TerrainFeature, fi: number): River {
    let rv = riverOf.get(f)
    if (rv) return rv
    const w0 = f.width ?? 24, path = meanderPath(f.path!, w0, f.meander ?? 1, s ^ hash(f.id)), step = 10, prof: number[] = [], wid: number[] = []
    let low = Infinity
    for (const p of resample(path, step)) { low = Math.min(low, hb(p[0], p[1], fi) - 1.2); prof.push(low) }
    prof.forEach((_, i) => wid.push(w0 * (0.55 + (0.9 * i) / Math.max(1, prof.length - 1))))
    const pools: River['pools'] = [], pts = resample(path, step)
    for (let i = 3; i < prof.length; i++) if (prof[i - 3] - prof[i] > 14 && (i + 1 >= prof.length || prof[i] - prof[i + 1] < 3) && !pools.some((p) => Math.hypot(p.at[0] - pts[i][0], p.at[1] - pts[i][1]) < 60)) pools.push({ at: pts[Math.min(i + 1, pts.length - 1)], r: wid[i] * 1.6, depth: 6 + Math.min(12, (prof[i - 3] - prof[i]) * 0.1), lvl: prof[Math.min(i + 1, prof.length - 1)] })
    rv = { id: f.id, path, width: w0, prof, wid, step, pools }
    riverOf.set(f, rv)
    return rv
  }
  const profAt = (rv: River, sv: number) => { const k = clamp(sv / rv.step, 0, rv.prof.length - 1.001), i = Math.floor(k); return lerp(rv.prof[i], rv.prof[i + 1], k - i) }
  const flats = doc.structures.flatMap((st) => {
    const fp = footprint(st)
    if (!fp || !st.at) return []
    const at: XY = [st.at[0], st.at[1]]
    return [{ id: st.id, at, r: fp.r, level: st.level ?? hb(at[0], at[1]) }]
  })
  const lakes = feats.flatMap((f, fi) => (f.kind === 'lake' && f.at ? [{ at: f.at, r: (f.radius ?? 400) * 1.7, level: levelOf(f, fi) }] : []))
  const rivers = feats.flatMap((f, fi) => (f.kind === 'river' && f.path && f.path.length > 1 ? [riverAt(f, fi)] : []))
  const glaciers = feats.flatMap((f, fi) => (f.kind === 'glacier' && f.path && f.path.length > 1 ? [glacierAt(f, fi)] : []))
  const h = (x: number, y: number) => {
    let v = hb(x, y)
    for (const f of flats) {
      const d = Math.hypot(x - f.at[0], y - f.at[1]), e = 30 + f.r * 0.4
      if (d < f.r + e) v = lerp(v, f.level, sstep(f.r + e, f.r, d))
    }
    return v
  }
  const sea = doc.sea ?? null
  const water = (x: number, y: number) => {
    for (const l of lakes) if (Math.hypot(x - l.at[0], y - l.at[1]) < l.r && h(x, y) < l.level) return l.level
    for (const r of rivers) { const n = pathNearFast(r.path, x, y, r.width); if (n.d < r.width * 0.6) return profAt(r, n.s) }
    if (sea != null && h(x, y) < sea) return sea
    return null
  }
  return { h, base: hb, water, lakes, flats, rivers, glaciers, fields: feats.filter((f) => f.kind === 'fields' && (f.area || f.at)), sea }
}
/** Compass facing (degrees, 0 = north, 90 = east) as a recipe-space unit vector. */
export const facingVec = (deg = 180): XY => [Math.sin(deg * DEG), Math.cos(deg * DEG)]
/** Recipe (x, y) to world (x, z), and the builder yaw that turns a kit's front (local +z) to face `deg`. */
const W = (p: XY): [number, number] => [p[0], -p[1]]
const yawOf = (deg = 180) => Math.PI - deg * DEG

// ---------- farmland ----------
const CROP_COL: Record<string, string[]> = {
  wheat: ['#c9b060', '#d4bc6c', '#bfa652'], barley: ['#b8b06a', '#c4ba78'], meadow: ['#7a9a48', '#86a452', '#6e9040'], fallow: ['#8a7050', '#7e6648', '#94785a'],
  vines: ['#6a7a3a', '#5e7034'], orchard: ['#6f8a44', '#78924a'], olives: ['#8a8a5a', '#7e8052'], pasture: ['#7e9e4c', '#8aa858', '#749448'], lavender: ['#8a7aa8', '#7a6c9a'], maize: ['#a8a84a'],
}
interface Parcel { crop: string; col: Col }
/** Fields are laid out as parcels on a turned grid; each parcel has its own crop. */
function parcelsOf(f: TerrainFeature, seed: number) {
  const a = (f.angle ?? (hash(f.id) % 180)) * DEG, size = f.step && f.crop !== 'terraces' && f.crop !== 'vines' ? f.step * 15 : 70, c = Math.cos(a), sn = Math.sin(a)
  const cache = new Map<string, Parcel>()
  const crops = f.crop === 'mixed' || !f.crop ? ['wheat', 'wheat', 'barley', 'meadow', 'fallow', 'maize', 'meadow'] : f.crop === 'terraces' ? ['vines', 'olives', 'vines', 'meadow'] : [f.crop]
  const at = (x: number, y: number) => {
    const u = x * c + y * sn, v = -x * sn + y * c, i = Math.floor(u / size), j = Math.floor(v / (size * 1.6)), k = `${i},${j}`
    let p = cache.get(k)
    if (!p) { const R = rng(seed ^ hash(f.id) ^ (i * 7919 + j * 104729)); const crop = crops[Math.floor(R() * crops.length)]; p = { crop, col: lin(CROP_COL[crop][Math.floor(R() * CROP_COL[crop].length)]) }; cache.set(k, p) }
    const fu = u / size - i, fv = v / (size * 1.6) - j
    return { p, u, v, i, j, edge: Math.min(fu, 1 - fu, fv, 1 - fv) * size, c, sn, size }
  }
  return at
}

// ---------- build ----------
export interface CityBuilt {
  size: number; N: number; heights: Float32Array; colors: Uint8Array; surf: Uint8Array; minH: number; maxH: number; sea: number | null
  outer: { size: number; n: number; heights: Float32Array; colors: Uint8Array }
  parts: Float32Array; chimneys: Float32Array; trees: Float32Array; rocks: Float32Array; lamps: Float32Array
  geo: Record<Mat, { pos: Float32Array; nor: Float32Array; col: Float32Array }>
  water: Float32Array; rivers: { pos: Float32Array; uv: Float32Array }; falls: Float32Array; waterLevels: number[]
  counts: { buildings: number; structures: number; roads: number; trees: number }; ms: number; stages: Record<string, number>
}
export const gridN = (size: number) => (size / 12 > 1500 ? 2048 : size / 12 > 700 ? 1024 : 512)

export function buildCity(doc: LocationDoc, onStage?: (stage: string) => void): CityBuilt {
  const t0 = Date.now(), seed = hash(doc.seed), T = terrainOf(doc), size = doc.size, N = gridN(size), cellM = size / N, w1 = N + 1
  const stages: Record<string, number> = {}, lap = (k: string, next?: string) => { stages[k] = Date.now() - t0 - Object.values(stages).reduce((a, c) => a + c, 0); if (next) onStage?.(next) }
  onStage?.('Shaping the ground')
  const heights = new Float32Array(w1 * w1)
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) heights[j * w1 + i] = T.h(-size / 2 + i * cellM, size / 2 - j * cellM) // row 0 = north edge
  lap('ground', 'Eroding the slopes')
  const grid = { N, size, heights }, Hw = sampler(grid)
  const H = (x: number, y: number) => Hw(x, -y) // recipe coordinates
  const stamp = (cx: number, cy: number, r: number, fn: (a: number, d: number) => void) => { // every vertex within r of a recipe point
    for (let j = Math.max(0, Math.floor((size / 2 - cy - r) / cellM)); j <= Math.min(N, Math.ceil((size / 2 - cy + r) / cellM)); j++)
      for (let i = Math.max(0, Math.floor((cx - r + size / 2) / cellM)); i <= Math.min(N, Math.ceil((cx + r + size / 2) / cellM)); i++) { const d = Math.hypot(-size / 2 + i * cellM - cx, size / 2 - j * cellM - cy); if (d <= r) fn(j * w1 + i, d) }
  }
  // erosion: rain carves gullies and fans everywhere except built, watery or farmed ground
  const strength = doc.erosion ?? 1
  if (strength > 0) {
    const mask = new Float32Array(heights.length).fill(1), soft = (a: number, v: number) => { mask[a] = Math.min(mask[a], v) }
    for (const f of T.flats) stamp(f.at[0], f.at[1], f.r * 1.5 + 40, (a, d) => soft(a, sstep(f.r, f.r * 1.5 + 40, d)))
    for (const l of T.lakes) stamp(l.at[0], l.at[1], l.r * 1.25, (a) => soft(a, 0))
    for (const g of T.glaciers) for (const p of resample(g.path, 40)) stamp(p[0], p[1], g.w * 1.3, (a) => soft(a, 0))
    for (const r of T.rivers) for (const p of resample(r.path, 15)) stamp(p[0], p[1], r.width * 2, (a) => soft(a, 0.2))
    for (const f of T.fields) { const [x0, y0, x1, y1] = bboxOf(f); stamp((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2, (a) => { const i = a % w1, j = Math.floor(a / w1); if (areaDist(f, -size / 2 + i * cellM, size / 2 - j * cellM) < 30) soft(a, 0) }) }
    for (const d of doc.districts) { const [x0, y0, x1, y1] = bboxOf(d); stamp((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2, (a) => { const i = a % w1, j = Math.floor(a / w1); const sd = areaDist(d, -size / 2 + i * cellM, size / 2 - j * cellM); if (sd < 60) soft(a, 0.15 + sstep(-60, 60, sd) * 0.85) }) }
    if (T.sea != null) for (let a = 0; a < heights.length; a++) if (heights[a] < T.sea + 2) mask[a] = 0
    erode(heights, N, cellM, mask, Math.round(N * N * 0.14 * strength), seed ^ 0xe40d, strength)
  }
  lap('erosion', 'Laying out the roads')
  // wealth follows altitude between the lowest and highest district ground, and rises near great buildings
  let [wl, wh] = doc.wealth ?? [Infinity, -Infinity]
  if (!doc.wealth) {
    const hs: number[] = []
    for (const d of doc.districts) for (let k = 0; k < 400; k++) {
      const r = rng(hash(d.id) + k), [x0, y0, x1, y1] = bboxOf(d), p: XY = [lerp(x0, x1, r()), lerp(y0, y1, r())]
      if (areaDist(d, ...p) <= 0) hs.push(H(...p))
    }
    hs.sort((a, b) => a - b)
    wl = hs[Math.floor(hs.length * 0.08)] ?? 0; wh = hs[Math.floor(hs.length * 0.92)] ?? 1
  }
  const greats = doc.structures.filter((s) => GREAT.has(s.kind) && s.at).map((s) => s.at!)
  const wealthAt = (x: number, y: number, h: number) => clamp((h - wl) / (wh - wl || 1) + greats.reduce((m, g) => Math.max(m, 0.32 * (1 - sstep(80, 600, Math.hypot(x - g[0], y - g[1])))), 0))

  // roads: hubs at plazas, fronts of great buildings, bridge ends, harbours and across districts
  let roads: Road[] = []
  const overRiver = (x: number, y: number) => T.rivers.some((r) => pathNearFast(r.path, x, y, r.width * 1.5).d < r.width * 1.1)
  const struct = (s: Structure) => s.at && footprint(s)
  const wetR = (x: number, y: number, h = H(x, y)) => T.lakes.some((l) => h < l.level + 0.5 && Math.hypot(x - l.at[0], y - l.at[1]) < l.r) || (T.sea != null && h < T.sea + 0.5) || T.rivers.some((r) => pathNearFast(r.path, x, y, r.width).d < r.width * 0.9)
  if (doc.roads !== false) {
    const hubs: { x: number; z: number }[] = [], hubAt = (p: XY) => { const [x, z] = W(p); const h = { x, z }; hubs.push(h); return h }
    for (const s of doc.structures) {
      const fp = struct(s)
      if (s.kind === 'plaza' || s.kind === 'colonnade') hubAt(s.at!)
      else if (fp && s.kind !== 'statue' && s.kind !== 'tower') { const [fx, fy] = facingVec(s.facing); hubAt([s.at![0] + fx * (fp.r + 12), s.at![1] + fy * (fp.r + 12)]) }
      if (s.kind === 'harbour' && s.at) { const [fx, fy] = facingVec(s.facing); hubAt([s.at[0] - fx * 40, s.at[1] - fy * 40]) }
    }
    const links: [{ x: number; z: number }, { x: number; z: number }][] = [], force: typeof links = []
    for (const s of doc.structures) {
      if (s.kind === 'bridge' && s.at && s.to) { const [fx, fy] = [s.to[0] - s.at[0], s.to[1] - s.at[1]], l = Math.hypot(fx, fy) || 1; links.push([hubAt([s.at[0] - (fx / l) * 30, s.at[1] - (fy / l) * 30]), hubAt([s.to[0] + (fx / l) * 30, s.to[1] + (fy / l) * 30])]) }
      if (s.kind === 'road' && s.path) for (let i = 0; i < s.path.length - 1; i++) force.push([hubAt(s.path[i]), hubAt(s.path[i + 1])])
    }
    for (const d of doc.districts) { // a hub every ~650 m across each district
      const [x0, y0, x1, y1] = bboxOf(d), R2 = rng(hash(d.id) ^ 0x51)
      for (let y = y0 + 325; y < y1; y += 650) for (let x = x0 + 325; x < x1; x += 650) { const p: XY = [x + (R2() - 0.5) * 300, y + (R2() - 0.5) * 300]; if (areaDist(d, ...p) < -40 && !wetR(...p)) hubAt(p) }
      if (d.at && areaDist(d, ...d.at) < 0) hubAt(d.at)
    }
    const cores = doc.structures.flatMap((s) => { const fp = struct(s); return fp && s.kind !== 'plaza' && s.kind !== 'colonnade' ? [{ at: W(s.at!), r: fp.r * 0.75 }] : [] })
    const icy = T.glaciers.flatMap((g) => resample(g.path, 60).map((p) => ({ at: W(p), r: g.w })))
    const lakeOrSea = (x: number, y: number, h = H(x, y)) => T.lakes.some((l) => h < l.level + 0.5 && Math.hypot(x - l.at[0], y - l.at[1]) < l.r) || (T.sea != null && h < T.sea + 0.5)
    const blocked = (x: number, z: number) => Math.abs(x) > size / 2 - 20 || Math.abs(z) > size / 2 - 20 || lakeOrSea(x, -z) || cores.some((c) => Math.hypot(x - c.at[0], z - c.at[1]) < c.r) || icy.some((c) => Math.hypot(x - c.at[0], z - c.at[1]) < c.r)
    roads = planRoads({
      grid, seed, hubs, links, force, blocked,
      districts: doc.districts.filter((d) => d.area || d.at).map((d) => { const [x0, y0, x1, y1] = bboxOf(d); return { inside: (x: number, z: number) => areaDist(d, x, -z) < -6 && !wetR(x, -z), bbox: [x0, -y1, x1, -y0] as [number, number, number, number], wealth: (h: number) => d.wealth ?? clamp((h - wl) / (wh - wl || 1)), density: d.density ?? 0.8 } }),
    })
    carve(grid, roads, (x, z) => overRiver(x, -z))
  }
  // canals: a flat bed between stone walls, quays either side (after the roads, which cross them on bridges)
  const canals = doc.structures.filter((s) => s.kind === 'canal' && s.path && s.path.length > 1).map((s) => {
    const pts = resample(s.path!, 4), w = s.width ?? 12, level = s.level ?? Math.min(...pts.map((p) => H(...p))) - 1.2
    const best = new Float32Array(heights.length), target = new Float32Array(heights.length)
    for (const p of pts) stamp(p[0], p[1], w / 2 + 16, (a, d) => { const [wt, t] = d < w / 2 ? [1, level - 3] : d < w / 2 + 6 ? [1, level + 1.6] : [1 - sstep(w / 2 + 6, w / 2 + 16, d), level + 1.6]; if (wt > best[a] || (wt === best[a] && t < target[a])) { best[a] = wt; target[a] = t } })
    for (let a = 0; a < heights.length; a++) if (best[a] > 0) heights[a] += (target[a] - heights[a]) * best[a]
    return { s, pts, w, level }
  })
  lap('roads', 'Building the town')
  const roadIdx = new RoadIndex(15, 30)
  roads.forEach((r, i) => roadIdx.add(r, i))
  let minH = Infinity, maxH = -Infinity
  for (const v of heights) { if (v < minH) minH = v; if (v > maxH) maxH = v }

  // ground that is already taken: roads, great buildings, bridges, aqueducts, walls, canals
  const occ = new Occ()
  for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) { const [ax, , az] = r.pts[i], [bx, , bz] = r.pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l > 0.01) occ.mark((ax + bx) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az), r.width + 0.6, l + 0.5) }
  for (const f of T.flats) { const [x, z] = W(f.at); occ.markCircle(x, z, f.r + 10) }
  for (const s of doc.structures) {
    const path = s.kind === 'bridge' && s.at && s.to ? [s.at, s.to] : (s.kind === 'aqueduct' || s.kind === 'wall') ? s.path : null
    if (path) for (const p of resample(path, 6)) { const [x, z] = W(p); occ.markCircle(x, z, (s.width ?? (s.kind === 'bridge' ? 14 : 5)) / 2 + 6) }
    if (s.kind === 'harbour' && s.at) { const [x, z] = W(s.at); occ.markCircle(x, z, (s.width ?? 160) / 2 + 10) }
  }
  for (const c of canals) for (const p of c.pts) { const [x, z] = W(p); occ.markCircle(x, z, c.w / 2 + 5) }
  const out: Out = placeAll({
    H: Hw, wet: (x, z, h) => wetR(x, -z, h), occ, roads, seed, max: 160000,
    districts: doc.districts.filter((d) => d.area || d.at).map((d): DistrictIn => { const [x0, y0, x1, y1] = bboxOf(d); return { culture: d.culture ?? doc.culture ?? 'central', inside: (x, z) => areaDist(d, x, -z), bbox: [x0, -y1, x1, -y0], density: clamp(d.density ?? 0.8, 0.05, 1), wealth: (x, z, h) => d.wealth ?? wealthAt(x, -z, h), steep: !!d.steep } }),
  })
  lap('buildings', 'Planting fields and forests')
  // gardens: trees in yards, courtyards and along the edges of towns (more for the rich; cypress and olive in the south)
  const gardenTrees: number[] = [], RG = rng(seed ^ 0x6a4d)
  for (const d of doc.districts) {
    if (!d.area && !d.at) continue
    const [x0, y0, x1, y1] = bboxOf(d), cu = d.culture ?? doc.culture ?? 'central'
    for (let y = y0; y < y1; y += 8) for (let x = x0; x < x1; x += 8) {
      const px = x + (RG() - 0.5) * 7, py = y + (RG() - 0.5) * 7, sd = areaDist(d, px, py)
      if (sd > 40) continue
      const h = H(px, py), w = d.wealth ?? wealthAt(px, py, h), [wx, wz] = W([px, py])
      if (RG() > (sd > 0 ? 0.25 : 0.06 + w * 0.3) || wetR(px, py, h) || !occ.free(wx, wz, 0, 4, 4)) continue
      const r = RG(), kind = cu === 'mediterranean' ? (r < 0.4 ? TREE.cypress : r < 0.7 ? TREE.olive : TREE.pine) : cu === 'eastern' ? (r < 0.4 ? TREE.cypress : r < 0.75 ? TREE.olive : TREE.orchard) : cu === 'mountain' ? (r < 0.6 ? TREE.spruce : TREE.orchard) : (r < 0.6 ? TREE.broadleaf : TREE.orchard)
      gardenTrees.push(wx, h - 0.3, wz, kind === TREE.broadleaf ? 0.55 + RG() * 0.35 : 0.6 + RG() * 0.4, kind, 0.8 + RG() * 0.35)
      occ.mark(wx, wz, 0, 4, 4)
    }
  }
  // farmland: parcels with their own crops, rows of vines, orchards, dry-stone walls and hedges, farmsteads
  const farmTrees: number[] = [], RF = rng(seed ^ 0xfa53)
  const fieldsAt = T.fields.map((f) => ({ f, at: parcelsOf(f, seed), bbox: bboxOf(f) }))
  const cultureNear = (x: number, y: number): Culture => { let best: Culture = doc.culture && doc.culture !== 'mixed' ? doc.culture : 'central', bd = Infinity; for (const d of doc.districts) { const sd = areaDist(d, x, y); if (sd < bd && d.culture && d.culture !== 'mixed') { bd = sd; best = d.culture } } return best }
  for (const { f, at, bbox } of fieldsAt) {
    const [x0, y0, x1, y1] = bbox, cu = cultureNear((x0 + x1) / 2, (y0 + y1) / 2), seen = new Set<string>()
    for (let y = y0; y < y1; y += 2.4) for (let x = x0; x < x1; x += 2.4) {
      if (areaDist(f, x, y) > -6) continue
      const q = at(x, y), [wx, wz] = W([x, y])
      if (q.edge < 2.5 || !occ.free(wx, wz, 0, 1.2, 1.2)) continue
      const h = H(x, y), crop = q.p.crop
      if (crop === 'vines' && Math.abs(q.v % 2.4) < 1.2 && (Math.floor(q.u / 2.6) + Math.floor(q.v / 2.4)) % 1 === 0 && Math.abs((q.u % 2.6) - 1.3) < 1.2 && RF() < 0.9) out.parts.push(PART.vine, wx, h, wz, Math.atan2(q.c, -q.sn), 0.55, 1.25, 2.3, 0.2 + RF() * 0.06, 0.26 + RF() * 0.06, 0.1, 0, 0, 0, 0, 0, 0)
      if ((crop === 'orchard' || crop === 'olives') && Math.abs((q.u % 7) - 3.5) < 1.2 && Math.abs((q.v % 7) - 3.5) < 1.2) farmTrees.push(wx + (RF() - 0.5), h - 0.2, wz + (RF() - 0.5), 0.45 + RF() * 0.2, crop === 'olives' ? 7 : 5, 0.85 + RF() * 0.3)
      const key = `${q.i},${q.j}`
      if (!seen.has(key)) { // once per parcel: walls or hedges along its edges, sometimes a farmstead
        seen.add(key)
        const hedge = cu === 'central' && RF() < 0.5, wall = !hedge && (cu === 'mountain' || cu === 'mediterranean' || crop === 'pasture') && RF() < 0.7
        if (hedge || wall) for (const side of [0, 1]) for (let t = 1.5; t < q.size - 1; t += hedge ? 3.2 : 3) {
          const u = q.i * q.size + (side ? t : 0.6), v = q.j * q.size * 1.6 + (side ? 0.6 : t * 1.6), px = u * q.c - v * q.sn, py = u * q.sn + v * q.c
          if (areaDist(f, px, py) > -4) continue
          const [pwx, pwz] = W([px, py])
          if (!occ.free(pwx, pwz, 0, 1.5, 1.5)) continue
          if (hedge) farmTrees.push(pwx, H(px, py) - 0.3, pwz, 0.35 + RF() * 0.2, 6, 0.8 + RF() * 0.3)
          else out.parts.push(PART.drywall, pwx, H(px, py) - 0.3, pwz, Math.atan2(side ? q.c : -q.sn, side ? -q.sn : -q.c), 0.7, 1.1, 3.1, 0.42, 0.4, 0.37, 0, 0, 0, 0, 0, 0)
        }
        if (RF() < 0.07 && q.edge > 20) farmstead(out, cu, wx, wz, RF() * Math.PI * 2, Hw, occ, RF)
      }
    }
  }
  // ground colour and surface (ice, sand, farmland, scree), from rock, meadow, forest, snow, paving, fields
  const urban = new Float32Array(w1 * w1)
  for (let k = 0; k < out.parts.length; k += PSTRIDE) {
    if (out.parts[k] !== PART.wall) continue
    const i = Math.round((out.parts[k + 1] + size / 2) / cellM), j = Math.round((out.parts[k + 3] + size / 2) / cellM), r = Math.ceil((Math.max(out.parts[k + 5], out.parts[k + 7]) * 1.3) / cellM)
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = (j + dj) * w1 + i + di; if (i + di >= 0 && i + di <= N && j + dj >= 0 && j + dj <= N) urban[a] = Math.min(1, urban[a] + 0.4) }
  }
  for (const f of T.flats) stamp(f.at[0], f.at[1], f.r, (a) => { urban[a] = 1 })
  for (const r of roads) for (const [x, , z] of r.pts) stamp(x, -z, r.width, (a) => { urban[a] = Math.max(urban[a], 0.8) })
  for (const c of canals) for (const p of c.pts) stamp(p[0], p[1], c.w / 2 + 6, (a) => { urban[a] = 1 })
  const snow = doc.snowline ?? maxH - (maxH - minH) * 0.18, treeLine = snow - 900, nC = simplex(seed ^ 0xc010), climate = doc.climate ?? 'temperate'
  const NS = 40, nsN = Math.ceil(Math.max(size, 60000) / NS) + 2, nsCache = new Map<number, [number, number]>()
  const noiseAt = (x: number, y: number): [number, number] => { // low-frequency colour noise, sampled every 40 m
    const fx = x / NS, fy = y / NS, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j
    const at = (a: number, c: number) => { const k = a * nsN + c; let v = nsCache.get(k); if (!v) { const vv = fbm(nC, (a * NS) / 400, 0, (c * NS) / 400, 3); v = [vv, vv + fbm(nC, (a * NS) / 1500, 3, (c * NS) / 1500, 2)]; nsCache.set(k, v) } return v }
    const a = at(i, j), b2 = at(i + 1, j), c2 = at(i, j + 1), d2 = at(i + 1, j + 1)
    return [0, 1].map((q) => (a[q] * (1 - tx) + b2[q] * tx) * (1 - ty) + (c2[q] * (1 - tx) + d2[q] * tx) * ty) as [number, number]
  }
  const warm = climate === 'mediterranean'
  const C = { grass: lin(warm ? '#8a9050' : '#6f7f4a'), grass2: lin(warm ? '#a8a060' : '#8a9356'), forest: lin(warm ? '#4a5a30' : '#3b4f30'), rock: lin('#7d786e'), scree: lin('#8a8478'), snow: lin('#eef2f6'), ice: lin('#bcd8e4'), sand: lin('#d8c8a0'), shore: lin('#a49c8c'), pave: lin('#8a8070'), pave2: lin('#a09684'), moraine: lin('#8e877c') }
  const glacierW = (x: number, y: number) => { let m = 0; for (const g of T.glaciers) { const n = pathNearFast(g.path, x, y, g.w * 2); if (n.d === Infinity) continue; const w = glacierWidth(g, n.s / g.total, x, y); if (n.d < w * 1.35) m = Math.max(m, n.d < w ? 1 - sstep(w * 0.86, w, n.d) : -1) } return m }
  const paint = (x: number, y: number, h: number, sl: number, u: number, sf: number[]): Col => {
    const [v, fo] = noiseAt(x, y)
    let c = mix(C.grass, C.grass2, clamp(v + 0.5))
    if (h < treeLine && sl < 0.8 && fo > -0.05) c = mix(c, C.forest, sstep(treeLine, treeLine - 200, h) * 0.7)
    for (const fa of fieldsAt) { const [x0, y0, x1, y1] = fa.bbox; if (x < x0 || x > x1 || y < y0 || y > y1) continue; const sd = areaDist(fa.f, x, y); if (sd < 8) { const q = fa.at(x, y); c = mix(c, mix(q.p.col, lin('#6a6450'), q.edge < 2 ? 0.5 : 0), sstep(8, -8, sd) * 0.9); sf[2] = Math.max(sf[2], sstep(8, -8, sd)) } }
    c = mix(c, C.rock, sstep(0.55, 0.9, sl) * 0.9)
    const scree = sstep(snow - 500, snow - 100, h) * sstep(0.35, 0.7, sl) + sstep(0.45, 0.75, sl) * (1 - sstep(0.75, 1.1, sl)) * 0.6
    c = mix(c, C.scree, Math.min(1, scree) * 0.6); sf[3] = Math.min(1, scree + sstep(0.7, 1.1, sl))
    const sn = sstep(snow - 60, snow + 120, h + v * 120) * (1 - sstep(0.9, 1.3, sl))
    c = mix(c, C.snow, sn)
    const gw = glacierW(x, y)
    if (gw > 0) { c = mix(c, C.ice, gw); sf[0] = gw } else if (gw < 0) c = mix(c, C.moraine, 0.7)
    for (const l of T.lakes) if (Math.abs(h - l.level) < 4 && Math.hypot(x - l.at[0], y - l.at[1]) < l.r) c = mix(c, C.shore, 0.6)
    if (T.sea != null && h < T.sea + 3.5 && h > T.sea - 6 && sl < 0.25) { const b = sstep(T.sea + 3.5, T.sea + 0.5, h); c = mix(c, C.sand, b); sf[1] = b }
    return mix(c, mix(C.pave, C.pave2, clamp(v + 0.5)), u * 0.85)
  }
  const to8 = (c: Col, o: Uint8Array, k: number) => { for (let q = 0; q < 3; q++) o[k + q] = Math.round(255 * clamp(c[q]) ** (1 / 2.2)) }
  const colors = new Uint8Array(w1 * w1 * 3), surf = new Uint8Array(w1 * w1 * 4), sf = [0, 0, 0, 0]
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const a = j * w1 + i, hx = (heights[j * w1 + Math.min(N, i + 1)] - heights[j * w1 + Math.max(0, i - 1)]) / (2 * cellM), hy = (heights[Math.min(N, j + 1) * w1 + i] - heights[Math.max(0, j - 1) * w1 + i]) / (2 * cellM)
    sf.fill(0)
    to8(paint(-size / 2 + i * cellM, size / 2 - j * cellM, heights[a], Math.hypot(hx, hy), urban[a], sf), colors, a * 3)
    for (let q = 0; q < 4; q++) surf[a * 4 + q] = Math.round(sf[q] * 255)
  }
  lap('colours')
  // forests by altitude and climate, river woods, cypress avenues; rocks and scree under cliffs
  const trees: number[] = [...farmTrees, ...gardenTrees], rocks: number[] = [], RT = rng(seed ^ 0x7ee5), dens = doc.forest ?? 1
  const pickTree = (h: number, wet: boolean, R: () => number) => {
    if (h > treeLine - 300) return R() < 0.55 ? TREE.larch : TREE.spruce
    if (h > treeLine - 900) return R() < 0.7 ? TREE.spruce : warm ? TREE.pine : TREE.broadleaf
    if (wet) return TREE.broadleaf
    if (warm) { const r = R(); return r < 0.45 ? TREE.pine : r < 0.7 ? TREE.olive : r < 0.85 ? TREE.cypress : TREE.broadleaf }
    if (climate === 'alpine') return R() < 0.6 ? TREE.spruce : TREE.broadleaf
    return R() < 0.75 ? TREE.broadleaf : TREE.spruce
  }
  for (let y = -size / 2 + 6; y < size / 2 && trees.length / TSTRIDE < 240000; y += 10) for (let x = -size / 2 + 6; x < size / 2; x += 10) {
    const px = x + (RT() - 0.5) * 9, py = y + (RT() - 0.5) * 9, i = Math.round((px + size / 2) / cellM), j = Math.round((size / 2 - py) / cellM), a = j * w1 + i
    if (urban[a] > 0.2 || surf[a * 4] > 40 || surf[a * 4 + 2] > 60 || surf[a * 4 + 1] > 60) continue
    const h = H(px, py), sl = Math.hypot(H(px + 4, py) - H(px - 4, py), H(px, py + 4) - H(px, py - 4)) / 8
    if (sl > 0.75 || h > snow - 120) { if (RT() < (sl > 0.75 ? 0.06 : 0.03)) rocks.push(px, h - 0.5, -py, 0.8 + RT() * RT() * 6, RT() * 6.28); continue }
    if (sl > 0.5 && RT() < 0.03) rocks.push(px, h - 0.4, -py, 0.6 + RT() * 2.5, RT() * 6.28) // boulders shed from the cliffs above
    if (wetR(px, py, h)) continue
    const nearRiver = T.rivers.some((r) => pathNearFast(r.path, px, py, r.width * 3).d < r.width * 3)
    const fo = noiseAt(px, py)[1]
    const p = nearRiver ? 0.8 : dens * sstep(-0.15, 0.25, fo) * (1 - sstep(treeLine - 100, treeLine + 150, h)) * 0.9
    if (RT() > p) { if (RT() < 0.004 * dens && h < treeLine) trees.push(px, h - 0.3, -py, 0.7 + RT() * 0.6, pickTree(h, nearRiver, RT), 0.8 + RT() * 0.4); continue }
    const [wx, wz] = W([px, py])
    if (!occ.free(wx, wz, 0, 3, 3)) continue
    trees.push(px, h - 0.3, -py, 0.75 + RT() * 0.6, pickTree(h, nearRiver, RT), 0.75 + RT() * 0.5)
  }
  if (warm || doc.districts.some((d) => d.culture === 'mediterranean')) for (const r of roads) { // cypress avenues along main roads near Mediterranean towns
    if (r.kind !== 'main') continue
    for (let i = 3; i < r.pts.length - 3; i += 3) {
      const [ax, ay, az] = r.pts[i], [bx, , bz] = r.pts[i + 1], l = Math.hypot(bx - ax, bz - az) || 1
      if (cultureNear(ax, -az) !== 'mediterranean' && !warm) continue
      for (const sd of [-1, 1]) { const ox = (-(bz - az) / l) * (r.width / 2 + 2.5) * sd, oz = ((bx - ax) / l) * (r.width / 2 + 2.5) * sd; if (occ.free(ax + ox, az + oz, 0, 1.5, 1.5) && !wetR(ax + ox, -(az + oz))) trees.push(ax + ox, ay - 0.3, az + oz, 0.8 + RT() * 0.3, TREE.cypress, 0.85 + RT() * 0.2) }
    }
  }
  lap('trees')
  // the range beyond, coarser and tucked under the detailed ground
  const os = Math.max(60000, size * 5), on = 256, oc = os / on, oh = new Float32Array((on + 1) * (on + 1)), ocol = new Uint8Array((on + 1) * (on + 1) * 3)
  // inside the map the backdrop must stay under the real ground: each of its points sits below the lowest ground within
  // one and a half of its cells, so no coarse triangle can poke up through a hollow
  const lowAround = (x: number, y: number) => {
    const r = Math.ceil((oc * 1.5) / cellM), ci = Math.round((x + size / 2) / cellM), cj = Math.round((size / 2 - y) / cellM)
    let m = Infinity
    for (let j = Math.max(0, cj - r); j <= Math.min(N, cj + r); j += 2) for (let i = Math.max(0, ci - r); i <= Math.min(N, ci + r); i += 2) m = Math.min(m, heights[j * w1 + i])
    return m - 10
  }
  for (let j = 0; j <= on; j++) for (let i = 0; i <= on; i++) {
    const x = -os / 2 + i * oc, y = os / 2 - j * oc, inside = Math.abs(x) < size / 2 - oc && Math.abs(y) < size / 2 - oc
    oh[j * (on + 1) + i] = inside ? Math.min(T.h(x, y), lowAround(x, y)) - 30 : T.h(x, y)
  }
  for (let j = 0; j <= on; j++) for (let i = 0; i <= on; i++) {
    const a = j * (on + 1) + i, hx = (oh[j * (on + 1) + Math.min(on, i + 1)] - oh[j * (on + 1) + Math.max(0, i - 1)]) / (2 * oc), hy = (oh[Math.min(on, j + 1) * (on + 1) + i] - oh[Math.max(0, j - 1) * (on + 1) + i]) / (2 * oc)
    to8(paint(-os / 2 + i * oc, os / 2 - j * oc, oh[a], Math.hypot(hx, hy), 0, [0, 0, 0, 0]), ocol, a * 3)
  }
  lap('outer', 'Raising the great buildings')
  // structures, then roads and canals drawn on the ground
  const b = new Builder(), gW = (x: number, z: number) => Hw(x, z)
  for (const st of doc.structures) structure(b, st, T, gW, seed, roads)
  const lamps: number[] = [...b.lamps]
  drawRoads(b, roads, lamps)
  riverBridges(b, roads, overRiver, gW, seed)
  const wp: number[] = []
  for (const c of canals) drawCanal(b, c, roads, gW, wp, lamps)
  const geo = {} as CityBuilt['geo']
  for (const m of MATS) { const g = b.geo[m]; geo[m] = { pos: new Float32Array(g.pos), nor: new Float32Array(g.nor), col: new Float32Array(g.col) } }
  lap('structures', 'Filling the lakes and rivers')
  // lake surfaces: grid cells near each lake where the ground dips below the water
  for (const l of T.lakes) { // flood the basin from the middle, so water never spills over the slopes outside it
    const cellLo = (i: number, j: number) => Math.min(heights[j * w1 + i], heights[j * w1 + i + 1], heights[(j + 1) * w1 + i], heights[(j + 1) * w1 + i + 1])
    const ci = Math.round((l.at[0] + size / 2) / cellM), cj = Math.round((size / 2 - l.at[1]) / cellM), seen = new Set<number>(), todo = [[ci, cj]]
    while (todo.length) {
      const [i, j] = todo.pop()!, k = j * w1 + i
      if (i < 0 || j < 0 || i >= N || j >= N || seen.has(k)) continue
      seen.add(k)
      const x = -size / 2 + i * cellM, z = -size / 2 + j * cellM
      if (cellLo(i, j) >= l.level || Math.hypot(x + cellM / 2 - l.at[0], -(z + cellM / 2) - l.at[1]) > l.r) continue
      const L = l.level, X = x + cellM, Z = z + cellM
      wp.push(x, L, z, x, L, Z, X, L, z, X, L, z, x, L, Z, X, L, Z)
      todo.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1])
    }
  }
  // rivers: a ribbon on the water surface (v runs downstream for the flow), widening downstream; falls where it drops
  const rp: number[] = [], ruv: number[] = [], falls: number[] = []
  for (const rv of T.rivers) {
    const pts = resample(rv.path, 5).map((p, i) => { const k = clamp((i * 5) / rv.step, 0, rv.prof.length - 1.001), q = Math.floor(k); return [p[0], lerp(rv.prof[q], rv.prof[q + 1], k - q) + 0.3, -p[1], lerp(rv.wid[q], rv.wid[q + 1], k - q)] })
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, az, aw] = pts[i], [bx, by, bz, bw] = pts[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l
      const A = aw * 0.58, B = bw * 0.58
      rp.push(ax - nx * A, ay, az - nz * A, ax + nx * A, ay, az + nz * A, bx - nx * B, by, bz - nz * B, bx - nx * B, by, bz - nz * B, ax + nx * A, ay, az + nz * A, bx + nx * B, by, bz + nz * B)
      const va = i * 5, vb = va + 5
      ruv.push(0, va, 1, va, 0, vb, 0, vb, 1, va, 1, vb)
      if ((ay - by) / l > 0.8 && (i === pts.length - 2 || (pts[i + 1][1] - pts[i + 2][1]) / 5 < 0.8)) falls.push(bx, by, bz, bw)
    }
  }
  const levels = [...new Set([...T.lakes.map((l) => l.level), ...canals.map((c) => c.level), ...(T.sea != null ? [T.sea] : [])])]
  lap('water')
  const parts = new Float32Array(out.parts)
  return {
    size, N, heights, colors, surf, minH, maxH, sea: T.sea, outer: { size: os, n: on, heights: oh, colors: ocol },
    parts, chimneys: new Float32Array(out.chimneys), trees: new Float32Array(trees), rocks: new Float32Array(rocks), lamps: new Float32Array(lamps),
    geo, water: new Float32Array(wp), rivers: { pos: new Float32Array(rp), uv: new Float32Array(ruv) }, falls: new Float32Array(falls), waterLevels: levels,
    counts: { buildings: out.count, structures: doc.structures.length, roads: roads.length, trees: trees.length / TSTRIDE }, ms: Date.now() - t0, stages,
  }
}

/** Road surfaces with kerbs, real steps on stairs, and street lamps along main roads and better lanes. */
function drawRoads(b: Builder, roads: Road[], lamps: number[]) {
  b.frame(0, 0, 0, 0)
  const kerb = lin('#8e877a'), Y: V = [0, 1, 0]
  for (const r of roads) {
    const p = r.pts, half = r.width / 2
    const col = r.kind === 'main' ? lin('#aaa294') : r.kind === 'stairs' ? lin('#b0a898') : mix(lin('#9c8e78'), lin('#b2aa9a'), r.wealth)
    if (r.kind === 'stairs') {
      for (let i = 0; i < p.length - 1; i++) {
        const [ax, ay, az] = p[i], [bx, by, bz] = p[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * half, nz = (dx / l) * half
        const steps = Math.max(1, Math.round(Math.abs(ay - by) / 0.3)), hi = Math.max(ay, by), lo = Math.min(ay, by), down = ay > by
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps, y = (down ? hi - (hi - lo) * t0 : lo + (hi - lo) * t1) + 0.15
          const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1
          b.face('road', [[x0 - nx, y, z0 - nz], [x0 + nx, y, z0 + nz], [x1 + nx, y, z1 + nz], [x1 - nx, y, z1 - nz]], col, [x0, y - 1, z0])
          const yr = down ? y - (hi - lo) / steps : y, xe = down ? x1 : x0, ze = down ? z1 : z0
          b.face('road', [[xe - nx, yr, ze - nz], [xe + nx, yr, ze + nz], [xe + nx, y, ze + nz], [xe - nx, y, ze - nz]], mix(col, [0, 0, 0], 0.25), [xe - (down ? dx : -dx) / l, y - 0.1, ze - (down ? dz : -dz) / l])
        }
      }
      continue
    }
    const lift = r.kind === 'main' ? 0.3 : 0.22, kerbs = r.kind === 'main'
    let ka = 0
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay, az] = p[i], [bx, by, bz] = p[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * half, nz = (dx / l) * half
      b.face('road', [[ax - nx, ay + lift, az - nz], [ax + nx, ay + lift, az + nz], [bx + nx, by + lift, bz + nz], [bx - nx, by + lift, bz - nz]], col, [ax, ay - 5, az])
      if (kerbs && (i - ka >= 3 || i === p.length - 2)) { // kerbs in longer pieces
        const [kx, ky, kz] = p[ka], kl = Math.hypot(bx - kx, bz - kz) || 1, mx = (-(bz - kz) / kl) * half, mz = ((bx - kx) / kl) * half
        for (const s of [-1, 1]) b.beam('road', [kx + mx * s, ky + lift + 0.1, kz + mz * s], [bx + mx * s, by + lift + 0.1, bz + mz * s], 0.35, 0.4, Y, kerb, true)
        ka = i + 1
      }
    }
    const every = r.kind === 'main' ? 32 : r.wealth > 0.45 ? 48 : 0
    if (every) for (let i = 2, side = 1; i < p.length - 1; i += Math.round(every / 4), side = -side) {
      const [ax, ay, az] = p[i], [bx, , bz] = p[i + 1], l = Math.hypot(bx - ax, bz - az) || 1, ox = (-(bz - az) / l) * (half + 0.6) * side, oz = ((bx - ax) / l) * (half + 0.6) * side
      b.cyl('metal', ax + ox, ay, az + oz, 0.1, 0.07, 4.2, 6, lin('#2a2a2c'), false)
      lamps.push(ax + ox, ay + 4.4, az + oz)
    }
  }
}

/** A stone bridge wherever a road runs over a river: from the last dry point before to the first after. */
function riverBridges(b: Builder, roads: Road[], over: (x: number, y: number) => boolean, gW: (x: number, z: number) => number, seed: number) {
  const stone = lin('#b8ae9a')
  roads.forEach((r, ri) => {
    if (r.kind === 'stairs') return
    const p = r.pts
    for (let i = 1; i < p.length - 1; i++) {
      if (!over(p[i][0], -p[i][2])) continue
      let j = i
      while (j < p.length - 1 && over(p[j][0], -p[j][2])) j++
      const a = p[Math.max(0, i - 2)], c = p[Math.min(p.length - 1, j + 1)], len = Math.hypot(c[0] - a[0], c[2] - a[2])
      if (len > 4) {
        const deck = Math.max(a[1], c[1]) + 0.6, spans = Math.max(1, Math.round(len / 28))
        arcade(b, a[0], a[2], deck, c[0], c[2], deck, gW, { width: r.width + 1.6, span: len / spans, deckT: 1.6, col: stone, seed: seed + ri * 31 + i, statues: r.kind === 'main' && len > 50 })
      }
      i = j
    }
  })
}

/** A canal: stone walls from the bed to the quays with copings, the still water, bridges wherever a road crosses, lamps. */
function drawCanal(b: Builder, c: { s: Structure; pts: XY[]; w: number; level: number }, roads: Road[], gW: (x: number, z: number) => number, wp: number[], lamps: number[]) {
  const stone = c.s.color ? lin(c.s.color) : lin('#b4aa96'), cope = mix(stone, [1, 1, 1], 0.15), quay = c.level + 1.6, bed = c.level - 3
  const P = c.pts.map((p) => W(p))
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, hw = c.w / 2
    b.frame(0, 0, 0, 0)
    for (const sd of [-1, 1]) {
      const cs: V[] = []
      for (let k = 0; k < 8; k++) { const e = k & 1 ? [bx, bz] : [ax, az], o = hw + (k & 4 ? 0.9 : 0); cs.push([e[0] + nx * o * sd, k & 2 ? quay : bed, e[1] + nz * o * sd]) }
      b.hexa('stone', cs, stone)
      b.beam('stone', [ax + nx * (hw + 0.45) * sd, quay + 0.15, az + nz * (hw + 0.45) * sd], [bx + nx * (hw + 0.45) * sd, quay + 0.15, bz + nz * (hw + 0.45) * sd], 1.1, 0.3, [0, 1, 0], cope, true)
    }
    const A = hw + 0.1, L = c.level
    wp.push(ax - nx * A, L, az - nz * A, bx - nx * A, L, bz - nz * A, ax + nx * A, L, az + nz * A, ax + nx * A, L, az + nz * A, bx - nx * A, L, bz - nz * A, bx + nx * A, L, bz + nz * A)
    if (i % 9 === 4) for (const sd of [-1, 1]) { const lx = ax + nx * (hw + 2.5) * sd, lz = az + nz * (hw + 2.5) * sd; b.cyl('metal', lx, quay, lz, 0.1, 0.07, 4, 6, lin('#2a2a2c'), false); lamps.push(lx, quay + 4.2, lz) }
    for (const r of roads) for (let k = 0; k < r.pts.length - 1; k++) { // a stone bridge wherever a road crosses
      const p = r.pts[k], q = r.pts[k + 1]
      if (!cross2(p[0], p[2], q[0], q[2], ax, az, bx, bz)) continue
      const rx = q[0] - p[0], rz = q[2] - p[2], rl = Math.hypot(rx, rz) || 1, mx = (p[0] + q[0]) / 2, mz = (p[2] + q[2]) / 2, half = hw + 4
      const deck = Math.max(quay + 1.2, (p[1] + q[1]) / 2 + 0.3)
      arcade(b, mx - (rx / rl) * half, mz - (rz / rl) * half, deck, mx + (rx / rl) * half, mz + (rz / rl) * half, deck, gW, { width: r.width + 1.5, span: half * 2, deckT: 1.4, col: stone, seed: k, statues: false })
    }
  }
}

function structure(b: Builder, st: Structure, T: TerrainFn, gW: (x: number, z: number) => number, seed: number, roads: Road[]) {
  const C = st.color ? lin(st.color) : lin('#d8d0bc'), sd = seed + hash(st.id), k = st.scale ?? SCALE[st.kind] ?? 1
  const flat = T.flats.find((f) => f.id === st.id), fp = footprint(st), roof = st.roof ? lin(st.roof) : lin('#56606a')
  if (st.kind === 'road' || st.kind === 'canal') return
  if (st.kind === 'bridge' || st.kind === 'aqueduct') {
    const path = st.kind === 'bridge' ? [st.at!, st.to!] : st.path!
    if (!path.every(Boolean) || path.length < 2) return
    const total = polyLen(path)
    const h0 = st.deck?.[0] ?? T.h(...path[0]) + (st.kind === 'bridge' ? 1 : 15)
    const h1 = st.deck?.[1] ?? (st.kind === 'bridge' ? T.h(...path[path.length - 1]) + 1 : h0 - total * 0.003)
    let run = 0
    for (let i = 0; i < path.length - 1; i++) {
      const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]), [ax, az] = W(path[i]), [bx, bz] = W(path[i + 1])
      arcade(b, ax, az, lerp(h0, h1, run / total), bx, bz, lerp(h0, h1, (run + l) / total), gW, {
        width: st.width ?? (st.kind === 'bridge' ? 14 : 5), span: st.span ?? (st.kind === 'bridge' ? 60 : 22), deckT: st.kind === 'bridge' ? 3 : 2,
        aqueduct: st.kind === 'aqueduct', statues: st.statues ?? st.kind === 'bridge', towers: st.kind === 'bridge' && i === 0 && path.length === 2, col: C, seed: sd + i,
      })
      run += l
    }
    return
  }
  if (st.kind === 'wall' && st.path && st.path.length > 1) {
    const pts: V[] = resample(st.path, 6).map((p) => { const [x, z] = W(p); return [x, gW(x, z), z] as V })
    // gates where main roads cross, and wherever the recipe asks
    const gates = new Set<number>()
    for (const r of roads) if (r.kind === 'main') for (let i = 0; i < r.pts.length - 1; i++) for (let j = 0; j < pts.length - 1; j++) if (cross2(r.pts[i][0], r.pts[i][2], r.pts[i + 1][0], r.pts[i + 1][2], pts[j][0], pts[j][2], pts[j + 1][0], pts[j + 1][2])) gates.add(j)
    for (const g of st.gates ?? []) { const [gx, gz] = W(g); let bi = 0, bd = Infinity; pts.forEach((p, i) => { const d = Math.hypot(p[0] - gx, p[2] - gz); if (d < bd) { bd = d; bi = i } }); gates.add(bi) }
    const merged = [...gates].sort((a, c) => a - c).filter((g, i, a) => !i || g - a[i - 1] > 4)
    cityWall(b, pts, st.height ?? 14, 110, merged, C, roof)
    return
  }
  if (st.kind === 'harbour' && st.at) {
    const [cx, cz] = W(st.at), lake = T.lakes.find((l) => Math.hypot(st.at![0] - l.at[0], st.at![1] - l.at[1]) < l.r + 200)
    harbour(b, cx, st.level ?? lake?.level ?? T.sea ?? T.h(...st.at), cz, yawOf(st.facing), st.width ?? 160, sd, C)
    return
  }
  if (!st.at || !flat || !fp) return
  const [fx, fy] = facingVec(st.facing), y = flat.level, yaw = yawOf(st.facing)
  const [ox, oz] = W([st.at[0] + fx * fp.back, st.at[1] + fy * fp.back]), [cx, cz] = W(st.at)
  // where the ground falls away, a retaining wall carries the terrace (plazas and the colonnade bring their own)
  if (st.kind !== 'plaza' && st.kind !== 'colonnade') {
    let low = T.base(...st.at)
    for (let a = 0; a < 24; a++) low = Math.min(low, T.base(st.at[0] + Math.cos((a / 12) * Math.PI) * fp.r, st.at[1] + Math.sin((a / 12) * Math.PI) * fp.r))
    if (low < y - 3) {
      b.frame(cx, 0, cz, 0)
      const wc = mix(C, lin('#8a8070'), 0.45)
      b.cyl('stone', 0, low - 6, 0, fp.r + 3, fp.r, y - low + 5.6, Math.max(32, Math.round(fp.r / 3)), wc, false)
      b.cyl('stone', 0, y - 0.4, 0, fp.r + 0.6, fp.r + 0.6, 1.2, Math.max(32, Math.round(fp.r / 3)), C)
    }
  }
  switch (st.kind) {
    case 'cathedral': cathedral(b, ox, y, oz, yaw, k, sd, C); break
    case 'basilica': basilica(b, ox, y, oz, yaw, k, sd, C); break
    case 'dome': domeChurch(b, ox, y, oz, yaw, k, sd, C, st.roof ? roof : lin('#5a7a78')); break
    case 'palace': palace(b, ox, y, oz, yaw, st.width ?? 80, st.depth ?? 64, sd, C, st.roof ? roof : lin('#4f6a68')); break
    case 'monastery': monastery(b, ox, y, oz, yaw, sd, C, st.roof ? roof : lin('#6e5040')); break
    case 'colonnade': colonnade(b, cx, y, cz, yaw, st.radius ?? 120, sd, C); break
    case 'tower': tower(b, cx, y, cz, yaw, st.width ?? 12, st.height ?? 70, sd, C); break
    case 'plaza': plaza(b, cx, y, cz, st.radius ?? 40, Math.min(y, T.base(...st.at)) - 30, st.centre ?? 'fountain', st.statues ?? true, sd, C); break
    case 'statue': b.frame(cx, y, cz, yaw); statue(b, 0, 0, 0, 0, st.height ?? 20, sd, st.color === 'bronze' ? BRONZE : st.color ? C : MARBLE); break
  }
}
const cross2 = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
  return d1 * d2 < 0 && d3 * d4 < 0
}

// ---------- checks and descriptions ----------
export function validate(doc: LocationDoc) {
  const errors: string[] = [], warnings: string[] = []
  if (!doc || typeof doc !== 'object') return { errors: ['not a location'], warnings }
  if (!doc.id || !doc.name || !doc.seed) errors.push('needs id, name and seed')
  if (!(doc.size >= 1000 && doc.size <= 60000)) errors.push('size must be 1000..60000 metres')
  for (const k of ['terrain', 'districts', 'structures'] as const) if (!Array.isArray(doc[k])) errors.push(`${k} must be a list`)
  if (doc.weather && !WEATHERS.includes(doc.weather)) errors.push(`weather: use ${WEATHERS.join(', ')}`)
  if (doc.season && !SEASONS.includes(doc.season)) errors.push(`season: use ${SEASONS.join(', ')}`)
  if (doc.climate && !CLIMATES.includes(doc.climate)) errors.push(`climate: use ${CLIMATES.join(', ')}`)
  if (doc.culture && doc.culture !== 'mixed' && !CULTURES.includes(doc.culture)) errors.push(`culture: use ${CULTURES.join(', ')} or mixed`)
  if (errors.length) return { errors, warnings }
  const ids = new Set<string>(), half = doc.size / 2
  const out = (p: number[]) => Math.abs(p[0]) > half || Math.abs(p[1]) > half
  const pt = (p: unknown, what: string, path = false) => { if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) { errors.push(`${what}: needs [x, y]`); return false } if (!path && out(p)) warnings.push(`${what} is outside the map`); return true }
  // paths may run off the edge (ranges, coasts, rivers to the sea); only one that never comes onto the map is a mistake
  const pts = (p: unknown, n: number, what: string) => { if (!Array.isArray(p) || p.length < n) { errors.push(`${what}: needs at least ${n} points`); return false } const ok = p.every((q, i) => pt(q, `${what} point ${i + 1}`, true)); if (ok && p.every(out)) warnings.push(`${what} is entirely outside the map`); return ok }
  const named = (o: { id: string; name?: string }, what: string) => { if (!o.id) errors.push(`${what} without an id`); else if (ids.has(o.id)) errors.push(`duplicate id ${o.id}`); ids.add(o.id); if (!o.name) warnings.push(`${o.id}: give it a name`) }
  for (const f of doc.terrain) {
    named(f, 'terrain feature')
    const w = `${f.id} (${f.kind})`
    if (!TERRAIN_KINDS.includes(f.kind)) { errors.push(`${w}: unknown kind; use ${TERRAIN_KINDS.join(', ')}`); continue }
    if (f.kind === 'peak' && (pt(f.at, w), f.height == null)) errors.push(`${w}: needs height (summit altitude)`)
    if ((f.kind === 'ridge' || f.kind === 'valley') && (pts(f.path, 2, w), f.height == null)) errors.push(`${w}: needs height (${f.kind === 'ridge' ? 'crest' : 'floor'} altitude)`)
    if (f.kind === 'river' || f.kind === 'cliff' || f.kind === 'gorge' || f.kind === 'glacier') pts(f.path, 2, w)
    if (f.kind === 'lake') pt(f.at, w)
    if (f.kind === 'plateau' || f.kind === 'fields') { if (f.area) pts(f.area, 3, w); else if (!f.at) errors.push(`${w}: needs area or at + radius`); else pt(f.at, w); if (f.kind === 'plateau' && f.height == null) errors.push(`${w}: needs height`) }
    if (f.kind === 'fields' && f.crop && !CROPS.includes(f.crop)) errors.push(`${w}: crop: use ${CROPS.join(', ')}`)
  }
  for (const d of doc.districts) {
    named(d, 'district')
    if (d.area) pts(d.area, 3, d.id); else if (d.at) pt(d.at, d.id); else errors.push(`${d.id}: needs area or at + radius`)
    if (d.culture && d.culture !== 'mixed' && !CULTURES.includes(d.culture)) errors.push(`${d.id}: culture: use ${CULTURES.join(', ')} or mixed`)
  }
  for (const s of doc.structures) {
    named(s, 'structure')
    const w = `${s.id} (${s.kind})`
    if (!STRUCTURE_KINDS.includes(s.kind)) { errors.push(`${w}: unknown kind; use ${STRUCTURE_KINDS.join(', ')}`); continue }
    if (s.kind === 'bridge') { pt(s.at, `${w} at`); pt(s.to, `${w} to`) } else if (s.kind === 'aqueduct' || s.kind === 'wall' || s.kind === 'road' || s.kind === 'canal') pts(s.path, 2, w); else pt(s.at, w)
  }
  if (errors.length) return { errors, warnings }
  const T = terrainOf(doc)
  for (const s of doc.structures) {
    const fp = footprint(s)
    if (fp && s.at) {
      const f = T.flats.find((q) => q.id === s.id)!
      let worst = 0
      for (let a = 0; a < 16; a++) worst = Math.max(worst, Math.abs(T.base(s.at[0] + Math.cos(a) * fp.r, s.at[1] + Math.sin(a) * fp.r) - f.level))
      if (worst > 90) warnings.push(`${s.id}: steep site, the ground is cut or filled by up to ${Math.round(worst)} m; move it, set level, or put a plateau under it`)
      if (T.water(...s.at) != null) warnings.push(`${s.id}: stands in water`)
    }
    if (s.kind === 'harbour' && s.at && !T.lakes.some((l) => Math.hypot(s.at![0] - l.at[0], s.at![1] - l.at[1]) < l.r + 200) && !(T.sea != null && T.h(s.at[0] + facingVec(s.facing)[0] * 60, s.at[1] + facingVec(s.facing)[1] * 60) < T.sea)) warnings.push(`${s.id}: a harbour needs a lake or the sea in front of it (facing points at the water)`)
    if (s.kind === 'bridge' && s.at && s.to) {
      const h0 = s.deck?.[0] ?? T.h(...s.at) + 1, h1 = s.deck?.[1] ?? T.h(...s.to) + 1
      for (let t = 0.1; t < 0.95; t += 0.05) { const g = T.h(lerp(s.at[0], s.to[0], t), lerp(s.at[1], s.to[1], t)); if (g > lerp(h0, h1, t) + 6) { warnings.push(`${s.id}: the deck runs into the ground ${Math.round(t * 100)}% of the way across; raise deck or move an end`); break } }
    }
  }
  for (const r of T.rivers) { // a river has to go somewhere: a lake, the sea, another river or off the map
    const end = r.path[r.path.length - 1], hEnd = r.prof[r.prof.length - 1]
    const ok = Math.abs(end[0]) > half - 200 || Math.abs(end[1]) > half - 200 || T.lakes.some((l) => Math.hypot(end[0] - l.at[0], end[1] - l.at[1]) < l.r) || (T.sea != null && hEnd < T.sea + 5) || T.rivers.some((o) => o !== r && pathNearFast(o.path, end[0], end[1], o.width * 2).d < o.width * 2)
    if (!ok) warnings.push(`${r.id}: the river ends nowhere; end it in a lake, the sea, another river or at the map edge`)
  }
  return { errors, warnings }
}

export function describe(doc: LocationDoc, built?: CityBuilt) {
  const T = terrainOf(doc), r = (n: number) => Math.round(n).toLocaleString('en'), xy = (p: XY) => `[${r(p[0])}, ${r(p[1])}]`
  const lines = [`${doc.name} (${doc.id}): ${r(doc.size)} m square, seed "${doc.seed}", ${doc.climate ?? 'temperate'} climate${doc.sea != null ? `, sea at ${r(doc.sea)} m` : ''}, mood ${doc.mood ?? 'morning'}`]
  if (built) lines.push(`ground ${r(built.minH)}..${r(built.maxH)} m, ${r(built.counts.buildings)} buildings, ${built.counts.roads} roads/lanes/stairs, ${r(built.counts.trees)} trees, ${built.counts.structures} structures; built in ${(built.ms / 1000).toFixed(1)} s`)
  lines.push('', 'Terrain:')
  for (const f of doc.terrain) lines.push(`  ${f.id} ${f.kind} "${f.name ?? ''}" ${f.at ? 'at ' + xy(f.at) : f.path ? `${f.path.length}-point path` : f.area ? `${f.area.length}-point area` : ''} ${f.height != null ? 'height ' + r(f.height) : ''}${f.level != null ? 'level ' + r(f.level) : ''}${f.crop ? ' ' + f.crop : ''}`)
  lines.push('', 'Districts:')
  for (const d of doc.districts) {
    let n = 0
    if (built) for (let k = 0; k < built.parts.length; k += PSTRIDE) if (built.parts[k] === PART.wall && built.parts[k + 12] < 50 && areaDist(d, built.parts[k + 1], -built.parts[k + 3]) <= 0) n++
    lines.push(`  ${d.id} "${d.name ?? ''}" ${d.culture ?? doc.culture ?? 'central'} ${d.area ? `${d.area.length}-point area` : `at ${xy(d.at!)} r ${r(d.radius ?? 300)}`}${built ? `, ${r(n)} wall blocks` : ''}`)
  }
  lines.push('', 'Structures:')
  for (const s of doc.structures) lines.push(`  ${s.id} ${s.kind} "${s.name ?? ''}" ${s.at ? `at ${xy(s.at)} ground ${r(T.h(...s.at))}` : ''}${s.to ? ` to ${xy(s.to)} ground ${r(T.h(...s.to))}` : ''}${s.path ? ` ${s.path.length}-point path, ${r(polyLen(s.path))} m` : ''}`)
  if (doc.views?.length) lines.push('', 'Views:', ...doc.views.map((v) => `  "${v.name}" at ${xy([v.at[0], v.at[1]])} alt ${r(v.at[2])} heading ${r(v.heading)} pitch ${r(v.pitch)}`))
  if (built) lines.push('', 'Build stages (ms): ' + Object.entries(built.stages).map(([k, v]) => `${k} ${v}`).join(', '))
  return lines.join('\n')
}

export function brief() {
  return `# Locations: recipe format
A location is JSON: { id, name, seed, size (metres, square), base?, relief?, snowline?, sea? (sea level altitude), climate? (${CLIMATES.join('|')}),
culture? (default building culture: ${CULTURES.join('|')}|mixed), erosion? (0..2, default 1), wealth?: [lowAlt, highAlt], roads? (default true), forest? (0..2),
mood?, hour? (0-24), weather?, season?, terrain: [], districts: [], structures: [], views?: [] }.
Coordinates are metres from the centre: x east, y north. Heights are altitudes in metres. Later terrain features win over earlier ones.
The background is a procedural mountain range (base altitude, relief = amplitude), then rain erodes it. Give everything an id; the user names things.

Terrain (kind: fields):
- peak: at, height (summit), radius (default 1500), sharp (default 1.4; higher = needle, below 1 = rounded summit)
- ridge: path, height (crest), width (half-width at the foot, default 900)
- valley: path, height (floor altitude), width (default 500), edge (half-width of a flat floodplain, default 0 = V-shaped)
- cliff: path, drop (120), side (left|right of the path's direction is the low side; default right), extent (how far the low ground runs, 1600), meander (how much the edge wanders, 1);
  for a coast, walk the path with the sea on your right and give it a big drop
- gorge: path, depth (160), width (70); near-vertical rock walls (run a river along the same path)
- glacier: path from the head down to the tongue, width (380), height (tongue altitude, default 700 m below the head), depth (ice thickness, 70)
- river: path from source to mouth, width (24 at the mouth; narrower upstream), depth (4), meander (0..2, default 1); never flows uphill, falls over
  cliffs into plunge pools; it must end in a lake, the sea, another river or at the map edge
- lake: at, radius, level (default: the ground there), depth; the shore is irregular, and a lip forms only where the ground would spill
- plateau: area (polygon) or at + radius, height, edge (blend width, default 150); use a wide edge for a natural shoulder
- fields: area or at + radius, crop (${CROPS.join('|')}), angle (parcel grid), step (terrace height for vines/olives/terraces, 3.5);
  parcels with their own crops, rows of vines, orchards and olive groves, dry-stone walls or hedges, farmsteads
With sea set, everything below it is ocean: beaches where the shore is low and gentle, sea cliffs where it is steep.

Districts: area (polygon) or at + radius; culture (${CULTURES.join(', ')}, mixed); density 0..1 (default 0.8); wealth 0..1 to override; steep: true for cliff towns.
Streets are lined with houses facing them, then back houses fill in. Wealth follows altitude (and rises near great buildings):
low = small, cramped, plain; high = large houses, palazzi with courtyards, towers, domes. Cultures:
- central: timber framing over stone, steep tile or slate roofs, gable-fronted town houses, stepped gables, dormers, needle and onion spires
- mediterranean: warm stucco, low barrel-tile roofs, flat roof terraces, loggias and arcades, balconies, awnings, campaniles, courtyards
- mountain: rubble stone with wooden upper floors and balconies, low roofs of stone slabs with deep eaves; steep districts become whitewashed cube towns
- eastern: whitewash and banded stone, flat roofs with parapets, domes, cupolas, onion domes, minarets, pointed arches, carved wooden balconies
Roads are automatic: main roads join plazas, great buildings, bridge ends, harbours and points across districts (switchbacks on slopes);
terraced lanes follow the contours inside districts and stairs climb between them; flat districts get a loose grid.

Structures (kind: fields; facing is a compass bearing the front faces, 0 = north, 180 = south):
- cathedral: at, facing, scale (1 = 79 m spires; Cologne is about 2, the default 1.9)
- basilica: at, facing, scale (Sagrada style; 1 = central tower 172 m)
- dome: at, facing, scale, roof colour (St Peter's style domed basilica)
- palace: at, facing, width (80), depth (64), roof colour (courtyard palace with corner towers and portico)
- monastery: at, facing (walled abbey: church, cloister, dormitory, bell tower)
- colonnade: at, facing (the open side), radius (oval half-width, default 120); statues on top, obelisk, fountains
- tower: at, facing, width (12), height (70)
- plaza: at, radius (40), centre fountain|obelisk|statue|none, statues (true)
- statue: at, facing, height (figure height, default 20), color ("bronze" or a hex colour)
- bridge: at, to, width (14), span (60), deck [altA, altB] (default: the ground at each end), statues
- aqueduct: path, width (5), span (22), deck [start, end] altitudes (default: 15 m up, falling gently)
- wall: path, height (14), gates [[x, y], ...]; towers every 110 m; gatehouses also appear wherever a main road crosses
- canal: path, width (12), level (default just below the lowest ground on the path); stone walls, quays, bridges where roads cross
- harbour: at (on a lake shore or the coast), facing (towards the water), width (quay length, 160); piers, boats, a lighthouse
- road: path of waypoints; a main road is routed through them in order
Structures with an at (except harbours) flatten the ground around them at their level (default: the ground there); set level to choose.
Colours are hex ("#d8d0bc"). Moods: ${MOOD_NAMES.join(', ')}. Weather: ${WEATHERS.join(', ')}. Seasons: ${SEASONS.join(', ')}.
Views: { name, at: [x, y, altitude], heading, pitch (degrees, negative = down), note?, hour?, weather?, season? } (the Tour button glides through them,
showing each note and switching to its hour, weather and season).

Workflow: node scripts/loc.ts validate <file>, describe <file>, preview <file> out.png; fix warnings (steep sites, decks in the ground, rivers that end nowhere).`
}
