# 0070: The flow takes the sinks of each strain in the engine

- Status: accepted. The coordinator set the task on 2026-11-20: part E2b of the engine of stage 4, in both backends,
  behind the setting `territory`, which no scene turns on yet: the pressure with the sinks and the sources, the
  adaptation while the front took flux, and the drift in the sensors. The rules are those of ADR 0065 (decisions 1
  and 6), the forms those of ADR 0067 (decisions 3, 6, 8 and 9). The drift is 1.5 for now: its default is an open point
  of part E4, the owner's choice of the form. The choices below are an agent's, under the owner's delegation of
  2026-11-12.
- Date: 2026-11-20
- Extends [ADR 0067](0067-the-rules-of-stage-4-in-the-forms-of-a-gpu.md) (decisions 3, 6, 8 and 9) and
  [ADR 0069](0069-the-sinks-of-each-strain-in-the-engine.md).
- Extended by ADR 0071 ([the births that the flux pays in the engine](0071-the-births-that-the-flux-pays-in-the-engine.md)).
- Extended by [ADR 0075](0075-the-drift-take-in-the-engine.md) (the drift `take`: decisions 6 and 7).
- Extended by [ADR 0086](0086-three-levers-of-the-crown-as-settings.md) (2026-11-21): the sinks take S = 2 k · I0,
  with k the setting Flux to the front.
- In short: [`docs/model.md`](../model.md), section 8.7, has the rules;
  [`research/front/ENGINE.md`](../../research/front/ENGINE.md) has the state of the parts and what part E3 needs.

## Context

ADR 0069 found the sinks of each strain, their rates, the sums R, C and N, and the state of each strain, but no rule
read them. The prototype `research/front/sim.ts` with `colony=1 solver=app` gives the rules that read them
(`paidSinks()`, `flowPass()`, `sense()`): the sinks take 2 times the flow strength, the covered foods or the tube cells
pay it, a tube adapts while the front took flux in the step before, and a sensor reads minus the drift times the mean
pressure of the lanes.

## Decision

1. **What the sinks take and the sources give is a term per cell of the pressure pass**, computed in the pass from the
   rates and the state of the step: no buffer. Every tube cell takes S · r / R, with S = 2 · I0, r its rate as R counted
   it, ⌊(|r| · 2^24 + 128) / 256⌋ / 2^16 (ADR 0067, decision 3), and R from the state. The covered ports give S / P each,
   and without one each tube cell gives S / C. The term is the same in every lane and adds to the flux of the roles, so
   the roles, their flux I0 and their pressure limit stay. Only while the front takes flux in the step (the state).
   A cell finds whether it is a port with a loop over the sites only when it holds food: only a food cell is a port.
2. **S rides in the uniform block of the flow** as the factor 2 of I0, in a slot after that of the sinks
   (`FLOW_TAKE_SLOT`; ADR 0067, decision 9). Its lanes y, z and w stay 0 for part E3 (the flux of a birth).
3. **Exactly means up to the rounding of float32.** The prototype runs in float64, and its sinks miss S by 10⁻⁹ (ADR
   0067, decision 3). The passes compute each share in float32 with two roundings, and R once, so the sinks miss S by
   less than 10⁻⁶ of it (the CPU copy in float32; a division of WGSL has an error of 2.5 ULP). With their own rates
   they would miss it by 10⁻³ in the unit test and take 2.2 times S in a GPU test. The flow compares GPU and CPU with a
   tolerance, as before (ADR 0069, decision 3: only exact operations compare exactly).
4. **The adaptation reads the flag of the step before in place.** On WebGPU the update of a strain runs before the
   pass `state` of the step, so the state still holds the flag of the step before; on WebGL2 the update reads the
   current copy of the state, and the pressure the copy that the step writes. A tube adapts while two sites had a role
   or that flag is 1; without both its flow memory stays, as in the prototype.
5. **The drift is a setting `drift` for all strains, in a lane per strain of the parameters**, as the food weight
   (ADR 0067, decision 9). The struct of the parameters gains the slot `drift` after every slot of the code before
   (from 432 to 448 B), so no pass of the code before reads another value. One setting for all strains now, packed
   into the lane of each: ADR 0065, decision 6 lets each scene set its value, and one drift per strain is an open
   point of ADR 0067 for the panel. The default is 1.5, the crown of ADR 0065, and it is provisional: part E4 picks
   the value of each scene. A link holds the setting only while the rules are on, the Jones model sets it to its
   default, and Learn shows no help for it until the panel offers it (part E4).
