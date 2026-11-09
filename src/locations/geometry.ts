// Locations geometry for the renderer: one unit shape per building part (scaled per instance to real metres), eight
// tree species at two levels of detail, rocks, and terrain tiles with levels of detail and skirts.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PART } from './buildings.ts'
import type { CityBuilt } from './city.ts'

type G = THREE.BufferGeometry
/** Non-indexed, with a white (or given) vertex colour so every part can be tinted per vertex and per instance. */
const prep = (g: G, col: [number, number, number] = [1, 1, 1]) => {
  const n = g.index ? g.toNonIndexed() : g
  n.deleteAttribute('uv')
  const c = n.attributes.position.count
  n.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c * 3).map((_, i) => col[i % 3]), 3))
  return n
}
const merge = (gs: G[]) => { const g = mergeGeometries(gs)!; g.computeVertexNormals(); return g }
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col?: [number, number, number]) => prep(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), col)
/** Faces between rectangles stacked upward: [half x, half z, y] from the eaves to the top (half z = 0 makes a ridge). */
function rings(levels: [number, number, number][]) {
  const pos: number[] = [], P = (l: [number, number, number], sx: number, sz: number) => [l[0] * sx, l[2], l[1] * sz]
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  for (let i = 0; i < levels.length - 1; i++) {
    const lo = levels[i], hi = levels[i + 1]
    const L = [P(lo, -1, 1), P(lo, 1, 1), P(lo, 1, -1), P(lo, -1, -1)], H = [P(hi, -1, 1), P(hi, 1, 1), P(hi, 1, -1), P(hi, -1, -1)]
    for (let k = 0; k < 4; k++) quad(L[k], L[(k + 1) % 4], H[(k + 1) % 4], H[k])
  }
  const b = levels[0]; quad(P(b, -1, -1), P(b, 1, -1), P(b, 1, 1), P(b, -1, 1))
  const top = levels[levels.length - 1]; if (top[0] > 0 && top[1] > 0) quad(P(top, -1, 1), P(top, 1, 1), P(top, 1, -1), P(top, -1, -1))
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals()
  return prep(g)
}
function gable(): G {
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], E = [-0.5, 1, 0], F = [0.5, 1, 0]
  const tris = [D, C, F, D, F, E, B, A, E, B, E, F, A, D, E, C, B, F, A, B, C, A, C, D]
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3)); g.computeVertexNormals()
  return prep(g)
}
function lathe(prof: [number, number][], seg = 16) { return prep(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg)) }

