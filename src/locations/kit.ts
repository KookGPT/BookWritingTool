// Locations kit library: a geometry builder and parametric megastructure kits (gothic cathedral, Sagrada-style basilica of
// spires, colonnaded plaza with obelisk, domed basilica, arcades for bridges and aqueducts, towers, plazas, colossal
// statues). Pure (no DOM, no three.js) so node, the CLI and the worker all run it.
// Coordinates are metres, three.js style: x east, y up, z south. Output is merged triangles per material.
import { rng } from '../world/noise.ts'

export type V = [number, number, number]
export type Col = [number, number, number]
export type P2 = [number, number]
export const MATS = ['stone', 'roof', 'dark', 'glass', 'stained', 'metal', 'water', 'leaf', 'road', 'cloth'] as const
export type Mat = typeof MATS[number]
interface Geo { pos: number[]; nor: number[]; col: number[] }
const DEG = Math.PI / 180

const LIN = new Map<string, Col>()
/** sRGB hex to linear colour (memoised: generators call this a lot). */
export const lin = (hex: string): Col => { let c = LIN.get(hex); if (!c) { c = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2) as Col; LIN.set(hex, c) } return c }
export const jit = (c: Col, R: () => number, a: number): Col => { const k = 1 + (R() - 0.5) * a; return [c[0] * k, c[1] * k, c[2] * k] }
export const mix = (a: Col, b: Col, t: number): Col => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V): V => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

// Unit icosphere (one subdivision), counter-clockwise from outside: heads, finials, foliage.
const ICO: V[][] = (() => {
  const t = (1 + Math.sqrt(5)) / 2
  const v: V[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => norm(p as V))
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
  const out: V[][] = []
  for (const [a, b, c] of f) {
    const A = v[a], B = v[b], C = v[c], ab = norm(add(A, B)), bc = norm(add(B, C)), ca = norm(add(C, A))
    for (const tri of [[A, ab, ca], [ab, B, bc], [ca, bc, C], [ab, bc, ca]] as V[][]) {
      const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      out.push(dot(n, tri[0]) < 0 ? [tri[0], tri[2], tri[1]] : tri)
    }
  }
  return out
})()

/** Accumulates geometry in a movable local frame (origin, yaw, uniform scale). Local +z turns to world (sin yaw, 0, cos yaw). */
export class Builder {
  geo = {} as Record<Mat, Geo>
  lamps: number[] = [] // world positions of lights that glow at night
  private ox = 0; private oy = 0; private oz = 0; private c = 1; private s = 0; private k = 1; yaw = 0
  constructor() { for (const m of MATS) this.geo[m] = { pos: [], nor: [], col: [] } }
  frame(x = 0, y = 0, z = 0, yaw = 0, scale = 1) { this.ox = x; this.oy = y; this.oz = z; this.yaw = yaw; this.c = Math.cos(yaw); this.s = Math.sin(yaw); this.k = scale; return this }
  lamp(x: number, y: number, z: number) { this.lamps.push(...this.w(x, y, z)) }
  w(x: number, y: number, z: number): V { const k = this.k; return [this.ox + k * (x * this.c + z * this.s), this.oy + k * y, this.oz + k * (-x * this.s + z * this.c)] }
  /** Run `fn` in a child frame placed at local (x, y, z) and turned by yaw (same scale). */
  within(x: number, y: number, z: number, yaw: number, fn: () => void) {
    const save = [this.ox, this.oy, this.oz, this.yaw, this.k] as const, o = this.w(x, y, z)
    this.frame(o[0], o[1], o[2], this.yaw + yaw, this.k); fn(); this.frame(...save)
  }
  tri(m: Mat, a: V, b: V, c: V, na: V, nb: V, nc: V, col: Col) {
    const g = this.geo[m]
    g.pos.push(...a, ...b, ...c); g.nor.push(...na, ...nb, ...nc); g.col.push(...col, ...col, ...col)
  }
  /** A flat polygon in world space, fanned from its first point; turned to face away from `inside` when given. */
  face(m: Mat, pts: V[], col: Col, inside?: V) {
    let nx = 0, ny = 0, nz = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1])
    }
    if (!(Math.hypot(nx, ny, nz) > 1e-9)) return
    let n = norm([nx, ny, nz])
    if (inside) {
      const c = pts.reduce((s, p) => add(s, p, 1 / pts.length), [0, 0, 0] as V)
      if (dot(n, sub(c, inside)) < 0) { pts = [pts[0], ...pts.slice(1).reverse()]; n = [-n[0], -n[1], -n[2]] }
    }
    for (let i = 1; i < pts.length - 1; i++) this.tri(m, pts[0], pts[i], pts[i + 1], n, n, n, col)
  }
  /** Eight local corners indexed by bits (x: 1, y: 2, z: 4). */
  hexa(m: Mat, c: V[], col: Col) {
    const W = c.map((p) => this.w(...p)), ctr = W.reduce((s, p) => add(s, p, 1 / 8), [0, 0, 0] as V)
    for (const f of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6]]) this.face(m, f.map((i) => W[i]), col, ctr)
  }
  box(m: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: Col) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return
    const c: V[] = []
    for (let i = 0; i < 8; i++) c.push([i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0])
    this.hexa(m, c, col)
  }
  /** A squared member from a to b (local), `wid` across, `dep` deep along unit n, starting on the a–b line (or centred). */
  beam(m: Mat, a: V, b: V, wid: number, dep: number, n: V, col: Col, centred = false) {
    const u = norm(sub(b, a)), v = norm(cross(n, u)), o = centred ? -dep / 2 : 0, c: V[] = []
    for (let i = 0; i < 8; i++) c.push(add(add(i & 1 ? b : a, v, i & 2 ? wid / 2 : -wid / 2), n, (i & 4 ? dep : 0) + o))
    this.hexa(m, c, col)
  }
  /** A polygon (u, v) extruded along local z (u = x) or x (u = z), v = height. Convex or star-shaped from point 0. */
  prism(m: Mat, pts: P2[], axis: 'x' | 'z', d0: number, d1: number, col: Col) {
    const L = (p: P2, d: number): V => (axis === 'z' ? [p[0], p[1], d] : [d, p[1], p[0]])
    const cu = pts.reduce((s, p) => s + p[0], 0) / pts.length, cv = pts.reduce((s, p) => s + p[1], 0) / pts.length
    const ctr = this.w(...L([cu, cv], (d0 + d1) / 2))
    this.face(m, pts.map((p) => this.w(...L(p, d0))), col, this.w(...L([cu, cv], d1)))
    this.face(m, pts.map((p) => this.w(...L(p, d1))), col, this.w(...L([cu, cv], d0)))
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      this.face(m, [L(a, d0), L(b, d0), L(b, d1), L(a, d1)].map((p) => this.w(...p)), col, ctr)
    }
  }
  /** Surface of revolution around local (cx, cz): profile is [radius, height] from bottom to top; smooth normals. */
  lathe(m: Mat, cx: number, y0: number, cz: number, prof: P2[], sides: number, col: Col) {
    const n = prof.length, nr: P2[] = prof.map((_, i) => {
      const a = prof[Math.max(0, i - 1)], b = prof[Math.min(n - 1, i + 1)], dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1
      return [dy / l, -dr / l]
    })
    const o = this.w(cx, y0, cz)
    const ring = (i: number) => Array.from({ length: sides + 1 }, (_, j) => {
      const a = (j / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a)
      const p = this.w(cx + prof[i][0] * ca, y0 + prof[i][1], cz + prof[i][0] * sa), q = this.w(cx + ca, y0, cz + sa)
      return { p, n: norm([(q[0] - o[0]) * nr[i][0], nr[i][1] * this.k, (q[2] - o[2]) * nr[i][0]]) }
    })
    let B = ring(0)
    for (let i = 0; i < n - 1; i++) {
      const T = ring(i + 1)
      for (let j = 0; j < sides; j++) {
        if (prof[i][0] > 1e-6) this.tri(m, B[j].p, T[j + 1].p, B[j + 1].p, B[j].n, T[j + 1].n, B[j + 1].n, col)
        if (prof[i + 1][0] > 1e-6) this.tri(m, B[j].p, T[j].p, T[j + 1].p, B[j].n, T[j].n, T[j + 1].n, col)
      }
      B = T
    }
  }
  /** Smooth-sided cylinder or cone, with caps. */
  cyl(m: Mat, cx: number, y0: number, cz: number, r0: number, r1: number, h: number, sides: number, col: Col, caps = true) {
    this.lathe(m, cx, y0, cz, caps ? [[0, 0], [r0, 0], [r1, h], [0, h]] : [[r0, 0], [r1, h]], sides, col)
  }
  /** Flat-faced pyramid (spires, pinnacles); 4 or 8 sides. */
  pyr(m: Mat, cx: number, y0: number, cz: number, r: number, h: number, sides: number, col: Col) {
    const off = sides === 4 ? Math.PI / 4 : Math.PI / 8, top = this.w(cx, y0 + h, cz), ctr = this.w(cx, y0 + h / 3, cz)
    const P = Array.from({ length: sides }, (_, i) => { const a = off + (i / sides) * Math.PI * 2; return this.w(cx + r * Math.cos(a), y0, cz + r * Math.sin(a)) })
    for (let i = 0; i < sides; i++) this.face(m, [P[i], P[(i + 1) % sides], top], col, ctr)
    this.face(m, P, col, top)
  }
  ico(m: Mat, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: Col) {
    const o = this.w(0, 0, 0)
    for (const t of ICO) {
      const p = t.map((q) => this.w(cx + q[0] * rx, cy + q[1] * ry, cz + q[2] * rz)) as V[]
      const n = t.map((q) => norm(sub(this.w(q[0] / rx, q[1] / ry, q[2] / rz), o))) as V[]
      this.tri(m, p[0], p[1], p[2], n[0], n[1], n[2], col)
    }
  }
  /** Moulding between two outlines in the local x/y plane (same point count), from z0 to z1. Arches, rings, tracery. */
  ring2(m: Mat, outer: P2[], inner: P2[], z0: number, z1: number, col: Col, closed = false) {
    const n = outer.length, end = closed ? n : n - 1, q = (p: P2, z: number) => this.w(p[0], p[1], z)
    for (let i = 0; i < end; i++) {
      const j = (i + 1) % n, o0 = outer[i], o1 = outer[j], i0 = inner[i], i1 = inner[j]
      this.face(m, [q(o0, z1), q(o1, z1), q(i1, z1), q(i0, z1)], col, q(i0, z1 - 1))
      this.face(m, [q(o0, z0), q(o1, z0), q(i1, z0), q(i0, z0)], col, q(i0, z0 + 1))
      this.face(m, [q(o0, z0), q(o1, z0), q(o1, z1), q(o0, z1)], col, q(i0, (z0 + z1) / 2))
      this.face(m, [q(i0, z0), q(i1, z0), q(i1, z1), q(i0, z1)], col, q(o0, (z0 + z1) / 2))
    }
  }
  /** A flat panel in the local x/y plane at z, facing +z (or -z with back). */
  fill2(m: Mat, pts: P2[], z: number, col: Col, back = false) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
    this.face(m, pts.map((p) => this.w(p[0], p[1], z)), col, this.w(cx, cy, back ? z + 1 : z - 1))
  }
}

