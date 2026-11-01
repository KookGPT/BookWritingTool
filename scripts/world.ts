// World tools for Claude Code / the terminal. Same pure code as the app.
//   node scripts/world.ts describe <world.json>
//   node scripts/world.ts query    <world.json> <lat> <lon>
//   node scripts/world.ts validate <world.json>
//   node scripts/world.ts preview  <world.json | --seed NAME> [out.png] [--w 1440] [--region lat0,lat1,lon0,lon1]
//   node scripts/world.ts add      <world.json> '<op json>'
//   node scripts/world.ts brief    <world.json>
// <world.json> is one world (as exported from the app or stored in the data repo at worlds/<id>.json).
import { readFileSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { brief, describe, query, validate } from '../src/world/describe.ts'
import { opCenter, type Op } from '../src/world/ops.ts'
import { layerColor } from '../src/world/layers.ts'
import { DEFAULT_PARAMS, makePlanet, toDir, type World } from '../src/world/terrain.ts'

const args = process.argv.slice(2)
const flag = (k: string) => { const i = args.indexOf(k); return i < 0 ? undefined : args.splice(i, 2)[1] }

function png(w: number, h: number, rgb: Uint8Array) {
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4)
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(t))
    return Buffer.concat([len, t, crc])
  }
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const seed = flag('--seed')
const width = Number(flag('--w') ?? 1440)
const region = (flag('--region') ?? '90,-90,-180,180').split(',').map(Number) // north, south, west, east
const cmd = args.shift()
const file = seed ? undefined : args.shift()
const load = (): World => {
  if (seed) return { id: 'cli', name: seed, generatorVersion: 1, seed, params: { ...DEFAULT_PARAMS } }
  if (!file) { console.error('missing <world.json>'); process.exit(2) }
  const j = JSON.parse(readFileSync(file, 'utf8'))
  return j.worlds ? j.worlds[0] : j
}

