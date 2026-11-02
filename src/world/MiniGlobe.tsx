// A small live globe centred on one place, for wiki pages. Loaded lazily so three.js stays out of the wiki bundle.
import { useEffect, useRef } from 'react'
import { Globe } from './globe'
import type { World } from './terrain'

export default function MiniGlobe({ world, lat, lon }: { world: World; lat: number; lon: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const g = new Globe(canvas.current!)
    g.setWorld({ ...world, layers: [...(world.layers ?? []), { id: 'story', name: '', kind: 'custom', color: '#ff6b9d', items: [{ id: 'here', at: [lat, lon] }] }] })
    g.flyTo(lat, lon, 0.4)
    return () => g.dispose()
  }, [world, lat, lon])
  return <div className="mini-globe"><canvas ref={canvas} aria-label="Globe showing this place" /></div>
}
