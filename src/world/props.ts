// Props: the trees, tufts, crystals and mushrooms scattered over the 3D globe. Pure data (no three.js) so the tile
// worker places them and the page only uploads buffers. Each prop is a small low-poly mesh in a unit box (x, z in
// about +-0.5, y from 0 to 1) that the shader scales, turns and plants on the ground per instance.
import type { DecorKind } from './terrains.ts'

/** Small things are placed on the fine lattice; the rest (trees and the like) on the two coarse ones. */
export const SMALL: ReadonlySet<DecorKind> = new Set(['tuft', 'bush', 'boulder', 'reed', 'cactus'])
/**
 * Props sit on fixed lattices in cube-face coordinates, so every LOD level places the same ones. A lattice cell is
 * tileSpan(ref) / m wide; a tile at level l (lo..hi) holds m * 2^(ref - l) cells per edge, so m must divide by
 * 2^(l - ref) for the deepest level. `scale` stretches the spec's sizes (far-off forests need bigger trees to read).
 */
export interface Tier { ref: number; m: number; lo: number; hi: number; scale: number; small: boolean }
export const TIERS: Tier[] = [
  { ref: 11, m: 24, lo: 10, hi: 12, scale: 5, small: false }, // ~190 m apart: seen from tens of km
  { ref: 13, m: 24, lo: 13, hi: 15, scale: 1.7, small: false }, // ~48 m apart
  { ref: 15, m: 24, lo: 14, hi: 15, scale: 1.7, small: true }, // ~12 m apart
]

export type V3 = [number, number, number]
export interface PropMesh { pos: Float32Array; col: Float32Array; fix: Float32Array; idx: Uint16Array }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

export class Builder {
  pos: number[] = []; col: number[] = []; fix: number[] = []; idx: number[] = []
  v(p: V3, c: V3, fix: number) { this.pos.push(...p); this.col.push(...c); this.fix.push(fix); return this.pos.length / 3 - 1 }
  /** Frustum from a to b (r1 = 0: a cone). `fix` colours are absolute; the others are tinted by the instance colour. */
  tube(a: V3, b: V3, r0: number, r1: number, n: number, c: V3, fix = 0) {
    const w = unit(sub(b, a)), ref: V3 = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = unit(cross(ref, w)), v = cross(w, u)
    const ring = (o: V3, r: number) => Array.from({ length: n }, (_, i) => {
      const t = i / n * Math.PI * 2, k = Math.cos(t) * r, l = Math.sin(t) * r
      return this.v([o[0] + u[0] * k + v[0] * l, o[1] + u[1] * k + v[1] * l, o[2] + u[2] * k + v[2] * l], c, fix)
    })
    const r = ring(a, r0)
    if (r1 > 0) {
      const q = ring(b, r1)
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.idx.push(r[i], r[j], q[j], r[i], q[j], q[i]) }
    } else {
      const apex = this.v(b, c, fix)
      for (let i = 0; i < n; i++) this.idx.push(r[i], r[(i + 1) % n], apex)
    }
  }
  /** Low-poly ellipsoid: two apexes and two rings. `jit` roughens it (boulders). */
  blob(o: V3, rx: number, ry: number, rz: number, n: number, c: V3, fix = 0, jit = 0) {
    const J = (i: number) => 1 + jit * (Math.sin(i * 12.9898 + o[0] * 78.233 + o[2] * 37.719) * 0.5)
    const top = this.v([o[0], o[1] + ry, o[2]], c, fix), bot = this.v([o[0], o[1] - ry * 0.9, o[2]], c, fix)
    const ring = (th: number, off: number) => Array.from({ length: n }, (_, i) => {
      const t = (i + off) / n * Math.PI * 2, j = J(i + off * 7 + th)
      return this.v([o[0] + Math.cos(t) * rx * Math.sin(th) * j, o[1] + Math.cos(th) * ry * j, o[2] + Math.sin(t) * rz * Math.sin(th) * j], c, fix)
    })
    const a = ring(0.95, 0), b = ring(2.15, 0.5)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      this.idx.push(top, a[i], a[j], a[i], b[i], a[j], a[j], b[i], b[j], bot, b[j], b[i])
    }
  }
  /** A flat triangle (frond, grass blade). */
  tri(a: V3, b: V3, c: V3, col: V3, fix = 0) { this.idx.push(this.v(a, col, fix), this.v(b, col, fix), this.v(c, col, fix)) }
  done(): PropMesh { return { pos: new Float32Array(this.pos), col: new Float32Array(this.col), fix: new Float32Array(this.fix), idx: new Uint16Array(this.idx) } }
}

const WOOD: V3 = [0.36, 0.25, 0.16], BARK: V3 = [0.3, 0.22, 0.17], WHITE: V3 = [1, 1, 1], SHADE: V3 = [0.82, 0.86, 0.82], STONE: V3 = [0.5, 0.48, 0.46]

