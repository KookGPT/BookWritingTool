// Layers: named overlays (cities, regions, borders, religions, roads...) drawn on top of the planet.
// Plain JSON on the world, like ops, but they never change the ground. Also: picking features under the cursor.
import { angle, areaKm2, dirOf, inPolygon, makePath, pathDist, type LatLon } from './geo.ts'
import type { Calendar } from '../calendar.ts'
import { dayOf, type TDate } from '../timelineScale.ts'
import { OP_SPECS, type Op } from './ops.ts'
import { footprintKm, markerPx, siteOf, SITE_IDS } from './sites.ts'

export interface LayerItem {
  id: string; name?: string; note?: string; wikiId?: string
  at?: LatLon; path?: LatLon[]; area?: LatLon[] // exactly one: a point, a line or a polygon
  props?: Record<string, string | number> // free-form facts, e.g. { type: 'capital', population: 120000 }
  from?: TDate; to?: TDate // when it exists on the book calendar; open-ended if omitted (used by the time slider)
}
export interface Layer { id: string; name: string; kind: LayerKind; color?: string; opacity?: number; hidden?: boolean; items: LayerItem[] }

export const LAYER_KINDS = {
  cities: { label: 'Cities & towns', geom: 'at', color: '#ffd166', example: { id: 'c1', name: 'Port Varra', at: [37.2, 12.5], props: { type: 'capital', population: 80000 } } },
  structures: { label: 'Structures & sites', geom: 'any', color: '#f2cc8f', example: { id: 's1', name: 'Hollow Farm', at: [36.1, 14.2], props: { type: 'farm' } } },
  regions: { label: 'Regions & nations', geom: 'area', color: '#e07a5f', example: { id: 'r1', name: 'Kingdom of Ash', area: [[42, 8], [42, 20], [34, 22], [33, 9]] } },
  borders: { label: 'Borders', geom: 'path', color: '#f4f1de', example: { id: 'b1', name: 'Ash-Varra border', path: [[40, 14], [36, 16]] } },
  religions: { label: 'Religions', geom: 'area', color: '#9b5de5', example: { id: 'g1', name: 'Faith of the Ember', area: [[40, 10], [40, 25], [30, 25], [30, 10]] } },
  roads: { label: 'Roads & trade routes', geom: 'path', color: '#c9a66b', example: { id: 'w1', name: 'Salt Road', path: [[37.2, 12.5], [35, 18], [33, 24]], props: { type: 'trade route' } } },
  custom: { label: 'Custom', geom: 'any', color: '#4cc9f0', example: { id: 'x1', name: 'Battle of the Ford', at: [36, 15] } },
} as const
export type LayerKind = keyof typeof LAYER_KINDS
/** Layers the globe page builds on the fly from the story (places, route, party, ruler); never saved, and never drawn as settlements. */
export const DERIVED_LAYERS = new Set(['story', 'route', 'party', 'measure'])
export const layerColor = (l: Layer) => l.color ?? LAYER_KINDS[l.kind]?.color ?? '#ffffff'
/** Point marker size in px: settlements grow with population, other sites by type. */
export const pointSize = (it: LayerItem) => Math.round(markerPx(it) * 0.65) || 7

const isLL = (v: unknown): v is LatLon => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180
const ITEM_KEYS = new Set(['id', 'name', 'note', 'wikiId', 'at', 'path', 'area', 'props', 'from', 'to'])
const isTDate = (v: unknown) => !!v && typeof v === 'object' && Number.isInteger((v as TDate).y) && (['m', 'd'] as const).every((k) => (v as TDate)[k] === undefined || Number.isInteger((v as TDate)[k]))
const LAYER_KEYS = new Set(['id', 'name', 'kind', 'color', 'opacity', 'hidden', 'items'])

