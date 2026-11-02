// Turns a settlement or structure (a layer item) into GPU-ready buffers on a given planet: building instances grouped by
// model, and a ground decal (streets, plazas, fields) that matches the terrain tiles under it. Pure (no three.js), so the
// tile worker runs it; the globe only uploads the arrays.
import { cross, dot, norm, toDir, type LatLon, type Vec } from './geo.ts'
import { layoutSite, type Ground, type Layout, type SiteSpec } from './layout.ts'
import type { LayerItem } from './layers.ts'
import { hash4 } from './noise.ts'
import type { Planet } from './terrain.ts'
import { ARABLE, BRIDGE_STYLES, footprintKm, PALETTES, popOf, siteOf, styleFor, type Style, STYLE_IDS } from './sites.ts'

/** Floats per building instance: position relative to the centre (3), up (3), [height, size, yaw, landmark] (4), wall colour (3), roof colour (3). */
export const SETTLE_STRIDE = 16
export interface SettleData {
  center: Vec
  extentM: number
  sets: { kind: string; data: Float32Array }[]
  decal?: { pos: Float32Array; up: Float32Array; h: Float32Array; grad: Float32Array; col: Float32Array; index: Uint32Array }
  count: number
}

const lin = (c: number) => Math.pow(Math.max(0, Math.min(255, c)) / 255, 2.2)
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const DETAIL = 13, CDETAIL = 12 // the octaves a level-15 tile samples, so buildings sit exactly on the ground

/** Local frame at a point: east and north tangents, and local metres -> unit direction. */
export function frame(c: Vec, R: number) {
  const e = cross([0, 1, 0], c), E = norm(Math.hypot(...e) < 1e-6 ? [1, 0, 0] : e), N = cross(c, E)
  const dirAt = (x: number, z: number): Vec => norm([c[0] + (E[0] * x + N[0] * z) / R, c[1] + (E[1] * x + N[1] * z) / R, c[2] + (E[2] * x + N[2] * z) / R])
  return { E, N, dirAt, local: (d: Vec): [number, number] => [dot(d, E) * R, dot(d, N) * R] }
}

/** The ground around a centre as the layout generator sees it, with small caches (many buildings share ground). */
export function groundAt(planet: Planet, c: Vec): Ground & { terr(x: number, z: number): string } {
  const R = planet.radiusM, { dirAt } = frame(c, R)
  const hc = new Map<number, { h: number; s: number; wet: boolean }>(), tc = new Map<number, string>()
  const q = 3, key = (x: number, z: number) => Math.round(x / q) * 65536 + Math.round(z / q)
  const at = (x: number, z: number) => {
    const k = key(x, z)
    let v = hc.get(k)
    if (!v) { const d = dirAt(Math.round(x / q) * q, Math.round(z / q) * q), h = planet.elevation(d[0], d[1], d[2], DETAIL); v = { h, s: planet.surface(d[0], d[1], d[2], h), wet: !!planet.water(d[0], d[1], d[2], h) }; hc.set(k, v) }
    return v
  }
  const slope = (x: number, z: number) => { const e = 9; return Math.hypot(at(x + e, z).h - at(x - e, z).h, at(x, z + e).h - at(x, z - e).h) / (2 * e) }
  const terr = (x: number, z: number) => {
    const k = Math.round(x / 12) * 65536 + Math.round(z / 12)
    let t = tc.get(k)
    if (t === undefined) { const d = dirAt(x, z), v = at(x, z); t = v.wet ? '' : planet.terrain(d[0], d[1], d[2], v.h, slope(x, z), CDETAIL).id; tc.set(k, t) }
    return t
  }
  return { h: (x, z) => at(x, z).s, wet: (x, z) => at(x, z).wet, slope, arable: (x, z) => ARABLE.has(terr(x, z)), terr }
}

/** Building style: the item's own `props.style`, else what the terrain at its centre suggests. */
export const styleOfItem = (item: LayerItem, terrainId: string): Style => {
  const s = String(item.props?.style ?? '') as Style
  return STYLE_IDS.includes(s) ? s : styleFor(terrainId)
}

