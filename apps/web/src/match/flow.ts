/**
 * Match Day flow — a tiny screen state machine. Pure; React renders `state`.
 *
 *   explore ──startMatchDay──▶ pick-team ──choose──▶ draft ──drafted──▶ tactics ──tactics-set──▶ match
 *      ▲                                                                                        │
 *      └──────────────────────── exit ◀── results ◀──────(winner)────────────────────────────────┘
 */
import type { DraftSide, DraftState, MatchSnapshot, TeamTactics } from "@mobacraft/sim"
import type { MatchHistory } from "./hud-data.ts"

export type Screen =
  | { readonly _tag: "explore" }
  | { readonly _tag: "pick-team" }
  | { readonly _tag: "draft"; readonly draft: DraftState; readonly you: DraftSide }
  | {
      readonly _tag: "tactics"
      readonly draft: DraftState
      readonly you: DraftSide
      readonly seed: number
    }
  | {
      readonly _tag: "match"
      readonly draft: DraftState
      readonly you: DraftSide
      readonly seed: number
      /** Your side's game plan from the tactics board (normalised). */
      readonly tactics: TeamTactics
    }
  | {
      readonly _tag: "results"
      readonly draft: DraftState
      readonly you: DraftSide
      readonly final: MatchSnapshot
      /** Sampled during the match by the HUD (gold-lead graph). */
      readonly history?: MatchHistory
    }

export type FlowEvent =
  | { readonly _tag: "start" }
  | { readonly _tag: "chosen"; readonly draft: DraftState; readonly you: DraftSide }
  | { readonly _tag: "drafted"; readonly draft: DraftState; readonly seed: number }
  | { readonly _tag: "tactics-set"; readonly tactics: TeamTactics }
  | {
      readonly _tag: "finished"
      readonly final: MatchSnapshot
      readonly history?: MatchHistory
    }
  | { readonly _tag: "exit" }

export const next = (s: Screen, e: FlowEvent): Screen => {
  switch (e._tag) {
    case "start":
      return { _tag: "pick-team" }
    case "chosen":
      return s._tag === "pick-team" ? { _tag: "draft", draft: e.draft, you: e.you } : s
    case "drafted":
      return s._tag === "draft" ? { _tag: "tactics", draft: e.draft, you: s.you, seed: e.seed } : s
    case "tactics-set":
      return s._tag === "tactics"
        ? { _tag: "match", draft: s.draft, you: s.you, seed: s.seed, tactics: e.tactics }
        : s
    case "finished":
      return s._tag === "match"
        ? { _tag: "results", draft: s.draft, you: s.you, final: e.final, history: e.history }
        : s
    case "exit":
      return { _tag: "explore" }
  }
}
