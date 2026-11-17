# 0058: The electrodes get outlines from their strokes, and a surface

- Status: accepted (decisions of the session "slime look" and of its two helpers of 2026-11-17, under the owner's
  delegation of 2026-11-12), built 2026-11-17. The look of a pole is the owner's to accept: the owner saw the
  pictures of the first build on 2026-11-17. The session "slime look" records the answer of the owner here.
- Date: 2026-11-17
- Extends [ADR 0047](0047-an-electrode-tool-and-the-scene-electrotaxis.md): its decision 8, the view of a pole,
  changes. Its sentence "It costs no memory" holds for the simulation and no longer for the view.
- Uses the outline pass and the spline of [ADR 0009](0009-rendering-pipeline.md) for a second buffer. That record
  does not change.
- In short: the commands and the records are in
  [`research/electrode/README.md`](../../research/electrode/README.md), part "The look of the electrodes".

## Context

The owner wrote on 2026-11-17 (translated from German): "The electrodes bother me in the same way as the slime:
jagged, angular blocks without a real surface and without anti-aliasing."

What ADR 0047 built:

- A pole lies in the fourth byte of a cell of `env`: 128 an anode, 255 a cathode.
- Its decision 8 for the view: a pole covers where the bilinear mix of its four cells around a point passes one half,
  at an opacity of 0.9, in one flat colour. The outline follows the cells.
- A dab of the scene Electrotaxis has a radius of 1.5 cells and its middle on a corner of four cells. It holds 2 × 2
  cells, so the picture showed a small square.

Food and walls have smooth outlines since ADR 0009. Their buffer `shape` holds, per cell, the signed distance to the
outline of the walls and to the outline of the food, as two bytes. The outline pass writes these distances from the
strokes. The view rebuilds an outline from the 3 × 3 cells around a point with a spline, and it covers a pixel by a
ramp one pixel wide. `shape` has four bytes per cell, and all are taken: two distances, the light, and the shadow of
the walls.

## Options

1. **The outline from the cells of `env`**, made smooth in the view. It needs no memory and no pass.
2. **The outline from the distances of the strokes**, in a buffer of its own, as food and walls have it. It needs 4 B
   per cell and a second run of the outline pass.

The measurement behind the choice, made on 2026-11-17: a dab painted on cells, and how far its outline lies from the
circle of its brush, in cells (below 0: inside the circle), over 72 directions. The session "slime look" made it
with a script that was not kept. `research/electrode/outline.ts` makes it again; its numbers for a dab on the centre
of a cell are those of that session, and the others differ by 0.09 cells at most, with the place of the dab.

| Dab                                  | Cells, bilinear (ADR 0047) | Cells, spline  | Cells, blur 1-2-1, spline | Cells, blur 1-4-6-4-1, spline | Distance to the stroke (ADR 0058) |
| ------------------------------------ | -------------------------- | -------------- | ------------------------- | ----------------------------- | --------------------------------- |
| 1.5 cells, on a corner of four cells | −0.50 to −0.38             | −0.50 to −0.42 | −0.92 to −0.91            | no outline                    | −0.15 to −0.14                    |
| 1.5 cells, on the centre of a cell   | 0.00 to +0.33              | 0.00 to +0.29  | −0.07 to −0.04            | −0.31 to −0.30                | −0.13 to 0.00                     |
| 1.5 cells, between the two           | −0.40 to +0.33             | −0.38 to +0.27 | −0.49 to −0.07            | −0.92 to −0.52                | −0.16 to +0.01                    |
| 2.5 cells                            | −0.37 to +0.40             | −0.36 to +0.34 | −0.37 to +0.12            | −0.41 to −0.07                | −0.06 to −0.01                    |
| 4 cells                              | −0.44 to +0.39             | −0.38 to +0.34 | −0.30 to +0.18            | −0.32 to +0.08                | −0.04 to −0.02                    |
| 10 cells                             | −0.38 to +0.40             | −0.35 to +0.37 | −0.30 to +0.30            | −0.30 to +0.24                | −0.02 to 0.00                     |

- "Cells, bilinear" is the rule of ADR 0047. "Cells, spline" is the spline of the view on the cells of a pole, with
  the outline where it passes one half. The two blurs smooth the cells first.
- An outline from the cells is smooth, and it is off by up to 0.5 cells, with flat sides: the cells of a disc have
  flat sides that are several cells long. A wider blur does not help, and it takes a small dab away.
- An outline from the distance to the stroke lies within 0.06 cells of the circle from a radius of 2.5 cells on. A
  dab of 1.5 cells is drawn up to 0.16 cells smaller than its brush, as a dab of food or of a wall is (Open points).
- Both backends draw these outlines: `sim.gpu.test.ts` walks into a dab of each pole from outside along 72
  directions in the picture, and the first pixel of the pole lies within these numbers and a pixel of room.

