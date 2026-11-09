// Locations hydrology on the height grid (world x, z; row j = z, heights in metres). Pure.
// - fluvial: stream-power erosion (Braun & Willett's implicit scheme) at half resolution: every cell drains to its lowest
//   neighbour on the depression-filled surface, rivers incise in proportion to the square root of the area they drain,
//   so ranges get dendritic valleys, spurs and sharp ridges instead of noise. Pits are filled at the end.
// - lakes: the water level is found so the flooded basin has the asked-for area; the shore is the contour at that level,
//   so a lake fills its valley like real water, and is dammed (a moraine) only where it would spill out of its reach.
// - rivers: routed along the valley floors between their waypoints, bent into sine-generated meanders where the land is
//   flat (wavelength about eleven channel widths), carved with a bed and banks, never flowing uphill, falling over steps
//   into plunge pools, widening downstream, ending in an estuary funnel or a delta of distributaries at the sea.
import { fbm, rng, simplex } from '../world/noise.ts'
import { clamp, lerp, pathNearFast, polyLen, resample, sstep, type XY } from './terrain.ts'

export interface Grid { N: number; size: number; heights: Float32Array }

/** A binary min-heap of (key, value) in typed arrays. */
export class Heap {
  k: Float64Array; v: Int32Array; n = 0; key = 0 // key: the key of the last value popped
  constructor(cap: number) { this.k = new Float64Array(cap); this.v = new Int32Array(cap) }
  push(key: number, val: number) {
    if (this.n === this.k.length) { const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2); k.set(this.k); v.set(this.v); this.k = k; this.v = v }
    let i = this.n++
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p }
    this.k[i] = key; this.v[i] = val
  }
  pop(): number {
    this.key = this.k[0]
    const top = this.v[0], key = this.k[--this.n], val = this.v[this.n]
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= this.n) break
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++
      if (this.k[c] >= key) break
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c
    }
    this.k[i] = key; this.v[i] = val
    return top
  }
}
const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const

/** Below sea level but cut off from the open sea: these hollows are dry land, not ponds of sea water. */
export function drySeaPuddles(g: Grid, sea: number) {
  const { N, heights: h } = g, w = N + 1, seen = new Uint8Array(w * w), st: number[] = []
  for (let i = 0; i <= N; i++) for (const a of [i, N * w + i, i * w, i * w + N]) if (h[a] < sea && !seen[a]) { seen[a] = 1; st.push(a) }
  while (st.length) {
    const a = st.pop()!, i = a % w, j = (a / w) | 0
    for (const [di, dj] of NB8) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni > N || nj > N) continue; const b = nj * w + ni; if (!seen[b] && h[b] < sea) { seen[b] = 1; st.push(b) } }
  }
  for (let a = 0; a < h.length; a++) if (h[a] < sea && !seen[a]) h[a] = sea + 0.4 + (sea - h[a]) * 0.02
}

/** Stream-power erosion at half resolution; `mask` (0..1 per full-res vertex) is how erodible the ground is. Where
 * `hard` is set (cliffs), streams still cut down like everywhere else but the slope never slumps, so a cliff keeps its
 * face and is worn back with the land around it instead of being left standing as a wall. */
