# 0044: A repellent source in the Jones model

- Status: accepted (decision of the coordinator, 2026-11-15, under the owner's delegation of 2026-11-12), built
  2026-11-15
- Date: 2026-11-15
- Extends [ADR 0022](0022-jones-and-extended-model.md) (the Jones and the extended model): it replaces decision 8 and
  the list item "Light that releases a repellent scent" of "Not Jones".
- Extended by ADR 0047 (the Electrode tool: a source above and one below 0 at ±255).
- Extended by ADR 0048 (2026-11-15): the scene Voronoi diagram, the first scene with light, the repellent of the Jones model.

## Context

ADR 0022 says that no paper of Jones has a source that releases a repellent. So the Jones model drew light without an
effect (decision 8), and the app told its users that a spreading repellent is this app's rule. A reading of Jones'
papers on 2026-11-15 found that this is wrong. The pages are in
[jones-later-papers.md](../knowledge-base/jones-later-papers.md):

- Attractants and repellents are projected onto the same lattice, as a positive and a negative displacement
  (Jones, "Exploiting Environmental Computation", p. 1).
- A source above 0 attracts and a source below 0 repels, in the one diffusing lattice (Jones and Adamatzky 2015,
  Sec. 4.1, p. 7).
- A current source projects −255 and a current sink +255 at every step (Tsuda et al. 2012, p. 10).

ADR 0022 also dates Jones' light rule to 2017. It is of 2012 (Jones and Adamatzky, Bioinspir. Biomim. 7, p. 7): a lit
agent's sensor values are multiplied by a factor below 1. That is another rule than a repellent source.

**The app had the mathematics already.** The scent texture holds the food scent C_F and the repellent C_L. Both take
the same mean, sites, decay and source pass as the trail (`sources()` and the passes of `diffuse.wgsl` and
`diffuse.frag`), and a sensor reads Σ A · T + w_F · C_F − w_L · C_L (`agents.wgsl:154`, `agents.frag:117` and `:119`).
The update is linear and nothing clamps a field. So with the scent decay of the strain, a source factor of 1 and
w_F = w_L = the own weight, T + C_F − C_L is Jones' one map with a source below 0. Only `packParams()` stood in the way:
in the Jones model it packed a light weight of 0 and a light source of 0 (`src/engine/pack.ts`).

## Options

1. Leave the model and correct only the texts. Then the Jones model lacks a rule that Jones published.
2. The Jones model reads drawn light as a repellent source of Jones' map, and names it a repellent.
3. Also build Jones' light rule of 2012 (weaker sensors on a lit agent). A new rule with a new pass input.

## Decision

Option 2. The coordinator decided it on 2026-11-15 under the owner's delegation of 2026-11-12: the Jones model allows
a repellent source as Jones' papers use it, a negative projection on the one map. Option 3 is not built.

1. **The rule.** In the Jones model a lit cell releases 255 · Light strength per step into C_L, with the factor 1 that
   the food has, and the strain weighs C_L as it weighs its own trail (`packParams()`). No shader changed.
   [model.md](../model.md), sections 6.4 and 7.3, has the mathematics.
2. **The settings.** `asJones()` no longer resets Light strength, and it binds the light weight of the strain to the
   own weight, as it binds the food weight. `jonesFits()` did not change: light never decided the model.
3. **The names.** In the Jones model the Light tool is "Repellent" ("such as salt or a current source"), Light strength
   is "Repellent strength", and the legend of the scent, the Clear button and the Erase tool say repellent. The key,
   the setting `lightStrength` and the kind `light` of a stroke keep their names, so links keep working.

Own choices of the agent that built it (2026-11-15):

4. **The repellent weight is bound to the own weight, not to +1.** A strain that flees its trail (−1) reads −J, so it
   turns toward a repellent, as it turns away from food. This is what "one map" means. The three scenes with −1
   (Turing spots, Turing stripes, Wound healing) now hold a light weight of −1. They have no light, so their runs keep
   their bytes.
5. **Both models offer every tool.** The rule that light in the Jones model selects Move (ADR 0022, decision 25) and
   the line "The light on the canvas has no effect" (decision 29) are gone, with `fitTool()`, `lightDrawn()` and
   `JONES_LIGHT`. The notice of a switch to Jones says "The light acts as a repellent source in Jones' trail map" while
   light is drawn.
6. **The scent view draws the repellent in both models.** The switch for it in the render pass is gone
   (`render.wgsl`, `render.frag`).
7. **Old Jones links run as they were made.** A link holds the mark `rules: 44` from now on (`LINK_RULES`,
   `encodeSettings()`). A Jones link without the mark that holds drawn light opens with a repellent strength of 0
   (`sanitize()`). Reason: such a link ran its light without an effect, and the owner's rule of 2026-11-11 is that a
   link runs as it was made (ADR 0022, decision 24). Without the mark an old link would get a repellent of 0.05.
8. **Fleeing light stays in the extended model.** The Jones model runs it with the same bytes (Results). But to call
   the source light is this app's reading, and Jones' light is another rule. Its text now says so.
9. **The range stays 0 to 0.5.** It holds the node weights of Jones and Adamatzky 2015, Fig. 14, up to 0.45, and not
   their 0.7 or the −255 of Tsuda et al. (a strength of 1). The food strength has the same limit. Open in `TODO.md`.
10. **The facts of the papers are in a fact file**, `docs/knowledge-base/jones-later-papers.md`, not in an amendment
    of ADR 0022 or ADR 0025 (ADR 0040).

## Results

All on an M3 Pro, 2026-11-15, on the code of this pull request against `main` at `b93584e`.

- **Every scene keeps its bytes.** The digests of the 21 runs of `research/flow/engine/digest.gpu.test.ts` (every
  scene and the default settings, 500 steps, with the state of the flow) on both backends: 42 of 42 equal to those
  of `main`, made on the same machine in the same hour.
- **Fleeing light in the Jones model** (`VITE_ONLY=light VITE_PATCH='{"model":"jones"}'`): the digests of both
  backends equal those of the scene as it is, in the extended model.
- **The field is Jones' one map** (GPU tests on both backends, `src/engine/sim.gpu.test.ts`): trail + food scent −
  repellent stays within a relative error of 1e-5 of a float64 map with a source below 0, over 40 steps, in a box with
  a wall, on a periodic grid and in a dish, with both own weights and both step orders. The scent of the Jones model
  with a repellent follows the CPU references of the scent ("release food and light scent …", "diffuse trail, food and
  light at the edges and walls …").
- **The sensors.** The Jones model with a repellent gives the agents, the trail and the scent of the extended model
  with Jones' values, bit for bit, after 60 steps, for both own weights and both step orders. After 300 steps a strain
  that follows its trail has fewer than a quarter of its agents left in the disc of a repellent, and a strain that
  flees its trail has more than 1.5 times as many, each against the run without the source.
- **Wrong rules** J1 to J6 of `research/flow/engine/mutate.ts` (no weight; the weight of Light avoidance; no source;
  the source factor of the extended model; the sensor adds the repellent, in WGSL and in GLSL): each fails tests, 12,
  8, 48, 16, 2 and 2.
- `npm run lint`, `npm run check`, `npm test` (622 passed), `npm run test:gpu` (988 passed), `npm run build` and the
  e2e tests (81 passed, on another port than 4173) pass.
- Not measured: no run compares a repellent with a figure of Jones' papers or with the organism. The logs of these
  runs are not in the archive of `research/flow`.

## Consequences

- A user of the Jones model can bend a network away with a repellent, as in Jones and Adamatzky 2015.
- The Jones model still has a 3 × 3 mean only. The papers with repellents use a 5 × 5 mean (2015) and a 15 × 15 mean
  (Tsuda et al.), so their figures are not reproduced, and no scene of them exists.
- Jones' light rule of 2012 and his consumption rule of 2012 are not built ([fidelity.md](../fidelity.md), rows 13
  and 18).
- A Jones link from 2026-11-11 to 2026-11-15 with drawn light shows a repellent strength of 0. The user can raise it.
- ADR 0022 stays as it is (ADR 0040). Its decision 8, its decisions 25 and 29, and its date 2017 for Jones' light
  rule no longer hold.
