/**
 * Inventory zones + mute (spec/10 Layer 1).
 *
 * Pure data + pure functions: the match owns the clock and calls these with
 * `t` (seconds). No RNG, no globals. Slot order is deterministic
 * (first free slot, ascending).
 *
 * Zones:
 *   main     6 slots — stats + actives live (unless muted)
 *   backpack 3 slots — inert; swapping to main mutes for BACKPACK_MUTE_S
 *   neutral  1 slot  — always active; tier gated by game time
 *   stash    6 slots — at base; net worth but not combat power until delivered
 */
import { type Item, ITEMS, itemById } from "./items.ts"

export const MAIN_SLOTS = 6
export const BACKPACK_SLOTS = 3
export const STASH_SLOTS = 6
/** Swapping backpack → main (or main → backpack) mutes the item this long. */
export const BACKPACK_MUTE_S = 6

export interface HeroInventory {
  /** Item ids; null = empty slot. */
  main: (string | null)[]
  /** Absolute clock time (s) until which the main-slot item is muted. */
  mainMute: number[]
  backpack: (string | null)[]
  neutral: string | null
  /** Absolute clock time (s) until which the neutral item is muted. */
  neutralMute: number
  stash: (string | null)[]
}

export const emptyInventory = (): HeroInventory => ({
  main: Array.from({ length: MAIN_SLOTS }, () => null),
  mainMute: Array.from({ length: MAIN_SLOTS }, () => 0),
  backpack: Array.from({ length: BACKPACK_SLOTS }, () => null),
  neutral: null,
  neutralMute: 0,
  stash: Array.from({ length: STASH_SLOTS }, () => null),
})

export const cloneInventory = (inv: HeroInventory): HeroInventory => ({
  main: [...inv.main],
  mainMute: [...inv.mainMute],
  backpack: [...inv.backpack],
  neutral: inv.neutral,
  neutralMute: inv.neutralMute,
  stash: [...inv.stash],
})

/** Items granting stats/actives at time t (main + neutral, minus muted). */
export const effectiveItems = (inv: HeroInventory, t: number): string[] => {
  const out: string[] = []
  inv.main.forEach((id, i) => {
    if (id !== null && (inv.mainMute[i] ?? 0) <= t) out.push(id)
  })
  if (inv.neutral !== null && inv.neutralMute <= t) out.push(inv.neutral)
  return out
}

/** All owned item ids across every zone (for net worth / "do I own X" checks). */
export const allItems = (inv: HeroInventory): string[] => [
  ...inv.main.filter((x): x is string => x !== null),
  ...inv.backpack.filter((x): x is string => x !== null),
  ...(inv.neutral !== null ? [inv.neutral] : []),
  ...inv.stash.filter((x): x is string => x !== null),
]

export const netWorthItems = (inv: HeroInventory): number =>
  allItems(inv).reduce((s, id) => s + lookupItem(id).cost, 0)

/** Free main-slot index, else free backpack index, else free stash index, else -1. */
const freeSlot = (inv: HeroInventory): number => {
  const m = inv.main.indexOf(null)
  if (m >= 0) return m
  const b = inv.backpack.indexOf(null)
  if (b >= 0) return MAIN_SLOTS + b
  const s = inv.stash.indexOf(null)
  return s >= 0 ? MAIN_SLOTS + BACKPACK_SLOTS + s : -1
}

/** Buy/receive an item. Returns false when every zone is full. */
export const addItem = (inv: HeroInventory, id: string): boolean => {
  const slot = freeSlot(inv)
  if (slot < 0) return false
  if (slot < MAIN_SLOTS) inv.main[slot] = id
  else if (slot < MAIN_SLOTS + BACKPACK_SLOTS) inv.backpack[slot - MAIN_SLOTS] = id
  else inv.stash[slot - MAIN_SLOTS - BACKPACK_SLOTS] = id
  return true
}

