// Flat worlds for the New Map Test section: a rectangle or a disc of land and sea, built from named features.
// Not a planet: x/y are km from the map centre. Heights are stylised (drawn many times taller than life).
// Pure and deterministic (no DOM, `.ts` imports): the app's worker, the CLI and the tests all run this.
import { fbm, hash, hash4, ridged, simplex } from '../world/noise.ts'

export type XY = [number, number] // km from the map centre: x east, y north

export const COASTS = ['mixed', 'beach', 'cliff', 'fjord', 'mangrove'] as const
export type Coast = typeof COASTS[number]
export const TEMPS = { frozen: 0, cold: 0.22, temperate: 0.5, warm: 0.72, hot: 0.92 } as const
export type Temp = keyof typeof TEMPS
export const WINDS = ['west', 'east', 'north', 'south'] as const
/** Optional climate: unpainted land then picks its own biome from warmth (north to south, colder up high) and rain (wet near upwind coasts, dry behind mountains). */
export interface Climate { north?: Temp; south?: Temp; wind?: typeof WINDS[number]; wet?: number }

export interface MapFeature {
  id: string; kind: FeatureKind; name?: string; note?: string
  at?: XY; path?: XY[]; area?: XY[] // exactly one, as the kind says
  height?: number // m: land, hills, plateau, range, peak, volcano, giant tree; floating island: how high it floats
  depth?: number // m: canyon, crater, sinkhole
  width?: number // km: range, canyon, river (at its mouth), arch
  radius?: number // km: peak, volcano, crater, sinkhole, whirlpool, floating island, giant tree
  coast?: Coast // land: what its shores look like (default mixed: beaches with cliff stretches)
  color?: string // magic zone glow, like "#9b5de5"
  angle?: number // degrees: arch orientation
}
export interface FlatWorld {
  id: string; name: string; note?: string
  shape: 'rect' | 'disc'; size: [number, number] // km, width x height (a disc uses the width as its diameter)
  seed: string; relief?: number // height exaggeration multiplier, 1 = default
  wobble?: number // how far outlines are bent away from their points, 1 = default; ~0.3 for a map traced from a drawing
  climate?: Climate
  edge?: 'wall' | 'waterfall' // the map's cut edge: rock strata, or the sea pouring off the world
  features: MapFeature[] // the ground: Claude writes these
  layers?: MapLayer[] // things on the ground: the user adds these with the map tools (Claude can too, same format)
}

/** A thing on a layer: a point (city, landmark), a line (border, road) or an area (region). `curve`: drawn as a smooth curve through its points. */
export interface MapItem { id: string; name?: string; note?: string; at?: XY; path?: XY[]; area?: XY[]; size?: CitySize; icon?: Landmark; curve?: boolean }

/** Catmull-Rom curve through the points (closed for areas), `n` steps per span. */
export function smoothPath(pts: XY[], closed: boolean, n = 6): XY[] {
  if (pts.length < 3) return pts
  const out: XY[] = [], L = pts.length, at = (i: number) => pts[closed ? (i + L) % L : Math.min(L - 1, Math.max(0, i))]
  for (let i = 0; i < (closed ? L : L - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t
      out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3)) as XY)
    }
  }
  if (!closed) out.push(pts[L - 1])
  return out
}
/** The line or outline as drawn: curved through its points, or straight between them. */
export const itemShape = (it: MapItem): XY[] => { const p = it.area ?? it.path ?? []; return it.curve ? smoothPath(p, !!it.area) : p }
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

export const TREE_KINDS = ['broad', 'pine', 'jungle', 'cactus', 'swamp', 'bamboo', 'autumn', 'blossom', 'dead', 'crystal', 'reeds', 'mangrove', 'palm'] as const
export type TreeKind = typeof TREE_KINDS[number]
/** Shader effects per ground cell (data texture, blue channel / 16). */
export const FX = { shimmer: 1, glow: 2, sparkle: 3, magic: 5, storm: 6, reef: 7, blizzard: 8 } as const

type RGB = [number, number, number]
type Shape = 'dunes' | 'terraces' | 'flat' | 'ice'
/** Ground types. `paint: true` = a feature kind you can paint as an area; the rest come from height, slope, coast and climate. */
export const BIOMES: Record<string, { color: RGB; tree?: TreeKind; trees?: number; paint?: boolean; label?: string; fx?: keyof typeof FX; shape?: Shape }> = {
  grass: { color: [118, 170, 72], tree: 'broad', trees: 0.04, paint: true, label: 'Grassland' },
  forest: { color: [72, 130, 58], tree: 'broad', trees: 0.92, paint: true, label: 'Forest' },
  taiga: { color: [92, 124, 88], tree: 'pine', trees: 0.88, paint: true, label: 'Pine forest' },
  jungle: { color: [48, 124, 62], tree: 'jungle', trees: 1, paint: true, label: 'Jungle' },
  bamboo: { color: [124, 172, 74], tree: 'bamboo', trees: 0.95, paint: true, label: 'Bamboo forest' },
  autumn: { color: [176, 116, 58], tree: 'autumn', trees: 0.9, paint: true, label: 'Autumn forest' },
  blossom: { color: [150, 182, 96], tree: 'blossom', trees: 0.8, paint: true, label: 'Blossom groves' },
  deadwood: { color: [112, 104, 84], tree: 'dead', trees: 0.6, paint: true, label: 'Dead or blighted forest' },
  savanna: { color: [200, 184, 96], tree: 'broad', trees: 0.07, paint: true, label: 'Savanna' },
  steppe: { color: [180, 178, 108], paint: true, label: 'Steppe' },
  desert: { color: [234, 198, 122], tree: 'cactus', trees: 0.025, paint: true, label: 'Desert (dunes)', fx: 'shimmer', shape: 'dunes' },
  badlands: { color: [194, 112, 70], tree: 'dead', trees: 0.015, paint: true, label: 'Badlands (layered mesas)', shape: 'terraces' },
  saltflat: { color: [238, 236, 228], paint: true, label: 'Salt flats', fx: 'shimmer', shape: 'flat' },
  wasteland: { color: [66, 56, 56], tree: 'dead', trees: 0.02, paint: true, label: 'Volcanic wasteland (lava cracks)' },
  swamp: { color: [96, 118, 70], tree: 'swamp', trees: 0.45, paint: true, label: 'Swamp' },
  reeds: { color: [128, 142, 76], tree: 'reeds', trees: 0.8, paint: true, label: 'Marsh reeds' },
  tundra: { color: [168, 174, 146], tree: 'pine', trees: 0.03, paint: true, label: 'Tundra' },
  snow: { color: [242, 246, 252], paint: true, label: 'Snowfield' },
  glacier: { color: [206, 228, 246], paint: true, label: 'Glacier', fx: 'sparkle', shape: 'ice' },
  crystal: { color: [154, 140, 206], tree: 'crystal', trees: 0.35, paint: true, label: 'Crystal fields (glow)', fx: 'glow' },
  reef: { color: [244, 150, 126], paint: true, label: 'Coral reef (paint it in shallow sea)', fx: 'reef' },
  meadow: { color: [146, 186, 88] },
  beach: { color: [236, 216, 162] },
  mangrove: { color: [74, 112, 64], tree: 'mangrove', trees: 0.75 },
  rock: { color: [152, 134, 116] },
  ash: { color: [82, 74, 72] },
  seabed: { color: [196, 186, 150] },
}

