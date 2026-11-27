# 0047: An Electrode tool with two poles, and the scene Electrotaxis

- Status: accepted (decision of a helper, 2026-11-15, under the owner's delegation of 2026-11-12; the owner asked for
  "current as another tool, like light and food" on 2026-11-15), built 2026-11-15
- Date: 2026-11-15
- Extends ADR 0021 (the drawing of a link: version 4), ADR 0022 (the Jones and the extended model), ADR 0037 (links to
  the figures of the papers), ADR 0044 (a repellent source in the Jones model) and ADR 0046 (the mean window).
- Extended by [ADR 0058](0058-the-outlines-and-the-surface-of-the-electrodes.md) (2026-11-17): decision 8, the view
  of a pole, changes. The outline of a pole comes from the distances of its strokes, in a buffer of 4 B per cell, and
  a pole is a lit stud that covers all of what lies below it. So "It costs no memory" holds for the simulation only.

## Context

S. Tsuda, J. Jones, A. Adamatzky and J. Mills, "Routing Physarum with electrical flow/current",
[arXiv:1204.1752](https://arxiv.org/abs/1204.1752) (2011). I read the owner's copy on 2026-11-15; the pages are those
of the PDF.

- **The organism** (p. 4, as [jones-later-papers.md](../knowledge-base/jones-later-papers.md) holds it): 13 of 16
  pieces had grown more toward the cathode than toward the anode after six hours, and no piece changed its direction.
- **The model** (p. 8 to 11): Jones' agents in one diffusing lattice. Every cell becomes (1 − d) · u, with u the mean
  of the 15 × 15 cells around it and d a damping; the paper gives no value of d. The field starts at zero. A current
  source projects −255 into the field at every step and a current sink +255. The field is diffused for 400 steps
  before the agents start. An agent deposits 5 units after a move; SA 22.5°, RA 45°, SO 5; the population is fixed.
  1,500 agents start in a vertical line just left of the current sources, and move as one body to the sinks (Fig. 11:
  five sinks in a column on the left, five sources on the right; pictures at 235 to 450 steps). The agents are in the
  oscillatory mode: a blocked agent keeps its heading (p. 8). The paper gives no lattice and no positions.

What the app had: the Jones model reads drawn light as a source below 0 of Jones' one map (ADR 0044), with a strength
of at most 0.5 (−127.5). Food is the source above 0, at most 0.5 too, and 0.01 to 0.05 in the scenes. The mean window
of 15 × 15 cells exists (ADR 0046).

## The three questions, with what the code says

**1. Can the poles reuse the food byte and the light byte?** No. In the Jones model the mathematics would fit: food is
a source above 0 and light one below 0. But the food byte means more than a source:

- a cell with a food byte is a site of the flow in the extended model (`flow.wgsl:238` and `:323`, `flow.frag:185` and
  `:306`), and a food stroke is a food site (`sites.ts:24` and `:38`): a cathode would give and take the flux;
- covered food reduces what a food cell releases under an agent (`sources()` in `diffuse.wgsl` and `diffuse.frag`);
- the start layout Food places a colony on the first food stroke (`Engine.seedAtFood()`);
- the view draws it as an oat flake, and light as light: a user could not tell an electrode from them;
- food and light have one strength each for the whole scene, so an electrode at ±255 beside a food at 0.05 · 255
  could not exist.

So the poles have a channel of their own. **It costs no memory.** A cell of the environment has four bytes, and the
fourth was unused on both backends (`Sim.readEnv()`: "wall, food, light, unused"; an erase and a wall wrote 0 into it
already). `BYTES_PER_CELL` (98) and `BYTES_PER_CELL_HALF_FLOAT` (118) of `src/engine/sizing.ts` stay. The renderer
reads the byte from the environment itself (a buffer on WebGPU, a texture on WebGL2, both there already): the outline
bytes that it has for walls, food and light are all taken.

**2. The strength.** Tsuda's ±255 is a strength of 1, twice the top of the ranges of food and light. The tool has a
setting of its own, Electrode strength (`electrodeStrength`), from 0 to 1, with the default 1. Both poles share it,
as in the paper.

**3. Links.** A stroke of a link has a head byte with two bits for its kind, and the four kinds filled them
(`src/model/link.ts`). Version 4 of the drawing holds the new kinds. No rule changes for a link made before: such a
link holds no pole, and its settings mean what they meant. So the mark `rules` stays 44 (`LINK_RULES`).

## Options

1. The Electrode tool paints food and light at a strength of 1. Ruled out by question 1.
2. Two tools, Anode and Cathode. Two more buttons and keys for one thing.
3. One tool, Electrode, with a choice of the pole beside the brush, in a channel of its own. In the Jones model only.
4. The same in both models.

## Decision

Option 4. The choices are mine, under the owner's delegation.

1. **The tool.** Electrode (key 8) paints the pole that the toolbar selects: the cathode (the current sink, drawn
   blue) or the anode (the current source, drawn red). It paints like food: a hard edge, a drag, a straight line with
   Shift. The kinds of stroke are `cathode` and `anode` (`EnvKind` 5 and 4).
2. **The byte.** The fourth byte of a cell: 128 an anode, 255 a cathode, 0 none (`POLE_BYTE`). A cell holds one pole,
   the one painted last. A pole leaves the food and the light of its cell. A wall and an erase clear it, as they clear
   food and light, so the sweep of the edit list needs no new rule (ADR 0019).
3. **The rule** ([model.md](../model.md), sections 6.2, 6.4 and 6.7). In every step an open cell with a cathode
   releases 255 · Electrode strength · g into the food scent C_F, and one with an anode the same into the repellent
   C_L, in the pass and at the place where food and light release (`sources()`). g is the source factor of food and
   light: 1 in the Jones model. There J = T + C_F − C_L is Jones' one map (ADR 0044), so the poles are Tsuda's sink
   and source. A pole on a wall cell releases nothing, as food there. Covered food does not reduce a cathode.
4. **Both models.** Reason: the tools are the same in both models (ADR 0044, decision 5), and the organism, which the
   extended model stands for, does grow to the cathode. In the extended model the rule is this app's reading: the
   two fields have the scent decay and the factor g, and a strain weighs them with Food attraction and Light
   avoidance. A strain with a food weight of 0 does not follow a cathode. The help of the setting says so.
5. **No site of the flow, no food.** `flow.wgsl`, `sites.ts`, covered food and the start layout Food read the food
   byte and the food strokes only. They did not change.
6. **The setting** `electrodeStrength`, 0 to 1 in steps of 0.01, default 1. A link holds it only when it is not 1, as
   it holds the mean window only when it is not 3: a link of settings without it has the bytes of a link from before.
7. **Link version 4.** A stroke of a kind above 3 writes the value 3 in the two bits of the arena (no arena has it),
   its arena in the two bits of the kind, and its kind in the next byte. Every other stroke has the bytes of version
   3, and links of the versions 1 to 3 open as before. A link now starts with the byte 4.
8. **The view.** A pole covers where the bilinear mix of its four cells around a point passes one half, at an opacity
   of 0.9, over everything. The view reads the cells of the poles only while a pole may be painted
   (`Sim.hasElectrodes`): other scenes pay one test of a uniform per pixel.
9. **A start layout Vertical line** (`line`): a strip around the middle column, 0.75 of the grid's height, as wide as
   all agents need at 0.75 agents per cell. Reason: the paper starts its agents in a line, and no layout gave one. A
   strip at 0.75 leaves the claim rounds room: at one agent per cell the last agents would find no cell.
10. **The scene Electrotaxis** (`electrotaxis`, group Experiments, Jones model, sense first). The paper's values:
    1,500 agents, SA 22.5°, RA 45°, SO 5, deposit 5, Mean window 15, Electrode strength 1, no growth. This app's
    choices, because the paper gives none:
    - a lattice of 250 × 240 cells in a closed box: 60,000 cells hold 1,500 agents at the density 0.025;
    - the line in the middle column, five anodes 20 cells right of it and five cathodes 100 cells left of it, 31
      cells apart, each 1.5 cells in radius (`ELECTROTAXIS` in `src/model/presets.ts`);
    - **decay 0.01** for d. With it the field is within 1.4 % of its end at step 400 (the middle row of the logs: 3.167
      against 3.123 at one point, less at the others), which fits the paper's 400 steps. With 0.1, Jones' usual
      value, it has settled at step 100, and the colony moves 14 cells in 800 steps. With 0.003 it still changes by
      5 to 40 % between step 400 and 800.
    - the style Agents. Fig. 11 draws the agents, and the trail of this scene is one wide smooth hill, because the
      map spreads over 15 × 15 cells and decays slowly: in the other styles the line of agents does not show.
11. **The figure link** (ADR 0037): Fig. 11, page 11 of `https://arxiv.org/pdf/1204.1752`. arXiv gives no licence to
    show it, so the app links it.

**Not built, and what the app does instead:**

- **The 400 steps without agents.** The app has no phase before the agents start. In the scene the field and the
  agents start together. Measured below: with the settled field the colony is 16 to 18 cells farther at step 450; the
  direction is the same in every run.
- **The oscillatory motor mode.** A blocked agent of the app takes a random heading (Jones 2010). The mode is its own
  item of `TODO.md`. So the scene is the paper's model without it, and Fig. 11 is not reproduced exactly.
- **Random order.** The agents update at once (ADR 0008).

## Results

All on an M3 Pro, 2026-11-15. The story and the commands: [research/electrode/README.md](../../research/electrode/README.md).

**The scene over 10 seeds** (`research/electrode/campaign.sh`). "Way": how far the mean x of the agents went toward
the cathodes, of the 100 cells from the line to them. "Toward the cathodes": a way above 10 cells. "At a cathode":
agents within 12 cells of the middle of a cathode, of 1,500. "Largest way back": the largest step of the mean x toward
the anodes between two samples 25 steps apart.

| Run                                           | Seeds | Toward the cathodes at 450 | Way at 450, cells | Toward at 800 | Way at 800, cells | At a cathode at 800      | Largest way back |
| --------------------------------------------- | ----- | -------------------------- | ----------------- | ------------- | ----------------- | ------------------------ | ---------------- |
| the scene, WebGPU                             | 10    | 10 of 10                   | 50.2 to 52.6      | 10 of 10      | 83.8 to 85.7      | 420 to 539 (mean 478)    | 0.00             |
| the scene, WebGL2                             | 10    | 10 of 10                   | 50.1 to 53.4      | 10 of 10      | 83.6 to 86.8      | 424 to 524 (mean 480)    | 0.00             |
| the field settled for 400 steps first, WebGPU | 10    | 10 of 10                   | 66.0 to 70.9      | 10 of 10      | 88.4 to 90.5      | 640 to 752 (mean 705)    | 0.00             |
| the field settled for 400 steps first, WebGL2 | 10    | 10 of 10                   | 65.7 to 72.9      | 10 of 10      | 89.4 to 91.0      | 697 to 785 (mean 726)    | 0.00             |
| the poles swapped                             | 10    | 10 of 10                   | 17.9 to 18.1      | 10 of 10      | 18.6 to 18.9      | 1214 to 1232 (mean 1226) | 0.02             |
| Electrode strength 0                          | 10    | 0 of 10                    | -0.1 to 0.1       | 0 of 10       | -0.2 to 0.1       | 0 to 0 (mean 0)          | 0.07             |
| decay 0.1                                     | 10    | 10 of 10                   | 10.4 to 11.0      | 10 of 10      | 13.7 to 14.3      | 0 to 1 (mean 0)          | 0.00             |
| decay 0.03                                    | 10    | 10 of 10                   | 25.4 to 26.1      | 10 of 10      | 35.6 to 36.7      | 0 to 1 (mean 0)          | 0.00             |
| decay 0.003                                   | 10    | 10 of 10                   | 66.8 to 69.7      | 10 of 10      | 85.1 to 86.7      | 483 to 528 (mean 506)    | 0.00             |
| Mean window 3                                 | 10    | 0 of 10                    | -0.5 to 2.0       | 0 of 10       | 0.0 to 4.6        | 6 to 82 (mean 27)        | 0.38             |

- **The share**: the colony moves toward the cathodes in 10 of 10 runs on each backend, and never turns. The organism:
  13 of 16, none turned. The model has no run that goes the other way: its direction is fixed by the field.
- **The poles decide, not the layout**: with the poles swapped the colony goes right, to the cathodes 20 cells away,
  and 1,214 to 1,232 agents stand at them. Without the electrodes (strength 0) the mean x stays within 0.2 cells.
- **The wide window is needed**: with the 3 × 3 mean the colony stays (at most 4.6 cells).
- **The settled field**: the run copies the scent of a run without agents after 400 steps into the scene before its
  first step. The colony then starts at once and is farther at every sample.
- **Against Fig. 11**: its last picture, at 450 steps, shows the agents at the sinks. Here the mean is half way at 450
  and 84 to 87 cells of 100 at 800. The paper's lattice is not known, so the speeds do not compare.

**Tests.** `src/engine/sim.gpu.test.ts`, "the electrode tool (ADR 0047)", 27 tests on each backend: the bytes against
the CPU reference in every arena, alone and in one call; the outline bytes unchanged; both lanes of the scent against
the float64 reference for the windows 3 and 15 in every arena and both orders, with a pole on a wall; Tsuda's field
between a source and a sink; the source factor of the extended model; covered food; the agents by the weights of the
strain in both models; the line; the poles in the picture in three styles. Unit tests: the parameters, the link of
version 4, the settings of a link, the scene, the tool, the food sites.

**Wrong rules** `EL1` to `EL21` of `research/flow/engine/mutate.ts` (every pole as a cathode; the poles in the wrong
lanes; no source; the anode with the cathode's byte; a cathode that clears its cell; the line as high as the grid is
wide, and at one agent per cell; the anode in the cathode's colour; the strength of the food; no source factor; the
poles never drawn; a pole that does not mark the scent as fed; in WGSL and in GLSL where the rule is in both): each
fails tests, 3 to 38 of them.

**Every other scene keeps its bytes.** The digests of the default settings and of the 22 scenes of `main` after 500
steps (`research/flow/engine/digest.gpu.test.ts`) on both backends: 46 of 46 runs equal to those of `main` at
`6d8d23a`, made on the same machine in the same hour. The source of a pole is a branch of its own in `sources()`, so
the sum for a cell without a pole is the code of before.

**Checks**: `npm run lint`, `npm run check`, `npm test`, `npm run test:gpu`, `npm run build` and the e2e tests pass on
the code of the pull request; its description has the counts.

## Consequences

- A user can paint a current in both models, and share it in a link. An older build of the app cannot open a link of
  version 4.
- `docs/fidelity.md` has a row for electrotaxis (21) with a number of the organism and one of the model.
- Open, in `TODO.md`: the settle phase, the oscillatory mode (its own item), and the run with obstacles of Fig. 12
  (two more sources; the paper's organism split there, p. 5). Not measured: the time of a frame with electrodes; the
  tool in the extended model against anything of the organism; SwiftShader beyond the tests of CI.
- The setting has one strength for both poles and for all electrodes. A strength per electrode would need the byte
  to hold it; the TODO item "a strength for each food" is the same question for food.
