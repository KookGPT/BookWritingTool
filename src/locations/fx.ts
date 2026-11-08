// Locations effects: cloud banks you can fly through, rain and snow around the camera, chimney smoke, birds, waterfall
// spray and lamp glows at night. Each is one draw call; positions are worked out in the vertex shader where possible.
import * as THREE from 'three'

const rnd = (s: number) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }

/** Camera-facing soft puffs (clouds, mist, spray, smoke): per instance centre (xyz) + size (w), and a phase. */
const PUFF_V = /* glsl */ `
attribute vec4 iPuff; attribute float iPhase;
uniform float uTime; uniform float uRise; uniform vec3 uWind;
varying vec2 vUv; varying float vFade; varying vec3 vW; varying float vLife;
void main() {
  vUv = uv;
  float life = uRise > 0.0 ? fract(uTime * uRise + iPhase) : 0.0;
  vLife = life;
  vec3 c = iPuff.xyz + uWind * (uRise > 0.0 ? life * 20.0 : uTime) + vec3(0.0, life * 26.0, 0.0);
  float size = iPuff.w * (uRise > 0.0 ? 0.4 + life * 1.6 : 1.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = c + (right * position.x + up * position.y) * size;
  vW = p;
  float d = distance(cameraPosition, c);
  vFade = smoothstep(size * 0.25, size * 0.9, d) * (1.0 - smoothstep(20000.0, 32000.0, d));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`
const PUFF_F = /* glsl */ `
uniform vec3 uCol; uniform vec3 uLit; uniform vec3 uSun; uniform float uAlpha; uniform float uRise; uniform float uTime;
varying vec2 vUv; varying float vFade; varying vec3 vW; varying float vLife;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 q = vUv - 0.5; float r = length(q) * 2.0;
  float sh = n(vUv * 4.0 + vW.xz * 0.002 + uTime * 0.01) * 0.6 + n(vUv * 9.0 - uTime * 0.02) * 0.4;
  float a = smoothstep(1.0, 0.25, r + (sh - 0.5) * 0.6) * uAlpha * vFade;
  if (uRise > 0.0) a *= smoothstep(0.0, 0.1, vLife) * (1.0 - vLife);
  if (a < 0.004) discard;
  vec3 c = mix(uCol, uLit, clamp(0.5 + q.y * 1.2 + (sh - 0.5) * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(c, a);
}`
function puffMesh(n: number, fill: (i: number) => [number, number, number, number, number], extra: Record<string, THREE.IUniform>) {
  const g = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry)
  const a = new Float32Array(n * 4), ph = new Float32Array(n)
  for (let i = 0; i < n; i++) { const [x, y, z, s, p] = fill(i); a.set([x, y, z, s], i * 4); ph[i] = p }
  g.setAttribute('iPuff', new THREE.InstancedBufferAttribute(a, 4)); g.setAttribute('iPhase', new THREE.InstancedBufferAttribute(ph, 1)); g.instanceCount = n
  const m = new THREE.ShaderMaterial({
    vertexShader: PUFF_V, fragmentShader: PUFF_F, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uRise: { value: 0 }, uWind: { value: new THREE.Vector3() }, uCol: { value: new THREE.Color() }, uLit: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uAlpha: { value: 1 }, ...extra },
  })
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false
  return mesh
}

export interface FxWorld { size: number; minH: number; maxH: number; chimneys: Float32Array; lamps: Float32Array; falls: Float32Array }
export interface FxState { clouds: number; mist: number; fogBase: number; precip: 'none' | 'rain' | 'snow'; storm: boolean; night: number; cloudCol: THREE.Color; cloudLit: THREE.Color; sun: THREE.Vector3; wind: THREE.Vector3 }

export class Fx {
  group = new THREE.Group()
  private clouds?: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private mist?: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private spray?: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private smoke: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>
  private snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private lamps?: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private birds: THREE.InstancedMesh
  private flocks: { c: THREE.Vector3; r: number; speed: number; n: number }[] = []
  private world?: FxWorld
  private smokeT = 0
  flash = 0; private nextFlash = 5
  state?: FxState