const PAINT = Object.keys(BIOMES).filter((b) => BIOMES[b].paint)
type Geom = 'at' | 'path' | 'area'
export const FEATURE_KINDS: Record<string, { geom: Geom; label: string; height?: number; depth?: number; width?: number; radius?: number }> = {
  land: { geom: 'area', label: 'Land: a continent or island outline (coast: mixed, beach, cliff, fjord, mangrove)', height: 260 },
  sea: { geom: 'area', label: 'Sea or bay cut out of land' },
  range: { geom: 'path', label: 'Mountain range along its crest (foothills come with it)', height: 3000, width: 120 },
  peak: { geom: 'at', label: 'Lone mountain', height: 3400, radius: 55 },
  volcano: { geom: 'at', label: 'Volcano (smokes, lava glow)', height: 2800, radius: 60 },
  hills: { geom: 'area', label: 'Hills', height: 600 },
  plateau: { geom: 'area', label: 'Plateau or mesa with cliffs', height: 1000 },
  canyon: { geom: 'path', label: 'Canyon', depth: 900, width: 22 },
  crater: { geom: 'at', label: 'Impact crater with a raised rim', depth: 600, radius: 45 },
  sinkhole: { geom: 'at', label: 'Sinkhole, a deep round pit', depth: 1200, radius: 10 },
  arch: { geom: 'at', label: 'Stone arch (angle in degrees)', width: 30 },
  river: { geom: 'path', label: 'River from source to mouth (finds the sea; gets tributaries, falls, a delta)', width: 6 },
  lake: { geom: 'area', label: 'Lake (sits at its own level)' },
  whirlpool: { geom: 'at', label: 'Whirlpool, in the sea', radius: 25 },
  floating: { geom: 'at', label: 'Floating island (height = how high it floats)', height: 2500, radius: 30 },
  gianttree: { geom: 'at', label: 'Giant world tree', height: 3000, radius: 12 },
  magic: { geom: 'area', label: 'Magic zone: glowing ground and drifting motes (color)' },
  storm: { geom: 'area', label: 'Storm zone: dark clouds, rain, lightning' },
  blizzard: { geom: 'area', label: 'Blizzard zone: snow and blowing snow' },
  ...Object.fromEntries(PAINT.map((b) => [b, { geom: 'area' as Geom, label: `${BIOMES[b].label} (painted area)` }])),
}
export type FeatureKind = string
const ZONES = ['magic', 'storm', 'blizzard']

// ---------- validation (trust boundary: imported JSON) ----------

const isXY = (v: unknown): v is XY => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
const isHex = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
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
  if (o.wobble !== undefined && !(typeof o.wobble === 'number' && o.wobble >= 0 && o.wobble <= 2)) errors.push('wobble must be a number in [0, 2]')
  if (o.edge !== undefined && o.edge !== 'wall' && o.edge !== 'waterfall') errors.push('edge must be "wall" or "waterfall"')
  if (o.climate !== undefined) {
    const c = o.climate
    if (!c || typeof c !== 'object') errors.push('climate must be an object')
    else {
      for (const k of ['north', 'south'] as const) if (c[k] !== undefined && !(c[k]! in TEMPS)) errors.push(`climate.${k} must be one of ${Object.keys(TEMPS).join(', ')}`)
      if (c.wind !== undefined && !WINDS.includes(c.wind)) errors.push(`climate.wind must be one of ${WINDS.join(', ')}`)
      if (c.wet !== undefined && !(typeof c.wet === 'number' && c.wet >= 0 && c.wet <= 1)) errors.push('climate.wet must be 0..1')
    }
  }
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
    if (f.coast !== undefined && !COASTS.includes(f.coast)) errors.push(`${at}: coast must be one of ${COASTS.join(', ')}`)
    if (f.color !== undefined && !isHex(f.color)) errors.push(`${at}: color must be like "#9b5de5"`)
    if (f.angle !== undefined && !(typeof f.angle === 'number' && Number.isFinite(f.angle))) errors.push(`${at}: angle must be a number of degrees`)
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
    if (l.color !== undefined && !isHex(l.color)) errors.push(`${at}: color must be like "#aa3300"`)
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
      if (it.curve !== undefined && typeof it.curve !== 'boolean') errors.push(`${where}: curve must be true or false`)
      if (pts.some(out)) warnings.push(`${where}: some points are outside the map`)
    }
  }
  return { errors, warnings }
}

// ---------- generation ----------