// ---------- outlines ----------
/** Equilateral pointed arch: up the left jamb, over the apex, down the right jamb. */
export const lancet = (w: number, hs: number, n = 7): P2[] => {
  const pts: P2[] = [[-w / 2, 0], [-w / 2, hs]]
  for (let i = 1; i <= n; i++) { const a = Math.PI - (i / n) * (Math.PI / 3); pts.push([w / 2 + w * Math.cos(a), hs + w * Math.sin(a)]) }
  for (let i = 1; i <= n; i++) { const a = Math.PI / 3 - (i / n) * (Math.PI / 3); pts.push([-w / 2 + w * Math.cos(a), hs + w * Math.sin(a)]) }
  pts.push([w / 2, 0])
  return pts
}
const roundArc = (r: number, cy: number, n = 12, cx = 0): P2[] => Array.from({ length: n + 1 }, (_, i) => { const a = Math.PI - (i / n) * Math.PI; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P2 })
const circle = (r: number, n: number, cx = 0, cy = 0): P2[] => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P2 })

const JEWEL = ['#1d3b8a', '#8a1d2a', '#1d6a3a', '#b08a20', '#4a2a7a', '#2a6a8a']
const IRON = lin('#2a2a2c'), GOLD = lin('#c9a24a')

/** A roof plane (deck only): eave corner e, unit a along the eave, unit s up the slope, insets per metre of slope. */
function roofPlane(b: Builder, e: V, a: V, s: V, la: number, ls: number, kl: number, kr: number, col: Col) {
  const P = (u: number, v: number) => add(add(e, a, u), s, v), top = la - (kl + kr) * ls
  const pts = top > 0.01 ? [P(0, 0), P(la, 0), P(la - kr * ls, ls), P(kl * ls, ls)] : [P(0, 0), P(la, 0), P(la / 2, ls)]
  let n = norm(cross(a, s)); if (n[1] < 0) n = [-n[0], -n[1], -n[2]]
  b.face('roof', pts.map((p) => b.w(...p)), col, b.w(...add(pts[0], n, -1)))
  b.face('roof', pts.map((p) => b.w(...add(p, n, -0.15))), mix(col, [0, 0, 0], 0.5), b.w(...add(pts[0], n, 1)))
}
/** Ridge or hip cap from p to q (local). */
function capLine(b: Builder, p: V, q: V, col: Col) { b.beam('roof', p, q, 0.5, 0.35, [0, 1, 0], col, true) }