export function fluvial(g: Grid, mask: Float32Array, sea: number | null, strength: number, iters = 18, hard?: Uint8Array) {
  const { N, heights: H } = g, w = N + 1, M = N >> 1, m1 = M + 1, n = m1 * m1, dx = (g.size / N) * 2
  const h = new Float32Array(n), er = new Float32Array(n), rigid = new Uint8Array(n)
  for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) { const a = j * 2 * w + i * 2; h[j * m1 + i] = H[a]; er[j * m1 + i] = mask[a]; rigid[j * m1 + i] = hard?.[a] ?? 0 }
  const orig = h.slice(), recv = new Int32Array(n), order = new Int32Array(n), area = new Float32Array(n), done = new Uint8Array(n)
  const heap = new Heap(n), K = 0.0034 * strength, talus = 1.05 * dx
  for (let it = 0; it <= iters; it++) {
    // priority flood from the outlets (map edge and sea): pop order is a valid downstream-first order, receivers point downhill
    done.fill(0); recv.fill(-1); heap.n = 0
    for (let k = 0; k < n; k++) { const i = k % m1, j = (k / m1) | 0; if (i === 0 || j === 0 || i === M || j === M || (sea != null && h[k] <= sea)) { done[k] = 1; heap.push(h[k], k) } }
    let cnt = 0
    const fill = new Float32Array(h)
    while (heap.n) {
      const k = heap.pop()
      order[cnt++] = k
      const i = k % m1, j = (k / m1) | 0
      for (const [di, dj] of NB8) {
        const ni = i + di, nj = j + dj
        if (ni < 0 || nj < 0 || ni > M || nj > M) continue
        const q = nj * m1 + ni
        if (done[q]) continue
        done[q] = 1; recv[q] = k
        fill[q] = Math.max(h[q], fill[k] + 1e-3)
        heap.push(fill[q], q)
      }
    }
    if (it === iters) { for (let k = 0; k < n; k++) if (er[k] > 0.05 && fill[k] - h[k] < 10) h[k] = lerp(h[k], fill[k], er[k]); break } // fill the small pits left over (big basins stay hollows)
    // steepest real descent where there is one, else the flood's receiver (the way out of a hollow)
    for (let k = 0; k < n; k++) {
      const i = k % m1, j = (k / m1) | 0
      let best = recv[k], bs = 0
      for (const [di, dj] of NB8) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni > M || nj > M) continue; const q = nj * m1 + ni, sl = (fill[k] - fill[q]) / (di && dj ? 1.414 : 1); if (sl > bs) { bs = sl; best = q } }
      if (best >= 0 && fill[best] < fill[k]) recv[k] = best
    }
    // drainage area, upstream to downstream; then incision, downstream first (implicit, so it is stable at any rate)
    area.fill(dx * dx)
    for (let o = n - 1; o >= 0; o--) { const k = order[o], r = recv[k]; if (r >= 0) area[r] += area[k] }
    for (let o = 0; o < n; o++) {
      const k = order[o], r = recv[k]
      if (r < 0 || er[k] <= 0 || h[k] <= h[r]) continue
      const i = k % m1, j = (k / m1) | 0, ri = r % m1, rj = (r / m1) | 0, dist = Math.hypot(i - ri, j - rj) * dx
      const F = (K * er[k] * Math.sqrt(area[k])) / dist
      h[k] = (h[k] + F * h[r]) / (1 + F)
    }
    // slopes steeper than the talus angle slump (cliffs, which are masked off, keep their faces)
    for (let j = 1; j < M; j++) for (let i = 1; i < M; i++) {
      const k = j * m1 + i
      if (er[k] < 0.5 || rigid[k]) continue
      let lo = k
      for (const [di, dj] of NB8) { const q = (j + dj) * m1 + i + di; if (h[q] < h[lo]) lo = q }
      const ex = h[k] - h[lo] - talus
      if (ex > 0 && !rigid[lo]) { h[k] -= ex * 0.35; h[lo] += ex * 0.35 }
    }
  }
  // add the change back to the full-resolution grid (bilinear), so the fine detail stays
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const fi = Math.min(M - 1e-6, i / 2), fj = Math.min(M - 1e-6, j / 2), i0 = Math.floor(fi), j0 = Math.floor(fj), tx = fi - i0, tz = fj - j0, k = j0 * m1 + i0
    const d = (h[k] - orig[k]) * (1 - tx) * (1 - tz) + (h[k + 1] - orig[k + 1]) * tx * (1 - tz) + (h[k + m1] - orig[k + m1]) * (1 - tx) * tz + (h[k + m1 + 1] - orig[k + m1 + 1]) * tx * tz
    H[j * w + i] += d
  }
}

