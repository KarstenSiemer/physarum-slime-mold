# 0050: Light stops growth

- Status: accepted (the owner chose the rule on 2026-11-16; its details are decisions of the coordinator of the same
  day, under the owner's delegation of 2026-11-12), built 2026-11-16
- Date: 2026-11-16
- Extends [ADR 0025](0025-growth-and-shrinkage.md) (the growth rule) and
  [ADR 0042](0042-a-second-tokyo-scene-with-light.md) (the scene Tokyo with light, and its open point).
- In short: [`research/flow/README.md`](../../research/flow/README.md), part 15, has the commands and the records.

## Context

ADR 0042 found that the colony of the scene Tokyo with light first grows over the lit ground as over dark ground: at
step 2,000 the network holds 15.9 % of its cells there, and the light covers 23.9 % of the land. Tero et al. 2010
(p. 440) state that the plasmodium avoids bright light, and their mask of light kept its growth to the shaded areas.

Three causes, read in the rules:

- The colony spreads by births. A moving agent places a child on a free cell beside it (`docs/model.md`, section 9).
  The growth rule does not read light.
- Inside a filled lit area the repellent is the same in every cell. So the three sensors of an agent lose the same
  amount, and the light turns an agent only at the edge of the area.
- A sensor reads the trail minus the repellent. A tube that crosses the edge holds far more trail than the repellent
  takes away (not measured).

**Jones' light rule does not answer this.** `TODO.md` proposed the rule of Jones and Adamatzky 2012 (Bioinspir.
Biomim. 7, p. 7): the sensor values of an agent in a lit region are multiplied by a factor below 1. Read on 2026-11-16:

- One factor on all three values changes no comparison of the sensory stage (Fig. 1(b) of the paper;
  `steer()` in `agents.wgsl`). So it turns no agent.
- The paper explains the effect at the interface of the lit region (p. 7 to 8): agents there read the dark side as
  stronger, because the lit side is damped. So the factor applies to each sample on a lit cell. An agent whose three
  sensors are lit turns as without light.

So Jones' rule acts only at the edge, as the repellent does. It is not built. `TODO.md` and
`docs/knowledge-base/jones-later-papers.md` now say this.

## Options

1. Jones' light rule per sample. It acts only at the edge, and growth still does not read light.
2. Light stops growth: a birth onto a lit cell fails with a chance. This app's own rule.
3. Light that grows with the altitude, as the mask of the paper. A new field with more than one strength of light per
   scene shape; it changes no cause above.

## Decision

Option 2. The owner chose it on 2026-11-16. The details are the coordinator's choices:

1. **The rule.** After a parent picked the free neighbour m for its child, the birth fails with the chance G_L · λ(m):
   G_L is the new setting Light stops growth (`lightGrowth`, 0 to 1), λ the light byte / 255 of m. The parent makes no
   claim in that step and picks no other cell. `docs/model.md`, section 9, has the exact rule.
2. **The cell of the child decides, not the cell of the parent.** Reason: the front must stop at the edge of the
   light, and a parent that walked onto lit ground may still divide into the dark. The wrong rules LG3 and LG8 read
   the cell of the parent, and the GPU test fails with them.
3. **The birth is dropped, the parent does not pick another cell.** Reason: one draw and one chance that the help
   text can state. A parent at the edge then divides less often; this slows the front along the edge a little.
4. **A random stream of its own (10), and no draw while the chance is 0.** So a run with G_L = 0, or without light,
   keeps its bits (the digests below).
5. **The default is 0, and a link holds the setting only when it is not 0.** So old links and every other scene run
   as before. A user who paints light in a scene with growth must set it. Open for the owner in `TODO.md`: a default
   above 0 would change runs of old links that hold light and growth.
