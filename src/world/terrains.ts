// The terrain registry: every ground type the world can have. Generated climate picks from it, and `terrain` / `zone`
// ops paint it anywhere (fantasy terrain included). Each type says how it looks on the 3D globe (ground colours and
// props such as trees) and on the flat map (a glyph). Pure data, no DOM. Adding a type here is all it takes.
import type { Vec } from './geo.ts'

export type DecorKind = 'conifer' | 'oak' | 'palm' | 'acacia' | 'giant' | 'dead' | 'cactus' | 'mushroom' | 'crystal' | 'boulder' | 'tuft' | 'reed' | 'bush'
export type Glyph = 'tree' | 'pine' | 'palm' | 'peak' | 'hill' | 'dune' | 'reed' | 'cactus' | 'crystal' | 'mushroom' | 'lava' | 'ash' | 'ice' | 'grass' | 'dead' | 'salt' | 'none'
/** What a terrain's ground does to the height: dunes ripple, badlands terrace, crystal fields jag. */
export type Shape = 'ripple' | 'terrace' | 'jag'

export interface Decor {
  kind: DecorKind
  density: number // 0..1 chance per lattice spot (the kinds on one lattice share the spots, so keep the sum <= 1)
  size: [number, number] // display height in metres (deliberately larger than life, so it reads from a distance)
  colors: Vec[] // sRGB, one picked per instance
}
export interface Terrain {
  label: string
  ground: Vec; ground2: Vec // the ground colour varies between these in patches
  decor: Decor[]
  glyph: Glyph; glyphDensity: number // flat map symbol and how often it is drawn (0..1)
  shape?: Shape
  paint?: boolean // only reachable through ops, never by climate
}

const d = (kind: DecorKind, density: number, lo: number, hi: number, ...colors: Vec[]): Decor => ({ kind, density, size: [lo, hi], colors })
const G = {
  pine: [[22, 66, 46], [30, 78, 52], [38, 88, 58], [26, 60, 50]] as Vec[],
  oak: [[52, 112, 44], [74, 130, 50], [96, 140, 48], [62, 100, 40], [150, 140, 52]] as Vec[],
  autumn: [[190, 110, 36], [176, 74, 32], [204, 150, 44], [120, 120, 40]] as Vec[],
  jungle: [[18, 100, 52], [30, 120, 58], [14, 84, 60], [50, 132, 60]] as Vec[],
  grass: [[126, 182, 64], [146, 196, 72], [108, 164, 60]] as Vec[],
  dry: [[200, 178, 92], [214, 190, 104], [182, 164, 84]] as Vec[],
  rock: [[120, 114, 108], [140, 132, 122], [98, 94, 92]] as Vec[],
  deadwood: [[88, 74, 62], [70, 62, 56], [110, 98, 84]] as Vec[],
}

