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
5. **With and without a tool.** The rule reads the wall byte of the agent's own cell once per alive agent and pass
   that calls `placement()`, and only while a wall may lie over an alive agent (decision 8; before it, while the
   environment may hold walls, `P.extra.y`).
6. **With one agent per cell the point is claimed like a move** (7.6). A loser stays under the wall with its heading
   and draws again in the next step.
7. **The test "is blocked by a wall" writes its agent into the open cell (31, 32)**, west of the wall. With the agent
   in the wall cell the test fails under the rule: the agent goes to x = 35.3.

The coordinator's decision of 2026-11-15, after the review of the pull request:

8. **The rule costs nothing in the scenes as they ship.** Reason: only a wall painted after the population was placed
   can put an alive agent on a wall cell (Context), so the rule needs to read the wall byte only while such a wall may
   exist. As first built it read it while any wall existed, and the Maze without the flow took about 0.02 ms more per
   step in every pair of runs: 0.195 against 0.213 ms on WebGPU, 0.448 against 0.474 ms on WebGL2 (`main` at
   `1cf6375` against `b8ecde5`, three runs each, M3 Pro). Built so:
   - Both simulations keep a flag `wallOverAgents` (`src/engine/sim.ts:200`, `src/engine/gl/sim.ts:268`), packed as
     `extra.w` (`src/engine/pack.ts:240`; the fourth value of `extra` was unused in `common.wgsl` and
     `common.glsl`). `underWall()` tests it in place of `P.extra.y` (`agents.wgsl:255`, `tools.glsl:89`).
   - Set by a painted stroke of kind wall (`sim.ts:957`, `gl/sim.ts:930`), by written bytes that hold a wall
     (`writeEnv()`, `sim.ts:1150`, `gl/sim.ts:1136`), and by a written agent while walls exist (`writeAgent()`,
     `sim.ts:1106`, `gl/sim.ts:1107`: a test can put an agent anywhere).
   - Cleared by `reset()` (`sim.ts:617`, `gl/sim.ts:748`), which places every alive agent on an open cell: `init`
     starts an agent alive only on a habitable cell (`init.wgsl:136`, `init.frag:136`), and the claim rounds take only
     free cells (`freeCell()`, `init.wgsl:152`; `points.vert:34`). Cleared by `clearEnvironment()` (`sim.ts:1037`,
     `gl/sim.ts:997`), which leaves no wall.
   - The scenes keep it cleared: `Engine.load()` paints the edits (`engine.ts:262`) before `this.reset()`
     (`engine.ts:265`), and `Engine.rebuild()` paints (`engine.ts:389`) before `sim.reset()` (`engine.ts:390`).

   The other paths that write `env` or place agents, and why none puts an agent under a wall without the flag:
   - A stroke during a run, and a link's edits: the engine paints only through `flushEnv()` → `sim.paint()`
     (`engine.ts:628`), each frame (`engine.ts:724`) and after the sweep deleted edits (`engine.ts:603`). A wall stroke
     there sets the flag. A link's strokes come with `Engine.load()`, before the reset.
   - A new grid, lattice, density or capacity, or a change into or out of the dish: `needsRebuild()`
     (`engine.ts:338`–`343`), so `rebuild()` paints before it places. A new seed, layout, boundary or rule of one
     agent per cell, or new shares: `Engine.update()` resets (`engine.ts:236`). `Sim.update()` (`engine.ts:231`)
     moves no agent and writes no byte of `env`.
   - The steps themselves: a move needs a habitable target (`agents.wgsl:327`, `canClaim()` at `agents.wgsl:348`);
     inoculate, cut, respawn and a placement off a wall need an open cell (`openCell()`, `agents.wgsl:229`); a child
     of the growth rule needs a neighbour that is no wall (`growth.wgsl:149`–`151`). The start layout Food places its
     colonies with the inoculate tool after the reset (`seedAtFood()`, `engine.ts:391`, `engine.ts:444`).
   - `writeEnv()` and `writeAgent()` are for tests only: the engine changes the environment only with `paint()` and
     `clearEnvironment()` (`src/engine/types.ts:139`). Both set the flag.

   The flag only skips a read: wherever it is cleared, no alive agent stands on a wall cell, so no result changes
   (digests below). A wall stroke keeps it set until the next reset or clear, also after its agents have left.

## Consequences

