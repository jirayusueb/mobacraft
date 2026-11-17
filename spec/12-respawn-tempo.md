# Respawn & Match Tempo (spec/12)

Phase: **Production slice**, built on Match Day (spec/05), Fog of War (spec/08)
and Itemization (spec/10). Benchmark: the Dota 2 respawn rules that decide
comebacks — death timers, buyback, the 30 s creep metronome, camp spawn boxes
and stacking, runes, Roshan's hidden respawn window, and tree regrowth.

Status: PASS after a fresh-context review (CONCERNS → resolved below).

## Player fantasy (delta)

The coach reads the match by its **clock**. A death at level 25 means a
~78-second window to take a barracks. A buyback is a gamble with a visible price
and an 8-minute IOU. The support leaves lane at :45 to stack the ancients. The
enemy might have a sentry in our large camp. Roshan is "maybe up" from 8:00 to
11:00 after he dies, so somebody has to go and look.

## Ground truth (what exists)

- `match.ts` has a fixed respawn of `6 + 2.2 × level` s, a fixed 60 s camp
  timer, a fixed `ROSHAN_RESPAWN = 240`, waves every 30 s with a siege on every
  5th wave, and `empowered` lanes after a barracks falls. It has no buyback and
  no runes.
- `fog.ts` already stores `TreeEvent.regrowAt` and regrows into the fog
  blocker, and `locomotion.ts` has `regrowTree` for the nav grid.
- `spec/10` §4 reserves a buyback **gold floor** (`150 + 25 × level`) and
  defers the real mechanic to this spec.

## Scope and integration rule

All five systems ship as **pure, deterministic modules** in
`packages/sim/src/match/respawn/`, exported as the `respawn` namespace from
`@mobacraft/sim`. They take no wall-clock time and call no `Math.random`. All
randomness comes from a caller-supplied `Random` (mulberry32) stream.

**Time units.** Every constant is in **Dota seconds**, the authentic rules.
The match runs compressed time (`DOTA_TIME_SCALE = 2`, spec/07). The
integration feeds `dotaSeconds = clock × DOTA_TIME_SCALE` into the modules and
divides durations it schedules on the match clock by the same scale. None of
the modules know about the compression.

**Not in this slice: wiring into `match.ts`.** `match.ts` has a large
uncommitted rework on `main`, so the integration is a follow-up step (S6 below).
It replaces the constants listed under Ground truth with calls to these
modules. The spec/10 gold floor becomes `buybackCost(netWorth)`.

## 1. Hero death and respawn pipeline (`hero-life.ts`)

The hero object is **never destroyed**. A `HeroLife` record moves through
`alive → dead → alive`. Stats, item cooldowns and AI references survive the
whole cycle.

- **Timer.** `baseRespawnTime(level) = 12 + 88 × ((level − 1) / 29)^1.5`,
  clamped to levels 1–30. This gives exactly 12 s at level 1 and 100 s at
  level 30, rising convexly in between. The integration maps our 15-level XP
  curve onto 1–30 with `dotaLevel(L) = 1 + (L − 1) × 29 / 14` (1 → 1, 15 → 30).
- **Modifiers.** `RespawnModifier = { source, add?, mul? }`. The time is
  `max(MIN_RESPAWN = 3, base × Π mul + Σ add)` (multipliers apply to the base, then adds). Built-ins are Reaper's Scythe
  (`+15 / +25 / +35` by ultimate rank), the buyback penalty (`+25`), and talent
  or item reductions (negative `add`, or `mul < 1`).
- **Death cleanup** (`killHero`): sets `render = false` and `collide = false`.
  It drops every buff or debuff without `persistsThroughDeath`. It does **not**
  touch ability or item cooldowns: `tickLife` runs every tick whether the
  hero is alive or dead. It pins `anchor` (camera and AI focus) to the team's
  fountain and enters `brain = "dead"`.
- **Dead brain** (`planDeadBrain`). This is a pure planner that runs while the
  hero is dead and returns ordered actions:
  1. Buy from the shopping list, cheapest-next first in list order, but never
     below the buyback reserve.
  2. Sort the backpack so the highest-value items go to free main slots.
  3. Plan a TP: if the hero has a TP scroll and an objective, teleport to the
     friendly tower nearest the objective, with the cast queued for the first
     tick after respawn.