// ---------- lakes ----------
export interface Lake { id: string; at: XY; r: number; level: number; cells: Int32Array }
/** Flood a basin from its middle (or along its line) at `level`, no further than `reach` from it; returns cells and leaks. */
function flood(g: Grid, seeds: number[], level: number, near: (i: number, j: number) => boolean, cap: number) {
  const { N, heights: h } = g, w = N + 1, seen = new Set<number>(), st: number[] = [], cells: number[] = [], leaks: number[] = []
  for (const a of seeds) if (h[a] < level) { seen.add(a); st.push(a) }
  while (st.length && cells.length < cap) {
    const a = st.pop()!, i = a % w, j = (a / w) | 0
    cells.push(a)
    for (const [di, dj] of NB8) {
      const ni = i + di, nj = j + dj, b = nj * w + ni
      if (ni < 0 || nj < 0 || ni > N || nj > N || seen.has(b) || h[b] >= level) continue
      seen.add(b)
      if (!near(ni, nj)) { leaks.push(b); continue }
      st.push(b)
    }
  }
  return { cells, leaks, full: cells.length >= cap }
}
export function makeLake(g: Grid, id: string, line: XY[], radius: number, depth: number, level: number | undefined, seed: number): Lake | null {
  const { N, size, heights: h } = g, w = N + 1, c = size / N
  const idx = (p: XY) => clamp(Math.round((size / 2 - p[1]) / c), 0, N) * w + clamp(Math.round((p[0] + size / 2) / c), 0, N)
  const pts = line.length > 1 ? resample(line, c) : line, seeds = pts.map(idx), reach = radius * 1.9, nz = simplex(seed)
  const xy = (i: number, j: number): XY => [-size / 2 + i * c, size / 2 - j * c]
  const near = (i: number, j: number) => { const [x, y] = xy(i, j), d = line.length > 1 ? pathNearFast(line, x, y, reach * 1.5).d : Math.hypot(x - line[0][0], y - line[0][1]); return d < reach * (1 + 0.25 * fbm(nz, x / radius, 1, y / radius, 2)) }
  const target = (line.length > 1 ? polyLen(line) * radius * 2 : Math.PI * radius * radius) / (c * c), cap = Math.ceil(target * 6)
  let lv = level
  if (lv == null) { // the level whose flooded area is the size asked for
    const g0 = Math.min(...seeds.map((a) => h[a]))
    let lo = g0, hi = g0 + 600
    for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2, f = flood(g, seeds, mid, near, cap); if (f.cells.length < target && !f.full) lo = mid; else hi = mid }
    lv = lo
  }
  // the basin's floor is its own: deepen it away from the shore, so it shelves into deep water
  for (const a of seeds) if (h[a] >= lv) h[a] = lv - 0.6
  const f = flood(g, seeds, lv, near, cap)
  if (f.cells.length < 3) return null
  const inside = new Set(f.cells), dist = new Map<number, number>(), q: number[] = []
  { // little dry specks enclosed by the water are noise, not islands: sink them (real islands, big ones, stay)
    let i0 = N, j0 = N, i1 = 0, j1 = 0
    for (const a of f.cells) { const i = a % w, j = (a / w) | 0; i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j) }
    i0 = Math.max(0, i0 - 2); j0 = Math.max(0, j0 - 2); i1 = Math.min(N, i1 + 2); j1 = Math.min(N, j1 + 2)
    const seen = new Set<number>()
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const a0 = j * w + i
      if (inside.has(a0) || seen.has(a0)) continue
      const group: number[] = [a0], st = [a0]
      let open = false
      seen.add(a0)
      while (st.length) { const a = st.pop()!, ai = a % w, aj = (a / w) | 0; if (ai <= i0 || aj <= j0 || ai >= i1 || aj >= j1) open = true; for (const [di, dj] of NB8) { const ni = ai + di, nj = aj + dj; if (ni < i0 || nj < j0 || ni > i1 || nj > j1) continue; const b = nj * w + ni; if (!inside.has(b) && !seen.has(b)) { seen.add(b); group.push(b); st.push(b) } } }
      if (!open && group.length < Math.max(6, f.cells.length * 0.03)) for (const a of group) { h[a] = lv - 0.8; inside.add(a); f.cells.push(a) }
    }
  }
  for (const a of f.cells) { const i = a % w, j = (a / w) | 0; if (NB8.some(([di, dj]) => !inside.has((j + dj) * w + i + di))) { dist.set(a, 1); q.push(a) } }
  for (let k = 0; k < q.length; k++) { const a = q[k], i = a % w, j = (a / w) | 0, d = dist.get(a)!; for (const [di, dj] of NB8) { const b = (j + dj) * w + i + di; if (inside.has(b) && !dist.has(b)) { dist.set(b, d + 1); q.push(b) } } }
  for (const a of f.cells) { const d = dist.get(a) ?? 1, bed = Math.min(lv - 0.7, lv - Math.min(depth, 0.8 + d * c * 0.12) + fbm(nz, (a % w) / 9, 3, ((a / w) | 0) / 9, 2) * Math.min(4, depth * 0.1) * sstep(1, 5, d)); h[a] = Math.min(h[a], bed) }
  // where it would spill out of its reach, a moraine dam holds it
  for (const a of f.leaks) { const i = a % w, j = (a / w) | 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni > N || nj > N) continue; const b = nj * w + ni; if (!inside.has(b)) h[b] = Math.max(h[b], lv + 1.6 - Math.hypot(di, dj) * 0.5) } }
  let sx = 0, sy = 0, r = 0
  for (const a of f.cells) { const [x, y] = xy(a % w, (a / w) | 0); sx += x; sy += y }
  const at: XY = [sx / f.cells.length, sy / f.cells.length]
  for (const a of f.cells) { const [x, y] = xy(a % w, (a / w) | 0); r = Math.max(r, Math.hypot(x - at[0], y - at[1])) }
  return { id, at, r: r + c * 2, level: lv, cells: Int32Array.from(f.cells) }
}

