// Does it make geographic sense? Checks terrain patches and settlements against the planet's real climate and ground, and finds
// good places for them. Pure (node + browser): used by `validate`, and by the CLI `fit` and `sites` commands.
import { toDir, toLatLon, type LatLon } from './geo.ts'
import type { LayerItem } from './layers.ts'
import type { Op } from './ops.ts'
import { frame, groundAt, riverNear } from './settle.ts'
import { footprintKm, popOf, siteOf, tierOf } from './sites.ts'
import type { Planet } from './terrain.ts'
import { TERRAINS } from './terrains.ts'

const DETAIL = 8
const ring = (r: number, n = 8) => Array.from({ length: n }, (_, i): [number, number] => [Math.cos(i / n * Math.PI * 2) * r, Math.sin(i / n * Math.PI * 2) * r])

/** Climate and ground at a point, as the generator sees it. */
export function conditions(planet: Planet, ll: LatLon) {
  const [x, y, z] = toDir(ll[0], ll[1]), h = planet.elevation(x, y, z, DETAIL), c = planet.climate(x, y, z, h)
  return { ...c, h, sea: h < 0 }
}

/** The sample points of a terrain or zone op (centre and a ring at half radius, or the outline and its middle). */
function samples(op: Extract<Op, { kind: 'terrain' | 'zone' }>, radiusKm: number): LatLon[] {
  if (op.kind === 'zone') {
    const mid: LatLon = [op.area.reduce((a, p) => a + p[0], 0) / op.area.length, op.area.reduce((a, p) => a + p[1], 0) / op.area.length]
    return [mid, ...op.area.map((p): LatLon => [(p[0] + mid[0]) / 2, (p[1] + mid[1]) / 2])]
  }
  const dl = op.radius * 0.5 / radiusKm * 180 / Math.PI, k = Math.max(0.2, Math.cos(op.at[0] * Math.PI / 180))
  return [op.at, ...ring(1, 8).map(([a, b]): LatLon => [op.at[0] + a * dl, op.at[1] + b * dl / k])]
}

/** Warnings for terrain patches that don't belong where they are: in the sea, or in a climate the terrain can't live in. */
export function terrainIssues(planet: Planet, op: Op): string[] {
  if (op.kind !== 'terrain' && op.kind !== 'zone') return []
  const t = TERRAINS[op.terrain]
  if (!t) return []
  const pts = samples(op, planet.radiusM / 1000).map((ll) => conditions(planet, ll)), out: string[] = []
  const sea = pts.filter((p) => p.sea).length
  if (sea > pts.length * 0.6) out.push(`${op.terrain} is painted over open sea; terrain only shows on land (move it, or raise land there first)`)
  const land = pts.filter((p) => !p.sea)
  const hab = t.habitat
  if (hab && land.length) {
    const out2 = (k: 'temp' | 'moist') => land.filter((p) => hab[k] && (p[k] < hab[k]![0] || p[k] > hab[k]![1])).length > land.length / 2
    const mean = (k: 'temp' | 'moist') => land.reduce((a, p) => a + p[k], 0) / land.length
    if (out2('moist')) out.push(`${op.terrain} sits in ${mean('moist') > hab.moist![1] ? 'a wetter' : 'a drier'} climate than it occurs in (moisture ${mean('moist').toFixed(2)} here, wants ${hab.moist![0]}-${hab.moist![1]}): ${hab.why}. Move it (try \`fit ${op.terrain}\`) or accept it as magic`)
    if (out2('temp')) out.push(`${op.terrain} sits in ${mean('temp') > hab.temp![1] ? 'a hotter' : 'a colder'} climate than it occurs in (${mean('temp').toFixed(0)} C here, wants ${hab.temp![0]} to ${hab.temp![1]} C): ${hab.why}. Move it (try \`fit ${op.terrain}\`) or accept it as magic`)
  }
  return out
}