/** A river op's width in km where its course passes nearest to a point, with the course tangent there. */
export function riverNear(planet: Planet, c: Vec) {
  let best: { d: number; at: LatLon; tan: Vec; widthKm: number } | undefined
  const R = planet.radiusM / 1000
  for (const op of planet.world.ops ?? []) {
    if (op.kind !== 'river') continue
    const pts = planet.course(op), full = op.width ?? 5
    for (let i = 0; i < pts.length; i++) {
      const d = toDir(pts[i][0], pts[i][1]), ang = Math.acos(Math.max(-1, Math.min(1, dot(c, d)))) * R
      if (!best || ang < best.d) {
        const a = toDir(pts[Math.max(0, i - 1)][0], pts[Math.max(0, i - 1)][1]), b = toDir(pts[Math.min(pts.length - 1, i + 1)][0], pts[Math.min(pts.length - 1, i + 1)][1])
        best = { d: ang, at: pts[i], tan: [b[0] - a[0], b[1] - a[1], b[2] - a[2]], widthKm: full * (0.35 + 0.65 * i / Math.max(1, pts.length - 1)) }
      }
    }
  }
  return best
}

/** Builds everything the globe needs to show one item, or undefined if it isn't a site. */
export function buildSite(planet: Planet, item: LayerItem): SettleData | undefined {
  const s = siteOf(item)
  if (!s || !(item.at || (item.path && item.path.length > 1))) return undefined
  const R = planet.radiusM
  let center: Vec, bridge: SiteSpec['bridge']
  const kind = BRIDGE_STYLES.includes(String(item.props?.style) as never) ? String(item.props?.style) : 'stone'
  if (s.def.cls === 'bridge') {
    if (item.path && item.path.length > 1) { // explicit: from bank to bank
      const a = toDir(...item.path[0]), b = toDir(...item.path[item.path.length - 1])
      center = norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]])
      const f = frame(center, R), [ax, az] = f.local(a), [bx, bz] = f.local(b)
      bridge = { len: Math.hypot(bx - ax, bz - az), dir: Math.atan2(bz - az, bx - ax), kind }
    } else {
      center = toDir(...item.at!)
      const rv = riverNear(planet, center)
      if (rv && rv.d < Math.max(1, rv.widthKm * 1.2)) { // snap to the river and cross it at right angles
        center = toDir(rv.at[0], rv.at[1])
        const f = frame(center, R), tx = dot(rv.tan, f.E), tz = dot(rv.tan, f.N)
        bridge = { len: Math.max(60, rv.widthKm * 1000 * 1.15), dir: Math.atan2(tz, tx) + Math.PI / 2, kind }
      } else bridge = { len: Math.max(30, Number(item.props?.length ?? 0.3) * 1000), dir: Number(item.props?.heading ?? 0) * Math.PI / 180, kind }
    }
  } else center = toDir(...item.at!)
  const { E, N, dirAt } = frame(center, R), g = groundAt(planet, center)
  let style = styleOfItem(item, g.terr(0, 0) || g.terr(30, 30))
  if (!STYLE_IDS.includes(String(item.props?.style ?? '') as Style)) { // the climate has the last word: cold coasts don't build stilt huts
    const { temp } = planet.climate(center[0], center[1], center[2], planet.elevation(center[0], center[1], center[2], 6))
    if (style === 'timber' && temp < 3) style = 'northern'
    else if (style === 'tropical' && temp < 15) style = temp < 3 ? 'northern' : 'timber'
  }
  const spec: SiteSpec = { id: item.id, type: s.id, cls: s.def.cls, pop: popOf(item), style, r: footprintKm(item) * 1000, bridge, walled: item.props?.walled === undefined ? undefined : Number(item.props.walled) !== 0 && String(item.props.walled) !== 'no' }
  const L = layoutSite(spec, g)

  // ---------- instances ----------
  const groups = new Map<string, number[]>()
  for (const b of L.blds) {
    const d = dirAt(b.x, b.z), h = b.h ?? g.h(b.x, b.z)
    // the yaw is measured in the shader's own frame at this point, which can differ from ours near the poles
    const ax = Math.cos(b.rot), az = Math.sin(b.rot), want: Vec = [E[0] * ax + N[0] * az, E[1] * ax + N[1] * az, E[2] * ax + N[2] * az]
    const rf: Vec = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], t1 = norm(cross(rf, d)), t2 = cross(d, t1)
    let a = groups.get(b.k)
    if (!a) groups.set(b.k, a = [])
    a.push(d[0] - center[0], d[1] - center[1], d[2] - center[2], d[0], d[1], d[2], h / R, b.s / R, Math.atan2(dot(want, t2), dot(want, t1)), b.prio ? 1 : 0,
      lin(b.w[0]), lin(b.w[1]), lin(b.w[2]), lin(b.r[0]), lin(b.r[1]), lin(b.r[2]))
  }
  const sets = [...groups].map(([kind, data]) => ({ kind, data: new Float32Array(data) }))
  return { center, extentM: L.extent, sets, decal: s.def.cls === 'bridge' ? undefined : buildDecal(planet, center, L, E, N, dirAt), count: L.blds.length }
}

