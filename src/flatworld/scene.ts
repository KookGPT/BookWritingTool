// New Map Test renderer: a flat world as a lit, animated diorama in a toon style.
// The ground is drawn on the GPU from the height grid in quadtree tiles that add detail near the camera (the same detail
// the JS computes in `surfaceAt`). Heights ease from full exaggeration far away to 40% of it up close.
// A final pass adds the sky, ink outlines, haze, heat shimmer and the art styles.
import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { rng, hash } from '../world/noise.ts'
import { DETAIL_M, heightAt, surfaceAt, TREE_KINDS, type Gen, type treesOf, type wallMesh } from './gen.ts'

export interface Built { gen: Gen; wall: ReturnType<typeof wallMesh>; trees: ReturnType<typeof treesOf>; seed: string }
export const LIGHTS = { day: 'Day', golden: 'Golden hour', night: 'Night', cycle: 'Day & night cycle' } as const
export type Light = keyof typeof LIGHTS
export const STYLES = { toon: 'Toon', watercolor: 'Watercolour', atlas: 'Old atlas', neon: 'Neon night' } as const
export type Style = keyof typeof STYLES

const MAX_CLOUDS = 40, MAX_WHIRLS = 8, MAX_FLOCKS = 8, TILE = 64

// Shared GLSL: ground height (bilinear, exact), close-up detail (integer hash, matches gen.ts), toon light, cloud shadows.
const COMMON = /* glsl */ `
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb; uniform float uNight; uniform float uTime;
uniform vec4 uClouds[${MAX_CLOUDS}]; uniform int uNC; uniform float uDiscR; uniform float uFlash;
uniform sampler2D tHeight; uniform sampler2D tRough; uniform vec2 uSize; uniform vec2 uGrid; uniform float uE; uniform float uHScale;
vec2 mapUV(vec2 xy) { return vec2((xy.x + uSize.x * .5) / uSize.x, (uSize.y * .5 - xy.y) / uSize.y); }
float hRaw(vec2 xy) {
  vec2 f = clamp(mapUV(xy) * uGrid - .5, vec2(0.), uGrid - 1.001);
  ivec2 i = ivec2(floor(f)); vec2 t = f - vec2(i);
  float a = texelFetch(tHeight, i, 0).r, b = texelFetch(tHeight, i + ivec2(1, 0), 0).r, c = texelFetch(tHeight, i + ivec2(0, 1), 0).r, d = texelFetch(tHeight, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
float ih(int x, int y) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du; h ^= h >> 12u;
  return float(h) / 4294967296.;
}
float vn(vec2 p) { vec2 i = floor(p), f = p - i, u = f * f * (3. - 2. * f); int a = int(i.x), b = int(i.y);
  return mix(mix(ih(a, b), ih(a + 1, b), u.x), mix(ih(a, b + 1), ih(a + 1, b + 1), u.x), u.y); }
float detailN(vec2 xy) { float s = 0., a = .5, f = 1. / 6.5;
  for (int o = 0; o < 4; o++) { float n = vn(vec2(xy.x * f + float(o) * 17.3, xy.y * f - float(o) * 9.1)); s += a * (1. - abs(n * 2. - 1.)); a *= .5; f *= 2.3; }
  return s - .47; }
float roughAt(vec2 xy) { return texture(tRough, mapUV(xy)).r; }
float surf(vec2 xy) { return hRaw(xy) + detailN(xy) * roughAt(xy) * ${DETAIL_M.toFixed(1)}; }
float dispY(float m) { return m * uE * uHScale; }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
vec3 lit(vec3 base, float d) { // three soft toon bands between the ambient tint and the sun
  float b = .5 * smoothstep(-.04, .06, d) + .5 * smoothstep(.38, .48, d);
  return base * mix(uAmb, uSunCol, b);
}
vec3 toon(vec3 base, vec3 n) { return lit(base, dot(normalize(n), uSun)); }
float cloudShade(vec2 p) {
  float s = 0.;
  for (int i = 0; i < ${MAX_CLOUDS}; i++) { if (i >= uNC) break; vec4 c = uClouds[i]; s = max(s, smoothstep(c.z, c.z * .4, length(p - c.xy))); }
  return 1. - .32 * s;
}
`
const uniforms = () => ({
  uSun: { value: new THREE.Vector3(-0.55, 0.75, -0.4).normalize() }, uSunCol: { value: new THREE.Vector3(1.07, 1.03, 0.96) }, uAmb: { value: new THREE.Vector3(0.66, 0.62, 0.76) },
  uNight: { value: 0 }, uTime: { value: 0 }, uNC: { value: 0 }, uDiscR: { value: 0 }, uFlash: { value: 0 },
  uClouds: { value: Array.from({ length: MAX_CLOUDS }, () => new THREE.Vector4()) },
  tHeight: { value: null as THREE.Texture | null }, tRough: { value: null as THREE.Texture | null }, uSize: { value: new THREE.Vector2(1, 1) }, uGrid: { value: new THREE.Vector2(1, 1) },
  uE: { value: 0.03 }, uHScale: { value: 1 },
})
type U = ReturnType<typeof uniforms>
const shader = (u: U, extra: Record<string, THREE.IUniform>, vertexShader: string, fragmentShader: string, opts: THREE.ShaderMaterialParameters = {}) =>
  new THREE.ShaderMaterial({ uniforms: { ...u, ...extra }, vertexShader: COMMON + vertexShader, fragmentShader: COMMON + fragmentShader, ...opts })

// ---------- ground ----------
const terrainMat = (u: U, t: { color: THREE.Texture; data: THREE.Texture; shadow: THREE.Texture; fill: THREE.IUniform }) => shader(u,
  { tColor: { value: t.color }, tData: { value: t.data }, tShadow: { value: t.shadow }, tFill: t.fill, uMist: { value: 0.3 } },
  /* glsl */ `
    attribute vec3 iTile; // x0, y0 (south-west corner, km), size
    varying vec2 vXY; varying vec3 vN; varying vec3 vW; varying float vH; varying float vH0;
    void main() {
      vec2 xy = iTile.xy + position.xy * iTile.z;
      xy = clamp(xy, -uSize * .5, uSize * .5);
      float e = iTile.z / ${TILE}.;
      float h = surf(xy), hx0 = surf(xy - vec2(e, 0.)), hx1 = surf(xy + vec2(e, 0.)), hy0 = surf(xy - vec2(0., e)), hy1 = surf(xy + vec2(0., e));
      float k = uE * uHScale / (2. * e);
      vN = normalize(vec3(-(hx1 - hx0) * k, 1., (hy1 - hy0) * k));
      vXY = xy; vH = h; vH0 = hRaw(xy);
      vW = vec3(xy.x, dispY(h) - position.z * iTile.z * .04, -xy.y); // skirts hang below tile edges to hide cracks
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
    }`,
  /* glsl */ `
    uniform sampler2D tColor; uniform sampler2D tData; uniform sampler2D tShadow; uniform sampler2D tFill; uniform float uMist;
    varying vec2 vXY; varying vec3 vN; varying vec3 vW; varying float vH; varying float vH0;
    void main() {
      if (uDiscR > 0. ? length(vXY) > uDiscR : any(greaterThan(abs(vXY), uSize * .5))) discard;
      vec2 uv = mapUV(vXY);
      vec4 t = texture(tColor, uv), fill = texture(tFill, uv), dat = texture(tData, uv);
      float code = texelFetch(tData, ivec2(clamp(uv * uGrid, vec2(0.), uGrid - 1.)), 0).b * 255.;
      float fx = floor(code / 16. + .01), fs = mod(code, 16.) / 15.;
      t.rgb = mix(t.rgb, fill.rgb, fill.a * step(0., vH)); // region fills, land only
      float aa = fwidth(vW.x); // km per pixel: fine detail fades out before it can flicker
      vec3 base = t.rgb * (.92 + .1 * vnoise(vXY * .3) + .06 * mix(vnoise(vXY * 1.9), .5, smoothstep(.2, .6, aa)));
      // craggy facets on steep ground
      vec3 n = normalize(vN);
      float steep = smoothstep(.55, .85, 1. - n.y) * (1. - smoothstep(.5, 1.5, aa));
      if (steep > 0.) {
        vec2 q = vXY * .35, e = vec2(.08, 0.);
        float f0 = vnoise(q) + .5 * vnoise(q * 2.3), fx0 = vnoise(q + e.xy) + .5 * vnoise((q + e.xy) * 2.3), fz0 = vnoise(q + e.yx) + .5 * vnoise((q + e.yx) * 2.3);
        n = normalize(n + steep * vec3(f0 - fx0, 0., fz0 - f0) / e.x * .75);
      }
      float sh = texture(tShadow, uv).r, d = dot(n, uSun);
      d = mix(min(d, -.1), d, sh);
      vec3 col = lit(base, d) * (.8 + .32 * clamp(dot(n, uSun), 0., 1.) - .12 * (1. - n.y)) * mix(.62, 1., dat.a) * cloudShade(vXY);
      // coast ink, on the smooth height so close-up detail doesn't smear it
      float fw = fwidth(vH0), ink = 1. - smoothstep(fw * .7, fw * 1.8, abs(vH0 - 5.));
      col = mix(col, vec3(.16, .2, .3), ink * .7);
      // effects by ground type
      vec3 glow = vec3(0.);
      if (fx == 1.) col *= 1. + .05 * fs * sin(uTime * 3. + vXY.y * 1.3 + vnoise(vXY * .2) * 6.); // heat
      if (fx == 2.) glow += vec3(.55, .4, 1.) * fs * (.25 + .2 * sin(uTime * 2. + vXY.x * .3 + vXY.y * .2));
      if (fx == 3.) col += smoothstep(.985, 1., vnoise(vXY * 4. + floor(uTime * 3.) * 1.7)) * fs * (1. - smoothstep(.3, 1., aa)) * vec3(.9, .95, 1.);
      if (fx == 5.) glow += base * fs * (.35 + .25 * sin(uTime * 1.6 + vnoise(vXY * .05) * 8.));
      if (fx == 6.) col = mix(col, col * .7, fs) + uFlash * fs * vec3(.7, .75, .95);
      if (fx == 8.) col = mix(col, vec3(.92, .95, 1.), fs * .35 * vnoise(vXY * .15 + vec2(uTime * .8, uTime * .2)));
      float lava = 1. - t.a;
      vec3 lavaCol = vec3(1., .42, .1) * (1.25 + .35 * sin(uTime * 2.3 + vXY.x * .2));
      col = mix(col, lavaCol, clamp(lava, 0., 1.)) + glow * (1. + 1.5 * uNight);
      // mist pooling in valleys, strongest at golden hour
      float mist = uMist * (1. - dat.a) * smoothstep(900., 80., vH) * vnoise(vXY * .025 + vec2(uTime * .01, 0.));
      col = mix(col, mix(vec3(.95, .93, .9), vec3(.35, .4, .6), uNight), clamp(mist * 1.4, 0., .7));
      gl_FragColor = vec4(col, fx == 1. ? 1. - .6 * fs : 1.); // alpha < 1 asks the final pass for heat shimmer
    }`)

