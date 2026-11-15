# The Voronoi diagram: the app against the diagram and against a paper's figures

This folder belongs to [ADR 0048](../../docs/adr/0048-the-scene-voronoi-diagram.md). The first part tells in plain
words what was measured and what came out. The rest is a reference: the definitions, the numbers and one command for
each step.

The paper: J. Jones and A. Adamatzky, "Slime mould inspired generalised Voronoi diagrams with repulsive fields",
2015, [arXiv:1503.06973](https://arxiv.org/abs/1503.06973). Page numbers here are the ones printed in its PDF.

## The story in one page

**The question.** The Jones model has a repellent source (ADR 0044) and a wider mean (ADR 0046). No scene used
them, and no run compared a repellent with a figure of Jones' papers. This paper has such a figure: seven repellent
dots in a dish with a ring of attractant at its rim, and a sheet of agents that ends as the Voronoi diagram of the
dots (Fig. 10). The Voronoi diagram is exact geometry, so the app can be measured against it.

**The scene.** Voronoi diagram is the model of the paper (p. 7): sensor and rotation angle 60°, sensor distance 5, a
deposit of 1, a mean over 5 × 5 cells times 0.9, growth and shrinkage tested every 3 steps. The paper does not give
the rest. So the lattice, the ring and the dots are read from its Fig. 6a and 10: a dish of 225 cells across, a ring
of 3 cells, dots of 3 × 3 cells, about 10,000 agents. The two strengths are chosen by the measurements below.

**What the app does.** The same as Fig. 10: the sheet breaks into a mesh, the mesh leaves the dots, and after about
3,000 steps a hexagon around the middle dot and six spokes to the rim are left. A thick band of agents stays on the
ring, as in the figure. The network then stays as it is: step 20,000 gives the numbers of step 10,000.

**Against the diagram.** The measure looks at the network inside a circle that leaves out the band at the rim.

- At step 10,000, 0.87 of the network's cells lie within 3 cells of a Voronoi edge (30 seeds, 0.73 to 0.93). Cells at
  random would give 0.12. The network covers 0.91 of the length of the edges, and a network cell lies 2.0 cells from
  the nearest edge on average.
- In 30 of 30 runs each dot lies alone in a cell that the network closes.
- In 26 of 30 runs the network is the whole diagram: all 12 edges and the seven cells. In the other 4 a loop
  around one outer dot takes the place of two spokes, with one vein from the loop to the rim.
- WebGL2 gives the same picture: 0.84 on an edge, the whole diagram in 21 of 30 runs. The two backends do not differ
  by more than chance (26 against 21 of 30).

**The dot: smooth or hard.** The paper's dot is 3 × 3 cells of one value. The app's brush has a smooth edge
(`docs/model.md`, 6.7). A smooth dot with a radius of 2.5 cells releases as much as the hard one (2,243 against 2,295
in sums of bytes). The harness wrote the hard dots straight into the environment and ran both: 0.87 against 0.88 on an
edge, the whole diagram in 10 of 10 runs each. So the app needs no hard-edged brush for this scene, and none was
built. What counts is how much a dot releases: a smooth dot of the paper's size (radius 1.5, a third of the
bytes) gives the whole diagram in 1 of 10 runs.

**The strength, from Voronoi to hybrid.** The paper shows that a weak repellent gives a hybrid: the network
keeps each source in a cell of its own but pulls short between them (Fig. 13 to 16). The app does the same. With a
strength of 0.005 the network ignores the dots. From 0.025 to 0.15 it winds around the dots near the middle and
reaches the rim by few veins: 6 to 9 of the 12 edges. From 0.25 on most edges are there, and only at 0.5, the end of
the app's range, is the whole diagram the rule. A dot that releases 3.5 times as much fits a little better still
(0.91 on an edge). The ring matters as much: with a food strength of 0.2 the whole diagram comes in 3 of 10 runs.

**Do the paper's weights fit the app's range?** The paper names node weights from 0.005 to 0.7 (Fig. 14) and does
not say how a weight becomes a value. If a weight is the factor on a source of 255, as in Jones' other papers and
in this app, then a weight is the app's Repellent strength for a hard source of the same cells. Then 0.005 to 0.45
lie in the app's range of 0 to 0.5, and 0.7 does not. No run tests this reading: Fig. 14 has 20 nodes of unknown
size, each with a band of agents around it, and that start is not built. For a smooth dab the user reaches
more with a larger dab: the far field follows the sum of its bytes.

