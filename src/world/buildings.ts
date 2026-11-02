// Low-poly buildings for settlements, as unit meshes (x, z within about +-0.5, y from 0 up to 1). Pure data like props.ts;
// the globe instances them. Vertex `fix` modes: 0 = wall tint (instance colour 1), 2 = roof tint (instance colour 2),
// 1 = absolute colour (wood, stone, cloth...). Everything is modelled with its long side along x.
import { Builder, type PropMesh, type V3 } from './props.ts'

export type BuildKind =
  | 'cottage' | 'house' | 'longhouse' | 'cabin' | 'hut' | 'adobe' | 'domehouse' | 'stilt' | 'tenement' | 'rowhouse'
  | 'church' | 'templeDome' | 'pagoda' | 'hall' | 'market' | 'keep' | 'walltower' | 'wallseg' | 'gate' | 'palace' | 'spire' | 'stepped' | 'rotunda'
  | 'barn' | 'silo' | 'windmill' | 'haystack' | 'dock' | 'ship' | 'warehouse' | 'crane' | 'lighthouse' | 'headframe' | 'spoil' | 'ruin' | 'tent'
  | 'arch' | 'archTall' | 'deck' | 'rope'

const lin = (r: number, g: number, b: number): V3 => [(r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2]
const WHITE: V3 = [1, 1, 1], SHADE: V3 = [0.84, 0.84, 0.86]
const WOOD = lin(112, 80, 52), STONE = lin(146, 142, 136), DARK = lin(34, 28, 26), CLOTH = lin(238, 230, 210), GOLD = lin(222, 176, 70), RED = lin(196, 52, 42)
const HAY = lin(214, 184, 96), METAL = lin(150, 160, 172), SOIL = lin(78, 66, 54), LEAF = lin(70, 110, 54), MOSS = lin(86, 118, 70)

class B extends Builder {
  quad(a: V3, b: V3, c: V3, d: V3, col: V3, fix: number) { const i = this.v(a, col, fix), j = this.v(b, col, fix), k = this.v(c, col, fix), l = this.v(d, col, fix); this.idx.push(i, j, k, i, k, l) }
  /** Axis-aligned box (no floor) centred at (cx, cz) with half sizes (hx, hz). */
  box(cx: number, cz: number, hx: number, hz: number, y0: number, y1: number, c: V3, fix = 0) {
    const x0 = cx - hx, x1 = cx + hx, z0 = cz - hz, z1 = cz + hz
    const a = this.v([x0, y0, z0], c, fix), b = this.v([x1, y0, z0], c, fix), d = this.v([x1, y0, z1], c, fix), e = this.v([x0, y0, z1], c, fix)
    const f = this.v([x0, y1, z0], c, fix), g = this.v([x1, y1, z0], c, fix), h = this.v([x1, y1, z1], c, fix), i = this.v([x0, y1, z1], c, fix)
    this.idx.push(a, b, g, a, g, f, b, d, h, b, h, g, d, e, i, d, i, h, e, a, f, e, f, i, f, g, h, f, h, i)
  }
  /** Gable roof over a footprint: eaves at y0, ridge at y1 along x (or z), a small overhang. */
  gable(cx: number, cz: number, hx: number, hz: number, y0: number, y1: number, c: V3, fix = 2, alongX = true, oh = 0.05) {
    const P = (u: number, y: number, v: number) => this.v(alongX ? [cx + u, y, cz + v] : [cx + v, y, cz + u], c, fix)
    const a = alongX ? hx + oh : hz + oh, b = alongX ? hz + oh : hx + oh
    const e0 = P(-a, y0, -b), e1 = P(a, y0, -b), e2 = P(a, y0, b), e3 = P(-a, y0, b), r0 = P(-a, y1, 0), r1 = P(a, y1, 0)
    this.idx.push(e0, e1, r1, e0, r1, r0, e3, e2, r1, e3, r1, r0, e0, e3, r0, e1, e2, r1)
  }
  /** Pyramid roof over a rectangle. */
  hip(cx: number, cz: number, hx: number, hz: number, y0: number, y1: number, c: V3, fix = 2) {
    const a = this.v([cx - hx, y0, cz - hz], c, fix), b = this.v([cx + hx, y0, cz - hz], c, fix), d = this.v([cx + hx, y0, cz + hz], c, fix), e = this.v([cx - hx, y0, cz + hz], c, fix), t = this.v([cx, y1, cz], c, fix)
    this.idx.push(a, b, t, b, d, t, d, e, t, e, a, t)
  }
  /** Closed cylinder or tapered tower. */
  cyl(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, n: number, c: V3, fix = 0, cap = true) {
    const ring = (y: number, r: number) => Array.from({ length: n }, (_, i) => { const t = i / n * Math.PI * 2; return this.v([cx + Math.cos(t) * r, y, cz + Math.sin(t) * r], c, fix) })
    const a = ring(y0, r0), b = ring(y1, r1)
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.idx.push(a[i], a[j], b[j], a[i], b[j], b[i]) }
    if (cap) { const m = this.v([cx, y1, cz], c, fix); for (let i = 0; i < n; i++) this.idx.push(b[i], b[(i + 1) % n], m) }
  }
  cone(cx: number, cz: number, r: number, y0: number, y1: number, n: number, c: V3, fix = 2) {
    const a = Array.from({ length: n }, (_, i) => { const t = i / n * Math.PI * 2; return this.v([cx + Math.cos(t) * r, y0, cz + Math.sin(t) * r], c, fix) }), t = this.v([cx, y1, cz], c, fix)
    for (let i = 0; i < n; i++) this.idx.push(a[i], a[(i + 1) % n], t)
  }
  door(x: number, z: number, w = 0.07, h = 0.17) { this.box(x, z, w, 0.012, 0, h, DARK, 1) }
  chimney(x: number, z: number, y0: number, y1: number) { this.box(x, z, 0.05, 0.05, y0, y1, STONE, 1) }
  /** A stone arch (soffit and spandrels) along x between two piers, deck on top at `deck`. */
  arch(deck: number, r: number, hz: number, col: V3, fix: number, y0 = 0) {
    const N = 8, pt = (i: number, rr: number): [number, number] => { const t = Math.PI * (1 - i / N); return [Math.cos(t) * rr, y0 + Math.sin(t) * rr] }
    for (let i = 0; i < N; i++) {
      const [x0, ya] = pt(i, r), [x1, yb] = pt(i + 1, r)
      this.quad([x0, ya, -hz], [x1, yb, -hz], [x1, yb, hz], [x0, ya, hz], col, fix) // soffit
      for (const z of [-hz, hz]) this.quad([x0, ya, z], [x1, yb, z], [x1, deck, z], [x0, deck, z], col, fix) // spandrel
    }
    for (const sx of [-1, 1]) this.box(sx * (0.5 - (0.5 - r) / 2), 0, (0.5 - r) / 2, hz, y0 - 0.5, deck, col, fix) // piers beside the opening
  }
}

