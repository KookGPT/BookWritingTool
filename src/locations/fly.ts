// Flying camera for big places, map-style: drag to grab and slide the ground, right-drag (or Shift/Alt-drag) to orbit the
// point under the cursor, middle-drag to look around, wheel to glide toward the cursor, double-click to fly there.
// W A S D / Q E fly at a speed that grows with height, arrows turn, Shift is faster. Everything eases toward a target.
import * as THREE from 'three'

export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }
type Mode = 'pan' | 'orbit' | 'look' | null

export class Fly {
  cur: Pose = { x: 0, y: 500, z: 2000, yaw: 0, pitch: -0.35 }
  tgt: Pose = { ...this.cur }
  keys = new Set<string>()
  ease = 9 // per second; lower while gliding to a view
  private ghost = new THREE.PerspectiveCamera()
  private mode: Mode = null
  private anchor = new THREE.Vector3()
  private last = { x: 0, y: 0 }
  private dom: HTMLElement
  private camera: THREE.PerspectiveCamera
  ground: (x: number, z: number) => number = () => 0
  onMove?: () => void

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera; this.dom = dom
    dom.addEventListener('pointerdown', this.down)
    dom.addEventListener('pointermove', this.move)
    dom.addEventListener('pointerup', this.up)
    dom.addEventListener('pointercancel', this.up)
    dom.addEventListener('wheel', this.wheel, { passive: false })
    dom.addEventListener('dblclick', this.dbl)
    dom.addEventListener('contextmenu', this.ctx)
    addEventListener('keydown', this.key); addEventListener('keyup', this.key); addEventListener('blur', this.blur)
  }
  dispose() {
    const d = this.dom
    d.removeEventListener('pointerdown', this.down); d.removeEventListener('pointermove', this.move); d.removeEventListener('pointerup', this.up)
    d.removeEventListener('pointercancel', this.up); d.removeEventListener('wheel', this.wheel); d.removeEventListener('dblclick', this.dbl); d.removeEventListener('contextmenu', this.ctx)
    removeEventListener('keydown', this.key); removeEventListener('keyup', this.key); removeEventListener('blur', this.blur)
  }

  /** Jump (or glide) to a pose. */
  set(p: Pose, glide = false) { this.tgt = { ...p }; if (!glide) this.cur = { ...p }; this.ease = glide ? 2.2 : 9 }
  altitude() { return this.cur.y - this.ground(this.cur.x, this.cur.z) }

  private ctx = (e: Event) => e.preventDefault()
  private blur = () => this.keys.clear()
  private key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.('input, select, textarea, [contenteditable=true]')) return
    if (e.type === 'keydown') this.keys.add(e.code); else this.keys.delete(e.code)
  }
  private pose(cam: THREE.PerspectiveCamera, p: Pose) {
    cam.position.set(p.x, p.y, p.z); cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ'); cam.updateMatrixWorld()
  }
  /** The ground point under a screen position, seen from the target pose. */
  pick(cx: number, cy: number): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect(), g = this.ghost
    g.fov = this.camera.fov; g.aspect = this.camera.aspect; g.near = 1; g.far = 1e6; g.updateProjectionMatrix(); this.pose(g, this.tgt)
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), g)
    const o = ray.ray.origin, d = ray.ray.direction
    let t = 1, prev = 0
    for (let i = 0; i < 4000 && t < 2e5; i++) {
      const p = o.clone().addScaledVector(d, t)
      if (p.y < this.ground(p.x, p.z)) { // refine between prev and t
        let a = prev, b = t
        for (let k = 0; k < 24; k++) { const m = (a + b) / 2, q = o.clone().addScaledVector(d, m); if (q.y < this.ground(q.x, q.z)) b = m; else a = m }
        return o.clone().addScaledVector(d, b)
      }
      prev = t; t += Math.max(1, t * 0.01)
    }
    return null
  }
  private down = (e: PointerEvent) => {
    this.dom.setPointerCapture(e.pointerId); this.dom.focus()
    this.last = { x: e.clientX, y: e.clientY }
    const p = this.pick(e.clientX, e.clientY)
    const orbit = e.button === 2 || (e.button === 0 && (e.shiftKey || e.altKey || e.ctrlKey))
    if (e.button === 1) this.mode = 'look'
    else if (orbit) { this.mode = 'orbit'; this.anchor.copy(p ?? this.pick(this.dom.getBoundingClientRect().left + this.dom.clientWidth / 2, this.dom.getBoundingClientRect().top + this.dom.clientHeight / 2) ?? new THREE.Vector3(this.tgt.x, this.tgt.y - 500, this.tgt.z)) }
    else if (p) { this.mode = 'pan'; this.anchor.copy(p) }
    else this.mode = 'look'
    this.ease = 9
  }
  private move = (e: PointerEvent) => {
    if (!this.mode) return
    const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y
    this.last = { x: e.clientX, y: e.clientY }
    const t = this.tgt
    if (this.mode === 'look') { t.yaw -= dx * 0.003; t.pitch = THREE.MathUtils.clamp(t.pitch - dy * 0.003, -1.55, 1.2) }
    else if (this.mode === 'orbit') {
      const dyaw = -dx * 0.005, np = THREE.MathUtils.clamp(t.pitch - dy * 0.004, -1.55, 0.3), dp = np - t.pitch
      const off = new THREE.Vector3(t.x, t.y, t.z).sub(this.anchor)
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dyaw)
      const right = new THREE.Vector3(Math.cos(t.yaw + dyaw), 0, -Math.sin(t.yaw + dyaw))
      off.applyAxisAngle(right, dp)
      const p = this.anchor.clone().add(off)
      if (p.y > this.ground(p.x, p.z) + 3) { t.x = p.x; t.y = p.y; t.z = p.z; t.pitch = np }
      t.yaw += dyaw
    } else { // keep the grabbed ground point under the cursor
      const r = this.dom.getBoundingClientRect(), g = this.ghost
      this.pose(g, t)
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), g)
      const d = ray.ray.direction
      if (d.y < -0.01) {
        const k = (this.anchor.y - ray.ray.origin.y) / d.y, hit = ray.ray.origin.clone().addScaledVector(d, k)
        t.x += this.anchor.x - hit.x; t.z += this.anchor.z - hit.z
      }
    }
    this.onMove?.()
  }
  private up = (e: PointerEvent) => { this.mode = null; if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId) }
  private wheel = (e: WheelEvent) => {
    e.preventDefault()
    const p = this.pick(e.clientX, e.clientY), t = this.tgt
    const f = Math.exp(Math.max(-1, Math.min(1, e.deltaY * (e.deltaMode ? 0.05 : 0.0015))))
    if (p) {
      const nx = p.x + (t.x - p.x) * f, ny = p.y + (t.y - p.y) * f, nz = p.z + (t.z - p.z) * f
      if (Math.hypot(nx - p.x, ny - p.y, nz - p.z) > 4 || f > 1) { t.x = nx; t.y = ny; t.z = nz }
    } else { const d = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(t.pitch, t.yaw, 0, 'YXZ')); const step = (1 - f) * Math.max(200, this.altitude()); t.x += d.x * step; t.y += d.y * step; t.z += d.z * step }
    this.ease = 9; this.onMove?.()
  }
  private dbl = (e: MouseEvent) => {
    const p = this.pick(e.clientX, e.clientY), t = this.tgt
    if (!p) return
    const k = 0.3
    t.x = p.x + (t.x - p.x) * k; t.y = p.y + (t.y - p.y) * k; t.z = p.z + (t.z - p.z) * k
    this.ease = 3; this.onMove?.()
  }

  update(dt: number) {
    const k = this.keys, t = this.tgt, fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1
    const speed = THREE.MathUtils.clamp(this.altitude() * 0.9, 15, 5000) * fast
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0), s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), u = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') ? 1 : 0)
    const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0), tilt = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0)
    if (f || s || u || turn || tilt) {
      t.x += (-Math.sin(t.yaw) * f + Math.cos(t.yaw) * s) * speed * dt
      t.z += (-Math.cos(t.yaw) * f - Math.sin(t.yaw) * s) * speed * dt
      t.y += u * speed * dt
      t.yaw += turn * 1.2 * dt; t.pitch = THREE.MathUtils.clamp(t.pitch + tilt * 0.9 * dt, -1.55, 1.2)
      this.ease = 9; this.onMove?.()
    }
    t.y = Math.max(t.y, this.ground(t.x, t.z) + 3)
    const a = 1 - Math.exp(-dt * this.ease), c = this.cur
    c.x += (t.x - c.x) * a; c.y += (t.y - c.y) * a; c.z += (t.z - c.z) * a
    let dyaw = t.yaw - c.yaw; dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2
    c.yaw += dyaw * a; c.pitch += (t.pitch - c.pitch) * a
    c.y = Math.max(c.y, this.ground(c.x, c.z) + 2)
    this.pose(this.camera, c)
    const moving = Math.abs(t.x - c.x) + Math.abs(t.y - c.y) + Math.abs(t.z - c.z) > 0.05 || Math.abs(dyaw) + Math.abs(t.pitch - c.pitch) > 1e-4
    return moving
  }
}
