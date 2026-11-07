// What surrounds Eyaris on the Globe tab. `scene`/`camera` are the far sky, drawn first with no parallax: stars, constellations, the
// galaxy band, the sun, the planets and the asteroid belt, in units of 1 AU = 1000. `system` joins the planet's own scene, in planet
// radii: the axis marker, the moons and their orbits. Positions all come from the tables in solar.ts.
import * as THREE from 'three'
import { BELT, CONSTELLATIONS, MOONS, PLANETS, TILT_DEG, apparentDeg, eyarisAt, moonAt, northAxis, planetAt, type Look, type SkyPlanet } from './solar.ts'

const AU = 1000, STARS = 9000, FAR = 6e5, DEG = Math.PI / 180

export const NOISE3 = /* glsl */ `
float h3(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float fbm3(vec3 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * n3(p); p = p * 2.03 + 7.1; a *= .5; } return s; }
float ridge3(vec3 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * (1. - abs(n3(p) * 2. - 1.)); p = p * 2.1 + 3.3; a *= .5; } return s; }
`
const LOOKS: Record<Look, number> = { banded: 0, lava: 1, ice: 2, terra: 3, desert: 4, shattered: 5 }
const rgb = (c: string) => new THREE.Color().setStyle(c, THREE.LinearSRGBColorSpace)