// ---------- church ----------
/** A gothic cathedral (scale 1: spires 79 m; Cologne is about scale 2): twin-towered west front with spires, portal, rose window; nave, aisles, flying buttresses, apse. */
export function cathedral(b: Builder, x: number, y: number, z: number, yaw: number, scale: number, seed: number, stone?: Col) {
  const R = rng(seed)
  b.frame(x, y, z, yaw, scale)
  const S = stone ?? lin('#cfc6b2'), S2 = lin('#bdb39e'), SL = lin('#566069'), Z: V = [0, 0, 1], X: V = [1, 0, 0]
  const st = () => jit(S, R, 0.08)
  const glassC = () => lin(JEWEL[Math.floor(R() * JEWEL.length)])
  const nw = 6.5, aw = 6, ts = 9, L = 62, hA = 12, hN = 26, hT = 48, pitch = 55 * DEG, zT = -ts, zE = -L
  const yR = hN + nw * Math.tan(pitch)
  b.box('stone', -nw - aw - 3, -25, zE - nw - 1.5, nw + aw + 3, 0.4, 1.2, S2)
  b.box('stone', -nw, 0.4, zE, nw, hN, 0, S)
  for (const sd of [-1, 1]) {
    const xi = sd * nw, xo = sd * (nw + aw)
    b.box('stone', Math.min(xi, xo), 0.4, zE + 0.01, Math.max(xi, xo), hA, zT, S)
    // towers with corner buttresses, belfry openings, parapet, pinnacles and spire
    const t0 = sd * nw, t1 = sd * (nw + ts), tc = (t0 + t1) / 2
    b.box('stone', Math.min(t0, t1), 0.4, zT, Math.max(t0, t1), hT, 0.6, S)
    for (const [bx, tiers] of [[t1, [[16, 1.8], [32, 1.3], [44, 0.9]]], [tc - sd * ts * 0.5 + sd * 0.8, [[16, 1.8], [32, 1.3], [44, 0.9]]]] as const) {
      for (const [hgt, dep] of tiers) {
        b.box('stone', bx - 0.8, 0.4, 0.6, bx + 0.8, hgt, 0.6 + dep, st())
        b.prism('stone', [[0.6, hgt], [0.6 + dep, hgt], [0.6, hgt + dep * 0.8]], 'x', bx - 0.8, bx + 0.8, st())
      }
    }
    for (const [hgt, dep] of [[16, 1.8], [32, 1.3], [44, 0.9]]) {
      b.box('stone', Math.min(t1, t1 + sd * dep), 0.4, -0.2, Math.max(t1, t1 + sd * dep), hgt, 1.4, st())
      b.box('stone', Math.min(t1, t1 + sd * dep), 0.4, zT - 0.8, Math.max(t1, t1 + sd * dep), hgt, zT + 0.8, st())
    }
    b.within(tc, 0, 0.6, 0, () => {
      for (const y of [11, 21]) lancetWindow(b, 1.6, 3.2, y, 0.5, glassC, S, false)
      for (const dx of [-1.6, 1.6]) belfry(b, dx, 31, S, IRON)
    })
    b.within(t1, 0, (zT + 0.6) / 2, sd * Math.PI / 2, () => { lancetWindow(b, 1.6, 3.2, 21, 0.5, glassC, S, false); for (const dx of [-1.6, 1.6]) belfry(b, dx, 31, S, IRON) })
    for (let k = 0; k <= 14; k++) { // parapet blocks
      const u = Math.min(t0, t1) + (k / 14) * ts
      b.box('stone', u - 0.18, hT, 0.3, u + 0.18, hT + 0.9, 0.7, st()); b.box('stone', u - 0.18, hT, zT - 0.1, u + 0.18, hT + 0.9, zT + 0.3, st())
      const v = zT + (k / 14) * (ts + 0.6)
      b.box('stone', t1 - sd * 0.2 - 0.2, hT, v - 0.18, t1 - sd * 0.2 + 0.2, hT + 0.9, v + 0.18, st())
    }
    b.box('stone', Math.min(t0, t1) - 0.2, hT - 0.5, zT - 0.2, Math.max(t0, t1) + 0.2, hT, 0.8, S2)
    for (const [px, pz] of [[t0 + sd * 0.6, -0.1], [t1 - sd * 0.6, -0.1], [t1 - sd * 0.6, zT + 0.6], [t0 + sd * 0.6, zT + 0.6]]) pinnacle(b, px, hT, pz, 0.6, 5.5, S)
    const sz = (zT + 0.6) / 2
    b.cyl('stone', tc, hT, sz, 3.9, 3.9, 1.2, 8, S2)
    b.pyr('stone', tc, hT + 1.2, sz, 4.1, 30, 8, st())
    for (let e = 0; e < 8; e++) { // crockets up the spire's edges
      const a = Math.PI / 8 + (e / 8) * Math.PI * 2
      for (let t = 0.08; t < 0.9; t += 0.07) {
        const r = 4.1 * (1 - t), y = hT + 1.2 + 30 * t
        b.box('stone', tc + r * Math.cos(a) - 0.18, y, sz + r * Math.sin(a) - 0.18, tc + r * Math.cos(a) + 0.18, y + 0.3, sz + r * Math.sin(a) + 0.18, S)
      }
    }
    b.box('metal', tc - 0.06, hT + 31, sz - 0.06, tc + 0.06, hT + 34, sz + 0.06, IRON); b.box('metal', tc - 0.7, hT + 32.6, sz - 0.05, tc + 0.7, hT + 32.75, sz + 0.05, IRON)

    // aisle bays: windows, buttresses with pinnacles and gargoyles, flying buttresses, clerestory
    const nb = 7, bay = (zT - (zE + 2)) / nb
    for (let k = 0; k <= nb; k++) {
      const zc = zT - k * bay
      if (k < nb) {
        const zw = zc - bay / 2
        b.within(xo, 0, zw, sd * Math.PI / 2, () => lancetWindow(b, 2.4, 4.6, 2.8, 0.45, glassC, S, true))
        b.within(xi, 0, zw, sd * Math.PI / 2, () => lancetWindow(b, 2.8, 5, hA + 3.6, 0.45, glassC, S, true))
      }
      const bo = xo + sd * 2.4
      b.box('stone', Math.min(xo, bo), 0.4, zc - 0.7, Math.max(xo, bo), 9, zc + 0.7, st())
      b.box('stone', Math.min(xo, xo + sd * 1.7), 0.4, zc - 0.6, Math.max(xo, xo + sd * 1.7), 13, zc + 0.6, st())
      b.prism('stone', [[xo, 9], [bo, 9], [xo, 10.6]], 'x', zc - 0.7, zc + 0.7, st())
      b.within(xo + sd * 0.85, 0, zc, 0, () => pinnacle(b, 0, 13, 0, 0.6, 4.5, S))
      b.box('stone', Math.min(xo + sd * 1.7, xo + sd * 2.9), 11.4, zc - 0.15, Math.max(xo + sd * 1.7, xo + sd * 2.9), 11.8, zc + 0.15, S2)
      for (const [ya, yb] of [[13.2, hN - 4.5], [15.6, hN - 1.6]]) b.beam('stone', [xo + sd * 0.85, ya, zc], [xi, yb, zc], 0.7, 0.8, Z, st(), true)
    }
    // parapets and string courses
    for (let zz = zT - 0.3; zz > zE + 0.3; zz -= 0.7) {
      b.box('stone', xi - sd * 0.4 - 0.2, hN, zz - 0.15, xi - sd * 0.4 + 0.2, hN + 0.9, zz + 0.15, st())
      b.box('stone', xo - sd * 0.3 - 0.18, hA, zz - 0.15, xo - sd * 0.3 + 0.18, hA + 0.7, zz + 0.15, st())
    }
    b.box('stone', Math.min(xi, xi + sd * 0.25), hN - 0.4, zE, Math.max(xi, xi + sd * 0.25), hN, zT, S2)
    // roofs: nave (slate) and the aisle lean-tos
    const o = 0.4, ls = (nw + o) / Math.cos(pitch), drop = o * Math.tan(pitch)
    if (sd > 0) roofPlane(b, [nw + o, hN - drop, 0.2], [0, 0, -1], [-Math.cos(pitch), Math.sin(pitch), 0], -zE + 0.2, ls, 0, 0, SL)
    else roofPlane(b, [-nw - o, hN - drop, zE], [0, 0, 1], [Math.cos(pitch), Math.sin(pitch), 0], -zE + 0.2, ls, 0, 0, SL)
    const ap = 24 * DEG, als = (aw + 0.5) / Math.cos(ap)
    if (sd > 0) roofPlane(b, [xo + 0.5, hA - 0.1, zT], [0, 0, -1], [-Math.cos(ap), Math.sin(ap), 0], zT - (zE + 0.01), als, 0, 0, SL)
    else roofPlane(b, [xo - 0.5, hA - 0.1, zE + 0.01], [0, 0, 1], [Math.cos(ap), Math.sin(ap), 0], zT - (zE + 0.01), als, 0, 0, SL)
  }
  capLine(b, [0, yR + 0.05, 0.2], [0, yR + 0.05, zE], mix(SL, [0, 0, 0], 0.2))
  for (let zz = -3; zz > zE; zz -= 2.5) b.pyr('metal', 0, yR + 0.1, zz, 0.12, 0.7, 4, IRON)

  // west front: porch with stepped archivolts, doors, tympanum, gable; rose window; gallery; nave gable
  const pw = 8.4, pd = 2.4, ps = 4.6
  const arcs = [7.6, 6.8, 6.0, 5.2, 4.4]
  for (let k = 0; k < arcs.length - 1; k++) b.ring2('stone', lancet(arcs[k], ps), lancet(arcs[k + 1], ps), 0, pd - k * 0.45, k % 2 ? S2 : S)
  const outer = lancet(arcs[0], ps), apex = outer[8][1]
  for (const sd of [-1, 1]) {
    b.box('stone', sd < 0 ? -pw / 2 : arcs[0] / 2, 0.4, 0, sd < 0 ? -arcs[0] / 2 : pw / 2, apex + 0.6, pd, S)
    const half = sd < 0 ? outer.slice(1, 9) : outer.slice(8, 16).reverse()
    b.prism('stone', [[sd * arcs[0] / 2, apex + 0.6], ...half], 'z', 0, pd, S)
    pinnacle(b, sd * (pw / 2 - 0.4), apex + 0.6, pd - 0.4, 0.55, 5, S)
  }
  b.box('stone', -pw / 2, apex, 0, pw / 2, apex + 0.6, pd, S2)
  b.prism('stone', [[-pw / 2, apex + 0.6], [pw / 2, apex + 0.6], [0, apex + 5.8]], 'z', pd - 0.6, pd - 0.1, S)
  b.ring2('stone', circle(1.2, 16, 0, apex + 2.4), circle(0.9, 16, 0, apex + 2.4), pd - 0.1, pd + 0.05, S2, true)
  const inner = lancet(arcs[arcs.length - 1], ps)
  b.fill2('stone', inner.slice(1, -1), 0.02, S2)
  for (const sd of [-1, 1]) b.box('roof', sd < 0 ? -2.15 : 0.18, 0.4, 0.03, sd < 0 ? -0.18 : 2.15, ps, 0.12, lin('#4a3020'))
  for (let y = 1; y < ps; y += 0.8) b.box('metal', -2.1, y, 0.12, 2.1, y + 0.07, 0.15, IRON)
  b.box('stone', -0.2, 0.4, 0, 0.2, ps, 0.5, S)
  for (let k = 0; k < 7; k++) { const t = (k + 0.5) / 7, x = -2 + 4 * t; b.box('stone', x - 0.15, ps + 0.3, 0.05, x + 0.15, ps + 1.4, 0.35, S); b.ico('stone', x, ps + 1.6, 0.2, 0.14, 0.17, 0.14, S) }
  // rose window
  const ry = 18.5, rr = 4.6
  b.ring2('stone', circle(rr + 0.7, 48, 0, ry), circle(rr, 48, 0, ry), 0, 0.7, S, true)
  b.ring2('stone', circle(1.1, 20, 0, ry), circle(0.7, 20, 0, ry), 0, 0.45, S, true)
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    b.beam('stone', [Math.cos(a) * 1.05, ry + Math.sin(a) * 1.05, 0], [Math.cos(a) * rr, ry + Math.sin(a) * rr, 0], 0.18, 0.4, Z, S)
    const pa = a + Math.PI / 12
    b.ring2('stone', circle(0.78, 14, Math.cos(pa) * 3.1, ry + Math.sin(pa) * 3.1), circle(0.6, 14, Math.cos(pa) * 3.1, ry + Math.sin(pa) * 3.1), 0, 0.35, S, true)
    for (const [r0, r1] of [[0.7, 2.2], [2.2, rr]]) b.fill2('stained', [[Math.cos(a) * r0, ry + Math.sin(a) * r0], [Math.cos(a) * r1, ry + Math.sin(a) * r1], [Math.cos(a + Math.PI / 6) * r1, ry + Math.sin(a + Math.PI / 6) * r1], [Math.cos(a + Math.PI / 6) * r0, ry + Math.sin(a + Math.PI / 6) * r0]], 0.03, glassC())
  }
  b.fill2('stained', circle(0.7, 12, 0, ry), 0.03, lin('#b08a20'))
  b.box('stone', -nw, 11.6, 0, nw, 12.2, 0.5, S2)
  // gallery of little arches
  b.box('stone', -nw, 24.2, 0, nw, 24.6, 0.9, S2)
  for (let k = 0; k < 9; k++) {
    const x = -nw + 0.7 + (k * (2 * nw - 1.4)) / 8
    b.within(x, 24.6, 0.2, 0, () => { b.ring2('stone', lancet(1.15, 1.4), lancet(0.85, 1.4), 0, 0.5, S); b.fill2('dark', lancet(0.85, 1.4).slice(1, -1), 0.02, [0.03, 0.03, 0.03]) })
    b.cyl('stone', x + 0.65, 24.6, 0.55, 0.11, 0.11, 1.4, 8, S)
  }
  b.box('stone', -nw, hN - 0.4, 0, nw, hN, 0.9, S2)
  b.prism('stone', [[-nw, hN], [nw, hN], [0, yR]], 'z', -0.6, 0.4, S)
  for (const sd of [-1, 1]) {
    b.beam('stone', [sd * nw, hN, 0.4], [0, yR + 0.3, 0.4], 0.5, 0.25, Z, S2)
    for (let t = 0.1; t < 0.95; t += 0.12) b.box('stone', sd * nw * (1 - t) - 0.15, hN + (yR - hN) * t + 0.15, 0.4, sd * nw * (1 - t) + 0.15, hN + (yR - hN) * t + 0.5, 0.7, S)
  }
  b.ico('stone', 0, yR + 1.1, 0.2, 0.4, 0.8, 0.4, S); b.box('metal', -0.05, yR + 1.8, 0.15, 0.05, yR + 3.2, 0.25, IRON); b.box('metal', -0.45, yR + 2.6, 0.15, 0.45, yR + 2.72, 0.25, IRON)
  b.within(0, 0, 0.4, 0, () => { b.ring2('stone', lancet(2.2, 1.6, 6).map(([u, v]) => [u, v + yR - 7.5] as P2), lancet(1.6, 1.6, 6).map(([u, v]) => [u, v + yR - 7.5] as P2), 0, 0.35, S); b.fill2('dark', lancet(1.6, 1.6, 6).slice(1, -1).map(([u, v]) => [u, v + yR - 7.5] as P2), 0.02, [0.03, 0.03, 0.03]) })

  // apse: half a decagon of tall windows and buttresses, with a conical roof
  const n = 5, ar = nw
  const ap: P2[] = Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI; return [ar * Math.cos(a), zE - ar * Math.sin(a)] as P2 })
  for (let i = 0; i < n; i++) {
    const [ax, az] = ap[i], [bx, bz] = ap[i + 1], mx = (ax + bx) / 2, mz = (az + bz) / 2, seg = Math.hypot(bx - ax, bz - az)
    const yaw = Math.atan2(mx, mz - zE)
    b.within(mx, 0, mz, yaw, () => {
      b.box('stone', -seg / 2 - 0.05, 0.4, -1, seg / 2 + 0.05, hN, 0, S)
      lancetWindow(b, seg * 0.5, 13, 5, 0.5, glassC, S, true)
      b.box('stone', -seg / 2, hN - 0.4, 0, seg / 2, hN, 0.3, S2)
    })
    b.face('roof', [b.w(ax * 1.07, hN - 0.3, zE + (az - zE) * 1.07), b.w(bx * 1.07, hN - 0.3, zE + (bz - zE) * 1.07), b.w(0, yR, zE)], SL, b.w(0, hN, zE))
  }
  for (let i = 1; i < n; i++) {
    const [ax, az] = ap[i], yaw = Math.atan2(ax, az - zE)
    b.within(ax, 0, az, yaw, () => { b.box('stone', -0.7, 0.4, 0, 0.7, 18, 2.6, st()); b.prism('stone', [[0, 18], [2.6, 18], [0, 20.5]], 'x', -0.7, 0.7, st()); pinnacle(b, 0, 18, 0.7, 0.55, 4, S) })
  }
  // crossing flèche
  const fz = zE + 14
  b.cyl('roof', 0, yR - 1, fz, 1.5, 1.5, 4.5, 8, SL)
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.box('stone', 1.45 * Math.cos(a) - 0.12, yR + 1, fz + 1.45 * Math.sin(a) - 0.12, 1.45 * Math.cos(a) + 0.12, yR + 3.3, fz + 1.45 * Math.sin(a) + 0.12, S) }
  b.pyr('roof', 0, yR + 3.5, fz, 1.7, 15, 8, SL)
  b.box('metal', -0.05, yR + 18.4, fz - 0.05, 0.05, yR + 20.5, fz + 0.05, IRON)
  void X
}
function pinnacle(b: Builder, x: number, y: number, z: number, r: number, h: number, c: Col) {
  b.box('stone', x - r, y, z - r, x + r, y + h * 0.42, z + r, c)
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) b.prism('stone', dz ? [[x - r * 0.6, y + h * 0.42], [x + r * 0.6, y + h * 0.42], [x, y + h * 0.58]] : [[z - r * 0.6, y + h * 0.42], [z + r * 0.6, y + h * 0.42], [z, y + h * 0.58]], dz ? 'z' : 'x', dz ? z + dz * r - 0.06 : x + dx * r - 0.06, dz ? z + dz * r + 0.06 : x + dx * r + 0.06, c)
  b.pyr('stone', x, y + h * 0.42, z, r * 0.95, h * 0.58, 4, c)
  for (let t = 0.2; t < 0.9; t += 0.22) { const rr = r * 0.95 * (1 - t), yy = y + h * 0.42 + h * 0.58 * t; for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.box('stone', x + dx * rr * 0.7 - 0.07, yy, z + dz * rr * 0.7 - 0.07, x + dx * rr * 0.7 + 0.07, yy + 0.16, z + dz * rr * 0.7 + 0.07, c) }
  b.ico('stone', x, y + h + 0.05, z, r * 0.25, r * 0.35, r * 0.25, c)
}
/** A traceried lancet on the local z = 0 face: mouldings, glass, mullion, two sub-arches and an oculus. */
function lancetWindow(b: Builder, w: number, hs: number, y0: number, dep: number, glassC: () => Col, S: Col, tracery: boolean) {
  const at = (p: P2[]) => p.map(([u, v]) => [u, v + y0] as P2)
  b.ring2('stone', at(lancet(w + 0.6, hs)), at(lancet(w + 0.2, hs)), 0, dep, S)
  b.ring2('stone', at(lancet(w + 0.2, hs)), at(lancet(w, hs)), 0, dep * 0.6, mix(S, [0, 0, 0], 0.08))
  const g = at(lancet(w, hs)).slice(1, -1)
  b.fill2('stained', g, 0.03, glassC())
  b.box('stone', -w / 2 - 0.4, y0 - 0.25, 0, w / 2 + 0.4, y0, dep + 0.15, S)
  if (!tracery) return
  b.box('stone', -0.08, y0, 0, 0.08, y0 + hs + w * 0.1, dep * 0.5, S)
  const sw = w / 2 - 0.12
  for (const sd of [-1, 1]) b.ring2('stone', at(lancet(sw, hs).map(([u, v]) => [u + sd * (sw / 2 + 0.06), v] as P2)), at(lancet(sw - 0.14, hs).map(([u, v]) => [u + sd * (sw / 2 + 0.06), v] as P2)), 0, dep * 0.5, S)
  b.ring2('stone', circle(w * 0.24, 16, 0, y0 + hs + w * 0.5), circle(w * 0.17, 16, 0, y0 + hs + w * 0.5), 0, dep * 0.5, S, true)
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; b.beam('stone', [Math.cos(a) * w * 0.05, y0 + hs + w * 0.5 + Math.sin(a) * w * 0.05, 0], [Math.cos(a) * w * 0.2, y0 + hs + w * 0.5 + Math.sin(a) * w * 0.2, 0], 0.07, dep * 0.4, [0, 0, 1], S) }
  for (let t = 1; t < 5; t++) b.box('metal', -w / 2, y0 + (hs * t) / 5, 0.03, w / 2, y0 + (hs * t) / 5 + 0.03, 0.06, IRON)
}
function belfry(b: Builder, x: number, y0: number, S: Col, iron: Col) {
  const w = 1.7, hs = 6
  b.within(x, 0, 0, 0, () => {
    b.ring2('stone', lancet(w + 0.6, hs).map(([u, v]) => [u, v + y0] as P2), lancet(w, hs).map(([u, v]) => [u, v + y0] as P2), 0, 0.6, S)
    b.fill2('dark', lancet(w, hs).slice(1, -1).map(([u, v]) => [u, v + y0] as P2), -0.3, [0.02, 0.02, 0.02])
    for (let y = y0 + 0.3; y < y0 + hs + 0.8; y += 0.45) b.beam('roof', [-w / 2, y, -0.1], [w / 2, y, -0.1], 0.08, 0.35, [0, -0.6, 0.8], mix(iron, [0.2, 0.15, 0.1], 0.6))
  })
}


