# The Electrode tool and the scene Electrotaxis: how they came about, and how to check them

This folder belongs to [ADR 0047](../../docs/adr/0047-an-electrode-tool-and-the-scene-electrotaxis.md). The first
part of this page tells in plain words how the tool and the scene came about. The rest is a reference: one command
for each check. The last part, [The look of the electrodes](#the-look-of-the-electrodes-adr-0058), belongs to
[ADR 0058](../../docs/adr/0058-the-outlines-and-the-surface-of-the-electrodes.md).

## The story in one page

**The question.** The owner asked for electric current as another tool, like light and food. A real slime mold on a
gel with a current grows toward the cathode: 13 of 16 pieces did so in a paper of Tsuda, Jones, Adamatzky and Mills
(2011). The same paper has a model for it, built on Jones' agents. Does the app run that model, and do its agents go
to the cathode?

**Step 1: the rule of the paper.** In the paper's model the agents sense one map. The trail of the agents is in it.
A current sink, the cathode, adds 255 to its cells in every step. A current source, the anode, takes 255 away. In
every step the map takes the mean of 15 × 15 cells, times a damping. Agents turn toward higher values, so they leave
the anodes and go to the cathodes.

**Step 2: where the poles live.** The Jones model of the app has food as a source above 0 and a repellent as a source
below 0. So the poles could have been food and repellent with another strength. They are not, because food is more
than a source in the app: the flow in the tubes runs between foods, covered food releases less, a colony can start
on food, and the picture draws an oat flake. A cathode is none of that. Each cell has four bytes for walls, food and
light, and the fourth was free. The poles use it: 255 is a cathode, 128 an anode. This costs no memory.

**Step 3: the tool.** The tool Electrode paints the pole that the user selects beside the brush. The setting
Electrode strength is 1 for the paper's 255, and goes down to 0. A link holds the strokes; its format has a new
version for that.

**Step 4: the scene.** The paper starts 1,500 agents in a vertical line between five sources and five sinks. It gives
no size of its grid, no positions and no value of the damping. So the scene has a grid of 250 × 240 cells, the line
in the middle, the anodes 20 cells right of it and the cathodes 100 cells left of it. The damping is 0.01: with it
the field stops changing after about 400 steps, the time that the paper gives its field to settle.

**Step 5: the measurement.** Ten runs with ten seeds on each backend. In every run the agents go toward the
cathodes, and they never turn back. After 450 steps they are half way, and after 800 steps a third of them stand at
the cathodes. Three checks show that the electrodes cause this. With the poles swapped the agents go the other way.
With a strength of 0 they stay. With the small mean of 3 × 3 cells they stay too: the field of the electrodes then
does not reach them.

**What the app does not do.** In the paper the field settles for 400 steps before the agents start. The app has no
such phase: field and agents start together. A run that copies the settled field in first is faster (two thirds of
the way after 450 steps, in place of half), and goes the same way. The agents of the paper keep their heading when
they are blocked; the agents of the app take a random one. And the paper's second figure, with two more sources in
the way, was not run.

**What is not exact.** The organism has one number here, 13 of 16 pieces after six hours. The model has no chance
in its direction, so it gives 10 of 10. The paper's grid is not known, so the speed compares with nothing.

## The numbers

The table of the ADR, made by `tables.ts` from the logs. "Way": how far the mean x of the agents went toward the
cathodes, in cells; the line starts 100 cells from them (20 cells with the poles swapped). "Toward the cathodes": a
way above 10 cells. "At a cathode": agents within 12 cells of the middle of a cathode, of 1,500. "Largest way back":
the largest step of the mean x toward the anodes between two samples, 25 steps apart.

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

Every sample of a log also holds the field along the middle row at five points (`field`: food scent − repellent).
With the decay 0.01 it reads 44.31, 3.167, −25.59, −17.94, −2.628 at step 400 and 44.30, 3.123, −25.66, −18.02,
−2.661 at step 800: within 1.4 % of each other. With 0.1 it is the same to four digits from step 100 on. With 0.003
it changes by 5 to 40 % between step 400 and 800 (3.708 to 2.139 at the second point).

## The reference

### What you need

Node 26 and the packages of the repository (`npm ci`), and the browser of the tests (`npx playwright install
chromium`).

### The logs

The logs are one archive, `logs.tar.gz`. Unpack it to `research/electrode/logs/`, which git ignores:

```bash
node --import ./research/flow/register.mjs research/electrode/logs.ts unpack
```

`list` shows what the archive holds, and `pack` packs the folder again after a new measurement.

| Files                 | What                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| `logs/*-webgpu.jsonl` | the runs of the table on WebGPU, one line per seed and sample              |
| `logs/*-webgl2.jsonl` | the scene and the settled field on WebGL2                                  |
| `logs/digest-*.jsonl` | the digests of every scene after 500 steps, of `main` (`6d8d23a`) and here |
| `logs/mutations.txt`  | the tests that fail for each of the 21 wrong rules `EL1` to `EL21`         |

### Step 1: the tests

Both backends against the CPU references (10 seconds), and the unit tests of the link, the settings and the scene:

```bash
npx vitest run --project gpu src/engine/sim.gpu.test.ts -t "electrode tool"
npm test
```

The 21 wrong rules (4 minutes). Each block must name at least one test that fails:

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts $(seq -f "EL%g" 1 21)
```

### Step 2: the bytes of the other scenes

On `main` and on the branch, about 90 seconds each. Every scene but Electrotaxis must have the digests of `main`
(`research.test.ts` compares the two logs of the record):

```bash
VITE_NAME=digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

On another GPU make the digests of `main` on that machine too (`research/flow/README.md`, part 6).

### Step 3: the scene over 10 seeds

All runs of the table (2 minutes), then the table:

```bash
research/electrode/campaign.sh
node --import ./research/flow/register.mjs research/electrode/tables.ts research/electrode/out
```

Without a folder the last command reads the logs of the record. `electrotaxis.gpu.test.ts` names its environment
variables: the seeds, the steps, a patch of the settings, the settled field and the swapped poles.
`research.test.ts` checks the record with every `npm test`: it unpacks the archive, makes the table, and compares it
with the table of this page and of the ADR.

## The look of the electrodes (ADR 0058)

### The story in one page

**The question.** The owner found the electrodes ugly: angular blocks without a surface and without smooth edges. A
pole was drawn where its cells are, in one flat colour. The dabs of the scene Electrotaxis hold four cells each, so
they were small squares. How does a pole get a round outline and a surface?

**Step 1: where a round outline comes from.** Food and walls are round in the picture since ADR 0009. They are not
drawn from their cells. For every cell the app keeps the distance to the outline of the stroke, and the picture
rebuilds the outline from these distances. The first idea for the poles was cheaper: keep the cells, and smooth them
in the picture. The measurement says no. An outline from the cells is smooth, but it is off by up to half a cell,
with flat sides, however much the cells are blurred. Only the distance to the stroke gives a circle.

**Step 2: a buffer of its own.** The distances of food and walls fill their buffer. So the poles have a second one,
with the distance to the cathodes and the distance to the anodes in each cell. It costs 4 bytes per cell. The app
counts them for every scene from the start, so that a stroke of a pole never changes the size of the grid. Of 2,916
cases of scene, device and window, one gets a smaller grid.

**Step 3: one pass for two buffers.** The pass that writes the distances of food and walls writes those of the
poles too. A cell holds one pole. So a cathode stroke adds to the cathodes and takes from the anodes, as a wall
stroke adds to the walls and takes from the food. An erase and a wall take from both poles.

**Step 4: the stud.** A pole is drawn as a stud: a dome over its outer 1.5 cells and flat inside, lit from the top
left as the walls, with a small highlight, a thin dark line along its outline and a soft shadow on the side away
from the light. The cathode is blue and the anode red, as before. A pole covers all of what lies below it. Before,
a tenth showed through, and the squares of the agents looked like dirt on the surface.

**Step 5: the check, and what it found.** The second build wrote a copy of the rules for the CPU and held both
backends to it: the bytes of the buffer, and every pixel of the picture. One test paints a thin line of one pole over
the other pole and asks that no ground shows between them. It failed. The line was drawn a little narrower than the
gap that it had cut into the pole below, by up to 0.14 cells. So a hairline of ground showed along it: on its pixels
a quarter to a half of the ground at 3 pixels per cell, and most of it at 8 pixels per cell. The cause: the pass
rounds a thin stroke off before it stores it, and it cut the gap with the plain stroke. Now a pole and a wall cut the
gap with the rounded stroke, and the two outlines are one line. An erase still cuts with the plain stroke: nothing
fills its gap, and the plain stroke gives the straighter edge.

**What is not done.** Nobody measured a time: other work ran on the GPU. A stroke of the thinnest brush has small
knots, and a dab of 1.5 cells is drawn a little smaller than its brush, as food and walls of that size are. Where
a wall cuts a pole, a quarter of the ground shows on the one pixel between them. Where two strokes that cut a pole
come nearer than a cell to each other, the sliver of the pole between them is gone, and the ground shows there.
ADR 0058 lists these points.

### The numbers of the look

`outline.ts` computes four tables on the CPU, with the copy of the rules that both backends are held to.

How far the outline of a dab lies from the circle of its brush, in cells (below 0: inside the circle), over 72
directions. "Cells": the outline comes from the cells of the pole, with the rule of ADR 0047, with the spline of the
picture, and with two blurs before the spline. "Distance to the stroke": the rule of ADR 0058.

| Dab                                  | Cells, bilinear (ADR 0047) | Cells, spline  | Cells, blur 1-2-1, spline | Cells, blur 1-4-6-4-1, spline | Distance to the stroke (ADR 0058) |
| ------------------------------------ | -------------------------- | -------------- | ------------------------- | ----------------------------- | --------------------------------- |
| 1.5 cells, on a corner of four cells | −0.50 to −0.38             | −0.50 to −0.42 | −0.92 to −0.91            | no outline                    | −0.15 to −0.14                    |
| 1.5 cells, on the centre of a cell   | 0.00 to +0.33              | 0.00 to +0.29  | −0.07 to −0.04            | −0.31 to −0.30                | −0.13 to 0.00                     |
| 1.5 cells, between the two           | −0.40 to +0.33             | −0.38 to +0.27 | −0.49 to −0.07            | −0.92 to −0.52                | −0.16 to +0.01                    |
| 2.5 cells                            | −0.37 to +0.40             | −0.36 to +0.34 | −0.37 to +0.12            | −0.41 to −0.07                | −0.06 to −0.01                    |
| 4 cells                              | −0.44 to +0.39             | −0.38 to +0.34 | −0.30 to +0.18            | −0.32 to +0.08                | −0.04 to −0.02                    |
| 10 cells                             | −0.38 to +0.40             | −0.35 to +0.37 | −0.30 to +0.30            | −0.30 to +0.24                | −0.02 to 0.00                     |

The least share of a pixel that the two poles cover together on the seam of an anode line over a wide cathode: 1.00
where no ground shows. And the widest gap between the outline of the line and the outline of the cathode. "Plain":
the pole below loses its cells at the plain distance of the stroke, as in the first build. "Rounded": at the rounded
distance of the union of the stroke, the rule of ADR 0058.

| Radius of the line, cells | Plain, 8 px per cell | Plain, 3 px per cell | Plain, 1 px per cell | Plain, gap in cells | Rounded, 8 px per cell | Rounded, 3 px per cell | Rounded, 1 px per cell | Rounded, gap in cells |
| ------------------------- | -------------------- | -------------------- | -------------------- | ------------------- | ---------------------- | ---------------------- | ---------------------- | --------------------- |
| 0.75                      | 0.02                 | 0.50                 | 0.78                 | 0.14                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
| 1                         | 0.12                 | 0.60                 | 0.81                 | 0.10                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
| 1.5                       | 0.34                 | 0.72                 | 0.87                 | 0.07                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
| 2                         | 0.98                 | 0.99                 | 0.99                 | 0.00                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
| 2.25                      | 1.00                 | 1.00                 | 1.00                 | 0.00                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
| 3                         | 1.00                 | 1.00                 | 1.00                 | 0.00                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |

Where a wide cathode begins beside an erased line, in cells from the middle of the line, over 200 places along the
line: the plain distance, which an erase takes, gives the straighter edge.

| Radius of the erased line, cells | Plain (ADR 0058) | Rounded as a union |
| -------------------------------- | ---------------- | ------------------ |
| 0.75                             | 0.68 to 0.76     | 0.59 to 0.75       |
| 1                                | 0.98 to 1.02     | 0.89 to 1.02       |
| 1.5                              | 1.49 to 1.51     | 1.44 to 1.51       |

The largest share of the ground that shows on the seam between a wall line and the wide cathode that it cuts. The
picture draws the wall over the ground and then the pole over both, so a quarter of the ground shows on the one
pixel in the middle of a seam that is closed. With the plain distance the gap beside a thin wall showed more.

| Radius of the wall, cells | Plain, 8 px per cell | Plain, 3 px per cell | Rounded, 8 px per cell | Rounded, 3 px per cell |
| ------------------------- | -------------------- | -------------------- | ---------------------- | ---------------------- |
| 0.75                      | 0.98                 | 0.56                 | 0.25                   | 0.25                   |
| 1                         | 0.88                 | 0.48                 | 0.25                   | 0.25                   |
| 1.5                       | 0.69                 | 0.40                 | 0.25                   | 0.25                   |
| 2                         | 0.26                 | 0.25                 | 0.25                   | 0.25                   |
| 3                         | 0.25                 | 0.25                 | 0.25                   | 0.25                   |

### The reference of the look

The tables above (10 seconds), and the grids that the 4 B per cell change (1 second):

```bash
node --import ./research/flow/register.mjs research/electrode/outline.ts
node --import ./research/flow/register.mjs research/electrode/fit.ts
```

The second command fits the default settings and the 33 scenes with the 4 B and without them, on three backends, six
hints of the memory of the device and six canvases: 3,672 cases. It runs the fit of the engine itself on the CPU
backend of the engine tests. Eight grids change, and the command must print:

```text
3672 cases: 8 with another grid
three-networks on WebGL2, a memory hint of 0.5 GB, a canvas of 1600 × 1000: lattice 384 × 384 before, 256 now
three-networks on WebGL2, a memory hint of 0.5 GB, a canvas of 1920 × 1080: lattice 384 × 384 before, 512 now
three-networks on WebGL2, a memory hint of 0.5 GB, a canvas of 2560 × 1440: lattice 384 × 384 before, 512 now
three-networks on WebGL2, a memory hint of 0.5 GB, a canvas of 1280 × 720: lattice 384 × 384 before, 512 now
three-networks on WebGL2, a memory hint of 0.5 GB, a canvas of 390 × 844: lattice 384 × 384 before, 512 now
three-strains on WebGL2, a memory hint of 1 GB, a canvas of 390 × 844: 1024 before, 768 now
three-networks on WebGL2, a memory hint of 0.5 GB, a canvas of 1000 × 1000: lattice 384 × 384 before, 256 now
maze on WebGL2, a memory hint of 0.5 GB, a canvas of 1000 × 1000: 512 before, 256 now
```

So the start scene Three strains (`three-networks`, ADR 0064) runs without its lattice on WebGL2 with a hint of
0.5 GB: on a grid of 512 or 256 cells on the long side. The Three-strain weave (`three-strains`) goes from 1024 to 768
cells on the long side in one case, and the Maze from 512 to 256 in one. Every other case keeps its grid.

The record changed three times. When ADR 0058 was built, the list held 26 scenes, 2,916 cases, and one grid changed:
Cyclones on WebGL2 without float blending, with a hint of 2 GB on a canvas of 390 × 844 pixels, went from 1024 to 768
cells. Then the slime counted 11 B more per cell (ADR 0057, ADR 0060), and two other grids changed in its place:
those of the Three-strain weave, then the scene Three strains, and of the Maze. Since ADR 0064 the list holds the two
new start scenes too, 3,132 cases. Since ADR 0066 it holds the two scenes of Reid et al. 2012 as well: they add 216
cases, and their grids stay.

**The tests.** The CPU copies in Node, then both backends against them in a headless browser:

```bash
npx vitest run --project unit src/engine/outline-reference.test.ts src/engine/electrode-reference.test.ts src/engine/sizing.test.ts
npx vitest run --project gpu src/engine/electrode.gpu.test.ts
npx vitest run --project gpu src/engine/sim.gpu.test.ts -t "electrode tool"
```

You must see 42, 44 and 107 tests pass.

- `outline-reference.ts` is the outline pass, the pass that holds the bytes to the environment, and the spline of
  the picture. `electrode-reference.ts` is the stud and the blend of the two poles.
- `sim.gpu.test.ts`, "outline distances for the renderer", "of the electrode tool": the bytes of the buffer.
- `electrode.gpu.test.ts`: the picture, pixel for pixel, within 2 of 255.

**The wrong rules** `EL22` to `EL108` (13 minutes). Each block must name at least one test that fails:

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts $(seq -f "EL%g" 22 108)
```

**The bytes of the scenes.** The digests of every scene after 500 steps, and of the eight scenes with the flow
after 3,000 steps, as in `research/flow/README.md`, parts 17 and 18. They must equal those of `main`: 54 of 54 runs
and 16 of 16 (`research.test.ts` compares the logs of the record). The record of `main` is the one of ADR 0055
(`research/flow/logs/engine/slime/`): no commit of `main` up to `a6ffe64` changed a pass since then.

```bash
VITE_FLOW=1 VITE_NAME=el-digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
VITE_FLOW=1 VITE_STEPS=3000 VITE_ONLY=maze,snail-maze,corn-maze,tokyo,tokyo-light,food-ring,rival-networks,tokyo-rivals VITE_NAME=el-digest-3000-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/el-digest-branch.jsonl research/electrode/logs/digest-0058-main.jsonl
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/el-digest-3000-branch.jsonl research/electrode/logs/digest-0058-3000-main.jsonl
```

**The pictures** of the poles in each style, from the built app (`test-results/pictures/`, which git ignores). The
case `strokes` has the shot `seam`: thin poles over a wide pole.

```bash
npm run build && npx playwright test --project=pictures tests/pictures/electrodes.spec.ts
```

**The times**, measured on 2026-11-17 (ADR 0058, "The times"). Nothing else may use the GPU while they run. `time.gpu.test.ts` draws
three states (the scene Electrotaxis, the default settings with wide poles, and the default settings without a pole)
in two styles and two zooms, 21 × 50 draws each, and paints a pole, an erase and a wall 21 × 32 times each. It uses
only calls that the engine had before ADR 0058. So the same file measures `main`: copy it into a checkout of `main`
(`a6ffe64`) with `node_modules`, and run the two builds in turns, as `research/flow/engine/turns.sh` does for the
time of a step:

```bash
VITE_NAME=el-time-branch-r1 npx vitest run --config research/vitest.config.ts research/electrode/time.gpu.test.ts
(cd ../main && VITE_NAME=el-time-main-r1 npx vitest run --config research/vitest.config.ts research/electrode/time.gpu.test.ts)
```

Each run writes `research/electrode/out/<name>.jsonl`: one line per case with the median, the least and the largest
time in milliseconds. The lines to compare: `"part":"draw"` with `"state":"none"` (a frame without a pole must cost
what it cost), with `"state":"electrotaxis"` and `"state":"poles"` (the cost of the outlines and the stud), and
`"part":"stroke"` (a stroke of a pole, an erase and a wall with poles and without, and the first pole of a new
simulation, which builds the pass).

**The records** of ADR 0058 in `logs.tar.gz`:

| Files                                | What                                                                  |
| ------------------------------------ | --------------------------------------------------------------------- |
| `logs/mutations-0058.txt`            | the tests that fail for each wrong rule `EL1` to `EL108`, and `SL109` |
| `logs/digest-0058-branch.jsonl`      | the digests of every scene after 500 steps on the branch              |
| `logs/digest-0058-3000-branch.jsonl` | the same after 3,000 steps for the eight scenes with the flow         |
| `logs/digest-0058-main.jsonl`        | the digests of `main` after 500 steps: the record of ADR 0055         |
| `logs/digest-0058-3000-main.jsonl`   | the same after 3,000 steps                                            |
| `logs/time-0058-branch-r*.jsonl`     | the times of a draw and of a stroke at `9c01431`, two rounds          |
| `logs/time-0058-main-r*.jsonl`       | the same on `main` at `a6ffe64`                                       |
