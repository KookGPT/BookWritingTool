// World tools for Claude Code / the terminal. Uses the same pure terrain code as the app.
//   node scripts/world.ts preview <world.json | --seed NAME> [out.png] [--w 1024]
// world.json may be a single world or a whole book export with a `worlds` array (first world used).
import { readFileSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
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

function load(): World {
  const seed = flag('--seed')
  if (seed) return { id: 'cli', name: seed, generatorVersion: 1, seed, params: { ...DEFAULT_PARAMS } }
  const j = JSON.parse(readFileSync(args.shift()!, 'utf8'))
  return j.worlds ? j.worlds[0] : j
}

const cmd = args.shift()
if (cmd === 'preview') {
  const W = Number(flag('--w') ?? 1024), H = W / 2
  const world = load(), planet = makePlanet(world)
  const out = args.shift() ?? 'world-preview.png'
  const hs = new Float64Array(W * H), rgb = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = toDir(90 - (y + 0.5) * 180 / H, (x + 0.5) * 360 / W - 180)
    hs[y * W + x] = planet.elevation(d[0], d[1], d[2])
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const h = hs[y * W + x]
    const d = toDir(90 - (y + 0.5) * 180 / H, (x + 0.5) * 360 / W - 180)
    const c = planet.color(d[0], d[1], d[2], h)
    // hillshade from the north-west, land only
    const e = hs[y * W + ((x + 1) % W)], s = hs[Math.min(H - 1, y + 1) * W + x]
    const px = planet.radiusM * 2 * Math.PI / W
    const shade = h > 0 ? Math.max(0.55, Math.min(1.35, 1 + ((Math.max(0, h) - Math.max(0, e)) + (Math.max(0, h) - Math.max(0, s))) / px * 4)) : 1
    for (let k = 0; k < 3; k++) rgb[(y * W + x) * 3 + k] = Math.max(0, Math.min(255, c[k] * shade))
  }
  writeFileSync(out, png(W, H, rgb))
  console.log(`wrote ${out} (${W}x${H}) for "${world.name}" seed=${world.seed}`)
} else {
  console.log('usage: node scripts/world.ts preview <world.json | --seed NAME> [out.png] [--w 1024]')
}
