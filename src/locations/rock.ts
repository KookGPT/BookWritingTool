// Locations rock: real rock where the height grid can only make a steep slope. Every wall line from the terrain (sea
// cliffs, escarpments, gorge sides, mesa caps, canyon steps, caldera rims) gets a draped face that follows the ground's
// own profile (sampled from the final grid, so it always sits just in front of it) with buttresses, gullies and ledges;
// free-standing rocks (sea stacks, arches, spires, karst towers, hoodoos, basalt columns) are swept from rings.
// Pure: writes triangles into a kit Builder in world space (x east, y up, z south).
import { fbm, rng, simplex } from '../world/noise.ts'
import { Builder, lin, mix, type Col, type V } from './kit.ts'
import { clamp, lerp, normals, resample, sstep, type Rock, type Wall, type XY } from './terrain.ts'

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V): V => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const GREEN = lin('#5b6b3c'), ALGAE = lin('#2e3226'), DARK = lin('#3a3936')

/** A smooth-shaded surface from a grid of points (rows of columns); `out` says which way its front faces. */
export function sheet(b: Builder, P: V[][], C: Col[][], out: (r: number, c: number) => V) {
  const R = P.length, K = P[0].length, N: V[][] = []
  for (let r = 0; r < R; r++) {
    const row: V[] = []
    for (let c = 0; c < K; c++) {
      const du = sub(P[r][Math.min(K - 1, c + 1)], P[r][Math.max(0, c - 1)]), dv = sub(P[Math.min(R - 1, r + 1)][c], P[Math.max(0, r - 1)][c])
      let n = norm(cross(du, dv))
      const o = out(r, c)
      if (n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0) n = [-n[0], -n[1], -n[2]]
      row.push(n)
    }
    N.push(row)
  }
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < K - 1; c++) {
    const a = P[r][c], bb = P[r][c + 1], cc = P[r + 1][c], d = P[r + 1][c + 1], o = out(r, c)
    const fn = cross(sub(bb, a), sub(cc, a)), flip = fn[0] * o[0] + fn[1] * o[1] + fn[2] * o[2] < 0
    const col = C[r][c]
    if (!flip) { b.tri('rock', a, bb, cc, N[r][c], N[r][c + 1], N[r + 1][c], col); b.tri('rock', bb, d, cc, N[r][c + 1], N[r + 1][c + 1], N[r + 1][c], C[r][c + 1]) }
    else { b.tri('rock', a, cc, bb, N[r][c], N[r + 1][c], N[r][c + 1], col); b.tri('rock', bb, cc, d, N[r][c + 1], N[r + 1][c], N[r + 1][c + 1], C[r][c + 1]) }
  }
}

/** Rock faces over every wall line. `H` is the final ground at a recipe point as the renderer's triangles draw it;
 * `onFace` hears of every face sample so the caller can sink the grid's own steep triangles behind the rock. */
