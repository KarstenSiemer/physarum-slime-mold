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
   index, so priorities are random but never tie; WebGL2 uses `MAX` blending). A target is
   free only if it was empty at the start of the step. Pass B moves the winners, deposits, and
   writes the next occupancy with `atomicAdd`.

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
- In collision mode the mixed layout places agents on distinct cells with a bijective cell
  permutation (`init.wgsl`). Some cells still start with several agents: the other layouts draw
  random positions, an agent that starts in a wall or outside the dish moves to a random spot
  without a check, and rounding can push an agent into the next cell. Measured on WebGPU on
  2026-11-10 (seed 7): Shrinking plasmodium on 512 × 320 starts with 20,204 shared cells (up to
  7 agents) and has none left by step 2,000 (on a 236 × 512 phone grid by step 3,000); the
  Transport network starts with 14,516 in pie slices, gone by step 500, and with 4 in the mixed
  layout, gone after one step. The rule keeps agents out of occupied cells, so the stacks only
  dissolve as their agents move on. Placing every agent on a free cell is still open (TODO.md).
- Jones' attraction networks need the rule. Without it, agents pile up and the Fig. 4 network
  contracts into a few straight lines that wrap around the edges, usually within 2,000 to
  8,000 steps (measured on 2026-11-09 on WebGPU and WebGL2 and in two CPU ports). Jones ties
  new branches to the random turns of blocked agents (p. 135). The switch has a help text, and
  switching it off in a scene made for the rule shows a notice.
- Switching the rule restarts the population (`RESET_KEYS` in `engine.ts`, since 2026-11-09).
  Agents that piled up without the rule would stay stacked for thousands of steps. After the
  restart the new start decides when every cell holds at most one agent, as the point on start
  layouts above describes.
- A backend without the rule (WebGL2 without `EXT_float_blend`, ADR 0003) runs every scene
  without it. The switch then shows off and disabled, also after a preset load, and a notice says
  so once per page load when a scene made for the rule loads.
