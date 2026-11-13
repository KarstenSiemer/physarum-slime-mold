# 0034: The picture of the tubes

- Status: accepted. The owner asked for it on 2026-11-13. Every decision here is the coordinator's
  choice under the owner's delegation of 2026-11-12, with its date and reason.
- Date: 2026-11-13
- In short: while the flow in the tubes is on, the view draws every tube as wide and as bright as
  its flow memory says. A tube that carries much flow is thick, a tube with little flow is thin and
  faint. The rule changes the picture only. No pass of the simulation reads the picture.

## Context

The owner, on 2026-11-13: on the Tokyo scene tubes vanish, but no tube looks thicker than another.
He asked whether the picture can show the thickening.

What stood in the way:

- **The picture shows the trail.** A tube of Jones' agents has about the same width everywhere: the
  width of the band of trail that its agents leave. The flow in the tubes (ADR 0029) keeps a flow
  memory for each cell, the conductivity of a tube in the model of Tero, Kobayashi and Nakagaki. No
  view drew it.
- **The levels hide what is left.** The view sets its white level at the trail that 1 % of the
  cells exceed (`exposure.ts`). In a network most cells of a tube are near that level, so every
  tube is near the full brightness.
- **The flow memory has the information.** It goes from 0.0001 to 1. On the cells with a tube of
  the Tokyo scene its median is 0.035 at step 2,000 and 0.0055 at step 24,000, and one cell in a
  hundred has more than 0.34 to 0.47. In the Maze at step 4,000 the median is 0.125, and one cell
  in ten has more than 0.77: the route (`research/flow/view/tubes.ts` prints these numbers for a
  saved state; the log is `states.jsonl`).

## Decision

1. **The view draws the picture of the tubes while the flow is on** (2026-11-13). A switch below
   the flow strength turns it off: "Draw the tubes by their flow" (`showTubes`). It is on for a new
   scene and for a link from before this record. It is a setting of the view, as the scent view: a
   new scene keeps it, the card of a scene does not count it as a change, and it needs no restart.
   Reason for "on": the owner turned the flow on and saw no tube get thicker. A switch that is off
   would leave that as it is. The flow itself is off by default, so no scene without the flow
   changes.

2. **The rule**, per strain (`src/engine/tubes.ts` has the numbers):

   ```text
   strength of a cell      S = body · flow memory     on a cell with a tube (body ≥ 0.05), else 0
   strength across a tube  σ = min(1, sum of S over the 3 × 3 cells around the cell / 3)
   factor                  ρ = σ^(1/4)
   radius of the disc      r = 3.5 · ρ   cells, with an edge 1 cell wide
   weight at a cell        w = ρ · cover,   cover = clamp(r + 0.5 − distance, 0, 1)
   tube at a cell          the largest w of the discs that reach it,
                           times the mean of the trails of their cells by w
   picture at a cell       max(tube, 0.25 · its own trail)
   ```

   - **The fourth root.** For the flow of a liquid in a round tube the conductivity grows with the
     fourth power of the radius (Poiseuille's law, textbook physics). The flow memory is the
     conductivity of Tero's model, whose flux follows that law (knowledge base,
     `flow-in-the-tubes.md`). So the radius of a tube grows with the fourth root of its
     conductivity. The brightness has the same factor: a tube twice as thick holds twice as much
     plasmodium below a point of the picture.
   - **The sum over 3 × 3 cells, over 3.** Three cells of a tube lie in the 3 × 3 cells around a
     cell of it, so for a tube up to 3 cells wide the sum over 3 is the sum of the strengths across
     it. It is also smooth along the tube.
   - **3.5 cells.** With half the edge a disc reaches 4 cells. That is the range in which the
     engine holds the distance of a cell to the outline of a wall (`SHAPE_RANGE`, `paint.wgsl`), so
     decision 3 needs no new data.
   - **A quarter.** The plasmodium without a tube stays in the picture, fainter than a tube.
   - **The mean by weight.** The first rule took the largest value of the discs, trail times
     weight. The trail differs from cell to cell, so a thick tube showed scales, and a dense field
     showed pebbles (pictures: "How to check this record"). With the mean of the trails a thick
     tube is smooth. One disc alone gives the same value in both rules.

