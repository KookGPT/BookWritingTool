// Eyaris's place in space, for the Globe tab. Pure, so the node tests can run it. Everything is a plain table on purpose: to tie a
// moon, planet or constellation into the story later, give it a `name` (or a wiki link) here. Nothing here is saved in the book.
// World frame: the orbit lies in the xz plane, +y is its north. Eyaris stays at the origin and the sky moves around it.

export type XYZ = [number, number, number]
const TAU = Math.PI * 2, DEG = Math.PI / 180

export const TILT_DEG = 23.4
export const YEAR_DAYS = 24 // days per year on screen: sped up so the seasons can be watched, not the story's calendar
export const START_DAY = 19.6 // where the clock starts: late northern spring, with the sun just beside the planet in the opening view

/** The planet's north pole. It always leans the same way, so the seasons come from where the sun is on the orbit. */
export const northAxis = (): XYZ => [Math.sin(TILT_DEG * DEG), Math.cos(TILT_DEG * DEG), 0]
/** Direction from Eyaris to the sun, `t` days after northern midsummer. */
export const sunDir = (t: number): XYZ => { const a = TAU * t / YEAR_DAYS; return [Math.cos(a), 0, Math.sin(a)] }
/** The latitude the sun stands over, degrees: +tilt at northern midsummer, -tilt at northern midwinter. */
export const sunLatitude = (t: number) => { const s = sunDir(t), n = northAxis(); return Math.asin(s[0] * n[0] + s[1] * n[1] + s[2] * n[2]) / DEG }
const SEASONS = ['summer', 'autumn', 'winter', 'spring']
export const seasonOf = (t: number) => `Northern ${SEASONS[Math.floor(((t / YEAR_DAYS + 0.125) % 1 + 1) % 1 * 4)]}`

export interface Moon { id: string; name?: string; dist: number; radius: number; days: number; incl: number; node: number; phase: number; colors: [string, string] } // dist and radius in planet radii, angles in degrees
export const MOONS: Moon[] = [
  { id: 'pale-moon', dist: 9, radius: 0.3, days: 5, incl: 9, node: 204, phase: 0.328, colors: ['#c9c6bd', '#6f6c68'] },
  { id: 'red-moon', dist: 15, radius: 0.17, days: 13, incl: 11, node: 279, phase: 0.366, colors: ['#c98a5e', '#6b3a2c'] },
]
const inclined = (a: number, r: number, incl: number, node: number): XYZ => {
  const x = Math.cos(a) * r, z = Math.sin(a) * r, i = incl * DEG, n = node * DEG, y = z * Math.sin(i), zz = z * Math.cos(i)
  return [x * Math.cos(n) - zz * Math.sin(n), y, x * Math.sin(n) + zz * Math.cos(n)]
}
export const moonAt = (m: Moon, t: number) => inclined(TAU * (t / m.days + m.phase), m.dist, m.incl, m.node)

export type Look = 'banded' | 'lava' | 'ice' | 'terra' | 'desert' | 'shattered'
/** a in AU (Eyaris is at 1), size = how big it looks in degrees from 1 AU away, ring sizes in planet radii. */
export interface SkyPlanet {
  id: string; name?: string; look: Look; a: number; phase: number; incl: number; node: number; size: number; lean: number
  colors: [string, string, string]; ring?: { inner: number; outer: number; color: string }
}
export const PLANETS: SkyPlanet[] = [
  { id: 'lava-world', look: 'lava', a: 0.45, phase: 0.1, incl: 4, node: 30, size: 1.5, lean: 8, colors: ['#1d0f0d', '#4d2318', '#ff7a1e'] },
  { id: 'veiled-world', look: 'banded', a: 0.74, phase: 0.62, incl: 3, node: 120, size: 2.1, lean: 3, colors: ['#e6d3a8', '#c7a873', '#f5ecd4'] },
  { id: 'rust-world', look: 'desert', a: 1.6, phase: 0.14, incl: 9, node: 282, size: 2.4, lean: 25, colors: ['#c96b3c', '#7d3b24', '#f2e6d8'] },
  { id: 'garden-world', look: 'terra', a: 2.1, phase: 0.32, incl: 12, node: 327, size: 3.2, lean: 18, colors: ['#1c4f86', '#4d7a3f', '#c7b37e'] },
  { id: 'broken-world', look: 'shattered', a: 3.3, phase: 0.7, incl: 14, node: 288, size: 5, lean: 40, colors: ['#5b5560', '#2c2830', '#ff6a3c'] },
  { id: 'ringed-giant', look: 'banded', a: 5.4, phase: 0.15, incl: 15, node: 165, size: 14, lean: 24, colors: ['#d9b98a', '#a8733f', '#f0e3c8'], ring: { inner: 1.35, outer: 2.5, color: '#d8c7a6' } },
  { id: 'blue-giant', look: 'banded', a: 9.2, phase: 0.22, incl: 10, node: 249, size: 15, lean: 12, colors: ['#7aa7c7', '#3e6a94', '#dbeaf2'] },
  { id: 'violet-giant', look: 'banded', a: 14, phase: 0.86, incl: 13, node: 75, size: 20, lean: 58, colors: ['#8c6bbd', '#4c3a7a', '#d9c7f0'], ring: { inner: 1.6, outer: 2, color: '#b7a6dc' } },
  { id: 'teal-giant', look: 'ice', a: 20, phase: 0.24, incl: 6, node: 81, size: 24, lean: 80, colors: ['#8fd6d0', '#4a9aa3', '#e4f7f4'], ring: { inner: 1.7, outer: 1.85, color: '#7fb9b6' } },
  { id: 'ice-dwarf', look: 'ice', a: 31, phase: 0.15, incl: 17, node: 30, size: 16, lean: 30, colors: ['#e8eef4', '#9fb4cc', '#ffffff'] },
]
export const BELT = { inner: 2.3, outer: 2.95, count: 7000 }
export const eyarisAt = (t: number): XYZ => { const s = sunDir(t); return [-s[0], -s[1], -s[2]] }
export const planetAt = (p: SkyPlanet, t: number) => inclined(TAU * (t / YEAR_DAYS / p.a ** 1.5 + p.phase), p.a, p.incl, p.node)
/** How big a planet looks, degrees: real distance would make them specks, so distance counts for less, and within limits. */
export const apparentDeg = (size: number, dist: number) => Math.max(0.5, Math.min(5.5, size / Math.max(0.2, dist) ** 0.8))

