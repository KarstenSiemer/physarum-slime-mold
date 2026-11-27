# 0099: The veins in the picture

- Status: accepted. The owner asked for it on 2026-11-26. The coordinator gave the task on that day, under the
  owner's delegation of 2026-11-12. An agent built it on 2026-11-26 under the same delegation and made the choices
  below.
- Date: 2026-11-26
- Extends [ADR 0034](0034-the-picture-of-the-tubes.md) (the picture of the tubes).
- In short: while the picture of the tubes shows, the view draws a vein in a deeper and darker shade of the colour of
  its strain than the sheet around it, and in the gel style as a low lit ridge, as the CPU prototype draws it. Display
  only: no pass of the simulation changed, and the veins need no new texture.

## Context

The owner, on 2026-11-26 (in German): with the growth front on, the app often shows very homogeneous masses. "Der
Prototyp erzeugt Venen in leicht dunklerer Farbe als dem Rest des Strains, sieht eigentlich ganz gut aus. Können wir
das auch in die App bringen?" (The prototype draws veins in a slightly darker colour than the rest of the strain; it
looks quite good. Can we bring that into the app?) The look matters most.

The prototype (`research/front/picture.ts`, `look()`) takes the strength of a vein as v = √min(1, B · D) on a cell
with a tube (B ≥ 0.05), with B the tube body and D the flow memory. The body goes from the pale sheet (235, 200, 90)
to a deeper orange (210, 115, 30) at v = 1, and the vein is a raised ridge, lit by the light of the picture.

The app has the same strength already. Point 1 of `src/engine/tubes.ts` names "the strength of the tube of a cell":
tube body times flow memory. The pass `roots` of `tubes.wgsl` and `tubes.frag` writes, per cell and strain, the
fourth root of the strength across the tube (point 2: the sum of B · D over the 3 × 3 cells, over 3, at most 1). The
texture lives while the picture of the tubes shows.

In the growth run of the owner (Food ring with the territory, 8 edges, flow base 0.002, front flux 2, flow strength 8,
seed 7) the square root of the strength across, on the cells with a tube, has these quantiles (10, 25, 50, 75, 90 %):
0.01, 0.03, 0.18, 0.34, 0.54 at step 8,000, and 0.03, 0.15, 0.26, 0.40, 0.59 at step 12,000. A map of it shows the
ring, the spokes and their forks bright over a dimmer sheet of tubes.

## Options

1. Read the factors of `roots` in the render pass. No new texture: the pass binds the texture that the picture already
   holds. The strength across a tube is a sum over 3 × 3 cells, so it is wider than the strength of one cell.
2. Read the memory of the flow in the render pass: the strength of each cell, as the prototype takes it. On WebGL2 the
   memory of each strain is a texture of its own (`flowMemory`, `flowMemory1` to `3`), 4 more samplers in a pass that
   uses 14 of the 16 that every WebGL2 device has.
3. A new pass and texture of the veins: 4 to 16 bytes per cell more, and one more pass for each drawn state.

## Decision

Option 1. It costs no memory and holds the structure of the model: in the growth run the veins, the spokes and their
forks show in the deep shade, and the sheet of weak tubes keeps the colour of its strain.

1. The veins live under the switch "Draw the tubes by their flow" (`showTubes`, on at the start): they are a part of
   the picture of the tubes, and the texture that they read lives with it. With the flow off, or the switch off, the
   frame is the same as before, byte for byte (below).
2. The strength of a vein at a point is the square root of the strength across the tube, as the prototype takes the
   square root of the strength of a cell. The render pass takes it as a quadratic B-spline over the 3 × 3 cells around
   the point (as it takes walls and food), so a vein has no tooth at the edge of a cell, and its gradient from the
   same 9 cells.
3. From a strength of 0.2 to 0.7 the colour of the strain c goes in a smooth step up to 0.8 of the way to 0.8 · c²
   (`VEINS` in `tubes.ts`). The square of a colour is more saturated and darker, so each strain gets a deeper shade of
   its own colour: the yellow of strain A (#f2c14e) becomes about (215, 146, 36) on a whole vein, near the orange
   (210, 115, 30) of the prototype. Below 0.2 the colour stays as it was: in the growth run that keeps the sheet of weak tubes pale. A
   threshold of 0 gave a whole arm one orange; a straight ramp from 0 made the veins of step 12,000 hard to see.
4. In the gel style a vein is also a ridge 1 cell high at a whole vein: its gradient tilts the normal of the gel, so
   the light lights one side of it and the highlight runs along it, as in the prototype. The glow and paper styles
   have no relief: they take the shade alone (on paper as ink of the deeper colour). The agents style draws no veins.
5. `gelFx.z` of the uniform of the view says that a frame draws the veins (`packView()`): 1 while the trail of the
   frame is the picture of the tubes. The render pass of WebGPU binds the texture of `roots` at binding 13
   (`Simulation.veinTexture`), WebGL2 binds its target as `veins` (`GlSim.veinTarget()`).

## Consequences

- Memory: none. The render pass reads 9 texels of 16 bytes more per pixel while the picture shows. WebGPU binds 11 of
  its 16 sampled textures in the render pass, WebGL2 15 of its 16 sampler units in the widest program (the scent view
  over the skirt and the film, with food or walls). A new texture in that pass on WebGL2 needs a unit from another one.
- Not measured: the time of a frame. Not drawn: the veins in a frame zoomed out more than 2 cells per pixel (the
  spline then samples the cells at the point, not over the pixel; at 1.7 cells per pixel the Tokyo scene showed no
  aliasing).
- Proof (2026-11-26): `tubes.gpu.test.ts` draws a band of tubes on both backends and compares the glow of each pixel
  with the CPU reference of the veins (`veinDeep()`, `veinShade()` in `tubes-reference.ts`): at most 2 bytes off, with
  whole veins, veins in part, and the frames with the switch or the flow off, which hold no shade. `render.test.ts`
  checks the flag and that both shaders hold the numbers of `VEINS`. The frames with the flow off and with the switch
  off are byte-equal to `main` on both backends in all four styles (food ring, seed 7, 600 steps: a research runner
  outside the repository). The digests of every scene did not change, and the growth run of seed 7 kept its record
  to step 12,000 (alive agents, cells of plasm, tubes).
- The picture changed by design in one older test: on a whole vein the glow has less green and blue, so the test
  "draws a frame from the picture" compares red alone there.
- The look depends on the strength of the tubes in the model: in Food ring without the growth rules most tubes stay
  below 0.2 and the veins show only faintly; in Tokyo every tube shows its vein.