**A second check: the deflected path (Fig. 8).** A path between two foods bends away from a repellent that is put
beside it, and more with each further repellent. The harness lets the path form, paints the figure's three
repellents one after the other, and reads the height of the path at the middle of the dish. With a strength of 0.5:
20.8, 34.0 and 50.2 cells. The figure, read by eye from its pixels: 16.5, 32.5 and 51. With 0.2: 18.2, 31.3 and
47.2. After the repellents are gone the path comes back, as the paper says: to 4.6 cells after 12,000 steps. So
strengths of 0.2 to 0.5 give the deflections of the figure.

**No second scene.** A scene must start from its shapes. From a random start with the repellents in place the
network does not bend around them: it closes a loop around each one, the hybrid of the paper. The figure needs a
path that stands before the repellent comes. A user can do that by hand: let a path form and paint a repellent
beside it.

**What is not exact.**

- The paper gives no lattice, no size of a dot, no strength, no number of agents and no number of steps for Fig. 10.
  All of them are read from figures (JPEG pictures of 267 × 253 and 200 × 200 pixels, taken as one pixel per cell)
  or chosen here. The paper has no number for how well its network fits the diagram: the comparison is with the
  diagram, and with the figure by eye.
- "Typically" 5 × 5 and 0.1 are the paper's words for its mean and its damping. Its Fig. 9e moves a ring out by
  about 4 cells for each factor of 10 in the repellent. `reach.ts` computes the field of a source without agents: a
  5 × 5 mean with a damping of 0.1 gives 6.5 to 6.7 cells per decade, a 3 × 3 mean with 0.1 or a 5 × 5 mean with
  0.25 gives 3.8 to 4.0. So Fig. 9 was likely not made with the typical values. Which values Fig. 10 had is not known.
- The 10 seeds of the tables gave the whole diagram in 10 of 10 runs; over 30 seeds it is 26 of 30. The tables of
  the dot, the strength and the food compare with those 10 seeds.
- All agents update at once (ADR 0008); the paper updates them in random order.
- The hybrid graphs of Fig. 13 to 16 (planar shapes, 20 nodes, circles) are not rebuilt. Only the sweep of the
  strength on the seven dots is measured.
- The organism side has no number: the paper shows a picture of a plasmodium with repellents (Fig. 2, from
  Shirakawa and Gunji) and gives no measure.

## Definitions

- **The network.** The cells that hold an agent, as the paper draws its figures.
- **The circle of the measure.** All cells within 94.5 cells of the centre of the dish: the inner edge of the ring
  (109.5) less a band of 15 cells. The band of agents on the ring is about 10 cells thick, and wider where a spoke
  ends. It belongs to no edge.
- **The edges.** The Voronoi diagram of the centres of the seven dots: the points that lie as far from their nearest
  dot as from the next one. `voronoiEdges()` in `measure.ts` gives them as points 0.25 cells apart. The seven dots
  have 12 edges: six sides of the hexagon and six spokes.
- **On an edge.** The share of the network's cells inside the circle within 3 cells of an edge.
- **Edges covered.** The share of the length of the edges inside the circle with a network cell within 3 cells.
- **Distance.** The mean distance of a network cell inside the circle from the nearest edge, in cells.
- **Seven cells.** The run closes seven parts of the dish, each with one dot. A part is closed by the cells with an
  agent, the cells with a trail above a quarter of a deposit, and the ring. The agents alone leave gaps in a
  vein. The trail alone is open at the rim, where the agents stand packed and deposit nothing.
- **Edges of 12.** The edges that the network draws: it covers at least half of the edge's length inside the circle.
- **Whole diagram.** All 12 edges and the seven cells.
- **The height of the path** (Fig. 8). The mean height of the cells with an agent in the 11 columns at the middle
  of the dish, above the line of the two foods.

## The numbers

Cells at random inside the circle of the measure: 0.12 of them lie within 3 cells of an edge.

The scene over time, 10 seeds, WebGPU.

| Step   | agents | in the circle | on an edge          | edges covered       | distance | seven cells | edges of 12 | whole diagram |
| ------ | ------ | ------------- | ------------------- | ------------------- | -------- | ----------- | ----------- | ------------- |
| 300    | 8,925  | 3,466         | 0.38 (0.35 to 0.41) | 0.75 (0.69 to 0.81) | 12.2     | 0 of 10     | 12.0        | 0 of 10       |
| 1,000  | 6,359  | 1,839         | 0.57 (0.51 to 0.63) | 0.76 (0.70 to 0.82) | 8.0      | 0 of 10     | 12.0        | 0 of 10       |
| 3,000  | 4,937  | 1,172         | 0.89 (0.80 to 0.96) | 0.93 (0.83 to 1.00) | 1.6      | 10 of 10    | 11.7        | 8 of 10       |
| 10,000 | 4,922  | 1,185         | 0.88 (0.85 to 0.91) | 0.93 (0.90 to 0.96) | 1.5      | 10 of 10    | 12.0        | 10 of 10      |
| 20,000 | 4,908  | 1,169         | 0.88 (0.86 to 0.92) | 0.92 (0.89 to 0.95) | 1.5      | 10 of 10    | 12.0        | 10 of 10      |

