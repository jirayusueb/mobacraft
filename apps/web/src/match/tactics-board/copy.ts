/** Player-facing copy for the tactics board (spec/06 §3a–3c, §5, §6). */
import type {
  LanePreview,
  LaneSlot,
  LatePlan,
  LaningPlan,
  MidPlan,
  ShopTiming,
  TargetPriority,
  VisionZone,
} from "@mobacraft/sim"

export type TabId = "lanes" | "plans" | "items" | "vision" | "comms" | "behaviour"

export const COPY = {
  title: "Tactics board",
  subtitle: "Write the game plan. Every field starts from a sensible default.",
  vs: "vs",
  tabsLabel: "Tactics sections",
  tabs: {
    lanes: "Lanes",
    plans: "Plans",
    items: "Items",
    vision: "Vision",
    comms: "Comms",
    behaviour: "Behaviour",
  } satisfies Record<TabId, string>,
  tabHints: {
    lanes: "Who lanes where, and how each lane is predicted to go.",
    plans: "One team plan per game phase. Changeable live during the match.",
    items: "Build order per player, plus when the team walks back to shop.",
    vision: "Where your warder spends ward charges first.",
    comms: "Your in-game leader relays your calls and makes their own.",
    behaviour: "Standing orders per player. Editable live, no cooldown.",
  } satisfies Record<TabId, string>,

  // Lanes
  rosterHeading: "Assignments",
  swapHint: "Select two players to swap their lanes.",
  swapPending: (name: string) => `${name} selected — pick another player to swap with.`,
  swapDone: (a: string, b: string) => `Swapped ${a} and ${b}.`,
  swapSides: "Swap side lanes",
  slotLabel: (name: string) => `Lane for ${name}`,
  selectForSwap: (name: string, hero: string, slot: string) =>
    `${name}, ${hero}, ${slot}. Select to swap lanes`,
  matchupHeading: "Lane matchups",
  matchupHint: "Score = hero matchups + player skill + numbers in lane.",
  predictedNote: (team: string) =>
    `${team}'s lanes are predicted from their coach's likely plan. Jungle and roam are not lanes.`,
  emptyLane: "Nobody",
  ours: "You",
  theirs: "Them",
  score: "Score",
  slots: {
    safe: "Safe lane",
    mid: "Mid lane",
    off: "Off lane",
    jungle: "Jungle",
    roam: "Roam",
  } satisfies Record<LaneSlot, string>,
  slotShort: {
    safe: "Safe",
    mid: "Mid",
    off: "Off",
    jungle: "Jungle",
    roam: "Roam",
  } satisfies Record<LaneSlot, string>,
  verdict: {
    favoured: "Favoured",
    even: "Even",
    unfavoured: "Unfavoured",
  } satisfies Record<LanePreview["verdict"], string>,
  sideLanes: (safe: string, off: string) => `Safe = ${safe} · Off = ${off}`,

  // Plans
  plansHeading: {
    laning: "Laning plan",
    mid: "Mid-game plan",
    late: "Late-game plan",
  },
  plansWhen: {
    laning: "Until 7:00 or two tier-1 towers fall",
    mid: "Until 15:00, a tier-3 falls or average level 12",
    late: "Until the Ancient falls",
  },
  laning: {
    standard: ["Standard", "Farm, trade when ahead."],
    aggressive: ["Aggressive", "All laners +25 aggression, harass hard."],
    roam: ["Roam", "Roamer and jungler gank a lane every ~60 s."],
    scale: ["Scale", "Jungler farms only, laners play safe for gold."],
  } satisfies Record<LaningPlan, readonly [string, string]>,
  mid: {
    group: ["Group", "Five-man objective pushes."],
    split: ["Split push", "Carry pushes the far lane, four group elsewhere."],
    pickoff: ["Pick-off", "Hunt enemy heroes seen alone in vision."],
    farm: ["Farm", "Farm until late, only defend."],
  } satisfies Record<MidPlan, readonly [string, string]>,
  late: {
    siege: ["Siege", "Group up and take high ground."],
    roshan: ["Roshan first", "Take Aegis, then siege."],
    defend: ["Defend", "Hold base, push only after a won fight."],
  } satisfies Record<LatePlan, readonly [string, string]>,
  antiStall: "From 25:00, Defend and Farm play as Siege.",

  // Items
  buildsHeading: "Build presets",
  buildLabel: (name: string) => `Build for ${name}`,
  adaptive: "Adaptive",
  adaptiveHint: "Buys one magic-resist or armour item if the enemy damage leans ≥ 65 % one way.",
  adaptiveLabel: (name: string) => `Adaptive itemization for ${name}`,
  shopHeading: "Shop timing",
  shopTiming: {
    "on-item": [
      "On item",
      "Walk back as soon as the next item is affordable. Earlier items, less lane time.",
    ],
    "on-low": ["When low", "Shop only when retreating or dead."],
  } satisfies Record<ShopTiming, readonly [string, string]>,
  spike: "Group on carry spike",
  spikeHint: "Your IGL calls Group when the carry finishes their 2nd item.",
  itemsSr: (names: string) => `Items: ${names}`,

  // Vision
  visionHeading: "Ward priority",
  visionHint: "Highest first. The warder fills the top unwarded spot; laning skips their jungle.",
  zones: {
    roshan: ["Roshan pit", "Spot Roshan attempts and the river fights around them."],
    runes: ["River runes", "Both rune spots — mid-lane ganks pass through here."],
    "own-jungle": ["Our jungle", "Protect your farm and see invaders coming."],
    "enemy-jungle": ["Their jungle", "Track their jungler and set up pick-offs."],
  } satisfies Record<VisionZone, readonly [string, string]>,
  moveUp: (zone: string) => `Move ${zone} up`,
  moveDown: (zone: string) => `Move ${zone} down`,
  moved: (zone: string, rank: number) => `${zone} moved to priority ${rank}.`,
  wardStock: "2 ward charges at start, +1 every 90 s (max 3). Wards last 6 minutes.",

  // Comms
  iglHeading: "In-game leader",
  iglHint:
    "Relays your calls (faster with higher leadership) and calls ganks, defends, backs and pushes on their own.",
  leadership: "Leadership",
  relay: "Relay delay",
  compliance: "Teammates follow",
  seconds: (s: number) => `${s.toFixed(1)} s`,
  percent: (p: number) => `${Math.round(p * 100)} %`,
  backupNote: "If your IGL is dead, the next-best leader relays with +1.5 s delay.",
  iglBadge: "IGL",

  // Behaviour
  aggression: "Aggression",
  farm: "Farm priority",
  ultDiscipline: "Ult discipline",
  target: "Target priority",
  targetLabel: (name: string) => `Target priority for ${name}`,
  targets: {
    weakest: "Weakest",
    carry: "Their carry",
    support: "Their support",
    nearest: "Nearest",
    threat: "Biggest threat",
  } satisfies Record<TargetPriority, string>,
  sliderHints: {
    aggression: "Higher fights earlier and dives towers.",
    farm: "Higher keeps farming instead of joining group calls.",
    ultDiscipline: "Higher holds ults for multi-hero hits.",
  },

  // Footer
  reset: "Reset to defaults",
  ai: "Use AI suggestion",
  start: "Start match",
  resetDone: "Tactics reset to defaults.",
  aiDone: "Applied the AI coach's suggestion.",
} as const
