# Fog of War — milestone 5 spec

Phase: **Production slice** on top of Match Day (spec/05), Tactics (spec/06) and
Hero Systems (spec/07). Benchmark: Dota 2's fog of war — high-ground vision
blocking, tree shadows, day/night radii, True Sight — plus the strict
information isolation that competitive bot frameworks (OpenAI Five, Dota2AI)
enforce. Goal: vision stops being a radius paint and becomes a real
**line-of-sight system** that both teams' AIs can _only_ see through — no
cheating through world state, ever.

## Player fantasy (delta from spec/05–07)

You coach a team fighting inside real fog: ganks come out of the dark, the
mid laner you sent to ward can be seen walking there by the enemy only while
the path is lit, and "what does the enemy know?" becomes a readable coaching
question. On the match screen the battlefield shows the fog, so a viewer of
the auto-battle sees fights the way a caster does.

## 0. Relationship to existing code (ground truth)

- `packages/sim/src/match/vision.ts` today: a coarse grid (`VISION_CELL = 2`,
  map `size = 128` → 64×64), binary `cells` (visible / not), radius-only
  `reveal()` — **no line of sight, no explored state, no height rule**. The
  match owns one grid per side (`blue`/`red`) and recomputes every 0.5 s.
- `match.ts` has two readers: `seen(viewer, o)` (~line 1351, **combat targeting
  predicate**, owns the 3-tile proximity hole: `dist <= 3 || isVisible(...)`)
  and `visibleEnemyHeroes()` (~1353, grid-only listing). `seen()` is used by
  all unit matchups — melee creeps and towers hit things they collide with.
- Team keys: grids are keyed `DraftSide` (`blue`/`red`); `SIDE_TEAM =
  { blue: "radiant", red: "dire" }` (match.ts:93). **All new state in this
  spec is keyed by `Team` (`radiant`/`dire`); `SIDE_TEAM` converts.**
- `MobaMap` (packages/map) exposes `height` (`Float32Array`, quantised 0.25,
  tile-grid `size = 128`), `terrainAt` (`Terrain.Forest` = tree blocker,
  `Water` walkable-as-wade), `isWalkable`, `trees`.
- The sim is **deterministic and tick-based**; all new state must be seeded
  from the match RNG and advance from tick inputs only.
- No invisibility mechanic exists yet (spec/07 has Evasion only). True Sight
  ships as _infrastructure_ with the state machine ready; an invisibility
  mechanic is out of scope.
- No day/night clock exists in the sim. This spec introduces one.

## 1. Layer 1 — Multi-state visibility grid (`fog.ts`, replaces vision.ts internals)

One static layer computed once per match, one dynamic layer per team:

**Static (per cell, 64×64):**

- `height: Uint8Array` — height level per cell. `minH = min over all of
  map.height` (measured on seed 7: 0.25), band = `floor((h - minH) / 0.75)`
  clamped 0..3. Calibration assertion ships as a map fixture test: every
  landmark base sits at band ≥ 1 and at least one high-ground rim cell is
  band 2 while its adjacent lane cell is band 1.
- `blocker: Uint8Array` — 1 where the cell centre's `terrainAt` is
  `Terrain.Forest` **or** the cell has a `cutTrees` mask bit (§4c). Static-
  computed at load, runtime-mutable only through `destroyTree`/regrow.

**Dynamic (per team `radiant`/`dire`, one `Uint8Array` of bit flags):**

| Bit | Name        | Meaning                                              |
| --- | ----------- | ---------------------------------------------------- |
| 0   | `Explored`  | has ever been visible to this team; persists forever |
| 1   | `Visible`   | currently in live LoS this recompute                 |
| 2   | `TrueSight` | currently reveals invisible units in this cell       |

Plus one per-team `lastLit: Uint32Array` (tick of the last recompute that
lit the cell) — the linger state (§4b). `00` = unexplored (never seen),
explored-but-dark keeps the last-seen terrain snapshot for rendering;
`Visible` decays by tick arithmetic, never a blanket `fill(0)`. Grids are
plain typed arrays — bitwise ops and `fill()` stay cheap.

## 2. Layer 2 — Recursive shadowcasting LoS with height rule

`computeFog(team)` replaces `reveal()`:

- **Octant shadowcasting** (8 octants, slope-tracked, `start`/`end` slope
  queue per row scan) projected from each vision source. One source with
  radius `r` visits O(r²) cells — at 64×64 with ~40 sources this is
  microseconds; the 0.5 s recompute cadence is kept.
- **Height rule** (the Dota high-ground law), as shadowcasting semantics,
  not a per-cell formula: scanning outward from the source, track
  `litBand` = the band of the previously lit cell (source band for the
  first step). A cell whose band is **greater than `litBand`** is marked
  **visible but occluding**: it is lit, and everything behind it (further
  along the same ray within this octant) is shadowed until the ray reaches
  a band ≤ the occluder's band again (descending terrain re-lights; an
  upslope never does). A source with `flying` marks cells visible without
  occluding on height or trees. The rim cell itself is therefore visible
  from below — matches Dota and acceptance test 2.
