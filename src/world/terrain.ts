// The planet as a pure function: unit direction -> elevation (m), climate, biome colour.
// No DOM or three.js here so the browser, the tile worker and node scripts all share one implementation.
import { toDir, toLatLon, type Vec } from './geo.ts'
import { fbm, hash, ridged, rng, simplex } from './noise.ts'
import { compileOps, riverCourse, type Compiled, type LatLon, type Op } from './ops.ts'
import type { Layer } from './layers.ts'
import { TERRAINS } from './terrains.ts'

export { toDir, toLatLon, type Vec }

export interface WorldParams {
  oceanPct: number // share of the surface under water, 5..95
  plates: number // tectonic plates, 4..40; more plates = more, shorter mountain belts
  ruggedness: number // 0.2..2, scales mountains and hills
  aridity: number // 0..1, 0.5 is Earth-like
  tilt: number // axial tilt in degrees, widens or narrows climate bands
  radiusKm: number
}
export interface World { id: string; name: string; generatorVersion: 1; seed: string; params: WorldParams; ops?: Op[]; layers?: Layer[] }

/** The world as the generator sees it: names, notes and layers never change the ground. */
export const groundSpec = (world: World) => JSON.stringify({ ...world, name: '', layers: undefined, ops: (world.ops ?? []).map(({ name: _n, note: _o, wikiId: _w, ...op }) => op) })

export const DEFAULT_PARAMS: WorldParams = { oceanPct: 64, plates: 14, ruggedness: 1, aridity: 0.5, tilt: 23, radiusKm: 6000 }


// Whittaker-style lookup: rows = mean temperature (C), columns = moisture 0..1. Cells are terrain ids (see terrains.ts).
const TEMPS = [-15, -2, 8, 18, 28]
const MOIST = [0, 0.33, 0.66, 1]
const CLIMATE: string[][] = [
  ['polar_desert', 'tundra', 'tundra', 'ice'],
  ['cold_desert', 'steppe', 'taiga', 'bog'],
  ['steppe', 'grassland', 'forest', 'deep_forest'],
  ['desert', 'scrub', 'woodland', 'subtropical_forest'],
  ['desert', 'savanna', 'dry_forest', 'jungle'],
]
const SEA_ICE: Vec = [222, 230, 238], LAKE: Vec = [48, 104, 132], RIVER: Vec = [58, 118, 146]
const SHALLOW: Vec = [62, 160, 176], DEEP: Vec = [10, 28, 68]

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const mix = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const axis = (vals: number[], v: number) => {
  let i = 0
  while (i < vals.length - 2 && v > vals[i + 1]) i++
  return { i, t: Math.max(0, Math.min(1, (v - vals[i]) / (vals[i + 1] - vals[i]))) }
}

export interface Planet {
  world: World
  radiusM: number
  /** Elevation in metres (negative = sea floor). `detail` adds octaves for close-up tiles. */
  elevation(x: number, y: number, z: number, detail?: number): number
  climate(x: number, y: number, z: number, h: number): { temp: number; moist: number }
  /** Linear-ish sRGB 0..255 surface colour; `slope` is rise/run from the tile builder. */
  color(x: number, y: number, z: number, h: number, slope?: number, detail?: number): Vec
  biome(x: number, y: number, z: number, h: number): string
  /** The dominant terrain id at a point ('' on water) and how firmly it holds there (0..1, low near borders). */
  terrain(x: number, y: number, z: number, h: number, slope?: number, detail?: number): { id: string; w: number }
  /** Water at a point: sea below 0, lakes at their level, river channels. */
  water(x: number, y: number, z: number, h: number): { kind: 'sea' | 'lake' | 'river'; level: number } | undefined
  /** Height of the visible surface (water surfaces are flat), metres, never below sea level. */
  surface(x: number, y: number, z: number, h: number): number
  ops: Compiled[]
  /** A river op's meandering course as drawn and carved. */
  course(op: Extract<Op, { kind: 'river' }>): LatLon[]
}

