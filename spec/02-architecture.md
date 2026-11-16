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
