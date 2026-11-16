# Hero Systems — milestone 4 spec

Phase: **Production slice** on top of Match Day (spec/05) and Tactics (spec/06).
Benchmark: Dota 2 pro scene (flex drafting, signature heroes, pocket picks,
situational itemization) seen through _Teamfight Manager 2_'s coach lens.
Goal: heroes, players and items stop being flat stat blocks. The sim derives
advantages and AI behaviour from **data** (tags, curves, tiers, rules), never
from per-hero `if` statements.

Relationship to spec/06: spec/06 owns the _derived_ synergy/counter matrix
(`matrix.ts`: lockdown, aoe, burst…) and the adaptive Nullstone rule. This spec
adds **authored strategic tags** with real sim mechanics, the power curve,
player mastery over time, lane/combo checks and a general item-rule engine.
spec/06's adaptive rule becomes one built-in rule of the engine (§4).

## Time scale

Our matches last ~12–25 game minutes, about half of a Dota game. All
"Dota-minute" thresholds below use `dotaMinutes = gameSeconds / 60 × 2`
(constant `DOTA_TIME_SCALE = 2` in `archetypes.ts`). So "0–15 min" ends at
7:30 game time (= spec/06 laning phase) and "35+ min" starts at 17:30.

## 1. Hero archetype & tag system (`sim/match/archetypes.ts`)

Per hero, authored data:

- **Positions**: Pos 1 carry · Pos 2 mid · Pos 3 offlane · Pos 4 jungle/roamer ·
  Pos 5 support (our 5 roles). `positions: Partial<Record<1..5, fit 0..1>>`.
  **Flex score** = number of positions with fit ≥ 0.6, shown as 1–3+.
- **Strategic tags** (authored, each has a sim mechanic — no decorative tags):

| Tag               | Mechanic in the sim                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `Burst`           | ability damage ×1.1 when the target is above 70 % hp                                                          |
| `Illusion`        | 25 % of single-target enemy abilities hit an illusion instead (no effect) — unless the caster has `AOE Clear` |
| `AOE Clear`       | ignores Illusion; +15 % damage against Illusion heroes                                                        |
| `Evasion`         | 20 % of incoming basic attacks miss, unless the attacker has True Strike (item)                               |
| `Global`          | +35 % move speed while rotating to a group/fight/defend goal (fast rotations)                                 |
| `BKB-Piercing`    | this hero's stuns/roots ignore Spell Immunity                                                                 |
| `Wave Clear`      | abilities deal ×1.4 to creeps; AI casts on waves (≥3 creeps) near own towers                                  |
| `Building Damage` | +20 % basic-attack damage to structures                                                                       |
| `Lane Bully`      | +1 lane pressure (§3b)                                                                                        |
| `Initiator`       | combo setup (§3c)                                                                                             |
| `Follow-up`       | combo payoff (§3c)                                                                                            |

- **Power spike curve** `curve: "snowball" | "tempo" | "hard-carry" | "late"`,
  a multiplier on damage and ability power, by Dota minute and finished core
  items (items costing ≥ 1100, i.e. not boots):

| Curve      | 0–15 | 15–35 | 35+  |
| ---------- | ---- | ----- | ---- |
| snowball   | 1.15 | 1.0   | 0.85 |
| tempo      | 1.05 | 1.05  | 0.95 |
| hard-carry | 0.82 | 0.95  | 1.0  |
| late       | 0.92 | 1.0   | 1.1  |

Hard carry additionally: 3+ core items → ×1.3 (stacking with the column), 2 → ×1.1.
`powerAt(heroId, gameSeconds, coreItems)` is the only API; the draft screen draws it as a sparkline.

- **Facets** (§4a) are listed per hero: exactly 2 each.

## 2. Player–hero mastery & decay (`sim/match/career.ts`)

- Mastery stays a number 0..1 (as today), now owned by a **Career** state:
  `{ day, records: player × hero → { mastery, lastPlayed, publicMastery } , chemistry }`.
- **Tiers**: Unfamiliar < 0.45 ≤ Playable < 0.65 ≤ Comfortable < 0.85 ≤ Signature.

| Tier        | Sim effect                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unfamiliar  | +0.6 s cast hesitation per ability; **item rules ignored** (follows the default book only); 8 % chance per think to misposition (stand 3 tiles forward of the lane front / chase too deep)              |
| Playable    | +0.25 s hesitation; item rules apply                                                                                                                                                                    |
| Comfortable | no penalty                                                                                                                                                                                              |
| Signature   | ability power ×1.08 (> 100 % of the hero); **Clutch plays**: 30 % chance to fully dodge an incoming stun/root/single-target nuke when above 0 hp, at most once per 20 s; feed line "Clutch! X dodges Y" |

