// Flat maps: projections with a pan/zoom view, and a pure raster painter (several basemap styles, optional contour lines).
// Pure (no DOM) so the page and tests share it; overlays (rivers, layers, labels) are drawn by flatDraw.ts.
import { toDir, type Planet } from './terrain.ts'

export type ProjName = 'equirect' | 'mercator' | 'robinson'
export type MapStyle = 'atlas' | 'terrain' | 'hypso' | 'relief' | 'dark' | 'political'
export const PROJECTIONS: Record<ProjName, string> = { equirect: 'Equirectangular', mercator: 'Mercator', robinson: 'Robinson' }
export const MAP_STYLES: Record<MapStyle, string> = {
  atlas: 'Atlas (parchment)', terrain: 'Terrain colours', hypso: 'Elevation tint', relief: 'Shaded relief (grey)', dark: 'Dark (night)', political: 'Political (flat)',
}

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

/** Half-extent of each projection in its own unit coordinates (the whole world spans +-X by +-Y). */
export const extent = (name: ProjName) => name === 'mercator' ? { X: Math.PI, Y: Math.log(Math.tan(Math.PI / 4 + MERC_LAT * D / 2)) }
  : name === 'robinson' ? { X: 0.8487 * Math.PI, Y: 1.3523 } : { X: Math.PI, Y: Math.PI / 2 }
/** Pixels per unit at which the whole world fits a w x h canvas. */
export const fitScale = (name: ProjName, w: number, h: number) => { const { X, Y } = extent(name); return Math.min(w / (2 * X), h / (2 * Y)) }

/** What part of the map is shown: the centre in unit coordinates and the zoom in pixels per unit. */
export interface View { x: number; y: number; s: number }
export interface Proj {
  w: number; h: number
  view: View
  scale: number // px per unit; the same as view.s
  mapW: number // width of the whole world in px at this zoom (lines that jump by more than half of it cross the antimeridian)
  /** [lat, lon] degrees -> pixel [x, y] */
  fwd(lat: number, lon: number): [number, number]
  /** pixel -> [lat, lon], or undefined outside the map */
  inv(px: number, py: number): [number, number] | undefined
}

/** Without `h` the canvas is cut to the map's own aspect; without `view` the whole world is fitted and centred. */
export function makeProj(name: ProjName, w: number, h?: number, view?: View): Proj {
  const { X, Y } = extent(name)
  // each projection is a pair of functions in unit coordinates
  let f: (lat: number, lon: number) => [number, number], g: (x: number, y: number) => [number, number] | undefined
  if (name === 'mercator') {
    f = (la, lo) => [lo * D, Math.log(Math.tan(Math.PI / 4 + clamp(la, -MERC_LAT, MERC_LAT) * D / 2))]
    g = (x, y) => Math.abs(y) > Y || Math.abs(x) > X ? undefined : [(2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D, x / D]
  } else if (name === 'robinson') {
    f = (la, lo) => [0.8487 * tab(PLEN, la) * lo * D, 1.3523 * tab(PDFE, la) * Math.sign(la)]
    g = (x, y) => {
      const ay = Math.abs(y) / 1.3523
      if (ay > 1) return undefined
      let i = 0
      while (i < 17 && ay > PDFE[i + 1]) i++
      const lat = (i + (ay - PDFE[i]) / (PDFE[i + 1] - PDFE[i])) * 5, lon = x / (0.8487 * tab(PLEN, lat)) / D
      return Math.abs(lon) > 180 ? undefined : [Math.sign(y) * lat, lon]
    }
  } else {
    f = (la, lo) => [lo * D, la * D]
    g = (x, y) => Math.abs(y) > Y || Math.abs(x) > X ? undefined : [y / D, x / D]
  }
  const s0 = h ? fitScale(name, w, h) : w / (2 * X), H = h ?? Math.round(2 * Y * s0), v = view ?? { x: 0, y: 0, s: s0 }
  return {
    w, h: H, view: v, scale: v.s, mapW: 2 * X * v.s,
    fwd: (la, lo) => { const [x, y] = f(la, ((lo + 540) % 360) - 180); return [w / 2 + (x - v.x) * v.s, H / 2 - (y - v.y) * v.s] },
    inv: (px, py) => g(v.x + (px - w / 2) / v.s, v.y - (py - H / 2) / v.s),
  }
}

/** Extra noise octaves for close-up views: one per doubling of zoom past a ~1400 px wide world. */
export const detailOf = (p: Proj) => clamp(Math.round(Math.log2(p.scale / (1400 / (2 * Math.PI)))), 0, 6)

export interface Samples { hs: Float32Array; wet: Uint8Array; ok: Uint8Array }

/** Elevation and water per pixel. The slow part, so callers cache it while only the style changes. */
export function sampleFlat(planet: Planet, p: Proj): Samples {
  const { w, h } = p, hs = new Float32Array(w * h), wet = new Uint8Array(w * h), ok = new Uint8Array(w * h), detail = detailOf(p)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ll = p.inv(x + 0.5, y + 0.5)
    if (!ll) continue
    const d = toDir(ll[0], ll[1]), e = planet.elevation(d[0], d[1], d[2], detail), k = y * w + x, water = planet.water(d[0], d[1], d[2], e)
    hs[k] = e; ok[k] = 1; wet[k] = water && water.kind !== 'river' ? 1 : 0 // rivers are drawn as lines instead
  }
  return { hs, wet, ok }
}

