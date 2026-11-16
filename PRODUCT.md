# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: players who would enjoy a calm, toy-like take on MOBA strategy — people who know (or are curious about) Dota-style three-lane maps but are drawn to cozy, hand-made worlds rather than dark esports arenas. Today they open the page to explore the battlefield: pan, zoom, rotate, scrub time of day, and inspect buildings, camps and landmarks.

Builder: a solo/indie developer growing the game milestone by milestone; every surface must stay legible and maintainable for them.

## Product Purpose

Mobacraft is an indie Dota-style MOBA in development. The current milestone is the map: a complete three-lane battlefield (Radiant vs Dire, river, jungle, high-ground bases, Roshan) presented as an explorable isometric diorama island. Success for this milestone: a player can find and identify every landmark, read which team owns each half at a glance, and wants to linger. Later milestones add heroes, creeps and combat on the same map data.

## Positioning

A MOBA battlefield rendered as a calm, hand-made diorama — stepped toy terrain, cloud trees, a cut-cake island edge, day/night mood — instead of a grim competitive arena. Radiant reads as spring, Dire as autumn. Layout fidelity to classic Dota is kept, so strategy knowledge transfers.

## Operating Context

- Runs in desktop browsers on the web; WebGPU first with automatic WebGL2 fallback.
- Interaction: drag pan, wheel zoom to cursor, Q/E rotate, WASD pan, click to select, minimap jump, time-of-day slider; HUD keyboard shortcuts (Esc, ?, T, +/−).
- Sessions are exploratory and unhurried; the page may be left open as an ambient scene.

## Capabilities and Constraints

- Map is pure deterministic data (`generateMap(spec)`); Dire is a point-mirror of Radiant. Simplified classic layout (~7.2x): 3 lanes, 11 towers + 6 barracks per team, 7 camps per side, Roshan, 2 power runes, 2 secret shops. Tormentors, lotus pools, watchers, twin gates, bounty/wisdom runes are out of scope.
- Renderer is the single `MapView` Effect service; HUD talks to it only through that interface.
- No heroes, creeps, combat, audio, accounts, multiplayer, save, or monetisation yet — undecided, not to be implied in UI copy.
- Player-facing strings use stable keys (`apps/web/src/strings.ts`) for future localisation; English only today.
- Performance target: 60 fps on an M-series laptop at DPR ≤ 2.

## Brand Commitments

- Name: **Mobacraft**. Island title in HUD: "The Ancient Isle".
- Visual benchmark the user named: Quack (https://playquack.xyz) — cozy isometric diorama with floating glass-pill HUD. Reference: the hedge-maze shot on https://playquack.xyz (not redistributed here).
- Team identity: Radiant green / spring, Dire red-orange / autumn.

## Evidence on Hand

- Screenshots of the current build: `docs/design/shot-day.png`, `shot-night.png`, `shot-base.png`, `shot-roshan.png`; layout debug render `docs/design/layout-topdown.png`.
- Specs: `spec/01-04*.md`; ADRs in `docs/architecture/`.
- No players, testimonials, playtest data, store pages, or release dates exist — do not fabricate them.

## Product Principles

1. **The map is the product right now** — every surface serves exploring and reading the battlefield; the UI recedes.
2. **Strategy must stay legible through the coziness** — team ownership, lanes, objectives and high ground read instantly at any zoom and time of day.
3. **Calm over spectacle** — gentle motion, soft light, no esports noise; something you could leave open.
4. **Fidelity where it transfers** — keep Dota's topology so player knowledge carries over; simplify only what's out of milestone scope.
5. **One honest seam** — UI never reaches into the renderer; what the HUD shows comes from `MapView` state.

## Accessibility & Inclusion

- Every control reachable and operable by keyboard with visible focus; icon buttons labelled.
- Respect `prefers-reduced-motion` across HUD animation.
- Team identity must not rely on colour alone (pair with labels/shape/icons), since red/green is the core team split.
