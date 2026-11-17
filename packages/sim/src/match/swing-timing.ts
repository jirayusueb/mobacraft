/**
 * Per-hero attack point / backswing (spec/13 §1): data, not per-hero `if`s.
 *
 * Seconds at attack-speed 1. A silhouette sets the default feel (heavy weapons
 * wind up longer, casters have a slow hand), and individual heroes may override.
 * `swingTiming` in attack-phase.ts applies attack-speed scaling and the BAT cap.
 */
import type { HeroDef, HeroShape } from "./heroes.ts"

export interface SwingBase {
  readonly point: number
  readonly backswing: number
}

export const SHAPE_SWING: Readonly<Record<HeroShape, SwingBase>> = {
  knight: { point: 0.4, backswing: 0.5 },
  brute: { point: 0.4, backswing: 0.5 },
  rogue: { point: 0.25, backswing: 0.4 },
  beast: { point: 0.25, backswing: 0.4 },
  archer: { point: 0.3, backswing: 0.45 },
  mage: { point: 0.45, backswing: 0.5 },
  priest: { point: 0.45, backswing: 0.5 },
  shaman: { point: 0.45, backswing: 0.5 },
}

/** Hero-specific feel on top of the shape default. */
export const HERO_SWING: Readonly<Record<string, Partial<SwingBase>>> = {
  // Fastest hands in the roster: the twin-dagger rogue and the hunting cat.
  duskblade: { point: 0.2 },
  hollowfang: { point: 0.2, backswing: 0.35 },
  // The marksman's quick release.
  ivyshade: { point: 0.25 },
  // Siege-weight brute: the slowest, most telegraphed swing.
  rootfather: { point: 0.5, backswing: 0.55 },
}

export const heroSwing = (def: Pick<HeroDef, "id" | "look">): SwingBase => {
  const base = SHAPE_SWING[def.look.shape]
  const o = HERO_SWING[def.id]
  return { point: o?.point ?? base.point, backswing: o?.backswing ?? base.backswing }
}
