/** Ward spots scored with real fog-of-war line of sight (fog.ts), for the match. */
import type { MobaMap, Vec2 } from "@mobacraft/map"
import { Bits, type FogStatic, createTeamFog, recomputeFog, sourceRadius } from "./fog.ts"
import { type WardSpot, wardSpots } from "./vision.ts"

/** Ward spots whose jungle placements maximise cells actually lit under LOS (day vision). */
export const losWardSpots = (map: MobaMap, staticFog: FogStatic): readonly WardSpot[] => {
  const fog = createTeamFog(staticFog.cols)
  const radius = sourceRadius("ward", 0)
  const cover = (p: Vec2) => {
    fog.bits.fill(0)
    fog.lastLit.fill(0)
    recomputeFog({ staticFog, fog, tick: 0, sources: [{ x: p.x, z: p.z, radius }] })
    let n = 0
    for (const b of fog.bits) if (b & Bits.Visible) n++
    return n
  }
  return wardSpots(map, cover)
}