- **Tree rule**: a blocker cell is lit itself (you see the tree) but opaque
  beyond it. Same slope mechanism as height — both are "lit-but-occluding".
- **Day/night**: cadence in real game seconds, derived from integer ticks
  (0.1 s ticks): **day for ticks 0–3599, night 3600–7199, alternating
  every 3600 ticks** (3 real minutes each — a 12–25 min match spans 2–4
  cycles, which is intended). Night multiplies every hero's radius by
  **0.6**; per-hero `nightVision` multiplier overrides it (archetype data,
  default 1.0). Creep/tower/ward radii are unchanged.
  Radii (in cells, from existing `VISION_RADIUS`, unchanged at day): hero 8,
  creep 6, tower 9, ward 9, structure 7.
- **Dirty region recompute**: a full-team recompute every 0.5 s stays the
  baseline; out-of-cadence events (tree destroyed, ward placed, hero died)
  mark a dirty rectangle = the **union of the event source's radius box and
  the bounding box of every live source whose radius intersects it**, then a
  partial pass re-runs exactly those sources, OR-ing results over the
  preserved cells outside the rect. A partial pass must produce byte-
  identical output to a full pass (asserted by test 7).

## 3. Layer 3 — Strict information isolation (`knowledge.ts`)

**The anti-cheat layer.** Hero AI and coach code must never read live enemy
bodies from world state.

