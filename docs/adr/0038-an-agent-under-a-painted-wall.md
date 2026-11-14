# 0038: An agent under a painted wall is placed off it

- Status: accepted (decision of the coordinator, 2026-11-15, under the owner's delegation of 2026-11-12), built
  2026-11-15
- Date: 2026-11-15

## Context

`docs/model.md` 7.5 said: a move inside the agent's own cell succeeds unless that cell is a wall, and the start cell
is never checked on the way. So an alive agent under a wall that was painted onto it stepped out of it on a later
move. Deep in a thick wall it stayed there for good: every target cell was a wall, so every move was blocked, it
deposited nothing, its sensors read blocked, and it counted as alive (`TODO.md`, found on 2026-11-13).

What can put an alive agent on a wall cell, read in the code on 2026-11-15:

- The start: `init` (`init.wgsl`, `init.frag`) starts an agent alive only on a habitable cell, and the claim rounds
  take only free cells (`freeCell()`). `Engine.load()` and `Engine.rebuild()` paint the edits before `sim.reset()`
  places the agents (`src/engine/engine.ts`).
- A step: a move needs a habitable target; inoculate, cut and respawn need an open cell (`openCell()`); a child of
  the growth rule needs an open neighbour (`divideInto()` in `growth.wgsl`).
- The 20 scenes paint their shapes at load only (`env` in `src/model/presets.ts`).

So only a wall that the user paints during a run puts an agent there. One GPU test did it by chance: "is blocked by a
wall" wrote its agent into the cell (32, 32), which its wall of radius 1.2 paints.

## Options

1. Place the agent as the Cut tool places its agents (model.md 7.2). The population stays.
2. Kill it. The population shrinks, and without growth nothing brings it back.
3. Keep the rule.

## Decision

1. **Option 1** (coordinator, 2026-11-15). An alive agent whose cell is a wall at the start of its step takes the
   first of 8 uniform random points of the grid whose cell is open, keeps its heading, and moves as usual if none
   fits. Reason: Jones healed a wound by placing the agents of the wound elsewhere (Jones 2010, p. 148; ADR 0023), so
   the population stays the same, and the app already has this placement for the Cut tool. A kill would shrink a
   population that has no growth in most scenes.

My own choices, under the same delegation:

2. **It is placed in the sense of 7.2**: no move and no deposit in its step, so also no child of the growth rule in
   that step (a child needs a move). Reason: the cut's agents do the same, and one rule holds for every placement.
3. **The stream of the tools, in the loop of the cut** (`placement()` in `agents.wgsl` and `tools.glsl`). An alive
   agent draws from that stream only for the cut or a wall (inoculate draws only for dead agents), and an agent that
   the cut reaches under a wall runs the loop once. So no two draws of one agent in one step share a number, and no
   new stream is needed (model.md 7.7).
4. **Outside the wound while the cut is held.** Reason: the cut keeps its wound free, and an agent placed into it
   would be moved again in the next step.
5. **With and without a tool, while the environment may hold walls** (`P.extra.y`, set by the first wall stroke after
   a clear). Without walls the rule reads nothing. With walls it reads the wall byte of the agent's own cell once per
   alive agent and pass that calls `placement()`.
6. **With one agent per cell the point is claimed like a move** (7.6). A loser stays under the wall with its heading
   and draws again in the next step.
7. **The test "is blocked by a wall" writes its agent into the open cell (31, 32)**, west of the wall. With the agent
   in the wall cell the test fails under the rule: the agent goes to x = 35.3.

## Consequences

- No scene changes a byte. The digests of `research/flow/README.md` part 6 (`digest.gpu.test.ts`: the default
  settings and the 20 scenes, 500 steps, WebGPU and WebGL2, M3 Pro) against `main` at `1cf6375`: 42 of 42 equal with
  the flow off, and 42 of 42 equal with the flow as each scene has it.
- A wall painted over a colony sends the agents under it to random open cells of the whole grid in the next step, as
  the cut does. A thick wall no longer holds living agents that never deposit.
- Cost (`bench.gpu.test.ts`, the median time of a step in ms, M3 Pro with other work on the GPU): see the table
  below.
- Tests (`sim.gpu.test.ts`, "agents under a painted wall", both backends): every agent under a thick wall is at its
  first open point after one step, with its heading, and the count of alive agents stays, without and with one agent
  per cell; while the cut is held such an agent lands outside the wound; an agent beside the wall keeps its blocked
  step or its move. The first three fail without the rule; the one beside the wall passes without it by design and
  fails when the rule reads the cell of the move. `research/flow/engine/mutate.ts` holds these wrong rules as U1 to
  U6, and each fails at least one test (run of 2026-11-15).
