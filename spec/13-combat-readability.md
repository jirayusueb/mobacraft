# Combat Readability — milestone 7 spec (follow-up to spec/09 crowd-combat)

Phase: **Production slice**. Goal: make the spec/09 combat model _visible_ and
_per-hero_: wind-up and backswing read as different motions, orb-walking can be
seen, and a debug overlay shows rings, slots, phases and yields on the live
match.

## 0. Ground truth

- The sim has a three-phase swing per body (`attack-phase.ts`; `Body.swing`),
  but it exports only `Unit.attacks` (a counter). The engine plays a fixed
  0.55 s clip (`motion.ts ATTACK_TIME`) on each increment, so wind-up, strike
  and recovery timing are fake, and a cancelled backswing is invisible.
- Timings come from `swingTiming(class, BAT, asMul)`: every hero uses 0.3/0.5.
- The engine draws units through `createUnitLayer` (instanced, skinned). There
  is no debug drawing layer. `Population` is the only sim→engine seam.
- Web `match-screen.tsx` owns hotkeys (1–5, Space, [ ], G, T, +/−).

## 1. Per-hero attack point / backswing (`sim`)

- `HeroDef` gains optional `attackPoint` and `backswing` in seconds at
  attack-speed 1. A missing value falls back to the class default (0.3 / 0.5).
- Authored values follow Dota's feel per silhouette and keep `point +
  backswing ≤ attackTime`:

| shape                  | point | backswing |
| ---------------------- | ----- | --------- |
| knight / brute         | 0.40  | 0.50      |
| rogue / beast          | 0.25  | 0.40      |
| archer                 | 0.30  | 0.45      |
| mage / priest / shaman | 0.45  | 0.50      |

Shape is the default. Individual heroes can override (data only, no `if` per
hero). Fast-hands heroes get lower points.

- `swingTiming` takes an optional `{ point, backswing }` base, then applies the
  same attack-speed scaling and BAT cap as today.
- Balance gate: the existing match tests still pass (8–35 min, both sides win,
  deterministic).

## 2. Exposing swing phase through the seam (`sim` → `engine`)

- `Unit` gains optional fields (omitted → old behaviour, explore creeps
  unchanged):
  - `swing?: "point" | "backswing" | "cast"` — the current phase, `cast` while
    `castLock > 0`.
  - `swingT?: number` — 0..1 progress inside that phase.
  - `swingDur?: number` — total seconds of that phase (so the renderer can
    extrapolate between sim ticks).
- `Unit.attacks` stays: it still increments at the point start, as today.

## 3. Phase-driven animation (`engine`)

- `stepAnim` drives `attack` (the 0..1 clip the skeleton reads) from the sim
  phase when present:
  - point: `attack = 0.5 · swingT` (the skeleton's wind 0–0.35 and strike
    0.35–0.5 land exactly at the damage frame);
  - backswing: `attack = 0.5 + 0.5 · swingT`;
  - **cancel / no phase**: if the unit leaves backswing early (the phase goes
    to none while `attack < 1`), the clip blends to rest over 0.12 s instead of
    finishing. That makes orb-walking readable.
  - Without `swing` fields: the current ATTACK_TIME clip (explore creeps).
- Between sim ticks the renderer advances `swingT` by `dt / swingDur`, clamped
  to 1, and resyncs on the next snapshot (no stutter at ×1–×8 speed).

## 4. Debug overlay (`sim` debug API → `engine` layer → `web` toggle)

- `Match.crowdDebug(): CrowdDebug` (read-only, allocation per call is fine):
  - `rings: { targetId, x, z, r1, r2, slots: { x, z, ring, holder?: string }[] }[]`
  - `units: { id, x, z, vx, vz, pvx, pvz, mode: "locked" | "engaged" | "free",
    swing: "point" | "backswing" | "cast" | null, yielding: boolean }[]`
- `Population` gains optional `debug?(): CrowdDebug | undefined` so the engine
  stays sim-agnostic.
- Engine `createDebugLayer()`: one `LineSegments` with a dynamic buffer
  (capacity 8k segments, grown never), drawn on top (depthTest off):
  - ring circles (24 segments each; ring 1 solid team tint, ring 2 dim);
  - slot ticks: a small cross, green when held, grey when free, plus a line
    holder → slot;
  - per-unit velocity: preferred (thin white) and actual (cyan) from the
    unit's feet;
  - locked units: a red ring under the feet; yielding units: a yellow arrow.
- `MapView.setDebugOverlay(on)`; world calls `population.debug?.()` each frame
  only when on (zero cost when off).
- Web: `D` toggles the overlay on the match screen, with a small "DEBUG"
  chip when it's on.

## Acceptance (evidence required)

1. Sim tests: per-hero timings resolve (shape default, override, BAT cap);
   `units()` reports `swing`/`swingT` consistent with the swing state;
   `crowdDebug()` lists held slots and locked units in an 8-melee arena-like
   match moment.
2. Engine tests: `stepAnim` puts `attack` at 0.5 exactly when a point completes;
   a cancelled backswing returns to rest within 0.15 s; units without
   `swing` keep the old clip.
3. Debug layer test (pure): segment builder output counts for a known
   `CrowdDebug` input.
4. `make test` green; browser: match screen, `D` toggles the overlay, and a
   screenshot of a fight with rings/slots visible; 0 console errors.

## Out of scope

Turn-rate compensation on attacks, animation retiming per hero model, editor
gizmos, overlay for structures.

## Review resolution (fresh-context review, verdict CONCERNS → resolved)

Where this section and §1–§4 disagree, this section wins.

1. **Hotkey**: the engine pans with WASD and rotates/homes with Q/E/H
   (`map-view.ts` sends every non-Q/E/H key to its pan keys), so `D` would also
   pan. The overlay toggle is **backquote (`` ` ``)**. The web handler ignores
   it unless the target is `document.body`, and it never reaches the pan set.
