# The draft screen is already TFM2-good — but the match keeps its secrets, and sometimes the result feels like a coin I never see flipped

- Player: teamfight-manager-2-player · Date: 2026-11-17 · Build: 6727304 · URL: http://localhost:5173
- Sessions: 4 matches (all as manager, no dev tools read mid-match):
  1. **Mire Choir vs Hollow Vigil** — teamfight/synergy comp (Chainwarden+Embercall+Rootfather+Frostveil+Ivyshade, synergy 15/15). Default plans. Calls: Roshan (never saw it resolve — game ended first). **Win 24:10, kills 44–21, MVP Ada 20/2/10.**
  2. **Hollow Vigil vs Lantern Wardens** — counter/comfort draft (Gravejaw, Duskblade 70%, Thornmaw, Lumenmaid, Ivyshade, synergy 11/15). Plans: Aggressive laning / Split push / Roshan first. Calls: Group up (1), Push (2). **Win 24:52, kills 40–25, MVP Sable 9/4/14.** Early deficit −1.4k before mid game.
  3. **Ember Crows vs Mire Choir** — deliberately awful all-fragile-ranged draft (Grimfeather, Bonecaller, Embercall, Frostveil, Lumenmaid, synergy **1/15**, no frontline, no jungle hero till Yuki got Lumenmaid). Calls: Roshan, Push late. **Loss at the 40:00 cap, kills 27–45, towers 8–9 — despite a +11k net-worth lead.**
  4. **Mire Choir vs Hollow Vigil** — max-comfort draft (all five picks ≥50% mastery, synergy 15/15). Defaults + Group up call. **Loss 16:39, kills 15–9 FOR me, NW +2.3k, XP +3.6k — they took 11 towers and ended the game while I was "winning".**

## TL;DR

- **Yes, I'd play another match day today.** The pick → draft → tactics board loop is genuinely TFM2-shaped: the synergy meter, ★ comfort marks, mastery % per player, and the lane-matchup preview gave me four different drafts I _wanted_ to try across four matches.
- **Biggest win:** the draft board + synergy/counter legibility. I drafted a 15/15 teamfight comp in match 1 and could _say why_ it was good before the game; the AI banned my comfort picks (Stormcaller, Gravejaw in match 1), so bans felt like a duel, not decoration.
- **Biggest problem: outcome legibility collapses after the draft.** Matches 3 and 4 I lost (or nearly lost) _while the HUD said I was ahead_, and the results screen showed me graphs but no story. In match 4 I had more kills, more gold, more XP and lost in 16:39 — I still don't know what Hollow Vigil did to me. In TFM2 a loss always teaches; here two of my four losses taught nothing.
- **Pacing at 8× is great; the 40:00 stall in match 3 dragged** (my own fault for drafting no siege, but the game let me spin for 15 real minutes without forcing anything).
- Coach calls exist and the cooldown/IGL flavour is charming, but I could not tie a single call to a visible swing in any match.

## Compared to Teamfight Manager 2

- **Better:** the tactics board's lane-assignment + matchup preview (Favoured/Even/Unfavoured per lane with scores) is sharper than anything TFM2 gives you pre-game; the Matrix heatmap (20×20 with a "row has the edge, ±8% damage" legend) is a wish-I-had in TFM2; net-worth AND xp graphs on results; the IGL comms feed ("Sol (IGL): 'They're down — push!' · 5/5 following") makes the team feel like people.
- **TFM2 does better:** post-match explanation. TFM2 tells me _why_ I lost (ban phase loss, scaling comp, shot-call diff). Here the results screen is stats and graphs, no causal narrative. TFM2 also makes each match's 90 seconds dense with micro-decisions; my matches had long stretches at 8× where I made zero decisions.
- **Genuinely new:** a full MOBA map as the auto-battle substrate — towers in tier order, Roshan/Aegis, wards and map-control %, barracks. When it works (match 1's stomp, match 2's comeback), it feels like coaching a real Dota team, not a lobby mini-game.

## Decisions that mattered (keep)

- **Drafting to the synergy meter** (match 1: lockdown+aoe core → 15/15) → expected a cleaner teamfight win → won 44–21 with a 22k lead. This was my favourite moment of the session; the meter predicted the game. Severity of the _good_: keep exactly this.
- **Banning enemy comfort**: the AI banning my ★ picks (Stormcaller, Gravejaw) forced me off my plan in match 1 and I still won — bans have real value on both sides.
- **Plans actually flavouring phases** (match 2 Aggressive laning): early game was bloody and close (−1.4k at one point) vs match 1's passive standard lane open — different openings felt different.
- **Comfort assignment**: watching picks land on players at 35%–90% mastery made me _want_ the 90% picks; in match 4 I built the whole draft around mastery and it visibly made my players individually better (15 kills on 9).

## Decisions that felt fake or invisible

