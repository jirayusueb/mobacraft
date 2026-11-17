/**
 * Hero roster — pure data. 20 original heroes, polygon dark fantasy.
 * Numbers are tuned for ~10–14 minute *game-time* matches (3–5 min real time at 4×).
 */

export type Role = "carry" | "mid" | "offlane" | "support" | "jungle"
export type AttackKind = "melee" | "ranged"

/** Effect DSL — every ability is a list of these, applied to the chosen targets. */
export type Effect =
  | { readonly type: "damage"; readonly amount: number; readonly scale?: number }
  | { readonly type: "dot"; readonly dps: number; readonly duration: number }
  | { readonly type: "heal"; readonly amount: number; readonly scale?: number }
  | { readonly type: "hot"; readonly hps: number; readonly duration: number }
  | { readonly type: "stun"; readonly duration: number }
  | { readonly type: "root"; readonly duration: number }
  | { readonly type: "slow"; readonly pct: number; readonly duration: number }
  | { readonly type: "shield"; readonly amount: number; readonly duration: number }
  | {
      readonly type: "buff"
      readonly stat: "attack" | "speed" | "armor" | "attackSpeed"
      readonly pct: number
      readonly duration: number
    }
  | { readonly type: "dash"; readonly distance: number }
  | { readonly type: "execute"; readonly threshold: number }
  | { readonly type: "lifesteal"; readonly pct: number; readonly duration: number }

/** Who an ability lands on. */
export type Targeting =
  | { readonly kind: "enemy"; readonly range: number }
  | { readonly kind: "enemy-aoe"; readonly range: number; readonly radius: number }
  | { readonly kind: "self-aoe"; readonly radius: number }
  | { readonly kind: "self" }
  | { readonly kind: "ally"; readonly range: number }
  | { readonly kind: "ally-aoe"; readonly radius: number }
  | { readonly kind: "line"; readonly range: number; readonly width: number }

export interface Ability {
  readonly name: string
  readonly cooldown: number
  readonly target: Targeting
  readonly effects: readonly Effect[]
  /** AI hint: minimum enemies in area before casting an AoE (default 1). */
  readonly minTargets?: number
  readonly fx: "bolt" | "nova" | "slash" | "beam" | "heal" | "shield" | "storm"
}

export interface HeroDef {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly roles: readonly Role[]
  readonly attack: AttackKind
  readonly hp: number
  readonly hpPerLevel: number
  readonly damage: number
  readonly damagePerLevel: number
  readonly armor: number
  /** Seconds between basic attacks. */
  readonly attackTime: number
  readonly range: number
  /** Tiles per second. */
  readonly speed: number
  readonly skill: Ability
  readonly ultimate: Ability
  /** Silhouette hints for the model kit. */
  readonly look: {
    readonly body: number
    readonly accent: number
    readonly glow: number
    readonly shape: HeroShape
  }
}

export type HeroShape =
  | "knight"
  | "brute"
  | "rogue"
  | "archer"
  | "mage"
  | "priest"
  | "beast"
  | "shaman"

const melee = (r = 1.4) => ({ attack: "melee" as const, range: r })
const ranged = (r = 5) => ({ attack: "ranged" as const, range: r })

