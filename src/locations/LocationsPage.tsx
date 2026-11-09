import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import Icon from '../Icon'
import { useBook } from '../store'
import { brief, BUILD_VERSION, MOOD_NAMES, SEASONS, validate, WEATHERS, type CityBuilt, type LocationDoc, type MoodName, type Season, type View, type Weather } from './city'
import { LocScene, MOODS, STYLES, type Stats, type StyleName } from './scene'
import { useLocal } from '../ui'
import exampleRaw from '../../examples/showcase.json?raw'
import activeRaw from '../../examples/active-lands.json?raw'
import cliffRaw from '../../examples/cliff-test.json?raw'

/** Bundled demos: shown beside the book's own locations, saved into the book only if you change one (a view, an import). */
const DEMOS: LocationDoc[] = [JSON.parse(exampleRaw), JSON.parse(activeRaw), JSON.parse(cliffRaw)]
/** What the terrain and buildings depend on: names, notes, views and mood never trigger a rebuild. */
const specOf = (d: LocationDoc) => JSON.stringify(d, (k, v) => (['name', 'note', 'views', 'mood', 'hour', 'weather', 'season'].includes(k) ? undefined : v))
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`

// Locations: city-scale 3D places built from recipes that Claude writes. Fly over them; save views; hand the JSON to Claude.
export default function LocationsPage() {
  const { book, update } = useBook()
  const [params, setParams] = useSearchParams()
  const docs = [...book.locations, ...DEMOS.filter((d) => !book.locations.some((l) => l.id === d.id))]
  const doc = docs.find((d) => d.id === params.get('l')) ?? docs[0]
  const canvas = useRef<HTMLCanvasElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const scene = useRef<LocScene>(null)
  const shownSpec = useRef('')
  const [mood, setMood] = useState<MoodName | ''>(doc.mood ?? 'morning')
  const [hour, setHour] = useState(doc.hour ?? MOODS[doc.mood ?? 'morning'].hour)
  const [weather, setWeather] = useState<Weather>(doc.weather ?? MOODS[doc.mood ?? 'morning'].weather)
  const [season, setSeason] = useState<Season>(doc.season ?? 'summer')
  const [mist, setMist] = useState(MOODS[doc.mood ?? 'morning'].mist)
  const [playing, setPlaying] = useState(false)
  const [style, setStyle] = useLocal<StyleName>('loc-look', 'real')
  const [stats, setStats] = useState<Stats>()
  const [msg, setMsg] = useState('Building…')
  const [busy, setBusy] = useState(true)
  const [tour, setTour] = useState(-1)
  // the ground: as the recipe says, or forced to the volume prototype or the height grid (to compare the two; per device)
  const [ground, setGround] = useLocal<'recipe' | 'volume' | 'grid'>('loc-ground', 'recipe')
  const run = useMemo(() => (ground === 'recipe' ? doc : { ...doc, volume: ground === 'volume' }), [doc, ground])
  const spec = useMemo(() => specOf(run), [run])

  const save = (d: LocationDoc) => update((b) => ({ ...b, locations: b.locations.some((x) => x.id === d.id) ? b.locations.map((x) => (x.id === d.id ? d : x)) : [...b.locations, d] }))

  useEffect(() => {
    const s = new LocScene(canvas.current!)
    scene.current = s
    if (import.meta.env.DEV) (window as unknown as { locScene: LocScene }).locScene = s
    s.onStats = setStats
    s.onHour = setHour
    const ro = new ResizeObserver(() => s.resize())
    ro.observe(canvas.current!)
    return () => { ro.disconnect(); s.dispose(); scene.current = null }
  }, [])
  useEffect(() => {
    setBusy(true); setMsg('Building…')
    let w: Worker | null = null, live = true
    const sameDoc = shownSpec.current.startsWith(doc.id + '|'), key = `loc-build:${BUILD_VERSION}:${doc.id}${run.volume === false ? ':grid' : ''}`
    const show = (b: CityBuilt, cached: boolean) => {
      if (!live) return
      const s = scene.current
      s?.setBuilt(b, sameDoc, doc.snowline)
      const v = params.get('view'), view = doc.views?.find((x) => x.name === v) ?? doc.views?.[0] // open on the first saved view
      if (view && !sameDoc) s?.goto(view, false)
      shownSpec.current = doc.id + '|' + spec
      setMsg(`${b.counts.buildings.toLocaleString()} buildings · ${b.counts.structures} structures · ${b.counts.roads.toLocaleString()} streets · ${b.counts.trees.toLocaleString()} trees · ${(b.size / 1000).toFixed(0)} km · ${cached ? 'from the last build' : `built in ${(b.ms / 1000).toFixed(1)} s`}`)
      setBusy(false)
    }
    // the last build of this location is kept in the browser, so opening it again is instant
    idbGet(key).then((c: { spec: string; built: CityBuilt } | undefined) => {
      if (!live) return
      if (c?.spec === spec) { show(c.built, true); return }
      w = new Worker(new URL('./city.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<{ built?: CityBuilt; error?: string; stage?: string }>) => {
        if (e.data.stage) { setMsg(`${e.data.stage}…`); return }
        w?.terminate()
        if (e.data.error || !e.data.built) { setMsg(`Build failed: ${e.data.error}`); setBusy(false); return }
        show(e.data.built, false)
        idbSet(key, { spec, built: e.data.built }).catch(() => {})
      }
      w.postMessage({ doc: run, job: 1 })
    }).catch(() => setMsg('Could not read the saved build'))
    return () => { live = false; w?.terminate() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, doc.id])
  useEffect(() => { const m = MOODS[doc.mood ?? 'morning']; setMood(doc.mood ?? 'morning'); setHour(doc.hour ?? m.hour); setWeather(doc.weather ?? m.weather); setMist(m.mist); setSeason(doc.season ?? 'summer') }, [doc.id, doc.mood, doc.hour, doc.weather, doc.season])
  useEffect(() => { if (!playing) scene.current?.setAtmos({ hour }) }, [hour, playing])
  useEffect(() => scene.current?.setAtmos({ weather, season, mist }), [weather, season, mist])
  useEffect(() => { if (scene.current) scene.current.playing = playing ? 0.4 : 0 }, [playing])
  useEffect(() => scene.current?.setStyle(STYLES[style] ? style : 'real'), [style])
  // tour: glide through the saved views in order, showing each one's note
  useEffect(() => {
    const views = doc.views ?? []
    if (tour < 0 || !views.length) return
    if (tour >= views.length) { setTour(-1); return }
    showView(views[tour])
    const t = setTimeout(() => setTour((k) => (k < 0 ? k : k + 1)), 9000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showView is new each render; only a new stop should move on
  }, [tour, doc.views])
  // a view brings its own hour, weather and season; anything it leaves out goes back to the location's mood
  function showView(v: View) {
    const m = MOODS[doc.mood ?? 'morning']
    scene.current?.goto(v)
    setPlaying(false); setMood(v.hour == null && !v.weather ? (doc.mood ?? 'morning') : '')
    setHour(v.hour ?? doc.hour ?? m.hour); setWeather(v.weather ?? doc.weather ?? m.weather); setSeason(v.season ?? doc.season ?? 'summer'); setMist(m.mist)
  }
  const pickMood = (m: MoodName) => { const p = MOODS[m]; setMood(m); setPlaying(false); setHour(p.hour); setWeather(p.weather); setMist(p.mist) }

  const saveView = () => {
    const name = prompt('Name this view')?.trim()
    if (!name || !scene.current) return
    const v = scene.current.view(name)
    save({ ...doc, views: [...(doc.views ?? []).filter((x) => x.name !== name), v] })
  }
  const importJson = async (f: File) => {
    try {
      const d = JSON.parse(await f.text()) as LocationDoc, v = validate(d)
      if (v.errors.length) { alert(`Not imported:\n${v.errors.join('\n')}`); return }
      save(d); setParams({ l: d.id })
    } catch (e) { alert(`Not imported: ${e}`) }
  }
  const exportJson = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
    a.download = `${doc.id}.json`; a.click(); URL.revokeObjectURL(a.href)
  }
  const forClaude = async () => {
    await navigator.clipboard.writeText(`${brief()}\n\n# This location\n${JSON.stringify(doc, null, 2)}`)
    setMsg('Copied the format and this location for Claude')
  }

  return (
    <div ref={page} className="maptest-page loc-page">
      <canvas ref={canvas} tabIndex={0} aria-label={`3D view of ${doc.name}. Drag to slide, right-drag to orbit, scroll to glide toward the cursor, double-click to fly there, W A S D Q E to fly.`} />
      <div className="maptest-bar glass">
        <strong><Icon name="map" /> Locations</strong>
        <select value={doc.id} onChange={(e) => setParams({ l: e.target.value })} aria-label="Location">{docs.map((d) => <option key={d.id} value={d.id}>{d.name}{book.locations.some((l) => l.id === d.id) ? '' : ' (demo)'}</option>)}</select>
        <select value={mood} onChange={(e) => pickMood(e.target.value as MoodName)} aria-label="Mood">{mood === '' && <option value="">Custom</option>}{MOOD_NAMES.map((m) => <option key={m} value={m}>{MOODS[m].label}</option>)}</select>
        <label className="small loc-time" title="Time of day"><input type="range" min={0} max={24} step={0.05} value={hour} onChange={(e) => { setPlaying(false); setMood(''); setHour(Number(e.target.value)) }} aria-label="Time of day" /> {hhmm(hour)}</label>
        <button className="alt" aria-pressed={playing} title="Let the day pass" onClick={() => { setPlaying(!playing); setMood('') }}>{playing ? 'Pause' : 'Play'}</button>
        <select value={weather} onChange={(e) => { setWeather(e.target.value as Weather); setMood('') }} aria-label="Weather">{WEATHERS.map((w) => <option key={w} value={w}>{w[0].toUpperCase() + w.slice(1)}</option>)}</select>
        <select value={style} onChange={(e) => setStyle(e.target.value as StyleName)} aria-label="Style" title="How the scene is painted">{(Object.keys(STYLES) as StyleName[]).map((k) => <option key={k} value={k}>{STYLES[k].label}</option>)}</select>
        <select value={season} onChange={(e) => setSeason(e.target.value as Season)} aria-label="Season">{SEASONS.map((w) => <option key={w} value={w}>{w[0].toUpperCase() + w.slice(1)}</option>)}</select>
        <select value="" onChange={(e) => { const v = doc.views?.find((x) => x.name === e.target.value); if (v) showView(v) }} aria-label="Go to a saved view" disabled={!doc.views?.length}>
          <option value="">{doc.views?.length ? 'Views…' : 'No views yet'}</option>
          {doc.views?.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
        </select>
        <button className="alt" aria-pressed={tour >= 0} onClick={() => setTour(tour >= 0 ? -1 : 0)} disabled={!doc.views?.length} title="Glide through the saved views">{tour >= 0 ? 'Stop tour' : 'Tour'}</button>
        <button className="alt" onClick={saveView} title="Remember where the camera is">Save view</button>
        <button className="alt" onClick={() => scene.current?.frameAll()} title="See the whole place">Overview</button>
        <button className="alt" onClick={forClaude} title="Copy the recipe format and this location, to paste to Claude">For Claude</button>
        <button className="alt" onClick={exportJson}>Export</button>
        <button className="alt" onClick={() => file.current?.click()}>Import</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
        <button className="alt" title="Fill the screen (Esc to leave)" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : page.current?.requestFullscreen())}>Full screen</button>
        <select value={ground} onChange={(e) => setGround(e.target.value as 'recipe' | 'volume' | 'grid')} aria-label="Ground" title="How the ground is drawn: one 3D surface with its rock (the default), or the old height grid with rock faces laid over it"><option value="recipe">Ground: as the recipe</option><option value="volume">Ground: volume</option><option value="grid">Ground: height grid</option></select>
        <span className="muted small">{msg}</span>
      </div>
      <div className="loc-stats glass small" aria-live="off">
        <span className="muted">Drag: slide · Right-drag: orbit · Scroll: glide · Double-click: fly to · WASD QE: fly, Shift faster · Arrows: turn</span>
        {stats && <span> · <b>{stats.fps}</b> fps · {(stats.tris / 1e6).toFixed(1)}M tris</span>}
      </div>
      {busy && <div className="loc-busy glass small">{doc.name}: {msg}</div>}
      {tour >= 0 && doc.views?.[tour] && <div className="loc-caption glass"><b>{doc.views[tour].name}</b>{doc.views[tour].note && <span>{doc.views[tour].note}</span>}<span className="muted small">{tour + 1} of {doc.views.length}</span></div>}
    </div>
  )
}
