// Flat-map (New Map Test) tools for Claude Code / the terminal. Same pure code as the app.
//   node scripts/map.ts brief    [map.json]                    (the format, the rules, and a summary of this map)
//   node scripts/map.ts describe <map.json>                    (every feature and layer item with its size and place)
//   node scripts/map.ts validate <map.json>
//   node scripts/map.ts preview  <map.json> [out.png] [--w 1200]   (top-down, shaded, rivers, layers drawn)
//   node scripts/map.ts add      <map.json> '<json>' [--layer <layer id>]   (a feature, or with --layer a layer item; ids are made up if missing)
// <map.json> is one flat world, as exported from the New Map Test page (or flatworlds/<id>.json in the data repo).
import { readFileSync, writeFileSync } from 'node:fs'
import { png } from './png.ts'
import { brief, FEATURE_KINDS, generate, heightAt, itemShape, layerColor, pathLen, polyArea, validate, type FlatWorld, type MapFeature, type MapItem, type XY } from '../src/flatworld/gen.ts'

const args = process.argv.slice(2)
const flag = (k: string) => { const i = args.indexOf(k); return i < 0 ? undefined : args.splice(i, 2)[1] }
const width = Number(flag('--w') ?? 1200), layerId = flag('--layer')
const [cmd, file, arg] = args
if (cmd === 'brief' && !file) { console.log(brief()); process.exit(0) }
if (!file) { console.log('commands: brief, describe, validate, preview, add'); process.exit(1) }
const fw: FlatWorld = JSON.parse(readFileSync(file, 'utf8'))
const report = (w: FlatWorld) => {
  const v = validate(w)
  for (const e of v.errors) console.log('error  ', e)
  for (const e of v.warnings) console.log('warning', e)
  return v
}
const r1 = (n: number) => Math.round(n).toLocaleString('en')
const xy = (p: XY) => `[${Math.round(p[0])}, ${Math.round(p[1])}]`
const newId = (base: string) => { const ids = new Set([...fw.features.map((f) => f.id), ...(fw.layers ?? []).flatMap((l) => [l.id, ...l.items.map((i) => i.id)])]); let n = 1; while (ids.has(`${base}-${n}`)) n++; return `${base}-${n}` }

