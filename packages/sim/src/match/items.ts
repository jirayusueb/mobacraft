/**
 * Items (spec/10 layer 2) — a component DAG, not a flat list.
 *
 * `cost` is the full shop price: Σ component costs + recipe cost (derived,
 * test-enforced ≥ 0). Buying is component-first (match.ts buy()): the hero
 * picks up pieces as soon as they are affordable, then pays the recipe to
 * combine — Dota's smooth power curve instead of one big purchase.
 *
 * Tags are the strategic vocabulary the item AI (spec/10 layer 3) scores
 * against; `tier` drives the unified sell order (spec/10 layer 5).
 */
import type { Role } from "./heroes.ts"

export type ItemTag =
  | "spellImmunity"
  | "mobility"
  | "initiation"
  | "dispel"
  | "purge"
  | "trueStrike"
  | "break"
  | "silence"
  | "disable"
  | "armor"
  | "evasion"
  | "sustain"
  | "farmSpeed"
  | "vision"
  | "save"
  | "aura"
  | "consumable"

/** Active item definition (effects are wired in spec/10 slice S5). */
export interface ActiveDef {
  /** Cooldown in seconds. */
  cooldown: number
  /** Trigger family the tactical AI recognises. */
  trigger: "blink" | "spellImmunity" | "selfCleanse" | "allySave" | "regen" | "ward" | "buff"
}

export interface Item {
  readonly id: string
  readonly name: string
  /** Full shop price (components + recipe). */
  readonly cost: number
  /** Shop tier 1..4; drives sell order and HUD grouping. */
  readonly tier: 1 | 2 | 3 | 4
  /** Component ids (may repeat, e.g. two `steel`). Empty = basic. */
  readonly components: readonly string[]
  readonly tags: readonly ItemTag[]
  // --- stat fields (kept flat; recomputeStats sums them) ---
  readonly hp?: number
  readonly damage?: number
  readonly armor?: number
  /** Fraction, e.g. 0.15 = +15%. */
  readonly attackSpeed?: number
  readonly speed?: number
  /** Multiplies ability damage and healing. */
  readonly power?: number
  readonly lifesteal?: number
  /** Fraction of magic damage ignored, e.g. 0.2. */
  readonly magicResist?: number
  /** Magic resist granted to the holder and allies within 6 tiles (one per team counts). */
  readonly auraMagicResist?: number
  /** Flat mana / mana regen (spec/09 hero-think). */
  readonly mana?: number
  readonly manaRegen?: number
  /** Basic attacks can't miss (pierces Evasion). */
  readonly trueStrike?: boolean
  /** The first engage ability each fight reaches 10 tiles. */
  readonly blink?: boolean
  /** Lost when the holder dies. */
  readonly dropOnDeath?: boolean
  /** Seconds of Spell Immunity when a fight starts (60 s cooldown). */
  readonly spellImmunity?: number
  readonly active?: ActiveDef
  /** Components can be split back out (data only; mechanic deferred, spec/10). */
  readonly disassemblable?: boolean
}

