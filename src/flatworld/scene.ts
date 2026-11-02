// New Map Test renderer: a flat world as a lit, animated diorama in a toon style.
// Terrain, water, rivers, trees, clouds and smoke are custom shaders; a final pass adds ink outlines, sky and haze.
import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { rng, hash } from '../world/noise.ts'
import { heightAt, TREE_KINDS, type Gen, type terrainMesh, type treesOf, type wallMesh } from './gen.ts'

export interface Built { gen: Gen; terrain: ReturnType<typeof terrainMesh>; wall: ReturnType<typeof wallMesh>; trees: ReturnType<typeof treesOf>; seed: string }

const SUN = new THREE.Vector3(-0.55, 0.75, -0.4).normalize()
const MAX_CLOUDS = 40

// Shared GLSL: value noise, three soft toon bands, cloud shadows.
const COMMON = /* glsl */ `
uniform vec3 uSun; uniform float uTime; uniform vec4 uClouds[${MAX_CLOUDS}]; uniform int uNC; uniform float uDiscR;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
vec3 toon(vec3 base, vec3 n) {
  float d = dot(normalize(n), uSun);
  float b = .5 * smoothstep(-.04, .06, d) + .5 * smoothstep(.38, .48, d);
  return base * mix(vec3(.66, .62, .76), vec3(1.07, 1.03, .96), b);
}
float cloudShade(vec2 p) {
  float s = 0.;
  for (int i = 0; i < ${MAX_CLOUDS}; i++) { if (i >= uNC) break; vec4 c = uClouds[i]; s = max(s, smoothstep(c.z, c.z * .4, length(p - c.xy))); }
  return 1. - .32 * s;
}
`
const uniforms = () => ({
  uSun: { value: SUN }, uTime: { value: 0 }, uNC: { value: 0 }, uDiscR: { value: 0 }, uFill: { value: null as THREE.Texture | null },
  uClouds: { value: Array.from({ length: MAX_CLOUDS }, () => new THREE.Vector4()) },
})
type U = ReturnType<typeof uniforms>