const MAKERS: Record<DecorKind, (b: Builder) => void> = {
  conifer: (b) => {
    b.tube([0, 0, 0], [0, 0.25, 0], 0.045, 0.035, 4, WOOD, 1)
    b.tube([0, 0.14, 0], [0, 0.55, 0], 0.34, 0, 6, WHITE)
    b.tube([0, 0.36, 0], [0, 0.78, 0], 0.26, 0, 6, SHADE)
    b.tube([0, 0.6, 0], [0, 1, 0], 0.17, 0, 6, WHITE)
  },
  oak: (b) => {
    b.tube([0, 0, 0], [0, 0.45, 0], 0.06, 0.035, 4, WOOD, 1)
    b.blob([0, 0.62, 0], 0.38, 0.34, 0.38, 5, WHITE)
    b.blob([0.14, 0.82, 0.06], 0.26, 0.2, 0.26, 5, SHADE)
  },
  palm: (b) => {
    b.tube([0, 0, 0], [0.08, 0.5, 0.04], 0.05, 0.035, 4, WOOD, 1)
    b.tube([0.08, 0.5, 0.04], [0.16, 0.95, 0.08], 0.035, 0.025, 4, WOOD, 1)
    for (let i = 0; i < 6; i++) {
      const t = i / 6 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), px = 0.16, pz = 0.08
      b.tri([px, 0.95, pz], [px + c * 0.5 - s * 0.09, 0.8, pz + s * 0.5 + c * 0.09], [px + c * 0.5 + s * 0.09, 0.8, pz + s * 0.5 - c * 0.09], i % 2 ? WHITE : SHADE)
    }
  },
  acacia: (b) => {
    b.tube([0, 0, 0], [0.05, 0.75, 0], 0.05, 0.03, 4, WOOD, 1)
    b.blob([0.05, 0.84, 0], 0.5, 0.11, 0.5, 6, WHITE)
  },
  giant: (b) => {
    b.tube([0, 0, 0], [0, 0.6, 0], 0.085, 0.05, 5, BARK, 1)
    b.blob([0, 0.76, 0], 0.46, 0.3, 0.46, 6, WHITE)
    b.blob([0.1, 0.94, -0.05], 0.3, 0.16, 0.3, 5, SHADE)
  },
  dead: (b) => {
    b.tube([0, 0, 0], [0, 0.75, 0], 0.05, 0.012, 4, WHITE)
    b.tube([0, 0.4, 0], [0.32, 0.72, 0.08], 0.025, 0.006, 3, WHITE)
    b.tube([0, 0.5, 0], [-0.28, 0.82, -0.1], 0.022, 0.006, 3, WHITE)
    b.tube([0, 0.62, 0], [0.04, 0.9, 0.26], 0.018, 0.005, 3, WHITE)
  },
  cactus: (b) => {
    b.tube([0, 0, 0], [0, 0.85, 0], 0.11, 0.09, 5, WHITE)
    b.tube([0.08, 0.35, 0], [0.34, 0.35, 0], 0.06, 0.06, 4, SHADE)
    b.tube([0.34, 0.35, 0], [0.34, 0.68, 0], 0.06, 0.04, 4, SHADE)
    b.tube([-0.08, 0.5, 0], [-0.3, 0.5, 0.04], 0.055, 0.055, 4, SHADE)
    b.tube([-0.3, 0.5, 0.04], [-0.3, 0.76, 0.04], 0.055, 0.04, 4, SHADE)
  },
  mushroom: (b) => {
    b.tube([0, 0, 0], [0, 0.55, 0], 0.1, 0.075, 6, [0.93, 0.88, 0.78], 1)
    b.blob([0, 0.62, 0], 0.5, 0.2, 0.5, 6, WHITE)
  },
  crystal: (b) => {
    const spike = (x: number, z: number, lx: number, lz: number, h: number, r: number, c: V3) => {
      b.tube([x, 0, z], [x + lx * h * 0.7, h * 0.7, z + lz * h * 0.7], r, r * 0.9, 5, c)
      b.tube([x + lx * h * 0.7, h * 0.7, z + lz * h * 0.7], [x + lx * h, h, z + lz * h], r * 0.9, 0, 5, WHITE)
    }
    spike(0, 0, 0.05, 0, 1, 0.13, WHITE); spike(0.2, 0.08, 0.25, 0.1, 0.6, 0.1, SHADE); spike(-0.18, -0.1, -0.22, -0.05, 0.5, 0.09, WHITE); spike(0.02, -0.2, 0, -0.3, 0.42, 0.08, SHADE)
  },
  boulder: (b) => { b.blob([0, 0.36, 0], 0.5, 0.36, 0.44, 5, STONE, 0, 0.55) },
  tuft: (b) => {
    for (let i = 0; i < 6; i++) {
      const t = i / 6 * Math.PI * 2 + 0.3, c = Math.cos(t), s = Math.sin(t), lean = 0.22 + 0.1 * (i % 2)
      b.tri([c * 0.06 - s * 0.05, 0, s * 0.06 + c * 0.05], [c * 0.06 + s * 0.05, 0, s * 0.06 - c * 0.05], [c * (0.06 + lean), 1 - 0.18 * (i % 3), s * (0.06 + lean)], WHITE)
    }
  },
  bush: (b) => { b.blob([0, 0.34, 0], 0.5, 0.34, 0.5, 5, WHITE); b.blob([0.22, 0.28, 0.1], 0.3, 0.24, 0.3, 4, SHADE) },
  reed: (b) => {
    for (let i = 0; i < 5; i++) {
      const t = i / 5 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), r = 0.12 + 0.05 * (i % 2)
      b.tri([c * r - s * 0.03, 0, s * r + c * 0.03], [c * r + s * 0.03, 0, s * r - c * 0.03], [c * (r + 0.1), 0.8 + 0.2 * (i % 2), s * (r + 0.1)], i % 2 ? WHITE : SHADE)
    }
    b.tube([0, 0, 0], [0.02, 0.7, 0], 0.02, 0.025, 4, [0.4, 0.28, 0.2], 1)
  },
}

const cache = new Map<DecorKind, PropMesh>()
/** The shared unit mesh of a prop kind. */
export const propMesh = (kind: DecorKind): PropMesh => {
  let m = cache.get(kind)
  if (!m) { const b = new Builder(); MAKERS[kind](b); cache.set(kind, m = b.done()) }
  return m
}
