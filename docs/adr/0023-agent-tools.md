# 0023: Agent tools: dead agents only, free cells, an amount per second

- Status: accepted
- Date: 2026-11-11

## Context

Two tools act on agents while the pointer is held. Inoculate places agents of the selected strain in the brush. Cut
moves the agents in a wound away (Jones 2010, Sec. 4.3). A simulation has a fixed set of agents: a buffer with an id
for each agent for good (ADR 0005). Nothing creates agents. Growth (Jones 2011) is a later step (TODO.md, "Later").
So the inoculate tool can only bring back dead agents. These are the agents that shrinkage killed, the agents of the
start layout Empty, and the agents that found no free start cell (ADR 0008).

The measurements of items 1 to 4 are on `main` (d245ea3), on WebGPU and WebGL2. The scene is the Maze: 512 × 320
cells, 19,661 agents, start layout Empty, one agent per cell. The default brush (6.1 cells) is at the bottom-right
food.

1. Inoculate broke the one-agent-per-cell rule. A revived or moved agent went to a random point of the brush. Only
   walls were checked (`agents.wgsl:162–171`, `agents.frag:152–160` on `main`). With the rule an agent may always
   move inside its own cell (`agents.wgsl:267–268`), so the stacks stayed. After a 1 s hold, 811 to 852 agents sat in
   234 to 244 cells. Of these agents, 84 to 87 % were stacked, up to 18 in one cell. At step 2,000, 60 to 73 % were
   still stacked; at step 10,000, 6 to 49 %. Stacked agents jam and deposit almost nothing.
2. Cut re-seeded the agents of a wound the same way: 9 cells held two agents after one frame (Transport network,
   radius 12.2 cells).
3. Inoculate also moved living agents of its strain from anywhere into the brush. `App.svelte:286` passed `teleport`
   equal to `revive`. `agents.wgsl:164` applied it to every living agent of the strain. A second 1 s hold at the other
   food took 29 to 37 living agents (4.1 to 5.3 %) from the first colony. The owner saw "both sides split and behave
   oddly". `git log -S teleport` shows that the first commit (bc7d90c) added `teleport`; 8788c4f only uses it in
   tests. No commit message, ADR or design text gives a reason. The code gives a likely reason. With a fixed set of
   agents, a tool that takes only dead agents does nothing in a scene where every agent lives. Moving living agents
   made the tool show an effect in every scene.
4. The amount depended on the frame rate. The tool acted once per animation frame, with the chance of one frame at
   60 Hz (`App.svelte:279–282`, `sim.ts:260–269` on `main`). A 120 Hz display placed twice as many agents per second.
   While paused, each frame ran one step with the tool, so a 120 Hz display also ran twice the steps.
5. Found while testing: a move that ended just below an integer across the wrap seam landed in the next cell. On a
   grid 512 cells wide, x = −1.000001 lies in cell 510. The move counted there, and `wrapPos()` gave 511.0, in
   cell 511. A second agent could then claim cell 511 too.

The review of this change found four more faults (2026-11-11). Each one was measured again on an Apple M3 Pro:

6. The WebGL2 shaders wrapped cell coordinates with a float division: `c − size · floor(c / size)`. GLSL ES 3.00 lets
   a division be wrong by 2.5 ULP, so the floor can miss by one period. On the M3 Pro, `floor(vec2(c) / vec2(size))`
   was 0 at c = size for 291 of the sides 16 to 4096. Examples are 33, 47, 55, 66, 235, 243, 246, 264 and 293. Then
   `cellAt` put cell W in the next row, and row H outside the grid. Moves, sensors, diffusion, the clearance of walls
   and the view used it. On 512 × 246 cells, no agent crossed the top seam under the rule, also on `main`. That is the
   grid of a window of 1366 × 657 at grid 512. WebGPU had 3,769 crossings in 300 steps (seed 7). Without the rule, the
   first version of this change left on average 895 of 62,976 agents per step at y = 246. These agents were not
   drawn and deposited nothing.
7. `wrapPos()` took the whole periods from a float division too, on both backends. On a side of 480, x = 479.99997
   wrapped to −0.00003. On WebGPU, x = 33 on a side of 33 wrapped to 32.999996, also on 47 and 246. The first
   version of this change clamped such a position into its cell (`landed()`). That put the agent up to one cell from
   its true position, for example at 479.0 instead of 479.99997.