// ---------- rivers ----------
export interface River { id: string; path: XY[]; width: number; prof: number[]; wid: number[]; step: number; pools: { at: XY; r: number; depth: number; lvl: number }[]; mouth: number }
/** Least-cost path between waypoints on a coarse grid: climbing is dear and high ground costs more, so the line keeps to the valley floor. */
export function routeRiver(g: Grid, way: XY[], corridor: number): XY[] {
  const { N, size, heights: H } = g, w = N + 1
  const h = (x: number, y: number) => { const i = clamp(Math.round((x + size / 2) / (size / N)), 0, N), j = clamp(Math.round((size / 2 - y) / (size / N)), 0, N); return H[j * w + i] }
  return routeLine(h, [-size / 2, -size / 2, size / 2, size / 2], (size / N) * 3, way, corridor)
}
/** The same for any ground function over any box (glaciers route on the shaped ground before there is a grid). */
export function routeLine(ground: (x: number, y: number) => number, box: [number, number, number, number], c: number, way: XY[], corridor: number): XY[] {
  const [bx0, by0, bx1, by1] = box, mw = Math.max(2, Math.ceil((bx1 - bx0) / c)), mh = Math.max(2, Math.ceil((by1 - by0) / c)), m1 = mw + 1
  const hc = new Float32Array(m1 * (mh + 1))
  for (let j = 0; j <= mh; j++) for (let i = 0; i <= mw; i++) hc[j * m1 + i] = ground(bx0 + i * c, by1 - j * c)
  const xy = (k: number): XY => [bx0 + (k % m1) * c, by1 - ((k / m1) | 0) * c], at = (p: XY) => clamp(Math.round((by1 - p[1]) / c), 0, mh) * m1 + clamp(Math.round((p[0] - bx0) / c), 0, mw)
  const gcost = new Float64Array(m1 * (mh + 1)), from = new Int32Array(m1 * (mh + 1)), heap = new Heap(1024), out: XY[] = []
  for (let s = 0; s < way.length - 1; s++) {
    const a = at(way[s]), b = at(way[s + 1]), seg = [way[s], way[s + 1]] as XY[], [bx, by] = xy(b)
    gcost.fill(Infinity); from.fill(-1); heap.n = 0; gcost[a] = 0; heap.push(0, a)
    while (heap.n) {
      const k = heap.pop()
      if (k === b) break
      if (heap.key > gcost[k] + 1e-9) continue
      const i = k % m1, j = (k / m1) | 0
      for (const [di, dj] of NB8) {
        const ni = i + di, nj = j + dj
        if (ni < 0 || nj < 0 || ni > mw || nj > mh) continue
        const q = nj * m1 + ni, len = Math.hypot(di, dj) * c, dh = hc[q] - hc[k]
        const [x, y] = xy(q)
        if (pathNearFast(seg, x, y, corridor).d === Infinity) continue
        const cost = len * (1 + (3 * Math.abs(dh)) / len) + 40 * Math.max(0, dh)
        if (gcost[k] + cost < gcost[q]) { gcost[q] = gcost[k] + cost; from[q] = k; heap.push(gcost[q] + Math.hypot(x - bx, y - by) * 0.9, q) }
      }
    }
    const cells: number[] = [b]
    while (cells[cells.length - 1] !== a && from[cells[cells.length - 1]] >= 0) cells.push(from[cells[cells.length - 1]])
    if (cells[cells.length - 1] !== a) { out.push(...(s ? seg.slice(1) : seg)); continue }
    const pts = cells.reverse().map(xy)
    pts[0] = way[s]; pts[pts.length - 1] = way[s + 1]
    out.push(...(s ? pts.slice(1) : pts))
  }
  // smooth the grid steps away (Chaikin, three times)
  let p = out
  for (let it = 0; it < 3 && p.length > 2; it++) {
    const q: XY[] = [p[0]]
    for (let i = 0; i < p.length - 1; i++) { const [ax, ay] = p[i], [bx, by] = p[i + 1]; q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]) }
    q.push(p[p.length - 1]); p = q
  }
  return p
}
/** Sine-generated meanders (Langbein & Leopold) where the valley is flat: the channel's heading swings to and fro around
 * the valley axis, so loops form on their own; on steep ground the river runs nearly straight. */
