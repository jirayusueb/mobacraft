# Game Definition — Mobacraft (map milestone)

Phase: **Discovery**. This milestone delivers the _map_: a Dota 2–style three-lane
battlefield rendered as a cozy isometric diorama in the visual language of
[Quack](https://playquack.xyz). Heroes, creeps and combat are out of scope.

## Fantasy

You are looking down at a tiny, living toy world where two ancient kingdoms
face each other across a river — you feel like a commander studying a
beautiful war-table.

## Goal

For this milestone: the player can explore the full map (pan, zoom, rotate,
minimap jump, time of day), identify every Dota landmark (3 lanes, river, 2
bases on high ground, 22 towers, 12 barracks, 14 jungle camps, Roshan pit,
2 runes, 2 secret shops) and read which team owns each half at a glance.

## Pressure

None yet in the map milestone — the map _creates_ future pressure through
geography: chokepoints in the jungle, high-ground cliffs around each base,
a river that is slow to cross, and lanes of different length.

## Defining Twist

A MOBA battlefield presented as a calm, hand-made diorama island (stepped
voxel-ish terrain, cloud trees, cut-cake cliff edges, glass-pill HUD) rather
than a dark, noisy esports arena. Radiant reads as spring; Dire reads as autumn.

## Core Loop

Map milestone loop (30 s): open map → drag/scroll to inspect a region (5 s)
→ hover/select a structure to see its card (5 s) → jump via minimap to the
other side (2 s) → rotate to see the cliff/river from another angle (3 s)
→ scrub time of day to see the mood change (5 s) → repeat on the next lane.
Full-game loop (later milestone): last-hit in lane → gold → item → push tower.

## Candidate loops (Discovery only)

- Map explorer only (chosen): proves terrain, art direction, renderer and
  layout before any gameplay is funded.
- Single hero walk-around: needs pathing, animation, input — premature.
- Map editor (build-mode like Quack): attractive, but layout must be fixed
  and symmetric for MOBA fairness, so authoring tools come later.
