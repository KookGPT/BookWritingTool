// The standard shot set for a location (pure): the same pictures every session, so before and after can be compared.
import { facingVec, withTownCentres, type LocationDoc, type Season, type Weather } from './city.ts'
import { footprint } from './terrain.ts'

/** [name, [x, y north, alt], heading (compass degrees), pitch (degrees, down negative), atmosphere]. */
export type Shot = [string, [number, number, number], number, number, { hour?: number; weather?: Weather; season?: Season }]

const DEG = 180 / Math.PI
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const headingTo = (fx: number, fy: number, tx: number, ty: number) => ((Math.atan2(tx - fx, ty - fy) * DEG) % 360 + 360) % 360

/** Look at (tx, ty) from `dist` metres away towards `from` (compass degrees), `drop` of a metre down per metre out, aiming `aimH` above its ground. */
function lookAt(name: string, tx: number, ty: number, dist: number, from: number, aimH: number, groundAt: (x: number, y: number) => number): Shot {
  const a = from / DEG, cx = tx + Math.sin(a) * dist, cy = ty + Math.cos(a) * dist
  const tg = groundAt(tx, ty) + aimH
  let alt = Math.max(tg + dist * 0.3, groundAt(cx, cy) + 25)
  // high enough to see over any hill on the way: the sight line clears the ground by 10 m up to near the target
  for (let t = 0.05; t <= 0.9; t += 0.05) alt = Math.max(alt, (groundAt(cx + (tx - cx) * t, cy + (ty - cy) * t) + 10 - tg * t) / (1 - t))
  return [name, [Math.round(cx), Math.round(cy), Math.round(alt)], Math.round(headingTo(cx, cy, tx, ty)), Math.round(-Math.atan2(alt - tg, dist) * DEG * 10) / 10, {}]
}

/**
 * Every saved view, then a fixed set: overview, low pass from the south, each great structure close up,
 * each town at street height. Names are unique and stable, so the same shot from two sessions pairs up.
 */
export function standardShots(doc: LocationDoc, groundAt: (x: number, y: number) => number): Shot[] {
  const S = doc.size, out: Shot[] = []
  for (const v of doc.views ?? []) out.push([`view-${slug(v.name)}`, v.at, v.heading, v.pitch, { hour: v.hour, weather: v.weather, season: v.season }])
  // overview: high from the south-south-east, as the Overview button
  const ox = S * 0.34, oy = -S * 0.53, oz = S * 0.25 + 800
  out.push(['overview', [Math.round(ox), Math.round(oy), Math.round(oz)], Math.round(headingTo(ox, oy, 0, 0)), Math.round(-Math.atan2(oz, Math.hypot(ox, oy)) * DEG), {}])
  // low pass: just inside the south edge, 150 m over the ground, looking north
  out.push(['low-pass', [0, Math.round(-S * 0.45), -150], 0, -3, {}])
  for (const s of doc.structures) {
    const line = s.path ?? (s.at && s.to ? [s.at, s.to] : null)
    let tx: number, ty: number, r: number
    if (line) {
      const a = line[0], b = line[line.length - 1]
      tx = (a[0] + b[0]) / 2; ty = (a[1] + b[1]) / 2; r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2
    } else if (s.at) { tx = s.at[0]; ty = s.at[1]; r = footprint(s)?.r ?? 40 } else continue
    // lines are seen from the side, everything else three-quarters from the front (facing defaults to south)
    const from = line ? (headingTo(line[0][0], line[0][1], line[line.length - 1][0], line[line.length - 1][1]) + 90) % 360 : ((s.facing ?? 180) + 35) % 360
    const dist = Math.min(2500, Math.max(180, r * (line ? 1.4 : 2.6))), aim = Math.min(40, r * 0.4)
    const a = lookAt(`structure-${slug(s.id)}`, tx, ty, dist, from, aim, groundAt), b = lookAt(a[0], tx, ty, dist, (from + 180) % 360, aim, groundAt)
    out.push(b[1][2] < a[1][2] - 30 ? b : a) // from the other side if that one sees it from much lower
  }
  // street height: from one end of the town's square, 6 m up, looking along it and on down the main street
  // (a town whose core the recipe already gave a plaza or market: from that square towards the nearest great building)
  const all = withTownCentres(doc).structures, near = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1])
  for (const d of doc.districts) {
    if (!d.at) continue
    const auto = all.find((s) => s.id === `${d.id}~square`)
    const own = auto ? undefined : doc.structures.find((s) => s.at && (s.kind === 'plaza' || s.kind === 'market') && near(s.at, d.at!) < Math.max(150, (d.radius ?? 300) * 0.3))
    const sq = auto ?? own, at = sq?.at ?? d.at
    const goal = own && doc.structures.filter((s) => s.at && s !== own && s.kind !== 'plaza' && near(s.at, at) < 400).sort((a, b) => near(a.at!, at) - near(b.at!, at))[0]
    const h = goal ? headingTo(at[0], at[1], goal.at![0], goal.at![1]) : sq?.facing ?? 0
    const back = own ? (footprint(own)?.r ?? 40) * 0.8 : (sq?.depth ?? 60) / 2, [fx, fy] = facingVec(h)
    const cx = at[0] - fx * back, cy = at[1] - fy * back, alt = Math.max(groundAt(cx, cy), groundAt(at[0], at[1])) + 6 // never under a square levelled into a slope
    out.push([`town-${slug(d.id)}`, [Math.round(cx), Math.round(cy), Math.round(alt)], Math.round((h % 360 + 360) % 360), goal ? 4 : 1, {}])
  }
  return out
}