// ---------- ground decal ----------
function buildDecal(planet: Planet, center: Vec, L: Layout, E: Vec, N: Vec, dirAt: (x: number, z: number) => Vec) {
  const R = planet.radiusM, pal = PALETTES[L.style]
  const ext = L.extent * 1.05, cell = Math.max(3, 2 * ext / 180), n = Math.ceil(2 * ext / cell), W = n + 1, x0 = -n * cell / 2
  // rasterise the layout onto the grid: streets, fields and yards as alpha plus colour
  const road = new Float32Array(W * W), fieldA = new Float32Array(W * W), fieldC = new Float32Array(W * W * 3)
  const ij = (x: number, z: number): [number, number] => [(x - x0) / cell, (z - x0) / cell]
  for (const st of L.streets) for (let k = 0; k + 1 < st.pts.length; k++) {
    const [ax, az] = st.pts[k], [bx, bz] = st.pts[k + 1], len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(len / (cell * 0.5))), r = Math.max(0.9, st.w / 2 / cell)
    for (let s = 0; s <= steps; s++) {
      const [ci, cj] = ij(ax + (bx - ax) * s / steps, az + (bz - az) * s / steps)
      for (let j = Math.floor(cj - r); j <= Math.ceil(cj + r); j++) for (let i = Math.floor(ci - r); i <= Math.ceil(ci + r); i++) {
        if (i < 0 || j < 0 || i >= W || j >= W) continue
        road[j * W + i] = Math.max(road[j * W + i], 1 - smooth(r * 0.6, r + 0.5, Math.hypot(i - ci, j - cj)))
      }
    }
  }
  for (const f of L.fields) {
    const c = Math.cos(f.rot), s = Math.sin(f.rot), rad = Math.hypot(f.a, f.b) / cell
    const [ci, cj] = ij(f.x, f.z)
    for (let j = Math.floor(cj - rad); j <= Math.ceil(cj + rad); j++) for (let i = Math.floor(ci - rad); i <= Math.ceil(ci + rad); i++) {
      if (i < 0 || j < 0 || i >= W || j >= W) continue
      const px = x0 + i * cell - f.x, pz = x0 + j * cell - f.z, u = px * c + pz * s, v = -px * s + pz * c
      if (Math.abs(u) > f.a || Math.abs(v) > f.b) continue
      const edge = Math.min(f.a - Math.abs(u), f.b - Math.abs(v)), row = Math.floor(v / f.stripe) & 1
      const col = edge < Math.max(1.4, cell * 0.6) ? [66, 92, 46] : row ? f.c1 : f.c2 // hedge line, then alternating rows
      const k = j * W + i
      fieldA[k] = 0.96; fieldC[k * 3] = col[0]; fieldC[k * 3 + 1] = col[1]; fieldC[k * 3 + 2] = col[2]
    }
  }
  const blobAt = (x: number, z: number) => {
    if (!L.blob) return 0
    const a = ((Math.atan2(z, x) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * L.blob.length, i = Math.floor(a) % L.blob.length, t = a - Math.floor(a)
    const r = L.blob[i] * (1 - t) + L.blob[(i + 1) % L.blob.length] * t
    return 1 - smooth(r * 0.86, r * 1.06, Math.hypot(x, z))
  }

  const count = W * W, pos = new Float32Array(count * 3), up = new Float32Array(count * 3), h = new Float32Array(count), grad = new Float32Array(count * 3), col = new Float32Array(count * 3)
  const S = new Float64Array(count), paint = new Float32Array(count), lift = 3.5
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const x = x0 + i * cell, z = x0 + j * cell, k = j * W + i, d = dirAt(x, z)
    const e = planet.elevation(d[0], d[1], d[2], DETAIL), surf = planet.surface(d[0], d[1], d[2], e), wet = !!planet.water(d[0], d[1], d[2], e)
    S[k] = surf
    pos[k * 3] = d[0] - center[0]; pos[k * 3 + 1] = d[1] - center[1]; pos[k * 3 + 2] = d[2] - center[2]
    up[k * 3] = d[0]; up[k * 3 + 1] = d[1]; up[k * 3 + 2] = d[2]
    h[k] = (surf + lift) / R
    const base = planet.color(d[0], d[1], d[2], e, 0, CDETAIL)
    let r = base[0], gg = base[1], b = base[2], a = 0
    if (!wet) {
      // field colours first, then the built-up ground on top
      if (fieldA[k] > 0) { const fa = fieldA[k]; r += (fieldC[k * 3] - r) * fa; gg += (fieldC[k * 3 + 1] - gg) * fa; b += (fieldC[k * 3 + 2] - b) * fa; a = fa }
      let yc: [number, number, number] | undefined, ya = 0
      for (const y of L.yards) { const t = (1 - smooth(0.7, 1, Math.hypot(x - y.x, z - y.z) / y.r)) * y.a; if (t > ya) { ya = t; yc = y.c } }
      const ub = Math.max(blobAt(x, z) * 0.92, ya)
      if (ub > 0.01) {
        const rd = road[k], n1 = hash4(i, j, 7, 1) - 0.5, ground = ya > blobAt(x, z) * 0.92 && yc ? yc : pal.ground, rc = pal.road, f = 1 + n1 * 0.12
        const gx = ground[0] * 0.62 + base[0] * 0.38, gy = ground[1] * 0.62 + base[1] * 0.38, gz = ground[2] * 0.62 + base[2] * 0.38 // trampled earth, but still the colour of the land around it
        const ur = (gx + (rc[0] - gx) * rd) * f, ug = (gy + (rc[1] - gy) * rd) * f, ub2 = (gz + (rc[2] - gz) * rd) * f
        r += (ur - r) * ub; gg += (ug - gg) * ub; b += (ub2 - b) * ub; a = Math.max(a, ub)
      }
    }
    paint[k] = a
    col[k * 3] = lin(r); col[k * 3 + 1] = lin(gg); col[k * 3 + 2] = lin(b)
  }
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { // central differences, in the shader's units (rise over run)
    const k = j * W + i, gx = (S[j * W + Math.min(W - 1, i + 1)] - S[j * W + Math.max(0, i - 1)]) / (2 * cell), gz = (S[Math.min(W - 1, j + 1) * W + i] - S[Math.max(0, j - 1) * W + i]) / (2 * cell)
    grad[k * 3] = E[0] * gx + N[0] * gz; grad[k * 3 + 1] = E[1] * gx + N[1] * gz; grad[k * 3 + 2] = E[2] * gx + N[2] * gz
  }
  const idx: number[] = []
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1
    if (Math.max(paint[a], paint[b], paint[c], paint[d]) < 0.02) continue
    idx.push(a, b, c, b, d, c)
  }
  return idx.length ? { pos, up, h, grad, col, index: new Uint32Array(idx) } : undefined
}

