import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Icon from '../Icon'
import { trashIt } from '../history'
import { calendarOf, uid, useBook } from '../store'
import { fmt, fromOrdinal } from '../calendar'
import { dayOf } from '../timelineScale'
import { arc, legs as routeLegs, partyAt, type Stop } from './story'
import { Globe, lightMode, type Hover } from './globe'
import { brief, fmtLL, validate } from './describe'
import { distKm } from './geo'
import { activeAt, findFeature, LAYER_KINDS, layerColor, refKey, stats, type FeatureRef, type Layer, type LayerKind } from './layers'
import { OP_SPECS, opCenter, type Op } from './ops'
import { DEFAULT_PARAMS, groundSpec, makePlanet, type Planet, type World, type WorldParams } from './terrain'
import { makeProj, paintFlat, PROJECTIONS, sampleFlat, type MapStyle, type Proj, type ProjName, type Samples } from './flat'
import { drawOverlays } from './flatDraw'

const SLIDERS: [keyof WorldParams, string, number, number, number, (v: number) => string][] = [
  ['oceanPct', 'Ocean', 5, 95, 1, (v) => `${v}%`],
  ['plates', 'Tectonic plates', 4, 40, 1, (v) => `${v}`],
  ['ruggedness', 'Ruggedness', 0.2, 2, 0.05, (v) => `${v.toFixed(2)}x`],
  ['aridity', 'Aridity', 0, 1, 0.05, (v) => (v < 0.35 ? 'Wet' : v > 0.65 ? 'Dry' : 'Earth-like')],
  ['tilt', 'Axial tilt', 0, 60, 1, (v) => `${v}°`],
  ['radiusKm', 'Radius', 1000, 15000, 100, (v) => `${v.toLocaleString()} km`],
]

