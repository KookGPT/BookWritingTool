// Flat worlds for the New Map Test section: a rectangle or a disc of land and sea, built from named features.
// Not a planet: x/y are km from the map centre. Heights are stylised (drawn many times taller than life).
// Pure and deterministic (no DOM, `.ts` imports): the app's worker, the CLI and the tests all run this.
import { fbm, hash, hash4, ridged, simplex } from '../world/noise.ts'

export type XY = [number, number] // km from the map centre: x east, y north

export interface MapFeature {
  id: string; kind: FeatureKind; name?: string; note?: string
  at?: XY; path?: XY[]; area?: XY[] // exactly one, as the kind says
  height?: number // m above sea: land, hills, plateau, range, peak, volcano
  depth?: number // m: canyon
  width?: number // km: range, canyon, river (at its mouth)
  radius?: number // km: peak, volcano
}
export interface FlatWorld {
  id: string; name: string; note?: string
  shape: 'rect' | 'disc'; size: [number, number] // km, width x height (a disc uses the width as its diameter)
  seed: string; relief?: number // height exaggeration multiplier, 1 = default
  features: MapFeature[] // the ground: Claude writes these
  layers?: MapLayer[] // things on the ground: the user adds these with the map tools (Claude can too, same format)
}

/** A thing on a layer: a point (city, landmark), a line (border, road) or an area (region). */
export interface MapItem { id: string; name?: string; note?: string; at?: XY; path?: XY[]; area?: XY[]; size?: CitySize; icon?: Landmark }
export interface MapLayer { id: string; name: string; kind: LayerKind; color?: string; hidden?: boolean; items: MapItem[] }
export const LAYER_KINDS = {
  cities: { geom: 'at', label: 'Cities & towns', color: '#3b2a1e' },
  landmarks: { geom: 'at', label: 'Landmarks', color: '#5b3a22' },
  regions: { geom: 'area', label: 'Regions & nations', color: '#c0504d' },
  borders: { geom: 'path', label: 'Borders', color: '#7a2230' },
  roads: { geom: 'path', label: 'Roads & routes', color: '#8a5a2b' },
} as const
export type LayerKind = keyof typeof LAYER_KINDS
export const CITY_SIZES = ['hamlet', 'town', 'city', 'capital'] as const
export type CitySize = typeof CITY_SIZES[number]
export const LANDMARKS = { castle: 'Castle', tower: 'Tower', temple: 'Temple', shrine: 'Shrine', ruins: 'Ruins', cave: 'Cave', monument: 'Monument', battle: 'Battlefield', port: 'Port', mine: 'Mine', camp: 'Camp', lighthouse: 'Lighthouse' } as const
export type Landmark = keyof typeof LANDMARKS
export const layerColor = (l: MapLayer) => l.color ?? LAYER_KINDS[l.kind]?.color ?? '#333333'

type RGB = [number, number, number]
/** Ground types. `paint: true` = a feature kind you can paint as an area; the rest come from height and slope. */
export const BIOMES: Record<string, { color: RGB; tree?: TreeKind; trees?: number; paint?: boolean; label?: string }> = {
  grass: { color: [118, 170, 72], tree: 'broad', trees: 0.04, paint: true, label: 'Grassland' },
  forest: { color: [72, 130, 58], tree: 'broad', trees: 0.92, paint: true, label: 'Forest' },
  taiga: { color: [92, 124, 88], tree: 'pine', trees: 0.88, paint: true, label: 'Pine forest' },
  jungle: { color: [48, 124, 62], tree: 'jungle', trees: 1, paint: true, label: 'Jungle' },
  savanna: { color: [200, 184, 96], tree: 'broad', trees: 0.07, paint: true, label: 'Savanna' },
  steppe: { color: [180, 178, 108], paint: true, label: 'Steppe' },
  desert: { color: [234, 198, 122], tree: 'cactus', trees: 0.025, paint: true, label: 'Desert' },
  swamp: { color: [96, 118, 70], tree: 'swamp', trees: 0.45, paint: true, label: 'Swamp' },
  tundra: { color: [168, 174, 146], tree: 'pine', trees: 0.03, paint: true, label: 'Tundra' },
  snow: { color: [242, 246, 252], paint: true, label: 'Snowfield' },
  meadow: { color: [146, 186, 88] },
  beach: { color: [236, 216, 162] },
  rock: { color: [152, 134, 116] },
  ash: { color: [82, 74, 72] },
  seabed: { color: [196, 186, 150] },
}
export const TREE_KINDS = ['broad', 'pine', 'jungle', 'cactus', 'swamp'] as const
export type TreeKind = typeof TREE_KINDS[number]

const PAINT = Object.keys(BIOMES).filter((b) => BIOMES[b].paint)
type Geom = 'at' | 'path' | 'area'
export const FEATURE_KINDS: Record<string, { geom: Geom; label: string; height?: number; depth?: number; width?: number; radius?: number }> = {
  land: { geom: 'area', label: 'Land: a continent or island outline', height: 260 },
  sea: { geom: 'area', label: 'Sea or bay cut out of land' },
  range: { geom: 'path', label: 'Mountain range along its crest', height: 3400, width: 110 },
  peak: { geom: 'at', label: 'Lone mountain', height: 3800, radius: 45 },
  volcano: { geom: 'at', label: 'Volcano (smokes, lava glow)', height: 3200, radius: 55 },
  hills: { geom: 'area', label: 'Hills', height: 700 },
  plateau: { geom: 'area', label: 'Plateau or mesa with cliffs', height: 1100 },
  canyon: { geom: 'path', label: 'Canyon', depth: 900, width: 22 },
  river: { geom: 'path', label: 'River from source to mouth (it finds the sea)', width: 6 },
  lake: { geom: 'area', label: 'Lake' },
  ...Object.fromEntries(PAINT.map((b) => [b, { geom: 'area' as Geom, label: `${BIOMES[b].label} (painted area)` }])),
}
export type FeatureKind = string