export function meanderRiver(axis: XY[], ground: (x: number, y: number) => number, width: (t: number) => number, amount: number, seed: number): XY[] {
  if (amount <= 0 || axis.length < 3) return axis
  const ax = resample(axis, 10), n = ax.length, total = (n - 1) * 10, nz = simplex(seed), R = rng(seed)
  const hs = ax.map((p) => ground(p[0], p[1])), slope = ax.map((_, i) => { const a = Math.max(0, i - 40), b = Math.min(n - 1, i + 40); return Math.abs(hs[a] - hs[b]) / ((b - a) * 10 || 1) })
  const dir = ax.map((_, i) => { const a = ax[Math.max(0, i - 3)], b = ax[Math.min(n - 1, i + 3)]; return Math.atan2(b[1] - a[1], b[0] - a[0]) })
  const out: XY[] = [ax[0]]
  let x = ax[0][0], y = ax[0][1], k = 0, phase = R() * Math.PI * 2, guard = 0
  const ds = 5
  while (k < n - 2 && guard++ < 200000) {
    // where along the axis we are, and how far off it
    let best = k, bd = Infinity
    for (let q = k; q < Math.min(n, k + 30); q++) { const d = Math.hypot(ax[q][0] - x, ax[q][1] - y); if (d < bd) { bd = d; best = q } }
    k = best
    const t = (k * 10) / total, wv = width(t), flat = 1 - sstep(0.002, 0.018, slope[k]), m = amount * flat * sstep(0, 300, k * 10) * sstep(0, 300, total - k * 10)
    const lam = clamp(11 * wv, 60, 1600) * (0.85 + 0.3 * (fbm(nz, k / 40, 1, 0, 2) + 0.5)), omega = (1.15 + 0.5 * fbm(nz, k / 70, 5, 0, 2)) * m
    const off = (ax[k][0] - x) * -Math.sin(dir[k]) + (ax[k][1] - y) * Math.cos(dir[k]) // positive if the axis lies to our left
    const belt = Math.max(wv * 3, lam * 0.45 * m)
    phase += (ds / lam) * Math.PI * 2
    const head = dir[k] + omega * Math.sin(phase) + clamp(off / belt, -1.2, 1.2) * 0.6
    x += Math.cos(head) * ds; y += Math.sin(head) * ds
    out.push([x, y])
  }
  out.push(ax[n - 1])
  return out
}

