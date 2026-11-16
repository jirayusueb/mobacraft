/**
 * Per-unit animation state — pure, no three.js. The renderer steps one of these per
 * visible unit each frame, then hands it to the PoseSolver (skeleton.ts).
 *
 *  - phase advances by 2π per `stride` world units actually travelled, so feet match
 *    ground speed at any sim speed and stop when the unit stops (no moonwalking);
 *  - move eases toward 1 while travelling and back to 0 at rest (no snapping poses);
 *  - an increase of `Unit.attacks` restarts the attack swing (0 → 1 over ATTACK_TIME);
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

export const stepAnim = (s: AnimState, u: Unit, dt: number, stride: number): void => {
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
  if (attacks > s.attacks) {
    s.attack = 0
    // Snap to face the target when the swing starts.
    s.heading = u.heading
  }
  s.attacks = attacks
  if (s.attack < 1) s.attack = Math.min(1, s.attack + dt / ATTACK_TIME)
  // Hit flinch: an hp drop (not regeneration) jolt.
  const hp = u.hp ?? 1
  if (hp < s.hp - 0.02 && s.death < 0) s.hit = 1
  s.hp = hp
  if (s.hit > 0) s.hit = Math.max(0, s.hit - dt * 2.2)
  // Death clip.
  if (u.alive === false && s.death < 0) s.death = 0
  if (s.death >= 0 && s.death < 1) s.death = Math.min(1, s.death + dt / DEATH_TIME)
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
