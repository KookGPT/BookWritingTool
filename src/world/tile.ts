// Cube-sphere tiles: each cube face is a quadtree; a tile is (face, level, x, y). Pure, runs in the worker and in tests.
import type { Vec } from './geo.ts'
import type { Planet } from './terrain.ts'

export const SEG = 64 // quads per tile edge
// Face frames chosen so cross(u, v) = n, which makes the grid triangles wind counter-clockwise seen from outside.
const FACES: [Vec, Vec, Vec][] = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
]

// Face coords in [-1,1] -> unit direction. tan() spreads cells evenly instead of bunching them at face centres.
export function faceDir(face: number, U: number, V: number): Vec {
  const [n, u, v] = FACES[face]
  const a = Math.tan(U * Math.PI / 4), b = Math.tan(V * Math.PI / 4)
  const x = n[0] + u[0] * a + v[0] * b, y = n[1] + u[1] * a + v[1] * b, z = n[2] + u[2] * a + v[2] * b
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}

export const tileSpan = (level: number) => 2 / 2 ** level // in face coords
export const tileAngle = (level: number) => (Math.PI / 2) / 2 ** level // roughly, in radians
export function tileCenter(face: number, level: number, x: number, y: number): Vec {
  const s = tileSpan(level)
  return faceDir(face, -1 + s * (x + 0.5), -1 + s * (y + 0.5))
}

export interface TileData {
  center: Vec
  pos: Float32Array // on the unit sphere, relative to center (keeps float32 precise when zoomed in)
  up: Float32Array // unit direction per vertex
  h: Float32Array // visible surface height in radius units (sea and lakes are flat), scaled by exaggeration in the shader
  grad: Float32Array // surface gradient of h (radius units per radius unit), for normals at any exaggeration
  col: Float32Array // linear RGB 0..1
}

const lin = (c: number) => Math.pow(c / 255, 2.2)

export function buildTile(planet: Planet, face: number, level: number, tx: number, ty: number): TileData {
  const n = SEG, W = n + 3 // one extra ring each side for gradients
  const s = tileSpan(level)
  const detail = Math.max(0, Math.min(14, level - 2))
  const R = planet.radiusM
  const P = new Float64Array(W * W * 3), H = new Float64Array(W * W), S = new Float64Array(W * W) // terrain, visible surface
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const d = faceDir(face, -1 + s * (tx + (i - 1) / n), -1 + s * (ty + (j - 1) / n))
    const k = j * W + i
    P[k * 3] = d[0]; P[k * 3 + 1] = d[1]; P[k * 3 + 2] = d[2]
    H[k] = planet.elevation(d[0], d[1], d[2], detail)
    S[k] = planet.surface(d[0], d[1], d[2], H[k])
  }
  const center = tileCenter(face, level, tx, ty)
  const count = (n + 1) ** 2 + 4 * (n + 1)
  const pos = new Float32Array(count * 3), up = new Float32Array(count * 3), h = new Float32Array(count), grad = new Float32Array(count * 3), col = new Float32Array(count * 3)
  const put = (v: number, k: number, drop: number, slope: number) => {
    const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2]
    pos[v * 3] = x * (1 - drop) - center[0]; pos[v * 3 + 1] = y * (1 - drop) - center[1]; pos[v * 3 + 2] = z * (1 - drop) - center[2]
    up[v * 3] = x; up[v * 3 + 1] = y; up[v * 3 + 2] = z
    h[v] = S[k] / R
    const c = planet.color(x, y, z, H[k], slope, Math.max(0, level - 3))
    col[v * 3] = lin(c[0]); col[v * 3 + 1] = lin(c[1]); col[v * 3 + 2] = lin(c[2])
  }
  const gradAt = (k: number, v: number) => {
    // solve g . tu = dh_u, g . tv = dh_v with g in the tangent plane spanned by tu, tv
    const tu = [P[(k + 1) * 3] - P[(k - 1) * 3], P[(k + 1) * 3 + 1] - P[(k - 1) * 3 + 1], P[(k + 1) * 3 + 2] - P[(k - 1) * 3 + 2]]
    const tv = [P[(k + W) * 3] - P[(k - W) * 3], P[(k + W) * 3 + 1] - P[(k - W) * 3 + 1], P[(k + W) * 3 + 2] - P[(k - W) * 3 + 2]]
    const du = (S[k + 1] - S[k - 1]) / R, dv = (S[k + W] - S[k - W]) / R
    const a = tu[0] ** 2 + tu[1] ** 2 + tu[2] ** 2, b = tu[0] * tv[0] + tu[1] * tv[1] + tu[2] * tv[2], c = tv[0] ** 2 + tv[1] ** 2 + tv[2] ** 2
    const det = a * c - b * b || 1e-30
    const p = (du * c - dv * b) / det, q = (dv * a - du * b) / det
    const gx = p * tu[0] + q * tv[0], gy = p * tu[1] + q * tv[1], gz = p * tu[2] + q * tv[2]
    grad[v * 3] = gx; grad[v * 3 + 1] = gy; grad[v * 3 + 2] = gz
    return Math.hypot(gx, gy, gz)
  }
  let v = 0
  const slopes = new Float32Array((n + 1) ** 2)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = (j + 1) * W + i + 1
    slopes[v] = gradAt(k, v)
    put(v, k, 0, slopes[v]); v++
  }
  // skirts: a dropped copy of each edge vertex hides cracks between tiles of different levels
  const drop = tileAngle(level) * 0.03
  const edge = (i: number, j: number) => {
    const g = j * (n + 1) + i
    grad[v * 3] = grad[g * 3]; grad[v * 3 + 1] = grad[g * 3 + 1]; grad[v * 3 + 2] = grad[g * 3 + 2]
    put(v, (j + 1) * W + i + 1, drop, slopes[g]); v++
  }
  for (let i = 0; i <= n; i++) edge(i, 0)
  for (let i = 0; i <= n; i++) edge(i, n)
  for (let j = 0; j <= n; j++) edge(0, j)
  for (let j = 0; j <= n; j++) edge(n, j)
  return { center, pos, up, h, grad, col }
}

// Shared index buffer: grid triangles plus double-sided skirt strips.
export function tileIndex(): Uint32Array {
  const n = SEG, out: number[] = []
  const g = (i: number, j: number) => j * (n + 1) + i
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = g(i, j), b = g(i + 1, j), c = g(i, j + 1), d = g(i + 1, j + 1)
    out.push(a, b, c, b, d, c)
  }
  const base = (n + 1) ** 2
  const strip = (s: number, at: (t: number) => number) => {
    for (let t = 0; t < n; t++) {
      const a = at(t), b = at(t + 1), A = base + s * (n + 1) + t, B = A + 1
      out.push(a, b, A, b, B, A, a, A, b, b, A, B)
    }
  }
  strip(0, (t) => g(t, 0)); strip(1, (t) => g(t, n)); strip(2, (t) => g(0, t)); strip(3, (t) => g(n, t))
  return new Uint32Array(out)
}
