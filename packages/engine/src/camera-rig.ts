/**
 * Isometric orbit rig — pure math, no three.js.
 * Owns where the camera wants to be (goal) and eases toward it each frame.
 */
export interface RigOptions {
  /** Map side length in world units; pans are clamped to it. */
  readonly size: number
  /** Camera pitch above the ground plane, radians, when fully zoomed out. */
  readonly pitch?: number
  /** Pitch when fully zoomed in — lower = more cinematic close-ups. */
  readonly closePitch?: number
  readonly minZoom?: number
  readonly maxZoom?: number
  readonly home?: { readonly x: number; readonly z: number; readonly zoom: number }
}

export interface Pose {
  /** Ground point the camera looks at, map space. */
  readonly target: { readonly x: number; readonly z: number }
  /** Unit vector from target toward the camera. */
  readonly back: { readonly x: number; readonly y: number; readonly z: number }
  /** Half-height of the orthographic frustum, world units. */
  readonly halfHeight: number
  readonly yaw: number
  readonly zoom: number
}

const BASE_HALF_HEIGHT = 40
/**
 * Yaw for quarter-turn `k`. -45° puts the map's (0, size) corner — the Radiant
 * base — nearest the camera, so Radiant sits at the bottom of the screen like Dota.
 */
const yawOf = (k: number) => -Math.PI / 4 + (k * Math.PI) / 2

/** Ground-plane basis for a yaw: screen-right and screen-up. */
const basis = (yaw: number) => ({
  right: { x: Math.cos(yaw), z: -Math.sin(yaw) },
  up: { x: -Math.sin(yaw), z: -Math.cos(yaw) },
})

export const createRig = (opts: RigOptions) => {
  const farPitch = opts.pitch ?? (38 * Math.PI) / 180
  const closePitch = opts.closePitch ?? (30 * Math.PI) / 180
  const minZoom = opts.minZoom ?? 0.35
  const maxZoom = opts.maxZoom ?? 4
  const home = opts.home ?? { x: opts.size / 2, z: opts.size / 2, zoom: 0.55 }

  const clampZoom = (z: number) => Math.min(maxZoom, Math.max(minZoom, z))
  const clampXZ = (v: number) => Math.min(opts.size, Math.max(0, v))

  const goal = { x: home.x, z: home.z, zoom: home.zoom, turn: 0 }
  const cur = { x: home.x, z: home.z, zoom: home.zoom, yaw: yawOf(0) }
  /** Pan velocity in world units/s, kept after a drag ends for a short glide. */
  const vel = { x: 0, z: 0 }
  let dragging = false

  /** Pitch eases from far → close as zoom goes from home → max (log scale). */
  const pitchAt = (zoom: number) => {
    const t = Math.min(1, Math.max(0, Math.log(zoom / home.zoom) / Math.log(maxZoom / home.zoom)))
    return farPitch + (closePitch - farPitch) * t * t * (3 - 2 * t)
  }

  return {
    rotate(dir: 1 | -1) {
      goal.turn += dir
    },
    zoomBy(factor: number) {
      goal.zoom = clampZoom(goal.zoom * factor)
    },
    /** Pan by a screen-space drag, in pixels, for a viewport `viewportHeight` px tall. */
    panPixels(dx: number, dy: number, viewportHeight: number) {
      const perPx = (2 * BASE_HALF_HEIGHT) / cur.zoom / viewportHeight
      const { right, up } = basis(yawOf(goal.turn))
      const groundUp = perPx / Math.sin(pitchAt(cur.zoom))
      const mx = -right.x * dx * perPx + up.x * dy * groundUp
      const mz = -right.z * dx * perPx + up.z * dy * groundUp
      goal.x = clampXZ(goal.x + mx)
      goal.z = clampXZ(goal.z + mz)
      // Snap the camera to the finger while dragging (no lag), remember speed.
      cur.x = goal.x
      cur.z = goal.z
      dragging = true
      vel.x = vel.x * 0.6 + mx * 60 * 0.4
      vel.z = vel.z * 0.6 + mz * 60 * 0.4
    },
    /** Ends a drag; the camera glides on with the last drag velocity. */
    release() {
      dragging = false
    },
    /** Pan in screen directions by world units (keyboard). */
    panScreen(rightAmount: number, upAmount: number) {
      const { right, up } = basis(yawOf(goal.turn))
      goal.x = clampXZ(goal.x + right.x * rightAmount + up.x * upAmount)
      goal.z = clampXZ(goal.z + right.z * rightAmount + up.z * upAmount)
    },
    focus(x: number, z: number) {
      vel.x = 0
      vel.z = 0
      goal.x = clampXZ(x)
      goal.z = clampXZ(z)
    },
    home() {
      vel.x = 0
      vel.z = 0
      goal.turn = Math.round(goal.turn / 4) * 4
      goal.x = home.x
      goal.z = home.z
      goal.zoom = home.zoom
    },
    /** Ease toward the goal. Frame-rate independent. Returns true while still moving. */
    update(dt: number): boolean {
      const k = 1 - Math.exp(-dt * 9)
      const targetYaw = yawOf(goal.turn)
      if (!dragging && Math.hypot(vel.x, vel.z) > 0.05) {
        goal.x = clampXZ(goal.x + vel.x * dt)
        goal.z = clampXZ(goal.z + vel.z * dt)
        const decay = Math.exp(-dt * 5)
        vel.x *= decay
        vel.z *= decay
      } else if (!dragging) {
        vel.x = 0
        vel.z = 0
      } else {
        // Holding still mid-drag kills momentum.
        vel.x *= Math.exp(-dt * 12)
        vel.z *= Math.exp(-dt * 12)
      }
      cur.x += (goal.x - cur.x) * k
      cur.z += (goal.z - cur.z) * k
      // Zoom eases in log space so zooming in and out feel symmetric.
      cur.zoom = Math.exp(Math.log(cur.zoom) + (Math.log(goal.zoom) - Math.log(cur.zoom)) * k)
      cur.yaw += (targetYaw - cur.yaw) * (1 - Math.exp(-dt * 7))
      return (
        Math.abs(goal.x - cur.x) +
          Math.abs(goal.z - cur.z) +
          Math.abs(goal.zoom - cur.zoom) +
          Math.abs(targetYaw - cur.yaw) >
        1e-4
      )
    },
    pose(): Pose {
      const pitch = pitchAt(cur.zoom)
      return {
        target: { x: cur.x, z: cur.z },
        back: {
          x: Math.sin(cur.yaw) * Math.cos(pitch),
          y: Math.sin(pitch),
          z: Math.cos(cur.yaw) * Math.cos(pitch),
        },
        halfHeight: BASE_HALF_HEIGHT / cur.zoom,
        yaw: cur.yaw,
        zoom: cur.zoom,
      }
    },
    /** Quarter-turn index the rig is heading to, normalised to 0..3. */
    turn: () => ((goal.turn % 4) + 4) % 4,
  }
}

export type Rig = ReturnType<typeof createRig>