/** Schema checks; `ids` is shared with ops so every id in the world is unique. */
export function validateLayers(layers: unknown, ids: Set<string>, errors: string[], warnings: string[]) {
  if (layers === undefined) return
  if (!Array.isArray(layers)) { errors.push('layers must be an array'); return }
  const dup = (id: unknown, at: string) => {
    if (typeof id !== 'string' || !id) errors.push(`${at}: id must be a non-empty string`)
    else if (ids.has(id)) errors.push(`${at}: duplicate id "${id}"`)
    else ids.add(id)
  }
  layers.forEach((l: Layer, i) => {
    const at = `layers[${i}]${l?.name ? ` "${l.name}"` : ''}`
    if (!l || typeof l !== 'object') { errors.push(`${at}: not an object`); return }
    dup(l.id, at)
    for (const k of Object.keys(l)) if (!LAYER_KEYS.has(k)) errors.push(`${at}: unknown field "${k}"`)
    if (typeof l.name !== 'string') errors.push(`${at}: name must be a string`)
    const spec = LAYER_KINDS[l.kind]
    if (!spec) errors.push(`${at}: unknown kind "${String(l.kind)}" (use one of ${Object.keys(LAYER_KINDS).join(', ')})`)
    if (l.color !== undefined && !/^#[0-9a-f]{6}$/i.test(String(l.color))) errors.push(`${at}: color must be like "#aabbcc"`)
    if (l.opacity !== undefined && !(typeof l.opacity === 'number' && l.opacity >= 0 && l.opacity <= 1)) errors.push(`${at}: opacity must be 0..1`)
    if (l.hidden !== undefined && typeof l.hidden !== 'boolean') errors.push(`${at}: hidden must be true or false`)
    if (!Array.isArray(l.items)) { errors.push(`${at}: items must be an array`); return }
    l.items.forEach((it, j) => {
      const iat = `${at}.items[${j}]${it?.name ? ` "${it.name}"` : ''}`
      if (!it || typeof it !== 'object') { errors.push(`${iat}: not an object`); return }
      dup(it.id, iat)
      for (const k of Object.keys(it)) if (!ITEM_KEYS.has(k)) errors.push(`${iat}: unknown field "${k}"`)
      for (const k of ['name', 'note', 'wikiId'] as const) if (it[k] !== undefined && typeof it[k] !== 'string') errors.push(`${iat}: ${k} must be a string`)
      const geoms = (['at', 'path', 'area'] as const).filter((k) => it[k] !== undefined)
      if (geoms.length !== 1) { errors.push(`${iat}: needs exactly one of at, path, area`); return }
      const g = geoms[0], v = it[g]
      if (g === 'at' && !isLL(v)) errors.push(`${iat}: at must be [lat, lon] with |lat|<=90, |lon|<=180`)
      if (g !== 'at' && (!Array.isArray(v) || v.length < (g === 'area' ? 3 : 2) || !v.every(isLL))) errors.push(`${iat}: ${g} must be a list of at least ${g === 'area' ? 3 : 2} [lat, lon] points`)
      if (it.props !== undefined && (typeof it.props !== 'object' || Array.isArray(it.props) || !Object.values(it.props).every((x) => typeof x === 'string' || typeof x === 'number'))) errors.push(`${iat}: props must be an object of strings and numbers`)
      for (const k of ['from', 'to'] as const) if (it[k] !== undefined && !isTDate(it[k])) errors.push(`${iat}: ${k} must be a date like { "y": 412, "m": 3, "d": 9 } (m, d optional)`)
      if (spec && spec.geom !== 'any' && spec.geom !== g) warnings.push(`${iat}: ${l.kind} layers usually use ${spec.geom}, not ${g}`)
      if (!it.name) warnings.push(`${iat}: has no name`)
      const ty = it.props?.type
      if ((l.kind === 'cities' || l.kind === 'structures') && !siteOf(it)) warnings.push(`${iat}: props.type ${ty === undefined ? 'is missing' : `"${ty}" is not a known site type`} (use ${SITE_IDS.join(', ')}); it will show as a plain marker`)
    })
  })
}

/** Layers with only the items that exist on `day` (undefined = no filter). */
export const activeAt = (layers: Layer[], day: number | undefined, c: Calendar): Layer[] => day === undefined ? layers
  : layers.map((l) => ({ ...l, items: l.items.filter((it) => (!it.from || dayOf(c, it.from) <= day) && (!it.to || dayOf(c, it.to) >= day)) }))

export type FeatureRef = { opId: string } | { layerId: string; itemId: string }
export const refKey = (r: FeatureRef) => ('opId' in r ? r.opId : `${r.layerId}/${r.itemId}`)
export interface Feature { ref: FeatureRef; name?: string; note?: string; wikiId?: string; type: string; at?: LatLon; path?: LatLon[]; area?: LatLon[]; radius?: number; op?: Op; layer?: Layer; item?: LayerItem }

// ops that only nudge the ground aren't things a reader would point at, unless they're named
const QUIET = new Set(['raise', 'lower', 'flatten'])

/** Every pickable thing in the world: named ops and items of visible layers. */
export function features(world: { ops?: Op[]; layers?: Layer[] }): Feature[] {
  const out: Feature[] = []
  for (const op of world.ops ?? []) {
    if (QUIET.has(op.kind) && !op.name) continue
    out.push({ ref: { opId: op.id }, name: op.name, note: op.note, wikiId: op.wikiId, type: OP_SPECS[op.kind]?.label ?? op.kind, op,
      at: 'at' in op ? op.at : undefined, path: 'path' in op ? op.path : undefined, area: 'area' in op ? op.area : undefined, radius: 'radius' in op ? op.radius : undefined })
  }
  for (const layer of world.layers ?? []) {
    if (layer.hidden) continue
    for (const item of layer.items) out.push({ ref: { layerId: layer.id, itemId: item.id }, name: item.name, note: item.note, wikiId: item.wikiId, type: layer.name || LAYER_KINDS[layer.kind]?.label, at: item.at, path: item.path, area: item.area, radius: item.at && siteOf(item) ? footprintKm(item) : undefined, layer, item })
  }
  return out
}

export const findFeature = (world: { ops?: Op[]; layers?: Layer[] }, ref: FeatureRef) => features({ ...world, layers: world.layers?.map((l) => ({ ...l, hidden: false })) }).find((f) => refKey(f.ref) === refKey(ref))

/** The feature under a point: the nearest point or line within `tolKm`, else the smallest area containing it. */
export function pickFeature(world: { ops?: Op[]; layers?: Layer[] }, p: LatLon, tolKm: number, radiusKm: number): Feature | undefined {
  const d = dirOf(p)
  let near: Feature | undefined, nearD = tolKm, inside: Feature | undefined, insideA = Infinity
  for (const f of features(world)) {
    if (f.at) {
      const km = angle(d, dirOf(f.at)) * radiusKm
      if (f.radius && km < f.radius) { const a = Math.PI * f.radius ** 2; if (a < insideA) { inside = f; insideA = a } }
      // points get half the tolerance as a head start, so a city wins over the road that ends at it
      else if (km - (f.radius ?? tolKm / 2) < nearD) { near = f; nearD = km - (f.radius ?? tolKm / 2) }
    } else if (f.path) {
      const km = pathDist(d, makePath(f.path)).d * radiusKm
      if (km < nearD) { near = f; nearD = km }
    } else if (f.area) {
      if (inPolygon(d, f.area.map(dirOf))) { const a = areaKm2(f.area, radiusKm); if (a < insideA) { inside = f; insideA = a } }
      else { const km = pathDist(d, makePath([...f.area, f.area[0]])).d * radiusKm; if (km < nearD) { near = f; nearD = km } }
    }
  }
  return near ?? inside
}

/** A circle of `km` around a point, as a closed ring. */
export function circle(c: LatLon, km: number, radiusKm: number, n = 48): LatLon[] {
  const r = km / radiusKm * 180 / Math.PI, k = Math.max(0.05, Math.cos(c[0] * Math.PI / 180))
  return Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.sin(i / n * 2 * Math.PI), c[1] + r * Math.cos(i / n * 2 * Math.PI) / k] as LatLon)
}

