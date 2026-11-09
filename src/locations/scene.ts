// Locations renderer: a city-scale place lit for atmosphere. Terrain in tiles that simplify with distance (plus the
// range beyond), buildings assembled from instanced parts (walls whose facades are drawn by the shader, roofs of many
// shapes and tiles, chimneys, dormers, balconies, towers...), the megastructures, roads and canals as merged meshes,
// eight tree species and rocks in chunks with distance levels, reflective water (lakes, canals, rivers with falls, the
// sea), and a sky that follows the hour, the weather and the season. Desktop first. Shader pieces live in shaders.ts,
// shapes in geometry.ts, water in water.ts, effects in fx.ts.
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { standardShots } from './shots.ts'
import { TSTRIDE, type CityBuilt, type LocationDoc, type MoodName, type Season, type View, type Weather } from './city.ts'
import { PART, PART_COUNT, PSTRIDE, ROOF_PARTS } from './buildings.ts'
import { MATS, type Mat } from './kit.ts'
import { Fly, type Pose } from './fly.ts'
import { Fx } from './fx.ts'
import { atmo, GLOW, MOTTLE, ROAD, ROCK, ROCK_POST, ROOF, ROOF_FH, ROOF_V, ROOF_VH, SKY_F, SKY_V, STONE, STYLE_F, TERRAIN, TERRAIN_FH, TERRAIN_POST, TERRAIN_V, TERRAIN_VH, TREE, TREE_FH, TREE_V, TREE_VH, U, WALL, WALL_FH, WALL_V, WALL_VH } from './shaders.ts'
import { chunks, gridMesh, partGeometries, rockGeo, skirtMesh, terrainTiles, treeGeometries } from './geometry.ts'
import { heightTexture, Reflection, WATER_U, waterMaterial } from './water.ts'
import { VolumeLod } from './volumeLod.ts'

// ---------- sky keyframes by sun elevation, and the mood presets ----------
interface Key { el: number; sun: string; sunI: number; zenith: string; horizon: string; glow: string; hemi: string; ground: string; hemiI: number; exposure: number; night: number; haze: number; sat: number; tint: string }
const KEYS: Key[] = [
  { el: -18, sun: '#9ab0d8', sunI: 0.32, zenith: '#050913', horizon: '#18203a', glow: '#2a3450', hemi: '#3a4870', ground: '#141210', hemiI: 0.35, exposure: 1.7, night: 1, haze: 0.000008, sat: 0.95, tint: '#e8eeff' },
  { el: -4, sun: '#ff8a50', sunI: 0.5, zenith: '#1c2848', horizon: '#c08670', glow: '#ff9860', hemi: '#5868a0', ground: '#302820', hemiI: 0.6, exposure: 1.45, night: 0.75, haze: 0.000012, sat: 1.05, tint: '#f0f0ff' },
  { el: 4, sun: '#ffaa66', sunI: 3.2, zenith: '#46598a', horizon: '#e6b48a', glow: '#ffae6a', hemi: '#8a90b0', ground: '#5a4030', hemiI: 0.55, exposure: 1.05, night: 0.12, haze: 0.000016, sat: 1.1, tint: '#fff0e0' },
  { el: 13, sun: '#ffd8b0', sunI: 3.4, zenith: '#5a84b8', horizon: '#c6d0da', glow: '#f4d2a6', hemi: '#b8c8e0', ground: '#5a5040', hemiI: 0.7, exposure: 0.95, night: 0, haze: 0.000011, sat: 1.05, tint: '#fff8f0' },
  { el: 55, sun: '#fff4e6', sunI: 3.8, zenith: '#3d6dae', horizon: '#bccfe0', glow: '#e8eef4', hemi: '#c0d4ec', ground: '#5e5444', hemiI: 0.65, exposure: 0.85, night: 0, haze: 0.000008, sat: 1.05, tint: '#ffffff' },
]
export interface Atmos { hour: number; weather: Weather; season: Season; mist: number }
export const MOODS: Record<MoodName, { label: string } & Omit<Atmos, 'season'>> = {
  morning: { label: 'Alpine morning', hour: 8.2, weather: 'clear', mist: 0.2 },
  noon: { label: 'Clear noon', hour: 12.5, weather: 'clear', mist: 0.05 },
  golden: { label: 'Golden hour', hour: 18.6, weather: 'clear', mist: 0.15 },
  mist: { label: 'Mist in the valleys', hour: 9, weather: 'cloudy', mist: 1 },
  dusk: { label: 'Blue hour', hour: 19.9, weather: 'clear', mist: 0.15 },
  night: { label: 'Night', hour: 23, weather: 'clear', mist: 0.1 },
}
const WEATHER: Record<Weather, { clouds: number; sun: number; fog: number; haze: number; wet: number; precip: 'none' | 'rain' | 'snow'; storm: boolean; grey: number }> = {
  clear: { clouds: 0.35, sun: 1, fog: 1, haze: 1, wet: 0, precip: 'none', storm: false, grey: 0 },
  cloudy: { clouds: 0.8, sun: 0.55, fog: 1.6, haze: 1.3, wet: 0, precip: 'none', storm: false, grey: 0.35 },
  rain: { clouds: 0.95, sun: 0.3, fog: 2.6, haze: 2.2, wet: 1, precip: 'rain', storm: false, grey: 0.6 },
  snow: { clouds: 0.92, sun: 0.4, fog: 2.2, haze: 2, wet: 0, precip: 'snow', storm: false, grey: 0.5 },
  storm: { clouds: 1, sun: 0.15, fog: 3.2, haze: 2.8, wet: 1, precip: 'rain', storm: true, grey: 0.8 },
}
const FOLIAGE: Record<Season, string> = { spring: '#9cc463', summer: '#5f8c3c', autumn: '#c77a2e', winter: '#7a6a58' }
export interface Stats { fps: number; calls: number; tris: number }
/** Looks to choose between: the same scene, graded and painted differently. Grounded realism is the default. */
export const STYLES = {
  real: { label: 'Grounded realism', sat: 1, contrast: 1.06, shadow: '#f4f8ff', high: '#fffaf2', vig: 0.25, brush: 0, ink: 0, bands: 0, grain: 0.025, haze: 1, sun: 1 },
  matte: { label: 'Matte painting', sat: 1.15, contrast: 1.22, shadow: '#b4ccff', high: '#ffdcae', vig: 0.75, brush: 2, ink: 0, bands: 0, grain: 0.035, haze: 2.4, sun: 1.15 },
  story: { label: 'Storybook', sat: 1.5, contrast: 1.04, shadow: '#e0d8ff', high: '#fff0d0', vig: 0.3, brush: 4, ink: 1, bands: 4, grain: 0.05, haze: 0.6, sun: 1.05 },
} as const
export type StyleName = keyof typeof STYLES
const DEG = Math.PI / 180
/** Per detail tier above the massing: [chunk size, distance from the chunk's middle beyond which it is not drawn] (m). */
const DETAIL_LOD: [number, number][] = [[500, 2600], [250, 800]]
/** How far the flat land and sea run on past the backdrop (m). */
const FAR = 250000

