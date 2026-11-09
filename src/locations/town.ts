// Locations towns: a town is not a circle. It grows outward from its core (the market square, usually where roads meet
// or a river is crossed) over the cheapest ground, so it stretches along valley floors, ridge crests, contours and
// shores, and thins out toward its edge (`zone` 0 at the core, 1 at the edge). Its streets come from a tensor field:
// near a main road they run along and across it, around the square they radiate and ring, on slopes they follow the
// contours (with stairs straight down between them); streamlines of the field, kept a block apart, are the streets,
// so the blocks between them are real blocks. Pure; world coordinates (x east, z south), heights in metres.
import { fbm, rng, simplex } from '../world/noise.ts'
import { Heap } from './hydro.ts'
import type { Road, P3 } from './roads.ts'
import { clamp, lerp, sstep, type XY } from './terrain.ts'
import type { Culture } from './buildings.ts'

export interface Town {
  id: string; core: [number, number]; r: number; culture: Culture | 'mixed'; steep: boolean; plan: 'organic' | 'grid' | 'radial' | 'terraced'
  /** Signed distance to the town's edge in metres (negative inside). */
  inside: (x: number, z: number) => number
  /** 0 at the core, 1 at the edge, more outside. */
  zone: (x: number, z: number) => number
  bbox: [number, number, number, number]
  /** The town's fields reach out to this zone value (about seven times the town's own area). */
  farm: number
  g: number; gx: number; gz: number; gw: number; gh: number; cost: Float32Array; sdf: Float32Array
}
const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const

