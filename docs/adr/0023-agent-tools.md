# 0023: Agent tools: dead agents only, free cells, an amount per second

- Status: accepted
- Date: 2026-11-11

## Context

Two tools act on agents while the pointer is held: inoculate places agents of the selected strain in the brush, and
cut moves the agents in a wound away (Jones 2010, Sec. 4.3). A simulation has a fixed set of agents: a buffer with an
id for each agent for good (ADR 0005). Nothing creates agents. Growth (Jones 2011) is a later step (TODO.md, "Later").
So the inoculate tool can only bring back dead agents: agents that shrinkage killed, the agents of the start layout
Empty, and agents that found no free start cell (ADR 0008).

Measured on `main` (d245ea3) on WebGPU and WebGL2, on the Maze (512 × 320 cells, 19,661 agents, start layout Empty,
one agent per cell) with the default brush (6.1 cells) at the bottom-right food:

1. Inoculate broke the one-agent-per-cell rule. A revived or moved agent went to a random point of the brush, and
   only walls were checked (`agents.wgsl:162–171`, `agents.frag:152–160` on `main`). With the rule an agent may always
   move inside its own cell (`agents.wgsl:267–268`), so the stacks stayed. After a 1 s hold, 811 to 852 agents sat in
   234 to 244 cells, 84 to 87 % of them stacked, up to 18 in one cell. At step 2,000, 60 to 73 % were still stacked;
   at step 10,000, 6 to 49 %. Stacked agents jam and deposit almost nothing.
2. Cut re-seeded the agents of a wound the same way: 9 cells held two agents after one frame (Transport network,
   radius 12.2 cells).
3. Inoculate also moved living agents of its strain from anywhere into the brush. `App.svelte:286` passed `teleport`
   equal to `revive`, and `agents.wgsl:164` applied it to every living agent of the strain. A second 1 s hold at the
   other food took 29 to 37 living agents (4.1 to 5.3 %) from the first colony. The owner saw "both sides split and
   behave oddly". `git log -S teleport` shows that the first commit (bc7d90c) added `teleport`; 8788c4f only uses it in
   tests. No commit message, ADR or design text gives a reason. The code gives a likely one: with a fixed set of
   agents, a tool that takes only dead agents does nothing in a scene where every agent lives. Moving living agents
   made the tool show an effect in every scene.
4. The amount depended on the frame rate. The tool acted once per animation frame, with the chance of one frame at
   60 Hz (`App.svelte:279–282`, `sim.ts:260–269` on `main`). A 120 Hz display placed twice as many agents per second.
   While paused, each frame ran one step with the tool, so a 120 Hz display also ran twice the steps.
5. Found while testing: a move that ended just below an integer across the wrap seam landed in the next cell. On a
   grid 512 cells wide, x = −1.000001 lies in cell 510. The move counted there, and `wrapPos()` gave 511.0, in
   cell 511. A second agent could then claim cell 511 too.

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
2. A chance per step, with the time of each step: a dead agent stays dead over t seconds with the chance e^(−rate·t),
   however frames and steps cut t up.

## Decision

- Inoculate takes only dead agents of its strain (`placement()` in `agents.wgsl` and `gl/glsl/tools.glsl`). With
  none left it places nothing, and the app shows once per press: "All agents of strain A are alive. Inoculate places
  only dead agents. Agents die with Shrinkage, and the start layout Empty starts with no agents." (`App.svelte`
  `noDeadAgents()`, from the alive count of the stats, at most 500 ms old). Reason: the drain is a defect for the
  owner, the history shows no wish for it, and creating agents is a later step. Option 3.
- With the rule, a placed or moved agent claims its cell like a move, and only the winner goes there. The cell must
  be habitable and empty at the start of the step (`openCell()`). A loser stays dead (inoculate) or stays where it was
  (cut). Cut tries up to 8 random points outside the wound for such a cell. WebGPU claims in `claim` and places in
  `settle`. WebGL2 marks the agent with `PLACE` in mode 1, the claim points (`points.vert` kind 1) and mode 2 find
  the same spot again. `placement()` reads only the agent after shrinkage, the parameters, `env` and the occupancy, so
  every pass finds the same spot. Shrinkage now comes first in a step.
- A placed or moved agent spends its step on that: it does not move and deposits nothing in that step, with and
  without the rule.
- A tool acts on every step of a frame (`Sim.run`). The engine gets a rate (`inoculateRate()` in `pack.ts`: per
  second, what 60 frames placed before) and gives each step the chance of its share of the frame's time
  (`stepChance()`, `Engine.frame`). A frame without a step passes its time on. While paused, a held tool runs 60 steps
  per second at any frame rate (`PAUSED_TOOL_STEPS`).
- Moves and placements land in the cell they claimed and counted (`landed()` in `common.wgsl` and `common.glsl`). It
  gives the bits of `wrapPos()` wherever that stays in the cell.

## Consequences

- Max occupancy ≤ 1 holds for the tools too (ADR 0008). On the same Maze runs (seeds 1 to 3, WebGPU; seed 1 on
  WebGL2): no cell held two agents during or after a 1 s or 10 s hold, with shrinkage 0.0001 and 0. Cut: 0 doubled
  cells after one frame. A second hold took no agent from the first colony.
- A hold fills the free cells of the brush once, then only as agents walk off. With the default brush a 1 s hold now
  places 136 to 158 agents, a 10 s hold 204 to 296 (before: 811 to 856 and 6,704 to 7,190, nearly all stacked). The
  Maze is not solved from an inoculation: too few agents reach the far food. That needs growth.
- Without the rule the amount per second of holding does not depend on the frame rate or the speed: about 30 times
  the brush area times the density (at least 0.25) while every agent of the strain is dead. With the rule it is at
  most that, and it goes up with the steps per second, as agents leave cells free. The speed sets the steps per
  second at any frame rate. With the same steps per second, 60 and 120 frames per second give the same agents, bit
  for bit (`engine.gpu.test.ts`).
- While paused, holding a tool runs 60 steps per second, also on a 120 Hz display (before: one step per frame).
- In a scene where every agent lives, inoculate does nothing and shows the notice.
- The start layout `empty` reads "Empty (inoculate)": it applies to the box and the periodic grid too.
- Tests on both backends: a 300-frame hold under the rule keeps one agent per cell after every step and gives the same
  agents and trail in two runs; living agents outside the brush stay where they are; cut keeps one agent per cell;
  the seam move lands in its cell; 60 and 120 frames per second give the same agents, running and paused. Each test
  failed with a mutation of the code it checks.
