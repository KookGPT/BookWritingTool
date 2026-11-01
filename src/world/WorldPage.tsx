import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import { trashIt } from '../history'
import { uid, useBook } from '../store'
import { Globe, type Hover } from './globe'
import { DEFAULT_PARAMS, type World, type WorldParams } from './terrain'

const SLIDERS: [keyof WorldParams, string, number, number, number, (v: number) => string][] = [
  ['oceanPct', 'Ocean', 5, 95, 1, (v) => `${v}%`],
  ['plates', 'Tectonic plates', 4, 40, 1, (v) => `${v}`],
  ['ruggedness', 'Ruggedness', 0.2, 2, 0.05, (v) => `${v.toFixed(2)}x`],
  ['aridity', 'Aridity', 0, 1, 0.05, (v) => (v < 0.35 ? 'Wet' : v > 0.65 ? 'Dry' : 'Earth-like')],
  ['tilt', 'Axial tilt', 0, 60, 1, (v) => `${v}°`],
  ['radiusKm', 'Radius', 1000, 15000, 100, (v) => `${v.toLocaleString()} km`],
]

const newSeed = () => Math.random().toString(36).slice(2, 8)
const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`
const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`
const fmtAlt = (km: number) => (km >= 100 ? `${Math.round(km).toLocaleString()} km` : km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`)

export default function WorldPage() {
  const { book, update } = useBook()
  const [sel, setSel] = useState(() => { try { return localStorage.getItem('world-sel') ?? '' } catch { return '' } })
  const world = book.worlds.find((w) => w.id === sel) ?? book.worlds[0]
  const canvas = useRef<HTMLCanvasElement>(null)
  const globe = useRef<Globe>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [alt, setAlt] = useState('')
  const [relief, setRelief] = useState(1)
  const [panel, setPanel] = useState(() => innerWidth > 700)

  useEffect(() => { try { if (world) localStorage.setItem('world-sel', world.id) } catch { /* private mode */ } }, [world])
  const hasWorld = !!world
  useEffect(() => {
    if (!hasWorld || !canvas.current) return
    const g = new Globe(canvas.current)
    g.onHover = setHover
    g.onView = (v) => setAlt(fmtAlt(v.altitudeKm)) // same string = no re-render
    globe.current = g
    return () => { g.dispose(); globe.current = null }
  }, [hasWorld])
  // regenerate shortly after slider drags settle
  useEffect(() => {
    if (!world) return
    const t = setTimeout(() => {
      globe.current?.setWorld(world)
      if (import.meta.env.DEV) Object.assign(window, { globe: globe.current }) // for poking at it from devtools
    }, 150)
    return () => clearTimeout(t)
  }, [world])
  useEffect(() => globe.current?.setRelief(relief), [relief])

  const create = () => {
    const w: World = { id: uid(), name: `World ${book.worlds.length + 1}`, generatorVersion: 1, seed: newSeed(), params: { ...DEFAULT_PARAMS } }
    update((b) => ({ ...b, worlds: [...b.worlds, w] }))
    setSel(w.id)
  }
  const patch = (p: Partial<World>) => update((b) => ({ ...b, worlds: b.worlds.map((w) => (w.id === world!.id ? { ...w, ...p } : w)) }))
  const setParam = (k: keyof WorldParams, v: number) => patch({ params: { ...DEFAULT_PARAMS, ...world!.params, [k]: v } })
  const remove = () => {
    if (!world || !confirm(`Delete "${world.name}"? It goes to Trash.`)) return
    trashIt('worlds', world.name, world)
    update((b) => ({ ...b, worlds: b.worlds.filter((w) => w.id !== world.id) }))
  }

  if (!world) {
    return (
      <div className="page">
        <h1>Globe</h1>
        <p className="muted">Generate a planet: continents, oceans, mountain belts from plate tectonics, climate and biomes, all from a seed. You can reroll it or tune it, then zoom from orbit down to the ground.</p>
        <button style={{ alignSelf: 'flex-start' }} onClick={create}><Icon name="globe" /> Generate a world</button>
      </div>
    )
  }

  const p = { ...DEFAULT_PARAMS, ...world.params }
  return (
    <div className="globe-page">
      <canvas ref={canvas} tabIndex={0} aria-label={`Globe of ${world.name}. Drag to pan, scroll or plus and minus to zoom, right-drag to tilt and turn, arrow keys to move.`} />
      <div className={`globe-panel glass ${panel ? '' : 'closed'}`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong><Icon name="globe" /> Globe</strong>
          <button className="ghost icon" onClick={() => setPanel(!panel)} aria-label={panel ? 'Hide world settings' : 'Show world settings'} aria-expanded={panel}>
            <Icon name={panel ? 'left' : 'right'} />
          </button>
        </div>
        {panel && <>
          <div className="row">
            <select value={world.id} onChange={(e) => setSel(e.target.value)} aria-label="World" style={{ flex: 1 }}>
              {book.worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button className="alt icon" onClick={create} title="New world" aria-label="New world"><Icon name="plus" /></button>
          </div>
          <label className="globe-field">Name<input value={world.name} onChange={(e) => patch({ name: e.target.value })} /></label>
          <div className="globe-field">
            Seed
            <div className="row">
              <input value={world.seed} onChange={(e) => patch({ seed: e.target.value })} aria-label="Seed" style={{ flex: 1 }} />
              <button className="alt" onClick={() => patch({ seed: newSeed() })} title="Generate a different planet">Reroll</button>
            </div>
          </div>
          {SLIDERS.map(([k, label, min, max, step, fmt]) => (
            <label key={k} className="globe-slider">
              <span>{label}</span><output>{fmt(p[k])}</output>
              <input type="range" min={min} max={max} step={step} value={p[k]} onChange={(e) => setParam(k, Number(e.target.value))} />
            </label>
          ))}
          <label className="globe-slider">
            <span>Relief (view only)</span><output>{relief.toFixed(1)}x</output>
            <input type="range" min={0} max={3} step={0.1} value={relief} onChange={(e) => setRelief(Number(e.target.value))} />
          </label>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="alt" onClick={() => patch({ params: { ...DEFAULT_PARAMS } })}>Reset sliders</button>
            <button className="ghost danger" onClick={remove}>Delete world</button>
          </div>
        </>}
      </div>
      <div className="globe-zoom">
        <button className="glass icon" onClick={() => globe.current?.zoomBy(0.6)} aria-label="Zoom in"><Icon name="plus" /></button>
        <button className="glass icon" onClick={() => globe.current?.zoomBy(1 / 0.6)} aria-label="Zoom out"><span aria-hidden style={{ fontSize: '1.2rem', lineHeight: 1 }}>−</span></button>
      </div>
      <div className="globe-readout glass" aria-live="off">
        {hover
          ? <>{fmtLat(hover.lat)} {fmtLon(hover.lon)} · {hover.elevation >= 0 ? `${Math.round(hover.elevation).toLocaleString()} m` : `${Math.round(-hover.elevation).toLocaleString()} m deep`} · {hover.biome}</>
          : <span className="muted">Drag to pan · scroll to zoom · right-drag to tilt</span>}
        <span className="muted"> · alt {alt}</span>
      </div>
    </div>
  )
}
