# 0008: Optional one-agent-per-cell collision rule

- Status: accepted
- Date: 2026-11-08

## Context

Jones allows one agent per cell; a blocked agent does not deposit and turns to a random
heading (Fig. 3). This rule creates the high-density sheets, vacancy islands, spots and
stripes (Fig. 9, 11, 12). Jenson and Fogleman drop it and get thinner, sharper filaments.
Jones runs agents in random sequential order; a GPU runs them in parallel.

## Options

1. No collisions — simple, but loses half of the paper's results.
2. Compare-exchange on an occupancy grid in one pass — the winner depends on thread timing,
   so results are not reproducible.
3. **Two passes with claims**: pass A computes headings and targets and calls
   `atomicMax(claims[target], key)` with a unique per-step key (a bijective hash of the agent
   id, ADR 0005, so priorities are random but never tie; WebGL2 uses `MAX` blending). The two backends use
   different hash functions for the key, so their winners differ ([model.md](../model.md), section 12). A target
   is free only if it was empty at the start of the step. Pass B moves the winners, deposits,
   and writes the next occupancy with `atomicAdd`.

## Decision

Option 3, as a switch ("One agent per cell (Jones 2010)"), off by default. This is the
priority-claim method of Yang, Andelfinger, Cai & Knoll (SIGSIM-PADS '18,
doi 10.1145/3200921.3200940); no public GPU Physarum implements the rule
([gpu-techniques](../knowledge-base/gpu-techniques-and-extensions.md#one-agent-per-cell-on-the-gpu)). In both modes a
blocked move (wall, closed boundary, occupied cell) means: no deposit, random new heading.

## Consequences

- Deterministic, testable (max occupancy ≤ 1 is a test).
- Synchronous rule: a cell vacated in this step is not free until the next step. Documented
  difference to Jones' sequential order.
- Agent density in collision mode is capped at 1 per cell (the paper's `%p` ≤ 100).
- In collision mode every alive agent starts on a cell of its own, in every layout and arena
  (since 2026-11-10, ADR 0019). Claim rounds follow the init pass: every agent not placed yet
  claims its cell with a key unique per round (`atomicMax`, on WebGL2 `MAX` blending), the highest
  key takes the cell, and the others draw again in their layout's region. An agent with no free
  cell after 32 rounds (64 since ADR 0027, decision 8) starts dead. The mixed layout's first draw is a bijective cell permutation,
  so without walls and dish one round places everyone. Before, only the mixed layout started on
  distinct cells: other layouts drew random positions, an agent in a wall or outside the dish
  moved to a random spot without a check, and rounding pushed an agent into the next cell.
  Shrinking plasmodium then started with 19,563 shared cells on 512 × 288 (seed 7); now every
  scene with the rule starts with none, on both backends.
- A move across the wrap seam keeps the agent in the cell it claimed: wrapped in f32, a position a
  hair below 0 rounded up to x = W, into cell 0, while WebGPU counted the agent in cell W − 1, and a
  second agent could enter cell 0 (fixed on 2026-11-10, ADR 0019). A position a hair below −1 rounded
  up the same way, from cell W − 2 into cell W − 1. Since 2026-11-11 every move lands in the cell it
  claimed. `wrapPos()` in `common.wgsl` and `common.glsl` takes the whole periods from integers. It
  keeps the result below the upper edge of its cell (ADR 0023).
- On WebGL2 the rule also failed at the seams of some grid sides, also on `main` before 2026-11-11.
  The shaders wrapped cells with a float division, which is not exact on every GPU. On an Apple M3
  Pro, row H of a grid 246 cells high was outside the grid. So no agent crossed the top seam under
  the rule. Since 2026-11-11 the wrap uses integers (ADR 0023).
- Since 2026-11-11 the rule also holds for the agent tools (ADR 0023). An agent that inoculate places
  or cut moves claims a cell that was empty at the start of the step, with the claim key of a move,
  and only the winner goes there. A loser stays dead or stays where it was. Before, both tools checked
  only for walls: on the Maze a 1 s inoculation put 811 to 852 agents in 234 to 244 cells, up to 18 in
  one cell, and 60 to 73 % were still stacked at step 2,000 (an agent may always move inside its own
  cell). One frame of cut left 9 cells with two agents.
- Since 2026-11-11 the rule also holds for growth (ADR 0025). A parent claims an empty cell of its 3 × 3
  neighbourhood with the key of a move, and only the winner of each cell gets a child there. A cell is empty after
  the moves of the step, so a child never shares a cell. The window counts of growth and shrinkage assume the rule:
  without it growth is off.
- Jones' attraction networks need the rule. Without it, agents pile up and the Fig. 4 network
  contracts into a few straight lines that wrap around the edges, usually within 2,000 to
  8,000 steps (measured on 2026-11-09 on WebGPU and WebGL2 and in two CPU ports). Jones ties
  new branches to the random turns of blocked agents (p. 135). The switch has a help text, and
  switching it off in a scene made for the rule shows a notice.
- Switching the rule restarts the population (`RESET_KEYS` in `engine.ts`, since 2026-11-09).
  Agents that piled up without the rule would stay stacked for thousands of steps. After the
  restart every agent starts on a cell of its own.
- A backend without the rule (WebGL2 without `EXT_float_blend`, ADR 0003) runs every scene
  without it. The switch then shows off and disabled, also after a preset load, and a notice says
  so once per page load when a scene made for the rule loads.

## Amendment 2026-11-11: the synchronous rule stays (ADR 0027)

The fidelity check of 2026-11-11 compared every scene of Jones with its figure. Jones' random sequential order of the
agents (p. 133) against these synchronous claims is a real difference, but after Jones' order of a step, his dish, the
absorbing edges and the figures' foods (ADR 0027) no figure needs it: Turing spots form their regular array, Shrinking
plasmodium does not tear, and Steiner tree ends as a tree in every run. It stays the documented difference of this
ADR. The claims now run in the order of each scene's paper (ADR 0027, 2026-11-12): moving first, a step senses for
the moves of the step before, then claims and moves; sensing first, it senses on the map after the last diffusion,
then claims and moves.
