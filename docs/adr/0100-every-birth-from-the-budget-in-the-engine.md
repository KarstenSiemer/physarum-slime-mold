# 0100: Every birth from the budget, in the engine

- Status: accepted. The owner approved the port of option 1 of ADR 0097 on 2026-11-26 ("Ja"), with its estimate of
  about 500,000 tokens and 2.5 hours of GPU. Decisions 1 to 3 are the coordinator's, on the same day, under the
  owner's delegation of 2026-11-12. An agent built it on 2026-11-26 under the same delegation and made the choices
  under "The agent's choices". The same day the Y-maze with slime lost its choice; the coordinator set parts A and B,
  a second agent found the cause and chose the rule of decision 4 on the evidence of part A, and the coordinator
  decided decision 5, whose look the owner approved.
- Date: 2026-11-26
- Extends [ADR 0071](0071-the-births-that-the-flux-pays-in-the-engine.md) (the births that the flux pays),
  [ADR 0092](0092-the-boom-at-a-new-food-is-jones-births-without-starvation.md) (option 3: every birth from the
  budget), [ADR 0093](0093-the-food-pays-the-growth.md) (`feed=flux`, the plasm of the dead back to the budget) and
  [ADR 0097](0097-paid-births-thin-the-sheet-and-fill-the-dish.md) (its option 1).
- In short: while the rules of the growth front run, every birth costs one from the budget of the paid births, the
  births at the front first, then Jones' births and the respawns with the chance min(1, B / n); a death that the model
  makes gives one back; each covered food gives the front the flux of one food; and the food credits the budget only
  up to the agents of the front. An agent of the front is paid only while its key k lies below B / P, P the sum of the
  rates of the agents with a key (decision 4), and the drift reads the pressure of one food (decision 5). Both
  backends, `docs/model.md` 7.1, 7.2, 7.3, 7.7, 8.7, 9 and 9.1.

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

4. **The share of a sink limits its births** (an agent under the delegation of 2026-11-12, on the evidence below; the
   coordinator set the target on 2026-11-26: the Y-maze with slime on one arm must take the blank arm again, at least
   36 : 4 in the prototype, without a rule that changes the look of option 1 in Food ring). In a growth step the ⌊B⌋
   agents of the front with the least keys k = −ln(1 − u) / r claim, as before, but only those with k · P < B, P the
   sum of the rates r of the agents of the strain with a key. So each agent of the front is paid with the chance
   1 − e^(−B · r / P) at most: B times the share of its sink. What the front does not spend goes on to Jones' births and
   the respawns, as before. See "Part A" below.
