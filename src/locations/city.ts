// Locations: a city-scale place built from a short recipe that Claude writes (the user names things).
// A location is seed + size + named landforms (terrain.ts: ranges, peaks, valleys, coasts, cliffs, gorges, glaciers,
// volcanoes, mesas, canyons, dunes, karst...) + water (hydro.ts: erosion, lakes, rivers) + districts (towns that grow from
// a core along their roads, town.ts) + structures (megastructure kits, walls, canals, harbours, roads). Everything else
// is worked out: drainage, roads, streets and squares, houses, land use, forests, rock faces.
// Everything is deterministic. Pure: node tests, the CLI and the worker run it.
// Recipe coordinates are metres from the centre, x east and y north; heights are altitudes in metres.
import { fbm, hash, rng, simplex } from '../world/noise.ts'
import { AQUEDUCT_STYLES, arcade, basilica, BRIDGE_STYLES, BRONZE, Builder, cathedral, church, cityWall, colonnade, domeChurch, harbour, lin, MARBLE, market, MATS, mix, monastery, palace, plaza, statue, tower, type Col, type Mat, type V } from './kit.ts'
import { carve, planRoads, RoadIndex, sampler, type Road } from './roads.ts'
import { CULTURES, farmstead, Occ, PART, placeAll, PSTRIDE, type Culture, type DistrictIn, type Out } from './buildings.ts'
import { erode } from './erode.ts'
import { areaDist, bboxOf, clamp, footprint, glacierWidth, gridN, inPoly, lerp, pathNearFast, polyLen, resample, rockHex, ROCKS, simplify, sstep, STRUCTURE_SCALE, terrainOf, type Rock, type TerrainFn, type XY } from './terrain.ts'
import { growTown, townStreets, zoneOutline } from './town.ts'
import { carveDelta, carveRiver, drySeaPuddles, fluvial, makeLake, type Lake, type River } from './hydro.ts'
import { rockForms, rockWalls, springPools } from './rock.ts'
import { audit } from './check.ts'


export { terrainOf, inPoly, footprint, gridN, type TerrainFn, type XY, type River, type Lake }
export const TERRAIN_KINDS = ['peak', 'ridge', 'valley', 'cliff', 'coast', 'fjord', 'gorge', 'glacier', 'river', 'lake', 'marsh', 'plateau', 'fields', 'volcano', 'lavafield', 'crater', 'springs', 'geyser', 'mesa', 'canyon', 'dunes', 'island', 'stack', 'arch', 'spire', 'karst', 'hoodoos', 'columns'] as const
export const STRUCTURE_KINDS = ['cathedral', 'basilica', 'church', 'market', 'colonnade', 'dome', 'palace', 'monastery', 'tower', 'plaza', 'statue', 'bridge', 'aqueduct', 'wall', 'canal', 'harbour', 'road'] as const
export const MOOD_NAMES = ['morning', 'noon', 'golden', 'mist', 'dusk', 'night'] as const
export const WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'storm'] as const
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export const CROPS = ['mixed', 'wheat', 'vines', 'orchard', 'olives', 'pasture', 'lavender', 'terraces', 'rice'] as const
export const CLIMATES = ['temperate', 'alpine', 'mediterranean', 'arid', 'tropical', 'boreal'] as const
export const COAST_STYLES = ['cliffs', 'rocky', 'mixed', 'beach', 'fjord'] as const
export type MoodName = typeof MOOD_NAMES[number]
export type Weather = typeof WEATHERS[number]
export type Season = typeof SEASONS[number]
export type Crop = typeof CROPS[number]
export type Climate = typeof CLIMATES[number]
export type { Culture }
export interface TerrainFeature {
  id: string; kind: typeof TERRAIN_KINDS[number]; name?: string; note?: string
  at?: XY; to?: XY; path?: XY[]; area?: XY[]
  height?: number // summit / crest / valley floor / plateau altitude / glacier tongue / cliff top above the sea
  end?: number // a valley's floor altitude at the end of its path
  radius?: number; width?: number; level?: number; depth?: number; sharp?: number; edge?: number
  drop?: number; side?: 'left' | 'right'; extent?: number; meander?: number; crop?: Crop; angle?: number; step?: number
  style?: typeof COAST_STYLES[number]; bays?: number; stacks?: number; rock?: string; density?: number
  crater?: number; caldera?: boolean; active?: boolean; cones?: number; lava?: number; follow?: boolean; mouth?: 'estuary' | 'delta' | 'none'
}
export interface District {
  id: string; name?: string; note?: string; area?: XY[]; at?: XY; radius?: number; density?: number; wealth?: number; steep?: boolean; culture?: Culture | 'mixed'
  walls?: boolean; church?: boolean; square?: boolean; plan?: 'organic' | 'grid' | 'radial' | 'terraced'; farms?: boolean
}
export interface Structure {
  id: string; kind: typeof STRUCTURE_KINDS[number]; name?: string; note?: string
  at?: XY; to?: XY; path?: XY[]; facing?: number; scale?: number; height?: number; width?: number; depth?: number; radius?: number; span?: number
  level?: number; deck?: [number, number]; color?: string; roof?: string; statues?: boolean; centre?: 'fountain' | 'obelisk' | 'statue' | 'none'; gates?: XY[]; culture?: Culture
  /** Bridges: roman, gothic, renaissance, inhabited; aqueducts: roman, segovia, moorish (default: chosen by the seed). */
  style?: typeof BRIDGE_STYLES[number] | typeof AQUEDUCT_STYLES[number]
}
export interface View { name: string; at: [number, number, number]; heading: number; pitch: number; note?: string; hour?: number; weather?: Weather; season?: Season }
export interface LocationDoc {
  id: string; name: string; seed: string; size: number; note?: string
  base?: number; relief?: number; snowline?: number; sea?: number; climate?: Climate; culture?: Culture | 'mixed'; erosion?: number; rock?: string
  wealth?: [number, number]; roads?: boolean; forest?: number; farms?: boolean
  /** The ground and its rock are one volume surface (volume.ts), the default; false draws the old height grid with rock sheets. */
  volume?: boolean
  mood?: MoodName; hour?: number; weather?: Weather; season?: Season
  terrain: TerrainFeature[]; districts: District[]; structures: Structure[]; views?: View[]
}
/** Bump when the generator changes, so builds saved in the browser are redone. */
export const BUILD_VERSION = 25
export const TSTRIDE = 6 // trees: x y z scale kind shade
export const TREE = { broadleaf: 0, spruce: 1, pine: 2, cypress: 3, larch: 4, orchard: 5, bush: 6, olive: 7, palm: 8 } as const
const DEG = Math.PI / 180
const SCALE = STRUCTURE_SCALE
const GREAT = new Set(['cathedral', 'basilica', 'dome', 'palace', 'colonnade', 'monastery'])

/** Compass facing (degrees, 0 = north, 90 = east) as a recipe-space unit vector. */
export const facingVec = (deg = 180): XY => [Math.sin(deg * DEG), Math.cos(deg * DEG)]
/** Recipe (x, y) to world (x, z), and the builder yaw that turns a kit's front (local +z) to face `deg`. */
const W = (p: XY): [number, number] => [p[0], -p[1]]
const yawOf = (deg = 180) => Math.PI - deg * DEG

// ---------- farmland ----------
const CROP_COL: Record<string, string[]> = {
  wheat: ['#c9b060', '#d4bc6c', '#bfa652'], barley: ['#b8b06a', '#c4ba78'], meadow: ['#7a9a48', '#86a452', '#6e9040'], fallow: ['#8a7050', '#7e6648', '#94785a'],
  vines: ['#6a7a3a', '#5e7034'], orchard: ['#6f8a44', '#78924a'], olives: ['#8a8a5a', '#7e8052'], pasture: ['#7e9e4c', '#8aa858', '#749448'], lavender: ['#8a7aa8', '#7a6c9a'], maize: ['#a8a84a', '#9aa046'],
  rapeseed: ['#d6c63c', '#cdbd38'], potatoes: ['#5e7a3a', '#567034'], rice: ['#7aa060', '#6e9a5a'], hay: ['#a8a462', '#b4ae6a'],
}
/** What each building culture grows around its towns. */
const CROPS_OF: Record<Culture, string[]> = {
  central: ['wheat', 'wheat', 'barley', 'meadow', 'meadow', 'fallow', 'maize', 'rapeseed', 'potatoes', 'hay'],
  mediterranean: ['wheat', 'wheat', 'olives', 'olives', 'vines', 'fallow', 'hay', 'wheat'],
  mountain: ['meadow', 'meadow', 'pasture', 'pasture', 'hay', 'barley', 'potatoes'],
  eastern: ['wheat', 'wheat', 'orchard', 'vines', 'fallow', 'barley', 'hay'],
}
/** A field source: the recipe's own fields, or a town's farmland. `inside` < 0 is in the fields (metres, roughly). */
interface FieldSrc { id: string; inside: (x: number, y: number) => number; bbox: [number, number, number, number]; at: ReturnType<typeof parcels>; farm?: boolean }
/** Fields as irregular parcels (a Voronoi patchwork stretched `aspect` times along `angleDeg`, so central farmland gets
 * long strips), each with its own crop; also how far a point is from its parcel's edge and which way that edge runs. */
function parcels(id: string, crops: string[], size: number, angleDeg: number, aspect: number, seed: number) {
  const a = angleDeg * DEG, c = Math.cos(a), sn = Math.sin(a), su = size * aspect, sv = size, salt = hash(id) ^ seed
  const sites = new Map<number, { u: number; v: number; crop: string; col: Col }>()
  const site = (i: number, j: number) => {
    const k = Math.imul(i, 73856093) ^ Math.imul(j, 19349663)
    let s = sites.get(k)
    if (!s) { const R = rng(salt ^ k), crop = crops[Math.floor(R() * crops.length)], cols = CROP_COL[crop] ?? CROP_COL.meadow; s = { u: (i + 0.15 + 0.7 * R()) * su, v: (j + 0.15 + 0.7 * R()) * sv, crop, col: lin(cols[Math.floor(R() * cols.length)]) }; sites.set(k, s) }
    return s
  }
  const rowYaw = Math.atan2(c, -sn)
  let ci = NaN, cj = NaN, near: ReturnType<typeof site>[] = [] // the nine sites around the last cell asked about
  return (x: number, y: number) => {
    const u = x * c + y * sn, v = -x * sn + y * c, i0 = Math.floor(u / su), j0 = Math.floor(v / sv)
    if (i0 !== ci || j0 !== cj) { ci = i0; cj = j0; near = []; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) near.push(site(i0 + di, j0 + dj)) }
    let d1 = Infinity, d2 = Infinity, s1 = near[4], s2 = s1, key = 0
    for (let q = 0; q < 9; q++) {
      const s = near[q], d = Math.hypot((u - s.u) / aspect, v - s.v)
      if (d < d1) { d2 = d1; s2 = s1; d1 = d; s1 = s; key = (i0 + (q % 3) - 1) * 100003 + j0 + Math.floor(q / 3) - 1 } else if (d < d2) { d2 = d; s2 = s }
    }
    const du = s2.u - s1.u, dv = s2.v - s1.v, dx = du * c - dv * sn, dy = du * sn + dv * c
    return { crop: s1.crop, col: s1.col, u, v, key, edge: (d2 - d1) * 0.5, rowYaw, edgeYaw: Math.atan2(dy, dx), sx: s1.u * c - s1.v * sn, sy: s1.u * sn + s1.v * c }
  }
}

// ---------- build ----------
export interface CityBuilt {
  size: number; N: number; heights: Float32Array; colors: Uint8Array; surf: Uint8Array; minH: number; maxH: number; sea: number | null
  outer: { size: number; n: number; heights: Float32Array; colors: Uint8Array }
  /** Crop colours at about 7 m (RGB, A = how much field), drawn over the ground by the terrain shader. */
  fields: { n: number; tex: Uint8Array }
  /** 1 where a rock face covers the ground: there the coarse levels of detail must stay behind the rock. */
  cliffMask: Uint8Array
  /** Living ground at about 7 m: R lava (glowing above 0.75), G mineral crust (hot springs, geysers), B wetland. */
  marks: { n: number; tex: Uint8Array }
  /** Steam and ash: x, y, z, size, kind (0 hot spring, 1 volcanic plume, 2 geyser). */
  steam: Float32Array
  /** Where summer snow lies (from the climate unless the recipe says). */
  snowline: number
  parts: Float32Array; chimneys: Float32Array; trees: Float32Array; rocks: Float32Array; lamps: Float32Array
  geo: Record<Mat, { pos: Float32Array; nor: Float32Array; col: Float32Array }>
  /** Finer detail of the great structures (kit.ts TIERS): [ornament, carving], drawn only within reach of the camera. */
  detail: Record<Mat, { pos: Float32Array; nor: Float32Array; col: Float32Array }>[]
  water: Float32Array; rivers: { pos: Float32Array; uv: Float32Array }; falls: Float32Array; waterLevels: number[]
  counts: { buildings: number; structures: number; roads: number; trees: number }; ms: number; stages: Record<string, number>
  /** For the volume ground (volume.ts): the free-standing rocks it carves, and the rock colour under each grid vertex
   * (sRGB). Absent when the recipe draws the old height grid. */
  volume?: { rocks: Rock[]; rockMap: Uint8Array; seed: number }
  /** The realism audit (check.ts): one line per finding. */
  audit: string[]
}

/** Texels across the field and living-ground textures: 7 m on a big place, down to 1.5 m on a small one. */
const texN = (size: number) => Math.min(2048, Math.max(512, Math.round(size / clamp(size / 2000, 1.5, 7))))
const centroid = (p: XY[]): XY => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]
const polyArea = (p: XY[]) => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1] }, 0)) / 2

/** Every town gets a market square at its core and a parish church facing it, unless the recipe says otherwise or a
 * great building already stands there. They are ordinary structures, so they level their ground and get drawn. */
export function withTownCentres(doc: LocationDoc): LocationDoc {
  const extra: Structure[] = []
  for (const d of doc.districts) {
    const core = d.at ?? (d.area ? centroid(d.area) : null)
    if (!core) continue
    const r = d.radius ?? (d.area ? Math.sqrt(polyArea(d.area) / Math.PI) : 300), dist = (p: XY) => Math.hypot(p[0] - core[0], p[1] - core[1])
    // the main street most likely runs toward the nearest other town or great building
    const others = [...doc.districts.filter((o) => o !== d && o.at).map((o) => o.at!), ...doc.structures.filter((s) => s.at && GREAT.has(s.kind)).map((s) => s.at!)].filter((p) => dist(p) > r * 0.5).sort((a, b) => dist(a) - dist(b))
    const along = others[0] ? Math.atan2(others[0][0] - core[0], others[0][1] - core[1]) / DEG : hash(d.id) % 180
    const taken = doc.structures.some((s) => s.at && dist(s.at) < Math.max(70, r * 0.2) && (GREAT.has(s.kind) || s.kind === 'plaza' || s.kind === 'market'))
    const w = clamp(r * 0.07, 22, 56), l = w * 1.5, cu = d.culture && d.culture !== 'mixed' ? d.culture : doc.culture && doc.culture !== 'mixed' ? doc.culture : 'central'
    if (d.square !== false && !taken) extra.push({ id: `${d.id}~square`, kind: 'market', at: core, facing: along, width: w, depth: l, culture: cu })
    const great = doc.structures.some((s) => s.at && GREAT.has(s.kind) && dist(s.at) < r * 0.7)
    if (d.church !== false && !great) {
      const side = along + 90 * (hash(d.id) % 2 ? 1 : -1), k = r > 500 ? 1.15 : r < 260 ? 0.8 : 1, [fx, fy] = facingVec(side), off = (taken ? 30 : w / 2) + 22 * k
      extra.push({ id: `${d.id}~church`, kind: 'church', at: [core[0] + fx * off, core[1] + fy * off], facing: side + 180, scale: k, culture: cu })
    }
  }
  return extra.length ? { ...doc, structures: [...doc.structures, ...extra] } : doc
}

