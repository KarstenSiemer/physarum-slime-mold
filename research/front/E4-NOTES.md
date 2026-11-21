# Part E4 of stage 4: notes (2026-11-21)

The brief of the coordinator: turn the rules of the growth front on in the scenes of Reid et al. 2012, measure them in
the engine on both backends against the prototype and the paper, and make the avoidance of slime adjustable in the
panel. ADR 0088 records the result. These notes hold what each phase found, so that a fresh agent can go on.
Commands run from the root; the records go to `research/front/out/e4/` (git ignores it), the raw logs to the archive
(`logs/engine/reid-0088/`).

## Phase 1: the two settings (done)

- `slimeWeight` (Weight on slime, 0.001 to 1, log, default 0.025) and `freshReach` (Reach to fresh ground, 2 to 6
  cells, whole, default 6) in `globalSpec` of `src/model/params.ts`, after `slimeLife`. They replace `SINKS.slime`
  and `SINKS.fresh` of `src/engine/sinks.ts`: `slimeWeightOf()` and `freshReachOf()` give the values in the units of
  the passes, and `packSinks(f, s)` writes them into the lanes w and x of `FLOW_SINK_SLOT`, as the constants were.
  No shader changed: `sinks.wgsl` and `sinks.frag` read the lanes already. The CPU copy reads `SinkInput.slime` and
  `SinkInput.reach`.
- The passes go on from the paths of the edge (2 steps) to those of the reach, so a reach below 2 would need paths of
  its own; `freshReachOf()` keeps the reach from 2 to 6 for every value of the settings.
- The panel: the Slime section shows both sliders while the rules run and the model has slime, else a line that names
  the switch of the rules. Learn lists them after Slime life time (the order of `globalSpec`). A link holds them only
  while `territory` is on; the Jones model sets their defaults; the notice of a switch to Jones skips them.
- Tests: `sinks.test.ts` (the packing, the CPU copy with other values), `sinks.gpu.test.ts` (three cases with other
  values on both backends against the CPU copy), `params.test.ts`, `url.test.ts`, `state.test.ts`. Wrong rules SA1 to
  SA23 in `research/flow/engine/mutate.ts` (not run yet).

## Phase 2: the backends (done)

`bash research/front/e4.sh backends`: the four scenes, seeds 1 to 6, to step 1,500, both backends. The means of
WebGL2 over those of WebGPU at the steps 500, 1,000 and 1,500: live agents 0.95 to 1.07, territory 0.96 to 1.03,
sinks 0.91 to 1.22 (two of the twelve counts of the sinks with Mann-Whitney p below 0.05: 0.025 and 0.045). The
three cases of the Y-maze are equal to step 500: the colony is still on the base.

## Phase 3: the Y-maze on WebGPU (done)

