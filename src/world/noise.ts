// Seeded 3D simplex noise (after Stefan Gustavson's public-domain reference) and fractal sums.
// Pure and deterministic: the same seed always gives the same planet, in the browser, the worker and node.

export const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

// mulberry32
export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const F3 = 1 / 3, G3 = 1 / 6
const GRAD = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]

export type Noise3 = (x: number, y: number, z: number) => number

// Returns noise in roughly [-1, 1].
export function simplex(seed: number): Noise3 {
  const r = rng(seed)
  const p = new Uint8Array(256).map((_, i) => i)
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t }
  const perm = new Uint8Array(512), g12 = new Uint8Array(512)
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; g12[i] = (perm[i] % 12) * 3 }
  const corner = (g: number, x: number, y: number, z: number) => {
    let t = 0.6 - x * x - y * y - z * z
    if (t < 0) return 0
    t *= t
    return t * t * (GRAD[g] * x + GRAD[g + 1] * y + GRAD[g + 2] * z)
  }
  return (x, y, z) => {
    const s = (x + y + z) * F3
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s)
    const t = (i + j + k) * G3
    const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t
    let i1, j1, k1, i2, j2, k2
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    }
    const ii = i & 255, jj = j & 255, kk = k & 255
    return 32 * (
      corner(g12[ii + perm[jj + perm[kk]]], x0, y0, z0) +
      corner(g12[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3) +
      corner(g12[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3) +
      corner(g12[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3))
  }
}

// Fractal sum in roughly [-1, 1]. Fractional octave counts fade the last octave in, so LOD changes don't pop.
export function fbm(n: Noise3, x: number, y: number, z: number, octaves: number, gain = 0.5) {
  let sum = 0, amp = 1, f = 1
  for (let o = 0; o < octaves; o++) {
    const w = Math.min(1, octaves - o)
    sum += n(x * f, y * f, z * f) * amp * w
    amp *= gain; f *= 2
  }
  return sum * (1 - gain) // normalise by the infinite series so adding octaves (LOD) never rescales the coarse ones
}

// Ridged multifractal in [0, 1]: sharp crests where the noise crosses zero, used for mountain chains.
export function ridged(n: Noise3, x: number, y: number, z: number, octaves: number, gain = 0.5) {
  let sum = 0, amp = 0.5, f = 1, weight = 1
  for (let o = 0; o < octaves; o++) {
    let v = 1 - Math.abs(n(x * f, y * f, z * f))
    v *= v * weight
    weight = Math.min(1, v * 2)
    sum += v * amp
    amp *= gain; f *= 2
  }
  return sum * 2 * (1 - gain)
}