## Decision

Option 2. Who decided what, each on 2026-11-17 under the owner's delegation of 2026-11-12:

**The session "slime look":**

1. **The outline of a pole comes from the distances of its strokes.** Reason: the table. Only the distance to the
   stroke gives a circle.
2. **The distances lie in a buffer of their own**, in the format of `shape`: the first byte of a cell holds the
   distance to the outline of the cathodes, the second the one to the outline of the anodes, and the other two are 0.
   One `u32` per cell on WebGPU, an RGBA8 target on WebGL2. Reason: `shape` has no byte left.
3. **The fit of the grid counts the 4 B per cell from the start**, in every scene: `BYTES_PER_CELL` is 102 and
   `BYTES_PER_CELL_HALF_FLOAT` 122. The simulation makes the buffer at its first pole. Reason: a stroke must never
   change the grid, the rule of ADR 0028 for the coarse maps of the view.

**The helper of the first build:**

4. **One outline pass writes both buffers.** A cell holds one pole, the one painted last. So a cathode stroke is a
   union with the cathodes and a subtraction from the anodes, as a wall stroke is for walls and food. An anode stroke
   is the mirror. An erase and a wall subtract from both. Food and light run no pass on the buffer. On WebGPU the
   pass has one more pipeline constant, `POLES`, and on WebGL2 the program is compiled a second time with `POLES`
   defined. The lines of the poles return before the lines of walls and food. Reason: no time was measured, so the
   pipelines of walls and food keep the statements that they had.
5. **A union of a pole is rounded off over 1.5 cells** (`POLE_RIM`), the slope that the view lights. It is the
   number of the bevel of a wall.
6. **On the buffer every stroke takes the pipeline with the tile of `env`**: every kind of stroke subtracts from a
   layer there, and a subtraction is held to the cells around it.
7. **A stroke before the first pole of a simulation runs no pass on the buffer.** Reason: a long edit list with one
   pole at its end must not pay twice for every wall and erase before it.
8. **WebGL2**: a stroke of a pole joins the runs of outlines as every other kind, and a run ends where its outline
   box meets a pending segment of another kind. A subtraction from a pole is drawn only after a stroke of that pole.
9. **The buffer is held to `env` with `shape`**, under the same flag: after a change of boundary, after strokes
   under another boundary, and after bytes written into `env` (tests only), which clear it first.
10. **Clear frees the buffer**, and the next pole makes it again. So a simulation holds it exactly while a pole may
    lie in `env`. **A reset and a switch of the model leave it**: they leave `env`, and both models have the
    electrodes.
11. **The render pass reads the buffer at binding 16** (WebGL2: the sampler `poles`). Without a pole `shape` stands
    in, and no frame reads it there. The pass makes its bind group anew when the buffer is another one. Binding 13,
    the cells of `env`, is gone: the pass holds 5 storage buffers as before.
12. **A pole is a stud.** The numbers are in `studAt()` of `render.wgsl` and `render.frag`.
    - Its outline is the spline of the view on the 3 × 3 cells of the buffer, with a ramp one pixel wide.
    - Its surface is a dome over the outer 1.5 cells and flat from there on. The height rises as t (2 − t), so the
      slope is steepest at the outline. Reason: the bevel of a wall is flat at the outline, which reads as a pillow.
    - The light is the light of the walls: the colour times 0.5 + 0.7 × diffuse, plus a highlight of 0.6 × shine^60.
      The flat top is 0.96 of the colour of the pole.
    - A dark line runs along the outline: the colour goes toward a quarter of itself, by 0.6 at the outline, over 1.5
      pixels, at least 0.35 and at most 0.75 cells. Reason for the upper limit: a small pole keeps its colour in a
      view zoomed out.
    - A shadow lies beside the outline on the side away from the light: full at the outline, gone 2 cells from it,
      times the cosine between the gradient of the distance and the light. It is as dark as the shadow of a wall in
      each style (0.75, 0.6 and 0.3). Reason for the distances: the buffer needs no third byte and no pass for it.
    - The cathode is blue and the anode red in every style, as before.
    - Where a cathode meets an anode, each covers its share of a pixel, in one blend.
13. **A pole covers all of what lies below it**: an opacity of 1 in place of 0.9. It stays over everything, as
    ADR 0047 decided. Reason: at 0.9 the squares of the agents and the highlights of the gel showed through the
    surface, as dirt on the stud.
14. One helper of the view, `cellsAround()`, names the 3 × 3 cells for `shape` and for the buffer of the poles.

**The helper of the second build:**

