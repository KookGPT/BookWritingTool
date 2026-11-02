// Text tools over a world: a geography summary, point queries, validation and the brief handed to an AI editor.
// Pure (no DOM) so the app and `scripts/world.ts` share them.
import { angle, dirOf, inPolygon, makePath, pathDist, toDir, type LatLon } from './geo.ts'
import { OP_KINDS, OP_SPECS, opCenter, type Op } from './ops.ts'
import { LAYER_KINDS, validateLayers } from './layers.ts'
import { DEFAULT_PARAMS, makePlanet, type Planet, type World } from './terrain.ts'

const fmtLat = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`
const fmtLon = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`
export const fmtLL = (p: LatLon) => `${fmtLat(p[0])} ${fmtLon(p[1])}`
const m = (v: number) => `${Math.round(v).toLocaleString('en-US')} m`
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** Distance in km from a point to an op's shape (0 inside areas). */
export function opDistKm(op: Op, p: LatLon, radiusKm: number) {
  const d = dirOf(p)
  if ('at' in op) return angle(d, dirOf(op.at)) * radiusKm
  if ('path' in op) return pathDist(d, makePath(op.path)).d * radiusKm
  if (inPolygon(d, op.area.map(dirOf))) return 0
  return pathDist(d, makePath([...op.area, op.area[0]])).d * radiusKm
}

export function query(world: World, lat: number, lon: number, planet: Planet = makePlanet(world)) {
  const [x, y, z] = toDir(lat, lon)
  const h = planet.elevation(x, y, z, 6)
  const c = planet.climate(x, y, z, h)
  const km = planet.radiusM / 1000
  const near = (world.ops ?? []).map((op) => ({ id: op.id, kind: op.kind, name: op.name, km: Math.round(opDistKm(op, [lat, lon], km)) }))
    .filter((o) => o.km < 1500).sort((a, b) => a.km - b.km).slice(0, 8)
  return { lat, lon, elevation: Math.round(h), biome: planet.biome(x, y, z, h), water: planet.water(x, y, z, h)?.kind ?? null, temperatureC: Math.round(c.temp), moisture: +c.moist.toFixed(2), nearby: near }
}

