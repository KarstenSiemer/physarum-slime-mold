# 0072: A sink lies on a tube that carries flux to it

- Status: accepted. The coordinator set the task on 2026-11-20: part E2c of the engine of stage 4. The start scene with
  the rules of stage 4 grew more agents on WebGPU than on WebGL2, and the pressure had spikes; find the causes, fix
  them in both backends behind the setting `territory`, which no scene turns on yet, and make the engine behave as
  the measured prototype. The choices below are an agent's, under the owner's delegation of 2026-11-12. Two findings
  need the owner: the start of a colony with the rules, and a form of the drift that does not read the level of a
  network against its ground (Open points).
- Date: 2026-11-20
- Extends [ADR 0069](0069-the-sinks-of-each-strain-in-the-engine.md) (the sink test) and
  [ADR 0065](0065-the-growth-front-takes-the-flow-a-prototype.md) (the rule set, decision 1).
- In short: [`docs/model.md`](../model.md), section 6.11, has the rule;
  [`research/front/E2c-NOTES.md`](../../research/front/E2c-NOTES.md) has the diagnosis and its commands;
  [`research/flow/README.md`](../../research/flow/README.md), part 31, has the checks.

## Context

The coordinator measured the start scene `three-networks` with the rules (capacity 0.25, seeds 1 to 6, M3 Pro): at
step 1,503 a median of 2,119 agents on WebGPU and 1,155 on WebGL2, WebGPU higher in 35 of 36 pairs. In the first 30
steps the least pressure of a strain fell to −38,000 to −139,000 in 4 of 36 runs of a strain. The network of strain B
of seed 1 lay at −16,300 against its ground on WebGL2, and at +90 on WebGPU.

## Findings

1. **The gap is no difference of the backends.** Seeds 1 to 6 give the numbers of the coordinator bit for bit. Seeds 7
   to 18 turn the gap around: WebGPU median 1,203, WebGL2 1,477, WebGPU higher in 47 of 144 pairs. Over the 18 seeds
   the medians are 1,408 and 1,352 (WebGPU higher in 170 of 324 pairs), and a run ends with 578 to 3,498 agents. Both
   backends compute the flow of the scene as the CPU copy, with three strains, twelve sites and the rules on: in the
   steps 4 to 28 of seeds 1 and 2 the update within 1.5 · 10⁻⁷ of each value and the 16 iterations of the pressure
   within 6 · 10⁻⁶ of its largest value, from the inputs of each GPU; the sinks and sources of each strain sum to 0
   within 5 · 10⁻⁷. The start of each strain is the same on both. The level of the network of strain B against its
   ground at drift 0 lies below the ground in 24 of 31 seeds on WebGPU and in 26 of 31 on WebGL2; seeds 1 to 6 split
   by chance, and the level decides the growth (finding 3).
2. **The spikes are patches of tube that hold sinks and no port.** Each of the 4 spikes lies on a patch of 2 to 4
   tube cells (4-neighbours, a conductivity above 0) without a food cell, which holds 25 to 100 % of the sink rates of
   its strain in the first steps of the flux. Only the ghost conductance joins it to the rest: its sinks pull its
   pressure down by their flux over the sum of its edges in each iteration, and the momentum adds the iterations up.
   The patch is a piece of a tail of tube body below the food whose cells lie at a body of 0.04 to 0.05: the threshold
   0.05 cuts it into pieces. In the next step the patch joins the network, and the network keeps the low pressure:
   the momentum gives every mode the same slow decay, 0.9955 per iteration.
3. **The drift reads the level of a network against the ground beside it.** Kirchhoff's law fixes the pressure of a
   network up to a constant against the ground: only the ghost conductance of 10⁻⁵ joins them, and the ground relaxes
   slowly. A sensor reads the pressure at its cell on the network and on the ground alike. So that level, which the
   history of the iteration sets, decides whether the sensors of the front see the ground below the network (the
   front grows) or above it (it holds back). On the prototype in its dish, a shift of the pressure of every tube cell
   at step 100, with the momentum, which changes no difference within the network: 381 to 519 agents at step 1,500
   without it, 1,188 to 1,311 with +200, 202 to 308 with −200 (6 seeds each). The cell that the pressure recentres by
   does not matter: it shifts every cell, the network and the ground alike.
4. **The engine starts a colony without a food scent; the prototype after 300 steps of it.** With the start of the app
   the prototype grows as the engine: 79 to 90 agents at step 25 in its dish (the engine in the same dish 73 to 88),
   its first flux at step 7 to 10 (the engine 8 to 9), its far ground 100 to 700 from its network, and 229 to 1,596
   agents at step 1,501 (the engine 73 to 1,182; the prototype with its own start 381 to 519). And it makes the
   patches: 7 of 40 seeds of its dish fall to −24,000 to −444,000 within 60 steps; with its own start none does.

## Options

1. **The components of the network**: a sink only on the component of a port, found by a label per cell. Exact, but a
   label needs as many passes as the network is long, in each step, and a buffer per strain.
2. **A pressure limit of the sinks**, as the sites have one (ADR 0029, decision 6): it bounds a spike at 4096 · I0,
   32,768 at the flow strength 8, which still holds the front for thousands of steps, and the sinks then take less
   than the sources give.
3. **The tube of a sink in the square of its paths**: the passes of the sinks hold the 13 × 13 cells around a sink in
   rows of bits already (ADR 0067, decision 10). A tube that leaves that square, or holds a port, carries flux to the
   sink; a patch inside it without a port does not. Exact on every GPU, no buffer, a few rounds for each cell that
   passed the other tests. A patch larger than the square passes, and pulls its level slowly: its sum of edges is
   large.

