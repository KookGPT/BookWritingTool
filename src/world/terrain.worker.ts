// Builds terrain tiles and settlements off the main thread. One planet is cached per world spec.
import { buildSite } from './settle.ts'
import { makePlanet, type Planet } from './terrain.ts'
import { buildTile } from './tile.ts'

let spec = '', planet: Planet
self.onmessage = (e: MessageEvent) => {
  const { world, face, level, x, y, key, gen, light, clear, item } = e.data
  if (world !== spec) { spec = world; planet = makePlanet(JSON.parse(world)) }
  const post = (m: object, bufs: ArrayBufferLike[]) => (self as unknown as Worker).postMessage(m, bufs as ArrayBuffer[])
  if (item) {
    const site = buildSite(planet, item)
    post({ key, gen, site }, site ? [...site.sets.map((s) => s.data.buffer), ...(site.decal ? [site.decal.pos, site.decal.up, site.decal.h, site.decal.grad, site.decal.col, site.decal.index].map((a) => a.buffer) : [])] : [])
    return
  }
  const t = buildTile(planet, face, level, x, y, light, clear)
  post({ key, gen, t }, [t.pos.buffer, t.up.buffer, t.h.buffer, t.grad.buffer, t.col.buffer, ...(t.props ?? []).map((p) => p.data.buffer)])
}
