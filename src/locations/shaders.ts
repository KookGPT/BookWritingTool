// Locations shader pieces: shared uniforms, the atmosphere (fog that pools in valleys, haze, a glow toward the sun),
// relief from screen-space derivatives, snow and wet surfaces, and the surface work for terrain, stone, roads, building
// facades (eight wall materials, six window styles), roofs (nine tile kinds), trees and the sky. Every built-in
// material goes through `atmo()`.
import * as THREE from 'three'

export const U = {
  tField: { value: null as THREE.Texture | null }, tMarks: { value: null as THREE.Texture | null }, uMapSize: { value: 1 },
  uSun: { value: new THREE.Vector3(0, 1, 0) }, uFogCol: { value: new THREE.Color() }, uGlowCol: { value: new THREE.Color() },
  uFogD: { value: 0.0005 }, uFogFall: { value: 1 / 300 }, uFogBase: { value: 0 }, uHaze: { value: 0.00003 }, uNight: { value: 0 }, uTime: { value: 0 },
  uSnow: { value: 0 }, uSnowLine: { value: 1e5 }, uWet: { value: 0 }, uFoliage: { value: new THREE.Color() }, uBare: { value: 0 }, uSky: { value: new THREE.Color() },
  // weathering: the ground's height (for how high a surface stands above it) and how damp the climate is (0 desert .. 1 rainforest)
  tGround: { value: null as THREE.Texture | null }, uGroundGrid: { value: new THREE.Vector2(1, 1) }, uDamp: { value: 0.7 },
}
/** How damp each climate keeps stone and wood: moss, algae and rain streaks grow with it; dry climates bleach instead. */
export const DAMP: Record<string, number> = { tropical: 1, temperate: 0.8, boreal: 0.75, alpine: 0.6, mediterranean: 0.35, arid: 0.1 }
export const HEAD = /* glsl */ `
uniform vec3 uSun; uniform vec3 uFogCol; uniform vec3 uGlowCol; uniform float uFogD; uniform float uFogFall; uniform float uFogBase; uniform float uHaze; uniform float uNight; uniform float uTime;
uniform float uSnow; uniform float uSnowLine; uniform float uWet; uniform vec3 uFoliage; uniform float uBare; uniform vec3 uSky;
varying vec3 vAtmoPos;
float ahash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float anoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ahash(i), ahash(i + vec3(1, 0, 0)), f.x), mix(ahash(i + vec3(0, 1, 0)), ahash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(ahash(i + vec3(0, 0, 1)), ahash(i + vec3(1, 0, 1)), f.x), mix(ahash(i + vec3(0, 1, 1)), ahash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float afbm(vec3 p) { return anoise(p) * 0.55 + anoise(p * 2.13) * 0.3 + anoise(p * 4.37) * 0.15; }
`
/** Header for the materials that lay a pattern on the surface (pass as `fhead`; kept out of HEAD, which every shader shares). */
export const FACE_H = /* glsl */ `
// A surface's own frame from its world position and smooth normal: (along, up the slope) on upright and sloping faces,
// (x, z) on level ones; z = how fast the normal turns per metre (columns, domes, statues), where seams across lose sense
vec3 faceUV(vec3 p, vec3 n) {
  float curved = smoothstep(0.25, 0.9, length(fwidth(n)) / max(length(fwidth(p)), 1e-4));
  if (abs(n.y) > 0.75) return vec3(p.xz, curved);
  vec2 t2 = normalize(vec2(-n.z, n.x) + 1e-5);
  return vec3(dot(p.xz, t2), p.y / max(0.3, length(n.xz)), curved);
}
`
export const FOG = /* glsl */ `
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
// After the normal is known: relief from atmoBump, snow on upward faces, wet surfaces in rain, and per-material extras.
const POST = (extra: string) => /* glsl */ `
{
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition); vec2 dh = vec2(dFdx(atmoBump), dFdy(atmoBump));
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
  if (abs(det) > 1e-9) normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  ${extra}
  float sn = uSnow * smoothstep(0.45, 0.8, wN.y) * smoothstep(uSnowLine - 60.0, uSnowLine + 60.0, vAtmoPos.y + (anoise(vAtmoPos * 0.03) - 0.5) * 140.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), sn * atmoSnow);
  diffuseColor.rgb *= 1.0 - 0.32 * uWet * (1.0 - sn);
  roughnessFactor = mix(roughnessFactor, 0.25, uWet * smoothstep(0.3, 0.9, wN.y) * 0.8);
}
`
// Weathering, shared by everything built (great structures, house walls and roofs, parts): it reads only where the
// surface is (height above the real ground, which way it faces, the climate), so it is right for anything anywhere.
// - rising damp and splash at the foot of walls, darker and greener in damp climates
// - rain streaks running down vertical faces, broken up along the face
// - moss and lichen on faces turned from the sun (north here: world -z) and on ledges, only where it is damp
// - sun bleaching on tops and sunny faces in dry climates
// - roughness that varies: rough grime and moss, smoother streaks
const WEATHER_H = /* glsl */ `
uniform sampler2D tGround; uniform vec2 uGroundGrid; uniform float uDamp;
float wGround(vec2 xz) { vec2 g = (xz + uGroundGrid.x * 0.5) / uGroundGrid.x; return all(greaterThan(g, vec2(0.0))) && all(lessThan(g, vec2(1.0))) ? texture2D(tGround, g).r : -1e5; }
`
const WEATHER = /* glsl */ `
{
  // the facing comes from the smooth geometric normal, not the bumped one (bump detail would make every mask speckle),
  // and the noise needs no frame along the face (stretched upright for streaks), so it holds on any shape
  vec3 p = vAtmoPos, gN = inverseTransformDirection(normalize(vNormal), viewMatrix);
  float above = max(0.0, p.y - wGround(p.xz)), vert = 1.0 - smoothstep(0.55, 0.85, abs(gN.y)), ledge = smoothstep(0.6, 0.9, gN.y);
  // four noise lookups in all (it runs on every built pixel): a coarse one shapes the damp line, the streak runs and the
  // moss patches; a fine upright one draws the streaks and varies the roughness
  float big = anoise(vec3(p.x * 0.35, p.y * 0.02, p.z * 0.35 + 9.0)), fine = anoise(vec3(p.x * 2.6, p.y * 0.09, p.z * 2.6));
  float foot = (1.0 - smoothstep(0.15, 0.9 + 1.4 * big * (0.4 + uDamp), above)) * vert;
  float streak = smoothstep(0.66, 0.88, fine) * smoothstep(0.5, 0.75, big) * vert; // sparse runs, not a curtain of stripes
  float shade = smoothstep(0.1, -0.7, gN.z) * (1.0 - smoothstep(0.85, 1.0, gN.y));
  float mn = anoise(p * 0.45 + 3.0) * 0.65 + anoise(p * 1.6) * 0.35, patchy = smoothstep(0.45, 0.75, mn);
  float moss = uDamp * uDamp * clamp(foot * 0.9 + shade * 0.45 + ledge * 0.55, 0.0, 1.0) * patchy;
  float bleach = (1.0 - uDamp) * max(ledge, smoothstep(0.2, 0.9, gN.z) * vert) * 0.6;
  vec3 c = diffuseColor.rgb;
  c *= 1.0 - foot * (0.18 + 0.22 * uDamp);
  c *= 1.0 - streak * (0.1 + 0.2 * uDamp);
  c = mix(c, mix(vec3(0.17, 0.2, 0.09), vec3(0.32, 0.33, 0.22), smoothstep(0.55, 0.9, mn)), moss * 0.75);
  c = mix(c, vec3(dot(c, vec3(0.3, 0.55, 0.15))) * 1.12, bleach * 0.35);
  diffuseColor.rgb = c;
  roughnessFactor = clamp(roughnessFactor + (fine - 0.5) * 0.12 + moss * 0.1 + foot * 0.05 - streak * 0.08, 0.04, 1.0);
}
`
export interface AtmoOpts { surface?: string; emissive?: string; vertex?: string; vhead?: string; fhead?: string; snow?: number; post?: string; weather?: boolean }
/** Adds the atmosphere, relief, snow and wet to a built-in material, with optional surface and emissive work. */
export function atmo<T extends THREE.Material>(m: T, o: AtmoOpts = {}): T {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = 'varying vec3 vAtmoPos;\n' + (o.vhead ?? '') + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 atmoW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        atmoW = instanceMatrix * atmoW;
      #endif
      vAtmoPos = (modelMatrix * atmoW).xyz;
      ${o.vertex ?? ''}`)
    sh.fragmentShader = HEAD + (o.weather ? WEATHER_H : '') + (o.fhead ?? '') + sh.fragmentShader
      .replace('void main() {', `void main() {\n  float atmoGlow = 0.0, atmoBump = 0.0, atmoSnow = ${(o.snow ?? 1).toFixed(2)};`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (o.surface ?? ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + POST((o.post ?? '') + (o.weather ? WEATHER : '')))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (o.emissive ?? ''))
      .replace('#include <fog_fragment>', FOG)
  }
  m.customProgramCacheKey = () => (o.surface ?? '') + (o.post ?? '') + (o.vertex ?? '') + (o.weather ? 'w' : '')
  return m
}