## Decision

1. **A sink lies on a tube that carries flux to it** (option 3). The tube cells of its strain that a path between
   4-neighbours over tube cells of the strain reaches from the cell, inside the square of 13 × 13 cells around it,
   must include a cell on the edge of the square or a port of the strain of the step. A step crosses the seam of the
   periodic grid; a port lies in the square when its nearest copy does. The test comes after the edge test and before
   the test of fresh ground; the other tests stay as they are (ADR 0069). 4-neighbours, as the edges of the flow; each
   round of the passes reaches one step further, and the rounds end when a round reaches no cell more.
2. **The prototype holds the rule as `sinkTube`**, off by default, and the options of the diagnosis: `driftOn` ('all',
   the rule of ADR 0065; 'net'), `refOn` ('roles', the rule of ADR 0029; 'ports') and `Params.scentSteps` (300, its
   start; 0, the start of the app). The records of ADR 0065 and 0067 keep their rule set. `research/front/start.sh`
   runs the Y-maze and the dish for both starts with and without the rule.
3. **No change of the start and of the drift**: both change what the prototype measured, and the owner chooses them
   (Open points). The engine keeps the start of the app.

## Results

- **The rule on the prototype** (`start.sh`, the rule set of step 9 at the drift 1.5): with its start it changes 1 of
  10 runs of the dish (half of the dish after 5,340 steps in place of 5,111) and no choice of the Y-maze (slime on one
  arm 40 : 0 with and without; no slime 21 : 19 and 19 : 21). With the start of the app the 7 spikes of the 40 seeds
  go: the worst least pressure is −4,206, on a patch that leaves its square and holds 6 % of the sink rates. The dish
  and the Y-maze then keep every target: slime on one arm 40 : 0 (first food after 3,320 steps), no slime 26 : 14
  (p 0.081), half of the dish after 5,500 steps (5,139 with the start of the prototype).
- **The engine after the fix** (M3 Pro). The spikes go: in the first 30 steps of seeds 1 to 6 the least pressure of a
  strain lies at −315 to −3,801 on both backends, and no sink lies on a patch without a food cell; the other 32 runs of
  a strain keep their least pressure. A run without such a patch runs as before: 28 of the 36 runs to step 1,503 give
  the same agents at every 500 steps. At step 1,503 of seeds 1 to 18: WebGPU median 1,486 agents (657 to 2,925),
  WebGL2 1,531 (796 to 3,498), WebGPU higher in 158 of 324 pairs (Mann-Whitney p 0.90). Per strain the medians are 395
  and 456 (A), 466 and 326 (B), 471 and 464 (C). Seeds 1 to 6 alone still split (32 of 36 pairs, p 0.025), and seeds
  7 to 18 the other way (48 of 144). Strain B of seed 1 on WebGL2 ends with 1,513 agents in place of 72. One strain
  in the dish of the prototype ends step 1,501 with 161 to 1,182 agents on both backends (median 461); the prototype
  with the start of the app 229 to 1,596 (median 552, p 0.78), with its own start 381 to 519 (median 482, p 0.93).
- **Both backends follow the CPU copy** (`sinks.gpu.test.ts`, 22 tests, both backends): six new cases, in each arena,
  with tube on half of the cells, where the rule takes 20 sinks or more away, a patch around a port keeps its sinks,
  and on the periodic grid sinks find their port across the seam.
- **The wrong rules** TY214 to TY230 of `research/flow/engine/mutate.ts` each fail at least one test.
- **No scene changes**: the digests of every scene after 500 steps on both backends, with the state of the flow,
  equal those of the record of ADR 0071 in 62 of 62 runs (`research/flow/README.md`, part 31).
- **Where**: the whole GPU suite (1,422 tests) on an M3 Pro, both backends.

## Consequences

- The sinks of a strain lie on tubes that its sources reach within 13 × 13 cells, so the flux of the front runs
  through tubes. A patch that leaves the square and joins the network only farther away still takes its share: it is
  large, and its level moves slowly.
- The engine computes the rules as the prototype does, under the same start. The growth of the first thousands of
  steps stays a lottery of the level of each network against its ground (finding 3): a strain of the start scene ends
  step 1,503 with 51 to 1,593 agents, and the prototype's dish holds 114 to 863 agents at step 1,000 with the start of
  the app. Part E4 compares the scenes over enough seeds for that spread.

## Open points

- **The start of a colony with the rules** (for the owner). The records of ADR 0065 and 0067 come from a start with the
  food scent at its steady state; the app starts every scene without a scent. With the start of the app the prototype
  keeps the targets (above), but its dish covers half of the open cells 1.07 times later, its spread widens (3,612 to
  6,448 steps for 3,856 to 5,685), and the Y-maze without slime chooses the left arm, which holds site 0, 28 : 12
  (p 0.017; 26 : 14 with the rule). Either the engine starts a colony with the rules on a steady scent, as the
  prototype measured, or the records stay those of the start of the app (`start.sh`).
- **A form of the drift that does not read the level of a network against its ground** (for the owner; ADR 0070,
  open points). `driftOn=net` reads the pressure of the cell of a sensor less that of the cell of the agent, only where
  both hold a tube: a shift then changes nothing (84 to 300 agents without it, 66 to 247 with +200, 70 to 211 with
  −200), but the colony grows a quarter as much and loses the crown. No form tried keeps the crown without the level.
- Not measured: the time of the pass of the sinks with the test of the tube; the start scene and the Y-maze in the
  engine past step 1,503.
