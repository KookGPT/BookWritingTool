// Screen-space map layer drawn over the 3D view each frame: borders, roads, region outlines, city and landmark
// icons, labels (curved along rivers and ranges), the ruler and the shape being drawn. Lines and text keep a
// readable pixel size at every zoom. Also records what was drawn where, for hover and click picking.
import { placeLabels, type Label, type Rect } from '../world/labels.ts'
import { heightAt, itemShape, LAYER_KINDS, layerColor, pathLen, smoothPath, type CitySize, type FlatWorld, type Gen, type Landmark, type LayerKind, type MapItem, type XY } from './gen.ts'

export type Ref = { layer: string; id: string } | { feature: string }

export type LabelStyle = 'land' | 'sea' | 'water' | 'region' | 'range' | 'river' | 'road' | 'feature' | 'landmark' | CitySize
export interface MapLabel extends Label { style: LabelStyle; line?: XY[]; color?: string; area?: number; minZoom?: number } // minZoom: hide above this many km per px

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const STYLE: Record<LabelStyle, { px: number; weight?: number; italic?: boolean; caps?: boolean; spacing?: number; color: string }> = {
  land: { px: 20, weight: 700, caps: true, spacing: 0.35, color: '#3a2a18' },
  sea: { px: 15, italic: true, spacing: 0.25, color: '#1c4777' },
  water: { px: 11, italic: true, color: '#1c4777' },
  region: { px: 14, weight: 700, caps: true, spacing: 0.25, color: '#5a1f1f' },
  range: { px: 11.5, weight: 600, caps: true, spacing: 0.3, color: '#4a3424' },
  river: { px: 11, italic: true, spacing: 0.08, color: '#1d5590' },
  road: { px: 10, italic: true, color: '#5a3a1a' },
  feature: { px: 11, italic: true, color: '#3a2a18' },
  landmark: { px: 11, italic: true, color: '#3a2a18' },
  hamlet: { px: 10, color: '#2a1e14' },
  town: { px: 11.5, color: '#2a1e14' },
  city: { px: 13, weight: 600, color: '#24180f' },
  capital: { px: 14.5, weight: 700, color: '#24180f' },
}
export const fontOf = (s: LabelStyle, k: number, px = STYLE[s].px) => `${STYLE[s].italic ? 'italic ' : ''}${STYLE[s].weight ?? 400} ${px * k}px ${SERIF}`
const textOf = (l: MapLabel) => STYLE[l.style].caps ? l.text.toUpperCase() : l.text

// Landmark glyphs: 24px stroke paths, drawn in a parchment badge.
export const GLYPHS: Record<Landmark, string> = {
  castle: 'M5 21V9h3v3h2V9h4v3h2V9h3v12z M10 21v-4h4v4',
  tower: 'M8 21V8l4-5 4 5v13z M11 11h2 M8 21h8',
  temple: 'M3 9l9-6 9 6z M5 9v10 M9.5 9v10 M14.5 9v10 M19 9v10 M3 21h18',
  shrine: 'M3 6h18 M6 3h12 M7 6v15 M17 6v15 M7 11h10',
  ruins: 'M4 21V11h3v10 M10 21v-6h3v6 M16 21V7h3v14 M3 21h18',
  cave: 'M3 20c2-9 5-14 9-14s7 5 9 14z M9 20c0-4 1.5-6 3-6s3 2 3 6',
  monument: 'M10 21V7l2-4 2 4v14z M7 21h10',
  battle: 'M5 5l14 14 M19 5L5 19 M4 8l4-4 M16 4l4 4',
  port: 'M12 4v17 M8 8h8 M5 14a7 7 0 0 0 14 0 M12 4a1.5 1.5 0 1 0 0-.1',
  mine: 'M4 20L14 10 M10 6c4-2 8 0 9 4l-5 0z',
  camp: 'M3 20L12 4l9 16z M12 4v16 M9 20l3-5 3 5',
  lighthouse: 'M9 21l1-12h4l1 12z M10 9V6h4v3 M8 6h8 M3 6l3 1 M21 6l-3 1',
}
const glyphCache = new Map<string, Path2D>()
const glyph = (k: Landmark) => { let p = glyphCache.get(k); if (!p) glyphCache.set(k, p = new Path2D(GLYPHS[k] ?? GLYPHS.monument)); return p }
export const CITY_PX: Record<CitySize, number> = { hamlet: 3, town: 4.5, city: 6, capital: 8 }

