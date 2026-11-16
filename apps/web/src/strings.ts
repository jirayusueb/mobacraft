/** Player-facing text, keyed for future localisation. */
export const strings = {
  "app.name": "Mobacraft",
  "hud.title": "The Ancient Isle",
  "hud.subtitle.day": "Day",
  "hud.subtitle.season": "Summer",
  "hud.loading": "Growing the island…",
  "hud.loading.hint": "Planting trees, raising towers",
  "hud.failed": "The renderer couldn't start",
  "hud.failed.body":
    "Your browser or GPU didn't let us create a WebGPU or WebGL2 context. Try updating your browser, enabling hardware acceleration, or reloading.",
  "hud.failed.details": "Technical details",
  "hud.failed.retry": "Reload",
  "hud.rotate.left": "Rotate left",
  "hud.rotate.right": "Rotate right",
  "hud.home": "Reset view",
  "hud.zoom.in": "Zoom in",
  "hud.zoom.out": "Zoom out",
  "hud.camera": "Camera",
  "hud.time": "Time of day",
  "hud.time.group": "Time of day controls",
  "hud.time.play": "Play day cycle",
  "hud.time.pause": "Pause day cycle",
  "hud.stats": "Performance stats",
  "hud.help": "Controls",
  "hud.jump": "Jump to",
  "hud.focus.radiant": "Radiant Ancient",
  "hud.focus.dire": "Dire Ancient",
  "hud.focus.roshan": "Roshan's Pit",
  "hud.minimap": "Minimap",
  "hud.minimap.hint": "Click or drag to move the camera. Arrow keys pan when focused.",
  "hud.legend": "Towers standing",
  "hud.card.close": "Clear selection",
  "hud.card.center": "Center camera",
  "hud.card.team": "Team",
  "hud.card.lane": "Lane",
  "hud.card.tier": "Tier",
  "hud.card.type": "Type",
  "hud.card.grid": "Grid",
  "team.radiant": "Radiant",
  "team.dire": "Dire",
  "team.neutral": "Neutral",
} as const

export type StringKey = keyof typeof strings
export const t = (key: StringKey) => strings[key]

export const KIND_LABEL: Record<string, string> = {
  ancient: "Ancient",
  tower: "Tower",
  "barracks-melee": "Melee Barracks",
  "barracks-ranged": "Ranged Barracks",
  fountain: "Fountain",
  shop: "Shop",
  "secret-shop": "Secret Shop",
  roshan: "Roshan's Pit",
  rune: "Power Rune",
  "camp-small": "Small Camp",
  "camp-medium": "Medium Camp",
  "camp-large": "Large Camp",
  "camp-ancient": "Ancient Camp",
}

export const KIND_BLURB: Record<string, string> = {
  ancient: "The heart of the base. Destroy the enemy Ancient to win.",
  tower: "Guards the lane. Towers must fall in order, tier 1 → 4.",
  "barracks-melee": "Destroying it upgrades your melee creeps in this lane.",
  "barracks-ranged": "Destroying it upgrades your ranged creeps in this lane.",
  fountain: "Heals and restores mana. Heroes respawn here.",
  shop: "Base shop for most items.",
  "secret-shop": "Sells advanced components you can't buy at base.",
  roshan: "The strongest neutral. Drops the Aegis of the Immortal.",
  rune: "Spawns a power rune every two minutes.",
  "camp-small": "Neutral creeps. Quick to clear, low gold.",
  "camp-medium": "Neutral creeps. Fair gold for the time.",
  "camp-large": "Neutral creeps. Good gold, but they hit hard.",
  "camp-ancient": "Ancient creeps. Best gold, very dangerous.",
}

export const KIND_TYPE: Record<string, string> = {
  ancient: "Structure",
  tower: "Structure",
  "barracks-melee": "Structure",
  "barracks-ranged": "Structure",
  fountain: "Structure",
  shop: "Shop",
  "secret-shop": "Shop",
  roshan: "Landmark",
  rune: "Landmark",
  "camp-small": "Neutral camp",
  "camp-medium": "Neutral camp",
  "camp-large": "Neutral camp",
  "camp-ancient": "Neutral camp",
}

export const LANE_LABEL: Record<string, string> = { top: "Top", mid: "Mid", bot: "Bot" }

/** Help popover rows: keys (each rendered as a key cap) → action. */
export const CONTROLS: readonly { readonly keys: readonly string[]; readonly action: string }[] = [
  { keys: ["Drag"], action: "Pan the map" },
  { keys: ["Scroll"], action: "Zoom to cursor" },
  { keys: ["W", "A", "S", "D"], action: "Move camera" },
  { keys: ["Q", "E"], action: "Rotate" },
  { keys: ["H"], action: "Reset view" },
  { keys: ["+", "−"], action: "Zoom in / out" },
  { keys: ["Click"], action: "Select a building" },
  { keys: ["Esc"], action: "Clear selection" },
  { keys: ["T"], action: "Play / pause day cycle" },
  { keys: ["?"], action: "Show this help" },
]
