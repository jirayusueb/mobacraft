# Crowd & Combat Locomotion — milestone 6 spec

Phase: **Production slice** on top of Match Day (spec/05) … Fog of War (spec/08).
Benchmark: Dota 2 (Source 2) unit movement — attack point / backswing, 250-unit
attack-range buffer, slot-free "flowing" melee surrounds — plus RVO2/ORCA crowd
avoidance and StarCraft II's "push idle units aside" yielding.
Goal: **no unit ever stands next to an enemy without swinging** because of a
crowd. Navigation, local avoidance and the combat state machine become three
separate layers that never write each other's state.

## 0. Ground truth (before this spec)

- `match.ts` moves bodies by writing `b.x/b.z` directly inside the decision
  loops (`stepToward`, `travel`, `moveToward`, creep lane easing). Bodies have
  **no radius**; units overlap freely, stack on one tile and the renderer shows
  a single blob. Melee creeps converge on the exact target centre.
- `attack(b, t)` deals damage in the frame it is called; there is no wind-up,
  so a swing can never be "lost" — but also nothing to lock, nothing to cancel.
- Distances are tiles. Speed ≈ 3 tiles/s vs Dota ≈ 300 u/s ⇒ **1 tile = 100 Dota
  units**. All Dota figures below are converted with that factor.
- Tick is fixed `TICK = 0.1 s`; the sim is deterministic (no RNG in this spec).

## 1. Layering (the rule this spec exists for)

```
Decision (think / chooseTarget)          → intent, target
Navigation  macro: A* (nav.ts)  > 3 tiles → preferred velocity
            micro: context steering ≤ 3  → preferred velocity
Combat FSM  attack-phase.ts               → lock / unlock movement, damage frame
Avoidance   ORCA (crowd.ts)               → safe velocity (only writer of x/z)
```

- Decision code **never writes positions**. It writes a _preferred velocity_
  (`b.pvx/b.pvz`) through `steer()`; one `crowdStep(dt)` per tick runs ORCA for
  every mobile body and integrates. Exceptions (teleports): respawn, dash
  abilities.
- Physics engine is not used; overlap is prevented by velocities, not pushes.

## 2. ORCA / RVO2 local avoidance (`sim/match/crowd.ts`)

- Port of RVO2's `computeNewVelocity` for agent–agent half-planes
  (linearProgram 1/2/3), time horizon `τ = 1.0 s`, neighbour radius 3 tiles,
  max 10 neighbours, `timeStep = dt`.
- Body radii: hero 0.4, creep 0.35 (siege 0.5), neutral 0.4, Roshan 0.9,
  tower 0.8, barracks/ancient 1.2. Structures are static agents.
- **Avoidance priority** (`avoidPriority(body)`):

| State                                                     | Priority | Meaning                |
| --------------------------------------------------------- | -------- | ---------------------- |
| Attack point / cast lock / engaged in range of its target | 1.0      | a wall: does not avoid |
| Moving (preferred speed > 0)                              | 0.5      |                        |
| Idle (no preferred velocity, not engaged)                 | 0.1      | gives way to everyone  |

