# Tactics & Coaching — milestone 3 spec

Phase: **Production slice** on top of Match Day (spec/05). Benchmark: _Teamfight
Manager 2_ tactics board + Dota 2 coaching/caster tools (net-worth graph,
ward map). Goal: the coach's decisions **before and during** the match become
deep and legible, without the coach ever controlling a hero directly.

## Player fantasy (delta from spec/05)

You don't just draft and shout "group up": you write the game plan — who lanes
where, what they buy and when, where the team buys vision, who calls the
shots in-game and how each player behaves — then watch it play out phase by
phase, reading the economy graph and adjusting as the match turns.

## New loop

```
pick-team → draft (+synergy/counter matrix) → TACTICS BOARD → match (+live tactics) → results (+economy)
```

The tactics board is a new screen (~60–90 s). Every field has a sensible
default derived from the draft, so "Start match" immediately is always valid.

---

## 1. Game phases — Laning, Mid Game, Late Game

`phase: "laning" | "mid" | "late"` is derived in the sim each tick and only
moves forward.

| Transition   | Trigger (first that happens)                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------- |
| laning → mid | game time ≥ 7:00, **or** 2 tier-1 towers destroyed in total                                    |
| mid → late   | game time ≥ 15:00, **or** any tier-3 tower/barracks destroyed, **or** either team avg lvl ≥ 12 |

`phase` **replaces** the old `midGame = clock > 8 min` heuristic and the random
2 % Roshan roll everywhere in the hero AI.

Rules each phase changes (systemic, not cosmetic):

| Rule                      | Laning                                   | Mid                            | Late                            |
| ------------------------- | ---------------------------------------- | ------------------------------ | ------------------------------- |
| Default hero behaviour    | hold assigned lane; roamers rotate       | follow the team's **Mid plan** | follow the team's **Late plan** |
| Auto-grouping             | never (only coach/IGL calls)             | per plan                       | always 4–5 together             |
| Roshan                    | only on coach call (IGL may not call it) | per plan / IGL                 | per plan / IGL                  |
| Respawn time              | base                                     | base                           | ×1.3                            |
| Tier-1 tower damage taken | ×0.75 (fortified early towers)           | ×1                             | ×1                              |

Each phase has a **team plan** (chosen on the tactics board, changeable live,
AI coach picks by team style):

- **Laning plan**: `standard` (farm, trade when ahead) · `aggressive` (all
  laners +25 aggression in lane, harass) · `roam` (roam-slot + jungler gank
  every ~60 s) · `scale` (jungler farms only, laners play safe, +gold focus).
- **Mid plan**: `group` (5-man objective push) · `split` (carry pushes the lane
  farthest from the group, 4 group elsewhere) · `pickoff` (hunt enemy heroes
  seen alone in vision) · `farm` (farm until late, defend only).
- **Late plan**: `siege` (group, take high ground) · `roshan` (Aegis first,
  then siege) · `defend` (hold base, push only after a won fight: ≥2 enemies dead).
  Anti-stall: from 25:00 `defend` and `farm` behave as `siege` (the 40-min
  tiebreak must not reward stalling).
- Plans needing a carry (`split`, spike) use the highest-net-worth core
  (non-support) when no carry is drafted. `roam` laning plan with nobody in
  the roam slot → the jungler does the rotations.
- Changing a plan is free but is **relayed by the IGL** (latency, §5) and
  limited to once per 20 s per team.

A phase change posts a feed entry and an announcer banner.

## 2. Synergy & Counter Matrix

Hero **tags are derived from ability data** (never hand-listed, so balance
patches keep the matrix honest):

| Tag       | Derived when                                             |
| --------- | -------------------------------------------------------- |
| lockdown  | any stun/root ≥ 1.2 s                                    |
| aoe       | ultimate targets `enemy-aoe`/`self-aoe` and deals damage |
| burst     | an ability deals ≥ 200 base damage, or has `execute`     |
| sustain   | heal / hot / lifesteal                                   |
| protect   | shield, or buff on an ally target                        |
| dive      | dash                                                     |
| frontline | melee and base hp ≥ 680                                  |
| poke      | ranged with a dot or slow                                |
| fragile   | ranged and base hp ≤ 510                                 |

Rules (data table in `sim/match/matrix.ts`, each with a short player-facing reason):

