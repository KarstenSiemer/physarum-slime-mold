# 0027: The model as in Jones' papers: step order, dish, boundaries and the figures' foods

- Status: accepted (owner decisions of 2026-11-11: the scenes of Jones work exactly as in his papers, and the
  corrections apply to both models)
- Date: 2026-11-11

## Context

A fidelity check of 2026-11-11 compared the eight scenes of Jones 2010 (J. Jones, Characteristics of pattern
formation and evolution in approximations of Physarum transport networks, Artificial Life 16(2): 127–153) with the
images of their figures, each on the lattice of its figure (ADR 0026), and with a reference simulator written from the
paper's text. Page numbers are those of Jones 2010 unless a line names another paper. Three scenes matched: the
Transport network (Fig. 4: 8 lacunae at step 4,151, the app 6.4 ± 0.9), the Minimizing network (Fig. 5) and the Turing
stripes (wavelength 16.2 against 15.7 cells, one orientation over 85.5 against 84.6 % of the grid). The others
deviated, each for a cause in this app's model:

- **The order inside a step.** Jones: every agent moves and deposits (the motor stage), then every agent senses and
  turns (the sensory stage), then the trail map diffuses (p. 132–133). This app sensed first, then moved, then
  diffused (`src/engine/sim.ts` at `cf279c4`, lines 611, 631 and 653): its sensors read the map after the diffusion,
  Jones' read it after the moves and before the diffusion. With Jones' order the Turing spots of Fig. 16 form a regular
  array (spacing variation 5.6 % at step 10,000 and 4.4 % at 30,000, against 10.5 % with this app's order; 5.7 % in the
  figure).
- **The dish.** The images of Fig. 18 and 19 show a dish of 0.947 and 0.944 of the lattice's side. The app's dish was
  the side less 2 cells (0.993 on 300 × 300). Jones counts his population over the lattice (%p, p. 134; 45,000 agents
  for %p 50 on 300 × 300, p. 147), so 45,000 agents filled 64.5 % of the app's dish against about 71 % of Jones'. The
  thinner sheet of Shrinking plasmodium (Fig. 21) tore around its middle food in 18 of 31 runs; with Jones' dish in 0
  of 31.
- **Diffusion at the rim.** The app's mean was reflective: at walls and at the rim of a closed arena it averaged over
  the habitable cells only, so no trail left the arena (ADR 0007). Jones' later papers absorb the chemoattractant at the
  edges (Jones 2011, Influences on the formation and evolution of Physarum polycephalum inspired emergent transport
  networks, Natural Computing 10: 1345–1369, p. 1353) and run the mean filter at every lattice site (Jones and
  Adamatzky 2014, arXiv:1303.4969, p. 23; Jones 2015, arXiv:1503.03265, p. 14; Jones, Mayne and Adamatzky 2017,
  arXiv:1511.05862, p. 25). Fig. 18 fits an absorbing rim: the trail fades about 4.5 cells inside it, and no trail
  stays at the rim later. With the reflective rim, Shortest path kept a branch to the rim in 2 of 20 runs; absorbing,
  in 0 of 20. A growing colony coats the walls for the same cause (the growth analysis of 2026-11-11: within 4 cells of
  a wall, 7 % of the open cells, 71 % of the agents at step 15,000 on 16:9, 10.5 % when the walls absorb).
- **The foods.** Fig. 19 shows a square of 60 cells (0.317 of the dish) with foods of about 2.7 cells; the app had
  0.29 of the dish with foods of 4 cells, and a ring stayed in 10 of 20 runs. Fig. 21 shows 19 foods; the app had 8.
  Fig. 18 puts its foods 51 cells left and right of the middle; the app 57.6.

Jones' sequential order of the agents (p. 133) against this app's synchronous claims (ADR 0008) is a real difference,
but with the four corrections above no figure needs it (the fidelity check). It stays the documented difference of
ADR 0008.

The owner's rule of 2026-11-11: the scenes of Jones work exactly as in his papers ("Jones-Presets … genau so wie aus
seinen Papers"), and a deviation from Jones means there is an error somewhere. Asked whether the corrections also
apply to the extended model, the owner decided on 2026-11-11: "Ja, beide Modelle" (yes, both models). The reason
given: the extended model is Jones plus this app's additions; the step order and the reflective walls are not intended
additions, and the reflective walls make a growing colony coat the walls.

## Decisions

Each decision with its date, who made it, and why.

### Step order

1. **Jones' order of a step, in both models and on both backends** (owner, 2026-11-11). Every agent moves and
   deposits, then every agent senses and turns, then the map diffuses and decays (p. 132–133).
2. **The textures hold the map as the agents sense it** (this branch, 2026-11-11). A step of the GPU senses and turns
   for the moves of the step before, moves, then diffuses and decays the map, and its last diffusion pass adds the
   deposits and the food and light of this step's moves (`diffuse.wgsl`, `diffuse.frag`: the sources moved from the
   first pass, before the mean, to the last pass, after the decay). The sensors of the next step read exactly Jones'
   map after the motor stage: the last diffusion plus the new deposits. Options: (a) the fidelity check's patch for
   WebGPU: the claim pass reads the trail texture of before the last diffusion plus `counts` and `env` of the last
   step, and `counts` is cleared between `claim` and `settle`; (b) a third pass that senses after the moves; (c) this
   one. (a) works only with one diffusion pass (with two, the second pass overwrites the texture it needs) and with the
   rule of one agent per cell (without it, `advance` senses and deposits in one pass, so it would read the counts it
   writes), and it repeats covered food and the cut in every sensor. (b) costs a pass over all agents. (c) adds no
   pass, no texture and no read in a sensor, works for every number of diffusion passes, with and without the rule,
   and keeps covered food, the cut, light, trail saturation and the sensor walk of ADR 0020 where they were. Reason:
   the correct order at no cost.
