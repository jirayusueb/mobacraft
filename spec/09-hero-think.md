# Hero Think — milestone 6 spec (Pure Hero AI Loop)

Phase: **Production slice** on top of Match Day (05), Tactics (06), Hero Systems (07),
Fog of War (08) and Itemization (10). Every hero decides like a pro _without_ a coach:
each rethink it reads itself and the (fogged) world, scores six macro actions by role
and power curve, reserves its target on a team blackboard, and drops into a tactical
combat layer when enemies are in reach. It **replaces** the old `think()` in `match.ts`;
coach calls, IGL calls, phase plans and sliders are **score biases**, not overrides.

User decisions (2026-11-16): light mana pool · BKB/Blink active, Force Staff + Eul's
added · single-target/line spells travel as projectiles (12 tiles/s) · full replacement
of `think()`. Revision 2026-11-17: body rewritten to match the shipped code after the
second fresh-context review (see Review log); all constants below are the code's.

Units: 1 tile ≈ 120 Dota units ("400 units" = 3.3 tiles). Ticks are 0.1 s.

## Flow per hero

```
every rethink (0.8 − 0.5·sense/20 s):
  [L1 awareness] → [L2 six scores × role/tags/curve, then biases] → [L4 claims] → intent + goal
every tick:
  projectiles resolve → status → [L3 item triggers] → save walk → casts → [L3 ring/kite] → move/attack
```

## Layer 1 — Awareness (`think/awareness.ts`, `think/influence.ts`, `think/brain.ts`)

All values 0..1 unless stated.

