// Little map icons for settlements and structures on the flat map: one stylised pictogram per site type, drawn in a box of
// side `s` centred on the point. Settlements grow with their tier (a lone hut up to a skyline). Browser only (canvas).
import { siteOf, tierOf, popOf } from './sites.ts'
import type { LayerItem } from './layers.ts'

type Poly = number[][]
// the box is -0.5..0.5 with y pointing down; the ground line is y = 0.4
const G = 0.4
const house = (cx: number, w: number, h: number): Poly => [[cx - w, G], [cx - w, G - h], [cx, G - h - w * 0.85], [cx + w, G - h], [cx + w, G]]
const block = (cx: number, w: number, h: number): Poly => [[cx - w, G], [cx - w, G - h], [cx + w, G - h], [cx + w, G]]
const spire = (cx: number, w: number, h: number, t: number): Poly => [[cx - w, G], [cx - w, G - h], [cx, G - h - t], [cx + w, G - h], [cx + w, G]]
const crenel = (cx: number, w: number, h: number): Poly => { // a tower with a notched top
  const x0 = cx - w, x1 = cx + w, y = G - h, n = w * 0.5
  return [[x0, G], [x0, y - n], [x0 + n, y - n], [x0 + n, y], [cx - n / 2, y], [cx - n / 2, y - n], [cx + n / 2, y - n], [cx + n / 2, y], [x1 - n, y], [x1 - n, y - n], [x1, y - n], [x1, G]]
}

const ICONS: Record<string, (tier: number) => Poly[]> = {
  settlement: (t) => [
    ...[[house(0, 0.2, 0.22)], [house(-0.26, 0.17, 0.2), house(0.2, 0.22, 0.26)], [house(-0.34, 0.14, 0.18), spire(0, 0.12, 0.3, 0.3), house(0.32, 0.15, 0.2)],
      [crenel(-0.38, 0.1, 0.34), block(-0.14, 0.12, 0.28), spire(0.06, 0.1, 0.5, 0.26), block(0.26, 0.13, 0.3), crenel(0.44, 0.08, 0.34)],
      [crenel(-0.4, 0.1, 0.36), block(-0.2, 0.1, 0.3), spire(0, 0.11, 0.55, 0.3), block(0.2, 0.1, 0.34), crenel(0.4, 0.1, 0.36)],
      [block(-0.4, 0.07, 0.4), block(-0.26, 0.07, 0.55), block(-0.12, 0.07, 0.38), spire(0.03, 0.07, 0.78, 0.16), block(0.18, 0.07, 0.5), block(0.32, 0.07, 0.34), block(0.44, 0.05, 0.42)],
      [block(-0.44, 0.06, 0.5), block(-0.32, 0.06, 0.78), block(-0.2, 0.06, 0.6), block(-0.08, 0.06, 0.9), spire(0.06, 0.06, 0.7, 0.18), block(0.18, 0.06, 0.58), block(0.3, 0.06, 0.82), block(0.42, 0.06, 0.46)]][Math.min(5, t)],
    ...(t >= 3 ? [[[-0.48, G], [-0.48, G + 0.08], [0.48, G + 0.08], [0.48, G]]] : []), // the walls
  ],
  farm: () => [house(-0.12, 0.3, 0.28), block(0.36, 0.1, 0.5), [[0.26, G - 0.5], [0.36, G - 0.66], [0.46, G - 0.5]]],
  manor: () => [house(-0.08, 0.42, 0.28), block(-0.34, 0.05, 0.5), block(0.18, 0.05, 0.5)],
  castle: () => [crenel(-0.36, 0.13, 0.58), crenel(0.36, 0.13, 0.58), crenel(0, 0.2, 0.82), block(-0.18, 0.08, 0.3), block(0.18, 0.08, 0.3)],
  fort: () => [crenel(0, 0.14, 0.7), block(-0.32, 0.18, 0.28), block(0.32, 0.18, 0.28)],
  tower: () => [spire(0, 0.15, 0.66, 0.3)],
  temple: () => [[[-0.46, -0.08], [0, -0.44], [0.46, -0.08]], block(-0.34, 0.07, 0.42), block(-0.12, 0.07, 0.42), block(0.12, 0.07, 0.42), block(0.34, 0.07, 0.42), [[-0.48, G], [-0.48, G + 0.07], [0.48, G + 0.07], [0.48, G]]],
  monastery: () => [house(-0.22, 0.3, 0.26), spire(0.28, 0.12, 0.5, 0.3)],
  mine: () => [[[-0.38, G], [-0.08, -0.4], [0.22, G]], [[-0.1, G], [-0.1, 0.1], [0.4, 0.1], [0.4, G]]],
  windmill: () => [[[-0.12, G], [-0.07, -0.1], [0.07, -0.1], [0.12, G]], [[-0.1, -0.1], [0, -0.22], [0.1, -0.1]]],
  lighthouse: () => [[[-0.12, G], [-0.07, -0.2], [0.07, -0.2], [0.12, G]], [[-0.12, -0.2], [-0.12, -0.34], [0.12, -0.34], [0.12, -0.2]], [[-0.14, -0.34], [0, -0.5], [0.14, -0.34]]],
  ruins: () => [[[-0.4, G], [-0.4, 0], [-0.3, -0.1], [-0.22, 0.05], [-0.14, G]], [[0.02, G], [0.02, -0.3], [0.12, -0.36], [0.16, G]], [[0.3, G], [0.3, 0.12], [0.42, 0.02], [0.44, G]]],
  camp: () => [[[-0.44, G], [-0.16, -0.22], [0.12, G]], [[0.02, G], [0.26, -0.04], [0.48, G]]],
  bridge: () => [[[-0.5, 0], [0.5, 0], [0.5, 0.1], [0.34, 0.1], [0.3, 0.3], [0.12, 0.38], [-0.12, 0.38], [-0.3, 0.3], [-0.34, 0.1], [-0.5, 0.1]]],
  port: () => [[[-0.42, 0.1], [0.42, 0.1], [0.28, 0.4], [-0.28, 0.4]], [[0.02, 0.06], [0.02, -0.5], [0.34, 0.06]]],
}

/** Draws the icon for a site item centred at (x, y) in a box of `s` px. Fill and ink are CSS colours. */
export function drawSite(ctx: CanvasRenderingContext2D, it: Pick<LayerItem, 'props'>, x: number, y: number, s: number, fill: string, ink: string) {
  const site = siteOf(it)
  if (!site) return false
  const make = site.def.cls === 'settlement' && site.id !== 'port' ? ICONS.settlement : ICONS[site.id]
  if (!make) return false
  const polys = make(tierOf(popOf(it)))
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, s * 0.06); ctx.strokeStyle = ink; ctx.fillStyle = fill
  for (const poly of polys) {
    ctx.beginPath()
    poly.forEach(([a, b], i) => (i ? ctx.lineTo(x + a * s, y + b * s) : ctx.moveTo(x + a * s, y + b * s)))
    ctx.closePath(); ctx.fill(); ctx.stroke()
  }
  if (site.id === 'windmill') { ctx.beginPath(); for (const a of [0.3, 1.87, 3.44, 5.01]) { ctx.moveTo(x, y - 0.1 * s); ctx.lineTo(x + Math.cos(a) * 0.5 * s, y - 0.1 * s + Math.sin(a) * 0.5 * s) } ctx.stroke() }
  return true
}