- `TeamKnowledge` per side: the _only_ sanctioned view of the enemy.
  - `visible(enemyId)` → live reference (this tick's fog says visible, and
    for invisible-flagged units TrueSight bit set — infrastructure).
  - `ghost(enemyId)` → `GhostSnapshot { lastSeenTick, pos, vel, hpFrac,
    level, itemsAtSeen }`, created/updated the tick an enemy is seen, frozen
    the tick it goes dark. AI "guess where he went" logic (spec/06 `pickoff`)
    reads ghosts, never truth.
  - `IsVisibleToTeam(target, team)` is the single predicate: fog bit + true
    sight + alive; every **knowledge** reader (hero think, IGL, coach calls)
    goes through it. **Combat targeting keeps `seen()`'s 3-tile proximity
    hole** — a unit can always fight what it collides with — but proximity
    alone no longer feeds knowledge: a hero inside 3 tiles of an enemy in
    unexplored forest may swing, yet the enemy team's `TeamKnowledge` never
    learns of it unless the fog lights the cell. `mapControl` keeps counting
    raw lit walkable cells (team's own light metric, unaffected). **Feed and
    spectator events are explicitly out of scope**: they keep reading truth
    (viewers see everything); only AI decision inputs are masked.
- **Integration**: hero think and coach/IGL logic in `match.ts` switch their
  enemy-enumeration reads (`visibleEnemyHeroes()` and knowledge-flavoured
  `seen()` call sites) to per-team `TeamKnowledge` snapshots taken at the
  top of each tick; the combat-targeting `seen()` proximity rule stays (§3).
- **Test for the seam**: a regression test asserts, as **state assertions**
  (not read instrumentation): walking a hero through a fully forested
  corridor between two lit rooms leaves the enemy team's fog with zero
  `Visible` bits along the corridor and the walker's `GhostSnapshot` frozen
  at the last lit cell with `lastSeenTick` equal to that lit tick.

## 4. Layer 4 — Advanced mechanics

**a. Attack reveal** — a unit that basic-attacks from fog creates a
temporary vision bubble (radius 2 cells, 2.0 s, non-stacking) centred on the
attacker _for the defender's team_, so firing from high ground/fog exposes
you for the fight-back window. Implemented as a short-lived vision source
with `flying = false` in the recompute queue.

**b. Vision linger** — `lastLit[cell]` is the tick of the last recompute
that lit the cell; the `Visible` bit clears at the first tick where
`tick > lastLit + 5` (0.1 s ticks → 0.5 s wall-clock decay, independent of
recompute phase), dropping the cell to explored. A target leaving vision
stays targetable-by-knowledge for that grace window.

**c. Tree destruction & regrowth** — `destroyTree(cell)` sets the cell's
`cutTrees` mask bit (added to the blocker OR), marks the dirty region (§2
rule), and schedules regrowth after **1200 ticks (120 s)** — at regrow the
bit clears only if no unit occupies the cell, else it retries 100 ticks
later. No sim skill destroys trees yet; the API ships now for tests and
future specs.

**d. Ward expiry already exists** (`WARD_LIFETIME`); expiring wards now go
through linger (b) instead of vanishing cells instantly.

## 5. Layer 5 — Render (match screen fog)

- `packages/sim` exposes `fogSnapshot(team: Team) → { cols, bytes:
  Uint8Array }` — one byte per cell: `0` unexplored, `1` explored-dark,
  `2` visible (TrueSight is sim-side infrastructure only, not rendered this
  milestone).
- The match screen's map canvas uploads that as a small canvas layer at
  **20 Hz** with bilinear smoothing and temporal lerp (prev/current, 0.15)
  so fog fades instead of popping. 2D-canvas on the existing match overlay —
  no WebGPU pipeline change, no spectator fog toggle (blue-side coach
  perspective only). The diorama `MapView` fog pass stays deferred.

## 6. Performance budget

- Full recompute (both teams, all sources — realistic peak **100+** sources
  counting both sides' lane creeps — shadowcasting at O(r²) each):
  **≤ 2 ms** on the dev laptop per 0.5 s pass (micro-benchmark test,
  `performance.now()` upper bound with generous CI headroom ×4).
- Memory: static `height` + `blocker` = 8 KB; dynamic bit arrays 3×2 teams
  = 24 KB; `lastLit` 2×4096 Uint32 = 32 KB → **≈ 64 KB total**.
- No per-tick allocations in the recompute path (reuse scratch arrays).

## 7. Acceptance tests (`fog.test.ts`, `knowledge.test.ts`)

1. **Wall of trees** (synthetic fixture, not the real map): a forest wall
   lights the near side, leaves the far side unexplored-dark from a single
   source; `destroyTree` on one cell + dirty recompute opens a visible wedge
   (exercises the API, not a gameplay skill).
2. **High ground** (synthetic fixture): a source below a rim lights the rim
   cell but no cell beyond it; the same source on the high ground lights the
   basin.
3. **Night** (single-source synthetic fixture, walkable cells only): lit
   count at night = 0.36× the day count ± rounding; a boosted `nightVision`
   1.0/0.6 hero restores the day count; tower light identical day vs night
   (real map, sanity band only).
4. **Attack reveal** (ticks, 0.1 s each): attacking from fog lights the
   attacker's cell for the victim's team from the attack tick until
   `tick + 20` (2.0 s bubble), linger keeps it visible until `tick + 25`,
   explored-dark from `tick + 26`.
5. **Linger** (ticks): removing a ward at tick T leaves its cells visible
   while `tick ≤ T + 25`, explored-dark from `tick + 26` (decay semantics,
   §4b).
6. **Isolation**: state assertions per §3 (zero `Visible` bits along the
   forest corridor on the enemy grid; ghost frozen at last lit cell with
   matching `lastSeenTick`).
7. **Determinism & dirty convergence**: two runs of the same seed produce
   byte-identical fog histories; additionally, matches that interleave
   dirty-region events (tree cut, ward placed/expired, hero death) produce
   fog byte-identical to the same match replayed with forced full
   recomputes every tick.
8. **Budget**: recompute benchmark with a realistic 100+ source tick under
   the CI-padded bound.

## Out of scope (recorded, not implied)

- Invisibility mechanics consuming True Sight (infrastructure only), flying
  hero vision, day/night HUD clock art, WebGPU diorama fog shader pass,
  smoke/culling-decree-style vision denial, sentry-ward AI placement logic
  (ward targeting logic stays spec/06's).

## Verdicts

- Draft: reviewed fresh-context — **CONCERNS** (18 findings: contradictory
  height rule, underspecified dirty recompute, day/night unit mismatch,
  misstated ground truth, untestable isolation test, memory arithmetic,
  render-layer half-scope). All resolved in this revision: shadowcasting
  lit-but-occluding semantics (§2), dirty-rect union rule + convergence test
  (§2, test 7), real-second tick-derived day/night cadence (§2), corrected
  §0 ground truth with named call sites and key-space decision, tick-precise
  acceptance tests, `lastLit` array added to the layout (§1, 64 KB), render
  layer trimmed to a single-byte snapshot (§5), knowledge vs targeting split
  kept explicit with feed/spectator events declared out of scope (§3).
  Attack reveal is kept deliberately (test 4) with the accepted balance
  shift noted here. Verdict: **PASS** to implementation.
- Implementation: **PASS** — `fog.ts` (shadowcasting with separate tree and
  height-shadow block modes, day/night, linger, reveals, tree cut/regrow),
  `knowledge.ts` (TeamKnowledge + ghosts with heading×speed velocity),
  `match.ts` wiring (AI enemy reads via knowledge; targeting keeps the 3-tile
  collision rule), mini-map fog layer at 20 Hz. Evidence: fog/knowledge tests
  (fixtures + real-match isolation), fog-blend tests, full `bun run test`
  green, browser capture of the mini map mid-match.
- Known gaps (next spec): the partial dirty-region pass is implemented as
  "force a full recompute next tick" (byte-identical by construction; full
  pass costs ~1–3 ms for 100+ sources, inside the budget); invisibility/True
  Sight consumers and per-hero `nightVision` data are not populated; the
  diorama (WebGPU) fog pass is still deferred.