export interface RiverLine { id: string; name?: string; pts: XY[]; ch: number[]; width: number[]; minor?: boolean } // ch = water surface, m; minor = tributary or delta arm
export interface Prop { kind: 'floating' | 'gianttree' | 'arch'; id: string; at: XY; ground: number; height: number; radius: number; angle: number }
export interface Gen {
  w: number; h: number; cell: number; W: number; H: number; disc: boolean; edge: 'wall' | 'waterfall'
  height: Float32Array // m, sea level 0
  rgba: Uint8Array // ground colour; alpha < 255 marks glowing lava
  data: Uint8Array // r: water depth under its surface (0..255 = 0..1200 m), g: 255 = lake, b: FX code * 16 + strength, a: ambient light (valleys darker)
  rough: Uint8Array // close-up detail strength (0 on water, rivers, flats; most on mountains)
  tree: Uint8Array // 1 + index into TREE_KINDS, 0 = none
  dens: Uint8Array // tree density 0..255
  rivers: RiverLine[]
  lakes: { id: string; level: number; box: [number, number, number, number] }[] // box: x0, y0, x1, y1 km
  falls: { at: XY; top: number; bottom: number; dir: XY }[]
  vents: { id: string; at: XY; top: number }[] // volcano craters
  props: Prop[]
  zones: { kind: 'magic' | 'storm' | 'blizzard'; id: string; color: RGB; pts: Float32Array }[] // pts: x, y, ground m
  whirls: { at: XY; r: number }[]
  summits: XY[] // snowy peaks, for blowing snow
  exag: number // display km per km of height (before the zoom easing)
  maxH: number
  wx: Float32Array; wy: Float32Array // the shared warp: a feature written at p is drawn near p - warp
  anchors: Record<string, XY> // where named features are drawn: the point deepest inside an area, a peak's summit
  lines: Record<string, XY[]> // crest lines of ranges and canyons as drawn (warped); rivers use `rivers`
  snaps: Float32Array // x, y pairs on coasts, rivers and crests, for snapping borders and roads
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const hexRGB = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB

/** Display exaggeration from orbit: the tallest mountains stand a couple of percent of the map's width. The renderer eases it down up close. */
export const exagOf = (fw: FlatWorld) => Math.max(fw.size[0], fw.size[1]) / 120 * (fw.relief ?? 1)
export const DETAIL_M = 420 // close-up detail amplitude at full roughness, m

// Close-up detail: integer-hash value noise, written so the GPU (scene.ts) computes exactly the same numbers.
const ih = (x: number, y: number) => {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12
  return (h >>> 0) / 4294967296
}
const vn = (x: number, y: number) => {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  return mix(mix(ih(i, j), ih(i + 1, j), u), mix(ih(i, j + 1), ih(i + 1, j + 1), u), v)
}
/** Ridged detail in about -0.45..0.45 at map point x, y (km). */
export const detailAt = (x: number, y: number) => {
  let s = 0, a = 0.5, f = 1 / 6.5
  for (let o = 0; o < 4; o++) { const n = vn(x * f + o * 17.3, y * f - o * 9.1); s += a * (1 - Math.abs(n * 2 - 1)); a *= 0.5; f *= 2.3 }
  return s - 0.47
}

export function generate(fw: FlatWorld, long = 1536): Gen {
  const cell = Math.max(fw.size[0], fw.size[1]) / long
  const w = Math.round(fw.size[0] / cell), h = Math.round(fw.size[1] / cell)
  const W = w * cell, H = h * cell, N = w * h, disc = fw.shape === 'disc'
  const X = (i: number) => -W / 2 + (i + 0.5) * cell, Y = (j: number) => H / 2 - (j + 0.5) * cell
  const FI = (x: number) => (x + W / 2) / cell - 0.5, FJ = (y: number) => (H / 2 - y) / cell - 0.5
  const s0 = hash(fw.seed)
  const nA = simplex(s0), nB = simplex(s0 + 1), nC = simplex(s0 + 2), nD = simplex(s0 + 3), nE = simplex(s0 + 4)
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
  const idx = (i: number, j: number) => Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))

  // Domain warp shared by every outline, so coasts, ranges and painted areas bend together and nothing is a clean circle or polygon.
  // Two scales: broad bends (peninsulas, bays) and a finer ragged edge.
  const wob = fw.wobble ?? 1
  const a1 = size * 0.024 * wob, l1 = size / 6, a2 = size * 0.009 * Math.max(wob, 0.3), l2 = size / 28, wA = a1 + a2 + cell
  const wx = coarse((x, y) => a1 * fbm(nA, x / l1, y / l1, 0.5, 3) + a2 * fbm(nA, x / l2, y / l2, 20.5, 4))
  const wy = coarse((x, y) => a1 * fbm(nA, x / l1, y / l1, 7.5, 3) + a2 * fbm(nA, x / l2, y / l2, 31.5, 4))
  const warp = (p: XY): XY => { const k = idx(Math.round(FI(p[0])), Math.round(FJ(p[1]))); return [p[0] - wx[k], p[1] - wy[k]] }

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
    for (let j = box[2]; j <= box[3]; j++) for (let i = box[0]; i <= box[1]; i++) fn(j * w + i, i, j, box)
  }
  const detail = (x: number, y: number) => 0.6 * fbm(nB, x / 40, y / 40, 1.5, 3) + 0.4 * fbm(nB, x / 11, y / 11, 9.5, 2)
  // a point feature's footprint, wobbled by the warp so it isn't a perfect circle
  const disk = (f: MapFeature, r: number, fn: (k: number, d: number, x: number, y: number) => void) => {
    const [cx, cy] = f.at!
    over([f.at!], r, (k, i, j) => {
      const x = X(i), y = Y(j), d = Math.hypot(x - cx + wx[k] * 0.35, y - cy + wy[k] * 0.35) / r
      if (d < 1) fn(k, d, x, y)
    }, () => {})
  }

  // 1. Land and sea outlines -> signed distance to the coast, and each shore's kind.
  const CAP = 170
  const coast = new Float32Array(N).fill(CAP), base = new Float32Array(N).fill(FEATURE_KINDS.land.height!), ctype = new Uint8Array(N)
  const feats = fw.features
  for (const f of feats) {
    if (f.kind !== 'land' && f.kind !== 'sea') continue
    const poly = f.area!, ct = COASTS.indexOf(f.coast ?? 'mixed')
    over(poly, CAP, (k, i, j, box) => {
      const d = warped(k, i, j, box) + detail(X(i), Y(j)) * 14 * Math.max(wob, 0.4)
      if (f.kind === 'land') { if (d < coast[k]) { coast[k] = d; base[k] = f.height ?? FEATURE_KINDS.land.height!; ctype[k] = ct } }
      else coast[k] = Math.max(coast[k], -d)
    }, (box) => sdField(poly, CAP, box))
  }
  // fjord coasts: long narrow drowned valleys cut into the land
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i
    if (ctype[k] !== 3 || coast[k] > 0 || coast[k] < -130) continue
    const x = X(i), y = Y(j), r = ridged(nE, x / 55, y / 55, 1.5, 3)
    coast[k] += smooth(0.8, 0.93, r) * smooth(-130, -10, coast[k]) * 150
  }

  // 2. Base height: plains rise gently inland with rolling hills; cliff coasts stand up from the water; the sea floor falls away.
  const ht = new Float32Array(N), rollF = coarse((x, y) => fbm(nC, x / 160, y / 160, 3.3, 4))
  const lowF = coarse((x, y) => ridged(nC, x / 45, y / 45, 11.5, 3)), cliffF = coarse((x, y) => fbm(nE, x / 140, y / 140, 4.4, 3))
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, d = coast[k], roll = rollF[k], ct = ctype[k]
    if (d < 0) {
      const inland = smooth(0, 110, -d)
      ht[k] = base[k] * (0.12 + 0.88 * inland) * (0.75 + 0.5 * Math.max(0, roll)) + 18 + base[k] * 0.3 * inland * smooth(0.5, 0.85, lowF[k])
      const cliff = ct === 2 ? 1 : ct === 3 ? 1.6 : ct === 0 ? smooth(0.15, 0.35, cliffF[k]) : 0
      if (cliff) ht[k] += cliff * (170 + 110 * cliffF[k]) * smooth(0, -3, d)
    } else ht[k] = -(25 + 2700 * smooth(0, 150, d) * (0.85 + 0.3 * roll))
  }

  // 3. Mountains and hills (before erosion, so they get valleys), painted ground and zones.
  const biome = new Uint8Array(N), bw = new Float32Array(N) // painted ground: index+1 into PAINT (255 = volcanic ash), weight
  const zone = new Uint8Array(N), zw = new Float32Array(N) // weather and magic zones: index+1 into zoneFeats
  const zoneFeats = feats.filter((f) => ZONES.includes(f.kind))
  const lava = new Float32Array(N)
  for (const f of feats) {
    const spec = FEATURE_KINDS[f.kind], hh = f.height ?? spec.height ?? 0
    if (f.kind === 'hills') {
      over(f.area!, 70, (k, i, j, box) => {
        const m = smooth(35, -35, warped(k, i, j, box) + detail(X(i), Y(j)) * 6)
        if (m) ht[k] += hh * m * (0.35 + 0.65 * ridged(nD, X(i) / 28, Y(j) / 28, 2.1, 4))
      }, (box) => sdField(f.area!, 70, box))
    } else if (f.kind === 'range') {
      // a crest with ridged peaks, wide foothills that grade into the plains, tapering at both ends
      const wd = f.width ?? spec.width!, cap = wd * 3.4
      let len = 0
      over(f.path!, cap, (k, i, j, box) => {
        const d = warped(k, i, j, box)
        if (d >= cap) return
        const s = warped(k, i, j, box, along) / len, taper = smooth(0, 0.12, s) * smooth(1, 0.88, s)
        const x = X(i), y = Y(j), t = d / wd
        const crest = Math.pow(1 - smooth(0, 1, t), 1.5) * (0.45 + 0.5 * ridged(nD, x / (wd * 1.2), y / (wd * 1.2), 5.7, 5) + 0.3 * ridged(nE, x / (wd * 0.38), y / (wd * 0.38), 8.1, 3)) // main summits and secondary peaks
        const foot = Math.pow(1 - smooth(0, 1, d / cap), 1.4) * (0.2 + 0.18 * ridged(nE, x / (wd * 0.45), y / (wd * 0.45), 2.7, 3))
        ht[k] += hh * (crest + foot) * (0.3 + 0.7 * taper)
      }, (box) => { len = distField(f.path!, false, cap, box) })
    } else if (f.kind === 'peak') {
      const r = f.radius ?? spec.radius!
      disk(f, r * 2.6, (k, d, x, y) => {
        const core = Math.pow(1 - smooth(0, 0.38, d), 1.5), foot = Math.pow(1 - d, 2) * 0.22
        ht[k] += hh * (core * (0.8 + 0.3 * ridged(nD, x / (r * 0.5), y / (r * 0.5), 8.8, 4)) + foot * (0.7 + 0.5 * fbm(nE, x / 15, y / 15, 1, 2)))
      })
    } else if (BIOMES[f.kind]?.paint) {
      const b = PAINT.indexOf(f.kind) + 1, fr = 22
      over(f.area!, fr * 2, (k, i, j, box) => {
        const m = smooth(fr, -fr, warped(k, i, j, box) + (fbm(nC, X(i) / 18, Y(j) / 18, 6, 3) * 1.4 + (1 - Math.min(1, wob)) * 1.6 * fbm(nE, X(i) / 45, Y(j) / 45, 2.2, 3)) * fr) // less warp: rougher edges, so painted areas never look boxy
        if (m > 0.02 && m >= bw[k] * 0.98) { biome[k] = b; bw[k] = m }
      }, (box) => sdField(f.area!, fr * 2, box))
    } else if (ZONES.includes(f.kind)) {
      const z = zoneFeats.indexOf(f) + 1, fr = 30
      over(f.area!, fr * 2, (k, i, j, box) => {
        const m = smooth(fr, -fr, warped(k, i, j, box) + fbm(nC, X(i) / 25, Y(j) / 25, 16, 3) * fr)
        if (m > zw[k]) { zone[k] = z; zw[k] = m }
      }, (box) => sdField(f.area!, fr * 2, box))
    }
  }

  // 4. Erosion: water carves valleys into slopes (stream power), loose rock slides off spikes. Run on a half-resolution grid.
  erode(ht, w, h, cell)

  // 5. Sharp features after erosion: plateaus, volcanoes, canyons, craters, sinkholes.
  const vents: Gen['vents'] = [], props: Prop[] = [], whirls: Gen['whirls'] = []
  for (const f of feats) {
    const spec = FEATURE_KINDS[f.kind], hh = f.height ?? spec.height ?? 0
    if (f.kind === 'plateau') {
      over(f.area!, 12, (k, i, j, box) => {
        const m = smooth(6, -6, warped(k, i, j, box) + detail(X(i), Y(j)) * 6)
        if (m) ht[k] += hh * (Math.floor(m * 3.999) / 3 * 0.25 + m * 0.75) * (0.92 + 0.08 * fbm(nD, X(i) / 30, Y(j) / 30, 4, 3))
      }, (box) => sdField(f.area!, 12, box))
    } else if (f.kind === 'volcano') {
      const r = f.radius ?? spec.radius!
      vents.push({ id: f.id, at: f.at!, top: 0 })
      disk(f, r * 1.8, (k, d, x, y) => {
        const dd = d * 1.8, cone = dd < 1 ? Math.pow(1 - dd, 1.35) * (0.94 + 0.06 * fbm(nD, x / 6, y / 6, 2, 3)) : 0, crater = smooth(0.16, 0.06, dd)
        ht[k] += hh * (cone - crater * 0.28) + hh * 0.12 * Math.pow(1 - d, 2) // a skirt of old lava flows
        lava[k] = Math.max(lava[k], crater)
        if (dd < 0.75) { const a = smooth(0.75, 0.4, dd + detail(x, y) * 0.15); if (a > bw[k]) { biome[k] = 255; bw[k] = a } }
      })
    } else if (f.kind === 'canyon') {
      const wd = f.width ?? spec.width!, dp = f.depth ?? spec.depth!
      over(f.path!, wd, (k, i, j, box) => {
        const t = warped(k, i, j, box) / wd
        if (t >= 1) return
        const m = 1 - smooth(0.25, 1, t)
        if (ht[k] > 0) ht[k] = Math.max(Math.min(ht[k], 30), ht[k] - dp * (Math.floor(m * 4) / 4 * 0.8 + m * 0.2))
      }, (box) => distField(f.path!, false, wd, box))
    } else if (f.kind === 'crater') {
      const r = f.radius ?? spec.radius!, dp = f.depth ?? spec.depth!
      disk(f, r * 1.6, (k, d) => {
        const q = d * 1.6
        ht[k] += -dp * (1 - Math.min(1, q) ** 2) * (q < 1 ? 1 : 0) + dp * 0.55 * Math.exp(-(((q - 1) / 0.16) ** 2)) + dp * 0.25 * Math.exp(-((q / 0.12) ** 2))
      })
    } else if (f.kind === 'sinkhole') {
      const r = f.radius ?? spec.radius!, dp = f.depth ?? spec.depth!
      disk(f, r * 1.4, (k, d) => { const q = d * 1.4; ht[k] -= dp * smooth(1, 0.75, q); if (q < 1) { biome[k] = 255; bw[k] = Math.max(bw[k], 0.6) } })
    } else if (f.kind === 'whirlpool') whirls.push({ at: f.at!, r: f.radius ?? spec.radius! })
    else if (f.kind === 'floating' || f.kind === 'gianttree' || f.kind === 'arch') {
      props.push({ kind: f.kind, id: f.id, at: f.at!, ground: 0, height: hh || (f.width ?? spec.width ?? 30) * 40, radius: f.radius ?? spec.radius ?? (f.width ?? spec.width ?? 30) / 2, angle: (f.angle ?? hash(f.id) % 360) * Math.PI / 180 })
    }
  }

  // 6. Climate (if set): warmth and rain decide the ground wherever nothing was painted.
  const cl = fw.climate
  const cbiome = new Uint8Array(N) // index into CLIMATE_BIOMES + 1
  const warm = new Float32Array(N).fill(0.5)
  if (cl) {
    const tN = TEMPS[cl.north ?? 'temperate'], tS = TEMPS[cl.south ?? 'temperate'], wet = cl.wet ?? 0.5
    const moist = new Float32Array(N), tn = coarse((x, y) => fbm(nE, x / 220, y / 220, 9.1, 3)), mn = coarse((x, y) => fbm(nC, x / 180, y / 180, 19.3, 3))
    // rain comes in off the sea on the wind and rains out over land, most of all where the ground climbs
    const wind = cl.wind ?? 'west', alongX = wind === 'west' || wind === 'east', rev = wind === 'east' || wind === 'south'
    const outer = alongX ? h : w, inner = alongX ? w : h, decay = Math.exp(-cell / (500 + 900 * wet))
    for (let a = 0; a < outer; a++) {
      let m = 1, prev = 0
      for (let s = 0; s < inner; s++) {
        const b = rev ? inner - 1 - s : s, k = alongX ? a * w + b : b * w + a, z = ht[k]
        if (z < 0) m = Math.min(1, m + 0.08)
        else { m = m * decay - Math.max(0, z - prev) / 5000; if (m < 0.05) m = 0.05 }
        prev = Math.max(0, z); moist[k] = m
      }
    }
    const soft = boxBlur(moist, w, h, Math.max(3, Math.round(45 / cell))) // no streaks along the wind
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, z = ht[k]
      if (z < 0) continue
      const t = mix(tS, tN, (Y(j) + H / 2) / H) + tn[k] * 0.07 - z / 1000 * 0.1
      const m = Math.min(1, Math.max(0, soft[k] * 0.75 + smooth(-220, 0, coast[k]) * 0.2 + (wet - 0.5) * 0.4 + mn[k] * 0.15 + 0.08))
      warm[k] = t
      const pick = t < 0.1 ? 'snow' : t < 0.27 ? (m < 0.35 ? 'tundra' : 'taiga')
        : t < 0.62 ? (m < 0.22 ? 'steppe' : m < 0.5 ? 'grass' : m > 0.85 && z < 140 ? 'swamp' : 'forest')
          : m < 0.2 ? 'desert' : m < 0.42 ? 'savanna' : m < 0.68 ? 'forest' : 'jungle'
      cbiome[k] = CLIMATE_BIOMES.indexOf(pick) + 1
    }
  }
  const groundOf = (k: number) => { const b = biome[k]; return b && b !== 255 && bw[k] > 0.5 ? PAINT[b - 1] : cbiome[k] ? CLIMATE_BIOMES[cbiome[k] - 1] : 'grass' }

  // 7. Ground shaped by its biome: dunes, layered badland mesas, salt pans, thick ice, lava cracks.
  const duneF = coarse((x, y) => fbm(nE, x / 70, y / 70, 3.7, 2))
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i
    if (ht[k] <= 2) continue
    const g = groundOf(k), B = BIOMES[g], x = X(i), y = Y(j), wgt = biome[k] && biome[k] !== 255 ? smooth(0.2, 0.7, bw[k]) : 1
    if (B.shape === 'dunes') ht[k] += 55 * wgt * Math.pow(1 - Math.abs(Math.sin((x * 0.8 + y * 0.35) / 9 + duneF[k] * 5)), 3)
    else if (B.shape === 'terraces') { const v = ridged(nD, x / 34, y / 34, 7.7, 3) * 4; ht[k] += 360 * wgt * (Math.floor(v) + smooth(0.75, 1, v - Math.floor(v))) / 4 }
    else if (B.shape === 'flat') ht[k] = mix(ht[k], 12, wgt)
    else if (B.shape === 'ice') ht[k] += 80 * wgt
    if (g === 'wasteland') lava[k] = Math.max(lava[k], smooth(0.93, 0.975, ridged(nE, x / 16, y / 16, 5.5, 2)) * wgt)
  }

  // 8. Lakes sit at their own level: the low point of their rim. Their basin is cut below it and the rim kept above.
  const at = (x: number, y: number) => {
    const fi = Math.min(w - 1.001, Math.max(0, FI(x))), fj = Math.min(h - 1.001, Math.max(0, FJ(y)))
    const i0 = Math.floor(fi), j0 = Math.floor(fj), tx = fi - i0, ty = fj - j0, a = j0 * w + i0
    return mix(mix(ht[a], ht[a + 1], tx), mix(ht[a + w], ht[a + w + 1], tx), ty)
  }
  const lakeId = new Uint8Array(N), surface = new Float32Array(N) // water surface (m) for lake cells
  const lakes: Gen['lakes'] = []
  for (const f of feats) {
    if (f.kind !== 'lake') continue
    const cells: number[] = [], ds: number[] = [], rim: number[] = []
    over(f.area!, 40, (k, i, j, box) => {
      const d = warped(k, i, j, box) + detail(X(i), Y(j)) * 4
      if (d < 40) { cells.push(k); ds.push(d); if (d >= 0 && d < 8) rim.push(ht[k]) }
    }, (box) => sdField(f.area!, 40, box))
    rim.sort((a, b) => a - b)
    const level = Math.max(6, (rim[Math.floor(rim.length * 0.15)] ?? 20) - 4), n = lakes.length + 1
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [q, k] of cells.entries()) {
      const d = ds[q]
      if (d < 0) {
        ht[k] = Math.min(ht[k], level - 14 - 120 * smooth(0, -25, d)); lakeId[k] = n; surface[k] = level
        const x = X(k % w), y = Y(Math.floor(k / w)); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
      } else if (d < 6) ht[k] = Math.max(ht[k], level + 3)
      else if (ht[k] > level + 5) ht[k] = Math.min(ht[k], mix(level + 5, ht[k], smooth(6, 40, d)))
    }
    if (x0 <= x1) lakes.push({ id: f.id, level, box: [x0 - cell * 3, y0 - cell * 3, x1 + cell * 3, y1 + cell * 3] })
  }
  const wetAt = (x: number, y: number) => { const k = idx(Math.round(FI(x)), Math.round(FJ(y))); return lakeId[k] ? surface[k] : at(x, y) < 0 ? 0 : undefined }

  // 9. Rivers: meander more in the lowlands, step down in falls through the hills, pick up tributaries, fan out into deltas.
  const rivers: RiverLine[] = [], falls: Gen['falls'] = []
  const nearRiver = new Uint8Array(N)
  const trace = (pts: XY[], id: string, name: string | undefined, width: number, minor: boolean, startCh = Infinity) => {
    const wet = pts.findIndex((p, n) => n > 2 && wetAt(...p) !== undefined)
    if (wet > 0) pts.length = wet + 1
    else if (!minor) { // extend in the last direction until it reaches water
      let [x, y] = pts[pts.length - 1]
      const [px, py] = pts[Math.max(0, pts.length - 4)], l = Math.hypot(x - px, y - py) || 1
      const dx = (x - px) / l * cell, dy = (y - py) / l * cell
      for (let s = 0; s < 400 / cell && wetAt(x, y) === undefined && Math.abs(x) < W / 2 && Math.abs(y) < H / 2; s++) { x += dx; y += dy; pts.push([x, y]) }
    }
    if (pts.length < 3) return
    const end = wetAt(...pts[pts.length - 1]) ?? -4
    const ch: number[] = [], wd: number[] = [], total = pts.length - 1
    for (const [n, p] of pts.entries()) {
      const ground = at(...p) - 12, prev = n ? ch[n - 1] : startCh
      // in steep country the river drops in steps (pools and falls) rather than a smooth slide
      const steep = n > 0 && prev - ground > 60 ? Math.floor(ground / 160) * 160 : ground
      ch.push(Math.max(end, Math.min(prev - 0.4, steep)))
      wd.push(width * (minor ? 0.7 + 0.3 * n / total : 0.3 + 0.7 * n / total))
      if (n && ch[n - 1] - ch[n] > 90 && !minor) {
        const [ax, ay] = pts[n - 1], l = Math.hypot(p[0] - ax, p[1] - ay) || 1
        falls.push({ at: p, top: ch[n - 1], bottom: ch[n], dir: [(p[0] - ax) / l, (p[1] - ay) / l] })
      }
    }
    // carve: a channel under the water and a flatter valley floor around it
    for (let q = 0; q + 1 < pts.length; q++) {
      const [ax, ay] = pts[q], [bx, by] = pts[q + 1], R = Math.max(wd[q] * 5, 14)
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9
      const [i0, i1, j0, j1] = boxOf([pts[q], pts[q + 1]], R)
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = X(i), y = Y(j), t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2))
        const d = Math.hypot(x - ax - t * dx, y - ay - t * dy)
        if (d >= R) continue
        const c = mix(ch[q], ch[q + 1], t), half = mix(wd[q], wd[q + 1], t) * 0.6, k = j * w + i
        if (d < half * 2.5) nearRiver[k] = 1
        if (lakeId[k]) continue
        if (d < half) ht[k] = Math.min(ht[k], c - 25 * (1 - d / half))
        else if (ht[k] > c) ht[k] = Math.min(ht[k], c + (ht[k] - c) * Math.pow(smooth(half, R, d), 0.8))
      }
    }
    const line = { id, name, pts, ch, width: wd, minor }
    rivers.push(line)
    return line
  }
  const resample = (src: XY[], step: number) => {
    const out: XY[] = []
    for (let q = 0; q + 1 < src.length; q++) {
      const [ax, ay] = src[q], [bx, by] = src[q + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
      for (let s = 0; s < n; s++) out.push([mix(ax, bx, s / n), mix(ay, by, s / n)])
    }
    out.push(src[src.length - 1])
    return out
  }
  for (const f of feats) {
    if (f.kind !== 'river') continue
    const width = f.width ?? FEATURE_KINDS.river.width!
    const pts = resample(f.path!, cell).map((p) => {
      const [x, y] = warp(p), low = smooth(500, 60, at(x, y)), m = fbm(nB, p[0] / 70, p[1] / 70, 12, 2) * (7 + 20 * low)
      return [x + m, y - m * 0.7] as XY
    })
    const main = trace(pts, f.id, f.name, width, false)
    if (!main) continue
    const L = pathLen(main.pts)
    // tributaries: walk uphill from points along the river, then flow back down into it
    const nt = Math.min(6, Math.floor(L / 220))
    for (let n = 0; n < nt; n++) {
      const q = Math.floor(main.pts.length * (0.2 + 0.6 * (n + 0.5) / nt)), side = n % 2 ? 1 : -1
      const [px, py] = main.pts[q], [nx, ny] = main.pts[Math.min(main.pts.length - 1, q + 2)]
      const l = Math.hypot(nx - px, ny - py) || 1
      let dir: XY = [-(ny - py) / l * side, (nx - px) / l * side], p: XY = [px, py]
      const path: XY[] = [p]
      for (let s = 0; s < 45; s++) {
        const e = cell * 2, gx = at(p[0] + e, p[1]) - at(p[0] - e, p[1]), gy = at(p[0], p[1] + e) - at(p[0], p[1] - e), gl = Math.hypot(gx, gy) || 1
        const wob = fbm(nE, p[0] / 30, p[1] / 30, n * 3.1, 2)
        dir = [dir[0] * 0.65 + gx / gl * 0.35 - dir[1] * wob * 0.4, dir[1] * 0.65 + gy / gl * 0.35 + dir[0] * wob * 0.4]
        const dl = Math.hypot(...dir) || 1; dir = [dir[0] / dl, dir[1] / dl]
        p = [p[0] + dir[0] * 6, p[1] + dir[1] * 6]
        if (wetAt(...p) !== undefined || at(...p) > 2600) break
        path.push(p)
      }
      if (path.length > 12) trace(resample(path.reverse(), cell), `${f.id}~t${n}`, undefined, width * 0.35, true)
    }
    // delta: if a big river meets the sea, raise a fan of new land and split it into arms
    const mouth = main.pts[main.pts.length - 1]
    if (width >= 5 && at(...mouth) < 0 && !lakeId[idx(Math.round(FI(mouth[0])), Math.round(FJ(mouth[1])))]) {
      const b = Math.max(0, main.pts.length - Math.round(70 / cell)), [bx, by] = main.pts[b], l = Math.hypot(mouth[0] - bx, mouth[1] - by) || 1
      const dir: XY = [(mouth[0] - bx) / l, (mouth[1] - by) / l]
      const R = 95
      over([mouth], R, (k, i, j) => {
        const x = X(i) - bx, y = Y(j) - by, d = Math.hypot(x, y), cos = (x * dir[0] + y * dir[1]) / (d || 1)
        if (d > R || cos < 0.55 || ht[k] < -110 || ht[k] > 8 || nearRiver[k]) return // keep the main channel open
        const m = smooth(R, R * 0.5, d) * smooth(0.55, 0.8, cos) * smooth(-110, -40, ht[k])
        if (m > 0.3 + 0.25 * fbm(nE, X(i) / 12, Y(j) / 12, 2, 2)) { ht[k] = 4 + 6 * m; biome[k] = PAINT.indexOf('reeds') + 1; bw[k] = Math.max(bw[k], m) }
      }, () => {})
      for (const turn of [-0.5, 0.45]) {
        const arm: XY[] = [[bx, by]]
        let a = Math.atan2(dir[1], dir[0]) + turn, p: XY = [bx, by]
        for (let s = 0; s < 40; s++) { a -= turn * 0.04; p = [p[0] + Math.cos(a) * cell, p[1] + Math.sin(a) * cell]; arm.push(p); if (at(...p) < -30) break }
        trace(arm, `${f.id}~d${turn > 0 ? 1 : 2}`, undefined, width * 0.5, true, main.ch[b])
      }
    }
  }
  for (const v of vents) v.top = at(...v.at)
  for (const p of props) p.ground = Math.max(0, at(...p.at))

  // Where named features ended up after the warp: crest lines, label anchors, snap targets.
  const lines: Gen['lines'] = {}, anchors: Gen['anchors'] = {}, snaps: number[] = []
  for (const f of feats) {
    if (f.path && f.kind !== 'river') {
      const pts = resample(f.path, cell * 3).map(warp)
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
  for (const r of rivers) if (!r.minor) for (let n = 0; n < r.pts.length; n += 2) snaps.push(r.pts[n][0], r.pts[n][1])
  for (let j = 0; j + 2 < h; j += 2) for (let i = 0; i + 2 < w; i += 2) {
    const k = j * w + i
    if ((ht[k] >= 0) !== (ht[k + 2] >= 0) || (ht[k] >= 0) !== (ht[k + 2 * w] >= 0)) snaps.push(X(i + 1), Y(j + 1))
  }

  // Zones: drifting motes, rain or snow are spawned at random points inside them.
  const rz = (n: number) => hash4(n, 7, s0 & 0xffff, 3)
  const zones: Gen['zones'] = zoneFeats.map((f, zi) => {
    const box = boxOf(f.area!, 0), out: number[] = []
    const want = Math.min(500, Math.max(30, Math.round(polyArea(f.area!) / 900)))
    for (let n = 0; out.length < want * 3 && n < want * 30; n++) {
      const i = box[0] + Math.floor(rz(n * 2) * (box[1] - box[0] + 1)), j = box[2] + Math.floor(rz(n * 2 + 1) * (box[3] - box[2] + 1)), k = j * w + i
      if (zone[k] === zi + 1 && zw[k] > 0.5) out.push(X(i), Y(j), Math.max(0, ht[k]))
    }
    return { kind: f.kind as 'magic', id: f.id, color: f.color ? hexRGB(f.color) : f.kind === 'magic' ? [155, 93, 229] : f.kind === 'storm' ? [70, 76, 96] : [235, 242, 255], pts: new Float32Array(out) }
  })

  // 10. Ground colour, water and effects data, close-up roughness, trees.
  const rgba = new Uint8Array(N * 4), data = new Uint8Array(N * 4), rough = new Uint8Array(N), tree = new Uint8Array(N), dens = new Uint8Array(N)
  const R2 = (W / 2) ** 2
  let maxH = 0
  const C = BIOMES, n1F = coarse((x, y) => fbm(nC, x / 90, y / 90, 9, 4)), woodsF = coarse((x, y) => fbm(nD, x / 110, y / 110, 13, 4))
  const blur = boxBlur(ht, w, h, Math.max(2, Math.round(14 / cell)))
  const paint = (col: RGB, c: RGB, t: number) => { col[0] = mix(col[0], c[0], t); col[1] = mix(col[1], c[1], t); col[2] = mix(col[2], c[2], t) }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, x = X(i), y = Y(j)
    if (disc && x * x + y * y > R2) ht[k] = Math.min(ht[k], -20)
    const z = ht[k], wl = lakeId[k] ? surface[k] : 0, under = z < wl
    maxH = Math.max(maxH, z)
    const gx = (ht[idx(i + 1, j)] - ht[idx(i - 1, j)]) / (2 * cell), gy = (ht[idx(i, j + 1)] - ht[idx(i, j - 1)]) / (2 * cell)
    const slope = Math.hypot(gx, gy) // m per km
    const n1 = n1F[k], n2 = fbm(nB, x / 9, y / 9, 3, 2)
    const col: RGB = [0, 0, 0]
    let tk: TreeKind | undefined, td = 0, fx = 0, fs = 0
    const b = biome[k], wgt = smooth(0.25, 0.75, bw[k])
    let painted = b && b !== 255 ? PAINT[b - 1] : undefined
    if (painted === 'reef' && !under) painted = undefined // reefs colour the sea floor only
    if (under) {
      const dz = wl - z
      paint(col, C.seabed.color, 1); col[0] *= 1 - 0.55 * smooth(0, 900, dz); col[1] *= 1 - 0.5 * smooth(0, 900, dz); col[2] *= 1 - 0.4 * smooth(0, 900, dz)
      if (painted === 'reef' && dz < 400) {
        const c = n2 > 0.1 ? [250, 130, 120] : n2 > -0.15 ? [255, 196, 90] : [130, 220, 200]
        paint(col, c as RGB, wgt * smooth(400, 150, dz)); fx = FX.reef; fs = Math.round(15 * wgt)
      }
      data[k * 4] = Math.round(255 * Math.min(1, dz / 1200))
    } else {
      const cb = cbiome[k] ? CLIMATE_BIOMES[cbiome[k] - 1] : undefined
      // unpainted land without a climate: a grass / meadow mosaic with natural woods
      paint(col, C.grass.color, 1); paint(col, C.meadow.color, smooth(-0.15, 0.25, n1))
      const woods = smooth(0.18, 0.34, woodsF[k])
      tk = 'broad'; td = mix(C.grass.trees!, 0.7, woods)
      if (cb && cb !== 'grass') { const B = C[cb]; paint(col, B.color, 0.85 + 0.15 * n1); tk = B.tree; td = (B.trees ?? 0) * (0.75 + 0.5 * smooth(-0.3, 0.3, woodsF[k])) }
      else paint(col, C.forest.color, woods * 0.8)
      if (b === 255) { paint(col, C.ash.color, wgt); td *= 1 - wgt }
      else if (painted) {
        const B = C[painted]
        paint(col, B.color, wgt)
        // soft edges: across a border the trees of both sides mix, more of the painted kind further in
        if (hash4(i, j, s0 & 0xffff, 9) < wgt) { tk = B.tree; td = B.trees ?? 0 } else td *= 1 - wgt * 0.5
        if (B.fx) { fx = FX[B.fx]; fs = Math.round(15 * wgt) }
        if (painted === 'glacier') { const cr = smooth(0.9, 0.96, ridged(nE, x / 9, y / 9, 3.3, 2)); paint(col, [120, 160, 200], cr * 0.6 * wgt) }
        if (painted === 'badlands') { const band = Math.sin(z / 45) * 0.5 + 0.5; paint(col, [150, 80, 54], band * 0.5 * wgt) }
        if (painted === 'crystal') paint(col, [200, 170, 255], smooth(0.3, 0.6, n2) * 0.5 * wgt)
      }
      // shores: beaches, mangroves, palms on warm beaches; cliffs stay rock
      const ct = ctype[k], shore = coast[k] > -9 && z < 70 && ct !== 2 && ct !== 3
      if (shore) {
        const s = smooth(70, 25, z) * smooth(-9, -2.5, coast[k])
        if (ct === 4) { paint(col, C.mangrove.color, s); if (s > 0.3) { tk = 'mangrove'; td = C.mangrove.trees! } }
        else { paint(col, C.beach.color, s); td *= 1 - s; if (s > 0.5 && warm[k] > 0.68 && hash4(i, j, s0 & 0xffff, 11) < 0.35) { tk = 'palm'; td = 0.3 } }
      }
      const rock = Math.max(smooth(75, 160, slope) * smooth(300, 1000, z), smooth(1700, 2300, z + n2 * 300))
      paint(col, [C.rock.color[0] * (0.9 + 0.2 * n1), C.rock.color[1] * (0.9 + 0.2 * n1), C.rock.color[2] * (0.9 + 0.2 * n1)], rock)
      td *= 1 - smooth(0.2, 0.6, rock)
      const snow = smooth(3000, 3250, z + n1 * 300 + n2 * 150 - (warm[k] - 0.5) * 900) * (1 - 0.5 * smooth(240, 380, slope))
      paint(col, C.snow.color, snow)
      td *= 1 - snow
      if (slope > 220) td *= 0.3
      if (nearRiver[k] && td < 0.25 && tk === 'broad') td += 0.12 // green ribbons along rivers
    }
    // zones tint the ground: magic glows, storms darken, blizzards whiten
    const zi = zone[k]
    if (zi && zw[k] > 0.05) {
      const Z = zones[zi - 1], m = zw[k]
      if (Z.kind === 'magic') { paint(col, Z.color, 0.35 * m); fx = FX.magic; fs = Math.round(15 * m) }
      else if (Z.kind === 'storm') { col[0] *= 1 - 0.25 * m; col[1] *= 1 - 0.25 * m; col[2] *= 1 - 0.2 * m; fx = FX.storm; fs = Math.round(15 * m) }
      else { paint(col, C.snow.color, 0.6 * m); fx = FX.blizzard; fs = Math.round(15 * m); td *= 1 - 0.5 * m }
    }
    const shade = 1 + 0.07 * n1 + 0.05 * n2
    rgba[k * 4] = Math.min(255, col[0] * shade); rgba[k * 4 + 1] = Math.min(255, col[1] * shade); rgba[k * 4 + 2] = Math.min(255, col[2] * shade)
    rgba[k * 4 + 3] = 255 - Math.round(lava[k] * 255)
    if (lava[k] > 0.3) { rgba[k * 4] = 255; rgba[k * 4 + 1] = 110; rgba[k * 4 + 2] = 30 }
    data[k * 4 + 1] = lakeId[k] ? 255 : 0
    data[k * 4 + 2] = fx * 16 + fs
    data[k * 4 + 3] = Math.round(255 * (1 - 0.6 * Math.min(1, Math.max(0, (blur[k] - z) / 500))))
    rough[k] = under || nearRiver[k] ? 0 : Math.round(255 * smooth(25, 350, z) * Math.min(1, 0.25 + 0.75 * smooth(700, 2400, z) + smooth(60, 200, slope) * 0.5) * (BIOMES[groundOf(k)].shape === 'flat' ? 0.1 : 1))
    if (tk && td > 0 && !under) { tree[k] = TREE_KINDS.indexOf(tk) + 1; dens[k] = Math.round(Math.min(1, td) * 255) }
  }
  // lake rims get their own surface, so the lake's water shader can find its shore
  for (let k = 0; k < N; k++) if (!lakeId[k] && data[k * 4 + 1] === 0) {
    const i = k % w, j = (k - i) / w
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (lakeId[idx(i + di, j + dj)]) { data[k * 4 + 1] = 255; break }
  }
  // snowy summits: local high points, for blowing snow
  const summits: XY[] = []
  const tops: [number, number][] = []
  for (let j = 4; j < h - 4; j += 4) for (let i = 4; i < w - 4; i += 4) { const z = ht[j * w + i]; if (z > 2900 && z >= blur[j * w + i] + 250) tops.push([z, j * w + i]) }
  tops.sort((a, b) => b[0] - a[0])
  for (const [, k] of tops) {
    const x = X(k % w), y = Y(Math.floor(k / w))
    if (summits.length < 40 && summits.every((s) => Math.hypot(s[0] - x, s[1] - y) > size * 0.03)) summits.push([x, y])
  }
  return {
    w, h, cell, W, H, disc, edge: fw.edge ?? 'wall', height: ht, rgba, data, rough, tree, dens, rivers, lakes, falls, vents, props, zones, whirls, summits,
    exag: exagOf(fw), maxH, wx, wy, anchors, lines, snaps: new Float32Array(snaps),
  }
}
const CLIMATE_BIOMES = ['snow', 'tundra', 'taiga', 'steppe', 'grass', 'swamp', 'forest', 'desert', 'savanna', 'jungle']

/** Box blur of a field (radius in cells), via running sums along rows then columns. */
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const a = new Float32Array(src.length), b = new Float32Array(src.length)
  for (let j = 0; j < h; j++) {
    let s = 0
    for (let i = -r; i <= r; i++) s += src[j * w + Math.min(w - 1, Math.max(0, i))]
    for (let i = 0; i < w; i++) { a[j * w + i] = s / (2 * r + 1); s += src[j * w + Math.min(w - 1, i + r + 1)] - src[j * w + Math.max(0, i - r)] }
  }
  for (let i = 0; i < w; i++) {
    let s = 0
    for (let j = -r; j <= r; j++) s += a[Math.min(h - 1, Math.max(0, j)) * w + i]
    for (let j = 0; j < h; j++) { b[j * w + i] = s / (2 * r + 1); s += a[Math.min(h - 1, j + r + 1) * w + i] - a[Math.max(0, j - r) * w + i] }
  }
  return b
}

