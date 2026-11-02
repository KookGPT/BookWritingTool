// Builds terrain tiles off the main thread. One planet is cached per world spec.
import { makePlanet, type Planet } from './terrain.ts'
import { buildTile } from './tile.ts'

let spec = '', planet: Planet
self.onmessage = (e: MessageEvent) => {
  const { world, face, level, x, y, key, gen, light } = e.data
  if (world !== spec) { spec = world; planet = makePlanet(JSON.parse(world)) }
  const t = buildTile(planet, face, level, x, y, light)
  ;(self as unknown as Worker).postMessage({ key, gen, t }, [t.pos.buffer, t.up.buffer, t.h.buffer, t.grad.buffer, t.col.buffer, ...(t.props ?? []).map((p) => p.data.buffer)])
}