// ---------- validation (trust boundary: imported JSON) ----------

const isXY = (v: unknown): v is XY => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
export function validate(w: unknown): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = []
  const o = w as FlatWorld
  if (!o || typeof o !== 'object') return { errors: ['not an object'], warnings }
  if (typeof o.id !== 'string' || !o.id) errors.push('id must be a non-empty string')
  if (typeof o.name !== 'string') errors.push('name must be a string')
  if (o.shape !== 'rect' && o.shape !== 'disc') errors.push('shape must be "rect" or "disc"')
  if (!isXY(o.size) || o.size.some((n) => n < 100 || n > 40000)) errors.push('size must be [widthKm, heightKm], each 100..40000')
  if (typeof o.seed !== 'string') errors.push('seed must be a string')
  if (o.relief !== undefined && !(typeof o.relief === 'number' && o.relief > 0 && o.relief <= 5)) errors.push('relief must be a number in (0, 5]')
  if (!Array.isArray(o.features)) { errors.push('features must be an array'); return { errors, warnings } }
  const ids = new Set<string>()
  const [W, H] = isXY(o.size) ? o.size : [1, 1]
  const out = (p: XY) => o.shape === 'disc' ? Math.hypot(p[0], p[1]) > W / 2 : Math.abs(p[0]) > W / 2 || Math.abs(p[1]) > H / 2
  for (const [n, f] of o.features.entries()) {
    const at = `features[${n}]${f && typeof f.id === 'string' ? ` (${f.id})` : ''}`
    if (!f || typeof f !== 'object') { errors.push(`${at}: not an object`); continue }
    if (typeof f.id !== 'string' || !f.id) errors.push(`${at}: id must be a non-empty string`)
    else if (ids.has(f.id)) errors.push(`${at}: duplicate id`)
    else ids.add(f.id)
    const spec = FEATURE_KINDS[f.kind]
    if (!spec) { errors.push(`${at}: unknown kind "${f.kind}" (one of ${Object.keys(FEATURE_KINDS).join(', ')})`); continue }
    const pts = spec.geom === 'at' ? (isXY(f.at) ? [f.at] : null) : Array.isArray(f[spec.geom]) && (f[spec.geom] as unknown[]).every(isXY) ? f[spec.geom] as XY[] : null
    if (!pts) { errors.push(`${at}: ${f.kind} needs "${spec.geom}" as ${spec.geom === 'at' ? '[x, y]' : 'a list of [x, y]'} in km`); continue }
    if (spec.geom === 'area' && pts.length < 3) errors.push(`${at}: an area needs at least 3 points`)
    if (spec.geom === 'path' && pts.length < 2) errors.push(`${at}: a path needs at least 2 points`)
    for (const k of ['at', 'path', 'area'] as const) if (k !== spec.geom && f[k] !== undefined) errors.push(`${at}: ${f.kind} uses "${spec.geom}", not "${k}"`)
    for (const k of ['height', 'depth', 'width', 'radius'] as const) if (f[k] !== undefined && !(typeof f[k] === 'number' && f[k]! > 0 && f[k]! < 20000)) errors.push(`${at}: ${k} must be a positive number`)
    if (pts.some(out)) warnings.push(`${at}: some points are outside the map`)
    if (!f.name && ['range', 'peak', 'volcano', 'river', 'lake', 'land', 'sea'].includes(f.kind)) warnings.push(`${at}: give it a name`)
  }
  if (o.layers !== undefined && !Array.isArray(o.layers)) errors.push('layers must be an array')
  for (const [n, l] of (Array.isArray(o.layers) ? o.layers : []).entries()) {
    const at = `layers[${n}]${l && typeof l.id === 'string' ? ` (${l.id})` : ''}`
    if (!l || typeof l !== 'object') { errors.push(`${at}: not an object`); continue }
    if (typeof l.id !== 'string' || !l.id) errors.push(`${at}: id must be a non-empty string`)
    else if (ids.has(l.id)) errors.push(`${at}: duplicate id`)
    else ids.add(l.id)
    if (typeof l.name !== 'string') errors.push(`${at}: name must be a string`)
    const spec = LAYER_KINDS[l.kind]
    if (!spec) { errors.push(`${at}: unknown kind "${l.kind}" (one of ${Object.keys(LAYER_KINDS).join(', ')})`); continue }
    if (l.color !== undefined && !/^#[0-9a-f]{6}$/i.test(l.color)) errors.push(`${at}: color must be like "#aa3300"`)
    if (!Array.isArray(l.items)) { errors.push(`${at}: items must be an array`); continue }
    for (const [q, it] of l.items.entries()) {
      const where = `${at}.items[${q}]${it && typeof it.id === 'string' ? ` (${it.id})` : ''}`
      if (!it || typeof it !== 'object') { errors.push(`${where}: not an object`); continue }
      if (typeof it.id !== 'string' || !it.id) errors.push(`${where}: id must be a non-empty string`)
      else if (ids.has(it.id)) errors.push(`${where}: duplicate id`)
      else ids.add(it.id)
      const g = spec.geom
      const pts = g === 'at' ? (isXY(it.at) ? [it.at] : null) : Array.isArray(it[g]) && (it[g] as unknown[]).every(isXY) ? it[g] as XY[] : null
      if (!pts) { errors.push(`${where}: ${l.kind} items need "${g}"`); continue }
      if (g === 'area' && pts.length < 3) errors.push(`${where}: an area needs at least 3 points`)
      if (g === 'path' && pts.length < 2) errors.push(`${where}: a path needs at least 2 points`)
      if (it.size !== undefined && !CITY_SIZES.includes(it.size)) errors.push(`${where}: size must be one of ${CITY_SIZES.join(', ')}`)
      if (it.icon !== undefined && !(it.icon in LANDMARKS)) errors.push(`${where}: icon must be one of ${Object.keys(LANDMARKS).join(', ')}`)
      if (pts.some(out)) warnings.push(`${where}: some points are outside the map`)
    }
  }
  return { errors, warnings }
}

