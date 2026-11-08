// Locations: a city-scale place built from a short recipe that Claude writes (the user names things).
// A location is seed + size + named terrain features (peaks, ridges, valleys, rivers, glacial lakes, plateaus) +
// districts (areas filled with buildings whose wealth follows altitude, laced with lanes and stairs) + structures
// (megastructure kits, walls, roads). Main roads, forests, rocks, chimneys and lamps are worked out from those.
// Everything is deterministic. Pure: node tests, the CLI and the worker run it.
// Recipe coordinates are metres from the centre, x east and y north; heights are altitudes in metres.
import { fbm, hash, ridged, rng, simplex } from '../world/noise.ts'
import { arcade, basilica, BRONZE, Builder, cathedral, cityWall, colonnade, domeChurch, harbour, lin, MARBLE, MATS, mix, monastery, palace, plaza, statue, tower, type Col, type Mat, type V } from './kit.ts'
import { carve, planRoads, RoadIndex, roadMask, sampler, type Road } from './roads.ts'

export type XY = [number, number]
export const TERRAIN_KINDS = ['peak', 'ridge', 'valley', 'river', 'lake', 'plateau'] as const
export const STRUCTURE_KINDS = ['cathedral', 'basilica', 'colonnade', 'dome', 'palace', 'monastery', 'tower', 'plaza', 'statue', 'bridge', 'aqueduct', 'wall', 'harbour', 'road'] as const
export const MOOD_NAMES = ['morning', 'noon', 'golden', 'mist', 'dusk', 'night'] as const
export const WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'storm'] as const
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type MoodName = typeof MOOD_NAMES[number]
export type Weather = typeof WEATHERS[number]
export type Season = typeof SEASONS[number]
export interface TerrainFeature {
  id: string; kind: typeof TERRAIN_KINDS[number]; name?: string; note?: string
  at?: XY; path?: XY[]; area?: XY[]
  height?: number // summit / crest / valley floor / plateau altitude
  radius?: number; width?: number; level?: number; depth?: number; sharp?: number; edge?: number
}
export interface District { id: string; name?: string; note?: string; area?: XY[]; at?: XY; radius?: number; density?: number; wealth?: number; steep?: boolean }
export interface Structure {
  id: string; kind: typeof STRUCTURE_KINDS[number]; name?: string; note?: string
  at?: XY; to?: XY; path?: XY[]; facing?: number; scale?: number; height?: number; width?: number; depth?: number; radius?: number; span?: number
  level?: number; deck?: [number, number]; color?: string; roof?: string; statues?: boolean; centre?: 'fountain' | 'obelisk' | 'statue' | 'none'; gates?: XY[]
}
export interface View { name: string; at: [number, number, number]; heading: number; pitch: number }
export interface LocationDoc {
  id: string; name: string; seed: string; size: number; note?: string
  base?: number; relief?: number; snowline?: number; wealth?: [number, number]; roads?: boolean; forest?: number
  mood?: MoodName; hour?: number; weather?: Weather; season?: Season
  terrain: TerrainFeature[]; districts: District[]; structures: Structure[]; views?: View[]
}
export const BSTRIDE = 18 // x y0 z yaw w d hBody groundY roofType roofH floorH wealth  wall rgb  roof rgb
export const TSTRIDE = 6 // trees: x y z scale kind(0 broadleaf, 1 conifer) shade
export const ROOF = { flat: 0, gable: 1, hip: 2, spire: 3, dome: 4 } as const
const DEG = Math.PI / 180

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const smax = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25 }
const smin = (a: number, b: number, k: number) => -smax(-a, -b, k)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Distance to a polyline and how far along it the nearest point lies. */
function pathNear(path: XY[], x: number, y: number) {
  let best = Infinity, along = 0, run = 0
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, l = Math.sqrt(l2)
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2), d = Math.hypot(x - ax - dx * t, y - ay - dy * t)
    if (d < best) { best = d; along = run + t * l }
    run += l
  }
  return { d: best, s: along }
}
const pathDist = (path: XY[], x: number, y: number) => pathNear(path, x, y).d
export function inPoly(p: XY[], x: number, y: number) {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c
  return c
}
/** Signed distance to an area (negative inside): a polygon or a circle. */
const rings = new WeakMap<XY[], XY[]>()
const areaDist = (f: { area?: XY[]; at?: XY; radius?: number }, x: number, y: number) => {
  if (!f.area) return Math.hypot(x - f.at![0], y - f.at![1]) - (f.radius ?? 300)
  let ring = rings.get(f.area)
  if (!ring) { ring = [...f.area, f.area[0]]; rings.set(f.area, ring) }
  return (inPoly(f.area, x, y) ? -1 : 1) * pathDist(ring, x, y)
}
const polyLen = (p: XY[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0)
const bboxOf = (d: { area?: XY[]; at?: XY; radius?: number }): [number, number, number, number] => {
  const pts = d.area ?? [[d.at![0] - (d.radius ?? 300), d.at![1] - (d.radius ?? 300)], [d.at![0] + (d.radius ?? 300), d.at![1] + (d.radius ?? 300)]] as XY[]
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]
}

