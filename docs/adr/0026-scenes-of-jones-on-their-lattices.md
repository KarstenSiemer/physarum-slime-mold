# 0026: The scenes of Jones run on the lattices of their figures

- Status: accepted
- Date: 2026-11-11

## Context

The owner's rule of 2026-11-11 (ADR 0024, decision 3): a scene of Jones' papers runs on the lattice of its paper,
for the shipped scenes too. Jones gives his lengths in cells: the sensor offset, the step, and one 3 × 3 mean of the
trail per step. So a pattern has a fixed size in cells. Before this change, the scenes of Jones used 512 cells on the
long side of a grid shaped like the screen (the Transport and Minimizing networks 1024, Shortest path and Steiner tree
256): 512 × 288 on 16:9, 512 × 512 on a square and 236 × 512 on a phone. The same scene then showed another number of
meshes on every screen, and a dish of another size. The app's own scenes (the start scene, Two and Three strains,
Fleeing light, the Maze, Cyclones, Dunes, Dot grid) keep a grid shaped like the screen.

The lattices, from the figure captions of Jones 2010 (Artificial Life 16(2): 127–153). A page is the page that holds
the caption.

| Scene                | Figure          | Lattice   | Page | Arena                                                |
| -------------------- | --------------- | --------- | ---- | ---------------------------------------------------- |
| Transport network    | Fig. 4          | 200 × 200 | 135  | periodic (Table 1, p. 134)                           |
| Minimizing network   | Fig. 5          | 200 × 200 | 136  | periodic                                             |
| Turing spots         | Fig. 16, top    | 200 × 200 | 144  | periodic                                             |
| Turing stripes       | Fig. 16, bottom | 200 × 200 | 144  | periodic                                             |
| Shortest path        | Fig. 18         | 200 × 200 | 145  | closed: "boundary of the environment (uniform gray)" |
| Steiner tree         | Fig. 19         | 200 × 200 | 146  | closed                                               |
| Shrinking plasmodium | Fig. 21         | 300 × 300 | 147  | closed; the text on p. 147: %p 50 is 45,000 agents   |
| Wound healing        | Fig. 22         | 300 × 300 | 148  | periodic                                             |

Each caption names its lattice, and no two places in the paper disagree. Table 1 (p. 134) gives 200 × 200 as the
typical image size. Where the paper leaves a choice, this app keeps its earlier reading:

- The paper does not give the shape of the closed arena of Fig. 18, 19 and 21 in its text. Fig. 17 shows "a circular
  sheet of agents". The app's dish is the circle on the lattice's side less 2 cells (ADR 0019), and %p of the lattice's
  area gives Jones' count: 0.5 × 300 × 300 = 45,000 agents, as on p. 147. The images of Fig. 18 and 19 show a dish
  0.945 of the lattice's side (the fidelity check of 2026-11-11, see Measurements); that dish comes with a later
  change.
- The caption of Fig. 22 names no boundary: Table 1's periodic boundary, as before.
- The positions of the food in Fig. 18, 19 and 21 are not in the text. They stay this app's choice (decision 10).
  The images show them: Fig. 19 a square of about 60 cells, 0.32 of the dish, with foods of about 2.7 cells; Fig. 21
  19 foods, not the app's 8. The figures' foods come with a later change.

## Options

1. **A lattice setting of width × height cells, or none** (chosen). A scene of Jones sets the lattice of its figure;
   the app's scenes set none and keep a grid of `resolution` cells on the long side, shaped like the screen.
2. A square side only. All lattices of Jones 2010 are square, but ADR 0024 lists 400 × 150 for a later paper.
3. Scale every length with the grid. That is not Jones' model: diffusion acts over one cell per step (ADR 0024).

## Decision

Option 1, with these decisions of this app, on 2026-11-11 under the owner's rule:

1. **The setting** (`Settings.lattice` in `src/model/params.ts`): `[width, height]` in cells, or `null` for a grid
   shaped like the screen. `sanitize()` takes two whole numbers from 16 to 4096, the sides that links already accept
   for strokes (`src/model/link.ts`); anything else is `null`. Each scene of Jones sets the lattice of the table above
   (`src/model/presets.ts`, `L200`, `L300`). `resolution` stays: it sets the grid while there is no lattice, and it is
   the grid a scene of Jones gets when the device cannot hold its lattice (item 8). For the scenes of Jones it is now
   512, the value of `jones()`. Their 1024 and 256 were chosen for grids shaped like the screen. On a lattice the
   resolution sets nothing and is no change of the scene (`modelChanged()` in `src/model/scene.ts`).
2. **An old link opens as it was made.** A link from before this change holds no lattice, so it opens on the grid
   shaped like the screen of its resolution, with the sender's bytes on the sender's grid (ADR 0021). The scene card
   shows the scene as changed, and the hint (item 6) offers Jones' lattice. To open it on the lattice instead would
   change the picture that the sender shared. A link names a scene's shapes by the scene and one bit each (ADR 0021),
   so this holds only while a scene's shapes stay: Steiner tree's foods moved and came back on the same day
   (decision 10), and an old link of every scene paints its sender's bytes. A later change that moves shapes must give
   a scene's shapes a revision that a link holds.
