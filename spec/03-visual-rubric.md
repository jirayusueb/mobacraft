# Visual Rubric

## Benchmarks

- **Quack** (playquack.xyz, reference shot `docs/design/quack-reference.jpg`) —
  isometric island slab with a cut-cake soil edge, round cloud-blob trees,
  dense flowers/grass, warm low-saturation greens, dark backdrop, floating
  glass-pill HUD (title + day/season top-left, pills bottom-left/centre/right).
- **Dota 2 minimap**: the authoritative layout — lanes, river diagonal, base
  corners, camp and tower positions; take topology, not art.
- **Townscaper / Islanders**: readable toy scale, soft shadows, calm motion.

## Palette & resolution (pixel art)

- Native resolution: not pixel art — smooth 3D, flat-shaded low-poly, rendered at device pixel ratio capped at 2.
- Palette: Radiant spring greens `#86b04a` / `#5d8a37`, Dire autumn `#9a9a4a` /
  canopy `#c0612f` `#d08a34`, lanes `#c2a46e`, river `#2f5a63`→`#5f9c95`,
  cliffs `#7a5a3c` / `#5b5f66`, team accents Radiant `#5fe07a`, Dire `#ff5a3c`,
  backdrop `#15181a`. Source of truth: `packages/engine/src/palette.ts`.
- Tile size: 1 world unit per tile, 128×128 tiles, height steps of 0.25.

## Gap audit

Scores (1-5) are targets to verify after the first build, vs Quack: environments 3, lighting 3,
scale 4, HUD 4, icons/buttons 4, animation 2 (wind sway + water only),
characters n/a, action/VFX n/a. Biggest gaps: no ambient occlusion, trees
less varied than Quack, no birds/animals.

## Asset export pipeline

All geometry is procedural code (no external models): `packages/engine/src/scene/*.ts`
builds meshes from `MobaMap`. Future glTF assets: Blender → glTF 2.0 (Draco) →
`apps/web/public/models/` → loaded by an engine module behind `MapView`.
