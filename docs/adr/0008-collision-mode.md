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
- Initial layouts in collision mode place agents on unique cells (bijective cell
  permutation).
- Jones' attraction networks need the rule. Without it, agents pile up and the Fig. 4 network
  contracts into a few straight lines that wrap around the edges, usually within 2,000 to
  8,000 steps (measured on 2026-11-09 on WebGPU and WebGL2 and in two CPU ports). Jones ties
  new branches to the random turns of blocked agents (p. 135). The switch has a help text, and
  switching it off in a scene made for the rule shows a notice.
- Switching the rule restarts the population (`RESET_KEYS` in `engine.ts`, since 2026-11-09).
  Agents that piled up without the rule would stay stacked for thousands of steps, so the rule
  would not hold for every cell.
- A backend without the rule (WebGL2 without `EXT_float_blend`, ADR 0003) runs every scene
  without it. The switch then shows off and disabled, also after a preset load, and a notice says
  so once per page load when a scene made for the rule loads.
