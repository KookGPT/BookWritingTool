// Hydraulic erosion on a height grid: raindrops run downhill, pick up soil where they speed up and drop it where they
// slow, so slopes get gullies and spurs and valley floors get fans. `mask` (0..1 per vertex) protects built ground.
// Pure. Heights in metres, `cell` metres between vertices.
import { rng } from '../world/noise.ts'

export function erode(h: Float32Array, N: number, cell: number, mask: Float32Array, drops: number, seed: number, strength = 1) {
  const w = N + 1, R = rng(seed)
  const inertia = 0.06, capacity = 3.5, minSlope = 0.015, depositK = 0.3, erodeK = 0.25 * strength, evap = 0.025, gravity = 9, steps = 56
  const at = (x: number, y: number) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, k = j * w + i; return h[k] * (1 - u) * (1 - v) + h[k + 1] * u * (1 - v) + h[k + w] * (1 - u) * v + h[k + w + 1] * u * v }
  const BR: [number, number, number][] = [] // a soft 3 x 3 brush for taking soil
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) BR.push([i, j, i === 0 && j === 0 ? 0.36 : i === 0 || j === 0 ? 0.11 : 0.05])
  for (let d = 0; d < drops; d++) {
    let x = 2 + R() * (N - 4), y = 2 + R() * (N - 4), dx = 0, dy = 0, speed = 1, water = 1, sed = 0
    for (let s = 0; s < steps; s++) {
      const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, k = j * w + i
      const h00 = h[k], h10 = h[k + 1], h01 = h[k + w], h11 = h[k + w + 1]
      const gx = ((h10 - h00) * (1 - v) + (h11 - h01) * v) / cell, gy = ((h01 - h00) * (1 - u) + (h11 - h10) * u) / cell
      const hNow = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v
      dx = dx * inertia - gx * (1 - inertia); dy = dy * inertia - gy * (1 - inertia)
      const len = Math.hypot(dx, dy)
      if (len < 1e-9) break
      dx /= len; dy /= len
      const nx = x + dx, ny = y + dy
      if (nx < 2 || ny < 2 || nx >= N - 2 || ny >= N - 2) break
      const dh = at(nx, ny) - hNow, slope = -dh / cell
      const cap = Math.max(slope, minSlope) * speed * water * capacity
      if (sed > cap || dh > 0) { // drop soil: fill the hollow uphill steps, else a share of the excess
        const amt = (dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositK) * mask[k]
        sed -= amt
        h[k] += amt * (1 - u) * (1 - v); h[k + 1] += amt * u * (1 - v); h[k + w] += amt * (1 - u) * v; h[k + w + 1] += amt * u * v
      } else { // take soil, never more than the drop in height
        const amt = Math.min((cap - sed) * erodeK, -dh) * mask[k]
        if (amt > 0) { for (const [bi, bj, bw] of BR) h[k + bj * w + bi] -= amt * bw; sed += amt }
      }
      speed = Math.sqrt(Math.max(0.01, speed * speed - dh * gravity / cell))
      water *= 1 - evap
      x = nx; y = ny
    }
  }
}
