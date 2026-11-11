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
  keeps Jones' meaning for a full-intensity food pixel.
- Walls: block movement like an occupied cell (random new heading, no deposit), also when a move
  would pass through a wall cell on its way (ADR 0019); sensors read walls and the outside as a
  large negative value, also a sensor whose way from the agent passes through a wall cell, so no
  agent senses the trail behind a wall (ADR 0020); diffusion averages only over non-wall cells (no
  flux into walls). A cell is a wall when its wall byte is at least 128 (0.5), in WGSL and GLSL
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