export const TERRAINS: Record<string, Terrain> = {
  // ----- cold -----
  ice: { label: 'Ice sheet', ground: [236, 242, 248], ground2: [214, 228, 242], decor: [], glyph: 'ice', glyphDensity: 0.25 },
  glacier: { label: 'Glacier', ground: [214, 234, 246], ground2: [176, 210, 232], decor: [], glyph: 'ice', glyphDensity: 0.5 },
  polar_desert: { label: 'Polar desert', ground: [196, 198, 200], ground2: [172, 176, 182], decor: [d('boulder', 0.04, 6, 18, ...G.rock)], glyph: 'none', glyphDensity: 0 },
  tundra: { label: 'Tundra', ground: [142, 148, 116], ground2: [116, 128, 104], decor: [d('tuft', 0.9, 2, 4, [150, 150, 100], [120, 134, 96]), d('boulder', 0.05, 5, 14, ...G.rock)], glyph: 'grass', glyphDensity: 0.15 },
  cold_desert: { label: 'Cold desert', ground: [172, 160, 132], ground2: [150, 140, 118], decor: [d('boulder', 0.05, 6, 20, ...G.rock)], glyph: 'none', glyphDensity: 0 },
  steppe: { label: 'Steppe', ground: [192, 176, 98], ground2: [166, 158, 88], decor: [d('tuft', 0.95, 3, 6, [206, 188, 100], [184, 170, 90], [170, 160, 84])], glyph: 'grass', glyphDensity: 0.35 },
  taiga: { label: 'Taiga', ground: [52, 78, 56], ground2: [40, 66, 50], decor: [d('conifer', 0.85, 42, 82, ...G.pine), d('boulder', 0.02, 5, 14, ...G.rock)], glyph: 'pine', glyphDensity: 0.9 },
  bog: { label: 'Bog', ground: [70, 84, 62], ground2: [88, 90, 56], decor: [d('reed', 0.55, 6, 12, [120, 120, 60], [96, 110, 56]), d('conifer', 0.06, 28, 46, ...G.pine)], glyph: 'reed', glyphDensity: 0.5 },
  // ----- temperate -----
  grassland: { label: 'Grassland', ground: [106, 170, 62], ground2: [134, 188, 76], decor: [d('tuft', 0.95, 2.5, 5, ...G.grass), d('bush', 0.04, 8, 16, [70, 130, 52], [86, 140, 54])], glyph: 'grass', glyphDensity: 0.3 },
  meadow: { label: 'Flower meadow', ground: [120, 184, 84], ground2: [214, 190, 110], decor: [d('tuft', 0.95, 2.5, 5, [236, 120, 160], [244, 214, 92], [250, 250, 246], [150, 130, 230], ...G.grass)], glyph: 'grass', glyphDensity: 0.3 },
  forest: { label: 'Forest', ground: [62, 96, 46], ground2: [78, 108, 52], decor: [d('oak', 0.62, 34, 62, ...G.oak, ...G.oak, ...G.autumn), d('conifer', 0.14, 40, 70, ...G.pine), d('boulder', 0.01, 5, 14, ...G.rock)], glyph: 'tree', glyphDensity: 0.9 },
  deep_forest: { label: 'Deep forest', ground: [38, 78, 48], ground2: [48, 90, 52], decor: [d('giant', 0.2, 110, 190, [46, 106, 58], [38, 92, 54]), d('oak', 0.55, 40, 70, ...G.oak), d('conifer', 0.1, 50, 80, ...G.pine)], glyph: 'tree', glyphDensity: 1 },
  redwood: { label: 'Redwood forest', ground: [58, 84, 44], ground2: [50, 72, 40], decor: [d('giant', 0.5, 130, 230, [48, 104, 58], [40, 90, 52], [66, 112, 50]), d('conifer', 0.3, 50, 90, ...G.pine)], glyph: 'pine', glyphDensity: 1, paint: true },
  // ----- warm & dry -----
  desert: { label: 'Desert', ground: [214, 184, 130], ground2: [198, 166, 112], decor: [d('cactus', 0.05, 14, 28, [78, 140, 74], [96, 150, 80]), d('boulder', 0.04, 6, 22, [168, 140, 108], [150, 124, 98])], glyph: 'dune', glyphDensity: 0.3 },
  dunes: { label: 'Dune sea', ground: [234, 202, 140], ground2: [222, 178, 112], decor: [d('boulder', 0.01, 5, 14, [170, 140, 100])], glyph: 'dune', glyphDensity: 0.55, shape: 'ripple' },
  scrub: { label: 'Scrubland', ground: [168, 152, 88], ground2: [146, 138, 78], decor: [d('bush', 0.3, 8, 18, [104, 118, 60], [128, 128, 66]), d('tuft', 0.6, 3, 5, ...G.dry)], glyph: 'grass', glyphDensity: 0.25 },
  badlands: { label: 'Badlands', ground: [190, 108, 66], ground2: [226, 172, 112], decor: [d('boulder', 0.06, 10, 40, [176, 96, 60], [206, 140, 92], [150, 84, 56])], glyph: 'hill', glyphDensity: 0.6, shape: 'terrace', paint: true },
  salt_flat: { label: 'Salt flat', ground: [242, 242, 238], ground2: [220, 230, 232], decor: [], glyph: 'salt', glyphDensity: 0.3, paint: true },
  // ----- warm & wet -----
  savanna: { label: 'Savanna', ground: [196, 172, 84], ground2: [176, 164, 78], decor: [d('tuft', 0.9, 3, 6, ...G.dry), d('acacia', 0.05, 26, 44, [96, 128, 56], [120, 140, 60])], glyph: 'tree', glyphDensity: 0.12 },
  woodland: { label: 'Woodland', ground: [92, 128, 58], ground2: [112, 140, 62], decor: [d('oak', 0.32, 34, 58, ...G.oak), d('tuft', 0.6, 2.5, 5, ...G.grass)], glyph: 'tree', glyphDensity: 0.5 },
  dry_forest: { label: 'Dry forest', ground: [118, 126, 56], ground2: [132, 120, 54], decor: [d('acacia', 0.22, 28, 46, [100, 126, 54], [136, 134, 60]), d('oak', 0.25, 30, 50, [110, 130, 50], [160, 140, 56])], glyph: 'tree', glyphDensity: 0.65 },
  subtropical_forest: { label: 'Subtropical forest', ground: [52, 98, 46], ground2: [64, 108, 50], decor: [d('oak', 0.5, 36, 64, ...G.oak), d('palm', 0.14, 30, 50, ...G.jungle)], glyph: 'tree', glyphDensity: 0.85 },
  jungle: { label: 'Jungle', ground: [24, 90, 44], ground2: [32, 104, 50], decor: [d('giant', 0.22, 100, 170, [20, 100, 50], [14, 86, 52]), d('palm', 0.34, 34, 60, ...G.jungle), d('oak', 0.34, 40, 64, ...G.jungle)], glyph: 'palm', glyphDensity: 1 },
  swamp: { label: 'Swamp', ground: [60, 82, 52], ground2: [46, 70, 60], decor: [d('reed', 0.5, 7, 14, [120, 124, 60], [90, 110, 58]), d('dead', 0.08, 24, 42, ...G.deadwood), d('oak', 0.12, 28, 44, [58, 92, 52], [48, 80, 56])], glyph: 'reed', glyphDensity: 0.7 },
  beach: { label: 'Beach', ground: [228, 212, 164], ground2: [214, 198, 150], decor: [d('palm', 0.03, 26, 40, ...G.jungle)], glyph: 'none', glyphDensity: 0 },
  // ----- high ground -----
  alpine: { label: 'Alpine meadow', ground: [118, 150, 94], ground2: [150, 150, 108], decor: [d('tuft', 0.8, 2.5, 4, [132, 168, 96], [160, 160, 100]), d('boulder', 0.07, 6, 22, ...G.rock)], glyph: 'grass', glyphDensity: 0.15 },
  rock: { label: 'Barren rock', ground: [124, 114, 106], ground2: [98, 92, 90], decor: [d('boulder', 0.1, 8, 34, ...G.rock)], glyph: 'none', glyphDensity: 0 },
  snow: { label: 'Snowfield', ground: [244, 247, 252], ground2: [220, 232, 246], decor: [], glyph: 'ice', glyphDensity: 0.2 },
  moor: { label: 'Moorland', ground: [120, 104, 122], ground2: [136, 112, 96], decor: [d('tuft', 0.85, 2.5, 5, [150, 110, 150], [126, 112, 98], [140, 128, 96]), d('boulder', 0.07, 6, 24, ...G.rock)], glyph: 'grass', glyphDensity: 0.2, paint: true },
  // ----- fantasy: only painted -----
  ashland: { label: 'Ashland', ground: [66, 62, 62], ground2: [96, 90, 86], decor: [d('dead', 0.14, 26, 50, [40, 36, 36], [56, 50, 48]), d('boulder', 0.05, 8, 26, [50, 46, 46], [74, 70, 66])], glyph: 'ash', glyphDensity: 0.45, paint: true },
  lava: { label: 'Lava field', ground: [40, 22, 20], ground2: [230, 84, 22], decor: [d('boulder', 0.1, 8, 30, [28, 22, 22], [44, 30, 28])], glyph: 'lava', glyphDensity: 0.5, shape: 'jag', paint: true },
  crystal: { label: 'Crystal forest', ground: [150, 168, 204], ground2: [192, 150, 224], decor: [d('crystal', 0.4, 40, 150, [110, 230, 240], [190, 140, 255], [255, 150, 220], [150, 255, 210])], glyph: 'crystal', glyphDensity: 0.9, shape: 'jag', paint: true },
  fungal: { label: 'Fungal forest', ground: [88, 54, 104], ground2: [50, 98, 108], decor: [d('mushroom', 0.5, 40, 110, [230, 70, 130], [60, 200, 190], [250, 160, 50], [150, 90, 220])], glyph: 'mushroom', glyphDensity: 0.9, paint: true },
  blight: { label: 'Blighted land', ground: [82, 76, 50], ground2: [98, 90, 44], decor: [d('dead', 0.28, 22, 44, [70, 74, 52], [92, 88, 60]), d('tuft', 0.4, 2.5, 4, [110, 100, 50])], glyph: 'dead', glyphDensity: 0.7, paint: true },
  bonewood: { label: 'Bonewood', ground: [206, 196, 176], ground2: [186, 174, 150], decor: [d('dead', 0.32, 30, 58, [232, 226, 210], [212, 204, 186], [190, 182, 164])], glyph: 'dead', glyphDensity: 0.8, paint: true },
}

export const TERRAIN_IDS = Object.keys(TERRAINS)
export const terrainIndex = (id: string) => Math.max(0, TERRAIN_IDS.indexOf(id))
export const PAINTABLE = TERRAIN_IDS // every type can be painted; `paint: true` ones can only be painted
