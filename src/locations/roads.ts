// Roads for a location, worked out on the height grid (world x, z; heights in metres). Pure.
// - Main roads join hubs (plazas, fronts of great buildings, bridge ends, gates, district centres) by least-cost paths:
//   steep grades cost a lot, so switchbacks appear by themselves, and cells already on a road are cheap, so roads merge
//   into trunks. A tree of the hubs (plus a few extra links for loops) decides which pairs to join.
// - Inside districts, lanes follow the contours (terraced mountain towns) and stairs climb straight between them; flat
//   districts get a loose grid instead.
// - Roads carve a bench into the ground, and buildings later keep off them and turn to face them.
import { rng } from '../world/noise.ts'

export type P3 = [number, number, number] // x, height, z
export interface Road { kind: 'main' | 'lane' | 'stairs'; width: number; pts: P3[]; wealth: number }
export interface Grid { N: number; size: number; heights: Float32Array }
type Hub = { x: number; z: number }

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }

export function sampler(g: Grid) {
  const { N, size, heights } = g, c = size / N, w = N + 1
  return (x: number, z: number) => {
    const fx = clamp((x + size / 2) / c, 0, N - 1e-6), fz = clamp((z + size / 2) / c, 0, N - 1e-6), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j
    return (heights[j * w + i] * (1 - tx) + heights[j * w + i + 1] * tx) * (1 - tz) + (heights[(j + 1) * w + i] * (1 - tx) + heights[(j + 1) * w + i + 1] * tx) * tz
  }
}

/** Least-cost routing on a coarse grid; `blocked(x, z)` cells are impassable. */
class Router {
  M: number; cell: number; h: Float32Array; onRoad: Uint8Array; block: Uint8Array
  private g: Float64Array; private from: Int32Array; private grid: Grid
  constructor(grid: Grid, blocked: (x: number, z: number) => boolean) {
    this.grid = grid
    const H = sampler(grid)
    this.M = Math.max(200, Math.min(700, Math.round(grid.size / 18)))
    this.cell = grid.size / this.M
    const n = (this.M + 1) ** 2
    this.h = new Float32Array(n); this.onRoad = new Uint8Array(n); this.block = new Uint8Array(n); this.g = new Float64Array(n); this.from = new Int32Array(n)
    for (let j = 0; j <= this.M; j++) for (let i = 0; i <= this.M; i++) { const [x, z] = this.xz(j * (this.M + 1) + i); this.h[j * (this.M + 1) + i] = H(x, z); this.block[j * (this.M + 1) + i] = blocked(x, z) ? 1 : 0 }
  }
  xz(k: number): [number, number] { const w = this.M + 1; return [-this.grid.size / 2 + (k % w) * this.cell, -this.grid.size / 2 + Math.floor(k / w) * this.cell] }
  at(x: number, z: number) { const w = this.M + 1; return clamp(Math.round((z + this.grid.size / 2) / this.cell), 0, this.M) * w + clamp(Math.round((x + this.grid.size / 2) / this.cell), 0, this.M) }
  /** A* from a to b; returns cell indices or null. Grades over 0.33 are impassable, over 0.12 steeply penalised. */
  route(a: number, b: number): number[] | null {
    const w = this.M + 1, { g, from, h, onRoad, block } = this
    g.fill(Infinity); from.fill(-1)
    const [bx, bz] = this.xz(b), heap: [number, number][] = [[0, a]]
    g[a] = 0
    const push = (f: number, k: number) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } } return top }
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [1, 2], [-2, 1], [-1, 2], [2, -1], [1, -2], [-2, -1], [-1, -2]]
    let iter = 0
    while (heap.length && iter++ < 3e6) {
      const [, k] = pop()
      if (k === b) break
      const i = k % w, j = Math.floor(k / w)
      for (const [di, dj] of D) {
        const ni = i + di, nj = j + dj
        if (ni < 0 || nj < 0 || ni > this.M || nj > this.M) continue
        const nk = nj * w + ni
        if (block[nk] && nk !== b) continue
        const d = Math.hypot(di, dj) * this.cell, grade = Math.abs(h[nk] - h[k]) / d
        if (grade > 0.33) continue
        const c = d * (1 + 60 * Math.max(0, grade - 0.07) ** 2 + (grade > 0.12 ? 3 : 0)) * (onRoad[nk] ? 0.35 : 1)
        if (g[k] + c < g[nk]) {
          g[nk] = g[k] + c; from[nk] = k
          const [x, z] = this.xz(nk)
          push(g[nk] + Math.hypot(x - bx, z - bz) * 0.6, nk)
        }
      }
    }
    if (from[b] < 0 && a !== b) return null
    const out = [b]
    while (out[out.length - 1] !== a) out.push(from[out[out.length - 1]])
    return out.reverse()
  }
}