// ---------- plaza furniture ----------
function fountain(b: Builder, x: number, y: number, z: number, scale = 1) {
  b.frame(x, y, z, 0, scale)
  const S = lin('#c4b9a2'), r = 3.2
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, c = Math.cos(a), s = Math.sin(a), len = 2 * r * Math.tan(Math.PI / 8) + 0.05
    b.within(c * r, 0, s * r, Math.atan2(c, s), () => { b.box('stone', -len / 2, 0, -0.35, len / 2, 0.75, 0, S); b.box('stone', -len / 2 - 0.02, 0.75, -0.42, len / 2 + 0.02, 0.85, 0.06, mix(S, [0, 0, 0], 0.1)) })
  }
  b.cyl('water', 0, 0.55, 0, r - 0.3, r - 0.3, 0.01, 24, lin('#3a5a5a'))
  b.cyl('stone', 0, 0, 0, 0.5, 0.42, 2.4, 16, S)
  b.cyl('stone', 0, 2.4, 0, 0.3, 1.25, 0.35, 20, S)
  b.cyl('water', 0, 2.7, 0, 1.1, 1.1, 0.02, 20, lin('#3a5a5a'))
  b.cyl('stone', 0, 2.7, 0, 0.22, 0.18, 1.1, 12, S)
  b.ico('stone', 0, 4.0, 0, 0.32, 0.4, 0.32, S)
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; b.cyl('metal', Math.cos(a) * 0.35, 1.9, Math.sin(a) * 0.35, 0.04, 0.04, 0.3, 6, lin('#5a6a5a')) }
}

// ---------- statues ----------
export const MARBLE = lin('#e8e2d6'), BRONZE = lin('#5f8a78')
/** A robed figure `h` tall standing at local (x, y, z) facing local +z (turned by yaw), on a plinth if `plinth`. */
export function statue(b: Builder, x: number, y: number, z: number, yaw: number, h: number, seed: number, col: Col = MARBLE, plinth = true) {
  const R = rng(seed), m: Mat = col === BRONZE ? 'metal' : 'stone'
  b.within(x, y, z, yaw, () => {
    let y0 = 0
    if (plinth) {
      const p = h * 0.38
      b.box('stone', -p * 0.62, 0, -p * 0.62, p * 0.62, p * 0.18, p * 0.62, lin('#bdb5a4'))
      b.box('stone', -p * 0.5, p * 0.18, -p * 0.5, p * 0.5, p * 0.9, p * 0.5, lin('#cfc8b8'))
      b.box('stone', -p * 0.58, p * 0.9, -p * 0.58, p * 0.58, p, p * 0.58, lin('#bdb5a4'))
      y0 = p
    }
    const H = h, lean = (R() - 0.5) * 0.06 * H
    b.lathe(m, 0, y0, 0, [[0, 0], [0.2 * H, 0], [0.17 * H, 0.12 * H], [0.13 * H, 0.45 * H], [0.14 * H, 0.66 * H], [0.12 * H, 0.76 * H], [0.06 * H, 0.8 * H], [0, 0.82 * H]], 12, col)
    b.cyl(m, lean * 0.3, y0 + 0.8 * H, 0, 0.035 * H, 0.035 * H, 0.04 * H, 8, col, false)
    b.ico(m, lean * 0.4, y0 + 0.885 * H, 0.005 * H, 0.055 * H, 0.068 * H, 0.06 * H, col)
    const pose = Math.floor(R() * 4), Z: V = [0, 0, 1]
    const arm = (sd: number, hand: V) => b.beam(m, [sd * 0.12 * H, y0 + 0.75 * H, 0], hand, 0.055 * H, 0.06 * H, Z, col, true)
    if (pose === 0) { arm(1, [0.16 * H, y0 + 1.06 * H, 0.04 * H]); arm(-1, [-0.15 * H, y0 + 0.48 * H, 0.04 * H]); b.beam('metal', [0.16 * H, y0 + 0.95 * H, 0.04 * H], [0.16 * H, y0 + 1.35 * H, 0.04 * H], 0.02 * H, 0.02 * H, Z, GOLD, true) } // raised sword
    else if (pose === 1) { arm(1, [0.2 * H, y0 + 0.5 * H, 0.12 * H]); arm(-1, [-0.14 * H, y0 + 0.5 * H, 0.03 * H]); b.beam(m, [0.21 * H, y0 + 0.02 * H, 0.13 * H], [0.21 * H, y0 + 1.05 * H, 0.13 * H], 0.025 * H, 0.025 * H, Z, col, true) } // staff
    else if (pose === 2) { arm(1, [0.06 * H, y0 + 0.62 * H, 0.15 * H]); arm(-1, [-0.06 * H, y0 + 0.62 * H, 0.15 * H]); b.box(m, -0.08 * H, y0 + 0.6 * H, 0.1 * H, 0.08 * H, y0 + 0.7 * H, 0.17 * H, col) } // book
    else { arm(1, [0.32 * H, y0 + 0.92 * H, 0.08 * H]); arm(-1, [-0.32 * H, y0 + 0.92 * H, 0.08 * H]) } // arms raised
  })
}

// ---------- arcades: bridges and aqueducts ----------
export interface ArcadeOpts { width: number; span: number; deckT: number; aqueduct?: boolean; statues?: boolean; towers?: boolean; col: Col; seed: number }
/**
 * Stacked arches from world (ax, az) at deck height ha to (bx, bz) at hb. Piers reach down to `ground`; extra tiers of
 * arches are added under the deck wherever the valley is deep, Roman style.
 */
export function arcade(b: Builder, ax: number, az: number, ha: number, bx: number, bz: number, hb: number, ground: (x: number, z: number) => number, o: ArcadeOpts) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz)
  if (L < 1) return
  b.frame(ax, 0, az, Math.atan2(-dz, dx))
  const W = o.width, n = Math.max(1, Math.round(L / o.span)), s = L / n, pw = Math.max(2.5, s * 0.17), r = (s - pw) / 2
  const deck = (u: number) => ha + ((hb - ha) * u) / L, C = o.col, C2 = mix(C, [0, 0, 0], 0.12), R = rng(o.seed)
  const gAt = (u: number, half = pw / 2) => { let g = Infinity; for (const du of [-half, 0, half]) for (const dw of [-W / 2, W / 2]) { const p = b.w(u + du, 0, dw); g = Math.min(g, ground(p[0], p[2])) } return g }
  const gs = Array.from({ length: n + 1 }, (_, i) => gAt(i * s))
  const band = Math.max(1.2, r * 0.12), legs = r * 0.55, Z: V = [0, 0, 1]
  for (let i = 0; i <= n; i++) { // piers, battered at the foot
    const u = i * s, top = deck(u) - o.deckT, g = gs[i] - 4
    if (top <= g + 1) continue
    const mid = g + (top - g) * 0.45
    b.box('stone', u - pw / 2 - 0.6, g, -W / 2 - 1.2, u + pw / 2 + 0.6, mid, W / 2 + 1.2, C2)
    b.box('stone', u - pw / 2, mid, -W / 2, u + pw / 2, top, W / 2, C)
    b.prism('stone', [[-W / 2 - 1.2, mid], [W / 2 + 1.2, mid], [W / 2, mid + 1.5], [-W / 2, mid + 1.5]], 'x', u - pw / 2 - 0.6, u + pw / 2 + 0.6, C2)
  }
  for (let j = 0; j < n; j++) { // tiers of arches, top down
    const u0 = j * s + pw / 2, u1 = (j + 1) * s - pw / 2, uc = (u0 + u1) / 2, gLo = Math.min(gs[j], gs[j + 1]), gHi = Math.max(gs[j], gs[j + 1])
    let T = deck(uc) - o.deckT
    for (let k = 0; k < 6 && T > gLo + 2; k++) {
      const spring = T - band - r
      const arc = roundArc(r, spring, 12, uc)
      b.box('stone', u0, T - band, -W / 2, u1, T, W / 2, k ? C2 : C)
      b.prism('stone', [[u0, T - band], ...arc.slice(0, 7)], 'z', -W / 2, W / 2, C)
      b.prism('stone', [[u1, T - band], ...arc.slice(6).reverse()], 'z', -W / 2, W / 2, C)
      for (const [z0, z1] of [[W / 2, W / 2 + 0.35], [-W / 2 - 0.35, -W / 2]]) b.ring2('stone', roundArc(r + Math.max(0.6, r * 0.09), spring, 12, uc), arc, z0, z1, C2)
      if (spring - legs < gHi) break
      T = spring - legs
    }
  }
  // deck, parapets, road or water channel
  const y0 = deck(0), y1 = deck(L)
  b.beam('stone', [0, y0 - o.deckT / 2, 0], [L, y1 - o.deckT / 2, 0], o.deckT, W + 1.2, Z, C, true)
  b.beam('stone', [0, y0 - o.deckT - 0.5, 0], [L, y1 - o.deckT - 0.5, 0], 1, W + 0.6, Z, C2, true) // string course
  for (const sd of [-1, 1]) b.beam('stone', [0, y0 + 0.6, sd * (W / 2 + 0.2)], [L, y1 + 0.6, sd * (W / 2 + 0.2)], 1.2, o.aqueduct ? 0.8 : 0.5, Z, C, true)
  if (o.aqueduct) b.beam('water', [0, y0 + 0.5, 0], [L, y1 + 0.5, 0], 0.05, W - 1.4, Z, lin('#5a8a8a'), true)
  else b.beam('roof', [0, y0 + 0.03, 0], [L, y1 + 0.03, 0], 0.06, W - 0.6, Z, lin('#8a8478'), true)
  for (let i = 0; i <= n; i++) { // on each pier: a pinnacle, a lamp or a statue facing outwards
    const u = i * s, y = deck(u)
    for (const sd of [-1, 1]) {
      if (o.statues && !o.aqueduct && i % 2 === 0 && i > 0 && i < n) statue(b, u, y + 0.2, sd * (W / 2 + 0.2), sd > 0 ? 0 : Math.PI, Math.max(3.5, W * 0.28), o.seed + i * 7 + sd, MARBLE)
      else if (!o.aqueduct) { b.box('stone', u - 0.5, y, sd * (W / 2 + 0.2) - 0.5, u + 0.5, y + 1.8, sd * (W / 2 + 0.2) + 0.5, C); b.pyr('stone', u, y + 1.8, sd * (W / 2 + 0.2), 0.6, 1.4, 4, C); if (i % 2) { b.beam('metal', [u, y + 1.8, sd * (W / 2 + 0.2)], [u, y + 5, sd * (W / 2 + 0.2)], 0.15, 0.15, Z, IRON, true); b.lamp(u, y + 5.2, sd * (W / 2 + 0.2)) } }
    }
  }
  if (o.towers) for (const [u, y] of [[0, y0], [L, y1]] as const) { // gate towers at both ends
    const tw = W + 4, th = Math.max(18, W * 2.2)
    b.within(u, y, 0, Math.PI / 2, () => gateTower(b, tw, th, C, R))
  }
}
/** A square gate tower straddling the road (local z along the road), arch through it, crenellations and a spire. */
function gateTower(b: Builder, w: number, h: number, C: Col, R: () => number) {
  const d = w * 0.8, hw = w / 2, a = Math.min(w * 0.45, 6)
  b.box('stone', -hw, -6, -d / 2, -a / 2, h, d / 2, C); b.box('stone', a / 2, -6, -d / 2, hw, h, d / 2, C)
  b.prism('stone', [[-a / 2, h], ...roundArc(a / 2, a * 1.1, 10).map(([u, v]) => [u, v] as P2), [a / 2, h]], 'z', -d / 2, d / 2, C)
  for (let k = -3; k <= 3; k++) for (const sd of [-1, 1]) b.box('stone', (k * w) / 7 - w / 18, h, sd * d / 2 - 0.5, (k * w) / 7 + w / 18, h + 1.6, sd * d / 2 + 0.5, C)
  if (R() < 0.6) b.pyr('roof', 0, h, 0, Math.min(hw, d / 2) * 1.05, h * 0.7, 4, lin('#4a5560'))
  for (const sd of [-1, 1]) b.ring2('stone', lancet(w * 0.18, w * 0.35, 5).map(([u, v]) => [u, v + h * 0.6] as P2), lancet(w * 0.12, w * 0.35, 5).map(([u, v]) => [u, v + h * 0.6] as P2), sd * d / 2, sd * d / 2 + sd * 0.4, C)
}