/**
 * Erosion on a half-resolution copy, applied back as a smooth difference. Stream power: each cell is pulled towards the cell it
 * drains into, harder the more ground drains through it, so slopes grow valleys and ridges. Then a talus pass trims needle peaks.
 */
function erode(ht: Float32Array, w: number, h: number, cell: number) {
  const S = 2, cw = Math.ceil(w / S), chh = Math.ceil(h / S), n = cw * chh, dx = cell * S
  const c = new Float32Array(n)
  for (let b = 0; b < chh; b++) for (let a = 0; a < cw; a++) {
    let s = 0, m = 0
    for (let j = b * S; j < Math.min(h, b * S + S); j++) for (let i = a * S; i < Math.min(w, a * S + S); i++) { s += ht[j * w + i]; m++ }
    c[b * cw + a] = s / m
  }
  const orig = c.slice(), recv = new Int32Array(n), area = new Float32Array(n), order = new Uint32Array(n)
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
  const K = 0.0022 * Math.sqrt(dx / 5), talus = 230 * dx // max drop between neighbours, m
  for (let it = 0; it < 5; it++) {
    for (let b = 0; b < chh; b++) for (let a = 0; a < cw; a++) {
      const q = b * cw + a
      let best = -1, bs = 0
      if (c[q] > 0) for (const [da, db] of NB) {
        const aa = a + da, bb = b + db
        if (aa < 0 || bb < 0 || aa >= cw || bb >= chh) continue
        const r = bb * cw + aa, s = (c[q] - c[r]) / (da && db ? 1.414 : 1)
        if (s > bs) { bs = s; best = r }
      }
      recv[q] = best
    }
    for (let q = 0; q < n; q++) order[q] = q
    order.sort((p, q) => c[q] - c[p]) // high to low
    area.fill(1)
    for (let o = 0; o < n; o++) { const q = order[o], r = recv[q]; if (r >= 0) area[r] += area[q] }
    for (let o = n - 1; o >= 0; o--) { // low to high: each receiver is final before its donors
      const q = order[o], r = recv[q]
      if (r < 0) continue
      const f = K * Math.sqrt(area[q])
      c[q] = Math.max(c[r] + 0.5, (c[q] + f * c[r]) / (1 + f))
    }
    for (let b = 1; b < chh - 1; b++) for (let a = 1; a < cw - 1; a++) {
      const q = b * cw + a
      if (c[q] <= 0) continue
      let lo = q
      for (const [da, db] of NB) { const r = (b + db) * cw + a + da; if (c[r] < c[lo]) lo = r }
      const ex = c[q] - c[lo] - talus
      if (ex > 0) { c[q] -= ex * 0.4; c[lo] += ex * 0.4 }
    }
  }
  for (let j = 0; j < h; j++) {
    const fb = Math.min(chh - 1.001, Math.max(0, (j + 0.5) / S - 0.5)), b = Math.floor(fb), ty = fb - b
    for (let i = 0; i < w; i++) {
      const k = j * w + i
      if (ht[k] <= 0) continue
      const fa = Math.min(cw - 1.001, Math.max(0, (i + 0.5) / S - 0.5)), a = Math.floor(fa), tx = fa - a, q = b * cw + a
      const d = (p: number) => c[p] - orig[p]
      ht[k] = Math.max(1, ht[k] + mix(mix(d(q), d(q + 1), tx), mix(d(q + cw), d(q + cw + 1), tx), ty))
    }
  }
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
const bilinear = (g: Gen, f: ArrayLike<number>, x: number, y: number) => {
  const fi = Math.min(g.w - 1.001, Math.max(0, (x + g.W / 2) / g.cell - 0.5)), fj = Math.min(g.h - 1.001, Math.max(0, (g.H / 2 - y) / g.cell - 0.5))
  const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, ty = fj - j, a = j * g.w + i
  return mix(mix(f[a], f[a + 1], tx), mix(f[a + g.w], f[a + g.w + 1], tx), ty)
}
/** Height in m at a map point (bilinear), without close-up detail. */
export const heightAt = (g: Gen, x: number, y: number) => bilinear(g, g.height, x, y)
/** Height in m including the close-up detail the GPU adds, so markers sit on the drawn ground. */
export const surfaceAt = (g: Gen, x: number, y: number) => heightAt(g, x, y) + detailAt(x, y) * bilinear(g, g.rough, x, y) / 255 * DETAIL_M
/** Is this map point inside the drawn (warped) outline of an area feature? */
export const underFeature = (g: Gen, f: MapFeature, x: number, y: number) => { const k = sampleIdx(g, x, y); return !!f.area && inPoly(f.area, x + g.wx[k], y + g.wy[k]) }

// ---------- meshes and placements (still pure: plain typed arrays the renderer uploads) ----------

/** The diorama's cut edge: a ring around the map with the ground (or water) height at each point, in display km. */
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
    const gy = g.height[sampleIdx(g, x, y)] * e
    pos.push(x, Math.max(gy, 0), -y, x, bottom, -y); ground.push(gy, gy)
    if (n) { const a = (n - 1) * 2; index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3) }
  }
  return { pos: new Float32Array(pos), ground: new Float32Array(ground), index: new Uint32Array(index), bottom, ring }
}