// Shadows: march each ground point towards the sun through the height grid (half resolution), redone when the light or scale changes.
const shadowMat = (u: U, cell: number) => shader(u, { uCell: { value: cell } },
  /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  /* glsl */ `
    uniform float uCell; varying vec2 vUv;
    void main() {
      vec2 xy = vec2(vUv.x * uSize.x - uSize.x * .5, uSize.y * .5 - vUv.y * uSize.y);
      float h0 = dispY(max(hRaw(xy), 0.)) + .05;
      vec2 dir = normalize(vec2(uSun.x, -uSun.z) + 1e-5); float tanE = max(uSun.y, .02) / max(length(uSun.xz), 1e-3);
      float vis = 1., t = uCell;
      for (int i = 0; i < 44; i++) {
        float th = dispY(max(hRaw(xy + dir * t), 0.)), ry = h0 + t * tanE;
        vis = min(vis, clamp((ry - th) / (t * .05) + .3, 0., 1.));
        t = t * 1.11 + uCell * .6;
      }
      gl_FragColor = vec4(vis);
    }`, { depthTest: false, depthWrite: false })

const waterMat = (u: U, data: THREE.Texture, level: number, lake: boolean) => shader(u,
  { tData: { value: data }, uLevel: { value: level }, uWhirls: { value: Array.from({ length: MAX_WHIRLS }, () => new THREE.Vector4()) }, uNW: { value: 0 } },
  /* glsl */ `uniform float uLevel; varying vec2 vXY; varying vec3 vW;
    void main() { vXY = vec2(position.x, -position.z); vW = vec3(position.x, dispY(uLevel), position.z); gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`,
  /* glsl */ `
    uniform sampler2D tData; uniform vec4 uWhirls[${MAX_WHIRLS}]; uniform int uNW; varying vec2 vXY; varying vec3 vW;
    void main() {
      if (uDiscR > 0. ? length(vXY) > uDiscR : any(greaterThan(abs(vXY), uSize * .5))) discard;
      vec2 p = vXY, uv = mapUV(p);
      vec4 dat = texture(tData, uv);
      ${lake ? 'if (dat.g < .5) discard;' : ''}
      float code = texelFetch(tData, ivec2(clamp(uv * uGrid, vec2(0.), uGrid - 1.)), 0).b * 255.;
      float d = dat.r, t = uTime, aa = fwidth(p.x);
      float n = vnoise(p * .02 + vec2(t * .05, t * .03)) + .5 * vnoise(p * .07 - vec2(t * .08, -t * .05));
      vec3 col = mix(vec3(.38, .86, .82), vec3(.16, .58, .80), smoothstep(.015, .07, d + (n - .75) * .015));
      col = mix(col, vec3(.10, .34, .64), smoothstep(.22, .45, d));
      col = mix(col, vec3(.07, .24, .52), smoothstep(.7, 1., d));
      if (floor(code / 16. + .01) == 7.) col = mix(col, vec3(.3, .9, .85), .5 * mod(code, 16.) / 15.); // reef
      // painted depth contours, like an atlas
      float c = abs(fract(d * 6. + .5) - .5);
      col = mix(col, col * 1.18, (1. - smoothstep(0., fwidth(d * 6.) * 1.2, c)) * smoothstep(.08, .2, d) * .6);
      // open-sea waves: thin drifting crest lines, patchy so they come and go
      float cl = 1. - abs(vnoise(p * vec2(.035, .09) + vec2(t * .08, t * .04)) - .5) * 2.;
      float crest = smoothstep(.9, .96, cl) * smoothstep(.55, .75, vnoise(p * .012 - vec2(t * .015, 0.)));
      col = mix(col, vec3(.86, .95, 1.), crest * .55 * smoothstep(.04, .2, d) * (1. - smoothstep(2., 5., aa)));
      // surf: bands rolling in, breaking white at the shore
      float band = sin(d * 220. - t * 2.2 + n * 3.);
      float foam = smoothstep(.72, .92, band) * (1. - smoothstep(0., .045, d)) * (1. + smoothstep(.02, .0, d)) + 1. - smoothstep(.004, .012, d);
      col = mix(col, vec3(.97, .99, 1.), clamp(foam, 0., 1.) * .85);
      // whirlpools
      for (int i = 0; i < ${MAX_WHIRLS}; i++) {
        if (i >= uNW) break;
        vec2 v = p - uWhirls[i].xy; float r = length(v) / uWhirls[i].z;
        if (r < 1.3) {
          float s = sin(atan(v.y, v.x) * 3. + log(r + .04) * 9. + t * 3.);
          col = mix(col, vec3(.04, .12, .3), smoothstep(.5, 0., r) * .7);
          col = mix(col, vec3(.9, .97, 1.), smoothstep(.75, .95, s) * (1. - smoothstep(.6, 1.3, r)) * .8);
        }
      }
      float g = vnoise(p * .35 + t * .5) * vnoise(p * .21 - t * .35);
      col += smoothstep(.56, .6, g) * .35 * uSunCol * smoothstep(.02, .1, d) * (1. - smoothstep(.4, 1.2, aa));
      col = col * mix(vec3(1.), uAmb * 1.3, uNight * .6) * cloudShade(p);
      gl_FragColor = vec4(col, mix(.42, .96, smoothstep(0., .1, d))); // see-through shallows
    }`, { transparent: true })

const wallMat = (u: U, W: number, H: number) => shader(u, { uHalf: { value: new THREE.Vector2(W / 2, H / 2) } },
  /* glsl */ `attribute float ground; varying float vG; varying vec3 vW;
    void main() { vG = ground * uHScale; vW = vec3(position.x, position.y > 0. ? position.y * uHScale : position.y, position.z);
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`,
  /* glsl */ `
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
    }`, { side: THREE.DoubleSide })

// Falling water: the sea pouring off the edge of the world, and the falls off floating islands.
const fallMat = (u: U) => shader(u, {},
  /* glsl */ `attribute vec2 fall; varying vec2 vF; void main() { vF = fall; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`,
  /* glsl */ `varying vec2 vF;
    void main() {
      float s = vnoise(vec2(vF.x * .25, vF.y * 6. - uTime * 2.5)) * vnoise(vec2(vF.x * .7, vF.y * 14. - uTime * 4.));
      vec3 col = mix(vec3(.25, .62, .86), vec3(.95, .98, 1.), smoothstep(.25, .5, s) * .8 + vF.y * .3);
      gl_FragColor = vec4(col * mix(vec3(1.), uAmb, uNight * .6), (1. - smoothstep(.55, 1., vF.y)) * .92);
    }`, { transparent: true, side: THREE.DoubleSide, depthWrite: false })

