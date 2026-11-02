// Story geometry: great-circle arcs, the party's route between event locations, and where it is on a given day.
// Pure (no DOM). Days are calendar ordinals (see calendar.ts).
import { angle, dirOf, toLatLon, type LatLon } from './geo.ts'

const D = Math.PI / 180

/** Point a fraction t along the great circle from a to b. */
export function slerp(a: LatLon, b: LatLon, t: number): LatLon {
  const va = dirOf(a), vb = dirOf(b), w = angle(va, vb)
  if (w < 1e-9) return a
  const ka = Math.sin((1 - t) * w) / Math.sin(w), kb = Math.sin(t * w) / Math.sin(w)
  const p = toLatLon(ka * va[0] + kb * vb[0], ka * va[1] + kb * vb[1], ka * va[2] + kb * vb[2])
  return [p.lat, p.lon]
}

/** A great-circle path from a to b with a point every `stepDeg`, so it hugs the sphere when drawn. */
export function arc(a: LatLon, b: LatLon, stepDeg = 2): LatLon[] {
  const n = Math.max(1, Math.ceil(angle(dirOf(a), dirOf(b)) / D / stepDeg))
  return Array.from({ length: n + 1 }, (_, i) => slerp(a, b, i / n))
}

export interface Stop { id: string; title: string; at: LatLon; day: number }
export interface Leg { from: Stop; to: Stop; km: number; travelDays: number; gapDays: number; tight: boolean }

/** Legs between consecutive stops (sorted by day). `tight` = the story gives less time than the journey needs. */
export function legs(stops: Stop[], radiusKm: number, kmPerDay: number): Leg[] {
  const out: Leg[] = []
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1], to = stops[i], km = angle(dirOf(from.at), dirOf(to.at)) * radiusKm
    if (km < 1) continue // same place
    const travelDays = km / Math.max(1, kmPerDay), gapDays = to.day - from.day
    out.push({ from, to, km, travelDays, gapDays, tight: travelDays > gapDays + 0.5 })
  }
  return out
}

/** Where the party is on `day`: nowhere before the first stop, in transit between stops, at the last stop after it. */
export function partyAt(stops: Stop[], day: number): LatLon | undefined {
  if (!stops.length || day < stops[0].day) return undefined
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i]
    if (day <= b.day) return b.day === a.day ? b.at : slerp(a.at, b.at, (day - a.day) / (b.day - a.day))
  }
  return stops[stops.length - 1].at
}
