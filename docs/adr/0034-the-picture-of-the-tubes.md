# 0034: The picture of the tubes

- Status: accepted. The owner asked for it on 2026-11-13. Every decision here is the coordinator's
  choice under the owner's delegation of 2026-11-12, with its date and reason.
- Date: 2026-11-13
- In short: while the flow in the tubes is on, the view draws every tube as wide and as bright as
  its flow memory says. The flow memory of a tube grows where much flow runs, and it falls where
  little flow runs. So a tube that keeps much flow stays thick, and a tube with little flow gets
  thin and faint. The rule changes the picture only. No pass of the simulation reads the picture.

## Context

The owner, on 2026-11-13: on the Tokyo scene tubes vanish, but no tube looks thicker than another.
He asked whether the picture can show the thickening.

The flow in the tubes (ADR 0029) keeps two values for each cell and each strain. This record uses
both:

- The **tube body** says how much of a tube the cell holds, from 0 to 1. It follows the trail of
  the strain. A cell holds a tube if its tube body is 0.05 or more.
- The **flow memory** says how well the tube of the cell conducts, from 0.0001 to 1. It is the
  conductivity of a tube in the model of Tero, Kobayashi and Nakagaki. It follows the flux through
  the cell, by a factor e in 333 steps. Ground that never held a tube has 0.2: fresh ground.

What stood in the way:

- **The picture shows the trail.** A tube of Jones' agents has about the same width everywhere: the
  width of the band of trail that its agents leave. No view drew the flow memory.
- **The levels hide what is left.** The view sets its white level at the trail that 1 % of the
  cells exceed (`exposure.ts`). In a network most cells of a tube are near that level, so every
  tube is near the full brightness.
- **The flow memory has the information.** On the cells with a tube of the Tokyo scene its median
  is 0.035 at step 2,000 and 0.0055 at step 24,000, and one cell in a hundred has more than 0.34
  to 0.47. In the Maze at step 4,000 the median is 0.125, and one cell in ten has more than 0.76:
  the route (`research/flow/view/tubes.ts` prints these numbers for a saved state; the record is
  `states.jsonl`).

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
   strength of a cell      S = tube body · flow memory   on a cell with a tube, else 0;
                           a cell of a wall holds no tube
   strength across a tube  σ = min(1, sum of S over the 3 × 3 cells around the cell / 3)
                           on a cell with a tube, else 0
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
     cell of it, so on the middle line of a tube up to 3 cells wide the sum over 3 is the sum of
     the strengths across it. A cell at the edge of such a tube holds two rows of it. The sum is
     also smooth along the tube. The tubes of the scenes are wider: a band of cells with
     a tube is 7 cells wide at the median in the Tokyo scene and in the Food ring, and 10 in the
     Maze (`bandWidth` in `states.jsonl`). In such a band the sum holds 3 of its cells, so with
     a full tube body the strength is 1 from a flow memory of a third on.
   - **Only a cell with a tube is a disc** (2026-11-13, after a review). The first rule gave a
     factor to every cell, also to a cell beside a tube. The discs of those cells drew a tube wider
     than its radius says.
   - **3.5 cells.** With half the edge a disc reaches 4 cells, so a pass looks at the 7 × 7 cells
     around a cell. The number came from the first wall test (decision 3): 4 cells is the range in
     which the engine holds the distance of a cell to a wall (`SHAPE_RANGE`, `paint.wgsl`). The
     exact test does not need that. The radius stayed, because the rule was chosen with pictures
     that have it. It is the radius of the disc of one cell. A tube is drawn as wide as its band
     of cells and the discs of the cells at its two edges: at most 3 cells more on each side. A
     straight tube with a full tube body, by the width of its band:

     | Flow memory       | Factor | 1 cell wide | 3 cells wide | 7 cells wide |
     | ----------------- | ------ | ----------- | ------------ | ------------ |
     | 0.0025            | 0.29   | 1           | 3            | 7            |
     | 0.04              | 0.59   | 3           | 5            | 9            |
     | 0.64              | 1      | 7           | 9            | 13           |
     | 0.2, fresh ground | 0.88   | 5           | 7            | 11           |

     The widths are the cells across the tube that the picture draws at half of its middle or
     more. The factor is that of a band 3 or more cells wide, and it is the brightness of the
     middle against the trail alone. The first three flow memories are 16 times apart: the radius
     of a disc doubles from one to the next, until the strength is 1
     (`research/flow/view/widths.ts`; the record is `widths.jsonl`).

   - **A quarter.** The plasmodium without a tube stays in the picture, fainter than a tube.
   - **The mean by weight.** The first rule took the largest value of the discs, trail times
     weight. The trail differs from cell to cell, so a thick tube showed scales, and a dense field
     showed pebbles (pictures: "How to check this record"). With the mean of the trails a thick
     tube is smooth. One disc alone gives the same value in both rules.

