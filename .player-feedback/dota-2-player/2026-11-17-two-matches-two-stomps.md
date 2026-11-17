# The draft and the flavor are already Dota — but I stomped both games and the farm game doesn't exist yet

- Player: dota-2-player · Date: 2026-11-17 · Build: 6727304 · URL: http://localhost:5173
- Sessions: explore ~5 min (island, Roshan's Pit, day cycle, HUD), 2 full Match Days —
  Mire Choir (teamfight) vs Hollow Vigil: **won 28:20, kills 46–24, towers 11–2, MVP Ada (Ivyshade) 17/3/11**;
  Ember Crows (aggressive) vs Mire Choir: **won 18:54, kills 40–7, towers 11–2, +30.0k NW, MVP Rhee (Embercall) 13/1/10**.
- Note on method: I played via the browser's accessibility tree (HUD text, comms feed, scoreboards). Screenshots were saved for the dev's eyes; my claims below all come from live game text I read during play.

## TL;DR

- Yes, I'd queue another match — the draft (comfort bans, snake picks, mastery %, synergy meter) is genuinely the best part and already reads like a real draft screen.
- Biggest win: the IGL comms system ("Gank Hollowfang" · 5/5 following, "freelancing, ignoring the current call") — that's the coach fantasy, and my Push call came back as "Coach → Sol (IGL): Push the lanes!" which felt great.
- Biggest problem: I won both games with double-digit kill leads and never felt threatened. The AI coach drafts fine but doesn't seem to call like a coach; once you're ahead there is no comeback pressure.
- Farming is undertuned: 30–110 last hits per hero over 19–28 minute games. This economy is kill gold, not Dota gold.
- Roshan/Aegis didn't feel legible: I made a Roshan call after a won fight in game 2 and never saw it acknowledged or an Aegis line in the feed (match ended 6 game-min later).

## What felt like Dota (keep)

- **AI coach bans comfort.** Both games it banned my starred heroes first (Stormcaller and Gravejaw in game 1; same pattern in game 2). That's exactly what the spec promised and what a real captain does. Severity: n/a — praise.
- **Draft board is real.** Role tags per hero, ★ comfort markers, mastery % auto-assignment (Voidmother→Sol 85%, Ivyshade→Ada 90%, Goreclaw→Yuki 90%), synergy meter climbing to 15/15. I made actual draft decisions: banned the pick-off assassin into Hollow Vigil, banned Voidmother/Mossmother teamfight engines when I was the aggro team. It worked.
- **IGL comms.** Kill/objective feed plus "Sol (IGL): 'They're down — push!' · 4/5 following", backup IGL lines when Sol was dead, and enemy heroes shown "freelancing, ignoring the current call". Better than most manager games' flavor.
- **Coach calls relay through the IGL.** My Push call showed up as "Coach → Sol (IGL): 'Push the lanes!' · 4/5 following". That is the right shape — the coach suggests, the team decides.
- **Tactics board depth.** Lane assignments (Safe/Mid/Off/Jungle/Roam), phase plans (Laning: Aggressive/Roam/Scale, Mid: Group/Split push/Pick-off, Late: Siege/Roshan first/Defend). "Roshan first, then siege" is a real Dota late-game radio call.
- **Item auto-buys look sensible.** Carry Ada ended with Whisperwood Bow + Black King Bar + Steel Edge; support Wren had Force Staff; jungler Pim bought Blink Dagger; mid Sol stacked Glow Orbs on Voidmother. Role-appropriate, no grief builds.
- **Objective order.** Towers fell in a believable order both games, "Towers 11–2" end states imply full base races, and the tower counter next to clock/hero states made game state readable without watching pixels.
- **Roshan exists as a timing.** "Roshan up" / "Roshan ~0:28" respawn-style timer in the HUD gave me the "check the pit" reflex.

## What broke the Dota feel

- **No comeback / AI coach doesn't counter-call.** Game 1: 1–2 in towers at 11 min, I called Push, won 46–24. Game 2: 40–7. When I was behind early in game 1 the enemy never pressed; when I was ahead they never turtled or smoke-ganked. → A Dota game where the enemy coach never reacts isn't a match, it's a demo. Severity: **major**.
- **Last hits are starved.** Scoreboard LH: 30–110 across ten heroes in both games. A 28-minute carry with 110 LH is poverty Dota; supports at 39–54 are fine but cores aren't. Kill gold clearly dominates, which makes "Farm"/"Scale" plans placebo and every game a fight-fest. Severity: **major** (economy: 17.4k MVP gold is fine, but the source mix is wrong).
- **Level 15 cap hit by everyone.** Game 1: all ten... actually all five of mine hit 15 by 28 min, even the 2/4/8 support. XP leads vanish at the cap, removing another comeback axis. Severity: **minor–major**.
- **My Roshan call vanished.** Game 2, ~12:40 after a won fight (IGL said "They're down — push!"), I clicked the Roshan call. Comms before and after showed only IGL push calls; no "taking Roshan", no Aegis line, and the game ended at 18:54 without me ever seeing Aegis evidence. Either the call was dropped, on a silent cooldown, or the feed doesn't report it — all three are readability failures for the single most iconic Dota objective. Severity: **major** (I can't distinguish bug from design here; spec/06 might — dev should check).
- **Explore-mode landmark panels are empty.** Clicking Roshan's Pit gave me a heading and "Center camera" — nothing about Aegis, respawn, why I care. Same bare treatment elsewhere. For a game whose product principle is "strategy legible", the tooltip layer is missing. Severity: **minor** (map milestone, not match).
- **Comms feed repeats look like stutter.** "Gank Goreclaw" logged at 1:39 and again at 4:39 verbatim — either the IGL re-calls identical targets or the feed merges; reads like a stuck record on first glance. Severity: **nit**.
- **Freelancing with no explanation.** Enemy Vey/Sable "freelancing, ignoring the current call" — great flavor, but I never learned _why_ (low sense? dead IGL? low trust?). One clause of reason would make it a system instead of a coin flip. Severity: **nit**.