- **Coach calls (1 Group up / 2 Push / 3 Roshan / 4 Farm / 5 Play safe).** I pressed them in matches 2, 3 and 4 → expected a visible formation/objective change in the next ~15 sim-minutes → the feed showed my IGL relaying the call and… I could never point at a moment where the call changed anything. The comms feed is flavour-rich, effect-opaque. **Severity: major** (this is the core "coach" fantasy).
- **Roshan call.** Called it twice while ahead; "Roshan up" stayed in the HUD both times and I never saw an Aegis, a Roshan kill in the feed, or a pit attempt. Either my team ignored me or the result is invisible. **Severity: major.**
- **Match 4 loss.** Won kills/gold/XP, lost 16:39 → expected the results screen to tell me why (split-push? my Group-up call leaving lanes open? a tower-rush AI plan?) → got graphs and an MVP from my own team. **Severity: major** (outcome legibility).
- **Match 3 near-miss.** +11–15k lead for 10+ minutes, no closing power → expected the game to force a decisive fight or throw a Roshan/defense crisis at me → it just… continued until 40:00, then the tiebreak went against me with towers 8–9. **Severity: major** (pacing + legibility).
- **Hero detail on hover is thin.** Hovering showed tags (Ranged/AoE/Burst/Poke) and ability names, but during _my_ pick phase I didn't get "synergy with your picks / matchup vs theirs" reasons the way the lane board later shows. Synergy meter exists, but per-pick reasons would carry the draft. **Severity: minor.**

## Bugs

- Nothing hard-broken. One soft repro: on the results screen the "Play another" button intermittently needed two clicks / a DOM-level click after a snapshot (happened after match 1 and match 2). Expected immediate navigation; actual: first click silently did nothing. Could be an automation artifact — flagging only because it happened twice at the same screen.
- Team-pick screen showed my opponent as fixed (Hollow Vigil when I highlighted Mire Choir) rather than "drawn" — spec says opponent is drawn; across four matches it always matched the second card. Not sure this is a bug, but there was zero variety in the matchup display.

## UI / information

- **Team pick:** enough to choose (style line "Pick-off — lockdown and catches", SKILL/SENSE per player), but no comfort heroes visible _before_ the draft, so "do I like this roster?" rests on two numbers. Fine, thin.
- **Draft board:** the best screen in the game. Draft-order rail 1–10, live synergy meters per side, ★ comfort, mastery % per assignment, role filter tabs, Matrix dialog. My only ask: per-pick synergy/counter _reasons_ inline.
- **Tactics board:** lanes tab with matchup previews and swap controls is excellent; Plans tab (Laning/Mid/Late radio groups) reads clean; "Use AI suggestion" button is a nice safety net I never needed since defaults were sensible.
- **Match HUD:** scoreboard rows with level/KDA/NW/state (GROUP, PUSH, RESPAWN with timer) are readable at a glance; kill feed with ability flavour ("Kell (Chainwarden) blinks in") is lovely. The economy panel (G) and live tactics (T) I opened once and got net-worth + plans — fine.
- **Results:** graphs (gold/xp over time with phase markers and a legend "● kill · ▮ building · ◆ Roshan/Ancient") are genuinely good — I could see match 2's early deficit in the curve. Missing: any text that says _why_ the game ended when it did, and the MVP going to my losing team's carry in match 3 (Kas, 16/2/12) reads weird on a Defeat screen.

## Wishes (out of scope, clearly labelled)

- Seasons/league table, training, transfers, player fatigue/morale — the classic TFM2 glue.
- A post-match "coach's report": 3 bullets (draft edge, biggest call, turning point) generated from the sim, since the sim is deterministic and knows the answers.
- Series (bo3) with draft evolution between games vs the same AI coach.
- Sound, obviously — fight Stöbermoment needs it.

## Top 3 asks

1. **Make the match explain itself.** A turning-point marker on the results graph + 2–3 sentence narrative (e.g. "Hollow Vigil's split push took 4 towers while you grouped") — match 4 is unplayable-as-a-manager without this.
2. **Make coach calls visibly do something.** One feed line when the call _completes_ ("Team collapsed on Roshan — Aegis Wren", "5-man push took the T2") or a state change I can point at; right now pressing 1–5 feels like honking a horn in the team bus.
3. **Per-pick draft reasons inline** (synergy with my picks + matchup vs theirs, with the short rule text like the lane board shows) so drafting counters doesn't require opening the Matrix and squinting at 20×20.

Evidence: [teampick](2026-11-17-tfm2-01-teampick.png) · [draft 15/15](2026-11-17-tfm2-02-draft-synergy15.png) · [live HUD](2026-11-17-tfm2-04-live-hud.png) · [group-up call](2026-11-17-tfm2-05-groupup-call.png) · [match-4 loss results](2026-11-17-tfm2-06-results-m4-loss.png) in `shots/`.