3. **A disc does not pass a wall** (2026-11-13). A disc of the cell q reaches the cell p only if
   the distances of both cells to the outline of the walls are together more than the distance
   between the cells. Then no wall lies on the line between them: a point of a wall on that line
   would be at least as far from each cell as that cell is from the outline. The distances are the
   wall bytes of `shape`, which the renderer has for the outlines of the walls. A byte is never
   above the distance to the centre of the nearest wall cell (`paint.wgsl`, `floorByte()`), so the
   test never lets a disc pass a wall cell. A cell outside the arena holds no picture.

4. **Everything that the view makes from the trail, it makes from the picture** (2026-11-13): the
   levels, the bloom, the height field of the gel style and the map for a view zoomed out. One
   value is an exception. The strand of the scent view (ADR 0009) is a level of the trail of the
   model. It is measured on the trail without the tubes, in the same submission.

5. **The style that draws the agents has no picture of the tubes** (2026-11-13). It draws the
   agents, and it takes the strain of an agent that stayed from the trail of its cell.

6. **The memory counts the picture with the flow, whatever the switch says** (2026-11-13): 32 B per
   cell, for the factors of the radius and for the picture. Reason: the switch changes only the
   view, so it must not change the grid that fits the memory.

### What the picture shows, and what it does not

- The radius is the radius of the conductivity, in the model's own measure. It is not a count of
  agents, and the model has no tube with a radius (`docs/fidelity.md`, row 3).
- A tube that is new has the flow memory of fresh ground, 0.2 (ADR 0029). It is drawn at two
  thirds of the largest radius until its flow memory follows its flux, which takes 333 steps for a
  factor e. So a part of a network that moved onto fresh ground is thick for a time, and in a
  scene whose tubes carry no flux yet every tube has that width.
- In a scene with a weak flow most tubes with a flux have a flow memory below 0.2. They are drawn
  thinner than a new tube. The model does not thicken them: it lets the tubes without a flux
  starve.

### Rejected

- **Brightness alone, without a radius.** The levels and the tone curve of the glow style take
  most of the difference away: a tube at a third of the brightness of another looks about the
  same.
- **Fresh ground as the zero point**: a tube with the flow memory of fresh ground looks as the
  trail alone, with less it is fainter, with more it is wider. Without a flux the picture would be
  the trail alone, which is right. But most tubes of the scenes with growth have less than fresh
  ground, so they would differ in brightness only, and that shows little (the line above).
- **A wider window for the strength across a tube** (5 × 5 and 9 × 9 cells, also with another
  strength for the largest radius). It is smoother along a tube, but most tubes then reach the
  largest radius and the tubes differ less.
- **The flux in place of the flow memory.** The four pressure fields draw new roles every 300
  steps, 75 steps apart (ADR 0029), so the flux of a cell jumps every 75 steps. The flow memory is
  the model's own mean of it over time.
- **A switch that is off by default**, or a setting of each scene. See decision 1.

## Results

All numbers: the real engine, seed 1, on an M3 Pro.

### The pictures

`research/flow/view/tubes.ts` draws a saved state with the rule on the CPU, beside the trail alone
and the strength of the tubes. It was used to choose the rule. In the app, with the switch on and
off at the same step (seed 1):

- **Maze**, step 4,000: the route between the two foods has the largest radius, and it is smooth.
  The stubs of the dead ends are thin and faint.
- **Tokyo rail network**, step 16,000, and **Tokyo, two networks**, step 10,000: the routes with
  much flow are thick, the others thin. With two strains each network is clear, where the trail
  alone shows many faint strands of both.
