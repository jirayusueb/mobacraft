# The tactics board told me my mid would lose, I ignored it, and my mid lost the game. That's a manager sim working.

- Player: teamfight-manager-2-player · Date: 2026-11-17 · Build: 6727304 (served build at the URL; repo HEAD is 201a26e) · URL: http://127.0.0.1:5281
- Sessions: Match 1: Mire Choir (Teamfight) vs Hollow Vigil (Pick-off). Bans: Duskblade, Chainwarden. Picks: Voidmother, Thornmaw, Ivyshade (comfort ★ picks), then Rootfather and Mossmother (off-comfort, 35% mastery). Default tactics. Calls: Group up at 3:34, Roshan at about 8:40. Watched 1× → 2× → 8×. **Defeat in 18:37, kills 11–34, towers 5–11.** Match 2: Lantern Wardens vs Ember Crows: deny-bans plus power picks (synergy 3/15), calls Play safe, Roshan and Push, 2×→8×. **Victory in 30:14, 57–47, after a −9.4k deficit.** See the Match 2 section.

## TL;DR

- **Yes, I'd play another match day.** I lost, and I know why. The tactics board marked my mid lane **UNFAVOURED −2.3** (Voidmother vs Bonecaller). Their mid, Sable, went **16/2/7** and won MVP, and my mid, Sol, went 3/10/1. The draft drove the outcome I saw. That's the TFM feeling.
- **Biggest win:** the information chain. Synergy % per player in the draft, then lane-matchup scores on the tactics board, then an IGL comms feed ("Gank Ironwarden · 4/5 following"), then results with net-worth and XP graphs, phase bands and a gold-by-source split. It reads more like a real esports broadcast than TFM2.
- **Biggest problem:** my coach calls felt nearly invisible. "Group up" showed in comms as "4/5 following" and then went quiet. Nothing on the results screen says whether a call helped or hurt. At 8× I couldn't tell my Roshan call ever happened, and _they_ took Roshan (2.0k Roshan gold for Hollow Vigil, 0 for us).
- **Match 2 undercut two of my Match 1 conclusions:** I came back from −9.4k to win, and my mid, forecast at −3.7, was MVP. So comebacks exist, and I no longer know how far to trust the lane forecast.
- **Snowball (Match 1) was brutal:** NW lead peaked at +0.1k for me at about 1:00. The rest was a steady slide to −16.4k with no comeback beat. At 34–11 the last 8 minutes were just waiting.
- The draft was fast and readable. I want the "why" surfaced _during_ the draft, before I lock: the lane-matchup forecast only shows up on the next screen.

## Compared to Teamfight Manager 2

- **Better than TFM2:** Pre-match tactics depth: Lanes / Plans / Items / Vision / Comms / Behaviour, per-phase plans (Laning: Standard/Aggressive/Roam/Scale; Mid: Group/Split/Pick-off/Farm; Late: Siege/Roshan first/Defend) with clear exit conditions ("Until 7:00 or two tier-1 towers fall"). The post-match graphs are far richer than TFM2's summary. Players have SKILL/SENSE stats and comfort ★ heroes, so a roster is more than a stat line.
- **TFM2 does better:** Fights are shorter and on a tiny arena, so every pick visibly matters every 10 seconds. Here an 18-minute game with a decisive mid lane meant about 12 minutes of "already decided". TFM2 also makes the counter relationship explicit _at pick time_. Here I found out my mid was a losing matchup only after the draft.
- **Genuinely new:** the in-game leader (IGL) and backup callers. My coach call goes _to the IGL_ ("Coach → Sol (IGL): 'Group up!' · 4/5 following"), and players can ignore it. That's a lovely, very manager-y idea.

## Decisions that mattered (keep)

- **Picking comfort vs off-comfort.** My ★ picks (Ivyshade 90%, Voidmother 85%, Thornmaw 85%) vs fillers at 35% (Mossmother, Rootfather). The fillers ended 2/6/4 and 1/8/1. That reads as earned. Screenshot: [draft complete](shots/2026-11-17-p2-m1-draft-done.png).
- **Draft → lane forecast → result.** The tactics board said: Safe lane FAVOURED +1.9, Mid UNFAVOURED −2.3, Off lane FAVOURED +1.6. The match played out the mid prediction exactly. Keep this, and move it earlier (see asks). Screenshot: [tactics](shots/2026-11-17-p2-m1-tactics.png), [plans](shots/2026-11-17-p2-m1-plans.png).
- **Synergy bar 0/15 → 15/15** fills visibly as you pick. It's a nice drafting dopamine hit.

## Decisions that felt fake or invisible

- **Group up call at 3:34** → I expected my five to collapse onto a lane or objective → comms said "4/5 following" and the IGL went back to his own "Gank Bonecaller" calls by 6:20. Towers went 0–0 to 0–1 in that window, against us. I couldn't see what grouping achieved. **Major.** [call](shots/2026-11-17-p2-m1-call-group.png)
- **Roshan call at about 8:40 (at 8×)** → I expected a Roshan attempt → comms never showed a "Coach → … Roshan" line that I could find. The opponent ended with Roshan gold and we had none. Either my call didn't land, or it went through and we lost the fight; the game didn't tell me which. **Major.**
- **Lane forecast without a lever:** I saw −2.3 mid but had no obvious counter-move once the draft was locked. Swapping lanes would only move the problem. The real decision belonged in the draft, where nothing showed it. **Minor/major.**
- **Results screen has no "your calls" or "draft edge" section.** It explains _what_ happened (MVP, NW graph, gold sources) but not _what I did_: no call markers on the graph, no "draft edge: −X". **Major for outcome legibility.**

## Bugs

