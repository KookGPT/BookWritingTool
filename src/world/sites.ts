// Settlements and structures: what a layer item with `props.type` is, how big it is and how it is dressed.
// Pure data and helpers (no DOM, no three.js), shared by the layout generator, the globe, the flat map and validation.
import type { LayerItem } from './layers.ts'

/** What a place needs around it to make sense; `validate` and `sites` check these against the real terrain. */
export type Need = 'coast' | 'river' | 'water' | 'flat' | 'arable' | 'highland' | 'land'
export interface SiteType {
  label: string
  cls: 'settlement' | 'site' | 'bridge'
  /** Default population (settlements); `props.population` overrides it and sets the size. */
  pop?: number
  /** Footprint radius in km for single sites; settlements derive theirs from population. */
  km?: number
  /** Flat-map marker size in px at normal zoom. */
  px: number
  needs: Need[]
  desc: string
}

export const SITE_TYPES: Record<string, SiteType> = {
  hamlet: { label: 'Hamlet', cls: 'settlement', pop: 60, px: 8, needs: ['land'], desc: 'A handful of homes, under 150 people.' },
  village: { label: 'Village', cls: 'settlement', pop: 500, px: 10, needs: ['land', 'water'], desc: 'Farming village with a church or shrine and fields around it.' },
  town: { label: 'Town', cls: 'settlement', pop: 5000, px: 13, needs: ['land', 'water', 'flat'], desc: 'Market town, usually walled, with a church, hall and market.' },
  city: { label: 'City', cls: 'settlement', pop: 40000, px: 17, needs: ['land', 'water', 'flat'], desc: 'Walled city with a cathedral, keep, districts and farmland around it.' },
  capital: { label: 'Capital', cls: 'settlement', pop: 80000, px: 19, needs: ['land', 'water', 'flat'], desc: 'A city with a palace; the seat of a realm.' },
  metropolis: { label: 'Metropolis', cls: 'settlement', pop: 300000, px: 22, needs: ['land', 'water', 'flat'], desc: 'Great city of domes, spires and towers; needs a big river or a coast.' },
  megacity: { label: 'Megacity', cls: 'settlement', pop: 3000000, px: 26, needs: ['land', 'water', 'flat'], desc: 'A forest of towers many kilometres across; needs a great river or coast and flat land.' },
  port: { label: 'Port', cls: 'settlement', pop: 4000, px: 13, needs: ['coast'], desc: 'Harbour town: docks, ships, warehouses and cranes. Must touch the sea or a wide river.' },
  farm: { label: 'Farm', cls: 'site', km: 0.2, px: 11, needs: ['arable', 'flat'], desc: 'Farmhouse, barn, silo and haystacks among fields and an orchard.' },
  manor: { label: 'Manor', cls: 'site', km: 0.28, px: 12, needs: ['arable', 'flat'], desc: 'Manor house with stables, barns, fields and an orchard.' },
  castle: { label: 'Castle', cls: 'site', km: 0.3, px: 14, needs: ['land'], desc: 'Curtain walls, towers, gatehouse and a keep. Best on a hill or beside a river.' },
  fort: { label: 'Fort', cls: 'site', km: 0.14, px: 11, needs: ['land'], desc: 'Palisade fort with a watchtower and tents.' },
  tower: { label: 'Tower', cls: 'site', km: 0.06, px: 10, needs: ['land'], desc: 'A lone tall tower: watchtower, wizard\'s spire or beacon.' },
  temple: { label: 'Temple', cls: 'site', km: 0.12, px: 11, needs: ['land'], desc: 'A temple complex with a great hall and grounds.' },
  monastery: { label: 'Monastery', cls: 'site', km: 0.2, px: 12, needs: ['land'], desc: 'Church, cloister and cells inside a wall, with fields and an orchard.' },
  mine: { label: 'Mine', cls: 'site', km: 0.22, px: 11, needs: ['highland'], desc: 'Headframe, sheds and spoil heaps; belongs in hills or mountains.' },
  windmill: { label: 'Windmill', cls: 'site', km: 0.08, px: 10, needs: ['arable', 'flat'], desc: 'A windmill with a barn among fields, on open ground.' },
  lighthouse: { label: 'Lighthouse', cls: 'site', km: 0.05, px: 10, needs: ['coast'], desc: 'Striped tower and keeper\'s cottage. Must stand on the coast.' },
  ruins: { label: 'Ruins', cls: 'site', km: 0.2, px: 11, needs: ['land'], desc: 'Broken walls, fallen columns and overgrowth.' },
  camp: { label: 'Camp', cls: 'site', km: 0.1, px: 10, needs: ['land', 'flat'], desc: 'Tents, wagons and haystacks.' },
  bridge: { label: 'Bridge', cls: 'bridge', km: 0.1, px: 11, needs: ['water'], desc: 'Crosses a river or strait. Put `at` on the river; it spans the water and turns to cross it. props.style: stone (default), wood, rope, aqueduct, draw.' },
}
export const SITE_IDS = Object.keys(SITE_TYPES)

export type BridgeStyle = 'stone' | 'wood' | 'rope' | 'aqueduct' | 'draw'
export const BRIDGE_STYLES: BridgeStyle[] = ['stone', 'wood', 'rope', 'aqueduct', 'draw']