export function makePlanet(world: World): Planet {
  const P = { ...DEFAULT_PARAMS, ...world.params }
  const seed = hash(world.seed)
  const nShape = simplex(seed), nWarp = simplex(seed + 1), nRidge = simplex(seed + 2), nHill = simplex(seed + 3), nClim = simplex(seed + 4)

  // Tectonic plates: random centres, a continental/oceanic bias and a drift direction (tangent at the centre).
  const r = rng(seed + 99)
  const plates = Array.from({ length: Math.round(P.plates) }, () => {
    const z = 2 * r() - 1, t = 2 * Math.PI * r(), s = Math.sqrt(1 - z * z)
    const c: Vec = [s * Math.cos(t), s * Math.sin(t), z]
    const q: Vec = [r() - 0.5, r() - 0.5, r() - 0.5]
    const v: Vec = [c[1] * q[2] - c[2] * q[1], c[2] * q[0] - c[0] * q[2], c[0] * q[1] - c[1] * q[0]]
    const vl = Math.hypot(...v) || 1
    const continental = r() < (1 - P.oceanPct / 100) * 1.15
    return { c, v: v.map((x) => x / vl) as Vec, base: continental ? 0.42 : -0.42, continental }
  })

  // Raw elevation in arbitrary units; converted to metres once the sea level quantile is known.
  const raw = (x: number, y: number, z: number, detail: number) => {
    const wx = x + 0.16 * fbm(nWarp, x * 1.7, y * 1.7, z * 1.7, 4)
    const wy = y + 0.16 * fbm(nWarp, x * 1.7 + 31, y * 1.7, z * 1.7, 4)
    const wz = z + 0.16 * fbm(nWarp, x * 1.7, y * 1.7 + 57, z * 1.7, 4)
    // two nearest plate centres to the warped point
    let d1 = -2, d2 = -2, a = 0, b = 0
    for (let i = 0; i < plates.length; i++) {
      const c = plates[i].c, d = (wx * c[0] + wy * c[1] + wz * c[2])
      if (d > d1) { d2 = d1; b = a; d1 = d; a = i } else if (d > d2) { d2 = d; b = i }
    }
    const A = plates[a], B = plates[b]
    const gap = Math.acos(Math.max(-1, Math.min(1, d2))) - Math.acos(Math.max(-1, Math.min(1, d1))) // radians to the boundary * 2
    const base = (A.base + B.base) / 2 + (A.base - (A.base + B.base) / 2) * smooth(0, 0.35, gap)
    // boundary stress: plates moving toward each other raise ranges, apart open rifts / mid-ocean ridges
    const nx = B.c[0] - A.c[0], ny = B.c[1] - A.c[1], nz = B.c[2] - A.c[2], nl = Math.hypot(nx, ny, nz) || 1
    const rel = ((A.v[0] - B.v[0]) * nx + (A.v[1] - B.v[1]) * ny + (A.v[2] - B.v[2]) * nz) / nl
    const band = Math.exp(-((gap / 0.05) ** 2))
    const crest = ridged(nRidge, wx * 5, wy * 5, wz * 5, 5 + detail)
    let stress = 0
    if (rel > 0) stress = band * rel * (0.2 + 0.8 * crest * crest) * (A.continental && B.continental ? 0.9 : A.continental || B.continental ? 0.65 : 0.35)
    else stress = band * rel * (A.continental ? 0.25 : -0.12)
    const shape = 0.55 * fbm(nShape, wx * 1.4, wy * 1.4, wz * 1.4, 7 + detail)
    // inland mountain chains, masked so they cluster rather than cover everything
    const chains = ridged(nRidge, wx * 2.3 + 11, wy * 2.3, wz * 2.3, 6 + detail) ** 2 * smooth(0.05, 0.45, fbm(nHill, wx * 0.8, wy * 0.8, wz * 0.8, 3)) * 0.22
    const hills = 0.035 * fbm(nHill, wx * 9, wy * 9, wz * 9, 5)
    return base + shape + (stress * 0.8 + chains + hills) * P.ruggedness
  }

  // Sea level and height scale from a fixed Fibonacci sample, so oceanPct is honoured exactly.
  const N = 4000, samples = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * i + 1) / N, s = Math.sqrt(1 - y * y), t = i * 2.399963229728653
    samples[i] = raw(s * Math.cos(t), y, s * Math.sin(t), 0)
  }
  samples.sort()
  const q = (f: number) => samples[Math.max(0, Math.min(N - 1, Math.floor(f * N)))]
  const sea = q(P.oceanPct / 100), hi = q(0.997), lo = q(0.003)

  // Close-up relief in metres: ridged octaves with a slow falloff, so valleys and spurs keep appearing as you zoom.
  const nDet = simplex(seed + 5)
  // `fine` (0..1) scales the octaves finer than a few km: plains stay open and flat at human scale, only hills and mountains are craggy
  const relief = (x: number, y: number, z: number, octaves: number, fine = 1) => {
    let sum = 0, amp = 1, f = 30, w = 1
    for (let o = 0; o < octaves; o++) {
      let v = 1 - Math.abs(nDet(x * f, y * f, z * f))
      v *= v
      sum += (v - 0.45) * amp * w * (o >= 4 ? fine : 1)
      w = Math.max(0.25, Math.min(1, v * 1.6)) // fine detail mostly on ridges, valleys stay smoother (reads as erosion)
      amp *= 0.66; f *= 2
    }
    return 650 * sum
  }

  const generated = (x: number, y: number, z: number, detail: number) => {
    const e = raw(x, y, z, detail)
    if (e < sea) return -6000 * Math.pow(Math.min(1.4, (sea - e) / (sea - lo)), 0.8)
    const h = 6200 * Math.pow((e - sea) / (hi - sea), 1.3) // lowlands stay low, peaks sharpen
    return h < 5000 ? h : 5000 + 2500 * Math.tanh((h - 5000) / 2500) // soft ceiling so outliers stay mountain-sized
  }
  const nOps = simplex(seed + 7)
  const ops = compileOps(world.ops ?? [], P.radiusKm, nOps, (p) => generated(p[0], p[1], p[2], 0))
  const course = (op: Extract<Op, { kind: 'river' }>) => riverCourse(op, P.radiusKm, nOps)
  const near = (c: Compiled, x: number, y: number, z: number) => x * c.cap.c[0] + y * c.cap.c[1] + z * c.cap.c[2] >= c.cap.cos
  const paints = ops.filter((c) => c.paint), reshapes = paints.filter((c) => c.shape)

  // generated terrain -> shape ops -> close-up relief (land only, never moves the coast) -> painted ground shapes
  // (dunes, terraces, crystal spikes) -> water ops
  const elevation = (x: number, y: number, z: number, detail = 0) => {
    let h = generated(x, y, z, detail)
    const p: Vec = [x, y, z]
    for (const c of ops) if (c.stage === 'shape' && near(c, x, y, z)) h = c.apply(h, p)
    if (h > 0) {
      let calm = 1 // painted dunes and terraces tame the generic relief so their own shape shows
      for (const c of reshapes) if (near(c, x, y, z)) calm = Math.min(calm, 1 - c.shape!.calm * c.paint!(p))
      const rough = (0.2 + 1.6 * smooth(300, 2500, h)) * P.ruggedness * smooth(0, 120, h) * calm // highlands craggy, coasts calm
      h = Math.max(0.5, h + rough * relief(x, y, z, 2 + detail, 0.18 + 0.82 * smooth(150, 1200, h)))
      if (h > 3) for (const c of reshapes) if (near(c, x, y, z)) { const w = c.paint!(p); if (w > 0) h = Math.max(1, c.shape!.apply(h, p, w)) }
    }
    for (const c of ops) if (c.stage === 'water' && near(c, x, y, z)) h = c.apply(h, p)
    return h
  }

  const water = (x: number, y: number, z: number, h: number) => {
    let lake: number | undefined, river = false
    for (const c of ops) {
      if (!c.water || !near(c, x, y, z)) continue
      const w = c.water([x, y, z], h)
      if (w === 'river') river = true
      else if (w !== undefined) lake = Math.max(lake ?? -Infinity, w)
    }
    if (lake !== undefined && h < lake) return { kind: 'lake' as const, level: lake }
    if (h < 0) return { kind: 'sea' as const, level: 0 }
    if (river) return { kind: 'river' as const, level: h }
    return undefined
  }
  const surface = (x: number, y: number, z: number, h: number) => Math.max(0, h, water(x, y, z, h)?.level ?? 0)

  const climate = (x: number, y: number, z: number, h: number) => {
    const lat = Math.asin(Math.max(-1, Math.min(1, y)))
    const s2 = Math.sin(lat) ** 2, k = 1 + (P.tilt - 23) / 60 // more tilt = harsher high latitudes
    const temp = 27 - 30 * k * s2 ** 1.5 - 25 * k * s2 ** 8 - 0.0065 * Math.max(0, h) + 4 * nClim(x * 3, y * 3, z * 3)
    // Hadley/Ferrel bands: wet equator, dry ~30 deg, wet ~55 deg, dry poles; inland drier
    const inland = smooth(0.05, 0.4, fbm(nShape, x * 1.4, y * 1.4, z * 1.4, 2)) // low-octave landmass shape as a continentality proxy
    const moist = 0.5 + 0.3 * Math.cos(lat * 6) + 0.32 * fbm(nClim, x * 2.2 + 7, y * 2.2, z * 2.2, 4) - (P.aridity - 0.5) * 0.7 - inland * 0.15
    return { temp, moist: Math.max(0, Math.min(1, moist)) }
  }

  // The ground at a point: which terrain wins, how firmly, and its colour. Climate picks from a Whittaker grid with
  // sharpened borders (so regions read as distinct), height/steepness/cold override it, and painted ops win last.
  const nTer = simplex(seed + 6)
  const unit = (v: number) => Math.max(0, Math.min(1, v))
  const ground = (x: number, y: number, z: number, h: number, slope: number, detail: number): { id: string; w: number; rgb: Vec } => {
    const { temp, moist: m0 } = climate(x, y, z, h)
    const big = fbm(nClim, x * 12, y * 12, z * 12, 1 + detail) // always on, so neighbouring LOD levels match
    const mid = fbm(nTer, x * 70, y * 70, z * 70, 3 + Math.min(detail, 3)) // woods and fields alternate at regional scale
    const fine = fbm(nTer, x * 400 + 9, y * 400, z * 400, 2 + Math.min(detail, 4))
    const a = axis(TEMPS, temp + 2.5 * mid), m = axis(MOIST, unit(m0 + big * 0.18 + mid * 0.34))
    const ta = smooth(0.28, 0.72, a.t), tm = smooth(0.28, 0.72, m.t)
    const vary = (id: string) => id === 'desert' && mid > 0.1 ? 'dunes' : id === 'grassland' && fine > 0.12 ? 'meadow' : id
    const cells = [
      { id: vary(CLIMATE[a.i][m.i]), w: (1 - ta) * (1 - tm) }, { id: vary(CLIMATE[a.i][m.i + 1]), w: (1 - ta) * tm },
      { id: vary(CLIMATE[a.i + 1][m.i]), w: ta * (1 - tm) }, { id: vary(CLIMATE[a.i + 1][m.i + 1]), w: ta * tm },
    ]
    const tone = unit(0.5 + 0.9 * fine + 0.3 * big) // which of a terrain's two ground colours
    const paint = (id: string): Vec => { const t = TERRAINS[id]; return mix(t.ground, t.ground2, tone) }
    let id = cells[0].id, best = -1, rgb: Vec = [0, 0, 0]
    for (const c of cells) { if (c.w > best) { best = c.w; id = c.id } const g = paint(c.id); rgb = [rgb[0] + g[0] * c.w, rgb[1] + g[1] * c.w, rgb[2] + g[2] * c.w] }
    let w = smooth(0.3, 0.6, best)
    // overrides, weakest first; each one that takes over (> 0.5) names the terrain
    const set = (to: string, k: number) => { if (k <= 0) return; rgb = mix(rgb, paint(to), k); if (k > 0.5) { id = to; w = Math.max(k, 0.7) } }
    if (h < 14 && temp > -4) set('beach', 1 - smooth(3, 14, h))
    if (h < 90 && temp > 6 && m0 > 0.55) set('swamp', smooth(0.5, 0.72, m0 + 0.35 * mid) * (1 - smooth(20, 90, h)))
    if (h > 1200) set('alpine', smooth(1200, 1900, h) * (1 - smooth(0.25, 0.5, slope)) * smooth(6, 2, temp) * (1 - smooth(-4, -9, temp))) // between the tree line and the snow line
    if (temp < -8 && h > 1500) set('glacier', smooth(-8, -12, temp))
    set('rock', Math.max(smooth(0.28, 0.62, slope), smooth(2600, 4200, h) * 0.85))
    set('snow', smooth(-3, -10, temp + 6 * big) * (1 - smooth(0.5, 0.9, slope) * 0.6)) // patchy, thinner on cliffs
    let pid = '', pw = 0
    if (paints.length) { const p: Vec = [x, y, z]; for (const c of paints) if (near(c, x, y, z)) { const k = c.paint!(p); if (k > 0 && k >= pw) { pw = k; pid = c.terrain! } } }
    if (pid) {
      // the rim breaks up into patches (clearings, scattered trees) instead of a clean line, and fades through the terrain's fringe type
      pw += 0.5 * 4 * pw * (1 - pw) * (0.8 * mid + 1.1 * fine)
      const fr = TERRAINS[pid].fringe
      if (fr && pw < 0.5) set(fr, smooth(0.04, 0.2, pw))
      rgb = mix(rgb, paint(pid), smooth(0.15, 0.7, pw)); if (pw > 0.5) { id = pid; w = 1 }
    }
    const k = 1 + 0.16 * fbm(nHill, x * 20, y * 20, z * 20, 1 + detail) // ground texture
    return { id, w, rgb: [rgb[0] * k, rgb[1] * k, rgb[2] * k] }
  }

  const color = (x: number, y: number, z: number, h: number, slope = 0, detail = 0): Vec => {
    const w = water(x, y, z, h)
    if (w) {
      const { temp } = climate(x, y, z, h)
      if (w.kind === 'sea') return temp < -10 ? SEA_ICE : mix(SHALLOW, DEEP, Math.pow(Math.min(1, -h / 5500), 0.45))
      return temp < -12 ? SEA_ICE : w.kind === 'river' ? RIVER : mix(LAKE, DEEP, Math.min(1, (w.level - h) / 400) * 0.6)
    }
    return ground(x, y, z, h, slope, detail).rgb
  }

  const terrain = (x: number, y: number, z: number, h: number, slope = 0, detail = 0) => {
    if (water(x, y, z, h)) return { id: '', w: 0 }
    const g = ground(x, y, z, h, slope, detail)
    return { id: g.id, w: g.w }
  }

  const biome = (x: number, y: number, z: number, h: number) => {
    const { temp } = climate(x, y, z, h)
    const w = water(x, y, z, h)
    if (w?.kind === 'lake') return 'Lake'
    if (w?.kind === 'river') return 'River'
    if (h < 0) return temp < -10 ? 'Sea ice' : h > -200 ? 'Shallow sea' : 'Ocean'
    return TERRAINS[ground(x, y, z, h, 0, 4).id]?.label ?? 'Land'
  }

  return { world, radiusM: P.radiusKm * 1000, elevation, climate, color, biome, terrain, water, surface, ops, course }
}