// ---------- generation ----------

export interface RiverLine { id: string; name?: string; pts: XY[]; ch: number[]; width: number[] } // ch = water surface, m
export interface Gen {
  w: number; h: number; cell: number; W: number; H: number; disc: boolean
  height: Float32Array // m, sea level 0
  rgba: Uint8Array // ground colour; alpha < 255 marks glowing lava
  depth: Uint8Array // water depth, 0..255 over 0..1200 m (0 on land)
  tree: Uint8Array // 1 + index into TREE_KINDS, 0 = none
  dens: Uint8Array // tree density 0..255
  rivers: RiverLine[]
  vents: { id: string; at: XY; top: number }[] // volcano craters
  exag: number // display km per km of height
  maxH: number
  wx: Float32Array; wy: Float32Array // the shared warp: a feature written at p is drawn near p - warp
  anchors: Record<string, XY> // where named features are drawn: the point deepest inside an area, a peak's summit
  lines: Record<string, XY[]> // crest lines of ranges and canyons as drawn (warped); rivers use `rivers`
  snaps: Float32Array // x, y pairs on coasts, rivers and crests, for snapping borders and roads
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Display exaggeration: the tallest mountains stand a few percent of the map's width, at every zoom. */
export const exagOf = (fw: FlatWorld) => Math.max(fw.size[0], fw.size[1]) / 90 * (fw.relief ?? 1)

export function generate(fw: FlatWorld, long = 1536): Gen {
  const cell = Math.max(fw.size[0], fw.size[1]) / long
  const w = Math.round(fw.size[0] / cell), h = Math.round(fw.size[1] / cell)
  const W = w * cell, H = h * cell, N = w * h, disc = fw.shape === 'disc'
  const X = (i: number) => -W / 2 + (i + 0.5) * cell, Y = (j: number) => H / 2 - (j + 0.5) * cell
  const FI = (x: number) => (x + W / 2) / cell - 0.5, FJ = (y: number) => (H / 2 - y) / cell - 0.5
  const s0 = hash(fw.seed)
  const nA = simplex(s0), nB = simplex(s0 + 1), nC = simplex(s0 + 2), nD = simplex(s0 + 3)
  const size = Math.max(W, H)
  // Smooth noise fields are sampled every 4th cell and interpolated: they vary over tens of km, and this is most of the cost.
  const coarse = (fn: (x: number, y: number) => number) => {
    const S = 4, cw = Math.ceil(w / S) + 1, chh = Math.ceil(h / S) + 1, c = new Float32Array(cw * chh), out = new Float32Array(N)
    for (let b = 0; b < chh; b++) for (let a = 0; a < cw; a++) c[b * cw + a] = fn(X(a * S), Y(b * S))
    for (let j = 0; j < h; j++) {
      const b = Math.floor(j / S), ty = j / S - b
      for (let i = 0; i < w; i++) { const a = Math.floor(i / S), tx = i / S - a, q = b * cw + a; out[j * w + i] = mix(mix(c[q], c[q + 1], tx), mix(c[q + cw], c[q + cw + 1], tx), ty) }
    }
    return out
  }

  // Domain warp shared by every outline, so coasts, ranges and painted areas bend together and nothing is a clean circle or polygon.
  // Two scales: broad bends (peninsulas, bays) and a finer ragged edge.
  const a1 = size * 0.024, l1 = size / 6, a2 = size * 0.009, l2 = size / 28, wA = a1 + a2
  const wx = coarse((x, y) => a1 * fbm(nA, x / l1, y / l1, 0.5, 3) + a2 * fbm(nA, x / l2, y / l2, 20.5, 4))
  const wy = coarse((x, y) => a1 * fbm(nA, x / l1, y / l1, 7.5, 3) + a2 * fbm(nA, x / l2, y / l2, 31.5, 4))
  const warp = (p: XY): XY => { const k = idx(Math.round(FI(p[0])), Math.round(FJ(p[1]))); return [p[0] - wx[k], p[1] - wy[k]] }
  const idx = (i: number, j: number) => Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))

  // Scratch fields for one feature at a time, only touched inside its box.
  const tmp = new Float32Array(N), along = new Float32Array(N), inside = new Uint8Array(N)
  type Box = [number, number, number, number]
  const boxOf = (pts: XY[], pad: number): Box => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity
    for (const [x, y] of pts) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y) }
    return [Math.max(0, Math.floor(FI(a - pad))), Math.min(w - 1, Math.ceil(FI(b + pad))), Math.max(0, Math.floor(FJ(d + pad))), Math.min(h - 1, Math.ceil(FJ(c - pad)))]
  }
  // Distance (km, capped) from each sample in the box to a polyline, and the arc length at the closest point.
  const distField = (pts: XY[], closed: boolean, cap: number, box: Box) => {
    for (let j = box[2]; j <= box[3]; j++) tmp.fill(cap, j * w + box[0], j * w + box[1] + 1)
    let s = 0
    const n = closed ? pts.length : pts.length - 1
    for (let q = 0; q < n; q++) {
      const [ax, ay] = pts[q], [bx, by] = pts[(q + 1) % pts.length]
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2)
      const [i0, i1, j0, j1] = boxOf([pts[q], pts[(q + 1) % pts.length]], cap)
      for (let j = Math.max(j0, box[2]); j <= Math.min(j1, box[3]); j++) {
        const y = Y(j)
        for (let i = Math.max(i0, box[0]); i <= Math.min(i1, box[1]); i++) {
          const x = X(i), t = len2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0
          const d = Math.hypot(x - ax - t * dx, y - ay - t * dy), k = j * w + i
          if (d < tmp[k]) { tmp[k] = d; along[k] = s + t * len }
        }
      }
      s += len
    }
    return s
  }
  // Signed distance to a polygon (negative inside), capped.
  const sdField = (poly: XY[], cap: number, box: Box) => {
    distField(poly, true, cap, box)
    for (let j = box[2]; j <= box[3]; j++) {
      const y = Y(j), xs: number[] = []
      for (let q = 0; q < poly.length; q++) {
        const [ax, ay] = poly[q], [bx, by] = poly[(q + 1) % poly.length]
        if ((ay > y) !== (by > y)) xs.push(ax + (y - ay) / (by - ay) * (bx - ax))
      }
      xs.sort((a, b) => a - b)
      for (let i = box[0]; i <= box[1]; i++) inside[j * w + i] = 0
      for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(box[0], Math.ceil(FI(xs[q]))); i <= Math.min(box[1], Math.floor(FI(xs[q + 1]))); i++) inside[j * w + i] = 1
      for (let i = box[0]; i <= box[1]; i++) { const k = j * w + i; if (inside[k]) tmp[k] = -tmp[k] }
    }
  }
  // The scratch field read at the warped position of sample k, clamped to its box.
  const warped = (k: number, i: number, j: number, box: Box, f = tmp) => {
    const fi = Math.min(box[1], Math.max(box[0], i + wx[k] / cell)), fj = Math.min(box[3], Math.max(box[2], j - wy[k] / cell))
    const i0 = Math.min(box[1] - 1, Math.floor(fi)), j0 = Math.min(box[3] - 1, Math.floor(fj)), tx = fi - i0, ty = fj - j0
    if (i0 < box[0] || j0 < box[2]) return f[idx(Math.round(fi), Math.round(fj))]
    const a = j0 * w + i0
    return mix(mix(f[a], f[a + 1], tx), mix(f[a + w], f[a + w + 1], tx), ty)
  }
  // Run fn over every sample whose warped position can fall inside the feature's outline (plus pad).
  const over = (pts: XY[], pad: number, fn: (k: number, i: number, j: number, box: Box) => void, field: (box: Box) => void) => {
    const box = boxOf(pts, pad + wA * 2.2 + cell * 2)
    field(box)
    const inner: Box = [box[0], box[1], box[2], box[3]]
    for (let j = inner[2]; j <= inner[3]; j++) for (let i = inner[0]; i <= inner[1]; i++) fn(j * w + i, i, j, box)
  }
  const detail = (x: number, y: number) => 0.6 * fbm(nB, x / 40, y / 40, 1.5, 3) + 0.4 * fbm(nB, x / 11, y / 11, 9.5, 2)

  // 1. Land and sea outlines -> signed distance to the coast.
  const CAP = 170
  const coast = new Float32Array(N).fill(CAP), base = new Float32Array(N).fill(FEATURE_KINDS.land.height!)
  const feats = fw.features
  for (const f of feats) {
    if (f.kind !== 'land' && f.kind !== 'sea') continue
    const poly = f.area!
    over(poly, CAP, (k, i, j, box) => {
      const d = warped(k, i, j, box) + detail(X(i), Y(j)) * 14
      if (f.kind === 'land') { if (d < coast[k]) { coast[k] = d; base[k] = f.height ?? FEATURE_KINDS.land.height! } }
      else coast[k] = Math.max(coast[k], -d)
    }, (box) => sdField(poly, CAP, box))
  }
  // 2. Base height: plains rise gently inland, the sea floor falls away past a shelf.
  const ht = new Float32Array(N), rollF = coarse((x, y) => fbm(nC, x / 160, y / 160, 3.3, 4))
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, d = coast[k], roll = rollF[k]
    ht[k] = d < 0
      ? base[k] * (0.12 + 0.88 * smooth(0, 110, -d)) * (0.75 + 0.5 * Math.max(0, roll)) + 18
      : -(25 + 2700 * smooth(0, 150, d) * (0.85 + 0.3 * roll))
  }

  // 3. Relief features, in file order.
  const vents: Gen['vents'] = []
  const biome = new Uint8Array(N), bw = new Float32Array(N) // painted ground: index+1 into PAINT, weight
  const lava = new Float32Array(N)
  for (const f of feats) {
    const spec = FEATURE_KINDS[f.kind], hh = f.height ?? spec.height ?? 0
    if (f.kind === 'hills' || f.kind === 'plateau') {
      const cliff = f.kind === 'plateau' ? 6 : 35
      over(f.area!, cliff * 2, (k, i, j, box) => {
        const m = smooth(cliff, -cliff, warped(k, i, j, box) + detail(X(i), Y(j)) * 6)
        if (!m) return
        const x = X(i), y = Y(j)
        if (f.kind === 'hills') ht[k] += hh * m * (0.35 + 0.65 * ridged(nD, x / 28, y / 28, 2.1, 4))
        else ht[k] += hh * (Math.floor(m * 3.999) / 3 * 0.25 + m * 0.75) * (0.92 + 0.08 * fbm(nD, x / 30, y / 30, 4, 3))
      }, (box) => sdField(f.area!, cliff * 2, box))
    } else if (f.kind === 'range') {
      const wd = f.width ?? spec.width!, cap = wd * 2.6
      let len = 0
      over(f.path!, cap, (k, i, j, box) => {
        const d = warped(k, i, j, box)
        if (d >= cap) return
        const s = warped(k, i, j, box, along) / len, taper = smooth(0, 0.1, s) * smooth(1, 0.9, s)
        const x = X(i), y = Y(j), t = d / wd
        const crest = Math.pow(1 - smooth(0, 1, t), 1.25) * (0.35 + 0.9 * ridged(nD, x / wd, y / wd, 5.7, 6))
        const foot = (1 - smooth(0, 1, d / cap)) * 0.22
        ht[k] += hh * (crest + foot) * (0.35 + 0.65 * taper)
      }, (box) => { len = distField(f.path!, false, cap, box) })
    } else if (f.kind === 'peak' || f.kind === 'volcano') {
      const r = f.radius ?? spec.radius!, [cx, cy] = f.at!
      if (f.kind === 'volcano') vents.push({ id: f.id, at: f.at!, top: 0 })
      over([f.at!], r, (k, i, j) => {
        const x = X(i), y = Y(j), d = Math.hypot(x - cx + wx[k] * 0.35, y - cy + wy[k] * 0.35) / r
        if (d >= 1) return
        if (f.kind === 'peak') ht[k] += hh * Math.pow(1 - smooth(0, 1, d), 1.5) * (0.75 + 0.35 * ridged(nD, x / (r * 0.4), y / (r * 0.4), 8.8, 4))
        else {
          const cone = Math.pow(1 - d, 1.35) * (0.94 + 0.06 * fbm(nD, x / 6, y / 6, 2, 3)), crater = smooth(0.16, 0.06, d)
          ht[k] += hh * (cone - crater * 0.28)
          lava[k] = Math.max(lava[k], crater)
          if (d < 0.75) { const a = smooth(0.75, 0.4, d + detail(x, y) * 0.15); if (a > bw[k]) { biome[k] = 255; bw[k] = a } }
        }
      }, () => {})
    } else if (f.kind === 'canyon') {
      const wd = f.width ?? spec.width!, dp = f.depth ?? spec.depth!
      over(f.path!, wd, (k, i, j, box) => {
        const t = warped(k, i, j, box) / wd
        if (t >= 1) return
        const m = 1 - smooth(0.25, 1, t)
        if (ht[k] > 0) ht[k] = Math.max(Math.min(ht[k], 30), ht[k] - dp * (Math.floor(m * 4) / 4 * 0.8 + m * 0.2))
      }, (box) => distField(f.path!, false, wd, box))
    } else if (f.kind === 'lake') {
      over(f.area!, 40, (k, i, j, box) => {
        const d = warped(k, i, j, box) + detail(X(i), Y(j)) * 4
        if (d < 0) ht[k] = Math.min(ht[k], -35 - 140 * smooth(0, -25, d))
        else if (d < 40) ht[k] = Math.min(ht[k], mix(6, ht[k], smooth(0, 40, d)))
      }, (box) => sdField(f.area!, 40, box))
    } else if (BIOMES[f.kind]?.paint) {
      const b = PAINT.indexOf(f.kind) + 1, fr = 22
      over(f.area!, fr * 2, (k, i, j, box) => {
        const x = X(i), y = Y(j)
        const m = smooth(fr, -fr, warped(k, i, j, box) + fbm(nC, x / 18, y / 18, 6, 3) * fr * 1.4)
        if (m > 0.02 && m >= bw[k] * 0.98 && !(biome[k] === 255 && bw[k] > 0.2)) { biome[k] = b; bw[k] = m } // volcano ash stays bare
      }, (box) => sdField(f.area!, fr * 2, box))
    }
  }

  // 4. Rivers: bend with the warp, run to the sea, cut a channel that only ever goes downhill.
  const at = (x: number, y: number) => {
    const fi = Math.min(w - 1.001, Math.max(0, FI(x))), fj = Math.min(h - 1.001, Math.max(0, FJ(y)))
    const i0 = Math.floor(fi), j0 = Math.floor(fj), tx = fi - i0, ty = fj - j0, a = j0 * w + i0
    return mix(mix(ht[a], ht[a + 1], tx), mix(ht[a + w], ht[a + w + 1], tx), ty)
  }
  const rivers: RiverLine[] = []
  for (const f of feats) {
    if (f.kind !== 'river') continue
    const pts: XY[] = []
    const src = f.path!
    for (let q = 0; q + 1 < src.length; q++) {
      const [ax, ay] = src[q], [bx, by] = src[q + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / cell))
      for (let s = 0; s < n; s++) pts.push([mix(ax, bx, s / n), mix(ay, by, s / n)])
    }
    pts.push(src[src.length - 1])
    const bent = pts.map((p) => { const [x, y] = warp(p); const m = fbm(nB, p[0] / 25, p[1] / 25, 12, 3) * 9; return [x + m, y - m * 0.7] as XY })
    const wet = bent.findIndex((p, n) => n > 2 && at(...p) < 0)
    if (wet > 0) bent.length = wet + 1
    else { // extend downhill-ish in the last direction until it reaches water
      let [x, y] = bent[bent.length - 1]
      const [px, py] = bent[Math.max(0, bent.length - 4)], l = Math.hypot(x - px, y - py) || 1
      const dx = (x - px) / l * cell, dy = (y - py) / l * cell
      for (let s = 0; s < 400 / cell && at(x, y) >= 0 && Math.abs(x) < W / 2 && Math.abs(y) < H / 2; s++) { x += dx; y += dy; bent.push([x, y]) }
    }
    const ch: number[] = [], wd: number[] = [], total = bent.length - 1 || 1
    for (const [n, p] of bent.entries()) {
      ch.push(Math.max(-4, Math.min(n ? ch[n - 1] - 0.4 : Infinity, at(...p) - 12)))
      wd.push((f.width ?? FEATURE_KINDS.river.width!) * (0.3 + 0.7 * n / total))
    }
    // carve: a channel under the water and a flatter valley floor around it
    for (let q = 0; q + 1 < bent.length; q++) {
      const [ax, ay] = bent[q], [bx, by] = bent[q + 1], R = Math.max(wd[q] * 5, 14)
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9
      const [i0, i1, j0, j1] = boxOf([bent[q], bent[q + 1]], R)
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = X(i), y = Y(j), t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2))
        const d = Math.hypot(x - ax - t * dx, y - ay - t * dy)
        if (d >= R) continue
        const c = mix(ch[q], ch[q + 1], t), half = mix(wd[q], wd[q + 1], t) * 0.6, k = j * w + i
        if (d < half) ht[k] = Math.min(ht[k], c - 25 * (1 - d / half))
        else if (ht[k] > c) ht[k] = Math.min(ht[k], c + (ht[k] - c) * Math.pow(smooth(half, R, d), 0.8))
      }
    }
    rivers.push({ id: f.id, name: f.name, pts: bent, ch, width: wd })
  }
  for (const v of vents) v.top = at(...v.at)

  // Where named features ended up after the warp: crest lines, label anchors, snap targets.
  const lines: Gen['lines'] = {}, anchors: Gen['anchors'] = {}, snaps: number[] = []
  for (const f of feats) {
    if (f.path && f.kind !== 'river') {
      const pts: XY[] = []
      for (let q = 0; q + 1 < f.path.length; q++) {
        const [ax, ay] = f.path[q], [bx, by] = f.path[q + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell * 3)))
        for (let s = 0; s < n; s++) pts.push(warp([mix(ax, bx, s / n), mix(ay, by, s / n)]))
      }
      pts.push(warp(f.path[f.path.length - 1]))
      lines[f.id] = pts
      if (f.kind === 'range') for (const p of pts) snaps.push(p[0], p[1])
    }
    if (f.at) anchors[f.id] = f.at
    if (f.area) { // every area: names are stripped before building, so renames don't rebuild
      const box = boxOf(f.area, wA)
      let best = -Infinity
      for (let j = box[2]; j <= box[3]; j += 3) for (let i = box[0]; i <= box[1]; i += 3) {
        const k = j * w + i, x = X(i) + wx[k], y = Y(j) + wy[k]
        if (!inPoly(f.area, x, y)) continue
        const d = edgeDist(f.area, x, y)
        if (d > best) { best = d; anchors[f.id] = [X(i), Y(j)] }
      }
      anchors[f.id] ??= warp(f.area[0])
    }
  }
  for (const r of rivers) for (let n = 0; n < r.pts.length; n += 2) snaps.push(r.pts[n][0], r.pts[n][1])
  for (let j = 0; j + 2 < h; j += 2) for (let i = 0; i + 2 < w; i += 2) {
    const k = j * w + i
    if ((ht[k] >= 0) !== (ht[k + 2] >= 0) || (ht[k] >= 0) !== (ht[k + 2 * w] >= 0)) snaps.push(X(i + 1), Y(j + 1))
  }

  // 5. Ground colour, water depth and trees.
  const rgba = new Uint8Array(N * 4), depth = new Uint8Array(N), tree = new Uint8Array(N), dens = new Uint8Array(N)
  const R2 = (W / 2) ** 2
  let maxH = 0
  const C = BIOMES, n1F = coarse((x, y) => fbm(nC, x / 90, y / 90, 9, 4)), woodsF = coarse((x, y) => fbm(nD, x / 110, y / 110, 13, 4))
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, x = X(i), y = Y(j), z = ht[k]
    maxH = Math.max(maxH, z)
    if (disc && x * x + y * y > R2) { ht[k] = Math.min(z, -20); }
    const gx = (ht[idx(i + 1, j)] - ht[idx(i - 1, j)]) / (2 * cell), gy = (ht[idx(i, j + 1)] - ht[idx(i, j - 1)]) / (2 * cell)
    const slope = Math.hypot(gx, gy) // m per km
    const n1 = n1F[k], n2 = fbm(nB, x / 9, y / 9, 3, 2)
    let col: RGB, tk: TreeKind | undefined, td = 0
    if (z < 0) {
      col = C.seabed.color.map((c) => c * (1 - 0.55 * smooth(0, 900, -z))) as RGB
      depth[k] = Math.round(255 * Math.min(1, -z / 1200))
    } else {
      // unpainted land: a grass / meadow / dry-grass mosaic with natural woods
      const m = smooth(-0.15, 0.25, n1)
      col = C.grass.color.map((c, q) => mix(c, C.meadow.color[q], m)) as RGB
      const woods = smooth(0.18, 0.34, woodsF[k])
      tk = 'broad'; td = mix(C.grass.trees!, 0.7, woods)
      col = col.map((c, q) => mix(c, C.forest.color[q], woods * 0.8)) as RGB
      const b = biome[k], wgt = smooth(0.25, 0.75, bw[k])
      if (b === 255) { col = col.map((c, q) => mix(c, C.ash.color[q], wgt)) as RGB; td *= 1 - wgt }
      else if (b) {
        const B = C[PAINT[b - 1]]
        col = col.map((c, q) => mix(c, B.color[q], wgt)) as RGB
        if (wgt > 0.5) { tk = B.tree; td = B.trees ?? 0 } else td *= 1 - wgt
      }
      if (coast[k] > -7 && z < 60) { const s = smooth(60, 20, z) * smooth(-7, -2, coast[k]); col = col.map((c, q) => mix(c, C.beach.color[q], s)) as RGB; td *= 1 - s }
      const rock = Math.max(smooth(70, 150, slope) * smooth(400, 1200, z), smooth(1500, 2100, z + n2 * 300))
      col = col.map((c, q) => mix(c, C.rock.color[q] * (0.9 + 0.2 * n1), rock)) as RGB
      td *= 1 - smooth(0.2, 0.6, rock)
      const snow = smooth(3350, 3600, z + n1 * 350 + n2 * 150) * (1 - 0.5 * smooth(220, 360, slope))
      col = col.map((c, q) => mix(c, C.snow.color[q], snow)) as RGB
      td *= 1 - snow
      if (slope > 220) td *= 0.3
    }
    const shade = 1 + 0.07 * n1 + 0.05 * n2
    rgba[k * 4] = Math.min(255, col[0] * shade); rgba[k * 4 + 1] = Math.min(255, col[1] * shade); rgba[k * 4 + 2] = Math.min(255, col[2] * shade)
    rgba[k * 4 + 3] = 255 - Math.round(lava[k] * 255)
    if (lava[k] > 0.3) { rgba[k * 4] = 255; rgba[k * 4 + 1] = 110; rgba[k * 4 + 2] = 30 }
    if (tk && td > 0) { tree[k] = TREE_KINDS.indexOf(tk) + 1; dens[k] = Math.round(Math.min(1, td) * 255) }
  }
  return { w, h, cell, W, H, disc, height: ht, rgba, depth, tree, dens, rivers, vents, exag: exagOf(fw), maxH, wx, wy, anchors, lines, snaps: new Float32Array(snaps) }
}

