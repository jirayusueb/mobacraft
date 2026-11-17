/**
 * Hero Think — Layer 3, Micro-Combat (spec/09). Pure decision helpers the match calls
 * every tick for heroes in a fight: positioning ring (initiator hold / caster kite),
 * defensive item trigger, pre-fight buff, chain-stun hold. Views only — the match
 * applies the result. Enemy data comes from team knowledge (positions it can see,
 * projectiles lit by its fog, its own landed disables).
 */
import type { Vec2 } from "@mobacraft/map"

/** 400 Dota units in tiles. */
export const DANGER_PROJECTILE_RANGE = 3.3
export const INITIATOR_HOLD_MIN = 8.5
export const INITIATOR_HOLD_MAX = 10
export const BLINK_RANGE = 10
export const BLINK_LANDING = 1.5
export const FORCE_DISTANCE = 6
export const EUL_DURATION = 2.5
export const BKB_DURATION = 6
/** Glimmer Cape invisibility (spec/10 S5b). */
export const GLIMMER_DURATION = 5
/** Chain-stun slack: hold a disable while the current one has more than travel + this left. */
export const CHAIN_SLACK = 0.3

export type ActiveId = "bkb" | "blink" | "force" | "eul" | "manta" | "glimmer"

export interface ActiveView {
  readonly hpPct: number
  readonly stunned: boolean
  /** Ready actives this hero owns (cooldown 0, not stunned/cycloned). */
  readonly ready: ReadonlySet<ActiveId>
  /** Seconds since this hero last took hero damage (Blink lockout = 3 s). */
  readonly sinceHeroDamage: number
  /** Distance to the closest lit enemy spell projectile aimed at me (Infinity if none). */
  readonly incomingProjectile: number
  /** Known enemy heroes within 4 tiles. */
  readonly enemiesClose: number
  /** Known enemy heroes within 7 tiles. */
  readonly enemiesNear: number
  readonly role: "carry" | "mid" | "offlane" | "support" | "jungle"
  /** First tick of a fight (known enemy hero ≤ 7 tiles after ≥ 10 s without one). */
  readonly fightStart: boolean
  /** Rooted (or silenced) right now — Manta/Eul's self-cleanse trigger (spec/10 S5a). */
  readonly rooted?: boolean
}

export type DefensiveUse =
  | { readonly item: "bkb" }
  | { readonly item: "eul" }
  | { readonly item: "force" }
  | { readonly item: "manta" }
  | { readonly item: "blink"; readonly escape: true }

/**
 * Defensive trigger (spec/09 L3.1 + pre-fight BKB):
 *  - a lit enemy spell projectile within 3.3 tiles AND hp < 60 % → BKB, else Eul's;
 *  - hp < 25 % with an enemy hero within 4 tiles → Force Staff, else Blink home;
 *  - carry/mid at fight start with ≥ 2 enemy heroes ≤ 7 tiles → BKB;
 *  - rooted with an enemy near → Manta, else Eul's (spec/10 S5a self-cleanse).
 */
export const defensiveTrigger = (v: ActiveView): DefensiveUse | null => {
  if (v.stunned) return null
  // spec/10 S5a: dispel a Root/Silence the instant it lands while enemies are
  // close — breaks the enemy combo. Manta first (cheaper cooldown), then Eul's.
  if (v.rooted && v.enemiesNear > 0) {
    if (v.ready.has("manta")) return { item: "manta" }
    if (v.ready.has("eul")) return { item: "eul" }
  }
  if (v.incomingProjectile <= DANGER_PROJECTILE_RANGE && v.hpPct < 0.6) {
    if (v.ready.has("bkb")) return { item: "bkb" }
    if (v.ready.has("eul")) return { item: "eul" }
  }
  if (v.hpPct < 0.25 && v.enemiesClose > 0) {
    if (v.ready.has("force")) return { item: "force" }
    if (v.ready.has("blink") && v.sinceHeroDamage >= 3) return { item: "blink", escape: true }
  }
  if (v.fightStart && (v.role === "carry" || v.role === "mid") && v.enemiesNear >= 2)
    if (v.ready.has("bkb")) return { item: "bkb" }
  return null
}

