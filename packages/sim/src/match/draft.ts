/**
 * Draft — pure state machine for ban/pick, plus the AI coach that drafts for CPU teams.
 *
 * Order (TFM / captains-mode-lite): 4 bans (B R B R), then picks B1 R1 R2 B2 B3 R3 R4 B4 B5 R5.
 * Each pick is assigned to one of that side's players (by role, then mastery).
 */
import { HEROES, type HeroDef, type Role, heroDef } from "./heroes.ts"
import { type Player, type TeamDef, masteryOf } from "./teams.ts"

export type DraftSide = "blue" | "red"
export type DraftAction = { readonly side: DraftSide; readonly kind: "ban" | "pick" }

export const DRAFT_ORDER: readonly DraftAction[] = [
  { side: "blue", kind: "ban" },
  { side: "red", kind: "ban" },
  { side: "blue", kind: "ban" },
  { side: "red", kind: "ban" },
  ...(["blue", "red", "red", "blue", "blue", "red", "red", "blue", "blue", "red"] as const).map(
    (side) => ({
      side,
      kind: "pick" as const,
    }),
  ),
]

export interface Pick {
  readonly heroId: string
  readonly playerId: string
}

export interface DraftState {
  readonly blue: TeamDef
  readonly red: TeamDef
  readonly bans: readonly { readonly side: DraftSide; readonly heroId: string }[]
  readonly picks: Readonly<Record<DraftSide, readonly Pick[]>>
  /** Index into DRAFT_ORDER; === length when complete. */
  readonly step: number
}

export const createDraft = (blue: TeamDef, red: TeamDef): DraftState => ({
  blue,
  red,
  bans: [],
  picks: { blue: [], red: [] },
  step: 0,
})

export const currentAction = (d: DraftState): DraftAction | null => DRAFT_ORDER[d.step] ?? null
export const isComplete = (d: DraftState) => d.step >= DRAFT_ORDER.length

export const unavailable = (d: DraftState): ReadonlySet<string> =>
  new Set([
    ...d.bans.map((b) => b.heroId),
    ...d.picks.blue.map((p) => p.heroId),
    ...d.picks.red.map((p) => p.heroId),
  ])

export const available = (d: DraftState): readonly HeroDef[] => {
  const used = unavailable(d)
  return HEROES.filter((h) => !used.has(h.id))
}

const teamOf = (d: DraftState, side: DraftSide) => (side === "blue" ? d.blue : d.red)

/** Players on `side` who don't have a hero yet. */
export const openPlayers = (d: DraftState, side: DraftSide): readonly Player[] => {
  const taken = new Set(d.picks[side].map((p) => p.playerId))
  return teamOf(d, side).players.filter((p) => !taken.has(p.id))
}

/** Best open player for a hero: role fit first, then mastery. */
export const assignPlayer = (d: DraftState, side: DraftSide, heroId: string): Player => {
  const hero = heroDef(heroId)
  const open = openPlayers(d, side)
  const score = (p: Player) => (hero.roles.includes(p.role) ? 2 : 0) + masteryOf(p, heroId)
  return [...open].toSorted((a, b) => score(b) - score(a))[0]!
}

export type DraftError = "draft-complete" | "hero-unavailable" | "wrong-player"

/** Apply the current action. `playerId` optional for picks (auto-assigned if omitted). */
export const applyDraft = (
  d: DraftState,
  heroId: string,
  playerId?: string,
):
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly error: DraftError } => {
  const action = currentAction(d)
  if (!action) return { ok: false, error: "draft-complete" }
  if (unavailable(d).has(heroId) || !HEROES.some((h) => h.id === heroId))
    return { ok: false, error: "hero-unavailable" }
  if (action.kind === "ban") {
    return {
      ok: true,
      state: { ...d, bans: [...d.bans, { side: action.side, heroId }], step: d.step + 1 },
    }
  }
  const player = playerId
    ? openPlayers(d, action.side).find((p) => p.id === playerId)
    : assignPlayer(d, action.side, heroId)
  if (!player) return { ok: false, error: "wrong-player" }
  const picks = {
    ...d.picks,
    [action.side]: [...d.picks[action.side], { heroId, playerId: player.id }],
  }
  return { ok: true, state: { ...d, picks, step: d.step + 1 } }
}

// --- AI coach -----------------------------------------------------------------------

const ROLE_ORDER: readonly Role[] = ["carry", "mid", "offlane", "jungle", "support"]

/** Value of a hero to `side` right now: best open-player comfort + role need + style fit. */
const pickValue = (d: DraftState, side: DraftSide, hero: HeroDef) => {
  const open = openPlayers(d, side)
  const need = new Set(open.map((p) => p.role))
  const fits = open.filter((p) => hero.roles.includes(p.role))
  if (fits.length === 0 && need.size > 0) return -1
  const comfort = Math.max(
    ...(fits.length ? fits : open).map((p) => masteryOf(p, hero.id) * (0.6 + p.skill / 40)),
  )
  const style = teamOf(d, side).style
  const hasCC = [...hero.skill.effects, ...hero.ultimate.effects].some(
    (e) => e.type === "stun" || e.type === "root",
  )
  const aoeUlt = hero.ultimate.target.kind.includes("aoe")
  const styleBonus =
    (style === "teamfight" && aoeUlt ? 0.15 : 0) +
    (style === "aggressive" && hero.speed >= 3.2 ? 0.12 : 0) +
    (style === "pick" && hasCC ? 0.12 : 0) +
    (style === "macro" && hero.roles.includes("offlane") ? 0.06 : 0)
  return comfort + styleBonus
}

/** Value of denying a hero from the *enemy* of `side`. */
const banValue = (d: DraftState, side: DraftSide, hero: HeroDef) => {
  const enemy: DraftSide = side === "blue" ? "red" : "blue"
  return pickValue(d, enemy, hero)
}

/** Deterministic AI choice for the current action (ties broken by roster order). */
export const aiChoose = (d: DraftState): string => {
  const action = currentAction(d)
  if (!action) throw new Error("draft complete")
  const pool = available(d)
  const value =
    action.kind === "ban"
      ? (h: HeroDef) => banValue(d, action.side, h)
      : (h: HeroDef) => pickValue(d, action.side, h)
  let best = pool[0]!
  let bestV = -Infinity
  for (const h of pool) {
    const v = value(h)
    if (v > bestV) {
      bestV = v
      best = h
    }
  }
  return best.id
}

/** Lane assignment derived from roles: carry+support bot (radiant safe), mid mid, offlane top, jungle jungle. */
export const laneForRole = (role: Role): "top" | "mid" | "bot" | "jungle" =>
  role === "mid" ? "mid" : role === "offlane" ? "top" : role === "jungle" ? "jungle" : "bot"

export { ROLE_ORDER }
