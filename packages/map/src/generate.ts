import { alongPath, dist, distToPath, mirror, scale, smoothstep, v } from "./geometry.ts"
import * as Layout from "./layout.ts"
import { Rng, ValueNoise } from "./random.ts"
import {
  Terrain,
  type Camp,
  type Landmark,
  type Lane,
  type LaneId,
  type MapSpec,
  type MobaMap,
  type Prop,
  type Structure,
  type Team,
  type Tree,
  type Vec2,
} from "./types.ts"

export const DEFAULT_SPEC: MapSpec = { seed: 7, size: 128, forestDensity: 0.62 }

// Normalised widths.
const RIVER_W = 0.024
const SHORE_W = 0.014
const LANE_W = 0.016
const LANE_CLEAR = 0.034
const PLAZA_R = 0.075
const CAMP_CLEAR = 0.032

const GROUND = 1
const HIGH_GROUND = 1.75
const RIVER_BED = 0.25
/** Sandy bank one step below the meadow. */
const SHORE_LEVEL = 0.75
const WATER_LEVEL = 0.6

const LANE_IDS: readonly LaneId[] = ["top", "mid", "bot"]
const MIRROR_LANE: Record<LaneId, LaneId> = { top: "bot", mid: "mid", bot: "top" }

const quantise = (h: number) => Math.round(h * 4) / 4

/** Radiant-side structures in normalised space; Dire is derived by mirroring. */
const radiantStructures = (): Structure[] => {
  const out: Structure[] = [
    {
      id: "ancient",
      kind: "ancient",
      team: "radiant",
      position: Layout.RADIANT_ANCIENT,
      radius: 2.2,
    },
    {
      id: "fountain",
      kind: "fountain",
      team: "radiant",
      position: Layout.RADIANT_FOUNTAIN,
      radius: 1.8,
    },
    { id: "shop", kind: "shop", team: "radiant", position: Layout.RADIANT_SHOP, radius: 1.2 },
  ]
  for (const lane of LANE_IDS) {
    const path = Layout.LANES[lane]
    const [t3, t2, t1] = Layout.TOWER_T[lane]
    const tiers = [
      [3, t3],
      [2, t2],
      [1, t1],
    ] as const
    for (const [tier, t] of tiers) {
      out.push({
        id: `tower-${lane}-${tier}`,
        kind: "tower",
        team: "radiant",
        lane,
        tier,
        position: offsetFromLane(path, t, 0.024),
        radius: 0.9,
      })
    }
    // Barracks flank the lane just behind the tier-3 tower.
    const behind = Math.max(0, t3 - 0.035)
    out.push(
      {
        id: `rax-melee-${lane}`,
        kind: "barracks-melee",
        team: "radiant",
        lane,
        position: offsetFromLane(path, behind, 0.03),
        radius: 1.3,
      },
      {
        id: `rax-ranged-${lane}`,
        kind: "barracks-ranged",
        team: "radiant",
        lane,
        position: offsetFromLane(path, behind, -0.03),
        radius: 1.1,
      },
    )
  }
  const a = Layout.RADIANT_ANCIENT
  out.push(
    {
      id: "tower-4-a",
      kind: "tower",
      team: "radiant",
      tier: 4,
      position: v(a.x + 0.035, a.z - 0.055),
      radius: 0.9,
    },
    {
      id: "tower-4-b",
      kind: "tower",
      team: "radiant",
      tier: 4,
      position: v(a.x + 0.055, a.z - 0.035),
      radius: 0.9,
    },
  )
  return out
}

/** Point beside a lane: `side` > 0 is to the lane's right (relative to Radiant→Dire travel). */
const offsetFromLane = (path: readonly Vec2[], t: number, side: number): Vec2 => {
  const { point, dir } = alongPath(path, t)
  return v(point.x - dir.z * side, point.z + dir.x * side)
}

const mirrorStructure = (s: Structure): Structure => {
  const lane = s.lane ? MIRROR_LANE[s.lane] : undefined
  const id = lane && s.lane ? s.id.replace(s.lane, lane) : s.id
  return {
    ...s,
    id: `dire-${id}`,
    team: "dire",
    position: mirror(s.position),
    ...(lane ? { lane } : {}),
  }
}