function preview(world: World, out: string) {
  const [N, S, Wl, E] = [Math.max(region[0], region[1]), Math.min(region[0], region[1]), region[2], region[3] > region[2] ? region[3] : region[3] + 360]
  const W = width, H = Math.max(2, Math.round(W * (N - S) / (E - Wl))), planet = makePlanet(world)
  const hs = new Float64Array(W * H), rgb = new Uint8Array(W * H * 3)
  const latAt = (y: number) => N - (y + 0.5) * (N - S) / H, lonAt = (x: number) => Wl + (x + 0.5) * (E - Wl) / W
  const dirAt = (x: number, y: number) => toDir(latAt(y), lonAt(x))
  const detail = Math.max(0, Math.round(Math.log2(360 / (E - Wl))))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = dirAt(x, y); hs[y * W + x] = planet.elevation(d[0], d[1], d[2], detail) }
  const px = planet.radiusM * Math.PI / 180 * (E - Wl) / W
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const h = hs[y * W + x], d = dirAt(x, y), c = planet.color(d[0], d[1], d[2], h, 0, detail)
    const e = hs[y * W + ((x + 1) % W)], s = hs[Math.min(H - 1, y + 1) * W + x]
    const shade = h > 0 ? Math.max(0.55, Math.min(1.35, 1 + ((h - Math.max(0, e)) + (h - Math.max(0, s))) / px * 4)) : 1
    for (let k = 0; k < 3; k++) rgb[(y * W + x) * 3 + k] = Math.max(0, Math.min(255, c[k] * shade))
  }
  // feature overlay (layers drawn after): rivers blue, ridges/rifts dark, areas yellow outline, point features white rings
  const put = (lat: number, lon: number, col: number[], r = 1) => {
    const rel = ((lon - Wl) % 360 + 360) % 360
    const cx = Math.floor(rel / (E - Wl) * W), cy = Math.floor((N - lat) / (N - S) * H)
    for (let dy = -r + 1; dy < r; dy++) for (let dx = -r + 1; dx < r; dx++) {
      const x = cx + dx, y = cy + dy
      if (y >= 0 && y < H && x >= 0 && x < W) rgb.set(col, (y * W + x) * 3)
    }
  }
  const line = (pts: [number, number][], col: number[], r: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]], dlon = ((b[1] - a[1] + 540) % 360) - 180
      const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]) / (N - S) * H, Math.abs(dlon) / (E - Wl) * W)) + 1
      for (let s = 0; s <= n; s++) put(a[0] + (b[0] - a[0]) * s / n, ((a[1] + dlon * s / n + 540) % 360) - 180, col, r)
    }
  }
  for (const op of world.ops ?? []) {
    if (op.kind === 'river') line(planet.course(op), [40, 110, 230], 2)
    else if ('path' in op) line(op.path, [90, 30, 30], 1)
    else if ('area' in op) line([...op.area, op.area[0]], [235, 200, 60], 1)
    else {
      const [lat, lon] = opCenter(op)
      for (let a = 0; a < 24; a++) put(lat + 1.2 * Math.sin(a / 24 * 2 * Math.PI), lon + 1.2 * Math.cos(a / 24 * 2 * Math.PI) / Math.max(0.2, Math.cos(lat * Math.PI / 180)), [255, 255, 255])
    }
  }
  // layer items in their layer's colour: lines, polygon outlines, 3x3 dots for points
  for (const l of world.layers ?? []) {
    if (l.hidden) continue
    const hex = layerColor(l), col = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    for (const it of l.items) {
      if (it.path) line(it.path, col, 1)
      else if (it.area) line([...it.area, it.area[0]], col, 1)
      else if (it.at) put(it.at[0], it.at[1], col, 3)
    }
  }
  // graticule ticks on the edges, so coordinates can be read off the image
  const step = [1, 2, 5, 10, 15, 30].find((s) => (E - Wl) / s <= 14) ?? 30
  for (let lon = Math.ceil(Wl / step) * step; lon <= E; lon += step) for (let k = 0; k < 6; k++) { put(N - k * (N - S) / H, lon, [255, 255, 255]); put(S + (k + 0.5) * (N - S) / H, lon, [255, 255, 255]) }
  for (let lat = Math.ceil(S / step) * step; lat <= N; lat += step) for (let k = 0; k < 6; k++) { put(lat, Wl + k * (E - Wl) / W, [255, 255, 255]); put(lat, E - (k + 1) * (E - Wl) / W, [255, 255, 255]) }
  writeFileSync(out, png(W, H, rgb))
  console.log(`wrote ${out} (${W}x${H}, equirectangular: lat ${N}..${S}, lon ${Wl}..${E}, edge ticks every ${step}°)`)
}

const world = cmd && cmd !== 'help' ? load() : undefined
switch (cmd) {
  case 'describe': console.log(describe(world!)); break
  case 'brief': console.log(brief(world!)); break
  case 'query': console.log(JSON.stringify(query(world!, Number(args[0]), Number(args[1])), null, 2)); break
  case 'validate': {
    const { errors, warnings } = validate(world!)
    for (const e of errors) console.log(`error: ${e}`)
    for (const w of warnings) console.log(`warning: ${w}`)
    console.log(errors.length ? `${errors.length} error(s)` : `ok${warnings.length ? `, ${warnings.length} warning(s)` : ''}`)
    process.exit(errors.length ? 1 : 0)
    break
  }
  case 'preview': preview(world!, args[0] ?? 'world-preview.png'); break
  case 'add': {
    const op = JSON.parse(args[0]) as Op
    op.id ||= Math.random().toString(36).slice(2, 10)
    const next = { ...world!, ops: [...(world!.ops ?? []), op] }
    const { errors } = validate(next)
    if (errors.length) { for (const e of errors) console.log(`error: ${e}`); process.exit(1) }
    writeFileSync(file!, JSON.stringify(next, null, 2))
    console.log(`added ${op.kind} [${op.id}]${op.name ? ` "${op.name}"` : ''}`)
    break
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 8).join('\n').replace(/^\/\/ ?/gm, ''))
}