The dot, at step 10,000, 10 seeds each. The bytes are the sum of the light bytes of one dot.

| Dot                            | bytes | on an edge          | edges covered       | distance | seven cells | edges of 12 | whole diagram |
| ------------------------------ | ----- | ------------------- | ------------------- | -------- | ----------- | ----------- | ------------- |
| smooth, radius 2.5 (the scene) | 2,240 | 0.88 (0.85 to 0.91) | 0.93 (0.90 to 0.96) | 1.5      | 10 of 10    | 12.0        | 10 of 10      |
| hard, 3 × 3 cells (the paper)  | 2,295 | 0.87 (0.85 to 0.90) | 0.91 (0.88 to 0.94) | 1.6      | 10 of 10    | 12.0        | 10 of 10      |
| smooth, radius 1.5             | 749   | 0.71 (0.54 to 0.87) | 0.75 (0.60 to 0.90) | 5.6      | 8 of 10     | 9.4         | 1 of 10       |
| smooth, radius 4.72            | 7,981 | 0.91 (0.90 to 0.95) | 0.96 (0.94 to 0.98) | 1.4      | 10 of 10    | 12.0        | 10 of 10      |

The repellent strength, at step 10,000, 10 seeds each.

| Strength | agents | on an edge          | edges covered       | distance | seven cells | edges of 12 | whole diagram |
| -------- | ------ | ------------------- | ------------------- | -------- | ----------- | ----------- | ------------- |
| 0.005    | 5,027  | 0.08 (0.05 to 0.12) | 0.12 (0.09 to 0.18) | 18.1     | 0 of 10     | 0.7         | 0 of 10       |
| 0.025    | 4,980  | 0.35 (0.28 to 0.48) | 0.42 (0.35 to 0.53) | 12.1     | 2 of 10     | 6.3         | 0 of 10       |
| 0.05     | 4,870  | 0.45 (0.31 to 0.60) | 0.50 (0.35 to 0.64) | 10.3     | 3 of 10     | 7.1         | 0 of 10       |
| 0.075    | 4,809  | 0.54 (0.47 to 0.61) | 0.59 (0.51 to 0.69) | 9.1      | 6 of 10     | 7.8         | 0 of 10       |
| 0.125    | 4,790  | 0.65 (0.53 to 0.83) | 0.70 (0.56 to 0.86) | 6.4      | 8 of 10     | 8.9         | 0 of 10       |
| 0.15     | 4,829  | 0.68 (0.58 to 0.91) | 0.73 (0.63 to 0.93) | 6.1      | 7 of 10     | 9.2         | 1 of 10       |
| 0.25     | 4,818  | 0.78 (0.68 to 0.87) | 0.81 (0.75 to 0.93) | 4.3      | 9 of 10     | 10.5        | 3 of 10       |
| 0.45     | 4,856  | 0.81 (0.65 to 0.92) | 0.84 (0.68 to 0.97) | 3.8      | 9 of 10     | 10.7        | 5 of 10       |
| 0.5      | 4,922  | 0.88 (0.85 to 0.91) | 0.93 (0.90 to 0.96) | 1.5      | 10 of 10    | 12.0        | 10 of 10      |

The food strength of the ring, at step 10,000, 10 seeds each.

| Food strength | agents | on an edge          | edges covered       | distance | seven cells | edges of 12 | whole diagram |
| ------------- | ------ | ------------------- | ------------------- | -------- | ----------- | ----------- | ------------- |
| 0.05          | 4,618  | 0.69 (0.54 to 0.86) | 0.76 (0.64 to 0.92) | 7.0      | 6 of 10     | 9.3         | 1 of 10       |
| 0.2           | 4,732  | 0.80 (0.75 to 0.93) | 0.84 (0.78 to 0.95) | 4.0      | 10 of 10    | 10.6        | 3 of 10       |
| 0.5           | 4,922  | 0.88 (0.85 to 0.91) | 0.93 (0.90 to 0.96) | 1.5      | 10 of 10    | 12.0        | 10 of 10      |

The scene on the two backends, at step 10,000, 30 seeds each (WebGPU: the 10 seeds above and 20 more).

| Backend | agents | on an edge          | edges covered       | distance | seven cells | edges of 12 | whole diagram |
| ------- | ------ | ------------------- | ------------------- | -------- | ----------- | ----------- | ------------- |
| WebGPU  | 4,902  | 0.87 (0.73 to 0.93) | 0.91 (0.78 to 0.98) | 2.0      | 30 of 30    | 11.7        | 26 of 30      |
| WebGL2  | 4,884  | 0.84 (0.62 to 0.92) | 0.88 (0.73 to 0.98) | 2.7      | 29 of 30    | 11.3        | 21 of 30      |