/** Grow a town from `core` until it covers about pi r^2 of the cheapest ground. */
export function growTown(o: { id: string; core: [number, number]; r: number; culture: Culture | 'mixed'; steep: boolean; plan?: Town['plan']; area?: (x: number, z: number) => number }, H: (x: number, z: number) => number, wet: (x: number, z: number) => boolean, seed: number): Town {
  const R = o.r, g = clamp(R / 45, 5, 14), span = R * 3.3, gx = o.core[0] - span, gz = o.core[1] - span, gw = Math.ceil((span * 2) / g) + 1, gh = gw, n = gw * gh
  const nz = simplex(seed), cost = new Float32Array(n).fill(Infinity), hs = new Float32Array(n), block = new Uint8Array(n)
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const x = gx + i * g, z = gz + j * g, k = j * gw + i; hs[k] = H(x, z); block[k] = wet(x, z) || (o.area ? o.area(x, z) > 0 : false) ? 1 : 0 }
  const ci = clamp(Math.round((o.core[0] - gx) / g), 0, gw - 1), cj = clamp(Math.round((o.core[1] - gz) / g), 0, gh - 1), heap = new Heap(4096)
  cost[cj * gw + ci] = 0; heap.push(0, cj * gw + ci)
  const order: number[] = [], target = (Math.PI * R * R) / (g * g)
  while (heap.n && order.length < target * 9) {
    const k = heap.pop(), i = k % gw, j = (k / gw) | 0
    if (heap.key > cost[k]) continue // a stale entry: this cell was reached more cheaply since
    order.push(k)
    for (const [di, dj] of NB8) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue
      const q = nj * gw + ni
      if (block[q]) continue
      const len = Math.hypot(di, dj) * g, sl = Math.abs(hs[q] - hs[k]) / len, x = gx + ni * g, z = gz + nj * g
      // gentle ground is cheap, steep ground dear (less so for cliff towns), and a little noise keeps the edge ragged
      const c = len * (1 + (o.steep ? 4 : 18) * sl * sl + (sl > (o.steep ? 1.4 : 0.55) ? 30 : 0)) * (1 + 0.45 * (fbm(nz, x / (R * 0.6), 1, z / (R * 0.6), 3) + 0.5))
      if (cost[k] + c < cost[q]) { cost[q] = cost[k] + c; heap.push(cost[q], q) }
    }
  }
  const edge = cost[order[Math.min(order.length - 1, Math.floor(target))]] || 1, farm = (cost[order[Math.min(order.length - 1, Math.floor(target * 7))]] || edge * 2.5) / edge
  for (let k = 0; k < n; k++) cost[k] /= edge
  // signed distance to the edge (chamfer), so `inside` is in metres like the old district shapes
  const sdf = new Float32Array(n).fill(1e9), q: number[] = []
  const isIn = (k: number) => cost[k] <= 1
  for (let k = 0; k < n; k++) { const i = k % gw, j = (k / gw) | 0; if (isIn(k) && NB8.some(([di, dj]) => { const ni = i + di, nj = j + dj; return ni < 0 || nj < 0 || ni >= gw || nj >= gh || !isIn(nj * gw + ni) })) { sdf[k] = 0.5 * g; q.push(k) } }
  const out = new Float32Array(n).fill(1e9), qo: number[] = []
  for (let k = 0; k < n; k++) { const i = k % gw, j = (k / gw) | 0; if (!isIn(k) && NB8.some(([di, dj]) => { const ni = i + di, nj = j + dj; return ni >= 0 && nj >= 0 && ni < gw && nj < gh && isIn(nj * gw + ni) })) { out[k] = 0.5 * g; qo.push(k) } }
  const spread = (d: Float32Array, list: number[], ok: (k: number) => boolean) => {
    for (let h = 0; h < list.length; h++) { const k = list[h], i = k % gw, j = (k / gw) | 0; for (const [di, dj] of NB8) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue; const p = nj * gw + ni, v = Math.fround(d[k] + Math.hypot(di, dj) * g); if (ok(p) && v < d[p]) { d[p] = v; list.push(p) } } }
  }
  spread(sdf, q, isIn); spread(out, qo, (k) => !isIn(k))
  for (let k = 0; k < n; k++) sdf[k] = isIn(k) ? -sdf[k] : out[k] < 1e8 ? out[k] : span
  const look = (arr: Float32Array, x: number, z: number, far: number) => {
    const fx = (x - gx) / g, fz = (z - gz) / g
    if (fx < 0 || fz < 0 || fx > gw - 1.001 || fz > gh - 1.001) return far
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * gw + i
    const a = arr[k], b = arr[k + 1], c = arr[k + gw], d = arr[k + gw + 1]
    if (!Number.isFinite(a + b + c + d)) return far
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let k = 0; k < n; k++) if (isIn(k)) { const x = gx + (k % gw) * g, z = gz + ((k / gw) | 0) * g; x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z) }
  let slope = 0, cnt = 0
  for (const k of order.slice(0, Math.floor(target))) { const i = k % gw; if (i > 0 && i < gw - 1) { slope += Math.abs(hs[k + 1] - hs[k - 1]) / (2 * g); cnt++ } }
  const plan = o.plan ?? (o.steep || slope / Math.max(1, cnt) > 0.14 ? 'terraced' : 'organic')
  return {
    id: o.id, core: o.core, r: R, culture: o.culture, steep: o.steep, plan, bbox: [x0 - g, z0 - g, x1 + g, z1 + g], farm: clamp(farm, 1.4, 3.4), g, gx, gz, gw, gh, cost, sdf,
    inside: (x, z) => look(sdf, x, z, span), zone: (x, z) => look(cost, x, z, 9),
  }
}

