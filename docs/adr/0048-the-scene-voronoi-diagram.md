# 0048: The scene Voronoi diagram, measured against the diagram and against a paper's figures

- Status: accepted (decision of a helper, 2026-11-15, under the owner's delegation of 2026-11-12; the coordinator
  asked for the scene and the measurement), built 2026-11-15
- Date: 2026-11-15
- Extends ADR 0026 (the scenes of Jones on their lattices), ADR 0037 (links to the figures of the papers), ADR 0044 (a
  repellent source in the Jones model) and ADR 0046 (the mean window): the first scene with light as the repellent,
  and the second with a mean over more than 3 × 3 cells, after the scene Electrotaxis of ADR 0047.

## Context

The Jones model has a repellent source (ADR 0044) and a mean over more than 3 × 3 cells (ADR 0046). No scene used
them when this work began, and ADR 0044 says: "no run compares a repellent with a figure of Jones' papers". The scene
Electrotaxis (ADR 0047), built at the same time, uses both with its electrodes.

J. Jones and A. Adamatzky, "Slime mould inspired generalised Voronoi diagrams with repulsive fields", 2015,
arXiv:1503.06973, has such figures. I read the owner's copy (v1) on 2026-11-15. Page numbers are those printed there.

What the paper states:

- p. 7: growth and shrinkage. An agent that moved divides with 1 to 10 agents in its 9 × 9 window; an agent survives
  with 0 to 24 agents in its 5 × 5 window; both tests every 3 steps. Sensor distance 5, sensor and rotation angle
  60°, a step of 1 cell, a deposit of 1.
- p. 7, Sec. 4.1: attractants are sources above 0 and repellents sources below 0 in the one lattice. The mean has a
  kernel of size Dw, "typically 5×5", and the result is multiplied by 1 − Dd, Dd "typically 0.1".
- p. 8, Sec. 5.2, and Fig. 10 (p. 10): a dish with seven repellent sources inside and attractant sources at its
  border, and a uniform sheet of agents. The sheet becomes the Voronoi diagram of the seven sources.
- p. 8, Sec. 5.1, and Fig. 7 and 8 (p. 9): a path between two attractants bends away from a repellent placed beside
  it, more with each further repellent, and returns when the repellents are removed.
- p. 11 to 16, Fig. 13 to 16: a weaker repellent gives a hybrid of the Voronoi diagram and a short network. Fig. 14
  names node weights of 0.005 to 0.7.

What the paper does not state: the lattice, the size and the strength of a source, the number of agents, the number
of steps, and how a weight becomes a value. It has no number for how well a network fits the diagram.

The organism side (p. 3, Sec. 2.1, Fig. 2): a plasmodium in a round arena with repellents on it and attractants at
the border adapts its network and approximates the Voronoi diagram (from Shirakawa et al. 2009 and Shirakawa and
Gunji 2010, which I did not read). No number.

The licence: arXiv holds the paper under its non-exclusive licence (`docs/knowledge-base/papers.md`). So the app may
link a figure and may not show it (ADR 0037).

## Options

1. No scene; only a script that runs the paper's values.
2. A Jones scene for Fig. 10, with a research script that compares its network with the Voronoi diagram.
3. Also a brush with a hard edge, so that a dot is the paper's 3 × 3 cells.
4. Also a second scene for the deflected path of Fig. 7 and 8.

## Decision

Option 2. Options 3 and 4 are not built; the measurements below say why. The choices are mine.

1. **The scene** `voronoi`, "Voronoi diagram", in the group Experiments, on the Jones model, with the paper's values
   above, a mean window of 5 and the decay of 0.1. Sense first, as every scene outside Jones 2010 (ADR 0027).
   Capacity 1: the paper has no limit on the population. No glow, as in the network scenes.
2. **The lattice is 239 × 239 cells.** The paper names none. Its Fig. 6a and 10 are pictures of 267 × 253 pixels with
   a dish of 225 pixels across, a ring of 3 pixels and dots of exactly 3 × 3 pixels, so I take one pixel as one
   cell. The app's dish is 0.945 of the side (ADR 0027): on 239 cells it is 225 cells across, and its centre is the
   centre of a cell, as in the figure. The grey ground around the figure's dish is closed, so its size changes nothing.
3. **The ring** is food: 72 strokes with a radius of 1.5 cells along a circle of 111 cells (2,100 cells; the figure's
   ring has about 2,134 pixels). It lies inside the dish, whose radius is 112.9 cells.
4. **The dots** lie where Fig. 6a has them: a hexagon around one dot, 3 to 4 cells off the centre of the dish
   (`VORONOI_DOTS` in `src/model/presets.ts`).
5. **A dot is a smooth dab with a radius of 2.5 cells. No brush with a hard edge.** The light brush has a smooth edge
   (`docs/model.md`, 6.7). With a radius of 2.5 cells the bytes of a dab sum to 2,243, against 2,295 for 3 × 3 cells
   of 255. The harness wrote the hard dots into the environment and ran both (10 seeds each): 0.87 against 0.88 of
   the network on an edge, the whole diagram in 10 of 10 runs each. What counts is the sum: a smooth dab of the
   paper's size (radius 1.5, 749 bytes) gives the whole diagram in 1 of 10 runs.
6. **Food strength 0.5 and Repellent strength 0.5**, the ends of their ranges. The paper names neither. Of the
   values tried they fit the diagram best (Results). **About 10,000 agents**: Fig. 10a shows about 10,000 yellow
   pixels, 27 % of the dish.
