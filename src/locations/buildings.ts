// Buildings for a location: four building traditions, each house designed from its culture and wealth and assembled
// from real-sized parts (walls, roofs of many shapes, eaves, chimneys, dormers, balconies, awnings, towers, minarets,
// cupolas, courtyards). Streets are lined first, house beside house, facing the street; what space is left is filled
// with back houses and courtyards. Pure (world x, z; heights in metres).
import { fbm, rng, simplex } from '../world/noise.ts'
import { lin, mix, type Col } from './kit.ts'
import type { Road } from './roads.ts'

export const CULTURES = ['central', 'mediterranean', 'mountain', 'eastern'] as const
export type Culture = typeof CULTURES[number]
/** Part shapes; the renderer has one geometry per shape. */
export const PART = { wall: 0, gable: 1, hip: 2, flat: 3, dome: 4, onion: 5, spire: 6, mansard: 7, pyramid: 8, stepgable: 9, shed: 10, chimney: 11, balcony: 12, dormer: 13, awning: 14, minaret: 15, cornice: 16, parapet: 17, vine: 18, drywall: 19 } as const
export const PART_COUNT = 20
/** Parts drawn with roof tiles; the rest (step gables, dormers, balconies, chimneys, ...) take their colour as is. */
export const ROOF_PARTS = new Set<number>([PART.gable, PART.hip, PART.flat, PART.dome, PART.onion, PART.spire, PART.mansard, PART.pyramid, PART.shed])
/** Per part: type, x, y, z, yaw, sx, sy, sz, r, g, b, then six numbers whose meaning depends on the type.
 * Walls: ground height, floor height, wealth, seed, material, window style. Roofs: tile style, seed. */
export const PSTRIDE = 17
export const MATERIAL = { plaster: 0, stone: 1, brick: 2, timber: 3, whitewash: 4, rubble: 5, ablaq: 6, wood: 7 } as const
export const WINDOW = { shutter: 0, arched: 1, small: 2, mullion: 3, pointed: 4, arcade: 5 } as const
export const TILE = { clay: 0, barrel: 1, slate: 2, shingle: 3, slab: 4, copper: 5, glazed: 6, lead: 7, plain: 8 } as const

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const P = (a: string[], R: () => number) => lin(a[Math.floor(R() * a.length)])
const jit = (c: Col, R: () => number, a: number): Col => { const k = 1 + (R() - 0.5) * a; return [c[0] * k, c[1] * k, c[2] * k] }

// ---------- palettes ----------
const PAL = {
  central: {
    plaster: ['#e8dcc0', '#d9c7a0', '#e6d3b3', '#c9b48a', '#e9e2d0', '#d8b89a', '#c7c9b4', '#e3c9a8', '#b9c4c6', '#e4cdb4', '#d6c2d0'],
    rough: ['#a89a84', '#9a8e7c', '#b0a48e', '#8e8474'], stone: ['#b8ad98', '#a39a8a', '#c4b8a0', '#9e9686'], brick: ['#9a4a32', '#8a3e2c', '#a8583c', '#7e4232'],
    clay: ['#8a3e26', '#9a4a2e', '#7a3a28', '#6a4030', '#a0502e'], slate: ['#4a4f57', '#3e434a', '#555a60'], shingle: ['#5e4a38', '#6a5440'], copper: ['#4f7a6e', '#5a8676'],
  },
  mediterranean: {
    stucco: ['#e3b97a', '#d99a6c', '#e8cfa0', '#f0e2c4', '#c97b5a', '#e6c08a', '#f2e8d8', '#d4a373', '#e8b4a0', '#efd4a8', '#d8b08c', '#c98e6e'],
    stone: ['#d2c3a0', '#c8b48e', '#dccdb0'], barrel: ['#b8643a', '#c4703f', '#a65a34', '#cc7d4e', '#b36a48'],
    awning: ['#a83a2a', '#2f5a7a', '#d8b04a', '#4a7a3a', '#e8dcc0', '#8a3a5a'], shutter: ['#3d5a3a', '#2f5a6a', '#6a8a4a', '#7a4a2a'],
  },
  mountain: {
    rubble: ['#8f8a80', '#7d7a72', '#9a958a', '#86827a', '#a09a8e'], wood: ['#5a3e2a', '#4a3322', '#644632', '#3e2c20'], white: ['#ece9e2', '#e4e0d6', '#f0ece4'],
    slab: ['#5a5a58', '#6a6660', '#4e4e4c'], shingle: ['#5e4a38', '#4a3a2c'], slate: ['#45484e', '#3a3d42'],
  },
  eastern: {
    white: ['#ece6da', '#e8e0d0', '#f2ede4'], stucco: ['#d9c4a0', '#e0b48a', '#cfb08a', '#e4d0ac'], ablaq: ['#d8c8a8', '#cdb890', '#e2d4b8'],
    lead: ['#7a8288', '#6e767c'], glazed: ['#3a8a8a', '#3a5a8a', '#4a7a4a', '#2f6f7f'], gold: ['#c9a24a'],
  },
}