export function buildCity(doc0: LocationDoc, onStage?: (stage: string) => void): CityBuilt {
  const t0 = Date.now(), seed = hash(doc0.seed), doc = withTownCentres(doc0), T = terrainOf(doc), size = doc.size, N = gridN(size), cellM = size / N, w1 = N + 1, vol = doc.volume !== false
  const stages: Record<string, number> = {}, lap = (k: string, next?: string) => { stages[k] = Date.now() - t0 - Object.values(stages).reduce((a, c) => a + c, 0); if (next) onStage?.(next) }
  onStage?.('Shaping the ground')
  const heights = new Float32Array(w1 * w1)
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) heights[j * w1 + i] = T.h(-size / 2 + i * cellM, size / 2 - j * cellM) // row 0 = north edge
  const grid = { N, size, heights }, Hw = sampler(grid)
  const H = (x: number, y: number) => Hw(x, -y) // recipe coordinates
  if (T.sea != null) drySeaPuddles(grid, T.sea)
  const stamp = (cx: number, cy: number, r: number, fn: (a: number, d: number) => void) => { // every vertex within r of a recipe point
    for (let j = Math.max(0, Math.floor((size / 2 - cy - r) / cellM)); j <= Math.min(N, Math.ceil((size / 2 - cy + r) / cellM)); j++)
      for (let i = Math.max(0, Math.floor((cx - r + size / 2) / cellM)); i <= Math.min(N, Math.ceil((cx + r + size / 2) / cellM)); i++) { const d = Math.hypot(-size / 2 + i * cellM - cx, size / 2 - j * cellM - cy); if (d <= r) fn(j * w1 + i, d) }
  }
  const vx = (a: number) => -size / 2 + (a % w1) * cellM, vy = (a: number) => size / 2 - Math.floor(a / w1) * cellM
  lap('ground', 'Growing the towns')

  // towns grow from their cores over the cheapest dry ground
  const lakeFeats = doc.terrain.filter((f) => f.kind === 'lake' && (f.at || (f.path && f.path.length > 1)))
  const preWet = (x: number, z: number) => (T.sea != null && Hw(x, z) < T.sea + 0.8) || lakeFeats.some((l) => (l.path ? pathNearFast(l.path, x, -z, (l.radius ?? 400)).d : Math.hypot(x - l.at![0], -z - l.at![1])) < (l.radius ?? 400) * 0.9)
  const towns = doc.districts.filter((d) => d.at || d.area).map((d) => {
    const core = d.at ?? centroid(d.area!)
    return growTown({ id: d.id, core: W(core), r: d.radius ?? (d.area ? Math.sqrt(polyArea(d.area) / Math.PI) : 300), culture: d.culture ?? doc.culture ?? 'central', steep: !!d.steep, plan: d.plan, area: d.area ? (x, z) => areaDist(d, x, -z) : undefined }, Hw, preWet, seed ^ hash(d.id))
  })
  lap('towns', 'Eroding the slopes')

  // erosion: rivers of rain carve the ranges into valleys and spurs, except where it is built, farmed, icy or a cliff
  const strength = doc.erosion ?? 1
  const mask = new Float32Array(heights.length).fill(1), soft = (a: number, v: number) => { mask[a] = Math.min(mask[a], v) }
  for (const f of T.flats) stamp(f.at[0], f.at[1], f.r * 1.5 + 40, (a, d) => soft(a, sstep(f.r, f.r * 1.5 + 40, d)))
  // glaciers: the ice and its trough walls and moraines out to three widths (else the rain lowers the banks and the ice is left standing)
  for (const g of T.glaciers) for (const p of resample(g.path, 40)) stamp(p[0], p[1], g.w * 3.2, (a, d) => soft(a, sstep(g.w * 1.8, g.w * 3.2, d)))
  for (const f of T.fields) { const [x0, y0, x1, y1] = bboxOf(f); stamp((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2, (a) => { if (areaDist(f, vx(a), vy(a)) < 30) soft(a, 0) }) }
  for (const t of towns) { const [x0, z0, x1, z1] = t.bbox; stamp((x0 + x1) / 2, -(z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 80, (a) => soft(a, 0.08 + 0.92 * sstep(0.9, 1.3, t.zone(vx(a), -vy(a))))) }
  // cliffs erode with the land round them (a protected strip would be left standing like a wall), but never slump
  const hard = new Uint8Array(heights.length)
  for (const wl of T.walls) for (const p of resample(wl.pts, 12)) stamp(p[0], p[1], wl.face + 25, (a) => { hard[a] = 1; soft(a, wl.sea ? 0 : 0.3) }) // hard rock: streams notch it slowly; the sea keeps its cliffs fresh
  for (const l of lakeFeats) for (const p of l.path ? resample(l.path, 60) : [l.at!]) stamp(p[0], p[1], (l.radius ?? 400) * 1.2, (a) => soft(a, 0))
  if (T.sea != null) for (let a = 0; a < heights.length; a++) if (heights[a] < T.sea + 2) mask[a] = 0
  if (strength > 0) fluvial(grid, mask, T.sea, strength, 18, hard)
  lap('erosion', 'Filling the lakes and rivers')

  // lakes fill their basins to the size asked; rivers find their valleys, meander on the flats and reach the sea
  const lakes: Lake[] = []
  for (const f of lakeFeats) { const L = makeLake(grid, f.id, f.path ?? [f.at!], f.radius ?? 400, f.depth ?? 40, f.level, seed ^ hash(f.id)); if (L) lakes.push(L) }
  const lakeId = new Int16Array(heights.length).fill(-1)
  lakes.forEach((l, i) => { for (const a of l.cells) lakeId[a] = i })
  const vtx = (x: number, y: number) => clamp(Math.round((size / 2 - y) / cellM), 0, N) * w1 + clamp(Math.round((x + size / 2) / cellM), 0, N)
  const lakeAt = (x: number, y: number) => { const id = lakeId[vtx(x, y)]; return id >= 0 ? lakes[id].level : null }
  const MT = texN(size), mtC = size / MT, marks = new Uint8Array(MT * MT * 4)
  const markAt = (x: number, y: number, r: number, ch: number, v: number) => {
    for (let vv = Math.max(0, Math.floor((size / 2 - y - r) / mtC)); vv <= Math.min(MT - 1, Math.ceil((size / 2 - y + r) / mtC)); vv++)
      for (let u = Math.max(0, Math.floor((x - r + size / 2) / mtC)); u <= Math.min(MT - 1, Math.ceil((x + r + size / 2) / mtC)); u++) {
        const d = Math.hypot(-size / 2 + (u + 0.5) * mtC - x, size / 2 - (vv + 0.5) * mtC - y)
        if (d < r) { const k = (vv * MT + u) * 4 + ch; marks[k] = Math.max(marks[k], Math.round(255 * v * Math.min(1, (1 - d / r) * 3))) }
      }
  }
  const rivers: River[] = []
  for (const f of doc.terrain) {
    if (f.kind !== 'river' || !f.path || f.path.length < 2) continue
    const rv = carveRiver(grid, { id: f.id, way: f.path, width: f.width ?? 24, depth: f.depth ?? 4, meander: f.meander ?? 1, follow: f.follow !== false, mouth: f.mouth }, T.sea, lakeAt, seed ^ hash(f.id))
    rivers.push(rv)
    if (f.mouth === 'delta' && T.sea != null) carveDelta(grid, rv, T.sea, seed ^ hash(f.id) ^ 0xde17a, (x, y, r) => markAt(x, y, r, 2, 0.85)) // the delta plain is wetland
  }
  // then rain on the slopes: gullies and fans at a finer scale (not in the water, the towns or the fields)
  for (const l of lakes) for (const a of l.cells) mask[a] = 0
  for (const r of rivers) for (let i = 0; i < r.path.length; i += 3) stamp(r.path[i][0], r.path[i][1], r.wid[i] * 1.5 + 12, (a) => soft(a, 0))
  for (let a = 0; a < heights.length; a++) if (hard[a]) mask[a] = Math.min(mask[a], 0.3) // rain cuts gullies into cliffs only slowly
  if (strength > 0) erode(heights, N, cellM, mask, Math.round(N * N * 0.09 * strength), seed ^ 0xe40d, strength)
  if (T.sea != null) drySeaPuddles(grid, T.sea) // carving may have left hollows below the sea
  { // steep mountain ground: crests a little sharper, couloirs a little deeper (an unsharp mask of about 60 m)
    const blur = heights.slice(), tmp = new Float32Array(heights.length), R0 = 3
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { let s = 0, c = 0; for (let k = Math.max(0, i - R0); k <= Math.min(N, i + R0); k++) { s += blur[j * w1 + k]; c++ } tmp[j * w1 + i] = s / c }
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { let s = 0, c = 0; for (let k = Math.max(0, j - R0); k <= Math.min(N, j + R0); k++) { s += tmp[k * w1 + i]; c++ } blur[j * w1 + i] = s / c }
    }
    for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
      const a = j * w1 + i, sl = Math.hypot(heights[a + 1] - heights[a - 1], heights[a + w1] - heights[a - w1]) / (2 * cellM)
      const k = sstep(0.3, 0.7, sl) * mask[a] * (T.sea != null ? sstep(T.sea + 20, T.sea + 60, heights[a]) : 1)
      if (k > 0) heights[a] += clamp(0.8 * k * (heights[a] - blur[a]), -6, 6)
    }
  }
  { // no needles: a single vertex standing far above all its neighbours is noise, not a summit
    const lim = cellM * 1.2
    for (let pass = 0; pass < 2; pass++) for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
      const a = j * w1 + i, hi = Math.max(heights[a + 1], heights[a - 1], heights[a + w1], heights[a - w1])
      if (heights[a] > hi + lim) heights[a] = hi + lim
    }
  }
  // the living ground: lava flows from active vents, old lava fields, hot springs, geysers and marshes, marked in a
  // texture the terrain shader reads (R lava, G mineral crust, B wetland), with steam where the ground breathes
  const steam: number[] = [], pools: number[] = []
  const RL = rng(seed ^ 0x1a7a), raise = new Float32Array(heights.length)
  for (const f of doc.terrain) {
    if (f.kind === 'volcano' && f.at && f.height != null) {
      const r = f.radius ?? 4000, cr = f.crater ?? r * (f.caldera ? 0.3 : 0.07), flows = f.lava ?? (f.active ? 3 : 0)
      if (f.active) steam.push(f.at[0], H(...f.at) + 20, -f.at[1], Math.max(50, cr * 0.5), 1) // an ash and steam plume
      for (let k = 0; k < flows; k++) { // each flow breaches the rim and runs downhill, widening, until the ground flattens out
        const a = RL() * Math.PI * 2, L = r * (0.5 + RL() * 0.7)
        let x = f.at[0] + Math.cos(a) * cr * 1.1, y = f.at[1] + Math.sin(a) * cr * 1.1, dx = Math.cos(a), dy = Math.sin(a), wv = 10, flat = 0
        for (let s = 0; s < L; s += 8) {
          const gx = H(x + 6, y) - H(x - 6, y), gy = H(x, y + 6) - H(x, y - 6), gl = Math.hypot(gx, gy) || 1
          dx = dx * 0.7 - (gx / gl) * 0.3 + (RL() - 0.5) * 0.2; dy = dy * 0.7 - (gy / gl) * 0.3 + (RL() - 0.5) * 0.2
          const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl; x += dx * 8; y += dy * 8
          if (Math.abs(x) > size / 2 - 10 || Math.abs(y) > size / 2 - 10 || (T.sea != null && H(x, y) < T.sea)) break
          flat = gl / 12 < 0.025 ? flat + 8 : 0
          if (flat > 300) break
          wv = Math.min(wv + 0.3, 35 + L * 0.015)
          const tt = s / L
          markAt(x, y, wv, 0, f.active ? 1 - tt * 0.55 : 0.42)
          stamp(x, y, wv, (a2, d) => { raise[a2] = Math.max(raise[a2], (3 + 5 * tt) * (1 - (d / wv) ** 2)) })
        }
      }
    }
    if (f.kind === 'lavafield' && (f.area || f.at)) {
      const [x0, y0, x1, y1] = bboxOf(f), nz = simplex(seed ^ hash(f.id))
      stamp((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2, (a) => { const sd = areaDist(f, vx(a), vy(a)); if (sd < 0) raise[a] = Math.max(raise[a], 2 + 3 * Math.abs(fbm(nz, vx(a) / 60, 1, vy(a) / 60, 3)) * 2) })
      for (let y = y0; y < y1; y += 12) for (let x = x0; x < x1; x += 12) if (areaDist(f, x, y) < 0) markAt(x, y, 14, 0, f.active ? 0.9 : 0.42)
    }
    if (f.kind === 'springs' && (f.area || f.at)) { // travertine terraces: the slope steps down in pale rims, each holding a warm pool
      const st = f.step ?? 1.4, [x0, y0, x1, y1] = bboxOf(f)
      stamp((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + 20, (a) => { const sd = areaDist(f, vx(a), vy(a)); if (sd < 20) heights[a] = lerp(heights[a], Math.floor(heights[a] / st) * st, sstep(20, -5, sd)) })
      for (let y = y0; y < y1; y += 10) for (let x = x0; x < x1; x += 10) if (areaDist(f, x, y) < 10) markAt(x, y, 14, 1, 1)
      for (let k = 0; k < 6; k++) { const p: XY = [lerp(x0, x1, RL()), lerp(y0, y1, RL())]; if (areaDist(f, ...p) < 0) steam.push(p[0], H(...p) + 1, -p[1], 6 + RL() * 6, 0) }
      for (let j = Math.max(0, Math.floor((size / 2 - y1) / cellM)); j < Math.min(N, Math.ceil((size / 2 - y0) / cellM)); j++)
        for (let i = Math.max(0, Math.floor((x0 + size / 2) / cellM)); i < Math.min(N, Math.ceil((x1 + size / 2) / cellM)); i++) {
          const a = j * w1 + i, hs = [heights[a], heights[a + 1], heights[a + w1], heights[a + w1 + 1]], lv = Math.max(...hs)
          if (areaDist(f, vx(a) + cellM / 2, vy(a) - cellM / 2) < 0 && lv - Math.min(...hs) < 0.2) { const x = vx(a), z = -vy(a), L = lv + 0.3, X = x + cellM, Z = z + cellM; pools.push(x, L, z, x, L, Z, X, L, z, X, L, z, x, L, Z, X, L, Z) }
        }
    }
    if (f.kind === 'geyser' && f.at) { markAt(f.at[0], f.at[1], (f.radius ?? 30) * 2.2, 1, 0.8); steam.push(f.at[0], H(...f.at) + 1, -f.at[1], 10, 2) }
    if (f.kind === 'marsh' && (f.area || f.at)) { // a marsh: ground held at the water table, open pools among the reeds
      const [x0, y0, x1, y1] = bboxOf(f), nz = simplex(seed ^ hash(f.id))
      let low = Infinity
      stamp((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2, (a) => { if (areaDist(f, vx(a), vy(a)) < 0) low = Math.min(low, heights[a]) })
      const lv = low + 0.6, cells: number[] = []
      stamp((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + 40, (a) => { const sd = areaDist(f, vx(a), vy(a)); if (sd < 40) { heights[a] = lerp(heights[a], lv + 0.9 + fbm(nz, vx(a) / 50, 1, vy(a) / 50, 3) * 1.4, sstep(40, -20, sd)); if (sd < 0 && heights[a] < lv) cells.push(a) } })
      for (let y = y0; y < y1; y += 10) for (let x = x0; x < x1; x += 10) if (areaDist(f, x, y) < 10) markAt(x, y, 13, 2, 1)
      if (cells.length) lakes.push({ id: f.id, at: f.at ?? [(x0 + x1) / 2, (y0 + y1) / 2], r: Math.hypot(x1 - x0, y1 - y0) / 2, level: lv, cells: Int32Array.from(cells) })
    }
  }
  for (let a = 0; a < heights.length; a++) heights[a] += raise[a]
  lap('rivers', 'Laying out the roads')

  // wealth follows altitude between the lowest and highest town ground, and rises near great buildings
  let [wl, wh] = doc.wealth ?? [Infinity, -Infinity]
  if (!doc.wealth) {
    const hs: number[] = []
    for (const t of towns) { const R0 = rng(hash(t.id)); for (let k = 0; k < 500; k++) { const x = lerp(t.bbox[0], t.bbox[2], R0()), z = lerp(t.bbox[1], t.bbox[3], R0()); if (t.zone(x, z) <= 1) hs.push(Hw(x, z)) } }
    hs.sort((a, b) => a - b)
    wl = hs[Math.floor(hs.length * 0.08)] ?? 0; wh = hs[Math.floor(hs.length * 0.92)] ?? 1
  }
  const greats = doc.structures.filter((s) => GREAT.has(s.kind) && s.at).map((s) => s.at!)
  const wealthAt = (x: number, y: number, h: number) => clamp((h - wl) / (wh - wl || 1) + greats.reduce((m, g) => Math.max(m, 0.32 * (1 - sstep(80, 600, Math.hypot(x - g[0], y - g[1])))), 0))
  /** How far inside a river's banks a point is (metres; negative outside). */
  const riverHalf = (r: River, x: number, y: number) => { const n = pathNearFast(r.path, x, y, 400); return n.d === Infinity ? -400 : r.wid[Math.round(clamp(n.s / r.step, 0, r.wid.length - 1))] * 0.55 - n.d }
  const overRiver = (x: number, y: number) => rivers.some((r) => riverHalf(r, x, y) > -1)
  const wetR = (x: number, y: number, h = H(x, y)) => (T.sea != null && h < T.sea + 0.5) || (lakeId[vtx(x, y)] >= 0 && h < lakes[lakeId[vtx(x, y)]].level + 0.5) || rivers.some((r) => riverHalf(r, x, y) > -1.5)
  const structs: Structure[] = [...doc.structures]
  // a town on the sea gets a harbour where it meets the water, facing out, unless the recipe placed one
  const seaLvl = T.sea
  if (seaLvl != null) for (const t of towns) {
    if (structs.some((s) => s.kind === 'harbour' && s.at && t.zone(s.at[0], -s.at[1]) < 1.3)) continue
    let best: [number, number] | null = null, bd = Infinity
    for (let j = 0; j < t.gh; j += 2) for (let i = 0; i < t.gw; i += 2) {
      const x = t.gx + i * t.g, z = t.gz + j * t.g
      if (t.zone(x, z) > 1 || Hw(x, z) < seaLvl + 0.5 || Hw(x, z) > seaLvl + 8) continue // a harbour needs a low shore, not a cliff top
      const d = Math.hypot(x - t.core[0], z - t.core[1])
      if (d < bd && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => Hw(x + di * 40, z + dj * 40) < seaLvl - 1.5)) { bd = d; best = [x, z] }
    }
    if (!best) continue
    const [x, z] = best, gx = Hw(x + 8, z) - Hw(x - 8, z), gz = Hw(x, z + 8) - Hw(x, z - 8), fa = Math.atan2(-gx, gz) / DEG // downhill, toward the water
    structs.push({ id: `${t.id}~harbour`, kind: 'harbour', at: [x, -z], facing: (fa + 360) % 360, width: clamp(t.r * 0.22, 80, 200) })
  }

  // main roads: between town squares, great buildings, bridge ends and harbours, through the valleys
  let roads: Road[] = []
  const struct = (s: Structure) => s.at && footprint(s)
  const lakeOrSea = (x: number, y: number, h = H(x, y)) => (lakeId[vtx(x, y)] >= 0 && h < lakes[lakeId[vtx(x, y)]].level + 0.5) || (T.sea != null && h < T.sea + 0.5)
  const cores = doc.structures.flatMap((s) => { const fp = struct(s); return fp && s.kind !== 'plaza' && s.kind !== 'colonnade' && s.kind !== 'market' ? [{ at: W(s.at!), r: fp.r * 0.75 }] : [] })
  const icy = T.glaciers.flatMap((g) => resample(g.path, 60).map((p) => ({ at: W(p), r: g.w })))
  const blocked = (x: number, z: number) => Math.abs(x) > size / 2 - 20 || Math.abs(z) > size / 2 - 20 || lakeOrSea(x, -z) || cores.some((c) => Math.hypot(x - c.at[0], z - c.at[1]) < c.r) || icy.some((c) => Math.hypot(x - c.at[0], z - c.at[1]) < c.r)
  const squares = doc.structures.filter((s) => s.kind === 'market' && s.at)
  if (doc.roads !== false) {
    const hubs: { x: number; z: number }[] = [], hubAt = (p: XY) => { const [x, z] = W(p); const h = { x, z }; hubs.push(h); return h }
    for (const s of structs) {
      const fp = struct(s)
      if (s.kind === 'plaza' || s.kind === 'colonnade' || s.kind === 'market') hubAt(s.at!)
      else if (fp && s.kind !== 'statue' && s.kind !== 'tower') { const [fx, fy] = facingVec(s.facing); hubAt([s.at![0] + fx * (fp.r + 12), s.at![1] + fy * (fp.r + 12)]) }
      if (s.kind === 'harbour' && s.at) { const [fx, fy] = facingVec(s.facing); hubAt([s.at[0] - fx * 40, s.at[1] - fy * 40]) }
    }
    for (const t of towns) if (!squares.some((s) => Math.hypot(W(s.at!)[0] - t.core[0], W(s.at!)[1] - t.core[1]) < 60)) hubs.push({ x: t.core[0], z: t.core[1] })
    const links: [{ x: number; z: number }, { x: number; z: number }][] = [], force: typeof links = []
    for (const s of doc.structures) {
      if (s.kind === 'bridge' && s.at && s.to) { const [fx, fy] = [s.to[0] - s.at[0], s.to[1] - s.at[1]], l = Math.hypot(fx, fy) || 1; links.push([hubAt([s.at[0] - (fx / l) * 30, s.at[1] - (fy / l) * 30]), hubAt([s.to[0] + (fx / l) * 30, s.to[1] + (fy / l) * 30])]) }
      if (s.kind === 'road' && s.path) for (let i = 0; i < s.path.length - 1; i++) force.push([hubAt(s.path[i]), hubAt(s.path[i + 1])])
    }
    roads = planRoads({ grid, seed, hubs, links, force, blocked, districts: [] })
    // each town's own streets, from its tensor field, joined to the main roads
    const mainIdx = new RoadIndex(10, 12)
    roads.forEach((r, i) => mainIdx.add(r, i))
    for (const t of towns) {
      const d = doc.districts.find((q) => q.id === t.id)!
      const mains = roads.filter((r) => r.kind === 'main' && r.pts.some((p) => t.zone(p[0], p[2]) < 1.3))
      const onSq = (x: number, z: number) => squares.some((s) => { const fp = footprint(s)!, [sx, sz] = W(s.at!); return Math.hypot(x - sx, z - sz) < fp.r * 0.8 })
      const streets = townStreets({ town: t, H: Hw, mains, blocked: (x, z) => blocked(x, z) || wetR(x, -z) || onSq(x, z), near: (x, z) => mainIdx.near(x, z).d, wealth: (x, z, h) => d.wealth ?? wealthAt(x, -z, h), seed: seed ^ hash(t.id) ^ 0x57 })
      roads.push(...streets)
      if ((globalThis as { LOC_DEBUG?: boolean }).LOC_DEBUG) { let inC = 0; for (let k = 0; k < t.cost.length; k++) if (t.cost[k] <= 1) inC++; console.log(t.id, 'r', t.r, 'area', Math.round(Math.sqrt(inC * t.g * t.g / Math.PI)), 'plan', t.plan, 'mains', mains.length, 'streets', streets.length, streets.reduce((s, r) => s + r.pts.length * 4, 0), 'm', 'farm', t.farm.toFixed(2)) }
      if (d.walls) { // a wall round the old town, where the houses stand close
        const ring = simplify(zoneOutline(t, 0.72), 6)
        if (ring.length > 8) structs.push({ id: `${t.id}~walls`, kind: 'wall', path: [...ring, ring[0]], height: 12 })
      }
    }
    carve(grid, roads, (x, z) => overRiver(x, -z))
  }
  // canals: a flat bed between stone walls, quays either side (after the roads, which cross them on bridges)
  const canals = structs.filter((s) => s.kind === 'canal' && s.path && s.path.length > 1).map((s) => {
    const pts = resample(s.path!, 4), w = s.width ?? 12, level = s.level ?? Math.min(...pts.map((p) => H(...p))) - 1.2
    const best = new Float32Array(heights.length), target = new Float32Array(heights.length)
    for (const p of pts) stamp(p[0], p[1], w / 2 + 16, (a, d) => { const [wt, t] = d < w / 2 ? [1, level - 3] : d < w / 2 + 6 ? [1, level + 1.6] : [1 - sstep(w / 2 + 6, w / 2 + 16, d), level + 1.6]; if (wt > best[a] || (wt === best[a] && t < target[a])) { best[a] = wt; target[a] = t } })
    for (let a = 0; a < heights.length; a++) if (best[a] > 0) heights[a] += (target[a] - heights[a]) * best[a]
    return { s, pts, w, level }
  })
  lap('roads', 'Building the towns')
  const roadIdx = new RoadIndex(15, 30)
  roads.forEach((r, i) => roadIdx.add(r, i))
  let minH = Infinity, maxH = -Infinity
  for (const v of heights) { if (v < minH) minH = v; if (v > maxH) maxH = v }

  // ground that is already taken: roads, squares, great buildings, bridges, aqueducts, walls, canals
  const occ = new Occ()
  for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) { const [ax, , az] = r.pts[i], [bx, , bz] = r.pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l > 0.01) occ.mark((ax + bx) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az), r.width + 0.6, l + 0.5) }
  for (const f of T.flats) {
    const s = structs.find((q) => q.id === f.id), [x, z] = W(f.at)
    if (s?.kind === 'market') occ.mark(x, z, (90 - (s.facing ?? 0)) * DEG, (s.depth ?? 60) + 1, (s.width ?? 40) + 1)
    else occ.markCircle(x, z, f.r + 10)
  }
  for (const s of structs) {
    const path = s.kind === 'bridge' && s.at && s.to ? [s.at, s.to] : (s.kind === 'aqueduct' || s.kind === 'wall') ? s.path : null
    if (path) for (const p of resample(path, 6)) { const [x, z] = W(p); occ.markCircle(x, z, (s.width ?? (s.kind === 'bridge' ? 14 : 5)) / 2 + 6) }
    if (s.kind === 'harbour' && s.at) { const [x, z] = W(s.at); occ.markCircle(x, z, (s.width ?? 160) / 2 + 10) }
  }
  for (const c of canals) for (const p of c.pts) { const [x, z] = W(p); occ.markCircle(x, z, c.w / 2 + 5) }
  // houses also line the edges of each square, facing onto it
  const fronts: Road[] = squares.map((s) => {
    const [x, z] = W(s.at!), f = (s.facing ?? 0) * DEG, lx = Math.sin(f), lz = -Math.cos(f), hl = (s.depth ?? 60) / 2 + 0.5, hw = (s.width ?? 40) / 2 + 0.5
    const corner = (u: number, v: number): [number, number, number] => { const px = x + u * lx - v * lz, pz = z + u * lz + v * lx; return [px, Hw(px, pz), pz] }
    return { kind: 'lane', width: 0.2, wealth: 0.6, pts: [corner(-hl, -hw), corner(hl, -hw), corner(hl, hw), corner(-hl, hw), corner(-hl, -hw)] }
  })
  const out: Out = placeAll({
    H: Hw, wet: (x, z, h) => wetR(x, -z, h), occ, roads: [...fronts, ...roads], seed, max: 160000,
    districts: towns.map((t): DistrictIn => { const d = doc.districts.find((q) => q.id === t.id)!; return { culture: t.culture, inside: t.inside, zone: t.zone, bbox: t.bbox, density: clamp(d.density ?? 0.85, 0.05, 1), wealth: (x, z, h) => d.wealth ?? wealthAt(x, -z, h), steep: t.steep } }),
  })
  lap('buildings', 'Planting fields and forests')
  // gardens: trees in yards and back gardens, more toward the edge of town and for the rich; street trees on squares
  const gardenTrees: number[] = [], RG = rng(seed ^ 0x6a4d)
  const gardenTree = (cu: string, r: number) => cu === 'mediterranean' ? (r < 0.4 ? TREE.cypress : r < 0.7 ? TREE.olive : TREE.pine) : cu === 'eastern' ? (r < 0.4 ? TREE.cypress : r < 0.75 ? TREE.olive : TREE.orchard) : cu === 'mountain' ? (r < 0.6 ? TREE.spruce : TREE.orchard) : (r < 0.55 ? TREE.broadleaf : TREE.orchard)
  for (const t of towns) {
    const [x0, z0, x1, z1] = t.bbox, cu = t.culture === 'mixed' ? 'central' : t.culture
    for (let z = z0; z < z1; z += 7) for (let x = x0; x < x1; x += 7) {
      const px = x + (RG() - 0.5) * 6, pz = z + (RG() - 0.5) * 6, zn = t.zone(px, pz)
      if (zn > 1.12) continue
      const h = Hw(px, pz), w = wealthAt(px, -pz, h)
      if (RG() > (zn > 1 ? 0.3 : 0.05 + zn * 0.3 + w * 0.15) || wetR(px, -pz, h) || !occ.free(px, pz, 0, 4, 4)) continue
      const kind = gardenTree(cu, RG())
      gardenTrees.push(px, h - 0.3, pz, kind === TREE.broadleaf ? 0.55 + RG() * 0.35 : 0.6 + RG() * 0.4, kind, 0.8 + RG() * 0.35)
      occ.mark(px, pz, 0, 4, 4)
    }
  }
  for (const s of squares) { // a row of trees along one long side of each square
    const [x, z] = W(s.at!), f = (s.facing ?? 0) * DEG, lx = Math.sin(f), lz = -Math.cos(f), hl = (s.depth ?? 60) / 2, hw = (s.width ?? 40) / 2, cu = s.culture ?? 'central'
    for (let u = -hl + 4; u <= hl - 4; u += 7) { const px = x + u * lx - (hw - 2.5) * lz, pz = z + u * lz + (hw - 2.5) * lx; gardenTrees.push(px, Hw(px, pz), pz, 0.5, cu === 'mediterranean' ? TREE.pine : TREE.broadleaf, 0.9) }
  }

  // farmland: the recipe's own fields, and the fields every town works around itself; then pasture, then forest
  const farmTrees: number[] = [], RF = rng(seed ^ 0xfa53)
  const cultureNear = (x: number, y: number): Culture => { let best: Culture = doc.culture && doc.culture !== 'mixed' ? doc.culture : 'central', bd = Infinity; for (const t of towns) { const zn = t.zone(x, -y); if (zn < bd && t.culture !== 'mixed') { bd = zn; best = t.culture } } return best }
  const fieldsAt: FieldSrc[] = T.fields.map((f) => {
    const bb = bboxOf(f), crops = f.crop === 'mixed' || !f.crop ? CROPS_OF[cultureNear((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)] : f.crop === 'terraces' ? ['vines', 'olives', 'vines', 'meadow'] : [f.crop]
    return { id: f.id, inside: (x: number, y: number) => areaDist(f, x, y), bbox: bb, at: parcels(f.id, crops, f.step && f.crop !== 'terraces' && f.crop !== 'vines' ? f.step * 15 : 70, f.angle ?? hash(f.id) % 180, 1.5, seed) }
  })
  const slopeAt = (x: number, y: number) => Math.hypot(H(x + 6, y) - H(x - 6, y), H(x, y + 6) - H(x, y - 6)) / 12
  const treeLine0 = Math.min((doc.snowline ?? maxH - (maxH - minH) * 0.18) - 900, { temperate: 1900, alpine: 1800, mediterranean: 2300, arid: 3300, tropical: 3600, boreal: 900 }[doc.climate ?? 'temperate'])
  if (doc.farms !== false) for (const t of towns) {
    const d = doc.districts.find((q) => q.id === t.id)!
    if (d.farms === false) continue
    const cu = t.culture === 'mixed' ? 'central' : t.culture, crops = doc.climate === 'alpine' ? CROPS_OF.mountain : CROPS_OF[cu]
    const sq = squares.find((s) => Math.hypot(W(s.at!)[0] - t.core[0], W(s.at!)[1] - t.core[1]) < 80), ang = sq ? 90 - (sq.facing ?? 0) : hash(t.id) % 180
    const at = parcels(t.id + '~farms', crops, cu === 'mountain' ? 55 : 80, ang, cu === 'central' ? 2.4 : 1.4, seed)
    const steepOk = cu === 'mediterranean' || cu === 'eastern' ? 0.42 : 0.2
    // where the town's fields lie, worked out once on an 8 m grid (zone band, gentle enough, below the trees), then looked up
    const FG = 8, fx0 = t.gx, fy1 = -t.gz, fw = Math.ceil((t.gw * t.g) / FG) + 1, fh = Math.ceil((t.gh * t.g) / FG) + 1, fsd = new Float32Array(fw * fh)
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
      const x = fx0 + i * FG, y = fy1 - j * FG, zn = t.zone(x, -y)
      fsd[j * fw + i] = zn < 0.92 || towns.some((o) => o !== t && o.zone(x, -y) < 1.02) || zn > t.farm * 1.05 || Math.hypot(x - t.core[0], -y - t.core[1]) > t.r * 3 ? 20 : lerp(14, -14, sstep(0.95, 1.08, zn) * sstep(t.farm, t.farm * 0.9, zn) * sstep(steepOk, steepOk * 0.7, slopeAt(x, y)) * (H(x, y) < treeLine0 ? 1 : 0))
    }
    fieldsAt.push({ id: t.id + '~farms', bbox: [fx0, fy1 - (fh - 1) * FG, fx0 + (fw - 1) * FG, fy1], at, farm: true,
      inside: (x: number, y: number) => { const fi = (x - fx0) / FG, fj = (fy1 - y) / FG; if (fi < 0 || fj < 0 || fi >= fw - 1 || fj >= fh - 1) return 20; const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, ty = fj - j, k = j * fw + i; return (fsd[k] * (1 - tx) + fsd[k + 1] * tx) * (1 - ty) + (fsd[k + fw] * (1 - tx) + fsd[k + fw + 1] * tx) * ty } })
  }
  for (const { inside, at, bbox, farm } of fieldsAt) {
    const [x0, y0, x1, y1] = bbox, cu = cultureNear((x0 + x1) / 2, (y0 + y1) / 2), seen = new Set<number>()
    for (let y = y0; y < y1; y += 2.4) for (let x = x0; x < x1; x += 2.4) {
      if (Math.abs(x) > size / 2 - 2 || Math.abs(y) > size / 2 - 2 || inside(x, y) > (farm ? 6 : -6)) continue
      const q = at(x, y), crop = q.crop
      if (farm && inside(q.sx, q.sy) > -2) continue
      if (q.edge < 1.4) { // hedges and dry-stone walls along the field edges
        if (RF() >= (farm ? 0.08 : 0.25)) continue
        const [wx, wz] = W([x, y])
        if (!occ.free(wx, wz, 0, 1.5, 1.5) || wetR(x, y)) continue
        if (cu === 'central' || cu === 'eastern') farmTrees.push(wx, H(x, y) - 0.3, wz, 0.35 + RF() * 0.2, TREE.bush, 0.8 + RF() * 0.3)
        else out.parts.push(PART.drywall, wx, H(x, y) - 0.3, wz, q.edgeYaw, 0.7, 1.1, 3.1, 0.42, 0.4, 0.37, 0, 0, 0, 0, 0, 0)
        occ.mark(wx, wz, 0, 1.5, 1.5)
        continue
      }
      const vine = crop === 'vines' && Math.abs(q.v % 2.4) < 1.2 && Math.abs((q.u % 2.6) - 1.3) < 1.2, tree = (crop === 'orchard' || crop === 'olives') && Math.abs((q.u % 7) - 3.5) < 1.2 && Math.abs((q.v % 7) - 3.5) < 1.2
      const first = !seen.has(q.key)
      if (!vine && !tree && !first) continue
      const [wx, wz] = W([x, y])
      if (!occ.free(wx, wz, 0, 1.2, 1.2) || wetR(x, y)) continue
      const h = H(x, y)
      if (vine && RF() < 0.9) out.parts.push(PART.vine, wx, h, wz, q.rowYaw, 0.55, 1.25, 2.3, 0.2 + RF() * 0.06, 0.26 + RF() * 0.06, 0.1, 0, 0, 0, 0, 0, 0)
      if (tree) farmTrees.push(wx + (RF() - 0.5), h - 0.2, wz + (RF() - 0.5), 0.45 + RF() * 0.2, crop === 'olives' ? TREE.olive : TREE.orchard, 0.85 + RF() * 0.3)
      if (first) { seen.add(q.key); if (RF() < (farm ? 0.05 : 0.07) && q.edge > 14) farmstead(out, cu, wx, wz, q.rowYaw, Hw, occ, RF) } // now and then a farmstead
    }
  }
  // fields at their own resolution: a texture of crop colours (parcel edges darkened for hedges and balks), so the
  // patchwork stays crisp from the air instead of blurring into the coarser ground colours
  const FT = texN(size), ftC = size / FT, fieldTex = new Uint8Array(FT * FT * 4), edgeC = lin('#5e5a46')
  for (const fa of fieldsAt) {
    const [x0, y0, x1, y1] = fa.bbox
    for (let v = Math.max(0, Math.floor((size / 2 - y1) / ftC)); v < Math.min(FT, Math.ceil((size / 2 - y0) / ftC)); v++) for (let u = Math.max(0, Math.floor((x0 + size / 2) / ftC)); u < Math.min(FT, Math.ceil((x1 + size / 2) / ftC)); u++) {
      const x = -size / 2 + (u + 0.5) * ftC, y = size / 2 - (v + 0.5) * ftC, sd = fa.inside(x, y)
      if (sd >= 12) continue
      const k = (v * FT + u) * 4, q = fa.at(x, y)
      if (fa.farm && (fa.inside(q.sx, q.sy) > -2 || sd > 6)) continue // a town's fields are whole parcels: farmed or not
      const wgt = fa.farm ? 255 : Math.round(255 * sstep(5, -3, sd))
      if (wgt <= fieldTex[k + 3]) continue
      const c = q.edge < 1.4 ? mix(q.col, edgeC, 0.6) : q.col
      for (let i = 0; i < 3; i++) fieldTex[k + i] = Math.round(255 * clamp(c[i]) ** (1 / 2.2))
      fieldTex[k + 3] = wgt
    }
  }
  lap('fieldtex')
  const fieldAt = (x: number, y: number) => { const u = Math.floor((x + size / 2) / ftC), v = Math.floor((size / 2 - y) / ftC); return u < 0 || v < 0 || u >= FT || v >= FT ? -1 : (v * FT + u) * 4 }
  // ground colour and surface (ice, sand, farmland, scree), from rock, meadow, forest, snow, paving, fields
  const urban = new Float32Array(w1 * w1)
  for (let k = 0; k < out.parts.length; k += PSTRIDE) {
    if (out.parts[k] !== PART.wall) continue
    const i = Math.round((out.parts[k + 1] + size / 2) / cellM), j = Math.round((out.parts[k + 3] + size / 2) / cellM), r = Math.ceil((Math.max(out.parts[k + 5], out.parts[k + 7]) * 1.3) / cellM)
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = (j + dj) * w1 + i + di; if (i + di >= 0 && i + di <= N && j + dj >= 0 && j + dj <= N) urban[a] = Math.min(1, urban[a] + 0.4) }
  }
  for (const f of T.flats) stamp(f.at[0], f.at[1], f.r, (a) => { urban[a] = 1 })
  for (const r of roads) for (const [x, , z] of r.pts) stamp(x, -z, r.width, (a) => { urban[a] = Math.max(urban[a], 0.8) })
  for (const c of canals) for (const p of c.pts) stamp(p[0], p[1], c.w / 2 + 6, (a) => { urban[a] = 1 })
  const climate = doc.climate ?? 'temperate', nC = simplex(seed ^ 0xc010)
  // the snow line: the recipe's own, else where this climate keeps snow through the summer (never below the ground's top fifth)
  const snow = doc.snowline ?? Math.max(maxH - (maxH - minH) * 0.18, { temperate: 2700, alpine: 2400, mediterranean: 3200, arid: 4300, tropical: 4900, boreal: 1500 }[climate]), treeLine = Math.min(snow - 900, { temperate: 1900, alpine: 1800, mediterranean: 2300, arid: 3300, tropical: 3600, boreal: 900 }[climate])
  const NS = 40, nsN = Math.ceil(Math.max(size, 60000) / NS) + 2, nsCache = new Map<number, [number, number]>()
  const noiseAt = (x: number, y: number): [number, number] => { // low-frequency colour noise, sampled every 40 m
    const fx = x / NS, fy = y / NS, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j
    const at = (a: number, c: number) => { const k = a * nsN + c; let v = nsCache.get(k); if (!v) { const vv = fbm(nC, (a * NS) / 400, 0, (c * NS) / 400, 3); v = [vv, vv + fbm(nC, (a * NS) / 1500, 3, (c * NS) / 1500, 2)]; nsCache.set(k, v) } return v }
    const a = at(i, j), b2 = at(i + 1, j), c2 = at(i, j + 1), d2 = at(i + 1, j + 1)
    return [0, 1].map((q) => (a[q] * (1 - tx) + b2[q] * tx) * (1 - ty) + (c2[q] * (1 - tx) + d2[q] * tx) * ty) as [number, number]
  }
  const warm = climate === 'mediterranean' || climate === 'arid', arid = climate === 'arid', lush = climate === 'tropical'
  const C = {
    grass: lin(arid ? '#a89870' : lush ? '#4f7a36' : warm ? '#8a9050' : '#6f7f4a'), grass2: lin(arid ? '#bfae84' : lush ? '#5e8a3e' : warm ? '#a8a060' : '#8a9356'), meadow: lin(arid ? '#b8a878' : warm ? '#9a9a58' : '#7f9450'),
    forest: lin(lush ? '#2e4a24' : climate === 'boreal' ? '#2e3e2a' : warm ? '#4a5a30' : '#3b4f30'), rock: mix(lin(doc.rock ? rockHex(doc.rock, 'limestone') : '#97938b'), lin('#5a5650'), 0.4), scree: mix(lin(doc.rock ? rockHex(doc.rock, 'limestone') : '#97938b'), lin('#8a8478'), 0.4), alpine: lin(arid ? '#a89870' : '#8c9a5c'), snow: lin('#eef2f6'), ice: lin('#bcd8e4'), sand: lin(doc.rock === 'basalt' || doc.rock === 'slate' ? '#57524c' : doc.rock === 'redstone' || doc.rock === 'sandstone' ? '#cf9e74' : lush ? '#e4dcc0' : '#d8c8a0'),
    shore: lin('#a49c8c'), pave: lin('#8a8070'), pave2: lin('#a09684'), moraine: lin('#8e877c'), ash: lin('#4a4440'), ash2: lin('#5e5550'), mud: lin('#7a7060'), wetland: lin(lush ? '#4e6a32' : '#66703e'),
  }
  // land use: the land round each town is cleared for fields and meadows; forest holds the rest below the tree line
  const cleared = (x: number, y: number) => { let c = 0; for (const t of towns) { const zn = t.zone(x, -y); if (zn < t.farm * 1.45) c = Math.max(c, sstep(t.farm * 1.45, t.farm * 1.05, zn) * sstep(t.r * 3.4, t.r * 2.6, Math.hypot(x - t.core[0], -y - t.core[1]))) } return c }
  const forestP = (x: number, y: number, h: number, sl: number) => {
    const fo = noiseAt(x, y)[1], cl = cleared(x, y)
    let p = (doc.forest ?? 1) * (0.2 + 0.8 * sstep(-0.32, 0.12, fo)) * (1 - cl * 0.94) * (1 - sstep(treeLine - 100, treeLine + 150, h)) * (sl > 0.95 ? 0.15 : 1) * (1 - T.volcanic(x, y) * 0.8)
    if (arid) p *= 0.1
    if (lush) p = Math.max(p, 0.8 * (1 - cl) * (1 - sstep(treeLine - 100, treeLine + 150, h)))
    return p
  }
  /** Ice on a glacier: 1 inside, fading at the margin; -1 on the moraines beside it; and the ice's own colour here. */
  const iceC = lin('#a9bfca'), snowC = lin('#e8eef4'), debris = lin('#77736c')
  const glacierAt = (x: number, y: number): [number, Col] => {
    let m = 0, col: Col = iceC
    for (const g of T.glaciers) {
      const n = pathNearFast(g.path, x, y, g.w * 2.2)
      if (n.d === Infinity) continue
      const t = n.s / g.total, w = glacierWidth(g, t, x, y), q = n.d / w
      if (q < 1.35 && m <= 0) m = q < 1 ? 1 - sstep(0.86, 1, q) : -1
      if (q >= 1) continue
      // snow up in the basin, grey-blue ice below the snow line, rubble along the margins, medial moraines, a dirty snout
      const lat = (n.d * n.side) / w, stripe = t > 0.35 && (Math.abs(lat - 0.3) < 0.05 || Math.abs(lat + 0.38) < 0.04)
      col = mix(snowC, iceC, sstep(0.25, 0.45, t + fbm(nC, x / 250, 7, y / 250, 2) * 0.15))
      col = mix(col, debris, Math.max(sstep(0.72, 0.98, q) * sstep(0.3, 0.5, t), stripe ? 0.75 : 0, sstep(0.82, 1, t) * 0.7))
    }
    return [m, col]
  }
  const lakeShore = (a: number, h: number) => { const i = a % w1, j = Math.floor(a / w1); for (const [di, dj] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni > N || nj > N) continue; const id = lakeId[nj * w1 + ni]; if (id >= 0 && lakeId[a] < 0 && h - lakes[id].level < 4) return true } return false }
  const paint = (x: number, y: number, h: number, sl: number, u: number, sf: number[], a = -1): Col => {
    const [v] = noiseAt(x, y)
    let c = mix(C.grass, C.grass2, clamp(v + 0.5))
    c = mix(c, C.meadow, (towns.length ? cleared(x, y) : 0) * 0.6)
    if (h < treeLine && sl < 0.9) c = mix(c, C.forest, sstep(0.35, 0.7, forestP(x, y, h, sl)) * 0.75)
    { const k = fieldAt(x, y); if (k >= 0 && fieldTex[k + 3]) { const wv = fieldTex[k + 3] / 255; c = mix(c, [0, 1, 2].map((i) => (fieldTex[k + i] / 255) ** 2.2) as Col, wv * 0.92); sf[2] = wv } }
    const vo = T.volcanic(x, y)
    if (vo > 0) c = mix(c, mix(C.ash, C.ash2, clamp(v + 0.5)), vo * sstep(-0.2, 0.3, v + vo * 0.5) * 0.9)
    c = mix(c, C.alpine, sstep(treeLine - 150, treeLine + 250, h) * (1 - sstep(snow - 300, snow, h)) * 0.7) // alpine meadows above the trees
    c = mix(c, C.rock, sstep(0.7, 1.05, sl) * 0.92) // grass holds on to about 40 degrees, then bare rock
    const scree = sstep(snow - 500, snow - 100, h) * sstep(0.35, 0.7, sl) + sstep(0.45, 0.75, sl) * (1 - sstep(0.75, 1.1, sl)) * 0.6 * sstep(treeLine - 600, treeLine, h) // talus up high; lower slopes stay green
    c = mix(c, C.scree, Math.min(1, scree) * 0.6); sf[3] = Math.min(1, scree + sstep(0.7, 1.1, sl))
    const sn = sstep(snow - 60, snow + 120, h + v * 120) * (1 - sstep(0.9, 1.3, sl))
    c = mix(c, C.snow, sn)
    const [gw, gc] = glacierAt(x, y)
    if (gw > 0) { c = mix(c, gc, gw); sf[0] = gw } else if (gw < 0) c = mix(c, C.moraine, 0.7)
    if (a >= 0 && lakeShore(a, h)) c = mix(c, C.shore, 0.6)
    { const u2 = Math.floor((x + size / 2) / mtC), v2 = Math.floor((size / 2 - y) / mtC), k = (v2 * MT + u2) * 4 // the living ground's own colours
      if (u2 >= 0 && v2 >= 0 && u2 < MT && v2 < MT) { const wet = marks[k + 2] / 255, lava = marks[k] / 255, crust = marks[k + 1] / 255; if (wet > 0.05) { c = mix(c, C.wetland, wet * 0.85); sf[1] = 0 } if (lava > 0.05) c = mix(c, C.ash, Math.min(1, lava * 2)); if (crust > 0.05) c = mix(c, lin('#e2d8c4'), crust * 0.8); if (wet > 0.3) return mix(c, mix(C.pave, C.pave2, clamp(v + 0.5)), u * 0.85) } }
    if (T.sea != null) {
      const be = Math.max(T.beach(x, y), h < T.sea + 3.5 && h > T.sea - 6 && sl < 0.25 ? sstep(T.sea + 3.5, T.sea + 0.5, h) : 0) * (1 - sstep(T.sea + 6, T.sea + 12, h))
      if (be > 0) { c = mix(c, C.sand, be); sf[1] = be }
      if (h < T.sea + 0.8 && h > T.sea - 1.5 && be < 0.5 && sl < 0.08) c = mix(c, C.mud, 0.6) // tidal flats
    }
    return mix(c, mix(C.pave, C.pave2, clamp(v + 0.5)), u * 0.85)
  }
  const to8 = (c: Col, o: Uint8Array, k: number, ao = 1) => { for (let q = 0; q < 3; q++) o[k + q] = Math.round(255 * clamp(c[q] * ao) ** (1 / 2.2)) }
  // ambient occlusion: how much of the sky each point sees (horizon in eight directions), so valleys, gullies and the feet
  // of cliffs sit in shade the way they do on a real day
  lap('urban')
  const ao = new Float32Array(w1 * w1), STEPS = [1, 2, 3, 5, 8, 13, 21, 34], DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]]
  const oi = new Int32Array(64), oj = new Int32Array(64), inv = new Float64Array(64)
  DIRS.forEach(([di, dj], k) => STEPS.forEach((s, q) => { oi[k * 8 + q] = Math.round(di * s); oj[k * 8 + q] = Math.round(dj * s); inv[k * 8 + q] = 1 / (s * cellM) }))
  for (let j = 0; j <= N; j += 2) for (let i = 0; i <= N; i += 2) { // every other vertex; the rest are interpolated
    const a = j * w1 + i, h0 = heights[a]
    let occ = 0
    for (let k = 0; k < 64; k += 8) {
      let m = 0
      for (let q = k; q < k + 8; q++) { const ii = i + oi[q], jj = j + oj[q]; if (ii < 0 || jj < 0 || ii > N || jj > N) break; const v = (heights[jj * w1 + ii] - h0) * inv[q]; if (v > m) m = v }
      occ += m / Math.sqrt(1 + m * m)
    }
    ao[a] = 1 - (occ / 8) * 0.9
  }
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    if (!(i & 1) && !(j & 1)) continue
    const i0 = i & ~1, j0 = j & ~1, i1 = Math.min(N, i0 + 2), j1 = Math.min(N, j0 + 2), tx = (i - i0) / 2, ty = (j - j0) / 2
    ao[j * w1 + i] = (ao[j0 * w1 + i0] * (1 - tx) + ao[j0 * w1 + i1] * tx) * (1 - ty) + (ao[j1 * w1 + i0] * (1 - tx) + ao[j1 * w1 + i1] * tx) * ty
  }
  lap('ao')
  const colors = new Uint8Array(w1 * w1 * 3), surf = new Uint8Array(w1 * w1 * 4), sf = [0, 0, 0, 0]
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const a = j * w1 + i, hx = (heights[j * w1 + Math.min(N, i + 1)] - heights[j * w1 + Math.max(0, i - 1)]) / (2 * cellM), hy = (heights[Math.min(N, j + 1) * w1 + i] - heights[Math.max(0, j - 1) * w1 + i]) / (2 * cellM)
    sf.fill(0)
    to8(paint(-size / 2 + i * cellM, size / 2 - j * cellM, heights[a], Math.hypot(hx, hy), urban[a], sf, a), colors, a * 3, 0.45 + 0.55 * ao[a])
    for (let q = 0; q < 4; q++) surf[a * 4 + q] = Math.round(sf[q] * 255)
  }
  lap('colours')
  // forests by altitude and climate, river woods, cypress avenues; rocks and scree under cliffs
  const trees: number[] = [...farmTrees, ...gardenTrees], rocks: number[] = [], RT = rng(seed ^ 0x7ee5), dens = doc.forest ?? 1
  const pickTree = (h: number, wet: boolean, R: () => number) => {
    if (h > treeLine - 300) return R() < 0.55 ? TREE.larch : TREE.spruce
    if (climate === 'boreal' || h > treeLine - 900) return R() < 0.7 ? TREE.spruce : warm ? TREE.pine : climate === 'boreal' ? TREE.larch : TREE.broadleaf
    if (lush) return R() < 0.25 ? TREE.palm : TREE.broadleaf
    if (wet) return TREE.broadleaf
    if (warm) { const r = R(); return r < 0.45 ? TREE.pine : r < 0.7 ? TREE.olive : r < 0.85 ? TREE.cypress : TREE.broadleaf }
    if (climate === 'alpine') return R() < 0.6 ? TREE.spruce : TREE.broadleaf
    return R() < 0.75 ? TREE.broadleaf : TREE.spruce
  }
  for (let y = -size / 2 + 6; y < size / 2 && trees.length / TSTRIDE < 260000; y += 10) for (let x = -size / 2 + 6; x < size / 2; x += 10) {
    const px = x + (RT() - 0.5) * 9, py = y + (RT() - 0.5) * 9, i = Math.round((px + size / 2) / cellM), j = Math.round((size / 2 - py) / cellM), a = j * w1 + i
    if (urban[a] > 0.2 || surf[a * 4] > 40 || surf[a * 4 + 2] > 60 || surf[a * 4 + 1] > 60) continue
    const h = H(px, py), sl = Math.hypot(H(px + 4, py) - H(px - 4, py), H(px, py + 4) - H(px, py - 4)) / 8
    if (sl > 0.75 || h > snow - 120) { if (RT() < (sl > 0.75 ? 0.06 : 0.03)) rocks.push(px, h - 0.5, -py, 0.8 + RT() * RT() * 6, RT() * 6.28); continue }
    if (sl > 0.5 && RT() < 0.03) rocks.push(px, h - 0.4, -py, 0.6 + RT() * 2.5, RT() * 6.28) // boulders shed from the cliffs above
    if (wetR(px, py, h)) continue
    const nearRiver = rivers.some((r) => riverHalf(r, px, py) > -r.width * 2.5)
    const p = nearRiver ? 0.75 : forestP(px, py, h, sl)
    if (RT() > p) { if (RT() < 0.006 * dens && h < treeLine) trees.push(px, h - 0.3, -py, 0.7 + RT() * 0.6, pickTree(h, nearRiver, RT), 0.8 + RT() * 0.4); continue } // lone trees in the meadows
    const [wx, wz] = W([px, py])
    if (!occ.free(wx, wz, 0, 3, 3)) continue
    trees.push(px, h - 0.3, -py, 0.75 + RT() * 0.6, pickTree(h, nearRiver, RT), 0.75 + RT() * 0.5)
  }
  for (const r of T.rocks) if (r.kind === 'tower' || (r.kind === 'stack' && r.green && r.r > 12)) { // trees clinging to the tops of karst towers and big stacks
    const n = r.kind === 'tower' ? 4 + Math.floor(r.r / 6) : 2
    for (let k = 0; k < n; k++) { const a = RT() * Math.PI * 2, d = RT() * r.r * (r.kind === 'tower' ? 0.35 : 0.5); trees.push(r.at[0] + Math.cos(a) * d, r.top - 0.5, -(r.at[1] + Math.sin(a) * d), 0.4 + RT() * 0.4, lush ? TREE.broadleaf : TREE.pine, 0.8 + RT() * 0.3) }
  }
  if (warm || doc.districts.some((d) => d.culture === 'mediterranean')) for (const r of roads) { // cypress avenues along main roads near Mediterranean towns
    if (r.kind !== 'main') continue
    for (let i = 3; i < r.pts.length - 3; i += 3) {
      const [ax, ay, az] = r.pts[i], [bx, , bz] = r.pts[i + 1], l = Math.hypot(bx - ax, bz - az) || 1
      if (cultureNear(ax, -az) !== 'mediterranean' && !warm) continue
      for (const sd of [-1, 1]) { const ox = (-(bz - az) / l) * (r.width / 2 + 2.5) * sd, oz = ((bx - ax) / l) * (r.width / 2 + 2.5) * sd; if (occ.free(ax + ox, az + oz, 0, 1.5, 1.5) && !wetR(ax + ox, -(az + oz))) trees.push(ax + ox, ay - 0.3, az + oz, 0.8 + RT() * 0.3, TREE.cypress, 0.85 + RT() * 0.2) }
    }
  }
  lap('trees')
  // the land beyond: a fringe a few kilometres wide where the ranges run on and settle down to lowland (the sea stays
  // sea); past it the renderer carries the rim out flat into the haze. The scene is the place, not a sample of a continent.
  const margin = clamp(size * 0.35, 2500, 9000), os = size + margin * 2, on = 256, oc = os / on, oh = new Float32Array((on + 1) * (on + 1)), ocol = new Uint8Array((on + 1) * (on + 1) * 3)
  // inside the map the backdrop must stay under the real ground: each of its points sits below the lowest ground within
  // one and a half of its cells, so no coarse triangle can poke up through a hollow
  const lowAround = (x: number, y: number) => {
    const r = Math.ceil((oc * 1.5) / cellM), ci = Math.round((x + size / 2) / cellM), cj = Math.round((size / 2 - y) / cellM)
    let m = Infinity
    for (let j = Math.max(0, cj - r); j <= Math.min(N, cj + r); j += 2) for (let i = Math.max(0, ci - r); i <= Math.min(N, ci + r); i += 2) m = Math.min(m, heights[j * w1 + i])
    return m - 10
  }
  let edgeLo = Infinity
  for (let k = 0; k <= N; k++) for (const a of [k, N * w1 + k, k * w1, k * w1 + N]) if (T.sea == null || heights[a] > T.sea) edgeLo = Math.min(edgeLo, heights[a])
  const rimLow = T.sea != null ? T.sea + 12 : (Number.isFinite(edgeLo) ? edgeLo : minH) - 15
  for (let j = 0; j <= on; j++) for (let i = 0; i <= on; i++) {
    const x = -os / 2 + i * oc, y = os / 2 - j * oc, inside = Math.abs(x) < size / 2 - oc && Math.abs(y) < size / 2 - oc
    const g = T.h(x, y), t = sstep(margin * 0.1, margin * 0.95, Math.max(Math.abs(x), Math.abs(y)) - size / 2)
    oh[j * (on + 1) + i] = inside ? Math.min(g, lowAround(x, y)) - 30 : T.sea != null && g < T.sea ? g : lerp(g, Math.min(g, rimLow), t)
  }
  for (let j = 0; j <= on; j++) for (let i = 0; i <= on; i++) {
    const a = j * (on + 1) + i, hx = (oh[j * (on + 1) + Math.min(on, i + 1)] - oh[j * (on + 1) + Math.max(0, i - 1)]) / (2 * oc), hy = (oh[Math.min(on, j + 1) * (on + 1) + i] - oh[Math.max(0, j - 1) * (on + 1) + i]) / (2 * oc)
    to8(paint(-os / 2 + i * oc, os / 2 - j * oc, oh[a], Math.hypot(hx, hy), 0, [0, 0, 0, 0]), ocol, a * 3)
  }
  lap('outer', 'Raising the great buildings')
  // structures, then roads and canals drawn on the ground
  const b = new Builder(), gW = (x: number, z: number) => Hw(x, z), cliffMask = new Uint8Array(w1 * w1)
  for (const st of structs) structure(b, st, T, gW, seed, roads, lakes, (x, z) => wetR(x, -z))
  if (!vol) { // rock faces sit on the triangles as drawn; the grid's own steep face is sunk a little behind them
    const Htri = (x: number, y: number) => {
      const fx = clamp((x + size / 2) / cellM, 0, N - 1e-6), fz = clamp((size / 2 - y) / cellM, 0, N - 1e-6), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, a = j * w1 + i
      const ha = heights[a], hb2 = heights[a + 1], hc = heights[a + w1], hd = heights[a + w1 + 1]
      return tx + tz <= 1 ? ha + (hb2 - ha) * tx + (hc - ha) * tz : hd + (hc - hd) * (1 - tx) + (hb2 - hd) * (1 - tz)
    }
    const sinks: [number, number, number, number, number][] = []
    rockWalls(b, T.walls, Htri, T.sea, size / 2, seed, (x, y, r, bot, top) => sinks.push([x, y, r, bot, top]))
    for (const [x, y, r, bot, top] of sinks) stamp(x, y, r + cellM * 2, (a, d) => { cliffMask[a] = 1; if (d < r && heights[a] > Math.max(bot + 0.5, (T.sea ?? -1e9) + 4.5) && heights[a] < top - 2.5) heights[a] -= 3.5 })
  }
  rockForms(b, vol ? T.rocks.filter((r) => r.kind === 'hoodoo' || r.kind === 'columns') : T.rocks, seed) // the volume carves stacks, spires and arches itself
  for (const f of doc.terrain) if (f.kind === 'springs' && (f.area || f.at)) springPools(b, (x, y) => areaDist(f, x, y), bboxOf(f), H, seed ^ hash(f.id))
  const lamps: number[] = [...b.lamps]
  drawRoads(b, roads, lamps, Hw, (x, z) => overRiver(x, -z))
  riverBridges(b, roads, overRiver, gW, seed)
  const wp: number[] = []
  for (const c of canals) drawCanal(b, c, roads, gW, wp, lamps)
  const typed = (t: Builder['geo']) => { const o = {} as CityBuilt['geo']; for (const m of MATS) { const g = t[m]; o[m] = { pos: new Float32Array(g.pos), nor: new Float32Array(g.nor), col: new Float32Array(g.col) } } return o }
  const geo = typed(b.geo), detail = b.tiers.slice(1).map(typed)
  lap('structures', 'Filling the lakes and rivers')
  // lake surfaces: every grid cell touching a flooded vertex whose lowest corner is under the water
  for (const l of lakes) {
    const cellLo = (i: number, j: number) => Math.min(heights[j * w1 + i], heights[j * w1 + i + 1], heights[(j + 1) * w1 + i], heights[(j + 1) * w1 + i + 1]), done = new Set<number>()
    for (const v of l.cells) {
      const vi = v % w1, vj = Math.floor(v / w1)
      for (const [i, j] of [[vi - 1, vj - 1], [vi, vj - 1], [vi - 1, vj], [vi, vj]]) {
        if (i < 0 || j < 0 || i >= N || j >= N || done.has(j * w1 + i) || cellLo(i, j) >= l.level) continue
        done.add(j * w1 + i)
        const x = -size / 2 + i * cellM, z = -size / 2 + j * cellM, L = l.level, X = x + cellM, Z = z + cellM
        wp.push(x, L, z, x, L, Z, X, L, z, X, L, z, x, L, Z, X, L, Z)
      }
    }
  }
  for (const v of pools) wp.push(v)
  // rivers: a ribbon on the water surface (v runs downstream for the flow), widening downstream; falls where it drops
  const rp: number[] = [], ruv: number[] = [], falls: number[] = []
  for (const rv of rivers) {
    const pts = resample(rv.path, 5).map((p, i) => { const k = clamp((i * 5) / rv.step, 0, rv.prof.length - 1.001), q = Math.floor(k); return [p[0], lerp(rv.prof[q], rv.prof[q + 1], k - q) + 0.3, -p[1], lerp(rv.wid[q], rv.wid[q + 1], k - q)] })
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, az, aw] = pts[i], [bx, by, bz, bw] = pts[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l
      const A = aw * 0.58, B = bw * 0.58
      if ((T.sea != null && ay < T.sea + 0.32 && by < T.sea + 0.32) || lakeAt(ax, -az) != null) continue // the sea or a lake takes over
      rp.push(ax - nx * A, ay, az - nz * A, ax + nx * A, ay, az + nz * A, bx - nx * B, by, bz - nz * B, bx - nx * B, by, bz - nz * B, ax + nx * A, ay, az + nz * A, bx + nx * B, by, bz + nz * B)
      const va = i * 5, vb = va + 5
      ruv.push(0, va, 1, va, 0, vb, 0, vb, 1, va, 1, vb)
      if ((ay - by) / l > 0.8 && (i === pts.length - 2 || (pts[i + 1][1] - pts[i + 2][1]) / 5 < 0.8)) falls.push(bx, by, bz, bw)
    }
  }
  const levels = [...new Set([...lakes.map((l) => l.level), ...canals.map((c) => c.level), ...(T.sea != null ? [T.sea] : [])])]
  lap('water')
  const houses: number[] = []
  for (let k = 0; k < out.parts.length; k += PSTRIDE) if (out.parts[k] === PART.wall && out.parts[k + 12] < 50) houses.push(out.parts[k + 1], out.parts[k + 3], out.parts[k + 5], out.parts[k + 7])
  let volume: CityBuilt['volume']
  if (vol) { // the rock under each vertex: the place's own, and near each cliff that cliff's
    const rockMap = new Uint8Array(w1 * w1 * 3), put = (a: number, hex: string) => { const cc = mix(lin(hex), lin('#5a5650'), 0.18); for (let q = 0; q < 3; q++) rockMap[a * 3 + q] = Math.round(255 * clamp(cc[q]) ** (1 / 2.2)) }
    const base = doc.rock ? rockHex(doc.rock, 'limestone') : climate === 'alpine' || climate === 'boreal' ? ROCKS.granite : ROCKS.limestone
    for (let a = 0; a < w1 * w1; a++) put(a, base)
    for (const wl of T.walls) for (const p of resample(wl.pts, 8)) stamp(p[0], p[1], wl.face + 40, (a) => put(a, wl.rock))
    volume = { rocks: T.rocks, rockMap, seed }
  }
  const auditLines = audit({ N, size, heights, sea: T.sea, rivers, lakes, towns, roads: [...roads, ...fronts], glaciers: T.glaciers, walls: T.walls, houses, volume: vol })
  lap('audit')
  const parts = new Float32Array(out.parts)
  return {
    size, N, heights, colors, surf, minH, maxH, sea: T.sea, outer: { size: os, n: on, heights: oh, colors: ocol }, fields: { n: FT, tex: fieldTex }, cliffMask, marks: { n: MT, tex: marks }, steam: new Float32Array(steam), snowline: snow,
    parts, chimneys: new Float32Array(out.chimneys), trees: new Float32Array(trees), rocks: new Float32Array(rocks), lamps: new Float32Array(lamps),
    geo, detail, volume, water: new Float32Array(wp), rivers: { pos: new Float32Array(rp), uv: new Float32Array(ruv) }, falls: new Float32Array(falls), waterLevels: levels,
    counts: { buildings: out.count, structures: structs.length, roads: roads.length, trees: trees.length / TSTRIDE }, ms: Date.now() - t0, stages, audit: auditLines,
  }
}

