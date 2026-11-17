| step                   | outcome                                                                          | next action                                           |
| ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| spec/09-crowd-combat   | PASS after fresh-context review (CONCERNS → resolved)                            | —                                                     |
| pure modules           | PASS: crowd.ts, attack-ring.ts, attack-phase.ts, engage.ts; 27 unit/arena tests  | —                                                     |
| match integration      | PASS: commit 40c13f2; sim 191/191; balance within 0.5 min of baseline            | —                                                     |
| spec/13 readability    | PASS: per-hero swings, phase-driven anims, debug overlay (\`); 49b10b6 + 6b01a08 | measure overlay CPU (world.debugMs) in a real browser |
| respawn death-pose bug | FIXED 921e8fc; 2 regression tests                                                | —                                                     |
