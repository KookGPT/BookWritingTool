// Builds a flat world (heights, colours, meshes, trees) off the main thread.
import { generate, terrainMesh, treesOf, wallMesh, type FlatWorld } from './gen.ts'

self.onmessage = (e: MessageEvent<{ fw: FlatWorld; res: number; job: number }>) => {
  const { fw, res, job } = e.data
  const gen = generate(fw, res), terrain = terrainMesh(gen), wall = wallMesh(gen), trees = treesOf(gen, fw.seed)
  const bufs = [gen.height, gen.rgba, gen.depth, gen.tree, gen.dens, gen.wx, gen.wy, gen.snaps, terrain.pos, terrain.nor, terrain.uv, terrain.index, wall.pos, wall.ground, wall.index, ...trees].map((a) => a.buffer)
  ;(self as unknown as Worker).postMessage({ job, built: { gen, terrain, wall, trees, seed: fw.seed } }, bufs as ArrayBuffer[])
}