export const inPoly = (poly: XY[], x: number, y: number) => {
  let c = false
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [ax, ay] = poly[a], [bx, by] = poly[b]
    if ((ay > y) !== (by > y) && x < ax + (y - ay) / (by - ay) * (bx - ax)) c = !c
  }
  return c
}
export const segDist = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
  return Math.hypot(x - ax - t * dx, y - ay - t * dy)
}
export const edgeDist = (poly: XY[], x: number, y: number) => {
  let d = Infinity
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) d = Math.min(d, segDist(x, y, poly[a][0], poly[a][1], poly[b][0], poly[b][1]))
  return d
}
export const pathLen = (p: XY[]) => p.reduce((s, v, n) => n ? s + Math.hypot(v[0] - p[n - 1][0], v[1] - p[n - 1][1]) : 0, 0)
export const polyArea = (p: XY[]) => Math.abs(p.reduce((s, v, n) => { const u = p[(n + 1) % p.length]; return s + v[0] * u[1] - u[0] * v[1] }, 0)) / 2
const sampleIdx = (g: Gen, x: number, y: number) => Math.min(g.h - 1, Math.max(0, Math.round((g.H / 2 - y) / g.cell - 0.5))) * g.w + Math.min(g.w - 1, Math.max(0, Math.round((x + g.W / 2) / g.cell - 0.5)))
/** Height in m at a map point (bilinear). */
export function heightAt(g: Gen, x: number, y: number) {
  const fi = Math.min(g.w - 1.001, Math.max(0, (x + g.W / 2) / g.cell - 0.5)), fj = Math.min(g.h - 1.001, Math.max(0, (g.H / 2 - y) / g.cell - 0.5))
  const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, ty = fj - j, a = j * g.w + i, H = g.height
  return mix(mix(H[a], H[a + 1], tx), mix(H[a + g.w], H[a + g.w + 1], tx), ty)
}
/** Is this map point inside the drawn (warped) outline of an area feature? */
export const underFeature = (g: Gen, f: MapFeature, x: number, y: number) => { const k = sampleIdx(g, x, y); return !!f.area && inPoly(f.area, x + g.wx[k], y + g.wy[k]) }

