/**
 * Per-unit animation state — pure, no three.js. The renderer steps one of these per
 * visible unit each frame, then hands it to the PoseSolver (skeleton.ts).
 *
 *  - phase advances by 2π per `stride` world units actually travelled, so feet match
 *    ground speed at any sim speed and stop when the unit stops (no moonwalking);
 *  - move eases toward 1 while travelling and back to 0 at rest (no snapping poses);
 *  - with sim phase data (`Unit.swing`, spec/13) the swing follows the real phases:
 *    point → attack 0..0.5 (strike ends on the damage frame), backswing → 0.5..1;
 *    a backswing cancelled early (orb-walk) blends back to rest over CANCEL_TIME;
 *  - without phase data, an increase of `Unit.attacks` plays the fixed clip
 *    (0 → 1 over ATTACK_TIME);
 *  - heading is smoothed along the shortest arc; `turn` is the smoothed yaw rate the
 *    spine leans into;
 *  - a hp drop triggers the hit flinch; `alive: false` starts the death clip.
 */
import type { Unit } from "@mobacraft/sim"
import { type AttackStyle, type PoseInput } from "./skeleton.ts"

export interface AnimState {
  x: number
  z: number
  heading: number
  phase: number
  move: number
  /** 0..1 swing progress; ≥ 1 = not attacking. */
  attack: number
  /** Last sim phase seen and its extrapolated progress (spec/13 §3). */
  swing: "point" | "backswing" | "cast" | null
  swingT: number
  /** >0 while blending a cancelled swing back to rest (seconds left). */
  cancel: number
  attacks: number
  seed: number
  /** 1 at the moment of a hit, decaying. */
  hit: number
  /** −1 alive; 0..1 death progress. */
  death: number
  /** Smoothed yaw rate, rad/s. */
  turn: number
  hp: number
  /** Renderer bookkeeping: last frame this unit was seen. */
  frame: number
}

/** Seconds for one attack swing (wind-up → strike → recover). */
export const ATTACK_TIME = 0.55
/** Seconds to blend a cancelled backswing back to rest. */
export const CANCEL_TIME = 0.12
/** A phase that ends before this much clip progress was cancelled, not finished. */
const CANCEL_BEFORE = 0.9
/** Seconds for the death clip (buckle → topple → sink). */
export const DEATH_TIME = 1.1
/** Speeds below this (world units / s) count as standing. */
const STILL = 0.25
/** Movement per frame above this is a teleport (respawn), not a step. */
const TELEPORT = 3
const TAU = Math.PI * 2

const hashSeed = (id: string): number => {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) / 4294967296) * TAU
}

export const createAnimState = (u: Unit): AnimState => {
  const seed = hashSeed(u.id)
  return {
    x: u.x,
    z: u.z,
    heading: u.heading,
    // Desync stride starts so a wave never marches in lockstep.
    phase: seed,
    move: 0,
    attack: 1,
    swing: null,
    swingT: 0,
    cancel: 0,
    attacks: u.attacks ?? 0,
    seed,
    hit: 0,
    death: -1,
    turn: 0,
    hp: u.hp ?? 1,
    frame: 0,
  }
}

const wrap = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU)

/**
 * `timeScale` = game seconds per real second (Population.timeScale); used only to
 * extrapolate sim swing progress between ticks. Paused → 0 → frozen swing.
 */
export const stepAnim = (
  s: AnimState,
  u: Unit,
  dt: number,
  stride: number,
  timeScale = 1,
): void => {
  const d = Math.hypot(u.x - s.x, u.z - s.z)
  const teleport = d > TELEPORT
  s.x = u.x
  s.z = u.z
  if (teleport) {
    s.heading = u.heading
    s.move = 0
  } else if (dt > 0) {
    s.phase = (s.phase + (d / stride) * TAU) % (TAU * 64)
    const target = d / dt > STILL ? 1 : 0
    s.move += (target - s.move) * Math.min(1, dt * (target > s.move ? 8 : 5))
    // Ease toward the sim heading along the shortest arc; track the yaw rate.
    const diff = wrap(u.heading - s.heading)
    const k = Math.min(1, dt * 14)
    const step = diff * k
    s.heading = wrap(s.heading + step)
    s.turn += (step / Math.max(dt, 1e-4) - s.turn) * Math.min(1, dt * 6)
  }
  const attacks = u.attacks ?? 0
  const started = attacks > s.attacks
  if (started) s.heading = u.heading // snap to face the target when a swing starts
  s.attacks = attacks
  if (u.swing !== undefined) stepPhased(s, u, dt, timeScale, started)
  else {
    if (started) s.attack = 0
    if (s.attack < 1) s.attack = Math.min(1, s.attack + dt / ATTACK_TIME)
  }
  // Hit flinch: an hp drop (not regeneration) jolt.
  const hp = u.hp ?? 1
  if (hp < s.hp - 0.02 && s.death < 0) s.hit = 1
  s.hp = hp
  if (s.hit > 0) s.hit = Math.max(0, s.hit - dt * 2.2)
  // Death clip.
  if (u.alive === false && s.death < 0) s.death = 0
  if (s.death >= 0 && s.death < 1) s.death = Math.min(1, s.death + dt / DEATH_TIME)
}

/** Map a sim phase + progress onto the skeleton's 0..1 attack clip. */
const clipOf = (phase: "point" | "backswing" | "cast", t: number) =>
  phase === "backswing" ? 0.5 + 0.5 * t : 0.5 * t

const stepPhased = (s: AnimState, u: Unit, dt: number, timeScale: number, started: boolean) => {
  const phase = u.swing ?? null
  const gameDt = dt * Math.max(0, timeScale)
  if (phase !== null) {
    const dur = Math.max(1e-3, u.swingDur ?? 0.3)
    const simT = u.swingT ?? 0
    // New phase (or a fresh snapshot): resync to the sim; otherwise extrapolate.
    if (phase !== s.swing || simT > s.swingT) s.swingT = simT
    else s.swingT = Math.min(1, s.swingT + gameDt / dur)
    const next = clipOf(phase, s.swingT)
    // Never step backwards inside one phase (tick resync vs extrapolation).
    s.attack = phase === s.swing ? Math.max(s.attack, next) : next
    s.cancel = 0
  } else if (s.swing !== null && s.attack < CANCEL_BEFORE) {
    // Phase vanished early: cancelled (orb-walk / interrupted) → blend to rest.
    s.cancel = CANCEL_TIME
  } else if (started) {
    // Swing began and ended between two frames (hitch / high speed): fixed clip.
    s.attack = 0
  }
  if (phase === null) {
    if (s.cancel > 0) {
      const k = Math.min(1, dt / s.cancel)
      s.attack += (1 - s.attack) * k
      s.cancel = Math.max(0, s.cancel - dt)
      if (s.cancel === 0) s.attack = 1
    } else if (s.attack < 1) s.attack = Math.min(1, s.attack + gameDt / ATTACK_TIME)
  }
  s.swing = phase
}

/** Scratch PoseInput the renderer fills per unit (no allocation in the hot path). */
export const poseInput = (
  s: AnimState,
  time: number,
  stride: number,
  style: AttackStyle,
): PoseInput => ({
  time,
  phase: s.phase,
  move: s.move,
  stride,
  attack: s.attack,
  style,
  hit: s.hit,
  death: s.death,
  turn: s.turn,
  seed: s.seed,
})
