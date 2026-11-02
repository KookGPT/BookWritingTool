// Lines that belong to the land: borders and roads routed along rivers, ridges and coasts, and regions filled up to
// coasts and existing borders. Pure: works on the generated grid at a third of its resolution.
import type { Gen, XY } from './gen.ts'

export const FOLLOW = { free: 'Free hand', natural: 'Rivers & ridges', river: 'Rivers', ridge: 'Ridges', coast: 'Coasts' } as const
export type Follow = keyof typeof FOLLOW

const COAST = 1, RIVER = 2, RIDGE = 4
interface Grid { cw: number; ch: number; cs: number; h: Float32Array; flags: Uint8Array }
const cache = new WeakMap<Gen, Grid>()

/** A coarse copy of the ground marking coasts, rivers and ridgelines. */
export function gridOf(g: Gen): Grid {
  const hit = cache.get(g)
  if (hit) return hit
  const S = 3, cw = Math.ceil(g.w / S), ch = Math.ceil(g.h / S), n = cw * ch, cs = g.cell * S
  const h = new Float32Array(n), flags = new Uint8Array(n)
  for (let b = 0; b < ch; b++) for (let a = 0; a < cw; a++) h[b * cw + a] = g.height[Math.min(g.h - 1, b * S + 1) * g.w + Math.min(g.w - 1, a * S + 1)]
  // coasts: land cells next to the sea
  for (let b = 0; b < ch; b++) for (let a = 0; a < cw; a++) {
    const k = b * cw + a
    if (h[k] >= 0 && ((a > 0 && h[k - 1] < 0) || (a < cw - 1 && h[k + 1] < 0) || (b > 0 && h[k - cw] < 0) || (b < ch - 1 && h[k + cw] < 0))) flags[k] |= COAST
  }
  // rivers, as drawn
  const G = { cw, ch, cs, h, flags }
  for (const r of g.rivers) for (let q = 1; q < r.pts.length; q++) walk(g, G, r.pts[q - 1], r.pts[q], (k) => { if (h[k] >= 0) flags[k] |= RIVER })
  // ridgelines: cells standing well above their surroundings, high up
  const R = 3, blur = new Float32Array(n)
  for (let b = 0; b < ch; b++) for (let a = 0; a < cw; a++) {
    let s = 0, m = 0
    for (let y = Math.max(0, b - R); y <= Math.min(ch - 1, b + R); y++) for (let x = Math.max(0, a - R); x <= Math.min(cw - 1, a + R); x++) { s += h[y * cw + x]; m++ }
    blur[b * cw + a] = s / m
  }
  for (let k = 0; k < n; k++) if (h[k] > 700 && h[k] - blur[k] > 160) flags[k] |= RIDGE
  cache.set(g, G)
  return G
}

const cellOf = (g: Gen, G: Grid, [x, y]: XY): [number, number] => [Math.min(G.cw - 1, Math.max(0, Math.floor((x + g.W / 2) / G.cs))), Math.min(G.ch - 1, Math.max(0, Math.floor((g.H / 2 - y) / G.cs)))]
const xyOf = (g: Gen, G: Grid, a: number, b: number): XY => [-g.W / 2 + (a + 0.5) * G.cs, g.H / 2 - (b + 0.5) * G.cs]
// every coarse cell a segment passes through
function walk(g: Gen, G: Grid, p: XY, q: XY, fn: (k: number) => void) {
  const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (G.cs * 0.3)))
  for (let s = 0; s <= n; s++) { const [a, b] = cellOf(g, G, [p[0] + (q[0] - p[0]) * s / n, p[1] + (q[1] - p[1]) * s / n]); fn(b * G.cw + a) }
}

/** Drop points that lie within `tol` km of the line between their neighbours (Douglas-Peucker). */
export function simplify(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!, [ax, ay] = pts[i], [bx, by] = pts[j], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1
    let best = -1, bd = tol
    for (let k = i + 1; k < j; k++) { const d = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / l; if (d > bd) { bd = d; best = k } }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]) }
  }
  return pts.filter((_, k) => keep[k])
}

