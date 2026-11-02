// Draws the vector side of a flat map (rivers, layers, labels) onto a 2D canvas. Browser only.
import type { MapStyle, Proj } from './flat.ts'
import type { LatLon } from './geo.ts'
import { layerColor, pointSize } from './layers.ts'
import { opCenter } from './ops.ts'
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
    if (!prev || Math.abs(q[0] - prev[0]) > p.w / 2) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1])
    prev = q
  }
}

export function drawOverlays(ctx: CanvasRenderingContext2D, planet: Planet, world: World, p: Proj, style: MapStyle, labels: boolean) {
  const k = Math.max(0.8, p.w / 1200), atlas = style === 'atlas'
  const text = (s: string, ll: LatLon, size: number, italic = false) => {
    const [x, y] = p.fwd(ll[0], ll[1])
    ctx.font = `${italic ? 'italic ' : ''}${size * k}px ${atlas ? 'Georgia, serif' : 'system-ui, sans-serif'}`
    ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 3 * k
    ctx.strokeStyle = atlas ? 'rgba(244,234,208,.9)' : 'rgba(0,0,0,.65)'; ctx.strokeText(s, x, y)
    ctx.fillStyle = atlas ? '#3b2a1a' : '#fff'; ctx.fillText(s, x, y)
  }
  ctx.lineCap = 'round'
  for (const op of world.ops ?? []) {
    if (op.kind === 'river') { trace(ctx, p, planet.course(op)); ctx.strokeStyle = '#3d7fc4'; ctx.lineWidth = 1.5 * k; ctx.stroke() }
    if (labels && op.name) {
      const [lat, lon] = opCenter(op)
      text(op.name, [lat, lon], 11, true)
    }
  }
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
        const [x, y] = p.fwd(it.at[0], it.at[1])
        ctx.beginPath(); ctx.arc(x, y, pointSize(it) * k / 2, 0, Math.PI * 2)
        ctx.globalAlpha = a; ctx.fill(); ctx.lineWidth = 1.5 * k; ctx.strokeStyle = '#1a1410'; ctx.stroke()
      }
      ctx.globalAlpha = 1
      if (labels && it.name) {
        const c: LatLon = it.at ?? (() => { const q = it.path ?? it.area!, m = q[Math.floor(q.length / 2)]; return it.area ? [q.reduce((s, v) => s + v[0], 0) / q.length, q.reduce((s, v) => s + v[1], 0) / q.length] : m })()
        text(it.name, it.at ? [c[0] + 1.6 * k, c[1]] : c, it.at ? 10 : 12, !it.at)
      }
    }
  }
}