- **Skill Rust**: each day after 30 days without playing or practising a hero,
  mastery −0.004/day, floored at the tier floor of Playable (0.45) for heroes
  that were ever Comfortable, else 0.35. Playing a hero in a match: +0.02 and
  resets `lastPlayed`. Practice: see below.
- **Calendar**: one match day per week. Between match days a **Practice week**
  screen assigns each player one focus:
  `scrim <hero>` (+0.06, public), `private <hero>` (+0.06, **hidden**),
  `bonding <teammate>` (chemistry +0.15 for that pair), `rest` (no gain; rust still applies).
- **Pocket strat**: private-lobby gains do not raise `publicMastery`. The
  opponent's AI coach drafts and bans against **public** mastery (scouting);
  the sim uses real mastery. The draft screen marks your hidden-Signature heroes
  `POCKET`; when an opponent's hero is picked onto a player whose real tier is
  higher than the scouted tier, the reveal posts "Pocket pick!".
- AI teams also practise weekly (their top 3 heroes, 1 private).

## 3. Synergy, counters & mechanics matrix

### 3a. Tag counters (`archetypes.ts` → used by matrix consumers)

Directional rules on strategic tags, merged into spec/06's matchup:
`AOE Clear › Illusion +2`, `True-Strike carrier › Evasion` (item-driven, §4),
`BKB-Piercing › Spell-immunity buyer +1`, `Wave Clear › Building Damage +1`,
`Global › Lane Bully +1` (rotations punish greedy lanes). Team-level: if the
enemy has ≥ 2 Illusion heroes and we have an AOE Clear hero, team teamfight
power +5 % (shown in draft analysis).

### 3b. Lane matchup advantage

For each lane at 0:00, per side: `pressure = Σ heroes (ranged +1, Lane Bully +1,
matrix matchup vs lane opponents /2) + (avg player skill diff)/5`. Lane advantage
`A = pressure_us − pressure_them`, clamped [−3, 3], computed for the lane
assignment actually played (safe vs off, mid vs mid).
During laning (`dotaMinutes < 15`), a hero whose lane advantage ≤ −1 misses
`12 % × |A|` of last-hit gold; at ≤ −2 after 2:00 game time they are **zoned out**:
they leave for their jungle (intent jungle) until laning ends. Feed line
"X is zoned out of the {lane} lane". The draft screen shows predicted lanes.

### 3c. Combo execution check

A **combo pair** = an `Initiator` and a `Follow-up` on the same team. When the
initiator lands a stun/root on ≥ 1 hero, each follow-up ally within 9 tiles
whose ultimate (or skill) is ready rolls on the pair's **sync**:
`sync = 0.35 + 0.35·(teamwork_a + teamwork_b)/40 + 0.3·chemistry(a,b)`, chemistry ∈ [−1, 1].

- roll < sync → **Combo**: the follow-up casts immediately on the held target,
  +20 % power; feed "Combo! A → B".
- else, if chemistry < 0 and coin flip → **Overlap**: the follow-up fires its
  disable on the already-held target; the disable is wasted (duration 0),
  feed "Spells overlapped (A & B)".
- else → **Late**: no forced cast (normal AI later), feed "Late follow-up".
  New player rating `teamwork` (1..20) and initial pair chemistry in team data
  (one feuding pair per team, chemistry −0.5).

## 4. Facets & conditional itemization (`sim/match/builds.ts`)

### 4a. Facets

Each hero has 2 facets picked from templates, chosen per pick before the match
(defaults to facet 0):

- `Arcane` — ability damage ×1.2, basic attack ×0.9.
- `Warlord` — basic attack ×1.15, ability damage ×0.9.
- `Aura` — allies within 6 tiles get +3 armor and +3 hp/s; own ability damage ×0.85.
- `Bulwark` — max hp ×1.12, damage ×0.92.
- `Hunter` — +10 % move speed, +15 % damage to heroes below 50 % hp, max hp ×0.94.

### 4b. Item rule engine

A rule: `{ id, when: Condition[], then: Action, scope }`, evaluated before every
purchase, first matching rule wins, otherwise the build book is followed.

- Conditions: `enemyMagicShare > x` (from enemy hero damage dealt; before 20 s of
  data, from draft: ability-heavy heroes), `enemyHas(tag)`, `losingBase`
  (any own tier-3 / barracks down), `netWorthDeficit > x`, `role is R`,
  `heroHasItem(id)` negations.
