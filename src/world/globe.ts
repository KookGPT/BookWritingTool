// 3D globe renderer: cube-sphere quadtree LOD, tiles built in workers, custom orbit/ground camera.
import * as THREE from 'three'
import { groundSpec, makePlanet, toDir, toLatLon, type Planet, type World } from './terrain.ts'
import { layerColor, outline, pickFeature, pointSize, refKey, type Feature } from './layers.ts'
import type { LatLon } from './geo.ts'
import { tileAngle, tileCenter, tileIndex, type TileData } from './tile.ts'

const MAX_LEVEL = 15
const SPLIT = 5 // split a tile when the camera is closer than SPLIT * its angular size (~3px quads at the switch)
const MAX_TILES = 900
const DEG = Math.PI / 180

interface Tile { key: string; face: number; level: number; x: number; y: number; center: THREE.Vector3; mesh?: THREE.Mesh; pending: boolean; used: number }
interface View { lat: number; lon: number; dist: number; heading: number; tilt: number }
export interface Hover { lat: number; lon: number; elevation: number; biome: string; feature?: Feature }
export interface ViewInfo { altitudeKm: number; lat: number; lon: number }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const wrap = (d: number) => ((d + 540) % 360) - 180

// Overlays draped on the surface: no depth test (so they read from orbit), and the far side of the planet is
// hidden per vertex instead. `round` makes points discs with a dark rim.
const drapeMat = (color: string | number, alpha: number, round = false) => new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false, transparent: true,
  uniforms: { exag: { value: 1 }, color: { value: new THREE.Color(color) }, alpha: { value: alpha } },
  vertexShader: 'attribute float h; attribute float size; uniform float exag; varying float vis; void main(){ vec3 w = position * (1. + h * exag); vis = dot(normalize(position), normalize(cameraPosition - w)); gl_PointSize = size; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }',
  fragmentShader: `uniform vec3 color; uniform float alpha; varying float vis; void main(){ if (vis < 0.02) discard; vec3 c = color;${round ? ' float r = length(gl_PointCoord - .5); if (r > .5) discard; if (r > .36) c = vec3(.06);' : ''} gl_FragColor = vec4(c, alpha); }`,
})

// split a lat/lon triangle until its edges are short, so big polygons hug the curved surface
const splitTri = (a: LatLon, b: LatLon, c: LatLon, out: LatLon[], depth = 0) => {
  const len = (p: LatLon, q: LatLon) => Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]))
  if (depth > 5 || Math.max(len(a, b), len(b, c), len(c, a)) < 3) { out.push(a, b, c); return }
  const m = (p: LatLon, q: LatLon): LatLon => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  const ab = m(a, b), bc = m(b, c), ca = m(c, a)
  for (const t of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) splitTri(t[0], t[1], t[2], out, depth + 1)
}

