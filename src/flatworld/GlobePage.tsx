import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { useBook } from '../store'
import { useLocal } from '../ui'
import { buildWorld, mainWorld, specOf } from './built'
import { GlobeScene } from './globeScene'
import { planetKm } from './sphere'

const SPEEDS = { Paused: 0, Slow: 0.04, Normal: 0.1, Fast: 0.33 } // days per second

// The Map tab's world on a sphere at true size, in its solar system. View only: it reads the world and its build, and saves nothing to the book.
export default function GlobePage() {
  const { book } = useBook()
  const world = mainWorld(book.flatWorlds)
  const canvas = useRef<HTMLCanvasElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const scene = useRef<GlobeScene>(null)
  const [shown, setShown] = useState<string>()
  const [msg, setMsg] = useState('')
  const [cinematic, setCinematic] = useState(false)
  const [speed, setSpeed] = useLocal('globe-speed', SPEEDS.Normal)
  const [axis, setAxis] = useLocal('globe-axis', true)
  const [lines, setLines] = useLocal('globe-constellations', true)
  const [season, setSeason] = useState('')
  const spec = world && specOf(world)

  useEffect(() => {
    const s = new GlobeScene(canvas.current!)
    scene.current = s
    if (import.meta.env.DEV) (window as unknown as { globeScene: GlobeScene }).globeScene = s
    s.onSeason = setSeason
    const ro = new ResizeObserver(() => s.resize())
    ro.observe(canvas.current!)
    return () => { ro.disconnect(); s.dispose(); scene.current = null }
  }, [])
  useEffect(() => scene.current?.set({ cinematic, speed, axis, lines }), [cinematic, speed, axis, lines])
  useEffect(() => {
    if (!spec) return
    return buildWorld(spec, (b) => { scene.current?.setWorld(b); setShown(spec); setMsg('') }, (m) => setMsg(`Build failed: ${m}`))
  }, [spec])

  return (
    <div ref={page} className={`maptest-page globe-page ${cinematic ? 'cinematic' : ''}`}>
      <canvas ref={canvas} tabIndex={0} aria-label={world ? `Globe showing ${world.name} in its solar system. Drag or use the arrow keys to turn, scroll or use plus and minus to zoom.` : 'Empty globe'} />
      {world
        ? <div className="maptest-bar glass">
          <strong><Icon name="globe" /> Globe</strong>
          <span>{world.name}</span>
          {spec === shown
            ? <>
              <button className={cinematic ? '' : 'alt'} aria-pressed={cinematic} title="Let the planet turn in space, through day and night and the seasons" onClick={() => setCinematic(!cinematic)}>Cinematic</button>
              {cinematic && <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed" title="How fast time passes">{Object.entries(SPEEDS).map(([n, v]) => <option key={n} value={v}>{n}</option>)}</select>}
              {cinematic && <span className="small">{season}</span>}
              <label className="small"><input type="checkbox" checked={axis} onChange={(e) => setAxis(e.target.checked)} /> Axis</label>
              <label className="small"><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} /> Constellations</label>
              <button className="alt" title="Fill the screen (Esc to leave)" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : page.current?.requestFullscreen())}>Full screen</button>
              {!cinematic && <span className="muted small">True to scale, planet {Math.round(2 * planetKm(world.size[0], world.size[1], world.shape === 'disc')).toLocaleString()} km across</span>}
            </>
            : <span className="muted small">{msg || 'Building…'}</span>}
        </div>
        : <div className="maptest-empty glass">
          <p>No map yet. Make or import one on the Map tab and it will show here.</p>
          <Link to="/map-test">Go to Map</Link>
        </div>}
    </div>
  )
}