/** Plain-text geography summary: landmasses, peaks, biomes, named features. */
export function describe(world: World, planet: Planet = makePlanet(world)) {
  const P = { ...DEFAULT_PARAMS, ...world.params }
  const W = 360, H = 180, cell = (i: number, j: number) => j * W + i
  const hs = new Float64Array(W * H), land = new Uint8Array(W * H), wt = new Float64Array(H)
  const biomes = new Map<string, number>()
  let landW = 0, allW = 0, peak = { h: -Infinity, lat: 0, lon: 0 }
  for (let j = 0; j < H; j++) {
    const lat = 89.5 - j
    wt[j] = Math.cos(lat * Math.PI / 180)
    for (let i = 0; i < W; i++) {
      const lon = i - 179.5, [x, y, z] = toDir(lat, lon)
      const h = planet.elevation(x, y, z), k = cell(i, j)
      hs[k] = h
      allW += wt[j]
      const wet = planet.water(x, y, z, h)
      if (wet && wet.kind !== 'river') continue
      land[k] = 1; landW += wt[j]
      const b = planet.biome(x, y, z, h)
      biomes.set(b, (biomes.get(b) ?? 0) + wt[j])
      if (h > peak.h) peak = { h, lat, lon }
    }
  }
  // connected landmasses (4-neighbour, wrapping in longitude)
  const comp = new Int32Array(W * H).fill(-1)
  const masses: { w: number; cells: number[]; max: number; maxAt: LatLon }[] = []
  for (let k0 = 0; k0 < W * H; k0++) {
    if (!land[k0] || comp[k0] >= 0) continue
    const id = masses.length, stack = [k0], mass = { w: 0, cells: [] as number[], max: -Infinity, maxAt: [0, 0] as LatLon }
    comp[k0] = id
    while (stack.length) {
      const k = stack.pop()!, i = k % W, j = (k - i) / W
      mass.w += wt[j]; mass.cells.push(k)
      if (hs[k] > mass.max) { mass.max = hs[k]; mass.maxAt = [89.5 - j, i - 179.5] }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jj = j + dj
        if (jj < 0 || jj >= H) continue
        const kk = cell((i + di + W) % W, jj)
        if (land[kk] && comp[kk] < 0) { comp[kk] = id; stack.push(kk) }
      }
    }
    masses.push(mass)
  }
  masses.sort((a, b) => b.w - a.w)
  const cellKm2 = (2 * Math.PI * P.radiusKm / 360) ** 2
  const big = masses.filter((ms) => ms.w * cellKm2 > 150_000)
  const lines: string[] = []
  lines.push(`World "${world.name}" (seed "${world.seed}"), radius ${P.radiusKm.toLocaleString('en-US')} km, axial tilt ${P.tilt}°.`)
  lines.push(`Surface: land ${pct(landW / allW)}, water ${pct(1 - landW / allW)}. Highest point ${m(peak.h)} at ${fmtLL([peak.lat, peak.lon])}.`)
  lines.push('', `Landmasses (largest first; coordinates are approximate, 1° grid):`)
  big.forEach((ms, n) => {
    // centroid via mean unit vector; extent relative to it so wrapping at ±180° reads sensibly
    let sx = 0, sy = 0, sz = 0, la0 = 90, la1 = -90
    for (const k of ms.cells) {
      const i = k % W, j = (k - i) / W, d = toDir(89.5 - j, i - 179.5)
      sx += d[0]; sy += d[1]; sz += d[2]
      la0 = Math.min(la0, 89.5 - j); la1 = Math.max(la1, 89.5 - j)
    }
    const cl = Math.hypot(sx, sy, sz), clat = Math.asin(sy / cl) * 180 / Math.PI, clon = Math.atan2(sx, sz) * 180 / Math.PI
    let lo0 = 180, lo1 = -180
    for (const k of ms.cells) { const rel = ((k % W) - 179.5 - clon + 540) % 360 - 180; lo0 = Math.min(lo0, rel); lo1 = Math.max(lo1, rel) }
    const local = new Map<string, number>()
    for (const k of ms.cells) {
      const i = k % W, j = (k - i) / W, [x, y, z] = toDir(89.5 - j, i - 179.5)
      const b = planet.biome(x, y, z, hs[k]); local.set(b, (local.get(b) ?? 0) + 1)
    }
    const top = [...local].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, c]) => `${b} ${Math.round(c / ms.cells.length * 100)}%`).join(', ')
    const wrapLon = (v: number) => ((v + 540) % 360) - 180
    lines.push(`${n + 1}. ~${(ms.w * cellKm2 / 1e6).toFixed(1)}M km² (${pct(ms.w / landW)} of land). Centre ${fmtLL([clat, clon])}; spans ${fmtLat(la0)}–${fmtLat(la1)}, ${lo1 - lo0 > 350 ? 'all longitudes' : `${fmtLon(wrapLon(clon + lo0))}–${fmtLon(wrapLon(clon + lo1))}`}. Highest ${m(ms.max)} at ${fmtLL(ms.maxAt)}. ${top}.`)
  })
  const small = masses.length - big.length
  if (small) lines.push(`+ ${small} smaller islands/landmasses.`)
  lines.push('', 'Biomes (share of land): ' + [...biomes].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([b, w]) => `${b} ${pct(w / landW)}`).join(', '))
  const ops = world.ops ?? []
  lines.push('', ops.length ? `Features (${ops.length}, applied in this order):` : 'Features: none yet (the whole planet is generated).')
  for (const op of ops) lines.push(`- [${op.id}] ${op.kind}${op.name ? ` "${op.name}"` : ''} near ${fmtLL(opCenter(op))}${op.wikiId ? ` (wiki ${op.wikiId})` : ''}`)
  for (const l of world.layers ?? []) {
    lines.push('', `Layer [${l.id}] ${l.kind} "${l.name}"${l.hidden ? ' (hidden)' : ''}, ${l.items.length} item(s):`)
    for (const it of l.items) {
      const pts = it.at ? [it.at] : it.path ?? it.area ?? []
      const c: LatLon = it.at ?? [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length]
      lines.push(`- [${it.id}] ${it.at ? 'point' : it.path ? 'line' : 'area'}${it.name ? ` "${it.name}"` : ''} ${it.at ? 'at' : 'around'} ${fmtLL(c)}${it.props ? ` ${JSON.stringify(it.props)}` : ''}${it.wikiId ? ` (wiki ${it.wikiId})` : ''}`)
    }
  }
  return lines.join('\n')
}

export interface Problems { errors: string[]; warnings: string[] }

const isLL = (v: unknown): v is LatLon => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180