export const ITEMS: readonly Item[] = [
  // --- tier 1: basics -----------------------------------------------------------------
  {
    id: "boots",
    name: "Wanderer's Boots",
    cost: 400,
    tier: 1,
    components: [],
    tags: ["mobility"],
    speed: 0.35,
  },
  { id: "steel", name: "Steel Edge", cost: 500, tier: 1, components: [], tags: [], damage: 8 },
  {
    id: "plating",
    name: "Iron Plating",
    cost: 550,
    tier: 1,
    components: [],
    tags: ["armor"],
    hp: 80,
    armor: 3,
  },
  { id: "orb", name: "Glow Orb", cost: 500, tier: 1, components: [], tags: [], power: 0.1 },
  // --- tier 2 --------------------------------------------------------------------------
  {
    id: "blade",
    name: "Gravesteel Blade",
    cost: 1100,
    tier: 2,
    components: ["steel", "steel"],
    tags: [],
    damage: 22,
  },
  {
    id: "plate",
    name: "Barrow Plate",
    cost: 1150,
    tier: 2,
    components: ["plating", "steel"],
    tags: ["armor"],
    hp: 220,
    armor: 5,
  },
  {
    id: "charm",
    name: "Moon Charm",
    cost: 900,
    tier: 2,
    components: ["orb"],
    tags: [],
    hp: 150,
    power: 0.12,
    mana: 150,
  },
  {
    id: "bow",
    name: "Whisperwood Bow",
    cost: 1200,
    tier: 2,
    components: ["steel", "boots"],
    tags: ["farmSpeed"],
    damage: 14,
    attackSpeed: 0.25,
  },
  // --- tier 3 --------------------------------------------------------------------------
  {
    id: "fang",
    name: "Vampire Fang",
    cost: 1300,
    tier: 3,
    components: ["blade"],
    tags: ["sustain"],
    damage: 14,
    lifesteal: 0.15,
  },
  {
    id: "heart",
    name: "Treant Heart",
    cost: 1500,
    tier: 3,
    components: ["plating", "plating"],
    tags: ["sustain"],
    hp: 420,
  },
  {
    id: "tome",
    name: "Ember Tome",
    cost: 1200,
    tier: 3,
    components: ["orb"],
    tags: [],
    power: 0.25,
    mana: 100,
  },
  {
    id: "staff",
    name: "Voidglass Staff",
    cost: 1600,
    tier: 3,
    components: ["orb", "plating"],
    tags: [],
    power: 0.35,
    hp: 120,
    mana: 200,
  },
  {
    id: "nullstone",
    name: "Nullstone Amulet",
    cost: 1300,
    tier: 3,
    components: ["plating", "orb"],
    tags: ["armor"],
    hp: 150,
    magicResist: 0.2,
  },
  {
    id: "aegis-cloak",
    name: "Warden's Cloak",
    cost: 1400,
    tier: 3,
    components: ["plating", "orb"],
    tags: [],
    hp: 260,
    armor: 4,
    power: 0.1,
    mana: 100,
  },
  // --- tier 4: situational (rule engine, spec/07 §4b) ----------------------------------
  {
    id: "pipe",
    name: "Pipe of Insight",
    cost: 1700,
    tier: 4,
    components: ["nullstone"],
    tags: ["aura"],
    hp: 150,
    auraMagicResist: 0.25,
  },
  {
    id: "blink",
    name: "Blink Dagger",
    cost: 1600,
    tier: 4,
    components: [],
    tags: ["mobility", "initiation"],
    blink: true,
    active: { cooldown: 15, trigger: "blink" },
  },
  {
    id: "mkb",
    name: "Monkey King Bar",
    cost: 2200,
    tier: 4,
    components: ["blade", "steel"],
    tags: ["trueStrike"],
    damage: 30,
    trueStrike: true,
  },
  {
    id: "bkb",
    name: "Black King Bar",
    cost: 2400,
    tier: 4,
    components: ["blade", "nullstone"],
    tags: ["spellImmunity"],
    damage: 10,
    hp: 100,
    spellImmunity: 6,
    active: { cooldown: 60, trigger: "spellImmunity" },
  },
  {
    id: "rapier",
    name: "Divine Rapier",
    cost: 3600,
    tier: 4,
    components: ["blade", "blade"],
    tags: [],
    damage: 110,
    dropOnDeath: true,
  },
  {
    id: "force",
    name: "Force Staff",
    cost: 1500,
    tier: 4,
    components: ["orb", "plating"],
    tags: ["save", "mobility"],
    power: 0.1,
    active: { cooldown: 18, trigger: "allySave" },
    manaRegen: 1,
  },
  {
    id: "eul",
    name: "Eul's Scepter",
    cost: 2000,
    tier: 4,
    components: ["orb", "orb"],
    tags: ["dispel"],
    power: 0.15,
    speed: 0.1,
    active: { cooldown: 22, trigger: "selfCleanse" },
    manaRegen: 1.5,
  },
]

export const itemById = (id: string): Item => {
  const i = ITEMS.find((x) => x.id === id)
  if (!i) throw new Error(`Unknown item ${id}`)
  return i
}

/** Recipe premium: full cost minus the components' cost. Always ≥ 0 (test). */
export const recipeCost = (id: string): number =>
  itemById(id).cost - itemById(id).components.reduce((s, c) => s + itemById(c).cost, 0)

/**
 * Components still missing to complete `id`, honouring multiplicity, given
 * the owned multiset. Basic items return [] when owned once.
 */
export const missingComponents = (owned: readonly string[], id: string): string[] => {
  const want = [...itemById(id).components]
  const have = [...owned]
  const missing: string[] = []
  for (const c of want) {
    const i = have.indexOf(c)
    if (i >= 0) have.splice(i, 1)
    else missing.push(c)
  }
  // Cheapest first: smooth power curve, deterministic tiebreak by id.
  return missing.toSorted((a, b) => itemById(a).cost - itemById(b).cost || (a < b ? -1 : 1))
}

/** Items whose components consume `id` (test-only reverse edge helper). */
export const itemsUsing = (id: string): readonly Item[] =>
  ITEMS.filter((i) => i.components.includes(id))

export const BUILD: Readonly<Record<Role, readonly string[]>> = {
  carry: ["boots", "bow", "blade", "fang", "blade", "heart"],
  mid: ["boots", "tome", "charm", "staff", "tome", "heart"],
  offlane: ["boots", "plate", "heart", "blade", "aegis-cloak", "plate"],
  jungle: ["boots", "fang", "plate", "blade", "heart", "blade"],
  support: ["boots", "charm", "aegis-cloak", "tome", "heart", "staff"],
}

export const MAX_ITEMS = 6