// One shader for every planet, picked by uLook; the patterns are drawn from noise, so each stays sharp at any size.
const planetMat = (p: SkyPlanet, n: number) => new THREE.ShaderMaterial({
  side: p.look === 'shattered' ? THREE.DoubleSide : THREE.FrontSide,
  uniforms: { uLook: { value: LOOKS[p.look] }, uSeed: { value: n * 7.3 + 1 }, uA: { value: rgb(p.colors[0]) }, uB: { value: rgb(p.colors[1]) }, uC: { value: rgb(p.colors[2]) }, uL: { value: new THREE.Vector3() } },
  vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vV;
    void main() { vP = position; vN = normalize(mat3(modelMatrix) * position); vec4 w = modelMatrix * vec4(position, 1.); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: NOISE3 + /* glsl */ `
    uniform int uLook; uniform float uSeed; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uL;
    varying vec3 vP; varying vec3 vN; varying vec3 vV;
    void main() {
      vec3 p = normalize(vP), q = p + uSeed, col = uA, glow = vec3(0.);
      float air = 0.;
      if (uLook == 0) { // bands, turbulence between them, one long-lived storm
        float w = fbm3(q * 3.) * .16, l = p.y + w, b = sin(l * 17.) + .5 * sin(l * 41. + 1.3);
        col = mix(uA, uB, .5 + .5 * b);
        col = mix(col, uC, smoothstep(.55, .75, fbm3(vec3(q.x * 2., q.y * 13., q.z * 2.))));
        vec3 s = normalize(vec3(.7, -.32, .64)) ; float d = length((p - s) * vec3(1., 2.1, 1.));
        col = mix(col, uC * vec3(1.1, .75, .6), smoothstep(.2, .14, d + (fbm3(q * 9.) - .5) * .1));
        air = .6;
      } else if (uLook == 1) { // black crust split by lava
        float r = ridge3(q * 2.6);
        col = mix(uA, uB, fbm3(q * 4.));
        glow = uC * (pow(r, 7.) * 3.2 + .12 * smoothstep(.55, .8, fbm3(q * 2.)));
      } else if (uLook == 2) { // pale ice under long cracks
        col = mix(uA, uB, smoothstep(.3, .7, fbm3(vec3(q.x, q.y * 3., q.z) * 3.)));
        col = mix(col, uC, smoothstep(.72, .8, ridge3(q * 2.2)));
        air = .4;
      } else if (uLook == 3) { // oceans, land, cloud: somebody else's home
        float h = fbm3(q * 2.3), land = smoothstep(.5, .52, h);
        col = mix(uA, mix(uB, uC, smoothstep(.52, .66, h)), land);
        col = mix(col, vec3(.95), smoothstep(.78, .9, abs(p.y) + fbm3(q * 5.) * .2));
        col = mix(col, vec3(1.), smoothstep(.5, .7, fbm3(q * 4.6 + 9.)) * .85);
        air = 1.;
      } else if (uLook == 4) { // rust desert, canyons, ice caps
        col = mix(uA, uB, smoothstep(.35, .7, fbm3(q * 3.2)));
        col *= 1. - .55 * smoothstep(.78, .9, ridge3(q * 2.));
        col = mix(col, uC, smoothstep(.8, .9, abs(p.y) + (fbm3(q * 6.) - .5) * .25));
        air = .3;
      } else { // a world with a bite out of it, still glowing inside
        vec3 b = normalize(vec3(-.5, .3, .8));
        float cut = dot(p, b) - .32 + (fbm3(q * 5.) - .5) * .5;
        if (cut > 0.) discard;
        col = mix(uA, uB, ridge3(q * 3.));
        if (!gl_FrontFacing) { col = uB * .4; glow = uC * (.5 + 1.4 * fbm3(q * 5.)); }
        glow += uC * smoothstep(-.1, 0., cut) * 1.6;
      }
      vec3 n = normalize(gl_FrontFacing ? vN : -vN);
      float d = dot(n, uL), day = smoothstep(-.06, .22, d), rim = pow(1. - clamp(dot(n, vV), 0., 1.), 3.);
      gl_FragColor = vec4(col * (.015 + day * (.35 + .65 * clamp(d, 0., 1.))) + glow + mix(uC, vec3(.6, .8, 1.), .5) * air * rim * day * .5, 1.);
    }`,
})

const ringMat = (color: string, inner: number, outer: number, seed: number) => new THREE.ShaderMaterial({
  side: THREE.DoubleSide, transparent: true, depthWrite: false,
  uniforms: { uC: { value: rgb(color) }, uIn: { value: inner }, uOut: { value: outer }, uSeed: { value: seed }, uL: { value: new THREE.Vector3() } },
  vertexShader: `varying vec3 vP; varying vec3 vW; void main() { vP = position; vec4 w = modelMatrix * vec4(position, 1.); vW = (modelMatrix * vec4(position, 0.)).xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: NOISE3 + /* glsl */ `
    uniform vec3 uC; uniform float uIn; uniform float uOut; uniform float uSeed; uniform vec3 uL; varying vec3 vP; varying vec3 vW;
    void main() {
      float r = length(vP.xy), t = (r - uIn) / (uOut - uIn);
      float a = smoothstep(0., .04, t) * smoothstep(1., .96, t) * (.25 + .75 * smoothstep(.25, .6, n3(vec3(r * 22., uSeed, 0.)) * .6 + n3(vec3(r * 70., uSeed, 3.)) * .4));
      float along = dot(vW, -uL), off = length(vW + uL * along), pr = length(vW) / max(r, .001); // the planet's shadow across the ring
      float sh = along > 0. ? smoothstep(pr * .98, pr * 1.04, off) : 1.;
      gl_FragColor = vec4(uC * (.12 + .88 * sh), a * .85);
    }`,
})

const moonMat = (a: string, b: string, n: number) => new THREE.ShaderMaterial({
  uniforms: { uA: { value: rgb(a) }, uB: { value: rgb(b) }, uSeed: { value: n * 5.1 + 2 }, uL: { value: new THREE.Vector3() }, uShade: { value: 1 } },
  vertexShader: `varying vec3 vP; varying vec3 vN; void main() { vP = position; vN = normalize(mat3(modelMatrix) * position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: NOISE3 + /* glsl */ `
    uniform vec3 uA; uniform vec3 uB; uniform float uSeed; uniform vec3 uL; uniform float uShade; varying vec3 vP; varying vec3 vN;
    float craters(vec3 p, float s) {
      p = p * s; vec3 i = floor(p); float h = 0.;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
        vec3 g = i + vec3(x, y, z), c = g + vec3(h3(g), h3(g + 11.), h3(g + 23.));
        float d = length(p - c) / (.2 + .4 * h3(g + 31.));
        h += -smoothstep(1., .55, d) * .55 + smoothstep(.72, .96, d) * smoothstep(1.2, .96, d) * .6;
      }
      return h;
    }
    void main() {
      vec3 p = normalize(vP), q = p + uSeed;
      float e = .012, c0 = craters(q, 4.) + .5 * craters(q, 11.);
      vec3 col = mix(uB, uA, smoothstep(.3, .62, fbm3(q * 2.6))) * (1. + c0 * .28);
      float d = clamp(dot(normalize(vN), uL) + c0 * .1, 0., 1.);
      gl_FragColor = vec4(col * (.05 + smoothstep(0., .25, d) * d * 1.2 * uShade), 1.); // the dark side stays faintly visible, lit by Eyaris
    }`,
})

const label = (text: string, color: string) => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64
  const c = cv.getContext('2d')!
  c.font = '600 38px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
  c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(text, 128, 33); c.fillStyle = color; c.fillText(text, 128, 33)
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, sizeAttenuation: false }))
}

