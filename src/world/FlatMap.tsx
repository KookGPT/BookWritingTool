// The zoomable flat map. Panning and zooming first rescale a cached whole-world raster (instant), then, once the
// view settles, the visible part is resampled at real detail. Overlays and labels are redrawn in screen space each time.
import { useEffect, useRef } from 'react'
import { extent, fitScale, makeProj, paintFlat, sampleFlat, type MapStyle, type Proj, type ProjName, type Samples, type View } from './flat'
import { drawOverlays } from './flatDraw'
import { groundSpec, makePlanet, type Planet, type World } from './terrain'

export interface FlatApi { zoomBy(f: number): void; reset(): void; toBlob(cb: (b: Blob | null) => void): void }
interface Props { world: World; proj: ProjName; style: MapStyle; contour: number; labels: boolean; apiRef: { current: FlatApi | null }; onBusy: (b: boolean) => void }

const CAP = 700_000 // pixels sampled per raster; the slow part
const MAX_ZOOM = 80
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export default function FlatMap(props: Props) {
  const box = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null)
  const P = useRef(props); P.current = props
  const run = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = cv.current!, wrap = box.current!
    const st: { key: string; planet?: Planet; base?: { c: HTMLCanvasElement; p: Proj; s: Samples; painted: string }; crisp?: { c: HTMLCanvasElement; vk: string }; view?: View; timer: number } = { key: '', timer: 0 }
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2)
    const dims = () => ({ W: canvas.width, H: canvas.height })
    const view = (): View => st.view ?? { x: 0, y: 0, s: fitScale(P.current.proj, canvas.width, canvas.height) }
    const viewKey = () => { const v = view(), { proj, style, contour } = P.current; return `${proj}|${style}|${contour}|${canvas.width}x${canvas.height}|${v.x.toFixed(4)},${v.y.toFixed(4)},${v.s.toFixed(3)}` }

    const composite = () => {
      const { W, H } = dims()
      if (!W || !H) return
      const { world, proj, style, labels } = P.current, ctx = canvas.getContext('2d')!, v = view(), b = st.base
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#0b1114'; ctx.fillRect(0, 0, W, H)
      if (st.crisp?.vk === viewKey()) ctx.drawImage(st.crisp.c, 0, 0, W, H)
      else if (b) { // the cached world raster, moved and scaled to the current view
        const k = v.s / b.p.scale
        ctx.setTransform(k, 0, 0, k, W / 2 - b.p.w / 2 * k - v.x * v.s, H / 2 - b.p.h / 2 * k + v.y * v.s)
        ctx.drawImage(b.c, 0, 0)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }
      if (st.planet) drawOverlays(ctx, st.planet, world, makeProj(proj, W, H, v), style, labels, dpr())
    }

    const paintInto = (c: HTMLCanvasElement, planet: Planet, p: Proj, s: Samples) => {
      const ctx = c.getContext('2d')!, img = ctx.createImageData(c.width, c.height)
      paintFlat(planet, p, s, { style: P.current.style, contour: P.current.contour }, img.data)
      ctx.putImageData(img, 0, 0)
    }
    const rasterSize = () => { const { W, H } = dims(), r = Math.min(1, Math.sqrt(CAP / (W * H))); return { r, w: Math.max(2, Math.round(W * r)), h: Math.max(2, Math.round(H * r)) } }

    const ensureBase = () => {
      const { world, proj, style, contour } = P.current, { W, H } = dims(), key = `${proj}|${W}x${H}|${groundSpec(world)}`
      if (st.key !== key || !st.base || !st.planet) {
        const { w, h } = rasterSize(), c = document.createElement('canvas')
        c.width = w; c.height = h
        st.planet = makePlanet(world)
        const p = makeProj(proj, w, h)
        st.base = { c, p, s: sampleFlat(st.planet, p), painted: '' }
        st.key = key; st.crisp = undefined
      }
      if (st.base.painted !== `${style}|${contour}`) { paintInto(st.base.c, st.planet, st.base.p, st.base.s); st.base.painted = `${style}|${contour}` }
    }

    // the visible region resampled at its own resolution; replaces the scaled raster once the view stops moving
    const crispNow = () => {
      const v = view(), b = st.base, { W, H } = dims()
      if (!b || !st.planet || v.s / b.p.scale < 1.4) { st.crisp = undefined; return }
      const { r, w, h } = rasterSize(), c = document.createElement('canvas')
      c.width = w; c.height = h
      const p = makeProj(P.current.proj, w, h, { x: v.x, y: v.y, s: v.s * r })
      paintInto(c, st.planet, p, sampleFlat(st.planet, p))
      st.crisp = { c, vk: viewKey() }
      if (W && H) composite()
    }
    const scheduleCrisp = () => { clearTimeout(st.timer); st.timer = window.setTimeout(crispNow, 350) }

    run.current = () => {
      P.current.onBusy(true)
      clearTimeout(st.timer)
      st.timer = window.setTimeout(() => { // a tick, so "Rendering..." can paint before the slow part blocks
        if (canvas.width && canvas.height) { ensureBase(); composite(); scheduleCrisp() }
        P.current.onBusy(false)
      }, 30)
    }

    // ---------- interaction ----------
    let raf = 0
    const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; composite() }) }
    const pt = (e: { clientX: number; clientY: number }) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height } }
    const setView = (v: View) => {
      const { proj } = P.current, { W, H } = dims(), s0 = fitScale(proj, W, H), { X, Y } = extent(proj), s = clamp(v.s, s0, s0 * MAX_ZOOM)
      st.view = s <= s0 * 1.001 ? undefined : { s, x: clamp(v.x, -X, X), y: clamp(v.y, -Y, Y) }
      redraw(); scheduleCrisp()
    }
    const zoomAt = (f: number, px: number, py: number) => { // f > 1 zooms in, keeping the point under (px, py) fixed
      const v = view(), { W, H } = dims(), s = v.s * f
      setView({ s, x: v.x + (px - W / 2) / v.s - (px - W / 2) / s, y: v.y - (py - H / 2) / v.s + (py - H / 2) / s })
    }
    const pointers = new Map<number, { x: number; y: number }>()
    const down = (e: PointerEvent) => { canvas.focus(); canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, pt(e)) }
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const now = pt(e), v = view()
      if (pointers.size === 2) { // pinch: zoom about the midpoint
        const other = [...pointers].find(([id]) => id !== e.pointerId)![1]
        const before = Math.hypot(prev.x - other.x, prev.y - other.y), after = Math.hypot(now.x - other.x, now.y - other.y)
        pointers.set(e.pointerId, now)
        if (before > 0 && after > 0) zoomAt(after / before, (now.x + other.x) / 2, (now.y + other.y) / 2)
        return
      }
      pointers.set(e.pointerId, now)
      setView({ ...v, x: v.x - (now.x - prev.x) / v.s, y: v.y + (now.y - prev.y) / v.s })
    }
    const up = (e: PointerEvent) => pointers.delete(e.pointerId)
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = pt(e); zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y) }
    const dbl = (e: MouseEvent) => { const p = pt(e); zoomAt(2, p.x, p.y) }
    const key = (e: KeyboardEvent) => {
      const { W, H } = dims(), v = view(), step = 0.1 * W / v.s
      if (e.key === '+' || e.key === '=') zoomAt(1.5, W / 2, H / 2)
      else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.5, W / 2, H / 2)
      else if (e.key === 'ArrowLeft') setView({ ...v, x: v.x - step })
      else if (e.key === 'ArrowRight') setView({ ...v, x: v.x + step })
      else if (e.key === 'ArrowUp') setView({ ...v, y: v.y + step })
      else if (e.key === 'ArrowDown') setView({ ...v, y: v.y - step })
      else return
      e.preventDefault()
    }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('dblclick', dbl); canvas.addEventListener('keydown', key)

    P.current.apiRef.current = {
      zoomBy: (f) => zoomAt(1 / f, canvas.width / 2, canvas.height / 2),
      reset: () => { st.view = undefined; redraw(); scheduleCrisp() },
      toBlob: (cb) => canvas.toBlob(cb),
    }

    // canvas backing size follows the container; a new size starts again from the whole-world view
    const resize = () => {
      const w = Math.round(wrap.clientWidth * dpr()), h = Math.round(wrap.clientHeight * dpr())
      if (!w || !h || (w === canvas.width && h === canvas.height)) return
      canvas.width = w; canvas.height = h; st.view = undefined
      run.current()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize() // don't wait for the observer's first callback
    return () => {
      ro.disconnect(); clearTimeout(st.timer); cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('dblclick', dbl); canvas.removeEventListener('keydown', key)
      P.current.apiRef.current = null
    }
  }, [])

  // anything that changes what is drawn; projection changes also start over from the whole world
  const lastProj = useRef(props.proj)
  useEffect(() => { run.current() }, [props.world, props.proj, props.style, props.contour, props.labels])
  useEffect(() => { if (lastProj.current !== props.proj) { lastProj.current = props.proj; props.apiRef.current?.reset() } }, [props.proj, props.apiRef])

  return (
    <div ref={box} className="flatwrap">
      <canvas ref={cv} tabIndex={0} role="img" aria-label={`Flat map of ${props.world.name}. Drag to pan, scroll or plus and minus to zoom.`} />
    </div>
  )
}