/** Road surfaces with kerbs, real steps on stairs, street lamps along main roads and streets, and on slopes the stone
 * retaining walls (uphill) and parapets (downhill) that terraced towns are made of. */
function drawRoads(b: Builder, roads: Road[], lamps: number[], ground: (x: number, z: number) => number, over: (x: number, z: number) => boolean) {
  b.frame(0, 0, 0, 0)
  const kerb = lin('#8e877a'), Y: V = [0, 1, 0], wallC = lin('#9a9284'), capC = lin('#b0a898')
  for (const r of roads) {
    const p = r.pts, half = r.width / 2
    const col = r.kind === 'main' ? lin('#aaa294') : r.kind === 'stairs' ? lin('#b0a898') : r.kind === 'street' ? mix(lin('#a29a8a'), lin('#b8b0a0'), r.wealth) : mix(lin('#9c8e78'), lin('#b2aa9a'), r.wealth)
    if (r.kind === 'stairs') {
      for (let i = 0; i < p.length - 1; i++) {
        const [ax, ay, az] = p[i], [bx, by, bz] = p[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * half, nz = (dx / l) * half
        const steps = Math.max(1, Math.round(Math.abs(ay - by) / 0.3)), hi = Math.max(ay, by), lo = Math.min(ay, by), down = ay > by
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps, y = (down ? hi - (hi - lo) * t0 : lo + (hi - lo) * t1) + 0.15
          const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1
          b.face('road', [[x0 - nx, y, z0 - nz], [x0 + nx, y, z0 + nz], [x1 + nx, y, z1 + nz], [x1 - nx, y, z1 - nz]], col, [x0, y - 1, z0])
          const yr = down ? y - (hi - lo) / steps : y, xe = down ? x1 : x0, ze = down ? z1 : z0
          b.face('road', [[xe - nx, yr, ze - nz], [xe + nx, yr, ze + nz], [xe + nx, y, ze + nz], [xe - nx, y, ze - nz]], mix(col, [0, 0, 0], 0.25), [xe - (down ? dx : -dx) / l, y - 0.1, ze - (down ? dz : -dz) / l])
        }
        for (const sd of [-1, 1]) b.beam('stone', [ax + nx * sd * 1.08, ay + 0.5, az + nz * sd * 1.08], [bx + nx * sd * 1.08, by + 0.5, bz + nz * sd * 1.08], 0.35, 1.2, Y, wallC, true) // side walls
      }
      continue
    }
    const lift = r.kind === 'main' ? 0.3 : 0.22, kerbs = r.kind === 'main' || r.kind === 'street'
    let ka = 0
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay, az] = p[i], [bx, by, bz] = p[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * half, nz = (dx / l) * half
      b.face('road', [[ax - nx, ay + lift, az - nz], [ax + nx, ay + lift, az + nz], [bx + nx, by + lift, bz + nz], [bx - nx, by + lift, bz - nz]], col, [ax, ay - 5, az])
      if (kerbs && (i - ka >= 3 || i === p.length - 2)) { // kerbs in longer pieces
        const [kx, ky, kz] = p[ka], kl = Math.hypot(bx - kx, bz - kz) || 1, mx = (-(bz - kz) / kl) * half, mz = ((bx - kx) / kl) * half
        for (const s of [-1, 1]) b.beam('road', [kx + mx * s, ky + lift + 0.1, kz + mz * s], [bx + mx * s, by + lift + 0.1, bz + mz * s], 0.35, 0.4, Y, kerb, true)
        ka = i + 1
      }
      // terraces: where the ground beside the street falls away, a parapet wall on the edge; where it rises, a retaining wall
      if (over(ax, az)) continue
      const ux = nx / half, uz = nz / half
      for (const sd of [-1, 1]) {
        const ex = ax + ux * sd * (half + 0.3), ez = az + uz * sd * (half + 0.3), fx = bx + ux * sd * (half + 0.3), fz = bz + uz * sd * (half + 0.3)
        const ga = ground(ax + ux * sd * (half + 3), az + uz * sd * (half + 3)), gb = ground(bx + ux * sd * (half + 3), bz + uz * sd * (half + 3))
        const ya = ay + lift, yb = by + lift
        if (ga < ya - 1.6 && gb < yb - 1.6) { // downhill: a wall from below the ground up to a parapet
          b.face('stone', [[ex, ga - 0.5, ez], [fx, gb - 0.5, fz], [fx, yb + 0.9, fz], [ex, ya + 0.9, ez]], wallC, [ax - ux * sd, (ya + ga) / 2, az - uz * sd])
          b.beam('stone', [ex - ux * sd * 0.2, ya + 0.9, ez - uz * sd * 0.2], [fx - ux * sd * 0.2, yb + 0.9, fz - uz * sd * 0.2], 0.45, 0.15, Y, capC, true)
        } else if (ga > ya + 1.8 && gb > yb + 1.8) { // uphill: the hillside held back by a retaining wall
          const ta = ground(ax + ux * sd * (half + 1.2), az + uz * sd * (half + 1.2)), tb = ground(bx + ux * sd * (half + 1.2), bz + uz * sd * (half + 1.2))
          b.face('stone', [[ex, ya - 0.2, ez], [fx, yb - 0.2, fz], [fx, Math.max(yb + 1, tb) + 0.3, fz], [ex, Math.max(ya + 1, ta) + 0.3, ez]], wallC, [ax, ya + 1, az])
        }
      }
    }
    const every = r.kind === 'main' || r.kind === 'street' ? 32 : r.wealth > 0.45 ? 48 : 0
    if (every) for (let i = 2, side = 1; i < p.length - 1; i += Math.round(every / 4), side = -side) {
      const [ax, ay, az] = p[i], [bx, , bz] = p[i + 1], l = Math.hypot(bx - ax, bz - az) || 1, ox = (-(bz - az) / l) * (half + 0.6) * side, oz = ((bx - ax) / l) * (half + 0.6) * side
      b.cyl('metal', ax + ox, ay, az + oz, 0.1, 0.07, 4.2, 6, lin('#2a2a2c'), false)
      lamps.push(ax + ox, ay + 4.4, az + oz)
    }
  }
}

