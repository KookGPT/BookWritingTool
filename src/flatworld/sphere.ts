// Puts a flat world on a sphere at its true size. Pure, so the node tests can run it.

export const EARTH_KM = 6371

/** Planet radius in km: Earth, or bigger when a huge map would otherwise wrap round onto itself (size goes up to 40000 km). */
export const planetKm = (W: number, H: number, disc: boolean) => Math.max(EARTH_KM, disc ? W / 2 / (0.9 * Math.PI) : Math.max(W / (2 * Math.PI), H / Math.PI))

/**
 * Unit direction for a map point (km from the centre, x east, y north). The map centre sits on the equator facing +z, north up.
 * A rectangle: x is longitude and y latitude, so a map as big as the planet covers all of it. North-south distances stay true
 * everywhere, east-west ones on the equator; away from it they shrink by cos(latitude), half at 60 degrees, as at the top of any world map.
 * A disc: azimuthal equidistant around its centre, so it stays a perfect circle and every distance from the centre stays true.
 * surfaceDir in globeScene.ts is the same thing in GLSL.
 */
export function toSphere(x: number, y: number, R: number, disc = false): [number, number, number] {
  if (disc) {
    const r = Math.hypot(x, y), c = r / R, s = c < 1e-6 ? 1 / R : Math.sin(c) / r
    return [x * s, y * s, Math.cos(c)]
  }
  const lat = y / R, lon = x / R
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]
}