/** Why a settlement or structure is badly placed; empty when it makes sense. `first` stops at the first problem (cheaper). */
export function siteIssues(planet: Planet, item: LayerItem, first = false): string[] {
  const s = siteOf(item), at = item.at ?? item.path?.[0]
  if (!s || !at) return []
  const c = toDir(at[0], at[1]), R = planet.radiusM, out: string[] = []
  const add = (m: string) => { out.push(m); return first }
  if (s.def.cls === 'bridge') {
    const rv = riverNear(planet, c)
    if (!item.path && !(rv && rv.d < Math.max(1, rv.widthKm * 1.2))) out.push('is not over a river: put `at` on a river (it snaps to the course and spans it) or give a `path` from bank to bank')
    return out
  }
  const g = groundAt(planet, c), r = Math.max(30, footprintKm(item) * 1000), tier = tierOf(popOf(item))
  if (g.wet(0, 0)) return ['stands in water; move it onto land']
  const pts = [[0, 0] as [number, number], ...ring(r * 0.55), ...ring(r * 0.95)]
  // the lie of the land across the footprint (centre to ring), not the micro-relief that gives every metre of ground some slope
  const h0 = g.h(0, 0), rr = Math.max(r, 90), tilt = [...ring(Math.max(rr * 0.55, 60)), ...ring(rr * 0.95)]
  const slope = tilt.reduce((a, [x, z]) => a + Math.abs(g.h(x, z) - h0) / Math.hypot(x, z), 0) / tilt.length
  if (s.def.needs.includes('flat')) {
    const limit = s.def.cls === 'settlement' ? (tier >= 3 ? 0.12 : tier === 2 ? 0.16 : 0.2) : 0.1 // farms and mills need level fields
    if (slope > limit && add(`sits on steep ground (slope ${(slope * 100).toFixed(0)}%, wants under ${Math.round(limit * 100)}%); move it to flatter land or choose a hillier type`)) return out
  }
  if (s.def.needs.includes('arable') && pts.filter(([x, z]) => g.arable(x, z)).length < pts.length * 0.4 && add(`has no fertile ground (${g.terr(0, 0) || 'water'} here); farms and villages need grassland, meadow, woodland or similar`)) return out
  if (s.def.needs.includes('highland') && !(g.h(0, 0) > 400 || slope > 0.12) && add('is on low flat ground; mines belong in hills or mountains')) return out
  const { dirAt } = frame(c, R)
  const wet = (km: number, kind?: string) => ring(km * 1000, 10).some(([x, z]) => {
    const d = dirAt(x, z), h = planet.elevation(d[0], d[1], d[2], DETAIL), w = planet.water(d[0], d[1], d[2], h)
    return !!w && (!kind || w.kind === kind)
  })
  const rv = riverNear(planet, c)
  const big = tier >= 4
  if (s.def.needs.includes('coast') && !(wet(0.5, 'sea') || wet(2, 'sea') || wet(4, 'sea') || (rv && rv.d < 2 && rv.widthKm >= 6)) && add('is not on the coast (needs the sea or a wide river within a few km)')) return out
  if (s.def.needs.includes('water') && !(wet(1) || wet(3) || wet(6) || wet(10) || (rv && rv.d < 10)) && add('has no water within 10 km; settlements need a river, lake or coast')) return out
  if (big && !(wet(4, 'sea') || wet(8, 'sea') || (rv && rv.d < 6 && rv.widthKm >= 6)) && add(`a ${tier === 5 ? 'megacity' : 'metropolis'} needs the sea or a great river (6+ km wide) within a few km`)) return out
  return out
}