export class SolarSky {
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(35, 1, 1, FAR * 3)
  system = new THREE.Group()
  guides = new THREE.Group()
  lines: THREE.LineSegments
  private helio = new THREE.Group()
  private glow: THREE.Mesh
  private planets: { p: SkyPlanet; mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; ring?: THREE.ShaderMaterial }[] = []
  private moons: { m: typeof MOONS[number]; mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> }[] = []
  private labels: THREE.Sprite[] = []

  constructor() {
    this.scene.add(this.galaxy())
    const [stars, lines] = this.starfield()
    this.lines = lines
    this.scene.add(stars, lines, this.helio)

    // the sun: a disc with a corona that always faces the viewer
    const sun = new THREE.Mesh(new THREE.SphereGeometry(AU * Math.tan(1.1 * DEG), 48, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.84) }))
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(AU * 0.5, AU * 0.5), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vU; void main() { vU = uv * 2. - 1.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: /* glsl */ `varying vec2 vU;
        void main() {
          float r = length(vU), a = atan(vU.y, vU.x), rays = pow(abs(cos(a * 3. + .4)), 40.) + .6 * pow(abs(cos(a * 7. - 1.1)), 60.);
          float g = .022 / (r * r + .004) * pow(max(0., 1. - r), 2.) + rays * pow(max(0., 1. - r * 1.4), 6.) * .5;
          gl_FragColor = vec4(vec3(1., .86, .62) * g, 1.);
        }`,
    }))
    this.glow.renderOrder = 4
    this.helio.add(sun, this.glow)

    PLANETS.forEach((p, n) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), planetMat(p, n))
      mesh.rotation.set(p.lean * DEG, n * 1.7, p.lean * 0.6 * DEG)
      let ring: THREE.ShaderMaterial | undefined
      if (p.ring) {
        ring = ringMat(p.ring.color, p.ring.inner, p.ring.outer, n)
        const r = new THREE.Mesh(new THREE.RingGeometry(p.ring.inner, p.ring.outer, 128, 1), ring)
        r.rotation.x = Math.PI / 2
        r.renderOrder = 2
        mesh.add(r)
      }
      if (p.look === 'shattered') { // what came out of it
        const pos: number[] = []
        for (let q = 0; q < 900; q++) {
          const s = 1 + Math.random() ** 2 * 2.2, b = new THREE.Vector3(-0.5, 0.3, 0.8).normalize().add(new THREE.Vector3().randomDirection().multiplyScalar(0.75)).normalize().multiplyScalar(s)
          pos.push(b.x, b.y, b.z)
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
        mesh.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#b9a99a', size: 1.7, sizeAttenuation: false })))
      }
      this.helio.add(mesh)
      this.planets.push({ p, mesh, ring })
    })

    const belt: number[] = []
    for (let n = 0; n < BELT.count; n++) {
      const a = Math.random() * 6.283, r = (BELT.inner + (BELT.outer - BELT.inner) * Math.random()) * AU
      belt.push(Math.cos(a) * r, (Math.random() - 0.5) * 0.25 * AU, Math.sin(a) * r)
    }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(belt, 3))
    this.helio.add(new THREE.Points(bg, new THREE.PointsMaterial({ color: '#a39a8c', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false })))

    this.buildSystem()
  }

  private galaxy() {
    return new THREE.Mesh(new THREE.SphereGeometry(FAR * 1.5, 48, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: NOISE3 + /* glsl */ `varying vec3 vP;
        void main() {
          vec3 d = normalize(vP), g = normalize(vec3(.35, .8, -.48));
          float h = dot(d, g), band = exp(-h * h * 11.), n = fbm3(d * 3.4), dust = smoothstep(.42, .62, fbm3(d * 6.3 + 4.));
          vec3 col = mix(vec3(.13, .15, .26), vec3(.3, .24, .3), n) * band * (.5 + n) * (1. - .75 * dust * band);
          col += vec3(.2, .06, .22) * smoothstep(.52, .72, fbm3(d * 1.9 + 13.)) * .45 + vec3(.03, .13, .18) * smoothstep(.54, .74, fbm3(d * 2.2 + 29.)) * .45; // far nebulae
          gl_FragColor = vec4(col * .62 + vec3(.004, .006, .012), 1.);
        }`,
    }))
  }

  private starfield(): [THREE.Points, THREE.LineSegments] {
    const pos: number[] = [], col: number[] = [], size: number[] = [], seg: number[] = []
    const add = (d: THREE.Vector3, s: number, c: THREE.Color) => { pos.push(d.x * FAR, d.y * FAR, d.z * FAR); col.push(c.r, c.g, c.b); size.push(s) }
    const tones = ['#ffd2a1', '#fff4e8', '#ffffff', '#cfdcff', '#a9c2ff'].map((c) => new THREE.Color(c))
    for (let n = 0; n < STARS; n++) add(new THREE.Vector3().randomDirection(), 0.7 + Math.random() ** 12 * 3.4, tones[Math.floor(Math.random() * tones.length)])
    for (const c of CONSTELLATIONS) {
      const lon = c.lon * DEG, lat = c.lat * DEG, D = new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon))
      const e1 = new THREE.Vector3(0, 1, 0).cross(D).normalize(), e2 = D.clone().cross(e1), turn = c.turn * DEG, k = Math.tan(c.size * DEG)
      const at = ([x, y]: [number, number]) => {
        const u = x * Math.cos(turn) - y * Math.sin(turn), v = x * Math.sin(turn) + y * Math.cos(turn)
        return D.clone().addScaledVector(e1, u * k).addScaledVector(e2, v * k).normalize()
      }
      const seen = new Set<string>()
      for (const stroke of c.lines) stroke.forEach((p, n) => {
        const d = at(p), key = p.join()
        if (!seen.has(key)) { seen.add(key); add(d, 3.8 + (key.length % 3) * 0.8, tones[(key.length + c.id.length) % tones.length]) }
        if (n) { const a = at(stroke[n - 1]); seg.push(a.x * FAR, a.y * FAR, a.z * FAR, d.x * FAR, d.y * FAR, d.z * FAR) }
      })
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1))
    const stars = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPx: { value: 1 } },
      vertexShader: 'attribute float size; attribute vec3 color; uniform float uPx; varying vec3 vC; void main() { vC = color * min(1., size * .55); gl_PointSize = size * uPx * 1.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'varying vec3 vC; void main() { float r = length(gl_PointCoord - .5) * 2.; gl_FragColor = vec4(vC * pow(max(0., 1. - r), 1.8), 1.); }',
    }))
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3))
    return [stars, new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#7fa6e0', transparent: true, opacity: 0.42, depthWrite: false }))]
  }

  private buildSystem() {
    const axis = new THREE.Group(), n = new THREE.Vector3(...northAxis()), Y = new THREE.Vector3(0, 1, 0), gold = '#ffcf6b'
    axis.quaternion.setFromUnitVectors(Y, n)
    const mat = new THREE.MeshBasicMaterial({ color: gold })
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 2.76, 12), mat), tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 16), mat)
    tip.position.y = 1.43
    axis.add(rod, tip)
    // where "straight up" from the orbit is, and the angle between that and the axis
    const up = new THREE.Line(new THREE.BufferGeometry().setFromPoints([Y.clone().multiplyScalar(1.02), Y.clone().multiplyScalar(1.5)]), new THREE.LineDashedMaterial({ color: '#cfe0ff', dashSize: 0.035, gapSize: 0.03, transparent: true, opacity: 0.8 }))
    up.computeLineDistances()
    const arc: THREE.Vector3[] = []
    for (let q = 0; q <= 24; q++) arc.push(new THREE.Vector3().lerpVectors(Y, n, q / 24).normalize().multiplyScalar(1.3))
    const arcLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), new THREE.LineBasicMaterial({ color: gold }))
    const place = (text: string, at: THREE.Vector3, color = gold) => { const s = label(text, color); s.position.copy(at); this.labels.push(s); this.guides.add(s) }
    place('N', n.clone().multiplyScalar(1.56))
    place('S', n.clone().multiplyScalar(-1.5))
    place(`${TILT_DEG}°`, arc[12].clone().multiplyScalar(1.13).add(new THREE.Vector3(-0.02, 0.03, 0)))
    this.guides.add(axis, up, arcLine)
    this.system.add(this.guides)

    MOONS.forEach((m, i) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(m.radius, 64, 48), moonMat(m.colors[0], m.colors[1], i))
      this.system.add(mesh)
      this.moons.push({ m, mesh })
      const pts: THREE.Vector3[] = []
      for (let q = 0; q <= 180; q++) pts.push(new THREE.Vector3(...moonAt(m, m.days * q / 180)))
      this.guides.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#9fb4d8', transparent: true, opacity: 0.28 })))
    })
  }

  /** Puts everything where it is on day `t`. `sun` is the direction to the sun, R the planet's radius in km. */
  update(t: number, sun: THREE.Vector3, cam: THREE.PerspectiveCamera, R: number, px: number) {
    const sky = this.camera
    sky.quaternion.copy(cam.quaternion); sky.fov = cam.fov; sky.aspect = cam.aspect; sky.updateProjectionMatrix()
    const me = new THREE.Vector3(...eyarisAt(t)), v = new THREE.Vector3()
    this.helio.position.copy(sun).multiplyScalar(AU)
    this.glow.quaternion.copy(cam.quaternion)
    ;((this.scene.children[1] as THREE.Points).material as THREE.ShaderMaterial).uniforms.uPx.value = px
    for (const { p, mesh, ring } of this.planets) {
      v.set(...planetAt(p, t))
      mesh.position.copy(v).multiplyScalar(AU)
      const d = v.distanceTo(me)
      mesh.scale.setScalar(d * AU * Math.tan(apparentDeg(p.size, d) * DEG))
      const L = v.clone().normalize().negate()
      mesh.material.uniforms.uL.value.copy(L)
      if (ring) ring.uniforms.uL.value.copy(L)
    }
    this.system.scale.setScalar(R)
    for (const { m, mesh } of this.moons) {
      mesh.position.set(...moonAt(m, t))
      mesh.lookAt(0, 0, 0)
      mesh.material.uniforms.uL.value.copy(sun)
      // in Eyaris's shadow: on the far side from the sun and within a planet radius of the line through it
      const along = mesh.position.dot(sun), off = mesh.position.clone().addScaledVector(sun, -along).length()
      mesh.material.uniforms.uShade.value = along < 0 ? THREE.MathUtils.smoothstep(off, 0.85, 1.15) : 1
    }
    const k = 1 / R
    for (const s of this.labels) s.scale.set(0.11 * k, 0.0275 * k, 1)
  }

  dispose() {
    const free = (o: THREE.Object3D) => o.traverse((c) => {
      const m = c as THREE.Mesh
      m.geometry?.dispose()
      for (const x of [m.material].flat() as THREE.Material[]) { if (!x) continue; (x as THREE.SpriteMaterial).map?.dispose(); x.dispose() }
    })
    free(this.scene); free(this.system)
  }
}
