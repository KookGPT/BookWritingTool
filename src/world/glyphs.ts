// Terrain symbols for the flat map: peaks that grow with height, hills, trees, dunes, crystals... one per cell of a
// jittered grid anchored to the map (so they pan and zoom with it, never shimmer), taller than life on purpose.
// A cell's ground (height and terrain) is looked up once and cached. Browser only (draws to a canvas).
import type { MapStyle, Proj } from './flat.ts'
import { toDir } from './geo.ts'
import { hash4 } from './noise.ts'
import type { Planet } from './terrain.ts'
import { TERRAINS, type Glyph } from './terrains.ts'

interface Cell { ll: [number, number]; id: string; h: number }
const caches = new WeakMap<Planet, Map<string, Cell | null>>()
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

// what each basemap shows: everything, only the relief (peaks and hills), or nothing
const SHOW: Record<MapStyle, 'all' | 'relief' | 'off'> = { atlas: 'all', terrain: 'all', hypso: 'relief', relief: 'relief', dark: 'relief', political: 'off' }
interface Pal { ink: string; tree: string; pine: string; peak: string; shade: string; snow: string; hill: string; sand: string; reed: string; crystal: string[]; cap: string[]; lava: string; ash: string }
const ATLAS: Pal = { ink: '#4a3622', tree: '#86a35a', pine: '#5d7d4e', peak: '#dcc79c', shade: '#a98c5f', snow: '#fffdf4', hill: '#e0cda4', sand: '#a07f4c', reed: '#7a8a4a', crystal: ['#7fc7d9', '#b59be0'], cap: ['#c6577a', '#d9923c'], lava: '#d9582a', ash: '#6e665e' }
const PAL: Record<MapStyle, Pal> = {
  atlas: ATLAS,
  terrain: { ...ATLAS, ink: '#1c2414', tree: '#3f8a36', pine: '#2c6a42', peak: '#c4bcae', shade: '#766e60', hill: '#b4a37a', sand: '#8a6a38', reed: '#5f7a34', crystal: ['#6fe0ee', '#c49dff'], cap: ['#f0508a', '#ffb347'], lava: '#ff7a30', ash: '#4a4440' },
  hypso: { ...ATLAS, ink: '#3c3428', peak: '#d9d2c6', shade: '#8a8070', hill: '#c8bda8' },
  relief: { ...ATLAS, ink: '#4a4a4a', peak: '#e4e2dc', shade: '#9a9890', hill: '#d2d0c8' },
  dark: { ...ATLAS, ink: '#0a1216', peak: '#7e8e94', shade: '#4a5860', hill: '#5e6e74', snow: '#e6f0f2' },
  political: ATLAS,
}

/** Draws one glyph with its base at (x, y); s is its height in pixels. */
function glyph(ctx: CanvasRenderingContext2D, g: Glyph, x: number, y: number, s: number, c: Pal, h: number, flip: number) {
  ctx.lineWidth = Math.max(1, s * 0.07); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = c.ink
  const poly = (pts: number[][], fill: string, stroke = true) => {
    ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(x + a * s * flip, y - b * s) : ctx.moveTo(x + a * s * flip, y - b * s))); ctx.closePath()
    ctx.fillStyle = fill; ctx.fill(); if (stroke) ctx.stroke()
  }
  const line = (pts: number[][]) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(x + a * s * flip, y - b * s) : ctx.moveTo(x + a * s * flip, y - b * s))); ctx.stroke() }
  const disc = (a: number, b: number, r: number, fill: string) => { ctx.beginPath(); ctx.arc(x + a * s * flip, y - b * s, r * s, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.stroke() }
  switch (g) {
    case 'peak':
      poly([[-0.62, 0], [0, 1], [0.62, 0]], c.peak)
      poly([[0.02, 0.96], [0.62, 0], [0.12, 0]], c.shade, false)
      if (h > 3400) poly([[-0.2, 0.62], [0, 1], [0.2, 0.62], [0.08, 0.68], [-0.02, 0.58], [-0.1, 0.66]], c.snow)
      ctx.beginPath(); ctx.moveTo(x - 0.62 * s, y); ctx.lineTo(x, y - s); ctx.lineTo(x + 0.62 * s, y); ctx.stroke()
      break
    case 'hill': ctx.beginPath(); ctx.arc(x, y, s * 0.5, Math.PI, 0); ctx.fillStyle = c.hill; ctx.fill(); ctx.stroke(); break
    case 'tree': line([[0, 0], [0, 0.3]]); disc(0, 0.58, 0.3, c.tree); break
    case 'pine': line([[0, 0], [0, 0.2]]); poly([[-0.34, 0.2], [0, 0.78], [0.34, 0.2]], c.pine); poly([[-0.26, 0.5], [0, 1], [0.26, 0.5]], c.pine); break
    case 'palm': line([[0, 0], [0.12, 0.45], [0.04, 0.8]]); ctx.strokeStyle = c.tree; line([[0.04, 0.8], [-0.34, 0.62]]); line([[0.04, 0.8], [0.4, 0.62]]); line([[0.04, 0.8], [-0.2, 0.98]]); line([[0.04, 0.8], [0.28, 0.98]]); break
    case 'dune': ctx.strokeStyle = c.sand; line([[-0.5, 0.1], [-0.25, 0.4], [0, 0.1]]); line([[0, 0.1], [0.25, 0.4], [0.5, 0.1]]); break
    case 'reed': ctx.strokeStyle = c.reed; line([[-0.2, 0], [-0.26, 0.7]]); line([[0, 0], [0, 0.9]]); line([[0.2, 0], [0.28, 0.65]]); break
    case 'cactus': ctx.strokeStyle = c.tree; ctx.lineWidth = s * 0.14; line([[0, 0], [0, 0.85]]); line([[0, 0.35], [0.3, 0.35], [0.3, 0.6]]); line([[0, 0.5], [-0.28, 0.5], [-0.28, 0.72]]); break
    case 'crystal': poly([[0, 0], [-0.22, 0.45], [0, 1], [0.22, 0.45]], c.crystal[0]); poly([[0.2, 0], [0.4, 0.3], [0.5, 0.7], [0.58, 0.3]], c.crystal[1]); break
    case 'mushroom': line([[0, 0], [0, 0.4]]); ctx.beginPath(); ctx.arc(x, y - 0.4 * s, 0.38 * s, Math.PI, 0); ctx.closePath(); ctx.fillStyle = c.cap[Math.abs(Math.round(h)) % 2]; ctx.fill(); ctx.stroke(); break
    case 'lava': poly([[0, 0], [-0.3, 0.4], [0, 1], [0.3, 0.4]], c.lava); break
    case 'ash': ctx.strokeStyle = c.ash; line([[-0.35, 0.1], [-0.1, 0.45]]); line([[0, 0.05], [0.25, 0.5]]); line([[0.3, 0.1], [0.5, 0.4]]); break
    case 'ice': ctx.strokeStyle = '#7fa6c4'; line([[-0.3, 0.1], [0.3, 0.7]]); line([[0.3, 0.1], [-0.3, 0.7]]); line([[0, 0], [0, 0.8]]); break
    case 'grass': ctx.strokeStyle = c.reed; line([[-0.3, 0.45], [-0.1, 0], [0, 0.4]]); line([[0, 0.4], [0.1, 0], [0.3, 0.45]]); break
    case 'dead': line([[0, 0], [0, 0.85]]); line([[0, 0.45], [0.3, 0.75]]); line([[0, 0.6], [-0.26, 0.9]]); break
    case 'salt': ctx.strokeStyle = '#9fb7c4'; line([[-0.4, 0.15], [0.4, 0.15]]); line([[-0.25, 0.4], [0.25, 0.4]]); break
  }
}