/** Chaikin smoothing, then even spacing; heights from the ground, smoothed along the way. */
function finish(pts2: [number, number][], H: (x: number, z: number) => number, step: number, smoothH: number, maxGrade = Infinity): P3[] {
  let p = pts2
  for (let it = 0; it < 2 && p.length > 2; it++) {
    const q: [number, number][] = [p[0]]
    for (let i = 0; i < p.length - 1; i++) { const [ax, az] = p[i], [bx, bz] = p[i + 1]; q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]) }
    q.push(p[p.length - 1]); p = q
  }
  const out: [number, number][] = [p[0]]
  let carry = 0
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1], l = Math.hypot(bx - ax, bz - az)
    let t = step - carry
    while (t < l) { out.push([ax + ((bx - ax) * t) / l, az + ((bz - az) * t) / l]); t += step }
    carry = l - (t - step)
  }
  if (Math.hypot(out[out.length - 1][0] - p[p.length - 1][0], out[out.length - 1][1] - p[p.length - 1][1]) > step * 0.3) out.push(p[p.length - 1])
  const hs = out.map(([x, z]) => H(x, z)), n = Math.max(1, Math.round(smoothH / step))
  const ys = out.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - n); k <= Math.min(hs.length - 1, i + n); k++) { s += hs[k]; c++ } return s / c })
  if (maxGrade < Infinity) { // cap the grade both ways; the carve then cuts or fills the ground to meet the road
    const g = (i: number) => maxGrade * Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1])
    for (let i = 1; i < ys.length; i++) ys[i] = Math.min(ys[i - 1] + g(i), Math.max(ys[i - 1] - g(i), ys[i]))
    for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i + 1] + g(i + 1), Math.max(ys[i + 1] - g(i + 1), ys[i]))
  }
  return out.map(([x, z], i) => [x, ys[i], z] as P3)
}

/** Segment index for "how far to the nearest road" questions. */
export class RoadIndex {
  private cells = new Map<number, number[]>()
  segs: { ax: number; az: number; bx: number; bz: number; half: number; road: number }[] = []
  private cell: number; private reach: number
  /** `reach`: how far (m) `near` must see; segments are filed in every cell within that distance. */
  constructor(cell = 15, reach = 30) { this.cell = cell; this.reach = Math.ceil(reach / cell) }
  private key(i: number, j: number) { return i * 73856093 ^ j * 19349663 }
  add(r: Road, id: number) {
    for (let k = 0; k < r.pts.length - 1; k++) {
      const [ax, , az] = r.pts[k], [bx, , bz] = r.pts[k + 1], s = this.segs.length
      this.segs.push({ ax, az, bx, bz, half: r.width / 2, road: id })
      for (let j = Math.floor(Math.min(az, bz) / this.cell) - this.reach; j <= Math.floor(Math.max(az, bz) / this.cell) + this.reach; j++)
        for (let i = Math.floor(Math.min(ax, bx) / this.cell) - this.reach; i <= Math.floor(Math.max(ax, bx) / this.cell) + this.reach; i++) { const l = this.cells.get(this.key(i, j)) ?? []; l.push(s); this.cells.set(this.key(i, j), l) }
    }
  }
  /** Distance to the nearest road edge (negative on the road), the road's direction there, and which road. */
  near(x: number, z: number, skip = -1) {
    let best = Infinity, dx = 1, dz = 0, road = -1, px = 0, pz = 0
    for (const s of this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? []) {
      const q = this.segs[s]
      if (q.road === skip) continue
      const ex = q.bx - q.ax, ez = q.bz - q.az, l2 = ex * ex + ez * ez || 1, t = clamp(((x - q.ax) * ex + (z - q.az) * ez) / l2)
      const cx = q.ax + ex * t, cz = q.az + ez * t, d = Math.hypot(x - cx, z - cz) - q.half
      if (d < best) { best = d; const l = Math.sqrt(l2); dx = ex / l; dz = ez / l; road = q.road; px = cx; pz = cz }
    }
    return { d: best, dx, dz, road, px, pz }
  }
}

