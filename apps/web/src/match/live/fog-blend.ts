/**
 * Fog render blending (spec/08 §5) — pure, so it is unit-tested without a DOM.
 *
 * The sim emits one byte per cell (0 unexplored, 1 explored-dark, 2 visible).
 * Each cell has a scalar *light* (0 = never seen, 1 = in live vision) that
 * eases toward its target with a temporal lerp so fog fades instead of popping.
 * Light maps to an overlay colour: near-black and opaque in the unexplored
 * dark, a dim shroud where the team has been, and a soft glow where it sees
 * right now — so live vision reads on the dark mini map. Bilinear smoothing
 * comes from the browser scaling the 64×64 canvas up (image-rendering: auto).
 */

/** Target light per fog state. */
export const FOG_LIGHT = { unexplored: 0, explored: 0.4, visible: 1 } as const

/** Temporal lerp factor per 20 Hz upload (spec/08 §5). */
export const FOG_LERP = 0.15

export const targetLight = (state: number): number =>
  state === 2 ? FOG_LIGHT.visible : state === 1 ? FOG_LIGHT.explored : FOG_LIGHT.unexplored

/**
 * Ease `light` toward the targets for `bytes` in place. `k = 1` snaps
 * (reduced motion / first frame). Returns true while any cell is still moving.
 */
export const blendFog = (light: Float32Array, bytes: Uint8Array, k = FOG_LERP): boolean => {
  let moving = false
  for (let i = 0; i < bytes.length; i++) {
    const target = targetLight(bytes[i]!)
    const next = light[i]! + (target - light[i]!) * k
    // Settle within 1/500 so the loop can go idle.
    if (Math.abs(target - next) < 0.002) light[i] = target
    else {
      light[i] = next
      moving = true
    }
  }
  return moving
}

const DARK = [4, 6, 12, 240] as const
const GLOW = [150, 190, 140, 0] as const

/** Overlay RGBA for a light value (0 dark → 1 glow). */
export const fogColor = (l: number): readonly [number, number, number, number] => [
  DARK[0] + (GLOW[0] - DARK[0]) * l,
  DARK[1] + (GLOW[1] - DARK[1]) * l,
  DARK[2] + (GLOW[2] - DARK[2]) * l,
  DARK[3] + (GLOW[3] - DARK[3]) * l,
]

/** Write the blended light into RGBA pixels. */
export const paintFog = (light: Float32Array, rgba: Uint8ClampedArray) => {
  for (let i = 0; i < light.length; i++) {
    const c = fogColor(light[i]!)
    const o = i * 4
    rgba[o] = c[0]
    rgba[o + 1] = c[1]
    rgba[o + 2] = c[2]
    rgba[o + 3] = c[3]
  }
}
