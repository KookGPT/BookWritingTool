// The flat world wrapped on a sphere at true size, for the Globe tab: view only. The map is drawn in quadtree tiles on a plain ocean
// sphere, lit like the flat map (same colours, height texture and toon light), with no trees, clouds or effects. The planet leans on
// its axis in a solar system (solarScene.ts). Normally it is evenly lit so the map stays readable and nothing moves until you do;
// Cinematic mode runs the clock: it turns, the sun lights one side only, the seasons go round. Units are km.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DETAIL_M, type Gen } from './gen.ts'
import { COMMON, TILE, tileGeometry, uniforms, type Built } from './scene.ts'
import { northAxis, seasonOf, START_DAY, sunDir, TILT_DEG, YEAR_DAYS } from './solar.ts'
import { NOISE3, SolarSky } from './solarScene.ts'
import { planetKm, toSphere } from './sphere.ts'

const FOV = 35, MAX_TILES = 4096
const DEEP = 'vec3(.07, .24, .52)' // open sea: the flat map's deepest water
const NEAR_SCALE = 0.4 // heights ease to this share of full exaggeration up close, as on the flat map
const MAX_TILT = 0.85 // radians from straight down, near the ground

// Shared by land and sea, in the planet's own frame (y = its axis). Roundness: both darken slightly towards the edge of the disc and
// pick up a blue haze. uReal is 0 for the evenly lit map, 1 for real sunlight: night, red dusk, sun on the water, polar sea ice that
// grows in winter. uSeason is 1 at northern midsummer, -1 at northern midwinter.
const SPACE = /* glsl */ `
uniform vec3 uSunP; uniform vec3 uCamP; uniform float uReal; uniform float uSeason;
${NOISE3}
float seaIce(vec3 dir) {
  if (uReal < .001) return 0.;
  float lat = asin(clamp(dir.y, -1., 1.)), over = abs(lat) - (1.22 + .24 * uSeason * sign(lat));
  return over < -.3 ? 0. : uReal * smoothstep(-.03, .03, over + (fbm3(dir * 6.) - .5) * .35);
}
vec3 inSpace(vec3 col, vec3 dir, vec3 pos, float wet) {
  vec3 view = normalize(uCamP - pos);
  float f = clamp(dot(dir, view), 0., 1.), s = dot(dir, uSunP), day = mix(1., smoothstep(-.1, .16, s), uReal);
  col *= mix(.72, 1., smoothstep(0., .55, f));
  col = mix(col, mix(vec3(.55, .75, 1.), vec3(1., .6, .35), uReal * smoothstep(.3, 0., abs(s))), pow(1. - f, 3.) * .45);
  col += wet * uReal * vec3(1., .9, .75) * pow(max(dot(reflect(-uSunP, dir), view), 0.), 220.) * .9;
  return col * mix(vec3(.035, .05, .1), vec3(1.), day);
}`