// ---------- structures: footprints ----------
const SCALE: Partial<Record<Structure['kind'], number>> = { cathedral: 1.9, basilica: 1, dome: 1 }
/** Where a structure sits and how much flat ground it needs; arcades, walls, harbours and roads need none. */
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
export interface River { id: string; path: XY[]; width: number; prof: number[]; step: number }
export interface TerrainFn {
  h: (x: number, y: number) => number; base: (x: number, y: number) => number; water: (x: number, y: number) => number | null
  lakes: { at: XY; r: number; level: number }[]; flats: { at: XY; r: number; level: number; id: string }[]; rivers: River[]
}
export function terrainOf(doc: LocationDoc): TerrainFn {
  const s = hash(doc.seed), n1 = simplex(s), n2 = simplex(s ^ 0x5151), base = doc.base ?? 500, relief = doc.relief ?? 500
  const feats = doc.terrain.filter((f) => TERRAIN_KINDS.includes(f.kind))
  const lakeLevel = new Map<TerrainFeature, number>(), riverOf = new Map<TerrainFeature, River>()
  const hb = (x: number, y: number, upto = feats.length): number => {
    const wx = x + fbm(n2, x / 3000, 1, y / 3000, 3) * 900, wy = y + fbm(n2, x / 3000, 5, y / 3000, 3) * 900
    let h = base + relief * (ridged(n1, wx / 5200, 0, wy / 5200, 6) * 1.15 - 0.35) + fbm(n1, x / 500, 9, y / 500, 4) * relief * 0.06 + ridged(n2, x / 160, 13, y / 160, 3) * relief * 0.025
    const floor = base - relief * 0.45 // feature profiles end below the background, so their edges leave no step
    for (let fi = 0; fi < upto; fi++) {
      const f = feats[fi]
      if (f.kind === 'peak' && f.at && f.height != null) {
        const r = f.radius ?? 1500, d = Math.hypot(x - f.at[0], y - f.at[1])
        if (d >= r) continue
        const t = d / r, crag = ridged(n2, x / 650, 3, y / 650, 4) - 0.5
        const gully = ridged(n1, x / 260, 17, y / 260, 3) - 0.55 // ravines down the flanks
        const p = floor + (f.height - floor) * (1 - t) ** (f.sharp ?? 1.4) + (crag * 0.14 + gully * 0.07) * (f.height - base) * (1 - t)
        h = smax(h, p, 1 + 150 * (1 - t)) // the blend narrows to nothing at the edge, so no seam
      } else if (f.kind === 'ridge' && f.path && f.height != null) {
        const w = f.width ?? 900, d = pathDist(f.path, x, y)
        if (d >= w) continue
        const t = d / w, crest = 0.86 + 0.28 * (ridged(n2, x / 900, 7, y / 900, 3))
        const gully = ridged(n1, x / 240, 19, y / 240, 3) - 0.55
        h = smax(h, floor + (f.height - floor) * crest * (1 - t) ** (f.sharp ?? 1.3) + gully * (f.height - base) * 0.08 * (1 - t), 1 + 120 * (1 - t))
      } else if (f.kind === 'valley' && f.path && f.height != null) {
        const w = f.width ?? 500, d = pathDist(f.path, x, y)
        if (d > w * 3) continue
        h = smin(h, f.height + (d / w) ** 2 * 900 + fbm(n2, x / 300, 2, y / 300, 2) * 15, 90)
      } else if (f.kind === 'river' && f.path && f.path.length > 1) {
        const rv = riverAt(f, fi), w = rv.width, { d, s: along } = pathNear(f.path, x, y)
        if (d > w * 4) continue
        const surf = profAt(rv, along), bed = surf - (f.depth ?? 4)
        h = smin(h, bed + Math.max(0, d / (w * 0.5)) ** 2 * ((f.depth ?? 4) + 2), 6)
      } else if (f.kind === 'lake' && f.at) {
        const lv = levelOf(f, fi), d = Math.hypot(x - f.at[0], y - f.at[1]), r0 = f.radius ?? 400
        const r = r0 * (1 + 0.28 * fbm(n2, x / (r0 * 1.4), 11, y / (r0 * 1.4), 2)), q = d / r
        if (q < 1) h = smin(h, lv - (f.depth ?? 40) * (1 - q * q), 30)
        else if (q < 1.6) h += Math.max(0, lv + 1.5 - (d - r) * 0.04 - h) * (1 - (q - 1) / 0.6) // a moraine lip only where the ground would spill
      } else if (f.kind === 'plateau' && f.height != null && (f.area || f.at)) {
        const e = f.edge ?? 150, sd = areaDist(f, x, y)
        if (sd < e) h = lerp(h, f.height + fbm(n2, x / 200, 4, y / 200, 2) * 4, sstep(e, 0, sd))
      }
    }
    return h
  }
  /** A lake's water altitude: as given, or the ground at its centre before it was dug. */
  function levelOf(f: TerrainFeature, fi: number) {
    if (f.level != null) return f.level
    let v = lakeLevel.get(f)
    if (v == null) { v = hb(f.at![0], f.at![1], fi) - 3; lakeLevel.set(f, v) }
    return v
  }
  /** A river's water surface along its path: the ground before it, never rising downstream, so it falls over cliffs. */
  function riverAt(f: TerrainFeature, fi: number): River {
    let rv = riverOf.get(f)
    if (rv) return rv
    const path = f.path!, total = polyLen(path), step = 10, prof: number[] = []
    let low = Infinity
    for (let sv = 0; sv <= total + step; sv += step) {
      let run = 0, p: XY = path[path.length - 1]
      for (let i = 0; i < path.length - 1; i++) { const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]); if (run + l >= sv) { const t = (sv - run) / (l || 1); p = [lerp(path[i][0], path[i + 1][0], t), lerp(path[i][1], path[i + 1][1], t)]; break } run += l }
      low = Math.min(low, hb(p[0], p[1], fi) - 1.2)
      prof.push(low)
    }
    rv = { id: f.id, path, width: f.width ?? 24, prof, step }
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
  const h = (x: number, y: number) => {
    let v = hb(x, y)
    for (const f of flats) {
      const d = Math.hypot(x - f.at[0], y - f.at[1]), e = 30 + f.r * 0.4
      if (d < f.r + e) v = lerp(v, f.level, sstep(f.r + e, f.r, d))
    }
    return v
  }
  const water = (x: number, y: number) => {
    for (const l of lakes) if (Math.hypot(x - l.at[0], y - l.at[1]) < l.r && h(x, y) < l.level) return l.level
    for (const r of rivers) { const n = pathNear(r.path, x, y); if (n.d < r.width * 0.6) return profAt(r, n.s) }
    return null
  }
  return { h, base: hb, water, lakes, flats, rivers }
}
/** Compass facing (degrees, 0 = north, 90 = east) as a recipe-space unit vector. */
export const facingVec = (deg = 180): XY => [Math.sin(deg * DEG), Math.cos(deg * DEG)]
/** Recipe (x, y) to world (x, z), and the builder yaw that turns a kit's front (local +z) to face `deg`. */
const W = (p: XY): [number, number] => [p[0], -p[1]]
const yawOf = (deg = 180) => Math.PI - deg * DEG

