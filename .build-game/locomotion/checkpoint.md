# spec/11 locomotion nav layer — checkpoint

- spec drafted (orig. 09), fresh-context reviewed FAIL → resolved, committed as spec/11.
- locomotion.ts + locomotion.test.ts committed (835a848), 14/14 green.
- Integration into match.ts (DynamicNav swap, cutTree feed, turn rates in add())
  DEFERRED: parallel spec/09 crowd session owns match.ts right now and already
  consumes FREE_PATH_T/freePath/velMag. See spec/11 "Relationship to spec/09".
- Next step (when match.ts is free): the deferred integration slice, then
  run make test + re-baseline any trajectory snapshots once.