const terrainMat = (u: U, color: THREE.Texture, exag: number) => new THREE.ShaderMaterial({
  uniforms: { ...u, uColor: { value: color }, uExag: { value: exag } },
  vertexShader: /* glsl */ `
    uniform float uExag; varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vH;
    void main() { vUv = uv; vN = normal; vW = position; vH = position.y / uExag * 1000.;
      gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */ `${COMMON}
    uniform sampler2D uColor; uniform sampler2D uFill; varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vH;
    void main() {
      if (uDiscR > 0. && length(vW.xz) > uDiscR) discard;
      vec4 t = texture2D(uColor, vUv), fill = texture2D(uFill, vUv);
      t.rgb = mix(t.rgb, fill.rgb, fill.a * step(0., vH)); // region fills, land only
      float aa = fwidth(vW.x); // km per pixel: fine detail fades out before it can flicker
      vec3 base = t.rgb * (.92 + .1 * vnoise(vW.xz * .3) + .06 * mix(vnoise(vW.xz * 1.9), .5, smoothstep(.2, .6, aa)));
      // craggy detail on steep ground: bend the normal by fine noise so the toon bands break into facets
      vec3 n = normalize(vN);
      float steep = smoothstep(.55, .85, 1. - n.y) * (1. - smoothstep(.5, 1.5, aa));
      if (steep > 0.) {
        vec2 q = vW.xz * .35, e = vec2(.08, 0.);
        float f0 = vnoise(q) + .5 * vnoise(q * 2.3), fx = vnoise(q + e.xy) + .5 * vnoise((q + e.xy) * 2.3), fz = vnoise(q + e.yx) + .5 * vnoise((q + e.yx) * 2.3);
        n = normalize(n + steep * 3. * vec3(f0 - fx, 0., f0 - fz) / e.x * .25);
      }
      vec3 col = toon(base, n) * cloudShade(vW.xz);
      float fw = fwidth(vH), ink = 1. - smoothstep(fw * .7, fw * 1.8, abs(vH - 5.));
      col = mix(col, vec3(.16, .2, .3), ink * .7);
      float lava = 1. - t.a;
      col = mix(col, vec3(1., .42, .1) * (1.25 + .35 * sin(uTime * 2.3 + vW.x * .2)), lava);
      gl_FragColor = vec4(col, 1.);
    }`,
})

const waterMat = (u: U, depth: THREE.Texture, W: number, H: number) => new THREE.ShaderMaterial({
  uniforms: { ...u, uDepth: { value: depth }, uSize: { value: new THREE.Vector2(W, H) } },
  vertexShader: /* glsl */ `varying vec3 vW; void main() { vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */ `${COMMON}
    uniform sampler2D uDepth; uniform vec2 uSize; varying vec3 vW;
    void main() {
      if (uDiscR > 0. && length(vW.xz) > uDiscR) discard;
      vec2 p = vW.xz, uv = p / uSize + .5;
      float d = texture2D(uDepth, uv).r, t = uTime, aa = fwidth(p.x);
      float n = vnoise(p * .02 + vec2(t * .05, t * .03)) + .5 * vnoise(p * .07 - vec2(t * .08, -t * .05));
      vec3 col = mix(vec3(.38, .86, .82), vec3(.16, .58, .80), smoothstep(.015, .07, d + (n - .75) * .015));
      col = mix(col, vec3(.10, .34, .64), smoothstep(.22, .45, d));
      col = mix(col, vec3(.07, .24, .52), smoothstep(.7, 1., d));
      // open-sea waves: thin drifting crest lines, patchy so they come and go
      float cl = 1. - abs(vnoise(p * vec2(.035, .09) + vec2(t * .08, t * .04)) - .5) * 2.;
      float crest = smoothstep(.9, .96, cl) * smoothstep(.55, .75, vnoise(p * .012 - vec2(t * .015, 0.)));
      col = mix(col, vec3(.86, .95, 1.), crest * .55 * smoothstep(.04, .2, d) * (1. - smoothstep(2., 5., aa)));
      float band = sin(d * 220. - t * 2.2 + n * 3.);
      float foam = smoothstep(.72, .92, band) * (1. - smoothstep(0., .045, d)) + 1. - smoothstep(.004, .012, d);
      col = mix(col, vec3(.97, .99, 1.), clamp(foam, 0., 1.) * .85);
      float g = vnoise(p * .35 + t * .5) * vnoise(p * .21 - t * .35);
      col += smoothstep(.56, .6, g) * .35 * vec3(1., .95, .8) * smoothstep(.02, .1, d) * (1. - smoothstep(.4, 1.2, aa));
      gl_FragColor = vec4(col * cloudShade(p), 1.);
    }`,
})

const wallMat = (u: U, W: number, H: number) => new THREE.ShaderMaterial({
  uniforms: { ...u, uHalf: { value: new THREE.Vector2(W / 2, H / 2) } },
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `attribute float ground; varying float vG; varying vec3 vW;
    void main() { vG = ground; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */ `${COMMON}
    uniform vec2 uHalf; varying float vG; varying vec3 vW;
    void main() {
      vec3 n = uDiscR > 0. ? normalize(vec3(vW.x, 0., vW.z)) : abs(vW.x) / uHalf.x > abs(vW.z) / uHalf.y ? vec3(sign(vW.x), 0., 0.) : vec3(0., 0., sign(vW.z));
      vec3 col;
      if (vW.y > vG) col = mix(vec3(.10, .32, .60), vec3(.30, .70, .85), smoothstep(vG, 0., vW.y));
      else {
        float along = vW.x + vW.z, b = vW.y * .18 + vnoise(vec2(along * .02, vW.y * .05)) * 1.3;
        float k = mod(floor(b), 3.);
        col = k < 1. ? vec3(.55, .40, .30) : k < 2. ? vec3(.68, .55, .40) : vec3(.42, .33, .30);
        col *= .9 + .2 * vnoise(vec2(along * .2, vW.y * .6));
        col = mix(col, vec3(.36, .26, .18), smoothstep(-6., 0., vW.y - vG));
      }
      gl_FragColor = vec4(toon(col, n), 1.);
    }`,
})

const riverMat = (u: U) => new THREE.ShaderMaterial({
  uniforms: { ...u }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */ `${COMMON}
    varying vec2 vUv; varying vec3 vW;
    void main() {
      float e = abs(vUv.x);
      vec3 col = mix(vec3(.20, .55, .84), vec3(.45, .80, .92), smoothstep(.3, 1., e));
      float f = vnoise(vec2(vUv.x * 2.5, vUv.y * .22 - uTime * 1.4)) * vnoise(vec2(vUv.x * 5., vUv.y * .5 - uTime * 2.));
      col = mix(col, vec3(.92, .98, 1.), smoothstep(.32, .4, f) * .7);
      gl_FragColor = vec4(col * cloudShade(vW.xz), 1. - smoothstep(.75, 1., e));
    }`,
})

// Instanced props (trees, smoke) share this: per instance position, scale, yaw, shade.
const propMat = (u: U, sway: number) => new THREE.ShaderMaterial({
  uniforms: { ...u, uSway: { value: sway } },
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uSway;
    attribute vec4 iPos; attribute vec2 iRot; attribute vec3 color;
    varying vec3 vCol; varying vec3 vN; varying vec3 vW;
    void main() {
      float c = cos(iRot.x), s = sin(iRot.x);
      mat2 r = mat2(c, -s, s, c);
      vec3 p = position; p.xz = r * p.xz;
      vec3 n = normal; n.xz = r * n.xz;
      float k = sin(uTime * 1.7 + iPos.x * .07 + iPos.z * .05) + .4 * sin(uTime * 3.1 + iPos.z * .11);
      p.x += k * uSway * p.y * p.y; p.z += k * uSway * .6 * p.y * p.y;
      vW = iPos.xyz + (p - vec3(0., .06, 0.)) * iPos.w; vN = n; vCol = color * iRot.y;
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
    }`,
  fragmentShader: /* glsl */ `${COMMON}
    varying vec3 vCol; varying vec3 vN; varying vec3 vW;
    void main() { gl_FragColor = vec4(toon(vCol, vN) * cloudShade(vW.xz), 1.); }`,
})

const smokeMat = (u: U, rise: number, size: number) => new THREE.ShaderMaterial({
  uniforms: { ...u, uRise: { value: rise }, uSize: { value: size } },
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uRise; uniform float uSize;
    attribute vec4 iPos; varying vec3 vN; varying float vLife;
    void main() {
      float life = fract(uTime * .06 + iPos.w);
      vec3 drift = vec3(life * uRise * .55 + sin(life * 6. + iPos.w * 20.) * uSize, life * uRise, -life * uRise * .2);
      float s = uSize * (.45 + 1.8 * life) * (1. - smoothstep(.8, 1., life));
      vN = normal; vLife = life;
      gl_Position = projectionMatrix * viewMatrix * vec4(iPos.xyz + drift + position * s, 1.);
    }`,
  fragmentShader: /* glsl */ `${COMMON}
    varying vec3 vN; varying float vLife;
    void main() { gl_FragColor = vec4(toon(mix(vec3(.38, .34, .34), vec3(.82, .80, .80), vLife), vN), 1.); }`,
})

const cloudMat = (u: U) => new THREE.ShaderMaterial({
  uniforms: { ...u },
  vertexShader: /* glsl */ `varying vec3 vN; void main() { vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */ `${COMMON}
    varying vec3 vN;
    void main() { float d = dot(vN, uSun); vec3 c = mix(vec3(.74, .80, .94), vec3(1.), smoothstep(.0, .1, d)); gl_FragColor = vec4(c, 1.); }`,
})

// Final pass: sky where nothing was drawn, depth-based ink outlines, distance haze, a soft vignette.
const finalMat = () => new THREE.ShaderMaterial({
  uniforms: { tColor: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 }, uHaze: { value: new THREE.Vector2(1, 2) } },
  depthTest: false, depthWrite: false,
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform vec2 uHaze;
    varying vec2 vUv;
    float lin(vec2 uv) { float d = texture2D(tDepth, uv).r; return d >= 1. ? uFar * 4. : uNear * uFar / (uFar - d * (uFar - uNear)); }
    void main() {
      vec3 col = texture2D(tColor, vUv).rgb;
      float d0 = texture2D(tDepth, vUv).r;
      vec3 sky = mix(vec3(.80, .88, .94), vec3(.42, .62, .86), smoothstep(.35, 1., vUv.y));
      if (d0 >= 1.) col = sky;
      else {
        vec2 px = 1. / uRes; float z = lin(vUv);
        float sum = lin(vUv + vec2(px.x, 0.)) + lin(vUv - vec2(px.x, 0.)) + lin(vUv + vec2(0., px.y)) + lin(vUv - vec2(0., px.y));
        float ink = smoothstep(.05, .14, max(0., sum - 4. * z) / z);
        col = mix(col, sky, smoothstep(uHaze.x, uHaze.y, z) * .55);
        col = mix(col, vec3(.14, .12, .2), ink * .8);
      }
      col *= 1. - .22 * smoothstep(.45, .9, length(vUv - .5));
      gl_FragColor = vec4(col, 1.);
    }`,
})

// Low-poly tree models, one unit tall, with vertex colours; flat-shaded so the toon bands read as facets.
function treeGeometry(kind: string) {
  const part = (g: THREE.BufferGeometry, rgb: [number, number, number], y: number, sx = 1, sy = 1, sz = 1, x = 0, z = 0) => {
    g = g.toNonIndexed(); g.scale(sx, sy, sz); g.translate(x, y, z)
    const c = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < c.length; i += 3) c.set(rgb, i)
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv')
    return g
  }
  const trunk = (h: number, r: number) => part(new THREE.CylinderGeometry(r * 0.7, r, h, 5), [0.42, 0.29, 0.2], h / 2)
  const parts = {
    broad: [trunk(0.35, 0.06), part(new THREE.IcosahedronGeometry(0.3, 0), [0.36, 0.64, 0.26], 0.55), part(new THREE.IcosahedronGeometry(0.21, 0), [0.42, 0.7, 0.3], 0.74, 1, 1, 1, 0.1, 0.05)],
    pine: [trunk(0.22, 0.05), part(new THREE.ConeGeometry(0.27, 0.5, 7), [0.2, 0.44, 0.3], 0.42), part(new THREE.ConeGeometry(0.19, 0.4, 7), [0.24, 0.5, 0.33], 0.72)],
    jungle: [trunk(0.5, 0.07), part(new THREE.IcosahedronGeometry(0.38, 0), [0.18, 0.54, 0.22], 0.72, 1.1, 0.6, 1.1), part(new THREE.IcosahedronGeometry(0.24, 0), [0.26, 0.62, 0.24], 0.86, 1, 0.6, 1, -0.15, 0.1)],
    cactus: [part(new THREE.CylinderGeometry(0.07, 0.08, 0.7, 6), [0.34, 0.6, 0.32], 0.35), part(new THREE.CylinderGeometry(0.045, 0.05, 0.28, 5), [0.36, 0.62, 0.34], 0.45, 1, 1, 1, 0.13, 0)],
    swamp: [trunk(0.4, 0.08), part(new THREE.IcosahedronGeometry(0.34, 0), [0.34, 0.46, 0.26], 0.52, 1.25, 0.55, 1.25)],
  } as Record<string, THREE.BufferGeometry[]>
  const g = mergeGeometries(parts[kind])
  g.computeVertexNormals()
  return g
}

function instanced(base: THREE.BufferGeometry, iPos: Float32Array, iRot?: Float32Array) {
  const g = new THREE.InstancedBufferGeometry()
  for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k])
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4))
  if (iRot) g.setAttribute('iRot', new THREE.InstancedBufferAttribute(iRot, 2))
  g.instanceCount = iPos.length / 4
  return g
}

export class MapScene {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(40, 1, 1, 10000)
  controls: MapControls
  private u = uniforms()
  private rt: THREE.WebGLRenderTarget
  private post = finalMat()
  private quad: THREE.Mesh
  private world = new THREE.Group()
  private clouds: { mesh: THREE.Mesh; x: number; z: number; r: number }[] = []
  private cloudAlt = 0
  private built?: Built
  private clock = new THREE.Clock()
  private fly?: { from: THREE.Vector3; to: THREE.Vector3; dfrom: number; dto: number; t: number }
  private spin?: { from: number; to: number; t: number }
  private keys = new Set<string>()
  private fill: THREE.CanvasTexture
  private pv = new THREE.Matrix4()
  raf = 0
  showClouds = true
  dblFly = true // double-click flies in (off while a drawing tool is active)
  onFrame?: () => void // after each render: the page draws its screen layer here

  private canvas: HTMLCanvasElement
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType) })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post)
    this.quad.frustumCulled = false
    this.scene.add(this.world)
    this.controls = new MapControls(this.camera, canvas)
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.12, zoomToCursor: true, screenSpacePanning: false, maxPolarAngle: 1.32, zoomSpeed: 1.4 })
    canvas.addEventListener('dblclick', this.onDbl)
    canvas.addEventListener('keydown', this.onKey); canvas.addEventListener('keyup', this.onKey); canvas.addEventListener('blur', this.onBlur)
    this.controls.listenToKeyEvents(canvas)
    const blank = document.createElement('canvas'); blank.width = blank.height = 1
    this.fill = new THREE.CanvasTexture(blank)
    this.u.uFill.value = this.fill
    this.resize()
    this.loop()
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    const p = this.renderer.getPixelRatio()
    this.rt.setSize(Math.round(w * p), Math.round(h * p))
    this.post.uniforms.uRes.value.set(w * p, h * p)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  setWorld(b: Built) {
    const first = !this.built || this.built.gen.W !== b.gen.W || this.built.gen.H !== b.gen.H
    this.built = b
    for (const o of [...this.world.children]) { this.world.remove(o); o.traverse((m) => { if (m instanceof THREE.Mesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose() } }) }
    this.clouds = []
    const g = b.gen, e = g.exag / 1000, u = this.u, size = Math.max(g.W, g.H)
    u.uDiscR.value = g.disc ? g.W / 2 : 0

    const tex = (data: Uint8Array, fmt: THREE.PixelFormat) => {
      const t = new THREE.DataTexture(data, g.w, g.h, fmt)
      t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true
      return t
    }
    const terrain = new THREE.BufferGeometry()
    terrain.setAttribute('position', new THREE.BufferAttribute(b.terrain.pos, 3))
    terrain.setAttribute('normal', new THREE.BufferAttribute(b.terrain.nor, 3))
    terrain.setAttribute('uv', new THREE.BufferAttribute(b.terrain.uv, 2))
    terrain.setIndex(new THREE.BufferAttribute(b.terrain.index, 1))
    this.world.add(new THREE.Mesh(terrain, terrainMat(u, tex(g.rgba, THREE.RGBAFormat), g.exag)))

    const wg = g.disc ? new THREE.CircleGeometry(g.W / 2, 256) : new THREE.PlaneGeometry(g.W, g.H)
    wg.rotateX(-Math.PI / 2)
    this.world.add(new THREE.Mesh(wg, waterMat(u, tex(g.depth, THREE.RedFormat), g.W, g.H)))

    const wall = new THREE.BufferGeometry()
    wall.setAttribute('position', new THREE.BufferAttribute(b.wall.pos, 3))
    wall.setAttribute('ground', new THREE.BufferAttribute(b.wall.ground, 1))
    wall.setIndex(new THREE.BufferAttribute(b.wall.index, 1))
    this.world.add(new THREE.Mesh(wall, wallMat(u, g.W, g.H)))

    // Rivers: ribbons on the carved channel, wider than life, widening downstream.
    const rp: number[] = [], ruv: number[] = [], ri: number[] = []
    for (const r of g.rivers) {
      let along = 0
      const start = rp.length / 3
      for (let n = 0; n < r.pts.length; n++) {
        const [x, y] = r.pts[n], a = r.pts[Math.max(0, n - 1)], c = r.pts[Math.min(r.pts.length - 1, n + 1)]
        let tx = c[0] - a[0], ty = c[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l
        const hw = Math.max(r.width[n] * 1.5, g.cell * 1.1), yy = (r.ch[n] + 8) * e
        if (n) along += Math.hypot(x - r.pts[n - 1][0], y - r.pts[n - 1][1])
        rp.push(x - ty * hw, yy, -(y + tx * hw), x + ty * hw, yy, -(y - tx * hw))
        ruv.push(-1, along, 1, along)
        if (n) { const q = start + (n - 1) * 2; ri.push(q, q + 1, q + 2, q + 2, q + 1, q + 3) }
      }
    }
    if (ri.length) {
      const rg = new THREE.BufferGeometry()
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2)); rg.setIndex(ri)
      const m = new THREE.Mesh(rg, riverMat(u)); m.renderOrder = 1
      this.world.add(m)
    }

    // Trees: [x, y, z, scale, yaw, shade] -> iPos (x, y, z, scale) + iRot (yaw, shade)
    for (const [n, kind] of TREE_KINDS.entries()) {
      const t = b.trees[n], count = t.length / 6
      if (!count) continue
      const iPos = new Float32Array(count * 4), iRot = new Float32Array(count * 2)
      for (let q = 0; q < count; q++) { iPos.set(t.subarray(q * 6, q * 6 + 4), q * 4); iRot[q * 2] = t[q * 6 + 4]; iRot[q * 2 + 1] = t[q * 6 + 5] }
      const m = new THREE.Mesh(instanced(treeGeometry(kind), iPos, iRot), propMat(u, kind === 'cactus' ? 0 : 0.05))
      m.frustumCulled = false
      this.world.add(m)
    }

    // Volcano smoke: a column of puffs per vent, animated entirely in the shader.
    if (g.vents.length) {
      const per = 18, iPos = new Float32Array(g.vents.length * per * 4)
      g.vents.forEach((v, n) => { for (let q = 0; q < per; q++) iPos.set([v.at[0], v.top * e, -v.at[1], q / per], (n * per + q) * 4) })
      const m = new THREE.Mesh(instanced(new THREE.IcosahedronGeometry(1, 1), iPos), smokeMat(u, size * 0.06, size * 0.006))
      m.frustumCulled = false
      this.world.add(m)
    }

    // Clouds: puffy clusters drifting with the wind; their shadows are drawn by every ground shader.
    const r = rng(hash(b.seed) ^ 0x51ed)
    this.cloudAlt = g.maxH * e * 1.25 + size * 0.012
    const n = Math.min(MAX_CLOUDS, Math.max(6, Math.round(g.W * g.H / (size * 0.22) ** 2)))
    const cm = cloudMat(u)
    for (let q = 0; q < n; q++) {
      const parts: THREE.BufferGeometry[] = [], k = 4 + Math.floor(r() * 4)
      for (let p = 0; p < k; p++) {
        const s = 0.45 + r() * 0.55, gg = new THREE.IcosahedronGeometry(s, 1)
        gg.translate((p / (k - 1) - 0.5) * 2.2 + (r() - 0.5) * 0.4, s * 0.35 + (r() - 0.5) * 0.2, (r() - 0.5) * 0.8)
        parts.push(gg)
      }
      const geo = mergeGeometries(parts)
      geo.scale(1, 0.62, 1)
      const rad = size * (0.012 + r() * 0.012), mesh = new THREE.Mesh(geo, cm)
      mesh.scale.setScalar(rad)
      mesh.rotation.y = r() * Math.PI
      this.world.add(mesh)
      this.clouds.push({ mesh, x: (r() - 0.5) * g.W, z: (r() - 0.5) * g.H, r: rad })
    }

    if (first) this.frame()
  }

  /** Whole map in view, from the south, tilted. */
  frame() {
    const g = this.built?.gen
    if (!g) return
    const s = Math.max(g.W, g.H / this.camera.aspect * 1.3)
    this.controls.target.set(0, 0, 0)
    this.camera.position.set(0, s * 0.78, s * 0.78)
    this.controls.minDistance = g.cell * 4
    this.controls.maxDistance = s * 2.2
    this.controls.update()
  }

  /** Region fills: a map-sized canvas (row 0 = north), draped on the land. */
  setFill(c: HTMLCanvasElement) {
    this.fill.dispose()
    this.fill = new THREE.CanvasTexture(c)
    this.fill.flipY = false
    this.fill.colorSpace = THREE.NoColorSpace
    this.u.uFill.value = this.fill
  }

  /** CSS pixel position of a map point on the ground (undefined behind the camera). */
  proj = (x: number, y: number): [number, number] | undefined => {
    const g = this.built?.gen
    if (!g) return
    const e = this.pv.elements, z = -y, hy = Math.max(0, heightAt(g, x, y)) * g.exag / 1000
    const w = e[3] * x + e[7] * hy + e[11] * z + e[15]
    if (w <= 0) return
    const px = (e[0] * x + e[4] * hy + e[8] * z + e[12]) / w, py = (e[1] * x + e[5] * hy + e[9] * z + e[13]) / w
    return [(px + 1) / 2 * this.canvas.clientWidth, (1 - py) / 2 * this.canvas.clientHeight]
  }

  /** The map point under a CSS pixel, or undefined off the map. */
  ground(cx: number, cy: number): [number, number] | undefined {
    const r = this.canvas.getBoundingClientRect(), p = this.pick(cx + r.left, cy + r.top)
    return p && [p.x, -p.z]
  }

  /** km per CSS pixel at the middle of the view. */
  kmPerPx() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, a = this.ground(w / 2, h / 2), b = this.ground(w / 2 + 50, h / 2)
    return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) / 50 : this.camera.position.distanceTo(this.controls.target) / h
  }

  /** Compass bearing of the view in radians (0 = north up). */
  azimuth() { const o = this.camera.position.clone().sub(this.controls.target); return Math.atan2(o.x, o.z) }
  north() { const a = this.azimuth(); if (Math.abs(a) > 1e-3) this.spin = { from: a, to: 0, t: 0 } }

  /** Fly to a map point; dist in km from the camera to the ground (default: keep the current distance, at most a regional view). */
  flyTo(x: number, y: number, dist?: number) {
    const g = this.built?.gen
    if (!g) return
    const d = this.camera.position.distanceTo(this.controls.target)
    const to = new THREE.Vector3(x, Math.max(0, heightAt(g, x, y)) * g.exag / 1000, -y)
    this.fly = { from: this.controls.target.clone(), to, dfrom: d, dto: dist ?? Math.min(d, Math.max(g.W, g.H) * 0.25), t: 0 }
  }

  /** Move the view centre without changing zoom or angle (minimap). */
  moveTo(x: number, y: number) {
    const c = this.controls.target, dx = x - c.x, dz = -y - c.z
    c.x += dx; c.z += dz; this.camera.position.x += dx; this.camera.position.z += dz
  }

  /** The view's corners on the sea-level plane, as map points (for the minimap). */
  footprint() {
    const out: [number, number][] = [], ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3()
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ray.setFromCamera(new THREE.Vector2(x, y * 0.98), this.camera)
      if (ray.ray.intersectPlane(plane, hit)) out.push([hit.x, -hit.z])
      else { const d = ray.ray.direction; out.push([this.camera.position.x + d.x * 1e5, -(this.camera.position.z + d.z * 1e5)]) }
    }
    return out
  }

  /** The current frame as a 2D canvas (for PNG export). */
  snapshot() {
    this.render()
    const src = this.renderer.domElement, c = document.createElement('canvas')
    c.width = src.width; c.height = src.height
    c.getContext('2d')!.drawImage(src, 0, 0)
    return c
  }

  private onKey = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); if (k === 'q' || k === 'e') { if (e.type === 'keydown') this.keys.add(k); else this.keys.delete(k) } }
  private onBlur = () => this.keys.clear()

  /** Where a screen point hits the ground: ray-march the height grid. */
  pick(cx: number, cy: number) {
    const g = this.built?.gen
    if (!g) return
    const r = this.canvas.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera)
    const o = ray.ray.origin, d = ray.ray.direction, e = g.exag / 1000
    const groundAt = (x: number, z: number) => {
      const i = Math.round((x + g.W / 2) / g.cell - 0.5), j = Math.round((z + g.H / 2) / g.cell - 0.5)
      return i < 0 || j < 0 || i >= g.w || j >= g.h ? -Infinity : Math.max(0, g.height[j * g.w + i] * e)
    }
    const step = g.cell * 0.5, far = this.camera.far
    for (let t = 0; t < far; t += step * Math.max(1, t / (g.cell * 400))) {
      const p = o.clone().addScaledVector(d, t)
      if (p.y <= groundAt(p.x, p.z)) return p
    }
  }

  private onDbl = (ev: MouseEvent) => {
    if (!this.dblFly) return
    const p = this.pick(ev.clientX, ev.clientY)
    if (!p) return
    const d = this.camera.position.distanceTo(this.controls.target)
    this.fly = { from: this.controls.target.clone(), to: p, dfrom: d, dto: Math.max(this.controls.minDistance, d * 0.35), t: 0 }
  }

  loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, this.clock.getDelta()), t = this.clock.elapsedTime
    const g = this.built?.gen
    this.u.uTime.value = t
    if (this.fly) {
      const f = this.fly; f.t = Math.min(1, f.t + dt / 0.7)
      const k = f.t * f.t * (3 - 2 * f.t), off = this.camera.position.clone().sub(this.controls.target).normalize()
      this.controls.target.lerpVectors(f.from, f.to, k)
      this.camera.position.copy(this.controls.target).addScaledVector(off, f.dfrom + (f.dto - f.dfrom) * k)
      if (f.t >= 1) this.fly = undefined
    }
    const turn = (this.keys.has('q') ? 1 : 0) - (this.keys.has('e') ? 1 : 0)
    if (turn || this.spin) { // Q/E turn the view; the compass spins it back to north
      const o = this.camera.position.clone().sub(this.controls.target), a = Math.atan2(o.x, o.z)
      let to = a + turn * dt * 1.2
      if (this.spin && !turn) { const s = this.spin; s.t = Math.min(1, s.t + dt / 0.6); to = s.from + (s.to - s.from) * s.t * s.t * (3 - 2 * s.t); if (s.t >= 1) this.spin = undefined }
      o.applyAxisAngle(new THREE.Vector3(0, 1, 0), to - a)
      this.camera.position.copy(this.controls.target).add(o)
    }
    this.controls.update()
    const dist = this.camera.position.distanceTo(this.controls.target)
    if (g) { // keep the view over the map
      const c = this.controls.target, lim = (v: number, m: number) => Math.max(-m, Math.min(m, v))
      const dx = lim(c.x, g.W / 2) - c.x, dz = lim(c.z, g.H / 2) - c.z
      if (dx || dz) { c.x += dx; c.z += dz; this.camera.position.x += dx; this.camera.position.z += dz }
      // clouds drift and wrap; they hide when the camera is down among them
      const size = Math.max(g.W, g.H), wind = size * 0.0035
      const show = this.showClouds && this.camera.position.y > this.cloudAlt * 1.25 && dist > size * 0.45 // only at continent scale, never in the way up close
      let nc = 0
      for (const cl of this.clouds) {
        cl.x += wind * dt; cl.z += wind * 0.35 * dt
        if (cl.x > g.W / 2 + cl.r * 2) cl.x -= g.W + cl.r * 4
        if (cl.z > g.H / 2 + cl.r * 2) cl.z -= g.H + cl.r * 4
        cl.mesh.position.set(cl.x, this.cloudAlt, cl.z)
        cl.mesh.visible = show
        if (show && nc < MAX_CLOUDS) this.u.uClouds.value[nc++].set(cl.x - SUN.x / SUN.y * this.cloudAlt, cl.z - SUN.z / SUN.y * this.cloudAlt, cl.r * 1.5, 0)
      }
      this.u.uNC.value = nc
    }
    this.camera.near = Math.max(0.05, dist * 0.004)
    this.camera.far = dist * 6 + (g ? Math.max(g.W, g.H) * 2 : 1000)
    this.camera.updateProjectionMatrix()
    this.post.uniforms.uNear.value = this.camera.near
    this.post.uniforms.uFar.value = this.camera.far
    this.post.uniforms.uHaze.value.set(dist * 1.2, dist * 4)
    this.render()
    this.pv.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
    this.onFrame?.()
  }

  private render() {
    this.renderer.setRenderTarget(this.rt)
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null)
    this.post.uniforms.tColor.value = this.rt.texture
    this.post.uniforms.tDepth.value = this.rt.depthTexture
    this.renderer.render(this.quad, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('dblclick', this.onDbl)
    this.canvas.removeEventListener('keydown', this.onKey); this.canvas.removeEventListener('keyup', this.onKey); this.canvas.removeEventListener('blur', this.onBlur)
    this.fill.dispose()
    this.controls.dispose()
    this.world.traverse((m) => { if (m instanceof THREE.Mesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose() } })
    this.rt.dispose()
    this.renderer.dispose()
  }
}