// ---------- meshes (still pure: plain typed arrays the renderer uploads) ----------

/** Display units: x = km east, z = km south, y = height km * exag. */
export function terrainMesh(g: Gen) {
  const { w, h, cell, W, H } = g, e = g.exag / 1000
  const pos = new Float32Array(w * h * 3), nor = new Float32Array(w * h * 3), uv = new Float32Array(w * h * 2)
  const Yd = (i: number, j: number) => g.height[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))] * e
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i
    pos[k * 3] = -W / 2 + (i + 0.5) * cell; pos[k * 3 + 1] = Yd(i, j); pos[k * 3 + 2] = -H / 2 + (j + 0.5) * cell
    const dx = (Yd(i + 1, j) - Yd(i - 1, j)) / (2 * cell), dz = (Yd(i, j + 1) - Yd(i, j - 1)) / (2 * cell), l = Math.hypot(dx, 1, dz)
    nor[k * 3] = -dx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -dz / l
    uv[k * 2] = (i + 0.5) / w; uv[k * 2 + 1] = (j + 0.5) / h
  }
  const index = new Uint32Array((w - 1) * (h - 1) * 6)
  let n = 0
  for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
    const a = j * w + i, b = a + 1, c = a + w, d = c + 1
    index[n++] = a; index[n++] = c; index[n++] = b; index[n++] = b; index[n++] = c; index[n++] = d
  }
  return { pos, nor, uv, index }
}