/** A stone bridge wherever a road runs over a river: from the last dry point before to the first after. */
function riverBridges(b: Builder, roads: Road[], over: (x: number, y: number) => boolean, gW: (x: number, z: number) => number, seed: number) {
  const stone = lin('#b8ae9a')
  roads.forEach((r, ri) => {
    if (r.kind === 'stairs') return
    const p = r.pts
    for (let i = 1; i < p.length - 1; i++) {
      if (!over(p[i][0], -p[i][2])) continue
      let j = i
      while (j < p.length - 1 && over(p[j][0], -p[j][2])) j++
      const a = p[Math.max(0, i - 2)], c = p[Math.min(p.length - 1, j + 1)], len = Math.hypot(c[0] - a[0], c[2] - a[2])
      if (len > 4) {
        const deck = Math.max(a[1], c[1]) + 0.6, spans = Math.max(1, Math.round(len / 28))
        arcade(b, a[0], a[2], deck, c[0], c[2], deck, gW, { width: r.width + 1.6, span: len / spans, deckT: 1.6, col: stone, seed: seed + ri * 31 + i, statues: r.kind === 'main' && len > 50, style: r.kind === 'main' && len > 50 ? 'roman' : 'plain', wet: (x, z) => over(x, -z), hump: Math.min(3, len * 0.04) })
      }
      i = j
    }
  })
}

