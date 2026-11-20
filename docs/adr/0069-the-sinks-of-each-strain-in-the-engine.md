# 0069: The sinks of each strain in the engine, and the corner of the push

- Status: accepted. The coordinator set the task on 2026-11-20: part E2a of the engine of stage 4, in both backends,
  behind the setting `territory`, which no scene turns on yet: the rule of a corner in the push (ADR 0068, open point
  1), the sink test of each cell and strain, the mean of the sink rate, the sums R, C and N per strain, and the state
  per strain. The rules are those of ADR 0065 (decisions 1, 5 and 8), the forms those of ADR 0067 (decisions 3, 6 to 8
  and 10). The choices below are an agent's, under the owner's delegation of 2026-11-12.
- Date: 2026-11-20
- Extends [ADR 0067](0067-the-rules-of-stage-4-in-the-forms-of-a-gpu.md) (decisions 3, 6 to 8 and 10) and
  [ADR 0068](0068-the-territory-of-each-strain-in-the-engine.md) (open point 1).
- Extended by ADR 0070 ([the flow takes the sinks](0070-the-flow-takes-the-sinks-in-the-engine.md)).
- Extended by ADR 0071 ([the births that the flux pays in the engine](0071-the-births-that-the-flux-pays-in-the-engine.md)).
- In short: [`docs/model.md`](../model.md), sections 6.10 and 6.11, has the rules;
  [`research/front/ENGINE.md`](../../research/front/ENGINE.md) has the state of the parts and what part E2b needs.

## Context

ADR 0068 built the territory. Its push counted a diagonal neighbour between two walls, so a territory could reach a
cell that no agent can enter. The sinks come next: ADR 0067 gives their forms (the paths of decision 10, the integer
sums of decision 3, the passes of decision 6, the buffers of decision 7, the bindings of decision 8), and the prototype
gives the rule (`paidSinks()` in `research/front/sim.ts` with `sinkAt=edge`). The pressure, the adaptation and the drift
that read the sinks come in part E2b, the paid births in part E3.

## Decision

1. **The push counts a diagonal neighbour only if the two cells beside their corner are not both walls**, as a move and
   a birth do. A cell outside a closed arena is no wall there, as in `divideInto()` of growth and `wallIn()` of a move.
   So the territory reaches no cell that an agent cannot enter.
2. **Two passes per strain in the loop of the flow**: `sinks`, per cell, and `state`, per strain, run for each strain
   right after the update of its flow and before its pressure. Decision 6 of ADR 0067 orders the update, the sinks, the
   state and the pressure; the passes of a strain read no state of another strain (ADR 0031), so the order between
   the strains changes no result, and the loop of the flow stays as it is.
3. **The sink rate is a whole number of steps of 2^-24, and its mean rounds toward the weight.** WGSL lets a compiler
   fuse a product and a sum (its section "Reassociation and Fusion"), and WGSL and GLSL ES give a division an error of
   2.5 ULP, so a mean in floats could round apart on two GPUs and on the CPU, and the sums with it (`agents.wgsl`
   holds a case: code that never runs changes how a compiler rounds, `SENSE_WALLS`). In steps of 2^-24 the mean of a
   step is integer arithmetic, R ← R ± ⌈|W − R| / 100⌉, the same on every GPU. Each step moves at least 1 toward the
   weight W, so the rate reaches its weight and a cell that is no sink comes to 0, and the rate never passes W. It lies
   less than 100 steps of 2^-24 from the mean in exact numbers, less than one step of the sums (256 steps). The float
   of decision 7 holds the whole number exactly, as it is at most 2^24. The weights are 2^24 and 419,430, the nearest
   whole number to 0.025 · 2^24. Both backends and the CPU gave the same rates on an M3 Pro and on SwiftShader, the
   GPU of CI.
4. **A sink keeps its rate with a minus sign on both backends.** Decision 7 asks for it on WebGL2, where the pyramid
   counts N by the sign. On WebGPU it costs nothing, and the readers, the tests and the next parts see the same rates
   on both backends.
5. **The cell of the sink starts every path.** So the cell counts for the edge, and for ground without slime, as the
   squares of the prototype hold it: an agent that a tool put outside its territory lies at the edge. Room is a cell
   within 1 step that holds no agent of any strain and lies in the territory of the strain.
6. **Ground without slime is read after the stamps of the step**: an open cell without slime for a reader of the next
   step, as the prototype reads it (`k = step + 1` in `paidSinks()`).
