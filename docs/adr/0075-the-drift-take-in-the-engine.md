# 0075: The drift `take` in the engine

- Status: accepted. The owner chose the form `take` of the drift on 2026-11-20 (ADR 0074, option 2), after the
  coordinator explained `all`, `take` and `mirror`. The coordinator set the task on the same day: part E2e of the
  engine of stage 4, in both backends, behind the setting `territory`, which no scene turns on yet. The choices below
  are an agent's, under the owner's delegation of 2026-11-12.
- Date: 2026-11-20
- Extends [ADR 0074](0074-a-drift-that-does-not-read-the-level-of-the-ground.md) (what part E2e builds in the
  engine), [ADR 0070](0070-the-flow-takes-the-sinks-in-the-engine.md) (decisions 6 and 7, the drift) and
  [ADR 0067](0067-the-rules-of-stage-4-in-the-forms-of-a-gpu.md) (decision 8, the limits of a GPU).
- In short: [`docs/model.md`](../model.md), sections 7.3 and 8.7, has the rule;
  [`research/front/E2e-NOTES.md`](../../research/front/E2e-NOTES.md) has the files, the commands and every number;
  [`research/flow/README.md`](../../research/flow/README.md), part 32, has the checks.

## Context

The drift of ADR 0070 let a sensor read the pressure at its cell, on the network and on the ground alike (the form
`all`). The level of a network against its ground, which only the history of the solver sets, then decided the growth
(ADR 0072, finding 3): a strain of the start scene ended step 1,503 with 124 to 1,593 agents. ADR 0074 tried eight
forms on the prototype and proposed `take`; the owner chose it. `take` needs in the agent pass what the sink of the
agent's cell took in the flow of the step before. The brief: the WebGPU agent pass binds 8 storage buffers, the most
that every device has, so take / G must come through a texture; the WebGL2 agent pass samples 16 textures, the least
that every device has, so room must be found there.

## Decisions

1. **The rule, as ADR 0074 says it.** While the rules of stage 4 run, an agent of strain s on a cell a reads at a sensor
   that is not blocked: V alone if a holds no tube of s; V − δ · P̄(c) if the cell c of the sensor holds a tube of s;
   else V − δ · (P̄(a) − SO · t_a / G_s(a)), with P̄ the mean pressure of the four lanes, t_a = S · r_a / R_s what the
   sink of a took (0 while the front of s took no flux), SO the sensor offset and G_s the conductivity, all as the flow
   of the step before left them. A cell holds a tube of s where G_s > 0 (lane z of the memory): the test of the
   prototype (`driftPressure()` of `research/front/sim.ts`), which holds exactly where the tube body is 0.05 or more
   (lane y against `U.c.z`). The prototype subtracts P̄(a) from every sensor of an agent on a tube; that changes no
   choice of the agent, so the engine leaves it out. The agent pass reads the cell of the agent once for its three
   sensors (`driftOf()`); the three calls of the sensors in `steer()` pass it on, after a `//#else` of TERRITORY.
2. **take / G comes from a pass at the start of each step**, before the agent passes, per strain with its block:
   `takes` of `flow.wgsl` into a texture of a layer per strain (`r32float`), PASS 5 of `flow.frag` into a target of a
   lane per strain. It reads the memory, the rates and the state as the flow of the step before left them, and shares
   the share S · r / R of a cell with the pressure (`taken()`), so the sensors read what that flow took. The reasons:
   R and the flag of the front exist only after the pass `state`, and the rates and the state stay as they are until
   the next flow; so the pass at the start of the step gives the same values as one at the end of the flow, and also
   what a test writes (`writeFlow()`, `writeSinks()`, `writeSinkState()`, `writePressure()`), with no copy that could
   go stale, no clear at a reset and no method of the simulation more. The premise of the brief holds only for
   `settle`: `claim`, the agent pass whose sensors read, binds 5 storage buffers (agents, env, occupancy, claims,
   clearance), so the rates and the state would fit it. The texture keeps one function of the share per backend, the
   same pass on both backends, one texel per sensor, and no buffer of the sinks in the agent passes.
3. **WebGL2: two targets of a lane per strain in place of the four pressure samplers.** `sinks.pressures` holds in lane
   s the mean pressure of the four lanes of strain s, and `sinks.takes` take / G; PASS 5 draws per strain into its lane
   of both (`gl.colorMask`), as the two targets of one framebuffer. The agent pass samples 14 textures. The reasons:
   the sensors read only the mean of the lanes (ADR 0070), so one lane per strain holds all that they read; two
   targets fit the helpers of `gl.ts`; and 2 samplers stay free. The other ways: a texture array of a layer per strain
   for each (4 B per cell and strain, but `gl.ts` binds and frames only 2D textures); the ring of the pressure of the
   flow as texture arrays (a change of every pass of the flow); programs of the agent pass by mode, so that `claim`
   does not sample `claims` (one sampler, and two programs more).