3. **The first step after a reset moves without sensing** (this branch, 2026-11-11; `sensesFirst()` in
   `agents.wgsl` and `agents.frag`). Jones' first step moves with the start heading; a step here senses for the moves
   before it, and the first step has none. Without this an agent would sense the empty map once: a sensor in a wall or
   outside the arena would turn it, and the random turn pCD would draw. Reason: Jones' first step exactly. Tests that
   write a trail and agents to see one sensing step now run a first step before (`pastFirstStep()` in
   `sim.gpu.test.ts`).
4. **Food and light enter with the deposits, before the sensors** (this branch, 2026-11-11). Jones projects the stimuli
   into the trail map (p. 144) but does not say where in the step. They enter where the deposits enter, after the step's
   diffusion, so the sensors read them with the deposits. The fidelity check measured the scenes with this choice.
   Covered food counts the agents after the step's moves, as before (ADR 0022, decision 20).
5. **The normalised emission keeps the plateau of a large food at every decay** (this branch, 2026-11-11, from ADR 0022
   decision 13). With Jones' order the scent of a large food settles where s = (1 − d) · s + source, so s = source / d,
   not source · (1 − d) / d. `emissionScale()` (`src/model/params.ts`) is now d / 0.1, so the plateau is 255 · strength
   · 10 at every decay. It is exactly 1 at 0.1 as before, so no scene changes by it. Outside a static food the scent of
   Jones' order equals the scent of the old order: with Q = s − source the new step is Q′ = (1 − d) · M(Q + source),
   the old one. So the old factor would have kept the scent outside a food as it was and let the plateau vary by
   0.9 / (1 − d) (−10 % at decay 0.001); the new factor keeps the plateau and makes the scent outside a food
   (1 − d) / 0.9 of before (+11 % at decay 0.001). Decision 13 names the plateau, so the plateau it is. Owner question
   (below).

### Dish

6. **Every dish is 0.945 of the grid's short side, in both models** (owner, 2026-11-11, with the rule above; the fidelity
   check measured 0.947 in Fig. 18 and 0.944 in Fig. 19, so 0.945 lies between them). `DISH_FILL` in `common.wgsl`,
   `common.glsl`, `render.wgsl`, `view.glsl` and `src/engine/brush.ts` (`dishRadius()`), which the sweep, the brush,
   the CPU paint reference and the tests use; `render.frag` takes it from `view.glsl`, and the CPU copy of growth
   (`growth-reference.ts`, from main's merge of ADR 0025) from `brush.ts`. A unit test (`pack.test.ts`, "the dish")
   checks that every shader holds the same value and that no rim of the old formula is left; the copy's GPU test
   fails in the dish on both backends with the old rim. Before, the
   rim lay at half the short side less 1 cell (ADR 0019). Options the check listed: 0.945 for every dish; 0.92; 0.945
   only on Jones' lattices; the old dish with density 0.6 for Shrinking plasmodium. The owner's rule decides: a dish is
   Jones' dish, whatever grid it runs on.
7. **The agent count stays Jones' %p of the square around the dish** (this branch, 2026-11-11; `agentCount()`,
   unchanged). Jones counts his population over the lattice (p. 134), and 45,000 agents for %p 50 on 300 × 300 (p. 147)
   is the count of Fig. 21. In Jones' dish they fill 71 % of the cells (64.5 % of the old dish). The food positions
   keep their frame, the short side (ADR 0019), so no food moves with the rim, and a link keeps its strokes in that
   frame. A stroke of an old link that reached past 0.945 of the side now paints only its cells inside the new rim.
8. **64 claim rounds at the start** (this branch, 2026-11-11; `START_ROUNDS` in `src/engine/pack.ts`, before 32).
   Jones starts every agent on a free cell (p. 132). In a claim round a waiting agent finds a free cell with about the
   share of the free cells, so N · f^n of N agents still wait after n rounds at the filled share f. At 71 % and 32
   rounds, 0 to 2 of Shrinking plasmodium's 45,000 agents started dead in 15 of 61 seeds on WebGPU and 13 of 61 on
   WebGL2 (seeds 0 to 60); with 64 rounds none in 61 seeds on either backend. A round is one claim and one settle pass
   over the agents at a reset, only in an arena with the rule that is not a periodic or box grid with the mixed layout
   and no walls. A GPU test starts Shrinking plasmodium with seed 6, which left 2 agents dead with 32 rounds.

### Diffusion at closed edges and walls