export const MOTTLE = 'diffuseColor.rgb *= 0.9 + 0.12 * anoise(vAtmoPos * 0.35) + 0.08 * anoise(vAtmoPos * 0.04);'

// ---------- terrain: colours arrive sRGB-encoded; the surface attribute marks ice, sand, farmland and scree ----------
export const TERRAIN_VH = 'attribute vec4 surf; varying vec4 vSurf;\n'
export const TERRAIN_V = 'vSurf = surf;'
export const TERRAIN_FH = 'varying vec4 vSurf; uniform sampler2D tField; uniform sampler2D tMarks; uniform float uMapSize;\n'
export const TERRAIN = /* glsl */ `
  diffuseColor.rgb = pow(diffuseColor.rgb, vec3(2.2));
  diffuseColor.rgb *= 0.9 + 0.18 * anoise(vec3(vAtmoPos.x * 0.006, vAtmoPos.y * 0.035 + anoise(vAtmoPos * 0.01) * 2.0, vAtmoPos.z * 0.006));
  diffuseColor.rgb *= 0.86 + 0.2 * afbm(vAtmoPos * 0.08) + 0.08 * anoise(vAtmoPos * 0.9);
  // fields: crisp parcels from the field texture (inside the map only)
  { vec2 fuv = (vAtmoPos.xz + uMapSize * 0.5) / uMapSize;
    if (fuv.x > 0.0 && fuv.y > 0.0 && fuv.x < 1.0 && fuv.y < 1.0) { vec4 fld = texture2D(tField, fuv); diffuseColor.rgb = mix(diffuseColor.rgb, pow(fld.rgb, vec3(2.2)) * (0.92 + 0.16 * anoise(vAtmoPos * 0.05)), fld.a * 0.95); } }
  // the living ground: lava (dark, rough, glowing in its cracks while fresh), mineral crusts round hot springs, wetland
  { vec2 muv = (vAtmoPos.xz + uMapSize * 0.5) / uMapSize;
    if (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) { vec4 mk = texture2D(tMarks, muv);
      if (mk.r > 0.02) {
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.05, 0.048) * (0.75 + 0.6 * anoise(vAtmoPos * 0.35)), smoothstep(0.02, 0.25, mk.r));
        float crack = 1.0 - smoothstep(0.0, 0.05, abs(anoise(vAtmoPos * vec3(0.18, 0.1, 0.18)) - 0.5)), hot = smoothstep(0.72, 1.0, mk.r);
        atmoGlow = max(atmoGlow, hot * (crack * 1.2 + 0.3 + 0.25 * anoise(vAtmoPos * 0.05 + uTime * 0.05)));
      }
      if (mk.g > 0.02) diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.9, 0.87, 0.8), vec3(0.76, 0.44, 0.2), smoothstep(0.5, 0.78, anoise(vAtmoPos * 0.06)) * 0.6), mk.g * 0.9);
      if (mk.b > 0.02) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.64, 0.42), mk.b * 0.75);
    } }
  float green = clamp((diffuseColor.g - diffuseColor.r) * 12.0, 0.0, 1.0) * (1.0 - vSurf.b);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uFoliage * 1.7, green * 0.45);
  atmoBump = afbm(vAtmoPos * 0.12) * 1.6 + anoise(vAtmoPos * 0.7) * 0.25;
  // cliffs: buttresses, gullies, ledges and strata, so a tall face is never one flat sheet
  { float up = dot(normalize(vNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), cl = smoothstep(0.72, 0.4, up);
    if (cl > 0.0) {
      float strata = anoise(vec3(vAtmoPos.x * 0.004, vAtmoPos.y * 0.07 + anoise(vAtmoPos * 0.004) * 5.0, vAtmoPos.z * 0.004));
      float streak = anoise(vec3(vAtmoPos.x * 0.045, vAtmoPos.y * 0.003, vAtmoPos.z * 0.045)); // gullies and water streaks down the face
      atmoBump += cl * (afbm(vAtmoPos * vec3(0.022, 0.009, 0.022)) * 10.0 + afbm(vAtmoPos * 0.08) * 2.2 + smoothstep(0.55, 0.62, strata) * 1.0 - smoothstep(0.6, 0.75, streak) * 2.0);
      diffuseColor.rgb *= mix(1.0, (0.88 + 0.18 * strata) * (1.0 - 0.25 * smoothstep(0.55, 0.8, streak)), cl);
    } }
  // sand: wind ripples, lighter where dry
  if (vSurf.g > 0.02) { float rip = sin(dot(vAtmoPos.xz, vec2(0.83, 0.55)) * 3.2 + anoise(vAtmoPos * 0.2) * 6.0); atmoBump = mix(atmoBump, rip * 0.03, vSurf.g); diffuseColor.rgb *= 1.0 + 0.06 * rip * vSurf.g; }
  // farmland: furrows in each field, turned a different way in each
  if (vSurf.b > 0.02) { vec2 cell = floor(vAtmoPos.xz / 70.0); float a = ahash(vec3(cell, 5.0)) * 3.1416; vec2 dir = vec2(cos(a), sin(a));
    float row = sin(dot(vAtmoPos.xz, dir) * 4.2); float fade = 1.0 - smoothstep(0.4, 1.2, fwidth(dot(vAtmoPos.xz, dir) * 0.7));
    diffuseColor.rgb *= 1.0 + row * 0.035 * vSurf.b * fade; atmoBump = mix(atmoBump, row * 0.025 * fade, vSurf.b); }
  // scree: broken rock
  if (vSurf.a > 0.02) { float rk = afbm(vAtmoPos * 0.9); diffuseColor.rgb *= mix(1.0, 0.75 + 0.45 * rk, vSurf.a * 0.8); atmoBump += vSurf.a * rk * 0.35; }
`
export const TERRAIN_POST = /* glsl */ `
  // glacier ice: blue sheen, crevasses across the flow on steeper ice, dirty bands
  if (vSurf.r > 0.02) {
    vec2 flow = normalize(-wN.xz + 1e-4);
    float c = dot(vAtmoPos.xz, flow) * 0.09 + anoise(vAtmoPos * 0.02) * 3.0, cr = smoothstep(0.9, 0.97, fract(c)) * smoothstep(0.02, 0.12, 1.0 - wN.y);
    vec3 ice = diffuseColor.rgb * (0.92 + 0.14 * anoise(vAtmoPos * 0.05)); // the painted ice: snow, blue ice or rubble
    ice = mix(ice, vec3(0.1, 0.28, 0.4), cr * smoothstep(0.35, 0.6, ice.b - ice.r + 0.4));
    ice *= 1.0 - 0.18 * smoothstep(0.6, 0.8, anoise(vec3(c * 3.0, 0.0, 1.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, ice, vSurf.r);
    roughnessFactor = mix(roughnessFactor, 0.35, vSurf.r);
  }
  // steep ground shows its rock whatever the colour map says
  // steep ground shows its rock: the location's own rock colour (painted on steep cells), varied, never a flat sheet
  float steepRock = smoothstep(0.8, 0.5, wN.y) * (1.0 - vSurf.r);
  vec3 rock = diffuseColor.rgb * (0.8 + 0.35 * anoise(vec3(vAtmoPos.x * 0.03, vAtmoPos.y * 0.12, vAtmoPos.z * 0.03))) * mix(0.85, 1.05, anoise(vAtmoPos * 0.004));
  diffuseColor.rgb = mix(diffuseColor.rgb, rock, steepRock * 0.7);
`