/** A canal: stone walls from the bed to the quays with copings, the still water, bridges wherever a road crosses, lamps. */
function drawCanal(b: Builder, c: { s: Structure; pts: XY[]; w: number; level: number }, roads: Road[], gW: (x: number, z: number) => number, wp: number[], lamps: number[]) {
  const stone = c.s.color ? lin(c.s.color) : lin('#b4aa96'), cope = mix(stone, [1, 1, 1], 0.15), quay = c.level + 1.6, bed = c.level - 3
  const P = c.pts.map((p) => W(p))
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, hw = c.w / 2
    b.frame(0, 0, 0, 0)
    for (const sd of [-1, 1]) {
      const cs: V[] = []
      for (let k = 0; k < 8; k++) { const e = k & 1 ? [bx, bz] : [ax, az], o = hw + (k & 4 ? 0.9 : 0); cs.push([e[0] + nx * o * sd, k & 2 ? quay : bed, e[1] + nz * o * sd]) }
      b.hexa('stone', cs, stone)
      b.beam('stone', [ax + nx * (hw + 0.45) * sd, quay + 0.15, az + nz * (hw + 0.45) * sd], [bx + nx * (hw + 0.45) * sd, quay + 0.15, bz + nz * (hw + 0.45) * sd], 1.1, 0.3, [0, 1, 0], cope, true)
    }
    const A = hw + 0.1, L = c.level
    wp.push(ax - nx * A, L, az - nz * A, bx - nx * A, L, bz - nz * A, ax + nx * A, L, az + nz * A, ax + nx * A, L, az + nz * A, bx - nx * A, L, bz - nz * A, bx + nx * A, L, bz + nz * A)
    if (i % 9 === 4) for (const sd of [-1, 1]) { const lx = ax + nx * (hw + 2.5) * sd, lz = az + nz * (hw + 2.5) * sd; b.cyl('metal', lx, quay, lz, 0.1, 0.07, 4, 6, lin('#2a2a2c'), false); lamps.push(lx, quay + 4.2, lz) }
    for (const r of roads) for (let k = 0; k < r.pts.length - 1; k++) { // a stone bridge wherever a road crosses
      const p = r.pts[k], q = r.pts[k + 1]
      if (!cross2(p[0], p[2], q[0], q[2], ax, az, bx, bz)) continue
      const rx = q[0] - p[0], rz = q[2] - p[2], rl = Math.hypot(rx, rz) || 1, mx = (p[0] + q[0]) / 2, mz = (p[2] + q[2]) / 2, half = hw + 4
      const deck = Math.max(quay + 1.2, (p[1] + q[1]) / 2 + 0.3)
      arcade(b, mx - (rx / rl) * half, mz - (rz / rl) * half, deck, mx + (rx / rl) * half, mz + (rz / rl) * half, deck, gW, { width: r.width + 1.5, span: half * 2, deckT: 1.4, col: stone, seed: k, statues: false })
    }
  }
}