/** The outline of a zone (marching squares on the cost field), longest loop, as recipe points (x, y). */
export function zoneOutline(t: Town, level: number): XY[] {
  const { gw, gh, g, gx, gz, cost } = t, segs = new Map<string, [number, number][]>()
  const v = (i: number, j: number) => { const c = cost[j * gw + i]; return Number.isFinite(c) ? c : 9 }
  const pt = (i: number, j: number, i2: number, j2: number): [number, number] => { const a = v(i, j), b = v(i2, j2), t2 = clamp((level - a) / (b - a || 1)); return [gx + lerp(i, i2, t2) * g, gz + lerp(j, j2, t2) * g] }
  const lines: [[number, number], [number, number]][] = []
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const c = (v(i, j) < level ? 1 : 0) | (v(i + 1, j) < level ? 2 : 0) | (v(i + 1, j + 1) < level ? 4 : 0) | (v(i, j + 1) < level ? 8 : 0)
    if (!c || c === 15) continue
    const T = pt(i, j, i + 1, j), Rt = pt(i + 1, j, i + 1, j + 1), B = pt(i, j + 1, i + 1, j + 1), L = pt(i, j, i, j + 1)
    const E: Record<number, [number, number][][]> = { 1: [[L, T]], 2: [[T, Rt]], 3: [[L, Rt]], 4: [[Rt, B]], 5: [[L, T], [Rt, B]], 6: [[T, B]], 7: [[L, B]], 8: [[B, L]], 9: [[B, T]], 10: [[T, Rt], [B, L]], 11: [[B, Rt]], 12: [[Rt, L]], 13: [[Rt, T]], 14: [[T, L]] }
    for (const [a, b] of E[c]) lines.push([a, b])
  }
  const key = (p: [number, number]) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`
  for (const [a, b] of lines) { const k = key(a); const l = segs.get(k); if (l) l.push(b); else segs.set(k, [b]) }
  const used = new Set<string>(), loops: [number, number][][] = []
  for (const [a] of lines) {
    if (used.has(key(a))) continue
    const loop: [number, number][] = [a]
    let cur = a
    for (let it = 0; it < 100000; it++) { used.add(key(cur)); const nx = segs.get(key(cur))?.find((p) => !used.has(key(p))); if (!nx) break; loop.push(nx); cur = nx }
    loops.push(loop)
  }
  const best = loops.sort((p, q) => q.length - p.length)[0] ?? []
  return best.map(([x, z]) => [x, -z] as XY)
}

// ---------- streets ----------
export interface StreetIn {
  town: Town; H: (x: number, z: number) => number; mains: Road[]; blocked: (x: number, z: number) => boolean; wealth: (x: number, z: number, h: number) => number; seed: number
  /** Streets already laid (main roads): a new street may end on one. */
  near: (x: number, z: number) => number
}
/** The town's streets: streamlines of a tensor field, major (along roads and contours) and minor (across them). */
export function townStreets(o: StreetIn): Road[] {
  const t = o.town, R = rng(o.seed), nz = simplex(o.seed ^ 0x5717), [cx, cz] = t.core
  // basis fields: along nearby main roads, radial round the square, along the contours where it is steep
  const segs: { x: number; z: number; a: number }[] = []
  for (const r of o.mains) for (let i = 0; i < r.pts.length - 1; i += 6) {
    const p = r.pts[i], q = r.pts[Math.min(r.pts.length - 1, i + 6)]
    if (t.zone(p[0], p[2]) > 1.6) continue
    segs.push({ x: p[0], z: p[2], a: Math.atan2(q[2] - p[2], q[0] - p[0]) })
  }
  const gAng = segs.length ? segs[0].a : R() * Math.PI, planW = t.plan === 'grid' ? 3 : t.plan === 'radial' ? 0.3 : 1, radW = t.plan === 'radial' ? 2.5 : t.plan === 'grid' ? 0.1 : 0.8
  const field = (x: number, z: number): [number, number] => {
    let tx = 0, tz = 0
    const add = (a: number, w: number) => { tx += Math.cos(2 * a) * w; tz += Math.sin(2 * a) * w }
    for (const s of segs) { const d2 = (x - s.x) ** 2 + (z - s.z) ** 2; if (d2 < 250 * 250) add(s.a, Math.exp(-d2 / (110 * 110)) * planW) }
    const dc = Math.hypot(x - cx, z - cz)
    add(Math.atan2(z - cz, x - cx), radW * Math.exp(-((dc / (t.r * 0.55)) ** 2)))
    const gx = o.H(x + 4, z) - o.H(x - 4, z), gz = o.H(x, z + 4) - o.H(x, z - 4), sl = Math.hypot(gx, gz) / 8
    if (sl > 0.02) add(Math.atan2(gz, gx) + Math.PI / 2, (t.plan === 'terraced' ? 6 : 3) * sl * sl * 40) // contours
    add(gAng + fbm(nz, x / 900, 1, z / 900, 2) * 0.6, 0.06)
    return [tx, tz]
  }
  const dirOf = (x: number, z: number, minor: boolean) => { const [a, b] = field(x, z), ang = 0.5 * Math.atan2(b, a) + (minor ? Math.PI / 2 : 0); return [Math.cos(ang), Math.sin(ang)] as [number, number] }
  // placed samples per family, in a hash grid, for the separation test
  const C = 8, grids = [new Map<number, number[]>(), new Map<number, number[]>()], all = new Map<number, number[]>()
  const keyOf = (x: number, z: number) => Math.floor(x / C) * 100003 + Math.floor(z / C)
  const put = (m: Map<number, number[]>, x: number, z: number) => { const k = keyOf(x, z); const l = m.get(k); if (l) l.push(x, z); else m.set(k, [x, z]) }
  const nearest = (m: Map<number, number[]>, x: number, z: number, rad: number) => {
    let best = Infinity
    const r = Math.ceil(rad / C), ci = Math.floor(x / C), cj = Math.floor(z / C)
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) { const l = m.get(i * 100003 + j); if (l) for (let q = 0; q < l.length; q += 2) best = Math.min(best, Math.hypot(l[q] - x, l[q + 1] - z)) }
    return best
  }
  // main roads count as streets of the major family (the field runs along them); crossing streets start on them
  for (const r of o.mains) for (const p of r.pts) if (t.zone(p[0], p[2]) < 1.4) { put(grids[0], p[0], p[2]); put(all, p[0], p[2]) }
  const sep = (fam: number, x: number, z: number) => { const zn = clamp(t.zone(x, z), 0, 1); return fam === 0 ? lerp(52, 100, zn ** 1.3) : lerp(34, 70, zn ** 1.3) }
  const ok = (x: number, z: number) => t.zone(x, z) < 1.03 && !o.blocked(x, z)
  const trace = (sx: number, sz: number, fam: number): [number, number][] | null => {
    const half = (sg: number) => {
      const out: [number, number][] = []
      let x = sx, z = sz, [px, pz] = dirOf(x, z, fam === 1)
      px *= sg; pz *= sg
      for (let k = 0; k < 400; k++) {
        let [dx, dz] = dirOf(x, z, fam === 1)
        if (dx * px + dz * pz < 0) { dx = -dx; dz = -dz }
        let [mx, mz] = dirOf(x + dx * 2, z + dz * 2, fam === 1) // RK2
        if (mx * dx + mz * dz < 0) { mx = -mx; mz = -mz }
        const nx = x + mx * 4, nzv = z + mz * 4
        if (!ok(nx, nzv)) break
        const s = sep(fam, nx, nzv)
        if (k > 2 && nearest(grids[fam], nx, nzv, s * 0.5) < s * 0.5) break
        if (k > 1 && nearest(grids[1 - fam], nx, nzv, 3) < 2.5 && o.near(nx, nzv) < 2) { out.push([nx, nzv]); break } // reached a main road
        x = nx; z = nzv; px = mx; pz = mz
        out.push([x, z])
      }
      return out
    }
    const a = half(1), b = half(-1)
    const line = [...b.reverse(), [sx, sz] as [number, number], ...a]
    return line.length * 4 > sep(1, sx, sz) * 1.6 ? line : null
  }
  const lines: { pts: [number, number][]; fam: number }[] = []
  const seeds: [number, number, number][] = []
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, d = 45 + t.r * 0.04; seeds.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d, k % 2]) } // round the square
  for (const r of o.mains) for (let i = 2; i < r.pts.length - 2; i += 8) {
    const p = r.pts[i], q = r.pts[i + 1], l = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1, s = sep(0, p[0], p[2])
    if (t.zone(p[0], p[2]) > 0.95) continue
    seeds.push([p[0], p[2], 1], [p[0] - ((q[2] - p[2]) / l) * s, p[2] + ((q[0] - p[0]) / l) * s, 0], [p[0] + ((q[2] - p[2]) / l) * s, p[2] - ((q[0] - p[0]) / l) * s, 0])
  }
  let guard = 0
  while (seeds.length && guard++ < 4000) {
    const [sx, sz, fam] = seeds.shift()!
    if (!ok(sx, sz) || nearest(grids[fam], sx, sz, sep(fam, sx, sz)) < sep(fam, sx, sz) * 0.9) continue
    const ln = trace(sx, sz, fam)
    if (!ln) continue
    lines.push({ pts: ln, fam })
    for (const [x, z] of ln) { put(grids[fam], x, z); put(all, x, z) }
    // new seeds: one block away on either side for this family, and along it for the other
    for (let k = 3; k < ln.length - 3; k += 6) {
      const [x, z] = ln[k], [x2, z2] = ln[k + 1], l = Math.hypot(x2 - x, z2 - z) || 1, s = sep(fam, x, z)
      seeds.push([x - ((z2 - z) / l) * s, z + ((x2 - x) / l) * s, fam], [x + ((z2 - z) / l) * s, z - ((x2 - x) / l) * s, fam])
      if (k % 12 === 3) seeds.push([x, z, 1 - fam])
    }
  }
  // dangling ends reach out to the nearest street ahead (T-junctions) instead of stopping in a yard
  const ends = (pts: [number, number][]) => {
    for (const atEnd of [true, false]) {
      const p = atEnd ? pts[pts.length - 1] : pts[0], q = atEnd ? pts[pts.length - 2] : pts[1]
      if (!q) continue
      const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz) || 1
      for (let s = 4; s <= 28; s += 4) {
        const x = p[0] + (dx / l) * s, z = p[1] + (dz / l) * s
        if (o.blocked(x, z)) break
        if (nearest(all, x, z, 4) < 3 || o.near(x, z) < 1) { const ext: [number, number][] = []; for (let u = 4; u <= s; u += 4) ext.push([p[0] + (dx / l) * u, p[1] + (dz / l) * u]); if (atEnd) pts.push(...ext); else pts.unshift(...ext.reverse()); break }
      }
    }
  }
  // to roads: smoothed heights, capped grades; steep stretches of the minor family become stairs
  const roads: Road[] = []
  for (const ln of lines) {
    ends(ln.pts)
    const P: P3[] = ln.pts.map(([x, z]) => [x, o.H(x, z), z])
    const ys = P.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - 2); k <= Math.min(P.length - 1, i + 2); k++) { s += P[k][1]; c++ } return s / c })
    P.forEach((p, i) => { p[1] = ys[i] })
    let cur: P3[] = [P[0]], stairs = false
    const flush = () => {
      if (cur.length < 2) return
      const [x, , z] = cur[Math.floor(cur.length / 2)], w = o.wealth(x, z, cur[0][1]), zn = clamp(t.zone(x, z), 0, 1)
      roads.push(stairs ? { kind: 'stairs', width: 3, pts: cur, wealth: w } : { kind: ln.fam === 0 ? 'street' : 'lane', width: ln.fam === 0 ? lerp(7.5, 5, zn) + w * 1.5 : lerp(4.6, 3.4, zn) + w, pts: cur, wealth: w })
    }
    for (let i = 1; i < P.length; i++) {
      const g = Math.abs(P[i][1] - P[i - 1][1]) / (Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]) || 1), st = g > (ln.fam === 0 ? 0.24 : 0.2)
      if (st !== stairs && cur.length > 1) { flush(); cur = [P[i - 1]] }
      stairs = st
      cur.push(P[i])
    }
    flush()
  }
  return roads
}

/** The market square: a paved space at the core, longer along the main street, a fountain or well in it. */
export function squareOf(t: Town, H: (x: number, z: number) => number, mains: Road[]) {
  let a = 0, bd = Infinity
  for (const r of mains) for (let i = 0; i < r.pts.length - 1; i++) { const p = r.pts[i], d = Math.hypot(p[0] - t.core[0], p[2] - t.core[1]); if (d < bd) { bd = d; const q = r.pts[i + 1]; a = Math.atan2(q[2] - p[2], q[0] - p[0]) } }
  const w = clamp(t.r * 0.07, 22, 60), l = w * 1.5, level = H(t.core[0], t.core[1])
  return { x: t.core[0], z: t.core[1], a, w, l, level }
}

/** Is (x, z) on the square? */
export const onSquare = (s: ReturnType<typeof squareOf>, x: number, z: number, pad = 0) => {
  const c = Math.cos(s.a), sn = Math.sin(s.a), u = (x - s.x) * c + (z - s.z) * sn, v = -(x - s.x) * sn + (z - s.z) * c
  return Math.abs(u) < s.l / 2 + pad && Math.abs(v) < s.w / 2 + pad
}
export const lerpZ = (a: number, b: number, zn: number) => lerp(a, b, sstep(0, 1, zn))