// ---------- buildings ----------
const PAL = {
  slumWall: ['#6b5b4a', '#7a6a58', '#5e5650', '#8a7a62', '#6a6058', '#7d705e', '#857462'], slumRoof: ['#4a3a30', '#5a4a3a', '#3e3a36', '#56483c', '#6a5848'],
  midWall: ['#d8c8a8', '#c9b48a', '#e0d0b0', '#b8a888', '#d4bc94', '#cbb89a', '#d9b99a', '#c8c0aa'], midRoof: ['#8a4a30', '#9a5a3a', '#7a4630', '#6e5040', '#a0603e'],
  richWall: ['#ece6da', '#e8e0cc', '#f2eee6', '#d9d2c2', '#e6dccb', '#efe4d0'], richRoof: ['#4a5560', '#5a6a72', '#4f7a6e', '#3d4650', '#55606a'],
}
interface Placed { buildings: number[]; chimneys: number[] }
/** Is this spot under a lake or in a river? Uses the ground height already known, not the terrain function. */
const wetter = (T: TerrainFn) => (x: number, y: number, h: number) => T.lakes.some((l) => h < l.level + 0.5 && Math.hypot(x - l.at[0], y - l.at[1]) < l.r) || T.rivers.some((r) => pathDist(r.path, x, y) < r.width * 0.8)
function placeBuildings(doc: LocationDoc, T: TerrainFn, H: (x: number, y: number) => number, seed: number, wl: number, wh: number, roadIdx: RoadIndex): Placed {
  const wet = wetter(T)
  const out: number[] = [], chim: number[] = [], R = rng(seed ^ 0xb11d), cell = 34, grid = new Map<number, number[]>()
  const key = (x: number, y: number) => Math.floor(x / cell) * 73856093 ^ Math.floor(y / cell) * 19349663
  const blocked = T.flats.map((f) => ({ at: f.at, r: f.r + 12 }))
  const corridors = doc.structures.filter((s) => s.kind === 'bridge' || s.kind === 'aqueduct' || s.kind === 'wall').map((s) => ({ path: s.kind === 'bridge' ? [s.at!, s.to!] : s.path!, w: (s.width ?? (s.kind === 'bridge' ? 14 : 5)) / 2 + 8 })).filter((c) => c.path?.every(Boolean))
  const n = simplex(seed ^ 0x77)
  const emit = (x: number, y: number, yaw: number, fw: number, fd: number, floors: number, w: number, roof: number, wall: Col, rc: Col) => {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    let lo = Infinity, hi = -Infinity
    for (const [u, v] of [[-fw / 2, -fd / 2], [fw / 2, -fd / 2], [-fw / 2, fd / 2], [fw / 2, fd / 2], [0, fd / 2]]) { const hh = H(x + u * c + v * s, y - (-u * s + v * c)); lo = Math.min(lo, hh); hi = Math.max(hi, hh) }
    const fh = lerp(3, 4.3, w), base = lo - 1.5, body = hi - base + floors * fh
    const roofH = roof === ROOF.spire ? fw * (fw < 10 && floors > 6 ? 2.4 : 1.4) : roof === ROOF.dome ? Math.min(fw, fd) * 0.55 : roof === ROOF.flat ? 0 : Math.min(fw, fd) * lerp(0.42, 0.3, w)
    const [wx, wz] = W([x, y])
    out.push(wx, base, wz, yaw, fw, fd, body, hi, roof, roofH, fh, w, ...wall, ...rc)
    if ((roof === ROOF.gable || roof === ROOF.hip) && w < 0.85) for (let k = 0, nC = R() < 0.4 ? 2 : 1; k < nC; k++) { // chimneys poke through the roof
      const u = (k ? -1 : 1) * fw * (0.18 + R() * 0.15), v = (R() - 0.5) * fd * 0.4
      chim.push(wx + u * c + v * s, base + body, wz - u * s + v * c, roofH * 0.75 + 1.2 + R() * 0.8)
    }
  }
  for (const d of doc.districts) {
    if (!d.area && !d.at) continue
    const [x0, y0, x1, y1] = bboxOf(d)
    const dens = clamp(d.density ?? 0.8, 0.05, 1), step = 5, nx = Math.ceil((x1 - x0) / step), ny = Math.ceil((y1 - y0) / step), order = new Int32Array(nx * ny)
    for (let k = 0; k < order.length; k++) order[k] = k
    for (let k = order.length - 1; k > 0; k--) { const r = Math.floor(R() * (k + 1)), t = order[k]; order[k] = order[r]; order[r] = t } // random order
    for (const o of order) {
      const x = x0 + (o % nx) * step + (R() - 0.5) * step, y = y0 + Math.floor(o / nx) * step + (R() - 0.5) * step
      const ad = areaDist(d, x, y)
      if (ad > 0 || R() > sstep(0, 90, -ad)) continue // thin out toward the edge
      if (R() > dens * 1.15) continue
      const h = H(x, y), w = d.wealth ?? clamp((h - wl) / (wh - wl || 1))
      const tall = w > 0.6 && R() < 0.025
      let fw = tall ? 6 + R() * 4 : lerp(6, 22, w ** 1.3) * (0.75 + R() * 0.5)
      let fd = tall ? fw : fw * (0.8 + R() * 0.6)
      if (w < 0.3 && R() < 0.3) { fw *= 0.7; fd *= 0.8 }
      const wing = !tall && w > 0.25 && R() < 0.35, ww = fw * (0.45 + R() * 0.25), wd = fd * (0.55 + R() * 0.3)
      const gap = lerp(1, 7, w) * (1.7 - dens), rho = 0.42 * Math.hypot(fw + (wing ? ww : 0), fd) + gap / 2
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell)
      let hit = false
      for (let j = -1; j <= 1 && !hit; j++) for (let i = -1; i <= 1 && !hit; i++) {
        const l = grid.get(((cx + i) * 73856093) ^ ((cy + j) * 19349663))
        if (l) for (let k = 0; k < l.length; k += 3) if (Math.hypot(l[k] - x, l[k + 1] - y) < l[k + 2] + rho) { hit = true; break }
      }
      if (hit) continue
      if (blocked.some((b) => Math.hypot(x - b.at[0], y - b.at[1]) < b.r)) continue
      if (corridors.some((c) => pathDist(c.path, x, y) < c.w)) continue
      if (wet(x, y, h)) continue
      const gx = (H(x + 5, y) - H(x - 5, y)) / 10, gy = (H(x, y + 5) - H(x, y - 5)) / 10, sl = Math.hypot(gx, gy)
      if (sl > 1.25 - 0.65 * w + (d.steep ? 0.9 : 0)) continue
      const [wx, wz] = W([x, y]), road = roadIdx.near(wx, wz)
      if (road.d < rho * 0.8 + 0.5) continue // keep off the street
      const g = grid.get(key(x, y)) ?? []; g.push(x, y, rho); grid.set(key(x, y), g)
      // face the nearest street; else downhill; else a slowly turning grid
      let yaw = road.d < 28 ? Math.atan2(road.px - wx, road.pz - wz) : sl > 0.06 ? Math.atan2(-gx, gy) : Math.round(fbm(n, x / 900, 0, y / 900, 2) * 8) * (Math.PI / 4)
      if (road.d < 28) { const along = Math.atan2(road.dx, road.dz) + Math.PI / 2; yaw = Math.abs(Math.sin(yaw - along)) < 0.7 ? along + (Math.cos(yaw - along) < 0 ? Math.PI : 0) : yaw }
      yaw += (R() - 0.5) * 0.35 * (1 - w)
      const floors = tall ? 7 + Math.floor(R() * 8) : w < 0.3 ? 2 + Math.floor(R() * 3) : w < 0.65 ? 3 + Math.floor(R() * 4) : 3 + Math.floor(R() * 3)
      const rr = R(), roof = tall ? ROOF.spire : w > 0.65 ? (rr < 0.55 ? ROOF.hip : rr < 0.82 ? ROOF.gable : rr < 0.89 ? ROOF.dome : rr < 0.96 ? ROOF.flat : ROOF.spire) : w > 0.3 ? (rr < 0.6 ? ROOF.gable : rr < 0.95 ? ROOF.hip : ROOF.spire) : rr < 0.7 ? ROOF.gable : rr < 0.9 ? ROOF.flat : ROOF.hip
      const tier = w < 0.3 ? 0 : w < 0.65 ? 1 : 2, pick = (a: string[]) => lin(a[Math.floor(R() * a.length)])
      const walls = [PAL.slumWall, PAL.midWall, PAL.richWall], roofs = [PAL.slumRoof, PAL.midRoof, PAL.richRoof]
      const wall = mix(pick(walls[tier]), pick(walls[Math.min(2, tier + 1)]), clamp((w - [0, 0.3, 0.65][tier]) / 0.35) * 0.4)
      const rc = pick(roofs[tier])
      emit(x, y, yaw, fw, fd, floors, w, roof, wall, rc)
      if (wing) { // an attached lower wing makes an L or a T
        const side = R() < 0.5 ? -1 : 1, off = fw / 2 + ww / 2 - 0.3, back = (wd - fd) / 2 - (R() * (fd - wd)) / 2
        const c = Math.cos(yaw), s = Math.sin(yaw), u = side * off, v = back
        emit(x + u * c + v * s, y - (-u * s + v * c), yaw, ww, wd, Math.max(2, floors - 1 - Math.floor(R() * 2)), w, roof === ROOF.dome || roof === ROOF.spire ? ROOF.hip : roof, mix(wall, [0, 0, 0], 0.04), rc)
      }
      if (out.length / BSTRIDE > 320000) return { buildings: out, chimneys: chim }
    }
  }
  return { buildings: out, chimneys: chim }
}

