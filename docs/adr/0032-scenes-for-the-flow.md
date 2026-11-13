# 0032: Scenes for the flow, also with several strains

- Status: accepted. The owner asked for the scenes on 2026-11-13. Every decision here is the
  coordinator's choice under the owner's delegation of 2026-11-12, with its date and reason.
- Date: 2026-11-13
- In short: three new scenes show the flow in the tubes (ADR 0029), two of them with rival strains
  that each build a network of their own (ADR 0031). For them, each strain starts on a food of its
  own. And the level of the trail from which a cell holds a tube now follows the decay of the
  strain, so the flow also acts in a scene whose trail decays fast.

## Context

The owner, on 2026-11-13: more scenes for the flow in the tubes, also scenes that show several
strains at once. He also named a case in which the flow showed nothing: the start scene Three
strains in a dish, with one agent per cell, growth and shrinkage, the flow and two foods.

Three things stood in the way.

- **The level of a tube.** A cell holds a tube of a strain from 0.2 deposits of trail on, and a
  full tube from 1 deposit on (ADR 0029, decision 4). ADR 0031 measured the owner's case: the trail
  of a strain is at most 0.26 deposits there, no cell holds a tube, and so the flow does nothing.
  The Maze has up to 2 deposits. The levels fit Jones' decay of 0.1, and that scene has a decay of
  0.6.
- **The start.** The start layout on food placed one colony, of strain A, on the first food
  (ADR 0025). A second strain had no agent until the user inoculated it.
- **No scene.** The two scenes with the flow, Maze and Tokyo rail network, have one strain.

## Decision

1. **The levels of the trail follow the decay of the strain** (2026-11-13). A cell that an agent
   enters at every step holds this trail in the end, in deposits:

   ```text
   held(decay) = (1 − decay) / decay      a step that senses first: T ← (T + 1) · (1 − decay)
   held(decay) = 1 / decay                a step that moves first:  T ← T · (1 − decay) + 1
   no tube below   0.2 · deposit · held(decay) / held(0.1)
   a full tube at  1.0 · deposit · held(decay) / held(0.1)
   ```

   The two lines for `held` are the two orders of a step in `diffuse.wgsl`: sensing first, the
   deposits enter before the decay, and moving first after it. At Jones' decay of 0.1 the factor
   is 1 in both orders, exactly, so the levels are those of ADR 0029 and every scene with that
   decay keeps its bytes. At a decay of 0.6 a cell holds 0.67 deposits where Jones' holds 9, and
   the levels are a thirteenth: 0.015 and 0.074 deposits. Reason: the level says where the
   plasmodium is, and the trail of a tube is a share of what a cell can hold. In the code:
   `trailLevels()` and `heldTrail()` in `src/engine/flow.ts`. Rejected: lower levels for every
   strain. The Maze and the Tokyo scene are measured with their levels (ADR 0029).

2. **The start layout on food starts a colony of each strain on a food of its own** (2026-11-13).
   Strain A starts on the first food of the scene, strain B on the second, and so on, about 50
   agents each, one step for each strain. A strain without such a food starts without agents, as
   before. A scene with one strain starts as it did. The panel names the layout "On food, one
   colony each". Reason: a strain that the user adds to a foraging scene had no agent, and rivals
   need a start apart from each other. Rejected: a new layout beside the old one. With one strain
   the two would be the same.