8. The notice read the alive count of the stats, and a restart did not clear that count. The review loaded the
   Transport network, selected the start layout Empty and pressed 80 ms later. The notice said that every agent
   lives, and the hold placed 881 agents. Also, WebGPU gave the count of the last step before a reset until the next
   step. A new simulation gave 0 until its first step.
9. While paused, a hold ran 60 steps per second also where inoculate could place nothing. The paused scene moved
   while the notice said that the tool does nothing.

SwiftShader, the GPU of CI, divides exactly. With the old code, the new seam tests pass there and fail on the M3 Pro.
Both were measured on 2026-11-11, SwiftShader through ANGLE on Vulkan, as in CI.

## Options

Living agents, and no dead agents left:

1. Keep moving living agents. It drains other colonies (item 3), and nothing shows that the owner wanted that.
2. Take dead agents only. With none left, place nothing and say nothing. The tool then seems broken.
3. Take dead agents only. With none left, place nothing, and a notice says why.
4. Create agents. That needs growth, a later step.

The rule (ADR 0008):

1. Draw again until a cell is empty at the start of the step. A move into that cell in the same step still gives
   two agents in one cell.
2. Claim the cell like a move: `atomicMax` with the unique key of the step, on WebGL2 `MAX` blending. The highest
   key takes the cell. The start placement uses the same method (`init.wgsl` `claimStart`, `settleStart`).

The amount per second:

1. A chance per frame, scaled by the time of the frame. The same in the mean, but a lower frame rate gives more
   claims per step under the rule.
2. A chance per step, with the time of each step. A dead agent stays dead over t seconds with the chance
   e^(−rate·t), however frames and steps cut t up.

Wrapping (items 5 to 7):

1. Clamp the result of `wrapPos()` into the cell of the move (`landed()`, the first version of this change). This
   fixes item 5, but it keeps items 6 and 7.
2. Keep `wrapPos()` where its result is in the cell, else add the fraction of p to the cell (proposed in the review).
   The second formula rounds twice, so it can differ by 1 ULP from the first.
3. Integers for every wrap of a cell coordinate, and for the whole periods of `wrapPos()`. Then one subtraction, and
   a clamp below the upper edge of the cell. One formula, with one rounding.

The alive count (item 8):

1. Clear the count at a restart. A count that waits for the GPU during the restart still arrives later, with the
   old number.
2. Mark each count with the run of its agents (`Engine.restarts`), and use only a count of the current run.

Paused holds (item 9):

1. Keep the steps, and say here that the paused scene moves.
2. Run no paused step while no dead agent of the strain is known. Cut always runs.

## Decision

- Inoculate takes only dead agents of its strain (`placement()` in `agents.wgsl` and `gl/glsl/tools.glsl`). With
  none left, it places nothing. Reason: the drain is a defect for the owner, the history shows no wish for it, and
  creating agents is a later step. Option 3.
- The notice comes once per press (`App.svelte`, text of 2026-11-11, after the review): "All agents of strain A are
  alive. Inoculate uses only dead agents. To get dead agents, set Shrinkage above 0, or select the start layout
  Empty. In that layout all agents are dead at the start." Reason: each sentence has one topic. The last one agrees
  with `docs/design.md`; the first text ("the start layout Empty starts with no agents") did not. The notice stays
  for 10 s, not 7 s, because it has 36 words.
- The tooltip of the tool reads "Hold to place agents of the selected strain. The tool uses only dead agents."
  (2026-11-11). Reason: the first text, "Hold to place dead agents", read as if the placed agents stay dead.
- With the rule, a placed or moved agent claims its cell like a move, and only the winner goes there. The cell must
  be habitable and empty at the start of the step (`openCell()`). A loser stays dead (inoculate) or stays where it was
  (cut). Cut tries up to 8 random points outside the wound for such a cell. WebGPU claims in `claim` and places in
  `settle`. WebGL2 marks the agent with `PLACE` in mode 1. The claim points (`points.vert` kind 1) and mode 2 find
  the same spot again. `placement()` reads only the agent after shrinkage, the parameters, `env` and the occupancy.
  So every pass finds the same spot. Shrinkage now comes first in a step.