// ---------- towers ----------
/** A tall square tower with string courses, a belfry stage, corner pinnacles and a crown (spire, dome or battlements). */
export function tower(b: Builder, x: number, y: number, z: number, yaw: number, w: number, h: number, seed: number, C: Col) {
  const R = rng(seed), crown = Math.floor(R() * 3), hw = w / 2, roof = R() < 0.5 ? lin('#4a5560') : lin('#4f7a6e')
  b.frame(x, y, z, yaw)
  b.box('stone', -hw - 1, -30, -hw - 1, hw + 1, 4, hw + 1, mix(C, [0, 0, 0], 0.1))
  b.box('stone', -hw, 4, -hw, hw, h, hw, C)
  for (let yy = 16; yy < h - 4; yy += 14) b.box('stone', -hw - 0.4, yy, -hw - 0.4, hw + 0.4, yy + 0.8, hw + 0.4, mix(C, [0, 0, 0], 0.08))
  for (let f = 0; f < 4; f++) b.within(0, 0, 0, (f * Math.PI) / 2, () => {
    for (const dx of [-w * 0.2, w * 0.2]) {
      b.ring2('stone', lancet(w * 0.22, w * 0.5, 6).map(([u, v]) => [u + dx, v + h - w * 1.1] as P2), lancet(w * 0.16, w * 0.5, 6).map(([u, v]) => [u + dx, v + h - w * 1.1] as P2), hw, hw + 0.5, C)
      b.fill2('dark', lancet(w * 0.16, w * 0.5, 6).slice(1, -1).map(([u, v]) => [u + dx, v + h - w * 1.1] as P2), hw + 0.02, [0.02, 0.02, 0.02])
    }
    b.box('stone', -hw * 0.3, 8, hw, hw * 0.3, h * 0.55, hw + 0.4, mix(C, [0, 0, 0], 0.05))
  })
  for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pinnacle(b, cx * (hw - 0.6), h, cz * (hw - 0.6), Math.max(0.6, w * 0.06), w * 0.5, C)
  if (crown === 0) b.pyr('roof', 0, h, 0, hw * 0.95, h * 0.55, 8, roof)
  else if (crown === 1) { b.cyl('stone', 0, h, 0, hw * 0.7, hw * 0.7, w * 0.5, 16, C); b.lathe('roof', 0, h + w * 0.5, 0, dome(hw * 0.75, hw * 0.9), 20, roof); b.cyl('stone', 0, h + w * 0.5 + hw * 0.9, 0, hw * 0.15, hw * 0.12, hw * 0.5, 8, C); b.ico('metal', 0, h + w * 0.5 + hw * 1.5, 0, hw * 0.1, hw * 0.12, hw * 0.1, GOLD) }
  else for (let k = -2; k <= 2; k++) for (const sd of [-1, 1]) { b.box('stone', (k * w) / 5 - w / 16, h, sd * hw - 0.4, (k * w) / 5 + w / 16, h + w * 0.12, sd * hw + 0.4, C); b.box('stone', sd * hw - 0.4, h, (k * w) / 5 - w / 16, sd * hw + 0.4, h + w * 0.12, (k * w) / 5 + w / 16, C) }
}
/** Profile of a slightly pointed dome of radius r and height h. */
const dome = (r: number, h: number): P2[] => [...Array.from({ length: 10 }, (_, i) => { const t = (i / 10) * (Math.PI / 2); return [r * Math.cos(t), h * Math.sin(t) ** 0.9] as P2 }), [0, h]]

// ---------- basilica of spires (Sagrada style) ----------
/**
 * A basilica crowned by a forest of tall parabolic spires: twelve bell towers in rows of four over three facades, four
 * evangelist towers and one great central tower (scale 1: 172 m), with tall nave windows and cave-like portals.
 */
export function basilica(b: Builder, x: number, y: number, z: number, yaw: number, scale: number, seed: number, C: Col) {
  const R = rng(seed), C2 = mix(C, lin('#8a7a60'), 0.35), hue = [lin('#c8463a'), lin('#e8c84a'), lin('#f0ece0'), lin('#3a7ac8')]
  b.frame(x, y, z, yaw, scale)
  const nw = 22, L = 90, tx = 32, nh = 45
  b.box('stone', -tx - 10, -25, -L - 30, tx + 10, 0.5, 15, mix(C, [0, 0, 0], 0.1))
  b.box('stone', -nw, 0.5, -L, nw, nh, 0, C)
  b.box('stone', -tx, 0.5, -L * 0.62, tx, nh * 0.85, -L * 0.38, C)
  for (const sd of [-1, 1]) b.box('stone', sd > 0 ? nw : -nw - 9, 0.5, -L + 6, sd > 0 ? nw + 9 : -nw, nh * 0.55, -6, C)
  // stepped roofs with pointed lanterns along the ridge
  for (let k = 0; k < 6; k++) { const zz = -8 - k * 14; b.prism('stone', [[-nw, nh], [nw, nh], [0, nh + 16]], 'z', zz - 12, zz, C2); b.pyr('stone', 0, nh + 16, zz - 6, 2.2, 12, 8, C) }
  // nave windows: tall lancets on the sides
  for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) b.within(sd * (nw + 9), 0, -12 - k * 13, sd * Math.PI / 2, () => {
    b.ring2('stone', lancet(5, 14, 6).map(([u, v]) => [u, v + 6] as P2), lancet(4, 14, 6).map(([u, v]) => [u, v + 6] as P2), 0, 1.2, C2)
    b.fill2('stained', lancet(4, 14, 6).slice(1, -1).map(([u, v]) => [u, v + 6] as P2), 0.05, lin(JEWEL[Math.floor(R() * JEWEL.length)]))
  })
  const spire = (cx: number, cz: number, base: number, h: number, r0: number, tip: Col) => {
    const prof: P2[] = Array.from({ length: 16 }, (_, i) => { const t = i / 15; return [r0 * (1 - t) ** 0.62 * (1 + 0.05 * Math.sin(t * 40)), h * t] as P2 })
    b.lathe('stone', cx, base, cz, prof, 18, C)
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; for (let t = 0.1; t < 0.8; t += 0.06) { const rr = r0 * (1 - t) ** 0.62 + 0.15; b.box('dark', cx + Math.cos(a) * rr - 0.25, base + h * t, cz + Math.sin(a) * rr - 0.25, cx + Math.cos(a) * rr + 0.25, base + h * t + h * 0.025, cz + Math.sin(a) * rr + 0.25, [0.04, 0.035, 0.03]) } }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.ico('stone', cx + Math.cos(a) * r0 * 0.12, base + h * 0.9, cz + Math.sin(a) * r0 * 0.12, r0 * 0.09, r0 * 0.16, r0 * 0.09, hue[k % 4]) }
    b.ico('stone', cx, base + h + r0 * 0.15, cz, r0 * 0.22, r0 * 0.3, r0 * 0.22, tip)
  }
  // three facades, each with four bell towers and a portal of stacked pointed arches
  const facades: [number, number, number][] = [[0, 8, 0], [nw + 14 + 4, -L / 2, Math.PI / 2], [-(nw + 14 + 4), -L / 2, -Math.PI / 2]]
  facades.forEach(([fx, fz, fyaw], fi) => b.within(fx, 0, fz, fyaw, () => {
    for (let k = 0; k < 4; k++) { const tx2 = (k - 1.5) * 10.5, outer = k === 0 || k === 3; spire(tx2, 0, 0.5, outer ? 98 : 110 + fi * 2, 4.6, hue[(k + fi) % 4]) }
    for (let k = 0; k < 3; k++) {
      const w = 7 - k * 1.6, cx = (k - 1) * 10.5
      for (let r = 0; r < 4; r++) b.ring2('stone', lancet(w + 3 - r * 0.8, 12, 6).map(([u, v]) => [u + cx, v] as P2), lancet(w + 2.2 - r * 0.8, 12, 6).map(([u, v]) => [u + cx, v] as P2), -2 - r, 3 - r * 1.2, r % 2 ? C2 : C)
      b.fill2('dark', lancet(w - 0.6, 12, 6).slice(1, -1).map(([u, v]) => [u + cx, v] as P2), -5.5, [0.03, 0.03, 0.03])
    }
    b.prism('stone', [[-21, 26], [21, 26], [0, 58]], 'z', -4, -1, C2)
    b.ring2('stone', circle(5, 24, 0, 38), circle(3.6, 24, 0, 38), -1, 0.5, C, true)
    b.fill2('stained', circle(3.6, 24, 0, 38), -0.9, lin('#b08a20'))
  }))
  // evangelists, Mary over the apse, and the great central tower with its cross
  for (const [ex, ez] of [[-12, -L / 2 - 12], [12, -L / 2 - 12], [-12, -L / 2 + 12], [12, -L / 2 + 12]]) spire(ex, ez, nh, 90, 6.5, hue[2])
  spire(0, -L + 6, nh, 93, 7, lin('#3a7ac8'))
  spire(0, -L / 2, nh, 127, 9.5, hue[2])
  const top = nh + 127 + 9.5 * 0.45
  b.beam('stone', [0, top, -L / 2], [0, top + 14, -L / 2], 2, 2, [0, 0, 1], lin('#f0ece0'), true)
  for (const a of [0, Math.PI / 2]) b.within(0, 0, -L / 2, a, () => b.beam('stone', [-5, top + 9, 0], [5, top + 9, 0], 1.6, 1.6, [0, 0, 1], lin('#f0ece0'), true))
  // apse ring of small chapels
  for (let k = 0; k < 7; k++) { const a = Math.PI + (k / 6) * Math.PI, cx = Math.cos(a) * (nw + 2), cz = -L + Math.sin(a) * 16; b.cyl('stone', cx, 0.5, cz, 5, 5, 24, 16, C); b.pyr('stone', cx, 24.5, cz, 5, 14, 8, C2) }
}

