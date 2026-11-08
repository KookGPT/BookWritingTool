// Locations renderer: a city-scale place lit for atmosphere. Terrain in tiles that simplify with distance (plus the
// range beyond), tens of thousands of buildings as instances whose facades (windows with frames, sills, shutters and
// arched heads, doors, corner stones, weathering, night lights) are drawn by the shader, the megastructures and roads as
// merged meshes, forests and rocks in chunks with distance levels, lakes and rivers with falls, and a sky that follows
// the hour, the weather and the season. Desktop first. (UnrealBloomPass blanked the frame in some views; lamps glow
// with additive sprites instead.)
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BSTRIDE, ROOF, TSTRIDE, type CityBuilt, type MoodName, type Season, type View, type Weather } from './city.ts'
import { MATS, type Mat } from './kit.ts'
import { Fly, type Pose } from './fly.ts'
import { Fx } from './fx.ts'

// ---------- sky keyframes by sun elevation, and the mood presets ----------
interface Key { el: number; sun: string; sunI: number; zenith: string; horizon: string; glow: string; hemi: string; ground: string; hemiI: number; exposure: number; night: number; haze: number; sat: number; tint: string }
const KEYS: Key[] = [
  { el: -18, sun: '#9ab0d8', sunI: 0.32, zenith: '#050913', horizon: '#18203a', glow: '#2a3450', hemi: '#3a4870', ground: '#141210', hemiI: 0.35, exposure: 1.7, night: 1, haze: 0.00002, sat: 0.95, tint: '#e8eeff' },
  { el: -4, sun: '#ff8a50', sunI: 0.5, zenith: '#1c2848', horizon: '#c08670', glow: '#ff9860', hemi: '#5868a0', ground: '#302820', hemiI: 0.6, exposure: 1.45, night: 0.75, haze: 0.00003, sat: 1.05, tint: '#f0f0ff' },
  { el: 4, sun: '#ffaa66', sunI: 3.2, zenith: '#46598a', horizon: '#e6b48a', glow: '#ffae6a', hemi: '#8a90b0', ground: '#5a4030', hemiI: 0.55, exposure: 1.05, night: 0.12, haze: 0.00004, sat: 1.1, tint: '#fff0e0' },
  { el: 13, sun: '#ffd8b0', sunI: 3.4, zenith: '#5a84b8', horizon: '#c6d0da', glow: '#f4d2a6', hemi: '#b8c8e0', ground: '#5a5040', hemiI: 0.7, exposure: 0.95, night: 0, haze: 0.00003, sat: 1.05, tint: '#fff8f0' },
  { el: 55, sun: '#fff4e6', sunI: 3.8, zenith: '#3d6dae', horizon: '#bccfe0', glow: '#e8eef4', hemi: '#c0d4ec', ground: '#5e5444', hemiI: 0.65, exposure: 0.85, night: 0, haze: 0.000022, sat: 1.05, tint: '#ffffff' },
]
export interface Atmos { hour: number; weather: Weather; season: Season; mist: number }
export const MOODS: Record<MoodName, { label: string } & Omit<Atmos, 'season'>> = {
  morning: { label: 'Alpine morning', hour: 7.6, weather: 'clear', mist: 0.35 },
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
const DEG = Math.PI / 180

// ---------- shared shader pieces ----------
const U = {
  uSun: { value: new THREE.Vector3(0, 1, 0) }, uFogCol: { value: new THREE.Color() }, uGlowCol: { value: new THREE.Color() },
  uFogD: { value: 0.0005 }, uFogFall: { value: 1 / 300 }, uFogBase: { value: 0 }, uHaze: { value: 0.00003 }, uNight: { value: 0 }, uTime: { value: 0 },
  uSnow: { value: 0 }, uSnowLine: { value: 1e5 }, uWet: { value: 0 }, uFoliage: { value: new THREE.Color() }, uBare: { value: 0 }, uSky: { value: new THREE.Color() },
}
const HEAD = /* glsl */ `
uniform vec3 uSun; uniform vec3 uFogCol; uniform vec3 uGlowCol; uniform float uFogD; uniform float uFogFall; uniform float uFogBase; uniform float uHaze; uniform float uNight; uniform float uTime;
uniform float uSnow; uniform float uSnowLine; uniform float uWet; uniform vec3 uFoliage; uniform float uBare; uniform vec3 uSky;
varying vec3 vAtmoPos;
float ahash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float anoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ahash(i), ahash(i + vec3(1, 0, 0)), f.x), mix(ahash(i + vec3(0, 1, 0)), ahash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(ahash(i + vec3(0, 0, 1)), ahash(i + vec3(1, 0, 1)), f.x), mix(ahash(i + vec3(0, 1, 1)), ahash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float afbm(vec3 p) { return anoise(p) * 0.55 + anoise(p * 2.13) * 0.3 + anoise(p * 4.37) * 0.15; }
`
const FOG = /* glsl */ `
{
  vec3 V = vAtmoPos - cameraPosition; float L = length(V); vec3 dir = V / max(L, 1e-3);
  // density falls off exponentially above the fog base and stays level below it: average it over the heights the ray spans
  float y0 = max(cameraPosition.y - uFogBase, 0.0) * uFogFall, y1 = max(vAtmoPos.y - uFogBase, 0.0) * uFogFall, dy = y1 - y0;
  float avg = abs(dy) > 1e-4 ? (exp(-min(y0, y1)) - exp(-max(y0, y1))) / abs(dy) : exp(-y0);
  float f = 1.0 - exp(-uFogD * L * avg - uHaze * L);
  vec3 fc = mix(uFogCol, uGlowCol, pow(max(dot(dir, uSun), 0.0), 6.0));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, clamp(f, 0.0, 1.0));
}
`
// After the normal is known: relief from atmoBump (screen-space derivatives), snow on upward faces, wet surfaces in rain.
const POST = /* glsl */ `
{
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition); vec2 dh = vec2(dFdx(atmoBump), dFdy(atmoBump));
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
  if (abs(det) > 1e-9) normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  float sn = uSnow * smoothstep(0.45, 0.8, wN.y) * smoothstep(uSnowLine - 60.0, uSnowLine + 60.0, vAtmoPos.y + (anoise(vAtmoPos * 0.03) - 0.5) * 140.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), sn * atmoSnow);
  diffuseColor.rgb *= 1.0 - 0.32 * uWet * (1.0 - sn);
  roughnessFactor = mix(roughnessFactor, 0.25, uWet * smoothstep(0.3, 0.9, wN.y) * 0.8);
}
`
/** Adds the atmosphere, relief, snow and wet to a built-in material, with optional surface and emissive work. */
function atmo<T extends THREE.Material>(m: T, surface = '', emissive = '', vertex = '', vhead = '', fhead = '', snow = 1): T {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = 'varying vec3 vAtmoPos;\n' + vhead + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 atmoW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        atmoW = instanceMatrix * atmoW;
      #endif
      vAtmoPos = (modelMatrix * atmoW).xyz;
      ${vertex}`)
    sh.fragmentShader = HEAD + fhead + sh.fragmentShader
      .replace('void main() {', `void main() {\n  float atmoGlow = 0.0, atmoBump = 0.0, atmoSnow = ${snow.toFixed(2)};`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + surface)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + POST)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + emissive)
      .replace('#include <fog_fragment>', FOG)
  }
  return m
}
const MOTTLE = 'diffuseColor.rgb *= 0.9 + 0.12 * anoise(vAtmoPos * 0.35) + 0.08 * anoise(vAtmoPos * 0.04);'
const TERRAIN = /* glsl */ `
  diffuseColor.rgb = pow(diffuseColor.rgb, vec3(2.2));
  diffuseColor.rgb *= 0.9 + 0.18 * anoise(vec3(vAtmoPos.x * 0.006, vAtmoPos.y * 0.035 + anoise(vAtmoPos * 0.01) * 2.0, vAtmoPos.z * 0.006));
  diffuseColor.rgb *= 0.86 + 0.2 * afbm(vAtmoPos * 0.08) + 0.08 * anoise(vAtmoPos * 0.9);
  float green = clamp((diffuseColor.g - diffuseColor.r) * 12.0, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uFoliage * 1.7, green * 0.45);
  atmoBump = afbm(vAtmoPos * 0.12) * 1.6 + anoise(vAtmoPos * 0.7) * 0.25;
`
const STONE = MOTTLE + `
  { vec3 q = vAtmoPos * vec3(1.6, 2.6, 1.6); vec3 cell = floor(vec3(q.x + floor(q.y) * 0.5, q.y, q.z + floor(q.y) * 0.5));
    atmoBump = anoise(vAtmoPos * 1.4) * 0.05 - smoothstep(0.92, 1.0, max(fract(q.y), max(fract(q.x + floor(q.y) * 0.5), fract(q.z + floor(q.y) * 0.5)))) * 0.03;
    diffuseColor.rgb *= 0.94 + 0.1 * ahash(cell); }
`
const ROAD = /* glsl */ `
  { vec2 q = vAtmoPos.xz * 2.2; vec2 c = floor(q + vec2(floor(q.y) * 0.5, 0.0)); vec2 f = fract(q + vec2(floor(q.y) * 0.5, 0.0));
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)), fade = 1.0 - smoothstep(0.3, 0.9, fwidth(q.x));
    atmoBump = smoothstep(0.0, 0.18, e) * 0.04 * fade;
    diffuseColor.rgb *= mix(1.0, (0.86 + 0.2 * ahash(vec3(c, 3.0))) * (0.75 + 0.25 * smoothstep(0.0, 0.12, e)), fade) * (0.9 + 0.15 * anoise(vAtmoPos * 0.2)); }
`
// Facades, laid out on each face of the building in its own metres (so windows sit evenly between the corners):
// windows with frames, sills and shutters (arched heads on rich houses), a door and shop fronts on the ground floor,
// corner stones and cornices on rich houses, weathering streaks, a dark foundation, relief, and lit windows at night.
const WALL_VH = 'attribute vec4 iData; varying vec4 vData; varying vec3 vLoc; varying vec3 vSize; varying vec3 vObjN;\n'
const WALL_V = 'vData = iData; vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vLoc = position * vSize; vObjN = normal;'
const WALL_FH = 'varying vec4 vData; varying vec3 vLoc; varying vec3 vSize; varying vec3 vObjN;\n'
const WALL = /* glsl */ `
  vec3 on = normalize(vObjN);
  if (abs(on.y) < 0.5) {
    bool fx = abs(on.z) > 0.5;
    float width = fx ? vSize.x : vSize.z, u = (fx ? vLoc.x * sign(on.z) : -vLoc.z * sign(on.x)) + width * 0.5;
    float h = vAtmoPos.y - vData.x, fh = vData.y, w = vData.z, sd = vData.w;
    vec3 base = diffuseColor.rgb, trim = mix(base, vec3(0.92, 0.9, 0.85), 0.55);
    float aa = max(fwidth(u), fwidth(h)), fade = 1.0 - smoothstep(0.35, 1.1, aa);
    // weathering: streaks running down from the windows, grime at the foot, patchy plaster
    base *= 0.9 + 0.1 * anoise(vec3(u * 1.7, h * 0.07, sd)) + 0.06 * (anoise(vAtmoPos * 0.6) - 0.5);
    base *= 0.74 + 0.26 * smoothstep(0.0, 6.0, h);
    float bump = anoise(vAtmoPos * 2.3) * 0.015;
    if (h < 0.0) { base *= 0.55 + 0.12 * anoise(vAtmoPos * vec3(1.2, 2.4, 1.2)); bump = anoise(vAtmoPos * vec3(1.6, 3.2, 1.6)) * 0.06; diffuseColor.rgb = base; }
    else {
      float n = max(1.0, floor(width / (fh * mix(0.9, 1.1, w)))), cw = width / n, col = floor(u / cw);
      float x = (fract(u / cw) - 0.5) * cw, fl = floor(h / fh), y = fract(h / fh) * fh;
      float hw = cw * mix(0.2, 0.17, w), yb = fh * 0.3, yt = fh * 0.86;
      bool door = fl < 0.5 && col == floor(n * 0.5), shop = fl < 0.5 && !door && w > 0.25 && ahash(vec3(col, sd, 7.0)) < 0.6;
      if (door) { hw = min(0.75, cw * 0.32); yb = 0.0; yt = min(fh * 0.8, 2.6); } else if (shop) { hw = cw * 0.36; yb = 0.45; yt = fh * 0.8; } else if (fl < 0.5) { yb = fh * 0.38; }
      float arch = (!door && w > 0.6) ? hw : 0.0, top = yt + arch;
      float inArch = (arch > 0.0 && y > yt) ? step(x * x + (y - yt) * (y - yt), arch * arch) : 1.0;
      float win = step(abs(x), hw) * step(yb, y) * step(y, top) * inArch;
      float fr = 0.11, outArch = (arch > 0.0 && y > yt) ? step(x * x + (y - yt) * (y - yt), (arch + fr) * (arch + fr)) : 1.0;
      float frame = step(abs(x), hw + fr) * step(yb - fr, y) * step(y, top + fr) * outArch * (1.0 - win);
      float sill = door ? 0.0 : step(abs(x), hw + 0.22) * step(yb - 0.2, y) * step(y, yb - fr * 0.5);
      float shut = (w > 0.22 && w < 0.72 && !door && !shop && ahash(vec3(sd, 3.0, 1.0)) < 0.65) ? step(hw + fr, abs(x)) * step(abs(x), hw * 1.95 + fr) * step(yb, y) * step(y, yt) : 0.0;
      vec3 shutC = vec3(0.16, 0.26, 0.17) * (0.8 + 0.6 * ahash(vec3(sd, 1.0, 2.0)));
      if (ahash(vec3(sd, 4.0, 4.0)) < 0.4) shutC = shutC.bgr * vec3(0.9, 1.0, 1.5);
      float edge = min(u, width - u), quoin = w > 0.55 ? step(edge, 0.7) * step(0.5, fract(h / 0.7)) : 0.0;
      float cornice = w > 0.35 ? smoothstep(vSize.y - 1.1, vSize.y - 0.5, vLoc.y) : 0.0;
      float band = (w > 0.45 && fl > 0.5) ? step(y, 0.25) : 0.0;
      float lit = step(ahash(vec3(col, fl, sd)), mix(0.22, 0.55, w));
      vec3 glass = mix(vec3(0.03, 0.035, 0.045), uSky * 0.35, 0.35 + 0.2 * smoothstep(top, yb, y));
      vec3 c = base;
      c = mix(c, trim, max(max(frame, sill), max(quoin * 0.7, max(cornice, band) * 0.6)));
      c = mix(c, shutC, shut);
      c = mix(c, door ? vec3(0.13, 0.08, 0.05) : shop ? mix(glass, vec3(0.12, 0.09, 0.06), step(y, 1.2)) : glass, win);
      c *= 1.0 - 0.35 * win * smoothstep(top - 0.5, top, y); // shadow under the lintel
      diffuseColor.rgb = mix(base * (1.0 - 0.18 * mix(0.35, 0.5, w)), c, fade);
      bump += (-0.09 * win + 0.035 * (frame + sill) + 0.03 * quoin + 0.05 * cornice + 0.02 * shut) * fade;
      atmoGlow = mix(win * lit * (door ? 0.4 : 1.0), mix(0.22, 0.55, w) * 0.2, 1.0 - fade) * uNight;
    }
    atmoBump = bump;
  } else { diffuseColor.rgb *= 0.7; atmoBump = anoise(vAtmoPos * 1.5) * 0.05; }
`
const GLOW = 'totalEmissiveRadiance += atmoGlow * vec3(1.0, 0.6, 0.28) * 3.2;'
const ROOFS = /* glsl */ `
  { float rows = vAtmoPos.y * 3.2, fade = 1.0 - smoothstep(0.25, 0.7, fwidth(rows));
    float t = fract(rows), tc = floor(rows), tile = ahash(vec3(floor((vAtmoPos.x + vAtmoPos.z) * 3.5 + tc * 0.5), tc, 1.0));
    diffuseColor.rgb *= mix(1.0, (0.82 + 0.24 * tile) * (0.82 + 0.18 * smoothstep(0.0, 0.25, t)), fade);
    diffuseColor.rgb *= 0.88 + 0.16 * anoise(vAtmoPos * 0.4);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.24, 0.12), smoothstep(0.62, 0.8, anoise(vAtmoPos * 0.5)) * 0.35);
    atmoBump = t * 0.06 * fade; }