export const removeItem = (inv: HeroInventory, id: string): boolean => {
  const mi = inv.main.indexOf(id)
  if (mi >= 0) {
    inv.main[mi] = null
    inv.mainMute[mi] = 0
    return true
  }
  const bi = inv.backpack.indexOf(id)
  if (bi >= 0) {
    inv.backpack[bi] = null
    return true
  }
  if (inv.neutral === id) {
    inv.neutral = null
    inv.neutralMute = 0
    return true
  }
  const si = inv.stash.indexOf(id)
  if (si >= 0) {
    inv.stash[si] = null
    return true
  }
  return false
}

/** Swap a backpack item into a main slot (or an empty main slot picks the backpack item). */
export const swapToMain = (inv: HeroInventory, id: string, t: number): boolean => {
  const bi = inv.backpack.indexOf(id)
  if (bi < 0) return false
  const mi = inv.main.indexOf(null)
  if (mi < 0) return false
  inv.main[mi] = id
  inv.mainMute[mi] = t + BACKPACK_MUTE_S
  inv.backpack[bi] = null
  return true
}

/** First backpack item that fits an empty main slot (used when main is underfull). */
export const promoteFirstBackpack = (inv: HeroInventory, t: number): boolean => {
  const id = inv.backpack.find((x): x is string => x !== null)
  return id !== undefined && swapToMain(inv, id, t)
}

// --- neutral items (spec/10 Layer 1: stat-mod pool, ≤1 tag, no actives) --------------------

export const NEUTRAL_TIERS: readonly (readonly string[])[] = [
  ["n-trinket", "n-charm-luck"],
  ["n-belt-vigor", "n-grove-veil"],
  ["n-psi-blade", "n-vampire-fang"],
  ["n-spy-goggles", "n-stone-guard"],
  ["n-apex-power", "n-seer-stone"],
]

/** Tier index unlocked at each gate (game minutes, spec/10 review resolution 2). */
export const NEUTRAL_TIER_GATES: readonly number[] = [0, 6, 12, 18, 24]

export const unlockedTier = (gameMinutes: number): number => {
  let tier = 0
  NEUTRAL_TIER_GATES.forEach((g, i) => {
    if (gameMinutes >= g) tier = i
  })
  return tier
}

export const NEUTRAL_ITEMS: readonly Item[] = [
  { id: "n-trinket", name: "Keen Trinket", cost: 0, power: 0.06 },
  { id: "n-charm-luck", name: "Charmer's Luck", cost: 0, lifesteal: 0.04 },
  { id: "n-belt-vigor", name: "Belt of Vigor", cost: 0, hp: 140 },
  { id: "n-grove-veil", name: "Grove Veil", cost: 0, magicResist: 0.08 },
  { id: "n-psi-blade", name: "Psi Blade", cost: 0, damage: 14 },
  { id: "n-vampire-fang", name: "Vampire Fanglet", cost: 0, lifesteal: 0.08 },
  { id: "n-spy-goggles", name: "Spy Goggles", cost: 0, attackSpeed: 0.15 },
  { id: "n-stone-guard", name: "Stone Guard", cost: 0, armor: 4 },
  { id: "n-apex-power", name: "Apex Power", cost: 0, damage: 26 },
  { id: "n-seer-stone", name: "Seer Stone", cost: 0, power: 0.18 },
]

const neutralItemById = (id: string): Item => {
  const i = NEUTRAL_ITEMS.find((x) => x.id === id)
  if (!i) throw new Error(`Unknown neutral item ${id}`)
  return i
}

/**
 * Resolve a lookup across shop + neutral items. Used by `recomputeStats`
 * and anything reading item stats by id.
 */
export const lookupItem = (id: string): Item =>
  id.startsWith("n-") ? neutralItemById(id) : itemById(id)

/** Pick the neutral item for a camp kill at time t. No RNG: rotating index. */
export const rollNeutralDrop = (
  gameMinutes: number,
  campIndex: number,
  current: string | null,
): string | null => {
  if (current !== null) return null
  const tier = unlockedTier(gameMinutes)
  const pool = NEUTRAL_TIERS[tier]
  if (!pool) return null
  return pool[campIndex % pool.length] ?? null
}

/** Count of items across zones (for full-inventory checks). */
export const countItems = (inv: HeroInventory): number => allItems(inv).length

// Shop items never appear in neutral pools and vice versa (test-enforced).
export const SHOP_IDS: readonly string[] = ITEMS.map((i) => i.id)