export class Globe {
  onHover?: (h: Hover | null) => void
  onView?: (v: ViewInfo) => void
  onClick?: (f: Feature | undefined, x: number, y: number) => void
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(40, 1, 1e-6, 100)
  private material: THREE.MeshStandardMaterial
  private exag = { value: 20 }
  private relief = 1
  private index = new THREE.BufferAttribute(tileIndex(), 1)
  private tiles = new Map<string, Tile>()
  private queue: Tile[] = []
  private workers: Worker[] = []
  private idle: Worker[] = []
  private gen = 0
  private spec = ''
  private planet?: Planet
  private goal: View = { lat: 15, lon: 0, dist: 3.2, heading: 0, tilt: 65 * DEG }
  private cur: View = { ...this.goal }
  private frame = 0
  private raf = 0
  private dirty = true
  private sun = new THREE.DirectionalLight(0xfff4e6, 2.6)
  private atmo: THREE.Mesh
  private stars: THREE.Points
  private space = new THREE.Color(0x070b0d)
  private sky = new THREE.Color(0x9db4c4)
  private pointers = new Map<number, { x: number; y: number }>()
  private drag?: { button: number; x: number; y: number; moved: number }
  private mouse?: { x: number; y: number }
  private ro: ResizeObserver
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.scene.background = this.space.clone()

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 })
    this.material.onBeforeCompile = (s) => {
      s.uniforms.exag = this.exag
      s.vertexShader = 'attribute vec3 up;\nattribute float h;\nattribute vec3 grad;\nuniform float exag;\n' + s.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(up - grad * exag);')
        .replace('#include <begin_vertex>', 'vec3 transformed = position + up * (h * exag);')
    }
    this.scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x1a2420, 0.9))
    this.scene.add(this.sun, this.sun.target)

    // atmosphere rim
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 64), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(0x6aa6e0) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      // back faces: dot is 0 at the outer silhouette and about -0.26 just outside the planet's limb, so glow fades outward
      fragmentShader: 'uniform vec3 color; varying vec3 vN; varying vec3 vV; void main(){ float f = clamp(-dot(vN, vV) / 0.26, 0., 1.); gl_FragColor = vec4(color * pow(f, 3.) * 0.75, 1.); }',
    }))
    this.scene.add(this.atmo)

    // stars ride with the camera like a skybox
    const sp = new Float32Array(1800 * 3)
    for (let i = 0; i < sp.length; i += 3) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(5)
      sp[i] = v.x; sp[i + 1] = v.y; sp[i + 2] = v.z
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xaeb8c0, size: 1.4, sizeAttenuation: false, depthWrite: false }))
    this.stars.renderOrder = -1
    this.stars.frustumCulled = false
    this.scene.add(this.stars)

    const n = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 4)
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e) => { this.idle.push(w); this.receive(e.data) }
      this.workers.push(w); this.idle.push(w)
    }

    canvas.addEventListener('pointerdown', this.down)
    canvas.addEventListener('pointermove', this.move)
    canvas.addEventListener('pointerup', this.up)
    canvas.addEventListener('pointercancel', this.up)
    canvas.addEventListener('pointerleave', this.leave)
    canvas.addEventListener('wheel', this.wheel, { passive: false })
    canvas.addEventListener('contextmenu', this.noMenu)
    canvas.addEventListener('keydown', this.key)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(canvas.parentElement ?? canvas)
    this.resize()
    if (this.camera.aspect < 1) this.goal.dist = this.cur.dist = 2.6 / this.camera.aspect // fit the globe on narrow screens
    this.loop()
  }

  setWorld(world: World) {
    // names, notes and layers don't change the ground, so editing them doesn't rebuild the planet
    const spec = groundSpec(world)
    const layers = JSON.stringify(world.layers ?? [])
    this.world = world
    if (spec === this.spec) {
      if (layers !== this.layersSpec) { this.layersSpec = layers; this.buildOverlays() }
      return
    }
    this.spec = spec; this.layersSpec = layers
    this.planet = makePlanet(world)
    this.gen++
    for (const t of this.tiles.values()) this.drop(t)
    this.tiles.clear(); this.queue = []
    this.buildOverlays()
  }
  private world?: World
  private layersSpec = ''

  // Rivers and layers as draped lines/points/fills, so they read from orbit where carved channels are sub-pixel.
  private overlays: THREE.Object3D[] = []
  private drapeGeom(lls: LatLon[], sizes?: number[]) {
    const p = this.planet!, pos: number[] = [], h: number[] = []
    for (const ll of lls) {
      const d = toDir(ll[0], ll[1])
      pos.push(...d); h.push(p.surface(d[0], d[1], d[2], p.elevation(d[0], d[1], d[2], 4)) / p.radiusM)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('h', new THREE.Float32BufferAttribute(h, 1))
    if (sizes) g.setAttribute('size', new THREE.Float32BufferAttribute(sizes.map((s) => s * this.renderer.getPixelRatio()), 1))
    return g
  }
  private segs = (lines: LatLon[][]) => lines.flatMap((l) => l.slice(1).flatMap((q, i) => [l[i], q]))
  private addOverlay(list: THREE.Object3D[], o: THREE.Mesh | THREE.LineSegments | THREE.Points, order: number) {
    ;(o.material as THREE.ShaderMaterial).uniforms.exag = this.exag
    o.frustumCulled = false
    o.renderOrder = order
    this.scene.add(o); list.push(o)
  }
  private clearOverlays(list: THREE.Object3D[]) {
    for (const o of list.splice(0) as THREE.Mesh[]) { this.scene.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose() }
  }
  private buildOverlays() {
    this.clearOverlays(this.overlays)
    this.hiKey = ''; this.clearOverlays(this.hi)
    const p = this.planet!, w = this.world!, add = this.addOverlay.bind(this, this.overlays)
    const rivers = (w.ops ?? []).flatMap((op) => (op.kind === 'river' ? [p.course(op)] : []))
    if (rivers.length) add(new THREE.LineSegments(this.drapeGeom(this.segs(rivers)), drapeMat(0x4fa3e8, 0.9)), 2)
    for (const l of w.layers ?? []) {
      if (l.hidden) continue
      const col = layerColor(l), a = l.opacity ?? 1
      const fills: LatLon[] = []
      for (const it of l.items) {
        if (!it.area || it.area.length < 3) continue
        // triangulate in unwrapped lat/lon (fine unless a region straddles a pole), then subdivide
        const lon0 = it.area[0][1], ring = it.area.map(([la, lo]): LatLon => [la, lon0 + wrap(lo - lon0)])
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring.map(([la, lo]) => new THREE.Vector2(lo, la)), [])) splitTri(ring[i], ring[j], ring[k], fills)
      }
      if (fills.length) add(new THREE.Mesh(this.drapeGeom(fills), drapeMat(col, a * 0.3)), 1)
      const lines = l.items.flatMap((it) => (it.path ? [it.path] : it.area ? [[...it.area, it.area[0]]] : []))
      if (lines.length) add(new THREE.LineSegments(this.drapeGeom(this.segs(lines)), drapeMat(col, a * 0.9)), 3)
      const pts = l.items.filter((it) => it.at)
      if (pts.length) add(new THREE.Points(this.drapeGeom(pts.map((it) => it.at!), pts.map(pointSize)), drapeMat(col, a, true)), 5)
    }
    this.dirty = true
  }

  // hover highlight: the feature's outline drawn white on top
  private hi: THREE.Object3D[] = []
  private hiKey = ''
  private highlight(f: Feature | undefined, ptKm: number) {
    const key = f ? refKey(f.ref) : ''
    if (key === this.hiKey) return
    this.hiKey = key
    this.clearOverlays(this.hi)
    this.canvas.style.cursor = f ? 'pointer' : ''
    if (f) {
      const lines = outline(f, this.planet!.radiusM / 1000, ptKm, (op) => this.planet!.course(op))
      this.addOverlay(this.hi, new THREE.LineSegments(this.drapeGeom(this.segs(lines)), drapeMat(0xffffff, 1)), 6)
    }
    this.dirty = true
  }

  setRelief(m: number) { this.relief = m; this.dirty = true }

  flyTo(lat: number, lon: number, dist?: number) {
    this.goal.lat = clamp(lat, -89, 89); this.goal.lon = wrap(lon)
    if (dist) this.goal.dist = dist
    this.dirty = true
  }

  zoomBy(f: number) { this.goal.dist = clamp(this.goal.dist * f, this.minDist(), 6); this.dirty = true }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    for (const w of this.workers) w.terminate()
    for (const t of this.tiles.values()) this.drop(t)
    const c = this.canvas
    c.removeEventListener('pointerdown', this.down); c.removeEventListener('pointermove', this.move)
    c.removeEventListener('pointerup', this.up); c.removeEventListener('pointercancel', this.up)
    c.removeEventListener('pointerleave', this.leave); c.removeEventListener('wheel', this.wheel)
    c.removeEventListener('contextmenu', this.noMenu); c.removeEventListener('keydown', this.key)
    this.clearOverlays(this.overlays); this.clearOverlays(this.hi)
    this.material.dispose(); this.renderer.dispose()
  }

  // ---------- tiles ----------
  private tile(face: number, level: number, x: number, y: number) {
    const key = `${face}/${level}/${x}/${y}`
    let t = this.tiles.get(key)
    if (!t) {
      t = { key, face, level, x, y, center: new THREE.Vector3(...tileCenter(face, level, x, y)), pending: false, used: 0 }
      this.tiles.set(key, t)
    }
    return t
  }
  private kids(t: Tile) {
    const l = t.level + 1, x = t.x * 2, y = t.y * 2
    return [this.tile(t.face, l, x, y), this.tile(t.face, l, x + 1, y), this.tile(t.face, l, x, y + 1), this.tile(t.face, l, x + 1, y + 1)]
  }
  // behind the horizon or outside the view frustum (bounds padded for exaggerated relief)
  private hidden(t: Tile, v: { camDir: THREE.Vector3; horizon: number; frustum: THREE.Frustum; pad: number }) {
    const r = tileAngle(t.level) * 0.75
    if (Math.acos(clamp(t.center.dot(v.camDir), -1, 1)) > v.horizon + r + 0.03) return true
    return !v.frustum.intersectsSphere(this.sphere.set(t.center, r + v.pad))
  }
  private sphere = new THREE.Sphere()
  private want(t: Tile) {
    if (t.pending || t.mesh) return
    t.pending = true
    this.queue.push(t)
  }
  private receive(m: { key: string; gen: number; t: TileData }) {
    const t = this.tiles.get(m.key)
    if (m.gen !== this.gen || !t) return
    t.pending = false
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.t.pos, 3))
    g.setAttribute('up', new THREE.BufferAttribute(m.t.up, 3))
    g.setAttribute('h', new THREE.BufferAttribute(m.t.h, 1))
    g.setAttribute('grad', new THREE.BufferAttribute(m.t.grad, 3))
    g.setAttribute('color', new THREE.BufferAttribute(m.t.col, 3))
    g.setIndex(this.index)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), tileAngle(t.level) * 0.8 + 0.08)
    const mesh = new THREE.Mesh(g, this.material)
    mesh.position.copy(t.center)
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    mesh.visible = false
    t.mesh = mesh
    this.scene.add(mesh)
    this.dirty = true
  }
  private drop(t: Tile) {
    if (!t.mesh) return
    this.scene.remove(t.mesh)
    t.mesh.geometry.index = null // the index buffer is shared; don't let dispose() delete it
    t.mesh.geometry.dispose()
    t.mesh = undefined
  }

  private updateTiles() {
    const cam = this.camera.position, cl = cam.length()
    const camDir = cam.clone().normalize()
    const horizon = Math.acos(clamp(1 / cl, 0, 1))
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse))
    const v = { camDir, horizon, frustum, pad: 9000 / (this.planet?.radiusM ?? 6e6) * this.exag.value + 1e-4 }
    const draw = new Set<Tile>()
    const visit = (t: Tile) => {
      t.used = this.frame
      if (this.hidden(t, v)) return
      if (!t.mesh) { this.want(t); return }
      if (t.level < MAX_LEVEL && cam.distanceTo(t.center) < tileAngle(t.level) * SPLIT) {
        const kids = this.kids(t)
        if (kids.every((k) => k.mesh || this.hidden(k, v))) { kids.forEach(visit); return }
        for (const k of kids) { k.used = this.frame; if (!this.hidden(k, v)) this.want(k) }
      }
      draw.add(t)
    }
    for (let f = 0; f < 6; f++) visit(this.tile(f, 0, 0, 0))
    for (const t of this.tiles.values()) if (t.mesh) t.mesh.visible = draw.has(t)

    // dispatch: coarse and near first; forget requests nobody needs any more
    this.queue = this.queue.filter((t) => { if (t.used >= this.frame - 1) return true; t.pending = false; return false })
    this.queue.sort((a, b) => a.level - b.level || cam.distanceTo(a.center) - cam.distanceTo(b.center))
    while (this.idle.length && this.queue.length) {
      const t = this.queue.shift()!
      this.idle.pop()!.postMessage({ world: this.spec, face: t.face, level: t.level, x: t.x, y: t.y, key: t.key, gen: this.gen })
    }
    // evict least recently used meshes beyond the cap; level 0 stays
    if (this.tiles.size > MAX_TILES) {
      const old = [...this.tiles.values()].filter((t) => t.level > 0 && t.used < this.frame - 2 && !t.pending).sort((a, b) => a.used - b.used)
      for (const t of old.slice(0, this.tiles.size - MAX_TILES)) { this.drop(t); this.tiles.delete(t.key) }
    }
    if (this.queue.length || this.idle.length < this.workers.length) this.dirty = true
  }

  // ---------- camera ----------
  private minDist() { return this.planet ? 60 / this.planet.radiusM : 1e-5 }
  private ground(d: THREE.Vector3) {
    if (!this.planet) return 0
    return Math.max(0, this.planet.elevation(d.x, d.y, d.z, 4)) / this.planet.radiusM * this.exag.value
  }

  private placeCamera() {
    const g = this.goal, c = this.cur
    const k = 0.22
    c.lat += (g.lat - c.lat) * k
    c.lon = wrap(c.lon + wrap(g.lon - c.lon) * k)
    c.dist = Math.exp(Math.log(c.dist) + (Math.log(g.dist) - Math.log(c.dist)) * k)
    c.heading += (g.heading - c.heading) * k
    c.tilt += (g.tilt - c.tilt) * k
    const moving = Math.abs(g.lat - c.lat) + Math.abs(wrap(g.lon - c.lon)) > 1e-7 || Math.abs(Math.log(g.dist / c.dist)) > 1e-4 ||
      Math.abs(g.heading - c.heading) + Math.abs(g.tilt - c.tilt) > 1e-5

    // relief exaggeration: dramatic from orbit, near true scale on the ground
    const zt = clamp((Math.log10(c.dist) - Math.log10(0.0005)) / (Math.log10(3) - Math.log10(0.0005)), 0, 1)
    this.exag.value = (1.5 + 18 * zt ** 3) * this.relief

    const U = new THREE.Vector3(...toDir(c.lat, c.lon))
    const T = U.clone().multiplyScalar(1 + this.ground(U))
    const E = new THREE.Vector3(0, 1, 0).cross(U)
    if (E.lengthSq() < 1e-9) E.set(1, 0, 0)
    E.normalize()
    const N = U.clone().cross(E)
    const F = N.clone().multiplyScalar(Math.cos(c.heading)).addScaledVector(E, Math.sin(c.heading))
    const tiltMax = clamp((Math.log10(0.8) - Math.log10(c.dist)) / (Math.log10(0.8) - Math.log10(0.003)), 0, 1) * 78 * DEG
    const t = Math.min(c.tilt, tiltMax)
    const C = T.clone().addScaledVector(U, c.dist * Math.cos(t)).addScaledVector(F, -c.dist * Math.sin(t))
    const floor = 1 + this.ground(C.clone().normalize()) + this.minDist() * 0.5
    if (C.length() < floor) C.setLength(floor)

    const cam = this.camera
    cam.position.copy(C)
    cam.up.copy(F).multiplyScalar(Math.cos(t)).addScaledVector(U, Math.sin(t))
    cam.lookAt(T)
    cam.updateMatrixWorld()
    const alt = C.length() - 1
    cam.near = Math.max(1e-7, alt * 0.2)
    cam.far = Math.max(C.length() + 2, 10)
    cam.updateProjectionMatrix()

    // light from the upper-left of the screen, so terrain is always hill-shaded toward the viewer
    const Rt = E.clone().multiplyScalar(Math.cos(c.heading)).addScaledVector(N, -Math.sin(c.heading))
    this.sun.position.copy(T).addScaledVector(U, 0.6).addScaledVector(F, 0.55).addScaledVector(Rt, -0.6)
    this.sun.target.position.copy(T)
    this.sun.target.updateMatrixWorld()

    // near the ground the sky brightens and space effects fade
    const skyT = clamp((Math.log10(0.05) - Math.log10(alt)) / (Math.log10(0.05) - Math.log10(0.0015)), 0, 1)
    ;(this.scene.background as THREE.Color).copy(this.space).lerp(this.sky, skyT)
    this.atmo.visible = C.length() > 1.04
    this.stars.visible = skyT < 0.6
    this.stars.position.copy(C)
    this.onView?.({ altitudeKm: alt * (this.planet?.radiusM ?? 6e6) / 1000, lat: c.lat, lon: c.lon })
    return moving
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (!this.planet) return
    const moving = this.placeCamera()
    if (moving) this.dirty = true
    if (!this.dirty) return
    this.dirty = false
    this.frame++
    this.updateTiles()
    this.renderer.render(this.scene, this.camera)
    if (this.mouse) this.hover(this.mouse.x, this.mouse.y)
  }

  private resize() {
    const p = this.canvas.parentElement ?? this.canvas
    const w = p.clientWidth, h = p.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  // ---------- input ----------
  private pick(px: number, py: number) {
    const r = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3())
    return hit?.normalize()
  }
  // the feature under the cursor, with ~8px of slack on the ground
  private featureAt(d: THREE.Vector3) {
    const km = this.planet!.radiusM / 1000
    const kmPerPx = this.camera.position.distanceTo(d) * 2 * Math.tan(this.camera.fov * DEG / 2) / this.canvas.clientHeight * km
    const ll = toLatLon(d.x, d.y, d.z)
    return { f: this.world && pickFeature(this.world, [ll.lat, ll.lon], kmPerPx * 8, km), kmPerPx }
  }
  private hover(px: number, py: number) {
    const d = this.pick(px, py)
    if (!d || !this.planet) { this.highlight(undefined, 0); this.onHover?.(null); return }
    const h = this.planet.elevation(d.x, d.y, d.z, 6)
    const { f, kmPerPx } = this.drag ? { f: undefined, kmPerPx: 0 } : this.featureAt(d)
    this.highlight(f, kmPerPx * 7)
    this.onHover?.({ ...toLatLon(d.x, d.y, d.z), elevation: h, biome: this.planet.biome(d.x, d.y, d.z, h), feature: f })
  }

  private down = (e: PointerEvent) => {
    this.canvas.focus()
    this.canvas.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.drag = { button: e.button === 2 || e.shiftKey || e.ctrlKey ? 2 : 0, x: e.clientX, y: e.clientY, moved: 0 }
  }
  private move = (e: PointerEvent) => {
    this.mouse = { x: e.clientX, y: e.clientY }
    const prev = this.pointers.get(e.pointerId)
    if (prev && this.pointers.size === 2) {
      // pinch zoom
      const [a, b] = [...this.pointers.values()]
      const before = Math.hypot(a.x - b.x, a.y - b.y)
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const [c, d] = [...this.pointers.values()]
      const after = Math.hypot(c.x - d.x, c.y - d.y)
      if (before > 0 && after > 0) this.zoomBy(before / after)
      return
    }
    if (prev) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (!this.drag) { this.dirty = true; return }
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y
    this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved += Math.abs(dx) + Math.abs(dy)
    const g = this.goal
    if (this.drag.button === 2) {
      g.heading -= dx * 0.005
      g.tilt = clamp(g.tilt - dy * 0.005, 0, 80 * DEG)
    } else {
      const k = (this.cur.dist * 2 * Math.tan(this.camera.fov * DEG / 2)) / this.canvas.clientHeight / DEG // degrees per pixel
      const dn = (Math.cos(g.heading) * dy + Math.sin(g.heading) * dx) * k
      const de = (Math.sin(g.heading) * dy - Math.cos(g.heading) * dx) * k
      g.lat = clamp(g.lat + dn, -89, 89)
      g.lon = wrap(g.lon + de / Math.max(0.05, Math.cos(g.lat * DEG)))
    }
    this.dirty = true
  }
  private up = (e: PointerEvent) => {
    const click = e.type === 'pointerup' && this.drag?.button === 0 && this.drag.moved < 5 && this.pointers.size === 1
    this.pointers.delete(e.pointerId); this.drag = undefined
    const d = click && this.planet ? this.pick(e.clientX, e.clientY) : undefined
    if (click) this.onClick?.(d && this.featureAt(d).f, e.clientX, e.clientY)
  }
  private leave = () => { this.mouse = undefined; this.highlight(undefined, 0); this.onHover?.(null) }
  private wheel = (e: WheelEvent) => { e.preventDefault(); this.zoomBy(Math.exp(e.deltaY * 0.0015)) }
  private noMenu = (e: Event) => e.preventDefault()
  private key = (e: KeyboardEvent) => {
    const g = this.goal, step = Math.min(10, this.cur.dist * 8) // degrees
    const k = e.key
    if (k === 'ArrowUp') g.lat = clamp(g.lat + step, -89, 89)
    else if (k === 'ArrowDown') g.lat = clamp(g.lat - step, -89, 89)
    else if (k === 'ArrowLeft') g.lon = wrap(g.lon - step)
    else if (k === 'ArrowRight') g.lon = wrap(g.lon + step)
    else if (k === '+' || k === '=') this.zoomBy(0.7)
    else if (k === '-' || k === '_') this.zoomBy(1 / 0.7)
    else if (k === 'q') g.heading += 0.1
    else if (k === 'e') g.heading -= 0.1
    else return
    e.preventDefault()
    this.dirty = true
  }
}