3. **A disc does not pass a wall** (2026-11-13; the test is exact since 2026-11-14, after a
   second review). A disc of the cell q reaches the cell p only if neither cell is a cell of a
   wall, and no cell of a wall lies on the line between the centres of the two cells. A line
   through the corner of a cell is on that cell, so no disc passes between two wall cells that
   touch at a corner. That is the rule of a move of the model, which takes no line that touches a
   wall cell (`docs/model.md`, 7.5). The disc of a cell that is no wall always reaches the cell
   itself. A cell outside the arena holds no picture. The passes read which cells are walls from
   `shape`, which the renderer has for the outlines of the walls.

   The strength across a tube stays behind a wall too (2026-11-14, after a third review). A cell
   of a wall holds no tube and adds nothing to the sum of decision 2. A cell at a corner of a
   cell adds nothing if the two cells beside that corner are both walls: no plasmodium goes from
   one to the other, and growth puts no child there (ADR 0025, amendment of 2026-11-13). Before,
   a weak tube along a wall of cells that touch at their corners took the strength of a strong
   tube on the other side. One wall cell beside a corner parts nothing here: a tube that runs
   along a wall keeps its own cells.

   The first wall test read no cell on the line. It used the distances of the two cells to the
   outline of the walls, which `shape` holds too: a disc passed if they were together more than
   the distance between the cells. A review found two faults in it. Where the engine makes these
   distances from the cells, after a change of boundary, a distance is that to the centre of a
   wall cell: a disc then passed a wall cell beside the middle of its line, and a wall of cells
   that touch at their corners stopped nothing. And along a wall the test stopped discs between
   two cells with no wall between them. The exact test costs no more time ("The cost"): a pass
   reads the cells on a line only for a disc that reaches the cell.

4. **Everything that the view makes from the trail, it makes from the picture** (2026-11-13): the
   levels, the bloom, the height field of the gel style and the map for a view zoomed out. One
   value is an exception. The strand of the scent view (ADR 0009) is a level of the trail of the
   model. The view measures it on the trail without the tubes, at the same time as the levels.

5. **The style that draws the agents has no picture of the tubes** (2026-11-13). It draws the
   agents, and it takes the strain of an agent that stayed from the trail of its cell.

6. **The fit of the grid to the memory of the GPU counts the picture with the flow, whatever the
   switch says** (2026-11-13): 32 B per cell, for the factors of the radius and for the picture.
   Reason: the switch changes only the view, so it must not change the size of the grid.

7. **A new tube is drawn by its flow memory, as every tube** (2026-11-13). The rule has no case
   for a tube on fresh ground, so a new tube is thick until its flow memory follows its flux
   ("What the picture shows"). Reason: the picture shows the value that the model holds. The model
   starts a tube on fresh ground with a middle conductivity, and it lets the tubes with little
   flux get thin. A rule with fresh ground as the zero point was tried and rejected (below).

### What the picture shows, and what it does not

- The radius is the radius of the conductivity, in the model's own measure. It is not a count of
  agents, and the model has no tube with a radius (`docs/fidelity.md`, row 3).
