/**
 * The authored Dota-style layout, in normalised [0,1] map space, Radiant side only.
 * Radiant sits bottom-left (small x, large z); Dire is the point-mirror about (0.5, 0.5).
 * Everything here is data — the generator is the only reader.
 */
import { mirror, v } from "./geometry.ts"
import type { CampKind, LaneId, Vec2 } from "./types.ts"

export const RADIANT_ANCIENT = v(0.13, 0.87)
export const RADIANT_FOUNTAIN = v(0.05, 0.95)
export const RADIANT_SHOP = v(0.1, 0.96)
/** High-ground plateau around the ancient, normalised radius. */
export const BASE_RADIUS = 0.19

const TOP: readonly Vec2[] = [
  v(0.12, 0.79),
  v(0.1, 0.62),
  v(0.08, 0.42),
  v(0.09, 0.22),
  v(0.13, 0.11),
  v(0.24, 0.08),
  v(0.45, 0.09),
  v(0.66, 0.08),
  v(0.8, 0.12),
]
const MID: readonly Vec2[] = [
  v(0.19, 0.81),
  v(0.34, 0.65),
  v(0.5, 0.5),
  v(0.66, 0.35),
  v(0.81, 0.19),
]
/** Bottom lane is Top mirrored and reversed, so it also runs Radiant → Dire. */
const BOT: readonly Vec2[] = TOP.map(mirror).toReversed()

export const LANES: Readonly<Record<LaneId, readonly Vec2[]>> = { top: TOP, mid: MID, bot: BOT }

/** Runs top-left → bottom-right through the centre; self-symmetric under `mirror`. */
const RIVER_HALF: readonly Vec2[] = [
  v(0.15, -0.02),
  v(0.2, 0.12),
  v(0.27, 0.22),
  v(0.36, 0.33),
  v(0.44, 0.45),
  v(0.5, 0.5),
]
export const RIVER: readonly Vec2[] = [
  ...RIVER_HALF,
  ...RIVER_HALF.slice(0, -1).map(mirror).toReversed(),
]

/** Tower placement as arc-length fraction along each lane, from the Radiant end. */
export const TOWER_T: Readonly<Record<LaneId, readonly [t3: number, t2: number, t1: number]>> = {
  top: [0.06, 0.2, 0.4],
  mid: [0.1, 0.24, 0.38],
  bot: [0.06, 0.2, 0.4],
}

export const RADIANT_CAMPS: readonly { kind: CampKind; at: Vec2 }[] = [
  // safe jungle (between mid and bot)
  { kind: "medium", at: v(0.42, 0.69) },
  { kind: "large", at: v(0.55, 0.75) },
  { kind: "small", at: v(0.67, 0.8) },
  { kind: "ancient", at: v(0.47, 0.83) },
  // off-lane jungle (between top and mid)
  { kind: "large", at: v(0.22, 0.47) },
  { kind: "medium", at: v(0.27, 0.6) },
  { kind: "small", at: v(0.2, 0.33) },
]

export const SECRET_SHOP = v(0.25, 0.3)
/** Pit on the Dire bank of the river, south of mid — classic pre-7.33 placement. */
export const ROSHAN = v(0.645, 0.6)
/** Power runes sit in the river itself. */
export const RUNES: readonly Vec2[] = [v(0.33, 0.29), mirror(v(0.33, 0.29))]
