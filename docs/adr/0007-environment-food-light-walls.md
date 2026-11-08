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
- Walls: block movement like an occupied cell (random new heading, no deposit); sensors read
  walls and the outside as a large negative value; diffusion averages only over non-wall
  cells (no flux into walls).
- Boundary modes: periodic (Jones default), closed box, dish (circle, Jones Fig. 9 and 17–21).

## Consequences

- For one strain with food weight 1 and equal decay, behaviour matches Jones' single trail
  map.
- One more `rg32float` ping-pong pair and one more fetch per sensor.