2. **Time base**: `Population.timeScale?(): number` returns game seconds per
   real second (`speed`, or 0 while paused or finished). The renderer advances
   `swingT` by `dt · timeScale / swingDur`. Paused → frozen pose.
3. **Tick quantisation**: the sim reports `swingDur = ceil(dur / TICK) · TICK`,
   the phase's real length on the 0.1 s tick grid, and
   `swingT = 1 − leftQuantised / swingDur`.
4. **Cancel detection**: a cancel is "phase became none while the animated
   `attack` < 0.9". A phase that ends at ≥ 0.9 finishes its clip normally. When
   `attacks` increased but no phase arrived (a skipped frame hitch, or a creep
   without phase data), play the old fixed clip.
5. **Cast**: `cast` maps to `attack = 0.5 · swingT` (wind-up + strike over the
   0.3 s cast lock), then recovers like a normal swing end.
6. Animation math is confirmed: both skeleton envelopes strike-end at 0.5.
7. Timing data is confirmed: every hero satisfies `point + backswing ≤
   attackTime` (tightest is ivyshade, 0.25 + 0.45 ≤ 1.05).
8. **§1 location**: timings live in `sim/match/swing-timing.ts`
   (`SHAPE_SWING` + `HERO_SWING` overrides), not on `HeroDef`. `heroes.ts` is
   unchanged.
9. **Lines**: WebGPU lines are 1 px. Emphasis comes from colour and opacity
   only (`transparent`, `depthTest: false`, high `renderOrder`). The geometry
   uses `setDrawRange`, and segments past the 8k cap are truncated.
10. **Overlay cost**: the world re-reads `debug()` only when `population.time()`
    changed (once per sim tick at most). Trimmed: no yield arrows. Yielding
    units get a yellow foot ring, and there are no holder→slot lines (held
    slots are coloured instead).
11. **Added acceptance**: backquote does not move the camera; pause freezes
    `attack`; at ×8, `attack` never steps backwards within a swing; overlay-on
    frame cost ≤ 2 ms CPU for the debug layer (measured in the browser via
    `performance.now()` around the layer update).