`
const TREE_VH = 'attribute float foliage; varying float vFol;\n'
const TREE_V = 'vFol = foliage;'
const TREE_FH = 'varying float vFol;\n'
const TREE = /* glsl */ `
  if (vFol > 0.5 && vFol < 1.5) { if (uBare > 0.5 && ahash(floor(vAtmoPos * 0.5)) < 0.75) discard; diffuseColor.rgb *= uFoliage * 1.9; }
  diffuseColor.rgb *= 0.85 + 0.3 * anoise(vAtmoPos * 0.8);
  atmoBump = anoise(vAtmoPos * 2.5) * 0.15;
`
const WATER = /* glsl */ `
  { float steep = 1.0 - smoothstep(0.3, 0.75, abs(normalize(vNormalW).y));
    vec2 f = vFlow * vec2(1.0, 0.08) - vec2(0.0, uTime * (0.6 + steep * 2.5));
    float foam = smoothstep(0.55, 0.85, anoise(vec3(f * vec2(6.0, 4.0), 1.0)) * 0.7 + anoise(vec3(f * 14.0, 2.0)) * 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.95), clamp(steep * (0.6 + foam * 0.5) + foam * 0.25, 0.0, 1.0));
    atmoBump = (anoise(vec3(f * 3.0, uTime * 0.2)) - 0.5) * 0.25; }