export interface RoadInput {
  grid: Grid; seed: number
  hubs: Hub[]; links: [Hub, Hub][]; force: [Hub, Hub][] // links: already joined (bridges); force: always routed (explicit roads)
  blocked: (x: number, z: number) => boolean
  districts: { inside: (x: number, z: number) => boolean; bbox: [number, number, number, number]; wealth: (h: number) => number; density: number }[]
}
export function planRoads(o: RoadInput): Road[] {
  const H = sampler(o.grid), R = rng(o.seed ^ 0x40ad), roads: Road[] = []
  const router = new Router(o.grid, o.blocked)
  const mark = (path: number[]) => { for (const k of path) router.onRoad[k] = 1 }
  const add = (cells: number[], width: number) => {
    if (cells.length < 2) return
    mark(cells)
    const pts = finish(cells.map((k) => router.xz(k)), H, 4, 14, 0.22)
    roads.push({ kind: 'main', width, pts, wealth: 0.5 })
  }
  // which hubs to join: a minimum spanning tree (bridges count as already joined), then a few short extra links
  const hubs = o.hubs, n = hubs.length, joined = new Set<string>()
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)
  const idx = (h: Hub) => hubs.indexOf(h)
  const comp = hubs.map((_, i) => i), find = (i: number): number => (comp[i] === i ? i : (comp[i] = find(comp[i])))
  for (const [a, b] of o.links) { const i = idx(a), j = idx(b); if (i >= 0 && j >= 0) { comp[find(i)] = find(j); joined.add(key(i, j)) } }
  const edges: [number, number, number][] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([Math.hypot(hubs[i].x - hubs[j].x, hubs[i].z - hubs[j].z), i, j])
  edges.sort((a, b) => a[0] - b[0])
  const todo: [number, number][] = []
  for (const [, i, j] of edges) if (find(i) !== find(j)) { comp[find(i)] = find(j); todo.push([i, j]) }
  for (let i = 0; i < n; i++) { // loops: join each hub to its second-nearest neighbour when it is close
    const near = edges.filter((e) => e[1] === i || e[2] === i).slice(0, 3)
    for (const [d, a, b] of near.slice(1)) if (d < o.grid.size * 0.18 && !joined.has(key(a, b)) && !todo.some(([p, q]) => key(p, q) === key(a, b))) { todo.push([a, b]); break }
  }
  for (const [a, b] of o.force) { const path = router.route(router.at(a.x, a.z), router.at(b.x, b.z)); if (path) add(path, 8) }
  for (const [i, j] of todo) {
    const path = router.route(router.at(hubs[i].x, hubs[i].z), router.at(hubs[j].x, hubs[j].z))
    if (path) add(path, 7)
  }
  // lanes and stairs inside the districts
  const idxR = new RoadIndex(10, 12)
  roads.forEach((r, i) => idxR.add(r, i))
  for (const d of o.districts) {
    const [x0, z0, x1, z1] = d.bbox
    const grad = (x: number, z: number): [number, number] => [(H(x + 3, z) - H(x - 3, z)) / 6, (H(x, z + 3) - H(x, z - 3)) / 6]
    let slopeSum = 0, cnt = 0
    for (let k = 0; k < 200; k++) { const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0); if (d.inside(x, z)) { slopeSum += Math.hypot(...grad(x, z)); cnt++ } }
    const spacing = 44 / Math.max(0.4, d.density)
    if (cnt && slopeSum / cnt < 0.07) { // flat: a loose grid turned to a random angle
      const a = R() * Math.PI, c = Math.cos(a), s = Math.sin(a), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, half = Math.hypot(x1 - x0, z1 - z0) / 2
      for (const dir of [0, 1]) for (let o2 = -half; o2 <= half; o2 += spacing * 1.6) {
        let cur: [number, number][] = []
        const flush = () => { if (cur.length > 8) { const r: Road = { kind: 'lane', width: 4.5, pts: finish(cur, H, 4, 6), wealth: d.wealth(H(...cur[0])) }; idxR.add(r, roads.length); roads.push(r) } cur = [] }
        for (let t = -half; t <= half; t += 4) {
          const u = dir ? o2 : t, v = dir ? t : o2, x = cx + u * c - v * s, z = cz + u * s + v * c
          if (d.inside(x, z) && !o.blocked(x, z)) cur.push([x, z]); else flush()
        }
        flush()
      }
      continue
    }
    // terraced: trace contour lanes from seeds, then stairs straight downhill to the next lane
    const first = roads.length
    for (let gz = z0; gz < z1; gz += spacing) for (let gx = x0; gx < x1; gx += spacing) {
      let x = gx + (R() - 0.5) * spacing, z = gz + (R() - 0.5) * spacing
      if (!d.inside(x, z) || o.blocked(x, z)) continue
      const w = d.wealth(H(x, z)), dh = 9 + 9 * w, level = Math.round(H(x, z) / dh) * dh
      for (let k = 0; k < 4; k++) { const [gx2, gz2] = grad(x, z), g2 = gx2 * gx2 + gz2 * gz2; if (g2 < 1e-4) break; const e = (H(x, z) - level) / g2; x -= gx2 * e; z -= gz2 * e }
      if (Math.abs(H(x, z) - level) > 1 || idxR.near(x, z).d < spacing * 0.35) continue
      const trace = (sgn: number) => {
        const out: [number, number][] = []
        let px = x, pz = z
        for (let k = 0; k < 160; k++) {
          const [gx2, gz2] = grad(px, pz), gl = Math.hypot(gx2, gz2)
          if (gl < 0.04) break
          px += (-gz2 / gl) * 4 * sgn; pz += (gx2 / gl) * 4 * sgn
          for (let it = 0; it < 2; it++) { const [a, b] = grad(px, pz), g2 = a * a + b * b; if (g2 < 1e-4) break; const e = (H(px, pz) - level) / g2; px -= a * e; pz -= b * e }
          if (!d.inside(px, pz) || o.blocked(px, pz) || (k > 2 && idxR.near(px, pz).d < 3)) break
          out.push([px, pz])
        }
        return out
      }
      const pts = [...trace(-1).reverse(), [x, z] as [number, number], ...trace(1)]
      if (pts.length < 12) continue
      const r: Road = { kind: 'lane', width: lerpW(w), pts: pts.map(([px, pz]) => [px, H(px, pz), pz] as P3), wealth: w }
      idxR.add(r, roads.length); roads.push(r)
    }
    for (let li = first, end = roads.length; li < end; li++) {
      const lane = roads[li]
      for (let k = 8; k < lane.pts.length - 8; k += 26 + Math.floor(R() * 14)) {
        let [x, , z] = lane.pts[k]
        const st: [number, number][] = [[x, z]]
        let hit = false
        for (let s = 0; s < 30; s++) {
          const [gx2, gz2] = grad(x, z), gl = Math.hypot(gx2, gz2)
          if (gl < 0.1) break
          x -= (gx2 / gl) * 3; z -= (gz2 / gl) * 3
          if (!d.inside(x, z) || o.blocked(x, z)) break
          st.push([x, z])
          const nr = idxR.near(x, z, li)
          if (s > 1 && nr.d < 0.5 && nr.road >= first) { hit = true; break }
        }
        if (!hit || st.length < 3) continue
        const r: Road = { kind: 'stairs', width: 3, pts: st.map(([px, pz]) => [px, H(px, pz), pz] as P3), wealth: lane.wealth }
        idxR.add(r, roads.length); roads.push(r)
      }
    }
  }
  return roads
}
const lerpW = (w: number) => 3.5 + w * 2.5