export interface RiverIn { id: string; way: XY[]; width: number; depth: number; meander: number; follow: boolean; mouth?: 'estuary' | 'delta' | 'none' }
/** Route, bend and carve a river into the grid; returns its line and water profile. `lakeAt` gives a lake's level. */
export function carveRiver(g: Grid, r: RiverIn, sea: number | null, lakeAt: (x: number, y: number) => number | null, seed: number): River {
  const { N, size, heights: h } = g, w = N + 1, c = size / N
  const H = (x: number, y: number) => { const fx = clamp((x + size / 2) / c, 0, N - 1e-6), fy = clamp((size / 2 - y) / c, 0, N - 1e-6), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j; return (h[j * w + i] * (1 - tx) + h[j * w + i + 1] * tx) * (1 - ty) + (h[(j + 1) * w + i] * (1 - tx) + h[(j + 1) * w + i + 1] * tx) * ty }
  const axis = r.follow ? routeRiver(g, r.way, Math.max(1200, polyLen(r.way) * 0.15)) : r.way
  const wAt = (t: number) => r.width * (0.35 + 0.65 * t ** 0.6)
  const path = meanderRiver(axis, H, wAt, r.meander, seed), step = 5, pts = resample(path, step), n = pts.length
  // the water surface: the ground along the line, never rising; lakes hold it at their level; the sea is the floor
  const prof: number[] = [], wid: number[] = []
  // the level is the lowest ground across the whole channel and its banks, so the water never stands above a bank
  let low = Infinity
  const ground: number[] = []
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i], lk = lakeAt(x, y), p = pts[Math.max(0, i - 2)], q = pts[Math.min(n - 1, i + 2)], dl = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    const nx = -(q[1] - p[1]) / dl, ny = (q[0] - p[0]) / dl, wv = wAt(i / Math.max(1, n - 1)), off = wv * 0.6 + 12
    ground.push(H(x, y))
    // the banks: across the channel and out past its edge, also turned a little up and down stream (on a steep reach
    // the ground beside the water falls with it, so a bank seen slightly downstream is the one that limits the water)
    let bank = Math.min(H(x, y), H(x + nx * wv * 0.5, y + ny * wv * 0.5), H(x - nx * wv * 0.5, y - ny * wv * 0.5))
    for (const d of [off * 0.8, off, off * 1.25]) for (const a of [-0.35, 0, 0.35]) {
      const ca = Math.cos(a), sa = Math.sin(a), ux = nx * ca - ny * sa, uy = ny * ca + nx * sa, vx2 = nx * ca + ny * sa, vy2 = ny * ca - nx * sa
      bank = Math.min(bank, H(x + ux * d, y + uy * d), H(x - vx2 * d, y - vy2 * d))
    }
    low = Math.min(low, lk ?? bank - 1)
    if (sea != null) low = Math.max(low, sea)
    prof.push(low); wid.push(wv)
  }
  // the running minimum is a staircase wherever the floor is bumpy: a fall at every dip. A river wears small steps back
  // into a steady incline (rapids) and keeps only the big ones as falls, one per reach.
  {
    // sizes follow the river: a fall is a step over 2.5 channel depths (else rapids), falls closer than 7 widths are one
    // reach, and the grade is read over 8 widths (a creek and a great river both)
    const F = Math.max(6, r.depth * 2.5), reach = Math.max(150, r.width * 7), lip = new Uint8Array(n), runs: [number, number, number][] = [] // [first step, last step, drop]
    for (let i = 0; i + 3 < n; i++) if (prof[i] - prof[i + 3] > F && prof[i] - prof[i + 1] > 0.5) { // a big step close ahead, starting here
      let j = i; while (j + 1 < n && prof[j] - prof[j + 1] > 0.5) j++
      const last = runs[runs.length - 1]
      if (last && i <= last[1] + 1) { last[1] = Math.max(last[1], j); last[2] = prof[last[0]] - prof[last[1]] } else runs.push([i, j, prof[i] - prof[j]])
      i = j
    }
    // one fall per reach: the biggest of any that close together
    const keep = runs.filter((r) => !runs.some((o) => o !== r && Math.abs(o[0] - r[0]) * step < reach && (o[2] > r[2] || (o[2] === r[2] && o[0] < r[0]))))
    for (const [a, b] of keep) for (let k = a; k < b; k++) lip[k] = 1
    // allowed fall per step elsewhere: a little steeper than the reach's own grade, leaving the falls
    // themselves out of that grade (else every step beside a fall would pass as one)
    const W = Math.round(Math.max(150, r.width * 8) / step), out = prof.slice(), fell = new Float64Array(n)
    for (let i = 1; i < n; i++) fell[i] = fell[i - 1] + (lip[i - 1] ? prof[i - 1] - prof[i] : 0)
    for (let i = n - 2; i >= 0; i--) {
      if (lip[i]) continue
      const a = Math.max(0, i - W), b = Math.min(n - 1, i + W), g = (prof[a] - prof[b] - (fell[b] - fell[a])) / ((b - a) * step || 1)
      out[i] = Math.min(prof[i], out[i + 1] + step * Math.max(0.02, 1.3 * g))
    }
    for (let i = 0; i < n; i++) prof[i] = out[i]
  }
  // how deep the river has to cut below the land here (smoothed along it): the deeper the cut, the wider its valley
  const cut = ground.map((g, i) => Math.max(0, g - prof[i])).map((_, i, a) => { let s = 0, c2 = 0; for (let k = Math.max(0, i - 12); k <= Math.min(n - 1, i + 12); k++) { s += a[k]; c2++ } return s / c2 })
  // an estuary: the last stretch opens in a funnel, its width growing exponentially toward the sea
  const reachesSea = sea != null && prof[n - 1] <= sea + 0.01
  let mouth = n
  if (reachesSea && r.mouth !== 'none') { mouth = prof.findIndex((v) => v <= sea! + 0.01); if (mouth < 0) mouth = n }
  const est = reachesSea && r.mouth !== 'delta' && r.mouth !== 'none' ? Math.min(n - 1, Math.round(Math.min(r.width * 70, (n * step) * 0.3) / step)) : 0
  const e0 = Math.max(0, mouth - est)
  for (let i = e0; i < n; i++) { // a drowned valley: the water falls to the sea's level as the channel opens out
    const t = Math.min(1, (i - e0) / Math.max(1, mouth - e0))
    wid[i] *= Math.exp(2.6 * t ** 1.3)
    if (est) prof[i] = t > 0.3 ? sea! : Math.max(sea!, Math.min(prof[i], lerp(prof[e0], sea!, t / 0.3)))
  }
  // carve: a bed under the water, banks that rise to the land. Each grid vertex takes its shape from its own nearest point
  // of the river (never from a point further down, which would cut the bed below the water upstream)
  const nz = simplex(seed ^ 0x77), cand = new Set<number>()
  // banks rise to the land at the edge of a strip that widens with the cut, so a deep cut is a valley with sloping sides
  // (about 20 degrees), not a trench with vertical walls
  const shape = (i: number) => { const ww = wid[i], est01 = i >= e0 && est ? (i - e0) / Math.max(1, n - e0) : 0; return { half: ww / 2, plain: Math.min(400, Math.max(12 + ww * 1.2, cut[i] * 2.7)), rise: Math.max(6 + ww * 0.15, cut[i] + 3), depth: r.depth * (0.6 + 0.4 * (i / n)) + (est01 ? 2.5 : 0), est01, ww } }
  for (let i = 0; i < n; i += 2) {
    const [x, y] = pts[i], s = shape(i), rad = s.half + s.plain
    for (let j = Math.max(0, Math.floor((size / 2 - y - rad) / c)); j <= Math.min(N, Math.ceil((size / 2 - y + rad) / c)); j++)
      for (let k = Math.max(0, Math.floor((x - rad + size / 2) / c)); k <= Math.min(N, Math.ceil((x + rad + size / 2) / c)); k++) cand.add(j * w + k)
  }
  const maxRad = Math.max(...wid) / 2 + 400
  for (const a of cand) {
    const vx = -size / 2 + (a % w) * c, vy = size / 2 - ((a / w) | 0) * c, near = pathNearFast(pts, vx, vy, maxRad)
    if (near.d === Infinity) continue
    const i = clamp(Math.round(near.s / step), 0, n - 1), s = shape(i), d = near.d, surf = prof[i]
    if (d > s.half + s.plain) continue
    const t = d < s.half ? surf - s.depth * (1 - (d / s.half) ** 2) + (s.est01 ? fbm(nz, vx / 80, 1, vy / 80, 3) * s.depth * 0.8 * s.est01 : 0) // shoals in the estuary
      : surf + 0.6 + ((d - s.half) / s.plain) ** 1.6 * s.rise - 0.9 * s.est01 // banks; mud flats at the mouth
    if (t < h[a]) h[a] = t
  }
  // plunge pools below falls
  const pools: River['pools'] = []
  for (let i = 3; i < n; i++) if (prof[i - 3] - prof[i] > 12 && (i + 1 >= n || prof[i] - prof[i + 1] < 3) && !pools.some((p) => Math.hypot(p.at[0] - pts[i][0], p.at[1] - pts[i][1]) < 60)) {
    const at = pts[Math.min(i + 1, n - 1)], pr = wid[i] * 1.6, pd = 6 + Math.min(12, (prof[i - 3] - prof[i]) * 0.1), lvl = prof[Math.min(i + 1, n - 1)]
    pools.push({ at, r: pr, depth: pd, lvl })
    for (let j = Math.max(0, Math.floor((size / 2 - at[1] - pr) / c)); j <= Math.min(N, Math.ceil((size / 2 - at[1] + pr) / c)); j++)
      for (let k = Math.max(0, Math.floor((at[0] - pr + size / 2) / c)); k <= Math.min(N, Math.ceil((at[0] + pr + size / 2) / c)); k++) { const d = Math.hypot(-size / 2 + k * c - at[0], size / 2 - j * c - at[1]); if (d < pr) h[j * w + k] = Math.min(h[j * w + k], lvl - pd * (1 - (d / pr) ** 2)) }
  }
  return { id: r.id, path: pts, width: r.width, prof, wid, step, pools, mouth }
}