function structure(b: Builder, st: Structure, T: TerrainFn, gW: (x: number, z: number) => number, seed: number, roads: Road[], lakes: Lake[], wet: (x: number, z: number) => boolean) {
  const C = st.color ? lin(st.color) : lin('#d8d0bc'), sd = seed + hash(st.id), k = st.scale ?? SCALE[st.kind] ?? 1
  const flat = T.flats.find((f) => f.id === st.id), fp = footprint(st), roof = st.roof ? lin(st.roof) : lin('#56606a')
  if (st.kind === 'road' || st.kind === 'canal') return
  if (st.kind === 'bridge' || st.kind === 'aqueduct') {
    const path = st.kind === 'bridge' ? [st.at!, st.to!] : st.path!
    if (!path.every(Boolean) || path.length < 2) return
    const total = polyLen(path)
    const h0 = st.deck?.[0] ?? T.h(...path[0]) + (st.kind === 'bridge' ? 1 : 15)
    const h1 = st.deck?.[1] ?? (st.kind === 'bridge' ? T.h(...path[path.length - 1]) + 1 : h0 - total * 0.003)
    const styles = st.kind === 'bridge' ? BRIDGE_STYLES.filter((q) => q !== 'inhabited') : AQUEDUCT_STYLES, style = st.style ?? styles[hash(st.id + seed) % styles.length]
    let run = 0
    for (let i = 0; i < path.length - 1; i++) {
      const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]), [ax, az] = W(path[i]), [bx, bz] = W(path[i + 1])
      arcade(b, ax, az, lerp(h0, h1, run / total), bx, bz, lerp(h0, h1, (run + l) / total), gW, {
        width: st.width ?? (st.kind === 'bridge' ? 14 : 5), span: st.span ?? (st.kind === 'bridge' ? 60 : 22), deckT: st.kind === 'bridge' ? 3 : 2,
        aqueduct: st.kind === 'aqueduct', statues: st.statues ?? st.kind === 'bridge', towers: st.kind === 'bridge' && i === 0 && path.length === 2, col: C, seed: sd + i, style, wet,
        hump: st.kind === 'bridge' && !st.deck ? Math.min(14, total * 0.035) : 0, // old bridges are hump-backed: up from the streets, high over the water
      })
      run += l
    }
    return
  }
  if (st.kind === 'wall' && st.path && st.path.length > 1) {
    const pts: V[] = resample(st.path, 6).map((p) => { const [x, z] = W(p); return [x, gW(x, z), z] as V })
    // gates where main roads cross, and wherever the recipe asks
    const gates = new Set<number>()
    for (const r of roads) if (r.kind === 'main' || r.kind === 'street') for (let i = 0; i < r.pts.length - 1; i++) for (let j = 0; j < pts.length - 1; j++) if (cross2(r.pts[i][0], r.pts[i][2], r.pts[i + 1][0], r.pts[i + 1][2], pts[j][0], pts[j][2], pts[j + 1][0], pts[j + 1][2])) gates.add(j)
    for (const g of st.gates ?? []) { const [gx, gz] = W(g); let bi = 0, bd = Infinity; pts.forEach((p, i) => { const d = Math.hypot(p[0] - gx, p[2] - gz); if (d < bd) { bd = d; bi = i } }); gates.add(bi) }
    const merged = [...gates].sort((a, c) => a - c).filter((g, i, a) => !i || g - a[i - 1] > 4)
    cityWall(b, pts, st.height ?? 14, 110, merged, C, roof)
    return
  }
  if (st.kind === 'harbour' && st.at) {
    const [cx, cz] = W(st.at), lake = lakes.find((l) => Math.hypot(st.at![0] - l.at[0], st.at![1] - l.at[1]) < l.r + 200)
    harbour(b, cx, st.level ?? lake?.level ?? T.sea ?? T.h(...st.at), cz, yawOf(st.facing), st.width ?? 160, sd, C)
    return
  }
  if (!st.at || !flat || !fp) return
  const [fx, fy] = facingVec(st.facing), y = flat.level, yaw = yawOf(st.facing)
  const [ox, oz] = W([st.at[0] + fx * fp.back, st.at[1] + fy * fp.back]), [cx, cz] = W(st.at)
  // where the ground falls away, a retaining wall carries the terrace (plazas and the colonnade bring their own)
  if (st.kind !== 'plaza' && st.kind !== 'colonnade' && st.kind !== 'market') {
    let low = T.base(...st.at)
    for (let a = 0; a < 24; a++) low = Math.min(low, T.base(st.at[0] + Math.cos((a / 12) * Math.PI) * fp.r, st.at[1] + Math.sin((a / 12) * Math.PI) * fp.r))
    if (low < y - 3) {
      b.frame(cx, 0, cz, 0)
      const wc = mix(C, lin('#8a8070'), 0.45)
      b.cyl('stone', 0, low - 6, 0, fp.r + 3, fp.r, y - low + 5.6, Math.max(32, Math.round(fp.r / 3)), wc, false)
      b.cyl('stone', 0, y - 0.4, 0, fp.r + 0.6, fp.r + 0.6, 1.2, Math.max(32, Math.round(fp.r / 3)), C)
    }
  }
  switch (st.kind) {
    case 'cathedral': cathedral(b, ox, y, oz, yaw, k, sd, C); break
    case 'basilica': basilica(b, ox, y, oz, yaw, k, sd, C); break
    case 'dome': domeChurch(b, ox, y, oz, yaw, k, sd, C, st.roof ? roof : lin('#5a7a78')); break
    case 'palace': palace(b, ox, y, oz, yaw, st.width ?? 80, st.depth ?? 64, sd, C, st.roof ? roof : lin('#4f6a68')); break
    case 'monastery': monastery(b, ox, y, oz, yaw, sd, C, st.roof ? roof : lin('#6e5040')); break
    case 'colonnade': colonnade(b, cx, y, cz, yaw, st.radius ?? 120, sd, C); break
    case 'tower': tower(b, cx, y, cz, yaw, st.width ?? 12, st.height ?? 70, sd, C); break
    case 'plaza': plaza(b, cx, y, cz, st.radius ?? 40, Math.min(y, T.base(...st.at)) - 30, st.centre ?? 'fountain', st.statues ?? true, sd, C); break
    case 'statue': b.frame(cx, y, cz, yaw); statue(b, 0, 0, 0, 0, st.height ?? 20, sd, st.color === 'bronze' ? BRONZE : st.color ? C : MARBLE); break
    case 'church': church(b, ox, y, oz, yaw, st.culture ?? 'central', k, sd, st.color ? C : lin(CHURCH_STONE[st.culture ?? 'central'])); break
    case 'market': market(b, cx, y, cz, (90 - (st.facing ?? 0)) * DEG, st.width ?? 40, st.depth ?? 60, Math.min(y, T.base(...st.at)) - 8, sd, st.color ? C : lin(CHURCH_STONE[st.culture ?? 'central'])); break
  }
}
const CHURCH_STONE: Record<string, string> = { central: '#b8ad98', mediterranean: '#d8c8a4', mountain: '#9a958a', eastern: '#e4dccc' }
const cross2 = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
  return d1 * d2 < 0 && d3 * d4 < 0
}

