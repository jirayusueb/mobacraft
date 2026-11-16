# ADR 003: Navigation, local avoidance and the combat state machine are separate layers

- Date: 2026-11-17
- Status: Accepted

## Context

Melee units piled onto the exact target centre, pushed each other out of range
and stood next to enemies without swinging (crowd deadlock / combat congestion).
Movement and attacking were interleaved in the same decision loops, so any fix
to one disturbed the other.

## Decision

Three layers with one-way data flow. None writes the others' state (spec/09).

1. **Navigation** (A* > 3 tiles, 16-ray context steering ≤ 3 tiles, melee goals
   = attack-ring slots) produces a _preferred velocity_ only.
2. **Combat state machine** (`attack-phase.ts`: point → damage frame → backswing,
   2.5-tile motion buffer) decides lock/unlock and maps it to an _avoidance
   priority_ (1.0 locked, 0.5 moving/engaged, 0.1 idle).
3. **Local avoidance** (`crowd.ts`: ORCA with priority-weighted responsibility,
   yield requests) is the only layer that integrates positions.

No physics engine and no collider push-out: overlap is prevented in velocity
space before integration.

## Alternatives considered

- Physics push-out (hull separation after integration): units jitter and get
  shoved out of range mid-swing, which is the bug we are fixing.
- Single-tick attacks with "stop when in range": no lock window means nothing
  protects a swing from a crowd. It also cannot express Dota's buffer or
  animation cancel.
- Flow fields for micro movement: overkill for a few units around one target.
  Rings plus context steering are cheaper and deterministic.

## Consequences

- An attacker that is in reach always swings. Slots only shape the approach.
- First hits land one attack point later (0.1–0.3 s). DPS over time is unchanged
  because cooldown is charged at the point start.
- Every new movement source must write a preferred velocity, not `x/z`. The
  only sanctioned teleports are respawn and dash.
