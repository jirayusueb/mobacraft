/**
 * Courier system (spec/10 layer 1 / slice S3) — delivery delay only.
 *
 * One courier per team. It sits at the fountain, loads stash items for the
 * first hero (by hero id) that has any, flies straight to the hero, delivers,
 * and returns. No combat interaction (killing it is the optional S3b).
 *
 * Deterministic: pure state machine, no RNG. Motion is straight-line flight
 * (couriers fly over terrain).
 */
import type { DraftSide } from "./draft.ts"

export const COURIER_SPEED = 5.5 // tiles/s
export const DELIVERY_RANGE = 1.2

export interface CourierState {
  readonly side: DraftSide
  x: number
  z: number
  /** Items in the bag, in load order. */
  cargo: string[]
  /** Hero id the bag is addressed to; null = idle at base. */
  targetHero: string | null
  /** Flying back to base empty. */
  returning: boolean
}

export const createCourier = (side: DraftSide, home: { x: number; z: number }): CourierState => ({
  side,
  x: home.x,
  z: home.z,
  cargo: [],
  targetHero: null,
  returning: false,
})

export const courierBusy = (c: CourierState): boolean =>
  c.targetHero !== null || c.returning || c.cargo.length > 0

/** Load `items` for `heroId` — only while resting at base (Dota: one run at a time). */
export const dispatchCourier = (
  c: CourierState,
  heroId: string,
  heroPos: { x: number; z: number },
  items: readonly string[],
): boolean => {
  if (courierBusy(c) || items.length === 0) return false
  c.cargo = [...items]
  c.targetHero = heroId
  c.returning = false
  void heroPos // the courier tracks the hero live in advance()
  return true
}

/**
 * Advance one tick. `hero` is the target's live position (null = dead or
 * gone: hover in place). Returns delivered item ids (empty = none).
 */
export const advanceCourier = (
  c: CourierState,
  hero: { x: number; z: number } | null,
  home: { x: number; z: number },
  dt: number,
): readonly string[] => {
  if (c.returning) {
    const step = Math.min(dist(c, home), COURIER_SPEED * dt)
    if (step > 0) move(c, home, step)
    if (dist(c, home) < 0.05) {
      c.returning = false
      c.x = home.x
      c.z = home.z
    }
    return []
  }
  if (c.targetHero === null || hero === null) return []
  const step = Math.min(dist(c, hero), COURIER_SPEED * dt)
  if (step > 0) move(c, hero, step)
  if (dist(c, hero) <= DELIVERY_RANGE) {
    const delivered = [...c.cargo]
    c.cargo = []
    c.targetHero = null
    c.returning = true
    return delivered
  }
  return []
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

const move = (c: CourierState, to: { x: number; z: number }, step: number) => {
  const d = dist(c, to) || 1
  c.x += ((to.x - c.x) / d) * step
  c.z += ((to.z - c.z) / d) * step
}