4. **The memory**: WebGPU 4 B per cell and strain more (`SINK_BYTES_PER_CELL` 8), WebGL2 32 B per cell whatever the
   strains (`DRIFT_BYTES_PER_CELL_GL`, the new `Backend.driftBytesPerCell`), both only while the rules run.
5. **Tests and wrong rules.** `flow-sinks.gpu.test.ts` holds both backends to the CPU copy (`takesOf()`, `groundOf()`,
   `drifted()` in `flow-reference.ts`): 256 agents on and off the tubes, a sink rate on every cell, a strain whose front
   takes flux and one whose front takes none, every value exact; and a shift of the pressure of every tube cell of
   each strain by ±200, which moves no agent, where the form `all` turns more than 20 otherwise. 19 wrong rules follow
   the new code, and TY231 to TY270 are new; each fails at least one test.
6. **The default drift of 1.5 stays provisional** (ADR 0070, decision 5): part E4 picks the value of each scene, now
   with the form `take`.

## Findings

1. **The start scene grows alike on both backends, with a narrow spread.** `three-networks` with the rules, seeds 1 to
   12, step 1,503 (M3 Pro), live agents per strain, median (least to most):

   | Strain | WebGPU        | WebGL2          | Mann-Whitney p | WebGPU higher in |
   | ------ | ------------- | --------------- | -------------- | ---------------- |
   | A      | 291 (259–424) | 307.5 (244–396) | 0.64           | 64 of 144 pairs  |
   | B      | 296 (224–374) | 316.5 (226–403) | 0.27           | 52 of 144 pairs  |
   | C      | 328 (241–382) | 299.5 (261–430) | 0.89           | 69 of 144 pairs  |
   | sum    | 954.5         | 964.5           | 0.60           | 63 of 144 pairs  |

   Every strain of the 24 runs ends with 224 to 430 agents. The prototype gave one strain in the dish of the start
   scene with `take` 284 to 435 agents at step 1,500 (ADR 0074, finding 6). With the form `all` a strain of the scene
   ended with 124 to 1,593 agents, and a run with 657 to 3,498 (ADR 0072, 18 seeds); with `take` a run ends with 804 to
   1,100.

2. **No spike of the pressure.** The least mean pressure of a strain over the cells in the first 30 steps is −346 to
   −2,513 on WebGPU and −258 to −3,801 on WebGL2; after the fix of ADR 0072 it was −315 to −3,801 (seeds 1 to 6), and
   25 of the 36 values of those seeds are the same to the unit.
3. **Both backends compute the reads as the CPU copy**, every value exact, and no move changes when the pressure of
   every tube cell of a strain moves by 200 (`flow-sinks.gpu.test.ts`). The form `all` turns more than 20 of the 256
   agents otherwise in the same case.
4. **The cost is about 2 to 3 % of a step with the rules.** The start scene at capacity 1 (147,456 agents, 384 × 384
   cells, seed 1), the median time of a step at step 1,833, the code with `take` and the code before it (`main` at
   `c2b1b3b`) in turns, two runs each (M3 Pro): WebGPU 3.74 and 3.72 ms against 3.67 and 3.63 ms, WebGL2 8.06 and
   7.96 ms against 7.84 and 7.80 ms; without the rules 2.89 and 3.78 ms. The runs differ in their agents too: with `take` 1,387 alive on WebGPU and 1,372 on WebGL2,
   with `all` 4,356 and 1,314, so the time mixes the passes with the agents.

## Consequences

- No scene changes its bytes: the 62 digests of every scene after 500 steps on both backends equal those of the record
  of ADR 0072. No scene turns the rules on.
- The engine has the form `take` only; `research/front/sim.ts` keeps every form of ADR 0074 as an option of
  `driftOn`, with `all` as its default, so every record of ADR 0065 to 0074 runs as before.
- The weights 0, 1.25 to 1.5 and 5 of ADR 0065, decision 6, were measured with `all`; ADR 0074 measured `take` at 1.5
  and 5 on the prototype.

## Open points

- Part E4: the drift of each scene and whether each strain gets its own; the measures of the scenes with the rules.
- Not measured: any scene with the rules but the start scene (the Y-maze, the dish, the Tokyo scenes and the mazes
  in the engine, part E4); the drift `take` at the weights 0, 1.25 and 5 in the engine; more than 12 seeds of the
  start scene; the look of `take` in the app; Murray's exponent.