export const HEROES = [
  {
    id: "ironwarden",
    name: "Ironwarden",
    title: "The Unbroken Gate",
    roles: ["offlane", "support"],
    ...melee(),
    hp: 720,
    hpPerLevel: 95,
    damage: 46,
    damagePerLevel: 3.2,
    armor: 6,
    attackTime: 1.4,
    speed: 2.9,
    skill: {
      name: "Shield Bash",
      cooldown: 9,
      target: { kind: "enemy", range: 1.8 },
      effects: [
        { type: "damage", amount: 70, scale: 12 },
        { type: "stun", duration: 1.4 },
      ],
      fx: "slash",
    },
    ultimate: {
      name: "Bulwark Oath",
      cooldown: 55,
      target: { kind: "ally-aoe", radius: 6 },
      effects: [
        { type: "shield", amount: 260, duration: 5 },
        { type: "buff", stat: "armor", pct: 0.4, duration: 5 },
      ],
      minTargets: 2,
      fx: "shield",
    },
    look: { body: 0x8a8f99, accent: 0x3f6aa8, glow: 0x7fd0ff, shape: "knight" },
  },
  {
    id: "ashbringer",
    name: "Ashbringer",
    title: "Cinder Knight",
    roles: ["offlane", "carry"],
    ...melee(),
    hp: 660,
    hpPerLevel: 90,
    damage: 54,
    damagePerLevel: 3.8,
    armor: 4,
    attackTime: 1.3,
    speed: 3,
    skill: {
      name: "Searing Cleave",
      cooldown: 7,
      target: { kind: "self-aoe", radius: 2.2 },
      effects: [
        { type: "damage", amount: 85, scale: 14 },
        { type: "dot", dps: 18, duration: 3 },
      ],
      fx: "slash",
    },
    ultimate: {
      name: "Pyre Leap",
      cooldown: 50,
      target: { kind: "enemy-aoe", range: 7, radius: 2.8 },
      effects: [
        { type: "dash", distance: 7 },
        { type: "damage", amount: 210, scale: 24 },
        { type: "stun", duration: 1.2 },
      ],
      minTargets: 2,
      fx: "nova",
    },
    look: { body: 0x4a3a34, accent: 0xd8542a, glow: 0xff7a2a, shape: "knight" },
  },
  {
    id: "gravejaw",
    name: "Gravejaw",
    title: "Barrow Brute",
    roles: ["offlane"],
    ...melee(1.5),
    hp: 800,
    hpPerLevel: 105,
    damage: 50,
    damagePerLevel: 3,
    armor: 5,
    attackTime: 1.6,
    speed: 2.8,
    skill: {
      name: "Bone Hook",
      cooldown: 12,
      target: { kind: "line", range: 7, width: 1 },
      effects: [
        { type: "damage", amount: 90, scale: 12 },
        { type: "root", duration: 1.6 },
      ],
      fx: "beam",
    },
    ultimate: {
      name: "Grave Roar",
      cooldown: 60,
      target: { kind: "self-aoe", radius: 4.5 },
      effects: [
        { type: "stun", duration: 1.8 },
        { type: "damage", amount: 140, scale: 16 },
      ],
      minTargets: 2,
      fx: "nova",
    },
    look: { body: 0x5a5a4a, accent: 0xcfc3a8, glow: 0x9fe07a, shape: "brute" },
  },
  {
    id: "thornmaw",
    name: "Thornmaw",
    title: "Briar Beast",
    roles: ["jungle", "offlane"],
    ...melee(),
    hp: 740,
    hpPerLevel: 98,
    damage: 48,
    damagePerLevel: 3.4,
    armor: 5,
    attackTime: 1.4,
    speed: 3.1,
    skill: {
      name: "Bramble Burst",
      cooldown: 8,
      target: { kind: "self-aoe", radius: 2.5 },
      effects: [
        { type: "damage", amount: 70, scale: 12 },
        { type: "slow", pct: 0.35, duration: 2.5 },
      ],
      fx: "nova",
    },
    ultimate: {
      name: "Overgrowth",
      cooldown: 55,
      target: { kind: "enemy-aoe", range: 6, radius: 3 },
      effects: [
        { type: "root", duration: 2.2 },
        { type: "dot", dps: 30, duration: 4 },
      ],
      minTargets: 2,
      fx: "storm",
    },
    look: { body: 0x3e5a32, accent: 0x8a5a3a, glow: 0xb8ff5a, shape: "beast" },
  },
  {
    id: "hollowfang",
    name: "Hollowfang",
    title: "Moon-Starved Wolf",
    roles: ["jungle", "carry"],
    ...melee(1.3),
    hp: 600,
    hpPerLevel: 82,
    damage: 56,
    damagePerLevel: 4,
    armor: 3,
    attackTime: 1.15,
    speed: 3.4,
    skill: {
      name: "Rend",
      cooldown: 7,
      target: { kind: "enemy", range: 3.5 },
      effects: [
        { type: "dash", distance: 3.5 },
        { type: "damage", amount: 75, scale: 15 },
        { type: "dot", dps: 20, duration: 3 },
      ],
      fx: "slash",
    },
    ultimate: {
      name: "Blood Moon",
      cooldown: 50,
      target: { kind: "self" },
      effects: [
        { type: "buff", stat: "attackSpeed", pct: 0.6, duration: 7 },
        { type: "lifesteal", pct: 0.35, duration: 7 },
      ],
      fx: "nova",
    },
    look: { body: 0x4a4a55, accent: 0x9a2a2a, glow: 0xff3a3a, shape: "beast" },
  },
  {
    id: "duskblade",
    name: "Duskblade",
    title: "Shade Assassin",
    roles: ["mid", "carry"],
    ...melee(1.3),
    hp: 560,
    hpPerLevel: 78,
    damage: 58,
    damagePerLevel: 4.1,
    armor: 3,
    attackTime: 1.2,
    speed: 3.4,
    skill: {
      name: "Shadowstep",
      cooldown: 8,
      target: { kind: "enemy", range: 6 },
      effects: [
        { type: "dash", distance: 6 },
        { type: "damage", amount: 95, scale: 18 },
      ],
      fx: "slash",
    },
    ultimate: {
      name: "Death Mark",
      cooldown: 45,
      target: { kind: "enemy", range: 3 },
      effects: [
        { type: "damage", amount: 260, scale: 30 },
        { type: "execute", threshold: 0.2 },
      ],
      fx: "slash",
    },
    look: { body: 0x2e2a3a, accent: 0x6a3aa8, glow: 0xb07cff, shape: "rogue" },
  },
  {
    id: "vexlash",
    name: "Vexlash",
    title: "Thorn Whip",
    roles: ["carry"],
    ...melee(1.6),
    hp: 590,
    hpPerLevel: 80,
    damage: 55,
    damagePerLevel: 4.2,
    armor: 3,
    attackTime: 1.2,
    speed: 3.2,
    skill: {
      name: "Lashing Coil",
      cooldown: 9,
      target: { kind: "enemy-aoe", range: 3, radius: 2 },
      effects: [
        { type: "damage", amount: 80, scale: 14 },
        { type: "slow", pct: 0.3, duration: 2 },
      ],
      fx: "slash",
    },
    ultimate: {
      name: "Thousand Cuts",
      cooldown: 50,
      target: { kind: "self" },
      effects: [
        { type: "buff", stat: "attack", pct: 0.5, duration: 6 },
        { type: "buff", stat: "speed", pct: 0.25, duration: 6 },
      ],
      fx: "nova",
    },
    look: { body: 0x5a2a3a, accent: 0xd8b04a, glow: 0xff5a8a, shape: "rogue" },
  },
  {
    id: "grimfeather",
    name: "Grimfeather",
    title: "Crow Ranger",
    roles: ["carry"],
    ...ranged(5.5),
    hp: 520,
    hpPerLevel: 72,
    damage: 52,
    damagePerLevel: 4,
    armor: 2,
    attackTime: 1.1,
    speed: 3.1,
    skill: {
      name: "Pinning Shot",
      cooldown: 10,
      target: { kind: "enemy", range: 6.5 },
      effects: [
        { type: "damage", amount: 90, scale: 16 },
        { type: "root", duration: 1.3 },
      ],
      fx: "bolt",
    },
    ultimate: {
      name: "Murder of Crows",
      cooldown: 55,
      target: { kind: "enemy-aoe", range: 7, radius: 3 },
      effects: [
        { type: "damage", amount: 220, scale: 26 },
        { type: "slow", pct: 0.4, duration: 3 },
      ],
      minTargets: 2,
      fx: "storm",
    },
    look: { body: 0x2a2a30, accent: 0x5a5a6a, glow: 0x8ab0ff, shape: "archer" },
  },
  {
    id: "ivyshade",
    name: "Ivyshade",
    title: "Sylvan Archer",
    roles: ["carry", "support"],
    ...ranged(6),
    hp: 500,
    hpPerLevel: 70,
    damage: 50,
    damagePerLevel: 3.8,
    armor: 2,
    attackTime: 1.05,
    speed: 3.1,
    skill: {
      name: "Venom Arrow",
      cooldown: 8,
      target: { kind: "enemy", range: 6.5 },
      effects: [
        { type: "damage", amount: 60, scale: 10 },
        { type: "dot", dps: 28, duration: 4 },
        { type: "slow", pct: 0.25, duration: 2 },
      ],
      fx: "bolt",
    },
    ultimate: {
      name: "Wildwood Volley",
      cooldown: 50,
      target: { kind: "enemy-aoe", range: 7, radius: 3.5 },
      effects: [{ type: "damage", amount: 200, scale: 24 }],
      minTargets: 2,
      fx: "storm",
    },
    look: { body: 0x3a5a3a, accent: 0xd8cfa8, glow: 0x9aff7a, shape: "archer" },
  },
  {
    id: "bonecaller",
    name: "Bonecaller",
    title: "Necromancer",
    roles: ["mid"],
    ...ranged(5),
    hp: 500,
    hpPerLevel: 70,
    damage: 44,
    damagePerLevel: 3,
    armor: 2,
    attackTime: 1.4,
    speed: 2.9,
    skill: {
      name: "Soul Bolt",
      cooldown: 6,
      target: { kind: "enemy", range: 6 },
      effects: [{ type: "damage", amount: 110, scale: 18 }],
      fx: "bolt",
    },
    ultimate: {
      name: "Grave Harvest",
      cooldown: 60,
      target: { kind: "enemy-aoe", range: 6, radius: 3.5 },
      effects: [
        { type: "damage", amount: 240, scale: 28 },
        { type: "lifesteal", pct: 0.5, duration: 1 },
      ],
      minTargets: 2,
      fx: "storm",
    },
    look: { body: 0x2a2630, accent: 0xcfc3a8, glow: 0x7aff9a, shape: "mage" },
  },
  {
    id: "embercall",
    name: "Embercall",
    title: "Pyromancer",
    roles: ["mid"],
    ...ranged(5),
    hp: 490,
    hpPerLevel: 68,
    damage: 44,
    damagePerLevel: 3,
    armor: 1,
    attackTime: 1.4,
    speed: 3,
    skill: {
      name: "Fireball",
      cooldown: 7,
      target: { kind: "enemy-aoe", range: 6, radius: 2 },
      effects: [
        { type: "damage", amount: 105, scale: 18 },
        { type: "dot", dps: 15, duration: 3 },
      ],
      fx: "bolt",
    },
    ultimate: {
      name: "Cataclysm",
      cooldown: 60,
      target: { kind: "enemy-aoe", range: 7, radius: 4 },
      effects: [{ type: "damage", amount: 300, scale: 32 }],
      minTargets: 2,
      fx: "storm",
    },
    look: { body: 0x5a2a1a, accent: 0xff8a3a, glow: 0xffb04a, shape: "mage" },
  },
  {
    id: "frostveil",
    name: "Frostveil",
    title: "Rime Witch",
    roles: ["mid", "support"],
    ...ranged(5),
    hp: 500,
    hpPerLevel: 70,
    damage: 42,
    damagePerLevel: 2.9,
    armor: 2,
    attackTime: 1.4,
    speed: 3,
    skill: {
      name: "Frost Lance",
      cooldown: 8,
      target: { kind: "line", range: 7, width: 1.2 },
      effects: [
        { type: "damage", amount: 90, scale: 15 },
        { type: "slow", pct: 0.45, duration: 2.5 },
      ],
      fx: "beam",
    },
    ultimate: {
      name: "Glacial Prison",
      cooldown: 55,
      target: { kind: "enemy-aoe", range: 6, radius: 3.2 },
      effects: [
        { type: "stun", duration: 2 },
        { type: "damage", amount: 150, scale: 18 },
      ],
      minTargets: 2,
      fx: "storm",
    },
    look: { body: 0x3a4a6a, accent: 0xcfe6ff, glow: 0x7fe0ff, shape: "mage" },
  },
  {
    id: "stormcaller",
    name: "Stormcaller",
    title: "Thunder Shaman",
    roles: ["mid", "offlane"],
    ...ranged(5),
    hp: 540,
    hpPerLevel: 76,
    damage: 45,
    damagePerLevel: 3.1,
    armor: 3,
    attackTime: 1.3,
    speed: 3,
    skill: {
      name: "Chain Spark",
      cooldown: 7,
      target: { kind: "enemy-aoe", range: 6, radius: 2.5 },
      effects: [
        { type: "damage", amount: 85, scale: 14 },
        { type: "stun", duration: 0.5 },
      ],
      fx: "beam",
    },
    ultimate: {
      name: "Tempest",
      cooldown: 55,
      target: { kind: "self-aoe", radius: 5 },
      effects: [
        { type: "damage", amount: 200, scale: 24 },
        { type: "slow", pct: 0.35, duration: 3 },
      ],
      minTargets: 2,
      fx: "storm",
    },
    look: { body: 0x2a3a5a, accent: 0xb8c4d8, glow: 0x9ad0ff, shape: "shaman" },
  },
  {
    id: "voidmother",
    name: "Voidmother",
    title: "Abyssal Seer",
    roles: ["mid", "support"],
    ...ranged(5.5),
    hp: 510,
    hpPerLevel: 72,
    damage: 42,
    damagePerLevel: 2.9,
    armor: 2,
    attackTime: 1.4,
    speed: 2.9,
    skill: {
      name: "Rift",
      cooldown: 10,
      target: { kind: "enemy", range: 6 },
      effects: [
        { type: "damage", amount: 80, scale: 14 },
        { type: "stun", duration: 1.2 },
      ],
      fx: "bolt",
    },
    ultimate: {
      name: "Event Horizon",
      cooldown: 65,
      target: { kind: "enemy-aoe", range: 6, radius: 3.5 },
      effects: [
        { type: "root", duration: 2.4 },
        { type: "dot", dps: 45, duration: 3 },
      ],
      minTargets: 3,
      fx: "storm",
    },
    look: { body: 0x1e1a2a, accent: 0x4a2a6a, glow: 0xc07cff, shape: "mage" },
  },
  {
    id: "lumenmaid",
    name: "Lumenmaid",
    title: "Dawn Priestess",
    roles: ["support"],
    ...ranged(5),
    hp: 520,
    hpPerLevel: 72,
    damage: 38,
    damagePerLevel: 2.4,
    armor: 3,
    attackTime: 1.5,
    speed: 3,
    skill: {
      name: "Radiant Mend",
      cooldown: 7,
      target: { kind: "ally", range: 6 },
      effects: [{ type: "heal", amount: 140, scale: 22 }],
      fx: "heal",
    },
    ultimate: {
      name: "Sunrise",
      cooldown: 60,
      target: { kind: "ally-aoe", radius: 7 },
      effects: [
        { type: "heal", amount: 280, scale: 30 },
        { type: "hot", hps: 25, duration: 4 },
      ],
      minTargets: 2,
      fx: "heal",
    },
    look: { body: 0xe8dcc0, accent: 0xd8b04a, glow: 0xfff0a0, shape: "priest" },
  },
  {
    id: "mossmother",
    name: "Mossmother",
    title: "Grove Keeper",
    roles: ["support"],
    ...ranged(4.5),
    hp: 560,
    hpPerLevel: 78,
    damage: 38,
    damagePerLevel: 2.4,
    armor: 3,
    attackTime: 1.5,
    speed: 2.9,
    skill: {
      name: "Rejuvenate",
      cooldown: 8,
      target: { kind: "ally", range: 6 },
      effects: [
        { type: "hot", hps: 40, duration: 4 },
        { type: "shield", amount: 90, duration: 4 },
      ],
      fx: "heal",
    },
    ultimate: {
      name: "Entangle Grove",
      cooldown: 55,
      target: { kind: "enemy-aoe", range: 6, radius: 3.5 },
      effects: [
        { type: "root", duration: 2.2 },
        { type: "damage", amount: 120, scale: 12 },
      ],
      minTargets: 2,
      fx: "storm",
    },
    look: { body: 0x4a5a3a, accent: 0x8a6a4a, glow: 0x9aff7a, shape: "shaman" },
  },
  {
    id: "chainwarden",
    name: "Chainwarden",
    title: "Penitent Jailer",
    roles: ["support", "offlane"],
    ...melee(1.5),
    hp: 680,
    hpPerLevel: 92,
    damage: 44,
    damagePerLevel: 2.8,
    armor: 5,
    attackTime: 1.5,
    speed: 2.9,
    skill: {
      name: "Iron Hook",
      cooldown: 11,
      target: { kind: "line", range: 7, width: 1 },
      effects: [
        { type: "damage", amount: 60, scale: 10 },
        { type: "stun", duration: 1.3 },
      ],
      fx: "beam",
    },
    ultimate: {
      name: "Shackles",
      cooldown: 55,
      target: { kind: "enemy", range: 4 },
      effects: [
        { type: "stun", duration: 2.8 },
        { type: "dot", dps: 30, duration: 3 },
      ],
      fx: "slash",
    },
    look: { body: 0x4a4440, accent: 0x8a7a6a, glow: 0xffa04a, shape: "brute" },
  },
  {
    id: "hexweaver",
    name: "Hexweaver",
    title: "Curse Doll",
    roles: ["support", "mid"],
    ...ranged(5),
    hp: 490,
    hpPerLevel: 68,
    damage: 40,
    damagePerLevel: 2.6,
    armor: 2,
    attackTime: 1.4,
    speed: 3,
    skill: {
      name: "Withering Hex",
      cooldown: 9,
      target: { kind: "enemy", range: 6 },
      effects: [
        { type: "slow", pct: 0.5, duration: 2.5 },
        { type: "dot", dps: 30, duration: 3 },
      ],
      fx: "bolt",
    },
    ultimate: {
      name: "Puppet Strings",
      cooldown: 55,
      target: { kind: "enemy-aoe", range: 6, radius: 3 },
      effects: [
        { type: "stun", duration: 1.6 },
        { type: "damage", amount: 140, scale: 16 },
      ],
      minTargets: 2,
      fx: "storm",
    },
    look: { body: 0x4a2a4a, accent: 0xd8a0c0, glow: 0xff8ad8, shape: "priest" },
  },
  {
    id: "rootfather",
    name: "Rootfather",
    title: "Elder Treant",
    roles: ["jungle", "support"],
    ...melee(1.6),
    hp: 820,
    hpPerLevel: 108,
    damage: 46,
    damagePerLevel: 2.8,
    armor: 6,
    attackTime: 1.7,
    speed: 2.7,
    skill: {
      name: "Bark Skin",
      cooldown: 10,
      target: { kind: "ally", range: 5 },
      effects: [
        { type: "shield", amount: 160, duration: 4 },
        { type: "buff", stat: "armor", pct: 0.3, duration: 4 },
      ],
      fx: "shield",
    },
    ultimate: {
      name: "Earthshaker Roots",
      cooldown: 60,
      target: { kind: "self-aoe", radius: 5 },
      effects: [
        { type: "root", duration: 2.5 },
        { type: "damage", amount: 120, scale: 14 },
      ],
      minTargets: 2,
      fx: "nova",
    },
    look: { body: 0x5a4a32, accent: 0x5f7a3a, glow: 0xb8ff7a, shape: "brute" },
  },
  {
    id: "goreclaw",
    name: "Goreclaw",
    title: "Ravager",
    roles: ["jungle", "offlane"],
    ...melee(1.4),
    hp: 700,
    hpPerLevel: 94,
    damage: 52,
    damagePerLevel: 3.6,
    armor: 4,
    attackTime: 1.35,
    speed: 3.2,
    skill: {
      name: "Feral Pounce",
      cooldown: 9,
      target: { kind: "enemy", range: 5 },
      effects: [
        { type: "dash", distance: 5 },
        { type: "damage", amount: 80, scale: 14 },
        { type: "slow", pct: 0.4, duration: 2 },
      ],
      fx: "slash",
    },
    ultimate: {
      name: "Frenzy",
      cooldown: 50,
      target: { kind: "self" },
      effects: [
        { type: "buff", stat: "attackSpeed", pct: 0.5, duration: 6 },
        { type: "lifesteal", pct: 0.3, duration: 6 },
        { type: "buff", stat: "speed", pct: 0.2, duration: 6 },
      ],
      fx: "nova",
    },
    look: { body: 0x5a3a2a, accent: 0xcfc3a8, glow: 0xff6a2a, shape: "beast" },
  },
] as const satisfies readonly HeroDef[]