// ---------- design ----------
export interface Spec {
  culture: Culture; w: number; d: number; floors: number; fh: number
  mat: number; upper: number | null; wall: Col; upperCol: Col; win: number
  roof: number; tile: number; roofCol: Col; pitch: number; over: number; gableFront: boolean
  chim: number; dormers: number; balconies: number; awning: boolean; tower: number; cornice: boolean; cupolas: number; minaret: boolean; courtyard: boolean; dome: number
  accent: Col
}
/** Design one house from its culture and wealth (0 slum .. 1 palace). */
export function design(c: Culture, w: number, R: () => number, steep = false): Spec {
  const tier = w < 0.3 ? 0 : w < 0.66 ? 1 : 2
  const s: Spec = {
    culture: c, w: 8, d: 10, floors: 3, fh: 3.1, mat: MATERIAL.plaster, upper: null, wall: [0.8, 0.8, 0.8], upperCol: [0.8, 0.8, 0.8], win: WINDOW.shutter,
    roof: PART.gable, tile: TILE.clay, roofCol: [0.4, 0.2, 0.1], pitch: 0.5, over: 0.4, gableFront: false, chim: 0, dormers: 0, balconies: 0, awning: false, tower: 0,
    cornice: false, cupolas: 0, minaret: false, courtyard: false, dome: 0, accent: [0.3, 0.3, 0.3],
  }
  const r = R
  if (c === 'central') {
    const pal = PAL.central
    s.w = [5 + r() * 2.5, 6 + r() * 4.5, 12 + r() * 12][tier]; s.d = 9 + r() * 5
    s.floors = [2 + Math.floor(r() * 2), 3 + Math.floor(r() * 3), 3 + Math.floor(r() * 2)][tier]; s.fh = [2.9, 3.1, 3.9][tier]
    const m = r()
    if (tier === 0) { s.mat = m < 0.35 ? MATERIAL.timber : MATERIAL.plaster; s.wall = s.mat === MATERIAL.timber ? P(pal.plaster, r) : P(pal.rough, r) }
    else if (tier === 1) { s.mat = m < 0.45 ? MATERIAL.timber : m < 0.85 ? MATERIAL.plaster : MATERIAL.brick; s.wall = s.mat === MATERIAL.brick ? P(pal.brick, r) : P(pal.plaster, r) }
    else { s.mat = m < 0.55 ? MATERIAL.stone : m < 0.8 ? MATERIAL.plaster : MATERIAL.brick; s.wall = s.mat === MATERIAL.stone ? P(pal.stone, r) : s.mat === MATERIAL.brick ? P(pal.brick, r) : P(pal.plaster, r) }
    if (s.mat === MATERIAL.timber && r() < 0.6) { s.upper = MATERIAL.timber; s.mat = MATERIAL.stone; s.upperCol = P(pal.plaster, r); s.wall = P(pal.stone, r) }
    s.win = s.mat === MATERIAL.timber || s.upper === MATERIAL.timber ? WINDOW.mullion : tier === 2 && r() < 0.45 ? WINDOW.arched : r() < 0.45 ? WINDOW.shutter : WINDOW.mullion
    const rr = r()
    s.gableFront = tier < 2 && s.w < 9 && r() < 0.6
    s.roof = tier === 2 ? (rr < 0.35 ? PART.hip : rr < 0.6 ? PART.mansard : rr < 0.85 ? (s.gableFront = true, PART.stepgable) : PART.gable) : s.gableFront && (s.mat === MATERIAL.brick || r() < 0.2) ? PART.stepgable : PART.gable
    s.pitch = 0.6 + r() * 0.25; s.over = 0.45
    const t = r(); s.tile = tier === 0 && t < 0.3 ? TILE.shingle : t < 0.68 ? TILE.clay : t < 0.95 ? TILE.slate : TILE.copper
    s.roofCol = P(s.tile === TILE.clay ? pal.clay : s.tile === TILE.slate ? pal.slate : s.tile === TILE.shingle ? pal.shingle : pal.copper, r)
    s.chim = 1 + Math.floor(r() * 2); s.dormers = tier > 0 && !s.gableFront && r() < 0.6 ? 1 + Math.floor(r() * 3) : 0
    s.cornice = tier === 2 || (tier === 1 && r() < 0.3)
    s.tower = tier === 2 && r() < 0.18 ? (r() < 0.55 ? PART.spire : PART.onion) : 0
  } else if (c === 'mediterranean') {
    const pal = PAL.mediterranean
    s.w = [5 + r() * 3, 7 + r() * 5, 16 + r() * 14][tier]; s.d = 8 + r() * 6
    s.floors = [2 + Math.floor(r() * 2), 3 + Math.floor(r() * 3), 3 + Math.floor(r() * 2)][tier]; s.fh = [3, 3.3, 4.4][tier]
    s.mat = tier === 2 && r() < 0.25 ? MATERIAL.stone : MATERIAL.plaster
    s.wall = s.mat === MATERIAL.stone ? P(pal.stone, r) : P(pal.stucco, r)
    s.win = tier === 2 && r() < 0.4 ? WINDOW.arcade : tier === 2 && r() < 0.4 ? WINDOW.arched : WINDOW.shutter
    const rr = r()
    s.roof = tier < 2 && rr < 0.32 ? PART.flat : rr < 0.7 ? PART.hip : PART.gable
    s.pitch = 0.22 + r() * 0.1; s.over = 0.3; s.tile = TILE.barrel; s.roofCol = P(pal.barrel, r)
    s.cornice = tier > 0 && r() < 0.7; s.balconies = r() < 0.6 ? 1 + Math.floor(r() * 3) : 0; s.awning = tier < 2 && r() < 0.4
    s.chim = r() < 0.5 ? 1 : 0; s.tower = tier === 2 && r() < 0.14 ? PART.pyramid : 0
    s.courtyard = tier === 2 && s.w > 22 && r() < 0.55
    s.accent = P(pal.awning, r)
  } else if (c === 'mountain') {
    const pal = PAL.mountain
    const white = steep || r() < 0.18
    s.w = [5 + r() * 2.5, 7 + r() * 3.5, 10 + r() * 7][tier]; s.d = 8 + r() * 4.5
    s.floors = [2 + Math.floor(r() * 2), 2 + Math.floor(r() * 3), 3 + Math.floor(r() * 2)][tier]; s.fh = [2.8, 3, 3.4][tier]
    if (white) {
      s.mat = MATERIAL.whitewash; s.wall = P(pal.white, r); s.win = WINDOW.small
      s.roof = r() < 0.75 ? PART.flat : PART.dome; s.tile = TILE.plain; s.roofCol = s.roof === PART.dome ? lin(r() < 0.6 ? '#3a6aa8' : '#ece9e2') : P(pal.white, r)
      s.accent = lin(['#2f5a9a', '#3a7aa8', '#7a3a2a'][Math.floor(r() * 3)])
    } else {
      s.mat = MATERIAL.rubble; s.wall = P(pal.rubble, r)
      if (r() < 0.65) { s.upper = MATERIAL.wood; s.upperCol = P(pal.wood, r) }
      s.win = WINDOW.small; s.roof = PART.gable; s.pitch = 0.3 + r() * 0.12; s.over = 1 + r() * 0.5
      const t = r(); s.tile = t < 0.5 ? TILE.slab : t < 0.8 ? TILE.shingle : TILE.slate
      s.roofCol = P(s.tile === TILE.slab ? pal.slab : s.tile === TILE.shingle ? pal.shingle : pal.slate, r)
      s.balconies = r() < 0.55 ? 1 + Math.floor(r() * 2) : 0; s.chim = 1 + Math.floor(r() * 2)
      s.gableFront = r() < 0.5
      s.tower = tier === 2 && r() < 0.15 ? PART.pyramid : 0
    }
  } else {
    const pal = PAL.eastern
    s.w = [5 + r() * 3, 7 + r() * 5, 14 + r() * 14][tier]; s.d = 8 + r() * 6
    s.floors = [2 + Math.floor(r() * 2), 2 + Math.floor(r() * 3), 2 + Math.floor(r() * 2)][tier]; s.fh = [3.2, 3.4, 4.6][tier]
    const m = r()
    s.mat = tier === 2 && m < 0.5 ? MATERIAL.ablaq : m < 0.5 ? MATERIAL.whitewash : MATERIAL.plaster
    s.wall = P(s.mat === MATERIAL.ablaq ? pal.ablaq : s.mat === MATERIAL.whitewash ? pal.white : pal.stucco, r)
    s.win = tier === 0 ? WINDOW.small : r() < 0.6 ? WINDOW.pointed : WINDOW.arched
    const rr = r()
    s.roof = tier === 2 && rr < 0.45 ? PART.flat : tier === 2 ? PART.flat : rr < 0.8 ? PART.flat : PART.hip
    s.tile = TILE.plain; s.roofCol = mix(s.wall, [0.5, 0.45, 0.4], 0.25); s.pitch = 0.25
    if (tier === 2) { s.dome = r() < 0.75 ? PART.dome : PART.onion; s.cupolas = r() < 0.6 ? 2 + Math.floor(r() * 3) : 0; s.minaret = r() < 0.12 }
    s.accent = P(r() < 0.15 ? pal.gold : r() < 0.5 ? pal.glazed : pal.lead, r)
    s.balconies = tier > 0 && r() < 0.35 ? 1 : 0
    s.courtyard = tier === 2 && s.w > 20 && r() < 0.5
  }
  s.wall = jit(s.wall, r, 0.12); s.roofCol = jit(s.roofCol, r, 0.18)
  return s
}

