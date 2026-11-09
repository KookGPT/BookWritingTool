// Locations volume ground: the land and its rock as ONE surface. Instead of a height grid with rock sheets laid over
// its steep parts (two surfaces that must be kept in line), the land is a signed distance field: distance to the
// finished height grid (erosion, rivers, lakes and all), plus real 3D rock where the ground is steep (layers that stand
// out and fall back, buttresses, joint clefts, wave-cut notches at the sea) and the free-standing rocks (stacks,
// spires, karst towers, arches). Any square of it can be meshed at any voxel size by surface nets on columns sampled
// only near the surface, so a vertical face, an overhang or an arch is just more of the same mesh, and the renderer
// asks for fine squares near the camera and coarse ones far away (volumeLod.ts). Pure (no DOM): workers, node tests
// and the CLI run it. World coordinates: x east, y up, z south; recipe y north is world -z.
import { fbm, simplex } from '../world/noise.ts'
import type { Rock } from './terrain.ts'

export interface VolumeChunk { pos: Float32Array; nor: Float32Array; col: Uint8Array; surf: Uint8Array; idx: Uint32Array }
/** What the field needs from a build. `rockMap` is the colour of the rock under each grid vertex (sRGB bytes). */
export interface FieldIn { N: number; size: number; heights: Float32Array; colors: Uint8Array; surf: Uint8Array; sea: number | null; rocks: Rock[]; rockMap: Uint8Array; seed: number }

const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
// corners of a cube (bit 1: +x, 2: +y, 4: +z) and its twelve edges
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]

export type Field = ReturnType<typeof volumeField>