- **A new tube is thick.** A tube on fresh ground has a flow memory of 0.2. With a full tube body
  its factor is 0.67 if it is one cell wide and 0.88 from three cells on, and it is drawn 4 cells
  wider than its band (the table of decision 2). The factor is lower while the tube body still
  grows. In a scene of three strains without food no flux runs, and every cell keeps 0.2: there
  the factor is 0.48 for one cell with a tube in ten, 0.75 at the median and 0.88 at most (the
  state `v-three-s1`).
- **Then most tubes get thin.** The flow memory follows the flux by a factor e in 333 steps. On
  the Tokyo scene 97 % of the cells with a tube are below 0.2 at step 2,000, and 92 % at step
  24,000. On the Food ring it is 98.7 % or more, and in the Maze 53 % at step 4,000
  (`belowFresh` in `states.jsonl`). The model does not thicken most tubes with a flux: it lets the tubes with
  less flux starve.
- So in a network that has settled, a thick tube is a tube that keeps much flow. A part of a
  network that moved onto fresh ground is thick for some hundred steps, with or without a flux.
  A strain that covers fewer than two foods has no flux, and all its tubes keep the width of a
  new tube.

### Rejected

- **The largest value of the discs**, trail times weight, in place of the mean by weight: a thick
  tube showed scales (decision 2).
- **Brightness alone, without a radius.** The levels and the tone curve of the glow style take
  most of the difference away: a tube at a third of the brightness of another looks about the
  same.
- **Fresh ground as the zero point**: a tube with the flow memory of fresh ground looks as the
  trail alone, with less it is fainter, with more it is wider. Without a flux the picture would be
  the trail alone, which is right. But most tubes of the scenes have less than fresh ground (the
  numbers above), so they would differ in brightness only, and that shows little (the line
  above).
- **A wider window for the strength across a tube** (5 × 5 and 9 × 9 cells, also with another
  strength for the largest radius). It is smoother along a tube, but most tubes then reach the
  largest radius and the tubes differ less.
- **The flux in place of the flow memory.** The four pressure fields draw new roles every 300
  steps, 75 steps apart (ADR 0029), so the flux of a cell jumps every 75 steps. The flow memory is
  the model's own mean of it over time. This one was rejected for its reason; the four above were
  drawn, and the script draws them again.
- **The wall distances alone as the wall test.** See decision 3.
- **A switch that is off by default**, or a setting of each scene. See decision 1.

## Results

All numbers: the real engine, seed 1, on an M3 Pro.

### The pictures

`tests/pictures/tubes.spec.ts` takes pictures of the app with the switch off and on at the same
step (seed 1), and writes them to `test-results/pictures/`:

- **Maze**, step 4,000: the route between the two foods is a thick, smooth tube. The stubs of the
  dead ends are thin and faint.
- **Tokyo rail network**, step 16,000, and **Tokyo, two networks**, step 10,000: the routes with
  much flow are thick, the others thin. With two strains each network is clear, where the trail
  alone shows many faint strands of both.
- **Food ring**, step 12,000: the network between the nine foods is thick, and the strands outside
  it, which carry no flux, are thin and faint. At step 6,000 the network is moving, and parts of
  tubes on fresh ground are thick (decision 7).
- **The owner's case** of ADR 0032 (three strains in a dish, one agent per cell, growth, the flow,
  two foods), step 4,000: the band of three stripes between the two foods is smooth and bright,
  one stripe for each strain, where the trail alone shows three bands of specks. The strands
  outside the band are fainter.
- The paper style shows the same as the glow style. The gel style shows less: its height is at its
  top from a low trail on, so a thin tube and a thick one differ mostly in width.

`research/flow/view/tubes.ts` draws a saved state with the rule on the CPU, beside the trail alone
and the strength of the tubes. It was used to choose the rule, and it draws the rules that were
rejected.

### The cost

The time of a frame in ms: one step and one drawn picture on a canvas of 1,280 × 800 pixels, the
median of 21 samples of 50 frames after 3,000 steps, with the switch off and on in turns on the
same run (`research/flow/engine/picture.gpu.test.ts`; the record is `picture.jsonl`):