- **Synergy** (symmetric, pair of allies): lockdown+aoe +2 ("setup for AoE"),
  lockdown+burst +2, dive+protect +1, frontline+fragile +1, sustain+frontline +1,
  poke+lockdown +1, aoe+aoe −1 (overlap), fragile+fragile −1 (no front line).
- **Counter** (directional, A vs B): lockdown › dive +2, burst › fragile +2,
  sustain › poke +1, protect › burst +1, frontline › dive +1, poke › frontline +1,
  dive › fragile +1, aoe › sustain +1.
- `synergy(a,b)` and `counter(a,b)` = sum of matching rules, clamped to [−3, 3].
  `matchup(a,b) = counter(a,b) − counter(b,a)`.
- Tag thresholds were tuned against the real roster (lockdown ≥ 1.4 s, aoe
  ult radius ≥ 3.2, plus a `duelist` tag for self attack/attack-speed buffs);
  a snapshot test pins the derived tags and checks no tag covers > 60 % of
  heroes and every hero has ≥ 1 tag. Rule weights in `matrix.ts` are the source
  of truth; the table above is descriptive.

Sim effects (small, deterministic, explained in UI):

- Hero A damaging hero B: ×(1 + 0.04 · clamp(matchup(A,B), −2, 2)) → ±8 %,
  **halved during Laning** (anti-snowball).
- Team synergy = sum of all ally pair synergies, clamped [0, 15] → ability
  power ×(1 + 0.004 · synergy) → at most +6 %.

