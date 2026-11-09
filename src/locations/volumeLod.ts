// The volume ground's levels of detail: a quadtree over the place. Every square is meshed with the same number of
// cubes, so a square twice as big has cubes twice as coarse; a square splits into four when the camera is within a few
// of its widths. Squares are meshed on demand in workers, nearest first, and a square is only replaced by its four
// children once all four are ready (until then it stays), so there are no holes while flying. Squares overlap their
// neighbours by a cube, which hides the cracks where sizes meet. Squares not needed for a while are let go.
import * as THREE from 'three'
import type { CityBuilt } from './city.ts'
import type { VolumeChunk } from './volume.ts'

const C = 64 // cubes across every square
const K = 2.2 // split while the camera is closer than K widths
const WORKERS = 2, QUEUE = 3 // requests in flight per worker

interface Node { key: string; x0: number; z0: number; s: number; lo: number; hi: number; kids?: Node[]; mesh?: THREE.Mesh; state: 0 | 1 | 2 | 3; used: number }

export class VolumeLod {
  group = new THREE.Group()
  private workers: Worker[] = []
  private busy: number[] = []
  private root: Node
  private nodes = new Map<string, Node>()
  private frame = 0
  private waiters: (() => void)[] = []
  private lastNeed = 0
  private vmin: number
  private meshes = 0

  private b: CityBuilt
  private mat: THREE.Material
  constructor(b: CityBuilt, mat: THREE.Material) {
    this.b = b; this.mat = mat
    const v = b.volume!
    for (let k = 0; k < WORKERS; k++) {
      const w = new Worker(new URL('./volume.worker.ts', import.meta.url), { type: 'module' })
      w.postMessage({ init: { N: b.N, size: b.size, heights: b.heights, colors: b.colors, surf: b.surf, sea: b.sea, rocks: v.rocks, rockMap: v.rockMap, seed: v.seed } })
      w.onmessage = (e: MessageEvent<{ key: string; ch: VolumeChunk | null }>) => { this.busy[k]--; this.receive(e.data.key, e.data.ch) }
      this.workers.push(w); this.busy.push(0)
    }
    this.vmin = Math.max(0.9, b.size / 15000)
    this.root = this.node(-b.size / 2, -b.size / 2, b.size)
  }
  /** Heights the surface can reach over a square (from the grid and the free-standing rocks), for its box. */
  private node(x0: number, z0: number, s: number): Node {
    const b = this.b, w = b.N + 1, c = b.size / b.N, i0 = Math.max(0, Math.floor((x0 + b.size / 2) / c)), i1 = Math.min(b.N, Math.ceil((x0 + s + b.size / 2) / c)), j0 = Math.max(0, Math.floor((z0 + b.size / 2) / c)), j1 = Math.min(b.N, Math.ceil((z0 + s + b.size / 2) / c))
    const st = Math.max(1, Math.floor((i1 - i0) / 24))
    let lo = Infinity, hi = -Infinity
    for (let j = j0; j <= j1; j += st) for (let i = i0; i <= i1; i += st) { const h = b.heights[j * w + i]; lo = Math.min(lo, h); hi = Math.max(hi, h) }
    for (const r of b.volume!.rocks) { const rx = r.at[0], rz = -r.at[1]; if (rx > x0 - 60 && rx < x0 + s + 60 && rz > z0 - 60 && rz < z0 + s + 60) { lo = Math.min(lo, r.base); hi = Math.max(hi, r.top) } }
    const n: Node = { key: `${x0},${z0},${s}`, x0, z0, s, lo: lo - 15, hi: hi + 15, state: 0, used: 0 }
    this.nodes.set(n.key, n)
    return n
  }
  private receive(key: string, ch: VolumeChunk | null) {
    const n = this.nodes.get(key)
    if (n && n.state === 1) {
      if (ch) {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(ch.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(ch.nor, 3))
        g.setAttribute('color', new THREE.BufferAttribute(ch.col, 3, true)); g.setAttribute('surf', new THREE.BufferAttribute(ch.surf, 4, true)); g.setIndex(new THREE.BufferAttribute(ch.idx, 1))
        g.computeBoundingSphere()
        const m = new THREE.Mesh(g, this.mat); m.receiveShadow = true; m.castShadow = n.s <= 600; m.visible = false
        n.mesh = m; n.state = 2; this.group.add(m); this.meshes++
      } else n.state = 3
    }
    if (!this.busy.some((x) => x > 0)) { const w = this.waiters; this.waiters = []; for (const f of w) f() }
  }
  private dist(n: Node, p: THREE.Vector3) {
    const dx = Math.max(n.x0 - p.x, 0, p.x - n.x0 - n.s), dz = Math.max(n.z0 - p.z, 0, p.z - n.z0 - n.s), dy = Math.max(n.lo - p.y, 0, p.y - n.hi)
    return Math.hypot(dx, dy, dz)
  }
  /** Choose the squares to draw for a camera at `p`, ask for the ones missing; true while anything is still coming. */
  update(p: THREE.Vector3) {
    const f = ++this.frame, need: [Node, number][] = [], show: THREE.Mesh[] = []
    const select = (n: Node): boolean => {
      n.used = f
      const d = this.dist(n, p)
      if (n.state === 0) need.push([n, d])
      if (n.s / C > this.vmin && d < K * n.s) {
        const h = n.s / 2
        n.kids ??= [this.node(n.x0, n.z0, h), this.node(n.x0 + h, n.z0, h), this.node(n.x0, n.z0 + h, h), this.node(n.x0 + h, n.z0 + h, h)]
        const mark = show.length
        let all = true
        for (const k of n.kids) if (!select(k)) all = false
        if (all) return true
        show.length = mark // not all four ready yet: this square stands in for them
      }
      if (n.state === 2) { show.push(n.mesh!); return true }
      return n.state === 3
    }
    select(this.root)
    for (const c of this.group.children) c.visible = false
    for (const m of show) m.visible = true
    // ask for the nearest missing squares first
    need.sort((a, b) => a[1] - b[1])
    for (const [n] of need) {
      const k = this.busy.indexOf(Math.min(...this.busy))
      if (this.busy[k] >= QUEUE) break
      n.state = 1; this.busy[k]++
      this.workers[k].postMessage({ key: n.key, x0: n.x0, z0: n.z0, n: C, v: n.s / C })
    }
    this.lastNeed = need.length
    // let go of squares not drawn for a while
    if (this.meshes > 500 && f % 60 === 0) for (const n of this.nodes.values()) if (n.mesh && f - n.used > 300) { this.group.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh = undefined; n.state = 0; this.meshes-- }
    return need.length > 0 || this.busy.some((x) => x > 0)
  }
  /** Resolves once everything the camera at `p` needs has been meshed (for screenshots). */
  async settle(p: THREE.Vector3, timeout = 90000) {
    const t0 = performance.now()
    while (this.update(p) && performance.now() - t0 < timeout) await new Promise<void>((r) => { if (!this.busy.some((x) => x > 0)) setTimeout(r, 0); else this.waiters.push(r) })
    this.update(p)
  }
  get pending() { return this.lastNeed + this.busy.reduce((a, x) => a + x, 0) }
  dispose() {
    for (const w of this.workers) w.terminate()
    for (const n of this.nodes.values()) n.mesh?.geometry.dispose()
  }
}
