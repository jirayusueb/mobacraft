# Locomotion & Pathfinding (milestone 4)

Dota 2–style movement for the match sim: turn-rate physics, clearance-aware
dynamic navigation, local avoidance, wall sliding, and free pathing after
forced displacement. Spec-first slice: the system lives in `@mobacraft/sim`
as pure code, is driven by the existing 0.1 s deterministic tick, and stays
invisible to the renderer except through the unchanged `Population` seam.

## Scale convention

Dota units are mapped onto tile units at **64 Dota units = 1 tile** (the
Dota grid resolution). Consequences: hero hull radius = 24/64 = **0.375
tiles** (large heroes 8/64 = 0.125; creeps 0.25) and the movement gate
angle is **0.2 rad (≈11.5°)** exactly as in Dota. Turn rate is stored
directly in **rad/s**: heroes span **5–10 rad/s** (half-turn in
`π/turnRate` = 0.31–0.63 s, the felt range of Dota heroes; we do not
transcribe Dota's per-0.03 s formula). The gate applies only to forward
acceleration — no turn-rate compensation on attacks/casts in this slice.
**Max speed is 3.5 tiles/s** (existing bodies are 2–3), so a step is
≤ 0.35 tiles per 0.1 s tick — the bound the wall-slide rule relies on.
All logic remains 2D on (x, z); the engine already projects height
visually from the map heightmap, which this milestone does not change.

## Layer 1 — Hybrid navigation

Two tiers over the existing 128×128 walkability grid:

- **Macro**: grid A* with string pulling (current `Nav`), kept as the
  cross-map tier. Unchanged interface: `path(from, to) → Vec2[]`.
- **Micro/dynamic**: `DynamicNav` wraps `Nav` and owns the _dynamic
  obstacle state_: trees cut or regrown during the match and temporary
  walls (ability blockers, deferred to a later slice). It partitions the
  grid into **16×16 chunks**; cutting a tree clears its cell and marks
  only that chunk (and the path cache entries crossing it) dirty. A
  regrow re-blocks the cell the same way. Heroes can path through a
  fresh tree gap on the very next `travel()` call — tree juking.
- **Clearance map**: a per-cell free-space field computed with a
  two-pass chamfer distance transform where `clearance(c) = D(c) − 0.5`
  and `D(c)` is the distance in tiles from cell center to the nearest
  blocked cell center (blocked cells: 0; orthogonal neighbor: 1;
  diagonal: √2). This is the free space from the cell's boundary. A*
  expansion prunes cells whose clearance < unit radius _unless_ the
  goal itself sits in a tight spot (then it snaps inward as today).
  Consequence: a 1-tile slit has clearance 0.5 ≥ 0.375 and stays
  passable **by design** (a 0.375 hull fits a 1.0 gap — tree juking),
  while dead-end gaps narrower than 2 × radius and forest-edge hugging
  are avoided whenever a wider route exists.

Interface: `new DynamicNav(map)` → `cutTree(p)`, `regrowTree(p)`,
`path(from, to, radius, opts?: { ignoreForest?: boolean })`,
`clearance(p)`. `match.ts` replaces `createNav(map)` with it and feeds
it the existing `cutTree` events. `ignoreForest: true` is how Layer 4's
free pathing reaches the nav layer; clearance pruning is skipped in
that mode.

## Layer 2 — Turn rate & movement physics

`moveBody(b, desired, dt)` replaces `stepToward`'s instant heading snap:

- Each body carries `turnRate` in rad/s (see scale convention: heroes
  5–10; creeps 7), `heading`, and `moveWithoutTurning?: boolean`
  (Io/Pangolier-like units).
- Forward acceleration only when `|angleDiff(heading, desiredDir)| <
  0.2 rad`; otherwise the body rotates in place (still slides on
  existing momentum via velocity damping below).
- Speed ramps with acceleration (12 tiles/s²) and decays when stopping
  (soft stop inside `stopAt`), so cornering and stops read as weight,
  not teleportation.
- **Waypoint queue**: bodies hold `path: Vec2[]`; a waypoint is accepted
  within `accept = radius + 0.1` tiles and the next is taken without
  slowing (smooth cornering). `pathKey` invalidation as today, plus
  DynamicNav chunk-version invalidation.

## Layer 3 — Collision & avoidance

Per tick, after desired velocities are chosen:

1. **RVO2-lite**: for every moving body, sample up to 8 nearest
   neighbours (spatial hash grid, 1-tile buckets, rebuilt per tick;
   neighbours collected in bucket-row order and ordered by distance
   then by body id — ties resolve deterministically); compute a
   reciprocal velocity obstacle per neighbour weighted by relative
   priority (hero 2, creep/neutral 1; mass hero 2, creep/neutral 1)
   and pick from the fixed candidate ray set `[−60°, −30°, 0°, +30°,
   +60°]` around the desired heading, evaluated in index order with
   strict `<` improvement, the velocity that maximises the minimum
   predicted overlap time. This produces the sideways step around a
   head-on creep in a lane.
2. **Hard hull separation**: after integration, resolve circle overlaps
   (radius pairs) by pushing both bodies apart half-half weighted by
   mass (heroes push creeps 2:1), never into blocked cells (the slide
   below runs after separation).
3. **Body blocking**: a body whose RVO solution would move it _forward
   past_ a slower, higher-priority body directly in front (centre
   within 2 × (r₁+r₂), blocker's heading within 0.4 rad of the subject's)
   instead **yields**: its velocity component along the blocker's
   heading is clipped to the blocker's speed. Repeated yields
   reproduce creep blocking — the creep slows behind the hero.
4. **Phase movement**: `b.phase > 0` skips unit-vs-unit steps 1–3
   (still collides with forest/walls). Set by abilities/items later;
   the field and its handling ship now.

## Layer 4 — Height & forced movement

- Sim positions stay 2D (no change). The engine's height smoothing is
  untouched.
- **Free pathing**: any forced displacement (dash/blink/knockback that
  crosses blocked cells) sets `b.freePath = 5` seconds: pathfinding for
  that body runs with `ignoreForest: true` (clearance pruning skipped),
  unit-forest collision is skipped, and the flag decays; movement out
  of a blocked cell toward the nearest open cell is allowed. Dash
  abilities in `hero-systems` set it.

## Layer 5 — Wall sliding

When an integrated step lands in a blocked cell (forest), the step is not
discarded: compute the cell's inward axis-aligned normal `N`, project the
velocity `V ← V − (V·N)N`, re-attempt the step, and re-check. One
projection per tick is enough (cells are 1 tile, steps ≤ 0.35 tiles);
bodies therefore _slide_ along tree walls instead of sticking.

## Tests (bun test, deterministic, no renderer)

1. Turn rate: body commanded 180° behind reaches the 0.2 rad gate after
   `(π − 0.2)/turnRate` seconds, i.e. at tick
   `ceil(10·(π − 0.2)/turnRate)`; it does not move before that tick; a
   `moveWithoutTurning` body moves on tick 1.
2. Clearance: on the generated map, an A* route for radius 0.375 between
   two lane points never enters a cell with clearance < 0.375 whenever
   a route with all-clearance ≥ 0.375 exists; a goal down a 1-tile slit
   (clearance 0.5) still resolves and the route uses it.
3. Dynamic nav: a regrown tree that closes the only 2-wide shortcut
   makes the next `path()` call reroute the long way; the preceding
   `cutTree` had opened the shortcut. A cut/regrow dirties the cell's
   chunk plus its halo — at a chunk corner that is 4 chunks, so the
   assertion is **dirty chunk count ≤ 4**; regrow restores blocking.
4. RVO: two bodies head-on in an open lane pass each other sideways
   with zero final overlap (distance ≥ r₁+r₂ − 1e-6 after 6 s);
   priority yield: on the creep's goal axis, the creep behind a slower
   hero holding its line never advances beyond the hero's position
   minus (r_hero + r_creep) (blocking works); `phase` ignores both.
5. Slide: a body moving 45° into a forest wall exits the tick displaced
   along the wall with the normal velocity component removed.
6. Free pathing: a body placed inside forest with `freePath > 0` paths
   out and the flag decays over 5 s.
7. Regression: `make test` — seed-stability tests (same seed → same
   result _within a run's own new behaviour_) still hold; any
   trajectory-pinning snapshots are re-baselined exactly once at the
   integration commit, with the re-baseline named in the commit message.

## Out of scope (later slices)

Temporary ability walls in DynamicNav beyond the API, per-hero turn-rate
table overrides from `heroes.ts`, flying movement, Netcode prediction.

## Review resolutions (fresh-context review, verdict FAIL → resolved)

- Turn-rate convention unified: stored directly in rad/s (heroes 5–10),
  half-turn `π/turnRate` = 0.31–0.63 s; Dota's per-0.03 s formula is not
  transcribed. Max speed 3.5 tiles/s defined (backs the ≤ 0.35-tile step
  bound the slide rule needs).
- Clearance semantics fixed to boundary free space `D(c) − 0.5`; 1-tile
  slits (clearance 0.5) are explicitly passable by design (juking).
- Test 1 rewritten to `(π − 0.2)/turnRate` at discrete ticks.
- Test 3 semantics fixed (regrow closes, cut opens) with explicit ≤ 4
  dirty-chunk bound and corner-halo reason.
- `DynamicNav.path` gains `ignoreForest` for free pathing; clearance
  pruning skipped in that mode.
- RVO determinism: fixed candidate ray order, neighbour ordering by
  (distance, id), numeric priority (2/1) and mass (2/1) weights.
- Body-blocking made testable: yield clips the velocity component along
  the blocker's heading; thresholds quantified (2× radius sum, 0.4 rad).
- Gate: PASS for this spec (check-gate flags only spec/10, a separate
  workstream).