// ---------- occupancy ----------
/** A sparse 2 m raster of taken ground (roads, structures, buildings), allocated in tiles as needed. */
export class Occ {
  private tiles = new Map<number, Uint8Array>()
  private cell = 2; private T = 64
  private tile(ti: number, tj: number, make: boolean) { const k = ti * 100003 + tj; let t = this.tiles.get(k); if (!t && make) { t = new Uint8Array(this.T * this.T); this.tiles.set(k, t) } return t }
  private visit(cx: number, cz: number, yaw: number, w: number, d: number, pad: number, fn: (t: Uint8Array | undefined, i: number, ti: number, tj: number) => boolean | void) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2 + pad, hd = d / 2 + pad, rx = Math.abs(c) * hw + Math.abs(s) * hd, rz = Math.abs(s) * hw + Math.abs(c) * hd
    for (let j = Math.floor((cz - rz) / this.cell); j <= Math.floor((cz + rz) / this.cell); j++) for (let i = Math.floor((cx - rx) / this.cell); i <= Math.floor((cx + rx) / this.cell); i++) {
      const px = (i + 0.5) * this.cell - cx, pz = (j + 0.5) * this.cell - cz, u = px * c - pz * s, v = px * s + pz * c
      if (Math.abs(u) > hw || Math.abs(v) > hd) continue
      const ti = Math.floor(i / this.T), tj = Math.floor(j / this.T)
      if (fn(this.tile(ti, tj, false), (j - tj * this.T) * this.T + (i - ti * this.T), ti, tj) === true) return true
    }
    return false
  }
  free(cx: number, cz: number, yaw: number, w: number, d: number, pad = 0) { return !this.visit(cx, cz, yaw, w, d, pad, (t, i) => !!t && t[i] > 0) }
  mark(cx: number, cz: number, yaw: number, w: number, d: number, pad = 0) { this.visit(cx, cz, yaw, w, d, pad, (_t, i, ti, tj) => { this.tile(ti, tj, true)![i] = 1 }) }
  markCircle(cx: number, cz: number, r: number) { this.mark(cx, cz, 0, r * 2, r * 2) }
}