export function rockWalls(b: Builder, walls: Wall[], H: (x: number, y: number) => number, sea: number | null, half: number, seed: number, onFace?: (x: number, y: number, r: number, bot: number, top: number) => void) {
  const nz = simplex(seed ^ 0x40c), STEP = 5, DS = 1.5
  b.frame(0, 0, 0, 0)
  for (const wl of walls) {
    const pts = resample(wl.pts, STEP), nr = normals(pts), base = lin(wl.rock)
    // per column: the ground's profile across the face, from the low side to the high side
    const cols = pts.map((p, i) => {
      const u: XY = [nr[i][0] * wl.high, nr[i][1] * wl.high], reach = wl.face + 14, K = Math.ceil((reach + 12) / DS)
      const hs: number[] = []
      for (let k = 0; k <= K; k++) { const sd = -12 + k * DS; hs.push(H(p[0] + u[0] * sd, p[1] + u[1] * sd)) }
      for (let k = 1; k <= K; k++) hs[k] = Math.max(hs[k], hs[k - 1]) // climb only
      let bot = hs[0], top = hs[K]
      if (wl.sea && sea != null) bot = Math.min(bot, sea - 3)
      const inMap = Math.abs(p[0]) < half - 4 && Math.abs(p[1]) < half - 4
      const steep = (hs[K] - hs[0]) / (reach + 12)
      // a crest (the ground falls away again just behind the top: an arete, a knife-edge) is no face: a sheet there would
      // stick out of the far side as a dark slab
      const crest = H(p[0] + u[0] * (reach + 30), p[1] + u[1] * (reach + 30)) < hs[K] - 12
      return { p, u, hs, bot, top, ok: inMap && top - bot > 9 && steep > 0.85 && !crest }
    })
    // tops and feet vary smoothly along the wall, and short gaps are bridged, so a cliff is one face, not a row of pillars
    const tops = cols.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - 3); k <= Math.min(cols.length - 1, i + 3); k++) { s += cols[k].top; c++ } return s / c })
    const bots = cols.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - 2); k <= Math.min(cols.length - 1, i + 2); k++) { s += cols[k].bot; c++ } return s / c })
    cols.forEach((c, i) => { c.top = Math.min(tops[i], c.hs[c.hs.length - 1]); c.bot = Math.max(bots[i], c.hs[0] - 40) })
    for (let i = 1; i < cols.length - 1; i++) if (!cols[i].ok) { let j = i; while (j < cols.length && !cols[j].ok && j - i < 4) j++; if (j < cols.length && cols[j].ok && cols[i - 1].ok && j - i < 4 && cols.slice(i, j).every((c) => c.top - c.bot > 3)) for (let k = i; k < j; k++) cols[k].ok = true }
    // runs of steep columns become one sheet each
    let i = 0
    while (i < cols.length) {
      if (!cols[i].ok) { i++; continue }
      let j = i
      while (j < cols.length && cols[j].ok) j++
      if (j - i >= 6) { face(cols.slice(Math.max(0, i - 1), Math.min(cols.length, j + 1)), i); if (onFace) for (let k = i; k < j; k++) { const c = cols[k], mid = wl.face * 0.5; onFace(c.p[0] + c.u[0] * mid, c.p[1] + c.u[1] * mid, wl.face * 0.5 + 8, c.bot, c.top) } }
      i = j
    }
    function face(run: typeof cols, s0: number) {
      const tall = Math.max(...run.map((c) => c.top - c.bot)), R = clamp(Math.ceil(tall / 4.5), 3, 60)
      const P: V[][] = [], C: Col[][] = []
      for (let r = 0; r <= R; r++) {
        const row: V[] = [], crow: Col[] = []
        run.forEach((c, k) => {
          const v = r / R, y = r === 0 ? c.bot - 2 : r === R ? c.top - 0.9 : lerp(c.bot, c.top, v)
          // where the ground reaches this height: the face sits just in front of it
          let sd = -12
          for (let q = 0; q < c.hs.length; q++) if (c.hs[q] >= y) { const lo = q ? c.hs[q - 1] : c.hs[0]; sd = -12 + (q - 1 + clamp((y - lo) / (c.hs[q] - lo || 1))) * DS; break } else sd = -12 + q * DS
          const sv = (s0 + k) * STEP, mid = Math.sin(Math.PI * v) ** 0.6
          const butt = fbm(nz, sv / 110, y / 60, 3, 3) * 2 + fbm(nz, sv / 18, y / 30, 9, 2) * 0.5 // broad buttresses, shallow fluting
          const ledge = sstep(0.82, 1, ((y / (6.5 * wl.strata) + fbm(nz, sv / 60, 5, y / 40, 2) * 0.6) % 1 + 1) % 1) // recesses along the beds
          // always in front of the ground (else the ground shows through the face in wedges), tucked behind it at the top
          const out = r === R ? -2.2 : r === 0 ? 3 : Math.max(1.1, 2.6 + (butt + 0.25) * 2 * mid - ledge * 0.9 * mid)
          const x = c.p[0] + c.u[0] * (sd - out), yy = c.p[1] + c.u[1] * (sd - out)
          row.push([x, y, -yy])
          // colour: the rock, varied by bed and patch; a dark tide band at the sea; a little green on the ledges up top
          let col = mix(base, mix(base, DARK, 0.35), sstep(0.2, 0.7, fbm(nz, sv / 90, y / 14, 21, 2) + 0.5))
          col = mix(col, [col[0] * 1.12, col[1] * 1.1, col[2] * 1.06], sstep(0.4, 0.9, fbm(nz, sv / 25, y / 9, 31, 2) + 0.5) * 0.6)
          if (wl.sea && sea != null) col = mix(col, ALGAE, 1 - sstep(sea + 1.2, sea + 3.2, y))
          col = mix(col, GREEN, ledge * 0.35 * sstep(0.55, 0.95, v))
          crow.push(col)
        })
        P.push(row); C.push(crow)
      }
      sheet(b, P, C, (_r, c) => [-run[c].u[0], 0, run[c].u[1]])
    }
  }
}