- No scene changes a byte. The digests of `research/flow/README.md` part 6 (`digest.gpu.test.ts`: the default
  settings and the 20 scenes, 500 steps, WebGPU and WebGL2, M3 Pro) against `main` at `1cf6375`: 42 of 42 equal with
  the flow off, and 42 of 42 equal with the flow as each scene has it. With decision 8, against `main` at `3f579ff`
  (the food sites of decision 17 of ADR 0029): again 42 of 42 equal with the flow off and 42 of 42 with the flow as
  each scene has it.
- A wall painted over a colony sends the agents under it to random open cells of the whole grid in the next step, as
  the cut does. A thick wall no longer holds living agents that never deposit.
- Cost: none that a free GPU shows (check of 2026-11-15, below). With the rule a step of the Maze and of the Foraging
  maze, the flow off, takes what it took before the rule, within 1 % on WebGPU and within 4 % on WebGL2, and also
  while its flag is set. The 0.02 ms of the first build (decision 8) did not come again in 8 rounds in turns.
- Tests (`sim.gpu.test.ts`, "agents under a painted wall", both backends): every agent under a thick wall is at its
  first open point after one step, with its heading, and the count of alive agents stays, without and with one agent
  per cell; while the cut is held such an agent lands outside the wound; an agent beside the wall keeps its blocked
  step or its move. The first three fail without the rule; the one beside the wall passes without it by design and
  fails when the rule reads the cell of the move. `research/flow/engine/mutate.ts` holds these wrong rules as U1 to
  U6, and U7 and U8 for decision 8: a painted wall never sets the flag, on each backend. Each of the eight fails at
  least one test (runs of 2026-11-15): U7 and U8 fail the first three tests, because the tests paint their walls with
  `sim.paint()` over agents that are already placed.

### The cost of a step

Before decision 8 the Maze without the flow took 0.195 against 0.213 ms per step on WebGPU and 0.448 against 0.474 ms
on WebGL2 (decision 8). Those were runs of `main` and of the branch in turns, three of each, with no other GPU work on
the machine.

With decision 8, `main` at `3f579ff` against this branch, the Maze and the Foraging maze, both with walls and the flow
off (the Foraging maze ships so), M3 Pro, 2026-11-15 from 01:35 to 02:57. Two other sessions ran GPU campaigns the
whole time: a check every 2 s found another Vitest in 2,210 of 2,210 checks. So no run in turns was free of other GPU
work: 0 runs count, and none is in the table. A step took 4 to 27 times as long as on a free GPU (the Maze: 0.87 to
1.5 ms against 0.19 ms on WebGPU, up to 12 ms against 0.45 ms on WebGL2).

In their place `research/flow/engine/base-agents.gpu.test.ts` ran the agent pass of `main` (its `agents.wgsl` and
`tools.glsl`), of this branch, and of this branch after a wall stroke on one wall cell, which changes no byte but sets
the flag, as three engines in one page. They took turns for each of 31 batches of 50 steps after 3,000 steps, so other
work slows all three alike within a round. The table gives, for two runs, the median over the rounds of the time of a
batch over the time of the batch of `main` in the same round. In every run the three engines ended with the same
agents, bit for bit.

| Scene         | Backend | branch / `main` | branch with the flag set / `main` |
| ------------- | ------- | --------------- | --------------------------------- |
| Maze          | WebGPU  | 0.95, 0.97      | 0.96, 1.02                        |
| Foraging maze | WebGPU  | 1.16, 0.93      | 1.02, 1.00                        |
| Maze          | WebGL2  | 1.04, 0.95      | 0.96, 0.99                        |
| Foraging maze | WebGL2  | 1.02, 0.99      | 0.87, 0.97                        |

The ratios scatter by up to 16 % around 1, with no direction. That cannot show or rule out the 6 to 10 % of before
decision 8. Not measured, then: the step time of the scenes as they ship, and the cost of the rule while its flag is
set. To measure both on a free GPU, run in turns, `main` first, with the seven engine files of each:

```bash
VITE_SCENES=maze,foraging-maze VITE_FLOWS=off VITE_NAME=bench-main npx vitest run --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts
```

and on the branch the same with `VITE_NAME=bench-branch`, and with `VITE_WALL=1 VITE_NAME=bench-wall` for the rule
while its flag is set.

### Check of 2026-11-15: the cost on a free GPU

