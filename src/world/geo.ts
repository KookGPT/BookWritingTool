// Sphere geometry on unit vectors. Lat/lon in degrees; lon 0 faces +Z, north is +Y.
export type Vec = [number, number, number]
export type LatLon = [number, number] // [lat, lon]

export const toDir = (lat: number, lon: number): Vec => {
  const a = lat * Math.PI / 180, o = lon * Math.PI / 180
  return [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)]
}
export const toLatLon = (x: number, y: number, z: number) => {
  const r = Math.hypot(x, y, z)
  return { lat: Math.asin(y / r) * 180 / Math.PI, lon: Math.atan2(x, z) * 180 / Math.PI }
}
export const dirOf = (p: LatLon) => toDir(p[0], p[1])

export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm = (a: Vec): Vec => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
/** Angle between unit vectors, radians. */
export const angle = (a: Vec, b: Vec) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b))
/** Great-circle distance in km. */
export const distKm = (a: LatLon, b: LatLon, radiusKm: number) => angle(dirOf(a), dirOf(b)) * radiusKm

// Long paths (a densified river is thousands of segments) are split into chunks with a bounding cap each, so a distance
// query only walks the chunks that could hold the nearest point.
const CHUNK = 12
export interface Path { pts: Vec[]; cum: number[]; total: number; nrm: (Vec | undefined)[]; chunks: { c: Vec; r: number; from: number; to: number }[] } // cumulative angle along the path
export const makePath = (ll: LatLon[]): Path => {
  const pts = ll.map(dirOf), cum = [0], nrm: (Vec | undefined)[] = [], chunks: Path['chunks'] = []
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + angle(pts[i - 1], pts[i]))
    const n = cross(pts[i - 1], pts[i]), l = Math.hypot(...n)
    nrm.push(l < 1e-12 ? undefined : [n[0] / l, n[1] / l, n[2] / l])
  }
  for (let i = 0; i < pts.length - 1; i += CHUNK) {
    const j = Math.min(pts.length - 1, i + CHUNK), c = norm(pts.slice(i, j + 1).reduce<Vec>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]))
    chunks.push({ c, r: Math.max(...pts.slice(i, j + 1).map((v) => angle(c, v))), from: i, to: j })
  }
  return { pts, cum, total: cum[cum.length - 1] || 1e-12, nrm, chunks }
}

/** Distance (radians) from p to a polyline of great-circle arcs, and how far along it (0..1) the nearest point is. */
export function pathDist(p: Vec, path: Path) {
  let best = Infinity, t = 0
  const { pts, cum, nrm, chunks } = path
  if (pts.length === 1) return { d: angle(p, pts[0]), t: 0 }
  const run = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const a = pts[i], b = pts[i + 1], nn = nrm[i]
      let d: number, along: number
      if (!nn) { d = angle(p, a); along = 0 } else {
        const s = dot(p, nn), q: Vec = [p[0] - nn[0] * s, p[1] - nn[1] * s, p[2] - nn[2] * s]
        if (dot(cross(a, q), nn) >= 0 && dot(cross(q, b), nn) >= 0) { d = Math.abs(Math.asin(Math.max(-1, Math.min(1, s)))); along = angle(a, norm(q)) } else {
          const da = angle(p, a), db = angle(p, b)
          if (da < db) { d = da; along = 0 } else { d = db; along = cum[i + 1] - cum[i] }
        }
      }
      if (d < best) { best = d; t = (cum[i] + along) / path.total }
    }
  }
  if (chunks.length < 3) run(0, pts.length - 1)
  else {
    let k0 = 0, top = -2 // the chunk whose centre is nearest gives a tight bound first, then the rest are skipped unless they could beat it
    for (let k = 0; k < chunks.length; k++) { const c = dot(p, chunks[k].c); if (c > top) { top = c; k0 = k } }
    run(chunks[k0].from, chunks[k0].to)
    for (let k = 0; k < chunks.length; k++) if (k !== k0 && dot(p, chunks[k].c) >= Math.cos(Math.min(Math.PI, best + chunks[k].r))) run(chunks[k].from, chunks[k].to)
  }
  return { d: best, t }
}

/** Inside a spherical polygon: the signed angles the edges subtend at p add up to +-2pi inside, 0 outside. */
export function inPolygon(p: Vec, poly: Vec[]) {
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    sum += Math.atan2(dot(p, cross(a, b)), dot(a, b) - dot(a, p) * dot(b, p))
  }
  return Math.abs(sum) > Math.PI
}

/** Smallest cap (centre + angular radius) around some points; used to skip far-away features quickly. */
export function capOf(pts: Vec[], pad: number) {
  const c = norm(pts.reduce<Vec>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]))
  const r = Math.max(0, ...pts.map((v) => angle(c, v))) + pad
  return { c, cos: Math.cos(Math.min(Math.PI, r)) }
}

/** Area of a spherical polygon in km², by summing signed triangle excesses fanned from the first vertex. */
export function areaKm2(area: LatLon[], radiusKm: number) {
  const v = area.map(dirOf), a = v[0]
  let e = 0
  for (let i = 1; i < v.length - 1; i++) {
    const b = v[i], c = v[i + 1]
    e += 2 * Math.atan2(dot(a, cross(b, c)), 1 + dot(a, b) + dot(b, c) + dot(c, a))
  }
  return Math.abs(e) * radiusKm ** 2
}