/**
 * The cheapest way from one point to another when walking along the wanted kind of line costs 0.3 of open ground
 * (and water costs six times as much, so land borders stay on land). Free hand is a straight segment.
 */
export function route(g: Gen, from: XY, to: XY, follow: Follow): XY[] {
  if (follow === 'free') return [from, to]
  const G = gridOf(g), want = follow === 'natural' ? RIVER | RIDGE : follow === 'river' ? RIVER : follow === 'ridge' ? RIDGE : COAST
  const [ax, ay] = cellOf(g, G, from), [bx, by] = cellOf(g, G, to)
  if (ax === bx && ay === by) return [from, to]
  const pad = Math.max(10, Math.round(Math.hypot(ax - bx, ay - by) * 0.4)) // a corridor around the two clicks, so it can't wander off
  const x0 = Math.max(0, Math.min(ax, bx) - pad), x1 = Math.min(G.cw - 1, Math.max(ax, bx) + pad), y0 = Math.max(0, Math.min(ay, by) - pad), y1 = Math.min(G.ch - 1, Math.max(ay, by) + pad)
  const bw = x1 - x0 + 1, n = bw * (y1 - y0 + 1)
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1) // 64-bit: rounding to 32 makes nodes re-relax forever
  const cost = (k: number) => (G.flags[k] & want ? 0.3 : G.h[k] < 0 ? 6 : 1)
  const local = (a: number, b: number) => (b - y0) * bw + (a - x0)
  const heap = new Heap()
  const start = local(ax, ay), goal = local(bx, by)
  dist[start] = 0; heap.push(0, start)
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]]
  while (heap.size) {
    const [d, q] = heap.pop()
    if (q === goal) break
    if (d > dist[q]) continue
    const a = q % bw + x0, b = Math.floor(q / bw) + y0, cq = cost(b * G.cw + a)
    for (const [da, db, len] of NB) {
      const na = a + da, nb = b + db
      if (na < x0 || na > x1 || nb < y0 || nb > y1) continue
      const r = local(na, nb), nd = d + len * (cq + cost(nb * G.cw + na)) / 2
      if (nd < dist[r]) { dist[r] = nd; prev[r] = q; heap.push(nd, r) }
    }
  }
  if (prev[goal] < 0) return [from, to]
  const cells: XY[] = []
  for (let q = goal; q >= 0; q = prev[q]) cells.push(xyOf(g, G, q % bw + x0, Math.floor(q / bw) + y0))
  cells.reverse()
  const path = simplify(cells, G.cs * 0.9)
  path[0] = from; path[path.length - 1] = to
  return path
}

/**
 * A region filled from a point across land, stopped by the sea and by `walls` (borders and other regions' outlines),
 * returned as its outline. Undefined on water.
 */