export function volumeField(o: FieldIn) {
  const { N, size, heights, sea } = o, w = N + 1, c = size / N, half = size / 2, nz1 = simplex(o.seed ^ 0x51ab), nz2 = simplex(o.seed ^ 0x22c7)
  // slope of the grid and the lowest ground nearby (to tell sea cliffs from inland ones)
  const gxA = new Float32Array(w * w), gzA = new Float32Array(w * w), foot = new Float32Array(w * w)
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const a = j * w + i, il = Math.max(0, i - 1), ir = Math.min(N, i + 1), jl = Math.max(0, j - 1), jr = Math.min(N, j + 1)
    gxA[a] = (heights[j * w + ir] - heights[j * w + il]) / ((ir - il) * c); gzA[a] = (heights[jr * w + i] - heights[jl * w + i]) / ((jr - jl) * c)
    let m = Infinity
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii <= N && jj <= N) m = Math.min(m, heights[jj * w + ii]) }
    foot[a] = m
  }
  const cellOf = (x: number, z: number) => { const fx = Math.min(N - 1e-6, Math.max(0, (x + half) / c)), fz = Math.min(N - 1e-6, Math.max(0, (z + half) / c)), i = Math.floor(fx), j = Math.floor(fz); return [i, j, fx - i, fz - j] as const }
  /** Bilinear on a byte map with k channels (colours, rock, surface flags), so colour edges are smooth, not grid squares. */
  const bilB = (arr: Uint8Array, k: number, ch: number, x: number, z: number) => { const [i, j, tx, tz] = cellOf(x, z), a = j * w + i; return (arr[a * k + ch] * (1 - tx) + arr[(a + 1) * k + ch] * tx) * (1 - tz) + (arr[(a + w) * k + ch] * (1 - tx) + arr[(a + w + 1) * k + ch] * tx) * tz }
  const bil = (arr: Float32Array, x: number, z: number) => { const [i, j, tx, tz] = cellOf(x, z), a = j * w + i; return (arr[a] * (1 - tx) + arr[a + 1] * tx) * (1 - tz) + (arr[a + w] * (1 - tx) + arr[a + w + 1] * tx) * tz }
  /** The ground as the grid's triangles draw it, so houses, trees and roads stand where they always did. */
  const H = (x: number, z: number) => {
    const [i, j, tx, tz] = cellOf(x, z), a = j * w + i
    return tx + tz <= 1 ? heights[a] + (heights[a + 1] - heights[a]) * tx + (heights[a + w] - heights[a]) * tz : heights[a + w + 1] + (heights[a + w] - heights[a + w + 1]) * (1 - tx) + (heights[a + 1] - heights[a + w + 1]) * (1 - tz)
  }
  // the free-standing rocks in world coordinates, bucketed so each sample only looks at the rocks near it
  const rocks = o.rocks.filter((r) => r.kind === 'stack' || r.kind === 'spire' || r.kind === 'arch' || r.kind === 'tower').map((r) => {
    const ax = r.at[0], az = -r.at[1], bx = r.to ? r.to[0] : ax, bz = r.to ? -r.to[1] : az, rad = r.kind === 'arch' ? Math.hypot(bx - ax, bz - az) / 2 + r.r : r.r * 1.3
    return { ...r, ax, az, bx, bz, cx: (ax + bx) / 2, cz: (az + bz) / 2, reach: rad + 6 }
  })
  const RB = 128, rb = Math.ceil(size / RB) + 1, buckets = new Map<number, typeof rocks>()
  for (const r of rocks) for (let bj = Math.floor((r.cz - r.reach + half) / RB); bj <= Math.floor((r.cz + r.reach + half) / RB); bj++) for (let bi = Math.floor((r.cx - r.reach + half) / RB); bi <= Math.floor((r.cx + r.reach + half) / RB); bi++) { const k = bj * rb + bi, l = buckets.get(k); if (l) l.push(r); else buckets.set(k, [r]) }
  const near = (x: number, z: number) => buckets.get(Math.floor((z + half) / RB) * rb + Math.floor((x + half) / RB))
  // the layers: their spacing and how strongly they show vary over the face (massive here, thin-bedded there), they dip
  // and warp; broad buttresses and bays, and vertical joints that weather open into clefts
  const layers = (x: number, y: number, z: number) => {
    const warp = fbm(nz1, x / 60, 3, z / 60, 2) * 8 + fbm(nz1, x / 260, 7, z / 260, 2) * 24, period = 4.5 + 5 * (fbm(nz2, x / 320, 1, z / 320, 2) + 0.5)
    return (0.5 + 0.5 * Math.sin(((y + warp) / period) * Math.PI * 2)) ** 4 * sstep(-0.25, 0.25, fbm(nz2, x / 420, 11, z / 420, 2))
  }
  /** Weathered rock, > 0 cuts into it. `fine` (0..1) fades in the small detail a coarse mesh could not show anyway. */
  const bedding = (x: number, y: number, z: number, amp: number, fine: number) => {
    const butt = fbm(nz2, x / 55, y / 90, z / 55, 3) * 2, cleft = 1 - sstep(0, 0.05, Math.abs(fbm(nz1, x / 11, y / 140, z / 11, 2)))
    return amp * (1.1 * layers(x, y, z) + 1.5 * butt + 1.3 * cleft * fine + 0.2 * fine * fbm(nz2, x / 4, y / 6, z / 4, 2) - 0.5)
  }
  const rockSDF = (x: number, y: number, z: number, fine: number) => {
    let d = Infinity
    for (const r of near(x, z) ?? []) {
      if (Math.abs(x - r.cx) > r.reach || Math.abs(z - r.cz) > r.reach) continue
      if (r.kind === 'arch') { // a thick band of rock bent over between its two feet, the sea's hole under it
        const ux = r.bx - r.ax, uz = r.bz - r.az, L = Math.hypot(ux, uz) || 1, u = ((x - r.cx) * ux + (z - r.cz) * uz) / L, lat = (-(x - r.cx) * uz + (z - r.cz) * ux) / L
        // it springs from the waterline (its feet run on down to the sea floor), so the hole stands clear of the water
        const spring = sea != null ? Math.max(r.base, sea - 1) : r.base, th = Math.min(r.r * 0.5, (r.top - spring) * 0.25), ru = L / 2, rv = Math.max(6, r.top - spring - th), vv = Math.max(0, y - spring), e = (Math.hypot(u / ru, vv / rv) - 1) * Math.min(ru, rv)
        d = Math.min(d, Math.max(Math.abs(e) - th, Math.abs(lat) - r.r * 0.9, r.base - y - 2) + bedding(x, y, z, 0.5, fine))
      } else { // a column, tapering a little upward, its top rounded off by weather
        const t = Math.max(0, Math.min(1, (y - r.base) / Math.max(1, r.top - r.base))), rr = r.r * (1.1 - 0.35 * t)
        d = Math.min(d, Math.max(Math.hypot(x - r.ax, z - r.az) - rr, y - r.top, r.base - y - 2) + bedding(x, y, z, 0.7, fine))
      }
    }
    return d
  }
  /** Signed distance to the land (> 0 in the air). */
  const dens = (x: number, y: number, z: number, fine = 1) => {
    const gx = bil(gxA, x, z), gz = bil(gzA, x, z), g = Math.hypot(gx, gz)
    let d = (y - H(x, z)) / Math.sqrt(1 + g * g)
    const s = sstep(0.85, 1.7, g)
    if (s > 0) {
      d += bedding(x, y, z, 1.6 * s, fine)
      if (sea != null && bil(foot, x, z) < sea + 3) d += 3.2 * s * Math.exp(-(((y - sea - 1.3) / 2) ** 2)) // the sea's notch at the foot of its cliffs
    }
    return rocks.length ? Math.min(d, rockSDF(x, y, z, fine)) : d
  }
  /** The lowest and highest the surface reaches over a square (for the renderer's boxes). */
  const range = (x0: number, z0: number, s: number): [number, number] => {
    let lo = Infinity, hi = -Infinity
    const st = Math.max(c, s / 16)
    for (let z = z0; z <= z0 + s + 1e-6; z += st) for (let x = x0; x <= x0 + s + 1e-6; x += st) { const h = H(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h) }
    for (const r of rocks) if (r.cx + r.reach > x0 && r.cx - r.reach < x0 + s && r.cz + r.reach > z0 && r.cz - r.reach < z0 + s) { lo = Math.min(lo, r.base); hi = Math.max(hi, r.top) }
    return [lo - 12, hi + 12]
  }
  /** Mesh the square from (x0, z0), `n` cubes of `v` metres a side (plus a cube of overlap all round, which hides the
   * cracks where squares of different sizes meet). Null if nothing of the surface is in it. */
  function mesh(x0: number, z0: number, n: number, v: number): VolumeChunk | null {
    const fine = 1 - sstep(2.5, 8, v), M = 9 + 2 * v
    const ia = -2, ib = n + 2, cw = ib - ia + 1 // columns, with the overlap cube and one more for the faces on its edge
    const col = (i: number) => x0 + i * v, row = (k: number) => z0 + k * v
    const Hc = new Float32Array((cw + 2) * (cw + 2)) // heights with one more ring for the neighbourhoods
    for (let k = ia - 1; k <= ib + 1; k++) for (let i = ia - 1; i <= ib + 1; i++) Hc[(k - ia + 1) * (cw + 2) + i - ia + 1] = H(col(i), row(k))
    let yMin = Infinity
    for (const h of Hc) yMin = Math.min(yMin, h)
    const y0 = Math.floor((yMin - M - 20) / v) * v
    const clo = new Int32Array(cw * cw), chi = new Int32Array(cw * cw), off = new Int32Array(cw * cw)
    let total = 0
    for (let k = ia; k <= ib; k++) for (let i = ia; i <= ib; i++) {
      let a = Infinity, b = -Infinity
      for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) { const h = Hc[(k + dk - ia + 1) * (cw + 2) + i + di - ia + 1]; a = Math.min(a, h); b = Math.max(b, h) }
      const x = col(i), z = row(k)
      let mc = Math.hypot(bil(gxA, x, z), bil(gzA, x, z)) > 0.8 ? M : 2 * v + 1.5 // flat ground is never displaced: a thin band will do
      for (const r of near(x, z) ?? []) if (Math.abs(x - r.cx) < r.reach + v && Math.abs(z - r.cz) < r.reach + v) { a = Math.min(a, r.base); b = Math.max(b, r.top); mc = M }
      const q = (k - ia) * cw + i - ia
      clo[q] = Math.max(0, Math.floor((a - mc - y0) / v)); chi[q] = Math.ceil((b + mc - y0) / v); off[q] = total; total += chi[q] - clo[q] + 1
    }
    const D = new Float32Array(total)
    for (let k = ia; k <= ib; k++) for (let i = ia; i <= ib; i++) {
      const q = (k - ia) * cw + i - ia, x = col(i), z = row(k)
      for (let j = clo[q]; j <= chi[q]; j++) D[off[q] + j - clo[q]] = dens(x, y0 + j * v, z, fine)
    }
    const at = (i: number, j: number, k: number) => { const q = (k - ia) * cw + i - ia; return j < clo[q] ? -1e3 : j > chi[q] ? 1e3 : D[off[q] + j - clo[q]] }
    // a vertex in every cube the surface passes through, at the mean of its edge crossings
    const vid = new Map<number, number>(), P: number[] = []
    const vertex = (i: number, j: number, k: number) => {
      const kk = ((k - ia) * cw + (i - ia)) * 65536 + j, have = vid.get(kk)
      if (have != null) return have
      const cd: number[] = []
      for (let b = 0; b < 8; b++) cd.push(at(i + (b & 1), j + ((b >> 1) & 1), k + ((b >> 2) & 1)))
      let sx = 0, sy = 0, sz = 0, cnt = 0
      for (const [a, b] of EDGES) {
        if ((cd[a] < 0) === (cd[b] < 0)) continue
        const t = cd[a] / (cd[a] - cd[b])
        sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; cnt++
      }
      const id = P.length / 3
      P.push(col(i + sx / cnt), y0 + (j + sy / cnt) * v, row(k + sz / cnt))
      vid.set(kk, id)
      return id
    }
    const I: number[] = []
    const quad = (a: number, b: number, cc: number, d: number, axis: number, sign: number) => { // wound so its normal points into the air
      const ux = P[cc * 3] - P[a * 3], uy = P[cc * 3 + 1] - P[a * 3 + 1], uz = P[cc * 3 + 2] - P[a * 3 + 2], wx = P[d * 3] - P[b * 3], wy = P[d * 3 + 1] - P[b * 3 + 1], wz = P[d * 3 + 2] - P[b * 3 + 2]
      const nn = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx][axis]
      if (nn * sign >= 0) I.push(a, b, cc, a, cc, d); else I.push(a, cc, b, a, d, cc)
    }
    // every crossing edge from a corner of the squares owned (the overlap cube included) makes a quad of the four cubes round it
    for (let k = -1; k <= n; k++) for (let i = -1; i <= n; i++) {
      const q = (k - ia) * cw + i - ia
      for (let j = clo[q]; j <= chi[q]; j++) {
        const s0 = at(i, j, k) < 0
        if (j > 0 && s0 !== (at(i + 1, j, k) < 0)) quad(vertex(i, j - 1, k - 1), vertex(i, j, k - 1), vertex(i, j, k), vertex(i, j - 1, k), 0, s0 ? 1 : -1)
        if (s0 !== (at(i, j + 1, k) < 0)) quad(vertex(i - 1, j, k - 1), vertex(i, j, k - 1), vertex(i, j, k), vertex(i - 1, j, k), 1, s0 ? 1 : -1)
        if (j > 0 && s0 !== (at(i, j, k + 1) < 0)) quad(vertex(i - 1, j - 1, k), vertex(i, j - 1, k), vertex(i, j, k), vertex(i - 1, j, k), 2, s0 ? 1 : -1)
      }
    }
    if (!I.length) return null
    // normals from the field itself (so neighbouring squares shade alike), colours from the ground map, rock where it is steep
    const nv = P.length / 3, nor = new Float32Array(nv * 3), cl = new Uint8Array(nv * 3), sf = new Uint8Array(nv * 4), e = v * 0.5
    for (let p = 0; p < nv; p++) {
      const x = P[p * 3], y = P[p * 3 + 1], z = P[p * 3 + 2]
      let nx = dens(x + e, y, z, fine) - dens(x - e, y, z, fine), ny = dens(x, y + e, z, fine) - dens(x, y - e, z, fine), nzz = dens(x, y, z + e, fine) - dens(x, y, z - e, fine)
      const l = Math.hypot(nx, ny, nzz) || 1
      nx /= l; ny /= l; nzz /= l
      nor[p * 3] = nx; nor[p * 3 + 1] = ny; nor[p * 3 + 2] = nzz
      const steep = sstep(0.85, 1.7, Math.hypot(bil(gxA, x, z), bil(gzA, x, z))), rockness = Math.max(sstep(0.78, 0.5, ny), steep * sstep(0.95, 0.75, ny))
      const band = 0.86 + 0.24 * layers(x, y, z) + 0.12 * fbm(nz2, x / 30, y / 8, z / 30, 2), shade = band * (0.55 + 0.45 * sstep(-0.6, 0.4, ny))
      for (let t = 0; t < 3; t++) cl[p * 3 + t] = Math.round(Math.min(255, bilB(o.colors, 3, t, x, z) * (1 - rockness) + bilB(o.rockMap, 3, t, x, z) * shade * rockness))
      for (let t = 0; t < 4; t++) sf[p * 4 + t] = Math.round(bilB(o.surf, 4, t, x, z) * (1 - rockness))
    }
    return { pos: new Float32Array(P), nor, col: cl, surf: sf, idx: new Uint32Array(I) }
  }
  return { dens, range, mesh, H }
}

/** The voxel size a place is meshed at in one piece (tests, the CLI): about 1/1400 of its width, 1 to 4 m. */
export const voxelOf = (size: number) => Math.min(4, Math.max(1, size / 1400))
/** The whole place in squares at one voxel size. */
export function volumeTerrain(o: FieldIn, v = voxelOf(o.size)): VolumeChunk[] {
  const f = volumeField(o), n = 96, out: VolumeChunk[] = []
  for (let z = -o.size / 2; z < o.size / 2 - 1e-6; z += n * v) for (let x = -o.size / 2; x < o.size / 2 - 1e-6; x += n * v) { const m = f.mesh(x, z, Math.min(n, Math.round((o.size / 2 - x) / v)), v); if (m) out.push(m) }
  return out
}