UI: on the draft screen, the hovered/candidate hero shows synergy with your
picks and matchups vs theirs (with reasons); team synergy meter per side; a
**Matrix** dialog shows the 20×20 heatmap (synergy / counter toggle). The AI
coach's pick value adds `0.02 · clamp(Σ synergy with own picks + Σ matchup vs
enemy picks, −10, 10)` → at most ±0.2, below the comfort range (0.2–1.1) so
player comfort still dominates. Bans keep using the enemy's comfort value only.

## 3. In-depth tactical & draft micromanagement

### 3a. Laning assignments & matchup swaps

- Slots: `safe` · `mid` · `off` · `jungle` · `roam`. Default from role
  (carry→safe, mid→mid, offlane→off, jungle→jungle, support→safe as the
  classic duo; `roam` is opt-in). Any mapping is allowed (trilane, dual mid).
- Map: safe = Radiant bot / Dire top; off = the other side lane.
  **Bug fix**: today `laneForRole` sends Dire's carry+support to _bot_ (Dire's
  offlane) — Dire must use top. This changes every existing game, so the
  balance gate (spec/05) is re-run after the fix.
- **Matchup preview** per lane on the board: your lane heroes vs the enemy
  heroes predicted to face them (their safe vs your off, etc.), score =
  Σ matchup + (mean skill of our lane players − theirs)/4, labelled
  Favoured (≥ 1.5) / Even / Unfavoured (≤ −1.5). Jungle/roam are not lanes.
- **Swap** on the board: click two heroes to exchange slots; "Swap side
  lanes" one-click button.
- **Live lane swap** during the **Laning phase only**: `swapLanes(side, a, b)`;
  60 s own cooldown (not shared with calls); allowed while a hero is dead
  (applies on respawn); feed entry. The AI coach swaps its safe/off pair when its
  safe-lane matchup ≤ −3 at the tactics stage.
- Roam slot: places wards, then rotates through lanes, ganking a visible enemy
  hero (≤ 60 % hp) in any lane within 20 tiles.

### 3b. Itemization & timing rules

- Item catalogue gains **magic resist** (`magicResist` fraction, applies to
  magic damage) via one new item: _Nullstone Amulet_ (1300 g, +150 hp, 20 % MR).
- **Build presets**: 2–3 named builds per role (data), selectable per hero.
- **Adaptive rule** (toggle per hero, default on): before each purchase, look
  at the magic share of hero damage this hero has _taken_ (until it has taken
  ≥ 800, use the enemy draft). Magic share ≥ 65 % and no MR item → Nullstone
  next; physical share ≥ 65 % and no armour item → Barrow Plate next. At most
  one adaptive item per hero (prevents homogenised builds).
- **Timing rule** (per team): `on-item` — walk back to shop when the next item
  is affordable plus a margin (300 g, +farm-priority·4 g) and no enemy hero is
  visible within 9 tiles — buys earlier but loses lane time; `on-low` — shop
  only when retreating/dead (old behaviour). `spike` toggle: the IGL calls
  _Group_ when the carry finishes its 2nd item.
- Deferred: Teleport scrolls (channel/cancel rules need their own spec).
- Purchases are recorded `{t, heroId, itemId}` for the results item timeline.

### 3c. Map control & vision priority

- **Vision** per team on a 2-tile grid (64×64), recomputed every 0.5 s:
  heroes 8 tiles, creeps 6, towers 9, wards 9, other structures 7.
- **Fog matters**: hero AI only reacts to enemy heroes its team can see
  (threat assessment, fight/retreat, target choice, casts, IGL gank calls).
  Unseen ganks succeed more; wards prevent them.
- **Ward spots** (7, symmetric, derived from map data): 2 river runes,
  Roshan pit, each team's two jungle centroids (camps 0–3 and 4–6).
- **Ward stock** per team: 2 charges, +1 per 90 s, max 3. Placed by the roam
  slot (else the support role, else lowest net worth). Ward lives 360 s.
- **Vision priority**: the coach ranks 4 zone groups — _Roshan_, _River
  runes_, _Our jungle_, _Their jungle_. The warder fills the highest-priority
  unwarded spot reachable; Laning phase skips _Their jungle_.
- **Dewarding**: a support/roam hero within 4 tiles of any enemy ward destroys
  it (+50 g to that hero, gold source `wards`, feed). Stock is per team and
  refills regardless of who is alive.
- **Map control %** = visible cells / walkable cells, per team; a 2-tile cell is
  walkable if its centre is walkable. Vision is radius only (no LOS).
- **Fog-gated AI**: hero threat assessment (fight/retreat power), hero target
  choice and IGL gank detection only consider enemy heroes in team vision
  (or within 3 tiles — you always see who is hitting you).
- Rendering: wards appear on the match minimap (HUD overlay, team tokens) and in
  the HUD; no 3D ward model and no fog in the 3D view this slice (deferred —
  needs a creature-kit model).

## 4. Live economy & net-worth graph

- Net worth = unspent gold + Σ item cost. Per hero and per team.
- Gold by source per team: `start · passive · creeps · neutrals · kills ·
  assists · structures · roshan · wards`. Every `grant` takes a source, so
  Σ sources = Σ goldEarned by construction (test-asserted).
- **History owned by the sim** (deterministic, testable): every 5 game seconds
  `{t, nw, xp, vision}` per side + event markers (kills, towers, Roshan,
  phase changes) from the feed.
- In-match **Economy panel** (toggle `G`): net-worth lead line (shaded by
  phase), XP lead line, event ticks, per-hero net-worth bars, gold-source
  stacked bars. Header shows the live NW lead (+/−).
- Results screen uses the sim history (replaces UI-side sampling).

## 5. Communication & shotcalling hierarchy (IGL)

Three tiers, top overrides bottom:

1. **Coach** (you) — strategic calls (existing 5 + phase plans + lane swap), 60 s cooldown.
2. **In-game leader (IGL)** — one player per team, chosen on the board
   (default: highest `leadership`). Relays coach calls with latency
   `3 − 2.5·leadership/20` s; makes **autonomous tactical calls** when no coach
   call is active (checked every 20 s): `gank` (visible enemy ≤ 60 % hp, ≥ 2
   allies within 25 tiles), `defend` (own structure under attack), `back`
   (team avg hp < 40 % or 2+ allies dead), `push` (2+ enemies dead), `group on
   spike` (spike rule). An IGL call lasts 20 s. Uses only team vision.
3. **Players** — one seeded roll per player per relayed call: follow with
   probability `0.55 + 0.45·IGL leadership/20` ± 0.15 by fit with their
   aggression (aggressive players ignore _back/safe_ more, cautious ones
   ignore _push/gank_ more), clamped [0.3, 0.98].
   Non-followers keep their own behaviour ("freelancing", visible in the HUD).

- **Backup caller**: if the IGL is dead, the next-highest leadership alive
  player relays with +1.5 s latency and −0.15 compliance; if no caller is
  alive, the call waits (its 40 s duration still runs) and is relayed by the
  first caller to respawn.
- New `leadership` rating (1..20) on every player (team data).
- Comms log in HUD: `Coach → Mae (IGL): "Take Roshan" · 4/5 following`.

## 6. Behavioural sliders

Per player, set on the board and editable live (paused or not):

| Slider / control | Range                                        | Sim effect                                                                                                                                                                                |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aggression       | 0–100 (50 default)                           | adds to the existing `sense` term: retreat hp ±0.10; fight when power ratio ≥ 1.2..0.7; tower-dive hp threshold; call compliance. Laning plan `aggressive` adds +15, total clamped to 100 |
| Farm priority    | 0–100                                        | below 50 joins group calls sooner; above 50 keeps farming until 2+ allies are already at the objective; `on-item` gold margin                                                             |
| Ult discipline   | 0–100                                        | AoE/line ults: required heroes = 1 + round(2·d/100) (finisher exception kept). Single-target ults: ≥ 70 holds them for a target ≤ 50 % hp                                                 |
| Target priority  | weakest · carry · support · nearest · threat | hero target score weights (threat = most hero damage dealt)                                                                                                                               |

AI coach chooses sliders from team style (aggressive 75, macro 45, teamfight
55 with high ult discipline, pick 60 with `weakest`). Sliders and target
priority are standing orders: free to change anytime, read at each player's
next rethink (not a call, no cooldown).

---

## Architecture

- New pure modules in `@mobacraft/sim/match/`: `matrix.ts` (tags, rules,
  synergy/counter/matchup, team synergy), `tactics.ts` (types + defaults +
  `aiTactics(draft, side)`), `vision.ts` (grid, ward spots). `match.ts`
  consumes `MatchOptions.tactics?: Record<DraftSide, TeamTactics>` and gains
  commands `setPlan`, `setBehavior`, `swapLanes`, `setVisionPriority`,
  `setIgl`; snapshot gains `phase`, `economy`, `vision`, `comms`, `wards`,
  `history`, `purchases`, per-hero `netWorth`, `xp`, `lane`, `following`.
- Population seam unchanged.
- Web: flow gains `tactics` screen; new components `tactics-board/*`,
  `economy-panel.tsx`, `comms-log.tsx`, `live-tactics.tsx`, a ward overlay on the
  match minimap (CSS team tokens, no engine colours),
  draft `synergy-panel.tsx` + `matrix-dialog.tsx`. All strings keyed in `strings.ts`.

## Failure / edge states

- Lane swap requested outside laning / on cooldown → returns `false`, button disabled with reason.
- All ward spots warded → warder returns to its slot.
- IGL and backup dead → comms log shows "No caller alive"; calls queue.
- Invalid tactics (missing assignment) → normalised to defaults (never throws).
- Match length cap 40 min unchanged.

## Acceptance (gate)

1. `make test` green; new sim tests: matrix derivation & rules; phase order; lane
   assignment honoured in laning (incl. Dire safe = top); swap rules; wards
   placed & vision %; NW = gold + items; Σ sources = Σ earned; IGL relay
   latency and backup caller; aggression 100 vs 0 (both teams) gives ≥ 20 %
   more total kills+deaths over 4 seeds; determinism with tactics.
2. Balance: 8 AI-vs-AI games with default tactics still end 10–30 game-min and
   both sides win at least once (existing tests).
3. Browser playthrough: pick → draft (matrix visible) → tactics board (lanes,
   plans, items, vision, IGL, sliders edited) → match (phase banners, economy panel, comms log, live slider
   change, lane swap, wards on minimap) → results (NW graph from sim history,
   item timeline). 0 console errors. Screenshots in `docs/design/tactics-*.png`.

## Out of scope

Teleport scrolls, smoke of deceit, sentry wards as items, buyback, day/night
vision, couriers, neutral items, fog/ward rendering in the 3D view, LOS
vision, saving tactics presets, seasons.

## Review log

Fresh-context review verdict **FAIL (scope) / CONCERNS (design)**. Resolved:
all user-requested systems kept but trimmed (Teleport, 3D ward model, viewer
fog filter deferred); Dire safe-lane bug accepted as a fix + balance re-run;
`phase` replaces `midGame`; IGL can't call Roshan in laning; split removed from
late; plan/swap/slider cooldown rules defined; ult discipline split for
single-target ults; gold sources complete by construction; anti-snowball
(laning matchup halved, aggression clamp, ≤ 1 adaptive item, anti-stall from
25:00); draft value capped ±0.2; tag distribution test; measurable aggression
acceptance; minimap overlay uses CSS tokens (spec/02).