/** Grid vertices on or right beside a road (1), for quick "is this on a street" questions. */
export function roadMask(g: Grid, roads: Road[]) {
  const { N, size } = g, c = size / N, m = new Uint8Array((N + 1) * (N + 1))
  for (const r of roads) for (const [x, , z] of r.pts) {
    const rad = r.width / 2 + 2
    for (let j = Math.max(0, Math.floor((z - rad + size / 2) / c)); j <= Math.min(N, Math.ceil((z + rad + size / 2) / c)); j++)
      for (let i = Math.max(0, Math.floor((x - rad + size / 2) / c)); i <= Math.min(N, Math.ceil((x + rad + size / 2) / c)); i++) m[j * (N + 1) + i] = 1
  }
  return m
}

/** Cut a bench into the grid along every road (lanes gently, main roads with a wider shoulder). */
export function carve(g: Grid, roads: Road[], skip?: (x: number, z: number) => boolean) {
  const { N, size, heights } = g, c = size / N, w = N + 1
  const best = new Float32Array(heights.length).fill(0), target = new Float32Array(heights.length)
  for (const r of roads) {
    if (r.kind === 'stairs') continue
    const half = r.width / 2, sh = r.kind === 'main' ? 9 : 3
    for (let k = 0; k < r.pts.length; k++) {
      const [x, y, z] = r.pts[k], rad = half + sh
      if (skip?.(x, z)) continue // over a river the road goes on a bridge, not a dam
      for (let j = Math.max(0, Math.floor((z - rad + size / 2) / c)); j <= Math.min(N, Math.ceil((z + rad + size / 2) / c)); j++)
        for (let i = Math.max(0, Math.floor((x - rad + size / 2) / c)); i <= Math.min(N, Math.ceil((x + rad + size / 2) / c)); i++) {
          const d = Math.hypot(-size / 2 + i * c - x, -size / 2 + j * c - z), wt = 1 - sstep(half + 1, rad, d), a = j * w + i
          if (wt > best[a]) { best[a] = wt; target[a] = y - 0.15 }
        }
    }
  }
  for (let a = 0; a < heights.length; a++) if (best[a] > 0) heights[a] += (target[a] - heights[a]) * best[a]
}