6. **Only the extended model has it.** No paper of Jones has a rule for growth and light. `asJones()` holds it at 0.
7. **The uniform is `electrode.y`**, a free place of the parameters: no new slot, and the memory per step is the same.
8. **The scene Tokyo with light runs G_L = 1.** The strengths 0.5, 0.9 and 0.98 keep less growth off the lit ground
   (the table). Only 0.5 reaches Ito more often, and 0.5 keeps little growth off the lit ground. The scene changes
   its bytes: that is the aim of this change.

## Results

The scene Tokyo with light on WebGPU to step 48,000, measured as in ADR 0042. "On lit ground": the share of the cells
of the network whose light byte is above 0. G_L = 0 is the record of ADR 0042.

| G_L  | Seeds | On lit ground, step 2,000 | On lit ground, from 16,000 | All 36 foods joined, from 4,000 |
| ---- | ----- | ------------------------- | -------------------------- | ------------------------------- |
| 0    | 10    | 15.9 % (13 to 18)         | 4.6 % (1.3 to 8.7)         | 73 of 80 samples                |
| 0.5  | 3     | 13.0 % (12.6 to 13.6)     | 3.4 % (1.3 to 8.7)         | 12 of 24                        |
| 0.9  | 3     | 7.4 % (5.3 to 8.8)        | 1.9 % (1.2 to 4.7)         | 2 of 24                         |
| 0.98 | 3     | 5.5 % (4.8 to 6.2)        | 1.6 % (1.0 to 2.8)         | 2 of 24                         |
| 1    | 10    | 3.3 % (2.7 to 4.4)        | 1.3 % (0.9 to 1.9)         | 8 of 80                         |

- **The colony grows around the light.** At G_L = 1 the young network holds a fifth as many cells on lit ground as
  without the rule, and the old network less than a third.
- **Half a chance is not half the effect.** At 0.5 the young network is almost as without the rule. Growth is far
  faster than the front needs, so half as many births onto lit cells still fill the lit ground.
- **The measures of Tero et al. stay within the spread of the seeds.** At step 48,000 with G_L = 1: TL 1.69 ± 0.13
  (1.78 ± 0.07 without the rule), MD 0.83 ± 0.01 (0.83 ± 0.01), FT 0.85 ± 0.02 (0.88 ± 0.04). The organism with light:
  FT 0.86 ± 0.04. The 33 foods of Fig. 2 are all joined in 78 of 80 samples from step 4,000 on.
- **Ito stays alone.** Ito is one of the three foods of Fig. 1 that Fig. 2 and the statistics of the paper do not
  have. In the app's map it lies on 480 cells of dark land that the lit mountains and the coast enclose
  (`research/flow/engine/light-islands.ts`). From G_L = 0.9 on the colony does not keep a tube to it: a tube over lit
  ground loses agents and gets few new ones. The scene text says so. Open for the owner in `TODO.md`.
- **The rest on lit ground** (1.3 %) are agents that walk there: the rule stops births, not moves.
- **WebGL2** (seeds 1 and 2, to step 16,000): 2.3 and 2.4 % on lit ground at step 2,000, and 1.3 and 1.4 % at step 16,000; the 33
  foods joined and Ito not, in every sample.
- **Every other scene keeps its bytes.** The digests of every scene and of the default settings after 500 steps, on both
  backends, with the state of the flow: 48 of 50 runs equal those of `main` (`9dad09b`). The two others are Tokyo with
  light on each backend.
- **Tests.** `sim.gpu.test.ts`, "stop births onto lit cells as the CPU copy does": one growth step on both backends
  against `growth-reference.ts`, at G_L 0.6 and 1, with full and graded light. The 11 wrong rules LG1 to LG11 of
  `research/flow/engine/mutate.ts` each fail it.
- **The cost of a step** is not measured. The rule adds one read of the environment and one compare for a parent that
  divides, and a draw only onto a lit cell.

## Consequences

- A scene with light and growth can keep its colony in the shade. The default does not.
- A food that light encloses is out of reach at a high G_L. A scene must leave a dark way to each food.
- `docs/fidelity.md`, row 13, has the new numbers. The line of `TODO.md` on growth over lit ground is closed.