const STORY = 'story' // id of the derived layer of placed wiki entries
const DERIVED = new Set([STORY, 'route', 'party', 'measure']) // layers built on the fly from the story; never saved
const newSeed = () => Math.random().toString(36).slice(2, 8)
const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`
const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`
const fmtAlt = (km: number) => (km >= 100 ? `${Math.round(km).toLocaleString()} km` : km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`)

export default function WorldPage() {
  const { book, update } = useBook()
  const [sel, setSel] = useState(() => { try { return new URLSearchParams(location.hash.split('?')[1]).get('w') ?? localStorage.getItem('world-sel') ?? '' } catch { return '' } })
  const world = book.worlds.find((w) => w.id === sel) ?? book.worlds[0]
  const canvas = useRef<HTMLCanvasElement>(null)
  const globe = useRef<Globe>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [alt, setAlt] = useState('')
  const [relief, setRelief] = useState(1)
  const [panel, setPanel] = useState(() => innerWidth > 700)
  const [params] = useSearchParams()
  const nav = useNavigate()
  const pick = params.get('pick') // wiki entry waiting to be placed by a click on the globe
  const pickRef = useRef(pick)
  pickRef.current = pick
  const [showStory, setShowStory] = useState(true)
  const [route, setRoute] = useState(false)
  const [kmPerDay, setKmPerDay] = useState(30)
  const [timeOn, setTimeOn] = useState(false)
  const [day, setDay] = useState<number>()
  const [measure, setMeasure] = useState<[number, number][] | undefined>() // points while the ruler is active
  const measureRef = useRef(measure)
  measureRef.current = measure
  const [view, setView] = useState<'globe' | 'map'>('globe')
  const [proj, setProj] = useState<ProjName>('robinson')
  const [style, setStyle] = useState<MapStyle>('atlas')
  const [contour, setContour] = useState(0)
  const [labels, setLabels] = useState(true)
  const [busy, setBusy] = useState(false)
  const flat = useRef<HTMLCanvasElement>(null)
  const flatCache = useRef<{ key: string; planet: Planet; p: Proj; s: Samples }>(null)
  const placeEntry = useRef<(id: string, at: [number, number]) => void>(() => {})
  // Derived, read-only layers: wiki places, the party's route, the party on the scrubbed day, the ruler.
  const cal = calendarOf(book)
  const radius = { ...DEFAULT_PARAMS, ...world?.params }.radiusKm
  const stops = useMemo<Stop[]>(() => book.events.flatMap((e) => {
    const at = e.kind === 'party' && e.locationId ? book.wiki.find((w) => w.id === e.locationId)?.place : undefined
    return at && at.worldId === world?.id ? [{ id: e.id, title: e.title, at: [at.lat, at.lon] as [number, number], day: dayOf(cal, e.date) }] : []
  }).sort((x, y) => x.day - y.day), [book.events, book.wiki, world?.id, cal])
  const legList = useMemo(() => routeLegs(stops, radius, kmPerDay), [stops, radius, kmPerDay])
  const range = useMemo<[number, number] | undefined>(() => {
    const days = [...book.events.map((e) => dayOf(cal, e.date)), ...(world?.layers ?? []).flatMap((l) => l.items.flatMap((it) => [it.from, it.to].flatMap((t) => (t ? [dayOf(cal, t)] : []))))]
    return days.length ? [Math.min(...days), Math.max(...days)] : undefined
  }, [book.events, world?.layers, cal])
  const now = timeOn && range ? Math.min(range[1], Math.max(range[0], day ?? range[0])) : undefined
  const gworld = useMemo(() => {
    if (!world) return undefined
    const placed = book.wiki.filter((w) => w.place?.worldId === world.id).map((w) => ({ id: w.id, name: w.name, at: [w.place!.lat, w.place!.lon] as [number, number], wikiId: w.id, props: { type: w.type } }))
    const derived: Layer[] = []
    if (placed.length) derived.push({ id: STORY, name: 'Story places', kind: 'custom', color: '#ff6b9d', hidden: !showStory, items: placed })
    if (route && legList.length) derived.push({ id: 'route', name: 'Party route', kind: 'roads', color: '#ff9f1c', items: legList.map((l) => ({ id: `${l.from.id}>${l.to.id}`, name: `${l.from.title} → ${l.to.title}`, path: arc(l.from.at, l.to.at), props: { km: Math.round(l.km), days: Math.round(l.travelDays) } })) })
    const here = now !== undefined ? partyAt(stops, now) : undefined
    if (here) derived.push({ id: 'party', name: 'The party', kind: 'cities', color: '#00e5ff', items: [{ id: 'party', name: 'The party', at: here, props: { type: 'capital' } }] })
    if (measure?.length) derived.push({ id: 'measure', name: 'Measure', kind: 'custom', color: '#ffffff', items: [
      ...measure.slice(1).map((q, i) => ({ id: `m${i}`, path: arc(measure[i], q) })), ...measure.map((q, i) => ({ id: `p${i}`, at: q })),
    ] })
    const layers = [...activeAt(world.layers ?? [], now, cal), ...derived]
    return layers.length ? { ...world, layers } : world
  }, [world, book.wiki, showStory, route, legList, stops, now, measure, cal])
  const measureKm = (measure ?? []).slice(1).reduce((s, q, i) => s + distKm(measure![i], q, radius), 0)
  const lat = params.get('lat'), lon = params.get('lon')
  useEffect(() => {
    if (lat == null || lon == null) return
    const t = setTimeout(() => globe.current?.flyTo(Number(lat), Number(lon), 0.15), 400)
    return () => clearTimeout(t)
  }, [lat, lon])
  const [popup, setPopup] = useState<{ ref: FeatureRef; x: number; y: number } | undefined>()

  useEffect(() => { try { if (world) localStorage.setItem('world-sel', world.id) } catch { /* private mode */ } }, [world])
  const hasWorld = !!world
  useEffect(() => {
    if (!hasWorld || !canvas.current) return
    const g = new Globe(canvas.current)
    g.onHover = setHover
    g.onClick = (f, x, y, at) => {
      if (measureRef.current && at) { setMeasure((m) => [...(m ?? []), at]); return }
      const id = pickRef.current
      if (id && at) { // placing a wiki entry: this click is its position
        placeEntry.current(id, at)
        return
      }
      const r = canvas.current!.getBoundingClientRect()
      setPopup(f && { ref: f.ref, x: x - r.left, y: y - r.top })
    }
    g.onView = (v) => setAlt(fmtAlt(v.altitudeKm)) // same string = no re-render
    globe.current = g
    return () => { g.dispose(); globe.current = null }
  }, [hasWorld])
  // regenerate shortly after slider drags settle
  useEffect(() => {
    if (!world) return
    const t = setTimeout(() => {
      globe.current?.setWorld(gworld!)
      if (import.meta.env.DEV) Object.assign(window, { globe: globe.current }) // for poking at it from devtools
    }, 150)
    return () => clearTimeout(t)
  }, [gworld])
  useEffect(() => globe.current?.setRelief(relief), [relief])
  // flat map: sampling is slow so it's cached per terrain + projection; style, contours and labels just repaint
  useEffect(() => {
    if (view !== 'map' || !world || !flat.current) return
    setBusy(true)
    const t = setTimeout(() => {
      const key = `${proj}|${groundSpec(world)}`
      let c = flatCache.current
      if (c?.key !== key) { const planet = makePlanet(world), p = makeProj(proj, lightMode() ? 900 : 1400); c = { key, planet, p, s: sampleFlat(planet, p) }; flatCache.current = c }
      const cv = flat.current!, ctx = cv.getContext('2d')!
      cv.width = c.p.w; cv.height = c.p.h
      const img = ctx.createImageData(c.p.w, c.p.h)
      paintFlat(c.planet, c.p, c.s, { style, contour }, img.data)
      ctx.putImageData(img, 0, 0)
      drawOverlays(ctx, c.planet, world, c.p, style, labels)
      setBusy(false)
    }, 30)
    return () => clearTimeout(t)
  }, [view, world, proj, style, contour, labels])
  const exportPng = () => flat.current?.toBlob((b) => {
    if (!b) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(b); a.download = `${slug}.${proj}.png`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })

  const create = () => {
    const w: World = { id: uid(), name: `World ${book.worlds.length + 1}`, generatorVersion: 1, seed: newSeed(), params: { ...DEFAULT_PARAMS } }
    update((b) => ({ ...b, worlds: [...b.worlds, w] }))
    setSel(w.id)
  }
  const patch = (p: Partial<World>) => update((b) => ({ ...b, worlds: b.worlds.map((w) => (w.id === world!.id ? { ...w, ...p } : w)) }))
  const setParam = (k: keyof WorldParams, v: number) => patch({ params: { ...DEFAULT_PARAMS, ...world!.params, [k]: v } })
  placeEntry.current = (id, at) => {
    update((b) => ({ ...b, wiki: b.wiki.map((w) => (w.id === id ? { ...w, place: { worldId: world!.id, lat: +at[0].toFixed(3), lon: +at[1].toFixed(3) } } : w)) }))
    nav(`/wiki/${id}`)
  }
  const [msg, setMsg] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const setOps = (f: (ops: Op[]) => Op[]) => patch({ ops: f(world!.ops ?? []) })
  const setLayers = (f: (ls: Layer[]) => Layer[]) => patch({ layers: f(world!.layers ?? []) })
  const patchLayer = (id: string, p: Partial<Layer>) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)))
  const addLayer = (kind: LayerKind) => setLayers((ls) => [...ls, { id: uid(), name: LAYER_KINDS[kind].label, kind, items: [] }])
  // name / note / wikiId edits on an op or a layer item, plus wiki page creation in the same update
  const patchFeature = (ref: FeatureRef, p: { name?: string; note?: string; wikiId?: string }, entry?: { id: string; type: string; name: string; place?: { worldId: string; lat: number; lon: number } }) => !('opId' in ref) && DERIVED.has(ref.layerId) ? undefined : update((b) => ({
    ...b,
    wiki: entry ? [...b.wiki, { ...entry, fields: {}, notes: p.note ?? '' }] : b.wiki,
    worlds: b.worlds.map((w) => w.id !== world!.id ? w : 'opId' in ref
      ? { ...w, ops: (w.ops ?? []).map((o) => (o.id === ref.opId ? { ...o, ...p } : o)) }
      : { ...w, layers: (w.layers ?? []).map((l) => (l.id !== ref.layerId ? l : { ...l, items: l.items.map((it) => (it.id === ref.itemId ? { ...it, ...p } : it)) })) }),
  }))
  // rough size of a feature, to pick a sensible zoom when flying to it
  const sizeKm = (op: Op) => {
    if ('radius' in op) return op.radius * 2
    const pts = 'path' in op ? op.path : op.area
    return Math.max(50, ...pts.map((q) => distKm(q, opCenter(op), p.radiusKm) * 2))
  }
  const flyToOp = (op: Op) => { const [lat, lon] = opCenter(op); globe.current?.flyTo(lat, lon, Math.min(1.2, Math.max(0.01, sizeKm(op) * 2.2 / p.radiusKm))) }
  const slug = (world?.name ?? '').replace(/[^\w-]+/g, '-').toLowerCase() || 'world'
  const download = (name: string, text: string, type: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type }))
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const copyBrief = async () => {
    const text = brief(world!)
    try { await navigator.clipboard.writeText(text); setMsg('Brief copied. Paste it to Claude with what you want changed.') }
    catch { download(`${slug}.brief.md`, text, 'text/markdown'); setMsg(`Clipboard unavailable, so the brief was downloaded as ${slug}.brief.md.`) }
  }
  const exportJson = () => download(`${slug}.world.json`, JSON.stringify(world, null, 2), 'application/json')
  const importJson = async (f?: File) => {
    if (!f) return
    try {
      const j = JSON.parse(await f.text())
      const w: World = j.worlds ? j.worlds[0] : j
      const { errors, warnings } = validate(w)
      if (errors.length) { setMsg(`Not imported: ${errors.slice(0, 3).join('; ')}`); return }
      const exists = book.worlds.some((x) => x.id === w.id)
      update((b) => ({ ...b, worlds: exists ? b.worlds.map((x) => (x.id === w.id ? w : x)) : [...b.worlds, w] }))
      setSel(w.id)
      setMsg(`${exists ? 'Updated' : 'Added'} "${w.name}" (${w.ops?.length ?? 0} features)${warnings.length ? `. ${warnings.length} warning(s): ${warnings[0]}` : ''}`)
    } catch (e) { setMsg(`Not imported: ${(e as Error).message}`) }
    finally { if (file.current) file.current.value = '' }
  }

  const remove = () => {
    if (!world || !confirm(`Delete "${world.name}"? It goes to Trash.`)) return
    trashIt('worlds', world.name, world)
    update((b) => ({ ...b, worlds: b.worlds.filter((w) => w.id !== world.id) }))
  }

  const p = { ...DEFAULT_PARAMS, ...world?.params }
  if (!world) {
    return (
      <div className="page">
        <h1>Globe</h1>
        <p className="muted">Generate a planet: continents, oceans, mountain belts from plate tectonics, climate and biomes, all from a seed. You can reroll it or tune it, then zoom from orbit down to the ground.</p>
        <button style={{ alignSelf: 'flex-start' }} onClick={create}><Icon name="globe" /> Generate a world</button>
      </div>
    )
  }

  const ops = world.ops ?? [], layers = world.layers ?? []
  const placed = gworld?.layers?.find((l) => l.id === STORY)?.items.length ?? 0
  const pf = popup && gworld && findFeature(gworld, popup.ref)
  const readonly = !!pf && 'layerId' in pf.ref && DERIVED.has(pf.ref.layerId)
  const here = pf?.wikiId ? { events: book.events.filter((e) => e.locationId === pf.wikiId), scenes: book.scenes.filter((s) => s.location === pf.wikiId) } : undefined
  const linked = pf?.wikiId ? book.wiki.find((w) => w.id === pf.wikiId) : undefined
  return (
    <div className="globe-page">
      <canvas ref={flat} className="flatmap" style={{ display: view === 'map' ? 'block' : 'none' }} role="img" aria-label={`Flat map of ${world.name}`} />
      <canvas ref={canvas} style={{ display: view === 'map' ? 'none' : 'block' }} tabIndex={0} aria-label={`Globe of ${world.name}. Drag to pan, scroll or plus and minus to zoom, right-drag to tilt and turn, arrow keys to move.`} />
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
          <div className="row" role="group" aria-label="View">
            {(['globe', 'map'] as const).map((v) => <button key={v} className={view === v ? '' : 'alt'} aria-pressed={view === v} style={{ flex: 1 }} onClick={() => setView(v)}>{v === 'globe' ? 'Globe' : 'Flat map'}</button>)}
          </div>
          {view === 'map' && <div className="globe-sec" style={{ borderTop: 0, paddingTop: 0 }}>
            <label className="globe-field">Projection<select value={proj} onChange={(e) => setProj(e.target.value as ProjName)}>
              {Object.entries(PROJECTIONS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label className="globe-field">Style<select value={style} onChange={(e) => setStyle(e.target.value as MapStyle)}>
              <option value="atlas">Atlas (parchment)</option><option value="terrain">Terrain colours</option></select></label>
            <label className="globe-field">Contour lines<select value={contour} onChange={(e) => setContour(Number(e.target.value))}>
              <option value={0}>Off</option><option value={250}>Every 250 m</option><option value={500}>Every 500 m</option><option value={1000}>Every 1000 m</option></select></label>
            <label className="small" style={{ display: "flex", gap: ".4rem", alignItems: "center" }}><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Names on the map</label>
            <button className="alt" onClick={exportPng} disabled={busy}>{busy ? 'Rendering…' : 'Export PNG'}</button>
          </div>}
          <label className="globe-field">Name<input value={world.name} onChange={(e) => patch({ name: e.target.value })} /></label>
          <details className="globe-sec" open>
          <summary>Terrain</summary>
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
          <button className="alt" style={{ alignSelf: 'flex-start' }} onClick={() => patch({ params: { ...DEFAULT_PARAMS } })}>Reset sliders</button>
          </details>
          <details className="globe-sec" open={ops.length > 0}>
            <summary>Features <span className="muted">{ops.length}</span></summary>
            {!ops.length && <p className="muted small">Mountain ranges, rivers, lakes, volcanoes, islands and more. Ask Claude to add them (see below).</p>}
            <ul className="globe-ops">
              {ops.map((op) => (
                <li key={op.id}>
                  <input value={op.name ?? ''} placeholder={OP_SPECS[op.kind]?.label ?? op.kind} aria-label={`Name of ${OP_SPECS[op.kind]?.label ?? op.kind}`}
                    onChange={(e) => setOps((o) => o.map((x) => (x.id === op.id ? { ...x, name: e.target.value } : x)))} />
                  <small className="muted">{OP_SPECS[op.kind]?.label ?? op.kind}</small>
                  <button className="ghost icon" title="Fly to" aria-label={`Fly to ${op.name ?? op.kind}`} onClick={() => flyToOp(op)}><Icon name="focus" size={15} /></button>
                  <button className="ghost icon" title="Remove" aria-label={`Remove ${op.name ?? op.kind}`}
                    onClick={() => confirm(`Remove ${op.name ?? op.kind}? The land goes back to how it was generated.`) && setOps((o) => o.filter((x) => x.id !== op.id))}><Icon name="trash" size={15} /></button>
                </li>
              ))}
            </ul>
          </details>
          <details className="globe-sec" open={route || timeOn}>
            <summary>Story <span className="muted">{stops.length} stops</span></summary>
            <label className="small" style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={route} disabled={!legList.length} onChange={(e) => setRoute(e.target.checked)} /> Party route
            </label>
            {!legList.length && <p className="muted small">Set a location (placed on the globe) on party events in the timeline to draw the route.</p>}
            <label className="globe-slider">
              <span>Travel speed</span><output>{kmPerDay} km/day</output>
              <input type="range" min={5} max={200} step={5} value={kmPerDay} onChange={(e) => setKmPerDay(Number(e.target.value))} />
            </label>
            {route && <ul className="small muted" style={{ margin: 0, paddingLeft: '1rem' }}>
              {legList.map((l) => <li key={`${l.from.id}>${l.to.id}`} style={l.tight ? { color: 'var(--danger, #e07a5f)' } : undefined}>
                {l.from.title} → {l.to.title}: {Math.round(l.km).toLocaleString()} km, {Math.max(1, Math.round(l.travelDays))} days ({l.gapDays} in the story){l.tight ? ' – too fast?' : ''}
              </li>)}
            </ul>}
            {range && <>
              <label className="small" style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                <input type="checkbox" checked={timeOn} onChange={(e) => setTimeOn(e.target.checked)} /> Time slider
              </label>
              {timeOn && now !== undefined && <label className="globe-slider">
                <span>{fmt(cal, fromOrdinal(cal, now))}</span><output>{partyAt(stops, now) ? 'party shown' : ''}</output>
                <input type="range" min={range[0]} max={range[1]} step={1} value={now} aria-label="Date" onChange={(e) => setDay(Number(e.target.value))} />
              </label>}
            </>}
          </details>
          <details className="globe-sec" open={layers.length > 0}>
            <summary>Layers <span className="muted">{layers.length}</span></summary>
            {!layers.length && <p className="muted small">Cities, regions, borders, religions, roads. Ask Claude to fill them in, or add an empty one.</p>}
            <ul className="globe-ops">
              {layers.map((l) => (
                <li key={l.id} className="globe-layer">
                  <button className="ghost icon" aria-pressed={!l.hidden} title={l.hidden ? 'Show' : 'Hide'} aria-label={`${l.hidden ? 'Show' : 'Hide'} ${l.name}`}
                    onClick={() => patchLayer(l.id, { hidden: !l.hidden })}><Icon name={l.hidden ? 'eyeOff' : 'eye'} size={15} /></button>
                  <input value={l.name} aria-label="Layer name" onChange={(e) => patchLayer(l.id, { name: e.target.value })} />
                  <small className="muted">{l.items.length}</small>
                  <input type="color" value={layerColor(l)} aria-label={`Colour of ${l.name}`} onChange={(e) => patchLayer(l.id, { color: e.target.value })} />
                  <input type="range" min={0.1} max={1} step={0.05} value={l.opacity ?? 1} aria-label={`Opacity of ${l.name}`} onChange={(e) => patchLayer(l.id, { opacity: Number(e.target.value) })} />
                  <button className="ghost icon" title="Remove layer" aria-label={`Remove ${l.name}`}
                    onClick={() => confirm(`Remove the layer "${l.name}" and its ${l.items.length} item(s)?`) && setLayers((ls) => ls.filter((x) => x.id !== l.id))}><Icon name="trash" size={15} /></button>
                </li>
              ))}
            </ul>
            {placed > 0 && <label className="small" style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={showStory} onChange={(e) => setShowStory(e.target.checked)} /> Story places ({placed} wiki entries)
            </label>}
            <select value="" aria-label="Add layer" onChange={(e) => e.target.value && addLayer(e.target.value as LayerKind)}>
              <option value="">Add layer…</option>
              {Object.entries(LAYER_KINDS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </details>
          <details className="globe-sec">
            <summary>Edit with Claude</summary>
            <p className="muted small">Copy the brief and paste it to Claude with what you want ("add a desert south of the Spine"). It returns updated JSON to import, or edits <code>worlds/{world.id}.json</code> in your data repo directly if sync is on.</p>
            <div className="row">
              <button className="alt" onClick={copyBrief}>Copy AI brief</button>
              <button className="alt" onClick={exportJson}>Export JSON</button>
              <button className="alt" onClick={() => file.current?.click()}>Import JSON</button>
              <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
            </div>
          </details>
          {msg && <p className="small" role="status">{msg}</p>}
          <button className="ghost danger" style={{ alignSelf: 'flex-start' }} onClick={remove}>Delete world</button>
        </>}
      </div>
      {measure && view === 'globe' && (
        <div className="globe-banner glass" role="status">
          {measure.length < 2 ? 'Click points on the globe to measure' : <>{Math.round(measureKm).toLocaleString()} km · {Math.round(measureKm / kmPerDay)} days at {kmPerDay} km/day</>}
          <button className="alt" onClick={() => setMeasure((m) => m?.slice(0, -1))} disabled={!measure.length}>Undo</button>
          <button className="alt" onClick={() => setMeasure(undefined)}>Done</button>
        </div>
      )}
      {pick && !measure && view === 'globe' && (
        <div className="globe-banner glass" role="status">
          Click the globe to place “{book.wiki.find((w) => w.id === pick)?.name ?? 'entry'}”
          <button className="alt" onClick={() => nav(`/wiki/${pick}`)}>Cancel</button>
        </div>
      )}
      {pf && popup && view === 'globe' && (
        <div className="globe-popup glass" role="dialog" aria-label={pf.name || pf.type} key={refKey(pf.ref)}
          style={{ left: Math.min(popup.x + 12, innerWidth - 300), top: Math.min(popup.y + 12, innerHeight - 320) }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <small className="muted">{pf.type}</small>
            <button className="ghost icon" onClick={() => setPopup(undefined)} aria-label="Close"><Icon name="x" size={15} /></button>
          </div>
          <input value={pf.name ?? ''} placeholder="Name" aria-label="Name" readOnly={readonly} onChange={(e) => patchFeature(pf.ref, { name: e.target.value })} />
          <ul className="small muted">
            <li>{pf.at ? 'At' : 'Around'} {fmtLL(pf.at ?? (pf.path ?? pf.area)![Math.floor((pf.path ?? pf.area)!.length / 2)])}</li>
            {stats(pf, p.radiusKm).map((s) => <li key={s}>{s}</li>)}
          </ul>
          {!readonly && <textarea value={pf.note ?? ''} placeholder="Note" aria-label="Note" rows={3} onChange={(e) => patchFeature(pf.ref, { note: e.target.value })} />}
          {!!(here?.events.length || here?.scenes.length) && <div className="row" style={{ flexWrap: 'wrap' }}>
            {here!.events.map((e) => <Link key={e.id} to={`/timeline?e=${e.id}`} className="chip">{e.title}</Link>)}
            {here!.scenes.map((s) => <Link key={s.id} to={`/scenes?s=${s.id}`} className="chip">{s.title}</Link>)}
          </div>}
          <div className="row">
            {readonly ? (linked && <Link to={`/wiki/${linked.id}`} className="chip">Open “{linked.name}”</Link>) : linked
              ? <Link to={`/wiki/${linked.id}`} className="chip">Open “{linked.name}”</Link>
              : <button className="alt" disabled={!pf.name} title={pf.name ? '' : 'Name it first'} onClick={() => {
                  const id = uid()
                  const [la, lo] = pf.at ?? opCenter(pf.op ?? { id: '', kind: 'raise', at: pf.path?.[0] ?? pf.area![0], radius: 1, amount: 0 })
                  patchFeature(pf.ref, { wikiId: id }, { id, type: pf.layer?.kind === 'religions' ? 'religion' : 'location', name: pf.name!, place: { worldId: world.id, lat: la, lon: lo } })
                }}>Create wiki page</button>}
            {!readonly && <select value={pf.wikiId ?? ''} aria-label="Linked wiki entry" style={{ flex: 1, minWidth: 0 }} onChange={(e) => patchFeature(pf.ref, { wikiId: e.target.value || undefined })}>
              <option value="">{linked ? 'Unlink' : 'Link to entry…'}</option>
              {book.wiki.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>}
          </div>
        </div>
      )}
      <div className="globe-zoom" hidden={view === 'map'}>
        <button className="glass icon" aria-pressed={!!measure} onClick={() => setMeasure(measure ? undefined : [])} aria-label="Measure distance" title="Measure distance"><Icon name="ruler" /></button>
        <button className="glass icon" onClick={() => globe.current?.zoomBy(0.6)} aria-label="Zoom in"><Icon name="plus" /></button>
        <button className="glass icon" onClick={() => globe.current?.zoomBy(1 / 0.6)} aria-label="Zoom out"><span aria-hidden style={{ fontSize: '1.2rem', lineHeight: 1 }}>−</span></button>
      </div>
      <div className="globe-readout glass" aria-live="off" hidden={view === 'map'}>
        {hover
          ? <>{hover.feature && <strong>{hover.feature.name || hover.feature.type} · </strong>}{fmtLat(hover.lat)} {fmtLon(hover.lon)} · {hover.elevation >= 0 ? `${Math.round(hover.elevation).toLocaleString()} m` : `${Math.round(-hover.elevation).toLocaleString()} m deep`} · {hover.biome}</>
          : <span className="muted">Drag to pan · scroll to zoom · right-drag to tilt</span>}
        <span className="muted"> · alt {alt}</span>
      </div>
    </div>
  )
}
