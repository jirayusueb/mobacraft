/** Teams and players — pure data. Ratings are 1..20 (TFM-style). */
import type { Team } from "@mobacraft/map"
import type { Role } from "./heroes.ts"

export interface Player {
  readonly id: string
  readonly name: string
  readonly role: Role
  /** Raw mechanics: attack damage, ability damage/healing. */
  readonly skill: number
  /** Positioning / decision making: retreat timing, target choice, dodging. */
  readonly sense: number
  /** Hero mastery 0..1 by hero id; unlisted heroes = 0.35. */
  readonly mastery: Readonly<Record<string, number>>
}

export interface TeamDef {
  readonly id: string
  readonly name: string
  readonly tag: string
  /** Hex colour for HUD chips. */
  readonly color: number
  readonly players: readonly [Player, Player, Player, Player, Player]
  /** AI coach personality when this team is CPU-controlled. */
  readonly style: "aggressive" | "macro" | "teamfight" | "pick"
}

const p = (
  id: string,
  name: string,
  role: Role,
  skill: number,
  sense: number,
  mastery: Record<string, number>,
): Player => ({
  id,
  name,
  role,
  skill,
  sense,
  mastery,
})

export const TEAMS: readonly TeamDef[] = [
  {
    id: "lantern",
    name: "Lantern Wardens",
    tag: "LNT",
    color: 0xf2c14a,
    style: "macro",
    players: [
      p("lnt-bram", "Bram", "carry", 15, 13, { grimfeather: 0.9, ivyshade: 0.8, vexlash: 0.6 }),
      p("lnt-osk", "Oskar", "mid", 14, 15, { frostveil: 0.9, embercall: 0.7, voidmother: 0.6 }),
      p("lnt-hild", "Hild", "offlane", 13, 14, { ironwarden: 0.9, gravejaw: 0.7, ashbringer: 0.5 }),
      p("lnt-ivo", "Ivo", "jungle", 13, 13, { rootfather: 0.85, thornmaw: 0.7, goreclaw: 0.5 }),
      p("lnt-mae", "Mae", "support", 12, 16, { lumenmaid: 0.95, mossmother: 0.7, hexweaver: 0.5 }),
    ],
  },
  {
    id: "ember",
    name: "Ember Crows",
    tag: "EMB",
    color: 0xe8603a,
    style: "aggressive",
    players: [
      p("emb-kas", "Kas", "carry", 17, 11, { vexlash: 0.9, hollowfang: 0.8, grimfeather: 0.6 }),
      p("emb-rhee", "Rhee", "mid", 16, 12, { duskblade: 0.95, embercall: 0.8, bonecaller: 0.5 }),
      p("emb-tor", "Tor", "offlane", 15, 11, { ashbringer: 0.9, goreclaw: 0.7, gravejaw: 0.5 }),
      p("emb-yuki", "Yuki", "jungle", 16, 12, { goreclaw: 0.9, hollowfang: 0.8, thornmaw: 0.5 }),
      p("emb-lio", "Lio", "support", 12, 12, { chainwarden: 0.9, hexweaver: 0.7, lumenmaid: 0.4 }),
    ],
  },
  {
    id: "mire",
    name: "Mire Choir",
    tag: "MIR",
    color: 0x7fb069,
    style: "teamfight",
    players: [
      p("mir-ada", "Ada", "carry", 13, 14, { ivyshade: 0.9, grimfeather: 0.7, vexlash: 0.4 }),
      p("mir-sol", "Sol", "mid", 15, 14, { stormcaller: 0.9, voidmother: 0.85, embercall: 0.5 }),
      p("mir-kell", "Kell", "offlane", 14, 13, { gravejaw: 0.9, thornmaw: 0.7, ironwarden: 0.6 }),
      p("mir-pim", "Pim", "jungle", 12, 14, { thornmaw: 0.85, rootfather: 0.8, goreclaw: 0.4 }),
      p("mir-wren", "Wren", "support", 13, 15, { mossmother: 0.9, frostveil: 0.6, lumenmaid: 0.7 }),
    ],
  },
  {
    id: "vigil",
    name: "Hollow Vigil",
    tag: "HVL",
    color: 0x9a7cff,
    style: "pick",
    players: [
      p("hvl-nox", "Nox", "carry", 14, 15, { hollowfang: 0.85, vexlash: 0.75, ivyshade: 0.5 }),
      p("hvl-sable", "Sable", "mid", 16, 14, { bonecaller: 0.9, voidmother: 0.75, duskblade: 0.7 }),
      p("hvl-grey", "Grey", "offlane", 13, 15, {
        chainwarden: 0.8,
        ironwarden: 0.7,
        gravejaw: 0.6,
      }),
      p("hvl-rook", "Rook", "jungle", 14, 13, { hollowfang: 0.7, goreclaw: 0.75, thornmaw: 0.6 }),
      p("hvl-vey", "Vey", "support", 13, 15, { hexweaver: 0.9, voidmother: 0.6, mossmother: 0.6 }),
    ],
  },
]

export const teamById = (id: string): TeamDef => {
  const t = TEAMS.find((x) => x.id === id)
  if (!t) throw new Error(`Unknown team ${id}`)
  return t
}

export const masteryOf = (player: Player, heroId: string) => player.mastery[heroId] ?? 0.35

/** Which map side each draft slot plays. Blue side = Radiant. */
export const SIDE: Readonly<Record<"blue" | "red", Team>> = { blue: "radiant", red: "dire" }
