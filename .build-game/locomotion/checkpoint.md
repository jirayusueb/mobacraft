# spec/11 locomotion nav layer — checkpoint

- spec committed as spec/11 (orig. drafted as 09; see dedupe section in the spec).
- locomotion.ts + locomotion.test.ts committed (835a848), 14/14 green.
- Integration INTO match.ts DONE in the working tree (2026-11-17 01:03):
  createNav → DynamicNav, turn-gated stepToward via moveBody, radius-aware
  travel with ignoreForest, cutTree/regrowTree feeds, dash + knockback set
  freePath, phase/freePath decay, turn rates in add().
- Evidence: full `make test` gate PASS (4/4 tasks, 149 sim tests incl. the
  spec/09 think suite, 2m34s). Earlier failures were races with the
  concurrent spec/09/12 session's mid-edit states, not regressions.
- NOT committed: match.ts also carries the other session's uncommitted
  think/brain/inventory work (~900 lines); that session commits its own
  tree — my integration rides along in their next commit. Do NOT
  re-integrate or revert; verify with `bun test src/match/match.test.ts`
  after their commit lands.