const MAKERS: Record<BuildKind, (b: B) => void> = {
  cottage: (b) => { b.box(0, 0, 0.46, 0.3, 0, 0.3, WHITE); b.gable(0, 0, 0.46, 0.3, 0.3, 0.62, WHITE); b.door(0.12, 0.3); b.chimney(-0.28, -0.08, 0.3, 0.7) },
  house: (b) => { b.box(0, 0, 0.4, 0.28, 0, 0.5, WHITE); b.box(0, 0.285, 0.4, 0.008, 0.28, 0.32, WOOD, 1); b.gable(0, 0, 0.4, 0.28, 0.5, 0.88, WHITE); b.door(-0.1, 0.28); b.chimney(0.22, 0, 0.5, 0.98) },
  longhouse: (b) => { b.box(0, 0, 0.5, 0.2, 0, 0.22, WHITE); b.gable(0, 0, 0.5, 0.2, 0.22, 0.48, WHITE); b.door(0.2, 0.2, 0.06, 0.14) },
  cabin: (b) => { b.box(0, 0, 0.34, 0.26, 0, 0.2, WHITE); b.gable(0, 0, 0.34, 0.26, 0.2, 0.78, WHITE, 2, false, 0.07); b.door(0, 0.26, 0.06, 0.15); b.chimney(0.2, -0.1, 0.2, 0.72) },
  hut: (b) => { b.cyl(0, 0, 0.4, 0.4, 0, 0.26, 8, WHITE, 0, false); b.cone(0, 0, 0.52, 0.26, 0.9, 8, WHITE); b.door(0, 0.4, 0.06, 0.15) },
  adobe: (b) => { b.box(0, 0, 0.46, 0.4, 0, 0.42, WHITE); b.box(-0.12, -0.08, 0.26, 0.24, 0.42, 0.66, WHITE); b.box(0, 0, 0.48, 0.42, 0.42, 0.46, WHITE); b.door(0.15, 0.4, 0.08, 0.2) },
  domehouse: (b) => { b.box(0, 0, 0.42, 0.42, 0, 0.42, WHITE); b.blob([0, 0.4, 0], 0.4, 0.34, 0.4, 7, WHITE, 2); b.door(0, 0.42, 0.09, 0.22) },
  stilt: (b) => {
    for (const [x, z] of [[-0.32, -0.24], [0.32, -0.24], [-0.32, 0.24], [0.32, 0.24]]) b.cyl(x, z, 0.04, 0.04, -0.15, 0.3, 5, WOOD, 1, false)
    b.box(0, 0, 0.44, 0.34, 0.3, 0.35, WOOD, 1); b.box(0, 0, 0.34, 0.26, 0.35, 0.62, WHITE); b.gable(0, 0, 0.34, 0.26, 0.62, 0.96, WHITE); b.door(0, 0.26, 0.06, 0.14)
  },
  tenement: (b) => { b.box(0, 0, 0.3, 0.28, 0, 0.8, WHITE); for (const y of [0.2, 0.4, 0.6]) b.box(0, 0, 0.31, 0.29, y, y + 0.02, SHADE); b.gable(0, 0, 0.3, 0.28, 0.8, 0.96, WHITE, 2, false); b.chimney(0.18, 0.1, 0.85, 1) },
  rowhouse: (b) => { [[-0.33, 0.5], [0, 0.68], [0.33, 0.56]].forEach(([x, h], i) => { b.box(x, 0, 0.165, 0.3, 0, h, i % 2 ? SHADE : WHITE); b.gable(x, 0, 0.165, 0.3, h, h + 0.3, WHITE, 2, false, 0.01) }) },
  church: (b) => { b.box(-0.14, 0, 0.36, 0.2, 0, 0.3, WHITE); b.gable(-0.14, 0, 0.36, 0.2, 0.3, 0.52, WHITE); b.box(0.36, 0, 0.12, 0.12, 0, 0.62, WHITE); b.hip(0.36, 0, 0.14, 0.14, 0.62, 1, WHITE); b.box(0.36, 0.125, 0.04, 0.01, 0.4, 0.5, DARK, 1) },
  templeDome: (b) => {
    b.box(0, 0, 0.42, 0.42, 0, 0.34, WHITE); b.blob([0, 0.34, 0], 0.34, 0.3, 0.34, 8, WHITE, 2); b.cone(0, 0, 0.03, 0.62, 0.78, 4, GOLD, 1)
    for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) { b.cyl(x, z, 0.05, 0.05, 0, 0.7, 6, WHITE, 0, false); b.cone(x, z, 0.065, 0.7, 0.9, 6, WHITE) }
  },
  pagoda: (b) => { for (let i = 0; i < 4; i++) { const w = 0.34 - i * 0.06, y = i * 0.22; b.box(0, 0, w * 0.75, w * 0.75, y, y + 0.14, WHITE); b.hip(0, 0, w + 0.1, w + 0.1, y + 0.14, y + 0.24, WHITE) } b.cone(0, 0, 0.02, 0.9, 1, 4, GOLD, 1) },
  hall: (b) => {
    b.box(0, 0, 0.44, 0.2, 0, 0.3, WHITE); b.gable(0, 0, 0.44, 0.2, 0.3, 0.6, WHITE); b.door(0, 0.2, 0.08, 0.2)
    for (const x of [-0.46, 0.46]) { b.cyl(x, 0, 0.1, 0.1, 0, 0.62, 7, WHITE, 0, false); b.cone(x, 0, 0.13, 0.62, 0.98, 7, WHITE) }
  },
  market: (b) => { [[-0.32, -0.1, 0], [0.12, 0.2, 1], [0.3, -0.24, 2]].forEach(([x, z, k]) => { for (const [px, pz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) b.cyl(x + px, z + pz, 0.012, 0.012, 0, 0.26, 4, WOOD, 1, false); b.hip(x, z, 0.16, 0.16, 0.26, 0.42, WHITE, k % 2 ? 2 : 0) }) },
  keep: (b) => {
    b.box(0, 0, 0.3, 0.3, 0, 0.74, STONE, 1); b.box(0, 0, 0.34, 0.34, 0.7, 0.76, STONE, 1)
    for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { b.cyl(x, z, 0.1, 0.1, 0, 0.86, 7, STONE, 1, false); b.cone(x, z, 0.13, 0.86, 1, 7, WHITE) }
    b.box(0, 0.3, 0.07, 0.012, 0, 0.2, DARK, 1)
  },
  walltower: (b) => { b.cyl(0, 0, 0.4, 0.36, 0, 0.66, 8, WHITE, 0, false); b.cyl(0, 0, 0.45, 0.45, 0.64, 0.74, 8, WHITE, 0); b.cone(0, 0, 0.4, 0.74, 1, 8, WHITE); b.box(0, 0.38, 0.05, 0.01, 0.3, 0.46, DARK, 1) },
  wallseg: (b) => { b.box(0, 0, 0.5, 0.07, 0, 0.5, WHITE); for (let i = 0; i < 5; i++) b.box(-0.4 + i * 0.2, 0, 0.055, 0.075, 0.5, 0.64, WHITE) },
  gate: (b) => {
    for (const x of [-0.34, 0.34]) { b.cyl(x, 0, 0.16, 0.14, 0, 0.8, 7, WHITE, 0, false); b.cone(x, 0, 0.19, 0.8, 1, 7, WHITE) }
    b.box(0, 0, 0.2, 0.14, 0.45, 0.72, WHITE); b.box(0, 0, 0.19, 0.145, 0, 0.42, DARK, 1)
  },
  palace: (b) => {
    b.box(0, 0, 0.46, 0.22, 0, 0.36, WHITE); b.box(0, 0, 0.18, 0.2, 0.36, 0.52, WHITE); b.blob([0, 0.5, 0], 0.2, 0.26, 0.2, 8, WHITE, 2); b.cone(0, 0, 0.025, 0.74, 1, 5, GOLD, 1)
    for (const x of [-0.42, 0.42]) { b.cyl(x, 0, 0.09, 0.09, 0, 0.62, 7, WHITE, 0, false); b.blob([x, 0.62, 0], 0.11, 0.12, 0.11, 6, WHITE, 2) }
    b.door(0, 0.22, 0.1, 0.24)
  },
  spire: (b) => { b.box(0, 0, 0.14, 0.14, 0, 0.1, STONE, 1); b.cyl(0, 0, 0.09, 0.07, 0.08, 0.84, 6, WHITE, 0, false); for (const y of [0.3, 0.55]) b.cyl(0, 0, 0.115, 0.115, y, y + 0.05, 6, WHITE, 0); b.cone(0, 0, 0.1, 0.84, 1, 6, WHITE) },
  stepped: (b) => {
    [[0.5, 0, 0.34], [0.38, 0.34, 0.6], [0.27, 0.6, 0.8], [0.15, 0.8, 0.92]].forEach(([w, y0, y1]) => b.box(0, 0, w, w, y0, y1, WHITE))
    b.cone(0, 0, 0.08, 0.92, 1, 4, WHITE)
  },
  rotunda: (b) => { b.cyl(0, 0, 0.46, 0.42, 0, 0.4, 10, WHITE, 0, false); b.blob([0, 0.38, 0], 0.4, 0.34, 0.4, 10, WHITE, 2); b.cyl(0, 0, 0.07, 0.06, 0.66, 0.84, 6, WHITE, 0); b.cone(0, 0, 0.08, 0.84, 1, 6, GOLD, 1) },
  barn: (b) => { b.box(0, 0, 0.5, 0.3, 0, 0.32, WHITE); b.gable(0, 0, 0.5, 0.3, 0.32, 0.66, WHITE); b.box(0.5, 0, 0.012, 0.13, 0, 0.26, DARK, 1) },
  silo: (b) => { b.cyl(0, 0, 0.3, 0.3, 0, 0.7, 8, METAL, 1, false); b.blob([0, 0.7, 0], 0.3, 0.26, 0.3, 8, METAL, 1) },
  windmill: (b) => {
    b.cyl(0, 0, 0.24, 0.16, 0, 0.5, 8, WHITE, 0, false); b.cone(0, 0, 0.19, 0.5, 0.64, 8, WHITE); b.box(0, 0.2, 0.03, 0.016, 0.06, 0.98, WOOD, 1); b.box(0, 0.2, 0.46, 0.016, 0.52, 0.56, WOOD, 1)
    for (const x of [-0.3, 0.3]) b.box(x, 0.22, 0.14, 0.012, 0.5, 0.58, CLOTH, 1)
    for (const y of [0.1, 0.74]) b.box(0, 0.22, 0.04, 0.012, y, y + 0.2, CLOTH, 1)
  },
  haystack: (b) => { b.blob([0, 0.3, 0], 0.42, 0.34, 0.42, 6, HAY, 1) },
  dock: (b) => { b.box(0, 0, 0.5, 0.09, 0, 0.05, WOOD, 1); for (const x of [-0.45, -0.15, 0.15, 0.45]) for (const z of [-0.09, 0.09]) b.cyl(x, z, 0.025, 0.025, -0.2, 0.1, 4, WOOD, 1, false) },
  ship: (b) => {
    b.blob([0, 0.07, 0], 0.5, 0.08, 0.14, 6, WOOD, 1); b.cyl(-0.04, 0, 0.012, 0.012, 0.08, 0.86, 4, WOOD, 1, false)
    b.quad([-0.02, 0.22, 0], [-0.02, 0.8, 0], [0.26, 0.3, 0], [0.26, 0.24, 0], CLOTH, 1); b.quad([-0.06, 0.28, 0], [-0.06, 0.74, 0], [-0.3, 0.34, 0], [-0.3, 0.3, 0], CLOTH, 1); b.quad([-0.04, 0.86, 0], [-0.04, 0.96, 0], [0.1, 0.92, 0], [0.1, 0.88, 0], RED, 1)
  },
  warehouse: (b) => { b.box(0, 0, 0.5, 0.26, 0, 0.28, WHITE); b.gable(0, 0, 0.5, 0.26, 0.28, 0.52, WHITE); b.door(0.2, 0.26, 0.1, 0.2) },
  crane: (b) => { b.cyl(0, 0, 0.07, 0.07, 0, 0.55, 5, STONE, 1); b.box(0.2, 0, 0.3, 0.025, 0.55, 0.6, WOOD, 1); b.box(0.48, 0, 0.012, 0.012, 0.3, 0.6, DARK, 1); b.box(0.48, 0, 0.04, 0.04, 0.24, 0.3, DARK, 1) },
  lighthouse: (b) => {
    b.cyl(0, 0, 0.18, 0.11, 0, 0.7, 8, WHITE, 0, false); b.cyl(0, 0, 0.16, 0.14, 0.25, 0.4, 8, RED, 1, false); b.cyl(0, 0, 0.17, 0.17, 0.68, 0.73, 8, STONE, 1)
    b.cyl(0, 0, 0.07, 0.07, 0.73, 0.88, 6, GOLD, 1, false); b.cone(0, 0, 0.12, 0.88, 1, 8, WHITE)
  },
  headframe: (b) => {
    for (const z of [-0.14, 0.14]) { b.cyl(-0.26, z, 0.02, 0.02, 0, 0.1, 4, WOOD, 1, false); b.cyl(0, z, 0.03, 0.02, 0.3, 0.92, 4, WOOD, 1, false) }
    b.box(-0.13, 0, 0.14, 0.015, 0.45, 0.5, WOOD, 1); b.cyl(0, 0, 0.12, 0.12, 0.9, 0.93, 8, DARK, 1); b.box(0.28, 0, 0.2, 0.14, 0, 0.22, WHITE); b.gable(0.28, 0, 0.2, 0.14, 0.22, 0.4, WHITE)
  },
  spoil: (b) => { b.cone(0, 0, 0.5, 0, 0.55, 9, SOIL, 1) },
  ruin: (b) => {
    b.box(-0.3, 0, 0.2, 0.04, 0, 0.52, STONE, 1); b.box(0.12, 0.1, 0.32, 0.04, 0, 0.3, STONE, 1); b.box(0.4, -0.18, 0.04, 0.2, 0, 0.42, STONE, 1); b.box(-0.08, -0.3, 0.22, 0.04, 0, 0.2, STONE, 1)
    b.cyl(0, 0.3, 0.05, 0.05, 0, 0.36, 6, STONE, 1); b.cyl(-0.34, 0.26, 0.05, 0.05, 0, 0.2, 6, STONE, 1); b.blob([0.1, 0.1, -0.1], 0.14, 0.1, 0.14, 5, MOSS, 1); b.blob([-0.26, 0.04, 0.2], 0.1, 0.08, 0.1, 5, LEAF, 1)
  },
  tent: (b) => { b.cone(0, 0, 0.5, 0, 0.7, 6, WHITE); b.box(0, 0.26, 0.05, 0.012, 0, 0.2, DARK, 1) },
  arch: (b) => { b.arch(0.4, 0.3, 0.22, WHITE, 0); b.box(0, 0, 0.5, 0.22, 0.4, 0.46, WHITE); for (const z of [-0.2, 0.2]) b.box(0, z, 0.5, 0.02, 0.46, 0.56, WHITE) }, // unit along x: arch under a deck with parapets
  archTall: (b) => { b.arch(0.9, 0.4, 0.2, WHITE, 0, 0); b.box(0, 0, 0.5, 0.2, 0.9, 0.96, WHITE); b.box(0, 0, 0.5, 0.13, 0.96, 1, DARK, 1) },
  deck: (b) => {
    b.box(0, 0, 0.5, 0.2, 0.3, 0.35, WOOD, 1); b.box(0, 0.19, 0.5, 0.012, 0.35, 0.46, WOOD, 1); b.box(0, -0.19, 0.5, 0.012, 0.35, 0.46, WOOD, 1)
    for (const z of [-0.14, 0.14]) b.cyl(0, z, 0.03, 0.03, -0.4, 0.32, 5, WOOD, 1, false)
  },
  rope: (b) => {
    b.box(0, 0, 0.5, 0.15, 0.3, 0.34, WOOD, 1)
    for (const z of [-0.15, 0.15]) { b.box(0, z, 0.5, 0.008, 0.52, 0.54, CLOTH, 1); b.cyl(0.5, z, 0.014, 0.014, 0.3, 0.58, 4, WOOD, 1, false) }
  },
}

export const BUILD_KINDS = Object.keys(MAKERS) as BuildKind[]
const cache = new Map<BuildKind, PropMesh>()
/** The shared unit mesh of a building kind. */
export const buildMesh = (kind: BuildKind): PropMesh => {
  let m = cache.get(kind)
  if (!m) { const b = new B(); MAKERS[kind](b); cache.set(kind, m = b.done()) }
  return m
}