/** The site type of a layer item, from props.type (case-insensitive). */
export const siteOf = (it: Pick<LayerItem, 'props'>): { id: string; def: SiteType } | undefined => {
  const id = String(it.props?.type ?? '').trim().toLowerCase(), def = SITE_TYPES[id]
  return def ? { id, def } : undefined
}
export const popOf = (it: Pick<LayerItem, 'props'>) => {
  const p = Number(it.props?.population), s = siteOf(it)
  return Number.isFinite(p) && p > 0 ? p : s?.def.pop ?? 0
}
/** 0 hamlet, 1 village, 2 town, 3 city, 4 metropolis, 5 megacity, from population. */
export const tierOf = (pop: number) => pop < 150 ? 0 : pop < 1500 ? 1 : pop < 12000 ? 2 : pop < 120000 ? 3 : pop < 1200000 ? 4 : 5
/** Footprint radius in km: settlements grow with the square root of their population (stylised, and capped). */
export const footprintKm = (it: Pick<LayerItem, 'props'>) => {
  const s = siteOf(it)
  if (!s) return 0
  if (s.def.cls === 'settlement') return Math.max(0.06, Math.min(6, 0.12 * Math.sqrt(popOf(it) / 500)))
  return s.def.km ?? 0.1
}
/** Marker size in px: grows a little with population inside the type's range. */
export const markerPx = (it: Pick<LayerItem, 'props'>) => {
  const s = siteOf(it)
  if (!s) return 11 // untyped marker
  return s.def.cls === 'settlement' ? Math.round(6 + 2.6 * Math.log10(Math.max(popOf(it), 30) / 30)) : s.def.px
}

// ---------- dress: building styles by terrain ----------
export type Style = 'timber' | 'adobe' | 'northern' | 'tropical' | 'stone' | 'marsh' | 'crystal' | 'ash' | 'bone' | 'fungal'
export const STYLE_IDS: Style[] = ['timber', 'adobe', 'northern', 'tropical', 'stone', 'marsh', 'crystal', 'ash', 'bone', 'fungal']
const STYLE_OF: Record<string, Style> = {
  ice: 'northern', glacier: 'northern', snow: 'northern', polar_desert: 'northern', tundra: 'northern', taiga: 'northern', moor: 'northern', cold_desert: 'northern',
  bog: 'marsh', swamp: 'marsh',
  desert: 'adobe', dunes: 'adobe', scrub: 'adobe', badlands: 'adobe', salt_flat: 'adobe', savanna: 'adobe', dry_forest: 'adobe',
  jungle: 'tropical', subtropical_forest: 'tropical', beach: 'tropical',
  alpine: 'stone', rock: 'stone',
  crystal: 'crystal', fungal: 'fungal', ashland: 'ash', lava: 'ash', bonewood: 'bone', blight: 'ash',
}
export const styleFor = (terrainId: string): Style => STYLE_OF[terrainId] ?? 'timber'

type V3 = [number, number, number]
export interface Palette { walls: V3[]; roofs: V3[]; ground: V3; road: V3 }
export const PALETTES: Record<Style, Palette> = {
  timber: { walls: [[236, 226, 200], [222, 205, 170], [200, 180, 150], [176, 150, 118]], roofs: [[172, 86, 62], [150, 70, 52], [96, 100, 110], [188, 160, 92], [170, 140, 80]], ground: [136, 120, 92], road: [190, 172, 138] },
  adobe: { walls: [[226, 196, 150], [214, 178, 128], [236, 214, 172], [204, 160, 112]], roofs: [[226, 196, 150], [70, 130, 170], [40, 110, 150], [196, 100, 70]], ground: [190, 160, 112], road: [224, 200, 150] },
  northern: { walls: [[110, 82, 58], [92, 68, 48], [130, 98, 68], [150, 120, 88]], roofs: [[236, 240, 246], [206, 214, 224], [84, 90, 98], [110, 70, 54]], ground: [120, 112, 100], road: [186, 184, 176] },
  tropical: { walls: [[200, 180, 120], [176, 150, 96], [150, 120, 80], [220, 200, 150]], roofs: [[92, 140, 70], [120, 160, 72], [176, 150, 88], [70, 120, 60]], ground: [150, 120, 84], road: [200, 174, 126] },
  stone: { walls: [[156, 152, 146], [132, 128, 124], [176, 168, 156], [118, 116, 118]], roofs: [[86, 92, 104], [104, 100, 98], [130, 84, 66], [70, 76, 86]], ground: [118, 112, 104], road: [166, 160, 150] },
  marsh: { walls: [[84, 72, 56], [100, 84, 62], [70, 62, 50]], roofs: [[150, 140, 82], [120, 120, 70], [100, 110, 66]], ground: [88, 84, 60], road: [128, 112, 80] },
  crystal: { walls: [[210, 220, 240], [190, 170, 230], [176, 230, 236]], roofs: [[120, 220, 240], [230, 150, 230], [160, 255, 210], [250, 200, 250]], ground: [150, 160, 196], road: [214, 222, 244] },
  ash: { walls: [[50, 46, 46], [70, 64, 60], [88, 78, 72]], roofs: [[60, 56, 56], [150, 56, 40], [110, 44, 36]], ground: [62, 56, 54], road: [110, 102, 96] },
  bone: { walls: [[232, 224, 206], [214, 204, 184], [196, 186, 166]], roofs: [[250, 246, 236], [190, 182, 162], [226, 218, 198]], ground: [196, 184, 160], road: [232, 224, 204] },
  fungal: { walls: [[196, 160, 200], [160, 120, 170], [216, 190, 204]], roofs: [[230, 70, 130], [250, 160, 50], [60, 200, 190], [150, 90, 220]], ground: [100, 70, 110], road: [170, 140, 176] },
}

/** Terrain ids on which fields make sense (everything else gets no farmland unless the site says otherwise). */
export const ARABLE = new Set(['grassland', 'meadow', 'steppe', 'woodland', 'savanna', 'dry_forest', 'forest', 'subtropical_forest', 'scrub', 'beach'])
