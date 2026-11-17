/**
 * Three-phase attacks (spec/09 §4, Dota-style): attack point → damage frame → backswing.
 *
 * The point locks movement and avoidance (priority 1.0). Base attack time is charged
 * when the point *starts*, so cancelling backswing never changes DPS. A target that
 * leaves `reach + MOTION_BUFFER` during the point cancels the swing and refunds the
 * cooldown. Pure state machine; the match supplies distances and applies damage.
 */

/** Dota's 250-unit attack-range buffer, in tiles (1 tile = 100 units). */
export const MOTION_BUFFER = 2.5
/** Ability cast lock (s). */
export const CAST_LOCK = 0.3

export type AttackPhase = "idle" | "point" | "backswing"

export interface SwingTiming {
  readonly point: number
  readonly backswing: number
}

/** Default timings per unit class; scaled by attack speed and capped to fit inside BAT. */
export const swingTiming = (
  cls: "hero" | "creep" | "neutral" | "roshan" | "tower" | "other",
  baseAttackTime: number,
  attackSpeedMul: number,
  /** Per-unit feel at attack-speed 1 (spec/13 §1); omitted → class default. */
  override?: SwingTiming,
): SwingTiming => {
  const base =
    override ??
    (cls === "tower"
      ? { point: 0.1, backswing: 0.3 }
      : cls === "creep"
        ? { point: 0.3, backswing: 0.4 }
        : { point: 0.3, backswing: 0.5 })
  const k = 1 / Math.max(0.1, attackSpeedMul)
  const bat = baseAttackTime * k
  const point = Math.min(base.point * k, bat * 0.5)
  const backswing = Math.max(0, Math.min(base.backswing * k, bat - point))
  return { point, backswing }
}

export interface Swing {
  phase: AttackPhase
  /** Seconds left in the current phase. */
  left: number
  /** Total seconds of the current phase (renderer progress, spec/13 §2). */
  dur: number
  targetId?: string
  /** Cooldown charged at point start (refunded on cancel). */
  charged: number
  backswing: number
  /** Cast lock seconds left (abilities). */
  castLock: number
}

export const newSwing = (): Swing => ({
  phase: "idle",
  left: 0,
  dur: 0,
  charged: 0,
  backswing: 0,
  castLock: 0,
})

/** True while movement and avoidance are locked (attack point or cast lock). */
export const isLocked = (s: Swing) => s.phase === "point" || s.castLock > 0

/** Start an attack point. Caller has checked cooldown and reach. */
export const beginSwing = (s: Swing, targetId: string, timing: SwingTiming, cooldown: number) => {
  s.phase = "point"
  s.left = timing.point
  s.dur = timing.point
  s.targetId = targetId
  s.charged = cooldown
  s.backswing = timing.backswing
}

export type SwingEvent = "none" | "damage" | "cancel" | "backswing-done"

/**
 * Advance one tick. During the point `targetDist`/`reachRange` decide the buffer rule;
 * `valid` is false when the target died / the attacker is stunned.
 * Returns "damage" exactly on the frame the point completes.
 */
export const tickSwing = (
  s: Swing,
  dt: number,
  valid: boolean,
  targetDist: number,
  reachRange: number,
): SwingEvent => {
  s.castLock = Math.max(0, s.castLock - dt)
  if (s.phase === "point") {
    if (!valid || targetDist > reachRange + MOTION_BUFFER) {
      s.phase = "idle"
      s.left = 0
      return "cancel"
    }
    s.left -= dt
    if (s.left <= 1e-9) {
      s.phase = s.backswing > 0 ? "backswing" : "idle"
      s.left = s.backswing
      s.dur = s.backswing
      return "damage"
    }
    return "none"
  }
  if (s.phase === "backswing") {
    s.left -= dt
    if (s.left <= 1e-9) {
      s.phase = "idle"
      s.left = 0
      return "backswing-done"
    }
  }
  return "none"
}

/** A move order during backswing cancels it (orb-walking). Point cannot be cancelled by moving. */
export const cancelBackswing = (s: Swing): boolean => {
  if (s.phase !== "backswing") return false
  s.phase = "idle"
  s.left = 0
  return true
}