/** Sea stacks, arches, spires, karst towers, hoodoos and basalt columns. */
export function rockForms(b: Builder, rocks: Rock[], seed: number) {
  const nz = simplex(seed ^ 0x51ac)
  b.frame(0, 0, 0, 0)
  for (const r of rocks) {
    const base = lin(r.rock), tall = r.top - r.base, sd = r.seed % 1000
    if (r.kind === 'columns') { column(b, r, base); continue }
    if (r.kind === 'arch' && r.to) { arch(b, r, base, nz); continue }
    const rings = clamp(Math.ceil(tall / 4), 4, 48), sides = r.r > 14 ? 14 : 10, P: V[][] = [], C: Col[][] = []
    const lean = ((r.seed % 37) / 37 - 0.5) * 0.12, leanA = (r.seed % 101) / 101 * Math.PI * 2 // stacks and towers lean a little
    const shape = (v: number) => r.kind === 'spire' ? Math.max(0.06, (1 - v) ** 0.8) * 1.15
      : r.kind === 'tower' ? (0.8 + 0.35 * Math.sin(Math.PI * v ** 0.8)) * (1 - 0.45 * v ** 4)
        : r.kind === 'hoodoo' ? (v > 0.86 ? 1.25 : 0.5 + 0.12 * Math.sin(v * 17 + sd))
          : 1.05 - 0.2 * v + (v > 0.85 ? 0.08 : 0) // sea stack, a little undercut at the top
    for (let k = 0; k <= rings; k++) {
      const v = k / rings, y = lerp(r.base, r.top, v), row: V[] = [], crow: Col[] = []
      for (let q = 0; q <= sides; q++) {
        const a = (q / sides) * Math.PI * 2, wob = 1 + 1.1 * fbm(nz, Math.cos(a) * 1.6 + sd, Math.sin(a) * 1.6, y / (r.r * 2.5), 3) + 0.3 * fbm(nz, Math.cos(a) * 5, Math.sin(a) * 5 + sd, y / 6, 2) - 0.12 * sstep(0.8, 1, ((y / 7 + sd) % 1))
        const rr = r.r * shape(v) * Math.max(0.35, wob), off = (y - r.base) * lean
        row.push([r.at[0] + Math.cos(a) * rr + Math.cos(leanA) * off, y, -(r.at[1] + Math.sin(a) * rr + Math.sin(leanA) * off)])
        let col = mix(base, mix(base, DARK, 0.4), sstep(0.2, 0.8, fbm(nz, a, y / 12, sd, 2) + 0.5))
        if (r.kind === 'tower') col = mix(col, GREEN, sstep(0.45, 0.8, fbm(nz, Math.cos(a) * 2, y / 20, sd + 4, 2) + 0.5) * 0.7) // jungle clinging to the sides
        if (r.top - r.base > 0 && r.base < 0 && y < 2) col = mix(col, ALGAE, 1 - sstep(0.5, 2.5, y))
        crow.push(col)
      }
      P.push(row); C.push(crow)
    }
    sheet(b, P, C, (_k, q) => { const a = (q / sides) * Math.PI * 2; return [Math.cos(a), 0, -Math.sin(a)] })
    // the top: a low dome, green where plants hold on
    const top = P[rings], cy = r.top + r.r * (r.kind === 'tower' ? 0.25 : 0.08), off = (r.top - r.base) * lean, ctr: V = [r.at[0] + Math.cos(leanA) * off, cy, -(r.at[1] + Math.sin(leanA) * off)], tc = mix(base, GREEN, r.green * 0.85)
    for (let q = 0; q < sides; q++) b.tri('rock', ctr, top[q + 1], top[q], [0, 1, 0], norm(sub(top[q + 1], ctr)), norm(sub(top[q], ctr)), tc)
  }
}

function arch(b: Builder, r: Rock, base: Col, nz: ReturnType<typeof simplex>) {
  const A = r.at, B = r.to!, n = 22, sides = 12, P: V[][] = [], C: Col[][] = [], span = Math.hypot(B[0] - A[0], B[1] - A[1])
  const path: V[] = Array.from({ length: n + 1 }, (_, k) => { const t = k / n, y = lerp(r.base, r.top - r.r * 0.6, Math.sin(Math.PI * t) ** 0.3); return [lerp(A[0], B[0], t), y, -lerp(A[1], B[1], t)] })
  for (let k = 0; k <= n; k++) {
    const t = k / n, p = path[k], T = norm(sub(path[Math.min(n, k + 1)], path[Math.max(0, k - 1)])), side = norm(cross(T, [0, 1, 0])), up = norm(cross(side, T))
    const rr = r.r * (1.7 - 0.9 * Math.sin(Math.PI * t)) * (0.6 + span / 120), row: V[] = [], crow: Col[] = []
    for (let q = 0; q <= sides; q++) {
      const a = (q / sides) * Math.PI * 2, wob = 1 + 0.2 * fbm(nz, Math.cos(a) + t * 3, Math.sin(a), r.seed % 97, 3)
      const o = [side[0] * Math.cos(a) + up[0] * Math.sin(a), side[1] * Math.cos(a) + up[1] * Math.sin(a), side[2] * Math.cos(a) + up[2] * Math.sin(a)]
      row.push([p[0] + o[0] * rr * wob, p[1] + o[1] * rr * wob * 0.8, p[2] + o[2] * rr * wob])
      crow.push(mix(mix(base, DARK, sstep(0.2, 0.8, fbm(nz, a, p[1] / 12, 7, 2) + 0.5) * 0.4), GREEN, sstep(0.6, 0.95, Math.sin(a)) * sstep(0.3, 0.5, Math.sin(Math.PI * t)) * 0.8))
    }
    P.push(row); C.push(crow)
  }
  sheet(b, P, C, (k, q) => { const p = path[k], c = P[k][q]; return sub(c, p) })
}

