# Hero Think — milestone 6 spec (Pure Hero AI Loop)

Phase: **Production slice** on top of Match Day (05), Tactics (06), Hero Systems (07)
and Fog of War (08). Goal: every hero decides like a pro _without_ a coach: each
tick it reads itself and the (fogged) world, scores 5 macro activities by role and
power curve, reserves its target on a team blackboard, and drops into a tactical
combat tree when enemies are in reach. The old ad-hoc `think()` in `match.ts` is
**replaced**; coach calls, IGL calls, phase plans and sliders become **score
biases**, never hard overrides (user decision).

User decisions (2026-11-16): light mana pool added · BKB/Blink made active, Force
Staff + Eul's Scepter added · single-target/line spells become travelling
projectiles (12 tiles/s) · full replacement of `think()`.

Units: 1 tile ≈ 120 Dota units (hero attack range 5 tiles ≈ 600). "400 units" = 3.3 tiles.

## Flow per hero (every rethink, 0.3–0.8 s by `sense`)

```
[Layer 1 Awareness: self + fogged world] → [Layer 2 Macro: 5 scores × role/curve/biases]
→ [Layer 4 Blackboard: claim target / camp / lane] → act (goal + intent)
Every tick while enemies are within 9 tiles → [Layer 3 Micro-Combat tree]
```

## Layer 1 — Self & World Awareness (`think/awareness.ts`, pure)

All values 0..1.