- **Respawn execution** (`respawnHero`): HP and mana go to 100 %, the hero is
  placed at the team's `FountainSpawnPoint`, render and collide are restored,
  and the hero gets **fountain invulnerability**. That buff ends only on the
  hero's first `move`, `cast` or `item` action (`breakSpawnProtection`; "item"
  is any item activation including TP), or after a hard cap of
  `SPAWN_PROTECTION_MAX = 10 s`. Being attacked does not break it. This buff is
  a design addition (not a Dota rule) against fountain spawn-camping.

## 2. Buyback (`buyback.ts`)

- `buybackCost(netWorth) = 200 + floor(netWorth / 13)`.
- The cooldown is **480 s** from the moment of purchase.
- A purchase sets `penaltyPending`. The **next** death consumes it as a `+25 s`
  modifier.
- The cost is evaluated at the purchase tick from current net worth. A buyback
  while a penalty is still pending just keeps one pending penalty (no stacking).
  The cooldown runs in Dota seconds.
- `canBuyback` requires that the hero is dead, the cooldown has expired, and
  gold ≥ cost.
- **Utility decision** (`decideBuyback`). This is deterministic, scored in
  [0, 1], and buys only at or above a 0.6 threshold. Before scoring, two hard
  gates apply: the hero must have at least 15 s of respawn time left, and must
  be able to afford it. Each of the three scores below is checked on its own,
  and the decision takes the highest (ties resolved by the fixed order below).
  The inputs `wonFight`, `isCoreDamage` and `ultImpact` are supplied by the
  integration: wonFight = ≥2 more enemy than ally deaths in the last 20 s;
  core = role carry or mid; ultImpact is authored per hero (0..1).
  - **Base defense emergency = 1.0.** A tier-3 tower or barracks is under
    attack, _and_ `alliesAlive ≥ max(1, enemiesAtBase − 1)`, so the team can
    still fight back.
  - **High-value fight = 0.55 + 0.25 × ultImpact (0..1)**. This applies when
    Roshan is contested or a teamfight is still running, the hero's ultimate is
    ready, the hero holds a TP scroll, and the fight is expected to last longer
    than the TP time (3 s).
  - **Game-ending push = 0.9.** The team just won a fight, this hero is a core
    damage dealer, and the hero can reach the enemy Ancient before
    `min(enemy respawn remaining)` runs out.
  - Without any of these the score is 0 and the hero does not buy. The result
    also carries `reason`, so the HUD and the event feed can explain it.

## 3. Lane creep waves (`creep-waves.ts`)

- **Scheduler.** `wavesDue(prev, now)` returns the indices of waves whose spawn
  times (`0, 30, 60, …`) fall in `(prev, now]` (wave 0 included when `prev < 0`, empty when `now < 0`).
  A 1e-6 epsilon absorbs float drift from the scaled clock, so it never skips or
  doubles a wave regardless of tick size (property-tested over six tick sizes).
- **Composition.** With `tier = floor(wave / 15)`, so one tier every 7:30, a
  wave has `melee = min(6, 3 + tier)` and `ranged = min(3, 1 + floor(tier / 2))`.
  It adds `siege = 1` on every 10th wave (`wave % 10 == 0`, wave > 0). This deliberately replaces `match.ts`'s
  every-5th cadence, per the design brief ("Siege Creep ทุกๆ เวฟที่ 10"). HP and
  damage scale `× (1 + 0.1 × tier)`.
- **Templates.** These are tracked per attacking team and lane. When the
  defender's melee barracks in a lane falls, the attacker's melee creeps in that
  lane become **super**. When the ranged barracks falls, the ranged and siege
  creeps become super. When all six of the defender's barracks are gone, every
  lane of the attacker spawns **mega**.
- **Object pool.** `CreepPool` prewarms `cap` records and `acquire`s or
  `release`s them. A record is reset in place and never reallocated, so the
  spawner allocates nothing per wave once it is warm. Stats report `created`,
  `reused` and `inUse`, and the test asserts that `created` stays flat.

## 4. Neutral camps, spawn boxes and stacking (`neutral-camps.ts`)

- Every camp has an axis-aligned **spawn box**. Spawn checks run at each
  `:00`, starting at 60 s (`campTicksDue(prev, now)`).