/** The shore nearest a point (sea within `maxKm`), set a little inland: where a port or lighthouse can actually stand. */
export function snapToCoast(planet: Planet, ll: LatLon, maxKm = 80): LatLon | undefined {
  const c = toDir(ll[0], ll[1]), { dirAt } = frame(c, planet.radiusM)
  const sea = (x: number, z: number) => { const d = dirAt(x, z); return planet.elevation(d[0], d[1], d[2], DETAIL) < 0 }
  if (sea(0, 0)) return undefined
  for (let km = 0.4; km <= maxKm; km *= 1.3) {
    for (const [ux, uz] of ring(1, 24)) {
      if (!sea(ux * km * 1000, uz * km * 1000)) continue
      let lo = 0, hi = km * 1000 // land at lo, sea at hi
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (sea(ux * mid, uz * mid)) hi = mid; else lo = mid }
      for (const inland of [250, 500, 900]) { // not in a river mouth: step back until it is dry land
        const d = dirAt(ux * Math.max(0, lo - inland), uz * Math.max(0, lo - inland)), h = planet.elevation(d[0], d[1], d[2], DETAIL)
        if (h < 1 || planet.water(d[0], d[1], d[2], h)) continue
        const p = toLatLon(d[0], d[1], d[2])
        return [Math.round(p.lat * 1000) / 1000, Math.round(p.lon * 1000) / 1000]
      }
    }
  }
  return undefined
}

export interface Spot { at: LatLon; note: string }
const hashN = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }

/** Land cells on a lat/lon grid inside [N, S, W, E]. */
function* cells(planet: Planet, region: number[], step: number): Generator<LatLon> {
  const [N, S, W, E] = [Math.max(region[0], region[1]), Math.min(region[0], region[1]), region[2], region[3] > region[2] ? region[3] : region[3] + 360]
  for (let lat = N - step / 2; lat > S; lat -= step) {
    const k = Math.max(0.15, Math.cos(lat * Math.PI / 180))
    for (let lon = W + step / 2 / k; lon < E; lon += step / k) {
      const ll: LatLon = [Math.round(lat * 100) / 100, Math.round(((lon + 540) % 360 - 180) * 100) / 100]
      const [x, y, z] = toDir(ll[0], ll[1])
      if (planet.elevation(x, y, z, 4) > 5) yield ll
    }
  }
}

/** Places where a terrain occurs naturally (inside its habitat), best first, spread out. */
export function fitTerrain(planet: Planet, id: string, region = [90, -90, -180, 180], step = 4, top = 8): Spot[] {
  const hab = TERRAINS[id]?.habitat
  if (!hab) return []
  const found: { at: LatLon; margin: number; note: string }[] = []
  for (const ll of cells(planet, region, step)) {
    const c = conditions(planet, ll)
    const m = (v: number, r?: [number, number]) => r ? Math.min(v - r[0], r[1] - v) / (r[1] - r[0]) : 1
    const margin = Math.min(m(c.temp, hab.temp), m(c.moist, hab.moist))
    if (margin > 0.1 && c.h < 1800) found.push({ at: ll, margin, note: `${c.temp.toFixed(0)} C, moisture ${c.moist.toFixed(2)}, ${Math.round(c.h)} m` })
  }
  return spread(found.sort((a, b) => b.margin - a.margin), top, step * 2.5)
}

/** Places where a site type makes sense, spread out. */
export function fitSite(planet: Planet, type: string, region = [90, -90, -180, 180], step = 4, top = 8): Spot[] {
  const found: { at: LatLon; margin: number; note: string }[] = []
  const coastal = siteOf({ props: { type } })?.def.needs.includes('coast')
  for (const cell of cells(planet, region, step)) {
    const ll = coastal ? snapToCoast(planet, cell, step * 60) : cell
    if (!ll) continue
    const item: LayerItem = { id: 'fit', at: ll, props: { type } }
    if (siteIssues(planet, item, true).length === 0) found.push({ at: ll, margin: hashN(`${ll}`) / 4294967296, note: conditions(planet, ll).h.toFixed(0) + ' m' })
  }
  return spread(found.sort((a, b) => b.margin - a.margin), top, step * 2)
}

function spread(list: { at: LatLon; note: string }[], top: number, minDeg: number): Spot[] {
  const out: Spot[] = []
  for (const f of list) {
    if (out.every((o) => Math.hypot(o.at[0] - f.at[0], (o.at[1] - f.at[1]) * Math.cos(f.at[0] * Math.PI / 180)) >= minDeg)) out.push({ at: f.at, note: f.note })
    if (out.length >= top) break
  }
  return out
}
