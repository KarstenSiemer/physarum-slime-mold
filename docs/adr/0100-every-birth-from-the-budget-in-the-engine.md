# 0100: Every birth from the budget, in the engine

- Status: accepted. The owner approved the port of option 1 of ADR 0097 on 2026-11-26 ("Ja"), with its estimate of
  about 500,000 tokens and 2.5 hours of GPU. Decisions 1 to 3 are the coordinator's, on the same day, under the
  owner's delegation of 2026-11-12. An agent built it on 2026-11-26 under the same delegation and made the choices
  under "The agent's choices".
- Date: 2026-11-26
- Extends [ADR 0071](0071-the-births-that-the-flux-pays-in-the-engine.md) (the births that the flux pays),
  [ADR 0092](0092-the-boom-at-a-new-food-is-jones-births-without-starvation.md) (option 3: every birth from the
  budget), [ADR 0093](0093-the-food-pays-the-growth.md) (`feed=flux`, the plasm of the dead back to the budget) and
  [ADR 0097](0097-paid-births-thin-the-sheet-and-fill-the-dish.md) (its option 1).
- In short: while the rules of the growth front run, every birth costs one from the budget of the paid births, the
  births at the front first, then Jones' births and the respawns with the chance min(1, B / n); a death that the model
  makes gives one back; each covered food gives the front the flux of one food; and the food credits the budget only
  up to the agents of the front. Both backends, `docs/model.md` 7.1, 7.2, 7.7, 8.7, 9 and 9.1.

## Context

ADR 0097 measured four proposals together in the CPU prototype and offered them as option 1. It recommended to wait
for the owner's answer to the question of mass; ADR 0098 gave it: an agent is not mass. The owner then approved the
port. The exact case of the prototype is `feed=flux payAll=front refund=1 feedCap=1` with the rules of
`research/front/p1d.sh`, the cases `cap-f1` and `cap-f9`.

## Decisions

1. **The budget counts area** (the coordinator, from ADR 0098). Decision 4 of `TODO.md` is answered: an agent is not
   mass, it stands for an area of plasm. So no rate of the organism binds the budget, and no scene changes its start.
2. **The cap on the credit, Jones' births everywhere** (the coordinator). On 2026-11-26 the coordinator ran three more
   cases of the prototype with nine foods, seed 1 (`research/front/p1e.sh`; records and pictures in
   `research/front/out/p1e/` of the main checkout, git-ignored, with the montage `p1e-compare.png`):

   | Case (nine foods, seed 1)                   | Agents at 10,000 | Sheet at 10,000 | Sheet at 20,000 | Rise at the second food |
   | ------------------------------------------- | ---------------- | --------------- | --------------- | ----------------------- |
   | The front first and the cap (`cap-f9`)      | 21,228           | 0.65            | 0.17            | +119 %                  |
   | The cap, Jones' births only at the edge     | 12,411           | 0.39            | 0.12            | +101 %                  |
   | The front first, Jones only at the edge     | 16,230           | 0.47            | 0.11            | +117 %                  |
   | The front first, Jones only on young ground | 15,617           | 0.45            | 0.15            | +100 %                  |
   | The front first, no cap (`front-f9`)        | 27,578–29,631    | 0.75–0.79       | 0.14–0.15       | +102 to +114 %          |

   The pictures decide, because the owner puts the look first (ADR 0098). With the cap, step 10,000 shows fans of
   veins from the foods with holes, and the steps 15,000 to 20,000 a closed network that joins all nine foods. With
   Jones' births only at the edge or only on young ground the network breaks apart at 15,000 to 20,000.

3. **Known and accepted, and open**: the boom at a new food stays (+100 to +119 % in the prototype); a full dish falls
   by about half in agents while the budget holds the rest; the sheet at step 10,000 with nine foods stays above the
   aim of 0.3.

## The agent's choices

- **Each pass settles in the next one**, as the prototype says a GPU must: the agent pass counts its deaths and its
  respawns, growth spends the budget plus those deaths and less those respawns, and the pass of the state settles the
  deaths and births of growth before the credit. The counts are 8 whole numbers per strain (`PAID_COUNTS` in
  `src/engine/paid.ts`): atomics on WebGPU, marks of the agents and points with additive blending on WebGL2.