- Responsibility split: agent A takes share `pB / (pA + pB)` of the ORCA
  correction against B (RVO2's fixed 0.5 is the equal-priority case). If B has
  priority 1.0 B is static: A takes the **whole** correction and B's velocity is
  treated as 0. Priority-1.0 agents skip ORCA entirely (velocity = preferred,
  normally 0) — they cannot be shoved out of range.
- After ORCA, the step is accepted only onto walkable cells (`Nav.walkable`);
  otherwise slide along x, then z, else hold.

## 3. Dynamic attack rings & slot reservation (`sim/match/attack-ring.ts`)

- Every attacked target gets two concentric rings on demand:
  - Ring 1 radius `r1 = tR + 0.7`, slot count `N1 = clamp(floor(2π·r1 / 0.84), 4, 12)`
    (6–8 for a hero-sized target).
  - Ring 2 radius `r2 = r1 + 0.85`, `N2 = clamp(floor(2π·r2 / 0.84), 6, 16)` —
    for long-reach melee (reach ≥ r2) and for units waiting to slot in.
- Used by **melee** attackers only (range < 2.5); ranged units hold at range
  and rely on ORCA.
- Reservation starts when the attacker is within 3 tiles (micro range) of the
  target. Cost of a free slot: `|attacker → slot| + 0.6 · r · |Δθ|`
  (walk distance + arc to go around). Long-reach attackers try ring 2 first.
- Pathfinding goal becomes `target.pos + slotOffset`, not `target.pos`.
- Re-evaluation every 0.5 s: move to a free slot if it is ≥ 0.5 cheaper.
- **Preemption**: an attacker already within reach of the target with no
  ring-1 slot takes a ring-1 slot whose holder has not arrived (holder is
  ≥ 0.35 from the slot and farther from it than the arriver + 0.5). The holder
  receives the arriver's old slot (or none → re-requests next tick).
- Release when the attacker dies, changes target, or is > 4 tiles away; a whole
  ring is dropped when its target dies.
- Range rule: in range when `dist ≤ range + 0.3 + max(0, tR − 0.4)` (Dota hull
  rule: big targets are hit from their edge). Ring-1 is always within every
  melee range under this rule.

## 4. Three-phase attacks (`sim/match/attack-phase.ts`)

| Phase        | Duration (default)                                          | Movement                               |
| ------------ | ----------------------------------------------------------- | -------------------------------------- |
| Attack point | hero 0.3 s, creep 0.3 s, tower 0.1 s (÷ attack-speed mul)   | **locked**; avoidance priority 1.0     |
| Damage       | the frame point ends                                        | damage / projectile; lock released     |
| Backswing    | hero 0.5 s, creep 0.4 s (capped so point + backswing ≤ BAT) | cancelled by any move order (orb-walk) |

- Acquisition: an attack starts only when in range (rule §3). The base attack
  time (cooldown) starts at the **start** of the point, so cancelling backswing
  never changes DPS — it only frees movement earlier.
- **Motion buffer**: during the point the swing is kept while the target stays
  within `range + 2.5` tiles (Dota 250-unit buffer). Beyond that, target death,
  stun or the attacker's own death cancel the point and refund the cooldown.
- Casting an ability sets a 0.3 s cast lock (same lock rules as the point).
- Retreating heroes do not start attacks (they would lock themselves in place).
- Roshan's cleave fires at the damage frame.

## 5. Macro navigation vs micro steering (`crowd.ts`)

- Goal farther than **3 tiles** (300 units): A* path waypoints (unchanged
  `travel`), preferred velocity toward the next waypoint.
- Within 3 tiles: **no A***. Context steering: 16 directions; interest
  `(1 + cos θ)/2` toward the goal; danger per ray = `1 − hit/L` from ray–circle
  tests against nearby bodies (radius sum) and unwalkable samples, `L =
  min(1.5, dist to goal)`. Pick `argmax interest·(1−danger)`; when the direct
  ray to the goal is clear (danger < 0.05) use the exact direction (no 22.5°
  quantisation jitter).

## 6. Anti-clumping & yielding (`crowd.ts`)

- A moving agent A casts its preferred direction 1.0 tile ahead. The first
  body B hit that is **idle** or **engaged but not in a point/cast lock**
  receives `RequestYield(dir)` (≤ once per 0.6 s per B).
- B steps perpendicular to `dir`, on the side of A's ray it already lies on
  (tie → by id order), at 0.7 × its speed for 0.35 s (≈ one body width).
- An engaged B only yields if the stepped position keeps it in range of its
  target; B never yields onto unwalkable ground.

## Acceptance (evidence required)

1. Unit tests: ORCA (head-on pair passes without overlap; priority-1.0 agent
   never moves; low-priority agent takes the larger share), rings (slot count,
   cheapest slot, re-evaluation, preemption swap, release), attack phase
   (damage only at point end, buffer keeps the swing, cancel refunds, backswing
   cancel on move), steering (detours around a blocker), yield (perpendicular,
   side-correct, in-range guard).
2. Arena scenario test: 8 melee attackers vs one target — ≥ 6 are swinging
   within 4 s, no two bodies overlap by > 30 % of radius sum after settling,
   and no attack point is cancelled by crowd drift.
3. Match gate unchanged: existing match tests (8–35 min, both sides win,
   determinism) pass with the crowd layer on.

## Out of scope

Renderer visualisation of slots/phases (debug overlay), formation movement,
flow fields, ORCA static-obstacle lines (forest handled by walkability slide).

## Review resolution (fresh-context review, verdict CONCERNS → resolved)

Where this section and §1–§6 disagree, this section wins.

1. **Priority rows** — only attack point and cast lock are 1.0. Engaged-in-range
   between swings (cooldown wait / backswing) is **0.5**, so it does ORCA and can
   yield. Two 1.0 agents both skip ORCA, but a lock lasts ≤ 0.3 s.
2. **Flicker** — gone with (1): priority now follows the phase state, which
   changes at most twice per swing, not a per-tick range test.
3. **Corridor jam** — covered by (1). Added acceptance test: a hero crosses an
   engaged melee brawl along a lane within a time bound.
4. **Preemption** — kept (requested by the user) but one level only. **Attacking
   never requires a slot: in range ⇒ swing.** Slots only steer the approach.
   Preemption: an arriver in reach whose own slot is ring 2 or none may take a
   ring-1 slot whose holder is not yet in reach and is farther from that slot
   than the arriver. The holder gets the arriver's previous slot (or none). Both
   are then frozen from preemption for 1.0 s, so swaps cannot cascade.
   Re-evaluation is trimmed: an attacker keeps its slot until release; there is
   no periodic cost re-check.
5. **Reach** — `reach(a, t) = a.range + 0.3 + max(0, t.radius − 0.4)`. Ring users:
   `range < 2.5` (includes Roshan 2.2, which uses rings on its targets like any
   melee). Ring 2 is preferred when `reach ≥ r2`.
6. **Balance** — ranged damage lands on the damage frame; the projectile stays
   cosmetic. Retreating heroes keep swinging at heroes in range. Cooldown is
   charged at the start of the point, and a cancel refunds it. Roshan's cleave
   moves into the damage frame. Acceptance adds a 1v1 DPS-parity test: the time
   to kill a dummy stays within +0.3 s of `ceil(hp/dmg)·BAT` (only the first
   point delays).
7. **Position writers** — creep lane easing becomes a preferred velocity toward
   the lane point. Remaining direct writers: respawn and the dash effect.
8. **Determinism** — ORCA reads only last tick's velocities. All bodies are
   solved first, then integrated together, in `bodies` array order. Neighbours
   are sorted by (distance, id). Steering argmax ties go to the lowest ray index.
   All timers are tick-driven, and no RNG is used.
9. **Macro/micro** — 3 tiles (the user's 300-unit rule) with hysteresis: enter
   micro under 3, return to A* above 3.5. Creeps keep following the lane
   polyline (their macro nav) and use micro steering only toward a target.
10. **Acceptance additions** — the corridor test (3), the DPS-parity test (6), the
    existing seed-determinism match test with the crowd layer on, and a perf
    budget: `crowdStep` mean ≤ 2 ms at ~150 bodies, measured in the match test
    run. Stacked spawns are separated by ORCA's overlap branch, which removes
    overlap within one step, split by share.

## Implementation verdict — PASS (commit 40c13f2)

Drift from the spec, found while making the acceptance tests pass:

- **ORCA τ = 0.4 s** (spec said 1.0). With 1.0 s the outer attackers in an
  8-melee scrum stood off for 5–6 s. With 0.4 s all 8 swing by 3.6 s.
- **Slot clamp**: a slot is pulled to at most `reach − 0.15`, because ring 1
  sits at exactly reach for range-1.2 units. `REACH_EPS = 0.05` absorbs
  float noise in the in-reach test.
- **Slot drift**: in-reach attackers settle into their reserved slot between
  swings, which frees the ring edge for late arrivals.
- **Orbit approach**: a slot more than 45° around the target is approached via
  an outer orbit (radius tR + 1.6…2.2). The direction is fixed at reservation,
  so the approach never flip-flops.
- **Idle teammates are not steering blockers**: movers walk at them and they
  yield (§6).
- **Terrain wedge repath**: a mover that wants to move, isn't moving, and
  isn't touching a body re-runs A* after 0.5 s, with a 2 s backoff. A mover
  already inside forest may step anywhere to escape.

Evidence:

- `crowd.test.ts` 23 tests: ORCA, steering, yield, rings, phases.
- `crowd-arena.test.ts` 4 tests: 8-melee arena, corridor + yield, DPS parity,
  motion buffer.
- Full sim suite 191/191.
- Seed 7 (AI vs AI): 21.5 min vs 21.0 baseline, 22.4k swings landed, 409
  cancelled (1.8 %, target died or left the buffer). crowdStep costs 0.04 ms
  per tick at ~83 movers.