9. **Closed edges absorb, in both models** (owner, 2026-11-11). Jones absorbs the chemoattractant at the edges (Jones
   2011, p. 1353), and Fig. 18 fits an absorbing rim. The mean is now always the sum of 9 cells divided by 9; a cell
   outside the arena (the box's edge, the dish's rim, the edge of a closed lattice) counts as 0 and holds 0. Before, the
   mean divided by the habitable cells of the 3 × 3 (reflective, ADR 0007). The fidelity check measured the effect on
   Shortest path: a side branch to the rim beyond r = 85 of the 99-cell dish in 2 of 20 runs before, in 0 of 20 with
   either absorbing rule. Its reference simulator, written from the paper, also tried a third rule (the trail spreads
   outside the dish up to the lattice's edge): Shrinking plasmodium tore in 10 of 31 runs there, 17 of 31 absorbing and
   19 of 31 reflective, all with the old dish; the dish was the cause of the tears (decision 6).
10. **Walls in the Jones model are part of the diffusing lattice** (owner, 2026-11-11, "literal Jones"). Jones' later
    papers run the mean filter at every lattice site (Jones and Adamatzky 2014, p. 23; Jones 2015, p. 14; Jones, Mayne
    and Adamatzky 2017, p. 25). A wall cell takes the mean of its 9 cells and decays like any cell, and takes no deposit
    (no agent enters it) and no food or light. The growth analysis of 2026-11-11 measured this rule as "T". Jones'
    papers have no wall that reflects.
11. **Walls in the extended model are sinks** (owner, 2026-11-11). A wall cell holds 0 and counts 0 in the means of its
    neighbours, as the outside does, so no trail or scent passes a thin wall. This matches the extended model's sensors,
    which a wall on their way blocks (ADR 0020): neither the sensor nor the trail reaches the other side of a wall. The
    growth analysis measured this rule as "A": the share of a growing colony's agents within 4 cells of a wall fell from
    71 % (reflective) to 10.5 % on 16:9.
12. **Food and light follow the trail's rule in each model** (owner, 2026-11-11). The scent field takes the same means
    over the same cells, so in the Jones model trail + scent stays Jones' one map (ADR 0022) also at edges and walls.
13. **A wall is a wall for the sensors in both models, as before** (this branch, 2026-11-11). In the Jones model a wall
    cell now holds trail, but a sensor in a wall cell still reads `BLOCKED` (ADR 0007): Jones does not say what a sensor
    in an obstacle reads, and ADR 0020 rejected sensors that read the trail behind a wall. Only the diffusion changes.
14. **One uniform for the wall rule** (this branch, 2026-11-11). `packParams()` packs 1 in `model.z` for the Jones model
    and 0 for the extended model (`src/engine/pack.ts`); `diffuse.wgsl` and `diffuse.frag` read it per cell. Reason: the
    rule is the model's, and an override constant would double the diffusion pipelines for a branch that costs nothing
    measurable (below). No scene of Jones has walls, so the Jones rule acts only where a user paints a wall into a
    scene of Jones.

### The figures' foods

15. **The foods of Fig. 18, 19 and 21** (owner, 2026-11-11, with the rule above; the positions measured in the figures
    by the fidelity check). Shortest path (Fig. 18): 51 cells left and right of the middle of 200 × 200 (±0.255 of the
    side), radius 4 cells as before; before ±57.6 cells. Steiner tree (Fig. 19, second row): a square of 60 cells
    (±0.15 of the side, 0.317 of the dish's 189 cells) with foods of 2.7 cells (0.0135 of the side); before 58 cells
    with foods of 4 cells. Shrinking plasmodium (Fig. 21): the 19 foods of the figure, at the cell positions measured in
    it on 300 × 300, each `(x − 150) / 300` of the side from the middle; before 8 foods of this app's choice.
16. **Shrinking plasmodium's food radius of 2.5 cells and weight 0.05 are this app's choice** (this branch, 2026-11-11).
    Fig. 21 shows the trail, not the food cells, and the text gives neither. The fidelity check measured 0 of 31 runs
    torn with weight 0.01 and with 0.05; 0.05 stays, the scene's value before. A radius of 2.5 cells around a lattice
    corner paints 16 cells, the same as its first version's 2.49 cells.
17. **The scene texts say what the scenes now show** (this branch, 2026-11-11, from the measurements below): Steiner tree
    ends as a tree through the middle of the square with two junctions and a short bridge, as in Fig. 19, row 2; Turing
    spots settle as a regular array of about 20 spots; Shrinking plasmodium no longer tears; Shortest path keeps no
    branch to the rim.

### Links keep the shapes they were made with

18. **Shape revisions** (owner, 2026-11-11, from ADR 0026 decision 2; the design proposed by the lattice branch). A link
    names a scene's shapes by the scene's id and one bit each (ADR 0021), so moving a scene's foods would make an old
    link paint other foods than its sender had. Each preset keeps its earlier shape lists, oldest first
    (`envHistory` in `src/model/presets.ts`); `env` is the newest. Revision 0 is the list of every scene when links
    began to name shapes on 2026-11-10 (`9c1f56a`); a check of the presets at `9c1f56a`, `12c7078`, `45155a8` and
    `f81c4a3` found every list unchanged until this change. Shortest path, Steiner tree and Shrinking plasmodium now have
    revision 1. `shapeRevision()` gives a scene's newest revision and `shapesAt()` the shapes of one.
19. **Link format version 2** (this branch, 2026-11-11; `src/model/link.ts`). After the scene's id it writes the revision
    as a varint. A link of version 1 means revision 0. The decoder refuses a revision that the scene does not have and a
    count of shapes other than the revision's, as it refused a wrong count before; the drawing is then lost and the
    settings load alone, with the notice of ADR 0021. Without a scene no revision is written. `Drawing.revision` holds
    it; `drawingOf()`, `kindsOf()`, `sceneOnly()`, `waiting()`, `currentDrawing()` and the engine's match
    (`Engine.matches()` with the shapes of that revision) read it.
20. **An old revision is a change of the scene** (this branch, 2026-11-11; `app.sceneRevision` in
    `src/ui/state.svelte.ts`). The app keeps the revision that the engine's list holds: the newest after a preset load or
    Reload scene, a link's own after the link. While it is not the newest, the scene card counts the scene as changed:
    it says "This link changes the scene." while the link is as opened (ADR 0026, decision 14), and Reload scene loads
    the newest shapes. The address keeps writing the link's revision, so a reload paints the same shapes.
21. **An old link keeps its settings and its shapes, not the engine's old rules** (owner, 2026-11-11: the model change
    applies to both models). Old links run with Jones' order, Jones' dish and the new boundaries, so they no longer give
    the bytes they gave when they were made, also on the sender's grid (ADR 0021 promised those bytes). A stroke of an old
    dish link that reached past 0.945 of the short side now paints only its cells inside the new rim. No setting brings
    the old rules back.

### What the view shows

22. **The view shows the map as the agents sense it** (this branch, 2026-11-11). The textures hold the map after the
    step's moves and before its diffusion (decision 2), and the renderer, the auto levels and `Sim.readTrail()` read them
    as they are: fresh deposits show undiffused. Options: (a) this; (b) a pass per frame that writes the diffused map
    for the view (a pass more per frame); (c) the mean in the render pass (nine taps per bilinear tap). The images of
    Jones' figures are grainy at the scale of single agents (Fig. 16 next to the app's map before and after its
    diffusion, the comparison images of the pull request), so (a) is also the closer picture. The scenes of Jones look
    grainier than before at their lattices' scale (the contact sheets), and the app's scenes keep their character, apart
    from the two scenes below. The metrics of this ADR run on Jones' map after his diffusion, computed from the dumps:
    (1 − decay) times the mean of 9 cells, as the fidelity check measured.