- **Two passes count the respawns**: `claim` counts the respawns that pass their tests, `pay` draws for them, and
  `reborn` counts those that win their cells. `settle` cannot count them: it binds 8 storage buffers already, the
  most that WebGPU grants without a request. On WebGL2 mode 3 of the agent pass draws, and paid.vert counts.
- **`jones`, a pass after `rank`**: a parent of Jones' rule claims nothing in `test`; the front ranks first, a parent
  of Jones' rule among it; then each parent that the front did not pay draws. On WebGPU `rank` marks its paid parents
  in the buffer of the dead agents, which the step clears first and `win` writes anew; on WebGL2 marks of the agents.
- **The random streams** 13 (a respawn that waits) and 14 (a parent of Jones' rule that waits), `docs/model.md` 7.7.
- **The tools act from outside the model**: a dab of Inoculate places agents without the budget, and an agent that the
  cut or a wall kills gives nothing back.
- **F of the last growth step** stays in its lane of the state in a step without the growth test: the cap reads it.
- **A claim key of 0** (WebGPU, one id in 2^32 per step): such a parent of Jones' rule does not count and claims
  nothing.
- **No new setting**: the rules are part of Rules of the growth front. No memory per cell or per agent more.

## Measures

**The look.** Food ring with the levers of the crown (`{territory:true, flowEdges:8, flowBase:0.002, frontFlux:2,
flowStrength:8}`), WebGPU, seed 7, against row 3 of `p1e-compare.png`: at step 5,000 a ring of plasm at the rim with
veins inside; at 10,000 a thick band along the wall and veins from the middle food to the ring, with fewer fans than
the prototype shows; at 15,000 and 20,000 a closed network of tubes that joins all nine foods. The pictures are in
`research/front/out/owner/port/` of the main checkout.

**Food ring**, the same levers, seeds 1 to 3 on each backend, to step 20,000 (`bash research/front/p100.sh ring`,
`research/front/p100-ring.gpu.test.ts`; the table `bash research/front/p100.sh table`):

| Run       | Agents at 10,000 | Agents at 20,000 | Budget at 20,000 | Sheet at 10,000; 20,000 | Rise at the second food |
| --------- | ---------------- | ---------------- | ---------------- | ----------------------- | ----------------------- |
| WebGPU s1 | 22,139           | 2,665            | 19,704           | 0.59; 0.17              | +110 %                  |
| WebGPU s2 | 22,220           | 2,652            | 19,907           | 0.53; 0.16              | +96 %                   |
| WebGPU s3 | 23,087           | 2,693            | 21,002           | 0.60; 0.16              | +86 %                   |
| WebGL2 s1 | 21,615           | 2,533            | 19,260           | 0.52; 0.16              | +67 %                   |
| WebGL2 s2 | 22,171           | 2,558            | 20,612           | 0.56; 0.16              | +77 %                   |
| WebGL2 s3 | 22,743           | 2,793            | 20,322           | 0.55; 0.17              | +92 %                   |
| Prototype | 21,228           | 3,608            | 18,020           | 0.65; 0.17              | +119 %                  |

The prototype is `cap-f9`, seed 1 (ADR 0097). The colony peaks at 21,716 to 23,540 agents at step 10,300 to 10,900,
when it fills the dish; the front stops taking flux at step 10,400 to 11,200, and the colony falls to about 2,700.
The rise counts from the first record with two covered ports, every 100 steps.

**The help texts** (WebGPU, seed 1): with Flow strength 2 and the other levers Food ring holds 2,912 agents at step
10,000 (22,139 with 8); with the rules and the levers of the scene it holds 1,358 at step 8,000, and 15,665 to
17,340 with the levers of the crown (3 seeds).

**The Y-maze with slime**, seeds 1 to 10 per backend (`bash research/front/p100.sh y`, the runner of ADR 0088):

| Y-maze with slime on one arm | Blank arm first | First food (median, range) | The other food after it (median) |
| ---------------------------- | --------------- | -------------------------- | -------------------------------- |
| WebGPU                       | 5 of 10         | 2,912.5 (2,522 to 3,140)   | +297 steps                       |
| WebGL2                       | 5 of 10         | 2,953 (2,632 to 3,220)     | +192 steps                       |
| `main`, WebGL2               | 10 of 10        | 3,207.5 (3,097 to 3,722)   | +1,912.5 steps                   |

ADR 0088 had 40 of 40 on each backend, and Reid et al. 39 of 40. With the budget the colony no longer avoids the
slime: it grows faster (WebGL2 seed 1: 694 agents at step 2,000 against 463 on `main`) and reaches both foods within
a few hundred steps of each other. The owner said that 39 : 1 against 40 : 0 does not matter (ADR 0098); 5 : 5 is the
level of chance. See "Open".

**The Crown of veins**, WebGPU seeds 1 to 3, to step 16,000 (`bash research/front/p100.sh crown`), live agents /
reach of the tube body in cells, against ADR 0087 (seeds 1 and 2):

| Step   | ADR 0087 s1; s2          | ADR 0100 s1; s2; s3                      |
| ------ | ------------------------ | ---------------------------------------- |
| 2,000  | 506 / 46; 505 / 48       | 525 / 46; 637 / 50; 527 / 47             |
| 4,000  | 1,572 / 79; 1,567 / 80   | 1,871 / 87; 2,020 / 92; 1,877 / 92       |
| 8,000  | 3,950 / 129; 4,015 / 130 | 4,904 / 168; 5,074 / 176; 4,912 / 176    |
| 12,000 | 5,763 / 169; 5,960 / 171 | 8,092 / 251; 8,280 / 255; 8,058 / 255    |
| 16,000 | 7,207 / 209; 7,223 / 210 | 11,185 / 330; 11,447 / 336; 11,221 / 332 |

The crown grows about 1.5 times as fast and reaches 330 cells at step 16,000 in place of 210: the deaths behind the
front pay births at the front. The look changes too (seed 1, WebGPU, steps 8,000 and 16,000, in
`research/front/out/owner/port/crown-s1-webgpu/` of the main checkout): a band of plasm along the rim and two main
veins from the neck that fork toward it, and between them empty ground, where ADR 0087 showed a half disc of sheet
with veins in it.

**The bytes of the scenes** (`research/flow/README.md`, part 36): after 500 steps on both backends, 58 of 68 runs keep
the bytes of `main`; the 10 others are the five scenes with the rules (the three Y-mazes, Slime everywhere, the Crown
of veins) on each backend, which differ after 500 steps and after 3,000.

## Consequences

- `docs/model.md` 7.1, 7.2, 7.7, 8.7, 9 and 9.1 hold the rules; the help of Rules of the growth front, Flow strength
  and Flux to the front name the new numbers.
- Wrong rules: the texts of 33 wrong rules followed the code, TY170 went (its rule is gone), and PB1 to PB15 are new;
  FP15 of the prototype had a stale text, which follows `sim.ts` again.
- Open (decision 3): the boom at a new food, the fall of a full dish with the budget that holds the rest of the area
  and that no picture shows, and the sheet of 0.52 to 0.60 at step 10,000 with nine foods. At 10,000 the engine draws
  a band along the wall with fewer fans of veins than the prototype.
- Open, and new: the Y-maze with slime loses its choice (5 : 5 on each backend over 10 seeds, against 40 : 0 in ADR
  0088), and the Crown of veins grows 1.5 times as fast and leaves the ground behind its rim empty. The cause is not
  isolated. A guess, not tested: the budget no longer binds the front (the deaths behind it pay its births), so the sinks on slime, which
  take 40 times less flux, are paid as the others are. The coordinator decides whether the scenes of Reid et al. keep
  this rule, and whether a study isolates the cause first (in the prototype, ADR 0074 has the Y-maze there).
- Not measured: more than 3 seeds of Food ring, Food ring with one food in the engine, the other scenes of the app
  with the rules switched on, and a stored budget spent at a food that comes after the dish is full.