- None in the game. I installed window error, unhandled rejection and console.error capture at match start. It recorded **zero entries** through the whole match to the results screen.
- Tooling (not the game): ego-browser hung on every command, even `listTaskSpaces()`, for over 2 minutes, so I played via agent-browser. Hotkeys therefore went through the on-screen buttons (same aria-labels) rather than key presses.
- Note: the call buttons in this build are ordered Group up 1, Push 2, Roshan 3, Farm 4, Play safe 5. That differs from the order in my brief (Group, Roshan, Push, Safe, Farm). It's fine if intended; flagging it in case the spec or help text disagrees.
- Results table: the ITEMS column renders as icons only, and greyed "?" box icons (empty slots?) look like unknown items. **Nit.** [results](shots/2026-11-17-p2-m1-results.png)

## UI / information

- **Team pick:** 4 teams with clear identities (Macro, Aggressive, Teamfight, Pick-off) and SKILL/SENSE per player. Good. I'd like each player's ★ comfort heroes visible _here_, so I can choose a team for its pool. [team pick](shots/2026-11-17-teampick-01.png)
- **Draft:** a clean 4×5 grid with role filters, ★ comfort markers, a Matrix view and hover kits. The ban/pick track at the top (ban icons + 1–10) is readable. I want counter/threat hints on hover ("weak into Bonecaller").
- **Live HUD:** the scoreboard, the HVL/NW lead chip, "Roshan ~2:28", the phase bar with a countdown ("0:41 / ≤7:00"), big toasts ("TOWER DESTROYED") and the comms log are all great. At 8× the comms panel overlaps the left player cards (Wren/Ada cards sit under the comms lines), which makes both hard to read. **Minor.** [mid-game](shots/2026-11-17-p2-m1-midgame.png)
- **Call cooldown:** "Group up · 17s ↻ 37s" is clear, and the win-probability "48% · 53%" readout next to it is a cool touch. It barely moved when I called, though.
- **Results:** NW and XP lead graphs with phase bands and kill/building/Roshan markers are excellent, and "Explore island / Play another" is a good end. It needs my calls on the timeline.

## Match 2/2: Lantern Wardens vs Ember Crows (deny-ban plus "best available" draft)

- Plan: deny bans (Bonecaller and Hexweaver, the heroes that beat me in Match 1), then pick by power rather than comfort: Hollowfang, Goreclaw, Ashbringer, Embercall, Lumenmaid. (My click on Ember Crows misfired, so I stayed on the default Lantern Wardens. It's a fine test of a different identity.) The draft left my synergy at **3/15** against their 5/15. Only Mae/Lumenmaid (95%) and Oskar/Embercall (70%) were comfortable. [draft](shots/2026-11-17-p2-m2-draft-done.png)
- The tactics board was grim: Safe EVEN −1.2, Mid UNFAVOURED −3.7 (Embercall vs Duskblade), Off UNFAVOURED −5.8.
- Calls: Play safe at 2:22 ("5/5 following"), Take Roshan at 5:20 ("5/5 following"), Push at 10:17 ("5/5 following"). Speed went 2× → 4× → 8×. [Roshan call](shots/2026-11-17-p2-m2-roshan-call.png), [after](shots/2026-11-17-p2-m2-roshan-after.png)
- **Victory in 30:14, kills 57–47, towers 11–10.** We were down as much as −9.4k NW and came back to +14.3k. MVP: **Oskar (Embercall, mid) 22/10/12**, in the lane the board called −3.7. [late game](shots/2026-11-17-p2-m2-late.png), [results](shots/2026-11-17-p2-m2-results.png)
- What this changes in my read:
  - **The comeback exists** (−9.4k → win), so my Match 1 "dead snowball" complaint is softer. A Teamfight vs Pick-off stomp may just be that matchup. This game was tense the whole way, with win probability swinging (46% · 59%, then 41% · 42%, then 37% · 40%) and an "OPPONENT DOUBLE KILL" banner at 15:13. Great at 8×.
  - **The lane forecast is now less trustworthy to me.** In Match 1 mid at −2.3 lost the game. In Match 2 mid at −3.7 _won_ MVP. With two data points I can't tell whether the forecast is predictive or noise. As a manager I need to know how much to weight it. **Major for draft depth:** either show confidence, or show afterwards "forecast vs actual" per lane on the results screen.
  - **Calls are still unattributable.** The Roshan call showed "5/5 following" and both teams ended with exactly 1.0k Roshan gold. Did we take that Roshan? The results don't say. Push at 10:17 lined up with towers going from about 1–1 to 5–6, which felt good, but I'm guessing.
  - Off-comfort, low-synergy drafts can win. I like that variance, but it undercuts the comfort ★ system I praised after Match 1. I'd want results to state "draft edge −X, won via late-game teamfights" so I learn something.
- Errors: window error / unhandled rejection / console.error capture again recorded **zero** entries.

## Wishes

- (Wish) Seasons/ladder so a mid-lane weakness becomes a "scout a new mid" storyline.
- (Wish) Training to raise a 35% mastery hero over time.
- (Wish) Opponent scouting card before the draft: their ★ heroes and likely bans.

## Top 3 asks

1. **Show matchup and counter forecasts during the draft**, live as I hover or pick (the lane score from the tactics board, earlier), so draft decisions are informed rather than discovered.
2. **Make coach calls legible:** a ping or path on the map when a call is accepted, an outcome line in comms ("Roshan attempt: failed, 2 deaths"), and call markers on the results NW graph with a delta.
3. **Calibrate and explain the forecast:** show lane forecast vs actual on the results screen, plus a "draft edge" number, so I learn whether the draft or the calls won it. (Lower priority after Match 2's comeback: soften one-sided snowballs:) a comeback lever (a high-ground defence bonus, or a bigger Roshan swing), or an earlier GG/surrender once the result is decided, so 34–11 games end faster.