// ---------- checks and descriptions ----------
export function validate(doc: LocationDoc) {
  const errors: string[] = [], warnings: string[] = []
  if (!doc || typeof doc !== 'object') return { errors: ['not a location'], warnings }
  if (!doc.id || !doc.name || !doc.seed) errors.push('needs id, name and seed')
  if (!(doc.size >= 1000 && doc.size <= 60000)) errors.push('size must be 1000..60000 metres')
  for (const k of ['terrain', 'districts', 'structures'] as const) if (!Array.isArray(doc[k])) errors.push(`${k} must be a list`)
  if (doc.weather && !WEATHERS.includes(doc.weather)) errors.push(`weather: use ${WEATHERS.join(', ')}`)
  if (doc.season && !SEASONS.includes(doc.season)) errors.push(`season: use ${SEASONS.join(', ')}`)
  if (doc.climate && !CLIMATES.includes(doc.climate)) errors.push(`climate: use ${CLIMATES.join(', ')}`)
  if (doc.culture && doc.culture !== 'mixed' && !CULTURES.includes(doc.culture)) errors.push(`culture: use ${CULTURES.join(', ')} or mixed`)
  if (errors.length) return { errors, warnings }
  const ids = new Set<string>(), half = doc.size / 2
  const out = (p: number[]) => Math.abs(p[0]) > half || Math.abs(p[1]) > half
  const pt = (p: unknown, what: string, path = false) => { if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) { errors.push(`${what}: needs [x, y]`); return false } if (!path && out(p)) warnings.push(`${what} is outside the map`); return true }
  // paths may run off the edge (ranges, coasts, rivers to the sea); only one that never comes onto the map is a mistake
  const pts = (p: unknown, n: number, what: string) => { if (!Array.isArray(p) || p.length < n) { errors.push(`${what}: needs at least ${n} points`); return false } const ok = p.every((q, i) => pt(q, `${what} point ${i + 1}`, true)); if (ok && p.every(out)) warnings.push(`${what} is entirely outside the map`); return ok }
  const named = (o: { id: string; name?: string }, what: string) => { if (!o.id) errors.push(`${what} without an id`); else if (ids.has(o.id)) errors.push(`duplicate id ${o.id}`); ids.add(o.id); if (!o.name) warnings.push(`${o.id}: give it a name`) }
  for (const f of doc.terrain) {
    named(f, 'terrain feature')
    const w = `${f.id} (${f.kind})`
    if (!TERRAIN_KINDS.includes(f.kind)) { errors.push(`${w}: unknown kind; use ${TERRAIN_KINDS.join(', ')}`); continue }
    const area = () => { if (f.area) pts(f.area, 3, w); else if (!f.at) errors.push(`${w}: needs area or at + radius`); else pt(f.at, w) }
    if ((f.kind === 'peak' || f.kind === 'island' || f.kind === 'volcano') && (pt(f.at, w), f.height == null)) errors.push(`${w}: needs height (summit altitude)`)
    if ((f.kind === 'ridge' || f.kind === 'valley') && (pts(f.path, 2, w), f.height == null)) errors.push(`${w}: needs height (${f.kind === 'ridge' ? 'crest' : 'floor'} altitude)`)
    if (f.kind === 'river' || f.kind === 'cliff' || f.kind === 'gorge' || f.kind === 'glacier' || f.kind === 'coast' || f.kind === 'canyon' || f.kind === 'fjord') pts(f.path, 2, w)
    if ((f.kind === 'coast' || f.kind === 'fjord') && doc.sea == null) errors.push(`${w}: a ${f.kind} needs the location's sea level (sea)`)
    if (f.kind === 'geyser') pt(f.at, w)
    if (f.kind === 'coast' && f.style && !COAST_STYLES.includes(f.style)) errors.push(`${w}: style: use ${COAST_STYLES.join(', ')}`)
    if (f.kind === 'lake') { if (f.path) pts(f.path, 2, w); else pt(f.at, w) }
    if (f.kind === 'crater' || f.kind === 'stack' || f.kind === 'spire') pt(f.at, w)
    if (f.kind === 'arch') { pt(f.at, `${w} at`); pt(f.to, `${w} to`) }
    if (f.kind === 'plateau' || f.kind === 'mesa' || f.kind === 'fields' || f.kind === 'dunes' || f.kind === 'karst' || f.kind === 'hoodoos' || f.kind === 'columns' || f.kind === 'lavafield' || f.kind === 'springs' || f.kind === 'marsh') area()
    if ((f.kind === 'plateau' || f.kind === 'mesa') && f.height == null) errors.push(`${w}: needs height`)
    if (f.kind === 'fields' && f.crop && !CROPS.includes(f.crop)) errors.push(`${w}: crop: use ${CROPS.join(', ')}`)
  }
  for (const d of doc.districts) {
    named(d, 'district')
    if (d.area) pts(d.area, 3, d.id); else if (d.at) pt(d.at, d.id); else errors.push(`${d.id}: needs area or at + radius`)
    if (d.culture && d.culture !== 'mixed' && !CULTURES.includes(d.culture)) errors.push(`${d.id}: culture: use ${CULTURES.join(', ')} or mixed`)
  }
  for (const s of doc.structures) {
    named(s, 'structure')
    const w = `${s.id} (${s.kind})`
    if (!STRUCTURE_KINDS.includes(s.kind)) { errors.push(`${w}: unknown kind; use ${STRUCTURE_KINDS.join(', ')}`); continue }
    if (s.style && !((s.kind === 'bridge' ? BRIDGE_STYLES : s.kind === 'aqueduct' ? AQUEDUCT_STYLES : []) as readonly string[]).includes(s.style)) errors.push(`${w}: style: ${s.kind === 'bridge' ? BRIDGE_STYLES.join(', ') : s.kind === 'aqueduct' ? AQUEDUCT_STYLES.join(', ') : 'only bridges and aqueducts have one'}`)
    if (s.kind === 'bridge') { pt(s.at, `${w} at`); pt(s.to, `${w} to`) } else if (s.kind === 'aqueduct' || s.kind === 'wall' || s.kind === 'road' || s.kind === 'canal') pts(s.path, 2, w); else pt(s.at, w)
  }
  if (errors.length) return { errors, warnings }
  const T = terrainOf(doc), lakeF = doc.terrain.filter((f) => f.kind === 'lake' && (f.at || f.path)), riverF = doc.terrain.filter((f) => f.kind === 'river' && f.path && f.path.length > 1)
  const nearLake = (p: XY, pad: number) => lakeF.some((l) => (l.path ? pathNearFast(l.path, p[0], p[1], 1e9).d : Math.hypot(p[0] - l.at![0], p[1] - l.at![1])) < (l.radius ?? 400) + pad)
  const wet = (p: XY) => nearLake(p, -50) || (T.sea != null && T.h(...p) < T.sea) || riverF.some((r) => pathNearFast(r.path!, p[0], p[1], 1e9).d < (r.width ?? 24) * 0.5)
  for (const s of doc.structures) {
    const fp = footprint(s)
    if (fp && s.at) {
      const f = T.flats.find((q) => q.id === s.id)!
      let worst = 0
      for (let a = 0; a < 16; a++) worst = Math.max(worst, Math.abs(T.base(s.at[0] + Math.cos(a) * fp.r, s.at[1] + Math.sin(a) * fp.r) - f.level))
      if (worst > 90) warnings.push(`${s.id}: steep site, the ground is cut or filled by up to ${Math.round(worst)} m; move it, set level, or put a plateau under it`)
      if (wet(s.at)) warnings.push(`${s.id}: stands in water`)
    }
    if (s.kind === 'harbour' && s.at && !nearLake(s.at, 200) && !(T.sea != null && T.h(s.at[0] + facingVec(s.facing)[0] * 60, s.at[1] + facingVec(s.facing)[1] * 60) < T.sea)) warnings.push(`${s.id}: a harbour needs a lake or the sea in front of it (facing points at the water)`)
    if (s.kind === 'bridge' && s.at && s.to) {
      const h0 = s.deck?.[0] ?? T.h(...s.at) + 1, h1 = s.deck?.[1] ?? T.h(...s.to) + 1
      for (let t = 0.1; t < 0.95; t += 0.05) { const g = T.h(lerp(s.at[0], s.to[0], t), lerp(s.at[1], s.to[1], t)); if (g > lerp(h0, h1, t) + 6) { warnings.push(`${s.id}: the deck runs into the ground ${Math.round(t * 100)}% of the way across; raise deck or move an end`); break } }
    }
  }
  for (const r of riverF) { // a river has to go somewhere: a lake, the sea, another river or off the map
    const end = r.path![r.path!.length - 1]
    const ok = Math.abs(end[0]) > half - 200 || Math.abs(end[1]) > half - 200 || nearLake(end, 60) || (T.sea != null && T.h(...end) < T.sea + 5) || riverF.some((o) => o !== r && pathNearFast(o.path!, end[0], end[1], 1e9).d < (o.width ?? 24) * 2)
    if (!ok) warnings.push(`${r.id}: the river ends nowhere; end it in a lake, the sea, another river or at the map edge`)
    if (T.h(...r.path![0]) < T.h(...end) - 5) warnings.push(`${r.id}: the river's source is lower than its mouth; list its path from source to mouth`)
  }
  for (const d of doc.districts) if (d.at && (T.sea != null && T.h(...d.at) < T.sea + 1 || nearLake(d.at, -80))) warnings.push(`${d.id}: the town's core is in the water; move its at onto dry land`)
  return { errors, warnings }
}