/** Outline(s) to draw when a feature is highlighted. `course` gives a river's drawn line. */
export function outline(f: Feature, radiusKm: number, ptKm: number, course?: (op: Extract<Op, { kind: 'river' }>) => LatLon[]): LatLon[][] {
  if (f.op?.kind === 'river' && course) return [course(f.op)]
  if (f.path) return [f.path]
  if (f.area) return [[...f.area, f.area[0]]]
  return [circle(f.at!, Math.max(f.radius ?? 0, ptKm), radiusKm)]
}

/** Short facts for the popup: size plus the feature's numbers. */
export function stats(f: Feature, radiusKm: number): string[] {
  const n = (v: number) => Math.round(v).toLocaleString('en-US')
  const out: string[] = []
  if (f.path) out.push(`Length ${n(makePath(f.path).total * radiusKm)} km`)
  if (f.area) out.push(`Area ${n(areaKm2(f.area, radiusKm))} km²`)
  if (f.op) for (const [k, type] of OP_SPECS[f.op.kind].fields) {
    const v = (f.op as unknown as Record<string, unknown>)[k]
    if (type === 'num' && typeof v === 'number') out.push(`${k[0].toUpperCase()}${k.slice(1)} ${n(v)} ${k === 'count' ? '' : ['radius', 'width'].includes(k) ? 'km' : 'm'}`.trim())
  }
  for (const [k, v] of Object.entries(f.item?.props ?? {})) out.push(`${k[0].toUpperCase()}${k.slice(1)}: ${typeof v === 'number' ? n(v) : v}`)
  return out
}
