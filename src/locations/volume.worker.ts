// Meshes squares of the volume ground off the main thread: told the field once, then asked for squares as the camera moves.
import { volumeField, type Field, type FieldIn } from './volume.ts'

let field: Field | null = null
self.onmessage = (e: MessageEvent<{ init?: FieldIn; key?: string; x0?: number; z0?: number; n?: number; v?: number }>) => {
  const m = e.data
  if (m.init) { field = volumeField(m.init); return }
  if (!field || m.key == null) return
  const ch = field.mesh(m.x0!, m.z0!, m.n!, m.v!)
  ;(self as unknown as Worker).postMessage({ key: m.key, ch }, ch ? [ch.pos.buffer, ch.nor.buffer, ch.col.buffer, ch.surf.buffer, ch.idx.buffer] as ArrayBuffer[] : [])
}
