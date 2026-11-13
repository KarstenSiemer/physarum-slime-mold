# 0030: Every strain has a flow of its own

- Status: accepted. The owner found the fault on 2026-11-13. Every decision here is the
  coordinator's choice under the owner's delegation of 2026-11-12, with its date and reason.
- Date: 2026-11-13
- In short: with the flow in the tubes (ADR 0029), every strain is a slime mold of its own. Its
  flux runs only through its own tubes, between the foods that it covers, and it gives life only to
  its own agents. A scene with one strain keeps its bytes.

## Context

### The fault

The owner, on 2026-11-13: in the scene Foraging maze he switched Flow in the tubes on and added a
second strain. The new strain had no agent. When the first strain reached the far food, agents of
the new strain appeared, without the Inoculate tool.

The cause is decision 8 of ADR 0029. A dead agent draws a random cell. If the cell holds a tube
with a flow memory above 0.5, the agent comes to life there. The rule did not look at the strain of
the agent. In the start layout "At the first food" every agent starts dead, and the engine places
only agents of strain A (ADR 0025). So the second strain held half of the agents of the scene, all
dead, and they came to life on the tubes of strain A as soon as a flux ran.

A GPU test shows it: two strains, a tube between two foods in the trail of one strain, and 200
dead agents of each strain. After 1,500 steps, 197 of the 200 agents of the strain without a tube
lived, on WebGPU and on WebGL2.

### One network for all strains

The fault had a second part. Decision 4 of ADR 0029 built the tube body from the trail of all
strains. The scenes with the flow have one strain, and the record gave no reason for the sum. With
several strains it made one network of all of them:

- A flux ran from a food that one strain covers to a food that another strain covers, through the
  tubes of both, where the tubes touch.
- A dead end of one strain that touches a fed tube of another strain stayed fed.
- The levels of the trail (no tube below 0.2 deposits, a full tube from 1 deposit on) were in
  deposits of strain A for every strain.

### What a strain is

In this app a strain is a population with a trail of its own, settings of its own and a row of the
attraction matrix (ADR 0006). The scenes with several strains hold rivals: each strain follows its
own trail and flees the others (Three strains, Two strains, the scenes of Fogleman). Growth keeps
the strains apart too: a child has the strain of its parent (ADR 0025).

The organism: two plasmodia do not always fuse when they meet. In _Physarum polycephalum_ they fuse
only when they are alike at several loci. These lines are from the summaries of a web search; the
papers were not read (`docs/knowledge-base/flow-in-the-tubes.md`, "Two plasmodia", has the sources
and says what was read). The inference of this project: two plasmodia that do not fuse are two
bodies, the shuttle flow runs inside one body, and so no flux passes from one into the other.

## Options

1. **Only the births look at the strain.** A dead agent comes to life only on a cell with trail of
   its own strain. One line in each backend. The flux still runs through all strains as one
   network.
2. **One strain owns each cell**, the strain with the most trail there, and no flux passes between
   cells of two owners. It needs no more memory and no more time. It is wrong where strains share
   cells: in a scene whose agents share cells, or whose strains follow each other, the network of a
   strain is cut wherever the owner changes.
3. **Every strain has a flow of its own.** The passes of ADR 0029 run once per strain, on the trail
   of that strain, with a memory and a pressure of their own. It is right in every case. It costs
   time and memory for each strain.

## Decision

Option 3 (2026-11-13). Reasons: in every other rule of the app a strain is an organism of its own.
And option 3 is the rule of ADR 0029 without a change, once per strain, so every result of ADR 0029
holds for each strain. Option 1 leaves a flux between rivals. Option 2 saves the cost, and it is
wrong for strains that share cells.

1. **The flow of strain s is the rule of ADR 0029 on the trail of strain s.** With T_s,c the trail
   of strain s on cell c and d_s the deposit of strain s:

   ```text
   presence_s,c = clamp((T_s,c − 0.2 · d_s) / (d_s − 0.2 · d_s), 0, 1)
   B_s,c ← B_s,c + 0.02 · (presence_s,c − B_s,c)        the tube body of strain s
   g_s,c, D_s,c, p_s,c,k                                 as g_c, D_c and p_c,k in ADR 0029, for strain s
   ```

   Strain s covers a food site while the cell of the site holds food and a tube of the strain
   (B_s ≥ 0.05). Its roles are drawn among the sites that it covers, by the rule of ADR 0029,
   decision 5, with the same hash for every strain. A strain that covers fewer than two sites has
   no flux, and no cell of it adapts.

2. **An agent follows the flow of its own strain.** An agent of strain s starves by D_s of its
   cell. A dead agent of strain s comes to life only on a cell with a tube of strain s, by D_s.
   With growth and shrinkage it divides only where D_s ≥ 0.01. The chances are those of ADR 0029,
   decisions 8 and 9.