const riverMat = (u: U) => shader(u, {},
  /* glsl */ `attribute float steep; varying vec2 vUv; varying vec2 vXY; varying float vSteep;
    void main() { vUv = uv; vXY = vec2(position.x, -position.z); vSteep = steep;
      gl_Position = projectionMatrix * viewMatrix * vec4(position.x, dispY(position.y) + .05, position.z, 1.); }`,
  /* glsl */ `varying vec2 vUv; varying vec2 vXY; varying float vSteep;
    void main() {
      float e = abs(vUv.x);
      vec3 col = mix(vec3(.20, .55, .84), vec3(.45, .80, .92), smoothstep(.3, 1., e));
      float sp = 1.4 + vSteep * 6.;
      float f = vnoise(vec2(vUv.x * 2.5, vUv.y * .22 - uTime * sp)) * vnoise(vec2(vUv.x * 5., vUv.y * .5 - uTime * sp * 1.4));
      col = mix(col, vec3(.92, .98, 1.), max(smoothstep(.32, .4, f) * .7, smoothstep(.15, .5, vSteep) * (.6 + .4 * f)));
      gl_FragColor = vec4(col * cloudShade(vXY) * mix(vec3(1.), uAmb * 1.3, uNight * .6), 1. - smoothstep(.75, 1., e));
    }`, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })

// Trees: [x, y(north), scale, yaw] + shade per instance; they stand on the detailed ground and sit in its shadows.
const treeMat = (u: U, sway: number, glow: number, shadow: THREE.Texture, kScale: THREE.IUniform) => shader(u,
  { uSway: { value: sway }, uGlow: { value: glow }, tShadow: { value: shadow }, uK: kScale },
  /* glsl */ `
    uniform float uSway; uniform float uK; uniform sampler2D tShadow;
    attribute vec4 iA; attribute float iB; attribute vec3 color;
    varying vec3 vCol; varying vec3 vN; varying vec2 vXY; varying float vSh;
    void main() {
      float c = cos(iA.w), s = sin(iA.w);
      mat2 r = mat2(c, -s, s, c);
      vec3 p = position; p.xz = r * p.xz;
      vec3 n = normal; n.xz = r * n.xz;
      float k = sin(uTime * 1.7 + iA.x * .07 + iA.y * .05) + .4 * sin(uTime * 3.1 + iA.y * .11);
      p.x += k * uSway * p.y * p.y; p.z += k * uSway * .6 * p.y * p.y;
      vXY = iA.xy;
      vec3 w = vec3(iA.x, dispY(surf(iA.xy)), -iA.y) + (p - vec3(0., .06, 0.)) * iA.z * uK;
      vN = n; vCol = color * iB; vSh = texture(tShadow, mapUV(iA.xy)).r;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
    }`,
  /* glsl */ `uniform float uGlow; varying vec3 vCol; varying vec3 vN; varying vec2 vXY; varying float vSh;
    void main() {
      float d = dot(normalize(vN), uSun); d = mix(min(d, -.1), d, vSh);
      vec3 col = lit(vCol, d) * cloudShade(vXY);
      col += vCol * uGlow * (.5 + .3 * sin(uTime * 2. + vXY.x)) * (1. + 2. * uNight);
      gl_FragColor = vec4(col, 1.);
    }`)

// Solid low-poly things with vertex colours (props, ships): toon-lit in world space.
const solidMat = (u: U, glow = 0) => shader(u, { uGlow: { value: glow } },
  /* glsl */ `attribute vec3 color; varying vec3 vCol; varying vec3 vN;
    void main() { vCol = color; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`,
  /* glsl */ `uniform float uGlow; varying vec3 vCol; varying vec3 vN;
    void main() { gl_FragColor = vec4(toon(vCol, vN) + vCol * uGlow * (1. + uNight), 1.); }`)

const cloudMat = (u: U, dark: boolean) => shader(u, {},
  /* glsl */ `varying vec3 vN; void main() { vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`,
  /* glsl */ `varying vec3 vN;
    void main() { float d = dot(vN, uSun);
      vec3 c = ${dark ? 'mix(vec3(.28, .3, .38), vec3(.5, .52, .6), smoothstep(0., .1, d)) + uFlash * vec3(.6, .65, .8)' : 'mix(uAmb * 1.1, uSunCol, smoothstep(.0, .1, d))'};
      gl_FragColor = vec4(c, 1.); }`)

// Particles animated entirely in the shader. iP = x, y(north), ground (display km before the zoom easing), phase.
type PuffKind = 'smoke' | 'plume' | 'mote' | 'rain' | 'snow' | 'spray'
const PUFF: Record<PuffKind, { speed: string; drift: string; size: string; color: string }> = {
  smoke: { speed: '.06', drift: 'vec3(life * uRise * .55 + sin(life * 6. + iP.w * 20.) * uS, life * uRise, -life * uRise * .2)', size: '(.45 + 1.8 * life) * (1. - smoothstep(.8, 1., life))', color: 'toon(mix(vec3(.38, .34, .34), vec3(.82, .80, .80), vLife), vN)' },
  plume: { speed: '.12', drift: 'vec3(life * uRise, life * uRise * .15, -life * uRise * .3)', size: '(.45 + 1.8 * life) * (1. - smoothstep(.8, 1., life))', color: 'toon(vec3(.97, .98, 1.), vN)' },
  spray: { speed: '.5', drift: 'vec3(sin(iP.w * 40.) * uS * life * 3., life * uRise, cos(iP.w * 31.) * uS * life * 3.)', size: '(.45 + 1.8 * life) * (1. - smoothstep(.8, 1., life))', color: 'toon(vec3(.97, .98, 1.), vN)' },
  mote: { speed: '.05', drift: 'vec3(sin(life * 6. + iP.w * 20.) * uS * 4., life * uRise, cos(life * 5. + iP.w * 13.) * uS * 4.)', size: '(.6 + .4 * sin(uTime * 3. + iP.w * 50.)) * (1. - smoothstep(.85, 1., life))', color: 'vC * (1.6 + uNight)' },
  rain: { speed: '.9', drift: 'vec3(uRise * uHScale * .1 * life, uRise * uHScale * (1. - life), 0.)', size: '1.', color: 'vec3(.55, .62, .78) * mix(vec3(1.), uAmb, .5)' },
  snow: { speed: '.08', drift: 'vec3(uRise * life + sin(life * 9. + iP.w * 30.) * uS * 3., uRise * (1. - life), -uRise * .3 * life)', size: '1.', color: 'toon(vec3(.97, .98, 1.), vN)' },
}
const puffMat = (u: U, kind: PuffKind, size: number, rise: number, zoom: THREE.IUniform) => shader(u, { uS: { value: size }, uRise: { value: rise }, uK: zoom },
  /* glsl */ `
    uniform float uS; uniform float uRise; uniform float uK;
    attribute vec4 iP; attribute vec3 iC; varying vec3 vN; varying float vLife; varying vec3 vC;
    void main() {
      float life = fract(uTime * ${PUFF[kind].speed} + iP.w);
      vec3 p = position * uS * (.35 + .65 * uK) * ${PUFF[kind].size};
      ${kind === 'rain' ? 'p.y *= 22.;' : ''}
      vN = normal; vLife = life; vC = iC;
      gl_Position = projectionMatrix * viewMatrix * vec4(vec3(iP.x, iP.z * uHScale, -iP.y) + ${PUFF[kind].drift} + p, 1.);
    }`,
  /* glsl */ `varying vec3 vN; varying float vLife; varying vec3 vC;
    void main() { gl_FragColor = vec4(${PUFF[kind].color}, 1.); }`)

// Birds: V shapes flapping around a few flock centres. iB = flock, offset x, offset z, phase.
const birdMat = (u: U, size: number) => shader(u, { uFlocks: { value: Array.from({ length: MAX_FLOCKS }, () => new THREE.Vector4()) }, uBS: { value: size } },
  /* glsl */ `uniform vec4 uFlocks[${MAX_FLOCKS}]; uniform float uBS; attribute vec4 iB;
    void main() {
      vec4 f = uFlocks[int(iB.x)];
      float a = uTime * .12 + iB.x * 1.7, dir = -a;
      vec2 c = f.xy + vec2(cos(a), sin(a)) * f.z;
      vec3 p = position * uBS;
      p.y += abs(position.x) * uBS * .6 * sin(uTime * 9. + iB.w * 6.);
      p.xz += vec2(iB.y, iB.z) * uBS * 3.;
      float cs = cos(dir), sn = sin(dir);
      p.xz = mat2(cs, -sn, sn, cs) * p.xz;
      gl_Position = projectionMatrix * viewMatrix * vec4(c.x + p.x, f.w * uHScale + p.y, -c.y + p.z, 1.);
    }`,
  /* glsl */ `void main() { gl_FragColor = vec4(mix(vec3(.15, .14, .16), vec3(.5, .55, .8), uNight * .4), 1.); }`, { side: THREE.DoubleSide })

