/**
 * Population — the seam between anything that simulates units and the renderer.
 *
 * The engine renders whatever Population it is given. Explore mode uses the
 * ambient creep sim; Match Day plugs a full 5v5 match in through the same seam.
 * Implementations own time: `advance(dt)` receives *real* seconds since the last
 * frame and applies its own speed / pause.
 */
import type { Team } from "@mobacraft/map"
import type { CreatureKind, HeroId } from "./kinds.ts"

export type UnitKind = CreatureKind | HeroId

export interface Unit {
  /** Stable for the unit's life (and across deaths for heroes). */
  readonly id: string
  readonly kind: UnitKind
  readonly team: Team | "neutral"
  readonly x: number
  readonly z: number
  /** Radians; 0 looks toward +z. */
  readonly heading: number
  /** 0..1. Omitted → no health bar drawn. */
  readonly hp?: number
  /** Dead heroes stay in the list with alive=false (hidden, not removed). */
  readonly alive?: boolean
  /** Display name for cards (e.g. "Ember Witch · Vex"). */
  readonly label?: string
  readonly hero?: boolean
  /** Attacks / casts started so far; an increase plays the attack swing. Omitted → 0. */
  readonly attacks?: number
}

export interface StructureStatus {
  /** MobaMap structure id. */
  readonly id: string
  /** 0..1 */
  readonly hp: number
  readonly alive: boolean
}

export type FxStyle =
  | "bolt"
  | "nova"
  | "slash"
  | "beam"
  | "heal"
  | "shield"
  | "storm"
  | "arrow"
  | "siege"

export type FxEvent =
  | {
      readonly t: number
      readonly kind: "projectile"
      readonly from: P
      readonly to: P
      readonly duration: number
      readonly team: Team | "neutral"
      readonly style: FxStyle
    }
  | {
      readonly t: number
      readonly kind: "aoe"
      readonly at: P
      readonly radius: number
      readonly team: Team | "neutral"
      readonly style: FxStyle
    }
  | {
      readonly t: number
      readonly kind: "heal" | "shield" | "stun" | "levelup" | "death" | "hit"
      readonly at: P
      readonly team: Team | "neutral"
    }

type P = { readonly x: number; readonly z: number }

export interface Population {
  /** Real seconds since last frame. */
  advance(dt: number): void
  /** Current game time, seconds (fx `t` values are on this clock). */
  time(): number
  units(): readonly Unit[]
  /** Effects emitted since the previous call (drained). */
  fx(): readonly FxEvent[]
  /** Structure health; omitted → all standing at full health. */
  structures?(): readonly StructureStatus[]
}