type RGB = number[]
const mix = (a: RGB, b: RGB, t: number) => a.map((v, i) => v + (b[i] - v) * t)
const ramp = (stops: [number, RGB][], v: number) => {
  if (v <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]))
  return stops[stops.length - 1][1]
}

interface Look { land(h: number): RGB; sea(h: number, lake: boolean): RGB; shade: [number, number]; ink: RGB; coast: boolean }
// terrain colours come from the planet itself, so it only supplies shading and ink here
const LOOKS: Record<MapStyle, Look> = {
  atlas: { land: (h) => mix([236, 222, 186], [168, 132, 92], clamp(h / 3500, 0, 1)), sea: (h, lake) => mix(lake ? [170, 198, 205] : [186, 208, 206], [148, 176, 182], clamp(-h / 4000, 0, 1)), shade: [0.7, 1.2], ink: [92, 68, 46], coast: true },
  terrain: { land: () => [0, 0, 0], sea: () => [0, 0, 0], shade: [0.55, 1.35], ink: [60, 50, 40], coast: false },
  hypso: {
    land: (h) => ramp([[0, [112, 168, 92]], [400, [186, 190, 108]], [1400, [204, 164, 100]], [3000, [152, 112, 82]], [5000, [244, 244, 244]]], h),
    sea: (h) => ramp([[-6000, [18, 46, 108]], [-2000, [44, 98, 160]], [0, [132, 196, 214]]], h), shade: [0.75, 1.2], ink: [60, 50, 40], coast: false,
  },
  relief: { land: (h) => mix([214, 214, 208], [160, 160, 156], clamp(h / 4500, 0, 1)), sea: (h) => mix([160, 174, 184], [128, 144, 158], clamp(-h / 4500, 0, 1)), shade: [0.45, 1.4], ink: [70, 70, 70], coast: true },
  dark: { land: (h) => mix([36, 50, 58], [112, 124, 128], clamp(h / 4000, 0, 1)), sea: (h) => mix([16, 28, 40], [8, 14, 24], clamp(-h / 5000, 0, 1)), shade: [0.7, 1.3], ink: [150, 185, 195], coast: true },
  political: { land: () => [233, 229, 214], sea: () => [176, 206, 226], shade: [1, 1], ink: [90, 90, 104], coast: true },
}

/** Paints RGBA into `out` (w*h*4). contour = metres between contour lines, 0 for none. */
export function paintFlat(planet: Planet, p: Proj, s: Samples, o: { style: MapStyle; contour: number }, out: Uint8ClampedArray) {
  const { w, h } = p, { hs, wet, ok } = s, L = LOOKS[o.style], detail = detailOf(p)
  const px = planet.radiusM / p.scale // metres per pixel, for hillshading
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, i = k * 4
    if (!ok[k]) { out[i + 3] = 0; continue }
    const e = x + 1 < w && ok[k + 1] ? k + 1 : k, n = y + 1 < h && ok[k + w] ? k + w : k
    const hh = hs[k], water = wet[k] === 1
    const shade = water || L.shade[0] === L.shade[1] ? 1 : clamp(1 + ((hh - Math.max(0, hs[e])) + (hh - Math.max(0, hs[n]))) / px * 4, L.shade[0], L.shade[1])
    let c: RGB
    if (o.style === 'terrain') {
      const d = toDir(...(p.inv(x + 0.5, y + 0.5) as [number, number]))
      c = Array.from(planet.color(d[0], d[1], d[2], hh, 0, detail))
    } else c = water ? L.sea(hh, hh > 0) : L.land(hh)
    if (L.coast && (wet[e] !== wet[k] || wet[n] !== wet[k])) c = mix(c, L.ink, 0.8)
    if (o.contour > 0 && !water && hh > 0 && (Math.floor(hh / o.contour) !== Math.floor(hs[e] / o.contour) || Math.floor(hh / o.contour) !== Math.floor(hs[n] / o.contour))) c = mix(c, L.ink, 0.4)
    out[i] = c[0] * shade; out[i + 1] = c[1] * shade; out[i + 2] = c[2] * shade; out[i + 3] = 255
  }
}