function column(b: Builder, r: Rock, base: Col) {
  // a hexagonal basalt column: six flat sides and a flat (slightly cupped) top
  const c = mix(base, [0.05, 0.05, 0.05], (r.seed % 7) / 30), top = mix(c, [0.4, 0.4, 0.38], 0.15)
  const P = Array.from({ length: 6 }, (_, q) => { const a = (q / 6) * Math.PI * 2 + Math.PI / 6; return [r.at[0] + Math.cos(a) * r.r, -(r.at[1] + Math.sin(a) * r.r)] as [number, number] })
  for (let q = 0; q < 6; q++) {
    const [ax, az] = P[q], [bx, bz] = P[(q + 1) % 6], n = norm([az - bz, 0, bx - ax])
    const o: V = [(ax + bx) / 2 - r.at[0], 0, (az + bz) / 2 + r.at[1]], nn: V = n[0] * o[0] + n[2] * o[2] < 0 ? [-n[0], 0, -n[2]] : n
    b.face('rock', [[ax, r.base, az], [bx, r.base, bz], [bx, r.top, bz], [ax, r.top, az]], c, [r.at[0], r.top / 2 + r.base / 2, -r.at[1]].map((v, i) => v - nn[i]) as V)
  }
  b.face('rock', P.map(([x, z]) => [x, r.top, z] as V), top, [r.at[0], r.top - 1, -r.at[1]])
}

/** Hot-spring terraces: rows of irregular pools of warm turquoise water, each held in a pale travertine rim that drops to
 * the ground on its downhill side, so the slope steps down in white crescents (Pamukkale). */
export function springPools(b: Builder, inside: (x: number, y: number) => number, box: [number, number, number, number], H: (x: number, y: number) => number, seed: number) {
  const R = rng(seed), rimC = lin('#ebe3d4'), rimD = lin('#d9cdb6'), water = lin('#56bcc4'), [x0, y0, x1, y1] = box
  b.frame(0, 0, 0, 0)
  for (let y = y0; y < y1; y += 10) for (let x = x0; x < x1; x += 10) {
    const px = x + (R() - 0.5) * 6, py = y + (R() - 0.5) * 6
    if (inside(px, py) > -5) continue
    const r = 3.5 + R() * 3.8, lvl = H(px, py) + 0.3, n = 12, ph = R() * 6.28
    const ring = Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2, rr = r * (1 + 0.22 * Math.sin(a * 2 + ph) + 0.12 * Math.sin(a * 5 + ph * 2)); return [Math.cos(a) * rr, Math.sin(a) * rr] as [number, number] })
    for (let k = 0; k < n; k++) {
      const [ax, ay] = ring[k], [bx, by] = ring[(k + 1) % n], ox = 1 + 0.9 / r
      const iA: V = [px + ax, lvl + 0.12, -(py + ay)], iB: V = [px + bx, lvl + 0.12, -(py + by)], oA: V = [px + ax * ox, lvl + 0.12, -(py + ay * ox)], oB: V = [px + bx * ox, lvl + 0.12, -(py + by * ox)]
      b.face('water', [[px, lvl, -py], [px + ax, lvl, -(py + ay)], [px + bx, lvl, -(py + by)]], water, [px, lvl - 1, -py])
      b.face('rock', [iA, oA, oB, iB], rimC, [px, lvl - 1, -py])
      const gA = H(px + ax * ox, py + ay * ox) - 0.4, gB = H(px + bx * ox, py + by * ox) - 0.4
      b.face('rock', [oA, oB, [oB[0], Math.min(gB, lvl - 0.3), oB[2]], [oA[0], Math.min(gA, lvl - 0.3), oA[2]]], rimD, [px, lvl, -py]) // the rim's outer face, down to the slope
    }
  }
}