/** k = device pixels per CSS pixel. */
export function drawGlyphs(ctx: CanvasRenderingContext2D, planet: Planet, p: Proj, style: MapStyle, k: number) {
  const mode = SHOW[style]
  if (mode === 'off') return
  const { view: v, w: W, h: H } = p, s = v.s, n = Math.ceil(Math.log2(34 * k / s)), su = 2 ** n // cells 34..68 px apart
  let cache = caches.get(planet)
  if (!cache) caches.set(planet, cache = new Map())
  if (cache.size > 60000) cache.clear()
  const pal = PAL[style], found: { x: number; y: number; g: Glyph; size: number; h: number; flip: number }[] = []
  for (let j = Math.floor((v.y - H / 2 / s) / su); j <= Math.floor((v.y + H / 2 / s) / su); j++) for (let i = Math.floor((v.x - W / 2 / s) / su); i <= Math.floor((v.x + W / 2 / s) / su); i++) {
    const ux = (i + 0.15 + 0.7 * hash4(i, j, n, 1)) * su, uy = (j + 0.15 + 0.7 * hash4(i, j, n, 2)) * su
    const px = W / 2 + (ux - v.x) * s, py = H / 2 - (uy - v.y) * s
    if (px < -40 || py < -60 || px > W + 40 || py > H + 40) continue
    const key = `${p.name}|${n}|${i}|${j}`
    let c = cache.get(key)
    if (c === undefined) {
      c = null
      const ll = p.inv(px, py)
      if (ll) {
        const d = toDir(ll[0], ll[1]), h = planet.elevation(d[0], d[1], d[2], 2)
        const t = h > 0 ? planet.terrain(d[0], d[1], d[2], h, 0.1, 2) : undefined
        if (t?.id) c = { ll, id: t.id, h }
      }
      cache.set(key, c)
    }
    if (!c) continue
    const r = hash4(i, j, n, 3), T = TERRAINS[c.id]
    let g: Glyph = 'none', size = 14
    if (c.h > 1500) { if (r < smooth(1500, 3600, c.h) * 0.9) { g = 'peak'; size = 10 + 30 * Math.min(1, c.h / 9000) } } // mountains pop: height is exaggerated
    else if (mode === 'all' || c.h > 500) {
      if (mode === 'all' && r < T.glyphDensity) g = T.glyph
      if ((g === 'none' || g === 'grass' || g === 'dune') && c.h > 450 && hash4(i, j, n, 4) < 0.45 * smooth(450, 1400, c.h)) { g = 'hill'; size = 12 }
      if (mode === 'relief' && g !== 'hill') g = 'none'
    }
    if (g === 'none') continue
    found.push({ x: px, y: py, g, size: size * (0.85 + 0.3 * hash4(i, j, n, 5)) * 1.3 * k, h: c.h, flip: hash4(i, j, n, 6) < 0.5 ? 1 : -1 })
  }
  found.sort((a, b) => a.y - b.y) // nearer (lower) ones draw over farther ones
  for (const f of found) glyph(ctx, f.g, f.x, f.y, f.size, pal, f.h, f.flip)
}
