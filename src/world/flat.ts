// Flat maps: projections and a pure raster painter (terrain or atlas/parchment style, optional contour lines).
// Pure (no DOM) so the page and tests share it; overlays (rivers, layers, labels) are drawn by flatDraw.ts.
import { toDir, type Planet } from './terrain.ts'

export type ProjName = 'equirect' | 'mercator' | 'robinson'
export type MapStyle = 'terrain' | 'atlas'
export const PROJECTIONS: Record<ProjName, string> = { equirect: 'Equirectangular', mercator: 'Mercator', robinson: 'Robinson' }

const D = Math.PI / 180
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const MERC_LAT = 85

// Robinson's lookup tables, every 5 degrees of latitude from 0 to 90
const PLEN = [1, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322]
const PDFE = [0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1]
const tab = (t: number[], lat: number) => {
  const a = clamp(Math.abs(lat), 0, 90) / 5, i = Math.min(17, Math.floor(a))
  return t[i] + (t[i + 1] - t[i]) * (a - i)
}

export interface Proj {
  w: number; h: number
  /** [lat, lon] degrees -> pixel [x, y] */
  fwd(lat: number, lon: number): [number, number]
  /** pixel -> [lat, lon], or undefined outside the map (Robinson corners) */
  inv(px: number, py: number): [number, number] | undefined
}

export function makeProj(name: ProjName, w: number): Proj {
  // each projection is a pair of functions in unit coordinates (x within +-X, y within +-Y)
  let X = Math.PI, Y: number
  let f: (lat: number, lon: number) => [number, number], g: (x: number, y: number) => [number, number] | undefined
  if (name === 'mercator') {
    Y = Math.log(Math.tan(Math.PI / 4 + MERC_LAT * D / 2))
    f = (la, lo) => [lo * D, Math.log(Math.tan(Math.PI / 4 + clamp(la, -MERC_LAT, MERC_LAT) * D / 2))]
    g = (x, y) => [(2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D, x / D]
  } else if (name === 'robinson') {
    X = 0.8487 * Math.PI; Y = 1.3523
    f = (la, lo) => [0.8487 * tab(PLEN, la) * lo * D, 1.3523 * tab(PDFE, la) * Math.sign(la)]
    g = (x, y) => {
      const ay = Math.abs(y) / 1.3523
      let i = 0
      while (i < 17 && ay > PDFE[i + 1]) i++
      const lat = (i + (ay - PDFE[i]) / (PDFE[i + 1] - PDFE[i])) * 5, lon = x / (0.8487 * tab(PLEN, lat)) / D
      return Math.abs(lon) > 180 ? undefined : [Math.sign(y) * lat, lon]
    }
  } else {
    Y = Math.PI / 2
    f = (la, lo) => [lo * D, la * D]
    g = (x, y) => [y / D, x / D]
  }
  const h = Math.round(w * Y / X)
  return {
    w, h,
    fwd: (la, lo) => { const [x, y] = f(la, ((lo + 540) % 360) - 180); return [(x + X) / (2 * X) * w, (Y - y) / (2 * Y) * h] },
    inv: (px, py) => g((px / w * 2 - 1) * X, (1 - py / h * 2) * Y),
  }
}

export interface Samples { hs: Float32Array; wet: Uint8Array; ok: Uint8Array }

/** Elevation and water per pixel. The slow part, so callers cache it while only the style changes. */
export function sampleFlat(planet: Planet, p: Proj): Samples {
  const { w, h } = p, hs = new Float32Array(w * h), wet = new Uint8Array(w * h), ok = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ll = p.inv(x + 0.5, y + 0.5)
    if (!ll) continue
    const d = toDir(ll[0], ll[1]), e = planet.elevation(d[0], d[1], d[2], 0), k = y * w + x, water = planet.water(d[0], d[1], d[2], e)
    hs[k] = e; ok[k] = 1; wet[k] = water && water.kind !== 'river' ? 1 : 0 // rivers are drawn as lines instead
  }
  return { hs, wet, ok }
}

const INK = [92, 68, 46]
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)

/** Paints RGBA into `out` (w*h*4). contour = metres between contour lines, 0 for none. */
export function paintFlat(planet: Planet, p: Proj, s: Samples, o: { style: MapStyle; contour: number }, out: Uint8ClampedArray) {
  const { w, h } = p, { hs, wet, ok } = s
  const px = planet.radiusM * 2 * Math.PI / w // metres per pixel at the equator, for hillshading
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, i = k * 4
    if (!ok[k]) { out[i + 3] = 0; continue }
    const e = x + 1 < w && ok[k + 1] ? k + 1 : k, n = y + 1 < h && ok[k + w] ? k + w : k
    const hh = hs[k], water = wet[k] === 1
    const shade = water ? 1 : clamp(1 + ((hh - Math.max(0, hs[e])) + (hh - Math.max(0, hs[n]))) / px * 4, o.style === 'atlas' ? 0.7 : 0.55, o.style === 'atlas' ? 1.2 : 1.35)
    let c: number[]
    if (o.style === 'atlas') {
      c = water ? mix(hh > 0 ? [170, 198, 205] : [186, 208, 206], [148, 176, 182], clamp(-hh / 4000, 0, 1)) : mix([236, 222, 186], [168, 132, 92], clamp(hh / 3500, 0, 1))
      if (wet[e] !== wet[k] || wet[n] !== wet[k]) c = mix(c, INK, 0.85) // coast
    } else {
      const d = toDir(...(p.inv(x + 0.5, y + 0.5) as [number, number]))
      c = Array.from(planet.color(d[0], d[1], d[2], hh, 0, 0))
    }
    if (o.contour > 0 && !water && hh > 0 && (Math.floor(hh / o.contour) !== Math.floor(hs[e] / o.contour) || Math.floor(hh / o.contour) !== Math.floor(hs[n] / o.contour))) c = mix(c, INK, 0.4)
    const m = water && o.style === 'atlas' ? 1 : shade
    out[i] = c[0] * m; out[i + 1] = c[1] * m; out[i + 2] = c[2] * m; out[i + 3] = 255
  }
}
