// Map labels, shared by the flat map and the 3D globe: what to name (named features, layer items) and a greedy,
// non-overlapping placement in screen space. Pure (no DOM): callers supply text widths and draw the result.
import type { LatLon } from './geo.ts'
import { pointSize } from './layers.ts'
import { opCenter } from './ops.ts'
import type { World } from './terrain.ts'

export interface Label { text: string; at: LatLon; size: number; italic: boolean; prio: number; dot?: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Placed { label: Label; x: number; y: number; w: number; h: number } // x, y: text anchor (centre, baseline); w, h: text box

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Every nameable thing in the world, most important first. Hidden layers are skipped. */
export function collectLabels(world: World): Label[] {
  const out: Label[] = []
  for (const op of world.ops ?? []) if (op.name) out.push({ text: op.name, at: opCenter(op), size: 11, italic: true, prio: 1 })
  for (const l of world.layers ?? []) {
    if (l.hidden) continue
    for (const it of l.items) {
      if (!it.name) continue
      if (it.area) out.push({ text: it.name, at: [it.area.reduce((s, v) => s + v[0], 0) / it.area.length, it.area.reduce((s, v) => s + v[1], 0) / it.area.length], size: 12, italic: true, prio: 0 })
      else if (it.path) out.push({ text: it.name, at: it.path[Math.floor(it.path.length / 2)], size: 10, italic: true, prio: 6 })
      else if (it.at) out.push({ text: it.name, at: it.at, size: 10, italic: false, prio: 2 + 4 / pointSize(it), dot: pointSize(it) / 2 }) // bigger settlements first
    }
  }
  return out.sort((a, b) => a.prio - b.prio)
}

/**
 * Greedy placement: most important first; centred, then above/below/beside; labels that still collide are dropped.
 * `at` projects a label to pixels (undefined when it is off screen or hidden); `measure` gives its text width in px
 * at the given scale; `taken` is pre-filled with rectangles to keep clear (point markers). k = device pixels per CSS pixel.
 */
export function placeLabels(labels: Label[], at: (l: Label) => [number, number] | undefined, measure: (l: Label) => number, W: number, H: number, k: number, taken: Rect[] = []): Placed[] {
  const out: Placed[] = [], pad = 2 * k, spots: { l: Label; x: number; y: number }[] = []
  for (const l of labels) {
    const p = at(l)
    if (!p) continue
    spots.push({ l, x: p[0], y: p[1] })
    if (l.dot) { const r = l.dot * k; taken.push({ x: p[0] - r, y: p[1] - r, w: 2 * r, h: 2 * r }) }
  }
  for (const { l, x, y } of spots) {
    if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue
    const px = l.size * k, w = measure(l), h = px * 1.1, r = (l.dot ?? 0) * k
    const tries: [number, number][] = r
      ? [[0, -(r + 3 * k)], [0, r + h + k], [w / 2 + r + 4 * k, h * 0.3], [-(w / 2 + r + 4 * k), h * 0.3]]
      : [[0, h * 0.3], [0, -h * 0.8], [0, h * 1.5]]
    for (const [dx, dy] of tries) {
      const box: Rect = { x: x + dx - w / 2 - pad, y: y + dy - h * 0.85 - pad, w: w + 2 * pad, h: h + 2 * pad }
      if (box.x < 0 || box.y < 0 || box.x + box.w > W || box.y + box.h > H || taken.some((t) => hit(t, box))) continue
      taken.push(box)
      out.push({ label: l, x: x + dx, y: y + dy, w, h })
      break
    }
  }
  return out
}