15. **The pole below a pole or a wall ends where that stroke begins.** A pole and a wall fill the cells that they
    take from a pole, and the view draws them from the rounded byte of their union. So their subtraction takes the
    complement of that rounded byte. An erase fills nothing, and it takes the complement of the plain distance of
    the stroke, as every subtraction of walls and food does. Reason: with the plain distance a stroke thinner than
    2.25 cells was drawn narrower than the gap that it cut, and the ground showed between the two poles.
    `research/electrode/outline.ts` gives the least share of a pixel that the two poles cover together on the seam
    of an anode line over a wide cathode, at three zooms, and the widest gap between the two outlines:

    | Radius of the line, cells | Plain, 8 px per cell | Plain, 3 px per cell | Plain, 1 px per cell | Plain, gap in cells | Rounded, 8 px per cell | Rounded, 3 px per cell | Rounded, 1 px per cell | Rounded, gap in cells |
    | ------------------------- | -------------------- | -------------------- | -------------------- | ------------------- | ---------------------- | ---------------------- | ---------------------- | --------------------- |
    | 0.75                      | 0.02                 | 0.50                 | 0.78                 | 0.14                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
    | 1                         | 0.12                 | 0.60                 | 0.81                 | 0.10                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
    | 1.5                       | 0.34                 | 0.72                 | 0.87                 | 0.07                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
    | 2                         | 0.98                 | 0.99                 | 0.99                 | 0.00                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
    | 2.25                      | 1.00                 | 1.00                 | 1.00                 | 0.00                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |
    | 3                         | 1.00                 | 1.00                 | 1.00                 | 0.00                | 1.00                   | 1.00                   | 1.00                   | 0.00                  |

    Reason for the plain distance of an erase: it gives the straighter edge. Along an erased line of 0.75 cells the
    pole begins 0.68 to 0.76 cells from the middle of the line with the plain distance, and 0.59 to 0.75 cells with
    the rounded one. The first build took the plain distance for every subtraction. The pictures that the owner saw
    held no pole thinner than 2 cells over another pole.

16. **Two CPU references** hold both backends: `src/engine/outline-reference.ts` is the outline pass, the pass that
    holds the bytes to `env`, and the spline of the view. The model of the outline pass moved there from the GPU
    tests and got the rule of the poles beside the rule of walls and food. `src/engine/electrode-reference.ts` is
    the stud and the blend of the two poles.

## Results

All on an M3 Pro (Metal), 2026-11-17. No time was measured: the session "slime look" ran other work on the GPU.

**No run changes.** The digests of the agents, the trail, the scent, the environment, the flow memory and the
pressure (`research/flow/engine/digest.gpu.test.ts`) equal those of `main` at `a6ffe64`: 54 of 54 runs after 500
steps (the default settings and the 26 scenes on both backends), and 16 of 16 after 3,000 steps (the eight scenes
with the flow on both backends). The runs are those of the code of the pull request. The record of `main` is the one
of ADR 0055: no commit since then changed a pass, and the digests of `main` after 500 steps, made again in the first
build, equal it line for line.

**The fit of the grid.** `research/electrode/fit.ts` fits the default settings and the 26 scenes with the 4 B and
without them, on three backends (WebGPU, WebGL2, WebGL2 without float blending), six hints of the memory of the
device (none, 0.5, 1, 2, 4 and 8 GB) and six canvases: 2,916 cases. One grid changes: the scene Cyclones on WebGL2
without float blending, with a hint of 2 GB on a canvas of 390 × 844 pixels, goes from 1024 to 768 cells on the long
side. Every other case keeps its grid.

**Tests**, on both backends unless a backend is named:

- **The bytes of the buffer** (`sim.gpu.test.ts`, "outline distances for the renderer", "of the electrode tool"):
  random strokes of the six kinds and wide strokes against the CPU model, in every arena; one call against one call
  per stroke, also under mixed boundaries; the pole below a pole, a wall and an erase, byte for byte; three
  boundaries in a row and bytes written into `env` against the CPU model of the pass that holds the bytes, byte for
  byte; no byte before the first pole and after a Clear; every byte kept over a reset, over steps and over a switch
  of the model; the number of passes of a stroke before the first pole and after it.
- **The picture** (`electrode.gpu.test.ts`), every pixel against the CPU reference within 2 of 255: the flat top,
  the slope, the line and the shadow in each style, with chosen points in closed form; every zoom from 8 pixels per
  cell to 6 cells per pixel in each arena, and the copies of a periodic lattice; every cell centre on the side of
  the outline that `env` holds; a pole over the trail, the agents, food, light, a wall and the scent view; no ground
  on the seam of two poles; the picture after an erase, a wall, the other pole, a Clear, a reset, a switch of the
  model, a change of boundary and bytes written into `env`.
- **A frame without a pole has the pixels of before**: 56 frames of six simulations in every arena and style, with
  food, light and walls and without them, against the render shaders of `main` at `a6ffe64` without their code of
  the electrodes: 0 of 255 apart. And a draw changes no byte of the simulation.