/**
 * Trees on jittered lattices, as [x, y, scale, yaw, shade] per tree (y = map north; the GPU puts them on the ground).
 * `far`: big, sparse trees seen from anywhere. `near`: small, dense trees in forests, bucketed so only nearby buckets draw.
 */
export function treesOf(g: Gen, seed: string) {
  const s0 = hash(seed) & 0xffff
  const lattice = (sp: number, salt: number, min: number, scale: [number, number], push: (kind: number, x: number, y: number, v: number[]) => void) => {
    const nx = Math.floor(g.W / sp), ny = Math.floor(g.H / sp)
    for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
      const x = -g.W / 2 + (a + hash4(a, b, s0, salt + 1)) * sp, y = g.H / 2 - (b + hash4(a, b, s0, salt + 2)) * sp
      if (g.disc && Math.hypot(x, y) > g.W / 2 - sp) continue
      const k = sampleIdx(g, x, y), t = g.tree[k]
      if (!t || g.dens[k] < min || hash4(a, b, s0, salt + 3) * 255 >= g.dens[k] || g.height[k] < 8) continue
      push(t - 1, x, y, [x, y, sp * (scale[0] + hash4(a, b, s0, salt + 4) * scale[1]), hash4(a, b, s0, salt + 5) * Math.PI * 2, 0.82 + hash4(a, b, s0, salt + 6) * 0.3])
    }
  }
  const far: number[][] = TREE_KINDS.map(() => [])
  lattice(g.cell * 2.2, 0, 1, [1.5, 1.1], (t, _x, _y, v) => far[t].push(...v))
  const BX = 24, BY = Math.max(1, Math.round(24 * g.H / g.W)), near: number[][][] = TREE_KINDS.map(() => Array.from({ length: BX * BY }, () => []))
  lattice(g.cell * 0.8, 10, 80, [1.6, 1], (t, x, y, v) => {
    const bi = Math.min(BX - 1, Math.floor((x + g.W / 2) / g.W * BX)), bj = Math.min(BY - 1, Math.floor((g.H / 2 - y) / g.H * BY))
    near[t][bj * BX + bi].push(...v)
  })
  return {
    far: far.map((a) => new Float32Array(a)),
    near: { bx: BX, by: BY, kinds: near.map((buckets) => ({ data: new Float32Array(buckets.flat()), start: Int32Array.from(buckets.reduce<number[]>((s, b) => (s.push(s[s.length - 1] + b.length / 5), s), [0])) })) },
  }
}

