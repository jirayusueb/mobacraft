# Architecture

Discovery sketch. Vocabulary follows the codebase-design skill: **module**,
**interface**, **seam**, **adapter**, **depth**.

- Engine + version: three.js 0.187 `WebGPURenderer` (`three/webgpu`, TSL node
  materials; automatic WebGL2 fallback), React 19.3, Effect 4.1.4, Bun 1.4.4,
  Turborepo 2.11, Vite 8, Tailwind 4.3, react-aria-components 1.22.
- Folder map: `packages/map` (map as data), `packages/engine` (renderer),
  `packages/ui` (shadcn-style react-aria kit), `apps/web` (composition root).
  `prototypes/` is reserved for throwaway experiments and is never imported.
- Systems: camera (`engine/camera-rig`, pure), lighting/time-of-day
  (`engine/sky`, pure), terrain+water+foliage+structures (`engine/scene/*`),
  picking (engine raycast → `MapView.hovered/selected`), HUD + minimap
  (`apps/web`), input (pointer + keyboard handled inside the engine), menus /
  save / audio / analytics / localization are deferred to later milestones.
- Dependency rules: `map` → nothing. `engine` → `map`, `three`, `effect`.
  `ui` → `react-aria-components` only. `web` → all. React never touches
  three.js objects; it talks to the engine only through the `MapView` interface.
- Test approach: `bun test` per package through public interfaces (map
  invariants: determinism, symmetry, structure counts, walkability; camera
  rig: clamping, rotation, yaw-relative pan; sky curve). `tsc` typecheck,
  `oxlint`, `oxfmt --check`. Evidence for rendering = screenshot of the
  running page. Run everything with `make test`.
- Performance budget: 60 fps on an M-series laptop at DPR ≤ 2; low draw calls
  for the static map (instancing for trees, props, grass); terrain is one mesh;
  a single 2048 shadow map (< 400 draw calls incl. shadow pass).

## Modules and seams

| Module              | Interface                                                                                                            | What hides behind it                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `@mobacraft/map`    | `generateMap(spec) → MobaMap` (+ `terrainAt`, `heightAt`, `isWalkable`)                                              | Dota layout data, mirroring, river carving, high ground, forest noise, scatter              |
| `@mobacraft/engine` | `MapView` Effect service: `layer(canvas, map)`, then `rotate / zoomBy / home / focus / setTimeOfDay`, `state` stream | WebGPU init + fallback, scene build, lights, shadows, input, render loop, picking, disposal |
| `@mobacraft/ui`     | `Button`, `IconButton`, `Slider`, `Toolbar`, `Tooltip`, `Separator`                                                  | react-aria behaviour + Tailwind styling                                                     |
| `apps/web`          | the page                                                                                                             | runs the engine layer in a React-owned scope, renders HUD/minimap                           |

The single external seam into the renderer is `MapView`. Its lifetime is a
`Scope`: closing the scope stops the loop, removes listeners and disposes GPU
resources — so React's effect cleanup is one `Scope.close`.

## Review resolutions (fresh-context review, verdict CONCERNS → resolved)

- **Layout target**: simplified _classic_ Dota (~7.2x): 3 lanes, 11 towers + 6
  barracks + ancient + fountain + shop per team, 7 camps per side, 1 Roshan pit,
  2 river power runes, 2 secret shops. Tormentors, lotus pools, watchers, twin
  gates, wisdom/bounty runes are out of scope for this milestone.
- **`MapView` interface (complete)**: `state: Stream<ViewState>` plus commands
  `rotate(±1)`, `zoomBy(factor)`, `home()`, `focus(x, z)`, `select(id | null)`,
  `setTimeOfDay(t)` where **t ∈ [0,1)**, 0.5 = noon. Pan is input-driven
  (drag, WASD) and programmatic via `focus`. `ViewState` = backend, focus,
  yaw, zoom, viewExtent (map tiles), timeOfDay, phase, hovered, selected,
  fps, drawCalls. `hovered`/`selected` are `{ id, kind, team }` where `id` is
  the `MobaMap` structure/camp/landmark id — never a three.js object.
- **`MapSpec`** = `{ seed, size, forestDensity }`; **walkable** = in bounds,
  not forest, outside every structure radius. Tests assert every lane polyline
  stays on lane/plaza/shore/water tiles from ancient to ancient.
- **Keyboard ownership**: the engine reacts to keys only when focus is on
  `<body>` or the canvas; a focused HUD widget owns its keys.
- **Palette leak**: the minimap is drawn by the engine (`drawMinimap(map, canvas)`),
  so colours stay in `engine/palette.ts`; `web` never imports a colour.
- **`ui` deps**: react-aria-components + tailwind-variants/merge + lucide.
- **Draw calls**: structures are ~110 small meshes; budget raised to < 400
  draw calls including the shadow pass. Merging structures is a later
  optimisation if profiling shows it matters.

## Creatures (milestone 1.5)

- `@mobacraft/sim` owns _where creatures are_; `engine/creatures` owns _what they look like_.
  Seam: the `Creature` snapshot (id, kind, team, x, z, heading, state). The renderer
  never decides behaviour; the sim never touches three.js.
- Art direction: polygon dark fantasy — faceted flat-shaded low-poly, chunky readable
  silhouettes, glowing eyes/runes (`glow` attribute → emissive → night bloom).
- Model kit contract: `engine/src/creatures/contract.ts` (attributes position, normal,
  color, glow, limb; feet at y=0, +z forward). Gait animation is TSL-only.
- Rendering: one InstancedMesh per kind (≤ 23 draw calls); per-frame CPU = instance matrices.
- No combat/HP yet: waves "clash" (hold for a few seconds) and march on.

## Match Day (milestone 2)

- `@mobacraft/sim/match`: `createDraft/applyDraft/aiChoose` (pure draft state machine + AI coach),
  `createMatch(map, draft, {seed})` (deterministic 0.1 s tick 5v5; grid A* nav; utility AI per hero
  biased by coach calls and player `sense`). Implements the `Population` seam.
- `Population` (sim/population.ts) is the engine's only input for units: `advance(dt) · units() · fx() · structures()`.
  Explore mode = `creepPopulation(map)`; Match Day = a `Match`. `MapView.setPopulation(p | null)` swaps them.
- Engine draws heroes from `creatures/kit-hero.ts` through the same instanced creature path; destroyed
  structures collapse in the baked meshes via a `structureAlive` uniform array (no draw-call cost) plus rubble.
- Web: `apps/web/src/match/*` — flow reducer (explore → pick-team → draft → match → results) and screens.

## Tactics & Coaching (milestone 3, spec/06)

- New pure sim modules: `match/matrix.ts` (tags derived from ability data → synergy/counter/matchup),
  `match/tactics.ts` (TeamTactics data, defaults, `aiTactics`, `normalizeTactics`, lane preview,
  build presets), `match/vision.ts` (2-tile visibility grid, ward spots from map data).
- `createMatch(map, draft, { tactics })` owns phases, vision/wards, IGL relay, gold-by-source and a
  5 s history; live commands `swapLanes / setPlan / setBehavior / setTeamTactics`. Every random roll
  (call compliance) uses the match's seeded stream, so determinism holds with live commands.
- The snapshot is the HUD's only source (net worth, history, comms, wards); the results graph reads
  `final.history`, not UI-side sampling. Population seam unchanged (no 3D wards / fog this slice).
- Web: flow `draft → tactics → match`; the minimap ward overlay is SVG with team CSS tokens.