- **Food ring**, step 12,000: the network between the nine foods is thick, and the strands outside
  it, which carry no flux, are thin and faint. At step 6,000 the network is moving, and parts of
  tubes on fresh ground are thick ("What the picture shows").
- **The owner's case** of ADR 0032 (three strains in a dish, one agent per cell, growth, the flow,
  two foods), step 4,000: a dense field, no network. The picture is a smooth field of the three
  colours where the trail is a field of specks.
- The paper style shows the same as the glow style. The gel style shows less: its height is at its
  top from a low trail on, so a thin tube and a thick one differ mostly in width.

### The cost

The time of a frame in ms: one step and one drawn picture on a canvas of 1,280 × 800 pixels, the
median of 21 samples of 50 frames after 3,000 steps, with the switch off and on in turns on the
same run (`research/flow/engine/picture.gpu.test.ts`):

| Scene               | Cells     | Strains | WebGPU, off | WebGPU, on | WebGL2, off | WebGL2, on |
| ------------------- | --------- | ------- | ----------- | ---------- | ----------- | ---------- |
| Maze                | 512 × 320 | 1       | 3.00        | 3.49       | 5.75        | 6.49       |
| Tokyo rail network  | 512 × 512 | 1       | 4.19        | 4.80       | 7.72        | 8.20       |
| Food ring           | 384 × 384 | 1       | 2.40        | 2.75       | 5.12        | 5.54       |
| Rival networks      | 384 × 384 | 2       | 3.57        | 4.00       | 6.38        | 7.01       |
| Tokyo, two networks | 512 × 512 | 2       | 7.26        | 7.94       | 8.67        | 9.65       |

The picture costs 0.35 to 0.68 ms for each drawn state on WebGPU and 0.42 to 0.98 ms on WebGL2.
The view draws at most one state per frame, so the cost does not grow with the steps per frame.

### The tests

- `src/engine/tubes.test.ts`: the rule on the CPU, in plain cases with numbers: the strength
  across a tube, the radius and the edge of a disc, the mean by weight, the plasmodium without a
  tube, the edges of the three arenas, a wall of two rows and of one row.
- `src/engine/tubes.gpu.test.ts`, on both backends: the two passes against the CPU reference
  (`tubes-reference.ts`) on a box, on the periodic grid and in a dish, with walls and four strains,
  to 1 part in 100,000; the same plain cases; the picture after a step, a new trail, a new memory
  and a new wall; the picture of a step that moves first; the trail alone with the switch off,
  without the flow and in the agents style; the strand of the scent view.
- `src/engine/engine.test.ts`, `sizing.test.ts`, `params.test.ts`, `state.test.ts`: the switch
  neither restarts nor rebuilds a simulation, the memory counts the picture with the switch on and
  off, a link without the switch has it on, and a new scene keeps it.
- `tests/e2e/flow.spec.ts`: the switch in the built app.
- `research/flow/engine/mutate.ts` has 35 wrong rules of the picture (V1 to V35): each rule of the
  list above in each backend, and the readers of decision 4. Each one fails at least one test
  (`logs/view/mutations.txt`). The first run found one that no test caught: on WebGL2, a tube in
  the lane of a strain that the scene does not hold. A test now checks those lanes.

## Consequences

- A scene with the flow looks different from before: the picture of the tubes is on. A link from
  before this record opens with it too. No result of a simulation changes.
- The picture needs 32 B per cell more while the flow is on, and its two passes for each drawn
  state (the table above).
- Open: the gel style shows the tubes less clearly than the other styles. The owner asked for a
  better gel relief as a later step (`TODO.md`).
- Open: no view shows the flux itself, which changes with the roles of the foods (`TODO.md`).

## How to check this record

[`research/flow/README.md`](../../research/flow/README.md), part 10, has one command for each
result of this record. The logs are in `research/flow/logs.tar.gz`, in `logs/view/`.