// Cut stone for anything built of it, laid in the face's own frame: courses run level along each wall whichever way it
// turns, blocks vary in length per course and in tint, mortar joints are recessed, arrises a little worn. Paving on
// level tops. On curved surfaces (columns, statues, domes) only the course joints remain, as drums. All of it fades to
// the average colour once a joint is under a pixel, so far views stay calm.
export const STONE = /* glsl */ `
  { vec3 p = vAtmoPos, n = inverseTransformDirection(normalize(vNormal), viewMatrix);
    float curved = smoothstep(0.25, 0.9, length(fwidth(n)) / max(length(fwidth(p)), 1e-4)); // turn of the normal per metre
    vec2 q; // the face's own frame: along the wall and up, or across a level top
    if (abs(n.y) > 0.75) q = p.xz; else { vec2 t2 = normalize(vec2(-n.z, n.x) + 1e-5); q = vec2(dot(p.xz, t2), p.y); }
    float ch = 0.42, ri = floor(q.y / ch), rh = ch * (0.8 + 0.45 * ahash(vec3(ri, 2.0, 7.0)));
    ri = floor(q.y / rh); float rf = fract(q.y / rh);
    float bl = mix(0.75, 1.5, ahash(vec3(ri, 5.0, 1.0))), cu = q.x / bl + ahash(vec3(ri, 9.0, 3.0)), ci = curved > 0.5 ? 0.0 : floor(cu), cf = fract(cu); // a drum is one block all round
    float jy = min(rf, 1.0 - rf) * rh, jx = min(cf, 1.0 - cf) * bl * (1.0 - curved); // distance to the nearest joint, metres
    float joint = min(jy, mix(jx, 1.0, curved)), fade = 1.0 - smoothstep(0.012, 0.05, fwidth(q.y));
    float mortar = 1.0 - smoothstep(0.006, 0.016, joint), arris = 1.0 - smoothstep(0.016, 0.06, joint);
    float tint = 0.9 + 0.16 * ahash(vec3(ci, ri, 4.0)), hue = ahash(vec3(ci, ri, 8.0)) - 0.5;
    vec3 c = diffuseColor.rgb * tint * vec3(1.0 + hue * 0.05, 1.0, 1.0 - hue * 0.06);
    float tool = anoise(p * 3.1); // tooling and grain (three noise lookups in all)
    c *= 0.9 + 0.15 * tool;
    c = mix(c, c * 0.92, arris * (1.0 - mortar));
    c = mix(c, diffuseColor.rgb * vec3(0.86, 0.84, 0.8), mortar);
    float broad = anoise(p * 0.35);
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.9 + 0.12 * broad), c, fade);
    diffuseColor.rgb *= 0.92 + 0.1 * anoise(p * 0.05);
    atmoBump = (tool * 0.006 - mortar * 0.014 - arris * 0.004) * fade; }
`
// ---------- the other built materials, all in the face's own frame and fading out once their detail is under a pixel ----------
// Wood: boards a hand wide with joints, grain running along them (up posts and doors, along level decks), each board its
// own shade; exposed wood silvers with age, less where the climate keeps it damp and dark.
export const WOOD = /* glsl */ `
  { vec3 p = vAtmoPos, n = inverseTransformDirection(normalize(vNormal), viewMatrix), f = faceUV(p, n);
    float bw = 0.2, bi = floor(f.x / bw), bf = fract(f.x / bw);
    float fade = 1.0 - smoothstep(0.008, 0.035, fwidth(f.x)), joint = (1.0 - smoothstep(0.0, 0.06, min(bf, 1.0 - bf))) * (1.0 - f.z);
    float grain = anoise(vec3(f.x * 14.0 + bi * 3.7, f.y * 0.6, bi)) * 0.7 + anoise(vec3(f.x * 40.0, f.y * 2.0, bi + 5.0)) * 0.3;
    vec3 c = diffuseColor.rgb * (0.82 + 0.3 * ahash(vec3(bi, 3.0, 1.0))) * (0.78 + 0.4 * grain);
    c *= 1.0 - 0.55 * joint;
    float l = dot(c, vec3(0.3, 0.55, 0.15)); c = mix(c, vec3(l * 1.15, l * 1.13, l * 1.12), 0.35 * (1.0 - uDamp * 0.5)); // silvered
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.88 + 0.12 * grain), c, fade);
    atmoBump = (grain * 0.004 - joint * 0.01) * fade; }
`
// Metal: hammered sheet and cast work; iron rusts and bronze greens with the weather (in METAL_POST, where metalness is
// known); gold only tarnishes a little. The family comes from the colour the kit gave it.
export const METAL = /* glsl */ `
  { float h = anoise(vAtmoPos * 7.0); atmoBump = h * 0.004 * (1.0 - smoothstep(0.01, 0.05, fwidth(vAtmoPos.y))); diffuseColor.rgb *= 0.92 + 0.12 * h; }
`
export const METAL_POST = /* glsl */ `
  { vec3 b = diffuseColor.rgb, p = vAtmoPos; float l = dot(b, vec3(0.3, 0.55, 0.15));
    float gold = smoothstep(0.08, 0.2, b.r - b.b) * smoothstep(0.15, 0.3, l), iron = 1.0 - smoothstep(0.03, 0.08, l);
    float n1 = anoise(p * 1.4), run = smoothstep(0.5, 0.85, anoise(vec3(p.x * 3.0, p.y * 0.15, p.z * 3.0))); // patches, and runs down the faces
    float rust = iron * smoothstep(0.55, 0.85, n1 + run * 0.3) * (0.35 + 0.65 * uDamp);
    float patina = (1.0 - gold) * (1.0 - iron) * clamp(uDamp * (0.4 + 0.6 * run) + smoothstep(0.5, 0.9, wN.y) * 0.3, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.09, 0.035) * (0.7 + 0.6 * n1), rust);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.42, 0.34) * (0.8 + 0.4 * n1), patina * 0.6);
    diffuseColor.rgb *= 1.0 - 0.12 * gold * smoothstep(0.6, 0.9, n1); // tarnish
    metalnessFactor *= 1.0 - 0.8 * max(rust, patina * 0.7);
    roughnessFactor = clamp(roughnessFactor + rust * 0.5 + patina * 0.3 - gold * 0.15 + (n1 - 0.5) * 0.1, 0.05, 1.0); }
`
// Stained glass: small diamond quarries in lead cames, every pane its own shade of the window's colour (the emission uses
// the same colour, so the lead stays dark in the glow at night).
export const GLASS = /* glsl */ `
  { vec3 p = vAtmoPos, n = inverseTransformDirection(normalize(vNormal), viewMatrix), f = faceUV(p, n);
    float a = (f.x + f.y) / 0.32, b2 = (f.x - f.y) / 0.32, fa = fract(a), fb = fract(b2);
    // each pane's shade reads well past the point where the thin lead lines go under a pixel, so they fade apart
    float fw = fwidth(a * 0.32), tint = 1.0 - smoothstep(0.05, 0.16, fw), lead = 1.0 - smoothstep(0.015, 0.05, fw);
    float came = (1.0 - smoothstep(0.03, 0.09, min(min(fa, 1.0 - fa), min(fb, 1.0 - fb)))) * lead;
    vec3 c = diffuseColor.rgb * mix(1.0, 0.65 + 0.7 * ahash(vec3(floor(a), floor(b2), 2.0)), tint);
    diffuseColor.rgb = mix(c, vec3(0.025), came) * mix(1.0, 0.85, tint * (1.0 - lead)); // the lead darkens the window on average
    atmoBump = -came * 0.006; }
`
// Cloth: a fine weave and soft folds hanging down it, faded where the sun reaches.
export const CLOTH = /* glsl */ `
  { vec3 p = vAtmoPos, n = inverseTransformDirection(normalize(vNormal), viewMatrix), f = faceUV(p, n);
    float fade = 1.0 - smoothstep(0.005, 0.03, fwidth(f.x));
    float weave = sin(f.x * 220.0) * sin(f.y * 220.0) * 0.5 + 0.5, fold = sin(f.x * 5.5 + anoise(vec3(f.x * 0.8, f.y * 0.3, 1.0)) * 4.0);
    diffuseColor.rgb *= (0.9 + 0.1 * fold) * mix(1.0, 0.92 + 0.08 * weave, fade);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))) * 1.2, 0.2 * smoothstep(0.3, 0.9, n.y));
    atmoBump = fold * 0.02 + weave * 0.0015 * fade; }
`
// Roofs of the great buildings: clay tiles (red family), copper with standing seams going green (green family), slate or
// lead in small plates (grey and blue). Courses run level round domes and spires; seams across only where flat enough.
export const ROOF_K = /* glsl */ `
  { vec3 p = vAtmoPos, n = inverseTransformDirection(normalize(vNormal), viewMatrix), f = faceUV(p, n), b = diffuseColor.rgb;
    float clay = smoothstep(0.03, 0.12, b.r - b.g * 1.15), copper = smoothstep(0.0, 0.05, b.g - b.r) * (1.0 - clay);
    float rh = mix(mix(0.2, 0.3, clay), 0.6, copper), ri = floor(f.y / rh), rf = fract(f.y / rh);
    float cw = mix(mix(0.32, 0.26, clay), 0.55, copper), cu = f.x / cw + mod(ri, 2.0) * 0.5, ci = floor(cu), cf = fract(cu);
    float fade = 1.0 - smoothstep(0.012, 0.05, fwidth(f.y)), across = 1.0 - f.z;
    float lap = smoothstep(0.0, 0.2, rf), seam = (1.0 - smoothstep(0.0, 0.05, min(cf, 1.0 - cf))) * across;
    float t = ahash(vec3(ci * across, ri, 6.0));
    vec3 c = b * mix(0.8 + 0.3 * t, 1.0, copper) * (0.75 + 0.25 * lap);   // each tile or slate its own shade, darker under the lap
    c *= 1.0 - mix(0.25, 0.0, copper) * seam * (1.0 - copper);                  // gaps between tiles and slates
    c = mix(c, c * 1.18, copper * seam);                                        // copper: the standing seams catch the light
    diffuseColor.rgb = mix(b * (0.9 + 0.1 * anoise(p * 0.4)), c, fade);
    atmoBump = (lap * mix(0.03, 0.005, copper) + copper * seam * 0.02) * fade; }
`
// natural rock: bedding planes that wander, vertical joints, grain; lichen and grass on ledges (in ROCK_POST)
export const ROCK = /* glsl */ `
  { vec3 p = vAtmoPos;
    float warp = anoise(p * 0.012) * 3.0 + anoise(p * 0.05) * 0.6;
    float bed = p.y * 0.16 + warp, bf = fract(bed), bi = floor(bed);
    float layer = 0.82 + 0.3 * ahash(vec3(bi, 1.0, 7.0)), seam = smoothstep(0.0, 0.08, bf) * smoothstep(1.0, 0.9, bf);
    float joint = 1.0 - smoothstep(0.0, 0.06, abs(anoise(vec3(p.x * 0.07, p.y * 0.012, p.z * 0.07)) - 0.5));
    float grain = afbm(p * 0.7);
    diffuseColor.rgb *= layer * mix(0.62, 1.0, seam) * (1.0 - 0.45 * joint) * (0.86 + 0.24 * grain);
    diffuseColor.rgb *= 0.9 + 0.2 * anoise(p * 0.02);
    atmoBump = afbm(p * vec3(0.06, 0.14, 0.06)) * 2.4 + seam * 0.35 - joint * 0.5 + grain * 0.18; }
`
export const ROCK_POST = /* glsl */ `
  { float up = smoothstep(0.55, 0.85, wN.y), patchy = smoothstep(0.45, 0.7, anoise(vAtmoPos * 0.09));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.25, 0.12), up * patchy * 0.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.95, 1.02, 0.9), (1.0 - up) * smoothstep(0.6, 0.8, anoise(vAtmoPos * 0.3)) * 0.5); }
`
export const ROAD = /* glsl */ `
  { vec2 q = vAtmoPos.xz * 2.2; vec2 c = floor(q + vec2(floor(q.y) * 0.5, 0.0)); vec2 f = fract(q + vec2(floor(q.y) * 0.5, 0.0));
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)), fade = 1.0 - smoothstep(0.3, 0.9, fwidth(q.x));
    atmoBump = smoothstep(0.0, 0.18, e) * 0.04 * fade;
    diffuseColor.rgb *= mix(1.0, (0.86 + 0.2 * ahash(vec3(c, 3.0))) * (0.75 + 0.25 * smoothstep(0.0, 0.12, e)), fade) * (0.9 + 0.15 * anoise(vAtmoPos * 0.2)); }
`

