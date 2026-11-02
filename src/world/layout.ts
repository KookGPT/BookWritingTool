// Lays out a settlement or structure in local metres (x east, z north of its centre). Pure and deterministic: the same item on
// the same ground always grows the same streets and buildings. The caller supplies the ground (heights, water, slope, soil).
import type { BuildKind } from './buildings.ts'
import { rng } from './noise.ts'
import { PALETTES, tierOf, type Palette, type Style } from './sites.ts'
import type { DecorKind } from './terrains.ts'

type V3 = [number, number, number]
type P2 = [number, number]
export interface Ground {
  /** Visible surface height in metres (water surfaces are flat). */
  h(x: number, z: number): number
  wet(x: number, z: number): boolean
  /** Rise over run around the point. */
  slope(x: number, z: number): number
  /** Open fertile ground where fields make sense. */
  arable(x: number, z: number): boolean
}
/** One building or prop. Colours are sRGB 0..255. `rot` turns the model's x axis toward (cos, sin) in (east, north). */
export interface Bld { k: BuildKind | DecorKind; x: number; z: number; rot: number; s: number; w: V3; r: V3; prio?: boolean; h?: number }
export interface Field { x: number; z: number; a: number; b: number; rot: number; c1: V3; c2: V3; stripe: number }
export interface Yard { x: number; z: number; r: number; c: V3; a: number }
export interface Layout { extent: number; blds: Bld[]; fields: Field[]; streets: { pts: P2[]; w: number }[]; yards: Yard[]; blob?: number[]; style: Style }
export interface SiteSpec {
  id: string; type: string; cls: 'settlement' | 'site' | 'bridge'; pop: number; style: Style
  /** Footprint radius in metres. */
  r: number
  walled?: boolean
  /** Bridge: length in metres, direction (radians, east = 0, counter-clockwise), style. */
  bridge?: { len: number; dir: number; kind: string }
}

const TAU = Math.PI * 2
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const FOOT: Record<string, number> = {
  cottage: 0.42, house: 0.4, longhouse: 0.5, cabin: 0.36, hut: 0.42, adobe: 0.46, domehouse: 0.42, stilt: 0.44, tenement: 0.36, rowhouse: 0.52, church: 0.5, templeDome: 0.5,
  pagoda: 0.44, hall: 0.55, market: 0.5, keep: 0.45, palace: 0.55, spire: 0.16, stepped: 0.5, rotunda: 0.46, barn: 0.55, silo: 0.3, windmill: 0.3, warehouse: 0.55, dock: 0.5,
  ship: 0.45, tent: 0.5, haystack: 0.34, lighthouse: 0.2, headframe: 0.45, spoil: 0.5, ruin: 0.5, walltower: 0.45, gate: 0.5, wallseg: 0.5, crane: 0.3, oak: 0.4, bush: 0.4, boulder: 0.4,
}
const TALL = new Set(['spire', 'stepped', 'church', 'keep', 'palace', 'rotunda', 'templeDome', 'pagoda', 'hall', 'lighthouse', 'windmill', 'headframe', 'gate', 'walltower', 'silo', 'crane'])
const CROPS: [V3, V3][] = [[[118, 160, 60], [96, 140, 52]], [[150, 176, 68], [128, 156, 58]], [[214, 184, 84], [196, 164, 70]], [[128, 96, 64], [108, 80, 54]], [[190, 170, 100], [170, 150, 86]], [[150, 112, 160], [128, 92, 140]], [[84, 130, 70], [64, 108, 56]]]

/** Spatial hash for overlap tests: small things live in a grid, big ones in a list. */
class Spatial {
  private m = new Map<number, number[]>(); private x: number[] = []; private z: number[] = []; private r: number[] = []; private big: number[] = []
  private cell: number
  constructor(cell: number) { this.cell = cell }
  private key(i: number, j: number) { return (i + 8192) * 16384 + (j + 8192) }
  add(x: number, z: number, r: number) {
    const n = this.x.length
    this.x.push(x); this.z.push(z); this.r.push(r)
    if (r > this.cell * 1.5) { this.big.push(n); return }
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))
    const l = this.m.get(k)
    if (l) l.push(n); else this.m.set(k, [n])
  }
  free(x: number, z: number, r: number) {
    const hit = (n: number) => (this.x[n] - x) ** 2 + (this.z[n] - z) ** 2 < (r + this.r[n]) ** 2
    for (const n of this.big) if (hit(n)) return false
    const reach = Math.ceil((r + this.cell * 1.5) / this.cell), ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell)
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      const l = this.m.get(this.key(ci + i, cj + j))
      if (l) for (const n of l) if (hit(n)) return false
    }
    return true
  }
}