- Actions: `buyBefore(item, before)`, `mustBuy(item)`, `riskBuy(item)`.
- Built-in rules (toggleable on the Builds dialog, all on by default):
  1. IF enemyMagicShare > 60 % THEN buy **Pipe of Insight** BEFORE **Blink Dagger** (anyone whose book has Blink; others buy Pipe next).
  2. IF enemy has `Evasion` THEN Carry must buy **Monkey King Bar** (True Strike).
  3. IF losingBase AND netWorthDeficit > 15 000 THEN Carry risk-buys **Divine Rapier**.
     spec/06's adaptive Nullstone/Plate rule is rule 0 (lower priority).
- New items (Dota names kept as the coach-facing labels the user asked for):
  `pipe` Pipe of Insight 1700 g: +150 hp, 25 % magic resist to holder and allies within 6.
  `blink` Blink Dagger 1600 g: the hero's first engage ability each fight ignores range (dash to target ≤ 10 tiles).
  `mkb` Monkey King Bar 2200 g: +30 dmg, True Strike.
  `rapier` Divine Rapier 3600 g: +110 dmg; dropped (lost) on death.
  `bkb` Black King Bar 2400 g: +10 dmg, +100 hp; Spell Immunity for 6 s when a fight starts (60 s cooldown).
- Unfamiliar heroes ignore every rule (§2). Each triggered rule logs a feed
  line "Rule 1 → Mae buys Pipe of Insight" once per hero per rule.

## Architecture

- Pure modules: `archetypes.ts` (positions, flex, tags, curve, facets, tag
  counters, lane pressure), `career.ts` (calendar, mastery, tiers, rust,
  practice, scouting, chemistry), `builds.ts` (facets effects, item rules
  engine), `hero-systems.ts` (one runtime object `createHeroSystems(draft, plan)`
  the match calls at ~8 hooks: damage mul, ability mul, hit/miss, cast
  hesitation, dodge, purchase, lane gold, combo).
- `match.ts` changes are hooks only. `MatchOptions.plans?: Record<DraftSide, HeroPlan>`
  (`facets`, `rules` toggles). DraftState gains optional `scouted` (the public
  view of each team) used by `aiChoose`.
- Web: `practice-screen.tsx` (calendar + assignments + roster mastery grid),
  draft screen hero card (positions/flex, tags, curve sparkline, tier, pocket),
  `builds-dialog.tsx` (facets + rule toggles), feed lines for clutch/combo/rule/zone.

## Failure / edge states

- Unknown hero in archetypes → falls back to a neutral archetype (test asserts all 20 present).
- Rule wants an item already owned or inventory full → rule skipped.
- Rapier holder dies → item removed, feed line.
- Combo partner dead / out of range → no roll.
- Rust never drops mastery below the floor; practice (+0.06/week) outpaces rust (−0.028/week).
- Tiers shown everywhere come from one function (`tierOf`).

## Acceptance (gate)

1. `make test` green; new tests: archetype coverage + flex scores; curve shape
   (snowball early > late, hard carry 3 items > 0 items); tier thresholds; rust
   after 30 days & floor; private practice hidden from scouting and AI bans;
   lane advantage melee-vs-ranged; zone-out happens for −2 lanes; combo outcomes
   depend on chemistry (high chem → more combos over seeded runs); rules 1–3
   fire under constructed states; Unfamiliar ignores rules; determinism.
2. Balance: existing AI-vs-AI tests still pass (10–35 min, both sides win).
3. Browser: practice week → draft (tiers, flex, tags, curve, pocket) → builds
   dialog → match (rule/combo/clutch/zone feed lines) → results → next week shows
   rust warnings. 0 console errors; screenshots `docs/design/hero-*.png`.

## Out of scope

Real illusion units, hero talents trees, full season/league table, transfers,
player morale beyond pair chemistry, saving the career.

## Review resolutions (fresh-context review, verdict FAIL → resolved)

- **spec/06 runtime not in `match.ts` yet** — accepted. Spec/07 does not depend on it:
  the laning window is `dotaMinutes < 15` (7:30 game) until spec/06's `phase` lands,
  then the hook switches to `phase === "laning"` (one line in `hero-systems.ts`).
- **Tag clash** — strategic tags are a separate `StrategicTag` type with kebab ids
  (`aoe-clear`, `wave-clear` …); matrix tags stay derived. Test: every strategic tag
  appears on ≥ 1 hero and ≤ 60 % of heroes, and every tag is read by a hook (`TAG_HOOKS`).
- **Magic share** — one function `magicShare(enemy)`: enemy magic hero-damage ÷ all
  enemy hero-damage once ≥ 800 dealt, else the draft estimate (ability-heavy role count).
  Priority (first match wins): Rule 3 Rapier › Rule 2 MKB › Rule 1 Pipe › Initiator Blink › book.
  spec/06's adaptive Nullstone rule is not implemented in the match yet; when it is, it
  slots in after Rule 1.