// ---------- facades ----------
// Each face is laid out in its own metres, so windows sit evenly between the corners. iData: ground height, floor
// height (over 50 = no windows), wealth, seed; iStyle: wall material, window style.
export const WALL_VH = 'attribute vec4 iData; attribute vec2 iStyle; varying vec4 vData; varying vec2 vStyle; varying vec3 vLoc; varying vec3 vSize; varying vec3 vObjN;\n'
export const WALL_V = 'vData = iData; vStyle = iStyle; vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vLoc = position * vSize; vObjN = normal;'
export const WALL_FH = 'varying vec4 vData; varying vec2 vStyle; varying vec3 vLoc; varying vec3 vSize; varying vec3 vObjN;\n'
export const WALL = /* glsl */ `
  vec3 on = normalize(vObjN);
  if (abs(on.y) < 0.5) {
    bool fx = abs(on.z) > 0.5, front = on.z > 0.5;
    float width = fx ? vSize.x : vSize.z, u = (fx ? vLoc.x * sign(on.z) : -vLoc.z * sign(on.x)) + width * 0.5;
    float h = vAtmoPos.y - vData.x, fh = vData.y, w = vData.z, sd = vData.w, mat = vStyle.x, ws = vStyle.y;
    vec3 base = diffuseColor.rgb;
    float aa = max(fwidth(u), fwidth(h)), fade = 1.0 - smoothstep(0.35, 1.1, aa), bump = 0.0;
    vec3 beam = vec3(0.16, 0.11, 0.075);
    // ---- wall material ----
    if (mat < 0.5) { // plaster: soft blotches, and on poor houses patches where it has fallen away to rubble
      base *= 0.92 + 0.12 * anoise(vAtmoPos * 0.9) + 0.06 * anoise(vAtmoPos * 4.0);
      float bare = smoothstep(0.66, 0.72, anoise(vec3(u * 0.7, h * 0.9, sd))) * (1.0 - w) * fade;
      base = mix(base, base * vec3(0.7, 0.66, 0.6) * (0.8 + 0.4 * anoise(vAtmoPos * 6.0)), bare);
      bump = anoise(vAtmoPos * 3.0) * 0.012 - bare * 0.02;
    } else if (mat < 1.5) { // dressed stone in courses
      float row = h / 0.56, ri = floor(row), rf = fract(row), cu = (u + ri * 0.41) / (0.85 + 0.35 * ahash(vec3(ri, sd, 1.0))), ci = floor(cu), cf = fract(cu);
      float joint = min(min(rf, 1.0 - rf) * 0.56, min(cf, 1.0 - cf) * 0.9);
      base *= mix(1.0, mix(0.7, 1.0, smoothstep(0.0, 0.035, joint)) * (0.9 + 0.16 * ahash(vec3(ci, ri, sd))), fade);
      bump = smoothstep(0.0, 0.05, joint) * 0.03 * fade + anoise(vAtmoPos * 5.0) * 0.008;
    } else if (mat < 2.5) { // brick, with lighter mortar and the odd burnt brick
      float row = h / 0.085, ri = floor(row), rf = fract(row), cu = u / 0.25 + mod(ri, 2.0) * 0.5, cf = fract(cu), ci = floor(cu);
      float mort = 1.0 - step(0.16, rf) * step(0.06, cf) * step(cf, 0.96);
      base *= mix(1.0, mix(0.86 + 0.24 * ahash(vec3(ci, ri, sd)), 1.25, mort), fade);
      bump = (1.0 - mort) * 0.015 * fade;
    } else if (mat < 3.5) { // timber framing: dark posts, rails and braces over plaster infill (drawn per floor below)
      base *= 0.95 + 0.08 * anoise(vAtmoPos * 1.5);
    } else if (mat < 4.5) { // whitewash: bright, rough, a little blue in the shade near the ground
      base *= 0.96 + 0.06 * anoise(vAtmoPos * 2.5); bump = afbm(vAtmoPos * 2.0) * 0.03;
    } else if (mat < 5.5) { // rubble: irregular field stones
      vec2 q = vec2(u * 1.7, h * 2.6); vec2 c = floor(q + vec2(anoise(vec3(q * 0.7, sd)) * 0.8, 0.0)); vec2 f = fract(q + vec2(anoise(vec3(q * 0.7, sd)) * 0.8, 0.0));
      float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
      base *= mix(1.0, (0.75 + 0.4 * ahash(vec3(c, sd))) * mix(0.55, 1.0, smoothstep(0.0, 0.12, e)), fade);
      bump = smoothstep(0.0, 0.2, e) * 0.06 * fade;
    } else if (mat < 6.5) { // banded stone (ablaq): light and dark courses
      float band = step(0.5, fract(h / 1.1));
      base = mix(base, base * vec3(0.62, 0.5, 0.4), band * 0.85) * (0.92 + 0.1 * anoise(vAtmoPos * 2.0));
      bump = (smoothstep(0.0, 0.03, abs(fract(h / 0.55) - 0.5) - 0.47)) * 0.02 * fade;
    } else { // vertical wooden boards
      float b = u / 0.24, bf = fract(b), bi = floor(b);
      base *= mix(1.0, (0.8 + 0.3 * ahash(vec3(bi, sd, 2.0))) * mix(0.55, 1.0, smoothstep(0.0, 0.08, min(bf, 1.0 - bf))) * (0.9 + 0.2 * anoise(vec3(u * 30.0, h * 0.6, sd))), fade);
      bump = smoothstep(0.0, 0.08, min(bf, 1.0 - bf)) * 0.02 * fade;
    }
    // (rain streaks and grime at the foot come from the shared weathering)
    base *= 0.94 + 0.06 * anoise(vec3(u * 1.7, h * 0.07, sd));
    if (h < 0.0) { base *= 0.52 + 0.12 * anoise(vAtmoPos * vec3(1.2, 2.4, 1.2)); bump = anoise(vAtmoPos * vec3(1.6, 3.2, 1.6)) * 0.06; diffuseColor.rgb = base; }
    else if (fh > 50.0) diffuseColor.rgb = base;
    else {
      // ---- windows: style 0 shutters, 1 round-headed, 2 small and deep, 3 mullioned, 4 pointed, 5 arcade ----
      float small = step(1.5, ws) * step(ws, 2.5), arcade = step(4.5, ws);
      float n = max(1.0, floor(width / (fh * mix(mix(0.92, 1.12, w), 1.5, small)))), cw = width / n, col = floor(u / cw);
      float x = (fract(u / cw) - 0.5) * cw, fl = floor(h / fh), y = fract(h / fh) * fh;
      float hw = cw * mix(mix(0.21, 0.17, w), 0.13, small), yb = fh * mix(0.3, 0.36, small), yt = fh * mix(0.86, 0.72, small);
      bool door = front && fl < 0.5 && col == floor(n * 0.5);
      bool shop = fl < 0.5 && !door && front && w > 0.25 && w < 0.85 && small < 0.5 && ahash(vec3(col, sd, 7.0)) < 0.55;
      bool loggia = arcade > 0.5 && fl < 0.5;
      if (door) { hw = min(0.8, cw * 0.32); yb = 0.0; yt = min(fh * 0.78, 2.7); } else if (loggia) { hw = cw * 0.4; yb = 0.0; yt = fh * 0.6; } else if (shop) { hw = cw * 0.36; yb = 0.45; yt = fh * 0.8; } else if (fl < 0.5) { yb = max(yb, fh * 0.38); }
      float rhead = (ws > 0.5 && ws < 1.5) || arcade > 0.5 || (door && w > 0.6) ? 1.0 : 0.0, point = (ws > 3.5 && ws < 4.5) ? 1.0 : 0.0;
      float head = rhead > 0.5 ? hw : point > 0.5 ? hw * 1.6 : 0.0, top = yt + head;
      float inHead = 1.0;
      if (y > yt && rhead > 0.5) inHead = step(x * x + (y - yt) * (y - yt), hw * hw);
      if (y > yt && point > 0.5) inHead = step(abs(x), hw * (1.0 - pow((y - yt) / head, 1.6)));
      float win = step(abs(x), hw) * step(yb, y) * step(y, top) * inHead;
      float fr = small > 0.5 ? 0.16 : 0.11;
      float outHead = 1.0;
      if (y > yt && rhead > 0.5) outHead = step(x * x + (y - yt) * (y - yt), (hw + fr) * (hw + fr));
      if (y > yt && point > 0.5) outHead = step(abs(x), (hw + fr) * (1.0 - pow(clamp((y - yt) / (head + fr), 0.0, 1.0), 1.6)));
      float frame = step(abs(x), hw + fr) * step(yb - fr, y) * step(y, top + fr) * outHead * (1.0 - win);
      float sill = (door || loggia) ? 0.0 : step(abs(x), hw + 0.22) * step(yb - 0.2, y) * step(y, yb - fr * 0.5);
      float shut = (ws < 0.5 && w > 0.18 && w < 0.78 && !door && !shop && ahash(vec3(sd, 3.0, 1.0)) < 0.8) ? step(hw + fr, abs(x)) * step(abs(x), hw * 1.95 + fr) * step(yb, y) * step(y, yt) : 0.0;
      vec3 shutC = vec3(0.16, 0.26, 0.17) * (0.8 + 0.6 * ahash(vec3(sd, 1.0, 2.0)));
      if (ahash(vec3(sd, 4.0, 4.0)) < 0.4) shutC = shutC.bgr * vec3(0.9, 1.0, 1.5);
      if (ahash(vec3(sd, 5.0, 4.0)) < 0.2) shutC = vec3(0.42, 0.18, 0.12);
      // timber framing in the panels between windows
      float frameT = 0.0;
      if (mat > 2.5 && mat < 3.5 && fl > 0.5) {
        float px = abs(x), side = px - hw - fr - 0.05, panel = cw * 0.5 - hw - fr - 0.05;
        float post = step(abs(side - 0.0), 0.11) + step(cw * 0.5 - 0.12, px) + step(u, 0.25) + step(width - 0.25, u);
        float rail = step(y, 0.22) + step(fh - 0.2, y) + step(abs(y - (yb - 0.25)), 0.1);
        float t = clamp(side / max(panel, 0.3), 0.0, 1.0), by = (y - 0.22) / max(yb - 0.47, 0.3);
        float brace = side > 0.0 ? step(abs(t - by), 0.13 / max(panel, 0.3)) * step(y, yb - 0.25) : 0.0;
        frameT = clamp(post + rail + brace, 0.0, 1.0) * (1.0 - win) * (1.0 - frame);
      }
      float edge = min(u, width - u), quoin = (w > 0.55 && mat != 3.0 && mat < 3.5) ? step(edge, 0.7) * step(0.5, fract(h / 0.7)) : 0.0;
      float cornice = w > 0.35 ? smoothstep(vSize.y - 1.1, vSize.y - 0.5, vLoc.y) : 0.0;
      float band = (w > 0.45 && fl > 0.5) ? step(y, 0.25) : 0.0;
      float lit = step(ahash(vec3(col, fl, sd)), mix(0.22, 0.55, w));
      vec3 glass = mix(vec3(0.03, 0.035, 0.045), uSky * 0.35, 0.35 + 0.2 * smoothstep(top, yb, y));
      if (ws > 2.5 && ws < 3.5 && !door) { // mullions, transom and leaded panes
        float m = step(abs(x), 0.06) + step(abs(y - (yb + (yt - yb) * 0.66)), 0.06);
        float lead = step(0.86, max(fract((x + y) * 3.2), fract((x - y) * 3.2)));
        glass = mix(glass, vec3(0.08, 0.07, 0.06), clamp(lead * 0.35 + m * 0.9, 0.0, 1.0));
      }
      vec3 doorC = mat > 3.5 && mat < 4.5 ? vec3(0.1, 0.22, 0.42) : vec3(0.13, 0.08, 0.05) * (0.8 + 0.5 * ahash(vec3(sd, 9.0, 1.0)));
      vec3 c = base;
      vec3 trim = mat > 3.5 && mat < 4.5 ? base * 1.04 : mix(base, vec3(0.92, 0.9, 0.85), 0.55);
      c = mix(c, trim, max(max(frame, sill), max(quoin * 0.7, max(cornice, band) * 0.6)));
      c = mix(c, beam, frameT);
      c = mix(c, shutC, shut);
      c = mix(c, door ? doorC : loggia ? vec3(0.05, 0.045, 0.04) : shop ? mix(glass, vec3(0.12, 0.09, 0.06), step(y, 1.2)) : glass, win);
      c *= 1.0 - 0.35 * win * smoothstep(top - 0.5, top, y); // shadow under the lintel
      diffuseColor.rgb = mix(base * (1.0 - 0.18 * mix(0.35, 0.5, w)), c, fade);
      bump += (-0.09 * win + 0.035 * (frame + sill) + 0.03 * quoin + 0.05 * cornice + 0.02 * shut + 0.025 * frameT) * fade;
      atmoGlow = mix(win * lit * (door ? 0.4 : loggia ? 0.6 : 1.0), mix(0.22, 0.55, w) * 0.2, 1.0 - fade) * uNight;
    }
    atmoBump = bump;
  } else { diffuseColor.rgb *= 0.7; atmoBump = anoise(vAtmoPos * 1.5) * 0.05; }
`
export const GLOW = 'totalEmissiveRadiance += atmoGlow * vec3(1.0, 0.6, 0.28) * 3.2;'