const groundMat = (u: ReturnType<typeof uniforms>, light: Record<string, THREE.IUniform>, t: Record<'tColor' | 'tData' | 'tRivers' | 'tWarm', THREE.Texture>, R: number) => new THREE.ShaderMaterial({
  uniforms: { ...u, ...light, tColor: { value: t.tColor }, tData: { value: t.tData }, tRivers: { value: t.tRivers }, tWarm: { value: t.tWarm }, uR: { value: R } },
  vertexShader: COMMON + /* glsl */ `
    attribute vec3 iTile; // x0, y0 (south-west corner, km), size
    uniform float uR; uniform sampler2D tData; varying vec2 vXY; varying vec3 vDir; varying vec3 vPos; varying vec3 vN; varying float vEdge;
    vec3 surfaceDir(vec2 p) { // toSphere in sphere.ts
      if (uDiscR > 0.) { float r = max(length(p), 1e-6), c = r / uR; return vec3(p * sin(c) / r, cos(c)); }
      float lat = p.y / uR, lon = p.x / uR;
      return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    }
    void main() {
      vec2 xy = clamp(iTile.xy + position.xy * iTile.z, -uSize * .5, uSize * .5);
      float cell = uSize.x / uGrid.x, e = max(cell, iTile.z / ${TILE}.);
      vec2 side = uSize * .5 - abs(xy);
      vEdge = uDiscR > 0. ? uDiscR - length(xy) : min(side.x, side.y);
      float k = uE * uHScale / (2. * e);
      vN = vec3(-(hRaw(xy + vec2(e, 0.)) - hRaw(xy - vec2(e, 0.))) * k, 1., (hRaw(xy + vec2(0., e)) - hRaw(xy - vec2(0., e))) * k);
      vec4 dat = textureLod(tData, mapUV(xy), 0.);
      float h = max(hRaw(xy) + (dat.g > .5 ? dat.r * 1200. : 0.), 0.) * smoothstep(0., cell * 3., vEdge); // lakes lie level at their surface; land dips to the sea at a cut edge, so the patch has no gap under it
      vXY = xy; vDir = surfaceDir(xy); vPos = vDir * (uR + dispY(h) - position.z * iTile.z * .04); // skirts hang below tile edges to hide cracks
      gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos, 1.);
    }`,
  fragmentShader: COMMON + SPACE + /* glsl */ `
    uniform sampler2D tColor; uniform sampler2D tData; uniform sampler2D tRivers; uniform sampler2D tWarm; uniform float uFall;
    varying vec2 vXY; varying vec3 vDir; varying vec3 vPos; varying vec3 vN; varying float vEdge;
    float rough(vec2 p) { return detailN(p) * roughAt(p) * ${DETAIL_M.toFixed(1)}; }
    void main() {
      if (vEdge < 0.) discard;
      vec2 uv = mapUV(vXY);
      float cell = uSize.x / uGrid.x, aa = fwidth(vXY.x) + fwidth(vXY.y);
      vec4 t = texture(tColor, uv), dat = texture(tData, uv);

      // sea, fading into the open ocean towards the map's edge
      float d = max(dat.r, 1. - smoothstep(0., max(uSize.x, uSize.y) * .03, vEdge));
      vec3 sea = mix(vec3(.38, .86, .82), vec3(.16, .58, .80), smoothstep(.015, .07, d));
      sea = mix(sea, vec3(.10, .34, .64), smoothstep(.22, .45, d));
      sea = mix(sea, ${DEEP}, smoothstep(.7, 1., d));
      sea = mix(sea, vec3(.88, .93, .98), seaIce(vDir));

      // land: the flat map's colours and toon light, with its close-up detail once it is big enough to see
      vec3 n = vN;
      if (aa < cell) {
        float e = max(aa, .4), k = uE * uHScale / (2. * e), fade = 1. - smoothstep(cell * .4, cell, aa);
        n += fade * vec3(-(rough(vXY + vec2(e, 0.)) - rough(vXY - vec2(e, 0.))) * k, 0., (rough(vXY + vec2(0., e)) - rough(vXY - vec2(0., e))) * k);
      }
      vec3 base = t.rgb * (.92 + .1 * vnoise(vXY * .3));
      if (uReal > .001) { // the seasons: each hemisphere warms and cools; snow comes down in winter, cold lands thaw in summer, leaves turn
        float lat = asin(clamp(vDir.y, -1., 1.)), hemi = sign(lat) * smoothstep(.12, .75, abs(lat)), swing = uSeason * hemi;
        float w0 = texture(tWarm, uv).r * 1.6 - .3, te = w0 + .3 * swing + (vnoise(vXY * .012) - .5) * .1;
        float leafy = smoothstep(.02, .12, base.g - max(base.r, base.b)) * smoothstep(.28, .4, te) * smoothstep(.8, .6, te);
        base = mix(base, vec3(.66, .68, .57), uReal * smoothstep(.1, .28, te) * smoothstep(.17, .07, w0));
        base = mix(base, base.ggg * vec3(1.18, .72, .32), uReal * leafy * max(0., sign(lat) * uFall) * .8);
        base = mix(base, vec3(.5, .46, .37), uReal * leafy * smoothstep(-.1, -.8, swing) * .65);
        base = mix(base, vec3(.93, .95, 1.), uReal * smoothstep(.22, .1, te));
      }
      // the sun as this spot sees it: east, up, south, like the flat map's normals; the evenly lit map keeps the flat map's fixed sun
      vec3 east = normalize(vec3(vDir.z, 0., -vDir.x) + vec3(1e-5, 0., 0.)), north = cross(vDir, east);
      vec3 sunHere = normalize(mix(uSun, vec3(dot(uSunP, east), dot(uSunP, vDir), -dot(uSunP, north)), uReal));
      vec3 land = lit(base, dot(normalize(n), sunHere)) * mix(.62, 1., dat.a);
      land = mix(land, vec3(1., .42, .1) * 1.25, clamp(1. - t.a, 0., 1.)); // lava
      land = mix(land, vec3(.20, .55, .84), smoothstep(.08, .5, texture(tRivers, uv).r));

      float h = hRaw(vXY), fw = fwidth(h) + 1.;
      float wet = max(1. - smoothstep(-fw, fw, h), step(.5, dat.g) * smoothstep(.001, .008, dat.r)); // sea below zero; lakes by their mask, where the ground is under their surface
      vec3 col = mix(land, sea, wet);
      col = mix(col, vec3(.16, .2, .3), (1. - smoothstep(fw * .7, fw * 1.8, abs(h - 5.))) * .7 * smoothstep(0., cell, vEdge)); // coast ink
      gl_FragColor = vec4(inSpace(col, vDir, vPos, wet), 1.);
    }`,
})

