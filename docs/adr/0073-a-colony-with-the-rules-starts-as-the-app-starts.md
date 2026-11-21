# 0073: A colony with the rules of stage 4 starts as the app starts every scene

- Status: accepted. The coordinator decided it on 2026-11-20 under the owner's delegation of 2026-11-12: the first
  open point of ADR 0072.
- Date: 2026-11-20
- Extends [ADR 0072](0072-a-sink-lies-on-a-tube-that-carries-flux-to-it.md) (open points) and
  [ADR 0065](0065-the-growth-front-takes-the-flow-a-prototype.md) (the records of the prototype).
- Extended by [ADR 0088](0088-the-scenes-of-reid-run-the-rules-and-the-avoidance-of-slime-is-a-setting.md)
  (2026-11-21): the open point, measured in the engine.

## Context

The prototype of stage 4 measured every record of ADR 0065 and ADR 0067 with the food scent at its steady state when
the colony starts: 300 steps of the scent before the first agent (`Params.scentSteps` of `research/front/sim.ts`). The
app starts every scene without a scent. With the start of the app the prototype grows as the engine does (ADR 0072,
finding 4). ADR 0072 left the choice open: either the engine starts a colony with the rules on a steady scent, or the
records become those of the start of the app.

## Decision

A colony with the rules of stage 4 starts as the app starts every scene: without a food scent before it
(`Params.scentSteps` 0 in the prototype). The reasons:

- With the start of the app and the test of the tube of a sink (ADR 0072) the prototype keeps its targets
  (`research/front/start.sh`): in the Y-maze with slime on one arm the colony takes the blank arm 40 : 0, without slime
  it chooses 26 : 14, and it covers half of the open dish after 5,500 steps (5,139 with the start of the prototype).
- Every scene starts the same way, without a hidden run before it.
- The look that the owner knows stays: the app has always started without a scent.

From now on the research of stage 4 runs the start of the app and the test of the tube of a sink (`scent=0
sinkTube=1`), and it reports the prototype's own start beside it where it matters.

## Consequences

- The engine keeps its start; no scene changes.
- The records of ADR 0065 and ADR 0067 stay as they are, with their start. A new record says which start it ran.

## Open points

- The Y-maze without slime chooses 26 : 14 with the start of the app (a binomial test against no preference: p
  0.081). Part E4 measures it in the engine over 40 seeds.