| Scene               | Cells     | Strains | WebGPU, off | WebGPU, on | WebGL2, off | WebGL2, on |
| ------------------- | --------- | ------- | ----------- | ---------- | ----------- | ---------- |
| Maze                | 512 × 320 | 1       | 2.51        | 2.83       | 4.84        | 5.48       |
| Tokyo rail network  | 512 × 512 | 1       | 3.50        | 3.99       | 6.16        | 6.78       |
| Food ring           | 384 × 384 | 1       | 1.97        | 2.25       | 4.80        | 4.90       |
| Rival networks      | 384 × 384 | 2       | 2.86        | 3.35       | 5.34        | 5.98       |
| Tokyo, two networks | 512 × 512 | 2       | 5.97        | 6.53       | 8.35        | 8.58       |

The picture costs 0.28 to 0.56 ms for each drawn state on WebGPU and 0.10 to 0.64 ms on WebGL2.
The view draws at most one state per frame, so the cost does not grow with the steps per frame.
With the first wall test (decision 3) the picture took 0.33 to 0.61 ms on WebGPU, on 2026-11-13
with the same command: the exact test costs no more.

### The tests

- `src/engine/tubes.test.ts`, 14 tests: the rule on the CPU, in plain cases with numbers. The
  strength across a tube only on a cell with a tube, the radius and the edge of a disc, the mean
  by weight, the plasmodium without a tube, the edges of the three arenas, and the walls: a wall
  of two rows and of one row, every cell that a line between two cells touches (against a second
  way to compute it), a wall cell beside the middle of a line, a wall of cells that touch at their
  corners, a weak and a strong tube on the two sides of such a wall, a wall cell that still holds
  the memory of a tube, and the rule of a corner across the edge of the periodic grid and at the
  rim of a dish.
- `src/engine/tubes.gpu.test.ts`, 22 tests on each backend and one more on WebGL2:
  - the two passes against the CPU reference (`tubes-reference.ts`) on a box, on the periodic grid
    and in a dish, with four strains and three walls, one of them one cell thick along a diagonal:
    the factors to 1 part in 100,000, and the picture to 1 part in 100,000 of a value, or of 1
    for a value below 1. The walls stop more than 100 discs on their line in each of these scenes;
  - the same plain cases as on the CPU; walls written as cells, with a tube on every open cell, so
    that one disc too many or too few changes the picture; a weak and a strong tube on the two
    sides of a diagonal wall; a wall across the edge of the periodic grid; and the rule of a
    corner across that edge and at the rim of a dish;
  - the picture after a step, a new trail, a new memory and a new wall; the picture of a step that
    moves first; the trail alone with the switch off, without the flow and in the agents style;
  - a drawn frame: zoomed in and zoomed out in each style that draws the trail, its glow, and the
    scent of its own state below the picture;
  - the levels in the three places that measure them (the frames, a PNG, and at once for tests):
    the strand of the scent view is a level of the trail of the model, and the gain is that of the
    picture;
  - settings that free and make the textures that the picture reads (a third pair of the view, a
    flow with one more strain): the picture stays right, and WebGPU reports no error; a measurement
    that waits while the settings free the picture, while the levels of the frames start anew, or
    while the simulation is destroyed; a picture that waits for the scent view while the
    simulation is destroyed; and on WebGL2 a second target that cannot be made.
- `src/engine/engine.test.ts` and `engine.gpu.test.ts`: a measurement of the levels, a picture and
  a PNG, while a restart or a rebuild starts a new run: the engine asks again for the new run,
  also when the rebuild has ended before the answer comes, and it fails with an error when the
  rebuild failed.
- `src/engine/engine.test.ts`, `sizing.test.ts`, `params.test.ts`, `state.test.ts`: the switch
  neither restarts nor rebuilds a simulation, the fit of the grid counts the picture with the
  switch on and off, a link without the switch has it on, and a new scene keeps it.
