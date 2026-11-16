# Match Day — Game Definition (manager milestone)

Phase: **Discovery → vertical slice**. Benchmark: _Teamfight Manager 2_ (coach a
pro team: draft, then watch an auto-battled match). Our twist: the match is a
full 5v5 MOBA on The Ancient Isle (lanes, towers, creeps, jungle, Roshan),
rendered as the cozy diorama.

## Fantasy

You are the coach of a small esports team on The Ancient Isle: you read the
enemy, win the draft, and make the two or three calls that swing the game.

## Goal

Win one best-of-1 match: destroy the enemy Ancient.

## Pressure

An AI coach drafts against you and makes its own calls; your players have
strengths, weaknesses and hero comfort; fights are decided by draft, player
skill and timing — not by your clicks.

## Defining Twist

TFM-style management on a real three-lane MOBA map: lane assignment, towers
that must fall in order, jungle camps, Roshan and the Aegis all come from the
existing map data, so classic MOBA strategy (gank, push, group, Roshan)
emerges from the sim and the coach steers it with calls.

## Core Loop (one match day, ~6–8 min real time)

1. **Pick team** (20 s): choose one of 4 teams; opponent is drawn.
2. **Draft** (2 min): 2 bans each, then snake picks B1 R1 R2 B2 B3 R3 R4 B4 B5 R5.
   Each pick is assigned to a player; the board shows each player's mastery.
   The AI coach bans your comfort heroes and counter-picks.
3. **Match** (3–5 min at 4×): auto-played 5v5. Coach calls (cooldowns):
   _Group up · Take Roshan · Push · Play safe · Farm_. Speed 1×/2×/4×/8×, pause.
   Kill feed + objective feed; scoreboard; per-hero HP, level, KDA, items.
4. **Results** (30 s): winner, duration, per-player K/D/A, last hits, gold,
   hero damage, healing, MVP. Play again / Explore island.

## Scope (this slice)

- 20 heroes (original, polygon dark fantasy), 1 skill + 1 ultimate each, data-driven
  effect DSL (damage, dot, heal, hot, stun, root, slow, shield, buff, dash, execute).
- Economy: last-hit/kill/assist/tower gold; levels 1–15 (ultimate at 6);
  automatic item purchases from a 10-item list by role.
- Structures: towers fall in tier order; T4s and Ancient last; barracks
  empower the enemy wave when destroyed. Roshan grants the Aegis (one revive).
- Jungle: neutral camps fight back, give gold, respawn every 60 s.
- Deterministic seeded sim (fixed 0.1 s ticks) — same seed + same calls → same game.

## Out of scope

Seasons, training, transfers, money, injuries, multiplayer, saving, audio.

## Candidate loops considered

- Arena teamfights (TFM1-style): cheaper, but discards the island — rejected.
- Full season: right destination, wrong first slice — deferred.
