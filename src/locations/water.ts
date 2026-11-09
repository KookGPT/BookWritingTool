// Locations water: one shader for lakes, canals, the sea and rivers. Colour by depth (read from the height grid),
// moving ripples, a real planar reflection of the mountains and town on the water level nearest the camera (the sky
// elsewhere), sun glitter, foam along shores and breaking waves on beaches, and white water where rivers run steep.
import * as THREE from 'three'
import { FOG, HEAD, U } from './shaders.ts'

export const WATER_U = {
  tHeight: { value: null as THREE.Texture | null }, uGrid: { value: new THREE.Vector2(1, 1) },
  tRefl: { value: null as THREE.Texture | null }, uReflMat: { value: new THREE.Matrix4() }, uReflLevel: { value: -1e9 }, uHasRefl: { value: 0 },
  /** metres one pixel covers per metre of distance (set on resize) */ uPxK: { value: 0.001 },
  uZenith: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uSunI: { value: 1 }, uAmb: { value: new THREE.Color() },
}
const V = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 flow; attribute vec2 across; uniform float uPxK;
varying vec3 vAtmoPos; varying vec2 vFlow; varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  // a river is never drawn narrower than about 1.5 pixels: far away it widens on screen (inside the opening the volume
  // ground keeps for water at every level of detail) instead of breaking into dashes; up close it keeps its true width
  float hw = length(across);
  if (hw > 0.0) w.xz += across / hw * max(0.0, 0.75 * uPxK * length(cameraPosition - w.xyz) - hw);
  vAtmoPos = w.xyz; vFlow = flow; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`
const F = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${HEAD}
uniform sampler2D tHeight; uniform vec2 uGrid; uniform sampler2D tRefl; uniform mat4 uReflMat; uniform float uReflLevel; uniform float uHasRefl;
uniform vec3 uZenith; uniform vec3 uSunCol; uniform float uSunI; uniform vec3 uAmb;
uniform vec3 uShallow; uniform vec3 uDeep; uniform float uMode; uniform float uWaves;
varying vec2 vFlow; varying vec3 vN;
float wv(vec2 p, float t) { return anoise(vec3(p, t)) * 0.6 + anoise(vec3(p * 2.3 + 7.1, t * 1.3)) * 0.4; }
void main() {
  #include <logdepthbuf_fragment>
  vec2 guv = (vAtmoPos.xz + uGrid.x * 0.5) / uGrid.x;
  bool inside = all(greaterThan(guv, vec2(0.0))) && all(lessThan(guv, vec2(1.0)));
  float ground = inside ? texture2D(tHeight, guv).r : vAtmoPos.y - 60.0;
  float depth = max(0.0, vAtmoPos.y - ground);
  float t = uTime;
  vec3 V = normalize(cameraPosition - vAtmoPos);
  float dist = length(cameraPosition - vAtmoPos), detail = 1.0 - smoothstep(400.0, 4000.0, dist);
  // ripples: the slope of moving noise; rivers stream along their length and churn where they are steep
  float steep = uMode > 0.5 ? 1.0 - smoothstep(0.3, 0.75, abs(normalize(vN).y)) : 0.0;
  vec2 p = uMode > 0.5 ? vec2(vFlow.x * 3.0, vFlow.y * 0.25 - t * (1.2 + steep * 5.0)) : vAtmoPos.xz * 0.08 + vec2(t * 0.05, t * 0.03);
  float e = 0.05, amp = (uMode > 0.5 ? 0.35 : mix(0.05, 0.16, uWaves)) * (0.25 + 0.75 * detail);
  float h0 = wv(p, t * 0.3), hx = wv(p + vec2(e, 0.0), t * 0.3), hz = wv(p + vec2(0.0, e), t * 0.3);
  vec2 sp = vAtmoPos.xz * 0.45 + vec2(t * 0.4, t * 0.25);
  float s0 = anoise(vec3(sp, t * 0.6)), sx = anoise(vec3(sp + vec2(e, 0.0), t * 0.6)), sz = anoise(vec3(sp + vec2(0.0, e), t * 0.6));
  vec3 n = normalize(vec3(-(hx - h0) / e * amp - (sx - s0) / e * 0.06 * detail, 1.0, -(hz - h0) / e * amp - (sz - s0) / e * 0.06 * detail));
  if (uMode > 0.5) n = normalize(mix(n, normalize(vN), steep));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 r = reflect(-V, n);
  vec3 refl = mix(uFogCol, uZenith, pow(max(r.y, 0.0), 0.5)) + uGlowCol * pow(max(dot(r, uSun), 0.0), 8.0) * 0.4;
  if (uHasRefl > 0.5 && abs(vAtmoPos.y - uReflLevel) < 0.8 && uMode < 0.5) {
    vec4 pc = uReflMat * vec4(vAtmoPos, 1.0);
    vec2 ruv = pc.xy / pc.w + n.xz * 0.035;
    refl = mix(refl, texture2D(tRefl, clamp(ruv, 0.001, 0.999)).rgb, smoothstep(0.0, 0.04, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)) + 0.02));
  }
  float light = uSunI * max(uSun.y, 0.05) * 0.5;
  vec3 body = mix(uShallow, uDeep, 1.0 - exp(-depth * (uMode > 0.5 ? 0.25 : 0.09))) * (uAmb + uSunCol * light);
  vec3 col = mix(body, refl, fres);
  col += uSunCol * uSunI * pow(max(dot(reflect(-uSun, n), V), 0.0), 380.0) * 3.0 * (1.0 - uNight);
  // foam: along shores, breaking waves on beaches, white water in steep rivers
  float fn = anoise(vec3(vAtmoPos.xz * 0.35, t * 0.5)) * 0.6 + anoise(vec3(vAtmoPos.xz * 1.3, t)) * 0.4;
  float shore = (1.0 - smoothstep(0.0, 1.4, depth)) * smoothstep(0.35, 0.7, fn) * (0.12 + 0.88 * uWaves); // surf on the sea; still water only laps
  float waves = uWaves * smoothstep(0.82, 0.97, sin(depth * 1.3 - t * 1.5 + fn * 4.0)) * (1.0 - smoothstep(1.0, 7.0, depth)) * smoothstep(0.2, 0.6, fn);
  // falling water: streaks along the fall (v is metres along the water, down the curtain too) sliding downward,
  // thin and see-through between them and at the curtain's edges
  float streak = anoise(vec3(vFlow.x * 11.0, vFlow.y * 0.07 - t * 2.2, 3.0)) * 0.65 + anoise(vec3(vFlow.x * 27.0, vFlow.y * 0.15 - t * 3.1, 9.0)) * 0.35;
  float fall = uMode > 0.5 ? smoothstep(0.55, 0.9, steep) : 0.0;
  float white = uMode > 0.5 ? clamp(mix(steep * (0.6 + fn * 0.6), 0.35 + streak * 0.75, fall) + smoothstep(0.62, 0.85, fn) * 0.35 * (1.0 - fall), 0.0, 1.0) : 0.0;
  col = mix(col, vec3(0.9, 0.93, 0.95) * (uAmb + uSunCol * light * 1.6), clamp(shore * 0.8 + waves * 0.75 + white, 0.0, 1.0));
  float alpha = uMode > 0.5 ? 0.92 + steep * 0.08 : smoothstep(0.0, 1.0, depth) * 0.95 + 0.05;
  alpha = max(alpha, max(shore, white));
  float edge = smoothstep(0.0, 0.2, vFlow.x) * smoothstep(1.0, 0.8, vFlow.x);
  alpha = mix(alpha, (0.5 + 0.5 * streak) * edge, fall);
  gl_FragColor = vec4(col, alpha);
  ${FOG}
}`
/** A water material: mode 0 still water (lakes, canals, sea), 1 rivers (needs the `flow` attribute). */
export function waterMaterial(mode: 0 | 1, shallow: string, deep: string, waves = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: V, fragmentShader: F, transparent: true, depthWrite: true, side: mode ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: { ...U, ...WATER_U, uShallow: { value: new THREE.Color(shallow) }, uDeep: { value: new THREE.Color(deep) }, uMode: { value: mode }, uWaves: { value: waves } },
  })
}
/** The height grid as a float texture, so water knows how deep it is. */
export function heightTexture(h: Float32Array, N: number) {
  const t = new THREE.DataTexture(h, N + 1, N + 1, THREE.RedFormat, THREE.FloatType)
  t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true
  return t
}