5. **The drift of one food** (the coordinator, 2026-11-26; the owner approved its look on the same day: "Drift einer
   Nahrung sieht sehr gut aus! Dran bleiben!", in English: the drift of one food looks very good, keep at it). While
   the rules run, the drift of a strain is divided by the foods that its last flow pass covered, at least one
   (`driftPerFood` of the prototype, ADR 0097, finding 7). See "Part B" below.

## Part A: the Y-maze lost its choice, and why

On 2026-11-26 the port gave 5 : 5 with slime on one arm, seeds 1 to 10 on each backend (`main`: 10 : 0 on WebGL2; ADR
0088: 40 : 0; Reid et al. 2012: 39 : 1). The coordinator guessed that the budget, which the plasm of the dead keeps
full, pays every agent of the front, on slime as near fresh ground.

**The study** (`research/front/ywhy.sh`, `ymaze-why.ts`, `ywhy-table.ts`; CPU prototype, the rules in force of ADR
0088 with the drift `take` at 1.5, slime on one arm, seeds 1 to 40, the run ends at the first food). Each case changes
one rule. The births are summed from the start of the colony to the first food; "covers" is the share of the steps in
which the budget is at least the agents of the front.

| Case                                         | Blank : slime | First food (median) | Budget covers | Front births, blank; slime | Jones, blank; slime |
| -------------------------------------------- | ------------- | ------------------- | ------------- | -------------------------- | ------------------- |
| Today (`main`)                               | 40 : 0        | 3,292               | 0.00          | 1,565; 129                 | 516; 1,155          |
| Every birth from the budget, no refund       | 40 : 0        | 3,535               | 0.00          | 1,543; 69                  | 208; 26             |
| And the dead give back (refund)              | 24 : 16       | 2,955               | 0.96          | 2,509; 3,745               | 295; 890            |
| And the cap and the flux per food (the port) | 28 : 12       | 2,978               | 0.66          | 2,519; 3,808               | 292; 837            |
| The port with Jones' births first            | 27 : 13       | 3,013               | 0.67          | 2,535; 3,403               | 292; 1,120          |

So the refund is the cause, as the coordinator guessed. Without it the budget never covers the front, and the rank of
the keys gives the paid births to the sinks with the larger rates: 1,543 on the blank arm, 69 on the arm with slime.
With it the budget covers the front in 66 to 96 % of the steps, the rank then pays every agent of the front, and the
arm with slime gets more paid births than the blank arm (3,808 against 2,519). A probe of seed 1 shows why: the budget
holds 31 to 41 and the agents of the front number 19 to 36, many of them on cells of the arm with slime whose rate
is near 0 (sinks on slime and old sinks whose rate decays). The cap and the order are not the cause.

**The forms that limit the front** (the same 40 seeds; Food ring with nine foods, seed 1, with the rules of the port
and the drift of one food, `research/front/p1f.sh`; the case `all` is the coordinator's `capdrift-f9` of the same day):

| Form of the limit (`frontPay` of `research/front/sim.ts`)       | Blank : slime | First food | Food ring at step 10,000                         |
| --------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------------ |
| None (`all`, the port)                                          | 28 : 12       | 2,978      | 18,439 agents, a mesh of veins over the dish     |
| What the flux of the front earned (`take`, the first candidate) | 40 : 0        | 3,342      | a colony on one side, far from the ring of foods |
| At most the sum of the rates of the front (`rates`)             | 40 : 0        | 4,324      | a small disc, far from the ring                  |
| Each agent with the chance 1 − e^(−r) at most (`step`)          | 40 : 0        | 3,933      | a small disc, far from the ring                  |
| At most the sum of the weights of the sinks (`weights`)         | 28 : 12       | 2,987      | not run: the limit never binds in the Y-maze     |
| k · P < B, P the sum of the rates with a key (`shareR`: P = R)  | 40 : 0        | 4,283      | 2,669 agents, a small network                    |
| k · P < B, P the sum of the rates of the agents with a key      | 40 : 0        | 3,057      | 10,847 agents, a mesh of veins with holes        |

The candidate of the coordinator, a sink paid at most what its own flux earns, keeps the Y-maze as it was on `main`
(3,342 steps against 3,292), but the plasm of the dead then pays no birth at the front, and the colony in Food ring
grows only by the credit of the food: the look of option 1 goes. Each limit with an absolute scale (`rates`, `step`,
`shareR`) starves the front of Food ring: a sink at a moving front is young, and its rate, a mean over 100 steps,
is small. The weights of the sinks sum to more than the agents of the front, so they limit nothing. The last form has
no scale of its own: it compares each rate with the rates of the other agents of the front. Where all of them have
like rates, as at the rim of Food ring, a full budget pays most of them; where some sit on slime, with 40 times less
rate, it pays those seldom. Food ring with it (seed 1, nine foods), against `capdrift-f9`: 2,926 and 3,328 agents at
step 5,000, 10,847 and 18,439 at 10,000, 5,062 and 3,393 at 20,000; a rise of +78 % and +119 % at the second food;
a sheet of 0.58 and 0.61 at step 10,000 and 0.24 and 0.16 at 20,000; the dish full at step 15,500 and 12,500. The
picture keeps the look: a mesh of veins with holes at 10,000, a polygonal network between the foods at 20,000.
`research/front/out/p1f/` of the worktree has the records, the main checkout the copies in
`research/front/out/owner/port2/`.

## Part B: the drift of one food

The coordinator ran the prototype with the rules of the port and `driftPerFood=1` on 2026-11-26 (Food ring, nine
foods, seed 1; `research/front/out/p1e/capdrift-f9*` and `p1e-drift.png` of the main checkout): no sheet and no band at
the wall at step 10,000, a mesh of veins with holes over the dish, and a polygonal network between the foods at 15,000
to 20,000; 18,439 agents at step 10,000 and 3,393 at 20,000, a rise of +119 %, a sheet of 0.61 and 0.16. ADR 0097,
finding 7, found that this drift keeps the zone behind the front narrow: with `feed=flux` the front takes the flux of
each covered food, and the pressure that the drift reads grows with them. The engine divides the drift of each strain
by the covered ports of its state of the step before (lane w of its first vec4), at least one: in `driftOf()` of
`agents.wgsl` and `agents.frag`, and `driftOfFoods()` of `flow-reference.ts`. The pass of the agents reads the state
already, so no memory is added.

## The agent's choices

- **Each pass settles in the next one**, as the prototype says a GPU must: the agent pass counts its deaths and its
  respawns, growth spends the budget plus those deaths and less those respawns, and the pass of the state settles the
  deaths and births of growth before the credit. The counts are 10 whole numbers per strain (`PAID_COUNTS` in
  `src/engine/paid.ts`, the last two the parts of the sum P of decision 4): atomics on WebGPU, marks of the agents and
  points with additive blending on WebGL2.
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
- **The sum P in steps of 2^-12, in two counts** (decision 4): WebGL2 adds the counts as floats, which stay exact only
  below 2^24. Each agent adds its steps / 64 and the rest, so each count stays exact for fewer than 2^18 agents with a
  key in a strain, and the sum of the steps fits a u32 for fewer than 2^20. The rank compares k · P with B, a product
  that WGSL and GLSL round once, where B / P would be a division of 2.5 units in the last place. WebGL2 adds the parts
  of P with a pass of points (`paid.vert` with SHARE) between the test and the rank, as it adds the other counts.
- **The drift of one food in `driftOf()`** (decision 5): the pass of the agents reads the covered ports from the state
  that it binds already; the division by a whole number may err by 2.5 units in the last place in WGSL. The
  CPU copy (`driftOfFoods()`) divides in float32.

## Measures

The measures of the port with decisions 4 and 5. The first port (before parts A and B, the same day) is named so;
its records are in `research/front/out/owner/port/` of the main checkout, those of this one in
`research/front/out/owner/port2/`.

**The look.** Food ring with the levers of the crown (`{territory:true, flowEdges:8, flowBase:0.002, frontFlux:2,
flowStrength:8}`), WebGPU, seed 7: at step 5,000 a ring of plasm with veins from the middle food to it; at 10,000 a
ring-shaped mesh of veins with holes that reaches the wall, and no band along the wall (the first port: a thick band
along the wall); at 15,000 a network of tubes with the last parts of the mesh; at 20,000 a polygonal network that joins
the nine foods. Against the prototype with the drift of one food (`p1e-drift.png`) the middle of the mesh at 10,000 is
emptier: a few veins from the middle food, where the prototype has a mesh over the whole dish.

**Food ring**, the same levers, seeds 1 to 3 on each backend, to step 20,000 (`bash research/front/p100.sh ring`,
`research/front/p100-ring.gpu.test.ts`; the table `bash research/front/p100.sh table`):

| Run        | Agents at 10,000 | Agents at 20,000 | Budget at 20,000 | Sheet at 10,000; 20,000 | Rise at the second food |
| ---------- | ---------------- | ---------------- | ---------------- | ----------------------- | ----------------------- |
| WebGPU s1  | 13,825           | 5,171            | 11,262           | 0.47; 0.23              | +83 %                   |
| WebGPU s2  | 12,943           | 4,379            | 11,808           | 0.54; 0.23              | +57 %                   |
| WebGPU s3  | 12,552           | 3,596            | 13,067           | 0.48; 0.18              | +67 %                   |
| WebGL2 s1  | 14,143           | 3,229            | 13,643           | 0.50; 0.18              | +69 %                   |
| WebGL2 s2  | 14,527           | 4,545            | 13,051           | 0.49; 0.21              | +86 %                   |
| WebGL2 s3  | 13,184           | 2,842            | 13,846           | 0.54; 0.15              | +81 %                   |
| First port | 21,615–23,087    | 2,533–2,793      | 19,260–21,002    | 0.52–0.60; 0.16–0.17    | +67 to +110 %           |
| Prototype  | 10,847           | 5,062            | 13,733           | 0.58; 0.24              | +78 %                   |

The prototype is `frontPay=share` with the drift of one food, nine foods, seed 1 (`p1f.sh`). The colony peaks at
16,125 to 17,417 agents at step 12,800 to 14,300, when it fills the dish, and then falls. At step 8,000 it holds 8,845
to 9,008 agents on WebGPU and 9,702 to 10,338 on WebGL2; at 10,000 the three runs of WebGL2 lie 2 to 12 % above those
of WebGPU. Three seeds per backend do not tell whether this is a gap of the backends.

**The help texts** (WebGPU, seed 1): with Flow strength 2 and the other levers Food ring holds 1,806 agents at step
10,000 (13,825 with 8); with the rules and the levers of the scene it holds 1,214 at step 8,000, and 8,845 to 9,008
with the levers of the crown (3 seeds).

**The Y-maze**, seeds 1 to 10 (`bash research/front/p100.sh y`, the runner of ADR 0088; slime on both arms and no
slime on WebGPU only):

| Y-maze                           | Choice         | First food (median, range) | The other food after it (median) |
| -------------------------------- | -------------- | -------------------------- | -------------------------------- |
| Slime on one arm, WebGPU         | 10 : 0         | 3,103.5 (2,873 to 3,307)   | +1,588.5 steps                   |
| Slime on one arm, WebGL2         | 10 : 0         | 3,051.5 (2,870 to 3,229)   | +1,728 steps                     |
| Slime on both arms, WebGPU       | 6 : 4 (p 0.75) | 3,097.5 (2,758 to 3,263)   | +80 steps                        |
| No slime, WebGPU                 | 5 : 5 (p 1.0)  | 3,068.5 (2,758 to 3,235)   | +109.5 steps                     |
| Slime on one arm, first port     | 5 : 5 each     | 2,912.5 and 2,953          | +297 and +192 steps              |
| Slime on one arm, `main`, WebGL2 | 10 : 0         | 3,207.5 (3,097 to 3,722)   | +1,912.5 steps                   |

So the choice is back, and the controls show no preference. Slime on both arms against none: 1.01 times as late (p
0.24). The colony reaches the first food 3 to 5 % sooner than on `main`.

**The Crown of veins**, WebGPU seeds 1 to 3, to step 16,000 (`bash research/front/p100.sh crown`), live agents /
reach of the tube body in cells, against ADR 0087 (seeds 1 and 2):

| Step   | ADR 0087 s1; s2          | ADR 0100 s1; s2; s3                      |
| ------ | ------------------------ | ---------------------------------------- |
| 2,000  | 506 / 46; 505 / 48       | 495 / 45; 619 / 50; 583 / 51             |
| 4,000  | 1,572 / 79; 1,567 / 80   | 1,801 / 86; 2,011 / 92; 1,888 / 91       |
| 8,000  | 3,950 / 129; 4,015 / 130 | 4,653 / 162; 4,995 / 168; 4,927 / 164    |
| 12,000 | 5,763 / 169; 5,960 / 171 | 7,825 / 231; 8,145 / 241; 7,940 / 242    |
| 16,000 | 7,207 / 209; 7,223 / 210 | 10,913 / 310; 11,309 / 314; 11,071 / 314 |

The first port had 11,185 to 11,447 agents and a reach of 330 to 336 at step 16,000. The crown grows about 1.5 times as
fast as in ADR 0087: the deaths behind the front pay births at the front. The look (seed 1, steps 8,000 and 16,000): a
fan of veins from the neck to a band of plasm along the rim at 8,000; at 16,000 the band, two main veins from the neck
that fork toward it, and empty ground between them, where ADR 0087 showed a half disc of sheet with veins in it. The
look is that of the first port.

**The bytes of the scenes** (`research/flow/README.md`, part 36): after 500 steps on both backends, 58 of 68 runs keep
the bytes of `main`; the 10 others are the five scenes with the rules (the three Y-mazes, Slime everywhere, the Crown
of veins) on each backend.

**The wrong rules**: PB16 to PB23 are new (the drift of one food, the sum P and the threshold, on each backend and in
the CPU copy), and the texts of TY120, TY123, TY159, TY232 to TY235, TY237, TY246 to TY248 and TY250 follow the code.
Each of PB16 to PB23, TY120, TY123, TY159, TY235 and TY248 fails at least one test. PB16 and PB17 needed a trail in
the case of the drift: without one every sensor reads 0 less the drift times the pressure, and the size of the drift
changes no turn.

## Consequences

- `docs/model.md` 7.1, 7.2, 7.3, 7.7, 8.7, 9 and 9.1 hold the rules; the help of Rules of the growth front, Flow
  strength, Flux to the front and Drift name the new numbers.
- Wrong rules: the first port changed the texts of 33 wrong rules, removed TY170 (its rule is gone) and added PB1 to
  PB15; FP15 of the prototype had a stale text, which follows `sim.ts` again. Parts A and B added PB16 to PB23.
- The Y-maze with slime takes the blank arm again (10 : 0 on each backend), and the controls show no preference. The
  e2e test of the Y-maze (`tests/e2e/y-maze.spec.ts`) passes with its margin of 1.2 again.
- Open (decision 3): the boom at a new food (+57 to +86 % in the engine, +78 % in the prototype), the fall of a full
  dish with the budget that holds the rest of the area and that no picture shows, and the sheet of 0.47 to 0.54 at
  step 10,000 with nine foods. The middle of the mesh at step 10,000 is emptier than in the prototype.
- Open: the Crown of veins grows 1.5 times as fast as in ADR 0087 and leaves the ground behind its rim empty, as with
  the first port. The coordinator decides whether that look stays.
- Not measured: more than 3 seeds of Food ring (whether WebGL2 holds 2 to 12 % more agents at step 10,000 than
  WebGPU), Food ring with one food in the engine, the Y-maze with 40 seeds in the engine, slime on both arms and no
  slime on WebGL2, Slime everywhere with the rules, the other scenes of the app with the rules switched on, a stored
  budget spent at a food that comes after the dish is full, and the prototype's `share` with one food and with more
  seeds than seed 1 in Food ring.
