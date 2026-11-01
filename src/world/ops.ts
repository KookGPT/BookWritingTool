// Feature operations: the declarative, AI-editable layer on top of the generated planet.
// Each op is plain JSON in geography terms (km, metres, lat/lon) and is applied in order after generation.
import { capOf, dirOf, dot, inPolygon, makePath, pathDist, type LatLon, type Vec } from './geo.ts'

export type { LatLon }
import { hash, rng, type Noise3 } from './noise.ts'

interface Base { id: string; name?: string; note?: string; wikiId?: string }
export type Op = Base & (
  | { kind: 'range'; path: LatLon[]; height: number; width: number }
  | { kind: 'rift'; path: LatLon[]; depth: number; width: number }
  | { kind: 'river'; path: LatLon[]; width?: number; depth?: number }
  | { kind: 'volcano'; at: LatLon; height: number; radius: number }
  | { kind: 'plateau'; at: LatLon; radius: number; height: number }
  | { kind: 'basin'; at: LatLon; radius: number; depth: number }
  | { kind: 'lake'; at: LatLon; radius: number; level?: number }
  | { kind: 'islands'; at: LatLon; radius: number; count: number; height?: number }
  | { kind: 'crater'; at: LatLon; radius: number; depth?: number }
  | { kind: 'raise' | 'lower'; at: LatLon; radius: number; amount: number }
  | { kind: 'flatten'; at: LatLon; radius: number; height: number }
  | { kind: 'land' | 'sea'; area: LatLon[]; height?: number; edge?: number }
)
export type OpKind = Op['kind']

type Field = 'path' | 'at' | 'area' | 'num'
// One table drives validation and the AI brief. [field, type, required, description]
export const OP_SPECS: Record<OpKind, { label: string; desc: string; fields: [string, Field, boolean, string][]; example: Record<string, unknown> }> = {
  range: { label: 'Mountain range', desc: 'Ridged mountains along a path; tapers at both ends.', fields: [['path', 'path', true, '>=2 points along the crest'], ['height', 'num', true, 'peak elevation, m (e.g. 3000-8000)'], ['width', 'num', true, 'km across (e.g. 80-300)']], example: { kind: 'range', name: 'The Spine', path: [[42, 10], [38, 18], [33, 22]], height: 5200, width: 180 } },
  rift: { label: 'Rift valley', desc: 'A long trough cut into the terrain.', fields: [['path', 'path', true, 'points along the rift'], ['depth', 'num', true, 'm below surroundings'], ['width', 'num', true, 'km across']], example: { kind: 'rift', name: 'Sundering Rift', path: [[5, 30], [-8, 34]], depth: 1200, width: 60 } },
  river: { label: 'River', desc: 'Cuts a valley falling steadily from the source to sea level at the mouth. Start in highlands, follow low ground, end at a coast or lake.', fields: [['path', 'path', true, 'source first, mouth last; 4+ points look natural'], ['width', 'num', false, 'channel km at the mouth (default 1.5)'], ['depth', 'num', false, 'channel depth below the valley floor, m (default 15)']], example: { kind: 'river', name: 'Ashrun', path: [[40, 16], [38.5, 14], [37, 13.2], [35.2, 11]] } },
  volcano: { label: 'Volcano', desc: 'A cone with a summit crater; makes an island if placed at sea.', fields: [['at', 'at', true, 'summit'], ['height', 'num', true, 'summit elevation, m'], ['radius', 'num', true, 'base radius, km']], example: { kind: 'volcano', name: 'Mount Ember', at: [36, 24], height: 4200, radius: 40 } },
  plateau: { label: 'Plateau', desc: 'Flat-topped upland with steep edges.', fields: [['at', 'at', true, 'centre'], ['radius', 'num', true, 'km'], ['height', 'num', true, 'top elevation, m']], example: { kind: 'plateau', name: 'High Steppe', at: [30, 40], radius: 300, height: 2200 } },
  basin: { label: 'Basin', desc: 'Lowers the land in a bowl; deep enough and it floods into an inland sea.', fields: [['at', 'at', true, 'centre'], ['radius', 'num', true, 'km'], ['depth', 'num', true, 'm lowered at the centre']], example: { kind: 'basin', name: 'The Sink', at: [20, 50], radius: 250, depth: 1500 } },
  lake: { label: 'Lake', desc: 'Fresh water filling a bowl at a fixed level.', fields: [['at', 'at', true, 'centre'], ['radius', 'num', true, 'km'], ['level', 'num', false, 'surface elevation, m (default: ground at centre)']], example: { kind: 'lake', name: 'Mirrormere', at: [41, 12], radius: 25 } },
  islands: { label: 'Archipelago', desc: 'A scatter of islands, deterministic per op id.', fields: [['at', 'at', true, 'centre'], ['radius', 'num', true, 'km spread'], ['count', 'num', true, 'islands (1-60)'], ['height', 'num', false, 'tallest peak, m (default 600)']], example: { kind: 'islands', name: 'The Shards', at: [10, -20], radius: 220, count: 14 } },
  crater: { label: 'Crater', desc: 'Impact bowl with a raised rim.', fields: [['at', 'at', true, 'centre'], ['radius', 'num', true, 'km'], ['depth', 'num', false, 'm (default ~60 m per km radius)']], example: { kind: 'crater', name: 'Starfall', at: [-25, 70], radius: 30 } },
  raise: { label: 'Raise', desc: 'Smoothly lifts an area.', fields: [['at', 'at', true, 'centre'], ['radius', 'num', true, 'km'], ['amount', 'num', true, 'm at the centre']], example: { kind: 'raise', at: [12, 5], radius: 150, amount: 800 } },
  lower: { label: 'Lower', desc: 'Smoothly sinks an area.', fields: [['at', 'at', true, 'centre'], ['radius', 'num', true, 'km'], ['amount', 'num', true, 'm at the centre']], example: { kind: 'lower', at: [12, 5], radius: 150, amount: 400 } },
  flatten: { label: 'Flatten', desc: 'Levels an area to one elevation (for a city, plain or dam).', fields: [['at', 'at', true, 'centre'], ['radius', 'num', true, 'km'], ['height', 'num', true, 'target elevation, m']], example: { kind: 'flatten', at: [38, 18], radius: 8, height: 200 } },
  land: { label: 'Land', desc: 'Raises a polygon above sea: new peninsulas, islands or land bridges.', fields: [['area', 'area', true, '>=3 points, in order around the outline'], ['height', 'num', false, 'typical elevation, m (default 250)'], ['edge', 'num', false, 'coast softness, km (default 40)']], example: { kind: 'land', name: 'Hook Peninsula', area: [[20, 0], [24, 6], [18, 9], [15, 3]] } },
  sea: { label: 'Sea', desc: 'Drowns a polygon: bays, straits, inland seas.', fields: [['area', 'area', true, '>=3 points around the outline'], ['height', 'num', false, 'depth, m (default 1500)'], ['edge', 'num', false, 'coast softness, km (default 40)']], example: { kind: 'sea', name: 'Gulf of Teeth', area: [[5, 40], [9, 46], [3, 50], [0, 44]] } },
}
export const OP_KINDS = Object.keys(OP_SPECS) as OpKind[]