// ---------- colonnade plaza (St Peter's style) ----------
/**
 * An oval plaza embraced by two curved colonnades four columns deep, with a balustrade of statues on top, an obelisk in
 * the middle and two fountains. Local +z is the open side; the plaza is `a` metres in half-width.
 */
export function colonnade(b: Builder, x: number, y: number, z: number, yaw: number, a: number, seed: number, C: Col) {
  const c = a * 0.82, rows = 4, gap = 4.4, colH = 13, colR = 0.8, C2 = mix(C, [0, 0, 0], 0.1)
  b.frame(x, y, z, yaw)
  b.cyl('stone', 0, -30, 0, a + 4 * gap + 6, a + 4 * gap + 6, 30.15, 48, lin('#b8b0a0'))
  b.box('stone', -a - 30, -30, -c - 50, a + 30, 0.15, -c + 2, lin('#b8b0a0'))
  for (let k = 0; k < 16; k++) { const t = (k / 16) * Math.PI * 2; b.beam('stone', [0, 0.17, 0], [Math.cos(t) * a * 0.95, 0.17, Math.sin(t) * c * 0.95], 0.7, 0.04, [0, 1, 0], lin('#d8d0bc'), true) }
  const R = rng(seed)
  for (const sd of [-1, 1]) {
    const t0 = sd > 0 ? -1.15 : Math.PI - 1.15, t1 = sd > 0 ? 1.15 : Math.PI + 1.15
    const P = (t: number, off: number): P2 => [Math.cos(t) * (a + off), Math.sin(t) * (c + off)]
    const len = (t1 - t0) * (a + c) / 2, nCol = Math.round(len / 4.6)
    for (let r = 0; r < rows; r++) for (let i = 0; i <= nCol; i++) {
      const t = t0 + ((t1 - t0) * i) / nCol, [px, pz] = P(t, r * gap)
      b.box('stone', px - 1.1, 0.15, pz - 1.1, px + 1.1, 1, pz + 1.1, C2)
      b.cyl('stone', px, 1, pz, colR, colR * 0.86, colH - 2, 14, C)
      b.box('stone', px - 1.1, colH - 1, pz - 1.1, px + 1.1, colH, pz + 1.1, C2)
    }
    const steps = nCol * 2
    for (let i = 0; i < steps; i++) { // entablature, roof and balustrade, segment by segment along the arc
      const ta = t0 + ((t1 - t0) * i) / steps, tb = t0 + ((t1 - t0) * (i + 1)) / steps
      const quad = (o0: number, o1: number, ya: number, yb: number, m: Mat, col: Col) => {
        const p = [P(ta, o0), P(tb, o0), P(tb, o1), P(ta, o1)], cs: V[] = []
        for (let k = 0; k < 8; k++) { const q = p[[0, 1, 3, 2][k & 3]]; cs.push([q[0], k & 4 ? yb : ya, q[1]]) }
        b.hexa(m, [cs[0], cs[1], cs[2], cs[3], cs[4], cs[5], cs[6], cs[7]], col)
      }
      quad(-1.4, (rows - 1) * gap + 1.4, colH, colH + 2.6, 'stone', C)
      quad(-1.2, (rows - 1) * gap + 1.2, colH + 2.6, colH + 3.2, 'stone', C2)
      quad(-0.9, (rows - 1) * gap + 0.9, colH + 3.2, colH + 3.5, 'roof', lin('#7a7468'))
      quad(-1.2, -0.6, colH + 3.2, colH + 4.4, 'stone', C)
      quad((rows - 1) * gap + 0.6, (rows - 1) * gap + 1.2, colH + 3.2, colH + 4.4, 'stone', C)
    }
    for (let i = 0; i <= nCol; i += 2) { const t = t0 + ((t1 - t0) * i) / nCol, [px, pz] = P(t, -0.9); statue(b, px, colH + 4.4, pz, Math.atan2(-px, -pz) + Math.PI, 3.2, seed + i * 13 + sd, MARBLE, false) }
  }
  // obelisk on a pedestal with lions' blocks, and two fountains
  b.box('stone', -3.2, 0.15, -3.2, 3.2, 1.2, 3.2, C2); b.box('stone', -2.4, 1.2, -2.4, 2.4, 6, 2.4, C)
  const ob: V[] = []
  for (let k = 0; k < 8; k++) { const s2 = k & 2 ? 1.1 : 1.6; ob.push([(k & 1 ? 1 : -1) * s2, k & 2 ? 31 : 6, (k & 4 ? 1 : -1) * s2]) }
  b.hexa('stone', ob, lin('#c9b48a'))
  b.pyr('stone', 0, 31, 0, 1.1 * Math.SQRT2, 2.5, 4, lin('#c9b48a')); b.ico('metal', 0, 34, 0, 0.5, 0.5, 0.5, GOLD)
  for (const sd of [-1, 1]) fountain(b, b.w(sd * a * 0.45, 0, 0)[0], b.w(0, 0, 0)[1], b.w(sd * a * 0.45, 0, 0)[2], 1.4)
  void R
}

// ---------- domed basilica (St Peter's style) ----------
/** A Renaissance basilica: giant-columned facade with statues, long nave, and a great ribbed dome on a drum with a lantern. */
export function domeChurch(b: Builder, x: number, y: number, z: number, yaw: number, scale: number, seed: number, C: Col, roofCol: Col) {
  const R = rng(seed), C2 = mix(C, [0, 0, 0], 0.1)
  b.frame(x, y, z, yaw, scale)
  const fw = 58, fh = 46, L = 160, nw = 34, zc = -110
  b.box('stone', -fw - 10, -25, -L - 10, fw + 10, 0.4, 14, C2)
  for (let k = 0; k < 6; k++) b.box('stone', -26 + k * 0.1, 0.4 + k * 0.5, 4 + 6 - k, 26 - k * 0.1, 0.9 + k * 0.5, 14 - k, C) // steps
  b.box('stone', -fw / 2, 0.4, -6, fw / 2, fh, 0, C)
  b.box('stone', -fw / 2 - 1, fh, -6.8, fw / 2 + 1, fh + 3, 0.8, C2)
  b.box('stone', -fw / 2, fh + 3, -6, fw / 2, fh + 10, 0, C)
  for (let k = 0; k < 8; k++) { const cx = -fw / 2 + 3 + (k * (fw - 6)) / 7; b.cyl('stone', cx, 3.4, 2.2, 1.6, 1.4, fh - 4.4, 16, C); b.box('stone', cx - 2, fh - 1.4, 0, cx + 2, fh, 4.2, C2); b.box('stone', cx - 2, 0.4, 0, cx + 2, 3.4, 4.4, C2) }
  b.box('stone', -fw / 2, fh - 1, 0, fw / 2, fh, 4.2, C2)
  b.prism('stone', [[-12, fh], [12, fh], [0, fh + 9]], 'z', 0, 4.4, C)
  for (let k = 0; k < 13; k++) statue(b, -fw / 2 + 2 + (k * (fw - 4)) / 12, fh + 10, -2, 0, 5.5, seed + k * 31, MARBLE, false)
  for (let k = 0; k < 5; k++) { const cx = -20 + k * 10; b.box('dark', cx - 2, 3.4, 0.02, cx + 2, 12, 0.05, [0.03, 0.03, 0.03]); b.ring2('stone', lancet(3.2, 2, 6).map(([u, v]) => [u + cx, v + 18] as P2), lancet(2.4, 2, 6).map(([u, v]) => [u + cx, v + 18] as P2), 0, 0.6, C2) }
  b.box('stone', -nw / 2, 0.4, -L, nw / 2, fh - 4, -6, C)
  b.prism('roof', [[-nw / 2 - 1, fh - 4], [nw / 2 + 1, fh - 4], [0, fh + 6]], 'z', -L, -6, roofCol)
  for (const sd of [-1, 1]) {
    b.box('stone', sd > 0 ? nw / 2 : -nw / 2 - 14, 0.4, -L + 10, sd > 0 ? nw / 2 + 14 : -nw / 2, fh * 0.6, -14, C)
    b.box('stone', sd > 0 ? nw / 2 : -nw / 2 - 40, 0.4, zc - 22, sd > 0 ? nw / 2 + 40 : -nw / 2, fh - 4, zc + 22, C) // transepts
    b.within(sd * (nw / 2 + 44), 0, zc - 10, 0, () => { b.cyl('stone', 0, fh * 0.6, 0, 7, 7, 8, 16, C); b.lathe('roof', 0, fh * 0.6 + 8, 0, dome(7.5, 8), 16, roofCol); b.cyl('stone', 0, fh * 0.6 + 16, 0, 1.4, 1.2, 4, 8, C) })
  }
  // drum, ribbed dome and lantern over the crossing
  const dr = 21, dy = fh - 4, drumH = 22, domeH = 30
  b.box('stone', -26, dy, zc - 26, 26, dy + 8, zc + 26, C)
  b.cyl('stone', 0, dy + 8, zc, dr + 1, dr + 1, 2, 32, C2)
  b.cyl('stone', 0, dy + 10, zc, dr, dr, drumH, 32, C)
  for (let k = 0; k < 16; k++) b.within(0, 0, zc, (k / 16) * Math.PI * 2, () => {
    b.box('stone', -1.6, dy + 10, dr - 0.5, -0.4, dy + 10 + drumH, dr + 1.6, C2); b.box('stone', 0.4, dy + 10, dr - 0.5, 1.6, dy + 10 + drumH, dr + 1.6, C2)
    b.fill2('dark', [[-1.6, dy + 14], [1.6, dy + 14], [1.6, dy + 24], [0, dy + 26], [-1.6, dy + 24]], dr + 0.3, [0.04, 0.04, 0.05])
  })
  b.cyl('stone', 0, dy + 10 + drumH, zc, dr + 1.6, dr + 1.6, 2.2, 32, C2)
  const d0 = dy + 12 + drumH, prof = dome(dr + 0.6, domeH)
  b.lathe('roof', 0, d0, zc, prof, 48, roofCol)
  for (let k = 0; k < 16; k++) b.within(0, 0, zc, (k / 16) * Math.PI * 2, () => {
    for (let i = 0; i < prof.length - 2; i++) b.beam('stone', [0, d0 + prof[i][1], prof[i][0] + 0.2], [0, d0 + prof[i + 1][1], prof[i + 1][0] + 0.2], 1.2, 0.5, [1, 0, 0], C, true)
  })
  b.cyl('stone', 0, d0 + domeH - 0.5, zc, 5.5, 5.5, 9, 16, C)
  for (let k = 0; k < 16; k++) { const t = (k / 16) * Math.PI * 2; b.box('stone', Math.cos(t) * 5.5 - 0.4, d0 + domeH - 0.5, zc + Math.sin(t) * 5.5 - 0.4, Math.cos(t) * 5.5 + 0.4, d0 + domeH + 8.5, zc + Math.sin(t) * 5.5 + 0.4, C2) }
  b.lathe('roof', 0, d0 + domeH + 8.5, zc, dome(5.8, 5), 16, roofCol)
  b.ico('metal', 0, d0 + domeH + 14.5, zc, 1.2, 1.2, 1.2, GOLD)
  b.beam('metal', [0, d0 + domeH + 15, zc], [0, d0 + domeH + 20, zc], 0.5, 0.5, [0, 0, 1], GOLD, true)
  b.beam('metal', [-1.6, d0 + domeH + 18.4, zc], [1.6, d0 + domeH + 18.4, zc], 0.45, 0.45, [0, 0, 1], GOLD, true)
  void R
}