// Final pass: sky, ink outlines from depth, haze, heat shimmer, vignette, and the art styles.
const finalMat = () => new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 }, uHaze: { value: new THREE.Vector2(1, 2) },
    uStyle: { value: 0 }, uNight: { value: 0 }, uGolden: { value: 0 }, uTime: { value: 0 },
  },
  depthTest: false, depthWrite: false,
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform vec2 uHaze;
    uniform int uStyle; uniform float uNight; uniform float uGolden; uniform float uTime;
    varying vec2 vUv;
    float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float lin(vec2 uv) { float d = texture2D(tDepth, uv).r; return d >= 1. ? uFar * 4. : uNear * uFar / (uFar - d * (uFar - uNear)); }
    void main() {
      vec2 uv = vUv;
      vec4 src = texture2D(tColor, uv);
      if (src.a < .99) { uv += vec2(sin(uv.y * 900. + uTime * 7.), cos(uv.x * 700. + uTime * 5.)) * .0012 * (1. - src.a); src = texture2D(tColor, uv); } // heat shimmer
      vec3 col = src.rgb;
      float d0 = texture2D(tDepth, uv).r;
      vec3 day = mix(vec3(.80, .88, .94), vec3(.42, .62, .86), smoothstep(.35, 1., vUv.y));
      vec3 gold = mix(vec3(1., .72, .45), vec3(.45, .45, .75), smoothstep(.3, 1., vUv.y));
      vec3 night = mix(vec3(.08, .1, .2), vec3(.01, .02, .07), smoothstep(.3, 1., vUv.y));
      vec3 sky = mix(mix(day, gold, uGolden), night, uNight);
      if (uStyle == 3) sky = mix(vec3(.12, .02, .2), vec3(.01, .0, .05), smoothstep(.3, 1., vUv.y));
      if (uStyle == 2) sky = vec3(.9, .84, .68);
      float ink = 0.;
      if (d0 >= 1.) {
        col = sky;
        vec2 g = floor(vUv * uRes / 2.);
        float starry = max(uNight, uStyle == 3 ? 1. : 0.);
        col += step(.9975, h21(g)) * (.6 + .4 * sin(uTime * 2. + h21(g + 3.) * 30.)) * starry;
      } else {
        vec2 px = 1. / uRes; float z = lin(uv);
        float sum = lin(uv + vec2(px.x, 0.)) + lin(uv - vec2(px.x, 0.)) + lin(uv + vec2(0., px.y)) + lin(uv - vec2(0., px.y));
        ink = smoothstep(.05, .14, max(0., sum - 4. * z) / z);
        col = mix(col, sky, smoothstep(uHaze.x, uHaze.y, z) * .55);
      }
      vec2 q = vUv * uRes;
      if (uStyle == 0) col = mix(col, vec3(.14, .12, .2), ink * .8);
      else if (uStyle == 1) { // watercolour: soft pigment, paper grain, wet edges
        vec3 avg = (texture2D(tColor, uv + vec2(2., 1.) / uRes).rgb + texture2D(tColor, uv - vec2(1., 2.) / uRes).rgb + col) / 3.;
        if (d0 < 1.) col = mix(col, avg, .5);
        col = mix(col, floor(col * 7. + .5) / 7., .35);
        col = mix(col, vec3(dot(col, vec3(.3, .59, .11))), .12) * 1.04;
        col = mix(col, vec3(.97, .95, .9), .1);
        col *= .94 + .06 * h21(floor(q / 2.)) + .04 * sin(q.x * .05 + sin(q.y * .03) * 2.);
        col = mix(col, col * vec3(.55, .45, .5), ink * .6);
      } else if (uStyle == 2) { // old atlas: sepia inks, hatching in the shadows, parchment
        float l = dot(col, vec3(.3, .59, .11));
        bool water = col.b > col.r + .06 && col.b > col.g - .05;
        vec3 paper = vec3(.95, .89, .74), brown = vec3(.36, .25, .14);
        col = water ? mix(vec3(.45, .55, .58), vec3(.78, .82, .76), l) : mix(brown, paper, smoothstep(.15, .8, l));
        col = mix(col, brown, step(.5, fract((q.x + q.y) * .18)) * smoothstep(.45, .25, l) * .45);
        col *= .92 + .08 * h21(floor(q / 3.));
        col = mix(col, vec3(.22, .14, .07), ink * .9);
      } else { // neon night: dark land, glowing edges
        float bright = max(col.r, max(col.g, col.b));
        col = col * .2 + col * smoothstep(.85, 1.2, bright);
        col += vec3(.2, 1., .9) * ink * 1.2 + vec3(1., .2, .8) * ink * .3 * sin(uTime + q.x * .01);
      }
      col *= 1. - .22 * smoothstep(.45, .9, length(vUv - .5));
      gl_FragColor = vec4(col, 1.);
    }`,
})

// ---------- low-poly models (one unit tall, vertex colours, flat-shaded so the toon bands read as facets) ----------
type C3 = [number, number, number]
function part(g: THREE.BufferGeometry, rgb: C3, y: number, sx = 1, sy = 1, sz = 1, x = 0, z = 0, rx = 0, rz = 0) {
  g = g.toNonIndexed(); g.scale(sx, sy, sz); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z)
  const c = new Float32Array(g.attributes.position.count * 3)
  for (let i = 0; i < c.length; i += 3) c.set(rgb, i)
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv')
  return g
}
const merged = (parts: THREE.BufferGeometry[]) => { const g = mergeGeometries(parts); g.computeVertexNormals(); return g }
const BARK: C3 = [0.42, 0.29, 0.2]
const trunk = (h: number, r: number, c = BARK) => part(new THREE.CylinderGeometry(r * 0.7, r, h, 5), c, h / 2)
const ico = (r: number, c: C3, y: number, sx = 1, sy = 1, sz = 1, x = 0, z = 0) => part(new THREE.IcosahedronGeometry(r, 0), c, y, sx, sy, sz, x, z)
const TREES: Record<string, () => THREE.BufferGeometry[]> = {
  broad: () => [trunk(0.35, 0.06), ico(0.3, [0.36, 0.64, 0.26], 0.55), ico(0.21, [0.42, 0.7, 0.3], 0.74, 1, 1, 1, 0.1, 0.05)],
  pine: () => [trunk(0.22, 0.05), part(new THREE.ConeGeometry(0.27, 0.5, 7), [0.2, 0.44, 0.3], 0.42), part(new THREE.ConeGeometry(0.19, 0.4, 7), [0.24, 0.5, 0.33], 0.72)],
  jungle: () => [trunk(0.5, 0.07), ico(0.38, [0.18, 0.54, 0.22], 0.72, 1.1, 0.6, 1.1), ico(0.24, [0.26, 0.62, 0.24], 0.86, 1, 0.6, 1, -0.15, 0.1)],
  cactus: () => [part(new THREE.CylinderGeometry(0.07, 0.08, 0.7, 6), [0.34, 0.6, 0.32], 0.35), part(new THREE.CylinderGeometry(0.045, 0.05, 0.28, 5), [0.36, 0.62, 0.34], 0.45, 1, 1, 1, 0.13, 0)],
  swamp: () => [trunk(0.4, 0.08), ico(0.34, [0.34, 0.46, 0.26], 0.52, 1.25, 0.55, 1.25)],
  bamboo: () => [-0.12, 0, 0.12, 0.05, -0.06].flatMap((x, n) => [part(new THREE.CylinderGeometry(0.025, 0.03, 0.9 + n * 0.05, 5), [0.5, 0.7, 0.3], 0.45, 1, 1, 1, x, (n % 3 - 1) * 0.08), part(new THREE.ConeGeometry(0.1, 0.25, 5), [0.36, 0.62, 0.26], 0.88, 1, 1, 1, x, (n % 3 - 1) * 0.08)]),
  autumn: () => [trunk(0.35, 0.06), ico(0.3, [0.86, 0.42, 0.14], 0.55), ico(0.21, [0.94, 0.62, 0.2], 0.74, 1, 1, 1, 0.1, 0.05), ico(0.15, [0.75, 0.22, 0.12], 0.62, 1, 1, 1, -0.16, -0.05)],
  blossom: () => [trunk(0.34, 0.055, [0.35, 0.24, 0.22]), ico(0.3, [0.98, 0.7, 0.82], 0.56, 1.1, 0.85, 1.1), ico(0.2, [1, 0.84, 0.9], 0.74, 1, 1, 1, 0.1, 0.05)],
  dead: () => [trunk(0.55, 0.05, [0.4, 0.36, 0.32]), part(new THREE.CylinderGeometry(0.015, 0.025, 0.3, 4), [0.4, 0.36, 0.32], 0.45, 1, 1, 1, 0.08, 0, 0, -0.8), part(new THREE.CylinderGeometry(0.015, 0.025, 0.25, 4), [0.4, 0.36, 0.32], 0.38, 1, 1, 1, -0.07, 0, 0, 0.9)],
  crystal: () => [part(new THREE.OctahedronGeometry(0.12, 0), [0.62, 0.5, 1], 0.32, 0.8, 3, 0.8), part(new THREE.OctahedronGeometry(0.08, 0), [0.45, 0.85, 1], 0.22, 0.8, 2.6, 0.8, 0.14, 0.05, 0, -0.4), part(new THREE.OctahedronGeometry(0.07, 0), [0.85, 0.55, 1], 0.18, 0.8, 2.4, 0.8, -0.12, -0.04, 0, 0.5)],
  reeds: () => [-0.1, 0, 0.1, -0.05, 0.06].map((x, n) => part(new THREE.ConeGeometry(0.025, 0.5 + n * 0.06, 4), n % 2 ? [0.62, 0.66, 0.3] : [0.46, 0.58, 0.26], 0.25 + n * 0.03, 1, 1, 1, x, (n % 3 - 1) * 0.07)),
  mangrove: () => [part(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 4), BARK, 0.13, 1, 1, 1, -0.1, 0, 0, -0.4), part(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 4), BARK, 0.13, 1, 1, 1, 0.1, 0, 0, 0.4), trunk(0.35, 0.05), ico(0.32, [0.24, 0.46, 0.26], 0.48, 1.3, 0.55, 1.3)],
  palm: () => [part(new THREE.CylinderGeometry(0.035, 0.05, 0.7, 5), [0.55, 0.42, 0.28], 0.35, 1, 1, 1, 0.05, 0, 0, -0.12),
    ...[0, 1.26, 2.51, 3.77, 5.03].map((a) => { const g = part(new THREE.ConeGeometry(0.06, 0.4, 3), [0.3, 0.6, 0.24], 0, 1, 1, 0.3); g.rotateZ(-1.25); g.rotateY(a); g.translate(0.08, 0.7, 0); return g })],
}
const treeGeometry = (kind: string) => merged(TREES[kind]())

function instanced(base: THREE.BufferGeometry, attrs: Record<string, [Float32Array, number]>, count: number) {
  const g = new THREE.InstancedBufferGeometry()
  for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k])
  if (base.index) g.setIndex(base.index)
  for (const [k, [a, n]] of Object.entries(attrs)) g.setAttribute(k, new THREE.InstancedBufferAttribute(a, n))
  g.instanceCount = count
  return g
}
// Trees: [x, y, scale, yaw, shade] -> iA (vec4) + iB (float), sharing one buffer.
function treeInstances(base: THREE.BufferGeometry, data: Float32Array) {
  const g = new THREE.InstancedBufferGeometry()
  for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k])
  const buf = new THREE.InstancedInterleavedBuffer(data, 5)
  g.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0)); g.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 1, 4))
  g.instanceCount = data.length / 5
  return g
}
// One terrain tile: a grid over 0..1 plus a skirt (z = 1) around its edge.
function tileGeometry() {
  const n = TILE, pos: number[] = [], idx: number[] = []
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(i / n, j / n, 0)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, b, c, b, d, c) }
  const ring: number[] = []
  for (let i = 0; i < n; i++) ring.push(i)
  for (let j = 0; j < n; j++) ring.push(j * (n + 1) + n)
  for (let i = n; i > 0; i--) ring.push(n * (n + 1) + i)
  for (let j = n; j > 0; j--) ring.push(j * (n + 1))
  const base = pos.length / 3
  for (const v of ring) pos.push(pos[v * 3], pos[v * 3 + 1], 1)
  for (let q = 0; q < ring.length; q++) { const a = ring[q], b = ring[(q + 1) % ring.length], c = base + q, d = base + (q + 1) % ring.length; idx.push(a, c, b, b, c, d, a, b, c, b, d, c) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx)
  return g
}

const SUNS: Record<Exclude<Light, 'cycle'>, { az: number; el: number; sun: C3; amb: C3; night: number; golden: number; mist: number }> = {
  day: { az: -0.75, el: 0.85, sun: [1.07, 1.03, 0.96], amb: [0.66, 0.62, 0.76], night: 0, golden: 0, mist: 0.25 },
  golden: { az: -1.35, el: 0.24, sun: [1.3, 0.98, 0.72], amb: [0.6, 0.52, 0.68], night: 0, golden: 1, mist: 0.9 },
  night: { az: 0.9, el: 0.75, sun: [0.42, 0.5, 0.78], amb: [0.16, 0.2, 0.36], night: 1, golden: 0, mist: 0.5 },
}
const smooth01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t) }

export class MapScene {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(40, 1, 1, 10000)
  controls: MapControls
  private u = uniforms()
  private rt: THREE.WebGLRenderTarget
  private shadowRT = new THREE.WebGLRenderTarget(1, 1)
  private shadowMat?: THREE.ShaderMaterial
  private shadowKey = ''
  private post = finalMat()
  private quad: THREE.Mesh
  private world = new THREE.Group()
  private terrain?: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private tiles = new Float32Array(4096 * 3)
  private nearTrees: { mesh: THREE.Mesh; bucket: number }[] = []
  private clouds: { mesh: THREE.Mesh; x: number; z: number; r: number }[] = []
  private props: { obj: THREE.Object3D; ground: number; float: number; bob: number }[] = []
  private ships: { obj: THREE.Object3D; x: number; y: number; a: number; v: number }[] = []
  private birds?: THREE.Mesh
  private storm?: { pts: Float32Array; next: number; bolt: THREE.LineSegments }
  private cloudAlt = 0
  private edgeMist: number[][] = []
  private built?: Built
  private clock = new THREE.Clock()
  private fly?: { from: THREE.Vector3; to: THREE.Vector3; dfrom: number; dto: number; t: number }
  private spin?: { from: number; to: number; t: number }
  private keys = new Set<string>()
  private fill: THREE.CanvasTexture
  private fillU: THREE.IUniform
  private pv = new THREE.Matrix4()
  private treeK = { value: 1 }
  private nearK = { value: 0.55 }
  raf = 0
  showClouds = true
  showLife = true
  light: Light = 'day'
  style: Style = 'toon'
  night = 0 // 0..1, read by the page (city lights)
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
    this.fillU = { value: this.fill }
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
    for (const o of [...this.world.children]) { this.world.remove(o); o.traverse((m) => { if (m instanceof THREE.Mesh || m instanceof THREE.LineSegments) { m.geometry.dispose(); (m.material as THREE.Material).dispose() } }) }
    for (const t of [this.u.tHeight.value, this.u.tRough.value]) t?.dispose()
    this.clouds = []; this.props = []; this.ships = []; this.nearTrees = []; this.edgeMist = []; this.birds = undefined; this.storm = undefined; this.shadowKey = ''
    const g = b.gen, e = g.exag / 1000, u = this.u, size = Math.max(g.W, g.H), r = rng(hash(b.seed) ^ 0x51ed)
    u.uDiscR.value = g.disc ? g.W / 2 : 0
    u.uSize.value.set(g.W, g.H); u.uGrid.value.set(g.w, g.h); u.uE.value = e

    const tex = (data: Float32Array | Uint8Array, fmt: THREE.PixelFormat, type: THREE.TextureDataType = THREE.UnsignedByteType, filter: THREE.MagnificationTextureFilter = THREE.LinearFilter) => {
      const t = new THREE.DataTexture(data, g.w, g.h, fmt, type)
      t.magFilter = filter; t.minFilter = filter; t.needsUpdate = true
      return t
    }
    u.tHeight.value = tex(g.height, THREE.RedFormat, THREE.FloatType, THREE.NearestFilter)
    u.tRough.value = tex(g.rough, THREE.RedFormat)
    const data = tex(g.data, THREE.RGBAFormat)
    this.shadowRT.setSize(Math.ceil(g.w / 2), Math.ceil(g.h / 2))
    this.shadowRT.texture.minFilter = this.shadowRT.texture.magFilter = THREE.LinearFilter
    this.shadowMat?.dispose()
    this.shadowMat = shadowMat(u, g.cell * 2)

    // ground: instanced tiles, chosen per frame
    const tg = new THREE.InstancedBufferGeometry(), base = tileGeometry()
    tg.setAttribute('position', base.attributes.position); tg.setIndex(base.index)
    tg.setAttribute('iTile', new THREE.InstancedBufferAttribute(this.tiles, 3).setUsage(THREE.DynamicDrawUsage))
    tg.instanceCount = 0
    this.terrain = new THREE.Mesh(tg, terrainMat(u, { color: tex(g.rgba, THREE.RGBAFormat), data, shadow: this.shadowRT.texture, fill: this.fillU }))
    this.terrain.frustumCulled = false
    this.world.add(this.terrain)

    // sea, and a surface for each lake at its own level
    const addWater = (geo: THREE.BufferGeometry, level: number, lake: boolean) => {
      geo.rotateX(-Math.PI / 2)
      const m = waterMat(u, data, level, lake)
      m.uniforms.uNW.value = Math.min(MAX_WHIRLS, g.whirls.length)
      g.whirls.slice(0, MAX_WHIRLS).forEach((w, n) => (m.uniforms.uWhirls.value as THREE.Vector4[])[n].set(w.at[0], w.at[1], w.r, 0))
      const mesh = new THREE.Mesh(geo, m); mesh.renderOrder = 2; mesh.frustumCulled = false; this.world.add(mesh)
    }
    addWater(g.disc ? new THREE.CircleGeometry(g.W / 2, 256) : new THREE.PlaneGeometry(g.W, g.H), 0, false)
    for (const l of g.lakes) {
      const geo = new THREE.PlaneGeometry(l.box[2] - l.box[0], l.box[3] - l.box[1])
      geo.translate((l.box[0] + l.box[2]) / 2, (l.box[1] + l.box[3]) / 2, 0)
      addWater(geo, l.level, true)
    }

    // the cut edge, and the sea falling off it
    const wall = new THREE.BufferGeometry()
    wall.setAttribute('position', new THREE.BufferAttribute(b.wall.pos, 3))
    wall.setAttribute('ground', new THREE.BufferAttribute(b.wall.ground, 1))
    wall.setIndex(new THREE.BufferAttribute(b.wall.index, 1))
    this.world.add(new THREE.Mesh(wall, wallMat(u, g.W, g.H)))
    if (g.edge === 'waterfall') {
      const pos: number[] = [], fall: number[] = [], idx: number[] = [], drop = -b.wall.bottom * 2.2, ring = b.wall.ring
      let along = 0
      for (const [n, [x, y]] of ring.entries()) {
        const l = Math.hypot(x, y) || 1, ox = g.disc ? x / l : Math.abs(x) > g.W / 2 * 0.99 ? Math.sign(x) : 0, oy = g.disc ? y / l : ox ? 0 : Math.sign(y)
        if (n) along += Math.hypot(x - ring[n - 1][0], y - ring[n - 1][1])
        for (let s = 0; s <= 6; s++) { const t = s / 6, out = 0.2 + drop * (0.07 * Math.sqrt(t) + 0.18 * t * t); pos.push(x + ox * out, -t * drop, -(y + oy * out)); fall.push(along, t) } // spills outward over a lip, then falls
        if (n && b.wall.ground[n * 2] < 0 && b.wall.ground[(n - 1) * 2] < 0) for (let s = 0; s < 6; s++) { const a = (n - 1) * 7 + s, c = n * 7 + s; idx.push(a, c, a + 1, a + 1, c, c + 1) }
      }
      const fg = new THREE.BufferGeometry()
      fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('fall', new THREE.Float32BufferAttribute(fall, 2)); fg.setIndex(idx)
      const m = new THREE.Mesh(fg, fallMat(u)); m.renderOrder = 3; m.frustumCulled = false; this.world.add(m)
      this.edgeMist = ring.filter((_, n) => n % 6 === 0 && b.wall.ground[n * 2] < 0).map(([x, y]) => { const l = Math.hypot(x, y) || 1, k = g.disc ? 1 + drop * 0.17 / l : 1; return [x * k, y * k, -drop * 0.62 / e] })
    }

    // rivers: ribbons on the carved channel, wider than life; white water where they drop
    const rp: number[] = [], ruv: number[] = [], rs: number[] = [], ri: number[] = []
    for (const rv of g.rivers) {
      let along = 0
      const start = rp.length / 3
      for (let n = 0; n < rv.pts.length; n++) {
        const [x, y] = rv.pts[n], a = rv.pts[Math.max(0, n - 1)], c = rv.pts[Math.min(rv.pts.length - 1, n + 1)]
        let tx = c[0] - a[0], ty = c[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l
        const hw = Math.max(rv.width[n] * 1.5, g.cell * (rv.minor ? 0.6 : 1.1)), yy = rv.ch[n] + 8
        const drop = n ? Math.max(0, rv.ch[n - 1] - rv.ch[n]) / Math.max(1, Math.hypot(x - a[0], y - a[1])) / 60 : 0
        if (n) along += Math.hypot(x - rv.pts[n - 1][0], y - rv.pts[n - 1][1])
        rp.push(x - ty * hw, yy, -(y + tx * hw), x + ty * hw, yy, -(y - tx * hw))
        ruv.push(-1, along, 1, along); rs.push(drop, drop)
        if (n) { const q = start + (n - 1) * 2; ri.push(q, q + 1, q + 2, q + 2, q + 1, q + 3) }
      }
    }
    if (ri.length) {
      const rg = new THREE.BufferGeometry()
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2)); rg.setAttribute('steep', new THREE.Float32BufferAttribute(rs, 1)); rg.setIndex(ri)
      const m = new THREE.Mesh(rg, riverMat(u)); m.renderOrder = 1; m.frustumCulled = false
      this.world.add(m)
    }

    // trees: big ones everywhere, small dense ones only in buckets near the camera
    const sway: Record<string, number> = { cactus: 0, crystal: 0, reeds: 0.16, bamboo: 0.09, palm: 0.07 }
    for (const [n, kind] of TREE_KINDS.entries()) {
      const geo = treeGeometry(kind)
      if (b.trees.far[n].length) { const m = new THREE.Mesh(treeInstances(geo, b.trees.far[n]), treeMat(u, sway[kind] ?? 0.05, kind === 'crystal' ? 0.6 : 0, this.shadowRT.texture, this.treeK)); m.frustumCulled = false; this.world.add(m) }
      const near = b.trees.near.kinds[n], nmat = treeMat(u, sway[kind] ?? 0.05, kind === 'crystal' ? 0.6 : 0, this.shadowRT.texture, this.nearK)
      for (let q = 0; q + 1 < near.start.length; q++) {
        if (near.start[q + 1] === near.start[q]) continue
        const m = new THREE.Mesh(treeInstances(geo, near.data.subarray(near.start[q] * 5, near.start[q + 1] * 5)), nmat)
        m.frustumCulled = false; m.visible = false
        this.world.add(m); this.nearTrees.push({ mesh: m, bucket: q })
      }
    }

    // particles: volcano smoke, snow blowing off summits, spray under falls, and the zones
    const puffs = (kind: PuffKind, pts: number[][], per: number, sz: number, rise: number, color?: C3) => {
      if (!pts.length) return
      const iP = new Float32Array(pts.length * per * 4), iC = new Float32Array(pts.length * per * 3)
      pts.forEach((p, n) => { for (let q = 0; q < per; q++) { iP.set([p[0], p[1], p[2], (q + r()) / per], (n * per + q) * 4); iC.set(color ?? [1, 1, 1], (n * per + q) * 3) } })
      const m = new THREE.Mesh(instanced(new THREE.IcosahedronGeometry(1, kind === 'rain' || kind === 'mote' ? 0 : 1), { iP: [iP, 4], iC: [iC, 3] }, pts.length * per), puffMat(u, kind, sz, rise, this.treeK))
      m.frustumCulled = false; this.world.add(m)
    }
    puffs('smoke', g.vents.map((v) => [v.at[0], v.at[1], v.top * e]), 18, size * 0.006, size * 0.06)
    puffs('plume', g.summits.map((s) => [s[0], s[1], heightAt(g, ...s) * e]), 6, size * 0.0009, size * 0.012)
    puffs('spray', g.steam.map((p) => [p[0], p[1], heightAt(g, ...p) * e]), 8, size * 0.0012, size * 0.01)
    puffs('spray', g.falls.map((f) => [f.at[0], f.at[1], (f.bottom + 20) * e]), 10, g.cell * 0.5, g.cell * 2.5)
    if (this.edgeMist.length) puffs('spray', this.edgeMist.map((p) => [p[0], p[1], p[2] * e]), 4, size * 0.006, size * 0.01)
    for (const z of g.zones) {
      const pts: number[][] = []
      for (let q = 0; q < z.pts.length; q += 3) pts.push([z.pts[q], z.pts[q + 1], z.pts[q + 2] * e])
      if (z.kind === 'magic') puffs('mote', pts, 2, size * 0.0005, size * 0.02, z.color.map((c) => c / 255) as C3)
      if (z.kind === 'blizzard') puffs('snow', pts, 3, size * 0.0004, size * 0.03)
      if (z.kind === 'storm') {
        const alt = g.maxH * e * 0.9 + size * 0.01
        puffs('rain', pts, 2, size * 0.00028, alt * 0.85)
        const cm = cloudMat(u, true)
        for (let q = 0; q < pts.length; q += 6) { const m = this.cloudMesh(r, size * (0.014 + r() * 0.01), cm, pts[q][0], alt, -pts[q][1]); this.world.add(m); this.props.push({ obj: m, ground: 0, float: alt, bob: 0 }) }
        const bolt = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf2f6ff }))
        bolt.visible = false; bolt.frustumCulled = false; this.world.add(bolt)
        this.storm = { pts: z.pts, next: 2, bolt }
      }
    }

    // props: floating islands, giant trees, arches
    for (const p of g.props) {
      const s = p.radius, obj = new THREE.Group()
      if (p.kind === 'floating') {
        const rock = new THREE.ConeGeometry(s, s * 1.8, 9, 3), pa = rock.attributes.position
        for (let q = 0; q < pa.count; q++) { const k = 0.8 + 0.4 * r(); if (pa.getY(q) < s * 0.85) pa.setXYZ(q, pa.getX(q) * k, pa.getY(q), pa.getZ(q) * k) }
        const parts = [part(rock, [0.48, 0.4, 0.34], -s * 0.9, 1, 1, 1, 0, 0, Math.PI), part(new THREE.CylinderGeometry(s * 1.02, s * 0.98, s * 0.15, 12), [0.42, 0.66, 0.3], 0.02)]
        for (let q = 0; q < 7; q++) { const a = q * 2.4, rr = s * 0.55 * Math.sqrt((q + 0.5) / 7), t = treeGeometry(q % 2 ? 'pine' : 'broad'); t.scale(s * 0.45, s * 0.45, s * 0.45); t.translate(Math.cos(a) * rr, s * 0.08, Math.sin(a) * rr); parts.push(t) }
        obj.add(new THREE.Mesh(merged(parts), solidMat(u)))
        const fallGeo = new THREE.PlaneGeometry(s * 0.18, s * 2.4, 1, 8)
        fallGeo.translate(s * 0.9, -s * 1.1, 0)
        const fp = fallGeo.attributes.position, fa = new Float32Array(fp.count * 2)
        for (let q = 0; q < fp.count; q++) { fa[q * 2] = fp.getX(q); fa[q * 2 + 1] = (s * 0.1 - fp.getY(q)) / (s * 2.4) }
        fallGeo.setAttribute('fall', new THREE.BufferAttribute(fa, 2))
        obj.add(new THREE.Mesh(fallGeo, fallMat(u)))
        this.props.push({ obj, ground: p.ground * e, float: p.height * e, bob: s * 0.15 })
      } else if (p.kind === 'gianttree') {
        const tall = p.height * e, parts = [part(new THREE.CylinderGeometry(s * 0.35, s * 0.7, tall * 0.7, 9), [0.4, 0.28, 0.2], tall * 0.35)]
        for (let q = 0; q < 6; q++) { const a = q * 1.05; parts.push(part(new THREE.CylinderGeometry(s * 0.08, s * 0.2, s * 1.6, 5), [0.4, 0.28, 0.2], s * 0.15, 1, 1, 1, Math.cos(a) * s * 0.7, Math.sin(a) * s * 0.7, Math.sin(a) * 0.9, -Math.cos(a) * 0.9)) }
        for (let q = 0; q < 9; q++) { const a = q * 2.1, rr = q ? s * 2.2 : 0; parts.push(part(new THREE.IcosahedronGeometry(s * (q ? 1.5 : 2.2), 1), q % 3 ? [0.3, 0.6, 0.32] : [0.4, 0.7, 0.36], tall * (0.78 + 0.08 * (q % 3)), 1, 0.7, 1, Math.cos(a) * rr, Math.sin(a) * rr)) }
        obj.add(new THREE.Mesh(merged(parts), solidMat(u, 0.04)))
        this.props.push({ obj, ground: p.ground * e, float: 0, bob: 0 })
      } else {
        const g2 = part(new THREE.TorusGeometry(s, s * 0.22, 7, 16, Math.PI), [0.62, 0.46, 0.36], 0)
        g2.rotateY(p.angle)
        obj.add(new THREE.Mesh(merged([g2]), solidMat(u)))
        this.props.push({ obj, ground: p.ground * e - s * 0.1, float: 0, bob: 0 })
      }
      obj.position.set(p.at[0], 0, -p.at[1])
      this.world.add(obj)
    }

    // ships sailing the deep water
    const hull = merged([part(new THREE.BoxGeometry(1, 0.22, 0.32), [0.45, 0.3, 0.2], 0.05), part(new THREE.ConeGeometry(0.16, 0.35, 4), [0.45, 0.3, 0.2], 0.05, 1, 0.6, 1, 0.65, 0, 0, -Math.PI / 2), part(new THREE.ConeGeometry(0.28, 0.75, 3), [0.96, 0.94, 0.88], 0.55, 0.15, 1, 1.2)])
    const shipMat = solidMat(u)
    for (let q = 0, tries = 0; q < 14 && tries < 400; tries++) {
      const x = (r() - 0.5) * g.W, y = (r() - 0.5) * g.H
      if (heightAt(g, x, y) > -300 || (g.disc && Math.hypot(x, y) > g.W / 2 * 0.9)) continue
      const m = new THREE.Mesh(hull, shipMat); m.frustumCulled = false; this.world.add(m)
      this.ships.push({ obj: m, x, y, a: r() * Math.PI * 2, v: size * (0.0016 + r() * 0.001) })
      q++
    }
    // birds circling over a few coasts
    const flocks: THREE.Vector4[] = []
    for (let q = 0; q < MAX_FLOCKS && g.snaps.length; q++) {
      const k = Math.floor(r() * g.snaps.length / 2) * 2
      flocks.push(new THREE.Vector4(g.snaps[k], g.snaps[k + 1], size * (0.01 + r() * 0.015), (300 + r() * 600) * e + size * 0.004))
    }
    if (flocks.length) {
      const per = 7, iB = new Float32Array(flocks.length * per * 4)
      for (let f = 0; f < flocks.length; f++) for (let q = 0; q < per; q++) { const row = Math.ceil(q / 2); iB.set([f, -row * 1.2, (q % 2 ? 1 : -1) * row * 1.1, r()], (f * per + q) * 4) }
      const v = new THREE.BufferGeometry()
      v.setAttribute('position', new THREE.Float32BufferAttribute([0.3, 0, 0, -0.4, 0, -1, -0.1, 0, 0, 0.3, 0, 0, -0.1, 0, 0, -0.4, 0, 1], 3))
      const bm = birdMat(u, size * 0.0012)
      flocks.forEach((f, n) => (bm.uniforms.uFlocks.value as THREE.Vector4[])[n].copy(f))
      this.birds = new THREE.Mesh(instanced(v, { iB: [iB, 4] }, flocks.length * per), bm)
      this.birds.frustumCulled = false
      this.world.add(this.birds)
    }

    // clouds: puffy clusters drifting with the wind; their shadows are drawn by every ground shader
    this.cloudAlt = g.maxH * e * 1.25 + size * 0.012
    const n = Math.min(MAX_CLOUDS, Math.max(6, Math.round(g.W * g.H / (size * 0.22) ** 2)))
    const cm = cloudMat(u, false)
    for (let q = 0; q < n; q++) {
      const rad = size * (0.012 + r() * 0.012), x = (r() - 0.5) * g.W, z = (r() - 0.5) * g.H
      const mesh = this.cloudMesh(r, rad, cm, x, this.cloudAlt, z)
      this.world.add(mesh)
      this.clouds.push({ mesh, x, z, r: rad })
    }

    if (first) this.frame()
  }

  private cloudMesh(r: () => number, rad: number, mat: THREE.Material, x: number, y: number, z: number) {
    const parts: THREE.BufferGeometry[] = [], k = 4 + Math.floor(r() * 4)
    for (let p = 0; p < k; p++) {
      const s = 0.45 + r() * 0.55, gg = new THREE.IcosahedronGeometry(s, 1)
      gg.translate((p / (k - 1) - 0.5) * 2.2 + (r() - 0.5) * 0.4, s * 0.35 + (r() - 0.5) * 0.2, (r() - 0.5) * 0.8)
      parts.push(gg)
    }
    const geo = mergeGeometries(parts)
    geo.scale(1, 0.62, 1)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.setScalar(rad); mesh.rotation.y = r() * Math.PI; mesh.position.set(x, y, z)
    return mesh
  }

  /** Whole map in view, from the south, tilted. */
  frame() {
    const g = this.built?.gen
    if (!g) return
    const s = Math.max(g.W, g.H / this.camera.aspect * 1.3)
    this.controls.target.set(0, 0, 0)
    this.camera.position.set(0, s * 0.78, s * 0.78)
    this.controls.minDistance = g.cell * 1.5
    this.controls.maxDistance = s * 2.2
    this.controls.update()
  }

  /** Region fills: a map-sized canvas (row 0 = north), draped on the land. */
  setFill(c: HTMLCanvasElement) {
    this.fill.dispose()
    this.fill = new THREE.CanvasTexture(c)
    this.fill.flipY = false
    this.fill.colorSpace = THREE.NoColorSpace
    this.fillU.value = this.fill
  }

  /** Display height (km) of a map point on the drawn ground. */
  groundY(x: number, y: number) { return Math.max(0, surfaceAt(this.built!.gen, x, y)) * this.u.uE.value * this.u.uHScale.value }

  /** CSS pixel position of a map point on the ground (undefined behind the camera). */
  proj = (x: number, y: number): [number, number] | undefined => {
    if (!this.built) return
    const e = this.pv.elements, z = -y, hy = this.groundY(x, y)
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
    this.fly = { from: this.controls.target.clone(), to: new THREE.Vector3(x, this.groundY(x, y), -y), dfrom: d, dto: dist ?? Math.min(d, Math.max(g.W, g.H) * 0.25), t: 0 }
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

  /** Where a screen point hits the ground: ray-march the drawn surface, then refine. */
  pick(cx: number, cy: number) {
    const g = this.built?.gen
    if (!g) return
    const r = this.canvas.getBoundingClientRect(), ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera)
    const o = ray.ray.origin, d = ray.ray.direction
    const below = (t: number) => { const x = o.x + d.x * t, z = o.z + d.z * t; return Math.abs(x) <= g.W / 2 && Math.abs(z) <= g.H / 2 && o.y + d.y * t <= this.groundY(x, -z) }
    const dist = this.camera.position.distanceTo(this.controls.target), step = Math.min(g.cell * 0.5, dist * 0.004)
    let prev = 0
    for (let t = 0; t < this.camera.far; t += step * Math.max(1, t / (dist * 0.25))) {
      if (below(t)) {
        let a = prev, b = t
        for (let q = 0; q < 10; q++) { const m = (a + b) / 2; if (below(m)) b = m; else a = m }
        return o.clone().addScaledVector(d, b)
      }
      prev = t
    }
  }

  private onDbl = (ev: MouseEvent) => {
    if (!this.dblFly) return
    const p = this.pick(ev.clientX, ev.clientY)
    if (!p) return
    const d = this.camera.position.distanceTo(this.controls.target)
    this.fly = { from: this.controls.target.clone(), to: p, dfrom: d, dto: Math.max(this.controls.minDistance, d * 0.35), t: 0 }
  }

  // Quadtree of ground tiles: split where the camera is close, down to 1/512 of the map.
  private updateTiles(g: Gen) {
    const cam = this.camera.position, out = this.tiles
    let n = 0
    const visit = (cx: number, cy: number, s: number, depth: number) => {
      if (cx + s / 2 < -g.W / 2 || cx - s / 2 > g.W / 2 || cy + s / 2 < -g.H / 2 || cy - s / 2 > g.H / 2) return
      if (g.disc && Math.hypot(cx, cy) - s * 0.71 > g.W / 2) return
      const dx = Math.max(0, Math.abs(cam.x - cx) - s / 2), dy = Math.max(0, Math.abs(-cam.z - cy) - s / 2), d = Math.hypot(dx, dy, cam.y)
      if (depth < 9 && d < s * 1.7) { const q = s / 4; visit(cx - q, cy - q, s / 2, depth + 1); visit(cx + q, cy - q, s / 2, depth + 1); visit(cx - q, cy + q, s / 2, depth + 1); visit(cx + q, cy + q, s / 2, depth + 1) }
      else if (n < 4096) { out[n * 3] = cx - s / 2; out[n * 3 + 1] = cy - s / 2; out[n * 3 + 2] = s; n++ }
    }
    visit(0, 0, Math.max(g.W, g.H), 0)
    const geo = this.terrain!.geometry
    geo.instanceCount = n
    const attr = geo.attributes.iTile as THREE.InstancedBufferAttribute
    attr.clearUpdateRanges(); attr.addUpdateRange(0, n * 3); attr.needsUpdate = true
  }

  private setLight(t: number) {
    let L = SUNS[this.light === 'cycle' ? 'day' : this.light]
    if (this.light === 'cycle') { // a slow loop: day, golden, night, night, golden (dawn), day
      const keys = [SUNS.day, SUNS.golden, SUNS.night, SUNS.night, SUNS.golden, SUNS.day], f = (t / 120) % 1 * (keys.length - 1)
      const a = keys[Math.floor(f)], b = keys[Math.min(keys.length - 1, Math.floor(f) + 1)], k = f - Math.floor(f)
      const m = (p: number, q: number) => p + (q - p) * k, mc = (p: C3, q: C3) => p.map((v, i) => m(v, q[i])) as C3
      L = { az: m(a.az, b.az), el: m(a.el, b.el), sun: mc(a.sun, b.sun), amb: mc(a.amb, b.amb), night: m(a.night, b.night), golden: m(a.golden, b.golden), mist: m(a.mist, b.mist) }
    }
    this.u.uSun.value.set(Math.sin(L.az) * Math.cos(L.el), Math.sin(L.el), -Math.cos(L.az) * Math.cos(L.el)).normalize()
    this.u.uSunCol.value.set(...L.sun); this.u.uAmb.value.set(...L.amb); this.u.uNight.value = L.night
    this.post.uniforms.uNight.value = L.night; this.post.uniforms.uGolden.value = L.golden
    if (this.terrain) this.terrain.material.uniforms.uMist.value = L.mist
    this.night = L.night
  }

  loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, this.clock.getDelta()), t = this.clock.elapsedTime
    const g = this.built?.gen
    this.u.uTime.value = t; this.post.uniforms.uTime.value = t
    this.post.uniforms.uStyle.value = Object.keys(STYLES).indexOf(this.style)
    this.setLight(t)
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
    if (g) {
      const size = Math.max(g.W, g.H), e = g.exag / 1000
      // keep the view over the map
      const c = this.controls.target, lim = (v: number, m: number) => Math.max(-m, Math.min(m, v))
      const dx = lim(c.x, g.W / 2) - c.x, dz = lim(c.z, g.H / 2) - c.z
      if (dx || dz) { c.x += dx; c.z += dz; this.camera.position.x += dx; this.camera.position.z += dz }
      // the scale eases: full exaggeration from far away, 40% of it on the ground; trees shrink as you come close
      const near = 1 - smooth01((dist - size * 0.02) / (size * 0.28))
      const hs = 1 - 0.6 * near
      this.u.uHScale.value = hs
      this.treeK.value = 1 - 0.6 * near
      // ground tiles and nearby small trees
      this.updateTiles(g)
      const nb = this.built!.trees.near, bw = g.W / nb.bx, bh = g.H / nb.by, showNear = dist < size * 0.12
      for (const nt of this.nearTrees) {
        const bx = -g.W / 2 + (nt.bucket % nb.bx + 0.5) * bw, by = g.H / 2 - (Math.floor(nt.bucket / nb.bx) + 0.5) * bh
        nt.mesh.visible = showNear && Math.hypot(bx - c.x, by + c.z) < dist * 1.6 + bw
      }
      // shadows follow the light and the height scale
      const key = `${this.u.uSun.value.toArray().map((v) => v.toFixed(2))}|${hs.toFixed(2)}`
      if (key !== this.shadowKey && this.shadowMat) {
        this.shadowKey = key
        this.quad.material = this.shadowMat
        this.renderer.setRenderTarget(this.shadowRT); this.renderer.render(this.quad, this.camera)
        this.quad.material = this.post
      }
      // clouds drift and wrap; only at continent scale, never in the way up close
      const wind = size * 0.0035, show = this.showClouds && this.camera.position.y > this.cloudAlt * 1.25 && dist > size * 0.45, sun = this.u.uSun.value
      let nc = 0
      for (const cl of this.clouds) {
        cl.x += wind * dt; cl.z += wind * 0.35 * dt
        if (cl.x > g.W / 2 + cl.r * 2) cl.x -= g.W + cl.r * 4
        if (cl.z > g.H / 2 + cl.r * 2) cl.z -= g.H + cl.r * 4
        cl.mesh.position.set(cl.x, this.cloudAlt, cl.z)
        cl.mesh.visible = show
        if (show && nc < MAX_CLOUDS && sun.y > 0.1) this.u.uClouds.value[nc++].set(cl.x - sun.x / sun.y * this.cloudAlt, -(cl.z - sun.z / sun.y * this.cloudAlt), cl.r * 1.5, 0)
      }
      this.u.uNC.value = nc
      // props bob and follow the height scale
      for (const p of this.props) { p.obj.position.y = (p.ground + p.float) * hs + Math.sin(t * 0.6 + p.obj.position.x) * p.bob; if (!p.float) p.obj.scale.y = hs }
      // ships sail on, turning away from shallow water
      const sk = Math.max(g.cell * 3, size * 0.006) * (0.4 + 0.6 * this.treeK.value)
      for (const s of this.ships) {
        s.obj.visible = this.showLife
        const ahead = heightAt(g, s.x + Math.cos(s.a) * s.v * 6, s.y + Math.sin(s.a) * s.v * 6)
        if (ahead > -150 || (g.disc && Math.hypot(s.x, s.y) > g.W / 2 * 0.9)) s.a += 1.5 * dt; else s.a += Math.sin(t * 0.1 + s.v) * 0.05 * dt
        s.x += Math.cos(s.a) * s.v * dt; s.y += Math.sin(s.a) * s.v * dt
        s.obj.position.set(s.x, 0.02 * sk, -s.y); s.obj.rotation.set(Math.sin(t * 1.3 + s.x) * 0.08, s.a, Math.sin(t + s.y) * 0.05); s.obj.scale.setScalar(sk)
      }
      if (this.birds) this.birds.visible = this.showLife && dist < size * 0.35
      // lightning in storms
      const st = this.storm
      if (st) {
        st.next -= dt
        let flash = Math.max(0, this.u.uFlash.value - dt * 4)
        if (st.next <= 0 && st.pts.length) {
          st.next = 1.5 + Math.random() * 4
          const q = Math.floor(Math.random() * st.pts.length / 3) * 3, x = st.pts[q], y = st.pts[q + 1], top = (g.maxH * e * 0.9 + size * 0.01) * hs, bot = st.pts[q + 2] * e * hs
          const pts: number[] = []
          let px = x, py = top, pz = -y
          for (let s = 1; s <= 8; s++) { const nx = x + (Math.random() - 0.5) * size * 0.01, ny = top + (bot - top) * s / 8, nz = -y + (Math.random() - 0.5) * size * 0.01; pts.push(px, py, pz, nx, ny, nz); px = nx; py = ny; pz = nz }
          st.bolt.geometry.dispose(); st.bolt.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
          flash = 1
        }
        st.bolt.visible = flash > 0.6
        this.u.uFlash.value = flash
      }
    }
    this.camera.near = Math.max(0.01, dist * 0.004)
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
    this.world.traverse((m) => { if (m instanceof THREE.Mesh || m instanceof THREE.LineSegments) { m.geometry.dispose(); (m.material as THREE.Material).dispose() } })
    this.shadowMat?.dispose(); this.shadowRT.dispose()
    this.rt.dispose()
    this.renderer.dispose()
  }
}