- **Unit tests**: `outline-reference.test.ts` and `electrode-reference.test.ts` state the two references in closed
  form, and `sizing.test.ts` holds the bytes per cell.
- **All tests at the head of the branch**: 824 unit tests with the research tests, 1,310 GPU tests on both backends
  (8 more run on one backend only), and 84 tests of the built app. Of them 21 unit tests of the two references, one of
  the fit, 4 of the record, 44 GPU tests of the picture and 49 of the bytes are of this record.

**Wrong rules.** `EL22` to `EL108` of `research/flow/engine/mutate.ts` are 87 wrong forms of the new code:

- 21 of the outline pass on the buffer: `EL22` to `EL35` in WGSL and `EL36` to `EL42` in GLSL;
- 30 of the code that draws the pass, runs it, holds the buffer and frees it: `EL43` to `EL60` on WebGL2, `EL61` to
  `EL70` on WebGPU, and `EL71` and `EL72` for both;
- one of the fit of the grid, `EL73`;
- 35 of the picture: `EL74` to `EL76` hand the buffer to the render pass, and `EL77` to `EL92` in WGSL and `EL93` to
  `EL108` in GLSL are the stud, its light, its line, its shadow, its cover and its place over the walls.

Each fails at least one test, 1 to 34 of them. Seven fail one test only: `EL53`, `EL55`, `EL57`, `EL61`, `EL65`,
`EL66` and `EL73`. The same run took `EL1` to `EL21` of ADR 0047 and `SL109` of ADR 0055 again, whose code this
record changed: each still fails tests. The list has 504 wrong rules.

**Checks**: `npm run lint`, `npm run check`, `RESEARCH=full npm test`, `npm run test:gpu`, `npm run build` and the
e2e tests pass on the code of the pull request; its description has the counts.

## Consequences

- Every scene needs 4 B more per cell on both backends, with a pole or without one. A grid at the limit of the
  memory of a device gets smaller: one case of 2,916.
- A simulation with a pole runs the outline pass twice for an erase and for a wall. The first pole builds one or
  two pipelines on WebGPU and one program on WebGL2, and the first change of boundary with a pole one more pipeline.
- A frame of a simulation with a pole reads 9 cells of the buffer at every pixel, where it read 4 cells of `env`.
  A frame without a pole reads none, as before.
- The agents that stand at a cathode lie below it. Before, a tenth of them showed through.
- The picture of the scene Electrotaxis changes. No link changes: a link holds the strokes.
- The outline pass has a rule that walls and food do not share (decision 15). The CPU model states both rules.
- `docs/design.md`, section 3 and section 5, and `docs/model.md`, section 6.7, describe the buffer and the stud.

## Open points

- **Not measured: the time of a draw with poles, and the time of a stroke of a pole.** With them: an erase and a
  wall in a simulation with a pole, and the first pole. `research/electrode/README.md` has the commands.
- **Thin strokes and small dabs.** A stroke of the thinnest brush (0.75 cells) has knots, and a dab of it on a
  corner of four cells is a small cross. A dab of 1.5 cells is drawn up to 0.16 cells smaller than its brush. It
  is the same for walls and food since ADR 0009: the spline of the view smooths, so a cell that is barely inside
  comes out outside at its centre, and the cover then adds a bump for that one cell. Two ways on, for all three
  layers at once: add the bump only where the spline shows nothing of the body in the cell, or take a spline that
  goes through its samples. Both change the rule of ADR 0009 that the picture agrees with `env` at every cell
  centre.
- **The nub where a cathode meets an anode and the ground.** The tip of the pole that lost cells is a small blob.
  The same shows where a wall lies over food.
- **A sliver of a pole between two strokes.** Where two strokes that cut a pole cross, or pass nearer than a cell to
  each other, the part of the pole between them holds no cell centre. The buffer holds no outline for it, and the
  ground shows there in a wedge smaller than a cell. The shot `seam` of `tests/pictures/electrodes.spec.ts` shows
  it where a thin wall crosses a thin anode on a wide cathode. Food between two walls has the same wedge.
- **A wall through a pole.** The wall is drawn first and the pole over it, each over what lies below. On the pixel
  in the middle of their seam a quarter of the ground shows (`outline.ts`, its fourth table). Before decision 15 a
  wall of the thinnest brush showed almost all of the ground there: 0.98 at 8 pixels per cell. By the same blend a
  wall beside food shows about a quarter of the ground too; that is an inference, not a measurement.
- **A thin wall over food** still has the gap that decision 15 took from the poles: the outline pass of walls and
  food takes the plain distance for every subtraction (ADR 0009).
- **The image of CI.** The tests ran on Metal before the push. CI runs them on SwiftShader.
