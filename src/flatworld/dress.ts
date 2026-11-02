// Map dressing: compass rose, scale bar, legend and a parchment frame, for PNG export (the page shows its own DOM versions).
import { CITY_PX, GLYPHS } from './hud.ts'
import { layerColor, type MapLayer } from './gen.ts'

const INK = '#3a2a18', PAPER = '#f1e4c6', SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'

/** A round, readable scale length: 1, 2 or 5 x 10^n km that fits in about `px` pixels. */
export function niceScale(kmPerPx: number, px = 120) {
  const raw = kmPerPx * px, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p
  const km = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p
  return { km, px: km / kmPerPx }
}

export function compassRose(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, az: number) {
  ctx.save(); ctx.translate(x, y)
  ctx.fillStyle = 'rgba(241,228,198,.92)'; ctx.strokeStyle = INK; ctx.lineWidth = r * 0.04
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, 7); ctx.stroke()
  ctx.rotate(-az)
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0, len = long ? r * 0.8 : r * 0.48, wd = long ? r * 0.16 : r * 0.1
    ctx.save(); ctx.rotate(i * Math.PI / 4)
    ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(wd, 0); ctx.lineTo(0, 0); ctx.fill()
    ctx.fillStyle = i === 0 ? '#9b2c2c' : '#fbf4e2'; ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(-wd, 0); ctx.lineTo(0, 0); ctx.fill(); ctx.stroke()
    ctx.restore()
  }
  ctx.fillStyle = INK; ctx.font = `700 ${r * 0.3}px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('N', 0, -r * 1.22)
  ctx.restore()
}

export function scaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, kmPerPx: number, k: number) {
  const { km, px } = niceScale(kmPerPx / k, 140), h = 7 * k
  ctx.fillStyle = 'rgba(241,228,198,.92)'; ctx.fillRect(x - 8 * k, y - 22 * k, px + 16 * k, 36 * k)
  for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? PAPER : INK; ctx.fillRect(x + i * px / 4, y, px / 4, h) }
  ctx.strokeStyle = INK; ctx.lineWidth = k; ctx.strokeRect(x, y, px, h)
  ctx.fillStyle = INK; ctx.font = `600 ${11 * k}px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  ctx.fillText('0', x, y - 5 * k); ctx.fillText(`${km.toLocaleString()} km`, x + px, y - 5 * k)
}

export function legend(ctx: CanvasRenderingContext2D, x: number, y: number, layers: MapLayer[], k: number) {
  const rows = layers.filter((l) => !l.hidden && l.items.length), lh = 20 * k
  if (!rows.length) return
  ctx.font = `${12 * k}px ${SERIF}`
  const w = Math.max(...rows.map((l) => ctx.measureText(l.name).width)) + 46 * k, h = rows.length * lh + 30 * k
  ctx.fillStyle = 'rgba(241,228,198,.94)'; ctx.strokeStyle = INK; ctx.lineWidth = k
  ctx.fillRect(x - w, y, w, h); ctx.strokeRect(x - w, y, w, h)
  ctx.fillStyle = INK; ctx.font = `700 ${11 * k}px ${SERIF}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText('LEGEND', x - w + 10 * k, y + 13 * k)
  rows.forEach((l, n) => {
    const cy = y + 30 * k + n * lh, sx = x - w + 18 * k, c = layerColor(l)
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2 * k; ctx.setLineDash([])
    if (l.kind === 'cities') { ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(sx, cy, CITY_PX.city * k, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(sx, cy, CITY_PX.city * k * 0.4, 0, 7); ctx.fill() }
    else if (l.kind === 'landmarks') { ctx.save(); ctx.translate(sx - 7 * k, cy - 7 * k); ctx.scale(14 * k / 24, 14 * k / 24); ctx.lineWidth = 2; ctx.stroke(new Path2D(GLYPHS.castle)); ctx.restore() }
    else if (l.kind === 'regions') { ctx.globalAlpha = 0.35; ctx.fillRect(sx - 8 * k, cy - 6 * k, 16 * k, 12 * k); ctx.globalAlpha = 1; ctx.lineWidth = 1.5 * k; ctx.strokeRect(sx - 8 * k, cy - 6 * k, 16 * k, 12 * k) }
    else { ctx.setLineDash(l.kind === 'borders' ? [6 * k, 2 * k, 2 * k, 2 * k] : [k, 3 * k]); ctx.beginPath(); ctx.moveTo(sx - 9 * k, cy); ctx.lineTo(sx + 9 * k, cy); ctx.stroke(); ctx.setLineDash([]) }
    ctx.fillStyle = INK; ctx.font = `${12 * k}px ${SERIF}`; ctx.fillText(l.name, sx + 16 * k, cy)
  })
}

/** The view plus its labels, dressed: compass, scale, legend, and optionally a parchment frame with a title. */
export function dressedImage(o: { view: HTMLCanvasElement; hud: HTMLCanvasElement; title: string; frame: boolean; layers: MapLayer[]; kmPerPx: number; azimuth: number; k: number }) {
  const { view, k } = o, w = view.width, h = view.height
  const m = o.frame ? Math.round(Math.min(w, h) * 0.05) : 0
  const c = document.createElement('canvas'); c.width = w + 2 * m; c.height = h + 2 * m
  const ctx = c.getContext('2d')!
  if (o.frame) {
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.7)
    g.addColorStop(0, '#f4e8cc'); g.addColorStop(1, '#d9c294')
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height)
  }
  ctx.drawImage(view, m, m); ctx.drawImage(o.hud, m, m)
  compassRose(ctx, m + w - 52 * k, m + h - 64 * k, 34 * k, o.azimuth)
  scaleBar(ctx, m + 24 * k, m + h - 22 * k, o.kmPerPx * k, k)
  legend(ctx, m + w - 14 * k, m + 14 * k, o.layers, k)
  if (o.frame) {
    ctx.strokeStyle = INK; ctx.lineWidth = 3 * k; ctx.strokeRect(m - 4 * k, m - 4 * k, w + 8 * k, h + 8 * k)
    ctx.lineWidth = k; ctx.strokeRect(m - 10 * k, m - 10 * k, w + 20 * k, h + 20 * k)
    ctx.font = `700 ${Math.round(m * 0.42)}px ${SERIF}`; ctx.letterSpacing = `${m * 0.06}px`
    const t = o.title.toUpperCase(), tw = ctx.measureText(t).width, bw = tw + m * 1.4, bh = m * 0.8
    ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2 * k
    ctx.beginPath(); ctx.roundRect(c.width / 2 - bw / 2, m - bh / 2 - 7 * k, bw, bh, bh * 0.2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, c.width / 2, m - 7 * k)
    ctx.letterSpacing = '0px'
  }
  return c
}