- **Unfamiliar ignores rules** — applies to rules 1–3 and Blink; when spec/06 lands, its
  adaptive rule is also skipped for Unfamiliar heroes ("buys by the book").
- **Lane formula** — one `laneScore(us, them, skill)` in `archetypes.ts`, used by draft,
  tactics board and sim. It uses **per-hero averages** (so 2-vs-1 lanes aren't decided by
  headcount): avg(ranged + lane-bully + matchup/2) + Δavg skill/5, clamped [−3, 3].
  Recomputed from the lanes actually played at 1:00 game time.
- **Settings duplication** — facets and rule toggles live in `HeroPlan` passed as
  `MatchOptions.heroPlans`; when spec/06's `TeamTactics` lands, they move into it unchanged.
  Screen order: `practice week → pick-team → draft (+facets) → [tactics] → match → results → practice week`.
- **Mastery ownership** — the `Career` is the single source; `teamView(team, career, "real")`
  produces the TeamDef the draft and match read (team data only seeds the career).
  `DraftState.scouted?` holds the _scouted_ TeamDefs; the AI coach bans/counters from those.
- **Random rolls** — the hero systems use their own stream `createRandom(seed ^ 0x9e3779b9)`;
  the match's main stream is untouched. Rolls are tested by frequency over seeds.
- **Build cursor** — purchases use `bookIndex` (a cursor), not `items.length`; rule items
  are inserted, and when inventory is full the cheapest book item is sold for a rule item.
  Rapier lost on death frees its slot without moving the cursor.
- **Pipe/Blink** — Pipe aura: one per team counts, magic resist from all sources is capped
  at 0.5 and auras don't stack. Blink is bought by Initiator-tagged heroes as their 2nd core
  item (a built-in rule), so Rule 1 has something to come before.
- **Terms** — _Carry_ = the carry-role hero, else the highest-net-worth core.
  `netWorthDeficit` = team net worth (gold + items) difference. _Fight starts_ = first
  time an enemy hero is within 7 tiles after 10 s without one (BKB trigger).
  _Engage ability_ = the first enemy-targeted skill/ult cast while Blink is ready (range → 10).
  _Misposition_ = for 3 s, the lane goal moves 3 tiles toward the enemy. Global applies when
  intent ∈ {group, push, roshan, fight} and goal > 15 tiles away.
- **Combo** — only enemy-targeted, damaging or disabling abilities can be forced; the
  cooldown is consumed; one roll per pair per 10 s; held target must still be alive;
  `sync` clamped to [0.05, 0.95]. Overlap only when the follow-up's ability has a disable.
- **Career** — `peak` field exists; chemistry clamped [−1, 1]; the career has no RNG
  (AI practice is deterministic). The claim "nets out" is removed: practice (+0.06/week)
  outpaces rust (−0.028/week).
- **Unfamiliar frequency** — misposition is rolled once per 10 s per hero, chance
  `0.10 × (1 − sense/20)`, not per think.
- **Stacking** — all hero-system multipliers are summed as bonuses and the total is clamped
  to [0.75, 1.35] (`combineMul`). Mastery's linear `skillMul` term stays; Signature adds +0.08
  inside the clamp.
- **Push speed** — Building Damage is +20 % (not 40 %), Wave Clear ×1.4 to creeps.
  Balance gate unchanged: the existing match tests (8–35 min, both sides win) with all
  systems on.
- **Hook list** (all in `hero-systems.ts`, called from `match.ts`): `statMods` (hp, speed,
  damage on recompute), `heroDamageMul(src, dst, kind)`, `creepDamageMul`, `structureDamageMul`,
  `attackHits(src, dst)` (Evasion/True Strike), `spellLands(src, dst)` (Illusion / Clutch /
  Spell Immunity), `castDelay(hero)`, `laneGoalShift(hero)`, `laneGoldMul(hero)`,
  `zonedOut(hero)`, `moveMul(hero, intent, goalDist)`, `auraRegen(hero)`, `nextPurchase(view)`,
  `onDeath(hero)` (Rapier), `onDisable(caster, targets)` (combo), `onFightStart` (BKB).
- **Scope** (reviewer suggested deferring Illusion/BKB/Blink/Rapier and the calendar) —
  answered: the user asked for these explicitly and chose the minimal calendar. Each is
  kept to the smallest mechanic above; no illusion units, no saving.
- **Acceptance 3** — clutch/combo/zone/rule feed lines are asserted in sim tests; the
  browser gate screenshots the screens only.

Verdict after resolution: **CONCERNS → resolved**; proceed to implementation.