/** Triangles grouped into square chunks by their first corner. */
function splitTris(g: { pos: Float32Array; nor: Float32Array; col: Float32Array }, size: number) {
  const groups = new Map<string, number[]>()
  for (let t = 0; t < g.pos.length / 9; t++) { const k = `${Math.floor(g.pos[t * 9] / size)},${Math.floor(g.pos[t * 9 + 2] / size)}`; const l = groups.get(k); if (l) l.push(t); else groups.set(k, [t]) }
  return [...groups.values()].map((ts) => {
    const pos = new Float32Array(ts.length * 9), nor = new Float32Array(ts.length * 9), col = new Float32Array(ts.length * 9)
    ts.forEach((t, i) => { pos.set(g.pos.subarray(t * 9, t * 9 + 9), i * 9); nor.set(g.nor.subarray(t * 9, t * 9 + 9), i * 9); col.set(g.col.subarray(t * 9, t * 9 + 9), i * 9) })
    return { pos, nor, col }
  })
}

export class LocScene {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(55, 1, 0.5, 400000)
  fly: Fly
  composer: EffectComposer
  grade: ShaderPass
  fx = new Fx()
  sun = new THREE.DirectionalLight(0xffffff, 3)
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6)
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  pmrem: THREE.PMREMGenerator
  envRT: THREE.WebGLRenderTarget | null = null
  world = new THREE.Group()
  built: CityBuilt | null = null
  /** The recipe on show (set by the page), for the standard shots. */
  doc: LocationDoc | null = null
  atmos: Atmos = { hour: 7.6, weather: 'clear', season: 'summer', mist: 0.35 }
  style: StyleName = 'real'
  snowline = 1e5
  playing = 0 // hours of story time per second while time runs
  onStats?: (s: Stats) => void
  onHour?: (h: number) => void
  private canvas: HTMLCanvasElement
  private raf = 0; private last = performance.now(); private acc = { t: 0, n: 0 }; private envHour = -99; private envWeather = ''; private hemiBase = 0
  private sunDir = new THREE.Vector3(0, 1, 0); private lightDir = new THREE.Vector3(0, 1, 0)
  private mats = {} as Record<Mat, THREE.MeshStandardMaterial>
  private terrainMat = atmo(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), { surface: TERRAIN, post: TERRAIN_POST, vertex: TERRAIN_V, vhead: TERRAIN_VH, fhead: TERRAIN_FH, emissive: 'totalEmissiveRadiance += atmoGlow * vec3(1.0, 0.3, 0.05) * (6.0 + uNight * 10.0);' })
  private wallMat = atmo(new THREE.MeshStandardMaterial({ roughness: 0.9 }), { surface: WALL, emissive: GLOW, vertex: WALL_V, vhead: WALL_VH, fhead: WALL_FH, snow: 0.4 })
  private roofMat = atmo(new THREE.MeshStandardMaterial({ roughness: 0.75, vertexColors: true }), { surface: ROOF, vertex: ROOF_V, vhead: ROOF_VH, fhead: ROOF_FH })
  private partMat = atmo(new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true }), { surface: MOTTLE + 'atmoBump = anoise(vAtmoPos * 2.0) * 0.03;' })
  private treeMat = atmo(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), { surface: TREE, vertex: TREE_V, vhead: TREE_VH, fhead: TREE_FH })
  private rockMat = atmo(new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.95, flatShading: true }), { surface: MOTTLE + 'atmoBump = afbm(vAtmoPos * 0.9) * 0.25;' })
  private lakeMat = waterMaterial(0, '#3c9c9a', '#0c3a4a')
  private seaMat = waterMaterial(0, '#3f8f8c', '#0b2a40', 1)
  private riverMat = waterMaterial(1, '#4f7f74', '#1a3c3e')
  private reflection = new Reflection()
  private noReflect: THREE.Object3D[] = []
  private waterSamples: { level: number; pts: [number, number][] }[] = []
  private heightTex: THREE.Texture | null = null
  private fieldTex: THREE.Texture | null = null
  private marksTex: THREE.Texture | null = null
  private disposed = false
  /** The volume ground's levels of detail (when the build has one). */
  vlod: VolumeLod | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true }))
    r.setPixelRatio(Math.min(devicePixelRatio, 2))
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap
    r.info.autoReset = false
    this.pmrem = new THREE.PMREMGenerator(r)
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), new THREE.ShaderMaterial({
      vertexShader: SKY_V, fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { uSun: U.uSun, uNight: U.uNight, uTime: U.uTime, uGlowCol: U.uGlowCol, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uClouds: { value: 0.4 }, uFlash: { value: 0 } },
    }))
    this.sky.frustumCulled = false; this.sky.renderOrder = -1
    this.scene.add(this.sky, this.sun, this.sun.target, this.hemi, this.world, this.fx.group)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(4096, 4096)
    for (const m of MATS) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: m === 'metal' ? 0.35 : m === 'glass' ? 0.1 : m === 'water' ? 0.05 : m === 'roof' ? 0.7 : m === 'rock' ? 0.95 : 0.88, metalness: m === 'metal' ? 0.85 : 0, side: m === 'cloth' || m === 'leaf' || m === 'rock' ? THREE.DoubleSide : THREE.FrontSide })
      this.mats[m] = atmo(mat, { surface: m === 'stone' ? STONE : m === 'roof' ? MOTTLE : m === 'road' ? ROAD : m === 'rock' ? ROCK : '', post: m === 'rock' ? ROCK_POST : '', emissive: m === 'stained' ? 'totalEmissiveRadiance += diffuseColor.rgb * (0.35 + uNight * 1.6);' : '' })
    }
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }))
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new OutputPass())
    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uSat: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) }, uVig: { value: 0.35 },
        uContrast: { value: 1 }, uShadow: { value: new THREE.Color(1, 1, 1) }, uHigh: { value: new THREE.Color(1, 1, 1) }, uBrush: { value: 0 }, uInk: { value: 0 }, uBands: { value: 0 }, uGrain: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: STYLE_F,
    })
    this.composer.addPass(this.grade)
    this.fly = new Fly(this.camera, canvas)
    this.fly.ground = (x, z) => this.heightAt(x, z)
    this.setStyle('real')
    this.resize()
    this.loop()
  }

  /** Ground height at world (x, z): the detailed grid inside, the range beyond outside. */
  heightAt(x: number, z: number) {
    const b = this.built
    if (!b) return 0
    const look = (n: number, size: number, h: Float32Array) => {
      const c = size / n, fx = Math.min(n - 1e-6, Math.max(0, (x + size / 2) / c)), fz = Math.min(n - 1e-6, Math.max(0, (z + size / 2) / c))
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, w = n + 1
      return (h[j * w + i] * (1 - tx) + h[j * w + i + 1] * tx) * (1 - tz) + (h[(j + 1) * w + i] * (1 - tx) + h[(j + 1) * w + i + 1] * tx) * tz
    }
    const ground = Math.abs(x) < b.size / 2 && Math.abs(z) < b.size / 2 ? look(b.N, b.size, b.heights) : look(b.outer.n, b.outer.size, b.outer.heights)
    return b.sea != null ? Math.max(ground, b.sea) : ground
  }

  setBuilt(b: CityBuilt, keepView: boolean, snowline?: number) {
    for (const c of [...this.world.children]) { c.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); this.world.remove(c) }
    this.built = b
    this.noReflect = []
    this.snowline = snowline ?? b.snowline ?? b.maxH - (b.maxH - b.minH) * 0.18
    this.vlod?.dispose(); this.vlod = null
    if (b.volume) { this.vlod = new VolumeLod(b, this.terrainMat); this.world.add(this.vlod.group) } // the ground and its rock as one surface, fine near the camera
    else this.world.add(terrainTiles(b, this.terrainMat))
    const outer = new THREE.Mesh(gridMesh(b.outer.n, b.outer.size, b.outer.heights, b.outer.colors), this.terrainMat)
    outer.receiveShadow = true
    this.world.add(outer, new THREE.Mesh(skirtMesh(b.outer.n, b.outer.size, b.outer.heights, b.outer.colors, FAR), this.terrainMat))
    // water: height texture for depth, lakes and canals, rivers, the sea
    this.heightTex?.dispose(); this.fieldTex?.dispose()
    this.fieldTex = new THREE.DataTexture(b.fields.tex, b.fields.n, b.fields.n, THREE.RGBAFormat)
    this.fieldTex.magFilter = THREE.LinearFilter; this.fieldTex.minFilter = THREE.LinearMipmapLinearFilter; this.fieldTex.generateMipmaps = true; this.fieldTex.anisotropy = 8; this.fieldTex.needsUpdate = true
    this.marksTex?.dispose()
    this.marksTex = new THREE.DataTexture(b.marks.tex, b.marks.n, b.marks.n, THREE.RGBAFormat)
    this.marksTex.magFilter = THREE.LinearFilter; this.marksTex.minFilter = THREE.LinearMipmapLinearFilter; this.marksTex.generateMipmaps = true; this.marksTex.needsUpdate = true
    U.tField.value = this.fieldTex; U.tMarks.value = this.marksTex; U.uMapSize.value = b.size
    this.heightTex = heightTexture(b.heights, b.N)
    WATER_U.tHeight.value = this.heightTex; WATER_U.uGrid.value.set(b.size, b.N)
    const water: THREE.Object3D[] = []
    if (b.water.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(b.water, 3)); g.setAttribute('flow', new THREE.BufferAttribute(new Float32Array((b.water.length / 3) * 2), 2)); g.computeVertexNormals(); const m = new THREE.Mesh(g, this.lakeMat); m.renderOrder = 1; water.push(m) }
    if (b.rivers.pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(b.rivers.pos, 3)); g.setAttribute('flow', new THREE.BufferAttribute(b.rivers.uv, 2)); g.computeVertexNormals(); const m = new THREE.Mesh(g, this.riverMat); m.renderOrder = 1; water.push(m) }
    if (b.sea != null) { const g = new THREE.PlaneGeometry(FAR * 2, FAR * 2, 64, 64).rotateX(-Math.PI / 2); g.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); const m = new THREE.Mesh(g, this.seaMat); m.position.y = b.sea; m.renderOrder = 1; water.push(m) }
    this.world.add(...water); this.noReflect.push(...water)
    this.waterSamples = b.waterLevels.map((level) => ({ level, pts: [] as [number, number][] }))
    for (let k = 0; k < b.water.length; k += 18 * 8) { const s = this.waterSamples.find((w) => Math.abs(w.level - b.water[k + 1]) < 0.01); s?.pts.push([b.water[k], b.water[k + 2]]) }
    for (const m of MATS) { // merged structures, roads and rock, split into map chunks so each is culled on its own
      const g = b.geo[m]
      if (!g.pos.length) continue
      for (const part of splitTris(g, 1400)) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(part.pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(part.nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(part.col, 3))
        geo.computeBoundingSphere()
        const mesh = new THREE.Mesh(geo, this.mats[m]); mesh.castShadow = m !== 'water' && m !== 'glass' && m !== 'road'; mesh.receiveShadow = true
        this.world.add(mesh)
      }
    }
    // the great structures' ornament and carving: in small chunks, each drawn only while the camera is near it
    b.detail.forEach((tier, t) => {
      const [chunk, reach] = DETAIL_LOD[t]
      for (const m of MATS) {
        const g = tier[m]
        if (!g.pos.length) continue
        for (const part of splitTris(g, chunk)) {
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.BufferAttribute(part.pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(part.nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(part.col, 3))
          geo.computeBoundingSphere()
          const mesh = new THREE.Mesh(geo, this.mats[m]); mesh.castShadow = t === 0 && m !== 'glass'; mesh.receiveShadow = true
          const lod = this.lodOf(part.pos[0], part.pos[2], chunk, [[mesh, 0], [null, reach]])
          this.world.add(lod); this.noReflect.push(lod)
        }
      }
    })
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0)
    // buildings: parts grouped by shape within chunks, so each chunk is culled on its own
    const p = b.parts, np = p.length / PSTRIDE, geos = partGeometries(), small = new Set<number>([PART.chimney, PART.balcony, PART.awning, PART.vine, PART.drywall, PART.dormer])
    for (const ids of chunks(np, (i) => [p[i * PSTRIDE + 1], p[i * PSTRIDE + 3]], 1400)) {
      const byType: number[][] = Array.from({ length: PART_COUNT }, () => [])
      for (const i of ids) byType[p[i * PSTRIDE]].push(i)
      byType.forEach((list, type) => {
        if (!list.length) return
        const wall = type === PART.wall, roof = ROOF_PARTS.has(type), g = wall ? geos[type].clone() : geos[type].clone()
        const im = new THREE.InstancedMesh(g, wall ? this.wallMat : roof ? this.roofMat : this.partMat, list.length)
        const d4 = wall ? new Float32Array(list.length * 4) : null, d2 = new Float32Array(list.length * 2)
        list.forEach((i, k) => {
          const o = i * PSTRIDE
          Q.setFromAxisAngle(Y, p[o + 4])
          im.setMatrixAt(k, M.compose(P.set(p[o + 1], p[o + 2], p[o + 3]), Q, S.set(p[o + 5], p[o + 6], p[o + 7])))
          im.setColorAt(k, C.setRGB(p[o + 8], p[o + 9], p[o + 10]))
          if (d4) { d4.set([p[o + 11], p[o + 12], p[o + 13], p[o + 14]], k * 4); d2.set([p[o + 15], p[o + 16]], k * 2) } else d2.set([p[o + 11], p[o + 12]], k * 2)
        })
        if (d4) { g.setAttribute('iData', new THREE.InstancedBufferAttribute(d4, 4)); g.setAttribute('iStyle', new THREE.InstancedBufferAttribute(d2, 2)) }
        if (roof) g.setAttribute('iTile', new THREE.InstancedBufferAttribute(d2, 2))
        im.castShadow = type !== PART.vine && type !== PART.drywall; im.receiveShadow = true; im.computeBoundingSphere()
        if (small.has(type)) { const lod = this.lodOf(p[list[0] * PSTRIDE + 1], p[list[0] * PSTRIDE + 3], 1400, [[im, 0], [null, 2600]]); this.world.add(lod); this.noReflect.push(lod) } else this.world.add(im)
      })
    }
    // forests, orchards, hedges and rocks: detailed near, simple further out, nothing far away
    const t = b.trees, tg = treeGeometries()
    for (const ids of chunks(t.length / TSTRIDE, (i) => [t[i * TSTRIDE], t[i * TSTRIDE + 2]], 900)) {
      const levels = [0, 1].map((lvl) => {
        const g = new THREE.Group(), byKind: number[][] = Array.from({ length: tg.length }, () => [])
        for (const i of ids) byKind[t[i * TSTRIDE + 4]]?.push(i)
        byKind.forEach((mine, kind) => {
          if (!mine.length) return
          const im = new THREE.InstancedMesh(tg[kind][lvl], this.treeMat, mine.length)
          mine.forEach((i, k) => {
            const o = i * TSTRIDE, s = t[o + 3], sh = t[o + 5]
            Q.setFromAxisAngle(Y, (i * 2.399) % 6.28)
            im.setMatrixAt(k, M.compose(P.set(t[o], t[o + 1], t[o + 2]), Q, S.set(s, s * (0.85 + ((i * 0.37) % 0.3)), s)))
            im.setColorAt(k, C.setRGB(sh, sh, sh))
          })
          im.castShadow = lvl === 0; im.receiveShadow = true; im.computeBoundingSphere()
          g.add(im)
        })
        return g
      })
      const lod = this.lodOf(t[ids[0] * TSTRIDE], t[ids[0] * TSTRIDE + 2], 900, [[levels[0], 0], [levels[1], 1100], [null, 6000]])
      this.world.add(lod); this.noReflect.push(lod)
    }
    const rk = b.rocks, rg = rockGeo()
    for (const ids of chunks(rk.length / 5, (i) => [rk[i * 5], rk[i * 5 + 2]], 900)) {
      const im = new THREE.InstancedMesh(rg, this.rockMat, ids.length)
      ids.forEach((i, k) => { const o = i * 5, s = rk[o + 3]; Q.setFromAxisAngle(Y, rk[o + 4]); im.setMatrixAt(k, M.compose(P.set(rk[o], rk[o + 1], rk[o + 2]), Q, S.set(s, s, s))) })
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere()
      const lod = this.lodOf(rk[ids[0] * 5], rk[ids[0] * 5 + 2], 900, [[im, 0], [null, 3500]])
      this.world.add(lod); this.noReflect.push(lod)
    }
    this.fx.setWorld({ size: b.size, minH: b.minH, maxH: b.maxH, chimneys: b.chimneys, lamps: b.lamps, falls: b.falls, steam: b.steam })
    this.noReflect.push(this.fx.group)
    this.applyAtmos()
    if (!keepView) this.frameAll()
  }
  /** A LOD whose distances are measured from the middle of the chunk containing (x, z); the levels keep world positions. */
  private lodOf(x: number, z: number, size: number, levels: [THREE.Object3D | null, number][]) {
    const lod = new THREE.LOD(), cx = Math.floor(x / size) * size + size / 2, cz = Math.floor(z / size) * size + size / 2
    lod.position.set(cx, this.heightAt(cx, cz), cz)
    for (const [o, d] of levels) { const obj = o ?? new THREE.Object3D(); obj.position.set(-cx, -lod.position.y, -cz); lod.addLevel(obj, d) }
    return lod
  }
  /** Look over the whole place from the south-east, high up. */
  frameAll() {
    const b = this.built
    if (!b) return
    const d = b.size * 0.62, x = d * 0.55, z = d * 0.85, y = b.maxH + b.size * 0.22
    this.fly.set({ x, y, z, yaw: Math.atan2(x, z), pitch: -Math.atan2(y - (b.minH + b.maxH) / 2, Math.hypot(x, z)) })
  }
  view(name: string): View {
    const p = this.fly.tgt
    return { name, at: [Math.round(p.x), Math.round(-p.z), Math.round(p.y)], heading: Math.round(((-p.yaw / DEG) % 360 + 360) % 360), pitch: Math.round((p.pitch / DEG) * 10) / 10 }
  }
  goto(v: View, glide = true) { this.fly.set({ x: v.at[0], y: v.at[2], z: -v.at[1], yaw: -v.heading * DEG, pitch: v.pitch * DEG } as Pose, glide) }

  setStyle(name: StyleName) {
    this.style = name
    const st = STYLES[name], g = this.grade.uniforms
    g.uContrast.value = st.contrast; g.uShadow.value.set(st.shadow); g.uHigh.value.set(st.high); g.uVig.value = st.vig
    g.uBrush.value = st.brush; g.uInk.value = st.ink; g.uBands.value = st.bands; g.uGrain.value = st.grain
    this.applyAtmos()
  }
  setAtmos(a: Partial<Atmos>) { this.atmos = { ...this.atmos, ...a }; this.applyAtmos() }
  /** Sky, light, fog, weather and season from the hour, the weather, the season and the valley mist. */
  private applyAtmos() {
    const { hour, weather, season, mist } = this.atmos, wx = WEATHER[weather], b = this.built, st = STYLES[this.style ?? 'real']
    const el = 62 * Math.sin((Math.PI * (hour - 6.5)) / 13), az = 90 + ((hour - 6.5) / 13) * 180
    let i = 0
    while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++
    const k0 = KEYS[i], k1 = KEYS[i + 1], t = Math.min(1, Math.max(0, (el - k0.el) / (k1.el - k0.el)))
    const c = (p: 'sun' | 'zenith' | 'horizon' | 'glow' | 'hemi' | 'ground' | 'tint') => new THREE.Color(k0[p]).lerp(new THREE.Color(k1[p]), t)
    const n = (p: 'sunI' | 'hemiI' | 'exposure' | 'night' | 'haze' | 'sat') => k0[p] + (k1[p] - k0[p]) * t
    const grey = (col: THREE.Color, g: number) => { const l = col.r * 0.3 + col.g * 0.59 + col.b * 0.11; return col.lerp(new THREE.Color(l, l, l * 1.04), g) }
    const night = n('night')
    this.sunDir.setFromSphericalCoords(1, (90 - el) * DEG, (180 - az) * DEG)
    // at night the moon lights the land from high in the south-west
    if (el < -6) this.lightDir.setFromSphericalCoords(1, 55 * DEG, (180 - 215) * DEG)
    else this.lightDir.copy(this.sunDir).setY(Math.max(0.12, this.sunDir.y)).normalize()
    U.uSun.value.copy(el < -6 ? this.lightDir : this.sunDir)
    this.sun.color.copy(c('sun')); this.sun.intensity = n('sunI') * wx.sun * st.sun
    this.hemi.color.copy(grey(c('hemi'), wx.grey)); this.hemi.groundColor.copy(c('ground')); this.hemiBase = this.hemi.intensity = n('hemiI') * (1 + wx.grey * 0.6)
    const horizon = grey(c('horizon'), wx.grey * 0.8)
    U.uFogCol.value.copy(horizon); U.uGlowCol.value.copy(grey(c('glow'), wx.grey)); U.uHaze.value = n('haze') * wx.haze * st.haze; U.uNight.value = night
    U.uSky.value.copy(grey(c('zenith'), wx.grey)).lerp(horizon, 0.5)
    const su = this.sky.material.uniforms
    su.uZenith.value.copy(grey(c('zenith'), wx.grey * 0.9)); su.uHorizon.value.copy(horizon); su.uSunCol.value.copy(c('sun')); su.uClouds.value = wx.clouds
    WATER_U.uZenith.value.copy(su.uZenith.value); WATER_U.uSunCol.value.copy(c('sun')); WATER_U.uSunI.value = n('sunI') * wx.sun
    WATER_U.uAmb.value.copy(grey(c('hemi'), wx.grey)).multiplyScalar(this.hemiBase * 0.55)
    this.renderer.toneMappingExposure = n('exposure') * (1 + wx.grey * 0.25)
    this.grade.uniforms.uSat.value = n('sat') * (1 - wx.grey * 0.25) * st.sat; this.grade.uniforms.uTint.value.copy(c('tint'))
    // fog: a base by the hour, more with mist and bad weather; it pools in the valleys
    const lo = Math.max(b?.minH ?? 0, b?.sea ?? -Infinity), hi = b?.maxH ?? 2000 // the sea floor never counts as low ground
    U.uFogBase.value = lo + (0.06 + mist * 0.14) * (hi - lo)
    U.uFogD.value = (0.000015 + mist * mist * 0.005) * wx.fog // valley fog only when there is mist (or weather)
    U.uFogFall.value = 1 / (900 - mist * 780)
    U.uWet.value = wx.wet
    // season: snow line (winter brings it right down), foliage colour, bare trees
    const winter = season === 'winter', snowFall = weather === 'snow'
    U.uSnow.value = 1
    U.uSnowLine.value = winter ? lo + (hi - lo) * (snowFall ? -0.1 : 0.12) : snowFall ? lo + (hi - lo) * 0.45 : this.snowline
    U.uFoliage.value.set(FOLIAGE[season]); U.uBare.value = winter ? 1 : 0
    this.fx.state = {
      clouds: wx.clouds, mist, fogBase: U.uFogBase.value, precip: wx.precip, storm: wx.storm, night,
      cloudCol: grey(horizon.clone().multiplyScalar(0.85), 0.2), cloudLit: c('sun').lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(night > 0.5 ? 0.2 : 1), sun: U.uSun.value.clone(),
      wind: new THREE.Vector3(3, 0, 1.5).multiplyScalar(wx.storm ? 4 : weather === 'clear' ? 1 : 2),
    }
    // the sky's light for reflections, redone only when the hour or the weather changes noticeably
    if (Math.abs(hour - this.envHour) > 0.25 || weather !== this.envWeather) {
      this.envHour = hour; this.envWeather = weather
      const envScene = new THREE.Scene()
      envScene.add(new THREE.Mesh(this.sky.geometry, this.sky.material))
      this.envRT?.dispose()
      this.envRT = this.pmrem.fromScene(envScene, 0, 1, 5000)
      this.scene.environment = this.envRT.texture
    }
    this.scene.environmentIntensity = night > 0.5 ? 0.25 : 0.6 * (1 - wx.grey * 0.3)
  }

  /** While shooting: draw at this size (pixel ratio 1) whatever the window, so shots from any session line up. */
  private shotSize: [number, number] | null = null
  resize() {
    const [w, h] = this.shotSize ?? [this.canvas.clientWidth, this.canvas.clientHeight]
    if (!w || !h) return
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix()
    const pr = this.renderer.getPixelRatio()
    this.grade.uniforms.uRes.value.set(w * pr, h * pr)
    this.reflection.resize(w * pr, h * pr)
  }

  /** The water level to mirror this frame: the water body nearest to where the camera is looking. */
  private reflectLevel() {
    const b = this.built
    if (!b || !b.waterLevels.length) return null
    const f = new THREE.Vector3(); this.camera.getWorldDirection(f)
    const alt = Math.max(20, this.fly.altitude()), look = this.camera.position.clone().addScaledVector(f.setY(0).normalize(), Math.min(4000, alt * 2.5))
    let best: number | null = null, bd = Infinity
    for (const s of this.waterSamples) for (const [x, z] of s.pts) { const d = Math.hypot(x - look.x, z - look.z); if (d < bd && s.level < this.camera.position.y) { bd = d; best = s.level } }
    if (b.sea != null && this.camera.position.y > b.sea) { const ground = this.heightAt(look.x, look.z); if (ground <= b.sea + 1 && (bd > 300 || best == null)) best = b.sea }
    return bd < 6000 || best === b.sea ? best : null
  }

  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.frame(dt)
  }
  private frame(dt: number) {
    U.uTime.value += dt
    if (this.canvas.width !== (this.shotSize?.[0] ?? Math.floor(this.canvas.clientWidth * this.renderer.getPixelRatio()))) this.resize()
    if (this.playing) { this.atmos.hour = (this.atmos.hour + this.playing * dt) % 24; this.applyAtmos(); this.onHour?.(this.atmos.hour) }
    this.fly.update(dt)
    this.vlod?.update(this.camera.position)
    this.fx.update(dt, U.uTime.value, this.camera.position, this.canvas.clientHeight * this.renderer.getPixelRatio())
    const flash = this.fx.flash
    this.sky.material.uniforms.uFlash.value = flash
    this.hemi.intensity = this.hemiBase + flash * 2.5
    // the sun's shadow covers what you are looking at, sized to how high you are
    const alt = Math.max(10, this.fly.altitude()), half = THREE.MathUtils.clamp(alt * 1.6 + 150, 200, 7000)
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize()
    const focus = this.camera.position.clone().addScaledVector(fwd, half * 0.6)
    focus.y = this.heightAt(focus.x, focus.z)
    const snap = (half * 2) / 4096; focus.x = Math.round(focus.x / snap) * snap; focus.z = Math.round(focus.z / snap) * snap
    const sc = this.sun.shadow.camera
    this.sun.target.position.copy(focus); this.sun.position.copy(focus).addScaledVector(this.lightDir, half * 3)
    if (sc.right !== half) { Object.assign(sc, { left: -half, right: half, top: half, bottom: -half, near: half * 0.5, far: half * 6 }); sc.updateProjectionMatrix(); this.sun.shadow.normalBias = snap * 2.5; this.sun.shadow.bias = -0.0002 }
    this.camera.near = THREE.MathUtils.clamp(alt * 0.002, 0.3, 20); this.camera.updateProjectionMatrix()
    this.renderer.info.reset()
    // mirror the town and mountains in the nearest water
    const level = this.reflectLevel()
    if (level != null) this.reflection.render(this.renderer, this.scene, this.camera, level, this.noReflect)
    else WATER_U.uHasRefl.value = 0
    this.composer.render(dt)
    const a = this.acc
    a.t += dt; a.n++
    if (a.t > 0.5) { this.onStats?.({ fps: Math.round(a.n / a.t), calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles }); a.t = 0; a.n = 0 }
  }

  /** Dev: save a 1280 x 720 shot from each [name, [x, y, alt], heading, pitch, atmosphere?]; a negative alt is metres above the ground. */
  async shots(prefix: string, list: [string, [number, number, number], number, number, Partial<Atmos>?][], atmos: Partial<Atmos> = {}) {
    const keep = { ...this.atmos }, pr = this.renderer.getPixelRatio()
    this.shotSize = [1280, 720]; this.renderer.setPixelRatio(1); this.resize()
    try {
      for (const [name, at, heading, pitch, own = {}] of list) {
        const alt = at[2] < 0 ? this.heightAt(at[0], -at[1]) - at[2] : at[2]
        this.goto({ name, at: [at[0], at[1], alt], heading, pitch }, false)
        const set = Object.fromEntries(Object.entries({ ...atmos, ...own }).filter(([, v]) => v !== undefined))
        this.setAtmos({ hour: 10, weather: 'clear', season: 'summer', mist: 0.15, ...set })
        this.frame(0.016)
        await this.vlod?.settle(this.camera.position) // the ground in full detail before the picture
        await this.shot(prefix + name)
      }
    } finally { this.shotSize = null; this.renderer.setPixelRatio(pr); this.resize(); this.setAtmos(keep) }
    return list.length
  }
  /** Dev: the standard set (saved views, overview, low pass, each structure, each town at street height) as
   * test/out/shots/<prefix><location id>-<shot>.jpg; `node scripts/loc-sheet.ts before- after-` puts two sets side by side. */
  async standard(prefix: string) {
    if (!this.doc) throw new Error('no location shown')
    return this.shots(`${prefix}${this.doc.id}-`, standardShots(this.doc, (x, y) => this.heightAt(x, -y)))
  }
  /** Dev: draw this frame and save it as test/out/shots/<name>.jpg through the dev server, for Claude to look at. */
  async shot(name: string) {
    this.frame(0.016)
    const blob = await new Promise<Blob | null>((r) => this.canvas.toBlob(r, 'image/jpeg', 0.9))
    if (blob) await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.fly.dispose(); this.fx.dispose(); this.vlod?.dispose()
    this.world.traverse((c) => (c as THREE.Mesh).geometry?.dispose())
    for (const m of [...Object.values(this.mats), this.terrainMat, this.wallMat, this.roofMat, this.partMat, this.treeMat, this.rockMat, this.lakeMat, this.seaMat, this.riverMat]) m.dispose()
    this.heightTex?.dispose(); this.fieldTex?.dispose(); this.marksTex?.dispose(); this.reflection.rt.dispose()
    this.envRT?.dispose(); this.pmrem.dispose(); this.composer.dispose(); this.renderer.dispose()
  }
}