// ---------- roofs: the tile style comes from the part (iTile: style, seed) ----------
export const ROOF_VH = 'attribute vec2 iTile; varying vec2 vTile; varying vec3 vRoofN;\n'
export const ROOF_V = 'vTile = iTile; vRoofN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);'
export const ROOF_FH = 'varying vec2 vTile; varying vec3 vRoofN;\n'
export const ROOF = /* glsl */ `
  { vec3 rn = normalize(vRoofN); float tile = vTile.x, sd = vTile.y;
    vec2 dn = normalize(rn.xz + 1e-5); float along = dot(vAtmoPos.xz, vec2(-dn.y, dn.x)), up = vAtmoPos.y / max(0.25, length(rn.xz)) * max(0.25, rn.y);
    float sloped = step(0.12, length(rn.xz)), shade = 1.0, bump = 0.0;
    if (tile < 0.5) { // flat clay tiles in staggered courses
      float r = up * 3.4, ri = floor(r), rf = fract(r), t = ahash(vec3(floor(along * 3.8 + ri * 0.5), ri, sd));
      shade = (0.8 + 0.3 * t) * (0.78 + 0.22 * smoothstep(0.0, 0.25, rf)); bump = rf * 0.05;
    } else if (tile < 1.5) { // barrel tiles: rounded channels running down the slope
      float f = fract(along * 2.4), prof = sin(f * 3.1416);
      float r = up * 2.1, rf = fract(r), t = ahash(vec3(floor(along * 2.4), floor(r), sd));
      shade = (0.72 + 0.36 * prof) * (0.85 + 0.25 * t) * (0.85 + 0.15 * smoothstep(0.0, 0.2, rf)); bump = prof * 0.06;
    } else if (tile < 2.5) { // slate: small staggered plates, blue-grey shifts
      float r = up * 5.0, ri = floor(r), rf = fract(r), t = ahash(vec3(floor(along * 4.0 + ri * 0.5), ri, sd));
      shade = (0.82 + 0.28 * t) * (0.8 + 0.2 * smoothstep(0.0, 0.3, rf)); bump = rf * 0.025;
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.92, 0.98, 1.08), t);
    } else if (tile < 3.5) { // wooden shingles, silvered by weather
      float r = up * 4.2, ri = floor(r), rf = fract(r), cu = along * (3.0 + ahash(vec3(ri, sd, 1.0)) * 2.0), t = ahash(vec3(floor(cu), ri, sd));
      shade = (0.7 + 0.4 * t) * (0.72 + 0.28 * smoothstep(0.0, 0.3, rf)) * (0.92 + 0.15 * anoise(vec3(along * 25.0, up, sd))); bump = rf * 0.04;
    } else if (tile < 4.5) { // big stone slabs with moss
      float r = up * 1.5, ri = floor(r), rf = fract(r), cu = along * (1.2 + ahash(vec3(ri, sd, 3.0))), cf = fract(cu), t = ahash(vec3(floor(cu), ri, sd));
      float e = min(min(rf, 1.0 - rf), min(cf, 1.0 - cf));
      shade = (0.72 + 0.4 * t) * mix(0.55, 1.0, smoothstep(0.0, 0.08, e)); bump = smoothstep(0.0, 0.15, e) * 0.08;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.28, 0.14), smoothstep(0.55, 0.75, anoise(vAtmoPos * 0.8)) * 0.5);
    } else if (tile < 5.5) { // copper: standing seams and verdigris
      float s = fract(along * 1.8); shade = 0.92 + 0.15 * step(0.94, s); bump = step(0.94, s) * 0.04;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 1.15, 1.05), anoise(vAtmoPos * 0.6));
    } else if (tile < 6.5) { // glazed tiles in a diamond pattern
      float d = step(0.5, fract((along + up) * 1.5)) + step(0.5, fract((along - up) * 1.5));
      shade = 0.85 + 0.25 * mod(d, 2.0); bump = 0.0;
    } else if (tile < 7.5) { // lead sheets with seams
      float s = fract(along * 1.1), r = fract(up * 0.6); shade = 0.9 + 0.12 * anoise(vAtmoPos * 0.4) - 0.1 * step(0.96, max(s, r)); bump = step(0.96, s) * 0.03;
    } else { shade = 0.92 + 0.1 * anoise(vAtmoPos * 1.2); }
    float fadeR = 1.0 - smoothstep(0.3, 0.9, fwidth(up * 3.4));
    diffuseColor.rgb *= mix(0.95, shade, fadeR * sloped + (1.0 - sloped) * 0.6);
    diffuseColor.rgb *= 0.86 + 0.18 * anoise(vAtmoPos * 0.35);
    diffuseColor.rgb *= 1.0 - 0.15 * smoothstep(0.55, 0.85, anoise(vec3(along * 2.0, up * 0.25, sd))) * sloped; // streaks
    atmoBump = bump * fadeR;
  }
`
// ---------- trees: foliage 0 trunk, 1 leaves that turn and fall, 2 evergreen ----------
export const TREE_VH = 'attribute float foliage; varying float vFol;\n'
export const TREE_V = 'vFol = foliage;'
export const TREE_FH = 'varying float vFol;\n'
export const TREE = /* glsl */ `
  if (vFol > 0.5 && vFol < 1.5) { if (uBare > 0.5 && ahash(floor(vAtmoPos * 0.5)) < 0.75) discard; diffuseColor.rgb *= uFoliage * 1.9; }
  diffuseColor.rgb *= 0.82 + 0.34 * anoise(vAtmoPos * 0.9);
  atmoBump = anoise(vAtmoPos * 2.5) * 0.18;
`