/** One geometry per part shape (index = PART value). */
export function partGeometries(): G[] {
  const g: G[] = []
  g[PART.wall] = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  g[PART.gable] = gable()
  g[PART.hip] = rings([[0.5, 0.5, 0], [0.25, 0, 1]])
  g[PART.flat] = box(-0.5, 0, -0.5, 0.5, 1, 0.5)
  g[PART.dome] = prep(new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1))
  g[PART.onion] = lathe([[0, 0], [0.4, 0], [0.5, 0.18], [0.48, 0.36], [0.36, 0.55], [0.16, 0.74], [0.06, 0.86], [0.035, 0.94], [0.05, 0.96], [0, 1]], 18)
  g[PART.spire] = merge([prep(new THREE.ConeGeometry(0.55, 0.92, 8).translate(0, 0.46, 0)), prep(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 4).translate(0, 0.96, 0))])
  g[PART.mansard] = rings([[0.5, 0.5, 0], [0.42, 0.38, 0.62], [0.2, 0, 1]])
  g[PART.pyramid] = rings([[0.5, 0.5, 0], [0, 0, 1]])
  const steps: G[] = []
  for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) steps.push(box(sx * 0.5 - 0.035, k * 0.21 - 0.02, -0.5 + k * 0.1, sx * 0.5 + 0.035, (k + 1) * 0.21, 0.5 - k * 0.1))
  g[PART.stepgable] = merge(steps)
  const shed = new THREE.BufferGeometry(), S = [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5], [-0.5, 0, -0.5], [0.5, 0, -0.5]]
  shed.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 2, 0, 2, 3, 4, 3, 2, 4, 2, 5, 0, 3, 4, 1, 5, 2, 0, 4, 5, 0, 5, 1].flatMap((i) => S[i]), 3)); shed.computeVertexNormals()
  g[PART.shed] = prep(shed)
  g[PART.chimney] = merge([box(-0.5, 0, -0.5, 0.5, 0.9, 0.5), box(-0.65, 0.9, -0.65, 0.65, 1, 0.65, [0.8, 0.78, 0.74])])
  const rail: G[] = [box(-0.5, 0, -0.5, 0.5, 0.12, 0.5), box(-0.5, 0.9, 0.44, 0.5, 1, 0.5)]
  for (let k = 0; k <= 8; k++) rail.push(box(-0.5 + k / 8 - 0.012, 0.12, 0.45, -0.5 + k / 8 + 0.012, 0.92, 0.49))
  for (const sx of [-1, 1]) rail.push(box(sx * 0.5 - 0.02, 0.12, -0.5, sx * 0.5, 1, 0.5))
  g[PART.balcony] = merge(rail)
  const dormerRoof = gable().rotateY(Math.PI / 2).scale(1.15, 0.45, 1.1).translate(0, 0.55, 0)
  const dc = dormerRoof.attributes.color as THREE.BufferAttribute; for (let i = 0; i < dc.count; i++) dc.setXYZ(i, 0.32, 0.24, 0.2)
  g[PART.dormer] = merge([box(-0.5, 0, -0.5, 0.5, 0.56, 0.5), dormerRoof, box(-0.32, 0.12, 0.5, 0.32, 0.46, 0.52, [0.08, 0.08, 0.1])])
  const aw = new THREE.BufferGeometry(), A = [[-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 0.45, 0.5], [-0.5, 0.45, 0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]]
  aw.setAttribute('position', new THREE.Float32BufferAttribute([0, 3, 2, 0, 2, 1, 3, 5, 4, 3, 4, 2].flatMap((i) => A[i]), 3)); aw.computeVertexNormals()
  g[PART.awning] = prep(aw)
  g[PART.minaret] = lathe([[0.5, 0], [0.48, 0.02], [0.42, 0.04], [0.4, 0.7], [0.62, 0.72], [0.62, 0.74], [0.36, 0.75], [0.33, 0.9], [0.38, 0.905], [0.3, 0.92], [0.02, 1], [0, 1]], 12)
  g[PART.cornice] = merge([box(-0.5, 0.55, -0.5, 0.5, 1, 0.5), box(-0.47, 0, -0.47, 0.47, 0.55, 0.47, [0.9, 0.9, 0.9])])
  const t = 0.06
  g[PART.parapet] = merge([box(-0.5, 0, 0.5 - t, 0.5, 1, 0.5), box(-0.5, 0, -0.5, 0.5, 1, -0.5 + t), box(-0.5, 0, -0.5 + t, -0.5 + t, 1, 0.5 - t), box(0.5 - t, 0, -0.5 + t, 0.5, 1, 0.5 - t)])
  const vine = prep(new THREE.BoxGeometry(1, 1, 1, 1, 2, 3).translate(0, 0.5, 0))
  const vp = vine.attributes.position; for (let i = 0; i < vp.count; i++) { const y = vp.getY(i); vp.setX(i, vp.getX(i) * (y > 0.5 ? 1.25 : 0.7)) } vine.computeVertexNormals()
  g[PART.vine] = vine
  const dw = prep(new THREE.BoxGeometry(1, 1, 1, 1, 1, 4).translate(0, 0.5, 0))
  const dp = dw.attributes.position; for (let i = 0; i < dp.count; i++) if (dp.getY(i) > 0.5) dp.setY(i, 0.85 + Math.abs(Math.sin(dp.getZ(i) * 17.3)) * 0.2); dw.computeVertexNormals()
  g[PART.drywall] = dw
  return g
}