6. **The rules wrap the sensor of the flow.** With TERRITORY, `agents.wgsl` and `agents.frag` name the sensor of the
   code before `sensed` (one line after `#else`) and add a sensor `sense` that subtracts the drift times the mean of the
   4 lanes. The body of the sensor stays as it is, character for character: the tests of the model switch cut the
   saturation out of it by a pattern (`sim.gpu.test.ts`), and new code in a function changes how a compiler rounds
   (`SENSE_WALLS`). The test of the variants allows the lines after a `//#else` of TERRITORY. A blocked sensor stays
   blocked and reads no pressure: outside the grid a load of a texture is not defined.
7. **The sensors read the pressure that the flow of the step before left**: on WebGPU `claim` binds the whole texture
   of the current pressure as an array of a layer per strain; on WebGL2 the agent pass samples the 4 pressures, a
   texture per strain, 16 samplers in all (ADR 0067, decision 8). The update binds 3 storage buffers, the pressure 4,
   as decision 8 says.
8. **The CPU copy** is in `flow-reference.ts`: `sinksAndSources()` in float32 as the passes compute it, the update
   with the flag of the step before, the pressure with the term of each cell, and `drifted()`. Without the sinks it
   computes what it did before, bit for bit: `research/flow/rules.ts` and `bounded.ts` hold it to that.

## Results

- **Both backends follow the CPU copy** (`flow-sinks.gpu.test.ts`, 5 tests, both backends, M3 Pro): two strains in a
  dish with a wall that has a gap, over 5 steps, one with a covered port and one whose tube cells pay, with 117 to 175
  sinks per strain: the pressure within 1.7 · 10⁻⁵ of its largest value and the memory within 10⁻³; the CPU copy
  without the sinks lies 0.90 to 1.03 of the largest pressure away. No tube adapts in the first step, and all 860 and
  861 open tube cells of the two strains adapt in each step after it. A strain without a sink and with one site keeps
  its flow memory. Tube cells whose rates R counts as 0: within 6 · 10⁻⁷, where their own rates would take 2.16 times S
  and move the pressure by 0.056 of its largest value. A grid of 320 × 256 cells with rates of 0.9 to 1, whose R of
  77,052 passes 2^32 steps of 2^-16: within 2.9 · 10⁻⁶, where R from the low word alone, 11,516, moves the pressure
  by its whole largest value. 256 agents of both strains turn as the CPU copy says, at the drift 1.5 (81 keep their
  heading, 52 turn right, 53 left, 70 by the draw) and at 0 (all keep it), on both backends alike.
- **The CPU copy** (`flow-reference.test.ts`): the sinks take S, and the sources give it, to 10⁻⁶ of S, with 0 to 3
  ports, and with R of 131,072 cells near the rate 1, whose low word wraps.
- **The wrong rules** TY102 to TY140 of `research/flow/engine/mutate.ts` each fail at least one test, and so do TY36
  and TY37, whose texts follow the code of the link and of the Jones model now
  (`research/flow/logs/engine/flow-sinks-0070/mutations.txt`). A wrong rule of WGSL keeps reading each binding: a
  binding that a pass does not read leaves its layout, and every test would then fail for that alone.
- **Where**: the whole GPU suite (1,407 tests) on an M3 Pro, and `flow-sinks.gpu.test.ts`, `sinks.gpu.test.ts` and
  `territory.gpu.test.ts` in the image of CI (SwiftShader; 48 of 48 tests, the new file in 34 s).
- **No scene changes**: the digests of every scene after 500 steps on both backends, with the state of the flow, equal
  those of the record of ADR 0069 in 62 of 62 runs (`research/flow/README.md`, part 29).

## Consequences

- With the rules on, the agents turn down the pressure, to the sinks, and the tubes adapt to the flux that the front
  takes. How a scene runs with that is not measured (part E4). Part E3 pays births with that flux
  (`research/front/ENGINE.md`).
- The agent pass of WebGL2 samples 16 textures while the rules run, the least that a device has: a new sampler there
  needs a texture less elsewhere, for example the flow textures as arrays (ADR 0067, open points).
- Not measured: the time of a step with the rules, and any scene with the rules (the crown, the speed of the front, the
  Y-maze and the dish in the engine).

## Open points

- The default of the drift for each scene, and whether each strain gets a drift of its own: part E4, with the panel
  and the owner's choice of the form (ADR 0065, decision 6).