/** The diorama's cut edge: a wall around the map from below the sea floor up to the ground or the water. */
export function wallMesh(g: Gen) {
  const { W, H } = g, e = g.exag / 1000
  const ring: XY[] = [] // x, y in km, walked so the wall faces outwards
  if (g.disc) for (let a = 0; a < 720; a++) { const t = -a / 720 * Math.PI * 2; ring.push([Math.cos(t) * W / 2 * 0.999, Math.sin(t) * W / 2 * 0.999]) }
  else {
    const n = 400, c: XY[] = [[-W / 2, H / 2], [W / 2, H / 2], [W / 2, -H / 2], [-W / 2, -H / 2]]
    for (let s = 0; s < 4; s++) for (let q = 0; q < n; q++) { const [ax, ay] = c[s], [bx, by] = c[(s + 1) % 4]; ring.push([mix(ax, bx, q / n) * 0.9995, mix(ay, by, q / n) * 0.9995]) }
  }
  ring.push(ring[0])
  const bottom = -2700 * e * 1.6
  const pos: number[] = [], ground: number[] = [], index: number[] = []
  for (const [n, [x, y]] of ring.entries()) {
    const fi = Math.min(g.w - 1, Math.max(0, Math.round((x + W / 2) / g.cell - 0.5))), fj = Math.min(g.h - 1, Math.max(0, Math.round((H / 2 - y) / g.cell - 0.5)))
    const gy = g.height[fj * g.w + fi] * e
    pos.push(x, Math.max(gy, 0), -y, x, bottom, -y); ground.push(gy, gy)
    if (n) { const a = (n - 1) * 2; index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3) }
  }
  return { pos: new Float32Array(pos), ground: new Float32Array(ground), index: new Uint32Array(index), bottom }
}