- `tests/e2e/flow.spec.ts`: the switch in the built app.
- `research/flow/engine/mutate.ts` has 73 wrong rules of the picture (V1 to V73): the parts of the
  rule in the WGSL and in the GLSL pass, and the code of each backend that makes the picture and
  hands it to the readers of decision 4. Each one fails at least one test
  (`logs/view/mutations.txt`). Three runs each found a wrong rule that no test caught, and a test
  now checks each of them: on WebGL2, a tube in the values of a strain that the scene does not
  hold; on WebGPU, a bind group of the picture's passes that outlives the textures of the flow,
  which showed only at every second step; and on both, a picture that is made before the wall
  bytes follow new cells of a wall.

The times on GitHub, which has no GPU (the run of `ccc0ddc`; ADR 0010 allows a test a quarter of
its limit): `tubes.gpu.test.ts` took 9.1 s in the WebGL2 job and 25.8 s in the WebGPU job. Its
slowest test, the picture that waits for the scent view on a backend of its own, took 9.4 s of
120 s on WebGPU. Every other test of the picture took 2.3 s or less, with a limit of 60 s or of
120 s, and each of the four tests of a PNG during a new run (`engine.gpu.test.ts`) 1.8 to 2.4 s of
120 s.

Four independent reviews found faults that the tests of that time did not catch.

- 2026-11-13: on WebGPU the renderer kept the scent of an older frame, or a texture that was
  freed, below the picture; a measurement of the levels read textures that it took before a wait;
  a cell beside a tube was a disc too; and a wall byte could stand for more than its distance.
- 2026-11-14, the second review: the first wall test let a disc pass a wall cell (decision 3);
  the tests of the levels covered only the measurement that tests ask for, not the one of the
  frames and not the one of a PNG; a measurement that waited could ask a simulation that a rebuild
  had destroyed for its textures; and a PNG that waited through a rebuild was drawn with levels of
  the old simulation.
- 2026-11-14, the third review: the engine measured again only while a rebuild was still on its
  way, not after a rebuild that had ended and not after a restart; the strength across a tube
  crossed a wall of cells that touch at their corners (decision 3); and two tests passed for
  another reason than their name says.
- 2026-11-14, the fourth review, which found no fault in the passes: a PNG checked its run only
  until it had the levels, and the backend can wait again while it draws the picture; a rebuild
  that failed during a measurement counted as the same run; the e2e test of the switch counted
  cells that need no tube; and the rule of a corner had no test at the edge of the periodic grid
  and at the rim of a dish.

Each fault is fixed, and each fix has a test that fails without it.

Two runs of the tests on GitHub each found a fault in a test (ADR 0010). The e2e test of the
switch read the picture and the trail of the view in two reads, and on the slow machine the
simulation ran a step between them: the simulation now rests during the two reads. And a WebGL2
test took for granted that a picture waits for the programs of the scent view, which the image
of CI has at once: the test now holds them back itself.

## Consequences

- A scene with the flow looks different from before: the picture of the tubes is on. A link from
  before this record opens with it too. No result of a simulation changes.
- The pictures of the Maze and of the Tokyo scene in `README.md` and for ADR 0029 show the new
  look. `tests/pictures/readme.spec.ts` makes them from the app's own renderer (seed 7), so they
  can be made again after the next change of the look.
- The picture needs 32 B per cell more while the flow is on, and its two passes for each drawn
  state (the table above).
- A new tube is thick until its flow memory follows its flux (decision 7).
- Open: the gel style shows the tubes less clearly than the other styles. The owner asked for a
  better gel relief as a later step (`TODO.md`).
- Open: no view shows the flux itself, which changes with the roles of the foods (`TODO.md`).

## How to check this record

[`research/flow/README.md`](../../research/flow/README.md), part 10, has a command for each number
and each picture of this record. The logs are in `research/flow/logs.tar.gz`, in `logs/view/`.

## Amendment 2026-11-14: the stream of the plasm

### Context

The owner asked for a flow that is more visible (2026-11-13). On 2026-11-14 he chose a moving view:
grains that move in each tube in the direction of the flux, faster where the flux is larger.

The picture of the tubes shows the flow memory. It follows the flux over hundreds of steps, so
nothing in the picture moved with the flux.

### Decision

Under the owner's delegation of 2026-11-12, except for the choice of a moving view, which is the
owner's.