## Bugs

- **Hero-card clicks silently dropped during draft.** Multiple `click` actions on hero buttons (confirmed enabled, correct element) did nothing until I re-clicked later or used a synthetic JS click — happened on Mossmother (3 attempts) in game 1's draft and on some picks in game 2. Repro: during the AI coach's turn-transition window, clicking an enabled hero button sometimes no-ops with no disabled state or toast. Expected: either the button is disabled with a reason ("enemy picking…") or the click queues. Actual: silent drop. Could be a hit-target/overlay issue rather than logic — I was driving via accessibility refs, so a dev should reproduce with a real mouse. It never cost me a pick, just tempo.
- Nothing else hard-broken: no crashes, no frozen clocks, no dead UI across two full matches + explore.

## Balance & sim notes

- **Duo Ivyshade + Mossmother (game 1)**: Ada 17/3/11 with 35,571 hero damage — comfort carry + heal support lane looks strongest. Enemy mirror supports fed: Wren-proxy Lumenmaid 0/10/2 in game 2 (6,007 healing, at least she tried).
- **Embercall mid** 13/1/10 game 2 — comfort mid on an aggro team may be overtuned, or the AI team just never ganked him.
- **Enemy team's peak**: game 2 their best was Kell/Gravejaw 4/7. The sim's losing side K/DAs (1/9/0, 1/9/1, 0/10/2) look like feed-lock — heroes keep fighting while massively behind with no "Play safe" behavior from the AI coach.
- **NW spread**: winners 8.4k–12.7k, losers 3.5k–5.2k in an 18:54 game — the gap is fine for a stomp; the stomp frequency is the issue.

## Wishes (out of scope, labelled)

- Buyback and glyph — the two most coach-flavored buttons in Dota.
- A visible fight camera / auto-spectate on action, so 8× isn't just feed-reading.
- Hero kit tooltips inside the match HUD (draft board has them; in-match I only saw item lists).
- Replay scrub of the kill/objective timeline after the match.
- Creep equilibrium / deny mechanics surfaced in the laning readout (I couldn't judge lane matchups beyond K/D/A).

## Top 3 asks

1. **Make the AI coach fight back**: counter-calls (turtle/smoke/Rosh contest) when behind or ahead, plus rubber-band levers (defend bonus, kill-streak shutdown gold) so my two games don't both end 11–2 in towers.
2. **Fix the Roshan loop's legibility**: acknowledge the call in comms, an Aegis line in the feed, and an Aegis marker on the scoreboard — right now the game's namesake objective is invisible.
3. **Buff farm income** (last-hit gold and LH counts up, jungle camp value) so "Farm"/"Scale" plans are a real alternative to the constant teamfight meta.