The coordinator measured the step on a free GPU, after the campaigns of the other sessions had ended: 52 runs from
08:32 to 08:41, M3 Pro, and in each of the 52 checks before a run no other Vitest ran (load 3.4 to 4.4 in the 36 runs that logged it).
`research/flow/engine/turns.sh` ran `bench.gpu.test.ts` of `3d27e3b` in a checkout of each commit, the builds in turns
and the order reversed in every second round. A run is the Maze and the Foraging maze with the flow off, seed 1, a
canvas of 1280 × 800, 3,000 steps, then the median of 21 batches of 50 steps.

- **Before against after the rule**: `3f579ff` (`main` just before this ADR) against `3d27e3b` (this ADR, merged), and
  `3d27e3b` with `VITE_WALL=1`, where a wall stroke sets the flag and the rule reads the wall byte under every agent in
  every step. 12 rounds.
- **The first build**: `1cf6375` against `b8ecde5`, the pair of decision 8, whose rule read the wall byte while any wall
  existed. 8 rounds.

ms per step, the median over the rounds (least to most), and per round the time of a build over the time of the build
before the rule in the same round, the median (least to most):

| Scene         | Backend | `3f579ff`           | `3d27e3b`           | flag set            | after / before      | flag set / before   |
| ------------- | ------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| Maze          | WebGPU  | 0.204 (0.198–0.206) | 0.204 (0.194–0.208) | 0.202 (0.198–0.208) | 1.000 (0.951–1.030) | 1.000 (0.961–1.020) |
| Foraging maze | WebGPU  | 0.366 (0.348–0.370) | 0.367 (0.362–0.372) | 0.366 (0.358–0.406) | 1.011 (0.984–1.052) | 1.005 (0.978–1.103) |
| Maze          | WebGL2  | 0.422 (0.398–0.436) | 0.434 (0.420–0.448) | 0.423 (0.418–0.442) | 1.042 (0.968–1.062) | 1.002 (0.986–1.095) |
| Foraging maze | WebGL2  | 0.671 (0.648–0.688) | 0.668 (0.656–0.680) | 0.673 (0.656–0.682) | 0.994 (0.956–1.040) | 0.994 (0.979–1.027) |

| Scene         | Backend | `1cf6375`           | `b8ecde5`           | first build / before |
| ------------- | ------- | ------------------- | ------------------- | -------------------- |
| Maze          | WebGPU  | 0.200 (0.198–0.204) | 0.199 (0.198–0.204) | 1.000 (0.971–1.020)  |
| Foraging maze | WebGPU  | 0.368 (0.364–0.396) | 0.365 (0.358–0.374) | 0.984 (0.939–1.027)  |
| Maze          | WebGL2  | 0.428 (0.426–0.500) | 0.431 (0.424–0.448) | 0.998 (0.896–1.014)  |
| Foraging maze | WebGL2  | 0.664 (0.662–0.686) | 0.666 (0.662–0.674) | 1.000 (0.974–1.015)  |

In every run all builds ended with the same number of alive agents: 13,130 in the Maze, 17,840 in the Foraging maze
on WebGPU and 17,230 on WebGL2. A check before the runs read the flag after the wall stroke and 100 steps: it was set
on both backends in both scenes.

What the numbers say:

- The rule costs no time that these runs show, with its flag clear or set. The largest median, 1.042 on WebGL2 in the
  Maze, is a run with the flag clear; the same build with the flag set does more work and took 1.002. So 4 % lies in
  the spread of the order of the runs, and the rule costs less than that.
- The first build did not cost 0.02 ms either: its ratios are 0.98 to 1.00. The three runs of each build of decision 8
  measured 0.195 against 0.213 ms on WebGPU; here both took 0.199 to 0.200. Why those runs differed is not found.
- Decision 8 stays. Reason: it costs nothing either, its paths are tested (U7, U8), and to take it out would be a
  change of the engine that gains nothing measurable. Not measured: another GPU than the M3 Pro.

The 208 lines of the runs, with the build, the commit and the round, and the log of each check are
`research/flow/logs/engine/wall-cost/` in the archive. To measure again, in a checkout of each commit with
`node_modules` and the `bench.gpu.test.ts` of `3d27e3b`:

```bash
VITE_SCENES=maze,foraging-maze VITE_FLOWS=off research/flow/engine/turns.sh 12 before=<checkout of 3f579ff> after=<checkout of 3d27e3b> wall=<checkout of 3d27e3b>:wall
```