// ---------- build ----------
export interface CityBuilt {
  size: number; N: number; heights: Float32Array; colors: Uint8Array; minH: number; maxH: number
  outer: { size: number; n: number; heights: Float32Array; colors: Uint8Array }
  buildings: Float32Array; chimneys: Float32Array; trees: Float32Array; rocks: Float32Array; lamps: Float32Array
  geo: Record<Mat, { pos: Float32Array; nor: Float32Array; col: Float32Array }>
  water: Float32Array; rivers: { pos: Float32Array; uv: Float32Array }; falls: Float32Array
  counts: { buildings: number; structures: number; roads: number; trees: number }; ms: number; stages: Record<string, number>
}
export const gridN = (size: number) => (size / 12 > 1500 ? 2048 : size / 12 > 700 ? 1024 : 512)

export function buildCity(doc: LocationDoc): CityBuilt {
  const t0 = Date.now(), seed = hash(doc.seed), T = terrainOf(doc), size = doc.size, N = gridN(size), cellM = size / N
  const heights = new Float32Array((N + 1) * (N + 1))
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) heights[j * (N + 1) + i] = T.h(-size / 2 + i * cellM, size / 2 - j * cellM) // row 0 = north edge
  const stages: Record<string, number> = {}, lap = (k: string) => { stages[k] = Date.now() - t0 - Object.values(stages).reduce((a, c) => a + c, 0) }
  lap('ground')
  const grid = { N, size, heights }, Hw = sampler(grid)
  /** Ground height from the grid in recipe coordinates (bilinear), far cheaper than the terrain function. */
  const H = (x: number, y: number) => Hw(x, -y)
  // wealth follows altitude between the lowest and highest district ground unless the recipe says otherwise
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
  const wealthAt = (h: number) => clamp((h - wl) / (wh - wl || 1))

  // roads: hubs at plazas, fronts of great buildings, bridge ends, harbours, gates and across districts
  let roads: Road[] = []
  const struct = (s: Structure) => s.at && footprint(s)
  if (doc.roads !== false) {
    const hubs: { x: number; z: number }[] = [], hubAt = (p: XY) => { const [x, z] = W(p); const h = { x, z }; hubs.push(h); return h }
    for (const s of doc.structures) {
      const fp = struct(s)
      if (s.kind === 'plaza' || s.kind === 'colonnade') hubAt(s.at!)
      else if (fp && s.kind !== 'statue' && s.kind !== 'tower') { const [fx, fy] = facingVec(s.facing); hubAt([s.at![0] + fx * (fp.r + 12), s.at![1] + fy * (fp.r + 12)]) }
      if (s.kind === 'harbour' && s.at) { const [fx, fy] = facingVec(s.facing); hubAt([s.at[0] - fx * 30, s.at[1] - fy * 30]) }
    }
    const links: [{ x: number; z: number }, { x: number; z: number }][] = [], force: typeof links = []
    for (const s of doc.structures) {
      if (s.kind === 'bridge' && s.at && s.to) { const [fx, fy] = [s.to[0] - s.at[0], s.to[1] - s.at[1]], l = Math.hypot(fx, fy) || 1; links.push([hubAt([s.at[0] - (fx / l) * 30, s.at[1] - (fy / l) * 30]), hubAt([s.to[0] + (fx / l) * 30, s.to[1] + (fy / l) * 30])]) }
      if (s.kind === 'road' && s.path) for (let i = 0; i < s.path.length - 1; i++) force.push([hubAt(s.path[i]), hubAt(s.path[i + 1])])
    }
    for (const d of doc.districts) { // a hub every ~650 m across each district
      const [x0, y0, x1, y1] = bboxOf(d), R2 = rng(hash(d.id) ^ 0x51)
      for (let y = y0 + 325; y < y1; y += 650) for (let x = x0 + 325; x < x1; x += 650) { const p: XY = [x + (R2() - 0.5) * 300, y + (R2() - 0.5) * 300]; if (areaDist(d, ...p) < -40 && T.water(...p) == null) hubAt(p) }
      if (d.at && areaDist(d, ...d.at) < 0) hubAt(d.at)
    }
    const cores = doc.structures.flatMap((s) => { const fp = struct(s); return fp && s.kind !== 'plaza' && s.kind !== 'colonnade' ? [{ at: W(s.at!), r: fp.r * 0.75 }] : [] })
    const blocked = (x: number, z: number) => Math.abs(x) > size / 2 - 20 || Math.abs(z) > size / 2 - 20 || T.water(x, -z) != null || cores.some((c) => Math.hypot(x - c.at[0], z - c.at[1]) < c.r)
    roads = planRoads({
      grid, seed, hubs, links, force, blocked,
      districts: doc.districts.filter((d) => d.area || d.at).map((d) => { const [x0, y0, x1, y1] = bboxOf(d); return { inside: (x: number, z: number) => areaDist(d, x, -z) < -6, bbox: [x0, -y1, x1, -y0] as [number, number, number, number], wealth: (h: number) => d.wealth ?? wealthAt(h), density: d.density ?? 0.8 } }),
    })
    carve(grid, roads)
  }
  lap('roads')
  const roadIdx = new RoadIndex(15, 30)
  roads.forEach((r, i) => roadIdx.add(r, i))
  let minH = Infinity, maxH = -Infinity
  for (const v of heights) { if (v < minH) minH = v; if (v > maxH) maxH = v }

  const placed = placeBuildings(doc, T, H, seed, wl, wh, roadIdx), buildings = new Float32Array(placed.buildings)
  lap('buildings')
  // ground colour: rock on steep ground, meadow, forest below the tree line, snow above the snow line, paving in town
  const urban = new Float32Array((N + 1) * (N + 1))
  for (let k = 0; k < buildings.length; k += BSTRIDE) {
    const i = Math.round((buildings[k] + size / 2) / cellM), j = Math.round((buildings[k + 2] + size / 2) / cellM), r = Math.ceil((buildings[k + 4] * 0.9) / cellM)
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = (j + dj) * (N + 1) + i + di; if (i + di >= 0 && i + di <= N && j + dj >= 0 && j + dj <= N) urban[a] = Math.min(1, urban[a] + 0.5) }
  }
  for (const f of T.flats) { const i0 = Math.round((f.at[0] + size / 2) / cellM), j0 = Math.round((size / 2 - f.at[1]) / cellM), r = Math.ceil(f.r / cellM); for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r && i0 + di >= 0 && i0 + di <= N && j0 + dj >= 0 && j0 + dj <= N) urban[(j0 + dj) * (N + 1) + i0 + di] = 1 }
  const snow = doc.snowline ?? maxH - (maxH - minH) * 0.18, treeLine = snow - 900, nC = simplex(seed ^ 0xc010)
  // the colour noise is low-frequency: sample it every 40 m and interpolate
  const NS = 40, nsN = Math.ceil(Math.max(size, 60000) / NS) + 2, nsCache = new Map<number, [number, number]>()
  const noiseAt = (x: number, y: number): [number, number] => {
    const fx = x / NS, fy = y / NS, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j
    const at = (a: number, c: number) => { const k = a * nsN + c; let v = nsCache.get(k); if (!v) { const vv = fbm(nC, (a * NS) / 400, 0, (c * NS) / 400, 3); v = [vv, vv + fbm(nC, (a * NS) / 1500, 3, (c * NS) / 1500, 2)]; nsCache.set(k, v) } return v }
    const a = at(i, j), b2 = at(i + 1, j), c2 = at(i, j + 1), d2 = at(i + 1, j + 1)
    return [0, 1].map((q) => (a[q] * (1 - tx) + b2[q] * tx) * (1 - ty) + (c2[q] * (1 - tx) + d2[q] * tx) * ty) as [number, number]
  }
  const forestAt = (x: number, y: number) => noiseAt(x, y)[1]
  const paint = (x: number, y: number, h: number, sl: number, u: number): Col => {
    const [v, fo] = noiseAt(x, y)
    let c = mix(lin('#6f7f4a'), lin('#8a9356'), clamp(v + 0.5))
    if (h < treeLine && sl < 0.8 && fo > -0.05) c = mix(c, lin('#3b4f30'), sstep(treeLine, treeLine - 200, h) * 0.7)
    c = mix(c, lin('#7d786e'), sstep(0.55, 0.9, sl) * 0.9)
    c = mix(c, lin('#8a8478'), sstep(snow - 500, snow - 100, h) * sstep(0.35, 0.7, sl) * 0.6)
    const sn = sstep(snow - 60, snow + 120, h + v * 120) * (1 - sstep(0.9, 1.3, sl))
    c = mix(c, lin('#eef2f6'), sn)
    for (const l of T.lakes) if (Math.abs(h - l.level) < 4 && Math.hypot(x - l.at[0], y - l.at[1]) < l.r) c = mix(c, lin('#a49c8c'), 0.6)
    return mix(c, mix(lin('#8a8070'), lin('#a09684'), clamp(v + 0.5)), u * 0.85)
  }
  const to8 = (c: Col, o: Uint8Array, k: number) => { for (let q = 0; q < 3; q++) o[k + q] = Math.round(255 * clamp(c[q]) ** (1 / 2.2)) }
  const colors = new Uint8Array((N + 1) * (N + 1) * 3)
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const a = j * (N + 1) + i, hx = (heights[j * (N + 1) + Math.min(N, i + 1)] - heights[j * (N + 1) + Math.max(0, i - 1)]) / (2 * cellM), hy = (heights[Math.min(N, j + 1) * (N + 1) + i] - heights[Math.max(0, j - 1) * (N + 1) + i]) / (2 * cellM)
    to8(paint(-size / 2 + i * cellM, size / 2 - j * cellM, heights[a], Math.hypot(hx, hy), urban[a]), colors, a * 3)
  }
  lap('colours')
  // forests and rocks
  const trees: number[] = [], rocks: number[] = [], RT = rng(seed ^ 0x7ee5), dens = doc.forest ?? 1, wet = wetter(T), onRoad = roadMask(grid, roads)
  for (let y = -size / 2 + 6; y < size / 2 && trees.length / TSTRIDE < 200000; y += 10) for (let x = -size / 2 + 6; x < size / 2; x += 10) {
    const px = x + (RT() - 0.5) * 8, py = y + (RT() - 0.5) * 8, i = Math.round((px + size / 2) / cellM), j = Math.round((size / 2 - py) / cellM)
    if (urban[j * (N + 1) + i] > 0.2 || onRoad[j * (N + 1) + i]) continue
    const h = H(px, py), sl = Math.hypot(H(px + 4, py) - H(px - 4, py), H(px, py + 4) - H(px, py - 4)) / 8
    if (sl > 0.75 || h > snow - 120) { if (RT() < (sl > 0.75 ? 0.05 : 0.025)) rocks.push(px, h - 0.5, -py, 0.8 + RT() * RT() * 6, RT() * 6.28); continue }
    const f = forestAt(px, py)
    if (h > treeLine + 150 || RT() > dens * sstep(-0.15, 0.25, f) * (1 - sstep(treeLine - 100, treeLine + 150, h)) * 0.9) { if (RT() < 0.004 * dens && h < treeLine) trees.push(px, h - 0.3, -py, 0.7 + RT() * 0.6, 0, 0.8 + RT() * 0.4); continue }
    if (wet(px, py, h)) continue
    const conifer = h > treeLine - 650 || RT() < 0.25
    trees.push(px, h - 0.3, -py, 0.75 + RT() * 0.6, conifer ? 1 : 0, 0.75 + RT() * 0.5)
  }
  lap('trees')
  // the range beyond, coarser and tucked under the detailed ground
  const os = Math.max(60000, size * 5), on = 256, oc = os / on, oh = new Float32Array((on + 1) * (on + 1)), ocol = new Uint8Array((on + 1) * (on + 1) * 3)
  for (let j = 0; j <= on; j++) for (let i = 0; i <= on; i++) {
    const x = -os / 2 + i * oc, y = os / 2 - j * oc, inside = Math.abs(x) < size / 2 - oc && Math.abs(y) < size / 2 - oc
    oh[j * (on + 1) + i] = T.h(x, y) - (inside ? 40 : 0)
  }
  for (let j = 0; j <= on; j++) for (let i = 0; i <= on; i++) {
    const a = j * (on + 1) + i, hx = (oh[j * (on + 1) + Math.min(on, i + 1)] - oh[j * (on + 1) + Math.max(0, i - 1)]) / (2 * oc), hy = (oh[Math.min(on, j + 1) * (on + 1) + i] - oh[Math.max(0, j - 1) * (on + 1) + i]) / (2 * oc)
    to8(paint(-os / 2 + i * oc, os / 2 - j * oc, oh[a], Math.hypot(hx, hy), 0), ocol, a * 3)
  }
  lap('outer')
  // structures, then the roads drawn on the ground
  const b = new Builder(), gW = (x: number, z: number) => Hw(x, z)
  for (const st of doc.structures) structure(b, st, T, gW, seed, roads)
  const lamps: number[] = [...b.lamps]
  drawRoads(b, roads, lamps)
  lap('structures')
  const geo = {} as CityBuilt['geo']
  for (const m of MATS) { const g = b.geo[m]; geo[m] = { pos: new Float32Array(g.pos), nor: new Float32Array(g.nor), col: new Float32Array(g.col) } }
  // lake surfaces: grid cells near each lake where the ground dips below the water
  const wp: number[] = []
  for (const l of T.lakes) {
    const i0 = Math.max(0, Math.floor((l.at[0] - l.r + size / 2) / cellM)), i1 = Math.min(N - 1, Math.ceil((l.at[0] + l.r + size / 2) / cellM))
    const j0 = Math.max(0, Math.floor((size / 2 - l.at[1] - l.r) / cellM)), j1 = Math.min(N - 1, Math.ceil((size / 2 - l.at[1] + l.r) / cellM))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -size / 2 + i * cellM, z = -size / 2 + j * cellM
      if (Math.hypot(x + cellM / 2 - l.at[0], -(z + cellM / 2) - l.at[1]) > l.r) continue
      const w = N + 1, lo = Math.min(heights[j * w + i], heights[j * w + i + 1], heights[(j + 1) * w + i], heights[(j + 1) * w + i + 1])
      if (lo >= l.level) continue
      const L = l.level, X = x + cellM, Z = z + cellM
      wp.push(x, L, z, x, L, Z, X, L, z, X, L, z, x, L, Z, X, L, Z)
    }
  }
  // rivers: a ribbon on the water surface (v runs downstream for the flow), falls where it drops steeply
  const rp: number[] = [], ruv: number[] = [], falls: number[] = []
  for (const rv of T.rivers) {
    const total = polyLen(rv.path), pts: [number, number, number][] = []
    for (let sv = 0; sv <= total; sv += 5) {
      let run = 0, p: XY = rv.path[rv.path.length - 1]
      for (let i = 0; i < rv.path.length - 1; i++) { const l = Math.hypot(rv.path[i + 1][0] - rv.path[i][0], rv.path[i + 1][1] - rv.path[i][1]); if (run + l >= sv) { const t = (sv - run) / (l || 1); p = [lerp(rv.path[i][0], rv.path[i + 1][0], t), lerp(rv.path[i][1], rv.path[i + 1][1], t)]; break } run += l }
      const k = clamp(sv / rv.step, 0, rv.prof.length - 1.001), i = Math.floor(k)
      pts.push([p[0], lerp(rv.prof[i], rv.prof[i + 1], k - i) + 0.3, -p[1]])
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * rv.width * 0.55, nz = (dx / l) * rv.width * 0.55
      rp.push(ax - nx, ay, az - nz, ax + nx, ay, az + nz, bx - nx, by, bz - nz, bx - nx, by, bz - nz, ax + nx, ay, az + nz, bx + nx, by, bz + nz)
      const va = i * 5, vb = va + 5
      ruv.push(0, va, 1, va, 0, vb, 0, vb, 1, va, 1, vb)
      if ((ay - by) / l > 0.8 && (i === pts.length - 2 || (pts[i + 1][1] - pts[i + 2][1]) / 5 < 0.8)) falls.push(bx, by, bz, rv.width)
    }
  }
  const nb = buildings.length / BSTRIDE
  return {
    size, N, heights, colors, minH, maxH, outer: { size: os, n: on, heights: oh, colors: ocol },
    buildings, chimneys: new Float32Array(placed.chimneys), trees: new Float32Array(trees), rocks: new Float32Array(rocks), lamps: new Float32Array(lamps),
    geo, water: new Float32Array(wp), rivers: { pos: new Float32Array(rp), uv: new Float32Array(ruv) }, falls: new Float32Array(falls),
    counts: { buildings: nb, structures: doc.structures.length, roads: roads.length, trees: trees.length / TSTRIDE }, ms: Date.now() - t0, stages,
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

function structure(b: Builder, st: Structure, T: TerrainFn, gW: (x: number, z: number) => number, seed: number, roads: Road[]) {
  const C = st.color ? lin(st.color) : lin('#d8d0bc'), sd = seed + hash(st.id), k = st.scale ?? SCALE[st.kind] ?? 1
  const flat = T.flats.find((f) => f.id === st.id), fp = footprint(st), roof = st.roof ? lin(st.roof) : lin('#56606a')
  if (st.kind === 'road') return
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
    const pts: V[] = [], total = polyLen(st.path)
    for (let sv = 0; sv <= total; sv += 6) {
      let run = 0, p: XY = st.path[st.path.length - 1]
      for (let i = 0; i < st.path.length - 1; i++) { const l = Math.hypot(st.path[i + 1][0] - st.path[i][0], st.path[i + 1][1] - st.path[i][1]); if (run + l >= sv) { const t = (sv - run) / (l || 1); p = [lerp(st.path[i][0], st.path[i + 1][0], t), lerp(st.path[i][1], st.path[i + 1][1], t)]; break } run += l }
      const [x, z] = W(p); pts.push([x, gW(x, z), z])
    }
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
    harbour(b, cx, st.level ?? lake?.level ?? T.h(...st.at), cz, yawOf(st.facing), st.width ?? 160, sd, C)
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
  if (errors.length) return { errors, warnings }
  const ids = new Set<string>(), half = doc.size / 2
  const pt = (p: unknown, what: string) => { if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) { errors.push(`${what}: needs [x, y]`); return false } if (Math.abs(p[0]) > half || Math.abs(p[1]) > half) warnings.push(`${what} is outside the map`); return true }
  const pts = (p: unknown, n: number, what: string) => { if (!Array.isArray(p) || p.length < n) { errors.push(`${what}: needs at least ${n} points`); return false } return p.every((q, i) => pt(q, `${what} point ${i + 1}`)) }
  const named = (o: { id: string; name?: string }, what: string) => { if (!o.id) errors.push(`${what} without an id`); else if (ids.has(o.id)) errors.push(`duplicate id ${o.id}`); ids.add(o.id); if (!o.name) warnings.push(`${o.id}: give it a name`) }
  for (const f of doc.terrain) {
    named(f, 'terrain feature')
    const w = `${f.id} (${f.kind})`
    if (!TERRAIN_KINDS.includes(f.kind)) { errors.push(`${w}: unknown kind; use ${TERRAIN_KINDS.join(', ')}`); continue }
    if (f.kind === 'peak' && (pt(f.at, w), f.height == null)) errors.push(`${w}: needs height (summit altitude)`)
    if ((f.kind === 'ridge' || f.kind === 'valley') && (pts(f.path, 2, w), f.height == null)) errors.push(`${w}: needs height (${f.kind === 'ridge' ? 'crest' : 'floor'} altitude)`)
    if (f.kind === 'river') pts(f.path, 2, w)
    if (f.kind === 'lake') pt(f.at, w)
    if (f.kind === 'plateau') { if (f.area) pts(f.area, 3, w); else if (!f.at) errors.push(`${w}: needs area or at + radius`); else pt(f.at, w); if (f.height == null) errors.push(`${w}: needs height`) }
  }
  for (const d of doc.districts) { named(d, 'district'); if (d.area) pts(d.area, 3, d.id); else if (d.at) pt(d.at, d.id); else errors.push(`${d.id}: needs area or at + radius`) }
  for (const s of doc.structures) {
    named(s, 'structure')
    const w = `${s.id} (${s.kind})`
    if (!STRUCTURE_KINDS.includes(s.kind)) { errors.push(`${w}: unknown kind; use ${STRUCTURE_KINDS.join(', ')}`); continue }
    if (s.kind === 'bridge') { pt(s.at, `${w} at`); pt(s.to, `${w} to`) } else if (s.kind === 'aqueduct' || s.kind === 'wall' || s.kind === 'road') pts(s.path, 2, w); else pt(s.at, w)
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
    if (s.kind === 'harbour' && s.at && !T.lakes.some((l) => Math.hypot(s.at![0] - l.at[0], s.at![1] - l.at[1]) < l.r + 200)) warnings.push(`${s.id}: a harbour needs a lake within 200 m of its shore`)
    if (s.kind === 'bridge' && s.at && s.to) {
      const h0 = s.deck?.[0] ?? T.h(...s.at) + 1, h1 = s.deck?.[1] ?? T.h(...s.to) + 1
      for (let t = 0.1; t < 0.95; t += 0.05) { const g = T.h(lerp(s.at[0], s.to[0], t), lerp(s.at[1], s.to[1], t)); if (g > lerp(h0, h1, t) + 6) { warnings.push(`${s.id}: the deck runs into the ground ${Math.round(t * 100)}% of the way across; raise deck or move an end`); break } }
    }
  }
  return { errors, warnings }
}

