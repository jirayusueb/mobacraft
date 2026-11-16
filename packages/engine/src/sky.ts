/**
 * Time-of-day lighting curve. `t` is 0..1 over a day: 0.25 sunrise, 0.5 noon, 0.75 sunset.
 * Pure — the renderer applies the result to its lights.
 */
export interface Sky {
  readonly sunDir: { readonly x: number; readonly y: number; readonly z: number }
  readonly sunColor: number
  readonly sunIntensity: number
  readonly skyColor: number
  readonly groundColor: number
  readonly ambient: number
  readonly label: "Night" | "Dawn" | "Daytime" | "Dusk"
  /** 0 in daylight → 1 at full night; drives glows, fireflies, bloom. */
  readonly night: number
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const ch = (c: number, s: number) => (c >> s) & 0xff
const lerpColor = (a: number, b: number, k: number) => {
  const mix = (s: number) => Math.round(lerp(ch(a, s), ch(b, s), k)) << s
  return mix(16) | mix(8) | mix(0)
}

const NOON = { sun: 0xfff1d6, sky: 0xcfe6ff, ground: 0x6b5a3a }
const GOLDEN = { sun: 0xffb36b, sky: 0xf2b88a, ground: 0x4a3a30 }
const NIGHT = { sun: 0x9fb4ff, sky: 0x34437a, ground: 0x16182a }

export const skyAt = (t: number): Sky => {
  const tt = ((t % 1) + 1) % 1
  // Sun angle: rises in the east at 0.25, sets in the west at 0.75.
  const angle = (tt - 0.25) * Math.PI * 2
  const elevation = Math.sin(angle)
  const day = Math.max(0, elevation)
  const twilight = Math.max(0, 1 - Math.abs(elevation) * 3.5)

  const base = elevation > 0 ? lerpColor(GOLDEN.sun, NOON.sun, Math.min(1, day * 2)) : NIGHT.sun
  const sunColor = lerpColor(base, GOLDEN.sun, twilight * 0.6)
  const skyColor =
    elevation > 0
      ? lerpColor(GOLDEN.sky, NOON.sky, Math.min(1, day * 2))
      : lerpColor(GOLDEN.sky, NIGHT.sky, Math.min(1, -elevation * 3))
  const groundColor = elevation > 0 ? lerpColor(GOLDEN.ground, NOON.ground, day) : NIGHT.ground

  // Keep a dim "moon" key light at night so the map stays readable.
  const h = Math.max(0.25, Math.abs(elevation))
  const az = elevation > 0 ? angle : angle + Math.PI
  const sunDir = { x: Math.cos(az) * 0.8, y: h, z: 0.45 + Math.sin(az) * 0.2 }
  const len = Math.hypot(sunDir.x, sunDir.y, sunDir.z)

  const label =
    elevation > 0.2 ? "Daytime" : elevation < -0.2 ? "Night" : tt < 0.5 ? "Dawn" : "Dusk"
  return {
    sunDir: { x: sunDir.x / len, y: sunDir.y / len, z: sunDir.z / len },
    sunColor,
    sunIntensity: elevation > 0 ? lerp(1.2, 3, day) : 0.7,
    skyColor,
    groundColor,
    ambient: elevation > 0 ? lerp(0.9, 1.4, day) : 0.6,
    label,
    night: Math.min(1, Math.max(0, -elevation * 3 + 0.25)),
  }
}