`

// ---------- geometry ----------
function roofGeo(kind: number) {
  if (kind === ROOF.spire) return new THREE.ConeGeometry(0.62, 1, 8).translate(0, 0.5, 0)
  if (kind === ROOF.dome) return new THREE.SphereGeometry(0.5, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1)
  const r = kind === ROOF.hip ? 0.25 : 0.5
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], E = [-r, 1, 0], F = [r, 1, 0]
  const tris = [D, C, F, D, F, E, B, A, E, B, E, F, A, D, E, C, B, F, A, B, C, A, C, D]
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3)); g.computeVertexNormals()
  return g
}
/** A tree as one geometry with a `foliage` attribute (0 trunk, 1 broadleaf leaves, 2 needles) and jittered vertices. */
function treeGeo(conifer: boolean, detail: number) {
  const parts: THREE.BufferGeometry[] = []
  const tag = (g: THREE.BufferGeometry, f: number, col: [number, number, number]) => {
    const ng = g.index ? g.toNonIndexed() : g, n = ng.attributes.position.count
    ng.deleteAttribute('uv')
    ng.setAttribute('foliage', new THREE.BufferAttribute(new Float32Array(n).fill(f), 1))
    ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => col[i % 3]), 3))
    parts.push(ng)
  }
  const jitter = (g: THREE.BufferGeometry, a: number, s: number) => {
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) { const k = Math.abs(Math.sin(p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7 + s) * 43758.5); p.setXYZ(i, p.getX(i) * (1 + ((k % 1) - 0.5) * a), p.getY(i) * (1 + (((k * 7) % 1) - 0.5) * a * 0.6), p.getZ(i) * (1 + (((k * 13) % 1) - 0.5) * a)) }
    return g
  }
  tag(new THREE.CylinderGeometry(0.14, 0.32, conifer ? 3 : 4, 6).translate(0, conifer ? 1.5 : 2, 0), 0, [0.32, 0.24, 0.17])
  if (conifer) for (let i = 0; i < (detail ? 5 : 2); i++) { const k = detail ? i : i * 2; tag(jitter(new THREE.ConeGeometry(2.8 - k * 0.48, 4.2 - k * 0.35, detail ? 9 : 6).translate(0, 3.6 + k * 2.1, 0), 0.25, i), 2, [0.42, 0.56, 0.4]) }
  else for (const [x, y, z, r] of detail ? [[0, 6.2, 0, 2.9], [1.5, 5.1, 0.7, 2.1], [-1.3, 5.3, -0.8, 2.2], [0.3, 4.8, -1.6, 1.9], [-0.4, 7.6, 0.4, 2.0], [0.9, 7, -0.6, 1.6]] : [[0, 6, 0, 3.2]])
    tag(jitter(new THREE.IcosahedronGeometry(r, detail ? 1 : 0).translate(x, y, z), 0.3, x + y), 1, [1, 1, 1])
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}
function rockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 1)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) { const k = Math.abs(Math.sin(p.getX(i) * 4.1 + p.getY(i) * 7.3 + p.getZ(i) * 2.9) * 43758.5) % 1, s = 0.7 + k * 0.6; p.setXYZ(i, p.getX(i) * s * 1.2, p.getY(i) * s * 0.7, p.getZ(i) * s) }
  g.computeVertexNormals()
  return g
}

/** Terrain in tiles, each with four levels of detail (every 1, 2, 4 or 8 grid cells) and a skirt that hides cracks. */
function terrainTiles(b: CityBuilt, mat: THREE.Material) {
  const { N, size, heights, colors } = b, c = size / N, w = N + 1, nor = new Float32Array(w * w * 3)
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const hx = heights[j * w + Math.min(N, i + 1)] - heights[j * w + Math.max(0, i - 1)], hz = heights[Math.min(N, j + 1) * w + i] - heights[Math.max(0, j - 1) * w + i]
    const nx = -hx, ny = 2 * c, nz = -hz, l = Math.hypot(nx, ny, nz), a = (j * w + i) * 3
    nor[a] = nx / l; nor[a + 1] = ny / l; nor[a + 2] = nz / l
  }
  const T = 64, group = new THREE.Group()
  for (let tj = 0; tj < N; tj += T) for (let ti = 0; ti < N; ti += T) {
    const lod = new THREE.LOD()
    for (const [step, dist] of [[1, 0], [2, T * c * 1.4], [4, T * c * 3], [8, T * c * 6]] as const) {
      const m = T / step, pos: number[] = [], nr: number[] = [], col: number[] = [], idx: number[] = []
      const vert = (i: number, j: number, drop: number) => {
        const a = j * w + i
        pos.push(-size / 2 + i * c, heights[a] - drop, -size / 2 + j * c); nr.push(nor[a * 3], nor[a * 3 + 1], nor[a * 3 + 2]); col.push(colors[a * 3], colors[a * 3 + 1], colors[a * 3 + 2])
        return pos.length / 3 - 1
      }
      for (let y = 0; y <= m; y++) for (let x = 0; x <= m; x++) vert(ti + x * step, tj + y * step, 0)
      for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) { const a = y * (m + 1) + x, bb = a + 1, cc = a + m + 1, d = cc + 1; idx.push(a, cc, bb, bb, cc, d) }
      // skirt: an apron hanging down from every edge, facing both ways
      const at = (i: number, j: number) => ((j - tj) / step) * (m + 1) + (i - ti) / step
      const edge = (pts: [number, number][]) => { for (let k = 0; k < pts.length - 1; k++) { const [i0, j0] = pts[k], [i1, j1] = pts[k + 1], a = at(i0, j0), bb = at(i1, j1), a2 = vert(i0, j0, 25 + step * 6), b2 = vert(i1, j1, 25 + step * 6); idx.push(a, bb, a2, bb, b2, a2, a, a2, bb, bb, a2, b2) } }
      const line = (f: (k: number) => [number, number]) => Array.from({ length: m + 1 }, (_, k) => f(k))
      edge(line((k) => [ti + k * step, tj])); edge(line((k) => [ti + k * step, tj + T])); edge(line((k) => [ti, tj + k * step])); edge(line((k) => [ti + T, tj + k * step]))
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nr, 3))
      g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(col), 3, true)); g.setIndex(idx); g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = step <= 2
      lod.addLevel(mesh, dist)
    }
    group.add(lod)
  }
  return group
}
function gridMesh(n: number, size: number, heights: Float32Array, colors: Uint8Array) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array((n + 1) * (n + 1) * 3), c = size / n
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const a = (j * (n + 1) + i) * 3; pos[a] = -size / 2 + i * c; pos[a + 1] = heights[j * (n + 1) + i]; pos[a + 2] = -size / 2 + j * c }
  const idx = new Uint32Array(n * n * 6)
  let k = 0
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, cc = a + n + 1, d = cc + 1; idx.set([a, cc, b, b, cc, d], k); k += 6 }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colors, 3, true)); g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals(); g.computeBoundingSphere()
  return g
}
/** Group instance indices into square chunks so each chunk is culled (and levelled) on its own. */
function chunks(n: number, xz: (i: number) => [number, number], size: number) {
  const m = new Map<string, number[]>()
  for (let i = 0; i < n; i++) { const [x, z] = xz(i), k = `${Math.floor(x / size)},${Math.floor(z / size)}`; const l = m.get(k); if (l) l.push(i); else m.set(k, [i]) }
  return [...m.values()]
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
  atmos: Atmos = { hour: 7.6, weather: 'clear', season: 'summer', mist: 0.35 }
  snowline = 1e5
  playing = 0 // hours of story time per second while time runs
  onStats?: (s: Stats) => void
  onHour?: (h: number) => void
  private canvas: HTMLCanvasElement
  private raf = 0; private last = performance.now(); private acc = { t: 0, n: 0 }; private envHour = -99; private envWeather = ''; private hemiBase = 0
  private sunDir = new THREE.Vector3(0, 1, 0); private lightDir = new THREE.Vector3(0, 1, 0)
  private mats = {} as Record<Mat, THREE.MeshStandardMaterial>
  private terrainMat = atmo(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), TERRAIN)
  private wallMat = atmo(new THREE.MeshStandardMaterial({ roughness: 0.9 }), WALL, GLOW, WALL_V, WALL_VH, WALL_FH, 0.4)
  private roofMat = atmo(new THREE.MeshStandardMaterial({ roughness: 0.75 }), ROOFS)
  private treeMat = atmo(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), TREE, '', TREE_V, TREE_VH, TREE_FH)
  private rockMat = atmo(new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.95, flatShading: true }), MOTTLE + 'atmoBump = afbm(vAtmoPos * 0.9) * 0.25;')
  private chimMat = atmo(new THREE.MeshStandardMaterial({ color: 0x8a6a58, roughness: 0.9 }), STONE)
  private waterMat = atmo(new THREE.MeshStandardMaterial({ color: 0x2f747c, roughness: 0.05, metalness: 0.1 }), 'atmoBump = (anoise(vec3(vAtmoPos.xz * 0.15, uTime * 0.25)) - 0.5) * 0.18 + (anoise(vec3(vAtmoPos.xz * 0.9, uTime * 0.6)) - 0.5) * 0.04;', '', '', '', '', 0)
  private riverMat = atmo(new THREE.MeshStandardMaterial({ color: 0x3b7880, roughness: 0.12, metalness: 0.05, side: THREE.DoubleSide }), WATER, '', 'vFlow = flow; vNormalW = normalize(mat3(modelMatrix) * objectNormal);', 'attribute vec2 flow; varying vec2 vFlow; varying vec3 vNormalW;\n', 'varying vec2 vFlow; varying vec3 vNormalW;\n', 0)
  private disposed = false

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
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: m === 'metal' ? 0.35 : m === 'glass' ? 0.1 : m === 'water' ? 0.05 : m === 'roof' ? 0.7 : 0.88, metalness: m === 'metal' ? 0.85 : 0, side: m === 'cloth' || m === 'leaf' ? THREE.DoubleSide : THREE.FrontSide })
      this.mats[m] = atmo(mat, m === 'stone' ? STONE : m === 'roof' ? ROOFS : m === 'road' ? ROAD : '', m === 'stained' ? 'totalEmissiveRadiance += diffuseColor.rgb * (0.35 + uNight * 1.6);' : '')
    }
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }))
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new OutputPass())
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uSat: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) }, uVig: { value: 0.35 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; uniform float uSat; uniform vec3 uTint; uniform float uVig; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.299, 0.587, 0.114)); c.rgb = mix(vec3(l), c.rgb, uSat) * uTint; vec2 q = vUv - 0.5; c.rgb *= 1.0 - uVig * dot(q, q) * 1.8; gl_FragColor = c; }',
    })
    this.composer.addPass(this.grade)
    this.fly = new Fly(this.camera, canvas)
    this.fly.ground = (x, z) => this.heightAt(x, z)
    this.applyAtmos()
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
    return Math.abs(x) < b.size / 2 && Math.abs(z) < b.size / 2 ? look(b.N, b.size, b.heights) : look(b.outer.n, b.outer.size, b.outer.heights)
  }

  setBuilt(b: CityBuilt, keepView: boolean, snowline?: number) {
    for (const c of [...this.world.children]) { c.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); this.world.remove(c) }
    this.built = b
    this.snowline = snowline ?? b.maxH - (b.maxH - b.minH) * 0.18
    this.world.add(terrainTiles(b, this.terrainMat))
    const outer = new THREE.Mesh(gridMesh(b.outer.n, b.outer.size, b.outer.heights, b.outer.colors), this.terrainMat)
    outer.receiveShadow = true
    this.world.add(outer)
    if (b.water.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(b.water, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, this.waterMat); m.receiveShadow = true; this.world.add(m) }
    if (b.rivers.pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(b.rivers.pos, 3)); g.setAttribute('flow', new THREE.BufferAttribute(b.rivers.uv, 2)); g.computeVertexNormals(); const m = new THREE.Mesh(g, this.riverMat); m.receiveShadow = true; this.world.add(m) }
    for (const m of MATS) {
      const g = b.geo[m]
      if (!g.pos.length) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(g.nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(g.col, 3))
      const mesh = new THREE.Mesh(geo, this.mats[m]); mesh.castShadow = m !== 'water' && m !== 'glass' && m !== 'road'; mesh.receiveShadow = true
      this.world.add(mesh)
    }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0)
    // buildings, chunked: walls (one box each) and roofs by shape
    const a = b.buildings, nb = a.length / BSTRIDE, roofGeos = new Map<number, THREE.BufferGeometry>()
    for (const ids of chunks(nb, (i) => [a[i * BSTRIDE], a[i * BSTRIDE + 2]], 700)) {
      const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), data = new Float32Array(ids.length * 4)
      const walls = new THREE.InstancedMesh(g, this.wallMat, ids.length), byRoof = new Map<number, number[]>()
      ids.forEach((i, k) => {
        const o = i * BSTRIDE
        Q.setFromAxisAngle(Y, a[o + 3])
        walls.setMatrixAt(k, M.compose(P.set(a[o], a[o + 1], a[o + 2]), Q, S.set(a[o + 4], a[o + 6], a[o + 5])))
        walls.setColorAt(k, C.setRGB(a[o + 12], a[o + 13], a[o + 14]))
        data.set([a[o + 7], a[o + 10], a[o + 11], (i * 0.618) % 97], k * 4)
        if (a[o + 8] !== ROOF.flat) { const l = byRoof.get(a[o + 8]) ?? []; l.push(i); byRoof.set(a[o + 8], l) }
      })
      g.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 4))
      walls.castShadow = walls.receiveShadow = true; walls.computeBoundingSphere()
      this.world.add(walls)
      for (const [kind, rids] of byRoof) {
        if (!roofGeos.has(kind)) roofGeos.set(kind, roofGeo(kind))
        const rm = new THREE.InstancedMesh(roofGeos.get(kind)!, this.roofMat, rids.length)
        rids.forEach((i, k) => {
          const o = i * BSTRIDE, over = kind === ROOF.gable || kind === ROOF.hip ? 1.08 : kind === ROOF.dome ? 0.9 : 1
          Q.setFromAxisAngle(Y, a[o + 3])
          rm.setMatrixAt(k, M.compose(P.set(a[o], a[o + 1] + a[o + 6], a[o + 2]), Q, S.set(a[o + 4] * over, a[o + 9], a[o + 5] * over)))
          rm.setColorAt(k, C.setRGB(a[o + 15], a[o + 16], a[o + 17]))
        })
        rm.castShadow = rm.receiveShadow = true; rm.computeBoundingSphere()
        this.world.add(rm)
      }
    }
    // chimneys (hidden far away)
    const ch = b.chimneys, cbox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    for (const ids of chunks(ch.length / 4, (i) => [ch[i * 4], ch[i * 4 + 2]], 700)) {
      const cm = new THREE.InstancedMesh(cbox, this.chimMat, ids.length)
      ids.forEach((i, k) => cm.setMatrixAt(k, M.compose(P.set(ch[i * 4], ch[i * 4 + 1] - 1, ch[i * 4 + 2]), Q.identity(), S.set(0.9, ch[i * 4 + 3] + 1, 0.9))))
      cm.castShadow = true; cm.computeBoundingSphere()
      this.world.add(this.lodOf(cm, ch[ids[0] * 4], ch[ids[0] * 4 + 2], 700, [[cm, 0], [null, 2000]]))
    }
    // forests and rocks: detailed near, simple further out, nothing far away (the ground colour carries it)
    const t = b.trees, tg = [[treeGeo(false, 1), treeGeo(false, 0)], [treeGeo(true, 1), treeGeo(true, 0)]]
    for (const ids of chunks(t.length / TSTRIDE, (i) => [t[i * TSTRIDE], t[i * TSTRIDE + 2]], 500)) {
      const levels = [0, 1].map((lvl) => {
        const g = new THREE.Group()
        for (const kind of [0, 1]) {
          const mine = ids.filter((i) => t[i * TSTRIDE + 4] === kind)
          if (!mine.length) continue
          const im = new THREE.InstancedMesh(tg[kind][lvl], this.treeMat, mine.length)
          mine.forEach((i, k) => {
            const o = i * TSTRIDE, s = t[o + 3], sh = t[o + 5]
            Q.setFromAxisAngle(Y, (i * 2.399) % 6.28)
            im.setMatrixAt(k, M.compose(P.set(t[o], t[o + 1], t[o + 2]), Q, S.set(s, s * (0.85 + ((i * 0.37) % 0.3)), s)))
            im.setColorAt(k, C.setRGB(sh, sh, sh))
          })
          im.castShadow = lvl === 0; im.receiveShadow = true; im.computeBoundingSphere()
          g.add(im)
        }
        return g
      })
      this.world.add(this.lodOf(levels[0], t[ids[0] * TSTRIDE], t[ids[0] * TSTRIDE + 2], 500, [[levels[0], 0], [levels[1], 900], [null, 5500]]))
    }
    const rk = b.rocks, rg = rockGeo()
    for (const ids of chunks(rk.length / 5, (i) => [rk[i * 5], rk[i * 5 + 2]], 700)) {
      const im = new THREE.InstancedMesh(rg, this.rockMat, ids.length)
      ids.forEach((i, k) => { const o = i * 5, s = rk[o + 3]; Q.setFromAxisAngle(Y, rk[o + 4]); im.setMatrixAt(k, M.compose(P.set(rk[o], rk[o + 1], rk[o + 2]), Q, S.set(s, s, s))) })
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere()
      this.world.add(this.lodOf(im, rk[ids[0] * 5], rk[ids[0] * 5 + 2], 700, [[im, 0], [null, 3500]]))
    }
    this.fx.setWorld({ size: b.size, minH: b.minH, maxH: b.maxH, chimneys: b.chimneys, lamps: b.lamps, falls: b.falls })
    this.applyAtmos()
    if (!keepView) this.frameAll()
  }
  /** A LOD whose distances are measured from the middle of the chunk containing (x, z); the levels keep world positions. */
  private lodOf(_first: THREE.Object3D, x: number, z: number, size: number, levels: [THREE.Object3D | null, number][]) {
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

  setAtmos(a: Partial<Atmos>) { this.atmos = { ...this.atmos, ...a }; this.applyAtmos() }
  /** Sky, light, fog, weather and season from the hour, the weather, the season and the valley mist. */
  private applyAtmos() {
    const { hour, weather, season, mist } = this.atmos, wx = WEATHER[weather], b = this.built
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
    this.sun.color.copy(c('sun')); this.sun.intensity = n('sunI') * wx.sun
    this.hemi.color.copy(grey(c('hemi'), wx.grey)); this.hemi.groundColor.copy(c('ground')); this.hemiBase = this.hemi.intensity = n('hemiI') * (1 + wx.grey * 0.6)
    const horizon = grey(c('horizon'), wx.grey * 0.8)
    U.uFogCol.value.copy(horizon); U.uGlowCol.value.copy(grey(c('glow'), wx.grey)); U.uHaze.value = n('haze') * wx.haze; U.uNight.value = night
    U.uSky.value.copy(grey(c('zenith'), wx.grey)).lerp(horizon, 0.5)
    const su = this.sky.material.uniforms
    su.uZenith.value.copy(grey(c('zenith'), wx.grey * 0.9)); su.uHorizon.value.copy(horizon); su.uSunCol.value.copy(c('sun')); su.uClouds.value = wx.clouds
    this.renderer.toneMappingExposure = n('exposure') * (1 + wx.grey * 0.25)
    this.grade.uniforms.uSat.value = n('sat') * (1 - wx.grey * 0.25); this.grade.uniforms.uTint.value.copy(c('tint'))
    // fog: a base by the hour, more with mist and bad weather; it pools in the valleys
    const lo = b?.minH ?? 0, hi = b?.maxH ?? 2000
    U.uFogBase.value = lo + (0.06 + mist * 0.14) * (hi - lo)
    U.uFogD.value = (0.0001 + mist * mist * 0.006) * wx.fog
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

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix()
  }

  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    U.uTime.value += dt
    if (this.canvas.width !== Math.floor(this.canvas.clientWidth * this.renderer.getPixelRatio())) this.resize()
    if (this.playing) { this.atmos.hour = (this.atmos.hour + this.playing * dt) % 24; this.applyAtmos(); this.onHour?.(this.atmos.hour) }
    this.fly.update(dt)
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
    this.composer.render(dt)
    const a = this.acc
    a.t += dt; a.n++
    if (a.t > 0.5) { this.onStats?.({ fps: Math.round(a.n / a.t), calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles }); a.t = 0; a.n = 0 }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.fly.dispose(); this.fx.dispose()
    this.world.traverse((c) => (c as THREE.Mesh).geometry?.dispose())
    for (const m of [...Object.values(this.mats), this.terrainMat, this.wallMat, this.roofMat, this.waterMat, this.riverMat, this.treeMat, this.rockMat, this.chimMat]) m.dispose()
    this.envRT?.dispose(); this.pmrem.dispose(); this.composer.dispose(); this.renderer.dispose()
  }
}

// ---------- sky ----------
const SKY_V = 'varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }'
const SKY_F = /* glsl */ `
uniform vec3 uSun; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlowCol; uniform vec3 uSunCol; uniform float uClouds; uniform float uNight; uniform float uTime; uniform float uFlash;
varying vec3 vDir;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir); float up = max(d.y, 0.0), sd = max(dot(d, uSun), 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
  col = mix(col, uHorizon * 0.75, smoothstep(0.0, -0.25, d.y));
  col += uGlowCol * (pow(sd, 6.0) * 0.45 + pow(sd, 48.0) * 0.6);
  col += uSunCol * smoothstep(0.99935, 0.99965, sd) * 25.0 * step(-0.03, uSun.y) * (1.0 - uClouds * 0.7);
  if (d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.06) * 1.4 + vec2(uTime * 0.003, 0.0);
    float c = fbm(p) * 0.75 + fbm(p * 3.1) * 0.25;
    float cov = smoothstep(1.0 - uClouds * 0.85, 1.0 - uClouds * 0.85 + 0.3, c) * smoothstep(0.0, 0.12, d.y);
    vec3 cc = mix(uHorizon * 1.04, uSunCol * 0.7 + uGlowCol * 0.5, 0.35 + 0.65 * pow(sd, 3.0)) * mix(1.0, 0.25, uNight) * (1.0 - uClouds * 0.3);
    col = mix(col, cc, cov * 0.92);
    col += uNight * step(0.9975, h2(floor(d.xz / (d.y + 0.3) * 700.0))) * smoothstep(0.0, 0.25, d.y) * (1.0 - cov) * 0.9;
    col += uFlash * vec3(0.8, 0.85, 1.0) * (0.6 + cov);
  }
  gl_FragColor = vec4(col, 1.0);
}`