/** A representative point for flying to / labelling an op. */
export const opCenter = (op: Op): LatLon => {
  if ('at' in op) return op.at
  const pts = 'path' in op ? op.path : op.area
  if ('path' in op) return pts[Math.floor(pts.length / 2)]
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

/** A river's actual course: its path densified every few km and swung into meanders (ends stay put). */
export function riverCourse(op: Extract<Op, { kind: 'river' }>, radiusKm: number, n: Noise3): LatLon[] {
  const out: LatLon[] = [], salt = (hash(op.id) % 997) * 0.37
  const segs: { a: LatLon; b: LatLon; len: number }[] = []
  for (let i = 0; i < op.path.length - 1; i++) {
    const a = op.path[i], b = op.path[i + 1]
    segs.push({ a, b, len: Math.hypot(b[0] - a[0], (b[1] - a[1]) * Math.cos((a[0] + b[0]) * Math.PI / 360)) * Math.PI / 180 * radiusKm })
  }
  const total = segs.reduce((s, g) => s + g.len, 0) || 1, amp = Math.min(30, 6 + total / 40) // km of sideways swing
  let walked = 0
  for (const g of segs) {
    const steps = Math.max(1, Math.ceil(g.len / 4))
    const dLat = g.b[0] - g.a[0], dLon = g.b[1] - g.a[1], cosLat = Math.cos(g.a[0] * Math.PI / 180)
    const l = Math.hypot(dLat, dLon * cosLat) || 1, perp: LatLon = [-dLon * cosLat / l, dLat / l / Math.max(0.1, cosLat)] // unit-ish sideways, in degrees
    for (let k = 0; k < steps; k++) {
      const f = k / steps, s = walked + g.len * f, t = s / total
      const off = amp * taper(t) * (n(s / 110, salt, 0) + 0.35 * n(s / 40, salt, 7)) / radiusKm * 180 / Math.PI
      out.push([g.a[0] + dLat * f + perp[0] * off, g.a[1] + dLon * f + perp[1] * off])
    }
    walked += g.len
  }
  out.push(op.path[op.path.length - 1])
  return out
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const smax = (a: number, b: number, k: number) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return a + (b - a) * h + k * h * (1 - h) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const taper = (t: number) => smooth(0, 0.12, t) * smooth(1, 0.88, t)

export interface Compiled {
  op: Op
  cap: { c: Vec; cos: number }
  stage: 'shape' | 'water'
  apply: (h: number, p: Vec) => number
  water?: (p: Vec, h: number) => number | 'river' | undefined // lake level, or river channel
}

/** Turns ops into fast appliers. `ground` gives the pre-op elevation (for lake levels). */
export function compileOps(ops: Op[], radiusKm: number, n: Noise3, ground: (p: Vec) => number): Compiled[] {
  const km = (rad: number) => rad * radiusKm
  const rad = (k: number) => k / radiusKm
  const out: Compiled[] = []
  for (const op of ops) {
    const N = (p: Vec, f: number, off = 0) => n(p[0] * f + off, p[1] * f, p[2] * f)
    const salt = (hash(op.id) % 997) * 0.37 // each op gets its own slice of noise
    const point = 'at' in op ? dirOf(op.at) : undefined
    const u = (p: Vec, radius: number) => km(Math.acos(Math.max(-1, Math.min(1, dot(p, point!))))) / radius
    switch (op.kind) {
      case 'range': {
        const path = makePath(op.path), half = op.width / 2
        out.push({ op, stage: 'shape', cap: capOf(path.pts, rad(op.width)), apply: (h, p) => {
          const { d, t } = pathDist(p, path), x = km(d) / half
          if (x > 1.6) return h
          const crest = op.height * taper(t) * (0.75 + 0.25 * N(p, 25, salt))
          // spurs and side ridges: ridged noise at two scales, stronger toward the crest
          const r1 = 1 - Math.abs(N(p, 260, salt + 3)), r2 = 1 - Math.abs(N(p, 640, salt + 9))
          const ridges = 0.45 + 0.35 * r1 * r1 + 0.2 * r2 * r2
          return smax(h, crest * Math.exp(-x * x * 1.5) * ridges, 300)
        } })
        break
      }
      case 'rift': {
        const path = makePath(op.path), half = op.width / 2
        out.push({ op, stage: 'shape', cap: capOf(path.pts, rad(op.width)), apply: (h, p) => {
          const { d, t } = pathDist(p, path), x = km(d) / half
          return x > 1 ? h : h - op.depth * (1 - x * x) ** 1.5 * taper(t)
        } })
        break
      }
      case 'river': {
        // the river cuts a valley down to a bed that falls steadily from the source to sea level at the mouth,
        // so it always runs downhill whatever the generated terrain does
        const path = makePath(riverCourse(op, radiusKm, n)), w = op.width ?? 1.5, depth = op.depth ?? 15, half = 10 + w * 3
        const src = Math.max(0, ground(path.pts[0]))
        const bed = (t: number) => src * (1 - t) ** 1.3
        out.push({ op, stage: 'water', cap: capOf(path.pts, rad(half * 1.2)), apply: (h, p) => {
          const { d, t } = pathDist(p, path), dk = km(d)
          if (dk > half) return h
          const b = bed(t)
          if (h > b) h = b + (h - b) * smooth(0.12, 1, dk / half)
          const cw = (w / 2) * (0.35 + 0.65 * t)
          return dk < cw ? h - depth * (1 - (dk / cw) ** 2) : h
        }, water: (p) => {
          const { d, t } = pathDist(p, path)
          return km(d) < (w / 2) * (0.35 + 0.65 * t) ? 'river' : undefined
        } })
        break
      }
      case 'volcano': {
        out.push({ op, stage: 'shape', cap: capOf([point!], rad(op.radius * 1.8)), apply: (h, p) => {
          const x = u(p, op.radius) * (1 + 0.08 * N(p, 60, salt))
          if (x > 1.8) return h
          let cone = x < 1 ? op.height * (1 - x) ** 1.6 : -3000 * Math.min(1, (x - 1) / 0.8)
          if (x < 0.12) cone -= op.height * 0.12 * (1 - x / 0.12) ** 2
          return smax(h, cone, 150)
        } })
        break
      }
      case 'plateau': {
        out.push({ op, stage: 'shape', cap: capOf([point!], rad(op.radius * 1.2)), apply: (h, p) => {
          const x = u(p, op.radius) * (1 + 0.15 * N(p, 30, salt))
          const m = 1 - smooth(0.85, 1.05, x)
          return m <= 0 ? h : mix(h, op.height + 60 * N(p, 200, salt), m)
        } })
        break
      }
      case 'basin': {
        out.push({ op, stage: 'shape', cap: capOf([point!], rad(op.radius)), apply: (h, p) => {
          const x = u(p, op.radius) * (1 + 0.12 * N(p, 30, salt))
          return h - op.depth * smooth(1, 0.3, x)
        } })
        break
      }
      case 'lake': {
        const level = op.level ?? Math.max(1, ground(point!))
        const edge = (p: Vec) => u(p, op.radius) * (1 + 0.22 * N(p, 70, salt))
        out.push({ op, stage: 'water', cap: capOf([point!], rad(op.radius * 1.3)), apply: (h, p) => {
          const x = edge(p)
          return x >= 1 ? h : Math.min(h, level - 60 * Math.sqrt(1 - x))
        }, water: (p, h) => (edge(p) < 1.15 && h < level ? level : undefined) })
        break
      }
      case 'islands': {
        const r = rng(hash(op.id)), top = op.height ?? 600
        const count = Math.max(1, Math.min(60, Math.round(op.count)))
        const blobs = Array.from({ length: count }, () => {
          const b = r() * Math.PI * 2, dist = Math.sqrt(r()) * op.radius
          const lat = op.at[0] + (dist / radiusKm) * 180 / Math.PI * Math.cos(b)
          const lon = op.at[1] + (dist / radiusKm) * 180 / Math.PI * Math.sin(b) / Math.max(0.1, Math.cos(op.at[0] * Math.PI / 180))
          return { c: dirOf([lat, lon]), radius: op.radius * (0.18 + 0.3 * r()) / Math.sqrt(count) * 1.6, height: top * (0.35 + 0.65 * r()) }
        })
        out.push({ op, stage: 'shape', cap: capOf([point!], rad(op.radius * 1.5)), apply: (h, p) => {
          for (const bl of blobs) {
            const x = km(Math.acos(Math.max(-1, Math.min(1, dot(p, bl.c))))) / bl.radius * (1 + 0.3 * N(p, 120, salt))
            if (x < 2) h = smax(h, x < 1 ? bl.height * (1 - x) ** 1.3 : -1500 * (x - 1), 80)
          }
          return h
        } })
        break
      }
      case 'crater': {
        const depth = op.depth ?? Math.min(4000, op.radius * 60)
        out.push({ op, stage: 'shape', cap: capOf([point!], rad(op.radius * 1.6)), apply: (h, p) => {
          const x = u(p, op.radius)
          return h + (x < 1 ? -depth * (1 - x * x) : 0) + depth * 0.35 * Math.exp(-(((x - 1) / 0.15) ** 2))
        } })
        break
      }
      case 'raise':
      case 'lower': {
        const sign = op.kind === 'raise' ? 1 : -1
        out.push({ op, stage: 'shape', cap: capOf([point!], rad(op.radius)), apply: (h, p) => {
          const x = Math.min(1, u(p, op.radius))
          return h + sign * op.amount * 0.5 * (1 + Math.cos(Math.PI * x))
        } })
        break
      }
      case 'flatten': {
        out.push({ op, stage: 'water', cap: capOf([point!], rad(op.radius)), apply: (h, p) => mix(h, op.height, 1 - smooth(0.7, 1, u(p, op.radius))) })
        break
      }
      case 'land':
      case 'sea': {
        const poly = op.area.map(dirOf), ring = makePath([...op.area, op.area[0]]), edge = op.edge ?? 40
        out.push({ op, stage: 'shape', cap: capOf(poly, rad(edge * 1.6)), apply: (h, p) => {
          const s = (inPolygon(p, poly) ? 1 : -1) * km(pathDist(p, ring).d) + edge * 0.6 * N(p, 25, salt)
          const m = smooth(-edge, edge, s)
          if (m <= 0) return h
          return op.kind === 'land'
            ? mix(h, smax(h, (op.height ?? 250) + 150 * N(p, 60, salt), 100), m)
            : mix(h, Math.min(h, -(op.height ?? 1500)), m)
        } })
        break
      }
    }
  }
  return out
}