export function fillRegion(g: Gen, at: XY, walls: XY[][], closedWalls: XY[][] = []): XY[] | undefined {
  const G = gridOf(g), { cw, ch } = G, n = cw * ch
  const block = new Uint8Array(n)
  // a border drawn nearly to the coast should still seal: each loose end joins the nearest sea within 150 km
  const R = Math.ceil(150 / G.cs)
  const toSea = (end: XY): XY[] => {
    const [ea, eb] = cellOf(g, G, end)
    let best: XY | undefined, bd = Infinity
    for (let b = Math.max(0, eb - R); b <= Math.min(ch - 1, eb + R); b++) for (let a = Math.max(0, ea - R); a <= Math.min(cw - 1, ea + R); a++) {
      const d = (a - ea) ** 2 + (b - eb) ** 2
      if (d < bd && d <= R * R && G.h[b * cw + a] < 0) { bd = d; best = xyOf(g, G, a, b) }
    }
    return best ? [best] : []
  }
  for (const w of walls) {
    if (w.length < 2) continue
    const line = [...toSea(w[0]), ...w, ...toSea(w[w.length - 1])]
    for (let q = 1; q < line.length; q++) walk(g, G, line[q - 1], line[q], (k) => { block[k] = 1 })
  }
  for (const w of closedWalls) for (let q = 0; q < w.length; q++) walk(g, G, w[q], w[(q + 1) % w.length], (k) => { block[k] = 1 })
  const [sa, sb] = cellOf(g, G, at), s0 = sb * cw + sa
  if (G.h[s0] < 0) return
  block[s0] = 0
  const fill = new Uint8Array(n), queue = [s0]
  fill[s0] = 1
  while (queue.length) {
    const k = queue.pop()!, a = k % cw
    for (const r of [a > 0 ? k - 1 : -1, a < cw - 1 ? k + 1 : -1, k - cw, k + cw]) {
      if (r < 0 || r >= n || fill[r] || block[r] || G.h[r] < 0) continue
      fill[r] = 1; queue.push(r)
    }
  }
  // outline: the edges between filled and empty cells, linked into loops; keep the longest (the outer edge)
  const next = new Map<number, number[]>(), C = (a: number, b: number) => b * (cw + 1) + a
  const edge = (p: number, q: number) => { const l = next.get(p); if (l) l.push(q); else next.set(p, [q]) }
  const on = (a: number, b: number) => a >= 0 && b >= 0 && a < cw && b < ch && fill[b * cw + a] === 1
  for (let b = 0; b < ch; b++) for (let a = 0; a < cw; a++) {
    if (!on(a, b)) continue
    if (!on(a, b - 1)) edge(C(a, b), C(a + 1, b))
    if (!on(a + 1, b)) edge(C(a + 1, b), C(a + 1, b + 1))
    if (!on(a, b + 1)) edge(C(a + 1, b + 1), C(a, b + 1))
    if (!on(a - 1, b)) edge(C(a, b + 1), C(a, b))
  }
  let best: number[] = []
  while (next.size) {
    const [startC] = next.keys(), loop = [startC]
    let c = startC
    for (;;) {
      const l = next.get(c)
      if (!l?.length) break
      const d = l.pop()!
      if (!l.length) next.delete(c)
      if (d === startC) break
      loop.push(d); c = d
    }
    if (loop.length > best.length) best = loop
  }
  if (best.length < 4) return
  const pts = best.map((c): XY => [-g.W / 2 + (c % (cw + 1)) * G.cs, g.H / 2 - Math.floor(c / (cw + 1)) * G.cs])
  // a closed loop simplifies in two halves, split at the point farthest from the start
  let far = 0
  for (let q = 1; q < pts.length; q++) if (Math.hypot(pts[q][0] - pts[0][0], pts[q][1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = q
  return [...simplify(pts.slice(0, far + 1), G.cs * 0.7).slice(0, -1), ...simplify([...pts.slice(far), pts[0]], G.cs * 0.7).slice(0, -1)]
}

// Binary min-heap of (priority, value).
class Heap {
  private p: number[] = []; private v: number[] = []
  get size() { return this.p.length }
  push(p: number, v: number) {
    const P = this.p, V = this.v
    let i = P.length; P.push(p); V.push(v)
    while (i > 0) { const j = (i - 1) >> 1; if (P[j] <= p) break; P[i] = P[j]; V[i] = V[j]; i = j }
    P[i] = p; V[i] = v
  }
  pop(): [number, number] {
    const P = this.p, V = this.v, top: [number, number] = [P[0], V[0]], lp = P.pop()!, lv = V.pop()!
    if (P.length) {
      let i = 0
      for (;;) {
        const l = i * 2 + 1, r = l + 1
        let m = i, mp = lp
        if (l < P.length && P[l] < mp) { m = l; mp = P[l] }
        if (r < P.length && P[r] < mp) m = r
        if (m === i) break
        P[i] = P[m]; V[i] = V[m]; i = m
      }
      P[i] = lp; V[i] = lv
    }
    return top
  }
}
