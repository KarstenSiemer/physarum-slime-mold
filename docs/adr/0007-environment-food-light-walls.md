# 0007: Environment: food scent, light and walls

- Status: accepted
- Date: 2026-11-08

## Context

Jones projects food stimuli into the same trail map the agents deposit into, with weight
`wProj` 0.01–0.5 (p. 144, Fig. 17–20). His data map also holds obstacles and a habitable area
(p. 131) and mentions a layer for hazardous stimuli. Real Physarum avoids light (biology
note). With several strains (ADR 0006), a strain may have negative weights for other strains'
trails.

## Options

1. Project food into every strain lane — a strain that repels other strains would then also
   be repelled by food. Wrong.
2. Project food only into each strain's own lane — food would look like that strain's trail
   to other strains.
3. **Separate scent fields** that diffuse and decay like the trail: one for food
   (attractant), one for light (repellent). Every strain senses both with its own weights.

A static, non-diffusing light field was rejected: inside a uniformly lit area all three
sensors read the same value, so agents feel no gradient and walk through the light.

## Decision

Option 3, plus:

- Scent texture `rg32float` (ping-pong): `r` = food scent, `g` = light (repellent) scent.
- Sensed value: `dot(trail, A[strain]) + food_s · scent.r − light_s · scent.g`.
- Sources per step: `food(cell) · 255 · wProj` and `light(cell) · 255 · wLight`, so `wProj`
  keeps Jones' meaning for a full-intensity food pixel. The extended model scales both sources with
  the scent decay; the Jones model binds the scent to the trail (ADR 0022 and the amendment below).
- Walls: block movement like an occupied cell (random new heading, no deposit), also when a move
  would pass through a wall cell on its way (ADR 0019); sensors read walls and the outside as a
  large negative value, and in the extended model also a sensor whose way from the agent passes
  through a wall cell, so no agent senses the trail behind a wall (ADR 0020, ADR 0022); diffusion averages only over non-wall cells (no
  flux into walls; superseded by the amendment below and ADR 0027: [model.md](../model.md), section 6.3). A cell is a wall when its wall byte is at least 128 (0.5), in WGSL and GLSL
  alike (ADR 0019).
- Boundary modes: periodic (Jones default), closed box, dish (circle, Jones Fig. 9 and 17–21).

## Consequences

- For one strain with food weight 1 and equal decay, behaviour matches Jones' single trail
  map.
- Food acts over a short range (measured on WebGPU on 2026-11-09). With
  scent decay 0.1 the scent decreases by a factor of e every 1.6 to 1.7 cells with one diffusion
  pass (the default settings and Jones' scenes) and every 2.3 to 2.4 cells with two (the start
  scene; measured on 2026-11-11), so an agent notices food only when a
  sensor comes close. In the dense start scene food becomes a hub, about 6 times the mean agent
  density in the disc with radial paths around it, and the rest of the network stays as it was.
  A whole network reorganizes around food only with few agents and a contracting network
  (Jones Fig. 18 to 21: the scenes Shortest path, Steiner tree, Shrinking plasmodium). Lower
  scent decay reaches farther but also pulls more and more agents into the food. The help texts
  of Food strength and Scent decay and Learn → The model say this.
- One more `rg32float` ping-pong pair and one more fetch per sensor.
- Food, light and walls exist only on the GPU, so the engine keeps every edit since the last
  "Clear" or preset load and paints them all again on every new simulation, on a new grid through
  the canonical frame of the arena it was painted in. A stroke that later strokes cleared completely
  on the grid on screen leaves the list (ADR 0019). Such a replay writes the renderer's outlines
  with `env` (next item).
- The simulation reads `env`, one byte per layer and cell. How food, light and walls look is the
  renderer's business (ADR 0009, amendment 2026-11-10): the brush also writes distances to the
  outlines that only the renderer reads, so outlines are smooth at any zoom while a cell stays
  food or wall exactly when its centre lies within the brush. Food is drawn below the trail. A
  dish paints no `env` outside itself, and when the boundary changes `env` stays as it is: the
  outlines follow it under the new boundary (ADR 0009, item 10).

## Amendment 2026-11-11: the model switch (ADR 0022)