// ---------- emitting parts ----------
export interface Out { parts: number[]; chimneys: number[]; count: number }
const push = (o: Out, type: number, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, col: Col, d: number[] = []) => {
  o.parts.push(type, x, y, z, yaw, sx, sy, sz, col[0], col[1], col[2], d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0, d[4] ?? 0, d[5] ?? 0)
}
/** Place one designed house with its front (local +z) facing yaw, centred at (x, z). Returns its height above the base. */
export function emit(o: Out, s: Spec, x: number, z: number, yaw: number, H: (x: number, z: number) => number, wealth: number, R: () => number) {
  const c = Math.cos(yaw), sn = Math.sin(yaw), at = (u: number, v: number): [number, number] => [x + u * c + v * sn, z - u * sn + v * c]
  if (s.courtyard) { // four wings around a court
    const t = Math.min(12, s.d), ww = s.w, dd = s.w * (0.7 + R() * 0.3)
    const wings: [number, number, number, number][] = [[0, dd / 2 - t / 2, ww, t], [0, -dd / 2 + t / 2, ww, t], [-ww / 2 + t / 2, 0, t, dd - 2 * t], [ww / 2 - t / 2, 0, t, dd - 2 * t]]
    let top = 0
    wings.forEach(([u, v, w, d], k) => { const [px, pz] = at(u, v), sub = { ...s, courtyard: false, w: k < 2 ? w : d, d: k < 2 ? d : w, tower: k === 0 ? s.tower : 0, minaret: false, dome: k === 1 ? s.dome : 0, cupolas: 0, awning: k === 0 && s.awning, balconies: k === 0 ? s.balconies : 0 }; top = Math.max(top, emit(o, sub, px, pz, k < 2 ? yaw + (k === 1 ? Math.PI : 0) : yaw + (k === 2 ? -Math.PI / 2 : Math.PI / 2), H, wealth, R)) })
    return top
  }
  let lo = Infinity, hi = -Infinity
  for (const [u, v] of [[-s.w / 2, -s.d / 2], [s.w / 2, -s.d / 2], [-s.w / 2, s.d / 2], [s.w / 2, s.d / 2], [0, s.d / 2]]) { const h = H(...at(u, v)); lo = Math.min(lo, h); hi = Math.max(hi, h) }
  const base = lo - 1.5, ground = hi, body = ground - base + s.floors * s.fh, top = base + body, seed = Math.floor(R() * 997)
  const wallD = (mat: number) => [ground, s.fh, wealth, seed, mat, s.win]
  if (s.upper != null) {
    const low = ground - base + s.fh
    push(o, PART.wall, x, base, z, yaw, s.w, low, s.d, s.wall, wallD(s.mat))
    push(o, PART.wall, x, base + low, z, yaw, s.w, body - low, s.d, s.upperCol, wallD(s.upper))
  } else push(o, PART.wall, x, base, z, yaw, s.w, body, s.d, s.wall, wallD(s.mat))
  // roof
  const span = Math.min(s.w, s.d), ry = s.gableFront ? yaw + Math.PI / 2 : yaw, rw = s.gableFront ? s.d : s.w, rd = s.gableFront ? s.w : s.d
  const roofH = s.pitch * (s.gableFront ? s.w : s.d), tileD = [s.tile, seed]
  if (s.cornice) push(o, PART.cornice, x, top - 0.45, z, yaw, s.w + 0.5, 0.45, s.d + 0.5, mix(s.wall, [1, 1, 1], 0.25))
  if (s.roof === PART.flat) {
    push(o, PART.flat, x, top, z, yaw, s.w, 0.3, s.d, mix(s.roofCol, [0.3, 0.3, 0.3], 0.2), tileD)
    push(o, PART.parapet, x, top, z, yaw, s.w, 1.0, s.d, mix(s.wall, [0, 0, 0], 0.05))
    if (s.culture === 'mediterranean' && R() < 0.5) push(o, PART.awning, ...at(s.w * 0.2, -s.d * 0.1), top + 2.4, yaw, 3, 0.4, 3, s.accent) // a pergola shade on the roof terrace
  } else if (s.roof === PART.dome) push(o, PART.dome, x, top, z, yaw, span * 0.8, span * 0.55, span * 0.8, s.roofCol, tileD)
  else {
    const ov = s.roof === PART.stepgable ? 0 : s.over * 2, shape = s.roof === PART.stepgable ? PART.gable : s.roof
    push(o, shape, x, top, z, ry, rw + ov, s.roof === PART.hip ? span * s.pitch : roofH, rd + ov, s.roofCol, tileD)
    if (s.roof === PART.stepgable) push(o, PART.stepgable, x, top - 0.05, z, ry, rw + 0.1, roofH + 0.4, rd, mix(s.wall, [0.85, 0.82, 0.76], 0.3))
  }
  // eastern domes and cupolas over flat roofs
  if (s.dome) {
    const dw = span * 0.62
    push(o, PART.wall, x, top, z, yaw, dw * 0.85, dw * 0.35, dw * 0.85, s.wall, [top, 99, wealth, seed, s.mat, WINDOW.small])
    push(o, s.dome, x, top + dw * 0.35, z, yaw, dw, s.dome === PART.onion ? dw * 1.3 : dw * 0.62, dw, s.accent, [TILE.glazed, seed])
  }
  for (let k = 0; k < s.cupolas; k++) { const [px, pz] = at((k % 2 ? 1 : -1) * s.w * 0.32, (k < 2 ? 1 : -1) * s.d * 0.3); push(o, PART.dome, px, top + 0.3, pz, yaw, 2.6, 1.7, 2.6, s.accent, [TILE.glazed, seed]) }
  // chimneys (smoke rises from them later)
  if (s.roof !== PART.flat && s.roof !== PART.dome) for (let k = 0; k < s.chim; k++) {
    const u = (k ? -1 : 1) * s.w * (0.15 + R() * 0.2), v = (R() - 0.5) * s.d * 0.35, [px, pz] = at(u, v), hgt = roofH * 0.8 + 1.2 + R()
    push(o, PART.chimney, px, top - 0.5, pz, yaw, 0.9, hgt + 0.5, 0.9, s.culture === 'mountain' ? mix(s.wall, [0.4, 0.4, 0.4], 0.3) : lin(R() < 0.5 ? '#8a5a48' : '#a89a88'))
    o.chimneys.push(px, top - 0.5, pz, hgt + 0.5)
  }
  // dormers on the front slope
  if (s.dormers && (s.roof === PART.gable || s.roof === PART.mansard || s.roof === PART.hip) && !s.gableFront) for (let k = 0; k < s.dormers; k++) {
    const u = (k - (s.dormers - 1) / 2) * Math.min(3.2, s.w / (s.dormers + 0.5)), [px, pz] = at(u, s.d * 0.22)
    push(o, PART.dormer, px, top + roofH * 0.12, pz, yaw, 1.7, Math.min(2.6, roofH * 0.55), 2.2, s.wall, [s.tile, seed])
  }
  // balconies, awnings
  for (let k = 0; k < s.balconies; k++) {
    const fl = 1 + Math.floor(R() * Math.max(1, s.floors - 1)), bw = s.culture === 'mountain' ? s.w * 0.9 : 2 + R() * 2.5, u = s.culture === 'mountain' ? 0 : (R() - 0.5) * (s.w - bw)
    const [px, pz] = at(u, s.d / 2 + 0.6)
    push(o, PART.balcony, px, ground + fl * s.fh - 0.15, pz, yaw, bw, s.culture === 'eastern' ? 2.2 : 1, 1.2, s.culture === 'mountain' ? lin('#4a3322') : s.culture === 'eastern' ? lin('#5a3e2a') : lin('#2a2a2c'))
  }
  if (s.awning) { const [px, pz] = at((R() - 0.5) * s.w * 0.4, s.d / 2 + 0.8); push(o, PART.awning, px, ground + 2.6, pz, yaw, Math.min(s.w * 0.7, 4), 0.8, 1.6, s.accent) }
  // towers, minarets
  if (s.tower) {
    const tw = Math.min(5.5, s.w * 0.38), [px, pz] = at(s.w / 2 - tw / 2, s.d / 2 - tw / 2), th = body + s.fh * (2 + R() * 1.5)
    push(o, PART.wall, px, base, pz, yaw, tw, th, tw, s.wall, [ground, s.fh, wealth, seed + 1, s.mat === MATERIAL.timber ? MATERIAL.plaster : s.mat, WINDOW.small])
    push(o, s.tower, px, base + th, pz, yaw, tw * (s.tower === PART.onion ? 1.1 : 1.08), s.tower === PART.spire ? tw * 2.6 : s.tower === PART.onion ? tw * 1.6 : tw * 0.9, tw * (s.tower === PART.onion ? 1.1 : 1.08), s.tower === PART.onion ? lin(R() < 0.5 ? '#4f7a6e' : '#3a3a3e') : s.roofCol, [s.tower === PART.onion ? TILE.copper : s.tile, seed])
  }
  if (s.minaret) { const [px, pz] = at(-s.w / 2 - 2.5, s.d / 2 - 2.5); push(o, PART.minaret, px, H(px, pz) - 1, pz, yaw, 3.2, body + 22, 3.2, s.wall) }
  o.count++
  return top + roofH
}