export function describe(doc: LocationDoc, built?: CityBuilt) {
  const T = terrainOf(doc), r = (n: number) => Math.round(n).toLocaleString('en'), xy = (p: XY) => `[${r(p[0])}, ${r(p[1])}]`
  const lines = [`${doc.name} (${doc.id}): ${r(doc.size)} m square, seed "${doc.seed}", mood ${doc.mood ?? 'morning'}`]
  if (built) lines.push(`ground ${r(built.minH)}..${r(built.maxH)} m, ${r(built.counts.buildings)} buildings, ${built.counts.roads} roads/lanes/stairs, ${r(built.counts.trees)} trees, ${built.counts.structures} structures`)
  lines.push('', 'Terrain:')
  for (const f of doc.terrain) lines.push(`  ${f.id} ${f.kind} "${f.name ?? ''}" ${f.at ? 'at ' + xy(f.at) : f.path ? `${f.path.length}-point path` : f.area ? `${f.area.length}-point area` : ''} ${f.height != null ? 'height ' + r(f.height) : ''}${f.level != null ? 'level ' + r(f.level) : ''}`)
  lines.push('', 'Districts:')
  for (const d of doc.districts) {
    const n = built ? Array.from({ length: built.buildings.length / BSTRIDE }, (_, i) => i).filter((i) => areaDist(d, built.buildings[i * BSTRIDE], -built.buildings[i * BSTRIDE + 2]) <= 0).length : undefined
    lines.push(`  ${d.id} "${d.name ?? ''}" ${d.area ? `${d.area.length}-point area` : `at ${xy(d.at!)} r ${r(d.radius ?? 300)}`}${n != null ? `, ${r(n)} buildings` : ''}`)
  }
  lines.push('', 'Structures:')
  for (const s of doc.structures) lines.push(`  ${s.id} ${s.kind} "${s.name ?? ''}" ${s.at ? `at ${xy(s.at)} ground ${r(T.h(...s.at))}` : ''}${s.to ? ` to ${xy(s.to)} ground ${r(T.h(...s.to))}` : ''}${s.path ? ` ${s.path.length}-point path, ${r(polyLen(s.path))} m` : ''}`)
  if (doc.views?.length) lines.push('', 'Views:', ...doc.views.map((v) => `  "${v.name}" at ${xy([v.at[0], v.at[1]])} alt ${r(v.at[2])} heading ${r(v.heading)} pitch ${r(v.pitch)}`))
  return lines.join('\n')
}