1. **A third pass, `stream`** (`tubes.wgsl`, `tubes.frag`), writes per cell the direction of the
   flow of the plasm times its speed. It reads the pressure of the four lanes and the conductivity
   that the memory of the flow holds, and it computes the flux of each lane as the pass `update`
   of the flow does (`docs/model.md`, 8.4). It runs with the two passes of the picture.
2. **The speed is the flux over the root of the conductivity of the cell**, over 2 (`STREAM.fast`)
   and at most 1. The conductivity of a round tube grows with the fourth power of its radius
   (decision 2), so its root grows as the area that the flux passes: the flux over that area is the
   speed of the plasm. Measured on the cells with a tube at step 12,000 (seed 1), this ratio has a
   median of 0.40, 1.18 and 0.50 and a 90th percentile of 1.35, 2.75 and 1.43 on the Tokyo rail
   network, in the Maze and on the Food ring. So most tubes get a speed between 0.1 and 1, and the
   one thick tube of the Maze is at the limit.
3. **The lane with the largest flux gives the direction.** The four lanes are four flows at the same
   time. Their sum is no flow of the model, and it is zero in a tube that two lanes use in opposite
   directions.
4. **Of the strains with a tube in a cell, the one with the fastest flow counts.** The speed
   before the cut at 1 decides, so two strains at the limit give one answer on every GPU.
5. **The render pass draws grains** (`streaming` in `render.wgsl` and `render.frag`): a pattern
   of points 2.2 cells apart, shifted along the stream. Where the speed is 1 a grain moves 20 cells
   in a period of 32 steps, 0.625 cells per step. A shift that grows without end would tear the
   pattern where the stream turns, so two copies of the pattern take turns: each one starts again
   while the other one shows. A grain is the root of the speed times the pattern above its middle
   values (`smoothstep(0.45, 0.8)`). In the glow and on paper a grain shows up to 1.5 times more
   trail. In the gel it is up to 0.3 darker. From 1 cell per pixel on the grains fade, and from
   1.5 cells per pixel on there are none: a grain is then smaller than a pixel.
6. **The pattern follows the step of the state**, not the time. A paused simulation shows grains
   that stand still, and a frame of one state is always the same, also in a PNG.
7. **No switch of its own.** The grains are a part of the picture of the tubes, with the switch
   "Draw the tubes by their flow". Nobody asked for a second switch. It can come when a picture of
   the tubes without grains is needed.
8. **Built, looked at and rejected**:
   - A tube whose width pulses: the factor of the radius times a pattern that moves. The picture
     takes the largest disc at a cell, which fills a short neck again. With a pattern coarse and
     deep enough to show, the tubes look broken.
   - Bands of equal pressure that move: their speed is the inverse of the fall of the pressure, so
     a fast tube looks slow, and a dead end blinks as a whole.
   - The speed from f, the value that the flow memory follows: it is below 0.03 on three quarters
     of the cells with a tube on the Tokyo scene and on the Food ring, so nothing moved there.

### Consequences

- A scene with the flow shows grains that move in its tubes. They move from the foods that give
  to the foods that take, in the lane with the largest flux through a cell. A tube without a flux
  shows none. No result of a simulation changes.
- The grains show the mean flow of the model. They do not move back and forth, as the plasm of
  the organism does (`docs/fidelity.md`, 17).
- The picture needs 16 B per cell more while the flow is on, 48 B in all (`TUBES_BYTES_PER_CELL`).
- The cost: with the picture on, a frame takes 0 to 0.2 ms more on WebGPU and 0 to 0.35 ms more on
  WebGL2. The time of one step with one drawn picture on 1280 × 800 pixels, in ms (M3 Pro; the
  median of 21 samples of 50 frames; `research/flow/engine/picture.gpu.test.ts` on this commit and
  on the one before it):

  | Scene               | Strains | WebGPU, before | WebGPU, now | WebGL2, before | WebGL2, now |
  | ------------------- | ------- | -------------- | ----------- | -------------- | ----------- |
  | Maze                | 1       | 3.27           | 3.36        | 5.49           | 5.68        |
  | Tokyo rail network  | 1       | 4.44           | 4.54        | 6.87           | 7.10        |
  | Food ring           | 1       | 2.55           | 2.60        | 4.84           | 4.88        |
  | Rival networks      | 2       | 3.87           | 3.86        | 6.15           | 6.28        |
  | Tokyo, two networks | 2       | 7.37           | 7.55        | 9.30           | 9.64        |

  With the picture off the two runs differ by up to 0.11 ms: that is the spread of the measurement.