// ---------- plazas ----------
/** A round raised plaza (a podium down to `bottom`) with a balustrade, statues around the edge and a centrepiece. */
export function plaza(b: Builder, x: number, y: number, z: number, r: number, bottom: number, centre: 'fountain' | 'obelisk' | 'statue' | 'none', statues: boolean, seed: number, C: Col) {
  b.frame(x, y, z, 0)
  const C2 = mix(C, [0, 0, 0], 0.15), sides = Math.max(24, Math.round(r / 2))
  b.cyl('stone', 0, bottom - y, 0, r + 1, r, y - bottom, sides, C2, false)
  b.cyl('stone', 0, -0.2, 0, r, r, 0.35, sides, mix(C, lin('#ffffff'), 0.1))
  const nPost = Math.round((2 * Math.PI * r) / 2.2)
  for (let k = 0; k < 8; k++) { const t = (k / 8) * Math.PI * 2 + 0.2; b.cyl('metal', Math.cos(t) * (r - 1.5), 0.15, Math.sin(t) * (r - 1.5), 0.08, 0.06, 3.8, 6, IRON, false); b.lamp(Math.cos(t) * (r - 1.5), 4.1, Math.sin(t) * (r - 1.5)) }
  for (let k = 0; k < nPost; k++) { const t = (k / nPost) * Math.PI * 2; b.cyl('stone', Math.cos(t) * (r - 0.4), 0.15, Math.sin(t) * (r - 0.4), 0.16, 0.12, 0.9, 6, C, false) }
  b.cyl('stone', 0, 1.05, 0, r - 0.1, r - 0.1, 0.18, sides, C, false); b.cyl('stone', 0, 1.05, 0, r - 0.7, r - 0.7, 0.18, sides, C, false)
  if (statues) { const n = Math.max(4, Math.round((2 * Math.PI * r) / 24)); for (let k = 0; k < n; k++) { const t = (k / n) * Math.PI * 2; statue(b, Math.cos(t) * (r - 2), 0.15, Math.sin(t) * (r - 2), Math.atan2(Math.cos(t), Math.sin(t)) + Math.PI, 3.5 + (k % 3 === 0 ? 2 : 0), seed + k * 17) } }
  b.frame(x, y, z, 0)
  if (centre === 'fountain') fountain(b, x, y, z, Math.max(1, r / 25))
  else if (centre === 'obelisk') { b.box('stone', -2, 0.15, -2, 2, 3, 2, C2); const ob: V[] = []; for (let k = 0; k < 8; k++) { const s2 = k & 2 ? 0.7 : 1.1; ob.push([(k & 1 ? 1 : -1) * s2, k & 2 ? 22 : 3, (k & 4 ? 1 : -1) * s2]) } b.hexa('stone', ob, lin('#c9b48a')); b.pyr('stone', 0, 22, 0, 0.99, 1.8, 4, lin('#c9b48a')) }
  else if (centre === 'statue') statue(b, 0, 0.15, 0, 0, Math.max(6, r * 0.3), seed, BRONZE)
}

// ---------- palaces ----------
/** A courtyard palace: four wings of 3-4 storeys with rusticated ground floor, pedimented windows, cornice and
 * balustrade with urns, corner towers with domes, a columned portico and an arcaded courtyard. Front at local z = 0. */
export function palace(b: Builder, x: number, y: number, z: number, yaw: number, w: number, d: number, seed: number, C: Col, roof: Col) {
  const R = rng(seed), C2 = mix(C, [0, 0, 0], 0.12), fh = 5.5, floors = 3 + Math.floor(R() * 2), H = fh * floors, wing = 14, dark: Col = [0.03, 0.03, 0.035]
  b.frame(x, y, z, yaw)
  b.box('stone', -w / 2 - 2, -20, -d - 2, w / 2 + 2, 0.6, 3, C2)
  const facade = (len: number) => { // windows on the local z = 0 face, x from -len/2 to len/2
    const n = Math.max(3, Math.floor(len / 4.4)), bay = len / n
    for (let f = 0; f < floors; f++) {
      const y0 = 0.6 + f * fh
      if (f) b.box('stone', -len / 2, y0 - 0.25, 0, len / 2, y0 + 0.15, 0.35, C2)
      else for (let r = 1; r < 6; r++) b.box('stone', -len / 2, r * 0.9, 0, len / 2, r * 0.9 + 0.12, 0.12, C2)
      for (let k = 0; k < n; k++) {
        const cx = -len / 2 + bay * (k + 0.5), ww = Math.min(1.5, bay * 0.42), wb = y0 + (f ? 1.1 : 1.4), wt = y0 + fh - (f === 1 ? 0.9 : 1.3)
        b.fill2('dark', [[cx - ww / 2, wb], [cx + ww / 2, wb], [cx + ww / 2, wt], [cx - ww / 2, wt]], 0.03, dark)
        for (const [a, c, e, g] of [[cx - ww / 2 - 0.22, cx - ww / 2, wb, wt], [cx + ww / 2, cx + ww / 2 + 0.22, wb, wt], [cx - ww / 2 - 0.3, cx + ww / 2 + 0.3, wb - 0.25, wb]]) b.box('stone', a, e, 0, c, g, 0.18, C)
        if (f === 1) {
          if (k % 2) b.prism('stone', [[cx - ww / 2 - 0.45, wt + 0.15], [cx + ww / 2 + 0.45, wt + 0.15], [cx, wt + 0.9]], 'z', 0, 0.3, C)
          else b.ring2('stone', roundArc(ww / 2 + 0.45, wt + 0.15, 8, cx), roundArc(ww / 2 + 0.1, wt + 0.15, 8, cx), 0, 0.3, C)
          b.box('stone', cx - ww / 2 - 0.4, wb - 0.5, 0, cx + ww / 2 + 0.4, wb - 0.35, 0.7, C2)
          for (let q = 0; q < 4; q++) b.cyl('stone', cx - ww / 2 + (q + 0.5) * (ww / 4), wb - 1.15, 0.5, 0.08, 0.08, 0.65, 6, C, false)
        } else b.box('stone', cx - ww / 2 - 0.3, wt, 0, cx + ww / 2 + 0.3, wt + 0.3, 0.22, C)
      }
    }
    b.box('stone', -len / 2 - 0.3, H, -0.4, len / 2 + 0.3, H + 0.5, 0.6, C2)
    b.box('stone', -len / 2 - 0.5, H + 0.5, -0.6, len / 2 + 0.5, H + 0.9, 0.9, C)
    for (let k = 0; k < len / 0.6; k++) b.cyl('stone', -len / 2 + 0.3 + k * 0.6, H + 0.9, 0.3, 0.13, 0.1, 0.8, 6, C, false)
    b.box('stone', -len / 2, H + 1.7, 0.1, len / 2, H + 1.9, 0.5, C)
    for (let k = 0; k <= n; k += 2) b.lathe('stone', -len / 2 + bay * k, H + 1.9, 0.3, [[0, 0], [0.3, 0], [0.35, 0.4], [0.18, 0.6], [0.05, 0.8], [0, 0.85]], 8, C)
  }
  const wings: [number, number, number, number][] = [[-w / 2, -wing, w / 2, 0], [-w / 2, -d, w / 2, -d + wing], [-w / 2, -d + wing, -w / 2 + wing, -wing], [w / 2 - wing, -d + wing, w / 2, -wing]]
  for (const [x0, z0, x1, z1] of wings) b.box('stone', x0, 0.6, z0, x1, H, z1, C)
  b.within(0, 0, 0, 0, () => facade(w)); b.within(0, 0, -d, Math.PI, () => facade(w))
  b.within(w / 2, 0, -d / 2, Math.PI / 2, () => facade(d)); b.within(-w / 2, 0, -d / 2, -Math.PI / 2, () => facade(d))
  // hipped roofs over the wings
  b.prism('roof', [[-wing, H + 0.6], [0, H + 0.6], [-wing / 2, H + 6]], 'x', -w / 2, w / 2, roof)
  b.prism('roof', [[-d, H + 0.6], [-d + wing, H + 0.6], [-d + wing / 2, H + 6]], 'x', -w / 2, w / 2, roof)
  b.prism('roof', [[-w / 2, H + 0.6], [-w / 2 + wing, H + 0.6], [-w / 2 + wing / 2, H + 6]], 'z', -d + wing, -wing, roof)
  b.prism('roof', [[w / 2 - wing, H + 0.6], [w / 2, H + 0.6], [w / 2 - wing / 2, H + 6]], 'z', -d + wing, -wing, roof)
  // corner towers with domes or pyramids
  for (const [cx, cz] of [[-w / 2, 0], [w / 2, 0], [-w / 2, -d], [w / 2, -d]]) {
    b.box('stone', cx - 6, 0.6, cz - 6, cx + 6, H + 8, cz + 6, C)
    b.box('stone', cx - 6.4, H + 8, cz - 6.4, cx + 6.4, H + 8.8, cz + 6.4, C2)
    if (R() < 0.6) { b.cyl('stone', cx, H + 8.8, cz, 4.5, 4.5, 3, 16, C); b.lathe('roof', cx, H + 11.8, cz, dome(4.8, 5.5), 16, roof); b.ico('metal', cx, H + 18, cz, 0.5, 0.7, 0.5, GOLD) }
    else b.pyr('roof', cx, H + 8.8, cz, 6.6, 9, 4, roof)
  }
  // portico: steps, columns, entablature, pediment
  const pw = Math.min(26, w * 0.35)
  for (let s = 0; s < 5; s++) b.box('stone', -pw / 2 - 2 + s * 0.3, 0, 0, pw / 2 + 2 - s * 0.3, s * 0.3 + 0.9, 9 - s * 0.6, C2)
  for (let k = 0; k < 6; k++) b.cyl('stone', -pw / 2 + 1.2 + (k * (pw - 2.4)) / 5, 2.1, 6.5, 0.85, 0.72, fh * 2 - 1.5, 16, C)
  b.box('stone', -pw / 2, fh * 2 + 0.6, 0, pw / 2, fh * 2 + 2.2, 7.6, C2)
  b.prism('stone', [[-pw / 2, fh * 2 + 2.2], [pw / 2, fh * 2 + 2.2], [0, fh * 2 + 7]], 'z', 0, 7.6, C)
  b.lamp(-pw / 2 - 1, 4, 9); b.lamp(pw / 2 + 1, 4, 9)
  // courtyard arcade and garden
  const ix0 = -w / 2 + wing, ix1 = w / 2 - wing, iz0 = -d + wing, iz1 = -wing
  for (let u = ix0 + 2; u < ix1 - 1; u += 4) for (const zz of [iz0 + 2, iz1 - 2]) b.cyl('stone', u, 0.6, zz, 0.4, 0.35, 5, 10, C, false)
  for (let v = iz0 + 2; v < iz1 - 1; v += 4) for (const xx of [ix0 + 2, ix1 - 2]) b.cyl('stone', xx, 0.6, v, 0.4, 0.35, 5, 10, C, false)
  for (const [x0, z0, x1, z1] of [[ix0, iz0, ix1, iz0 + 3], [ix0, iz1 - 3, ix1, iz1], [ix0, iz0, ix0 + 3, iz1], [ix1 - 3, iz0, ix1, iz1]]) b.box('stone', x0, 5.6, z0, x1, 6.4, z1, C2)
  for (let k = 0; k < 14; k++) b.ico('leaf', lerpN(ix0 + 6, ix1 - 6, R()), 1.4, lerpN(iz0 + 6, iz1 - 6, R()), 1.2 + R(), 1 + R() * 0.8, 1.2 + R(), jit(lin('#3e5a2c'), R, 0.4))
  const fc = b.w(0, 0, (iz0 + iz1) / 2)
  fountain(b, fc[0], fc[1], fc[2], 0.7)
}
const lerpN = (a: number, c: number, t: number) => a + (c - a) * t