/** Schema checks plus geography sanity checks (rivers run downhill and reach water). */
export function validate(world: World): Problems {
  const errors: string[] = [], warnings: string[] = []
  if (!world || typeof world !== 'object') return { errors: ['not a world object'], warnings }
  if (typeof world.id !== 'string' || !world.id) errors.push('world.id must be a non-empty string')
  if (typeof world.seed !== 'string') errors.push('world.seed must be a string')
  if (world.generatorVersion !== 1) errors.push('world.generatorVersion must be 1')
  const P = { ...DEFAULT_PARAMS, ...world.params }
  const ranges: [keyof typeof P, number, number][] = [['oceanPct', 5, 95], ['plates', 4, 40], ['ruggedness', 0.2, 2], ['aridity', 0, 1], ['tilt', 0, 60], ['radiusKm', 1000, 15000]]
  for (const [k, a, b] of ranges) if (typeof P[k] !== 'number' || P[k] < a || P[k] > b) errors.push(`params.${k} must be a number from ${a} to ${b}`)
  const ops = world.ops ?? []
  if (!Array.isArray(ops)) return { errors: [...errors, 'ops must be an array'], warnings }
  const ids = new Set<string>()
  ops.forEach((op, i) => {
    const at = `ops[${i}]${op?.name ? ` "${op.name}"` : ''}`
    if (!op || typeof op !== 'object') { errors.push(`${at}: not an object`); return }
    if (typeof op.id !== 'string' || !op.id) errors.push(`${at}: id must be a non-empty string`)
    else if (ids.has(op.id)) errors.push(`${at}: duplicate id "${op.id}"`)
    else ids.add(op.id)
    const spec = OP_SPECS[op.kind as keyof typeof OP_SPECS]
    if (!spec) { errors.push(`${at}: unknown kind "${String(op.kind)}" (use one of ${OP_KINDS.join(', ')})`); return }
    const o = op as unknown as Record<string, unknown>
    const known = new Set(['id', 'kind', 'name', 'note', 'wikiId', ...spec.fields.map((f) => f[0])])
    for (const k of Object.keys(o)) if (!known.has(k)) errors.push(`${at}: unknown field "${k}" for ${op.kind}`)
    for (const k of ['name', 'note', 'wikiId']) if (o[k] !== undefined && typeof o[k] !== 'string') errors.push(`${at}: ${k} must be a string`)
    for (const [f, type, req] of spec.fields) {
      const v = o[f]
      if (v === undefined) { if (req) errors.push(`${at}: missing ${f}`); continue }
      if (type === 'num' && (typeof v !== 'number' || !Number.isFinite(v) || (f !== 'level' && v < 0))) errors.push(`${at}: ${f} must be a ${f === 'level' ? '' : 'non-negative '}number`)
      if (type === 'at' && !isLL(v)) errors.push(`${at}: ${f} must be [lat, lon] with |lat|<=90, |lon|<=180`)
      if ((type === 'path' || type === 'area') && (!Array.isArray(v) || v.length < (type === 'area' ? 3 : 2) || !v.every(isLL))) errors.push(`${at}: ${f} must be a list of at least ${type === 'area' ? 3 : 2} [lat, lon] points`)
    }
    if (op.kind === 'range' && op.height > 9500) warnings.push(`${at}: ${op.height} m is taller than anything on Earth`)
    if (op.kind === 'islands' && (op.count < 1 || op.count > 60)) warnings.push(`${at}: count is clamped to 1..60`)
  })
  validateLayers(world.layers, ids, errors, warnings)
  if (errors.length) return { errors, warnings }

  // geography: rivers should start high, follow low ground (not carve huge gorges) and end at water
  const planet = makePlanet(world), km = P.radiusKm
  for (const op of ops) {
    if (op.kind !== 'river') continue
    const name = `river "${op.name ?? op.id}"`
    const without = makePlanet({ ...world, ops: ops.filter((o) => o !== op) })
    const path = makePath(op.path), steps = Math.max(8, Math.ceil(path.total * km / 15))
    const [sx, sy, sz] = toDir(...op.path[0]), src = Math.max(0, planet.elevation(sx, sy, sz, 2))
    if (without.elevation(sx, sy, sz, 2) <= 0) warnings.push(`${name}: source ${fmtLL(op.path[0])} is under water`)
    let gorge = 0, gorgeAt: LatLon = op.path[0]
    for (let s = 1; s < steps; s++) {
      const target = s / steps * path.total
      let i = 0
      while (i < path.cum.length - 2 && path.cum[i + 1] < target) i++
      const seg = (target - path.cum[i]) / ((path.cum[i + 1] - path.cum[i]) || 1), a = op.path[i], b = op.path[i + 1]
      const ll: LatLon = [a[0] + (b[0] - a[0]) * seg, a[1] + (b[1] - a[1]) * seg]
      const [x, y, z] = toDir(...ll)
      const cut = without.elevation(x, y, z, 2) - src * (1 - s / steps) ** 1.3
      if (cut > gorge) { gorge = cut; gorgeAt = ll }
    }
    if (gorge > 2000) warnings.push(`${name}: cuts a ${m(gorge)} gorge near ${fmtLL(gorgeAt)}; route through lower ground (query nearby points) unless a canyon is intended`)
    const mouth = op.path[op.path.length - 1], [mx, my, mz] = toDir(...mouth)
    const coastal = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].some(([dl, dn]) => {
      const [x, y, z] = toDir(mouth[0] + dl, mouth[1] + dn), h = without.elevation(x, y, z, 2)
      const w = without.water(x, y, z, h)
      return w && w.kind !== 'river'
    })
    if (!coastal) warnings.push(`${name}: mouth ${fmtLL(mouth)} is ${m(without.elevation(mx, my, mz, 2))} up and not next to sea or a lake; end it at a coast`)
  }
  return { errors, warnings }
}