- **Survival Readiness** `S = 0.55·hp% + 0.2·mana% + 0.25·D`; `D` = ready share of owned
  defensive actives (BKB, Blink, Force, Eul's); owning none → `D = 0.3`.
- **Kill Potential** `K = clamp01((ult + skill)·magicTaken + attackDps·5 s·physicalTaken) / hp)`.
  `ult`/`skill` = ability damage (damage + dot total, × item power) only if castable now
  (level ≥ 6 for ult, cooldown 0, mana ≥ cost); `attackDps = damage / attackTime`.
  Target `hp`, armour and magic resist are derived from **public data only**: hero def +
  last-known level + `itemsAtSeen` × last-known `hpFrac` (from `TeamKnowledge`).
- **Known enemies** = visible now, or ghosts younger than 6 s (`GHOST_TARGET_AGE`;
  age = (tick − lastSeenTick)/10).
- **Threat Map** — per team, 16×16 cells of 8×8 tiles, rebuilt with the fog (0.5 s):
  live enemy tower +0.6 on its cell and cells whose centre is ≤ 8.5 tiles away; visible
  enemy hero `0.25·(1 + level/10)` on its cell and half on the 4 neighbours; ghost dark
  `age ≤ 20 s` adds `0.35·(1 − age/20)` within `min(3, 1 + age·speed/8)` cells (speed =
  the hero def's). Sum clamped to 1.
- **Item Timing Delta** `delta = max(0, cost(next) − gold)`, `closeness = 1 − delta/cost`
  (0 when no next item).

## Layer 2 — Macro Utility (`think/macro.ts`)

Six actions. Base scores (then clamped to [0, 1]):

| Action      | Formula                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `farm`      | `farmSpot × (0.35 + 0.65·closeness) × W.farm × curveGreed`                                                                                               |
| `gank`      | `bestGank × (hasDisable ? 1 : 0.55) × W.gank × (ultReady ? 1.4 : 1)`                                                                                     |
| `fight`     | `(0.4 + 0.6·min(1, fighting/2)) × readiness × odds × W.fight × (blink ? 1.3 : 1) / (1 + dist/25)`                                                        |
| `objective` | split: `pushPower × farSide × W.split`; team: `base(phase) + 0.25·min(1, onObj/3)` with base 0.08 / 0.22 / 0.36 (laning/mid/late); roshan & defend: 0.55 |
| `retreat`   | `max((1 − S)·min(1, 0.5 + nearEnemies/2 + danger), regenNeed)`                                                                                           |
| `save`      | 1 when a save target exists, else 0                                                                                                                      |

Terms:

- `farmSpot` = best unclaimed spot's `(1 − danger(spot)) / (1 + dist/60)`. Spots: laning
  (non-jungle, non-roam) → own slot lane only; otherwise own living camps (non-supports,
  or jungle slot) plus the 3 lane fronts (after laning, or roam slot).
- `curveGreed = clamp(powerAt(t + 300 s, min(3, items)) / powerAt(t, 0), 0.8, 1.4)`.
- `bestGank` = max over known enemies within 30 tiles of `K × isolation` (isolation =
  `1 − min(1, other known enemies ≤ 10 tiles / 2)`), unclaimed (2 per target) unless it is
  the IGL's gank target, which gets ×1.3. `hasDisable` = stun/root on skill or (lvl ≥ 6) ult.
- `fighting` = allies incl. self within 30 tiles with a visible enemy hero ≤ 9 tiles;
  `dist` = to the nearest such enemy; `readiness = (1 + ult + castable + mana ≥ 40 %)/4`;
  `odds = clamp01(0.75·ourPower / (theirPower·ratio))` within 12 tiles of that fight,
  power = Σ hp% × (1 + 0.15·level), `ratio` from aggression (1.2 − 0.008a below 50,
  0.8 − 0.002(a − 50) above).
- `pushPower = clamp01(dps × (1.2 with building-damage tag) / 60)`; `farSide =
  min(1, known enemies > 35 tiles from the split lane / 4)`; split lane = the lane front
  with the most such enemies.
- `danger` = own threat map at the hero; `nearEnemies` = visible enemy heroes ≤ 9 tiles;
  `regenNeed` = 0.85 if hp < 25 %, 0.6 if mana < 15 % and nothing castable, else 0.
- **Role weights** `W` (carry, mid, offlane, jungle, support): farm 1/0.8/0.6/0.7/0.25 ·
  gank 0.4/0.8/0.65/1/0.7 · fight 0.6/0.8/0.95/0.8/0.85 · split 0.8/0.5/0.4/0.45/0.1.
  Tags: initiator gank & fight ×1.2; follow-up fight ×1.1; building-damage split ×1.3;
  global gank ×1.2.

**Choice**: score' = base × mul + add (biases below); `save` and — while hp < 25 % —
`retreat` ignore multipliers. Commitment: the previous action gets +0.1 (if > 0).
Argmax with tie order `retreat, save, fight, gank, objective, farm`. A live save target
then wins over every action except retreat.

**Post-rules** (`brain.ts`, in order):

1. _Retreat hold_: last action retreat, intent retreat, hp < 80 % → keep retreating.
2. _Encounter_: visible enemies ≤ 9 tiles and local power ≥ theirs × ratio → `fight`
   unless saving or retreat score ≥ 0.6 (`RETREAT_URGENT`).
3. _Weak retreat_: no enemy ≤ 9, hp ≥ 50 %, retreat score < 0.3 → best of farm/objective.
4. _Release_: retreat not urgent, no enemy ≤ 9, and hp ≥ 80 % (or ≥ 45 % when not already
   retreating) → best of farm/objective.
5. gank with no target → farm; fight with no fight → farm.

### Biases (exact multipliers `×` and additions `+`)

- Sliders: aggression a: gank & fight ×(0.7 + 0.6a/100), retreat ×(1.3 − 0.6a/100);
  farm priority f: farm ×(0.7 + 0.6f/100).
- Laning: plan aggressive gank ×1.2 · roam plan (roam/jungle slot) gank ×1.4 · scale
  farm ×1.3, retreat +0.05 · roam slot farm ×0.3, gank ×1.3.
- Mid/late plan (anti-stall from 25:00: mid farm → group, late defend → siege):
  group objective ×1.25 · split: core → split mode ×1.6, others ×1.3 · pickoff gank ×1.5 ·
  farm farm ×1.5 · siege objective ×1.6 · roshan objective ×1.6 (Roshan mode when alive and
  ≥ 4 allies) · defend: ≥ 2 enemies dead objective ×1.8, else defend mode ×1.4.
- IGL (followers): gank ×1.6 +0.2 · defend → defend mode, objective ×1.6 +0.35 ·
  back retreat +0.4 · push/group → team mode, objective ×1.6 +0.35.
- Coach (followers): group/push → team mode, objective ×1.5 +0.5, farm ×0.5, fight ×1.2 ·
  safe retreat +0.25, gank ×0.5, fight ×0.8 · farm farm ×1.8 +0.3 · roshan (alive) →
  Roshan mode, objective ×2 +0.5.

Shop and ward (spec/06) stay as preconditions after retreat/save/encounter. Objective
modes map to intents: split → push to the split lane; team → `goGroup`; roshan → pit;
defend → IGL spot or deepest own T3/rax.

## Layer 3 — Micro-Combat (`think/combat.ts` + `microItems`/`microMove` in `match.ts`)

Item triggers (per tick, not while stunned or cycloned; enemy data = visible only):

1. Lit enemy spell projectile aimed at me within 3.3 tiles AND hp < 60 % → BKB, else Eul's.
2. hp < 25 % and a visible enemy ≤ 4 tiles → Force Staff away 6 tiles from the closest
   visible enemy, else Blink 8 tiles toward the fountain (only ≥ 3 s after hero damage).
3. Fight start (a visible enemy ≤ 7 tiles after ≥ 10 s without one), carry/mid, ≥ 2
   enemies ≤ 7 → BKB.
4. Save intent with Force ready: ally ≤ 6 tiles, its nearest visible enemy ≤ 8 → push the
   ally 6 tiles away.
5. Initiator engage: initiator tag, Blink ready, ≥ 3 s since hero damage, intent fight or
   gank, a disable ready, (ganking or ≥ 1 ally ≤ 10 tiles) → Blink to 1.5 tiles short of
   the lock target (else the lowest-hp visible enemy 3–10 tiles away) and lock it.

Positioning ring (fight/gank intents):

- Ranged: if a visible melee enemy is within 60 % of attack range and the attack is on
  cooldown, step away along the sum of unit vectors from visible enemies ≤ 6 tiles;
  attack when the swing is ready (orb-walk).
- Melee initiator with Blink ready, intent fight, no ally ≤ 10 tiles: hold 8.5–10 tiles
  from the nearest visible enemy (outside its 8-tile vision) and wait.

Casting: enemy-target spells prefer the blackboard lock, then the lowest hp%. Disables
are **held** while our own recorded disable on the target outlasts travel + 0.3 s; area
disables wait while every hero caught is still held by us. Ult discipline (spec/06)
unchanged.

## Layer 4 — Blackboard (`think/blackboard.ts`)

Per team, deterministic Maps:

- **Lock** `{target, by, until: t + 4}` set when any of our abilities with a stun/root
  hits an enemy hero, or an initiator blinks onto one. Heroes ≤ 12 tiles from the target
  add 50 % of the hero part of their target score to it.
- **Own disables** `disabledUntil[target]` — the only status input for chain-stuns.
- **Save**: savers = support role or any hero with an ally-targeted skill/ult. Target =
  lowest-hp% ally core (carry/mid; any ally if none alive) with hp < 25 %, a visible enemy
  ≤ 8 tiles, within 20 tiles of the saver, unclaimed. Intent `save` walks to the ally and
  casts ally/ally-aoe spells.
- **Claims** `camp:<id>` `lane:<id>` (1 holder), `gank:<id>` (2), `save:<id>` (1); TTL
  8 s, renewed each think; one claim per kind per hero; released on death and when the
  hero picks another action. Claims are made in hero array order; ties break by score then
  first in list order.

## Mana, items, projectiles

- **Mana**: max `220 + 32·(level − 1) + Σ item mana`; regen `2.5 + 0.25·level + Σ item
  regen` per s; fountain +12 %/s. Costs: skill `round(35 + 3·cd)`, ult `round(90 + 1.2·cd)`.
  No mana → no cast. Item mana: charm 150, tome 100, staff 200, aegis-cloak 100;
  regen: force 1/s, eul 1.5/s.
- **Actives** (data in `items.ts` `active.cooldown`, owned by spec/10's item DAG):
  BKB 6 s spell immunity, cd 60 — blocks hero magic damage and stun/root/slow/dot from
  heroes without `bkb-piercing`. Blink cd 15 (3 s lockout after hero damage). Force Staff
  cd 18, push 6 tiles. Eul's cd 22: 2.5 s cyclone — invulnerable, cannot act; enemy
  projectiles at it fizzle. Item stats/costs beyond these fields are spec/10's.
- **Defensive purchase** (once per hero, takes the next book slot, cursor advances):
  melee initiator → Blink at book index 1; carry → BKB at index 2; support → Force at 2;
  mid → Eul's at 2.
- **Projectiles** (12 tiles/s): `enemy` abilities with range > 2.5 and no dash home on
  their target and apply on arrival (fizzle if the target died or is cycloned); `line`
  abilities travel their full range and hit each enemy within `width + 0.4` once.
  They move and resolve once per tick after status, before hero actions.

## Architecture

Pure modules in `packages/sim/src/match/think/`: `awareness.ts`, `influence.ts`,
`macro.ts`, `combat.ts`, `blackboard.ts`, `brain.ts` (`createBrain(ctx)`; never receives
enemy bodies — only `TeamKnowledge`, public hero defs and own-team state). `match.ts`
owns effects (mana, actives, projectiles, immunity/cyclone) and the adapter
(`think`, `applyDecision`, `microItems`, `microMove`, `tickProjectiles`). Snapshot
`HeroLine` adds `mana`, `maxMana`, `think { action, scores }`; `thinkStats()` exposes
active counts, fizzles and lock focus. Web: mana bar + `save` intent label.

Known public-information reads (accepted): enemy hero alive/dead (kill feed), camp
alive state and Roshan alive (map knowledge), enemy tower positions.

## Failure / edge states

No known enemies → gank/fight 0 · all camps claimed → lanes · all spots claimed → no farm
spot (farm 0) · stunned/cycloned heroes fire no actives · full inventory → defensive item
skipped · projectile target dead/cycloned → fizzle.

## Acceptance (gate) — what the tests assert

1. `think/think.test.ts` (pure): S/K/delta formulas; threat map tower + ghost spike/decay;
   carry 300 g short farms over gank; lvl-6 ganker ganks an isolated target; initiator
   with Blink + ult fights when 2 allies fight; split pusher picks split; the retreat
   example (hp 34 %, mana 20 %, BKB on cd, nothing castable, 1 enemy → S 0.227, retreat
   0.773, chosen by every role); clamping + save over a coach-pushed fight; biases;
   commitment; defensive trigger / force / escape-blink rules; chain-stun hold; kite
   vector; initiator hold/landing; claims & locks.
2. `think/think-match.test.ts` (seeds 1–6, AI vs AI): every active fires ≥ 1; ≥ 1
   projectile fizzles; ≥ 50 % of hero damage dealt within live locks by heroes ≤ 12 tiles
   from the locked target lands on it; all six actions occur; mana is spent; determinism.
3. Balance: existing match/tactics suites (8–35 min, both sides win, aggression +20 %)
   pass with Hero Think; 8-game report in the checkpoint.
4. Browser: match runs with 0 console errors; mana bars and intents visible
   (`docs/design/think-match.png`).

## Out of scope

Real illusions, invisibility, TP scrolls, courier AI, pre-fight self-buff timing,
learned weights. Manta/Glimmer/Tango triggers belong to spec/10 S5 as new branches of
`defensiveTrigger`.

## Review log

- **Review 1 (2026-11-16) FAIL** — retreat math, score clamping/save ranking, info
  isolation, scope. Resolved: formula `0.5 + n/2 + danger`, clamping + save priority,
  `TeamKnowledge`-only inputs and own-disable chain-stuns, built as slices 6a/6b.
- **Review 2 (2026-11-17) FAIL** — the body still contradicted its resolutions and
  diverged from code. Resolved by this rewrite (body = code) and code fixes: item
  mana/regen restored after the spec/10 DAG migration; BKB now lets `bkb-piercing`
  magic damage through; carry BKB at book index 2; retreat release no longer breaks the
  45–80 % hold; ally radius 10 everywhere; the lock-focus metric now measures landed hero
  damage, not cast ordering. Tuning (same date): fight gets a 0.4 contact floor and
  25-tile decay, burst window 5 s, odds ×0.75, team-objective base lowered — measured over
  8 AI games: 12.0–30.5 min, 4/8 blue wins; mid-game fight+gank share 14 % → 18 %, kills/min 2.18 → 2.67 (gank weights +0.05–0.1, mid group plan objective ×1.4 → ×1.25).
  Accepted, not changed: pre-fight self-buff (out of scope), line-projectile sampling
  at 1.2 tiles/tick (deterministic; width + 0.4 margin), public-information reads above.