export function brief() {
  return `# Locations: recipe format
A location is JSON: { id, name, seed, size (metres, square), base?, relief?, snowline?, wealth?: [lowAlt, highAlt], roads? (default true), forest? (0..2, default 1),
mood?, hour? (0-24), weather?, season?, terrain: [], districts: [], structures: [], views?: [] }.
Coordinates are metres from the centre: x east, y north. Heights are altitudes in metres. Later terrain features win over earlier ones.
The background is a procedural mountain range (base altitude, relief = amplitude). Give everything an id; the user names things.

Terrain (kind: fields):
- peak: at, height (summit), radius (default 1500), sharp (default 1.4; higher = needle, below 1 = rounded summit)
- ridge: path, height (crest), width (half-width at the foot, default 900)
- valley: path, height (floor altitude), width (default 500)
- river: path from source to mouth, width (24), depth (4); it never flows uphill, so it falls over cliffs as waterfalls
- lake: at, radius, level (water altitude; default: the ground there), depth; the shore is irregular, and a lip forms only where the ground would spill
- plateau: area (polygon) or at + radius, height, edge (blend width, default 150); use a wide edge for a natural shoulder

Districts: area (polygon) or at + radius; density 0..1 (default 0.8); wealth 0..1 to override; steep: true for houses clinging to cliffs.
Buildings fill districts and line the streets. Wealth follows altitude between wealth[0] and wealth[1] (default: from the districts' ground):
low = cramped dark slums on steep ground, middle = plaster and red tile, high = white stone palaces, domes and slate or copper roofs, towers.
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
- harbour: at (on a lake shore), facing (towards the water), width (quay length, 160); piers, boats, a lighthouse
- road: path of waypoints; a main road is routed through them in order
Structures with an at (except harbours) flatten the ground around them at their level (default: the ground there); set level to choose.
Colours are hex ("#d8d0bc"). Moods: ${MOOD_NAMES.join(', ')}. Weather: ${WEATHERS.join(', ')}. Seasons: ${SEASONS.join(', ')}.
Views: { name, at: [x, y, altitude], heading, pitch (degrees, negative = down) }.

Workflow: node scripts/loc.ts validate <file>, describe <file>, preview <file> out.png; fix warnings (steep sites, decks in the ground).`
}
