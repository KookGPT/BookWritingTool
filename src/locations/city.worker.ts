// Builds a location (terrain, buildings, structures) off the main thread.
import { buildCity, type LocationDoc } from './city.ts'

self.onmessage = (e: MessageEvent<{ doc: LocationDoc; job: number }>) => {
  try {
    const built = buildCity(e.data.doc, (stage) => (self as unknown as Worker).postMessage({ job: e.data.job, stage }))
    const bufs = [built.water, built.heights, built.colors, built.surf, built.outer.heights, built.outer.colors, built.parts, built.chimneys, built.trees, built.rocks, built.lamps, built.falls, built.rivers.pos, built.rivers.uv, ...Object.values(built.geo).flatMap((g) => [g.pos, g.nor, g.col])].map((a) => a.buffer)
    ;(self as unknown as Worker).postMessage({ job: e.data.job, built }, bufs as ArrayBuffer[])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ job: e.data.job, error: String(err) })
  }
}