- **Spawn rule.** A camp spawns only if _no_ hero, neutral, lane creep or ward
  (observer or sentry) is inside the box. Neutrals inside the box count;
  neutrals pulled out of the box do not. `stacks` counts spawned groups
  currently alive: the first spawn into an empty camp makes it 1, each
  further spawn while pulled creeps survive adds a stack, `clearCamp` resets 0.
- **Stacking planner** (`planStack`). From the hero's distance and speed, the
  camp's pull second (default :53.5, inside the :53–:55 window), and the
  distance and speed the creeps need to leave the box, it returns `leaveAt`,
  `aggroAt` and `feasible`. The pull is feasible when the creeps can clear the
  box before :00.
- **Ward blocking.** A ward inside the box blocks the spawn
  (`blockedBy: "ward"`, authoritative). The AI side is fog-safe:
  `suspectBlock(campId, { hadVision, campAppeared, visibleBlockers })` reads only
  what the team observed — the camp did not spawn at :00 while we watched it and
  saw no blocker — and returns a `deward` action (buy a sentry).

## 5. World events (`world-events.ts`)

- **Power runes.** One spawns every 120 s from 360 s on, on a seeded random
  spot (`top` or `bottom` river). Its type comes from Haste, Double Damage,
  Arcane, Invisibility, Regeneration or Shield, and is **never the same as the
  previous** power rune.
- **Bounty runes** spawn every 180 s from 0 s, and **wisdom runes** every
  420 s from 420 s.
- **Alarms.** `upcomingRunes(now, lead = 15)` lists every rune spawn in
  `[now, now + lead]`. The support AI's "alarm clock" walks to the rune when
  this list is not empty.
- **Roshan.** When Roshan dies, `RoshanTimer.killed(t)` draws an
  integer `respawnAt ∈ [t + 480, t + 660]` (inclusive, own RNG stream) and keeps it **hidden**.
  `public(now)` exposes only `{ state, earliest, latest }`, where state
  is `"alive"`, `"dead"` (before the window opens) or `"maybe"` (inside it, inclusive; after `latest` it is certainly alive).
  `aliveProbability(now)` is the uniform CDF over that window, which the
  AI uses to schedule pit checks and wards. The **only** way to learn the true
  state is `tick(now)`, the authoritative spawn on the first tick ≥ respawnAt, which the integration
  reveals to a team only through fog.
- **Tree regrowth.** `TreeRegrowth.destroy(cellId, t)` stores
  `DestroyedTimestamp`. `tick(now, hooks)` regrows trees 180 s after they were
  destroyed, in ascending cellId order. 180 s follows the design brief; Dota
  uses 300 s, recorded as a deliberate tempo choice. On each regrowth it calls `hooks.restoreFogBlocker` and
  `hooks.restoreNav`. If `hooks.isOccupied` is true, it retries 10 s later
  instead of trapping a unit. Destroying a tree that is already cut keeps the
  original timestamp.

## Slices

1. **S1 Hero lifecycle and buyback.** `hero-life.ts` and `buyback.ts` with tests
   for the timer curve endpoints and monotonicity, modifiers, cleanup that keeps
   cooldowns, invulnerability breaking, buyback cost, cooldown and penalty, and
   all three utility branches plus their gates.
2. **S2 Creep waves.** Tests for scheduler exactness across odd tick sizes,
   scaling tiers, siege cadence, the super and mega templates, and a flat pool.
3. **S3 Neutral camps.** Tests for each blocker kind, stack accumulation, the
   stack planner window, and ward-block suspicion leading to a deward.
4. **S4 World events.** Tests for the power rune no-repeat rule over 200 spawns,
   cadences, alarms, Roshan staying within its window with no leak in the public
   view, and tree regrowth hooks and retry.