7. **The link** (ADR 0037): Fig. 10, page 10 of the PDF at arXiv (`https://arxiv.org/pdf/1503.06973v1#page=10`).
   Learn names the paper. The scene card's source text is new (`sourceKind` `voronoi`).
8. **The measurement** lives in `research/voronoi/`, with an archive of its own (8 files, with a count and a digest
   in `research.test.ts`). The story, the definitions and all tables are in
   [`research/voronoi/README.md`](../../research/voronoi/README.md).
9. **No second scene for the deflected path.** A scene starts from its shapes. From a random start with the
   repellents of Fig. 7c in place, the network closes a loop around each repellent and does not bend around it (2
   of 2 runs; not in the record). The figure needs a path that stands before the repellent comes. The
   harness does that and measures it (Results). A user can do it by hand.
10. **The repellent range stays 0 to 0.5.** See "The paper's weights" below.

## Results

WebGPU and WebGL2, Apple M3 Pro, 2026-11-15, `main` at `6d8d23a` plus this branch. The network is the cells with an
agent inside a circle that leaves out the band of agents at the rim; an edge counts within 3 cells.

| Measure at step 10,000                | WebGPU, 30 seeds    | WebGL2, 30 seeds    | The paper              |
| ------------------------------------- | ------------------- | ------------------- | ---------------------- |
| network cells on a Voronoi edge       | 0.87 (0.73 to 0.93) | 0.84 (0.62 to 0.92) | no number (Fig. 10d)   |
| the same for cells at random          | 0.12                | 0.12                |                        |
| length of the edges that is covered   | 0.91 (0.78 to 0.98) | 0.88 (0.73 to 0.98) | no number              |
| mean distance of a cell from an edge  | 2.0 cells           | 2.7 cells           | no number              |
| seven closed cells, each with one dot | 30 of 30 runs       | 29 of 30 runs       | yes, in its one figure |
| the whole diagram: 12 edges, 7 cells  | 26 of 30 runs       | 21 of 30 runs       | yes, in its one figure |

- **The course is that of Fig. 10**: a mesh within 300 steps, the diagram from about step 3,000, a thick band of
  agents on the ring. From step 10,000 to 20,000 nothing changes. A run that misses the whole diagram has a loop
  around one outer dot in place of two spokes.
- **The backends** do not differ by more than chance (26 against 21 of 30 runs).
- **The strength** (10 seeds each): 0.005 gives a network that ignores the dots (0.08 on an edge). 0.025 to 0.15 give
  the hybrid of the paper: 6 to 9 of the 12 edges, a short network between the dots. 0.25 and 0.45 give the whole
  diagram in 3 and 5 of 10 runs. A dot that releases 3.5 times as much as the scene's gives 0.91 on an edge.
- **The ring**: a food strength of 0.2 gives the whole diagram in 3 of 10 runs, 0.05 in 1 of 10.
- **The deflected path of Fig. 8** (5 seeds each): with a strength of 0.5 the path stands 20.8, 34.0 and 50.2 cells
  above the line of the foods with 1, 2 and 3 repellents. The figure, read from its pixels: 16.5, 32.5 and 51. With
  0.2: 18.2, 31.3 and 47.2. After the repellents are gone it is back at 4.6 cells after 12,000 steps.
- **Fig. 9** was likely not made with the "typical" mean and damping: its ring moves out by about 4 cells per factor
  of 10 in the repellent. The field of a source without agents moves by 6.5 to 6.7 cells with a 5 × 5 mean and a
  damping of 0.1, and by 3.8 to 4.0 with a 3 × 3 mean and 0.1 (`research/voronoi/reach.ts`).

**The paper's weights.** The paper does not say how a node weight becomes a value. In this app a strength w
releases 255 · w per cell and step (ADR 0044). If the paper does the same, a weight is the app's strength for a
hard source of the same cells: 0.005 to 0.45 of Fig. 14 lie in the range, 0.7 does not. No run tests this reading:
Fig. 14 has 20 nodes of unknown size, each with a band of agents around it, and that start is not built. Two results
speak for strengths of this size: the diagram needs 0.5 with dots of the paper's size, and the deflections of
Fig. 8 come out with 0.2 to 0.5. A user who wants more than 0.5 paints a larger dab: the far field follows the sum of
the bytes.

## Consequences

- The app has a scene with a repellent of Jones' papers and with the 5 × 5 mean, and a number for it.
- `docs/fidelity.md` has a new row 22, "A network around repellents draws their Voronoi diagram", with the status
  "Matches the model only": the docs hold no number of the organism.
- `docs/model.md` says that the mean window is 5 in this scene, and what a dab of 2.5 cells releases. No rule
  changed.
- Every other scene keeps its bytes: no pass and no setting of another scene changed. The digests of
  `research/flow/engine/digest.gpu.test.ts` (every scene and the default settings, 500 steps, both backends) are equal
  to those of `main` at `6d8d23a`, made on the same machine in the same hour: 46 of 46.
- `presets.test.ts` pins the paper's values, the ring, the dots and the page of the figure. Tests that listed the
  scenes with growth, with the Jones model or with a mean window of 3 name the new scene.
- The scene starts with a random seed like every scene. About one run in five on WebGPU, and three in ten on
  WebGL2, ends with a loop in place of two spokes.
- Open (`TODO.md`): the hybrid graphs of Fig. 13 to 16, the reading of the weights, a path scene with a repellent
  that comes at a given step, and the organism's fronts that do not fuse at once (p. 4).