The deflected path (Fig. 8), 5 seeds each: the height of the path at the middle of the dish above the line of the
foods, in cells, with no repellent, with 1, 2 and 3, and 3,000 and 12,000 steps after they are gone.

| Strength  | none              | 1                   | 2                   | 3                   | gone, 3,000         | gone, 12,000     |
| --------- | ----------------- | ------------------- | ------------------- | ------------------- | ------------------- | ---------------- |
| 0.05      | 1.0 (-3.1 to 4.0) | 14.0 (13.5 to 14.5) | 26.6 (26.2 to 27.0) | 43.1 (42.6 to 44.2) | 22.0 (21.0 to 23.2) | 3.7 (2.8 to 4.6) |
| 0.2       | 1.0 (-3.1 to 4.0) | 18.2 (17.7 to 18.9) | 31.3 (30.5 to 32.0) | 47.2 (46.6 to 47.8) | 25.1 (23.8 to 26.7) | 4.5 (3.1 to 6.2) |
| 0.5       | 1.0 (-3.1 to 4.0) | 20.8 (20.1 to 21.5) | 34.0 (33.6 to 34.4) | 50.2 (49.3 to 50.7) | 27.0 (26.0 to 27.8) | 4.6 (3.0 to 6.0) |
| the paper | 0.0               | 16.5                | 32.5                | 51.0                | no number           | returns          |

The path holds 436 to 509 agents from the first repellent on. It was one path after 6,000 to 8,000 steps, and at the
middle of the dish it is at most 6 cells wide in every sample.

Each column of a table is a mean over the seeds, with the least and the most in brackets.

The reach of a repellent without agents (`reach.ts`): the distance at which the field of 3 × 3 cells falls to one
level, for strengths of 1, 10, 100 and 1,000.

```text
mean 5 × 5, damping 0.1: 6.5, 6.6, 6.7 cells per decade
mean 3 × 3, damping 0.1: 3.8, 3.8, 3.9 cells per decade
mean 5 × 5, damping 0.25: 3.8, 3.9, 4.0 cells per decade
```

## The commands

The campaign (about 10 minutes on an Apple M3 Pro; it writes `out/*.jsonl`):

```sh
sh research/voronoi/campaign.sh
node --import ./research/flow/register.mjs research/voronoi/tables.ts reduce research/voronoi/out research/voronoi/logs
node --import ./research/flow/register.mjs research/voronoi/tables.ts research/voronoi/logs
node --import ./research/flow/register.mjs research/voronoi/picture.ts research/voronoi/out/scene.jsonl --step=10000
node --import ./research/flow/register.mjs research/voronoi/reach.ts
```

The campaign ran on 2026-11-15, on `main` at `6d8d23a` plus this branch. The runs of the seeds 11 to 30 on WebGPU and
of the seeds 1 to 10 on WebGL2 ran twice: the lines were equal byte for byte. The record:

```sh
node --import ./research/flow/register.mjs research/voronoi/logs.ts          # unpacks logs.tar.gz to logs/
node --import ./research/flow/register.mjs research/voronoi/tables.ts        # the tables above, from logs/
node --import ./research/flow/register.mjs research/voronoi/logs.ts pack     # packs logs/ again
```

A line of the campaign holds two masks of its sample: the cells with an agent and the cells with trail. They are
4 kB a line after packing, 1 MB for the campaign, so the record holds the measures of each line in their place
(`reduce`, the second command above). `masks.jsonl` keeps the masks of the 10 seeds of the scene at step 10,000.

`research.test.ts` (in `npm test`) unpacks the archive, makes the tables and compares them with this file. It makes
the measures of those 10 samples again from their masks, and it checks the measures on shapes whose answer is known.
After a new campaign: run the three commands of the campaign, pack, and put the new digest into the test.

## The files

| File                  | What                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| `voronoi.gpu.test.ts` | the scene in the real engine: agents and trail masks at chosen steps           |
| `deflect.gpu.test.ts` | the deflected path of Fig. 8: a path, then three repellents, then none         |
| `measure.ts`          | the Voronoi edges, the shares, the cells of the dots, the height of a path     |
| `tables.ts`           | the tables of this file from the logs; the record from the lines of a campaign |
| `picture.ts`          | a picture of a sample over the diagram                                         |
| `reach.ts`            | the field of a repellent without agents, per decade of its strength            |
| `campaign.sh`         | every run of the record                                                        |
| `logs.tar.gz`         | the record: 8 files of lines, one line per sample with its measures            |
