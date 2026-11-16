# ADR 001: The map is pure data behind `generateMap`

- Date: 2026-11-16
- Status: Accepted

## Context

The renderer, minimap, future pathfinding and a future authoritative server all
need the same map. Dota fairness requires exact point symmetry.

## Decision

`@mobacraft/map` exposes one function, `generateMap(spec) → MobaMap`: pure,
deterministic, no DOM/three/Effect. Radiant layout is authored as normalised
data (`layout.ts`); Dire is derived by point-mirroring, never authored.

## Alternatives considered

- Hand-built three.js scene: not reusable by server/pathing, not testable.
- Tilemap file from an editor: good later for authoring, but symmetry would be
  a convention instead of a construction.

## Consequences

Symmetry, counts, walkability and determinism are unit tests. Changing the seed
only re-scatters trees/props; layout is fixed. Any consumer can run headless.
