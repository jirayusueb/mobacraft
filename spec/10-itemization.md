# Itemization & Inventory Architecture (spec/10)

Production itemization for Match Day: items as abilities, counter-play, timing
spikes, and an economy — not stat sticks. Extends spec/07 §4 (builds.ts rule
engine) and spec/06 (tactics). All new code lives in `@mobacraft/sim` as pure
modules; the renderer/HUD only reads the match snapshot.

Status: PASS after fresh-context review (CONCERNS → resolved below).
Implementation: S1–S6 landed (inventory, DAG, courier, item AI, actives
S5a/S5b, late-game + comeback); see the slice list for commits.

**Scope override:** this spec supersedes spec/06's out-of-scope list for
_buyback reserve, couriers, and neutral items_. All other spec/06 deferrals
(TP scrolls, 3D wards, fog filtering) remain deferred.

**Time units:** every threshold below is in **game-minutes** (match clock),
and compressed to our 12–25 min match scale (spec/06 40-min cap). Late-game
slot management fires at **t ≥ 20 game-min**.

## Current state (what exists)

- `items.ts`: 17 flat items, stat fields only (`hp/damage/power/...`), three
  behavioral flags (`trueStrike`, `blink`, `spellImmunity`), `BUILD` per role,
  `MAX_ITEMS = 6`.
- `builds.ts`: `ITEM_RULES` (conditional must-buy / buy-before / risk-buy),
  `choosePurchase` with `PurchaseView`, sell-to-make-room already stubbed
  (`soldItemId`).
- `match.ts`: gold-by-source, `netWorthOf`, shopping intent (walk to base,
  `on-item` timing preset), purchases log.
- `hero-systems.ts`: `observe()` already triggers BKB at fight start;
  `purchase(view)`, `onDeath(key, items)` hooks exist.

## Layer 1 — Inventory & slot architecture

Four zones with different rules, replacing the flat `items: string[]`:

```ts
interface HeroInventory {
  main: ReadonlyArray<string | null> // 6 slots — stats + actives live
  backpack: ReadonlyArray<string | null> // 3 slots — inert (no stats, no actives)
  neutral: string | null // 1 slot  — always active (same as main)
  stash: ReadonlyArray<string | null> // 6 slots — at base; merges for recipes still work
}
```

Rules, implemented in `sim/match/inventory.ts` as pure functions + a reducer.

- **Stats/actives read from `main` + `neutral` only** (neutral is always
  active — Dota 7.x behaviour). `statMods`, `aura`, `blinkReach`,
  `spellImmunity` etc. all take the _effective item set_, a derived value —
  never read slots directly.
- **Backpack mute**: moving backpack → main applies a 6 s `muteUntil` stamp on
  that item; a muted item grants nothing and cannot activate. Timer ticks with
  the match clock (deterministic).
- **Neutral slot**: tiers 1–5 gated by game time (**0/6/12/18/24 min**).
  Neutral items are a **small stat-mod pool** (stats + at most 1 tag, no
  actives), drawn when a neutral camp dies; at most one per hero; tier
  unlocks announce via the comms feed.
- **Stash + courier**: buying away from the shop range routes the item to
  `stash`; an automatic courier ferries stash → hero (travel time = distance /
  speed along the lane graph). S3 ships delivery-delay only; courier killing
  (items return to stash, 30 s respawn — a timing-loss event) is **S3b,
  optional follow-up**. Buyback of _timing_ is the whole point: an item in
  the stash or on the courier is net worth but not combat power.

## Layer 2 — Data-driven recipes, tags & modifiers

Rewrite `items.ts` as a **DAG** — topological order validated by test; cycles fail `make test`.

```ts
interface Item {
  id: string
  cost: number
  components: readonly string[] // recipe; cost of recipe = cost - Σ components
  stats: Partial<StatBlock> // applies only when in main/neutral
  tags: readonly ItemTag[] // strategic vocabulary for AI (below)
  active?: ActiveDef // cooldown, castRange, targeting, effect
  tier: 1 | 2 | 3 | 4 | 5 // shop UX + sell-order heuristic
  disassemblable?: boolean
  charges?: number // consumables
}
type ItemTag =
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
```