/** Renders the scene mirrored in a water plane into a half-size target, for the water shader to look up. */
export class Reflection {
  rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
  cam = new THREE.PerspectiveCamera()
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
  resize(w: number, h: number) { this.rt.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2))) }
  render(r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, level: number, hide: THREE.Object3D[]) {
    const c = this.cam
    c.fov = cam.fov; c.aspect = cam.aspect; c.near = cam.near; c.far = cam.far; c.updateProjectionMatrix()
    const pos = cam.position.clone(); pos.y = 2 * level - pos.y
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir); dir.y = -dir.y
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion); up.y = -up.y
    c.position.copy(pos); c.up.copy(up); c.lookAt(pos.clone().add(dir)); c.updateMatrixWorld()
    WATER_U.uReflMat.value.multiplyMatrices(this.bias, c.projectionMatrix).multiply(c.matrixWorldInverse)
    WATER_U.uReflLevel.value = level; WATER_U.tRefl.value = this.rt.texture; WATER_U.uHasRefl.value = 1
    this.plane.constant = -(level - 0.4)
    const vis = hide.map((o) => o.visible)
    hide.forEach((o) => { o.visible = false })
    const old = r.getRenderTarget(), clip = r.clippingPlanes, auto = r.shadowMap.autoUpdate
    r.clippingPlanes = [this.plane]; r.shadowMap.autoUpdate = false
    r.setRenderTarget(this.rt); r.clear(); r.render(scene, c)
    r.setRenderTarget(old); r.clippingPlanes = clip; r.shadowMap.autoUpdate = auto
    hide.forEach((o, i) => { o.visible = vis[i] })
  }
}