export function layoutSite(sp: SiteSpec, g: Ground): Layout {
  let seed = 0
  for (let i = 0; i < sp.id.length; i++) seed = (Math.imul(seed, 31) + sp.id.charCodeAt(i)) | 0
  const rnd = rng(seed ^ 0x51ed270b), pal: Palette = PALETTES[sp.style]
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
  const between = (a: number, b: number) => a + (b - a) * rnd()
  const tint = (c: V3, k = 0.07): V3 => { const f = 1 + (rnd() - 0.5) * 2 * k; return [clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255)] }
  const out: Layout = { extent: sp.r, blds: [], fields: [], streets: [], yards: [], style: sp.style }
  const tier = tierOf(sp.pop)
  const cell = clamp(sp.r / 30, 6, 90), grid = new Spatial(cell), fgrid = new Spatial(cell * 4)
  const wallC = pick(pal.walls), roofC = pick(pal.roofs) // per-settlement leaning: neighbours share a look, with variation below
  const colors = (): [V3, V3] => [tint(rnd() < 0.55 ? wallC : pick(pal.walls)), tint(rnd() < 0.55 ? roofC : pick(pal.roofs))]

  const add = (k: Bld['k'], x: number, z: number, rot: number, s: number, o: { w?: V3; r?: V3; prio?: boolean; h?: number; room?: number; slope?: number; keep?: boolean; water?: boolean } = {}) => {
    const rad = s * (FOOT[k] ?? 0.45) * (o.room ?? 1)
    if (!o.keep && !grid.free(x, z, rad)) return false
    if ((!o.water && g.wet(x, z)) || (!o.water && g.slope(x, z) > (o.slope ?? 0.42))) return false
    const [w, r] = colors()
    out.blds.push({ k, x, z, rot, s, w: o.w ?? w, r: o.r ?? r, prio: o.prio ?? TALL.has(k), h: o.h })
    grid.add(x, z, rad)
    return true
  }
  /** Fields in a rectangle patchwork over [rMin, rMax] around (cx, cz), on fertile flat ground only. */
  const fields = (cx: number, cz: number, rMin: number, rMax: number, gs: number, limit: number, within?: (x: number, z: number) => boolean) => {
    const ang = rnd() * Math.PI, n = Math.ceil(rMax / gs)
    let count = 0
    for (let j = -n; j <= n && count < limit; j++) for (let i = -n; i <= n && count < limit; i++) {
      const x = cx + (i + 0.5 + (rnd() - 0.5) * 0.5) * gs, z = cz + (j + 0.5 + (rnd() - 0.5) * 0.5) * gs, d = Math.hypot(x - cx, z - cz)
      if (d < rMin || d > rMax || (within && !within(x, z))) continue
      const a = gs * between(0.32, 0.46), b = gs * between(0.22, 0.36), rot = ang + (rnd() - 0.5) * 0.4
      if (!fgrid.free(x, z, Math.max(a, b) * 0.9) || !grid.free(x, z, Math.min(a, b) * 0.7) || !g.arable(x, z) || g.wet(x, z) || g.slope(x, z) > 0.16) continue
      const [c1, c2] = pick(CROPS)
      out.fields.push({ x, z, a, b, rot, c1: tint(c1, 0.05), c2: tint(c2, 0.05), stripe: between(2.4, 4.6) })
      fgrid.add(x, z, Math.max(a, b) * 0.9); count++
      // a farmstead at the edge of some fields; a few become orchards
      if (rnd() < 0.07 && count < limit) {
        const fx = x + Math.cos(rot + Math.PI / 2) * (b + 9), fz = z + Math.sin(rot + Math.PI / 2) * (b + 9)
        add(pick<BuildKind>(['cottage', 'house']), fx, fz, rot, between(11, 15)); add('barn', fx + Math.cos(rot) * 16, fz + Math.sin(rot) * 16, rot, between(14, 19)); add('haystack', fx - Math.cos(rot) * 10, fz - Math.sin(rot) * 10, 0, 7)
      } else if (rnd() < 0.05) orchard(x, z, rot, a * 0.8, b * 0.8)
    }
  }
  const orchard = (cx: number, cz: number, rot: number, a: number, b: number) => {
    const sp2 = 11, c = Math.cos(rot), s = Math.sin(rot)
    for (let u = -a; u <= a; u += sp2) for (let v = -b; v <= b; v += sp2) add('oak', cx + c * u - s * v, cz + s * u + c * v, rnd() * TAU, between(5.5, 7.5), { w: tint([96, 140, 64], 0.12), keep: true, room: 0.5 })
  }
  const ringOf = (cx: number, cz: number, radius: (a: number) => number, n: number, from = 0): P2[] => Array.from({ length: n + 1 }, (_, i) => { const a = from + i / n * TAU, r = radius(a); return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as P2 })
  /** Wall segments with towers and optional gates along a closed or open polyline. */
  const wall = (pts: P2[], seg: number, gates: number[] = [], opts: { towers?: number; wood?: boolean; corners?: boolean } = {}) => {
    const wc: V3 | undefined = opts.wood ? [126, 92, 60] : undefined, tw = opts.towers ?? 4
    let n = 0
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), rot = Math.atan2(bz - az, bx - ax), steps = Math.max(1, Math.round(len / seg)), L = len / steps
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t
        const gate = gates.includes(i) && k === Math.floor(steps / 2)
        if (gate) add('gate', x, z, rot, L * 1.5, { keep: true, w: wc, prio: true })
        else if (tw > 0 && n % tw === tw - 1 && !opts.wood) add('walltower', x, z, rot, L * 0.95, { keep: true, w: wc })
        else add('wallseg', x, z, rot, L * 1.04, { keep: true, w: wc, prio: true })
        n++
      }
      if (opts.corners) add('walltower', ax, az, rot, seg * 1.5, { keep: true, w: wc })
    }
  }
  const yard = (x: number, z: number, r: number, c?: V3, a = 0.9) => out.yards.push({ x, z, r, c: c ?? pal.ground, a })

  if (sp.cls === 'bridge') return bridge(sp, g, out, add)

  if (sp.cls === 'settlement') {
    // ---------- towns and cities ----------
    const R = sp.r, N = Math.min(14000, Math.round(50 * (sp.pop / 500) ** 0.78))
    const s0 = Math.sqrt(0.2 * Math.PI * R * R / N)
    const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU], blobR = (a: number) => R * (0.84 + 0.1 * Math.sin(2 * a + ph[0]) + 0.06 * Math.sin(3 * a + ph[1]) + 0.04 * Math.sin(5 * a + ph[2]))
    out.blob = Array.from({ length: 72 }, (_, i) => blobR(i / 72 * TAU))
    const rho = (x: number, z: number) => Math.hypot(x, z) / blobR(Math.atan2(z, x))
    const F = [120, 260, 420, 900, 1400, 2400][tier]
    out.extent = R * 1.1 + F
    const streetW = clamp(s0 * 0.5, 3, 14)

    // harbour first, so houses keep clear of the docks
    const shore: { x: number; z: number; dx: number; dz: number }[] = []
    for (let k = 0; k < 96; k++) {
      const a = k / 96 * TAU, dx = Math.cos(a), dz = Math.sin(a), step = Math.max(R / 50, sp.type === 'port' ? 12 : 0)
      let px = 0, pz = 0, seen = !g.wet(0, 0)
      for (let d = step; d < (sp.type === 'port' ? Math.max(R * 1.25, 900) : R * 1.25); d += step) { const x = dx * d, z = dz * d; if (g.wet(x, z)) { if (seen) shore.push({ x: px, z: pz, dx, dz }); break } seen = true; px = x; pz = z }
    }
    if (shore.length) {
      const want = sp.type === 'port' ? Math.max(8, tier * 3) : tier >= 4 ? 14 : tier >= 3 ? 7 : tier >= 2 ? 3 : 1, stride = Math.max(1, Math.floor(shore.length / want)), ds = clamp(s0 * 3.4, 14, 120)
      for (let i = 0; i < shore.length && want > 0; i += stride) {
        const p = shore[i], rot = Math.atan2(p.dz, p.dx)
        if (!add('dock', p.x + p.dx * ds * 0.35, p.z + p.dz * ds * 0.35, rot, ds, { keep: true, prio: true, w: [118, 86, 56], water: true })) continue
        for (let k = 0; k < 1 + Math.floor(rnd() * (tier >= 4 ? 4 : 2)); k++) add('ship', p.x + p.dx * ds * (1.05 + 0.5 * k) + (rnd() - 0.5) * ds * 0.7, p.z + p.dz * ds * (1.05 + 0.5 * k) + (rnd() - 0.5) * ds * 0.7, rot + (rnd() - 0.5) * 0.7, ds * between(0.7, 1.1), { prio: true, w: [118, 86, 56], keep: true, water: true })
        add('warehouse', p.x - p.dx * ds * 0.95, p.z - p.dz * ds * 0.95, rot + Math.PI / 2, ds * 0.8, { room: 0.9 })
        if (tier >= 3) add('crane', p.x + p.dx * ds * 0.1 + p.dz * ds * 0.3, p.z + p.dz * ds * 0.1 - p.dx * ds * 0.3, rot, ds * 0.7, { keep: true })
      }
    }

    // landmarks
    const civic = (): BuildKind => sp.style === 'adobe' || sp.style === 'crystal' ? 'templeDome' : sp.style === 'tropical' ? 'pagoda' : sp.style === 'ash' || sp.style === 'bone' || sp.style === 'fungal' ? 'hall' : 'church'
    if (tier >= 5) {
      add('rotunda', 0, 0, 0, s0 * 3.2, { prio: true, keep: true }); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU, d = R * 0.12; add('spire', Math.cos(a) * d, Math.sin(a) * d, a, s0 * between(4.5, 6.5), { prio: true, keep: true }) }
    } else if (tier >= 4) { add('rotunda', 0, 0, 0, s0 * 3.4, { prio: true, keep: true }); add(civic(), s0 * 4.6, s0 * 1.5, rnd() * TAU, s0 * 2.8, { prio: true }) }
    else if (tier >= 3) { add(civic(), 0, 0, rnd() * TAU, s0 * 3.1, { prio: true, keep: true }); add('hall', s0 * 3.6, s0 * 1.4, rnd() * TAU, s0 * 2.2, { prio: true }) }
    else if (tier >= 1) add(civic(), 0, 0, rnd() * TAU, s0 * 2.3, { prio: true, keep: true })
    if (tier >= 2) for (let i = 0; i < (tier >= 4 ? 5 : tier >= 3 ? 3 : 1); i++) add('market', ...(((a: number, d: number) => [Math.cos(a) * d, Math.sin(a) * d])(rnd() * TAU, R * between(0.08, 0.3)) as P2), 0, s0 * 3, { prio: true })
    if (sp.type === 'capital' || tier >= 5) { const a = rnd() * TAU, d = R * 0.2; add('palace', Math.cos(a) * d, Math.sin(a) * d, a + Math.PI / 2, s0 * 5, { prio: true, keep: true }) }
    if (tier >= 3) { const a = rnd() * TAU, d = R * 0.55; add('keep', Math.cos(a) * d, Math.sin(a) * d, 0, s0 * 3.4, { prio: true }) }

    // streets: radial spokes that wander a little, and rings around the centre
    const nSp = clamp(Math.round(1.5 * Math.log2(N) - 3), 3, 14), spokes: P2[][] = []
    for (let k = 0; k < nSp; k++) {
      const a0 = (k + rnd() * 0.4) / nSp * TAU, wob = rnd() * TAU, pts: P2[] = []
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, a = a0 + 0.12 * Math.sin(wob + t * 5) * t, d = blobR(a) * t * 1.04, x = Math.cos(a) * d, z = Math.sin(a) * d
        if (g.wet(x, z)) break
        pts.push([x, z])
      }
      if (pts.length > 1) spokes.push([[0, 0], ...pts])
    }
    const rings: P2[][] = []
    for (const r of [0.33, 0.62, 0.86].slice(0, tier >= 4 ? 3 : tier >= 3 ? 2 : tier >= 2 ? 1 : 0)) {
      let cur: P2[] = []
      for (let i = 0; i <= 48; i++) {
        const a = i / 48 * TAU, d = blobR(a) * r * (1 + 0.04 * Math.sin(a * 3 + ph[0])), x = Math.cos(a) * d, z = Math.sin(a) * d
        if (g.wet(x, z)) { if (cur.length > 1) rings.push(cur); cur = []; continue }
        cur.push([x, z])
      }
      if (cur.length > 1) rings.push(cur)
    }
    for (const pts of spokes) out.streets.push({ pts, w: streetW })
    for (const pts of rings) out.streets.push({ pts, w: streetW * 0.75 })
    for (const st of out.streets) for (let i = 0; i + 1 < st.pts.length; i++) { // streets stay clear of buildings
      const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / (st.w * 0.9)))
      for (let k = 0; k < n; k++) grid.add(ax + (bx - ax) * k / n, az + (bz - az) * k / n, st.w * 0.5)
    }

    // what goes where
    const kindAt = (r: number): BuildKind => {
      const u = rnd(), core = r < 0.4, mid = r < 0.75
      switch (sp.style) {
        case 'adobe': return u < 0.55 ? 'adobe' : u < 0.8 ? 'domehouse' : core && tier >= 3 ? 'tenement' : 'adobe'
        case 'northern': return core && tier >= 3 && u < 0.4 ? 'house' : u < 0.5 ? 'cabin' : u < 0.75 ? 'cottage' : 'longhouse'
        case 'tropical': return u < 0.55 ? 'hut' : u < 0.9 ? 'stilt' : 'longhouse'
        case 'marsh': return u < 0.7 ? 'stilt' : u < 0.92 ? 'hut' : 'cabin'
        case 'crystal': return u < 0.4 ? 'domehouse' : u < 0.7 ? 'hut' : 'house'
        case 'fungal': return u < 0.6 ? 'hut' : 'domehouse'
        case 'bone': return u < 0.4 ? 'hut' : u < 0.7 ? 'longhouse' : 'cottage'
        case 'ash': return core && tier >= 3 && u < 0.4 ? 'tenement' : u < 0.7 ? 'house' : 'cottage'
        default: return core && tier >= 3 ? (u < 0.34 ? 'tenement' : u < 0.62 ? 'rowhouse' : 'house') : mid ? (u < 0.5 ? 'house' : u < 0.8 ? 'cottage' : tier >= 3 && u < 0.9 ? 'rowhouse' : 'longhouse') : u < 0.5 ? 'cottage' : u < 0.65 ? 'longhouse' : 'house'
      }
    }
    const building = (r: number): { k: BuildKind; s: number } => {
      let k = kindAt(r), s = s0 * between(0.8, 1.35)
      if (tier >= 4 && r < 0.55) { // the middle of a great city rises into towers
        const u = rnd()
        if (u < 0.22) { k = 'stepped'; s = s0 * between(2.2, 3.6) * (1.2 - r * 0.8) } else if (u < 0.34 && tier >= 5) { k = 'spire'; s = s0 * between(3.4, 5.5) * (1.2 - r * 0.6) } else if (u < 0.4) { k = 'rotunda'; s = s0 * between(1.8, 2.6) }
      }
      return { k, s: s * (k === 'tenement' ? 1.25 : k === 'hut' ? 0.8 : 1) }
    }
    const place = (x: number, z: number, rot: number) => {
      const r = rho(x, z)
      if (r > 1.02 || out.blds.length > N * 1.1) return false
      const b = building(r)
      return add(b.k, x, z, rot, b.s, { room: 0.85 })
    }
    // along the streets first
    for (const st of out.streets) {
      let carried = 0
      for (let i = 0; i + 1 < st.pts.length; i++) {
        const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len, step = s0 * 1.2
        for (let d = step - carried; d < len; d += step) {
          for (const side of [-1, 1]) {
            if (rnd() < 0.12) continue
            const off = st.w / 2 + s0 * 0.62
            place(ax + tx * d - tz * side * off, az + tz * d + tx * side * off, Math.atan2(tz, tx) + (rnd() - 0.5) * 0.08)
          }
          carried = 0
        }
        carried = len % step
      }
    }
    // then infill, a little denser toward the middle
    let tries = 0, made = out.blds.length
    while (made < N && tries++ < N * 6) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()), d = blobR(a) * r
      if (rnd() > 1 - 0.45 * r * r) continue
      if (place(Math.cos(a) * d, Math.sin(a) * d, a + Math.PI / 2 + (rnd() - 0.5) * 0.4)) made++
    }

    // walls: a ring just outside the blob, with towers and a gate at the end of every spoke
    const walled = sp.walled ?? (tier >= 2 && sp.style !== 'tropical' && sp.style !== 'marsh')
    if (walled) {
      const seg = clamp(R * 0.05, 9, 70), ring = ringOf(0, 0, (a) => blobR(a) * 1.06, Math.max(24, Math.round(TAU * R * 1.06 / seg)))
      const gates = spokes.map((s) => { const e = s[s.length - 1], a = Math.atan2(e[1], e[0]); return Math.round(((a + TAU) % TAU) / TAU * (ring.length - 1)) % (ring.length - 1) })
      wall(ring, seg, gates, { towers: 4 })
    }
    yard(0, 0, R * 0.12, pal.road, 0.8) // the main square
    fields(0, 0, R * 1.12, out.extent, clamp(s0 * 5.5, 50, 260), tier >= 5 ? 160 : 600)
    return out
  }

  // ---------- single sites ----------
  const R = sp.r, ang = rnd() * TAU, c = Math.cos(ang), s = Math.sin(ang)
  const at = (u: number, v: number): P2 => [c * u - s * v, s * u + c * v] // rotate (u along the site's axis, v across)
  const house = (): BuildKind => sp.style === 'adobe' ? 'adobe' : sp.style === 'tropical' ? 'hut' : sp.style === 'marsh' ? 'stilt' : sp.style === 'northern' ? 'cabin' : sp.style === 'fungal' ? 'hut' : 'cottage'
  const farmFields = (rMin: number, rMax: number, gs: number, limit: number) => fields(0, 0, rMin, rMax, gs, limit)
  switch (sp.type) {
    case 'farm': {
      yard(0, 0, 36)
      add(house(), 0, 0, ang, 15, { keep: true }); add('barn', ...at(30, 8), ang + Math.PI / 2, 22, { keep: true }); add('silo', ...at(30, -10), 0, 12, { keep: true })
      for (let i = 0; i < 3; i++) add('haystack', ...at(between(14, 40), between(-30, -16)), 0, between(7, 10))
      if (rnd() < 0.3) add('windmill', ...at(-34, 14), ang, 26, { keep: true })
      orchard(...at(-8, 36), ang, 28, 18)
      out.streets.push({ pts: [[0, 0], at(R * 1.2, between(-8, 8))], w: 4 })
      farmFields(34, R * 1.35, between(62, 84), 11); out.extent = R * 1.5
      break
    }
    case 'manor': {
      yard(0, 0, 54, pal.road, 0.85)
      add('hall', 0, 0, ang, 40, { keep: true, prio: true }); add('longhouse', ...at(-34, 22), ang, 26, { keep: true }); add('barn', ...at(36, 24), ang, 24, { keep: true }); add('barn', ...at(40, -22), ang + Math.PI / 2, 20, { keep: true })
      for (let i = 0; i < 5; i++) add(house(), ...at(between(-60, 60), (i % 2 ? 1 : -1) * between(46, 62)), ang + (rnd() - 0.5) * 0.4, between(11, 15))
      orchard(...at(-20, -56), ang, 30, 18)
      out.streets.push({ pts: [at(0, 0), at(R * 1.4, 4)], w: 5 })
      farmFields(60, R * 1.45, between(70, 92), 16); out.extent = R * 1.6
      break
    }
    case 'castle': {
      const rw = R * between(0.26, 0.32), ring = ringOf(0, 0, (a) => rw * (0.88 + 0.16 * Math.sin(a * 3 + ang)), 8, ang)
      yard(0, 0, rw * 1.15, pal.ground, 0.9)
      add('keep', 0, 0, ang, rw * 0.82, { keep: true, prio: true }); wall(ring, 20, [3], { towers: 0, corners: true })
      add('hall', ...at(-rw * 0.5, rw * 0.35), ang, 30, { keep: true }); add('longhouse', ...at(rw * 0.45, -rw * 0.45), ang, 24, { keep: true })
      for (let i = 0; i < 5; i++) add(house(), ...at(between(-rw * 0.7, rw * 0.7), between(-rw * 0.7, rw * 0.7)), rnd() * TAU, between(9, 13))
      out.extent = R * 0.8
      break
    }
    case 'fort': {
      const q = R * 0.36, sq: P2[] = [[-q, -q], [q, -q], [q, q], [-q, q], [-q, -q]].map(([u, v]) => at(u, v))
      yard(0, 0, q * 1.3, pal.ground, 0.9)
      wall(sq, 9, [0], { towers: 0, wood: true }); add('walltower', ...at(q, q), 0, 20, { keep: true, w: [126, 92, 60] }); add('walltower', ...at(-q, -q), 0, 20, { keep: true, w: [126, 92, 60] })
      for (let i = 0; i < 6; i++) add('tent', ...at(between(-q * 0.7, q * 0.7), between(-q * 0.7, q * 0.7)), rnd() * TAU, between(8, 11))
      out.extent = R * 0.8
      break
    }
    case 'tower': {
      yard(0, 0, R * 0.7, pal.ground, 0.8)
      add('walltower', 0, 0, ang, 50, { keep: true, prio: true, w: sp.style === 'timber' ? [150, 146, 140] : undefined, r: sp.style === 'timber' ? [88, 60, 110] : undefined }); add(house(), ...at(30, 12), ang, 11); add('haystack', ...at(36, -8), 0, 7)
      out.extent = R * 1.3
      break
    }
    case 'temple': {
      const big = civic(sp.style); yard(0, 0, R * 0.8, pal.road, 0.85)
      add(big, 0, 0, ang, 44, { keep: true, prio: true }); for (let i = 0; i < 4; i++) add(house(), ...at(between(-60, 60), (i % 2 ? 1 : -1) * between(48, 62)), ang, 11)
      wall([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([u, v]) => at(u * R * 0.55, v * R * 0.55)) as P2[], 14, [0], { towers: 0 })
      out.extent = R * 1.2
      break
    }
    case 'monastery': {
      const q = R * 0.34; yard(0, 0, q * 1.4, pal.road, 0.85)
      add('church', 0, 0, ang, 46, { keep: true, prio: true }); for (const [u, v] of [[0, 1], [0, -1]]) add('longhouse', ...at(u * 0 + 8, v * 40), ang, 28, { keep: true }); add('hall', ...at(-42, 0), ang + Math.PI / 2, 24, { keep: true })
      for (let i = 0; i < 4; i++) add(house(), ...at(between(-46, 46), (i % 2 ? 1 : -1) * between(54, 66)), ang, 10)
      wall([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([u, v]) => at(u * R * 0.5, v * R * 0.5)) as P2[], 14, [0], { towers: 0 })
      orchard(...at(R * 0.8, 0), ang, 28, 20); farmFields(R * 0.6, R * 1.3, 66, 8); out.extent = R * 1.5
      break
    }
    case 'mine': {
      yard(0, 0, R * 0.7, [58, 50, 44], 0.92)
      add('headframe', 0, 0, ang, 44, { keep: true, prio: true }); add('warehouse', ...at(36, 14), ang, 22, { keep: true }); add('warehouse', ...at(30, -22), ang + 0.4, 18, { keep: true })
      for (let i = 0; i < 3; i++) add('spoil', ...at(between(-60, -30), between(-42, 42)), 0, between(24, 40), { keep: true, w: [72, 62, 54] })
      for (let i = 0; i < 5; i++) add(house(), ...at(between(20, 70), between(30, 60) * (i % 2 ? 1 : -1)), ang, between(9, 12), { room: 0.8 })
      out.streets.push({ pts: [at(0, 0), at(R * 1.2, 8)], w: 4 }); out.extent = R * 1.3
      break
    }
    case 'windmill': {
      yard(0, 0, 26); add('windmill', 0, 0, ang, 36, { keep: true, prio: true }); add('barn', ...at(26, 10), ang + 0.3, 18, { keep: true }); add(house(), ...at(-22, 20), ang, 13)
      farmFields(30, R * 1.5, between(56, 74), 9); out.extent = R * 1.7
      break
    }
    case 'lighthouse': {
      yard(0, 0, R * 0.9, [120, 112, 100], 0.85); add('lighthouse', 0, 0, ang, 46, { keep: true, prio: true, water: true }); add(house(), ...at(26, 8), ang, 12, { water: true }); out.extent = R * 1.6
      break
    }
    case 'ruins': {
      yard(0, 0, R * 0.7, [96, 104, 76], 0.7)
      for (let i = 0; i < 9; i++) { const a = rnd() * TAU, d = between(0.1, 0.6) * R; add('ruin', Math.cos(a) * d, Math.sin(a) * d, rnd() * TAU, between(14, 26), { room: 0.9 }) }
      for (let i = 0; i < 12; i++) { const a = rnd() * TAU, d = between(0.05, 0.9) * R; add(rnd() < 0.5 ? 'oak' : 'bush', Math.cos(a) * d, Math.sin(a) * d, rnd() * TAU, between(5, 9), { w: tint([86, 122, 70], 0.15), room: 0.5 }) }
      out.extent = R * 1.2
      break
    }
    case 'camp': {
      yard(0, 0, R * 0.8, [110, 96, 70], 0.8)
      add('tent', 0, 0, ang, 15, { keep: true, prio: true, r: [200, 60, 50] })
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, d = R * between(0.3, 0.5); add('tent', Math.cos(a) * d, Math.sin(a) * d, a, between(8, 11), { w: tint([226, 216, 190], 0.08) }) }
      for (let i = 0; i < 3; i++) add('haystack', ...at(between(-30, 30), between(40, 55)), 0, 7)
      out.extent = R * 1.2
      break
    }
    default: add(house(), 0, 0, ang, 14, { keep: true })
  }
  return out
}
const civic = (style: Style): BuildKind => style === 'adobe' || style === 'crystal' ? 'templeDome' : style === 'tropical' ? 'pagoda' : style === 'ash' || style === 'bone' || style === 'fungal' ? 'hall' : 'church'