7. **The paths are rows of bits over the 13 × 13 cells around a cell, loaded in three rings**: 3 × 3 for the room,
   then 5 × 5 for the edge, then 13 × 13 for ground without slime. A cell without an agent of the strain or without a
   tube loads no cell, and one without room loads 9. The 6 and 2 steps, the 100 steps of the mean and the weight on
   slime in steps of the rate ride in a slot of the block of the flow after the push (`FLOW_SINK_SLOT`, as decision 9 of
   ADR 0067 asks); the window of 13 × 13 is the most that a pass holds (`SINK_WINDOW`), and a unit test keeps the
   steps of the block inside it.
8. **The sums.** R counts the rates of the tube cells (G > 0) only, as the prototype does, each in steps of 2^-16
   rounded to the nearest, ⌊(R + 128) / 256⌋ of its whole number. On WebGPU a workgroup of 8 × 8 cells sums its cells
   with atomics of the workgroup (at most 2^22, no wrap) and then adds each sum to the buffer with one `atomicAdd`,
   whose old value tells whether the low word of R wrapped. On WebGL2 each strain has a pyramid: its first level sums
   4 × 4 cells from the rates and the memory, each level above sums 4 × 4 texels with the carries in the second lane,
   and its top of one texel holds the sums.
9. **The state** is 2 vec4 per strain: R as a float, C, N, the covered ports; then 1 while the front takes flux, and 3
   lanes that the pass keeps for part E3 (the budget). R as a float is high · 2^16 + low / 2^16 in two additions of
   exact floats, so a fused addition rounds alike, and both backends give the float of the CPU. WebGPU writes the
   state in place; WebGL2 has two copies, as decision 7 says, and each strain writes its two texels.
10. **The memory**: 4 B per cell and strain on WebGPU and 8 + 16 / 15 B on WebGL2 (`SINK_BYTES_PER_CELL`,
    `SINK_BYTES_PER_CELL_GL` and `Backend.sinkBytesPerCell` in `sizing.ts`), counted for every strain that has a flow
    while the rules run. A new number of strains gives the sinks new buffers, as it gives the flow a new state.
11. **A simulation that is destroyed frees the territory and the sinks.** The `destroy()` of either backend did not
    free the territory since ADR 0068: after a new grid its textures and targets waited for the garbage collector. Both
    call `dropTerritory()` now, which frees the sinks too.

## Results

- **The CPU copy** (`sinks-reference.ts`) follows the paths with a queue over the cells; the passes take rows of bits.
  Both backends agree with it exactly in the rates, the sums and the state, with two strains (`sinks.gpu.test.ts`, 16
  tests): one step in a periodic grid, a box and a dish, with a thin column of wall between slime and fresh ground, a
  thin diagonal wall and a block, with more than 20 sinks of each strain, sinks of both weights, and more than 3 cells
  where the squares of the prototype see through a wall; an X of two thin diagonal walls, where no sink finds the edge
  across a wall in any of the four diagonal directions (more than 20 cells where a square would); 9 steps with births
  and a slime of 4 steps; a slime that ends in the step; a grid of 512 × 256 cells whose R wraps its low word; no
  sinks without the rules, a reset, and a third strain.
- **The corner of the push** (`territory.gpu.test.ts`): in 40 steps beside a thin diagonal wall no cell joins the
  territory of the strain of the other side, where the draws of the push would have taken more than 2 cells across
  the corners. The 22 tests of the file pass on both backends.
- **Where**: the whole GPU suite (1,397 tests) on an M3 Pro, and `sinks.gpu.test.ts` and `territory.gpu.test.ts` in
  the image of CI (SwiftShader; 35 s and 41 s for both backends).
- **The wrong rules** TY39 to TY101 of `research/flow/engine/mutate.ts` each fail at least one test, and so does TY31,
  whose text follows `packTerritory()` now (`research/flow/logs/engine/sinks-0069/mutations.txt`).
- **No scene changes**: the digests of every scene after 500 steps on both backends, with the state of the flow, equal
  those of the code of `main` (the record of ADR 0068) in 62 of 62 runs (`research/flow/README.md`, part 28).

## Consequences

- No rule reads the sinks yet. Part E2b gives the pressure the sinks and the sources, the adaptation while the front
  took flux, and the drift (`research/front/ENGINE.md`, the traps for E2b).
- Not measured: the time of a step with the rules on either backend, and any scene with the rules.