if (cmd === 'brief') console.log(brief(fw))
else if (cmd === 'validate') { const v = report(fw); console.log(v.errors.length ? 'invalid' : v.warnings.length ? `${v.warnings.length} warnings` : 'ok'); if (v.errors.length) process.exit(1) }
else if (cmd === 'add') {
  const o = JSON.parse(arg)
  if (layerId) {
    const l = fw.layers?.find((l) => l.id === layerId)
    if (!l) { console.log(`no layer "${layerId}"; layers: ${(fw.layers ?? []).map((l) => l.id).join(', ') || 'none'}`); process.exit(1) }
    l.items.push({ id: newId(l.kind), ...o } as MapItem)
  } else fw.features.push({ id: newId(o.kind), ...o } as MapFeature)
  if (report(fw).errors.length) process.exit(1)
  writeFileSync(file, JSON.stringify(fw, null, 2))
  console.log('added')
} else {
  if (report(fw).errors.length) process.exit(1)
  const t = performance.now()
  const g = generate(fw, cmd === 'preview' ? width : 800)
  if (cmd === 'describe') {
    console.log(`"${fw.name}": ${fw.shape} ${r1(fw.size[0])} x ${r1(fw.size[1])} km, highest point ${r1(g.maxH)} m, heights drawn ${g.exag.toFixed(0)}x`)
    for (const f of fw.features) {
      const s = FEATURE_KINDS[f.kind]
      let d = ''
      if (f.area) d = `${r1(polyArea(f.area))} km², around ${xy(g.anchors[f.id] ?? f.area[0])}`
      if (f.at) d = `${r1(heightAt(g, ...g.anchors[f.id]))} m at ${xy(f.at)}`
      const line = g.lines[f.id] ?? g.rivers.find((r) => r.id === f.id)?.pts
      if (line) d = `${r1(pathLen(line))} km from ${xy(line[0])} to ${xy(line[line.length - 1])}${f.kind === 'range' ? `, up to ${r1(Math.max(...line.map((p) => heightAt(g, ...p))))} m` : ''}`
      console.log(`  ${f.id}: ${f.kind}${f.name ? ` "${f.name}"` : ''} - ${d}${s ? '' : ' (unknown kind)'}`)
    }
    for (const l of fw.layers ?? []) {
      console.log(`layer ${l.id}: ${l.kind} "${l.name}"${l.hidden ? ' (hidden)' : ''}`)
      for (const it of l.items) console.log(`  ${it.id}: ${it.name ?? '(unnamed)'}${it.size ? ` ${it.size}` : ''}${it.icon ? ` ${it.icon}` : ''} - ${it.at ? `at ${xy(it.at)}, ${r1(heightAt(g, ...it.at))} m${heightAt(g, ...it.at) < 0 ? ' (IN WATER)' : ''}` : it.path ? `${r1(pathLen(it.path))} km` : `${r1(polyArea(it.area!))} km²`}`)
    }
  } else if (cmd === 'preview') {
    console.log(`generated ${g.w}x${g.h} (${g.cell.toFixed(2)} km/px) in ${Math.round(performance.now() - t)} ms, highest ${Math.round(g.maxH)} m`)
    const rgb = new Uint8Array(g.w * g.h * 3), e = g.exag / 1000
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i, z = g.height[k]
      const dx = (g.height[j * g.w + Math.min(g.w - 1, i + 1)] - g.height[j * g.w + Math.max(0, i - 1)]) * e / (2 * g.cell)
      const dy = (g.height[Math.min(g.h - 1, j + 1) * g.w + i] - g.height[Math.max(0, j - 1) * g.w + i]) * e / (2 * g.cell)
      const lit = Math.max(0.35, Math.min(1.25, 0.85 + (-dx * 0.6 - dy * 0.6) * 0.5))
      const d = g.data[k * 4] / 255, c = z < 0 || (g.data[k * 4 + 1] && d > 0) ? [70 - 40 * d, 170 - 90 * d, 190 - 60 * d] : [g.rgba[k * 4] * lit, g.rgba[k * 4 + 1] * lit, g.rgba[k * 4 + 2] * lit]
      if (g.disc && Math.hypot(i - g.w / 2, j - g.h / 2) > g.w / 2) c.fill(20)
      for (let q = 0; q < 3; q++) rgb[k * 3 + q] = Math.max(0, Math.min(255, c[q]))
    }
    const dot = (x: number, y: number, col: number[], r = 0) => {
      const ci = Math.round((x + g.W / 2) / g.cell - 0.5), cj = Math.round((g.H / 2 - y) / g.cell - 0.5)
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (i >= 0 && j >= 0 && i < g.w && j < g.h) rgb.set(col, (j * g.w + i) * 3)
    }
    const trace = (pts: XY[], col: number[], closed = false) => {
      const n = closed ? pts.length : pts.length - 1
      for (let q = 0; q < n; q++) {
        const [ax, ay] = pts[q], [bx, by] = pts[(q + 1) % pts.length], m = Math.ceil(Math.hypot(bx - ax, by - ay) / g.cell)
        for (let s = 0; s <= m; s++) dot(ax + (bx - ax) * s / m, ay + (by - ay) * s / m, col)
      }
    }
    for (const r of g.rivers) for (const [x, y] of r.pts) dot(x, y, [60, 130, 220])
    for (const l of fw.layers ?? []) {
      if (l.hidden) continue
      const c = layerColor(l), col = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
      for (const it of l.items) {
        if (it.at) { dot(...it.at, [255, 255, 255], 3); dot(...it.at, col, 2) }
        else trace(itemShape(it), col, !!it.area)
      }
    }
    writeFileSync(arg ?? 'map-preview.png', png(g.w, g.h, rgb))
  } else console.log('commands: brief, describe, validate, preview, add')
}
