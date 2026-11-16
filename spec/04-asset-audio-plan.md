# Asset & Audio Plan

## Representative assets first

1. Terrain tile set (top, cliff band, island edge strata) — proves the stepped look.
2. Cloud tree (trunk + 3 canopy blobs, two seasonal palettes) — proves instancing.
3. Tower (tier 1-4) + ancient — proves team readability.
4. HUD pill set with every button state (rest, hover, pressed, focus-visible, disabled).

## SFX families

Deferred to the gameplay milestone. Planned: ambience (birds by day, crickets
by night, river loop), UI (soft wooden clicks), structure select (chime per team).

## Music loops

Deferred. Planned: calm generative explore loop per time of day, like Quack.

## Analytics taxonomy

Deferred; reserved names: `map_open`, `camera_rotate`, `minimap_jump`,
`structure_select`, `time_scrub`. Never blocks rendering.

## Localization

English only for the map milestone; HUD strings live in one `strings.ts` with
stable keys (`hud.title`, `hud.time.day` …) so translation needs no refactor.