/** A bridge: repeated span units along its direction at one height, with the approaches on both banks. */
function bridge(sp: SiteSpec, g: Ground, out: Layout, add: (k: Bld['k'], x: number, z: number, rot: number, s: number, o?: { w?: V3; r?: V3; prio?: boolean; h?: number; keep?: boolean; slope?: number; water?: boolean }) => boolean): Layout {
  const { len, dir, kind } = sp.bridge!, dx = Math.cos(dir), dz = Math.sin(dir)
  const unitKind: BuildKind = kind === 'wood' || kind === 'draw' ? 'deck' : kind === 'rope' ? 'rope' : kind === 'aqueduct' ? 'archTall' : 'arch'
  const width = clamp(len * 0.05, 7, 36), width0 = unitKind === 'archTall' ? 0.4 : unitKind === 'rope' ? 0.3 : 0.44
  const n = Math.max(2, Math.round(len / (width / width0))), u = len / n
  const bank = Math.max(g.h(dx * len / 2, dz * len / 2), g.h(-dx * len / 2, -dz * len / 2)), deckAt = unitKind === 'archTall' ? 0.9 : unitKind === 'arch' ? 0.4 : 0.32
  const base = bank - deckAt * u
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * u - len / 2
    add(unitKind, dx * t, dz * t, dir, u, { keep: true, prio: true, water: true, h: base, slope: 99, w: kind === 'stone' || kind === 'aqueduct' ? undefined : [126, 92, 60] })
  }
  if (kind === 'draw') for (const e of [-1, 1]) add('gate', dx * (len / 2 + width) * e, dz * (len / 2 + width) * e, dir + Math.PI / 2, width * 2.2, { keep: true, prio: true, water: true, slope: 99 })
  out.extent = len * 0.6
  return out
}