/** Trees on a jittered lattice; one Float32 array per kind of [x, y, z, scale, yaw, shade]. Drawn far bigger than life. */
export function treesOf(g: Gen, seed: string) {
  const sp = g.cell * 2.2, e = g.exag / 1000, s0 = hash(seed) & 0xffff
  const out: number[][] = TREE_KINDS.map(() => [])
  const nx = Math.floor(g.W / sp), ny = Math.floor(g.H / sp)
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const x = -g.W / 2 + (a + hash4(a, b, s0, 1)) * sp, y = g.H / 2 - (b + hash4(a, b, s0, 2)) * sp
    if (g.disc && Math.hypot(x, y) > g.W / 2 - sp) continue
    const i = Math.min(g.w - 1, Math.floor((x + g.W / 2) / g.cell)), j = Math.min(g.h - 1, Math.floor((g.H / 2 - y) / g.cell)), k = j * g.w + i
    const t = g.tree[k]
    if (!t || hash4(a, b, s0, 3) * 255 >= g.dens[k] || g.height[k] < 8) continue
    out[t - 1].push(x, g.height[k] * e, -y, sp * (1.5 + hash4(a, b, s0, 4) * 1.1), hash4(a, b, s0, 5) * Math.PI * 2, 0.82 + hash4(a, b, s0, 6) * 0.3)
  }
  return out.map((a) => new Float32Array(a))
}

