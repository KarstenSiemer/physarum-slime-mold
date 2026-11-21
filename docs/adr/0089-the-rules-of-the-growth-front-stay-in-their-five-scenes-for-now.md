# 0089: The rules of the growth front stay in their five scenes for now

- Status: accepted. The owner wrote on 2026-11-21, while trying the Crown of veins in the app: "ich probiere gerade
  die growth Front Krone aus und denke, dass das feature noch nicht bereit ist es in andere mazes einzubauen, die
  meisten Sachen funktionieren noch nicht so richtig. Also noch nicht in anderen presets einschalten bitte" (I am
  trying the crown of the growth front and think that the feature is not ready to go into other mazes; most things do
  not work right yet. So please do not turn it on in other scenes yet). Decisions 1 and 4 are the owner's; decisions
  2 and 3 are the coordinator's, under the owner's delegation of 2026-11-12.
- Date: 2026-11-21
- Extends [ADR 0088](0088-the-scenes-of-reid-run-the-rules-and-the-avoidance-of-slime-is-a-setting.md) (decision 6:
  the other scenes do not run the rules) and [ADR 0067](0067-the-rules-of-stage-4-in-the-forms-of-a-gpu.md) (its
  open points on the start scene and on a second strain).
- In short: `TODO.md` and [`research/front/ENGINE.md`](../../research/front/ENGINE.md) hold the plan of part 4.

## Context

Five scenes run the rules of the growth front (`Settings.territory`): the Crown of veins (ADR 0087) and the four
scenes of Reid et al. 2012 (ADR 0088). Eleven other scenes have growth and the flow, so they could run the rules too.
On 2026-11-21 the coordinator proposed to turn the rules on in these eleven scenes, in four parts:

- E4b: the three mazes (`foraging-maze`, `snail-maze`, `corn-maze`);
- E4c: `tokyo` and `tokyo-light`;
- E4d: `light` and `food-ring`;
- E4e: the four scenes with several strains, with a drift per strain and a test where a second strain grows on the
  slime of the first.

The owner agreed ("Ja, Teil 4 starten"), and an agent started part E4b. Then the owner tried the crown in the app and
stopped the parts with the words above.

## Options

1. Go on with the parts E4b to E4e. The other scenes would get the slow front of the organism and the avoidance of
   slime sooner. But they would carry rules that the owner finds not ready, and each scene would need its campaign
   again after each change of the rules.
2. Wait until the owner finds the rules ready (the owner's choice). Every other scene keeps its bytes, and the
   campaigns of the eleven scenes run once, on rules that the owner accepts.

## Decision

1. No other scene turns the rules on until the owner finds them ready.
2. The five scenes that run the rules keep them. The owner's words name only the other scenes.
3. Part E4b stopped before its first measurement and changed no file of the repository. Its notes and its runner lie
   outside git in `research/front/out/e4b-start/` for the day that the work goes on.
4. The parts E4b to E4e wait. The next work is what the owner finds wrong with the crown.

## Consequences

- This record changes no code, so every scene keeps its bytes.
- The panel still shows the switch Rules of the growth front in the Flow section of every scene with growth, so the
  owner can try the rules in any scene with the flow by hand.
- The open points of ADR 0067 (the start scene at a memory hint of 0.5 GB, a second strain on the slime of the first)
  and the list "Not measured" of ADR 0088 stay open.