const oceanMat = (light: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
  uniforms: light,
  vertexShader: `varying vec3 vDir; varying vec3 vPos;
    void main() { vDir = normalize(position); vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: SPACE + `varying vec3 vDir; varying vec3 vPos;
    void main() { gl_FragColor = vec4(inSpace(mix(${DEEP}, vec3(.88, .93, .98), seaIce(vDir)), vDir, vPos, 1.), 1.); }`,
})

// Glow just outside the planet (the old globe's rim); in real light only the sunlit side, reddening at dusk.
const airMat = (light: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uSunW: light.uSunW, uReal: light.uReal },
  vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position,1.); vN = normalize(position); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `uniform vec3 uSunW; uniform float uReal; varying vec3 vN; varying vec3 vV;
    void main(){ float f = clamp(-dot(vN, vV) / 0.26, 0., 1.), s = dot(vN, uSunW), day = mix(1., smoothstep(-.3, .2, s), uReal);
      gl_FragColor = vec4(mix(vec3(.416, .651, .878), vec3(1., .55, .3), uReal * smoothstep(.3, .0, abs(s))) * pow(f, 3.) * .75 * day, 1.); }`,
})

/** River courses as a mask, finer than the height grid. North is the top row, like the data textures. */
function riverMask(g: Gen) {
  const long = Math.max(g.W, g.H), cv = document.createElement('canvas'), k = Math.min(6144, Math.max(4096, long / 3.2)) / long
  cv.width = Math.round(g.W * k); cv.height = Math.round(g.H * k)
  const c = cv.getContext('2d')!
  c.fillRect(0, 0, cv.width, cv.height)
  c.strokeStyle = '#fff'; c.lineCap = 'round'
  for (const r of g.rivers) for (let n = 1; n < r.pts.length; n++) {
    c.lineWidth = 2 * k * Math.max(r.width[n] * 1.5, g.cell * (r.minor ? 0.6 : 1.1)) // as wide as the flat map's ribbons
    c.beginPath(); c.moveTo((r.pts[n - 1][0] + g.W / 2) * k, (g.H / 2 - r.pts[n - 1][1]) * k); c.lineTo((r.pts[n][0] + g.W / 2) * k, (g.H / 2 - r.pts[n][1]) * k); c.stroke()
  }
  const t = new THREE.CanvasTexture(cv)
  t.flipY = false
  return t
}

export class GlobeScene {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(FOV, 1, 1, 100)
  rig = new THREE.PerspectiveCamera() // the controls drive this one straight above the ground; `camera` then leans back from the same spot
  controls: OrbitControls
  sky = new SolarSky()
  private u = uniforms()
  private light = { uSunP: { value: new THREE.Vector3() }, uCamP: { value: new THREE.Vector3() }, uSunW: { value: new THREE.Vector3() }, uReal: { value: 0 }, uSeason: { value: 0 }, uFall: { value: 0 } }
  private planet = new THREE.Group() // the turning world; the camera, sun and sky stay in the fixed frame around it
  private air?: THREE.Mesh
  private lean = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...northAxis()))
  private inverse = new THREE.Quaternion()
  private t = START_DAY // days on the clock
  private spin = 0 // radians the planet has turned
  private manual = 0 // when the viewer last moved the camera themselves, Cinematic mode leaves it alone for a while
  private settling = false // on the way to Cinematic mode's distance
  private last = 0
  private season = ''
  cinematic = false
  speed = 0.1 // days per second
  onSeason?: (label: string) => void
  private R = 0
  private gen?: Gen
  private ground?: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private tiles = new Float32Array(MAX_TILES * 3)
  private dirty = true
  private raf = 0
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }) // drawn only on change, so keep the last frame
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.autoClear = false
    this.scene.add(this.planet, this.sky.system)
    this.rig.up.set(...northAxis()) // dragging turns around the planet's own axis; it has to be set before the controls exist
    this.controls = new OrbitControls(this.rig, canvas)
    Object.assign(this.controls, { enablePan: false, enableDamping: true, dampingFactor: 0.12 })
    this.controls.addEventListener('start', this.grabbed)
    canvas.addEventListener('keydown', this.onKey)
    this.resize()
    this.loop()
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  setWorld(b: Built) {
    this.clear()
    const g = this.gen = b.gen, u = this.u, R = this.R = planetKm(g.W, g.H, g.disc)
    u.uDiscR.value = g.disc ? g.W / 2 : 0
    u.uSize.value.set(g.W, g.H); u.uGrid.value.set(g.w, g.h); u.uE.value = g.exag / 1000
    const tex = (data: Float32Array | Uint8Array, fmt: THREE.PixelFormat, type: THREE.TextureDataType = THREE.UnsignedByteType) => {
      const t = new THREE.DataTexture(data, g.w, g.h, fmt, type)
      t.needsUpdate = true
      return t
    }
    const smooth = (t: THREE.DataTexture) => { // mipmaps: the whole map is only a few hundred pixels across from orbit
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      return t
    }
    u.tHeight.value = tex(g.height, THREE.RedFormat, THREE.FloatType) // read with texelFetch, nearest
    const rough = tex(g.rough, THREE.RedFormat)
    rough.magFilter = rough.minFilter = THREE.LinearFilter
    u.tRough.value = rough
    this.planet.add(new THREE.Mesh(new THREE.SphereGeometry(R - 1, 192, 128), oceanMat(this.light))) // a km under the map's sea level, so the two never fight
    const geo = new THREE.InstancedBufferGeometry(), base = tileGeometry()
    geo.setAttribute('position', base.attributes.position); geo.setIndex(base.index)
    geo.setAttribute('iTile', new THREE.InstancedBufferAttribute(this.tiles, 3).setUsage(THREE.DynamicDrawUsage))
    const warm = tex(g.warm, THREE.RedFormat)
    warm.magFilter = warm.minFilter = THREE.LinearFilter
    this.ground = new THREE.Mesh(geo, groundMat(u, this.light, { tColor: smooth(tex(g.rgba, THREE.RGBAFormat)), tData: smooth(tex(g.data, THREE.RGBAFormat)), tRivers: riverMask(g), tWarm: warm }, R))
    this.ground.frustumCulled = false
    this.planet.add(this.ground)
    this.air = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 96, 64), airMat(this.light))
    this.scene.add(this.air)

    const c = this.controls
    c.minDistance = R + (g.maxH * u.uE.value * NEAR_SCALE + 40) / Math.cos(MAX_TILT) // never inside a mountain, even over the tallest
    c.maxDistance = R * 14
    // start framed on the map: the whole planet with its axis for a big one, closer for a small one
    const alt = Math.hypot(g.W, g.H) / (2 * Math.tan(FOV * Math.PI / 360))
    this.rig.position.set(0, 0, Math.max(c.minDistance, Math.min(R * 5, R + alt)))
    this.dirty = true
  }

  // Grab the ground: rotation and zoom slow down with height above the surface. Near the ground the camera leans back, still looking
  // at the point it would look straight down on, so zooming always heads for the middle of the screen.
  private place() {
    const c = this.controls, cam = this.camera, rig = this.rig, R = this.R, d = rig.position.length(), alt = d - R, Y = new THREE.Vector3(0, 1, 0)
    c.rotateSpeed = Math.min(1, alt * Math.tan(FOV * Math.PI / 360) / (Math.PI * R))
    c.zoomSpeed = Math.max(0.05, 2 * alt / d)
    const moved = c.update()
    const near = 1 - THREE.MathUtils.smoothstep(alt, R * 0.04, R * 0.5), tilt = near * MAX_TILT
    const down = rig.position.clone().normalize(), focus = down.clone().multiplyScalar(R), up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.quaternion)
    cam.position.copy(focus).addScaledVector(down, alt * Math.cos(tilt)).addScaledVector(up, -alt * Math.sin(tilt))
    cam.up.copy(up).multiplyScalar(Math.cos(tilt)).addScaledVector(down, Math.sin(tilt))
    // from space the orbit is level and the axis visibly leans; near the ground north is up, for reading the map
    cam.up.lerp(Y, (1 - near) * (1 - THREE.MathUtils.smoothstep(Math.abs(down.y), 0.85, 0.98)))
    cam.lookAt(focus)
    cam.near = Math.max(1, alt * 0.05); cam.far = cam.position.length() + R * 40
    cam.updateProjectionMatrix()
    this.u.uHScale.value = 1 - (1 - NEAR_SCALE) * near
    return moved
  }

  // The clock. Cinematic mode runs it, and eases between the evenly lit map and real sunlight.
  private tick(now: number) {
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000)), l = this.light
    this.last = now
    if (this.cinematic && this.speed) { const days = dt * this.speed; this.t += days; this.spin += days * Math.PI * 2; this.dirty = true }
    const want = this.cinematic ? 1 : 0
    if (l.uReal.value !== want) { l.uReal.value = Math.abs(want - l.uReal.value) < 0.004 ? want : l.uReal.value + (want - l.uReal.value) * Math.min(1, dt * 2.5); this.dirty = true }
    if (this.cinematic) this.aim(dt, now)
    const label = seasonOf(this.t)
    if (label !== this.season) { this.season = label; this.onSeason?.(label) }
  }

  // Cinematic camera: stays with the sun through the year and swings slowly from a sunlit face round to a crescent with the sun behind it.
  private aim(dt: number, now: number) {
    if (now < this.manual) return
    const sun = sunDir(this.t), a = Math.atan2(sun[2], sun[0]), Y = YEAR_DAYS, DEG = Math.PI / 180
    const b = (92 + 58 * Math.sin(Math.PI * 2 * this.t / (Y * 0.6))) * DEG, e = (11 + 12 * Math.sin(Math.PI * 2 * this.t / (Y * 0.37))) * DEG
    const goal = new THREE.Vector3(Math.cos(a + b) * Math.cos(e), Math.sin(e), Math.sin(a + b) * Math.cos(e)), p = this.rig.position
    let d = p.length()
    if (this.settling) { const to = this.R * 5; d += (to - d) * (1 - Math.exp(-dt * 1.2)); if (Math.abs(to - d) < this.R * 0.01) this.settling = false }
    p.normalize().lerp(goal, 1 - Math.exp(-dt * 0.7)).normalize().multiplyScalar(d)
    this.dirty = true
  }

  private grabbed = () => { this.manual = performance.now() + 9000; this.settling = false }

  /** Cinematic on or off, its speed, and what is drawn in the sky. */
  set(o: { cinematic: boolean; speed: number; axis: boolean; lines: boolean }) {
    if (o.cinematic && !this.cinematic) { this.settling = true; this.manual = 0 }
    this.cinematic = o.cinematic; this.speed = o.speed
    this.sky.guides.visible = o.axis; this.sky.lines.visible = o.lines
    this.dirty = true
  }

  // Tiles fine enough for their distance from the camera, skipping those over the horizon.
  private updateTiles(g: Gen, cam: THREE.Vector3) {
    const R = this.R, out = this.tiles, horizon = Math.acos(Math.min(1, R / cam.length()))
    const up = cam.clone().normalize(), p = new THREE.Vector3()
    const maxS = TILE * 80, minS = TILE * g.cell // no chord so long it sags through the sea, none finer than the height grid
    let n = 0
    const visit = (cx: number, cy: number, s: number) => {
      if (cx + s / 2 < -g.W / 2 || cx - s / 2 > g.W / 2 || cy + s / 2 < -g.H / 2 || cy - s / 2 > g.H / 2) return
      if (g.disc && Math.hypot(cx, cy) - s * 0.71 > g.W / 2) return
      p.set(...toSphere(cx, cy, R, g.disc))
      if (s < maxS && p.angleTo(up) > horizon + 0.15 + s * 0.8 / R / Math.max(0.2, Math.cos(cy / R))) return
      if (s > maxS || (s > minS && p.multiplyScalar(R).distanceTo(cam) - s * 0.71 < s * 2)) { const q = s / 4; visit(cx - q, cy - q, s / 2); visit(cx + q, cy - q, s / 2); visit(cx - q, cy + q, s / 2); visit(cx + q, cy + q, s / 2) }
      else if (n < MAX_TILES) { out[n * 3] = cx - s / 2; out[n * 3 + 1] = cy - s / 2; out[n * 3 + 2] = s; n++ }
    }
    visit(0, 0, Math.max(g.W, g.H))
    const geo = this.ground!.geometry, attr = geo.attributes.iTile as THREE.InstancedBufferAttribute
    geo.instanceCount = n
    attr.clearUpdateRanges(); attr.addUpdateRange(0, n * 3); attr.needsUpdate = true
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (!this.R) return
    this.tick(performance.now())
    if (!(this.place() || this.dirty)) return
    this.dirty = false
    const q = this.planet.quaternion, l = this.light, sun = new THREE.Vector3(...sunDir(this.t))
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spin).premultiply(this.lean)
    this.inverse.copy(q).invert()
    this.planet.updateMatrixWorld()
    l.uSunW.value.copy(sun)
    l.uSunP.value.copy(sun).applyQuaternion(this.inverse)
    l.uCamP.value.copy(this.camera.position).applyQuaternion(this.inverse)
    l.uSeason.value = l.uSunP.value.y / Math.sin(TILT_DEG * Math.PI / 180)
    l.uFall.value = sun.z // after midsummer the sun moves towards +z: the north's autumn, the south's spring
    this.updateTiles(this.gen!, l.uCamP.value)
    this.sky.update(this.t, sun, this.camera, this.R, this.renderer.getPixelRatio())
    this.renderer.clear()
    this.renderer.render(this.sky.scene, this.sky.camera)
    this.renderer.clearDepth()
    this.renderer.render(this.scene, this.camera)
  }

  private onKey = (e: KeyboardEvent) => {
    const turn = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    const zoom = { '+': 0.8, '=': 0.8, '-': 1.25, _: 1.25 }[e.key]
    if (!turn && !zoom) return
    e.preventDefault()
    const c = this.controls, p = this.rig.position, s = new THREE.Spherical().setFromVector3(p), alt = s.radius - this.R
    if (turn) { const a = 0.4 * alt / s.radius; s.theta += turn[0] * a; s.phi = THREE.MathUtils.clamp(s.phi + turn[1] * a, 0.05, Math.PI - 0.05) }
    if (zoom) s.radius = THREE.MathUtils.clamp(this.R + alt * zoom, c.minDistance, c.maxDistance)
    p.setFromSpherical(s)
    this.grabbed()
  }

  private clear() {
    for (const o of [...this.planet.children, ...(this.air ? [this.air] : [])] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[]) {
      o.removeFromParent(); o.geometry.dispose()
      for (const v of Object.values(o.material.uniforms)) if (v.value instanceof THREE.Texture) v.value.dispose()
      o.material.dispose()
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('keydown', this.onKey)
    this.controls.removeEventListener('start', this.grabbed)
    this.controls.dispose()
    this.clear()
    this.sky.dispose()
    this.renderer.dispose()
  }
}