/** Everything Claude needs to write or edit a flat world, plus a summary of this one. */
export function brief(fw?: FlatWorld) {
  const kinds = Object.entries(FEATURE_KINDS).filter(([, s]) => !s.label.includes('painted area'))
    .map(([k, s]) => `  ${k.padEnd(9)} ${s.geom.padEnd(5)} ${s.label}${['height', 'width', 'radius', 'depth'].filter((p) => s[p as 'height'] !== undefined).map((p) => `; ${p} ${s[p as 'height']}`).join('')}`)
  const out = [
    'FLAT WORLD FORMAT (Bookwright, New Map Test). One JSON object; the app generates the terrain from it.',
    '{ id, name, note?, shape: "rect" | "disc", size: [widthKm, heightKm], seed, relief?, wobble?, climate?, edge?, features: [...], layers?: [...] }',
    'wobble: how far the generator bends outlines away from their points (1 = default; about 0.3 when tracing a drawn map so shapes stay true).',
    'Coordinates are [x, y] in km from the map centre: x east, y north. A rect spans x in +-width/2, y in +-height/2; a disc has radius width/2.',
    'Scale is stylised: from far away heights are drawn about size/120 times taller than life (relief multiplies that), easing to about 40% of that up close.',
    `climate: { north?, south? (${Object.keys(TEMPS).join(', ')}), wind? (${WINDS.join(', ')}: where rain comes from), wet? 0..1 }. With a climate, unpainted land picks forest, desert, tundra, jungle... by itself, with dry rain shadows behind ranges.`,
    'edge: "wall" (rock strata, default) or "waterfall" (the sea pours off the edge of the world; best on a disc).',
    '',
    'FEATURES (the ground; geom: at = [x, y], path = [[x, y], ...], area = closed outline [[x, y], ...]). Defaults after the label:',
    ...kinds,
    `  painted ground (area): ${PAINT.map((b) => `${b}${BIOMES[b].fx || BIOMES[b].shape ? ` (${BIOMES[b].label!.replace(/^[^(]*\(?|\)$/g, '') || BIOMES[b].label})` : ''}`).join(', ')}`,
    'Order: land and sea outlines first; then ranges, peaks and hills (eroded into valleys); then plateaus, volcanoes, canyons, craters, sinkholes; lakes; rivers last. Later painted areas win where they overlap.',
    '',
    'LAYERS (things on the ground the user also edits with the map tools):',
    ...Object.entries(LAYER_KINDS).map(([k, s]) => `  ${k.padEnd(9)} items with "${s.geom}"`),
    `  item: { id, name?, note?, at | path | area, size? (cities: ${CITY_SIZES.join(', ')}), icon? (landmarks: ${Object.keys(LANDMARKS).join(', ')}), curve? (true: a smooth curve through the points) }`,
    '  Borders and regions should sit on the land: run borders along rivers and ridges, end them on a coast, and let region outlines follow coastlines.',
    '',
    'RULES',
    '- Make it look natural: coastlines and areas are irregular outlines with 12-30 points, never circles or boxes; the generator adds more wobble.',
    '- Ranges follow plate-like arcs; rivers start high (in or near a range) and run to the sea or a lake; they find the coast by themselves.',
    '- Biomes should make sense: deserts in rain shadows or hot dry interiors, jungles hot and wet, glaciers and tundra cold, reefs in warm shallow sea.',
    '- Keep ids stable when editing; give named things names (the user names features, use theirs).',
    '- Check with: node scripts/map.ts validate <file>, then preview <file> out.png and look at it.',
  ]
  if (fw) {
    out.push('', `THIS WORLD: "${fw.name}" ${fw.shape} ${fw.size[0]} x ${fw.size[1]} km, seed "${fw.seed}"${fw.relief ? `, relief ${fw.relief}` : ''}${fw.climate ? `, climate ${JSON.stringify(fw.climate)}` : ''}${fw.edge ? `, edge ${fw.edge}` : ''}`)
    for (const f of fw.features) out.push(`  ${f.id}: ${f.kind}${f.name ? ` "${f.name}"` : ''}`)
    for (const l of fw.layers ?? []) out.push(`  layer ${l.id}: ${l.kind} "${l.name}", ${l.items.length} items${l.items.length ? `: ${l.items.slice(0, 12).map((i) => i.name ?? i.id).join(', ')}${l.items.length > 12 ? ', ...' : ''}` : ''}`)
  }
  return out.join('\n')
}
