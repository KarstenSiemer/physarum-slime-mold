# 0062: With one agent per cell the black level stays below the plasm

- Status: accepted. Decision of an agent under the owner's delegation of 2026-11-12. Built 2026-11-19.
- Date: 2026-11-19
- Extends [ADR 0009](0009-rendering-pipeline.md), decision 2 (the auto levels). The white level, the percentiles
  and the smoothing stay.
- In short: the rule of the picture is in `docs/design.md`, section 5 (Auto levels). The tool
  `tests/pictures/levels.spec.ts` makes the pictures and the numbers of this record again.

## Context

The owner wrote on 2026-11-19 (translated from German): as soon as the tubes cover a certain share of the work
surface, the tubes tear, free spaces arise in the tubes, and the agents look jittery. With a wall that keeps the
tubes on a part of the surface, the picture is right. The owner sent a link: the scene Three strains in a dish with
one agent per cell, growth and the flow.

What the code does (`src/engine/exposure.ts`):

- The picture draws the summed trail above a black level. ADR 0009 put the black level at the 65th percentile of the
  trail over all cells of the grid. Its reason: the holes of Jones' networks hold trail too, and with a black level
  of 0 they looked washed out.
- The 65th percentile takes 65 % of the grid for background. While trail lies on less than 35 % of the cells, the
  black level is 0. Above that share it rises into the trail of the plasm, and the picture draws the weaker part of
  the plasm black. So the picture tears at a share of cover, and a wall that keeps the cover below it "repairs" it.

Measured in the owner's link on a grid of 768 × 576 cells, at step 741:

- Trail lay on 52.6 % of the cells. The black level was 0.42, and the 99th percentile of the trail 0.67.
- The picture drew 36 % of the cells with trail black. What stayed were the peaks of the trail, which are single
  agents: they change in every step, so the picture looked restless.
- The same state with a black level of 0 is one whole sheet. The model was right, and the picture was wrong.

The same fault in scenes of papers:

- Shrinking plasmodium (Jones 2010, Fig. 21) starts as a solid sheet. At step 150 the app drew a torn sheet.
- Turing spots (Jones 2010, Fig. 16, top row). The caption says that the dark flecks are the agents: they fill the
  lattice around round holes. The app drew fragments of rings.
- Turing stripes and Wound healing: the app drew thin, broken stripes and fragments.

The numbers of the tool, WebGPU, seed 1. "Cut" is the share of the cells with an agent that the picture draws black.
Levels are in parts of the white level.

| Scene                   | Step | Cells with an agent | Black before | Cut before | Black now | Cut now |
| ----------------------- | ---- | ------------------- | ------------ | ---------- | --------- | ------- |
| Three strains, the link | 900  | 0.198               | 0.707        | 0.190      | 0.422     | 0.006   |
| Shrinking plasmodium    | 150  | 0.482               | 0.707        | 0.485      | 0.347     | 0.012   |
| Turing spots            | 3000 | 0.200               | 0.707        | 0.301      | 0.402     | 0.061   |
| Turing stripes          | 3000 | 0.200               | 0.707        | 0.360      | 0.366     | 0.029   |
| Wound healing           | 2000 | 0.100               | 0.500        | 0.340      | 0.296     | 0.074   |
| Rival networks          | 3000 | 0.121               | 0.354        | 0.036      | 0.350     | 0.035   |
| Voronoi diagram         | 300  | 0.159               | 0.250        | 0.014      | 0.250     | 0.014   |
| Transport network       | 2000 | 0.150               | 0.125        | 0.000      | 0.125     | 0.000   |
| Coarsening network      | 300  | 0.123               | 0.177        | 0.000      | 0.177     | 0.000   |
| Maze                    | 500  | 0.103               | 0.250        | 0.003      | 0.250     | 0.003   |
| Corn maze               | 6000 | 0.073               | 0.022        | 0.000      | 0.022     | 0.000   |

## Options