// ---------- placing ----------
export interface DistrictIn { culture: Culture | 'mixed'; inside: (x: number, z: number) => number; bbox: [number, number, number, number]; density: number; wealth: (x: number, z: number, h: number) => number; steep: boolean }
export interface PlaceIn {
  H: (x: number, z: number) => number; wet: (x: number, z: number, h: number) => boolean; occ: Occ; roads: Road[]; districts: DistrictIn[]; seed: number; max: number
}
/** Line the streets with houses, then fill what space is left. */
export function placeAll(o: PlaceIn): Out {
  const out: Out = { parts: [], chimneys: [], count: 0 }, R = rng(o.seed ^ 0xb11d), mixN = simplex(o.seed ^ 0x3c3c)
  const cultureAt = (d: DistrictIn, x: number, z: number): Culture => d.culture !== 'mixed' ? d.culture : CULTURES[Math.floor(clamp(fbm(mixN, x / 600, 1, z / 600, 2) * 1.6 + 0.5, 0, 0.999) * 4)]
  const slopeAt = (x: number, z: number) => Math.hypot(o.H(x + 4, z) - o.H(x - 4, z), o.H(x, z + 4) - o.H(x, z - 4)) / 8
  const okAt = (d: DistrictIn, s: Spec, x: number, z: number, yaw: number, pad: number) => {
    if (d.inside(x, z) > -2) return false
    const h = o.H(x, z)
    if (o.wet(x, z, h) || slopeAt(x, z) > (d.steep ? 2 : 1.15)) return false
    return o.occ.free(x, z, yaw, s.w, s.courtyard ? s.w : s.d, pad)
  }
  // 1. street frontage, both sides of every lane and main road that runs through a district
  for (const d of o.districts) {
    for (const r of o.roads) {
      if (r.kind === 'stairs' || out.count > o.max) continue
      const p = r.pts
      if (!p.some(([x, , z]) => d.inside(x, z) < 0)) continue
      const segL: number[] = [0]
      for (let i = 1; i < p.length; i++) segL.push(segL[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]))
      const total = segL[segL.length - 1]
      const sample = (sv: number) => { let i = 1; while (i < p.length - 1 && segL[i] < sv) i++; const t = (sv - segL[i - 1]) / (segL[i] - segL[i - 1] || 1), dx = p[i][0] - p[i - 1][0], dz = p[i][2] - p[i - 1][2], l = Math.hypot(dx, dz) || 1; return { x: p[i - 1][0] + dx * t, z: p[i - 1][2] + dz * t, dx: dx / l, dz: dz / l } }
      for (const side of [-1, 1]) {
        let sv = 2 + R() * 4
        while (sv < total - 4) {
          const q = sample(sv)
          if (d.inside(q.x, q.z) > 0) { sv += 6; continue }
          const h = o.H(q.x, q.z), w = d.wealth(q.x, q.z, h), cu = cultureAt(d, q.x, q.z)
          if (R() > d.density * 1.1) { sv += 4 + R() * 6; continue }
          const s = design(cu, w, R, d.steep)
          const nx = -q.dz * side, nz = q.dx * side, set = r.width / 2 + 0.8 + (w > 0.7 ? 2 + R() * 4 : R() * 0.6), dd = s.courtyard ? s.w * 0.85 : s.d
          const cx = q.x + nx * (set + dd / 2) + q.dx * (s.w / 2), cz = q.z + nz * (set + dd / 2) + q.dz * (s.w / 2), yaw = Math.atan2(-nx, -nz)
          if (okAt(d, s, cx, cz, yaw, 0.2)) {
            emit(out, s, cx, cz, yaw, o.H, w, R)
            o.occ.mark(cx, cz, yaw, s.w, dd, w > 0.7 ? 2.5 : 0.25)
            sv += s.w + (w < 0.3 ? 0.1 : w < 0.66 ? R() * 1.5 : 3 + R() * 7)
          } else sv += 2.5
        }
      }
    }
  }
  // 2. back houses and courtyards in what is left
  for (const d of o.districts) {
    const [x0, z0, x1, z1] = d.bbox, step = 7
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step), order = new Int32Array(nx * nz)
    for (let k = 0; k < order.length; k++) order[k] = k
    for (let k = order.length - 1; k > 0; k--) { const r = Math.floor(R() * (k + 1)), t = order[k]; order[k] = order[r]; order[r] = t }
    for (const k of order) {
      if (out.count > o.max) break
      if (R() > d.density * 0.38) continue // leave room for yards and courtyards
      const x = x0 + (k % nx) * step + R() * step, z = z0 + Math.floor(k / nx) * step + R() * step
      if (d.inside(x, z) > -4) continue
      const h = o.H(x, z), w = d.wealth(x, z, h), s = design(cultureAt(d, x, z), w, R, d.steep)
      const gx = o.H(x + 4, z) - o.H(x - 4, z), gz = o.H(x, z + 4) - o.H(x, z - 4)
      const yaw = Math.hypot(gx, gz) > 0.4 ? Math.atan2(-gx, -gz) : R() * Math.PI * 2 // downhill, so the front looks out over the slope
      if (!okAt(d, s, x, z, yaw, 0.6)) continue
      emit(out, s, x, z, yaw, o.H, w, R)
      o.occ.mark(x, z, yaw, s.w, s.courtyard ? s.w : s.d, 0.6)
    }
  }
  return out
}