3. **Three scenes**, in the group Experiments, each with Jones' foraging agent of 2011, growth and
   shrinkage, the Maze's sensor distance and food weight, and the flow (`forager()` in
   `src/model/presets.ts`).

   - **Food ring.** One strain. A food in the middle and eight on a ring; the colony starts in the
     middle. A dish on a lattice of 384 × 384 cells, flow strength 2.
   - **Rival networks.** Two strains that flee each other's trail (weight −1). Ten foods in a dish
     on the same lattice; the strains start on two foods at opposite sides. Flow strength 2 for
     each strain.
   - **Tokyo, two networks.** Two such strains on the map of the Tokyo scene (ADR 0024), with its
     settings and its flow strength of 1.4. Strain A starts at Tokyo and strain B at Utsunomiya in
     the north; `tokyoShapes()` puts the foods of these two cities first.

   Reason for the lattice: a dish on a grid shaped like the screen is as wide as the short side of
   the screen, so the picture would differ from screen to screen; the Tokyo scene has a lattice for
   the same reason (ADR 0029, decision 12). 384 cells give a dish of 363 cells with 147,456 cells
   to compute, fewer than the 512 × 320 of the Maze.

4. **A link that holds the flow never opens as the Jones model** (2026-11-13). A link made before
   the model switch names no model, and it opens as Jones if Jones runs it as it was made
   (ADR 0022, decision 24). That rule looked at walls, light, food and the trail saturation, and
   not at the flow: the two scenes with the flow have walls. Food ring has the flow and no wall, and
   the test that opens every scene as such a link showed that it would open as Jones, without its
   flow. `runsAsJones()` now says no for a link with the flow.

## Results

All runs: the real engine, seed 1, WebGPU on an M3 Pro unless a line says WebGL2
(`research/flow/engine/strains.gpu.test.ts`).

### The owner's case

Three strains in a dish on a grid of 512 × 320 cells, one agent per cell, growth and shrinkage, the
flow, two foods. With the levels of ADR 0029 no cell holds a tube in any sample (ADR 0031). With
the levels of decision 1:

| Step  | Living agents of A, B, C | Cells with a tube of A, B, C | Foods that give or take, per strain |
| ----- | ------------------------ | ---------------------------- | ----------------------------------- |
| 0     | 21,863 / 21,877 / 21,860 | 0 / 0 / 0                    | 0 / 0 / 0                           |
| 1,000 | 7,567 / 8,208 / 8,496    | 45,086 / 42,755 / 45,411     | 2 / 2 / 2                           |
| 3,000 | 1,692 / 2,779 / 2,847    | 20,805 / 21,231 / 23,940     | 2 / 2 / 2                           |
| 5,000 | 851 / 456 / 518          | 5,118 / 2,004 / 4,669        | 2 / 2 / 2                           |
| 7,000 | 2,175 / 2,311 / 2,121    | 22,701 / 19,900 / 19,546     | 2 / 2 / 2                           |
| 8,000 | 854 / 377 / 477          | 8,863 / 1,986 / 3,193        | 2 / 2 / 2                           |

Every strain covers both foods, and a flux runs in each of the three flows. The meshes starve, and
a band between the two foods remains, one stripe of each strain. The colony does not come to
rest: growth sends out new strands, and the flow lets them starve again (step 7,000).

The same scene without the rule of one agent per cell had tubes before, because many agents share
a cell there. With the levels of ADR 0029 one strain was left at step 3,000 (3,930, 115 and 15
agents; two strains had lost the foods). With the levels of decision 1 all three keep both foods
(1,446, 1,336 and 229 agents).

### The scenes

| Scene                              | Step   | Living agents         | Cells with a tube        | Foods that give or take |
| ---------------------------------- | ------ | --------------------- | ------------------------ | ----------------------- |
| Food ring                          | 1,001  | 7,748                 | 30,184                   | 8 of 9                  |
|                                    | 2,001  | 6,944                 | 33,673                   | 9                       |
|                                    | 12,001 | 3,162                 | 19,061                   | 9                       |
| Rival networks                     | 2,002  | 8,125 / 7,987         | 36,038 / 32,800          | 10 / 9 of 10            |
|                                    | 4,002  | 7,111 / 7,105         | 35,403 / 35,866          | 10 / 10                 |
|                                    | 12,002 | 2,993 / 2,730         | 17,939 / 16,077          | 10 / 10                 |
| Rival networks, WebGL2             | 12,002 | 3,417 / 3,578         | 19,721 / 21,816          | 10 / 10                 |
| Rival networks with a third strain | 12,003 | 2,406 / 3,480 / 3,010 | 18,733 / 22,377 / 19,566 | 9 / 10 / 10             |
| Tokyo, two networks                | 2,002  | 7,610 / 7,209         | 34,849 / 32,496          | 39 / 40 of 42           |
|                                    | 14,002 | 3,960 / 3,799         | 23,189 / 22,758          | 38 / 41                 |

