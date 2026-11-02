// Builds a flat world (heights, colours, effects, trees) off the main thread.
import { generate, treesOf, wallMesh, type FlatWorld } from './gen.ts'

self.onmessage = (e: MessageEvent<{ fw: FlatWorld; res: number; job: number }>) => {
  const { fw, res, job } = e.data
  const gen = generate(fw, res), wall = wallMesh(gen), trees = treesOf(gen, fw.seed)
  const bufs = [gen.height, gen.rgba, gen.data, gen.rough, gen.tree, gen.dens, gen.wx, gen.wy, gen.snaps, ...gen.zones.map((z) => z.pts), wall.pos, wall.ground, wall.index,
    ...trees.far, ...trees.near.kinds.flatMap((k) => [k.data, k.start])].map((a) => a.buffer)
  ;(self as unknown as Worker).postMessage({ job, built: { gen, wall, trees, seed: fw.seed } }, bufs as ArrayBuffer[])
}