- A placed or moved agent spends its step on that: it does not move and deposits nothing in that step, with and
  without the rule.
- A tool acts on every step of a frame (`Sim.run`). The engine gets a rate (`inoculateRate()` in `pack.ts`): per
  second, what 60 frames placed before. Each step gets the chance of its share of the frame's time (`stepChance()`,
  `Engine.frame`). A frame without a step passes its time on. While paused, a held tool runs 60 steps per second at
  any frame rate (`PAUSED_TOOL_STEPS`).
- Wrapping: option 3 (2026-11-11). Reason: it is exact on every GPU, and both backends give the same bits.
  - `wrapAxis()` and `wrapCell()` wrap with integer `%` in every GLSL shader that wraps cells (`common.glsl`,
    `view.glsl`). Both operands stay non-negative, because GLSL ES leaves `%` undefined for a negative one. WGSL
    already wrapped with `%` (`wrapCell()` in `common.wgsl`).
  - `wrapPos()` takes the whole periods from these integers and subtracts them in one step. The result stays below
    the upper edge of its cell. So a move or a tool puts the agent in the cell that `cellOf()` gives. The claim and
    the count of the move use the same cell.
  - Where the old division was right, `wrapPos()` gives the same bits as before. The only exception is a result that
    rounded into the next cell (item 5). On the M3 Pro, 655,360 random moves near the seams of 10 sides per backend
    gave no other difference.
  - `landed()` is gone, because `wrapPos()` now does what it did.
  - The start placement keeps `placed()` (`init.wgsl`, `init.frag`), so the start positions keep their bits.
  - The gel view keeps a float wrap of a position (`heightAt` in `render.wgsl` and `render.frag`). A wrong period
    there occurs only a hair from the seam. The sample then lands in the border of the height texture, one cell wide,
    which holds the cells across the seam. The seam test of the gel view passes on the M3 Pro.
  - Integer `%` costs no measurable time on WebGL2 (see Consequences).
- The alive count: option 2 (2026-11-11). `app.stats.run` holds `Engine.restarts` from the moment the app asked for
  the count. `deadLeft()` (`ui/state.svelte.ts`) uses no count of another run. WebGPU now counts the agents after each
  reset (`census` in `init.wgsl`), as WebGL2 always did. Reason: option 1 cannot stop a count that is under way. And
  without the census, WebGPU gave the count of the old agents while paused.
- Paused holds: option 2 (2026-11-11). The app marks the tool as idle (`HeldTool.idle`) while it knows no dead agent
  of the strain. A paused hold of an idle tool runs no step and keeps none of its time. Reason: such steps would only
  move the paused scene. Before the first count of a new run, no dead agent is known. So right after a restart, a
  paused hold waits for that count, for at most 500 ms.

## Consequences

- Max occupancy ≤ 1 holds for the tools too (ADR 0008). The same Maze runs had no cell with two agents during or
  after a 1 s or 10 s hold, with shrinkage 0.0001 and 0. These are WebGPU seeds 1 to 3 and WebGL2 seed 1. Cut: 0
  doubled cells after one frame. A second hold took no agent from the first colony.
- A hold fills the free cells of the brush once, then only as agents walk off. With the default brush on the Maze, a
  1 s hold now places 136 to 158 agents on WebGPU (seeds 1 to 3). On WebGL2 it places 146 to 151. A 10 s hold places
  204 to 296 on WebGPU and 193 to 201 on WebGL2. The WebGL2 values are seed 1 in the harness and one run in the app.
  Before, 1 s placed 811 to 856 and 10 s placed 6,704 to 7,190, nearly all stacked.
- The Maze is not solved from an inoculation: too few agents reach the far food. That needs growth. Since 2026-11-11
  growth and a capacity exist (ADR 0025): a Capacity above Agents per cell keeps dead agents in a full scene, so the
  tool places agents there too, and growth from an inoculation reaches the far food of the Maze on wide screens. The
  numbers and the case of the square screen are in ADR 0025.