### Both backends alike

23. **The last diffusion pass multiplies the sum of 9 cells by (1 − decay) / 9** (this branch, 2026-11-11). Before this
    change WebGPU and WebGL2 gave the same trail after 500 steps for the default settings, Two strains, Dunes and Dot
    grid (digests of the agents by id, the trail and the scent, seed 7, M3 Pro); with Jones' order they still did. The
    mean of 9 cells over 9 broke it: a CPU replay of two steps of Dunes showed that Metal's compiler turns the WGSL
    `sum / 9.0` followed by `× (1 − decay)` into `sum × round((1 − decay) × round(1 / 9))`, while the GLSL rounds after
    the mean and again after the decay. Both now write that product out (`diffuse.wgsl`, `diffuse.frag`). WebGPU kept its
    bytes, and WebGL2 gives them again for those four scenes; the others differed between the backends before too. The
    passes before the last one divide by 9 alone, and both backends compute that as × round(1 / 9).

## Measurements

### The scenes of Jones against their figures

Built as the app builds a scene (`Engine.create` and `Engine.load` on a canvas of 1280 × 720), on the lattice of the
figure, Apple M3 Pro, with the seeds of the fidelity check: WebGPU at the commit of the foods (`f1fbb42`), whose bytes
the head of this branch keeps for every scene of Jones (digests at step 500), WebGL2 again after decision 23 changed
its bytes (`8e33876`, the bytes of the head). The dumps hold the map
as the agents sense it; the metrics run on Jones' map after his diffusion (decision 22). The network of a dish scene is
the trail above the mean of the dish; a lacuna is a part of the rest of at least 20 cells, not open to the rim; a tree
or a band touches every food, holds no lacuna and stays off the rim; a spot of Fig. 16 is a minimum of the trail blurred
over 0.12 of the wavelength (the fidelity check's discs, with the nearest-neighbour spacing and its variation, and ψ6
over the 6 nearest spots). The figure's values are the fidelity check's, measured in the images of Jones 2010. "Before"
is the code before this change, as ADR 0026 and the fidelity check measured it.