export type HeroId = (typeof HEROES)[number]["id"]

/**
 * Balance patch — applied on top of the base roster. Keep every tuning change here
 * (with the evidence that motivated it) so base kits stay readable and patches diff cleanly.
 * Evidence: /tmp-style headless reports (32 AI games, comps swapped across sides).
 */
interface Patch {
  readonly hp?: number
  readonly hpPerLevel?: number
  readonly damage?: number
  readonly armor?: number
  /** Multiply every damage/heal amount in the ability. */
  readonly skillScale?: number
  readonly ultScale?: number
  readonly skillCooldown?: number
  readonly ultCooldown?: number
}
const PATCH: Readonly<Record<string, Patch>> = {
  // 18–25% win rate: hook too slow and too weak to start fights.
  chainwarden: {
    hp: 720,
    hpPerLevel: 98,
    damage: 48,
    armor: 6,
    skillScale: 1.35,
    skillCooldown: 9,
  },
  // 13–16% win rate: ult needed 3 heroes and did little damage.
  voidmother: { skillScale: 1.3, skillCooldown: 8, ultScale: 1.4, ultCooldown: 55 },
  // 72–80% win rate: heal uptime too high.
  lumenmaid: { skillScale: 0.85, skillCooldown: 8 },
  // 75–82% win rate: AoE skill + 300 ult outclassed other mids.
  embercall: { skillScale: 0.85, ultScale: 0.85 },
  // Playtest #4: 0/0/1 with 0.2k hero damage in 14 min, then 2/8/4 with the
  // lowest net worth — beast jungler couldn't farm or skirmish.
  goreclaw: { hp: 760, damage: 56, skillScale: 1.25, skillCooldown: 7 },
}

