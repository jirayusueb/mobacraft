import type { MapViewShape } from "@mobacraft/engine"
import type { MobaMap } from "@mobacraft/map"
import { DraftScreen } from "./draft-screen.tsx"
import type { FlowEvent, Screen } from "./flow.ts"
import { MatchScreen } from "./match-screen.tsx"
import { PickTeam } from "./pick-team.tsx"
import { ResultsScreen } from "./results-screen.tsx"
import { TacticsBoard } from "./tactics-board/tactics-board.tsx"

/** Renders the current Match Day screen over the map. Explore mode renders nothing here. */
export const MatchDay = ({
  map,
  view,
  screen,
  dispatch,
}: {
  map: MobaMap
  view: MapViewShape
  screen: Screen
  dispatch: (e: FlowEvent) => void
}) => {
  switch (screen._tag) {
    case "explore":
      return null
    case "pick-team":
      return <PickTeam dispatch={dispatch} />
    case "draft":
      return <DraftScreen draft={screen.draft} you={screen.you} dispatch={dispatch} />
    case "tactics":
      return <TacticsBoard draft={screen.draft} you={screen.you} dispatch={dispatch} />
    case "match":
      return (
        <MatchScreen
          map={map}
          view={view}
          draft={screen.draft}
          you={screen.you}
          seed={screen.seed}
          tactics={screen.tactics}
          dispatch={dispatch}
        />
      )
    case "results":
      return (
        <ResultsScreen
          draft={screen.draft}
          you={screen.you}
          final={screen.final}
          history={screen.history}
          dispatch={dispatch}
        />
      )
  }
}
