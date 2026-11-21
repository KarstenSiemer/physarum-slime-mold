# 0086: Three levers of the crown as settings of the engine

- Status: accepted. The owner asked on 2026-11-21 that the best crown form of the prototype can be made in the app:
  "mindestens eine neue Szene und das Verhalten einstellbar" (at least one new scene, and the behaviour adjustable).
  The coordinator set the task on the same day: part E5a of stage 4, the three levers of that form as settings, each
  with today's value as its default. Decisions 1, 2, 9 and 10 are the coordinator's and decision 4 follows a rule of
  the coordinator, all under the owner's delegation of 2026-11-12; the other choices are an agent's, under the same
  delegation.
- Date: 2026-11-21
- Extends [ADR 0081](0081-a-flow-over-8-neighbours.md) (the proposal: the 8 neighbours in the engine),
  [ADR 0083](0083-more-flux-for-the-veins-of-the-growing-colony.md) (the base 0.002 and k),
  [ADR 0084](0084-a-front-that-splits-into-crowns-that-move-on.md) (the case `none`) and
  [ADR 0070](0070-the-flow-takes-the-sinks-in-the-engine.md) (S = 2 · I0).
- In short: [`docs/model.md`](../model.md), sections 8.1, 8.3, 8.4, 8.7 and 9.1, has the rules;
  [`research/front/ENGINE.md`](../../research/front/ENGINE.md) has the part E5a;
  [`research/flow/README.md`](../../research/flow/README.md), part 33, has the checks and their commands. The records
  are in the archive under `logs/engine/levers-0086/`.

## Context

The best crown form of the prototype is the case `none` of `research/front/e2n.sh` (ADR 0084): the rules of stage 4,
which the engine has behind the setting `territory` (ADR 0068 to ADR 0075), with three levers more. The prototype
names them `stencil=8`, `base=0.002` and `norm=4 paid=40`. The engine had none of them: its flow ran over 4
neighbours, the base conductance was the constant `FLOW.base` = 0.02, and the sinks of a strain took S = 2 · I0
(`SINKS.take`). A later part (E5b, ADR 0087) adds the crown scene, the panel controls and the help in Learn.

## Decisions

1. **Three settings, with the values of before as defaults** (the coordinator). In `src/model/params.ts`, each with a
   help text: `flowEdges`, 4 or 8, default 4 (`flowEdgesHelp`); `flowBase`, the base conductance g0, 0.02, from 0.001
   to 0.1 on a log slider; `frontFlux`, the flux to the front k, 1, from 0.25 to 16 on a log slider. The crown of ADR
   0084 is 8, 0.002 and 2. Learn and the panel show none of them yet (E5b). The ranges are the agent's: they hold the
   values that the research ran (the base 0.002 and 0.02, k from 1 to 16) with room on both sides, and the least base
   keeps the weakest tube above the ghost conductance (decision 9).
2. **Where they act, and the pattern of `drift` and `territory`** (the coordinator). `flowEdges` and `flowBase` act in
   every scene with Flow in the tubes, `frontFlux` only with the rules of stage 4. The Jones model sets their defaults
   (`asJones()`). A link holds `flowEdges` and `flowBase` only while the flow is on, and `frontFlux` only while the
   rules are on (`linkSettings()`); a link without them runs with the defaults, so every link made before runs as it
   was made. A change acts at the next step and restarts no run. The notice of a switch to the Jones model skips the
   base conductance, as it skips the flow strength: both mean nothing without the flow.
3. **The 8 neighbours as the prototype runs them with `stencil=8 solver=app`** (`research/front/sim.ts`: `STENCIL8`,
   the diagonal links of the constructor, `edges8()`, `fluxOfCells8()` and `pressure()`). An axis edge conducts
   w_a = √2 − 1 times the harmonic mean of its two cells, a diagonal edge w_d = 1 − 1/√2 times. A diagonal edge to
   (x + dx, y + dy) exists only where (x + dx, y) and (x, y + dy) are open, so it passes no corner of a wall. The
   pressure takes the ghost conductance on both cells of every edge, and Q is half the sum of the sizes of the
   fluxes over the 8 edges. The passes add the 4 axis edges and the 4 diagonal edges apart and weigh each sum once
   (w_a Σ_axis + w_d Σ_diagonal), where the prototype weighs each edge; both are the same sum, and the check below
   shows that they agree to float32. A diagonal edge needs both cells beside it open, so their axis edges conduct the
   ghost: the sum of the conductances of a cell is above 0 over 8 neighbours exactly where it is over 4. The weights
   are float32 literals in the passes (AXIS 0.414213568, DIAG 0.292893231), the float32 of `FLOW_EIGHT` in
   `src/engine/flow.ts`.