/** Trees: foliage 0 trunk, 1 leaves that turn and fall (tinted by season), 2 evergreen. */
function treeGeo(kind: number, detail: number): G {
  const parts: G[] = []
  const tag = (g: G, f: number, col: [number, number, number]) => { const n = prep(g, col); n.setAttribute('foliage', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count).fill(f), 1)); parts.push(n) }
  const jitter = (g: G, a: number, s: number) => {
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) { const k = Math.abs(Math.sin(p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7 + s) * 43758.5); p.setXYZ(i, p.getX(i) * (1 + ((k % 1) - 0.5) * a), p.getY(i) * (1 + (((k * 7) % 1) - 0.5) * a * 0.6), p.getZ(i) * (1 + (((k * 13) % 1) - 0.5) * a)) }
    return g
  }
  const trunk = (h: number, r: number, col: [number, number, number] = [0.32, 0.24, 0.17]) => tag(new THREE.CylinderGeometry(r * 0.5, r, h, 6).translate(0, h / 2, 0), 0, col)
  const ico = (x: number, y: number, z: number, r: number, sy: number, f: number, col: [number, number, number], s: number) => tag(jitter(new THREE.IcosahedronGeometry(r, detail ? 1 : 0).scale(1, sy, 1).translate(x, y, z), 0.3, s), f, col)
  switch (kind) {
    case 0: trunk(4, 0.32); for (const [x, y, z, r] of detail ? [[0, 6.2, 0, 2.9], [1.5, 5.1, 0.7, 2.1], [-1.3, 5.3, -0.8, 2.2], [0.3, 4.8, -1.6, 1.9], [-0.4, 7.6, 0.4, 2.0], [0.9, 7, -0.6, 1.6]] : [[0, 6, 0, 3.2]]) ico(x, y, z, r, 1, 1, [1, 1, 1], x + y); break
    case 1: trunk(3, 0.3); for (let i = 0; i < (detail ? 5 : 2); i++) { const k = detail ? i : i * 2; tag(jitter(new THREE.ConeGeometry(2.6 - k * 0.45, 4.2 - k * 0.35, detail ? 9 : 6).translate(0, 3.4 + k * 2.1, 0), 0.25, i), 2, [0.36, 0.5, 0.36]) } break
    case 2: trunk(7.5, 0.3, [0.42, 0.3, 0.22]); for (const [x, y, z, r] of detail ? [[0, 8.6, 0, 3.4], [2.2, 8.1, 0.8, 2.4], [-2, 8.2, -0.6, 2.5], [0.4, 8.4, -2.1, 2.2]] : [[0, 8.4, 0, 4]]) ico(x, y, z, r, 0.42, 2, [0.5, 0.6, 0.38], x); break // umbrella pine
    case 3: trunk(1.2, 0.2); tag(jitter(new THREE.CylinderGeometry(0.15, 1, 1, detail ? 10 : 6, detail ? 4 : 1).scale(1, 9, 1).translate(0, 5.6, 0), 0.18, 2), 2, [0.28, 0.4, 0.26]); break // cypress
    case 4: trunk(3, 0.28); for (let i = 0; i < (detail ? 4 : 2); i++) { const k = detail ? i : i * 2; tag(jitter(new THREE.ConeGeometry(2.4 - k * 0.5, 4 - k * 0.4, detail ? 8 : 6).translate(0, 3.4 + k * 2.3, 0), 0.4, i + 9), 1, [1.15, 1.1, 0.95]) } break // larch: needles that turn gold and fall
    case 5: trunk(1.6, 0.18); ico(0, 2.8, 0, 1.7, 0.85, 1, [1, 1, 1], 3); break // orchard tree
    case 6: ico(0, 0.7, 0, 1.3, 0.6, 1, [0.85, 0.95, 0.8], 5); break // hedge bush
    default: trunk(1.4, 0.26, [0.4, 0.35, 0.3]); for (const [x, y, z, r] of detail ? [[0, 2.6, 0, 1.6], [1, 2.3, 0.4, 1.1], [-0.9, 2.4, -0.5, 1.2]] : [[0, 2.5, 0, 1.9]]) ico(x, y, z, r, 0.75, 2, [0.6, 0.66, 0.5], x + 1) // olive
  }
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}
export const TREE_KINDS = 8
export const treeGeometries = () => Array.from({ length: TREE_KINDS }, (_, k) => [treeGeo(k, 1), treeGeo(k, 0)])
export function rockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position
  for (let i = 0; i < p.count; i++) { const k = Math.abs(Math.sin(p.getX(i) * 4.1 + p.getY(i) * 7.3 + p.getZ(i) * 2.9) * 43758.5) % 1, s = 0.7 + k * 0.6; p.setXYZ(i, p.getX(i) * s * 1.2, p.getY(i) * s * 0.7, p.getZ(i) * s) }
  g.computeVertexNormals()
  return g
}