5. **S5 Namespace export and gate.** `make test` green.
6. **S6 Match integration (done).** `match.ts` drives every system:
   - **Time.** Durations run in Dota seconds ÷ `DOTA_TIME_SCALE` (2). Creep
     waves keep the 30 s match-clock metronome, and wave k leaves at 1 + 30k s,
     exactly once (guarded by wave index). Camp checks, runes and Roshan run on
     the Dota clock, so a camp check happens every 30 match seconds.
   - **Hero life.** `respawnSeconds(level)` uses `dotaLevel`, giving 6 s → 50 s
     of match time. Bonecaller's ultimate is the Reaper's Scythe analogue: a
     kill within 1.5 s of the hit adds respawn time. Spawn protection breaks on
     the first move, cast, item use or TP. Cooldowns tick while dead. Once a
     second while dead the hero runs its dead brain: it shops (respecting the
     buyback floor), sorts the backpack, scores buyback, and plans a TP to the
     friendly tower nearest the objective (only when defending, fighting or
     after laning).
   - **Buyback.** The reserve floor is now `buybackCost(netWorth)`. The base
     defense branch requires at least 2 visible enemies at our base, and the
     fight branch requires the game to be past laning with at least 2 allies
     engaged. The feed explains each buyback.
   - **Waves.** Wave composition and the super/mega templates come from
     `BarracksState`. Creep bodies are pooled through `RecyclePool`, with a
     30 s quarantine before reuse so stale references are cleared. Reuse is
     more than 3× creation in a full game.
   - **Camps.** Camps start empty and spawn at the first check. Spawn boxes
     block on heroes, creeps, neutrals and wards. Supports pull large or
     ancient camps at Dota :53, and pulled neutrals chase past their leash for
     2.5 s to clear the box. The sentry stock is separate from observers.
     Supports block an enemy large camp, and dewards are inferred fog-safe.
   - **Runes.** Bounty runes go to both jungles, power runes to a seeded river
     spot (on its own RNG stream), and wisdom runes to both rune spots.
     Supports walk to runes on the 15 s alarm. Rune gold is tracked as the
     `runes` source.
   - **Roshan.** `RoshanTimer` has its own RNG stream. The AI reads it only
     through `roshanBelief(side)`: the pit when it is lit, otherwise the CDF and
     the time of our last empty-pit check. The snapshot carries
     `roshanWindow`, never the exact respawn time.
   - **Trees.** Trees regrow through `TreeRegrowth` 3 Dota minutes after being
     cut, restoring the fog blocker and the nav cell, and retry while the cell
     is occupied.
   - **HUD.** Hero frames show the death progress from `respawnTotal`, the
     buyback price or cooldown, and a spawn-protection ring. The scoreboard
     shows the Roshan window ("Roshan 3:46–5:16", then "maybe up"). The
     minimap shows runes and sentries in a different colour, and the feed has
     buyback and rune icons.
   - **Evidence.** `make test` passes (323 tests, including
     `tempo-match.test.ts`). The balance gate gives 6 seeds of 13.9–27.5 min
     with both sides winning. In the browser, the full flow draft → match →
     late game shows no errors. Screenshots are
     `docs/design/respawn-hud.jpg` and `docs/design/respawn-roshan-window.jpg`.

## Gate

Verdict **PASS** for S1–S6. Evidence: `make test` passes, the match-level tempo
tests pass, the 6-seed balance gate passes, and a browser playthrough is
recorded in S6 above.

## Review resolutions (fresh-context review)

1. The integration conflicts with uncommitted `match.ts` work, so the modules
   ship pure and S6 is deferred. The user chose this.
2. Time scale: the modules use authentic Dota seconds and the integration
   multiplies by `DOTA_TIME_SCALE`. This keeps the Dota numbers readable and
   testable.
3. Penalty semantics: `+25 s` applies to the **next** death only, then clears.
4. Barracks granularity: super creeps follow the barracks type (melee or
   ranged), which is the Dota rule. Mega requires all six barracks.
5. The Roshan information leak is prevented by the type itself:
   `RoshanPublic` has no `respawnAt` field.
6. Review CONCERNS (fresh context) resolved: level mapping (`dotaLevel`), L25
   ≈ 78 s, `MIN_RESPAWN` constant + combined-modifier test, siege cadence
   stated as intentional, wave-0 double count + float drift (epsilon +
   property test), separate RNG streams per system (`PowerRuneRoller`,
   `RoshanTimer` each take their own `Random`), Roshan inclusive integer
   window, buyback cost at purchase tick, fog-safe ward inference,
   stack semantics, tree regrow order + 180 s noted vs Dota 300 s,
   spawn protection timeout, gate stamped only after `make test`.
7. Checked against current Dota as design references: Reaper's Scythe extra
   respawn, siege creeps buffed by the ranged barracks and water runes
   (deliberately omitted) were kept as the brief specifies.
