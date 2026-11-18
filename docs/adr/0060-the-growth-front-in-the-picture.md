# 0060: The picture shows the growth front: a sheet, fine veins, then the tube

- Status: accepted, with one part open. Decisions 8 and 9 are requests of the owner of 2026-11-17, and decisions 11
  and 12 of 2026-11-18. The other decisions are of an agent under the owner's delegation of 2026-11-12. On
  2026-11-18 the owner looked at the fan of decision 4 in the app and judged that it disturbs the realism (Open
  points): whether the drawn fan stays is the owner's decision. Built 2026-11-17 and 2026-11-18.
- Date: 2026-11-17
- Extends [ADR 0055](0055-the-slime-field.md): the slime field holds a front stamp per cell. Changes
  [ADR 0057](0057-the-film-of-the-slime.md), decision 9: the plasm hides the film. Changes
  [ADR 0009](0009-rendering-pipeline.md): the gel reads its height as a spline. Extends
  [ADR 0026](0026-scenes-of-jones-on-their-lattices.md): a copy of a lattice dims the light that the screen shows.
- In short: the rule of the front stamp is in `docs/model.md`, section 6.9, and the rule of the picture in
  `docs/design.md`, section 5. [`research/flow/README.md`](../../research/flow/README.md), part 22, has the commands
  and the records.

## Context

Stage 3 of the plan of 2026-11-16 (`TODO.md`): a field with the step at which the front reached each cell, and a
picture that draws zones by this age: the sheet at the front, fine channels behind it, the tubes, and the slime where
the colony left. The picture alone; no run changes. The plan left one question open: whether the age of a cell counts
from the first front or from the last.

What the sources say ([slime-mazes-and-the-front.md](../knowledge-base/slime-mazes-and-the-front.md), "The front"):

- A front is a thin sheet without visible structure. Channels appear in it and become tubes, and the sheet between
  them thins away (Le Verge-Serandour and Alim 2023, Sec. 2.2, 4.1 and 5.1).
- A spot gives its mass to the veins with a time scale of 195 s, about 100 steps. The main vein shows about 50 min,
  1,500 steps, after the front passed (Schenz 2019, p. 52 and p. 30). Just behind the front there are many veins side
  by side, and the small ones disappear slowly (Sec. 3.1.4).
- The plasmodium is thickest close to the front (Kuroda et al. 2015).

What the model does, seen on pictures of 2026-11-17 (Tokyo at step 600, the Foraging maze at step 1,500): the colony
grows as arms of full plasm, 8 to 15 cells wide, with blunt ends. It has no sheet and no fine mesh at its front. In
Tokyo the front runs about 0.12 cells per step: 250 cells in 2,000 steps, ten times as fast as the organism
(`docs/fidelity.md`, row 6). The tubes of the model also move sideways while the network gets shorter.

The owner wrote on 2026-11-17, while this was built:

1. The film of the slime lies over the tubes in the picture, seen in Three strains: "the tubes shall always be on top
   without slime covering them".
2. The teeth at the edge of the gel (`TODO.md`, an open point of ADR 0057) may be fixed on the way.
3. Few tokens and few new tests. The owner's rules for a look, of the same day: natural and smooth, pictures first.

## Options

**The first front or the last.**

1. The first front in the life of the slime: a cell gets its front stamp when plasm comes onto ground without slime.
2. The last front: a cell gets a new stamp whenever plasm comes back after some steps without plasm.

**The look**, each tried in the app's renderer on Tokyo at step 600:

- A. A sheet alone: a soft layer around the young arms that gets thin with the age.
- B. A sheet at the youngest ground, and fine veins behind it that are thinner outward.
- Pores that open in the sheet and grow. Rejected by the agent: they look like bubbles.
- A net of straight veins of one width. Rejected by the agent: it looks like wire.

**Where the stamp lives**: a buffer of its own, or a counter of the age in the free bits of the amount of slime. The
counter needs no memory on WebGPU, but every pass that writes a stamp of the slime must then also count the age.

## Decision