/** Terrain in tiles, each with four levels of detail (every 1, 2, 4 or 8 grid cells) and a skirt that hides cracks. */
export function terrainTiles(b: CityBuilt, mat: THREE.Material) {
  const { N, size, heights, colors, surf } = b, c = size / N, w = N + 1, nor = new Float32Array(w * w * 3)
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const hx = heights[j * w + Math.min(N, i + 1)] - heights[j * w + Math.max(0, i - 1)], hz = heights[Math.min(N, j + 1) * w + i] - heights[Math.max(0, j - 1) * w + i]
    const nx = -hx, ny = 2 * c, nz = -hz, l = Math.hypot(nx, ny, nz), a = (j * w + i) * 3
    nor[a] = nx / l; nor[a + 1] = ny / l; nor[a + 2] = nz / l
  }
  const T = 64, group = new THREE.Group()
  for (let tj = 0; tj < N; tj += T) for (let ti = 0; ti < N; ti += T) {
    const lod = new THREE.LOD()
    for (const [step, dist] of [[1, 0], [2, T * c * 1.4], [4, T * c * 3], [8, T * c * 6]] as const) {
      const m = T / step, pos: number[] = [], nr: number[] = [], col: number[] = [], sf: number[] = [], idx: number[] = []
      const vert = (i: number, j: number, drop: number) => {
        const a = j * w + i
        let hv = heights[a]
        if (step > 1 && b.cliffMask?.[a]) for (let dj = -step; dj <= step; dj++) for (let di = -step; di <= step; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii <= N && jj <= N) hv = Math.min(hv, heights[jj * w + ii]) } // stay behind rock faces
        pos.push(-size / 2 + i * c, hv - drop, -size / 2 + j * c); nr.push(nor[a * 3], nor[a * 3 + 1], nor[a * 3 + 2]); col.push(colors[a * 3], colors[a * 3 + 1], colors[a * 3 + 2]); sf.push(surf[a * 4], surf[a * 4 + 1], surf[a * 4 + 2], surf[a * 4 + 3])
        return pos.length / 3 - 1
      }
      for (let y = 0; y <= m; y++) for (let x = 0; x <= m; x++) vert(ti + x * step, tj + y * step, 0)
      for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) { const a = y * (m + 1) + x, bb = a + 1, cc = a + m + 1, d = cc + 1; idx.push(a, cc, bb, bb, cc, d) }
      const at = (i: number, j: number) => ((j - tj) / step) * (m + 1) + (i - ti) / step
      const edge = (pts: [number, number][]) => { for (let k = 0; k < pts.length - 1; k++) { const [i0, j0] = pts[k], [i1, j1] = pts[k + 1], a = at(i0, j0), bb = at(i1, j1), a2 = vert(i0, j0, 25 + step * 6), b2 = vert(i1, j1, 25 + step * 6); idx.push(a, bb, a2, bb, b2, a2, a, a2, bb, bb, a2, b2) } }
      const line = (f: (k: number) => [number, number]) => Array.from({ length: m + 1 }, (_, k) => f(k))
      edge(line((k) => [ti + k * step, tj])); edge(line((k) => [ti + k * step, tj + T])); edge(line((k) => [ti, tj + k * step])); edge(line((k) => [ti + T, tj + k * step]))
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nr, 3))
      g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(col), 3, true)); g.setAttribute('surf', new THREE.BufferAttribute(new Uint8Array(sf), 4, true))
      g.setIndex(idx); g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = step <= 2
      lod.addLevel(mesh, dist)
    }
    group.add(lod)
  }
  return group
}
export function gridMesh(n: number, size: number, heights: Float32Array, colors: Uint8Array) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array((n + 1) * (n + 1) * 3), c = size / n
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const a = (j * (n + 1) + i) * 3; pos[a] = -size / 2 + i * c; pos[a + 1] = heights[j * (n + 1) + i]; pos[a + 2] = -size / 2 + j * c }
  const idx = new Uint32Array(n * n * 6)
  let k = 0
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, cc = a + n + 1, d = cc + 1; idx.set([a, cc, b, b, cc, d], k); k += 6 }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colors, 3, true)); g.setAttribute('surf', new THREE.BufferAttribute(new Uint8Array((n + 1) * (n + 1) * 4), 4, true)); g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals(); g.computeBoundingSphere()
  return g
}
/** Group instance indices into square chunks so each chunk is culled (and levelled) on its own. */
export function chunks(n: number, xz: (i: number) => [number, number], size: number) {
  const m = new Map<string, number[]>()
  for (let i = 0; i < n; i++) { const [x, z] = xz(i), k = `${Math.floor(x / size)},${Math.floor(z / size)}`; const l = m.get(k); if (l) l.push(i); else m.set(k, [i]) }
  return [...m.values()]
}