/** Star pictures, with room for names later. Lines are pen strokes on a square from -1 to 1. */
export interface Constellation { id: string; name?: string; lon: number; lat: number; size: number; turn: number; lines: [number, number][][] }
export const CONSTELLATIONS: Constellation[] = [
  { id: 'crown', lon: 200, lat: 34, size: 9, turn: -8, lines: [[[-1, 0], [-0.6, 0.7], [-0.25, 0.1], [0, 0.9], [0.25, 0.1], [0.6, 0.7], [1, 0], [-1, 0]]] },
  { id: 'sword', lon: 142, lat: 30, size: 11, turn: 22, lines: [[[0, 1], [0, -0.5], [0, -0.95]], [[-0.4, -0.45], [0.4, -0.45]]] },
  { id: 'serpent', lon: 165, lat: -33, size: 13, turn: 10, lines: [[[-1, 0.3], [-0.6, 0.7], [-0.2, 0.3], [0.1, -0.2], [0.5, -0.4], [0.9, -0.1], [1, 0.3]]] },
  { id: 'bow', lon: 245, lat: -24, size: 11, turn: -20, lines: [[[-0.6, 1], [-0.1, 0.6], [0.1, 0], [-0.1, -0.6], [-0.6, -1], [-0.6, 1]], [[-1, 0], [0.6, 0]]] },
  { id: 'ship', lon: 300, lat: 22, size: 12, turn: 6, lines: [[[-1, -0.3], [-0.5, -0.7], [0.6, -0.7], [1, -0.2]], [[0, -0.7], [0, 1], [0.7, -0.2], [0, -0.2]]] },
  { id: 'key', lon: 330, lat: -40, size: 9, turn: 35, lines: [[[0, -1], [0, 0.5], [-0.3, 0.8], [0, 1.1], [0.3, 0.8], [0, 0.5]], [[0, -0.7], [0.3, -0.7]], [[0, -0.95], [0.3, -0.95]]] },
  { id: 'tree', lon: 30, lat: 42, size: 11, turn: -5, lines: [[[0, -1], [0, 0.4]], [[0, 0], [-0.7, 0.6]], [[0, 0], [0.7, 0.6]], [[0, 0.4], [-0.3, 1]], [[0, 0.4], [0.3, 1]]] },
  { id: 'scales', lon: 62, lat: -30, size: 10, turn: 12, lines: [[[-1, 0.6], [1, 0.6]], [[0, 1], [0, -0.9]], [[-1, 0.6], [-1.2, 0], [-0.8, 0], [-1, 0.6]], [[1, 0.6], [0.8, 0], [1.2, 0], [1, 0.6]]] },
  { id: 'eye', lon: 100, lat: 58, size: 10, turn: 0, lines: [[[-1, 0], [-0.4, 0.5], [0.4, 0.5], [1, 0], [0.4, -0.5], [-0.4, -0.5], [-1, 0]], [[0, 0.15], [0.15, 0], [0, -0.15], [-0.15, 0], [0, 0.15]]] },
  { id: 'wing', lon: 260, lat: 55, size: 13, turn: 30, lines: [[[-1, -0.6], [-0.4, 0.1], [0.3, 0.5], [1, 0.7]], [[-0.4, 0.1], [-0.3, -0.6]], [[0.3, 0.5], [0.4, -0.2]], [[0.8, 0.65], [0.9, 0]]] },
  { id: 'tower', lon: 15, lat: -55, size: 10, turn: -10, lines: [[[-0.4, -1], [-0.4, 0.6], [-0.6, 0.9], [0, 1.2], [0.6, 0.9], [0.4, 0.6], [0.4, -1], [-0.4, -1]]] },
  { id: 'hound', lon: 215, lat: -58, size: 12, turn: 15, lines: [[[-1, 0.5], [-0.7, 0.8], [-0.5, 0.4], [0.5, 0.3], [0.9, 0.7]], [[-0.5, 0.4], [-0.6, -0.5]], [[0.5, 0.3], [0.6, -0.5]]] },
]