Decided on 2026-11-11 by the owner: a model "Jones" holds only Jones' published rules, and a model
"Extended" holds Jones' rules and this app's additions. ADR 0022 records the reasons and every
choice made with it.

- The separate scent field stays in both models. For one strain whose food weight is its own trail
  weight and whose scent decays with the trail, trail + scent is Jones' one trail map (p. 144): both
  fields take their sources in the same pass and get the same means and the same decay. A GPU test
  checks the sum against a CPU reference of the one map (within 1e-5). The Jones model has only
  this case: one strain, the scent decay equal to the strain's decay, the food weight equal to the
  strain's own trail weight, and no light (ADR 0022, decision 3).
- Option 3 serves the extended model: several strains, light, a scent decay of its own and a food
  and light weight per strain. There the extended model releases `255 · wProj · g(d)` and
  `255 · wLight · g(d)` with `g(d) = (d / (1 − d)) / (0.1 / 0.9)`, d the scent decay: the scent of
  a large food is then the same at every decay, 114.75 for wProj 0.05, and only its reach grows.
  (Since ADR 0027 this g holds for the order that senses first; moving first g = d / 0.1 and the plateau is 127.5:
  [model.md](../model.md), section 6.4.)
  g(0.1) = 1 exactly, so at decay 0.1 it releases the scent of the Jones model.
- Covered food, a rule of Jones' later papers (Adamatzky and Jones 2010, Jones and Adamatzky 2014),
  works in both models: a food cell releases a small share of its scent (0.001 by default, a
  setting per scene) while the 3 × 3 window around it holds an agent. It is off in every scene.
- Trail saturation (extended model only) makes a sensor read each strain's trail t as
  `t / (1 + t / K)`, so food can turn agents on a dense trail.
- Sensors that a wall on their way blocks (ADR 0020) and a cut that clears the chemicals are the
  extended model's only. In the Jones model a sensor reads its own cell, and the wound keeps its
  trail and scent (Jones 2010, p. 148).

## Amendment 2026-11-11: absorbing edges and the walls of each model (ADR 0027)

Decided on 2026-11-11 by the owner, for both models. The diffusion no longer averages over the habitable cells only
(the "no flux into walls" of the decision above): the mean is the sum of the 9 cells divided by 9 at every site of the
arena. A cell outside a closed arena counts 0 and holds 0, so trail and scent that leave the box or the dish are lost,
as in Jones 2011 (p. 1353). In the Jones model a wall cell is a site like any other: the trail and the food scent
diffuse into it and decay there, and it takes no deposit or source (Jones and Adamatzky 2014, p. 23; Jones 2015,
p. 14). In the extended model a wall cell is a sink that holds 0, so nothing passes a wall, as its sensors cannot see
past one (ADR 0020). Food and light follow the trail's rule in each model. A sensor in a wall cell reads the large
negative value in both models, as before. The reflective rule made a growing colony coat the walls and kept a branch
to the rim of Shortest path in 2 of 20 runs. ADR 0027 records the measurements, and the agents' step order of Jones,
which changed on the same day: the scent sources now enter after the step's diffusion in the order that moves first,
and before it in the order that senses first ([model.md](../model.md), section 6.2).

## Amendment 2026-11-13: the soft edge of light without a reversed smoothstep

Both paint shaders gave the soft edge of a light stroke as `smoothstep(r, 0.3 r, d)`, with the first edge above the
second. GLSL ES 3.00 leaves smoothstep undefined if edge0 ≥ edge1 (Khronos reference page of smoothstep for OpenGL
ES 3), so a WebGL2 driver may give any value there. Both shaders now write the Hermite step out, with the same float
operations as `lightByte()` in `src/engine/brush.ts`: t = clamp((d − r) / (0.3 r − r), 0, 1), t² (3 − 2t).
Coordinator's choice under the owner's delegation of 2026-11-12. `1 − smoothstep(0.3 r, r, d)` gives the same value in
real numbers, but other float operations.

Checked on an Apple M3 Pro (Chromium, Metal), both backends: 400 light strokes with radii from 0.75 to 31 cells on
256 × 256 cells give the same SHA-256 of `env` with the old and the new shaders (65,209 lit cells). The paint tests
compare the light bytes with the CPU reference on both backends; an edge at 0.4 r instead of 0.3 r fails 3 of them on
each backend.