  constructor() {
    // smoke: 8 puffs for each of the 260 chimneys nearest the camera (re-picked once a second)
    this.smoke = puffMesh(260 * 8, (i) => [0, -1e5, 0, 7, (i % 8) / 8], {})
    this.smoke.material.uniforms.uRise.value = 0.07
    this.smoke.material.uniforms.uAlpha.value = 0.28
    // rain: streaks that wrap in a box around the camera
    const R = rnd(7), nr = 16000, rp = new Float32Array(nr * 6)
    for (let i = 0; i < nr; i++) { const x = R(), y = R(), z = R(); rp.set([x, y, z, x, y, z], i * 6); rp[i * 6 + 4] = y + 1 } // second vertex marks the tail
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3))
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uWind: { value: new THREE.Vector3() }, uCol: { value: new THREE.Color(0.7, 0.75, 0.8) } },
      vertexShader: 'uniform float uTime; uniform vec3 uCam; uniform float uAmt; uniform vec3 uWind; varying float vA; void main() { float tail = step(1.0, position.y); vec3 p = vec3(position.x, fract(position.y - tail - uTime * 0.55), position.z); vec3 box = vec3(120.0, 90.0, 120.0); vec3 w = uCam + (fract(p + vec3(uWind.x, 0.0, uWind.z) * uTime * 0.002 + uCam / box * -1.0) - 0.5) * box; w += (uWind * 0.02 + vec3(0.0, 1.0, 0.0)) * tail * 1.6; vA = uAmt * (0.25 + 0.3 * fract(position.x * 91.7)); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }',
      fragmentShader: 'uniform vec3 uCol; varying float vA; void main() { gl_FragColor = vec4(uCol, vA); }',
    }))
    this.rain.frustumCulled = false
    // snow: soft flakes drifting down and swaying
    const ns = 22000, sp = new Float32Array(ns * 3)
    for (let i = 0; i < ns * 3; i++) sp[i] = R()
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    this.snow = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uWind: { value: new THREE.Vector3() }, uScale: { value: 600 } },
      vertexShader: 'uniform float uTime; uniform vec3 uCam; uniform float uAmt; uniform vec3 uWind; uniform float uScale; varying float vA; void main() { vec3 box = vec3(140.0, 100.0, 140.0); vec3 p = position + vec3(sin(uTime * 0.7 + position.z * 40.0) * 0.01, -uTime * 0.012, cos(uTime * 0.5 + position.x * 30.0) * 0.01) + uWind * uTime * 0.0006; vec3 w = uCam + (fract(p - uCam / box) - 0.5) * box; vec4 mv = viewMatrix * vec4(w, 1.0); gl_PointSize = uScale * 0.12 / -mv.z; vA = uAmt; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main() { float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(vec3(0.95), vA * smoothstep(0.5, 0.1, r)); }',
    }))
    this.snow.frustumCulled = false
    // birds: little V shapes whose wings beat in the vertex shader
    const bg = new THREE.BufferGeometry()
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.3, -1, 0, -0.2, 0, 0, -0.3, 0, 0, 0.3, 0, 0, -0.3, 1, 0, -0.2]), 3))
    bg.setAttribute('wing', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 0, 1]), 1))
    const bm = new THREE.MeshBasicMaterial({ color: 0x1a1a1e, side: THREE.DoubleSide })
    bm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 }; bm.userData.sh = sh
      sh.vertexShader = 'uniform float uTime; attribute float wing;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;\n#else\n float ph = 0.0;\n#endif\n transformed.y += wing * sin(uTime * 9.0 + ph) * 0.8;')
    }
    this.birds = new THREE.InstancedMesh(bg, bm, 8 * 16)
    this.birds.frustumCulled = false
    this.group.add(this.smoke, this.rain, this.snow, this.birds)
  }

  setWorld(w: FxWorld) {
    this.world = w
    for (const m of [this.clouds, this.mist, this.spray, this.lamps]) if (m) { this.group.remove(m); m.geometry.dispose(); m.material.dispose() }
    const R = rnd(11), half = w.size * 1.6, span = w.maxH - w.minH
    // cloud banks around and above the high ground, and mist puffs that pool in the valleys
    this.clouds = puffMesh(700, () => [(R() - 0.5) * half * 2, w.maxH - span * 0.1 + R() * (span * 0.5 + 500), (R() - 0.5) * half * 2, 260 + R() * 700, R()], {})
    this.mist = puffMesh(900, () => [(R() - 0.5) * w.size, 0, (R() - 0.5) * w.size, 180 + R() * 380, R()], {})
    const fa = w.falls, nf = Math.max(1, (fa.length / 4) * 10)
    this.spray = puffMesh(nf, (i) => { const k = Math.floor(i / 10) * 4; return fa.length ? [fa[k] + (R() - 0.5) * fa[k + 3], fa[k + 1] + R() * 6, fa[k + 2] + (R() - 0.5) * fa[k + 3], fa[k + 3] * (0.8 + R()), R()] : [0, -1e5, 0, 1, 0] }, {})
    this.spray.material.uniforms.uRise.value = 0.12; this.spray.material.uniforms.uAlpha.value = 0.35
    this.spray.material.uniforms.uCol.value.setRGB(0.85, 0.88, 0.9); this.spray.material.uniforms.uLit.value.setRGB(1, 1, 1)
    // lamps: warm glows that only show at night
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(w.lamps, 3))
    this.lamps = new THREE.Points(lg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uNight: { value: 0 }, uScale: { value: 600 } },
      vertexShader: 'uniform float uScale; uniform float uNight; varying float vA; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z; gl_PointSize = clamp(uScale * 9.0 / d, 2.0, 90.0); vA = uNight * (1.0 - smoothstep(2500.0, 6000.0, d)); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0 || vA < 0.01) discard; float core = smoothstep(0.25, 0.0, r), halo = pow(1.0 - r, 2.2) * 0.45; gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * (core * 2.5 + halo), (core + halo) * vA); }',
    }))
    this.lamps.frustumCulled = false
    this.group.add(this.clouds, this.mist, this.spray, this.lamps)
    // flocks circle over high points
    this.flocks = Array.from({ length: 8 }, () => ({ c: new THREE.Vector3((R() - 0.5) * w.size * 0.7, w.minH + span * (0.4 + R() * 0.5) + 60, (R() - 0.5) * w.size * 0.7), r: 120 + R() * 400, speed: 0.05 + R() * 0.06, n: 10 + Math.floor(R() * 7) }))
    this.smokeT = 0
  }

  /** Per frame: follow the camera, animate, apply the weather. Returns true while lightning is lit. */
  update(dt: number, time: number, cam: THREE.Vector3, viewport: number) {
    const s = this.state, w = this.world
    if (!s || !w) return
    for (const m of [this.clouds, this.mist, this.spray, this.smoke]) if (m) { const u = m.material.uniforms; u.uTime.value = time; u.uSun.value.copy(s.sun); u.uWind.value.copy(s.wind) }
    if (this.clouds) { const u = this.clouds.material.uniforms; u.uAlpha.value = Math.min(1, s.clouds * 1.15) * 0.75; u.uCol.value.copy(s.cloudCol); u.uLit.value.copy(s.cloudLit); u.uWind.value.copy(s.wind).multiplyScalar(0.8); this.clouds.visible = s.clouds > 0.05 }
    if (this.mist) {
      const u = this.mist.material.uniforms; u.uAlpha.value = s.mist * 0.55; u.uCol.value.copy(s.cloudCol).lerp(s.cloudLit, 0.3); u.uLit.value.copy(s.cloudLit); u.uWind.value.copy(s.wind).multiplyScalar(0.25)
      const a = this.mist.geometry.getAttribute('iPuff') as THREE.InstancedBufferAttribute
      if (a.getY(0) !== s.fogBase) { for (let i = 0; i < a.count; i++) a.setY(i, s.fogBase - 40 + (i % 7) * 18); a.needsUpdate = true }
      this.mist.visible = s.mist > 0.05
    }
    if (this.smoke) { const u = this.smoke.material.uniforms; u.uCol.value.setRGB(0.42, 0.4, 0.39).lerp(s.cloudCol, 0.3); u.uLit.value.setRGB(0.75, 0.73, 0.7).lerp(s.cloudLit, 0.3) }
    // smoke follows the chimneys nearest the camera
    if ((this.smokeT -= dt) <= 0 && w.chimneys.length) {
      this.smokeT = 1
      const c = w.chimneys, n = c.length / 4, best: [number, number][] = []
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 40000))) { const d = (c[i * 4] - cam.x) ** 2 + (c[i * 4 + 2] - cam.z) ** 2; if (d < 2500 ** 2) best.push([d, i]) }
      best.sort((a, b) => a[0] - b[0])
      const a = this.smoke.geometry.getAttribute('iPuff') as THREE.InstancedBufferAttribute
      for (let k = 0; k < 260; k++) for (let p = 0; p < 8; p++) { const i = best[k]?.[1]; a.setXYZW(k * 8 + p, i == null ? 0 : c[i * 4], i == null ? -1e5 : c[i * 4 + 1] + c[i * 4 + 3], i == null ? 0 : c[i * 4 + 2], 5 + (k % 3)) }
      a.needsUpdate = true
    }
    // weather around the camera
    const ru = this.rain.material.uniforms, su = this.snow.material.uniforms
    ru.uTime.value = time; ru.uCam.value.copy(cam); ru.uAmt.value = s.precip === 'rain' ? (s.storm ? 0.9 : 0.6) : 0; ru.uWind.value.copy(s.wind)
    su.uTime.value = time; su.uCam.value.copy(cam); su.uAmt.value = s.precip === 'snow' ? 0.85 : 0; su.uWind.value.copy(s.wind); su.uScale.value = viewport
    this.rain.visible = s.precip === 'rain'; this.snow.visible = s.precip === 'snow'
    if (this.lamps) { this.lamps.material.uniforms.uNight.value = s.night; this.lamps.material.uniforms.uScale.value = viewport; this.lamps.visible = s.night > 0.02 }
    // birds (not at night or in storms)
    this.birds.visible = s.night < 0.5 && !s.storm
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(2.2, 2.2, 2.2), Y = new THREE.Vector3(0, 1, 0)
    let k = 0
    for (const [fi, f] of this.flocks.entries()) for (let i = 0; i < f.n && k < this.birds.count; i++, k++) {
      const a = time * f.speed + fi * 1.7 + i * 0.09, r = f.r + Math.sin(i * 2.3) * 30
      P.set(f.c.x + Math.cos(a) * r + Math.sin(i * 7.1) * 12, f.c.y + Math.sin(a * 2 + i) * 15 + Math.cos(i * 3.3) * 8, f.c.z + Math.sin(a) * r + Math.cos(i * 5.7) * 12)
      Q.setFromAxisAngle(Y, -a)
      this.birds.setMatrixAt(k, M.compose(P, Q, S))
    }
    this.birds.count = k; this.birds.instanceMatrix.needsUpdate = true
    const bs = (this.birds.material as THREE.MeshBasicMaterial).userData.sh
    if (bs) bs.uniforms.uTime.value = time
    // lightning
    if (s.storm) { if ((this.nextFlash -= dt) <= 0) { this.flash = 1; this.nextFlash = 3 + Math.random() * 9 } } else this.nextFlash = 3
    this.flash = Math.max(0, this.flash - dt * (this.flash > 0.5 ? 6 : 2.5))
  }

  dispose() {
    for (const c of this.group.children) { const m = c as THREE.Mesh; m.geometry.dispose(); (m.material as THREE.Material).dispose() }
  }
}