`bash research/front/e4.sh y`: 40 seeds per case, the first food as `ymaze.ts` measures it (the engine's step less 1).

| Case              | Engine (WebGPU)          | Prototype, `take` 1.5 (ADR 0074)   | Reid et al. 2012 |
| ----------------- | ------------------------ | ---------------------------------- | ---------------- |
| Slime on one arm  | 40 : 0, first food 3,358 | 40 : 0, 3,291.5                    | 39 : 1           |
| Slime on both     | 20 : 20, 3,637.5         | 18 : 22, 3,601                     | no preference    |
| No slime          | 15 : 25 (p 0.15), 3,426  | 15 : 24, 1 split (p 0.20), 3,438.5 | the control      |
| Both against none | 1.06 times (p 0.000069)  | 1.05 times (p 0.0000072)           | not given        |

The layout is a mirror image about its middle column (checked: no open cell, arm cell or food cell off the mirror),
so the lean of 15 : 25 without slime is not the layout's. The territory of the blank arm over that of the arm with
slime, the least of the 40 runs: 1.07 at step 1,500, 1.47 at 1,800, 1.54 at 2,000 (for the e2e test).

The campaign on WebGPU stepped the scenes with `Engine.frame()`, which draws a picture in every step. On WebGL2 that
took about 100 s a run, so the test steps with `Sim.run()` now, as the digests do (`VITE_FRAME=1` keeps the old way).
Seeds 1 to 3 with slime on one arm give the same record both ways, every row of it (`out/e4/run-check`), in half the
time.

## Phase 4: the Y-maze on WebGL2 (done)

`bash research/front/e4.sh ygl`: slime on one arm 40 : 0, first food 3,292.5 (2,977 to 3,722); both arms 5 : 5, 3,567;
no slime 5 : 5, 3,530.5; both against none 1.01 times (p 0.94: 10 runs each do not resolve the 6 % of WebGPU). The
first food of WebGL2 over that of WebGPU: 0.98 (p 0.34), 0.98 (p 0.55) and 1.03 (p 0.073).

## Phase 5: the dish (done)

`bash research/front/e4.sh dish`, 10 seeds each. Slime everywhere, the steps to the glucose: WebGPU 11,452.5 (10,167
to 11,951) with the slime and 11,417.5 (10,933 to 11,814) without it, 1.00 times (p 0.88); WebGL2 11,517.5 and
11,386.5, 1.01 times (p 0.41). That is 6.4 h for 6.6 cm, about 1 cm/h (the organism: 1 to 3 cm/h). The open dish of
the prototype (160 cells, the food in the middle), half covered: WebGPU 5,793.5 (5,500 to 6,146), WebGL2 in the
table of ADR 0088; the prototype with `take` 1.5: 5,882.5 (5,303 to 6,150). Every target holds at the drift 1.5.

## Phase 6: the reach (done; the runs at the reaches 2 and 4 follow)

`bash research/front/e4.sh reach`: WebGPU, seeds 1 to 10 of each case, at the steps 1,500 and 3,000: for each sink
(a rate with a minus sign) the least steps of a path to ground without slime. The share of the sinks with fresh ground
within 0, 1, ..., 6 steps:

| Sinks                                         | 0   | 1   | 2           | 3           | 4           | 5           | 6           |
| --------------------------------------------- | --- | --- | ----------- | ----------- | ----------- | ----------- | ----------- |
| On blank ground: the blank arm, the open dish | 0   | 0   | 0.09 – 0.18 | 0.44 – 0.50 | 0.73 – 0.81 | 0.86 – 0.97 | 0.92 – 1.00 |
| On the arm with slime (one and both arms)     | 0   | 0   | 0           | 0           | 0           | 0           | 0 – 0.01    |

The colony's own slime lies on every cell within one step of each sink: the plasm reaches past the agents at the
edge, and every cell that held plasm has slime. So a reach of 0 or 1 gives every sink the weight on slime, on blank
ground as on slime: no meaning. A reach of 2 still tells the two apart, and the passes need it (their paths go on from
those of the edge, 2 steps). So the least reach is 2.

## Phase 7: the digests (done)

`VITE_FLOW=1 VITE_NAME=g88-digest-branch ... digest.gpu.test.ts` against `logs/engine/crown-scene-0087/digest-branch.jsonl`
(`summary.ts digests`): 64 runs in both files, 60 equal; the 4 different runs are the Y-maze with slime and Slime
everywhere on both backends, which run the rules now. The 4 runs of the two new scenes have no partner. The Crown of
veins, which runs the rules with the defaults of the two settings, keeps its bytes on both backends.

## Phase 8: the checks of the reach, the weight and a gap (done)

- The Y-maze with slime on one arm, WebGPU, seeds 1 to 10 (`out/e4/reach2`, `reach4`, `weight1`): at the reach 2 the
  blank arm first in 10 of 10, first food 3,151.5; at 4 in 10 of 10, 3,266.5; at 6 (the campaign, seeds 1 to 10)
  3,303.5. At the weight 1 (the avoidance off) 5 : 5, first food 3,553, the other food 9 to 644 steps later: the
  avoidance comes from the weight.
- The open dish, seeds 1 to 10: WebGL2 grew faster than WebGPU (agents 87 against 71 at step 300, p 0.0052; half of
  the dish 0.97 times, p 0.0082). Without the rules the same seeds show no gap (p 0.45 or more), and with the rules
  seeds 11 to 40 show none either (agents and territory at the steps 200 to 1,000: p 0.38 to 0.99; `out/e4/gap-more`):
  a chance of the ten seeds, as in ADR 0072 (`E2c-NOTES.md`, part 1).

## Phase 9: the time, SwiftShader, the tests (done)

- The time of a step (`bash research/front/e4.sh times`, 4 rounds, load 3.9 to 5.2): with the rules 0.46 to 0.58 ms on
  WebGPU and 1.47 to 1.83 ms on WebGL2, without them 0.20 to 0.28 and 1.15 to 1.25 ms; the Corn maze 1.58 to 1.66 and
  2.13 to 2.19 ms.
- SwiftShader in the image of CI (`research/start/run.sh`, 4 cores): the Y-maze runs at 2.15 steps per second in the
  app and at 16.2 with `Sim.run()` from the page. So the e2e test `tests/e2e/y-maze.spec.ts` pauses the app and steps
  the scene to step 1,800 itself; it passes in the image in 2.6 minutes. It is the last file, so it runs in shard 4.
- Wrong rules SA1 to SA23: each fails at least one test. SA8 first named an equivalent change (the paths of the CPU
  copy end at the reach already); it now cuts the paths at the edge.
- `npm run test:gpu` 1,448 tests and `RESEARCH=full npm test` 1,009 tests pass. The grid fit of ADR 0058 holds 33
  scenes and 3,672 cases now (`research/electrode/research.test.ts`); the same 8 grids change. The archive of the logs
  holds 926 files.