4. **A variant of the passes, not a branch on a uniform** (the coordinator's rule: a variant if a uniform branch costs
   time in the 4-edge path). `//#if EIGHT` in `flow.wgsl` and `tubes.wgsl`, `#if EIGHT` in `flow.frag` and
   `tubes.frag`; without it each source is the one of before, code for code, so a scene with 4 neighbours keeps its
   bytes by construction. In `flow.wgsl` EIGHT replaces one line after a `//#else`, the sum of the conductances of the
   pressure, which is a `let`. A uniform branch on the same code (`if (U.g.w != 0.0)`,
   `research/front/e5a-uniform.ts`) costs 3.2 % of a step of the Maze on WebGPU and 5.1 % on WebGL2 with 4
   neighbours: it is slower than both builds with the code of before in 7 of 8 rounds on WebGPU and in 8 of 8 on
   WebGL2. The variant costs nothing (the table below).
5. **Every reader of the 4 edges, and what each does now.**
   - The update (Q) and the pressure: the 8 edges (decision 3).
   - The stream of the picture of the tubes, which moves the grains: the 8 edges with their weights, and a diagonal
     edge only where both cells beside it are open, as the flow then runs. A diagonal edge points along (±1, ±1).
     The prototype draws no grains; without this a vein of one cell on a diagonal would show no stream, and a broad
     flow on a diagonal would move its grains 1.41 times too fast. Display only.
   - The tube of a sink (`tubeOut()` of `sinks.wgsl`, ADR 0072): its path keeps 4 neighbours. The prototype's
     `tubeOut()` walks 4 neighbours also with `stencil=8`, and the crown of ADR 0084 grew so. A patch of tube that only
     a diagonal edge joins to the network therefore holds no sink (an open point below).
   - The drift `take` (ADR 0075): it reads t / G of the agent's cell and no edge, as the prototype's
     `driftPressure()`; t is S · r / R, so it grows with k as the prototype's `take[c]` does.
   - The ports, the roles, the pressure limit, the zero point and the paths of the sinks read no edge.
   - The CPU copies follow: `flowFlux()`, `flowUpdate()` and `flowPressure()` in `src/engine/flow-reference.ts`, and
     `tubeStream()` in `src/engine/tubes-reference.ts`. `research/flow/rules.ts`, the research copy of the solver of
     ADR 0029, stays with 4 edges, and `bounded.ts` still holds it to the CPU copy bit for bit.
6. **The CPU copy reads the edges from the block.** `packFlow()` writes 1 into the last lane of the slot g with 8
   neighbours, 0 with 4 (it was 0 and free), and the base conductance of the settings into `U.b.x`. No pass reads
   that lane: the passes are compiled for the setting (`flowEight()`), and a GPU test that compares a pass with the
   CPU copy fails if the variant and the lane disagree. A block with 4 neighbours and 0.02 has the bytes of before.
7. **The arenas of the engine.** The prototype has a closed box only. In the engine a diagonal edge wraps across the
   seam of a periodic grid as an axis edge does, and in the dish a cell outside the disc is closed, so no diagonal
   edge leaves it: `openXY()` holds both rules for every edge.
8. **k as the prototype has it.** The prototype sets `norm` = 2 k and `paid` = 20 k (`research/front/e2m.sh`, line 4):
   its front takes S = `norm` · I0 (`paidSinks()`), and its budget grows by S / `paid` = I0 / 10, whatever k is.
   `norm` and `paid` enter nothing else with `paidBy=rank`. So the engine's sinks take S = 2 k · I0 (`U.take.x` =
   `SINKS.take` · k, `packSinks()`), the sources give the same S, the drift reads t of that S, and the budget grows by
   2 · I0 / 20 as before (`paidIncrement()`, `U.take.y`): one birth costs 20 k of flux. The coordinator's reading,
   verified in the code of the prototype.