export function describe(doc: LocationDoc, built?: CityBuilt) {
  const T = terrainOf(doc), r = (n: number) => Math.round(n).toLocaleString('en'), xy = (p: XY) => `[${r(p[0])}, ${r(p[1])}]`
  const lines = [`${doc.name} (${doc.id}): ${r(doc.size)} m square, seed "${doc.seed}", ${doc.climate ?? 'temperate'} climate${doc.sea != null ? `, sea at ${r(doc.sea)} m` : ''}, mood ${doc.mood ?? 'morning'}`]
  if (built) lines.push(`ground ${r(built.minH)}..${r(built.maxH)} m, ${r(built.counts.buildings)} buildings, ${built.counts.roads} roads/lanes/stairs, ${r(built.counts.trees)} trees, ${built.counts.structures} structures; built in ${(built.ms / 1000).toFixed(1)} s`)
  lines.push('', 'Terrain:')
  for (const f of doc.terrain) lines.push(`  ${f.id} ${f.kind} "${f.name ?? ''}" ${f.at ? 'at ' + xy(f.at) : f.path ? `${f.path.length}-point path` : f.area ? `${f.area.length}-point area` : ''} ${f.height != null ? 'height ' + r(f.height) : ''}${f.level != null ? 'level ' + r(f.level) : ''}${f.crop ? ' ' + f.crop : ''}`)
  lines.push('', 'Districts:')
  for (const d of doc.districts) {
    let n = 0
    if (built) for (let k = 0; k < built.parts.length; k += PSTRIDE) if (built.parts[k] === PART.wall && built.parts[k + 12] < 50 && areaDist(d, built.parts[k + 1], -built.parts[k + 3]) <= 0) n++
    lines.push(`  ${d.id} "${d.name ?? ''}" ${d.culture ?? doc.culture ?? 'central'} ${d.area ? `${d.area.length}-point area` : `at ${xy(d.at!)} r ${r(d.radius ?? 300)}`}${built ? `, ${r(n)} wall blocks` : ''}`)
  }
  lines.push('', 'Structures:')
  for (const s of doc.structures) lines.push(`  ${s.id} ${s.kind} "${s.name ?? ''}" ${s.at ? `at ${xy(s.at)} ground ${r(T.h(...s.at))}` : ''}${s.to ? ` to ${xy(s.to)} ground ${r(T.h(...s.to))}` : ''}${s.path ? ` ${s.path.length}-point path, ${r(polyLen(s.path))} m` : ''}`)
  if (doc.views?.length) lines.push('', 'Views:', ...doc.views.map((v) => `  "${v.name}" at ${xy([v.at[0], v.at[1]])} alt ${r(v.at[2])} heading ${r(v.heading)} pitch ${r(v.pitch)}`))
  if (built) lines.push('', 'Build stages (ms): ' + Object.entries(built.stages).map(([k, v]) => `${k} ${v}`).join(', '))
  return lines.join('\n')
}

export function brief() {
  return `# Locations: recipe format
A location is JSON: { id, name, seed, size (metres, square), base?, relief?, snowline?, sea? (sea level altitude), climate? (${CLIMATES.join('|')}),
culture? (default building culture: ${CULTURES.join('|')}|mixed), rock? (default rock: ${Object.keys(ROCKS).join('|')} or a hex colour),
erosion? (0..2, default 1), wealth?: [lowAlt, highAlt], roads? (default true), farms? (default true), forest? (0..2),
mood?, hour? (0-24), weather?, season?, volume? (default true: the ground and its rock are one 3D surface with
layered, undercut rock on every steep face; false draws the old height grid with rock sheets), terrain: [], districts: [],
structures: [], views?: [] }.
Coordinates are metres from the centre: x east, y north. Heights are altitudes in metres. Later terrain features win over earlier ones
(put coasts and fjords after the land they cut). Give everything an id; the user names things.

How the ground is made: a procedural range (base altitude, relief = amplitude), then your landforms, then rivers of rain carve it
(stream-power erosion: dendritic valleys, spurs, sharp ridges), then lakes fill their basins, rivers find their valleys, and the climate
decides snow, tree line, forest and meadow. Every steep face (coast cliffs, escarpments, gorges, mesas, canyons, calderas, fjords) is
drawn as real rock over the ground. Shape things the way nature does: put glaciers and rivers in valleys, towns on gentle ground by
water or crossroads, harbours where a town meets the sea.

Terrain (kind: fields):
- peak: at, height (summit), radius (1500), sharp (1.4; higher = needle, below 1 = rounded); island: the same, rising from the sea
- ridge: path, height (crest), width (half-width at the foot, 900); the crest rises and falls in summits and cols on its own
- valley: path, height (floor altitude at the start), end (floor altitude at the end; default = height), width (500), edge (half-width
  of a flat floodplain, 0 = V-shaped), meander (1: its axis winds in long bends between your points; 0 = straight). A valley
  that ends below sea level is a bay.
- coast: path with the sea on its RIGHT (walk it with the sea to your right), height (cliff top above the sea, 60), style
  (${COAST_STYLES.join('|')}: how much of it is hard rock), bays (0..2, headlands and bays, about 300 m at 1), stacks (0..2), depth (sea
  floor, 45), extent (how far inland the cliff top is raised, 900), rock. Hard rock makes headlands with sheer cliffs, a wave-cut platform,
  sea stacks and arches; soft rock retreats into bays with beaches. Needs the location's sea.
- fjord: path from the open sea to its head, width (900), depth (220 below the sea): a drowned U-shaped trough with sheer granite walls
- cliff: an escarpment: path, drop (120), side (left|right = the low side; default right), extent (1600), meander (1: spurs and
  re-entrants), rock; talus gathers at its foot
- gorge: path, depth (160), width (70); a slot with rock walls (run a river along it)
- canyon: path, width (1200), depth (600), step (cliff bands, 3), rock (redstone): stepped walls and benches
- mesa: area or at + radius, height (top), depth (cap-rock thickness): a flat top, a sheer cap-rock face, talus slopes below
- plateau: area or at + radius, height, edge (blend width, 150)
- glacier: path from its head to its snout (it follows the valley it finds between your points unless follow: false), width (380),
  height (snout altitude: the ice ends where the valley drops below it), depth (ice thickness, 70). It lies in its own U-trough with
  lateral moraines: snow in its basin, blue ice below, medial moraines, a dirty snout.
- river: waypoints from source to mouth (it finds the valley floor between them unless follow: false), width (24 at the mouth), depth (4),
  meander (0..2: sine-generated loops where the valley is flat, about eleven widths long), mouth (estuary|delta|none; at the sea it opens
  into an estuary by default). Never flows uphill; falls over steps into plunge pools. End it in a lake, the sea, another river or off the map.
- lake: at + radius (a round tarn) or path + radius (a finger lake along a valley), level (default: found so the lake has about that
  area), depth (40). The shore is the contour at its level, so it fills its valley; a moraine dam holds it where it would spill.
- marsh: area or at + radius: reed ground at the water table with scattered pools
- volcano: at, height, radius (4000), crater (radius), depth, caldera (true: a wide sheer-walled caldera; add a lake at its centre for a
  crater lake), active (true: an ash plume, glowing lava), lava (lava flows, 3 when active), cones (parasitic cones, 3)
- lavafield: area or at + radius: old rough black lava (active: true to glow)
- crater: at, radius, depth (an impact or explosion crater; add a lake for a maar)
- springs: area or at + radius, step (1.4): hot-spring travertine terraces with warm pools and steam
- geyser: at, radius (30): a sinter mound and a steam column
- dunes: area or at + radius, height (18), step (wavelength, 180), angle (wind direction)
- karst: area or at + radius, height (tower height, 160), density (1): a forest of limestone towers with trees on top
- stack | spire: at, height (above the sea, or the ground), radius; arch: at, to (its two feet), height
- hoodoos: area, height (25), density; columns: area, height (8): hexagonal basalt columns
- fields: area or at + radius, crop (${CROPS.join('|')}), angle, step (terrace height for vines/olives/terraces, 3.5)

Districts are towns: at (the core: the market square, where roads meet or a river is crossed) + radius (about how big), or area (a
polygon it must stay inside). A town grows from its core over the cheapest ground, so it follows valley floors, shores, ridges and
contours; it is built up wall to wall in the middle and thins to houses with gardens at its edge. culture (${CULTURES.join(', ')}, mixed),
density (0..1, 0.85), wealth (0..1, else from altitude and great buildings), steep (true: a cliff town), walls (true: a wall round the old
town, gates where roads cross), square (default true: a market square at the core), church (default true: a parish church on the
square), plan (organic|grid|radial|terraced; default from the ground), farms (default true: the town's own fields around it).
Streets come from the ground: along the main roads and the contours, radiating round the square; on slopes, stairs between terraces held
by retaining walls. A town on the sea gets a harbour where it meets the water.
- central: timber framing over stone, steep tile or slate roofs, gable-fronted town houses, stepped gables, dormers, needle and onion spires
- mediterranean: warm stucco, low barrel-tile roofs, flat roof terraces, loggias and arcades, balconies, awnings, campaniles, courtyards
- mountain: rubble stone with wooden upper floors and balconies, low roofs of stone slabs; steep districts become whitewashed cube towns
- eastern: whitewash and banded stone, flat roofs with parapets, domes, cupolas, onion domes, minarets, pointed arches, wooden balconies

Structures (kind: fields; facing is a compass bearing the front faces, 0 = north, 180 = south):
- cathedral: at, facing, scale (1 = towers about 55 m; Cologne is about 2, the default 1.9). No two alike (from the id): solid,
  openwork (Cologne, Freiburg) or lantern spires or flat-topped towers; a transept with roses or none; a flèche, lantern or spire
  over the crossing; a chevet of chapels. Great structures carry finer detail that appears as you fly closer.
- basilica: at, facing, scale (Sagrada style; 1 = central tower 172 m); dome: at, facing, scale, roof colour (St Peter's style)
- church: at, facing, scale, culture (a parish church); market: at, facing (along its length), width, depth (a market square)
- palace: at, facing, width (80), depth (64), roof colour; monastery: at, facing
- colonnade: at, facing (the open side), radius (oval half-width, 120); tower: at, facing, width (12), height (70)
- plaza: at, radius (40), centre fountain|obelisk|statue|none, statues; statue: at, facing, height (20), color ("bronze" or hex)
- bridge: at, to, width (14), span (60), deck [altA, altB], style (${BRIDGE_STYLES.join('|')}: round arches with cutwaters; pointed arches,
  refuges and gate towers; flat arches, oculi, a balustrade and statues; a row of houses on brackets; default from the seed)
- aqueduct: path, width (5), span (22), deck [start, end], style (${AQUEDUCT_STYLES.join('|')}: tiers of arches under small ones carrying a
  covered channel; slender stepped piers; striped horseshoe arches); it falls gently (about 0.3%) from its source to the town
- wall: path, height (14), gates [[x, y], ...]; canal: path, width (12), level; road: path of waypoints
- harbour: at (on a lake shore or the coast), facing (towards the water), width (quay length, 160)
Structures with an at (except harbours) level the ground around them (to level, default the ground there).
Colours are hex ("#d8d0bc"). Moods: ${MOOD_NAMES.join(', ')}. Weather: ${WEATHERS.join(', ')}. Seasons: ${SEASONS.join(', ')}.
Views: { name, at: [x, y, altitude], heading, pitch (degrees, negative = down), note?, hour?, weather?, season? } (the Tour glides
through them, showing each note and switching to its hour, weather and season).

Workflow: node scripts/loc.ts validate <file>, describe <file>, preview <file> out.png [--region W,E,S,N], check <file> (the realism
audit: rivers on their valley floors, lakes not circles, no stranded sea, glaciers in their troughs, towns shaped by the ground, houses on
streets, road grades). Fix every warning that is not deliberate, then look at the views in the browser.`
}