/**
 * Chain-stun lock: hold a disable when our team's own landed disable on the target
 * still has more than `travel + CHAIN_SLACK` seconds to run.
 */
export const holdDisable = (ourDisableLeft: number, travel: number) =>
  ourDisableLeft > travel + CHAIN_SLACK

/** Initiator ring: should hold position (true) or is free to engage. */
export const initiatorEngage = (o: {
  readonly blinkReady: boolean
  readonly disableReady: boolean
  readonly alliesNear: number
  readonly ganking: boolean
  readonly targetDist: number
}) =>
  (o.blinkReady || o.disableReady) &&
  (o.ganking || o.alliesNear >= 1) &&
  o.targetDist <= (o.blinkReady ? BLINK_RANGE : 6)

/** Hold point for an initiator waiting outside the enemies' vision. */
export const holdPoint = (me: Vec2, enemy: Vec2): Vec2 | null => {
  const d = Math.hypot(me.x - enemy.x, me.z - enemy.z)
  if (d >= INITIATOR_HOLD_MIN && d <= INITIATOR_HOLD_MAX) return null
  const want = (INITIATOR_HOLD_MIN + INITIATOR_HOLD_MAX) / 2
  const k = d > 0 ? want / d : 0
  return { x: enemy.x + (me.x - enemy.x) * k, z: enemy.z + (me.z - enemy.z) * k }
}

/** Blink landing point: BLINK_LANDING tiles short of the target, on the line from me. */
export const blinkLanding = (me: Vec2, target: Vec2): Vec2 => {
  const d = Math.hypot(target.x - me.x, target.z - me.z)
  if (d <= BLINK_LANDING) return { x: me.x, z: me.z }
  const k = (d - BLINK_LANDING) / d
  return { x: me.x + (target.x - me.x) * k, z: me.z + (target.z - me.z) * k }
}

/** Point `dist` tiles from `me` straight away from `threat` (Force Staff / escape Blink). */
export const awayFrom = (me: Vec2, threat: Vec2, dist: number): Vec2 => {
  const dx = me.x - threat.x
  const dz = me.z - threat.z
  const d = Math.hypot(dx, dz) || 1
  return { x: me.x + (dx / d) * dist, z: me.z + (dz / d) * dist }
}

/**
 * Kiting: a ranged hero with a melee enemy inside `range·0.6` steps along the sum of
 * unit vectors away from enemies within 6 tiles; null = hold ground and shoot.
 */
export const kiteVector = (
  me: Vec2,
  range: number,
  enemies: readonly { readonly x: number; readonly z: number; readonly melee: boolean }[],
): Vec2 | null => {
  const closeMelee = enemies.some(
    (e) => e.melee && Math.hypot(e.x - me.x, e.z - me.z) < range * 0.6,
  )
  if (!closeMelee) return null
  let vx = 0
  let vz = 0
  for (const e of enemies) {
    const dx = me.x - e.x
    const dz = me.z - e.z
    const d = Math.hypot(dx, dz)
    if (d === 0 || d > 6) continue
    vx += dx / d
    vz += dz / d
  }
  const len = Math.hypot(vx, vz)
  if (len === 0) return null
  return { x: vx / len, z: vz / len }
}

/** Tango (spec/10 S5a): eat when the heal won't be wasted and no regen is running. */
export const TANGO_HEAL = 115
export const TANGO_DURATION = 16
export const tangoTrigger = (o: {
  readonly hp: number
  readonly maxHp: number
  readonly charges: number
  readonly regenLeft: number
}): boolean => o.charges > 0 && o.regenLeft <= 0 && o.maxHp - o.hp >= TANGO_HEAL
