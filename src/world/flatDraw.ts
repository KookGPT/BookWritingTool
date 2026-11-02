// Draws the vector side of a flat map (rivers, layers, labels) onto a 2D canvas in screen pixels. Browser only.
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

interface Label { text: string; at: LatLon; size: number; italic: boolean; prio: number; dot?: number }
interface Rect { x: number; y: number; w: number; h: number }
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** k = device pixels per CSS pixel, so lines and text keep their size on hi-dpi screens. */
export function drawOverlays(ctx: CanvasRenderingContext2D, planet: Planet, world: World, p: Proj, style: MapStyle, showLabels: boolean, k = 1) {
  const theme = THEMES[style], W = ctx.canvas.width, H = ctx.canvas.height
  const cands: Label[] = [], taken: Rect[] = [] // taken: point markers, so no name sits on top of a dot
  ctx.lineCap = 'round'
  for (const op of world.ops ?? []) {
    if (op.kind === 'river') { trace(ctx, p, planet.course(op)); ctx.strokeStyle = '#3d7fc4'; ctx.lineWidth = 1.5 * k; ctx.stroke() }
    if (op.name) cands.push({ text: op.name, at: opCenter(op), size: 11, italic: true, prio: 1 })
  }
  for (const l of world.layers ?? []) {
    if (l.hidden) continue
    const col = layerColor(l), a = l.opacity ?? 1
    for (const it of l.items) {
      ctx.strokeStyle = col; ctx.fillStyle = col
      let at: LatLon | undefined
      if (it.area) {
        trace(ctx, p, [...it.area, it.area[0]])
        ctx.globalAlpha = a * 0.25; ctx.fill()
        ctx.globalAlpha = a; ctx.lineWidth = 1.5 * k; ctx.stroke()
        at = [it.area.reduce((s, v) => s + v[0], 0) / it.area.length, it.area.reduce((s, v) => s + v[1], 0) / it.area.length]
        if (it.name) cands.push({ text: it.name, at, size: 12, italic: true, prio: 0 })
      } else if (it.path) {
        trace(ctx, p, it.path)
        ctx.globalAlpha = a; ctx.lineWidth = 1.8 * k; ctx.setLineDash(l.kind === 'borders' ? [6 * k, 4 * k] : []); ctx.stroke(); ctx.setLineDash([])
        if (it.name) cands.push({ text: it.name, at: it.path[Math.floor(it.path.length / 2)], size: 10, italic: true, prio: 6 })
      } else if (it.at) {
        const [x, y] = p.fwd(it.at[0], it.at[1]), r = pointSize(it) * k / 2
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.globalAlpha = a; ctx.fill(); ctx.lineWidth = 1.5 * k; ctx.strokeStyle = '#1a1410'; ctx.stroke()
        taken.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r })
        // bigger settlements are placed first, so they keep their names when space is tight
        if (it.name) cands.push({ text: it.name, at: it.at, size: 10, italic: false, prio: 2 + 4 / pointSize(it), dot: r })
      }
      ctx.globalAlpha = 1
    }
  }
  if (!showLabels) return

  // greedy placement: most important first; try centred, then above/below/beside; skip what still collides
  const pad = 2 * k
  ctx.textAlign = 'center'; ctx.lineJoin = 'round'
  for (const L of cands.sort((x, y) => x.prio - y.prio)) {
    const [x, y] = p.fwd(L.at[0], L.at[1])
    if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue
    const px = L.size * k
    ctx.font = `${L.italic ? 'italic ' : ''}${px}px ${theme.serif ? 'Georgia, serif' : 'system-ui, sans-serif'}`
    const w = ctx.measureText(L.text).width, h = px * 1.1, r = L.dot ?? 0
    const tries: [number, number][] = r
      ? [[0, -(r + 3 * k)], [0, r + h + k], [w / 2 + r + 4 * k, h * 0.3], [-(w / 2 + r + 4 * k), h * 0.3]]
      : [[0, h * 0.3], [0, -h * 0.8], [0, h * 1.5]]
    for (const [dx, dy] of tries) {
      const box: Rect = { x: x + dx - w / 2 - pad, y: y + dy - h * 0.85 - pad, w: w + 2 * pad, h: h + 2 * pad }
      if (box.x < 0 || box.y < 0 || box.x + box.w > W || box.y + box.h > H || taken.some((t) => hit(t, box))) continue
      taken.push(box)
      ctx.lineWidth = 3 * k
      ctx.strokeStyle = theme.halo; ctx.strokeText(L.text, x + dx, y + dy)
      ctx.fillStyle = theme.fill; ctx.fillText(L.text, x + dx, y + dy)
      break
    }
  }
}