- Without the rule, the amount per second of holding does not depend on the frame rate or the speed. While every
  agent of the strain is dead, it is about 30 times the brush area times the density (at least 0.25). With the rule
  it is at most that, and it goes up with the steps per second, as agents leave cells free. The speed sets the steps
  per second at any frame rate. With the same steps per second, 60 and 120 frames per second give the same agents,
  bit for bit (`engine.gpu.test.ts`).
- While paused, holding a tool runs 60 steps per second, also on a 120 Hz display (before: one step per frame).
  Inoculate runs none while every agent of its strain lives.
- In a scene where every agent lives, inoculate does nothing and shows the notice.
- The start layout `empty` reads "Empty (inoculate)": it applies to the box and the periodic grid too.
- On 512 × 246 cells, WebGL2 now matches WebGPU without the rule. The run has default settings, grid 512, seed 7
  and 300 steps. No agent is outside the grid, 29,820 agents cross the top seam, and at most 1,387 agents share a
  cell. Before, WebGL2 had 1,505 crossings on `main`. With the rule, WebGL2 now has 3,478 crossings, against 0
  before. WebGPU has 3,769: its claim keys differ from those of WebGL2 (ADR 0008).
- Integer `%` costs no measurable time. The table gives the milliseconds per step on WebGL2 (M3 Pro) in three
  interleaved rounds, each the median of 5 × 100 steps. Other users shared the machine, so the rounds differ by up
  to 50 %. A check that skips `%` for an axis already in range gave no steady gain, so `%` alone stays.

  | Scene             | Float division   | Integer `%`      |
  | ----------------- | ---------------- | ---------------- |
  | Dunes             | 24.3, 31.3, 32.7 | 24.3, 34.9, 32.5 |
  | Cyclones          | 41.9, 63.2, 54.9 | 42.5, 58.8, 54.8 |
  | Transport network | 2.8, 3.8, 3.6    | 2.7, 3.5, 3.5    |

- The presets against `main` (2026-11-11, every preset, seed 7, 500 steps, both backends, M3 Pro):
  - The 10 presets with the rule give the bits of `main` on both backends, and so does Three strains on WebGL2.
  - Cyclones, Dot grid and Dunes (1024 × 640) differ on both backends. Two strains (1536 × 960) differs on both
    backends, Three strains (1536 × 960) on WebGPU.
  - Reason, from two versions of `wrapPos()` with every other change of this ADR. With the old formula, all five
    give the bits of `main` again: the integer wraps of WebGL2 change no preset, and only `wrapPos()` does.
  - With integer periods but the old clamp at the side, the three on 1024 × 640 still give the bits of `main`. So
    there they differ because a move that rounded into the next cell now stays in its cell (item 5).
  - On 1536 × 960 the integer periods alone change the result: the float division picked the wrong period there
    (item 7). There this version also differs from the first one (`landed()`), which put such an agent up to a cell
    away.
  - WebGL2 and WebGPU now give the same bits for Dot grid, Dunes and Two strains. On `main`, Dot grid and Dunes
    differed between them. WebGPU counted a move that rounded into the next cell in its claimed cell, and WebGL2 in
    the cell of its position. Cyclones and Three strains run other agent counts on the two backends. The presets
    with the rule differ between the backends as before: their claim keys differ (ADR 0008).
- Tests on both backends:
  - A 300-frame hold under the rule keeps one agent per cell after every step and gives the same agents and trail in
    two runs. Living agents outside the brush stay where they are. Cut keeps one agent per cell.
  - Moves across the seams land exactly in the cell of their floor, on sides of 33, 47, 246 and 480 cells, also in a
    box. Diffusion, the clearance of walls and the view are periodic on 47 × 246 and 264 × 32 cells.
  - The alive count holds the new agents after a reset. 60 and 120 frames per second give the same agents, running and
    paused.
  - In Node: a paused hold of an idle tool runs no step (`engine.test.ts`). Only a count of the current run counts
    (`state.test.ts`).
  - In the app (e2e): a paused hold runs no step while every agent lives. A press right after a restart into the
    layout Empty places agents, running and paused, and no notice comes.
  - Each test failed with a mutation of the code it checks. SwiftShader cannot show the faults of items 6 and 7, so
    CI cannot catch them again: only a GPU with an inexact division can.