In every scene with rivals each strain keeps its own network on the foods to the end of the run,
and the strains hold about the same number of agents. The Tokyo map has 42 food sites: the 36
cities, and six more at Tokyo.

Food ring with other flow strengths, at step 12,001: with 0.5 the network has 8,908 cells with a
tube and 1,033 agents, with 2 it has 19,061 and 3,162, and with 8 it has 18,972 and 3,392.

### One strain and Jones' decay: the bytes of before

The 18 runs of ADR 0031 (nine on each backend, 2,500 steps, the Maze and the Tokyo scene among
them) give the digests of `main` at `7d3a5ee` in 18 of 18 runs, with the levels of decision 1 and
the start of decision 2.

### The tests

- `src/engine/flow.test.ts`: the trail that a cell holds, for each order of a step, against the
  two recurrences; the levels of ADR 0029 at Jones' decay, bit for bit; the levels at another
  decay.
- `src/engine/flow.gpu.test.ts`, on both backends: a strain with a decay of 0.6 holds a full tube
  on 0.1 deposits of trail, and a strain with Jones' decay holds none there.
- `src/engine/engine.gpu.test.ts`, on both backends: the Foraging maze with three strains starts
  about 50 agents of strain A on the first food and of strain B on the second, and none of strain
  C.
- `src/model/params.test.ts`: a link with the flow and no model does not open as Jones.
- `tests/e2e/flow.spec.ts`: the scene Rival networks in the built app.
- `research/flow/engine/mutate.ts` has two more wrong rules, the levels without the decay of the
  strain for each backend. Both fail the GPU test above.

### The cost

The time of a step in ms, the median of 21 samples of 50 steps after 3,000 steps
(`research/flow/engine/bench.gpu.test.ts`):

| Scene               | Cells     | WebGPU, flow off | WebGPU, flow on | WebGL2, flow off | WebGL2, flow on |
| ------------------- | --------- | ---------------- | --------------- | ---------------- | --------------- |
| Food ring           | 384 × 384 | 0.28             | 1.36            | 0.69             | 1.80            |
| Rival networks      | 384 × 384 | 0.30             | 2.48            | 0.70             | 3.12            |
| Tokyo, two networks | 512 × 512 | 0.49             | 6.17            | 0.83             | 6.74            |

## Consequences

- The owner's case now shows the flow: a band between the two foods remains, with a stripe of
  each strain.
- A scene whose strains have Jones' decay of 0.1 runs as before. With another decay the flow now
  counts cells as a tube that it did not count before, and so its run changes: more cells adapt
  and starve, and a strain keeps a food on a weaker trail.
- A strain that the user adds to a scene with the start on food now starts with a colony, on the
  next food of the scene. A link to such a scene with several strains, made before this change,
  starts these colonies too.
- At the default speed of 120 steps per second, Tokyo with two networks needs 0.74 s of GPU time
  for each second on an M3 Pro. The frame budget (ADR 0028) then lowers the steps per second.
- The networks of the rivals take long: they are still thinning at step 12,000, which is 100 s at
  the default speed.
- Open, as before (ADR 0031): a food site is one cell, and the picture does not show how strong a
  tube is (`TODO.md`).

## How to check this record

[`research/flow/README.md`](../../research/flow/README.md), part 9, has one command for each
result of this record. The logs of the runs are in `research/flow/logs.tar.gz`, in
`logs/engine/`: `scenes-*.jsonl`.