3. **The strains share what is not part of an organism**: the food sites, the flow strength I0 and
   every constant. Each strain gives and takes I0 at each site that it covers. Two strains can
   cover the same site: the trail spreads to the cells beside it.

4. **No fusion.** No flux passes between two strains, whatever their weights in the attraction
   matrix are. Reason: the app has no rule that makes one organism of two strains. A fusion would
   be a rule of its own, with its own switch.

5. **A scene with one strain keeps its bytes.** The trail of the strains that a scene does not
   have is 0, so the trail of strain A alone is the sum of before, bit for bit. The check is below.

6. **In the code, the state of the flow has a part for each strain.** On WebGPU the textures of
   the memory and of the pressure have a layer for each strain (`FlowState` in
   `src/engine/sim.ts`). The passes of the flow take the layers of one strain, and the agent
   passes and growth take all layers and read the layer of the agent's strain
   (`texture_2d_array` in `agents.wgsl` and `growth.wgsl`). On WebGL2 each strain has its own
   targets, and the agent passes have four samplers (`flowMemoryOf()` in `tools.glsl` and
   `growth.frag`). Each strain has its uniform block, which names the strain (`packFlow()` in
   `src/engine/flow.ts`): the passes read that lane of the trail. Settings with another number of
   strains get a new state.

7. **The memory fit counts 80 B per cell for each strain** (`flowBytesPerCell()` in
   `src/engine/sizing.ts`).

## Results

### The tests

`src/engine/flow.gpu.test.ts` runs on both backends. New on 2026-11-13:

- A dead agent comes to life only on a tube of its own strain (the test of the fault: 0 of 200
  agents of the strain without a tube live after 1,500 steps, where 197 lived before).
- No flux passes from the tubes of one strain into the tubes of another: a route between two foods
  whose two halves are in the trail of two strains carries no flux, and no site gives or takes.
- Two strains with a route each between the same two foods: each strain sends its whole flux I0
  along its own route, and none along the other.
- An agent starves and comes to life by the flow memory of its own strain: four strains on the
  same cells, each with another flow memory. The strain whose ground starved loses 2 % of its
  agents in a step and has no birth. The other three lose none, and 16, 4 and 10 % of their dead
  agents come to life, as their memory gives it.
- Dead agents of every strain come to life with the rule of one agent per cell, each on a cell of
  its own: of four strains, the two that are fed.
- An agent divides by the flow memory of its own strain: four strains, in two runs with other
  pairs of starved strains.
- The passes follow the CPU copy for the second of two strains, which has another deposit, and for
  the third and the fourth of four strains.
- A change of the number of strains during a run: the simulation keeps stepping, and the flow holds
  a state for each strain of the settings and for no other.
- Dead agents come to life by the flow also in a step in which a tool is held (ADR 0029,
  decision 8). A reader of 2026-11-13 found that no test held this.

The file has 45 tests now, 22 on each backend and one on WebGL2 without float blending.
`src/engine/flow.test.ts` (24 tests) has the uniform block of each strain, and the CPU copy of the
passes with the trail of its strain alone.

A test is worth what it catches (ADR 0029, "The tests against wrong rules"). On 2026-11-13, 17
more wrong rules were put into the code, one at a time. `research/flow/engine/mutate.ts` now has
39 wrong rules. Every one of them fails at least one test; the log is
`research/flow/logs/engine/mutations-0030.txt`.

| Wrong rule                                                                      | In                 | Tests that fail                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tube body of every strain from the trail of the first strain                | WGSL, GLSL         | follows the CPU reference for the second of two strains; brings a dead agent to life only on a tube of its own strain; lets no flux pass from the tubes of one strain into the tubes of another; gives every strain its whole flux |
| The passes of every strain with the uniform block of the first strain           | the two backends   | the same four tests                                                                                                                                                                                                                |
| An agent starves by the flow memory of the first strain                         | WGSL, GLSL         | lets an agent starve and come to life by the flow memory of its own strain                                                                                                                                                         |
| An agent comes to life by the flow memory of the first strain                   | WGSL, GLSL         | brings a dead agent to life only on a tube of its own strain; lets an agent starve and come to life by the flow memory of its own strain                                                                                           |
| An agent divides by the flow memory of the first strain                         | WGSL, GLSL         | lets an agent divide by the flow memory of its own strain                                                                                                                                                                          |
| No birth by the flow in a step in which a tool is held                          | WGSL, GLSL         | brings dead agents to life by the flow also in a step in which a tool is held                                                                                                                                                      |
| The passes of the third and the fourth strain on the layer of the second strain | the WebGPU backend | follows the CPU reference for the third and the fourth of four strains                                                                                                                                                             |
| The agents of the fourth strain with the flow memory of the first strain        | the WebGL2 backend | the test of starvation and births by strain; brings dead agents of every strain to life with the rule; lets an agent divide by the flow memory of its own strain                                                                   |
| The claims of the agents with the flow memory of the first strain alone         | the WebGL2 backend | brings dead agents of every strain to life with the rule                                                                                                                                                                           |
| The agents of the third strain with the flow memory of the second strain        | GLSL               | the test of starvation and births by strain; brings dead agents of every strain to life with the rule                                                                                                                              |
| Growth of the third strain by the flow memory of the second strain              | GLSL               | lets an agent divide by the flow memory of its own strain                                                                                                                                                                          |