/**
 * Build a complete Dota-style map from a spec. Pure and deterministic:
 * equal specs produce byte-identical maps.
 */
export const generateMap = (spec: MapSpec = DEFAULT_SPEC): MobaMap => {
  const N = spec.size
  const rng = new Rng(spec.seed)
  const noise = new ValueNoise(spec.seed ^ 0x9e3779b9)
  const toWorld = (p: Vec2) => scale(p, N)

  // --- structures, camps, landmarks (normalised) --------------------------------
  const radiant = radiantStructures()
  const structuresN = [
    ...radiant.map((s) => ({ ...s, id: `radiant-${s.id}` })),
    ...radiant.map(mirrorStructure),
  ]
  const campsN: Camp[] = Layout.RADIANT_CAMPS.flatMap((c, i) => [
    { id: `radiant-camp-${i}`, kind: c.kind, team: "radiant" as Team, position: c.at },
    { id: `dire-camp-${i}`, kind: c.kind, team: "dire" as Team, position: mirror(c.at) },
  ])
  const landmarksN: Landmark[] = [
    { id: "roshan", kind: "roshan", position: Layout.ROSHAN },
    ...Layout.RUNES.map((p, i) => ({ id: `rune-${i}`, kind: "rune" as const, position: p })),
  ]
  const secretShops: Structure[] = [Layout.SECRET_SHOP, mirror(Layout.SECRET_SHOP)].map((p, i) => ({
    id: `secret-shop-${i}`,
    kind: "secret-shop",
    team: "neutral",
    position: p,
    radius: 1,
  }))
  const allStructuresN = [...structuresN, ...secretShops]

  const laneEntries = LANE_IDS.map((id) => [id, Layout.LANES[id]] as const)
  const ancients = [Layout.RADIANT_ANCIENT, mirror(Layout.RADIANT_ANCIENT)]
  const fountains = [Layout.RADIANT_FOUNTAIN, mirror(Layout.RADIANT_FOUNTAIN)]

  // --- tile grids ---------------------------------------------------------------
  const terrain = new Uint8Array(N * N)
  const height = new Float32Array(N * N)
  const side = new Uint8Array(N * N)
  const tint = new Float32Array(N * N)

  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      const i = tz * N + tx
      const p = v((tx + 0.5) / N, (tz + 0.5) / N)
      const dRiver = distToPath(p, Layout.RIVER)
      const dLane = Math.min(...laneEntries.map(([, path]) => distToPath(p, path)))
      const dBase = Math.min(...ancients.map((a) => dist(p, a)))
      const dPlaza = Math.min(
        ...ancients.map((a) => dist(p, a)),
        ...fountains.map((f) => dist(p, f) + 0.02),
      )
      const dCamp = Math.min(
        ...campsN.map((c) => dist(p, c.position)),
        ...landmarksN.map((l) => dist(p, l.position)),
      )
      const dStruct = Math.min(...allStructuresN.map((s) => dist(p, s.position)))

      // Radiant owns the half below the anti-diagonal.
      side[i] = p.x + (1 - p.z) > 1 ? 1 : 0
      tint[i] = noise.sample(p.x * 9, p.z * 9, 3)

      // Height: clean single-step cliffs (Quack-style) — plateau bases and a
      // carved river bank. Only lanes get smooth ramps, like Dota's high-ground
      // ramps and shallow river crossings.
      const onLane = dLane < LANE_CLEAR * 0.8
      const plateauT = onLane
        ? smoothstep(Layout.BASE_RADIUS + 0.02, Layout.BASE_RADIUS - 0.045, dBase)
        : dBase < Layout.BASE_RADIUS
          ? 1
          : 0
      let h = GROUND + (HIGH_GROUND - GROUND) * plateauT
      if (onLane)
        h =
          RIVER_BED +
          0.25 +
          (h - RIVER_BED - 0.25) * smoothstep(RIVER_W * 0.4, RIVER_W + SHORE_W * 2.2, dRiver)
      else if (dRiver < RIVER_W) h = RIVER_BED
      else if (dRiver < RIVER_W + SHORE_W) h = Math.min(h, SHORE_LEVEL)
      height[i] = quantise(h)

      let t: Terrain
      if (dRiver < RIVER_W && height[i]! < WATER_LEVEL) t = Terrain.Water
      else if (dRiver < RIVER_W + SHORE_W) t = dLane < LANE_W ? Terrain.Lane : Terrain.Shore
      else if (dPlaza < PLAZA_R) t = Terrain.Plaza
      else if (dLane < LANE_W) t = Terrain.Lane
      else {
        const forestNoise = noise.sample(p.x * 14 + 31, p.z * 14 - 17, 2)
        const open =
          dLane < LANE_CLEAR ||
          dCamp < CAMP_CLEAR ||
          dStruct < 0.03 ||
          dBase < Layout.BASE_RADIUS + 0.01
        // The rim of the island is always forest — the Dota tree wall.
        const rim = Math.min(p.x, p.z, 1 - p.x, 1 - p.z) < 0.035
        t =
          !open && (rim || forestNoise < spec.forestDensity * 0.85) ? Terrain.Forest : Terrain.Grass
      }
      terrain[i] = t
    }
  }

  // --- scatter: trees and props ---------------------------------------------------
  const trees: Tree[] = []
  const props: Prop[] = []
  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      const i = tz * N + tx
      const team: Team = side[i] === 0 ? "radiant" : "dire"
      if (terrain[i] === Terrain.Forest) {
        if (rng.next() < 0.55) {
          trees.push({
            position: v(tx + 0.2 + rng.next() * 0.6, tz + 0.2 + rng.next() * 0.6),
            scale: 0.7 + rng.next() * 0.6,
            team,
            variant: rng.next(),
          })
        }
      } else if (terrain[i] === Terrain.Grass || terrain[i] === Terrain.Shore) {
        const r = rng.next()
        const kind = r < 0.1 ? "flower" : r < 0.13 ? "bush" : r < 0.145 ? "rock" : undefined
        if (kind)
          props.push({
            kind,
            position: v(tx + rng.next(), tz + rng.next()),
            scale: 0.6 + rng.next() * 0.6,
            variant: rng.next(),
          })
      }
    }
  }

  const lanes: Lane[] = laneEntries.map(([id, path]) => ({ id, path: path.map(toWorld) }))
  const structures = allStructuresN.map((s) => ({ ...s, position: toWorld(s.position) }))

  const sample = <A>(grid: ArrayLike<A>, x: number, z: number, outside: A): A => {
    const tx = Math.floor(x)
    const tz = Math.floor(z)
    if (tx < 0 || tz < 0 || tx >= N || tz >= N) return outside
    return grid[tz * N + tx]!
  }

  return {
    spec,
    size: N,
    terrain,
    height,
    side,
    tint,
    waterLevel: WATER_LEVEL,
    lanes,
    river: Layout.RIVER.map(toWorld),
    structures,
    camps: campsN.map((c) => ({ ...c, position: toWorld(c.position) })),
    landmarks: landmarksN.map((l) => ({ ...l, position: toWorld(l.position) })),
    trees,
    props,
    terrainAt: (x, z) => sample(terrain, x, z, Terrain.Water) as Terrain,
    heightAt: (x, z) => {
      const fx = Math.max(0, Math.min(N - 1, x - 0.5))
      const fz = Math.max(0, Math.min(N - 1, z - 0.5))
      const x0 = Math.floor(fx)
      const z0 = Math.floor(fz)
      const x1 = Math.min(N - 1, x0 + 1)
      const z1 = Math.min(N - 1, z0 + 1)
      const kx = fx - x0
      const kz = fz - z0
      const h = (a: number, b: number) => height[b * N + a]!
      const top = h(x0, z0) + (h(x1, z0) - h(x0, z0)) * kx
      const bottom = h(x0, z1) + (h(x1, z1) - h(x0, z1)) * kx
      return top + (bottom - top) * kz
    },
    isWalkable: (x, z) => {
      const t = sample(terrain, x, z, undefined)
      if (t === undefined || t === Terrain.Forest) return false
      return !structures.some((s) => Math.hypot(s.position.x - x, s.position.z - z) < s.radius)
    },
  }
}
