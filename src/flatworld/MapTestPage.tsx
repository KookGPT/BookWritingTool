import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import Icon, { type IconName } from '../Icon'
import { trashIt } from '../history'
import { uid, useBook } from '../store'
import demoRaw from '../../examples/map-test-demo.json?raw'
import {
  brief, CITY_SIZES, FEATURE_KINDS, heightAt, inPoly, LANDMARKS, LAYER_KINDS, layerColor, pathLen, polyArea, segDist, underFeature, validate,
  type CitySize, type FlatWorld, type Gen, type Landmark, type LayerKind, type MapItem, type MapLayer, type XY,
} from './gen'
import { centroid, collectLabels, Hud, type Ref } from './hud'
import { dressedImage, niceScale } from './dress'
import { MapScene, type Built } from './scene'

const RES = 1536 // samples along the long side; the two target machines are strong, phones would want ~900

type Tool = 'select' | 'city' | 'landmark' | 'regions' | 'borders' | 'roads' | 'ruler'
const TOOLS: [Tool, string, IconName, string][] = [
  ['select', 'Select, move, edit (V)', 'pointer', 'v'],
  ['city', 'Place a city (C)', 'pin', 'c'],
  ['landmark', 'Place a landmark (L)', 'flag', 'l'],
  ['regions', 'Draw a region (G)', 'region', 'g'],
  ['borders', 'Draw a border (B)', 'border', 'b'],
  ['roads', 'Draw a road (R)', 'road', 'r'],
  ['ruler', 'Measure distance (M)', 'ruler', 'm'],
]
const KIND_OF: Partial<Record<Tool, LayerKind>> = { city: 'cities', landmark: 'landmarks', regions: 'regions', borders: 'borders', roads: 'roads' }
const DRAWS = new Set<Tool>(['regions', 'borders', 'roads'])
type ItemRef = { layer: string; id: string }

const mapItem = (w: FlatWorld, r: ItemRef, fn: (i: MapItem) => MapItem | null): FlatWorld => ({
  ...w, layers: w.layers?.map((l) => l.id !== r.layer ? l : { ...l, items: l.items.flatMap((i) => i.id !== r.id ? [i] : (fn(i) ?? [])) }),
})
const itemOf = (w: FlatWorld | undefined, r?: Ref) => r && 'id' in r ? w?.layers?.find((l) => l.id === r.layer)?.items.find((i) => i.id === r.id) : undefined
const layerOf = (w: FlatWorld | undefined, r?: Ref) => r && 'id' in r ? w?.layers?.find((l) => l.id === r.layer) : undefined
const typing = (e: Event) => { const t = e.target as HTMLElement; return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable }

export default function MapTestPage() {
  const { book, update } = useBook()
  const worlds = book.flatWorlds
  const [selWorld, setSelWorld] = useState<string>()
  const world = worlds.find((w) => w.id === selWorld) ?? worlds[0]
  const canvas = useRef<HTMLCanvasElement>(null), hudCanvas = useRef<HTMLCanvasElement>(null), mini = useRef<HTMLCanvasElement>(null)
  const compass = useRef<HTMLButtonElement>(null), scaleEl = useRef<HTMLDivElement>(null)
  const scene = useRef<MapScene>(null)
  const hud = useRef(new Hud())
  const [gen, setGen] = useState<Gen>()
  const [shown, setShown] = useState<string>() // spec of the world on screen
  const [clouds, setClouds] = useState(true)
  const [labels, setLabels] = useState(true)
  const [msg, setMsg] = useState('')
  const [tool, setToolState] = useState<Tool>('select')
  const [citySize, setCitySize] = useState<CitySize>('town')
  const [icon, setIcon] = useState<Landmark>('castle')
  const [snap, setSnap] = useState(true)
  const [sel, setSel] = useState<Ref>()
  const [popup, setPopup] = useState<{ target: Ref; x: number; y: number; fresh?: boolean }>()
  const [draft, setDraft] = useState<XY[]>([])
  const [ruler, setRuler] = useState<XY[]>([])
  const [speed, setSpeed] = useState(30)
  const [active, setActive] = useState<Partial<Record<LayerKind, string>>>({})
  const [panel, setPanel] = useState(true)
  const [query, setQuery] = useState('')
  const [frame, setFrame] = useState(true)
  const file = useRef<HTMLInputElement>(null)
  // per-frame things that must not re-render React
  const live = useRef<{ hover?: Ref; cursor?: XY; snapAt?: XY; drag?: { ref: ItemRef; vertex: number; item: MapItem; moved: boolean } }>({})
  const down = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const s = new MapScene(canvas.current!)
    scene.current = s
    if (import.meta.env.DEV) (window as unknown as { mapScene: MapScene }).mapScene = s
    const ro = new ResizeObserver(() => s.resize())
    ro.observe(canvas.current!)
    return () => { ro.disconnect(); s.dispose(); scene.current = null }
  }, [])
  useEffect(() => { if (scene.current) scene.current.showClouds = clouds }, [clouds])

  // Rebuild the ground in a worker when the shape or features change; names, notes and layers never rebuild it.
  const spec = world && JSON.stringify({ ...world, name: '', note: '', layers: undefined, features: world.features.map(({ name: _n, note: _o, ...f }) => f) })
  useEffect(() => {
    if (!spec) return
    const w = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ built: Built }>) => { scene.current?.setWorld(e.data.built); setGen(e.data.built.gen); setShown(spec); w.terminate() }
    w.onerror = (e) => { setMsg(`Build failed: ${e.message}`); setShown(spec) }
    w.postMessage({ fw: JSON.parse(spec), res: RES, job: 0 })
    return () => w.terminate()
  }, [spec])
  const ready = !!gen && spec === shown

  // ---------- edits with undo ----------
  const worldRef = useRef(world)
  worldRef.current = world
  const past = useRef<string[]>([]), future = useRef<string[]>([])
  useEffect(() => { past.current = []; future.current = [] }, [world?.id])
  const save = (next: FlatWorld) => update((b) => ({ ...b, flatWorlds: b.flatWorlds.map((x) => (x.id === next.id ? next : x)) }))
  const commit = (fn: (w: FlatWorld) => FlatWorld) => {
    const w = worldRef.current
    if (!w) return
    past.current.push(JSON.stringify(w)); if (past.current.length > 100) past.current.shift()
    future.current = []
    const next = fn(w)
    worldRef.current = next
    save(next)
  }
  const undo = () => { const w = worldRef.current, p = past.current.pop(); if (!w || !p) return; future.current.push(JSON.stringify(w)); save(JSON.parse(p)) }
  const redo = () => { const w = worldRef.current, f = future.current.pop(); if (!w || !f) return; past.current.push(JSON.stringify(w)); save(JSON.parse(f)) }

  const layerFor = (w: FlatWorld, kind: LayerKind): [FlatWorld, string] => {
    const l = w.layers?.find((l) => l.id === active[kind] && l.kind === kind) ?? w.layers?.find((l) => l.kind === kind)
    if (l) return [w, l.id]
    const nl: MapLayer = { id: uid(), name: LAYER_KINDS[kind].label, kind, items: [] }
    return [{ ...w, layers: [...(w.layers ?? []), nl] }, nl.id]
  }
  const addItem = (kind: LayerKind, item: MapItem): ItemRef => {
    let layer = ''
    commit((w) => { const [w2, id] = layerFor(w, kind); layer = id; return { ...w2, layers: w2.layers!.map((l) => (l.id === id ? { ...l, hidden: false, items: [...l.items, item] } : l)) } })
    return { layer, id: item.id }
  }
  const removeSel = () => {
    if (!sel || !('id' in sel)) return
    commit((w) => mapItem(w, sel, () => null)); setSel(undefined); setPopup(undefined)
  }

  // ---------- tools ----------
  const setTool = (t: Tool) => { setToolState(t); setDraft([]); setRuler([]); live.current.snapAt = undefined; if (t !== 'select') setPopup(undefined) }
  useEffect(() => {
    if (scene.current) scene.current.dblFly = tool === 'select'
    if (canvas.current) canvas.current.style.cursor = tool === 'select' ? '' : 'crosshair'
  }, [tool])

  const local = (e: { clientX: number; clientY: number }) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  // Snap to coasts, rivers, crests and the corners of other borders and regions, within a few pixels.
  const snapped = (g: XY): XY | undefined => {
    const s = scene.current, w = worldRef.current
    if (!snap || !s || !gen || !w) return
    const r = 12 * s.kmPerPx()
    let best: XY | undefined, bd = r
    const S = gen.snaps
    for (let q = 0; q < S.length; q += 2) { const d = Math.hypot(S[q] - g[0], S[q + 1] - g[1]); if (d < bd) { bd = d; best = [S[q], S[q + 1]] } }
    for (const l of w.layers ?? []) if (!l.hidden) for (const it of l.items) for (const p of it.path ?? it.area ?? []) { const d = Math.hypot(p[0] - g[0], p[1] - g[1]); if (d < bd * 1.2) { bd = d; best = p } }
    return best
  }
  // What is under a CSS pixel: layer things first (as drawn), then the ground's named features.
  const pickRef = (p: { x: number; y: number }, g?: XY): Ref | undefined => {
    const hits = hud.current.hits, k = devicePixelRatio
    for (let n = hits.length - 1; n >= 0; n--) { const h = hits[n]; if (h.x !== undefined && Math.hypot(h.x - p.x, h.y! - p.y) <= h.r!) return h.ref }
    for (const h of hits) {
      if (!h.pts || ('id' in h.ref && layerOf(worldRef.current, h.ref)?.kind === 'regions')) continue
      for (let q = 2; q < h.pts.length; q += 2) if (segDist(p.x * k, p.y * k, h.pts[q - 2], h.pts[q - 1], h.pts[q], h.pts[q + 1]) < 6 * k) return h.ref
    }
    const w = worldRef.current
    if (!g || !w || !gen) return
    const regions = (w.layers ?? []).filter((l) => !l.hidden && l.kind === 'regions').flatMap((l) => l.items.filter((i) => i.area && inPoly(i.area, ...g)).map((i) => ({ ref: { layer: l.id, id: i.id }, a: polyArea(i.area!) })))
    if (regions.length) return regions.sort((a, b) => a.a - b.a)[0].ref
    const s = scene.current!
    for (const f of w.features) {
      if (f.at && (f.kind === 'peak' || f.kind === 'volcano')) { const q = s.proj(...gen.anchors[f.id]); if (q && Math.hypot(q[0] - p.x, q[1] - p.y) < 18) return { feature: f.id } }
    }
    const km = s.kmPerPx()
    for (const r of gen.rivers) for (let n = 1; n < r.pts.length; n += 3) { const a = r.pts[n - 1], b = r.pts[Math.min(r.pts.length - 1, n + 2)]; if (segDist(g[0], g[1], a[0], a[1], b[0], b[1]) < Math.max(r.width[n] * 2, 6 * km)) return { feature: r.id } }
    for (const f of w.features) if (f.kind === 'range' || f.kind === 'canyon') {
      const L = gen.lines[f.id], wd = (f.width ?? FEATURE_KINDS[f.kind].width!) * 0.7
      for (let n = 1; n < L.length; n++) if (segDist(g[0], g[1], L[n - 1][0], L[n - 1][1], L[n][0], L[n][1]) < wd) return { feature: f.id }
    }
    const areas = w.features.filter((f) => f.area && f.kind !== 'sea' && underFeature(gen, f, ...g)).sort((a, b) => polyArea(a.area!) - polyArea(b.area!))
    if (areas.length) return { feature: areas[0].id }
    const sea = w.features.find((f) => f.kind === 'sea' && underFeature(gen, f, ...g))
    return sea && { feature: sea.id }
  }
  // Something to drag under the pointer: a handle of the selected line/area, or a city/landmark.
  const grabAt = (p: { x: number; y: number }) => {
    const s = scene.current!, w = worldRef.current
    const it = itemOf(w, sel)
    if (it && sel && 'id' in sel) for (const [n, v] of (it.path ?? it.area ?? []).entries()) { const q = s.proj(...v); if (q && Math.hypot(q[0] - p.x, q[1] - p.y) < 9) return { ref: sel, vertex: n, item: it, moved: false } }
    const hits = hud.current.hits
    for (let n = hits.length - 1; n >= 0; n--) {
      const h = hits[n]
      if (h.x !== undefined && 'id' in h.ref && Math.hypot(h.x - p.x, h.y! - p.y) <= h.r!) { const i = itemOf(w, h.ref); if (i) return { ref: h.ref, vertex: -1, item: i, moved: false } }
    }
  }
  const finishDraft = (pts = draft) => {
    const kind = KIND_OF[tool]
    if (!kind) return
    const clean = pts.filter((p, n) => !n || Math.hypot(p[0] - pts[n - 1][0], p[1] - pts[n - 1][1]) > 0.5)
    const need = kind === 'regions' ? 3 : 2
    setDraft([])
    if (clean.length < need) return
    const item: MapItem = { id: uid(), [kind === 'regions' ? 'area' : 'path']: clean }
    const ref = addItem(kind, item)
    const last = scene.current?.proj(...clean[clean.length - 1])
    setSel(ref); setPopup({ target: ref, x: last?.[0] ?? 200, y: last?.[1] ?? 200, fresh: true })
  }
  const click = (p: { x: number; y: number }) => {
    const s = scene.current
    if (!s || !ready) return
    const g = s.ground(p.x, p.y)
    if (tool === 'select') { const r = pickRef(p, g); setSel(r); setPopup(r && { target: r, ...p }); return }
    if (!g) return
    if (tool === 'city' || tool === 'landmark') {
      const kind = KIND_OF[tool]!, item: MapItem = { id: uid(), at: [Math.round(g[0] * 10) / 10, Math.round(g[1] * 10) / 10], ...(tool === 'city' ? { size: citySize } : { icon }) }
      const ref = addItem(kind, item)
      setSel(ref); setPopup({ target: ref, ...p, fresh: true })
      return
    }
    if (tool === 'ruler') { setRuler((r) => [...r, g]); return }
    if (tool === 'regions' && draft.length >= 3) { const f = s.proj(...draft[0]); if (f && Math.hypot(f[0] - p.x, f[1] - p.y) < 10) { finishDraft(); return } }
    setDraft((d) => [...d, snapped(g) ?? g])
  }

  const onPointerDownCapture = (e: RPointerEvent) => {
    if (e.target !== canvas.current || e.button !== 0) return
    const p = local(e)
    down.current = p
    if (tool !== 'select' || !ready) return
    const grab = grabAt(p)
    if (grab) { scene.current!.controls.enabled = false; live.current.drag = grab; canvas.current!.setPointerCapture(e.pointerId) }
  }
  const onPointerMove = (e: RPointerEvent) => {
    const s = scene.current
    if (!s || !ready || e.target !== canvas.current) return
    const p = local(e), d = live.current.drag
    if (d && down.current) {
      if (!d.moved && Math.hypot(p.x - down.current.x, p.y - down.current.y) < 3) return
      const g = s.ground(p.x, p.y)
      if (!g) return
      const kind = layerOf(worldRef.current, d.ref)?.kind
      const at = d.vertex >= 0 && kind !== 'cities' && kind !== 'landmarks' ? snapped(g) ?? g : g
      d.moved = true
      d.item = d.vertex < 0 ? { ...d.item, at } : d.item.path ? { ...d.item, path: d.item.path.map((v, n) => (n === d.vertex ? at : v)) } : { ...d.item, area: d.item.area!.map((v, n) => (n === d.vertex ? at : v)) }
      return
    }
    const g = s.ground(p.x, p.y)
    live.current.cursor = g
    live.current.snapAt = g && DRAWS.has(tool) ? snapped(g) : undefined
    if (live.current.snapAt) live.current.cursor = live.current.snapAt
    if (tool === 'select' && !e.buttons) {
      const h = grabAt(p) ? sel : pickRef(p, g)
      live.current.hover = h
      canvas.current!.style.cursor = grabAt(p) ? 'move' : h ? 'pointer' : ''
    }
  }
  const onPointerUp = (e: RPointerEvent) => {
    const st = down.current, d = live.current.drag
    down.current = null
    if (d) {
      scene.current!.controls.enabled = true
      live.current.drag = undefined
      if (d.moved) { commit((w) => mapItem(w, d.ref, () => d.item)); return }
    }
    if (!st || e.target !== canvas.current) return
    const p = local(e)
    if (Math.hypot(p.x - st.x, p.y - st.y) < 5) click(p)
  }

  // keyboard: tools, finish/cancel drawing, delete, undo/redo
  const keyRef = useRef<(e: KeyboardEvent) => void>(null)
  keyRef.current = (e: KeyboardEvent) => {
    if (typing(e)) return
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') { if (draft.length) setDraft([]); else if (ruler.length) setRuler([]); else if (popup) setPopup(undefined); else setTool('select'); return }
    if (e.key === 'Enter' && draft.length) { finishDraft(); return }
    if (e.key === 'Backspace' && draft.length) { setDraft((d) => d.slice(0, -1)); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && 'id' in sel) { removeSel(); return }
    const t = TOOLS.find((t) => t[3] === k)
    if (t && world) setTool(t[0])
  }
  useEffect(() => { const h = (e: KeyboardEvent) => keyRef.current?.(e); addEventListener('keydown', h); return () => removeEventListener('keydown', h) }, [])

  // ---------- drawing: region fills (draped texture) and the per-frame screen layer ----------
  const labelList = useMemo(() => (world && gen ? collectLabels(world, gen) : []), [world, gen])
  useEffect(() => {
    const s = scene.current
    if (!s || !gen || !world) return
    const c = document.createElement('canvas'), L = 2048
    c.width = Math.round(gen.W > gen.H ? L : L * gen.W / gen.H); c.height = Math.round(gen.H > gen.W ? L : L * gen.H / gen.W)
    const ctx = c.getContext('2d')!, X = (x: number) => (x + gen.W / 2) / gen.W * c.width, Y = (y: number) => (gen.H / 2 - y) / gen.H * c.height
    for (const l of world.layers ?? []) {
      if (l.hidden || l.kind !== 'regions') continue
      for (const it of l.items) {
        ctx.globalAlpha = sel && 'id' in sel && sel.id === it.id ? 0.5 : 0.3
        ctx.fillStyle = layerColor(l)
        ctx.beginPath(); it.area!.forEach(([x, y], n) => (n ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath(); ctx.fill()
      }
    }
    s.setFill(c)
  }, [world, gen, sel])

  const miniBase = useMemo(() => {
    if (!gen) return
    const c = document.createElement('canvas'), mw = 200, mh = Math.round(200 * gen.H / gen.W)
    c.width = mw; c.height = mh
    const ctx = c.getContext('2d')!, img = ctx.createImageData(mw, mh)
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const i = Math.floor(x / mw * gen.w), j = Math.floor(y / mh * gen.h), k = j * gen.w + i, o = (y * mw + x) * 4
      const off = gen.disc && Math.hypot(x - mw / 2, y - mh / 2) > mw / 2
      if (off) continue
      if (gen.height[k] < 0) { const d = gen.depth[k] / 255; img.data.set([70 - 40 * d, 160 - 90 * d, 190 - 60 * d, 255], o) }
      else img.data.set([gen.rgba[k * 4], gen.rgba[k * 4 + 1], gen.rgba[k * 4 + 2], 255], o)
    }
    ctx.putImageData(img, 0, 0)
    return c
  }, [gen])

  const st = { world, gen, labelList, labels, sel, tool, draft, ruler, speed, miniBase }
  const stRef = useRef(st)
  stRef.current = st
  useEffect(() => {
    const s = scene.current!
    s.onFrame = () => {
      const { world, gen, labelList, labels, sel, tool, draft, ruler, speed, miniBase } = stRef.current
      const c = hudCanvas.current!, k = devicePixelRatio, cw = canvas.current!.clientWidth, ch = canvas.current!.clientHeight
      if (c.width !== Math.round(cw * k) || c.height !== Math.round(ch * k)) { c.width = Math.round(cw * k); c.height = Math.round(ch * k) }
      const ctx = c.getContext('2d')!
      if (!world || !gen) { ctx.clearRect(0, 0, c.width, c.height); return }
      const d = live.current.drag
      const w = d?.moved ? mapItem(world, d.ref, () => d.item) : world
      const kmPerPx = s.kmPerPx(), kind = KIND_OF[tool]
      hud.current.draw(ctx, { proj: s.proj, k, w: cw, h: ch, kmPerPx }, {
        world: w, gen, labels: d?.moved ? collectLabels(w, gen) : labelList, showLabels: labels, sel, hover: live.current.hover,
        draft: kind && DRAWS.has(tool) ? { kind, pts: draft, cursor: live.current.cursor } : undefined,
        ruler: tool === 'ruler' ? { pts: ruler, cursor: live.current.cursor, speed } : undefined,
        snap: live.current.snapAt,
      })
      // compass and scale bar
      if (compass.current) compass.current.style.transform = `rotate(${-s.azimuth()}rad)`
      if (scaleEl.current) { const n = niceScale(kmPerPx, 110); scaleEl.current.style.width = `${n.px}px`; scaleEl.current.dataset.km = `${n.km.toLocaleString()} km` }
      // minimap: ground, cities, the area in view
      const m = mini.current
      if (m && miniBase) {
        const mc = m.getContext('2d')!, sx = m.width / gen.W, sy = m.height / gen.H, MX = (x: number) => (x + gen.W / 2) * sx, MY = (y: number) => (gen.H / 2 - y) * sy
        mc.clearRect(0, 0, m.width, m.height); mc.drawImage(miniBase, 0, 0)
        for (const l of w.layers ?? []) if (!l.hidden && l.kind === 'cities') { mc.fillStyle = layerColor(l); for (const it of l.items) mc.fillRect(MX(it.at![0]) - 1.5, MY(it.at![1]) - 1.5, 3, 3) }
        const fp = s.footprint()
        mc.strokeStyle = '#fff'; mc.lineWidth = 1.5; mc.fillStyle = 'rgba(255,255,255,.12)'
        mc.beginPath(); fp.forEach(([x, y], n) => (n ? mc.lineTo(MX(x), MY(y)) : mc.moveTo(MX(x), MY(y)))); mc.closePath(); mc.fill(); mc.stroke()
      }
    }
    return () => { s.onFrame = undefined }
  }, [])
  const miniMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!e.buttons || !gen) return
    const r = e.currentTarget.getBoundingClientRect()
    scene.current?.moveTo(((e.clientX - r.left) / r.width - 0.5) * gen.W, (0.5 - (e.clientY - r.top) / r.height) * gen.H)
  }

  // ---------- world-level actions ----------
  const put = (fw: FlatWorld) => {
    update((b) => ({ ...b, flatWorlds: b.flatWorlds.some((x) => x.id === fw.id) ? b.flatWorlds.map((x) => (x.id === fw.id ? fw : x)) : [...b.flatWorlds, fw] }))
    setSelWorld(fw.id); setSel(undefined); setPopup(undefined)
  }
  const load = (text: string) => {
    let j: unknown
    try { j = JSON.parse(text) } catch { setMsg('That file is not JSON.'); return }
    const v = validate(j)
    if (v.errors.length) { setMsg(`Not imported: ${v.errors.slice(0, 3).join('; ')}`); return }
    const fw = j as FlatWorld, old = worlds.find((w) => w.id === fw.id)
    put(old && !fw.layers && old.layers ? { ...fw, layers: old.layers } : fw) // a re-import without layers keeps the ones drawn here
    setMsg(v.warnings.length ? `Imported with ${v.warnings.length} warnings: ${v.warnings.slice(0, 2).join('; ')}` : 'Imported.')
  }
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const fname = (ext: string) => `${world!.name.replace(/[^\w-]+/g, '-')}.${ext}`
  const exportPng = () => {
    const s = scene.current
    if (!s || !world) return
    const img = dressedImage({ view: s.snapshot(), hud: hudCanvas.current!, title: world.name, frame, layers: world.layers ?? [], kmPerPx: s.kmPerPx(), azimuth: s.azimuth(), k: devicePixelRatio })
    img.toBlob((b) => b && download(b, fname('png')))
  }
  const copyBrief = async () => {
    try { await navigator.clipboard.writeText(`${brief(world)}\n\nCURRENT JSON:\n${JSON.stringify(world, null, 2)}`); setMsg('Copied the brief and this map\'s JSON. Paste it to Claude with what you want changed.') }
    catch { setMsg('Could not copy to the clipboard.') }
  }
  const remove = async () => {
    if (!world || !confirm(`Delete "${world.name}"? It goes to the trash.`)) return
    await trashIt('flatWorlds', world.name, world)
    update((b) => ({ ...b, flatWorlds: b.flatWorlds.filter((w) => w.id !== world.id) }))
    setSelWorld(undefined)
  }

  // ---------- search ----------
  const places = useMemo(() => {
    if (!world || !gen) return []
    const out: { name: string; kind: string; ref: Ref; at: XY }[] = []
    for (const f of world.features) if (f.name) out.push({ name: f.name, kind: FEATURE_KINDS[f.kind]?.label.split(/[(:]/)[0].trim() ?? f.kind, ref: { feature: f.id }, at: gen.anchors[f.id] ?? gen.lines[f.id]?.[Math.floor(gen.lines[f.id].length / 2)] ?? gen.rivers.find((r) => r.id === f.id)?.pts[0] ?? [0, 0] })
    for (const l of world.layers ?? []) for (const it of l.items) if (it.name) out.push({ name: it.name, kind: l.name, ref: { layer: l.id, id: it.id }, at: it.at ?? centroid(it.area ?? it.path!) })
    return out
  }, [world, gen])
  const found = query.trim() ? places.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : []
  const goTo = (p: { ref: Ref; at: XY }) => {
    const s = scene.current!
    s.flyTo(p.at[0], p.at[1])
    setQuery(''); setSel(p.ref); setPopup({ target: p.ref, x: canvas.current!.clientWidth / 2, y: canvas.current!.clientHeight / 2 })
  }

  const kind = KIND_OF[tool]
  const hint = tool === 'select' ? '' : DRAWS.has(tool) ? `Click to add points${tool === 'regions' ? ', click the first point' : ''}, double-click or Enter to finish, Backspace undoes a point, Esc cancels.${snap ? ' Snaps to coasts, rivers, crests and other lines.' : ''}`
    : tool === 'ruler' ? 'Click points along the way. Esc clears.' : `Click the map to place ${tool === 'city' ? 'a city' : 'a landmark'}.`
  const visibleLayers = (world?.layers ?? []).filter((l) => !l.hidden && l.items.length)

  return (
    <div className="maptest-page" onPointerDownCapture={onPointerDownCapture} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onDoubleClick={(e) => { if (DRAWS.has(tool) && e.target === canvas.current) finishDraft() }}>
      <canvas ref={canvas} tabIndex={0} aria-label={world ? `Map of ${world.name}. Drag to pan, right-drag or Q and E to turn, scroll to zoom, double-click to fly in.` : 'Empty map'} />
      <canvas ref={hudCanvas} className="maptest-hud" aria-hidden="true" />

      <div className="maptest-bar glass">
        <strong><Icon name="mountain" /> New Map Test</strong>
        {worlds.length > 0 && <select value={world?.id} onChange={(e) => { setSelWorld(e.target.value); setSel(undefined); setPopup(undefined) }} aria-label="Map">
          {worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>}
        {world && <div className="maptest-search">
          <input type="search" placeholder="Find a place…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a place on the map"
            onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) goTo(found[0]); if (e.key === 'Escape') setQuery('') }} />
          {found.length > 0 && <ul className="maptest-results glass" role="listbox">
            {found.map((p) => <li key={'feature' in p.ref ? p.ref.feature : p.ref.id}><button className="ghost" onClick={() => goTo(p)}>{p.name} <small className="muted">{p.kind}</small></button></li>)}
          </ul>}
        </div>}
        <button className="alt" onClick={() => load(demoRaw)}>Load demo</button>
        <button className="alt" onClick={() => file.current?.click()}>Import</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await f.text()); e.target.value = '' }} />
        {world && <>
          <button className="alt" onClick={() => download(new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' }), fname('json'))}>Export</button>
          <button className="alt" onClick={copyBrief} title="Copy the format brief and this map's JSON, to paste to Claude"><Icon name="copy" /> For Claude</button>
          <button className="alt" onClick={exportPng} title="Save the current view as a PNG"><Icon name="download" /> PNG</button>
          <label className="small" title="Parchment frame and title on the PNG"><input type="checkbox" checked={frame} onChange={(e) => setFrame(e.target.checked)} /> Frame</label>
          <label className="small"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Names</label>
          <label className="small"><input type="checkbox" checked={clouds} onChange={(e) => setClouds(e.target.checked)} /> Clouds</label>
          <button className="ghost icon" onClick={remove} aria-label="Delete map" title="Delete map"><Icon name="trash" /></button>
        </>}
        {spec && !ready && <span className="muted small">Building…</span>}
      </div>

      {world && <div className="maptest-tools glass" role="toolbar" aria-label="Map tools">
        {TOOLS.map(([t, label, ic]) => <button key={t} className={tool === t ? '' : 'ghost'} aria-pressed={tool === t} title={label} aria-label={label} onClick={() => setTool(t)}><Icon name={ic} /></button>)}
        <hr />
        <button className={snap ? '' : 'ghost'} aria-pressed={snap} title="Snap lines to coasts, rivers, crests and other lines" aria-label="Snap" onClick={() => setSnap(!snap)}><Icon name="magnet" /></button>
        <button className="ghost" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo}><Icon name="undo" /></button>
        <button className="ghost" title="Redo (Ctrl+Y)" aria-label="Redo" onClick={redo}><Icon name="redo" /></button>
      </div>}
      {world && tool !== 'select' && <div className="maptest-hint glass small">
        {tool === 'city' && <select value={citySize} onChange={(e) => setCitySize(e.target.value as CitySize)} aria-label="City size">{CITY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
        {tool === 'landmark' && <select value={icon} onChange={(e) => setIcon(e.target.value as Landmark)} aria-label="Landmark type">{Object.entries(LANDMARKS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}
        {tool === 'ruler' && <label>Travel <input type="number" min={1} max={2000} value={speed} onChange={(e) => setSpeed(Math.max(1, Number(e.target.value) || 1))} style={{ width: '4.5rem' }} /> km/day</label>}
        {kind && (world.layers ?? []).filter((l) => l.kind === kind).length > 1 && <select value={active[kind] ?? ''} onChange={(e) => setActive({ ...active, [kind]: e.target.value })} aria-label="Layer to add to">
          {(world.layers ?? []).filter((l) => l.kind === kind).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <span>{hint}</span>
      </div>}

      {world && gen && <LayersPanel world={world} open={panel} setOpen={setPanel} active={active} setActive={setActive} commit={commit} />}

      {popup && world && gen && <Popup key={'feature' in popup.target ? popup.target.feature : popup.target.id} {...popup} world={world} gen={gen} commit={commit}
        onClose={() => setPopup(undefined)} onDelete={removeSel}
        onZoom={(at, km) => scene.current?.flyTo(at[0], at[1], Math.max(km * 2.2, 60))} />}

      {world && gen && <canvas ref={mini} className="maptest-mini glass" width={200} height={Math.round(200 * gen.H / gen.W)} aria-label="Minimap: click or drag to move the view"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); miniMove(e) }} onPointerMove={miniMove} />}
      {world && <div className="maptest-dress">
        {visibleLayers.length > 0 && <ul className="maptest-legend glass small" aria-label="Legend">
          {visibleLayers.map((l) => <li key={l.id}><Swatch layer={l} /> {l.name}</li>)}
        </ul>}
        <div className="row" style={{ alignItems: 'flex-end', gap: '.6rem' }}>
          <div className="maptest-scale glass small"><div ref={scaleEl} /></div>
          <button ref={compass} className="maptest-compass" onClick={() => scene.current?.north()} title="North up" aria-label="Turn the map north up">
            <svg viewBox="-20 -20 40 40" width="46" height="46" aria-hidden="true">
              <circle r="18" fill="#f1e4c6" stroke="#3a2a18" strokeWidth="1.2" />
              <path d="M0-15L3 0H-3z" fill="#9b2c2c" /><path d="M0 15L3 0H-3z" fill="#3a2a18" /><path d="M-15 0L0 2.5V-2.5z M15 0L0 2.5V-2.5z" fill="#6b5640" />
            </svg>
            <span>N</span>
          </button>
        </div>
      </div>}

      {msg && <div className="maptest-msg glass small" role="status" onClick={() => setMsg('')}>{msg}</div>}
      {!world && <div className="maptest-empty glass">
        <p>No maps yet. Describe your world to Claude and import the JSON it writes, or load the demo to look around.</p>
      </div>}
    </div>
  )
}

function Swatch({ layer }: { layer: MapLayer }) {
  const c = layerColor(layer)
  return <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
    {layer.kind === 'cities' && <><circle cx="11" cy="7" r="5" fill="#fbf4e2" stroke={c} strokeWidth="1.6" /><circle cx="11" cy="7" r="2" fill={c} /></>}
    {layer.kind === 'landmarks' && <><circle cx="11" cy="7" r="6" fill="#f6ecd4" stroke={c} strokeWidth="1.3" /><path d="M8 10V6h1.5v1h1V6h1v1h1V6H14v4z" fill={c} /></>}
    {layer.kind === 'regions' && <rect x="3" y="2" width="16" height="10" fill={c} fillOpacity=".35" stroke={c} strokeWidth="1.5" />}
    {layer.kind === 'borders' && <path d="M1 7h20" stroke={c} strokeWidth="2.2" strokeDasharray="6 2 2 2" />}
    {layer.kind === 'roads' && <path d="M1 7h20" stroke={c} strokeWidth="2.2" strokeDasharray="1 3" strokeLinecap="round" />}
  </svg>
}

function LayersPanel({ world, open, setOpen, active, setActive, commit }: {
  world: FlatWorld; open: boolean; setOpen: (b: boolean) => void
  active: Partial<Record<LayerKind, string>>; setActive: (a: Partial<Record<LayerKind, string>>) => void
  commit: (fn: (w: FlatWorld) => FlatWorld) => void
}) {
  const layers = world.layers ?? []
  const patch = (id: string, p: Partial<MapLayer>) => commit((w) => ({ ...w, layers: w.layers!.map((l) => (l.id === id ? { ...l, ...p } : l)) }))
  const add = (kind: LayerKind) => {
    const id = uid()
    commit((w) => ({ ...w, layers: [...(w.layers ?? []), { id, name: LAYER_KINDS[kind].label, kind, items: [] }] }))
    setActive({ ...active, [kind]: id })
  }
  return (
    <div className={`maptest-layers glass ${open ? '' : 'closed'}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong><Icon name="layers" /> Layers</strong>
        <button className="ghost icon" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Hide layers' : 'Show layers'}><Icon name={open ? 'right' : 'left'} /></button>
      </div>
      {open && <>
        {!layers.length && <p className="muted small">Pick a tool on the left and click the map: cities, landmarks, regions, borders and roads each get their own layer.</p>}
        <ul>
          {layers.map((l) => {
            const isActive = active[l.kind] === l.id || (!active[l.kind] && layers.find((x) => x.kind === l.kind) === l)
            return <li key={l.id} className={isActive ? 'active' : ''}>
              <button className="ghost icon" onClick={() => patch(l.id, { hidden: !l.hidden })} aria-label={l.hidden ? `Show ${l.name}` : `Hide ${l.name}`} aria-pressed={!l.hidden}><Icon name={l.hidden ? 'eyeOff' : 'eye'} /></button>
              <input type="color" value={layerColor(l)} onChange={(e) => patch(l.id, { color: e.target.value })} aria-label={`${l.name} colour`} />
              <input className="name" defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && patch(l.id, { name: e.target.value || l.name })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Layer name" />
              <button className="ghost small" title="New items of this kind go here" onClick={() => setActive({ ...active, [l.kind]: l.id })} aria-pressed={isActive}>{l.items.length}</button>
              <button className="ghost icon" onClick={() => { if (!l.items.length || confirm(`Delete layer "${l.name}" and its ${l.items.length} items?`)) commit((w) => ({ ...w, layers: w.layers!.filter((x) => x.id !== l.id) })) }} aria-label={`Delete ${l.name}`}><Icon name="trash" size={15} /></button>
            </li>
          })}
        </ul>
        <select value="" onChange={(e) => e.target.value && add(e.target.value as LayerKind)} aria-label="Add a layer">
          <option value="">+ Add a layer…</option>
          {Object.entries(LAYER_KINDS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
      </>}
    </div>
  )
}

function Popup({ target: r, x, y, fresh, world, gen, commit, onClose, onDelete, onZoom }: {
  target: Ref; x: number; y: number; fresh?: boolean; world: FlatWorld; gen: Gen
  commit: (fn: (w: FlatWorld) => FlatWorld) => void; onClose: () => void; onDelete: () => void; onZoom: (at: XY, km: number) => void
}) {
  const feature = 'feature' in r ? world.features.find((f) => f.id === r.feature) : undefined
  const item = itemOf(world, r), layer = layerOf(world, r)
  const [name, setName] = useState((feature ?? item)?.name ?? '')
  const [note, setNote] = useState((feature ?? item)?.note ?? '')
  if (!feature && !item) return null
  const set = (p: Partial<MapItem>) => commit((w) => 'feature' in r
    ? { ...w, features: w.features.map((f) => (f.id === r.feature ? { ...f, ...p } as typeof f : f)) }
    : mapItem(w, r, (i) => ({ ...i, ...p })))
  const saveName = () => { if (name !== ((feature ?? item)?.name ?? '')) set({ name: name.trim() || undefined }) }
  const saveNote = () => { if (note !== ((feature ?? item)?.note ?? '')) set({ note: note.trim() || undefined }) }

  // what it is, how big, and where to zoom
  let kind = '', stats = '', at: XY = [0, 0], extent = 50
  if (feature) {
    kind = FEATURE_KINDS[feature.kind]?.label.split(/[(:]/)[0].trim() ?? feature.kind
    const line = gen.lines[feature.id] ?? gen.rivers.find((v) => v.id === feature.id)?.pts
    if (line) { const L = pathLen(line); at = line[Math.floor(line.length / 2)]; extent = L / 2; stats = `${Math.round(L).toLocaleString()} km long` }
    if (feature.kind === 'range' && line) stats += ` · highest ${Math.round(Math.max(...line.map((p) => heightAt(gen, ...p)))).toLocaleString()} m`
    if (feature.at) { at = gen.anchors[feature.id]; stats = `${Math.round(heightAt(gen, ...at)).toLocaleString()} m high`; extent = feature.radius ?? 50 }
    if (feature.area) { const a = polyArea(feature.area); at = gen.anchors[feature.id] ?? centroid(feature.area); extent = Math.sqrt(a) / 2; stats = `${Math.round(a).toLocaleString()} km²` }
  } else if (item && layer) {
    kind = LAYER_KINDS[layer.kind].label.replace(/s &.*|s$/, '')
    if (item.at) { at = item.at; extent = 40; stats = `${Math.round(heightAt(gen, ...at)).toLocaleString()} m above sea` }
    if (item.path) { const L = pathLen(item.path); at = centroid(item.path); extent = L / 2; stats = `${Math.round(L).toLocaleString()} km long` }
    if (item.area) { const a = polyArea(item.area); at = centroid(item.area); extent = Math.sqrt(a) / 2; stats = `${Math.round(a).toLocaleString()} km²` }
  }
  const left = Math.min(Math.max(8, x + 14), innerWidth - 300), top = Math.min(Math.max(8, y - 20), innerHeight - 320)
  return (
    <div className="maptest-popup glass" style={{ left, top }} role="dialog" aria-label={name || kind}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation() }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <small className="muted">{kind}{layer ? ` · ${layer.name}` : ''}</small>
        <button className="ghost icon" onClick={onClose} aria-label="Close"><Icon name="x" size={15} /></button>
      </div>
      <input autoFocus={fresh} value={name} placeholder="Name it…" onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') { saveName(); if (fresh) onClose() } }} aria-label="Name" />
      {stats && <small className="muted">{stats}</small>}
      {layer?.kind === 'cities' && <select value={item!.size ?? 'town'} onChange={(e) => set({ size: e.target.value as CitySize })} aria-label="Size">{CITY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
      {layer?.kind === 'landmarks' && <select value={item!.icon ?? 'monument'} onChange={(e) => set({ icon: e.target.value as Landmark })} aria-label="Kind of landmark">{Object.entries(LANDMARKS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}
      <textarea rows={2} value={note} placeholder="Notes…" onChange={(e) => setNote(e.target.value)} onBlur={saveNote} aria-label="Notes" />
      <div className="row">
        <button className="alt" onClick={() => onZoom(at, extent)}>Zoom to</button>
        {item && <button className="ghost" onClick={onDelete}><Icon name="trash" size={15} /> Delete</button>}
      </div>
      {feature && <small className="muted">The ground is Claude's to reshape: use “For Claude” and describe the change.</small>}
      {item && (item.path || item.area) && <small className="muted">Drag the square handles to reshape.</small>}
    </div>
  )
}