/** A farmstead: a house, a barn and maybe a shed, loosely around a yard. */
export function farmstead(out: Out, culture: Culture, x: number, z: number, yaw: number, H: (x: number, z: number) => number, occ: Occ, R: () => number) {
  const house = design(culture, 0.25 + R() * 0.2, R)
  house.floors = 2; house.courtyard = false; house.tower = 0
  if (!occ.free(x, z, yaw, house.w + 18, house.d + 18)) return
  emit(out, house, x, z, yaw, H, 0.3, R)
  const c = Math.cos(yaw), s = Math.sin(yaw), u = house.w / 2 + 9, v = -2
  const barn: Spec = { ...house, w: 12 + R() * 6, d: 9 + R() * 3, floors: 2, fh: 3.6, mat: MATERIAL.wood, upper: null, wall: jit(lin('#6a4a32'), R, 0.3), win: WINDOW.small, roof: PART.gable, pitch: 0.55, chim: 0, dormers: 0, balconies: 0, awning: false, cornice: false, gableFront: true, dome: 0, cupolas: 0, minaret: false }
  emit(out, barn, x + u * c + v * s, z - u * s + v * c, yaw - Math.PI / 2, H, 0.2, R)
  occ.mark(x, z, yaw, house.w + 18, house.d + 18)
}
