/** Player-facing text, keyed for future localisation. */
export const strings = {
  "hud.title": "The Ancient Isle",
  "hud.subtitle.season": "Summer",
  "hud.loading": "Growing the island…",
  "hud.failed": "Your browser couldn't start the renderer.",
  "hud.rotate.left": "Rotate left",
  "hud.rotate.right": "Rotate right",
  "hud.home": "Reset view",
  "hud.zoom.in": "Zoom in",
  "hud.zoom.out": "Zoom out",
  "hud.time": "Time of day",
  "hud.time.play": "Play day cycle",
  "hud.time.pause": "Pause day cycle",
  "hud.stats": "Toggle stats",
  "hud.focus.radiant": "Radiant base",
  "hud.focus.dire": "Dire base",
  "hud.focus.roshan": "Roshan pit",
  "hud.minimap": "Minimap — click to move the camera",
  "hud.help": "Drag to pan · Scroll to zoom · Q/E rotate · WASD move · Click a building",
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
  ancient: "Destroy the enemy Ancient to win.",
  tower: "Guards the lane. Must fall in order: tier 1 → 4.",
  "barracks-melee": "Destroying it upgrades your melee creeps in this lane.",
  "barracks-ranged": "Destroying it upgrades your ranged creeps in this lane.",
  fountain: "Heals and restores mana. Heroes respawn here.",
  shop: "Base shop for most items.",
  "secret-shop": "Sells advanced components.",
  roshan: "The strongest neutral. Drops the Aegis.",
  rune: "Spawns a power rune every two minutes.",
  "camp-small": "Neutral creeps. Quick, low gold.",
  "camp-medium": "Neutral creeps. Fair gold for time.",
  "camp-large": "Neutral creeps. Good gold, hits hard.",
  "camp-ancient": "Ancient creeps. Best gold, very dangerous.",
}