/** A delta: the river splits at its apex into distributaries that fan out across a low plain of its own mud. */
export function carveDelta(g: Grid, rv: River, sea: number, seed: number, wet?: (x: number, y: number, r: number) => void) {
  const { N, size, heights: h } = g, w = N + 1, c = size / N, R = rng(seed), nz = simplex(seed)
  // the apex is where the river has come down to the sea's level, never further up (a distributary cut at sea level
  // through land the river still crosses 70 m up would be a trench beside it)
  const n = rv.path.length, end = rv.path[n - 1], low = rv.prof.findIndex((v) => v <= sea + 2)
  const ai = Math.max(1, n - 1 - Math.round(Math.min(rv.width * 90, (n * rv.step) * 0.35) / rv.step), low < 0 ? n : low)
  if (ai >= n - 2) return [] // it never gets down to the sea
  // the fan grows out into the sea from there: at least ~20 river widths, however short the low stretch on land
  const L = (n - 1 - ai) * rv.step, back = rv.path[Math.max(0, Math.min(ai, n - 1 - Math.round(200 / rv.step)))]
  const apex = rv.path[ai], dir = Math.atan2(end[1] - back[1], end[0] - back[0]), Rf = Math.max(L * 1.25, rv.width * 20)
  // the plain: a lobed fan just above the sea, sloping into the water at its front
  for (let j = 0; j <= N; j++) {
    const y = size / 2 - j * c
    if (Math.abs(y - apex[1]) > Rf * 1.3) continue
    for (let k = 0; k <= N; k++) {
      const x = -size / 2 + k * c, d = Math.hypot(x - apex[0], y - apex[1])
      if (d > Rf * 1.3) continue
      let da = Math.atan2(y - apex[1], x - apex[0]) - dir; da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2
      // a rounded, gently lobed front that draws in at the sides (not a sector with notches between the channels)
      const lobe = Rf * (0.9 + 0.07 * Math.cos(da * 3) + 0.18 * fbm(nz, Math.cos(da) * 2, Math.sin(da) * 2, 1, 3)) * Math.cos(Math.min(1.45, Math.abs(da) * 1.25)) ** 0.6
      if (Math.abs(da) > 1.1) continue
      const t = d / lobe, a = j * w + k, top = sea + 1.4 * (1 - t) ** 0.5 + fbm(nz, x / 90, 3, y / 90, 3) * 0.8
      const v = t < 1 ? top : sea - (t - 1) * 30
      if (v > h[a] && t < 1.25) { h[a] = lerp(h[a], v, sstep(1.1, 0.95, Math.abs(da))); if (t < 0.97 && Math.abs(da) < 1) wet?.(x, y, c * 1.2) }
    }
  }
  // the distributaries, branching from the apex across the plain to the sea
  const k = 3 + Math.floor(R() * 3), lines: XY[][] = []
  for (let q = 0; q < k; q++) {
    const a = dir + (q / (k - 1) - 0.5) * 1.5 + (R() - 0.5) * 0.25, ln: XY[] = []
    for (let s = 0; s <= Rf * 1.25; s += 8) { const wob = (fbm(nz, s / 260, q * 7, 0, 2) * 0.12 + fbm(nz, s / 90, q * 7 + 3, 0, 2) * 0.03) * Rf * Math.min(1, s / (Rf * 0.3)); ln.push([apex[0] + Math.cos(a) * s - Math.sin(a) * wob, apex[1] + Math.sin(a) * s + Math.cos(a) * wob]) }
    lines.push(ln)
    const cw = Math.max(8, rv.width * (q === Math.floor(k / 2) ? 0.6 : 0.35))
    for (const [x, y] of ln) for (let j = Math.max(0, Math.floor((size / 2 - y - cw) / c)); j <= Math.min(N, Math.ceil((size / 2 - y + cw) / c)); j++)
      for (let kk = Math.max(0, Math.floor((x - cw + size / 2) / c)); kk <= Math.min(N, Math.ceil((x + cw + size / 2) / c)); kk++) { const d = Math.hypot(-size / 2 + kk * c - x, size / 2 - j * c - y); if (d < cw) h[j * w + kk] = Math.min(h[j * w + kk], sea - 1.8 * (1 - (d / cw) ** 2) - 0.2) }
  }
  return lines
}