- The pictures of the Maze and of the Tokyo scene in `README.md` are made again with
  `tests/pictures/readme.spec.ts`.
- Tests:
  - `tubes.test.ts`: the rule on the CPU in plain cases with numbers: from high to low pressure, the
    speed, the lane with the largest flux, the strain with the fastest flow, the periodic grid.
  - `tubes.gpu.test.ts`, on both backends: the pass against the CPU copy on a box, on the periodic
    grid and in a dish with four strains; the plain cases; and a drawn frame, in which the grains
    of two steps lie 10 pixels apart along the stream, to the east and with the pressure the other
    way to the west, and in which nothing moves without a fall of the pressure.
  - `sim.gpu.test.ts`, on both backends: a frame with grains against the CPU copy of the styles,
    within 3 of 255, in the glow, the gel and on paper, zoomed in, across the wrap seam and zoomed
    out.

## Amendment 2026-11-14: the grains go back and forth

### Context

The plasm of the organism streams back and forth with a period of about 2 minutes (`docs/fidelity.md`, 17). The grains
of the amendment above moved one way, with the mean flow of the model. The owner asked to see the back and forth, or to
note it for later if it is too much work (2026-11-14).

A model of the back and forth is much work: the organism pumps its tubes, and waves of that pumping run along the
network. That is a new rule of the model with a study of its own. It is noted in `TODO.md`, under Later.

A back and forth in the picture alone is little work, and it does not contradict the model. The flow memory follows
the size of the flux of a lane, not its direction (`docs/model.md`, 8.4), and the model of Tero, Kobayashi and Nakagaki
takes the mean of the flux over the period. So the model holds no direction that a swing of the grains could
contradict.

### Decision

Under the owner's delegation of 2026-11-12. The owner got moving pictures of two variants on 2026-11-14: a swing with
a small net motion, and a swing alone.

1. **The grains swing along the stream**: 12 cells to each side where the speed is 1 (`STREAM_SWING`), once in 60
   steps (`STREAM.swing`). 60 steps are 2 minutes of the model (`docs/model.md`, 8.6), the period of the organism.
   Both copies of the pattern swing together.
2. **The grains still go on with the stream**, half as fast as before: 10 cells in a period of 32 steps where the
   speed is 1 (`STREAM_REACH`), 0.31 cells per step. At the fastest point of a swing a grain moves 1.26 cells per
   step, so it goes on 1.57 cells per step one way and comes back at 0.94 cells per step. The net motion shows where
   the mean flow of the model runs.
3. **The swing is in the picture alone.** It has one period and one phase in the whole network, and the model holds
   neither. The organism has waves: its tubes do not swing in step. The help of the switch says that the model holds
   only the mean flow.
4. **A swing alone, without a net motion, is not built**: the grains would then not show where the mean flow runs,
   which the amendment above built. It is the same code with `STREAM_REACH` 0.

### Consequences

- The grains of every scene with the flow go back and forth. At 60 steps per second that is one swing per second.
- No pass and no texture is new: the uniform block of the view holds the phase of the swing in a slot that was free.
- Tests, on both backends: in a drawn frame the grains go 11 pixels on from step 4 to step 6, and 11 pixels back
  from step 22 to step 26 (`tubes.gpu.test.ts`); a frame with grains matches the CPU copy of the styles within 3 of
  255 at three steps of the swing (`sim.gpu.test.ts`). Nine wrong rules
  of the swing, one at a time, each failed at least one of these tests: the swing the other way round in each shader,
  a swing of 8 cells in each shader, a swing of one copy of the pattern only, no swing, 20 cells on in a period, a
  swing in 30 steps, and the two phases in the slot of each other.