/** Everything an AI editor needs: conventions, the op language, workflow and the current state of the world. */
export function brief(world: World, planet: Planet = makePlanet(world)) {
  const ops = Object.entries(OP_SPECS).map(([k, s]) =>
    `- **${k}** (${s.label}): ${s.desc}\n  fields: ${s.fields.map(([f, , req, d]) => `\`${f}\`${req ? '' : '?'} ${d}`).join('; ')}\n  e.g. \`${JSON.stringify(s.example)}\``).join('\n')
  return `# Bookwright world brief: ${world.name}

You are editing a fantasy planet for a novel. The planet is generated from \`seed\` + \`params\`; you shape it with \`ops\`, an ordered list of named geographic features. Never invent other fields.

## Conventions
- Coordinates are \`[lat, lon]\` in degrees (lat -90..90, north positive; lon -180..180, east positive).
- Distances in km, elevations in metres above sea level. Radius ${({ ...DEFAULT_PARAMS, ...world.params }).radiusKm} km (1° ≈ ${Math.round(2 * Math.PI * ({ ...DEFAULT_PARAMS, ...world.params }).radiusKm / 360)} km).
- Every op needs a unique \`id\` (short string) and should have a \`name\` the author can see. Optional: \`note\` (lore), \`wikiId\`.
- Ops apply in list order on top of the generated terrain; later ops win.

## Ops
${ops}

## Layers
Overlays that never change the ground: \`layers: [{ id, name, kind, color?, opacity?, hidden?, items: [...] }]\`.
- kinds: ${Object.entries(LAYER_KINDS).map(([k, s]) => `\`${k}\` (${s.label}, items use \`${s.geom === 'any' ? 'at/path/area' : s.geom}\`)`).join(', ')}.
- item: \`{ id, name, at | path | area, props?, note?, wikiId? }\` with exactly one of \`at\` [lat, lon], \`path\` (line, >=2 points) or \`area\` (polygon, >=3 points). \`props\` holds free facts as strings/numbers; for cities \`props.type\` = capital | city | town | village sets the marker size.
- optional \`from\` / \`to\` on an item: \`{ "y": 412, "m": 3, "d": 9 }\` dates on the book's calendar (m, d optional). The item only shows while the app's time slider is within them; use it for borders and cities that change over the story.
- ids are unique across ops, layers and items. color is "#rrggbb", opacity 0..1.
- e.g. ${Object.entries(LAYER_KINDS).slice(0, 3).map(([k, s]) => `\`${JSON.stringify({ id: k, name: s.label, kind: k, items: [s.example] })}\``).join(' ')}
- Put cities on coasts, rivers and passes; draw borders along ranges and rivers; roads link cities through low ground.

## Doing it well
- Look before you build: \`describe\` the world and \`query\` points to find coasts, highlands and climate.
- Make geography plausible: ranges along coasts or between landmasses, rivers from highlands to the sea along low ground, lakes in basins, deserts around 15–35° latitude or in rain shadows, archipelagos off coasts.
- Prefer a few large, named features over many tiny ones. Keep existing ops and ids unless asked to change them.
- After editing, \`validate\` (fix every error, read the warnings) and \`preview\` the PNG to check the result.

## Tools (run in the BookWriting Tool repo)
- \`node scripts/world.ts describe <world.json>\` summary of landmasses, peaks, biomes, features
- \`node scripts/world.ts query <world.json> <lat> <lon>\` elevation, biome, climate, nearby features
- \`node scripts/world.ts validate <world.json>\` schema + geography checks
- \`node scripts/world.ts preview <world.json> [out.png] [--region N,S,W,E]\` map render with features marked; zoom in with --region
- \`node scripts/world.ts add <world.json> '<op json>'\` append an op (id generated if missing)

## Where the file lives
- From the app: Globe panel -> Export JSON, then Import JSON after editing.
- With sync on: \`worlds/${world.id}.json\` in the book's private data repo; commit, push, then Sync in the app.

## Current world
${describe(world, planet)}

\`\`\`json
${JSON.stringify(world, null, 2)}
\`\`\`
`
}