9. **The base conductance as the prototype has it** (the coordinator). G = B · (g0 + D) on a tube, in every scene with
   the flow; a food keeps 4 B. `FLOW.base` stays as the default, and a test holds the two to each other. The least g0,
   0.001, leaves the weakest tube (B = 0.05, D = 1e-4) 5.5 times the ghost conductance, which only lets a cell beside
   the network hold a pressure.
10. **Whether every scene moves to 8 neighbours is the owner's decision** (the coordinator): it changes the bytes of
    every scene with the flow, so each needs its campaign again. In `TODO.md` under the owner's open decisions.

## Checks

- **The bytes of the scenes**: the digests of every scene after 500 steps, both backends, with the state of the flow,
  against the record of ADR 0075, whose engine `main` has: 62 of 62 runs are equal.
- **The CPU copy against the prototype** (`research/front/research.test.ts`): the same conductivities, roles, sinks and
  pressures of 4 lanes in a box of 14 × 11 cells with a thin diagonal wall and a wall of one cell. With 8 edges Q
  differs by 7.8 · 10⁻⁸ of its largest value and the pressure after 16 iterations by 3.7 · 10⁻⁷; with 4 edges by
  6.5 · 10⁻⁸ and 6.9 · 10⁻⁷. The test allows 10⁻⁶ and 10⁻⁵.
- **The GPU tests**, both backends: both passes against the CPU copy over 8 neighbours with g0 = 0.002 (a wall with
  two ends and a dab under it, 6 steps); a vein of one cell on a diagonal carries the whole I0 over 8 neighbours
  (Kirchhoff with the weights within 1 %, Q = I0, the memory of f(I0)) and nothing over 4 (Q = 0, it starves); a wall
  of one cell beside one step of that vein stops both foods at their pressure limit; the stream over 8 against the
  CPU copy in the box, on a periodic grid and in the dish, with a thin diagonal wall; the flow with the sinks and the
  drift at k = 2 with 8 neighbours and g0 = 0.002; the sinks with births at k = 2, whose budget grows as at k = 1.
  The whole GPU suite passes.
- **Wrong rules**: LV1 to LV35 (`research/flow/engine/mutate.ts`), in the shaders of both backends, the sims, the CPU
  copy, the block, the settings and the link; TY37, TY126, TY128, TY129 and TY134 follow the new code. FP1 named a
  text that is twice in the prototype since ADR 0076 (`edgeNear()`); it names `freshNear()` alone now. Each of the 41
  fails at least one test.
- **The time of a step** of the Maze with the flow (512 × 320 cells, steps 3,000 to 4,050, `bench.gpu.test.ts`), on
  an M3 Pro, 4 builds in turns over 8 rounds (`research/front/e5a-times.sh`), the median of the 8 medians:

  | Build                               | WebGPU             | WebGL2             |
  | ----------------------------------- | ------------------ | ------------------ |
  | `main`                              | 1.579 ms           | 2.047 ms           |
  | this branch, 4 neighbours           | 1.579 ms (0.0 %)   | 2.037 ms (−0.5 %)  |
  | a branch on a uniform, 4 neighbours | 1.629 ms (+3.2 %)  | 2.152 ms (+5.1 %)  |
  | this branch, 8 neighbours           | 2.020 ms (+27.9 %) | 2.829 ms (+38.2 %) |

  The runs with 4 neighbours hold the same agents (5,018 alive on WebGPU and 5,298 on WebGL2 at step 4,050), those
  with 8 neighbours fewer (4,100 and 4,317): the agent passes of the two differ too. The machine ran its desktop
  beside them (a load of 2.2 to 4.1).

## Not measured

- The crown in the engine: no scene turns the levers on yet (E5b). Any scene with 8 neighbours, another base or
  another k: their speed, their veins, their agents.
- Whether the tube of a sink should walk 8 neighbours while the flow does (decision 5).
- The ends of the ranges: no run of the research had a base below 0.002 or above 0.02, or k below 1.
- The time of the stream over 8 neighbours, which a frame computes, not a step; the time of a step in any other
  scene, or with the rules of stage 4.
- The 8 neighbours on SwiftShader beyond the GPU tests of CI.