3. **The view fits the lattice** (`Engine.fitView()`, unchanged): the lattice fits the canvas, centred (a square one
   fills the canvas's short side), with free space beside it, at every zoom and on both backends. Beside a closed
   arena, and in a square lattice's corners outside the dish, the free space shows only the background, as it did
   beside a dish (`lattice.gpu.test.ts` reads these pixels). Around a periodic lattice the copies of the lattice show
   at 0.15 of their light (`LATTICE_COPIES` in `src/engine/render.ts`, the third value of `fx` in the view uniform;
   `render.wgsl` and `render.frag`), with a ramp one pixel wide at the lattice's edge. A grid shaped like the screen
   shows its copies as before, when zoomed out. Reason: every tool on a copy acts on the cells that the copy shows
   (ADR 0019 for the paint tools, decision 12 for the agent tools). A plain free space beside a periodic lattice would
   hide that at the pointer and show it at the other edge. Dimmed, the copies show where a tool acts, and the lattice
   and its number of meshes stay clear.
4. **A lattice does not turn by 90°.** It keeps the orientation of the figure, and a tall screen shows free space
   above and below it, as Tokyo does (ADR 0024, decision 4). The canonical frames of ADR 0019 follow the shape of the
   grid, not of the screen: they turn only on a grid that is taller than wide. Every lattice of Jones 2010 is square,
   so no frame turns, and a turn of the lattice would change nothing in the model but the picture's orientation.
5. **Frames on a square lattice.** Food, light and walls keep the canonical frame of the arena they were painted in.
   The lattice gives that frame one size on every screen, so the shapes of a scene paint the same bytes on 16:9, a
   square and a phone. A scene's shapes keep the dish's frame after a switch to a box or a periodic grid on the
   lattice: Shrinking plasmodium's foods lie inside the dish, and the box and the periodic grid give the dish's bytes on
   every screen. A stroke painted on the lattice goes to a grid shaped like the screen through the frame of its arena,
   and comes back byte for byte on the lattice (`engine-env.test.ts`, "lattices").
6. **The hint** (`latticeNotice()` in `src/model/presets.ts`, `src/ui/Panel.svelte`; text revised after the review
   of 2026-11-11): while the loaded scene has a lattice and the grid is another one, a text below the grid choice says
   what runs, what Jones used and why the result differs, with the names of the panel: "This grid has 512 cells on the
   long side. For this figure, Jones used 200 × 200 cells. Jones gives lengths in cells, as for Sensor distance and
   Step size. So the pattern keeps its size in cells, and another grid holds more or less of it. The result is then
   different from the paper." The first text said that the pattern has another scale, which the measurements below
   contradict: the lacunae keep their size in cells. It says what runs, not who changed it, so it holds for an old
   link too. No-break spaces keep "200 × 200" on one line (`latticeText()`). A button "Use 200 × 200 cells", styled
   as an action like "Reload scene", puts the lattice back and keeps every other setting (`useSceneLattice()`); it
   removes itself with the hint, so the focus goes to the grid choice, as "Reload scene" moves it to the card's
   heading. The grid choice names the text with `aria-describedby`. The text follows ASD-STE100: at most 20 words per
   sentence (`presets.test.ts`). While the device cannot hold the scene's lattice, a note without a button says so
   (item 8).
7. **The grid choice** ("Grid"): the lattice that runs and the scene's lattice ("200 × 200 cells, as in the paper"),
   then the grids shaped like the screen ("512 cells on the long side"). A pick of a grid size marks the grid as the
   user's (`app.gridPicked`), as before, and stops the startup check for the session. The scene's own lattice, from
   the choice or from the hint's button, is no pick of a grid size (review of 2026-11-11): the check never lowers that
   lattice anyway (item 9), and it must go on for the scenes loaded later. Before, the button stopped the check for
   the session.
8. **Memory.** A lattice runs as it is, or the grid becomes one shaped like the screen. `Engine.fit()` checks the
   lattice against the memory budget, the largest buffer and the largest grid side (`fits()` in
   `src/engine/sizing.ts`). If it does not fit, the scene gets the largest grid of its resolution that fits, and a
   notice says: "This device cannot hold a lattice of 300 × 300 cells. The scene runs on a grid of 256 cells on the
   long side." An out-of-memory error steps a lattice down to the largest grid shaped like the screen with fewer
   cells, with the notice "The GPU ran out of memory for a lattice of …". By cells, not by the long side (review of
   2026-11-11): no resolution lies below 200, so the first version stopped the app for six of the eight scenes, and a
   lattice of 1000 × 100 would have stepped "down" to three times its cells. On a square screen no grid shaped like it
   has fewer cells than 200 × 200 (256 × 256 has 65,536), so the error stands there, as it does for the smallest grid
   shaped like the screen. A smaller lattice is not the paper's either, and the grids shaped like the screen already
   have these paths. A lattice that the device cannot hold does not lower `app.maxResolution`: that grid says nothing
   about the largest grid the device holds. When it is the scene's own lattice (`deviceAdjusted()` in
   `src/ui/state.svelte.ts`), the scene runs on that grid as on a grid the device lowered: the card shows no change and
   offers no "Reload scene", and the panel says "This device cannot hold Jones' grid of 300 × 300 cells for this
   figure. The scene runs on a grid of 256 cells on the long side, so the result can be different from the paper.",
   without a button that would fail the same way (review of 2026-11-11). A new load of the scene tries the lattice
   again. A lattice from a link that is not the scene's goes the same way, and the hint then offers the scene's own.
   A lattice of Jones 2010 needs at most 9.5 MB (300 × 300 cells at 90 B and 45,000 agents at 32 B, `sizing.ts`),
   and 11.3 MB on WebGL2 without float blending (110 B per cell). Since ADR 0028 (amendment of 2026-11-12) the fit
   counts the two coarse maps of the view: 10.3 MB (98 B) and 12.1 MB (118 B). Since its decision 14 WebGL2 counts
   54 B per agent: 11.25 MB with float blending, and 13.05 MB without it. All lie below the smallest budget of 32 MiB
   (0.25 GB of device memory), so only an out-of-memory error or a link can bring a lattice that does not fit.
9. **The startup check and rebuilds.** The startup check (`autoTune()` in `src/ui/state.svelte.ts`, `Tick.lattice` in
   `src/ui/tune.ts`) does not count time on the loaded scene's own lattice and never lowers it: Jones' result needs
   it, and it has at most 90,000 cells, below the 147,456 cells of the check's floor (512 × 288). Another lattice, such
   as one from a link (`sanitize()` takes up to 4096 × 4096 cells), counts as the smallest grid shaped like the screen
   with at least its cells (`latticeResolution()`), and the check lowers it, like any grid, to a grid shaped like the
   screen, with the usual notice (review of 2026-11-11). Before, a link of 2048 × 2048 cells kept running on a slow
   GPU. After a lattice the check goes on. A lattice is built again for a new density and a switch to or from the dish,
   which changes the agent count, not for the resolution or a new shape of the screen (`Engine.needsRebuild()`).