- **Survival Readiness** `S = 0.55·hp% + 0.2·mana% + 0.25·D`, where `D` = ready
  fraction of owned escape/defence actives (BKB, Blink, Force Staff, Eul's); a hero
  owning none has `D = 0.3`.
- **Kill Potential** `K` vs one enemy: `burst / effectiveHp`, clamped. `burst` =
  damage of the ready ult (if level ≥ 6 and mana allows) + ready skill (if mana
  allows) × ability power + 3 s of basic attacks. `effectiveHp` = last-known hp ×
  armour/magic-resist mitigation. Best `K` over enemies known (visible or ghost
  < 6 s old) within 25 tiles is `K*`. `hasDisable` = skill or ult has stun/root.
- **Threat Map** (`think/influence.ts`): per team, a 16×16 grid (8×8-tile cells)
  recomputed with the fog (0.5 s). Danger contributions, summed then clamped to 1:
  - live enemy tower: 0.6 in its cell and cells whose centre is ≤ tower range + 2;
  - visible enemy hero: `0.25·(1 + level/10)` at its cell, half to neighbours;
  - **missing enemy** (ghost gone dark `age` s ago, age ≤ 20): `0.35·(1 − age/20)`
    spread over cells within `min(3, 1 + age·speed/8)` cells of the ghost — the
    "he vanished from the minimap near there" spike.
    Readers only see their own team's map. No live enemy body ever feeds it except via
    `TeamKnowledge` (spec/08 §3).
- **Item Timing Delta**: `delta = cost(nextCoreItem) − gold` (≥ 0) and
  `closeness = 1 − clamp(delta / cost, 0, 1)`; no next item → closeness 0.

## Layer 2 — Macro Utility Scoring (`think/macro.ts`, pure)

Five actions, each 0..1 before biases:

| Action      | Formula                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `farm`      | `safety(spot) × (0.35 + 0.65·closeness) × W.farm × curveGreed`                |
| `gank`      | `K(target) × isolation(target) × (hasDisable ? 1 : 0.55) × W.gank × ultBoost` |
| `fight`     | `min(1, alliesFighting/2) × readiness / (1 + dist/15) × W.fight × blinkBoost` |
| `objective` | `pushPower × farSide × W.split` (split) or team objective (see plans)         |
| `retreat`   | `max((1 − S) × min(1, 0.35 + nearEnemies/2 + danger), regenNeed)`             |

- `safety(spot) = 1 − danger(spot)` (own threat map). Spot = slot lane front in
  laning; afterwards the best unclaimed lane/own camp by `safety / (1 + dist/30)`.
- `curveGreed` = `powerAt(+10 Dota min) / powerAt(now)` clamped [0.8, 1.4]: hard
  carries feel richer later, snowballers less.
- `isolation = 1 − min(1, alliesOfTarget(≤ 10 tiles)/2)`; target = best `K·isolation`
  known enemy within 30 tiles. `ultBoost` = 1.4 when ult ready and level ≥ 6.
- `alliesFighting` = allies within 30 tiles whose intent is `fight` with a known enemy
  within 9 tiles of them; `readiness` = mean(ult ready, skill ready, mana% ≥ 0.4);
  `blinkBoost` = 1.3 with Blink ready.
- `pushPower = min(1, attackDps·structMul / 60)` (structMul 1.2 with Building Damage);
  `farSide = min(1, knownEnemiesFarFromLane / 4)` where far = > 35 tiles from the
  split lane front.
- `regenNeed` = 0.85 if hp < 25 %; 0.6 if mana < 15 % and nothing castable; else 0.
  Spec example: skills on cooldown + hp < 35 % + BKB on cooldown + an enemy near →
  `S ≤ 0.3` → retreat ≥ 0.7, which beats every other unbiased action (test).
- **Role weights `W`** (carry, mid, offlane, jungle, support):
  farm 1.0/0.8/0.6/0.7/0.25 · gank 0.35/0.7/0.55/0.9/0.6 · fight 0.6/0.8/0.95/0.8/0.85 ·
  split 0.8/0.5/0.4/0.45/0.1. Tags: `initiator` gank/fight ×1.2; `follow-up`
  fight ×1.1; `building-damage` or `global` split ×1.3; `global` gank ×1.2.
- **Commitment**: the current action gets +0.1 (anti flip-flop). Retreat holds until
  hp ≥ 80 % and mana ≥ 40 %, or the hero reaches the fountain and is topped up.
- Choice = argmax after biases; ties → order retreat, fight, gank, objective, farm.

### Biases (coach, IGL, plans, sliders) — multipliers, never overrides

- Coach call (only heroes that rolled `followCoach`): `group`/`push` → objective
  (team mode) ×1.8, fight ×1.2, farm ×0.5 · `safe` → retreat +0.25, gank ×0.5 ·
  `farm` → farm ×1.8 · `roshan` (alive) → objective (Roshan mode) ×2.
- IGL call (followers): `gank` → gank on that target ×1.6 · `defend` → objective
  (defend mode at the spot) ×1.6 · `back` → retreat +0.4 · `push`/`group` → objective
  ×1.6.
- Plans: laning `aggressive` gank ×1.2 · `roam` gank ×1.4 for roam/jungle slots ·
  `scale` farm ×1.3, retreat +0.05. Mid `group` objective ×1.4 · `split` core's split
  ×1.6 · `pickoff` gank ×1.5 · `farm` farm ×1.5. Late `siege` objective ×1.6 ·
  `roshan` Roshan mode when ≥ 4 alive · `defend` defend mode until ≥ 2 enemies dead.
  Anti-stall (25:00) unchanged.
- Sliders: aggression `a` → gank & fight ×(0.7 + 0.6·a/100), retreat ×(1.3 − 0.6·a/100);
  farm priority `f` → farm ×(0.7 + 0.6·f/100).
- Laning phase: objective is never `split`; roamers (`roam` slot) farm weight ×0.3.

Objective modes: `split` (core only: lane farthest from known enemies), `team`
(spec/06 `objectiveFor` with gather-on-lead), `roshan`, `defend`. Shop and ward
(spec/06) stay as preconditions before scoring.

## Layer 3 — Micro-Combat & Ability Logic (`think/combat.ts`, pure helpers)

Runs every tick for a hero with intent `fight`/`gank`/`save` or any known enemy hero
within 9 tiles.

**Positioning ring** (from archetype + attack kind):

- _Melee initiator_ (`initiator` tag, melee): until engaging, hold 9–11 tiles from the
  nearest known enemy hero (outside their 8-tile hero vision). Engage when Blink or a
  disable is ready **and** (`fight` with ≥ 1 ally within 10 tiles, or `gank`): Blink
  to ≤ 1.5 tiles of the target (range 10), then chain the disable.
- _Ranged carry / caster_: kite. If the closest enemy hero within `range·0.6` is
  melee, step along the sum of unit vectors away from enemies within 6 tiles (stop
  when at `range·0.95`); attack only when the attack cooldown is ready (orb-walk).
- Others: chase as today.

**Combo & item chaining** (in this order each tick):

1. _Defensive trigger_ — an enemy spell projectile aimed at me within 3.3 tiles
   (400 u) AND hp < 60 % → BKB if ready, else Eul's (self-cyclone 2.5 s). hp < 25 %
   with an enemy hero within 4 tiles → Force Staff (6 tiles away from the threat) or
   Blink 8 tiles toward the fountain.
2. _Pre-fight buff_ — on entering a fight (known enemy hero ≤ 7 tiles): self
   buff/shield abilities; BKB for carry/mid when ≥ 2 enemy heroes ≤ 7 tiles.
3. _Disable lock_ — a stun/root cast on a target whose remaining stun/root is > the
   projectile travel time + 0.3 s is **held** (chain-stun); AoE disables wait unless
   at least one hero in the area is free or nearly free.
4. Ult, then skill (spec/06 ult discipline unchanged), targeting the blackboard lock.

## Layer 4 — Hero-to-Hero Sync (`think/blackboard.ts`)

One `Blackboard` per team (deterministic Maps, insertion-ordered):

- **Target lock**: when an `initiator`-tagged or any hero lands a stun/root on an enemy
  hero (or blinks onto it), `lock = { target, by, until: t + 4 }`. Heroes within 12
  tiles get **+50 % on the hero part of their target score** for that target, and
  enemy-targeted casts prefer it.
- **Save**: every think, supports (`role` support or ally-targeted ability) see each
  ally core (carry/mid; any ally if none) with hp < 25 % and a known enemy hero within
  8 tiles → `save` score 1.0 (beats every unbiased action). Intent `save`: move to the
  ally; cast ally/ally-aoe heal/shield on them, or Force Staff them away. One saver
  per ally (claimed).
- **Reservation**: claims `{ key, heroId, until }` with keys `camp:<id>`,
  `lane:<id>`, `gank:<enemyId>` (max 2 per gank), `save:<allyId>`. Claims expire after
  8 s unless renewed by the claimant's think; dead heroes release theirs. A hero picks
  the best **unclaimed** camp/lane, so two heroes never farm the same camp.

## Mana, items, projectiles (sim changes)

- **Mana**: `maxMana = 220 + 32·(level−1) + items.mana`, regen `2.5 + 0.25·level`
  per s (+items), fountain 12 %/s. Costs: skill `round(35 + 3·cooldown)`, ult
  `round(90 + 1.2·cooldown)`. No mana → no cast. Items: charm +150 mana, tome +100,
  staff +200, aegis-cloak +100, eul +1.5/s regen.
- **Actives** (new `active` field, cooldown per item):
  BKB 6 s spell immunity, cd 60 (immune to magic damage and stun/root/slow unless the
  caster has `bkb-piercing`) · Blink: teleport ≤ 10 tiles, cd 14 (3 s lockout after
  taking hero damage, as in Dota) · Force Staff (`force`, 1500 g, +150 hp, +1 mana/s):
  push 6 tiles, self or ally, cd 20 · Eul's (`eul`, 1650 g, +1.5 mana/s, +0.1 power):
  self cyclone 2.5 s, invulnerable and unable to act, cd 25.
- **Defensive purchase rule** (Hero Think, before the build book; one each, buying
  doesn't advance the book cursor): `initiator` melee → Blink as 2nd item; carry → BKB
  after 2 core items; support → Force Staff as 3rd item; mid → Eul's as 3rd item.
- **Projectiles**: `enemy` (range > 2.5, no dash) and `line` abilities spawn a
  projectile at 12 tiles/s. `enemy` homes on its target and resolves on arrival
  (dodged if target cycloned or dead; BKB blocks per above). `line` travels to its max
  range and hits each enemy within `width` of its path once. AoE/self/ally stay
  instant.

## Architecture

- New pure modules under `packages/sim/src/match/think/`: `awareness.ts`,
  `influence.ts`, `macro.ts`, `combat.ts`, `blackboard.ts`, `index.ts`. They take
  plain data views (no `Body`), so tests construct scenarios directly.
- `match.ts`: replaces `think()` with an adapter that builds `ThinkInput` from the hero
  and `knowledge[side]` (never raw enemy bodies), applies the decision; adds mana,
  item actives, projectiles, immunity/cyclone status, blackboard/claims, micro-combat
  hook in the hero tick. Snapshot `HeroLine` gains `mana`, `maxMana`, `think:
  { action, scores }`. Feed lines: "X blinks onto Y", "X saves Y", "BKB!" kept short.
- Web: intent label `save`; hero frame mana bar; nothing else required this slice.

## Failure / edge states

- No known enemies → gank/fight scores 0; fog-dark enemies are only ghosts.
- All camps claimed → farm uses lane; all lanes claimed → nearest lane anyway.
- Item actives on a dead/cycloned/stunned hero never fire (stun blocks items; BKB
  can't be used while stunned — matches Dota).
- Projectile target dies or is cycloned → projectile fizzles.
- Hero at full inventory → defensive item rule skipped.

## Acceptance (gate)

1. `make test` green. New pure tests: S/K/delta formulas; carry 300 g short of an
   item scores farm > gank; level-6 ganker with ult ready scores gank > farm on an
   isolated target; initiator with Blink+ult ready scores fight > farm when 2 allies
   fight; split-pusher picks objective(split) when 5 enemies are known far away;
   retreat example from the user spec; threat map spikes near a fresh ghost and
   decays; claims split two junglers across two camps; save score 1.0 for a 20 % carry;
   chain-stun holds while target stun > threshold; kite vector points away from a
   melee; defensive trigger BKB vs projectile at < 3.3 tiles and hp < 60 %.
2. Match tests: Blink/BKB/Force/Eul's each fire in seeded AI games; projectiles fly;
   mana spent; blackboard locks produce focus; determinism.
3. Balance: existing AI-vs-AI gates (8–35 min, both sides win, aggression +20 %).
4. Browser: match screen runs with 0 console errors; mana bars and `save` intent
   visible; screenshot `docs/design/think-match.png`.

## Out of scope

Real illusions, invisibility, Teleport scrolls, item disassembly, courier, player
micro-control, learning/ML weights.

## Review resolutions (fresh-context review, verdict FAIL → resolved)

- **Retreat example (FAIL 1)** — formula is `retreat = max((1−S)·min(1, 0.5 + nearEnemies/2 + danger(self cell)), regenNeed)`.
  The pinned example: hp 34 %, mana 20 %, BKB owned on cooldown (D = 0), skills on cooldown,
  1 enemy within 9 tiles, danger 0 → S = 0.227, retreat = 0.773, beating every unbiased action
  of every role (asserted in `think.test.ts`).
- **Score ranges & save (FAIL 2)** — every base score is clamped to [0, 1] _after_ role and
  tag boosts. `save` is a sixth action, first in the tie order
  (`retreat, save, fight, gank, objective, farm`). Biases never touch `save`; multiplier
  biases skip `retreat` while hp < 25 %. Commitment (+0.1) is added after biases.
- **Information isolation (FAIL 3)** — enemy effective hp = `hpFrac × maxHp(def, level,
  itemsAtSeen)` with armour/MR from the same data — all from `TeamKnowledge`. Chain-stun
  reads only **our own landed disables** recorded on the blackboard (`disabledUntil[target]`),
  never enemy status. The defensive trigger only sees enemy projectiles whose current
  position is lit by our fog.
- **Scope (FAIL 4)** — built as two verified slices inside this milestone:
  **6a** mana, item actives, Force Staff/Eul's, projectiles, immunity/cyclone — with the
  _existing_ AI using actives minimally, balance gate measured; **6b** Hero Think layers 1–4
  replacing `think()`, balance gate again.
- **Balance (C5)** — mana is tuned in 6a against the gate before 6b lands. Retreat release:
  hp ≥ 80 %, or mana < 40 % only while at the fountain (regen there is fast).
- **Glossary (C6)** — `danger` = own threat map at the hero's cell; fight `dist` = distance
  to the nearest known enemy hero near a fighting ally; `attackDps = damage / attackTime`;
  `readiness` counts a locked ult (level < 6) as not ready; `K` ∈ [0, 1]; `hasDisable` =
  stun or root (not slow); ghost age in seconds = (tick − lastSeenTick)/10; spread speed =
  enemy hero def speed; "Building Damage" = the strategic tag.
- **Determinism (C7)** — ties break by score then lowest id/index; claims are made in hero
  array order; projectiles move and resolve once per tick after status updates and before
  hero actions.
- **Measurable acceptance (C8)** — over seeds 1–6 (AI vs AI): every active (BKB, Blink,
  Force, Eul's) fires ≥ 1 time in total; ≥ 1 spell projectile is dodged by Eul's/BKB or
  fizzles; ≥ 50 % of hero-ability hits within 4 s of a lock land on the locked target.
- **Emergency exemptions (C9)** — as in FAIL 2.
- **Inventory (C10)** — a defensive purchase _replaces_ the next book item (cursor advances).
- **Nits** — initiators hold 8.5–10 tiles; BKB's passive `spellImmunity` is replaced by the
  active; new item lines: `force` 1500 g +150 hp +1 mana/s · `eul` 1650 g +1.5 mana/s +0.1
  power; existing mana items as in the Mana section.

Verdict after resolution: **CONCERNS → resolved**; proceed with 6a, then 6b.