1. **A black level of 0 with one agent per cell.** A sheet stays whole. But every tube gets a wide soft skirt: the
   trail falls by 0.57 per cell beside a tube (the 3 × 3 mean with a decay of 0.1), so 4 cells away it still holds a
   tenth. The networks of Jones look washed out again, which ADR 0009 solved.
2. **A lower percentile.** Each percentile fails above its own share of cover.
3. **A limit from the model: the black level is at most half of the median trail of the cells that hold an agent.**
   With one agent per cell the agents are the plasm, and the model knows their cells. Below the limit the 65th
   percentile stays, so a network keeps its picture.
4. **Draw where the agents are, not the trail.** A new field on both backends, with memory for every cell, and a new
   look of every scene.

## Decision

Option 3, with these parts:

1. With one agent per cell, the black level is the smallest of three levels: the 65th percentile of all cells, 0.8
   of the white level (both as before), and `PLASM_EDGE` = 0.5 times the median of the trail of the cells that hold
   an agent. The trail is the one that the frame draws, so with the picture of the tubes it is the trail of that
   picture.
2. Why the half. The mean of the diffusion is symmetric. Take a wide band of plasm with a straight edge. Its trail
   and the trail of a band on the other side of that edge add up to the trail of a full sheet, and the two are
   mirror images. So at the edge the trail is half of the trail deep inside. A black level above that half cuts into
   the plasm. A black level below it cuts only the trail beside the plasm.
3. Why the median. Half of the agents hold more trail and half hold less, whatever the scene. A child of the growth
   rule and a scout far from a tube hold little trail, and they do not move the median. In the 11 cases of the table
   the median is 0.59 to 0.85 of the white level.
4. Without the rule the levels stay as they were. Agents share cells there, and in the dense scenes every cell
   holds agents: the 65th percentile is the look of those scenes.
5. Both backends measure the same. WebGPU counts a third histogram, over the cells that hold an agent
   (`histogram.wgsl`, `held`). WebGL2 reads for each of its samples whether the cell holds an agent
   (`sample.frag`). A cell with an agent and without trail counts in the lowest bin. `levels()` in `exposure.ts`
   reads the median within its bin, as it reads the strand.

## Results

- The owner's link: the picture is one sheet of the three strains, with thin gaps where two strains meet. The gaps
  are in the model: the strains flee each other's trail.
- Shrinking plasmodium starts as a solid sheet, as in Fig. 21. Turing spots is a sheet with round holes, as in
  Fig. 16. Turing stripes has whole stripes.
- The scenes whose 65th percentile lies below the limit keep their levels: Transport network, Coarsening network,
  Maze, Corn maze and Voronoi diagram in the table, to three digits.
- WebGL2 gives the same levels as WebGPU in the same cases: 0.42, 0.35, 0.41, 0.36 and 0.30 of the white level for
  the first five rows (its runs differ from those of WebGPU, as its random numbers do).

Tests: `src/engine/exposure.test.ts` (the rule on the CPU) and `src/engine/levels.gpu.test.ts` (a sheet, a network,
agents without trail and a scene without the rule, on both backends). The wrong rules `BL1` to `BL11` of
`research/flow/engine/mutate.ts` each fail at least one of them. The frames, a PNG and a test now ask one function of
the WebGPU backend for what they measure, so six wrong rules of the picture of the tubes got new lines (`V51` to
`V54`, `V57` and `V58`); each still fails a test. [`research/flow/README.md`](../../research/flow/README.md), part 23,
has the commands and the records.

## Consequences

- The pictures of Turing spots, Turing stripes, Wound healing and of the first steps of Shrinking plasmodium change.
  No run changes: the levels are display only.
- A measurement of the levels costs one more histogram pass on WebGPU, of the size of the two before it, and one more
  read of a texel per sample on WebGL2. The time is not measured.
- The limit follows the trail, not the agents. In a scene whose trail decays fast (a decay of 0.6 in the owner's
  link), the trail between two agents is low, and the sheet still shows each agent as a bump. That is the trail of
  those settings, and no level changes it.
- The edge of a sheet lies at the black level, so it is a little ragged, as the edge of every tube is.