10. **Steiner tree keeps its foods** (±0.145 of the dish's side, radius 0.02 of it: 4 cells on 200 × 200). They moved
    to a square half as wide as the dish (±0.25) on 2026-11-11, because the old square kept a ring of trail in 5 of 10
    runs on Jones' lattice and half the dish gave a tree with two junctions and a long bridge in 10 of 10. They came
    back the same day: the image of Fig. 19 shows a square of about 60 cells (0.32 of the dish) with foods of about
    2.7 cells, and the end state of an X with a short bridge (row 2), not a long bridge. With the figure's foods the
    network forms a tree in 20 of 20 runs (the fidelity check). Those foods come with a later change, together with the
    shapes' revision of decision 2. Until then the scene text says what the scene shows: an X in about half of the
    runs, a ring in the others.
11. **The other scenes keep their values.** Shortest path keeps its foods, Shrinking plasmodium Jones' density 0.5, the
    networks no glow (decided 2026-11-09).
12. **The agent tools on a periodic grid** (review of 2026-11-11, also on `main` when zoomed out). Cut, the Cut's
    clearing of chemicals in the extended model and Inoculate measure the distance from an agent or a cell to the
    nearest copy of the brush (`toolDistance()` in `common.wgsl` and `common.glsl`, used in `agents.wgsl`,
    `tools.glsl`, `diffuse.wgsl` and `diffuse.frag`). So a tool held on a copy acts on the cells the copy shows, and
    a tool across an edge acts on both sides, on both backends. Before, Cut used the plain distance to the position
    under the pointer: on a copy it cut nothing, and across an edge only the part inside the grid. Inoculate already
    worked, because it wraps the point it places. The paint tools work by `fromStroke()` (ADR 0019).
13. **Nothing happens beside a closed arena** (review of 2026-11-11, also on `main` beside a dish). An agent tool
    whose brush reaches no cell of the arena is idle (`Engine.agentTool()`, `paintsCell()`), so a paused hold runs no
    step there. Before, a paused Cut or Inoculate held on the free space ran 60 steps per second. Paint tools there
    record no stroke (ADR 0019).
14. **"This link changes the scene."** While the settings and the drawing are as a shared link opened them
    (`linkUnchanged()` in `src/ui/state.svelte.ts`), the scene card says so in place of "You changed the scene." The
    receiver of an old link changed nothing (review of 2026-11-11). A grid the device lowered is no change.

## Measurements

WebGPU, Apple M3 Pro, seeds 1 to 5 (Shortest path and Steiner tree 1 to 10), built as the app builds a scene
(`Engine.create` and `Engine.load` on a canvas of 1280 × 720 and 390 × 844). "Before" is `main` (45155a8) on 16:9
and on a phone; "after" is the lattice, the same on every screen. The trail of the network is the trail above the
mean of the arena; a lacuna is a part of the rest of at least 20 cells, not open to the rim of a dish. A tree or a
band is one part of the trail that touches every food, holds no lacuna and stays off the rim; its junctions are
those of its skeleton (Zhang and Suen thinning).

| Scene, property                                             | Before 16:9          | Before phone         | After (lattice)    |
| ----------------------------------------------------------- | -------------------- | -------------------- | ------------------ |
| Transport network, grid                                     | 1024 × 576           | 473 × 1024           | 200 × 200          |
| lacunae at step 4,151 (Fig. 4)                              | 97.4 ± 4.6           | 77.4 ± 3.9           | 6.6 ± 1.0          |
| mean lacuna at step 4,151, cells                            | 4,314 ± 221          | 4,468 ± 236          | 4,424 ± 784        |
| trail cells that changed from step 4,151 to 4,651           | 23.2 ± 2.0 %         | 22.4 ± 1.5 %         | 18.5 ± 5.9 %       |
| Minimizing network, lacunae at step 31,190 (Fig. 5)         | 26.8 ± 1.6           | 22.4 ± 1.7           | 1.6 ± 0.5          |
| Turing spots, spots at step 10,000                          | 82.0 ± 2.8           | 66.8 ± 3.5           | 19.0 ± 1.9         |
| spacing to the next spot, cells; its variation              | 28.3; 19.9 ± 2.5 %   | 28.6; 17.9 ± 3.2 %   | 31.1; 27.7 ± 4.7 % |
| Turing stripes, one orientation over the grid, step 20,000  | 59.5 ± 20.2 %        | 47.9 ± 30.7 %        | 84.6 ± 1.0 %       |
| Shortest path, one band, no loop, off the rim, step 12,000  | 10 of 10             | 10 of 10             | 10 of 10           |
| Steiner tree, a tree off the rim with two junctions, 12,000 | 10 of 10 (bridge 20) | 10 of 10 (bridge 15) | 5 of 10, 5 rings   |
| Wound healing, wound vs. before the cut, 700 steps later    | 43.9 ± 24.2 %        | 43.2 ± 14.8 %        | 47.1 ± 14.1 %      |

- The lacunae of the Transport network have the same size in cells on every grid: the pattern keeps its size, and
  the lattice holds Jones' number of them. The network keeps changing on the lattice.
- The Minimizing network reaches Jones' end state on his lattice: a simple network with one or two lacunae at the
  step of his last image. On the grids of before it was still coarsening.
- A spot is a maximum of the trail blurred over 8 cells. The spots keep their spacing in cells. On the lattice their
  array has more defects: a variation of the spacing of 28.7 ± 2.1 % at step 30,000 and 28.8 ± 4.0 % at 60,000,
  against 18.0 to 19.0 % on 512 × 288. Some runs keep two spots in one ring. The cause is the order inside a step:
  Jones moves and deposits, then senses, then diffuses (p. 132–133), and this app senses first. With Jones' order all
  30 runs of the fidelity check hold exactly 20 discs on 200 × 200 cells at step 30,000, with a spacing variation of
  4.4 % (5.7 % in Fig. 16). Jones' order comes with a later change.
- On the lattice one orientation of stripes covers the grid by step 5,000 (82.4 ± 1.2 %), as on p. 143 to 144.
- The wound's pattern correlates with the pattern before the cut as much as the undamaged ring around it does
  (51.0 ± 13.0 % there at step 3,350).
- Steiner tree on the lattice, seeds 1 to 10, by the width of the square of food against the dish, with foods of
  4 cells: 0.21 wide, 1 tree at step 30,000 (9 rings); 0.23 wide, 3 trees; 0.29 wide (the app's foods), 5 trees at
  steps 6,000 to 30,000, an X or two junctions with a bridge of up to 15 cells; 0.4 wide, 9 trees from step 6,000;
  0.5 wide, 10 trees from step 6,000 to 30,000, with bridges of 40 to 50 cells. A ring stays where Jones says that
  loops cannot close around the points (p. 145). Fig. 19 shows 0.32 with foods of about 2.7 cells (decision 10).

Shrinking plasmodium (an open owner question since ADR 0019: Jones' density 0.5 tears holes): a hole is a part of the
sheet of at least 1,000 cells without trail, not open to the rim, by step 2,800. The app's dish has the lattice's side
less 2 cells.

| Grid                                 | Density | Agents | Runs with a hole      | Same network (IoU at step 10,000) |
| ------------------------------------ | ------- | ------ | --------------------- | --------------------------------- |
| 512 × 288 (before, 16:9), 15 seeds   | 0.5     | 41,472 | 3 of 15 (as ADR 0019) | 0.59                              |
| 237 × 512 (before, phone), 15 seeds  | 0.5     | 28,085 | 0 of 15               | 0.85                              |
| 512 × 288 (before, 16:9), 31 seeds   | 0.5     | 41,472 | 11 of 31              | 0.50                              |
| 300 × 300 (Jones' lattice), 31 seeds | 0.5     | 45,000 | 18 of 31              | 0.41                              |
| 300 × 300 (Jones' lattice), 31 seeds | 0.6     | 54,000 | 0 of 31               | 0.59                              |

The seeds are 0, 21 to 23 and 31 to 57. On Jones' lattice, Jones' density tears a hole in more than half of the
runs, always around the middle food (the centres of the 19 holes lie 12 to 39 cells from it), and such a run ends as
a ring through the outer foods. The runs without a hole
end in the same network (IoU 0.80 between them on the lattice, 0.82 on 512 × 288; 0.48 and 0.47 between the runs with
a hole). Jones reports three runs with the same network (p. 147). On the lattice the scene reproduces Fig. 21 less
often than on 512 × 288 (18 of 31 runs with a hole against 11 of 31), and 0.6 tears no hole in 31 runs. The cause is
the dish, not the density: Jones' dish is 0.945 of the lattice's side (0.947 in the image of Fig. 18, 0.944 in
Fig. 19), and with it Jones' density 0.5 tears a hole in 0 of 31 runs (the fidelity check). That dish comes with a
later change; the density stays Jones' 0.5.

The fidelity check (2026-11-11) compared every scene of Jones with the images of its figure and with a reference
simulator written from the paper's text. Its other result for these scenes: Fig. 4 shows 8 lacunae at step 4,151,
and the lattice gives 6.4 ± 0.9.

## Consequences

- The eight scenes of Jones change: their bytes differ from `main`, and on a large screen their cells are larger
  (5.4 pixels a cell for 200 × 200 on a window 1080 pixels tall). The app's scenes keep their bytes (digests of the
  agents, trail, scent and environment after 500 steps from seed 7, WebGPU, WebGL2 and WebGL2 without float blending).
- A scene of Jones on a desktop window lies partly below the panel, as the dish did before. The view does not fit the
  lattice into the space beside the panel.
- A link holds the lattice. The README's image of the Steiner tree stays: the scene keeps its foods (decision 10).
- Tests: `src/engine/lattice.gpu.test.ts` (both backends: the lattice on 16:9, 1:1 and a phone, also one that is not
  square, and the app's scenes on the screen's grid; a tool paints the cell under the pointer on the lattice, on a copy
  of a periodic lattice and on a lattice that is not square, and nothing beside a dish; the pixels beside a closed
  lattice; Cut, its clearing and Inoculate on a copy and across an edge; the copies' light), `engine-env.test.ts`
  ("lattices": the same bytes on every screen, a lattice that is not square, the frames, rebuilds, memory, out of memory
  for 200 × 200 and 300 × 300 and a wide lattice), `engine.test.ts` (no paused step beside a closed lattice),
  `state.test.ts` (the hint and its button, old links and the card's sentence, the grid picks, a lattice the device
  cannot hold, the startup check's wiring), `tune.test.ts`, `params.test.ts` and `url.test.ts` (sanitize and links),
  `presets.test.ts` (the table above, the hint's text), and `tests/e2e/lattice.spec.ts` (both backends: the hint, its
  button, the focus and the link; the pointer on 1280 × 720 and 375 × 812; the app's scenes without a hint; an old link;
  a lattice the device cannot hold, from a link and of the scene). Each new test fails with a mutation of the code it
  guards (22 mutations with the first version, 22 with the review's fixes, in the pull request). On SwiftShader on an M3
  Pro (macOS), beside other work, each new GPU test took at most 26.8 s and gets 240 s, the hook that builds both
  backends about 24 s of 360 s, and each new e2e test at most 39.8 s of its 240 s on CI: every limit lies at least 4
  times above the time (ADR 0010).
- The view's uniform holds the brightness of the copies in its third `fx` value, which was unused.

## Amendment 2026-11-11: the corrections of the fidelity check (ADR 0027)

The later change that this ADR names came with ADR 0027: Jones' order of a step, Jones' dish of 0.945 of the short
side, absorbing closed edges, and the foods of Fig. 18, 19 and 21 with a revision of a scene's shapes that links hold
(decision 2: an old link opens with the shapes it was made with). The dish of this ADR (the side less 2 cells) and the
Steiner tree of decision 10 are replaced there; the measurements above stay the record of the code before.