| Scene, property                                               | Figure             | Before                                        | After, WebGPU                  | After, WebGL2                  |
| ------------------------------------------------------------- | ------------------ | --------------------------------------------- | ------------------------------ | ------------------------------ |
| Transport network, lacunae at 99 / 512 / 1,740 / 4,151        | 56 / 23 / 12 / 8   | 4,151: 6.4 ± 0.9                              | 50.4 / 24.5 / 12.0 / 6.7 ± 0.6 | 50.9 / 26.1 / 11.1 / 6.6 ± 0.9 |
| Minimizing network, lacunae at 670 / 4,072 / 31,190           | 18 / 6 / 1         | 31,190: 1.6 ± 0.5                             | 22.2 / 7.4 / 2.0 ± 0.4         | 22.7 / 6.6 / 1.6 ± 0.9         |
| Turing stripes, wavelength; one orientation at 20,000         | 16.2; 85.5 %       | 15.7; 84.6 %                                  | 15.7; 82.6 ± 1.1 %             | 15.7; 82.0 ± 2.9 %             |
| Turing spots at 10,000: spots, spacing variation, ψ6          | 20; 5.7 %; 0.87    | 10.5 % (variation)                            | 19.7; 6.6 %; 0.85              | 19.6; 5.9 %; 0.86              |
| Turing spots at 30,000: exactly 20 spots, variation, ψ6       |                    | 28.7 % (ADR 0026's metric of blurred maxima)  | 28 of 30; 3.6 %; 0.88          | 28 of 30; 4.6 %; 0.85          |
| Shortest path, one band without a loop, steps 3,000 to 12,000 | one band           | 2 of 20 with network beyond r = 85 (old dish) | 20 of 20, none beyond r = 80   | 20 of 20, none beyond r = 80   |
| Steiner tree, a tree at 3,000 / 6,000 / 12,000 (20 seeds)     | an X, short bridge | rings in 10 of 20 (old foods)                 | 15 / 20 / 20 of 20             | 15 / 20 / 20 of 20             |
| Shrinking plasmodium, torn by 2,800 (31 seeds); IoU at 10,000 | not torn           | 18 of 31; 0.41                                | 0 of 31; 0.84                  | 0 of 31; 0.85                  |
| Wound healing, spacing variation at 2,650 (20 seeds)          | about 3 to 5 %     | 10.8 %                                        | 9.3 ± 3.4 %                    | 8.8 ± 3.5 %                    |

- Every scene keeps its pattern's size in cells (stripes 15.7 to 15.8 cells, spots 43.4 to 43.7 cells apart).
- The Transport network's lacunae follow Fig. 4 over its whole course. The Minimizing network ends with 1.6 to 2.0
  lacunae at step 31,190, Fig. 5 with 1.
- Steiner tree at step 12,000: two junctions with a bridge of 5 to 30 cells in 20 of 20 runs on WebGPU and 19 of 20 on
  WebGL2 (one run whose skeleton shows no junction); 14 of 20 and 14 of 19 bridges are 10 to 15 cells long, as in
  Fig. 19, row 2.
- Shrinking plasmodium: 22,318 ± 96 agents alive at step 2,800 of 45,000 on both backends; the largest enclosed void by
  step 2,800 has 295 cells (WebGPU) and 309 cells (WebGL2), a tear has at least 1,000.
- Wound healing stays less regular than the figure. Its variation is 8.8 to 9.3 % against about 3 to 5 % in the JPEG of
  Fig. 22, and 10.8 % with this app's order. It stays an open item (TODO.md); its cause is not found.

### The app's own scenes

Contact sheets of main and this branch (WebGPU, 1280 × 720, seed 7, steps 500 and 3,000; in the pull request). The
default settings, Three strains, Two strains, Fleeing light, the Maze and Cyclones keep their character. Two scenes of
Fogleman 2020 do not: in Dunes strain B no longer gathers into dots (on main the top 1 % of its cells hold 48 to 61 % of
its trail, now 4 %, a haze), and its ridges break into fewer pieces; in Dot grid strain B's lattice of dots goes and
strain A's streaks become round spots (top 1 % share 70 % against 31 %). Cyclones keeps its honeycomb and its
vortices, with more of them (17.4 and 11.4 at steps 3,000 and 10,000 against 11.0 and 7.8; 5 seeds, 1024 × 576). These
scenes run on a periodic grid without walls or food, so their only change is the step order: Fogleman's code senses,
moves and deposits, then blurs (`knowledge-base/variants.md`), the app's order before, and the two affected strains
sense only 1.3 and 1.7 cells ahead. A step order per scene of the extended model, with Fogleman's order for his scenes,
gives their statistics back (prepared, not in this branch; owner question below). The scenes of Jones sparkle in the
glow style: each agent's fresh deposit is a bright point (decision 22; owner question below).

### Growth after the merge of ADR 0025

Growth and shrinkage (ADR 0025) came in with the merge of main on 2026-11-12. Its passes run after the moves and their
deposits and before the diffusion (`sim.ts`, `gl/sim.ts`), so its tests count the occupancy after the moves, and the
agents sense after them in the next step, as before. The CPU copy of its passes (`growth-reference.ts`) needed Jones'
dish (decision 6). The merge keeps the bytes of every scene and of the default settings on both backends (digests of
the agents, the trail, the scent and `env` at step 500, before and after the merge).

Measured with the harness of ADR 0025 (D1, D1b): built as the app builds the scenes, the flood fill of ADR 0019 every
100 steps, seeds 1 to 10, 15,000 steps, M3 Pro. Both orders of a step: "move first" is this branch (decision 1),
"sense first" the order of Jones 2011 and later and of Fogleman (prepared, owner question below), each with the dish
and the boundaries of this ADR. "Near a wall" is the share of the agents within 4 cells of a wall or the box's edge at
step 15,000, the median of the seeds.

**The Foraging maze** (ADR 0025, decision 30, D1b), the start flow and the owner's flow of a hold of Inoculate at step
100 or 1,000:

| Backend | Flow               | Screen | Move first: path, steps (median) | Near a wall | Sense first: path, steps (median) | Near a wall | Agents at 15,000 (both) |
| ------- | ------------------ | ------ | -------------------------------- | ----------- | --------------------------------- | ----------- | ----------------------- |
| WebGPU  | start              | 16:9   | 10 of 10, 2,801 to 4,101 (3,201) | 38 %        | 10 of 10, 2,501 to 3,601 (3,101)  | 38 %        | 15,415 to 16,655        |
| WebGPU  | start              | 16:10  | 10 of 10, 2,901 to 4,401 (3,451) | 38 %        | 10 of 10, 2,801 to 4,101 (3,251)  | 37 %        | 17,006 to 18,751        |
| WebGPU  | start              | 1:1    | 10 of 10, 3,501 to 5,201 (4,351) | 33 %        | 10 of 10, 4,001 to 5,201 (4,801)  | 33 %        | 25,445 to 28,165        |
| WebGPU  | inoculate at 100   | 16:9   | 10 of 10, 3,520 to 4,720 (3,620) | 38 %        | 10 of 10, 3,020 to 3,920 (3,520)  | 37 %        | 15,460 to 16,913        |
| WebGPU  | inoculate at 100   | 16:10  | 10 of 10, 2,920 to 4,620 (3,620) | 37 %        | 10 of 10, 3,020 to 4,420 (3,570)  | 36 %        | 16,408 to 18,501        |
| WebGPU  | inoculate at 100   | 1:1    | 10 of 10, 4,320 to 5,320 (4,870) | 34 %        | 10 of 10, 4,420 to 6,320 (4,670)  | 33 %        | 25,733 to 27,819        |
| WebGPU  | inoculate at 1,000 | 16:9   | 10 of 10, 3,920 to 5,620 (4,470) | 38 %        | 10 of 10, 4,020 to 5,120 (4,470)  | 38 %        | 15,771 to 16,963        |
| WebGPU  | inoculate at 1,000 | 16:10  | 10 of 10, 3,920 to 5,520 (4,870) | 38 %        | 10 of 10, 4,220 to 5,420 (4,770)  | 38 %        | 16,648 to 18,089        |
| WebGPU  | inoculate at 1,000 | 1:1    | 10 of 10, 4,820 to 6,320 (5,470) | 34 %        | 10 of 10, 5,120 to 6,220 (5,470)  | 34 %        | 24,588 to 27,555        |
| WebGL2  | start              | 16:9   | 10 of 10, 2,401 to 3,801 (3,301) | 39 %        | 10 of 10, 2,601 to 3,301 (3,051)  | 36 %        | 15,311 to 17,107        |
| WebGL2  | start              | 16:10  | 10 of 10, 3,001 to 4,201 (3,351) | 37 %        | 10 of 10, 2,601 to 3,701 (3,501)  | 36 %        | 17,098 to 18,513        |
| WebGL2  | start              | 1:1    | 10 of 10, 4,101 to 5,701 (4,301) | 34 %        | 10 of 10, 3,801 to 5,201 (4,651)  | 33 %        | 25,234 to 28,058        |
| WebGL2  | inoculate at 100   | 16:9   | 10 of 10, 2,620 to 4,020 (3,670) | 38 %        | 10 of 10, 2,920 to 4,820 (3,670)  | 38 %        | 15,267 to 16,904        |
| WebGL2  | inoculate at 100   | 16:10  | 10 of 10, 3,420 to 4,420 (3,720) | 37 %        | 10 of 10, 3,120 to 4,320 (3,470)  | 36 %        | 16,456 to 18,996        |
| WebGL2  | inoculate at 100   | 1:1    | 10 of 10, 3,620 to 5,220 (4,470) | 34 %        | 10 of 10, 4,220 to 5,620 (4,570)  | 33 %        | 25,720 to 27,424        |
| WebGL2  | inoculate at 1,000 | 16:9   | 10 of 10, 4,220 to 4,920 (4,670) | 38 %        | 10 of 10, 3,820 to 4,920 (4,370)  | 38 %        | 15,746 to 16,997        |
| WebGL2  | inoculate at 1,000 | 16:10  | 10 of 10, 3,920 to 5,320 (4,620) | 38 %        | 10 of 10, 4,020 to 5,520 (4,670)  | 36 %        | 17,048 to 18,170        |
| WebGL2  | inoculate at 1,000 | 1:1    | 10 of 10, 4,820 to 6,220 (5,770) | 34 %        | 10 of 10, 5,020 to 6,620 (5,820)  | 33 %        | 25,786 to 27,871        |

Every flow reaches the far food in 10 of 10 seeds on every screen, on both backends and in both orders, as in D1b with
the code before (10 of 10, median 2,751 to 3,901 steps in the start flow; now 3,201 to 4,351 move first and 3,051 to
4,801 sense first). The colony settles at the same size (24,588 to 28,165 agents at step 15,000 on 1:1, 15,267 to
18,996 on the wide screens; D1b 24,755 to 27,534 and 14,990 to 18,142), and 33 to 39 % of its agents lie near a wall
(37 to 41 % with SA 22.5° and the reflective walls, ADR 0025's analysis).

**The Maze (SA 45°) with growth from 50 agents** (ADR 0025, D1: start layout Empty, 50 agents on random open cells of
the default brush on the bottom-right food, growth with the values of 2011):

| Code        | Backend | 16:9: path, steps (median)        | Near a wall | 1:1: path, steps (median) | Near a wall |
| ----------- | ------- | --------------------------------- | ----------- | ------------------------- | ----------- |
| Before (D1) | WebGPU  | 10 of 10, 3,200 to 10,000 (5,350) | 71 %        | 0 of 10                   | 80 %        |
| Before (D1) | WebGL2  | 9 of 10, 3,300 to 10,000 (5,200)  |             | 0 of 10                   |             |
| Move first  | WebGPU  | 9 of 10, 7,000 to 15,000 (10,900) | 18 %        | 0 of 10                   | 14 %        |
| Move first  | WebGL2  | 6 of 10, 7,800 to 14,600 (9,800)  | 13 %        | 0 of 10                   | 11 %        |
| Sense first | WebGPU  | 4 of 10, 6,900 to 12,700 (7,950)  | 10 %        | 0 of 10                   | 10 %        |
| Sense first | WebGL2  | 5 of 10, 8,300 to 14,100 (13,400) | 6 %         | 2 of 10, 11,700 to 12,600 | 10 %        |

The colony no longer coats the walls: 6 to 18 % of its agents lie near one, against 71 to 80 % with the walls that
reflected the trail, so the passes of D1 along the walls are gone. Without the coat it reaches the far food on 16:9 in
4 to 9 of 10 seeds and on 1:1 in 0 to 2 of 10: SA 45° is Jones' angle for minimising networks, as ADR 0025's analysis
found, and the Foraging maze, with his foraging angle, is the scene for growth. The Maze ships without growth, so its
text does not change by this.

**The Maze as it ships** (no growth), the path check of ADR 0019 and 0020 (WebGPU, seeds 31 to 42): a path from food to
food at steps 2,000, 5,000, 10,000 and 15,000 in 12 of 12 runs on 16:9, 16:10, 9:19.5 and 1:1, at the threshold and at
half of it, in both orders, as ADR 0020 recorded for the code before. Its text ("still holds at step 15,000, on wide,
tall and square screens alike") stays true. At step 15,000, 1 to 5 % of its agents lie near a wall: they keep off the
walls that take in the trail.

### Cost

Paired in one page on the M3 Pro (this branch's shaders against main's, 24 rounds of 300 steps, the order alternating):
the median ratio of a step's time per round is 1.02, 1.03, 0.99, 0.94 and 1.03 on WebGPU and 0.96, 1.02, 1.01, 0.98
and 0.95 on WebGL2 for the default settings (1536 × 864), Three strains, the Transport network (200 × 200), Shrinking
plasmodium (300 × 300) and the Maze, with rounds from 0.5 to 1.8 of each other. No change shows above that spread.

The old look of the view (decision 22, owner question), on a canvas of 2560 × 1600 at fit: Three strains on 1536 × 960
(4.4 M agents on WebGPU, 4.2 M on WebGL2, 0.6 cells per pixel) and the Transport network on 200 × 200 (0.125 cells per
pixel), medians of 12 to 16 rounds while other jobs shared the machine:

| Way to the old look                                                 | Three strains, WebGPU | WebGL2          | 200 × 200, WebGPU | WebGL2            |
| ------------------------------------------------------------------- | --------------------- | --------------- | ----------------- | ----------------- |
| None (decision 22): the draw                                        | 8.7 to 9.0 ms         | 9.2 ms          | 2.8 to 4.1 ms     | 1.5 ms            |
| (b) a diffusion pass per frame for the view                         | + 1.6 to 2.3 ms       | + 0.1 to 1.3 ms | + 0.04 to 0.07 ms | + 0.03 to 0.05 ms |
| (c) the 3 × 3 mean in the render pass where a cell is above a pixel | 15.5 to 19.8 ms       | 7.8 ms          | 10.2 to 10.5 ms   | 5.7 ms            |

- (b) is exact for every scene with one diffusion pass (the scenes of Jones, the default settings, Two strains) if the
  render pass, the gel's height field, the bloom, the auto levels and the PNG all read the pass's output, which fits in
  the free texture of the ping-pong pair. Three strains and the scenes of Fogleman run two diffusion passes; they need
  two passes per frame and a third trail texture (16 B per cell) to be exact.
- (c) reads 16 trail texels per pixel instead of 4. It is not exact: the bloom, the auto levels and the height field
  still read the sensed map, and zoomed out its 4 taps average the sensed map.
- Neither gives main's pixels: the dynamics differ (this ADR). (b) gives the renderer the kind of map it drew before.

### Tests

- `sim.gpu.test.ts`, both backends: Jones' order (the trail holds the step's deposits undiffused; a sensor reads the
  deposits of the last moves before they diffuse; the first step after a reset moves with the start heading); the
  boundaries (trail, food and light in both models and every arena against a float64 reference of ADR 0027's rules for
  20 steps, and far from the other model's walls and from the reflective mean; outside a dish and in the extended
  model's walls no trail, in the Jones model's walls trail; the wall byte for the sources and the sinks); Jones' one
  map, the scent references, covered food, the plateau and the mass balance in Jones' order; the dish (71 % filled,
  every agent of Shrinking plasmodium placed with seed 6, the moves and sensors past a wall byte outside a 64 × 64
  dish, the rim drawn and the outline of food straight up to the rim at 64 pixels per cell).
- Unit: `pack.test.ts` (one `DISH_FILL` in every shader, no rim of the old formula, the wall flag, the emission
  factor), `brush.test.ts`, `sweep.test.ts` and `engine-env.test.ts` (the geometry at the new rim, found again by
  search), `link.test.ts` (revisions in the bytes, version 1 as revision 0, refused revisions and counts, kinds by
  revision), `state.test.ts` (an old link paints its 8 foods until Reload scene), `presets.test.ts` (Fig. 19's foods,
  the texts), `environment.test.ts` (revision 0 against the fractions of before).
- e2e: an old link of Shortest path paints its foods of revision 0, and Reload scene those of Fig. 18.
- On SwiftShader on the M3 Pro (`--use-webgpu-adapter=swiftshader`, `--use-angle=swiftshader`) the new and changed GPU
  tests took at most 5.6 s (Jones' one map in a box, WebGL2, which has a limit of 120 s); every other new test at most
  3.1 s of 60 s. At the four times of CI (ADR 0010) none passes a quarter of its limit, so no limit changes.

### Mutations

Each new rule was broken on purpose, one at a time, and the tests named for it run (`vitest -t`); 37 mutations:

- killed (35): the deposits added before the decay, and before the mean (the old order), on each backend; the first
  step that senses, on each backend; the old emission factor (unit and GPU); the dish's radius of before in
  `common.wgsl`, `common.glsl`, the render rim of `render.wgsl` and `render.frag`, the outline lookups of `render.wgsl`
  and `view.glsl`, `brush.ts`, and a `DISH_FILL` of 0.95 in one shader; 32 start rounds; the reflective mean, the
  walls of the other model and the outside that keeps its trail, each on both backends; the wall flag left out of
  `pack.ts` (GPU and unit); sources in Jones' walls on both backends; a version 1 link read as the newest revision; the
  revision left out of the bytes; `kindsOf()` with the newest shapes; the card without the old revision; `waiting()`
  with the newest shapes; `openLink()` without the link's revision; `drawingOf()` without the revision; the old rim in the CPU copy of
  growth (`growth-reference.ts`).
- survived (2): the near-rim threshold of `shapeCells` in `render.wgsl` and `render.frag` with the old rim. It only
  chooses between two ways of reading the same cells; a probe of 4 views across the rim, 3 styles and both backends
  found no pixel that changed, so the mutation is equivalent there.

## Not changed

- **Jones' sequential order of the agents** (p. 133) against the synchronous claims of ADR 0008. The fidelity check
  found no figure that needs it after the four corrections, and the measurements above agree. ADR 0008 keeps it as the
  documented difference (amended).
- **Wound healing's remaining irregularity** (8.8 to 9.3 % against about 3 to 5 % in Fig. 22) stays an open item in
  TODO.md; its cause is not found.
- **Sensors in walls** read `BLOCKED` in both models (decision 13).

## Open for the owner

- **The order of a step for the scenes that do not come from Jones 2010** (found on 2026-11-12). Jones' papers
  differ. In Jones 2010 every agent moves, and then the whole population senses (p. 133). In Jones 2011 the motor stage
  follows the sensory stage (Nat. Comput. 10, p. 1350), and so it does in his later papers (arXiv:1503.03265, 2015;
  arXiv:1511.05862, 2017, with Mayne and Adamatzky). Fogleman's code senses first too. Sense first, then move and
  deposit, then diffuse, is the order of the code before this change. In Jones' order Dunes and Dot grid lose their
  dots (above); the Foraging maze passes in both orders (above). Options: move first for every scene (this branch); a
  step order of the extended model that follows each scene's paper, carried by links: move first for the eight scenes
  of Jones 2010, sense first for the Foraging maze, the scenes of later papers and the scenes of Fogleman, and the
  default settings and the app's own scenes in one of the two (prepared: it gives Fogleman's scenes their statistics
  back and, on WebGL2, main's bytes); or retune or drop the two scenes of Fogleman. Their texts stay as they are until
  then.
- **The sparkle of the scenes of Jones in the view** (decision 22): keep the map as the agents sense it, or show the map
  after the diffusion as before (a pass per frame, or a mean in the render pass; Cost, above). Jones 2010 does not say
  whether an image shows the map before or after a step's diffusion: it takes images "at notable times" of the
  diffusing trail map (p. 134), its captions count scheduler steps (Fig. 4, p. 134), and the diffusion follows every
  system step (p. 132).
- **The emission factor** (decision 5): d / 0.1 keeps the plateau of a large food at every decay, as ADR 0022's decision
  13 asks; the old factor would keep the scent outside a food as it was and let the plateau fall by up to 10 %.

## Consequences

- The eight scenes of Jones match their figures where the fidelity check found them off (the table above); Wound
  healing stays less regular than Fig. 22.
- Every scene changes its bytes on both backends, and so does every link, old ones too (decision 21). WebGPU and WebGL2
  give the same trail as each other where they did before (decision 23).
- No pass, texture or buffer is added; the diffusion pass reads `env` and `counts` once per output cell instead of per
  tile cell (WebGPU) or per tap (WebGL2).
- Links have version 2; an app from before this change refuses them and loads their settings alone, with its notice.