### One strain: the bytes of before

With one strain the rule did not change, so the bytes must not change. Nine runs on each backend
ran with the code before the change (`main` at `7d3a5ee`) and with the code after it, 2,500 steps
each with the seed 12345. The SHA-256 digests of the agents, the trail, the scent, the
environment, the flow memory and the pressure are equal in 18 of 18 runs (M3 Pro, Chromium,
Metal).

| Runs                                                           | Settings                                          |
| -------------------------------------------------------------- | ------------------------------------------------- |
| Maze, Tokyo rail network                                       | the scenes as they are                            |
| Foraging maze, Shortest path, Transport network, Fleeing light | the scenes in the extended model with the flow on |
| Maze                                                           | without the rule of one agent per cell            |
| Maze, Tokyo rail network                                       | with a trail saturation of 20                     |

A flux runs in six of the nine runs of each backend: their pressure is not zero at the end. In the
Foraging maze the colony does not reach the second food within 2,500 steps, and the Transport
network and Fleeing light have no food. The Tokyo runs have growth and a flux.

### The owner's case

The Foraging maze with the flow and a second strain like the first one (seed 1, WebGPU;
`research/flow/engine/strains.gpu.test.ts`). The living agents of strain A and of strain B:

| Step  | Before: A | Before: B | After: A | After: B |
| ----- | --------- | --------- | -------- | -------- |
| 3,001 | 15,597    | 0         | 15,597   | 0        |
| 3,501 | 17,914    | 0         | 17,914   | 0        |
| 4,001 | 16,201    | 560       | 16,220   | 0        |
| 4,501 | 13,557    | 7,428     | 12,350   | 0        |
| 5,001 | 13,083    | 10,953    | 11,677   | 0        |
| 8,001 | 4,357     | 3,877     | 7,566    | 0        |

At step 3,501 strain A covers both foods, and two sites give or take: from then on the flux runs.
Before the change strain B then appeared, as the owner saw. After it strain B has no agent in any
sample to step 8,001, on WebGPU and on WebGL2.

### The cost

The time of a step of the Maze (512 × 320 cells) with one to four strains like its first one, in
ms: the median of 21 samples of 50 steps after 3,000 steps, in two series (M3 Pro, Chromium,
Metal; `research/flow/engine/bench.gpu.test.ts`).

| Strains | WebGPU, flow off | WebGPU, flow on | WebGL2, flow off | WebGL2, flow on |
| ------- | ---------------- | --------------- | ---------------- | --------------- |
| 1       | 0.19 and 0.20    | 1.99 and 1.96   | 0.42 and 0.42    | 2.43 and 2.45   |
| 2       | 0.20 and 0.21    | 3.78 and 3.74   | 0.43 and 0.42    | 4.50 and 4.53   |
| 3       | 0.22 and 0.21    | 5.51 and 5.53   | 0.45 and 0.45    | 6.58 and 6.58   |
| 4       | 0.22 and 0.21    | 7.30 and 7.32   | 0.46 and 0.47    | 8.67 and 8.63   |

- Each strain adds the same time: 1.73 to 1.79 ms on WebGPU and 2.01 to 2.09 ms on WebGL2, which
  is 11 and 13 ns per cell and strain.
- One strain is as fast as before. The Maze with the code before the change and after it, two
  runs each in turn: 1.97 and 1.99 ms before, 1.97 and 1.98 ms after on WebGPU; 2.42 and 2.42 ms
  before, 2.43 and 2.47 ms after on WebGL2, where the lowest sample of a run is 2.36 to 2.39 ms
  on both sides.
- The start scene, Three strains, on 1,536 × 960 cells with 4.4 million agents: a step takes 4.2
  ms without the flow and 57 ms with it on WebGPU (15 ms and 76 ms on WebGL2). That is 18 ms for
  each strain, 12 ns per cell. With the code before the change, which had one flow for all
  strains, the step with the flow took 24 ms (35 ms on WebGL2).

## Review before the merge (2026-11-13)

A second reader went through the commit of the code. The reader found no fault in the code of the
engine. Each of the six points of the report was checked and closed:

- **Gaps in the tests.** No test had a third or a fourth strain, and no test brought an agent of a
  strain other than the first to life with the rule of one agent per cell. On WebGL2 the agents of
  each strain read their flow memory through code that is written out for each strain, in three
  places. Three wrong lines there passed every test, and so did a wrong layer for the passes of
  the third and the fourth strain on WebGPU. The tests above now have four strains, and the five
  wrong rules of the last five lines of the table fail them.
- `research/flow/rules.ts`, a copy of the CPU copy of the passes, still read the trail of all
  strains. It reads the trail of its strain now.
- `readFlow()` and `readPressure()` gave the state of a strain that the settings had lost, until
  the next step. They give nothing now, and a test holds it.
- A comment in `sizing.ts` named 16 B as the largest buffer or texture per cell. A texture of the
  flow has 16 B per cell for each strain on WebGPU. A texture has no limit in bytes, so nothing
  changes; the comment says so now.
- `research/flow/engine/dump.gpu.test.ts` writes the state of the first strain. Its head says so
  now.
- The state of the flow took the number of strains from the settings as it was. It takes at most
  four now, as the rest of a simulation does (`flowStrains()` in `flow.ts`). The app never has
  more.

After these changes the 18 runs with one strain give the same digests again.

## Consequences

- The fault is gone: a strain without a living agent stays without one until the user inoculates
  it.
- A strain needs two foods of its own for a flux. A strain that covers fewer than two foods lives
  by Jones' rules alone, as a colony with one food does in ADR 0029, decision 5: its flow memory
  stays, and few of its agents starve.
- In a scene with rivals the foods are part of the contest. A strain whose foods another strain
  takes loses its flux, and its tubes then starve only by the memory that they hold.
- The flow strength is the flux of each strain. Two strains on the same two foods carry I0 each.
- The flow costs its time and its memory once per strain (table above). The frame budget
  (ADR 0028) lowers the steps per second, and the startup check can lower the grid. On a large
  grid this is much: the start scene with the flow runs at 17 steps per second at most on an M3
  Pro (57 ms per step), where it ran at 42 with one flow for all strains (24 ms). A strain
  without a flux costs as much as one with a flux: the CPU does not know which strains cover two
  foods (`TODO.md`).
- Open (the owner's second case of 2026-11-13): the start scene Three strains with one agent per
  cell, growth and shrinkage, the flow and two foods shows no tube that gets thicker. Measured in
  a dish on a grid of 512 × 320 cells (seed 1, 6,000 steps): no cell holds a tube of any strain in
  any sample, before this change and after it, so no food is covered and no flux runs. The trail
  of a strain is at most 0.26 deposits there. A cell holds no tube below 0.2 deposits and a full
  tube from 1 deposit on, and the Maze has up to 2 deposits. These levels were chosen for Jones'
  decay of 0.1. That scene has a decay of 0.6: its trail loses 60 % in every step. Without the
  rule of one agent per cell the same scene has up to 43 deposits, and the flow acts: all three
  strains cover both foods at step 1,000, and of 307,200 agents 4,060 live at step 3,000, 3,930
  of them of one strain. A level that follows the decay of the strain is not built (`TODO.md`).
- Open: a food site is one cell, the centre of a food dot (ADR 0029, decision 5). A strain covers
  a food only when its own tube holds that cell. Where rivals share a food dot, only the strains
  at its centre have it as a site (`TODO.md`).
- A link to a scene with the flow and several strains, made before this change, now runs with a
  flow for each strain. No scene of the app had both.
- The texts: the help of the switch says that each strain has its own flow.
- The time limits of the GPU tests follow ADR 0010: a test uses at most a quarter of its limit on
  GitHub. In the first CI run of the pull request (commit `01aa2ac`, 41 tests) the file
  `flow.gpu.test.ts` took 123.8 s in the WebGPU job and 68.4 s in the other job; with the 27 tests
  of ADR 0029 it took 51.0 to 66.5 s. Its slowest tests are the two that run two strains for 1,500
  steps: 21.3 s and 21.1 s of their limit of 240 s on WebGPU, 8.9 %. The test on WebGL2 without
  float blending took 16.2 s of 240 s. The tests that the review added or changed are not in that
  run. On an M3 Pro each of them takes 0.02 to 0.14 s. The tests of their kind in that run (the
  CPU copy for two strains, starvation and growth by strain) took 0.3 to 1.6 s on GitHub, of
  limits of 120 and 240 s.
- Not built: a fusion of strains (decision 4).

## How to check this record

[`research/flow/README.md`](../../research/flow/README.md), part 8, has one command for each
result of this record: the test of the fault, the owner's case, the bytes of one strain and the
time of a step. Part 7 has the command for the wrong rules. The logs of the runs are in
`research/flow/logs.tar.gz`, in `logs/engine/`: `strains-*.jsonl` and `mutations-0030.txt`.