1. **The front is the plasm that comes onto ground without slime**: the first front in the life of the slime. Reasons:
   - It is the ground on which a birth will be a sink of the flow (the owner, 2026-11-16, for stage 4: "only a birth
     onto fresh ground counts"). So the picture and the flow have one meaning of a front.
   - A tube of the model moves sideways, and its plasm comes back onto cells that it left. With the last front, such
     a tube would be a front for as long as it moves.
   - The stamp of a cell does not change while the cell has slime, so no part of the picture jumps.

   The cost: a colony that comes back onto slime shows no front. With the default life time of 144 hours that holds
   for the return into the dead ends of the mazes after 160,182 steps (ADR 0054). An erase clears the slime, so the
   colony that grows back there shows a front.

2. **The front stamp** F is a third whole number per cell in the slime field, 4 B: the step, plus 1, in which plasm
   came onto the cell while it had no slime (`docs/model.md`, 6.9). The pass of the stamps writes it on WebGPU, and a
   pass before it on WebGL2. A stroke of the Slime tool sets F to 0 in a cell that had no slime: no front reached
   painted slime. An erase and a wall leave F, which has a meaning only in a cell with slime. A buffer of its own,
   and not a counter in the amount: the rule is one line in one pass, and a tool can read the step of the front as
   the plan says.
3. **The age of the ground** is taken for texels of 8 × 8 cells, in a map that a pass fills once for each state. The
   age of a texel is the age of its oldest front stamp among the cells with slime: the time since the front first
   reached the texel. So a tube that gets wider by a cell shows no new front beside it. A texel without slime has no
   front stamp and shows no fan.
4. **Look B: a sheet, then fine veins** (the agent's pick; the owner chooses on the pictures and in the app). The
   render pass takes the plasm around a pixel from the texels of the map within 2 texels, each with a weight that
   depends on its distance alone and ends without a step: a round, smooth hill at any zoom. The sheet is a thin
   skirt around young plasm, with an outline in the middle of that hill, and it goes with e^(−age / 100 steps). The
   veins are the walls between the cells of a pattern that is fixed in the grid, bent by soft noise. They come as
   the skirt goes, they are thick near strong plasm and end at the outer end of the fan, and they end at the tube of
   the model. The tube is drawn as before: the picture hides no plasm of the model.
5. **The times.** The sheet: 100 steps, the 195 s of the source. The end of the veins: 1,500 steps, the 50 min of the
   source. Between them a vein gets thinner by the factor e in 350 steps. This number is a choice made on pictures:
   the front of the model runs ten times too fast, so 1,500 steps are 180 cells in Tokyo, and veins of the full
   width for all that time put a fringe on the whole young network.
6. **The sheet stays on its side of a wall.** The fan reaches up to 16 cells from its plasm, more than a wall is
   thick. The render pass walks from the pixel toward the plasm, up the slope of the plasm, one cell at a time, and
   shows no fan where a wall lies on the way.
7. **The sheet is plasm.** It adds to the trail of its strain before the style draws it, and to the height and the
   slope of the gel. Its code is compiled in only for a frame that draws it, in pipelines of its own that also hold
   the film. The agents style and the scent view draw no fan. The switch Show growth front is on at the
   start, changes no run, and goes into a link like Show slime. A life time of 0 and the Jones model have no slime
   field, so they have no front stamp and no fan. A scene without growth draws no fan either: its agents start all
   over the ground, and the fan lay on the whole picture in its first steps (the e2e tests found this).
8. **The plasm hides the film of the slime** (the owner, 2026-11-17 and again 2026-11-18). In every style the plasm
   hides its ground from the light 0.02 on, and all of it from 0.14 on, the levels at which the gel begins. So a dim
   tube hides the film too. Before, the glow added its light to the pale film, a thin gel showed the film through
   it, and the beads of the film lay on the tubes.
9. **The gel reads its height as a quadratic B-spline** of the cells while a cell is a pixel wide or more, from four
   bilinear lookups in place of one (the owner's hint in `TODO.md`). The line at which the gel ends has no tooth for
   each cell. Zoomed out, the four lookups over the pixel stay.
10. **The proof is small** (the owner on the cost of look work, 2026-11-17). The front stamp is a rule of the passes:
    both backends against the CPU reference. The fan has no CPU reference: the two backends must draw the same
    pixels, the fan must be on young ground and not behind a wall or after 1,500 steps, and with both switches off
    the pixels are those of the shaders without the code.
11. **The scent view lies over the picture and hides nothing of it** (the owner, 2026-11-18: with Scent on, the slime
    went away, "that should not be so"). The scent view shows the film of the slime and the fan. ADR 0055, decision
    8, drew no film below the scent view, so that its picture was the same with slime and without it. The scent view
    has one render pass for each picture that lies below it: the picture alone, the film, or the fan with the film.
    A frame builds only the pass that it draws. It draws the view once that pass, the maps of the view and the
    passes of what lies below are built; until then it draws the picture without the view.
12. **Gel relief is the default style** (the owner, 2026-11-18: "it looks much better", also in the scenes of
    Jones). Every scene starts in it but Electrotaxis, which keeps the agents style of its figure. A link holds its
    own style. The style changes no run.
13. **A copy around a periodic lattice dims the light that the screen shows of the lattice.** The light of a pixel
    ends at 1 before the copy dims it to 0.15 (ADR 0026). A highlight of the gel has more light than the screen
    shows, up to 2. Without this rule the highlights of a copy stay brighter than the rest of the copy.

## Results

Made on 2026-11-17 and 2026-11-18 on an M3 Pro, in headless Chromium. The commands and the records are in
[`research/flow/README.md`](../../research/flow/README.md), part 22.

- **No run changes.** The digests of the agents, the trail, the scent, the environment, the flow memory and the
  pressure equal the record of `main`: 54 of 54 runs after 500 steps (every scene, both backends) and 16 of 16 after
  3,000 steps (the eight scenes with the flow, both backends).
- **The front stamp** (`front.gpu.test.ts`, both backends against `frontStep()` of `slime-reference.ts`): plasm on
  fresh ground, plasm that comes back onto slime, plasm after the life time is over, the Slime tool on ground with
  and without slime, a reset and the Jones model.
- **The fan** (the same file): the two backends draw the same pixels in the glow, gel and paper styles, close and
  fitted, 3 of 255 apart at most. The fan differs from the picture without it by more than 25 of 255 on young
  ground, by 2 at most behind a wall and 1,500 steps after the front.
- **Faults that the tests found**, all fixed. The first walk toward the plasm followed the slope of the sheet with
  its veins, so veins showed behind a wall: it follows the slope of the plasm alone now. Trail on ground without a
  stamp, which no step of the slime field saw, showed a fan: 71 tests of the trail, the tubes and the electrodes
  failed, and such a texel shows none now. In a scene without growth the fan lay on the whole picture in the first
  steps and hid the film (two e2e tests): the fan needs growth now (decision 7).
- **Two faults that the owner found in the running app** (2026-11-18), both fixed. The first rule for the film hid
  the share 1 − e^(−3 x) of it below plasm of the light x: a dim tube of the scene Three strains still showed a
  third of the film and its beads, and the owner took the build for `main`. And the first sheet was a quadratic
  B-spline of the map times 2.4: close to a young tip its outline lay at the far end of the reach of a texel and was
  a block with straight edges, 8 cells wide. The pictures of the looks did not show it, because their zoom was too
  small. Decisions 4 and 8 have the rules of now.
- **A fault that the new default style showed**, fixed (decision 13). The test of the copies around a periodic
  lattice ran in the glow style alone, which has no light above 1. In the gel style a highlight on a copy was up to
  39 of 255 brighter than 0.15 of the highlight on the lattice, on both backends. The test runs in the default style
  now.
- **A test that only CI failed** (2026-11-18). The e2e test of the Slime tool read the film with the levels of the
  frames. These follow a new picture over about 60 frames: a second on the M3 Pro, a minute on SwiftShader. Until
  then the haze of a start counts as plasm, and the plasm hides all of the film (decision 8). So the test saw no
  film in CI, failed twice, and the job ran into its limit of 30 minutes with 27 tests not run. The test measures
  the levels first now, and the 42 tests of that half pass in the image of CI.
- **Two passes that no frame drew.** The first build of decision 11 built the render pass with the scent view
  alone, without and with food, light and walls, beside the pass with the view and the film. No frame with the film
  draws it. Now a frame builds only the pass that it draws, and a test counts the passes (`slime.gpu.test.ts`,
  "builds the pipelines or programs of the film once"): two for the maps of the view and two for its render pass.
  Not measured: the time that this saves.
- **The time of the e2e tests in the image of CI** (M3 Pro, the second shard of two, 42 tests, one run each in turn
  on 2026-11-18, before the change of the passes above): 11.1 min on `main` and 12.4 min here. The four tests of
  `tubes.spec.ts` in it take 24 s more together: they draw the fan. The 38 tests of `ui.spec.ts` take 58 s more,
  1.25 s in the median: the default style draws more, and the scent view has the film below it. On GitHub this
  shard of `main` took 24.8 to 28.3 min of its limit of 30 in the last five runs of `main`. So it does not fit there
  with this change, and PR #109 (ADR 0061) makes four shards of the two.
- **A fault that only CI found.** The map of the front held 16-bit floats. A trail above 65,504 gave it a value that
  is no number, and on SwiftShader, the GPU of CI, the tube and the walls were black. On the M3 Pro the picture
  showed nothing of it, and both backends drew the same black, so the test of the two backends passed. The map holds
  32-bit floats now, as the trail does, and a test says that the fan only adds light in the glow style. The first run
  of CI also needed more than its 30 minutes for the second half of the e2e tests (24.5 minutes on `main`). So the
  fan got pipelines of its own, as the scent view has: a frame without the fan runs the shader without its code. In
  the image of CI, the tests of the slime and of the tubes on WebGPU take 124 s with that (125 s on `main`, 133 s
  before it).
- **The film below the plasm and the switches** (`slime.gpu.test.ts`): the tests of the film hold with new numbers
  where the plasm hides the film. With both switches off every pixel equals that of the shaders without the film and
  the fan.
- **Wrong rules**: 22 new ones (GF1 to GF22) and 16 of the slime with a new text, because their lines changed.
  Each of the 38 fails at least one test. The list has 629 wrong rules.
- **All tests**: 875 unit tests with the research tests, 1,345 GPU tests on both backends (8 more run on one
  backend only), and 84 tests of the built app.
- **The pictures**: `tests/pictures/front.spec.ts` makes them again: Tokyo at the steps 600, 1,500 and 4,000, the
  Foraging maze, Three strains and Rival networks in each style, fitted and close.

- **The time of a step**, against `main` at `07b295e`: milliseconds per step, the mean of the medians of two rounds
  in turns.

  | Scene, grid           | Backend | Without the flow | With the flow   |
  | --------------------- | ------- | ---------------- | --------------- |
  | Maze, 512 × 320       | WebGPU  | 0.189 → 0.213    | 1.763 → 1.778   |
  | Tokyo, 512 × 512      | WebGPU  | 0.483 → 0.430    | 2.903 → 2.890   |
  | Cyclones, 1,024 × 640 | WebGPU  | 3.673 → 3.673    | 19.300 → 19.097 |
  | Maze, 512 × 320       | WebGL2  | 0.418 → 0.489    | 2.253 → 2.241   |
  | Tokyo, 512 × 512      | WebGL2  | 0.835 → 0.703    | 3.537 → 3.558   |
  | Cyclones, 1,024 × 640 | WebGL2  | 11.869 → 12.043  | 28.351 → 28.753 |

  Two rounds do not resolve the cost of the front stamp: two rounds of one case differ by up to 20 % in the small
  scenes, and half of the cases are faster with it. The largest rise is 0.4 ms, 1 %, on WebGL2 with the flow.

Not measured: the time of a draw with the fan. A step writes one more buffer in the pass of the stamps on WebGPU and
runs one more pass on WebGL2. A pixel on young ground reads 9 texels of the map and 11 steps of two lattices, and
walks up to 13 cells toward its plasm in a scene with walls.

## Consequences

- The extended model needs 4 B more per cell: the slime field and its picture count 15 B. A grid at the limit of the
  memory of a GPU gets a little smaller.
- The picture of every scene of the extended model changes while a colony grows onto ground without slime, and
  where plasm lies on slime. The picture of every scene in the gel style changes at the edge of the gel, zoomed in.
  No scene changes a byte of its run.
- Stage 4 reads "ground without slime" from the stamp of the slime alone, as before. A tool can measure how long
  after the front a tube shows from the front stamps (`Sim.readSlimeFront()`).
- The numbers of the fan are the constants `FRONT_…` of `render.wgsl` and `render.frag`. The look of the film stays
  in `SLIME_LOOK`.
- A pixel below plasm that hides all of its ground draws no film. ADR 0057 named this as a way to make the film
  cheaper, and [ADR 0059](0059-the-film-of-the-slime-keeps-its-cost.md) left the cost of the film as it is. Here it
  comes with the rule that the plasm lies on the film, and nobody measured the time that it saves.

## Open points

- **The owner does not like the drawn fan** (2026-11-18, in the running app, with two photos of the organism): it
  "disturbs the realism", and the shader is "too far from the real look". In the photos a front is a whole sheet
  with a lobed rim, and the veins behind it run toward the rim and fork there, as a tree does. The fan of this
  record is a skirt and a net around an arm of the model. The owner asks whether the veins must be grown by the
  model, and whether the front that moves ahead of the tubes must come first. The agent's answer: yes. That is
  stage 4 of the plan, the front as a sink of the flow. The agent recommends to take the drawn fan out again and to
  keep the front stamp, the film below the plasm, the edge of the gel and decisions 11 and 12. Not decided.

- **The second shard of the e2e tests can reach its limit of 30 minutes on GitHub** until PR #109 is merged
  (Results). Then the check `verify` is red with a cancelled shard and no failed test.
- **The look is the owner's choice.** Look A, the sheet alone, is look B without the veins and with a sheet that
  lasts three times as long.
- **The fan is a picture.** The model grows arms, not a sheet, and no vein forms toward a front (`docs/fidelity.md`,
  rows 6 and 24). The crown of a tree that the owner asked for needs the flow of stage 4.
- **The veins do not follow the direction of the growth.** Their pattern is fixed in the grid.
- **The fan has no CPU reference.** A fault that both backends share shows only on pictures, or on another GPU:
  CI found one (Results).
- **Zoomed out beyond 4 cells per pixel** a pixel is wider than half a texel of the map of the front. Not looked at.
- **The time of a draw with the fan is not measured**, and two rounds do not resolve the cost of a step (Results).
