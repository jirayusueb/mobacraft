/**
 * Per-unit animation state — pure, no three.js. The renderer steps one of these per
 * visible unit each frame and uploads (phase, move, attack, seed) to the instance.
 *
 *  - phase advances by 2π per `stride` world units actually travelled, so feet match
 *    ground speed at any sim speed and stop when the unit stops (no moonwalking);
 *  - move eases toward 1 while travelling and back to 0 at rest (no snapping poses);
 *  - an increase of `Unit.attacks` restarts the attack swing (0 → 1 over ATTACK_TIME);
 *  - heading is smoothed along the shortest arc so units turn instead of popping.
 */
import type { Unit } from "@mobacraft/sim"

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
  /** Renderer bookkeeping: last frame this unit was seen. */
  frame: number
}

/** Seconds for one attack swing (wind-up → strike → recover). */
export const ATTACK_TIME = 0.55
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
    // Ease toward the sim heading along the shortest arc.
    s.heading = wrap(s.heading + wrap(u.heading - s.heading) * Math.min(1, dt * 14))
  }
  const attacks = u.attacks ?? 0
  if (attacks > s.attacks) {
    s.attack = 0
    // Snap to face the target when the swing starts.
    s.heading = u.heading
  }
  s.attacks = attacks
  if (s.attack < 1) s.attack = Math.min(1, s.attack + dt / ATTACK_TIME)
}