// ---------- sky ----------
export const SKY_V = 'varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }'
export const SKY_F = /* glsl */ `
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

// ---------- final look: grading, brush (Kuwahara), ink outlines, soft colour bands, grain ----------
export const STYLE_F = /* glsl */ `
uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uSat; uniform vec3 uTint; uniform float uVig; uniform float uContrast;
uniform vec3 uShadow; uniform vec3 uHigh; uniform float uBrush; uniform float uInk; uniform float uBands; uniform float uGrain;
varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float h1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = 1.0 / uRes;
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  if (uBrush > 0.5) {
    vec3 m0 = vec3(0), m1 = vec3(0), m2 = vec3(0), m3 = vec3(0), s0 = vec3(0), s1 = vec3(0), s2 = vec3(0), s3 = vec3(0);
    float n = 0.0;
    for (int j = -4; j <= 0; j++) for (int i = -4; i <= 0; i++) {
      if (float(-i) > uBrush || float(-j) > uBrush) continue;
      vec2 o = vec2(float(i), float(j)) * px;
      vec3 a = texture2D(tDiffuse, vUv + o).rgb, b = texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb, cc = texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb, d = texture2D(tDiffuse, vUv - o).rgb;
      m0 += a; s0 += a * a; m1 += b; s1 += b * b; m2 += cc; s2 += cc * cc; m3 += d; s3 += d * d; n += 1.0;
    }
    m0 /= n; m1 /= n; m2 /= n; m3 /= n;
    float v0 = lum(s0 / n - m0 * m0), v1 = lum(s1 / n - m1 * m1), v2 = lum(s2 / n - m2 * m2), v3 = lum(s3 / n - m3 * m3);
    c = m0; float v = v0;
    if (v1 < v) { v = v1; c = m1; } if (v2 < v) { v = v2; c = m2; } if (v3 < v) { c = m3; }
  }
  if (uInk > 0.0) {
    float tl = lum(texture2D(tDiffuse, vUv + px * vec2(-1, 1)).rgb), t = lum(texture2D(tDiffuse, vUv + px * vec2(0, 1)).rgb), tr = lum(texture2D(tDiffuse, vUv + px * vec2(1, 1)).rgb);
    float l = lum(texture2D(tDiffuse, vUv + px * vec2(-1, 0)).rgb), r = lum(texture2D(tDiffuse, vUv + px * vec2(1, 0)).rgb);
    float bl = lum(texture2D(tDiffuse, vUv + px * vec2(-1, -1)).rgb), b = lum(texture2D(tDiffuse, vUv + px * vec2(0, -1)).rgb), br = lum(texture2D(tDiffuse, vUv + px * vec2(1, -1)).rgb);
    float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl, gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
    c *= 1.0 - uInk * 0.85 * smoothstep(0.07, 0.3, length(vec2(gx, gy)));
  }
  if (uBands > 0.0) { float L = lum(c), q = (floor(L * uBands) + smoothstep(0.35, 0.65, fract(L * uBands))) / uBands; c *= mix(1.0, q / max(L, 1e-3), 0.45); }
  float L = lum(c);
  c = mix(vec3(L), c, uSat) * uTint;
  c = (c - 0.5) * uContrast + 0.5;
  c *= mix(uShadow, uHigh, smoothstep(0.15, 0.75, L));
  vec2 q = vUv - 0.5; c *= 1.0 - uVig * dot(q, q) * 1.8;
  c += (h1(vUv * uRes + fract(uContrast * 97.0)) - 0.5) * uGrain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`