- **Auto-combine**: when a hero's effective inventory + stash contains all
  components and gold ≥ recipe cost, the combine fires automatically.
  **Locking & disassemble are deferred** (pro-player texture that preset
  builds can't express; revisit if builds become freeform). `disassemblable`
  stays on the data shape, unused.
- **Modifiers**: stats flow through the existing `statMods` seam as stacked
  modifiers (additive flat + multiplicative percent), so auras, item stats and
  hero facets compose in one place.
- **Migration (breaking, owned by S2):** this _replaces_ the flat `items.ts`
  shape; it does not extend it. Every `Item` consumer changes:
  `builds.ts` (`PurchaseView` gains zones + effective set,
  `choosePurchase`/`makeRoom`/`activeRule` new signatures — see Layer 3),
  `hero-systems.ts` (`items` arguments become effective sets), `match.ts`
  (`HeroState.items` → `HeroInventory`). **Sell policy unified** to one rule:
  consumables first, then lowest tier, then cheapest cost, then item-id
  tiebreak — `makeRoom`'s "cheapest non-rule item" heuristic is deleted and
  its tests updated in the same slice.

## Layer 3 — Dynamic itemization AI

Replaces the static `BUILD` with a **skeleton + scoring** model
(`sim/match/item-ai.ts`):

1. **Core skeleton** per role (2–3 fixed early items): carry = farm item →
   survivability → damage; support = boots → save item → utility.
2. **Scoring every candidate item** each purchase decision:
   `score = roleWeight·item + threatResponse·item + timingCurve(t, item)
   − cost/affordability + buildlock`. Skeleton items get a large early bonus
   so early game still looks sane.
3. **Threat-response scan every 120 s** over _visible_ enemy data only
   (respects spec/06 vision + spec/08 fog): enemy items seen (courier kills,
   fights observed), enemy ability tags from `matrix.ts`. Examples wired as
   scoring rules, not hardcoded purchases: enemy `evasion` → `mkb` score ×N;
   enemy heavy disable/magic → `bkb` to top; enemy `invisBurst` hero → support
   `forceStaff`/`glimmerCape` jumps the queue.
   **Rule-engine compatibility (S4 gate):** the existing `ITEM_RULES` are
   first-match-wins priority rules (Rapier > MKB > Pipe > Blink, `blocked()`
   buy-before semantics) with spec/07 tests. The scoring engine must be a
   _wrapper that preserves them_: before scoring, the current `activeRule`
   is evaluated exactly as today; if one fires, its item wins outright
   (hard override, not a term). Scoring only picks when no rule fires.
   Acceptance: **all spec/07 §4 rule tests pass unchanged**, plus a new test
   that buy-before ordering survives.
4. **Buyback reserve (gold floor only — no respawn-buyback mechanic yet):**
   `buybackCost(level) = 150 + 25 × level` gold (tuned to our economy; Dota's
   dead-time term is deliberately simplified). When `t ≥ 15 game-min` or any
   Tier-3 tower falls, a purchase that would drop gold below the floor is
   deferred unless the item is a hard-override rule item. Late game the IGL
   may raise the floor ("save for buyback" tactic). Real buyback (early
   respawn) is a separate future system, not this spec.

**Determinism:** the item AI uses **no RNG**. Candidate choice is argmax with
tiebreak (score → lower cost → item id). Per-tick processing order is hero id
ascending; auto-combine evaluates heroes in the same order; the 120 s threat
scan runs once per team, blue then red. Courier pathing follows the lane
graph A* already used by creeps. Courier kill targeting (S3b only) would be the
nearest visible enemy hero within 3 tiles, tiebreak by unit id.

## Layer 4 — Active item tactical triggers

**Ownership (aligned 2026-11-17):** the BKB, Blink, Force Staff and Eul's actives
are **already implemented by spec/09 Hero Think** — effects in `match.ts`
(`microItems`, spell immunity `st.immune`, cyclone `st.cyclone`, `displace`),
trigger logic in the pure `think/combat.ts` (`defensiveTrigger`,
`initiatorEngage`, `blinkLanding`, `awayFrom`). spec/10 does **not** add a second
active system. Layer 4 owns only: the `ActiveDef` data on items (cooldown +
trigger family, read by the spec/09 code), new families that spec/09 lacks
(Manta-style root/silence self-cleanse, Glimmer, Tango, ward placement), and
any trigger refinement — added as new branches of `defensiveTrigger` /
`microItems`, with `think/think.test.ts` cases. The rows below for BKB, Blink,
Eul's and Force are the **target refinements** over spec/09's current triggers;
spec/09's thresholds stay authoritative until a refinement lands with a test.

| Family                | Trigger                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blink Dagger          | offensive: ≥2 allies ready + initiation ability off cooldown + enemy in 1200; defensive: HP < 30% and damage-free for 3 s → blink toward jungle                                                                                                          |
| BKB                   | on initiation cast (before combo); reactive when a disable projectile is in flight and ≥2 enemies within 600                                                                                                                                             |
| Manta / Eul's         | self-cleanse the instant Silence or Root lands (breaks the enemy combo)                                                                                                                                                                                  |
| Force Staff / Glimmer | support scans allies: stunned or HP < 35% → push/invis the ally out of enemy attack range                                                                                                                                                                |
| Tango                 | auto-eat when `maxHp − hp ≥ 115` AND not already regenerating AND charge off cooldown                                                                                                                                                                    |
| Wards                 | placement AI only for the **existing spec/06 ward system** (team stock 2 + 1/90 s, roam slot) — no ward items, no second economy. Offensive: darkest reachable tile in the zone the team is pushing (uses `vision.ts`); defensive: recent death location |

Cooldowns, mana costs, and the 6 s mute all gate activation. Every activation
appends to the comms feed ("Poppins used Blink Dagger"). The positional
Blink here **replaces** spec/07's "first engage ability reaches 10 tiles"
blink approximation — the old mechanic is deleted in S5b, not run alongside.
Implementation home for every active: spec/09's `microItems` (effects) and
`think/combat.ts` (when to fire) — one system, never two.

## Layer 5 — Economy & net worth

- `netWorthOf = gold + Σ effective items + backpack + stash + in-transit
  courier items` (change: include all zones, not just the 6 slots).
- **Comeback gold**: killing-blow bonus
  `comeback = gap ≥ 5000 ? min(0.05 × gap, 150) : 0` (gap = victimTeamNW −
  killerTeamNW), split evenly among killer + assists, so a single fight cannot
  flip the lead by itself. **S6 re-gate (16 AI games):** the drafted 10 % / 400
  cap stalled games to 32–34 min (both teams kept refunding each other's
  leads); 5 % / 150 / 5k gap keeps all 16 games at 14–25 min with both sides
  winning (11/5, identical to the pre-S6 baseline). Late-game slot actions
  _shorten_ stalled games (seed 15: 40-min cap → 32 min without comeback
  tuning).
- **Late-game slot management**, at t ≥ 20 game-min with 6/6 slots and gold surplus —
  sell by the unified rule (consumables first → lowest tier → cheapest → id
  tiebreak) for the 50 % sell price to open a slot for a luxury item, or buy
  slot-free consumable buffs (aghanimsBlessing, moonShard-consume) — these
  apply permanent stat mods with zero slots.
- **Snapshot:** the match snapshot carries the full per-hero inventory (all
  zones + mute timers) every tick — ~16 short strings/hero, trivially small,
  and the HUD needs mute timers. Graphs keep the 5 s `history` sampling; no
  diff events.

## Slices (each lands with tests + evidence)

1. **S1 Inventory zones + mute + net worth across zones** — pure
   `inventory.ts`, reducer tests, `bun test` green; snapshot shows per-zone
   items in HUD.
2. **S2 Recipe DAG + auto-combine (breaking migration)** — items rewritten as
   DAG; cycle + combine tests; every consumer (`builds.ts`,
   `hero-systems.ts`, `match.ts`) migrated; unified sell policy replaces
   `makeRoom` heuristic.
3. **S3 Stash + courier (delivery-delay only)** — travel model on the lane
   graph, purchase-timing history evidence in the results graph. Courier
   killing is **S3b, optional later** — cut from first landing.
4. **S4 Item AI: skeleton + threat scoring + buyback floor** — hard rule
   override wraps scoring; acceptance = all spec/07 §4 rule tests unchanged
   - buy-before ordering test + new scenario tests (enemy evasion → mkb).
5. **S5a Self-target actives** — BKB and Eul's already ship via spec/09 Hero
   Think (`think/combat.ts` + `microItems`); S5a adds only Manta-style
   root/silence self-cleanse and Tango as new `defensiveTrigger` branches,
   with deterministic trigger tests. **S5b Targeted-other + positional
   actives** — Force saves and positional Blink also ship via spec/09; S5b adds
   Glimmer, ward placement AI, and deletes spec/07's `blinkReach`
   approximation in `hero-systems.ts` (no longer read by the match).
6. **S6 Late-game slot & asset management + comeback gold + balance re-gate.**

Dependency rules unchanged: everything is `@mobacraft/sim` pure code; engine
renders icons only; web HUD reads the snapshot.

## Review resolutions (fresh-context review, verdict CONCERNS → resolved)

1. Spec/06 out-of-scope conflict → explicit supersede statement at top.
2. Time-scale bug → all thresholds in game-minutes, compressed gates
   0/6/12/18/24; late-game at t ≥ 20.
3. Neutral-slot inline question → always active; question deleted.
4. "Extension" claim → owned as breaking migration with consumer list;
   sell policies unified into one rule.
5. Rule-engine semantics → hard-override wrapper; spec/07 tests gate S4.
6. Determinism → no RNG in item AI, argmax + (score, cost, id) tiebreak,
   fixed processing orders, lane-graph courier path.
7. Buyback → gold floor only (`150 + 25 × level`); real buyback deferred.
8. Wards → spec/06 stock model kept; Layer 4 is placement AI only.
9. Lock/disassemble provenance → feature deferred entirely (10b).
10. Complexity cuts: courier kill → S3b optional; lock/disassemble deferred;
    backpack+mute kept; neutral items = stat-mod pool, ≤1 tag, no actives.
11. S5 split into S5a/S5b; Blink replacement made explicit.
12. Comeback formula + cap specified; spec/06 balance gate re-run in S6.
13. Tango trigger needs regen-awareness + cooldown.
14. Snapshot carries full inventory per tick; no diffing.