// ---------- monasteries ----------
/** A walled monastery: abbey church, cloister with an arcade around a garth, a long dormitory, a bell tower. */
export function monastery(b: Builder, x: number, y: number, z: number, yaw: number, seed: number, C: Col, roof: Col) {
  const C2 = mix(C, [0, 0, 0], 0.15)
  cathedral(b, x, y, z, yaw, 0.55, seed, C)
  b.frame(x, y, z, yaw)
  b.box('stone', -45, -20, -75, 50, 0.5, 8, C2)
  const cx0 = 12, cx1 = 44, cz0 = -50, cz1 = -18
  for (const [x0, z0, x1, z1] of [[cx0, cz0, cx1, cz0 + 5], [cx0, cz1 - 5, cx1, cz1], [cx0, cz0, cx0 + 5, cz1], [cx1 - 5, cz0, cx1, cz1]]) {
    b.box('stone', x0, 0.5, z0, x1, 1.2, z1, C2)
    b.box('stone', x0, 4.6, z0, x1, 5.4, z1, C)
  }
  for (let u = cx0 + 2.5; u <= cx1 - 2.5; u += 2.6) for (const zz of [cz0 + 4.6, cz1 - 4.6]) b.cyl('stone', u, 1.2, zz, 0.22, 0.2, 3.4, 8, C, false)
  for (let v = cz0 + 2.5; v <= cz1 - 2.5; v += 2.6) for (const xx of [cx0 + 4.6, cx1 - 4.6]) b.cyl('stone', xx, 1.2, v, 0.22, 0.2, 3.4, 8, C, false)
  b.prism('roof', [[cz0, 5.4], [cz0 + 5.5, 5.4], [cz0, 8]], 'x', cx0, cx1, roof)
  b.prism('roof', [[cz1 - 5.5, 5.4], [cz1, 5.4], [cz1, 8]], 'x', cx0, cx1, roof)
  b.box('stone', cx0, 0.5, cz0 - 0.5, cx1, 8, cz0, C)
  b.ico('leaf', (cx0 + cx1) / 2, 2, (cz0 + cz1) / 2, 3, 2.5, 3, lin('#3a5a2a'))
  b.box('stone', cx1, 0.5, -70, cx1 + 12, 12, -10, C)
  b.prism('roof', [[cx1, 12], [cx1 + 12, 12], [cx1 + 6, 18]], 'z', -70, -10, roof)
  b.within(cx1 + 12, 0, -40, Math.PI / 2, () => { for (let v = -26; v < 28; v += 4) for (const yy of [3, 8]) b.fill2('dark', [[v, yy], [v + 1, yy], [v + 1, yy + 2], [v, yy + 2]], 0.02, [0.03, 0.03, 0.03]) })
  const ring: P2[] = [[-45, 8], [50, 8], [50, -75], [-45, -75]]
  for (let i = 0; i < 4; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % 4], L = Math.hypot(bx - ax, bz - az)
    b.beam('stone', [ax, 3, az], [bx, 3, bz], 6, 1.6, [0, 1, 0], C2, true)
    for (let t = 1; t < L; t += 2.5) b.box('stone', ax + ((bx - ax) * t) / L - 0.5, 6, az + ((bz - az) * t) / L - 0.5, ax + ((bx - ax) * t) / L + 0.5, 7, az + ((bz - az) * t) / L + 0.5, C2)
  }
  b.lamp(0, 4, 9)
  const tp = b.w(-38, 0, -60)
  tower(b, tp[0], y, tp[2], yaw, 9, 42, seed + 3, C)
}

// ---------- city walls ----------
/** A curtain wall along world points [x, ground, z] (a few metres apart): crenellated, round towers every `every`
 * metres, gatehouses at the given point indices. */
export function cityWall(b: Builder, pts: V[], height: number, every: number, gates: number[], C: Col, roof: Col) {
  b.frame(0, 0, 0, 0)
  const C2 = mix(C, [0, 0, 0], 0.15), T = 3.6
  let run = 0, nextTower = every / 2, nT = 0
  const isGate = (i: number) => gates.some((g) => Math.abs(g - i) <= 1)
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ag, az] = pts[i], [bx, bg, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az)
    if (L < 0.01) continue
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz * (T / 2), nz = ux * (T / 2)
    if (!isGate(i) || !isGate(i + 1)) {
      const c: V[] = []
      for (let k = 0; k < 8; k++) { const e = k & 1 ? [bx, bg, bz] : [ax, ag, az], s = k & 4 ? 1 : -1; c.push([e[0] + nx * s, k & 2 ? e[1] + height : Math.min(ag, bg) - 5, e[2] + nz * s]) }
      b.hexa('stone', c, C)
      for (let t = 1.2; t < L; t += 2.4) {
        const px = ax + ux * t, pz = az + uz * t, py = ag + ((bg - ag) * t) / L + height
        b.box('stone', px - 0.6, py, pz - 0.6, px + 0.6, py + 1.5, pz + 0.6, C2)
      }
    }
    run += L
    if (run >= nextTower && !isGate(i)) {
      nextTower = run + every; nT++
      b.cyl('stone', ax, ag - 5, az, 6.5, 6, height + 11, 16, C)
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; b.box('stone', ax + Math.cos(a) * 5.6 - 0.6, ag + height + 6, az + Math.sin(a) * 5.6 - 0.6, ax + Math.cos(a) * 5.6 + 0.6, ag + height + 7.6, az + Math.sin(a) * 5.6 + 0.6, C2) }
      if (nT % 2) b.pyr('roof', ax, ag + height + 6, az, 6.8, 9, 8, roof)
    }
  }
  for (const gi of gates) {
    const p = pts[Math.max(0, Math.min(pts.length - 2, gi))], q = pts[Math.max(1, Math.min(pts.length - 1, gi + 1))], dx = q[0] - p[0], dz = q[2] - p[2]
    b.within(p[0], p[1], p[2], Math.atan2(-dz, dx) + Math.PI / 2, () => { // local z runs through the gate
      for (const s of [-1, 1]) { b.box('stone', s * 7 - 4, -5, -5, s * 7 + 4, height + 9, 5, C); b.pyr('roof', s * 7, height + 9, 0, 5.6, 7, 4, roof) }
      b.prism('stone', [[-3, height + 4], ...roundArc(3, 6, 10), [3, height + 4]], 'z', -4, 4, C)
      b.box('stone', -3.6, height + 4, -4.4, 3.6, height + 5.4, 4.4, C2)
      b.lamp(-3.5, 5, 5); b.lamp(3.5, 5, 5)
    })
  }
}

// ---------- harbours ----------
/** A lake harbour: a stone quay along the shore (local x), piers out over the water (+z), moored boats with sails and a
 * small lighthouse. y is the water level. */
export function harbour(b: Builder, x: number, y: number, z: number, yaw: number, len: number, seed: number, C: Col) {
  const R = rng(seed), C2 = mix(C, [0, 0, 0], 0.2), wood = lin('#5a4632')
  b.frame(x, y, z, yaw)
  b.box('stone', -len / 2, -8, -14, len / 2, 1.6, 0, C)
  for (let u = -len / 2 + 3; u < len / 2; u += 6) b.cyl('stone', u, 1.6, -0.6, 0.3, 0.3, 0.6, 8, C2)
  const nP = Math.max(2, Math.floor(len / 40))
  for (let k = 0; k < nP; k++) {
    const u = -len / 2 + (k + 0.5) * (len / nP), pl = 25 + R() * 35
    b.box('roof', u - 2.5, 1.0, 0, u + 2.5, 1.4, pl, wood)
    for (let v = 2; v < pl; v += 4) for (const s of [-2.3, 2.3]) b.cyl('roof', u + s, -4, v, 0.2, 0.2, 5.6, 6, wood, false)
    for (let m = 0; m < 3; m++) {
      const bv = 6 + m * 12 + R() * 4, bs = R() < 0.5 ? -1 : 1, L = 7 + R() * 6, hull = jit(lin('#4a3a2c'), R, 0.4), sail = lin(R() < 0.6 ? '#e8dcc0' : '#a84a32')
      b.within(u + bs * 5.5, 0, bv, Math.PI / 2, () => {
        b.prism('roof', [[-1.6, 1], [1.6, 1], [1.1, -0.4], [-1.1, -0.4]], 'x', -L / 2, L / 2, hull)
        b.box('roof', -L / 2 + 0.5, 1, -1.4, L / 2 - 0.5, 1.15, 1.4, mix(hull, [1, 1, 1], 0.15))
        if (R() < 0.7) {
          b.beam('roof', [0, 1, 0], [0, 1 + L * 0.9, 0], 0.18, 0.18, [0, 0, 1], wood, true)
          const sp = [b.w(0.3, 2, 0), b.w(L * 0.42, 2, 0), b.w(0.3, 1 + L * 0.8, 0)]
          b.face('cloth', sp, sail, b.w(0.3, 2, -1)); b.face('cloth', sp, sail, b.w(0.3, 2, 1))
        }
      })
    }
    if (k === nP - 1) { b.cyl('stone', u, 1.4, pl - 2, 2.2, 1.8, 14, 14, C); b.cyl('stained', u, 15.4, pl - 2, 1.4, 1.4, 2, 10, lin('#f0c060')); b.pyr('roof', u, 17.4, pl - 2, 2, 2.6, 8, lin('#4a5560')); b.lamp(u, 16.4, pl - 2) }
  }
}
