// Draws the vector side of a flat map (rivers, layers, labels) onto a 2D canvas in screen pixels. Browser only.
import type { MapStyle, Proj } from './flat.ts'
import type { LatLon } from './geo.ts'
import { drawGlyphs } from './glyphs.ts'
import { collectLabels, placeLabels } from './labels.ts'
import { DERIVED_LAYERS, layerColor, pointSize } from './layers.ts'
import { markerPx } from './sites.ts'
import { drawSite } from './siteGlyphs.ts'
import type { Planet, World } from './terrain.ts'

// straight lat/lon steps of at most 1 degree, so lines bend with the projection
const dens = (pts: LatLon[]) => pts.flatMap((a, i) => {
  if (!i) return [a]
  const b = pts[i - 1], dl = ((a[1] - b[1] + 540) % 360) - 180, n = Math.max(1, Math.ceil(Math.max(Math.abs(a[0] - b[0]), Math.abs(dl))))
  return Array.from({ length: n }, (_, s) => [b[0] + (a[0] - b[0]) * (s + 1) / n, b[1] + dl * (s + 1) / n] as LatLon)
})

// ponytail: lines that cross the antimeridian are broken, but filled areas that straddle it are not split
function trace(ctx: CanvasRenderingContext2D, p: Proj, pts: LatLon[]) {
  let prev: [number, number] | undefined
  ctx.beginPath()
  for (const ll of dens(pts)) {
    const q = p.fwd(ll[0], ll[1])
    if (!prev || Math.abs(q[0] - prev[0]) > p.mapW / 2) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1])
    prev = q
  }
}

const THEMES: Record<MapStyle, { fill: string; halo: string; serif: boolean }> = {
  atlas: { fill: '#3b2a1a', halo: 'rgba(244,234,208,.9)', serif: true },
  terrain: { fill: '#fff', halo: 'rgba(0,0,0,.65)', serif: false },
  hypso: { fill: '#1d2a24', halo: 'rgba(255,255,255,.8)', serif: false },
  relief: { fill: '#1d2a24', halo: 'rgba(255,255,255,.8)', serif: false },
  dark: { fill: '#e8f1f4', halo: 'rgba(5,8,11,.85)', serif: false },
  political: { fill: '#222', halo: 'rgba(255,255,255,.85)', serif: false },
}

/** k = device pixels per CSS pixel, so lines and text keep their size on hi-dpi screens. */
export function drawOverlays(ctx: CanvasRenderingContext2D, planet: Planet, world: World, p: Proj, style: MapStyle, showLabels: boolean, k = 1) {
  const theme = THEMES[style], W = ctx.canvas.width, H = ctx.canvas.height
  drawGlyphs(ctx, planet, p, style, k)
  ctx.lineCap = 'round'
  for (const op of world.ops ?? []) if (op.kind === 'river') drawRiver(ctx, p, planet.course(op), op.width ?? 5, k)
  for (const l of world.layers ?? []) {
    if (l.hidden) continue
    const col = layerColor(l), a = l.opacity ?? 1
    for (const it of l.items) {
      ctx.strokeStyle = col; ctx.fillStyle = col
      if (it.area) {
        trace(ctx, p, [...it.area, it.area[0]])
        ctx.globalAlpha = a * 0.25; ctx.fill()
        ctx.globalAlpha = a; ctx.lineWidth = 1.5 * k; ctx.stroke()
      } else if (it.path) {
        trace(ctx, p, it.path)
        ctx.globalAlpha = a; ctx.lineWidth = 1.8 * k; ctx.setLineDash(l.kind === 'borders' ? [6 * k, 4 * k] : []); ctx.stroke(); ctx.setLineDash([])
      } else if (it.at) {
        const [x, y] = p.fwd(it.at[0], it.at[1]), r = pointSize(it) * k / 2
        ctx.globalAlpha = a
        if (!DERIVED_LAYERS.has(l.id) && drawSite(ctx, it, x, y, markerPx(it) * 1.45 * k, col, '#1a1410')) { ctx.globalAlpha = 1; continue }
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill(); ctx.lineWidth = 1.5 * k; ctx.strokeStyle = '#1a1410'; ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
  }
  if (!showLabels) return

  ctx.textAlign = 'center'; ctx.lineJoin = 'round'
  const font = (l: { size: number; italic: boolean }) => `${l.italic ? 'italic ' : ''}${l.size * k}px ${theme.serif ? 'Georgia, serif' : 'system-ui, sans-serif'}`
  const placed = placeLabels(collectLabels(world).map((l) => l.dot ? { ...l, dot: l.dot * 2.1 } : l),(l) => { const [x, y] = p.fwd(l.at[0], l.at[1]); return [x, y] }, (l) => { ctx.font = font(l); return ctx.measureText(l.text).width }, W, H, k)
  for (const { label, x, y } of placed) {
    ctx.font = font(label); ctx.lineWidth = 3 * k
    ctx.strokeStyle = theme.halo; ctx.strokeText(label.text, x, y)
    ctx.fillStyle = theme.fill; ctx.fillText(label.text, x, y)
  }
}

/** A river as a tapered ribbon: thin at the source, wide at the mouth, in screen pixels at the map's zoom (width is exaggerated on purpose). */
function drawRiver(ctx: CanvasRenderingContext2D, p: Proj, course: LatLon[], widthKm: number, k: number) {
  const pts = dens(course), n = pts.length
  if (n < 2) return
  const grow = Math.max(1, Math.pow(p.scale / 200, 0.4)) // wider than life, and still growing as you zoom in
  const px = (t: number) => Math.max(1.5, Math.min(26, (0.35 + 0.65 * t) * widthKm * 0.5 * grow)) * k
  ctx.strokeStyle = '#3d7fc4'; ctx.lineCap = 'round'
  let prev: [number, number] | undefined
  for (let i = 0; i < n; i++) {
    const q = p.fwd(pts[i][0], pts[i][1])
    if (prev && Math.abs(q[0] - prev[0]) < p.mapW / 2) { ctx.lineWidth = px(i / (n - 1)); ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke() }
    prev = q
  }
}