export interface Hit { ref: Ref; pts?: number[]; x?: number; y?: number; r?: number } // a line (screen polyline) or a point
export interface HudState {
  world: FlatWorld; gen: Gen; labels: MapLabel[]; showLabels: boolean
  sel?: Ref; hover?: Ref
  draft?: { kind: LayerKind; pts: XY[]; clicks: XY[]; curve: boolean }
  ruler?: { pts: XY[]; cursor?: XY; speed: number }
  snap?: XY
  night?: number // 0..1: cities glow
}
export interface HudView { proj: (x: number, y: number) => [number, number] | undefined; k: number; w: number; h: number; kmPerPx: number }

/** Map points every few km along a path, so the projected line hugs the terrain. */
export function dense(pts: XY[], step: number, closed = false) {
  const out: XY[] = []
  const n = closed ? pts.length : pts.length - 1
  for (let q = 0; q < n; q++) {
    const [ax, ay] = pts[q], [bx, by] = pts[(q + 1) % pts.length], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let s = 0; s < m; s++) out.push([ax + (bx - ax) * s / m, ay + (by - ay) * s / m])
  }
  out.push(closed ? pts[0] : pts[pts.length - 1])
  return out
}

export class Hud {
  hits: Hit[] = []
  draw(ctx: CanvasRenderingContext2D, v: HudView, st: HudState) {
    const { k } = v, hits: Hit[] = []
    ctx.clearRect(0, 0, v.w * k, v.h * k)
    ctx.lineJoin = ctx.lineCap = 'round'
    const step = Math.max(st.gen.cell * 2, v.kmPerPx * 6)
    // screen polyline (device px) of a map path; NaN breaks where a point is behind the camera
    const line = (pts: XY[], closed = false, landOnly = false) => {
      const out: number[] = []
      for (const [x, y] of dense(pts, step, closed)) { const p = landOnly && heightAt(st.gen, x, y) < -15 ? undefined : v.proj(x, y); if (p) out.push(p[0] * k, p[1] * k); else out.push(NaN, NaN) }
      return out
    }
    const stroke = (s: number[]) => {
      ctx.beginPath()
      let pen = false
      for (let q = 0; q < s.length; q += 2) {
        if (Number.isNaN(s[q])) { pen = false; continue }
        if (pen) ctx.lineTo(s[q], s[q + 1]); else ctx.moveTo(s[q], s[q + 1])
        pen = true
      }
      ctx.stroke()
    }
    const isSel = (r: Ref) => st.sel && 'id' in st.sel && 'id' in r && st.sel.id === r.id
    const isHov = (r: Ref) => st.hover && 'id' in st.hover && 'id' in r && st.hover.id === r.id

    // 1. lines: region outlines, borders, roads
    const points: { it: MapItem; layer: string; kind: LayerKind; color: string }[] = []
    for (const l of st.world.layers ?? []) {
      if (l.hidden) continue
      const color = layerColor(l)
      for (const it of l.items) {
        const ref = { layer: l.id, id: it.id }, em = isSel(ref) ? 1.8 : isHov(ref) ? 1.35 : 1
        if (it.at) { points.push({ it, layer: l.id, kind: l.kind, color }); continue }
        const s = line(itemShape(it), !!it.area, l.kind === 'regions')
        hits.push({ ref, pts: s })
        ctx.setLineDash([])
        if (l.kind === 'regions') {
          ctx.strokeStyle = color + '55'; ctx.lineWidth = 7 * k * em; stroke(s)
          ctx.strokeStyle = color; ctx.lineWidth = 1.6 * k * em; stroke(s)
        } else if (l.kind === 'borders') {
          ctx.strokeStyle = 'rgba(255,248,235,.65)'; ctx.lineWidth = 4.5 * k * em; stroke(s)
          ctx.strokeStyle = color; ctx.lineWidth = 2.2 * k * em; ctx.setLineDash([9 * k, 3 * k, 2 * k, 3 * k]); stroke(s)
        } else {
          ctx.strokeStyle = 'rgba(255,248,235,.5)'; ctx.lineWidth = 3.5 * k * em; stroke(s)
          ctx.strokeStyle = color; ctx.lineWidth = 2 * k * em; ctx.setLineDash([1 * k, 4 * k]); stroke(s)
        }
      }
    }
    ctx.setLineDash([])

    // 2. the shape being drawn, and the ruler
    const drawDraft = (path: XY[], pts: XY[], closed: boolean, color: string, dash: number[]) => {
      const all = path
      if (all.length > 1) { ctx.setLineDash(dash.map((d) => d * k)); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 4 * k; stroke(line(all, closed && all.length > 2)); ctx.strokeStyle = color; ctx.lineWidth = 2 * k; stroke(line(all, closed && all.length > 2)); ctx.setLineDash([]) }
      for (const p of pts) { const s = v.proj(...p); if (s) { ctx.fillStyle = '#fff'; ctx.strokeStyle = color; ctx.lineWidth = 1.5 * k; ctx.beginPath(); ctx.arc(s[0] * k, s[1] * k, 4 * k, 0, 7); ctx.fill(); ctx.stroke() } }
    }
    if (st.draft) drawDraft(st.draft.curve ? smoothPath(st.draft.pts, false) : st.draft.pts, st.draft.clicks, st.draft.kind === 'regions', LAYER_KINDS[st.draft.kind].color, [6, 4])
    if (st.ruler) {
      drawDraft(st.ruler.cursor ? [...st.ruler.pts, st.ruler.cursor] : st.ruler.pts, st.ruler.pts, false, '#1a1a2e', [])
      const all = st.ruler.cursor ? [...st.ruler.pts, st.ruler.cursor] : st.ruler.pts
      if (all.length > 1) {
        const km = pathLen(all), end = v.proj(...all[all.length - 1])
        if (end) this.tag(ctx, `${Math.round(km).toLocaleString()} km · ${(km / st.ruler.speed).toFixed(1)} days`, end[0] * k + 10 * k, end[1] * k - 10 * k, k)
      }
    }
    if (st.snap) { const s = v.proj(...st.snap); if (s) { ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(s[0] * k, s[1] * k, 7 * k, 0, 7); ctx.stroke() } }

    // 3. point icons (cities light up at night)
    const taken: Rect[] = []
    if ((st.night ?? 0) > 0.05) for (const { it, kind } of points) {
      if (kind !== 'cities') continue
      const s = v.proj(...it.at!)
      if (!s) continue
      const r = (CITY_PX[it.size ?? 'town'] * 4 + 6) * k, gr = ctx.createRadialGradient(s[0] * k, s[1] * k, 0, s[0] * k, s[1] * k, r)
      gr.addColorStop(0, `rgba(255,200,110,${0.75 * st.night!})`); gr.addColorStop(1, 'rgba(255,170,80,0)')
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s[0] * k, s[1] * k, r, 0, 7); ctx.fill()
    }
    for (const { it, layer, kind, color } of points) {
      const s = v.proj(...it.at!)
      if (!s) continue
      const x = s[0] * k, y = s[1] * k, ref = { layer, id: it.id }, em = isSel(ref) || isHov(ref) ? 1.3 : 1
      let r: number
      if (kind === 'cities') {
        r = CITY_PX[it.size ?? 'town'] * k * em
        ctx.fillStyle = it.size === 'hamlet' ? color : '#fbf4e2'; ctx.strokeStyle = color; ctx.lineWidth = 1.6 * k
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke()
        if (it.size === 'city') { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, 7); ctx.fill() }
        if (it.size === 'capital') { ctx.fillStyle = color; this.star(ctx, x, y, r * 0.78) }
      } else {
        r = 11 * k * em
        ctx.fillStyle = '#f6ecd4'; ctx.strokeStyle = color; ctx.lineWidth = 1.5 * k
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke()
        ctx.save(); ctx.translate(x - r * 0.62, y - r * 0.62); ctx.scale(r * 1.24 / 24, r * 1.24 / 24)
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(glyph(it.icon ?? 'monument')); ctx.restore()
      }
      if (isSel(ref)) { ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 2.5 * k; ctx.beginPath(); ctx.arc(x, y, r + 4 * k, 0, 7); ctx.stroke() }
      hits.push({ ref, x: s[0], y: s[1], r: r / k + 3 })
      taken.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r })
    }

    // 4. labels: curved ones (rivers, ranges, roads) first, then the rest greedily by priority
    if (st.showLabels) {
      const vis = st.labels.filter((l) => !l.minZoom || v.kmPerPx <= l.minZoom)
      for (const l of vis) if (l.line) this.curved(ctx, v, l, taken)
      const flat = vis.filter((l) => !l.line).map((l) => {
        if (!l.area) return l
        const px = Math.min(30, Math.max(STYLE[l.style].px, Math.sqrt(l.area) / v.kmPerPx * 0.07))
        return { ...l, size: px }
      })
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      const measure = (l: Label) => { const m = l as MapLabel; ctx.font = fontOf(m.style, k, m.size); ctx.letterSpacing = `${(STYLE[m.style].spacing ?? 0) * m.size * k}px`; return ctx.measureText(textOf(m)).width }
      const placed = placeLabels(flat, (l) => { const p = v.proj(...(l.at as XY)); return p && [p[0] * k, p[1] * k] }, measure, v.w * k, v.h * k, k, taken)
      for (const p of placed) {
        const l = p.label as MapLabel, s = STYLE[l.style]
        ctx.font = fontOf(l.style, k, l.size); ctx.letterSpacing = `${(s.spacing ?? 0) * l.size * k}px`
        ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(252,246,232,.85)'; ctx.strokeText(textOf(l), p.x, p.y)
        ctx.fillStyle = l.color ?? s.color; ctx.fillText(textOf(l), p.x, p.y)
      }
      ctx.letterSpacing = '0px'
    }

    // 5. vertex handles on the selected line or area
    const sel = st.sel && 'id' in st.sel ? st.world.layers?.find((l) => l.id === (st.sel as { layer: string }).layer)?.items.find((i) => i.id === (st.sel as { id: string }).id) : undefined
    const handles = sel?.path ?? sel?.area ?? [], hs = (handles.length > 40 ? 2.5 : 4) * k
    for (const p of handles) {
      const s = v.proj(...p)
      if (!s) continue
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1.5 * k
      ctx.fillRect(s[0] * k - hs, s[1] * k - hs, hs * 2, hs * 2); ctx.strokeRect(s[0] * k - hs, s[1] * k - hs, hs * 2, hs * 2)
    }
    this.hits = hits
  }

  private star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.beginPath()
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q) }
    ctx.closePath(); ctx.fill()
  }

  private tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, k: number) {
    ctx.font = `600 ${12 * k}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width
    ctx.fillStyle = 'rgba(26,26,46,.85)'; ctx.beginPath(); ctx.roundRect(x - 6 * k, y - 11 * k, w + 12 * k, 22 * k, 6 * k); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.fillText(text, x, y)
  }

  /** Text along a projected path: centred on the visible stretch, flipped to read left to right; dropped if it collides. */
  private curved(ctx: CanvasRenderingContext2D, v: HudView, l: MapLabel, taken: Rect[]) {
    const k = v.k, s = STYLE[l.style], txt = textOf(l)
    let pts: number[] = []
    for (const [x, y] of dense(l.line!, Math.max(v.kmPerPx * 8, 1))) {
      const p = v.proj(x, y)
      if (p && p[0] > 0 && p[1] > 0 && p[0] < v.w && p[1] < v.h) pts.push(p[0] * k, p[1] * k)
      else if (pts.length) break // the first on-screen run is enough
    }
    if (pts.length < 4) return
    if (pts[pts.length - 2] < pts[0]) { const r: number[] = []; for (let q = pts.length - 2; q >= 0; q -= 2) r.push(pts[q], pts[q + 1]); pts = r }
    const cum = [0]
    for (let q = 2; q < pts.length; q += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[q] - pts[q - 2], pts[q + 1] - pts[q - 1]))
    ctx.font = fontOf(l.style, k); ctx.letterSpacing = '0px'
    const gap = (s.spacing ?? 0) * s.px * k, widths = [...txt].map((c) => ctx.measureText(c).width + gap), tw = widths.reduce((a, b) => a + b, 0)
    const L = cum[cum.length - 1]
    if (L < tw * 1.15) return
    const at = (d: number) => {
      let q = 1
      while (q < cum.length - 1 && cum[q] < d) q++
      const t = (d - cum[q - 1]) / (cum[q] - cum[q - 1] || 1), i = (q - 1) * 2
      return [pts[i] + (pts[i + 2] - pts[i]) * t, pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t]
    }
    const glyphs: { c: string; x: number; y: number; a: number }[] = [], boxes: Rect[] = []
    let d = (L - tw) / 2
    for (const [n, c] of [...txt].entries()) {
      const mid = d + widths[n] / 2, [x, y] = at(mid), [x0, y0] = at(mid - widths[n]), [x1, y1] = at(mid + widths[n])
      glyphs.push({ c, x, y, a: Math.atan2(y1 - y0, x1 - x0) })
      boxes.push({ x: x - s.px * k * 0.5, y: y - s.px * k * 0.6, w: s.px * k, h: s.px * k * 1.1 })
      d += widths[n]
    }
    if (boxes.some((b) => taken.some((t) => b.x < t.x + t.w && t.x < b.x + b.w && b.y < t.y + t.h && t.y < b.y + b.h))) return
    taken.push(...boxes)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    for (const g of glyphs) {
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a)
      ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(252,246,232,.85)'; ctx.strokeText(g.c, 0, 0)
      ctx.fillStyle = l.color ?? s.color; ctx.fillText(g.c, 0, 0)
      ctx.restore()
    }
  }
}

/** Everything nameable, most important first. Area sizes (km²) let big names grow on screen. */
export function collectLabels(fw: FlatWorld, g: Gen): MapLabel[] {
  const out: MapLabel[] = []
  const areaKm = (p: XY[]) => Math.abs(p.reduce((s, v, n) => { const u = p[(n + 1) % p.length]; return s + v[0] * u[1] - u[0] * v[1] }, 0)) / 2
  for (const f of fw.features) {
    if (!f.name) continue
    const at = g.anchors[f.id]
    if (!at && !f.path) continue
    if (f.kind === 'land') out.push({ text: f.name, at: at!, size: 20, italic: false, prio: 0, style: 'land', area: areaKm(f.area!) })
    else if (f.kind === 'sea') out.push({ text: f.name, at: at!, size: 15, italic: true, prio: 1, style: 'sea', area: areaKm(f.area!) })
    else if (f.kind === 'range') out.push({ text: f.name, at: at ?? f.path![0], size: 11.5, italic: false, prio: 2, style: 'range', line: g.lines[f.id] })
    else if (f.kind === 'river') { const r = g.rivers.find((r) => r.id === f.id); if (r) out.push({ text: f.name, at: r.pts[0], size: 11, italic: true, prio: 5, style: 'river', line: r.pts, minZoom: 8 }) }
    else if (f.kind === 'lake') out.push({ text: f.name, at: at!, size: 11, italic: true, prio: 4, style: 'water', minZoom: 6 })
    else if (f.kind === 'canyon') out.push({ text: f.name, at: f.path![0], size: 11, italic: true, prio: 4, style: 'feature', line: g.lines[f.id], minZoom: 5 })
    else if (at) out.push({ text: f.name, at, size: 11, italic: true, prio: 4, style: 'feature', dot: f.at ? 2 : undefined, minZoom: 6 })
  }
  for (const l of fw.layers ?? []) {
    if (l.hidden) continue
    const color = layerColor(l)
    for (const it of l.items) {
      if (!it.name) continue
      if (l.kind === 'regions') out.push({ text: it.name, at: centroid(it.area!), size: 14, italic: false, prio: 1, style: 'region', color: shade(color), area: areaKm(it.area!) })
      else if (it.path) out.push({ text: it.name, at: it.path[0], size: 10, italic: true, prio: 6, style: 'road', line: it.path, minZoom: 4 })
      else if (l.kind === 'cities') {
        const size = it.size ?? 'town', r = CITY_PX[size]
        out.push({ text: it.name, at: it.at!, size: STYLE[size].px, italic: false, prio: { capital: 1.5, city: 2.5, town: 3.5, hamlet: 5 }[size], style: size, dot: r + 1, minZoom: { capital: 99, city: 12, town: 6, hamlet: 2.5 }[size] })
      } else out.push({ text: it.name, at: it.at!, size: 11, italic: true, prio: 4, style: 'landmark', dot: 12, minZoom: 6 })
    }
  }
  return out.sort((a, b) => a.prio - b.prio)
}
export const centroid = (p: XY[]): XY => [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length]
const shade = (hex: string) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.6).toString(16).padStart(2, '0')).join('')
