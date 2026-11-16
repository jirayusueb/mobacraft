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

interface Goal {
  x: number
  z: number
  zoom: number
  turn: number
}

interface Current {
  x: number
  z: number
  zoom: number
  yaw: number
}

export class CameraRig {
  readonly #size: number
  readonly #farPitch: number
  readonly #closePitch: number
  readonly #minZoom: number
  readonly #maxZoom: number
  readonly #home: { readonly x: number; readonly z: number; readonly zoom: number }

  readonly #goal: Goal
  readonly #cur: Current
  /** Pan velocity in world units/s, kept after a drag ends for a short glide. */
  readonly #vel = { x: 0, z: 0 }
  #dragging = false

  constructor(opts: RigOptions) {
    this.#size = opts.size
    this.#farPitch = opts.pitch ?? (38 * Math.PI) / 180
    this.#closePitch = opts.closePitch ?? (30 * Math.PI) / 180
    this.#minZoom = opts.minZoom ?? 0.35
    this.#maxZoom = opts.maxZoom ?? 4
    this.#home = opts.home ?? { x: opts.size / 2, z: opts.size / 2, zoom: 0.55 }
    const h = this.#home
    this.#goal = { x: h.x, z: h.z, zoom: h.zoom, turn: 0 }
    this.#cur = { x: h.x, z: h.z, zoom: h.zoom, yaw: yawOf(0) }
  }

  rotate(dir: 1 | -1): void {
    this.#goal.turn += dir
  }

  zoomBy(factor: number): void {
    this.#goal.zoom = this.#clampZoom(this.#goal.zoom * factor)
  }

  /** Pan by a screen-space drag, in pixels, for a viewport `viewportHeight` px tall. */
  panPixels(dx: number, dy: number, viewportHeight: number): void {
    const goal = this.#goal
    const cur = this.#cur
    const perPx = (2 * BASE_HALF_HEIGHT) / cur.zoom / viewportHeight
    const { right, up } = basis(yawOf(goal.turn))
    const groundUp = perPx / Math.sin(this.#pitchAt(cur.zoom))
    const mx = -right.x * dx * perPx + up.x * dy * groundUp
    const mz = -right.z * dx * perPx + up.z * dy * groundUp
    goal.x = this.#clampXZ(goal.x + mx)
    goal.z = this.#clampXZ(goal.z + mz)
    // Snap the camera to the finger while dragging (no lag), remember speed.
    cur.x = goal.x
    cur.z = goal.z
    this.#dragging = true
    this.#vel.x = this.#vel.x * 0.6 + mx * 60 * 0.4
    this.#vel.z = this.#vel.z * 0.6 + mz * 60 * 0.4
  }

  /** Ends a drag; the camera glides on with the last drag velocity. */
  release(): void {
    this.#dragging = false
  }

  /** Pan in screen directions by world units (keyboard). */
  panScreen(rightAmount: number, upAmount: number): void {
    const goal = this.#goal
    const { right, up } = basis(yawOf(goal.turn))
    goal.x = this.#clampXZ(goal.x + right.x * rightAmount + up.x * upAmount)
    goal.z = this.#clampXZ(goal.z + right.z * rightAmount + up.z * upAmount)
  }

  focus(x: number, z: number): void {
    this.#stopGlide()
    this.#goal.x = this.#clampXZ(x)
    this.#goal.z = this.#clampXZ(z)
  }

  home(): void {
    this.#stopGlide()
    const goal = this.#goal
    goal.turn = Math.round(goal.turn / 4) * 4
    goal.x = this.#home.x
    goal.z = this.#home.z
    goal.zoom = this.#home.zoom
  }

  /** Ease toward the goal. Frame-rate independent. Returns true while still moving. */
  update(dt: number): boolean {
    const goal = this.#goal
    const cur = this.#cur
    const vel = this.#vel
    const k = 1 - Math.exp(-dt * 9)
    const targetYaw = yawOf(goal.turn)
    if (this.#dragging) {
      // Holding still mid-drag kills momentum.
      const decay = Math.exp(-dt * 12)
      vel.x *= decay
      vel.z *= decay
    } else if (Math.hypot(vel.x, vel.z) > 0.05) {
      goal.x = this.#clampXZ(goal.x + vel.x * dt)
      goal.z = this.#clampXZ(goal.z + vel.z * dt)
      const decay = Math.exp(-dt * 5)
      vel.x *= decay
      vel.z *= decay
    } else {
      this.#stopGlide()
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
  }

  pose(): Pose {
    const cur = this.#cur
    const pitch = this.#pitchAt(cur.zoom)
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
  }

  /** Quarter-turn index the rig is heading to, normalised to 0..3. */
  turn(): number {
    return ((this.#goal.turn % 4) + 4) % 4
  }

  /** Pitch eases from far → close as zoom goes from home → max (log scale). */
  #pitchAt(zoom: number): number {
    const home = this.#home.zoom
    const t = Math.min(1, Math.max(0, Math.log(zoom / home) / Math.log(this.#maxZoom / home)))
    return this.#farPitch + (this.#closePitch - this.#farPitch) * t * t * (3 - 2 * t)
  }

  #clampZoom(z: number): number {
    return Math.min(this.#maxZoom, Math.max(this.#minZoom, z))
  }

  #clampXZ(v: number): number {
    return Math.min(this.#size, Math.max(0, v))
  }

  #stopGlide(): void {
    this.#vel.x = 0
    this.#vel.z = 0
  }
}