const scaleAbility = (a: Ability, k: number, cd?: number): Ability => ({
  ...a,
  ...(cd ? { cooldown: cd } : {}),
  ...(a.name === "Event Horizon" ? { minTargets: 2 } : {}),
  effects: a.effects.map((e) =>
    e.type === "damage" || e.type === "heal"
      ? { ...e, amount: e.amount * k, ...(e.scale ? { scale: e.scale * k } : {}) }
      : e.type === "dot"
        ? { ...e, dps: e.dps * k }
        : e.type === "hot"
          ? { ...e, hps: e.hps * k }
          : e.type === "shield"
            ? { ...e, amount: e.amount * k }
            : e,
  ),
})

const patched = (h: HeroDef): HeroDef => {
  const p = PATCH[h.id]
  if (!p) return h
  return {
    ...h,
    ...(p.hp ? { hp: p.hp } : {}),
    ...(p.hpPerLevel ? { hpPerLevel: p.hpPerLevel } : {}),
    ...(p.damage ? { damage: p.damage } : {}),
    ...(p.armor ? { armor: p.armor } : {}),
    skill: scaleAbility(h.skill, p.skillScale ?? 1, p.skillCooldown),
    ultimate: scaleAbility(h.ultimate, p.ultScale ?? 1, p.ultCooldown),
  }
}

export const HERO_BY_ID: ReadonlyMap<string, HeroDef> = new Map(
  HEROES.map((h) => [h.id, patched(h)]),
)
export const heroDef = (id: string): HeroDef => {
  const h = HERO_BY_ID.get(id)
  if (!h) throw new Error(`Unknown hero ${id}`)
  return h
}