/** Everything Claude needs to write or edit a flat world, plus a summary of this one. */
export function brief(fw?: FlatWorld) {
  const kinds = Object.entries(FEATURE_KINDS).filter(([, s]) => !BIOMES[s.label] && !s.label.includes('painted area'))
    .map(([k, s]) => `  ${k.padEnd(8)} ${s.geom.padEnd(5)} ${s.label}${['height', 'width', 'radius', 'depth'].filter((p) => s[p as 'height'] !== undefined).map((p) => `; ${p} ${s[p as 'height']}`).join('')}`)
  const out = [
    'FLAT WORLD FORMAT (Bookwright, New Map Test). One JSON object; the app generates the terrain from it.',
    '{ id, name, note?, shape: "rect" | "disc", size: [widthKm, heightKm], seed, relief?, features: [...], layers?: [...] }',
    'Coordinates are [x, y] in km from the map centre: x east, y north. A rect spans x in +-width/2, y in +-height/2; a disc has radius width/2.',
    'Scale is stylised: heights are drawn about size/90 times taller than life (relief multiplies that), so big things read from anywhere.',
    '',
    'FEATURES (the ground; geom: at = [x, y], path = [[x, y], ...], area = closed outline [[x, y], ...]). Defaults after the label:',
    ...kinds,
    `  painted ground (area): ${PAINT.join(', ')}`,
    'Land and sea outlines come first; relief, lakes and painted ground apply in file order (later painted areas win); rivers are cut last.',
    '',
    'LAYERS (things on the ground the user also edits with the map tools):',
    ...Object.entries(LAYER_KINDS).map(([k, s]) => `  ${k.padEnd(9)} items with "${s.geom}"`),
    `  item: { id, name?, note?, at | path | area, size? (cities: ${CITY_SIZES.join(', ')}), icon? (landmarks: ${Object.keys(LANDMARKS).join(', ')}) }`,
    '',
    'RULES',
    '- Make it look natural: coastlines and areas are irregular outlines with 12-30 points, never circles or boxes; the generator adds more wobble.',
    '- Ranges follow plate-like arcs; rivers start high (in or near a range) and run to the sea or a lake; they find the coast by themselves.',
    '- Keep ids stable when editing; give named things names (the user names features, use theirs).',
    '- Check with: node scripts/map.ts validate <file>, then preview <file> out.png and look at it.',
  ]
  if (fw) {
    out.push('', `THIS WORLD: "${fw.name}" ${fw.shape} ${fw.size[0]} x ${fw.size[1]} km, seed "${fw.seed}"${fw.relief ? `, relief ${fw.relief}` : ''}`)
    for (const f of fw.features) out.push(`  ${f.id}: ${f.kind}${f.name ? ` "${f.name}"` : ''}`)
    for (const l of fw.layers ?? []) out.push(`  layer ${l.id}: ${l.kind} "${l.name}", ${l.items.length} items${l.items.length ? `: ${l.items.slice(0, 12).map((i) => i.name ?? i.id).join(', ')}${l.items.length > 12 ? ', ...' : ''}` : ''}`)
  }
  return out.join('\n')
}
