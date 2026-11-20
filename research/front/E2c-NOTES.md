# Part E2c of the engine of stage 4: notes of the diagnosis (2026-11-20)

The brief of the coordinator: the start scene `three-networks` with the rules of stage 4 grew more agents on WebGPU
than on WebGL2 (medians 2,119 and 1,155 at step 1,503, seeds 1 to 6), and the pressure showed spikes. These notes
hold what the diagnosis found, so that a fresh agent can go on from them. The files `research/front/e2c-*` are its
scripts; each writes `research/front/out/<name>.txt` (git ignores it). Run a GPU file with
`npx vitest run --config research/vitest.config.ts research/front/<file>`, a CPU file with
`node --import ./research/flow/register.mjs research/front/<file> key=value ...`.

## 1. The gap is no difference of the backends

- Seeds 1 to 6 give the numbers of the coordinator bit for bit (`e2c-backends.gpu.test.ts`). Seeds 7 to 18 turn the
  gap around: WebGPU median 1,252, WebGL2 1,546 agents at step 1,503, WebGPU higher in 55 of 156 pairs. Over the 18
  seeds the medians are about 1,407 and 1,351; one strain ends with 51 to 1,593 agents.
- Both backends compute the flow of the scene as the CPU copy (`e2c-pressure-cpu.gpu.test.ts`, seeds 1 and 2, steps 4
  to 28, three strains, twelve sites, the rules on, the drift 1.5 and 0): the update within 1.5 · 10⁻⁷ of each value,
  the 16 pressure iterations within 6 · 10⁻⁶ of the largest pressure, and the sinks and sources of each strain sum to
  0 within 5 · 10⁻⁷. The inputs are those of the GPU: the memory and the two pressures before the step (the second
  one from inside the sims), the memory, the rates and the state after it.
- The start of each strain is the same on both (`e2c-start.gpu.test.ts`): a territory of 236 cells at the same
  centres, 50, 50 and 53 agents.
- The level of the network of strain B against the ground at drift 0 (`e2c-aggregate.gpu.test.ts`, 31 seeds, step
  30): below the far ground in 24 runs on WebGPU and in 26 on WebGL2. Seeds 1 to 6 were above it in 4 runs on WebGPU
  and in none on WebGL2: a chance split, and the level decides the growth (part 3).

## 2. The spikes are islands of tube cells that hold sinks

- `e2c-islands.gpu.test.ts`: each of the 4 spikes of the first 30 steps (−36,500 to −138,700) lies in a patch of 2 to
  4 tube cells (g > 0, 4 neighbours) without a food cell, which holds 25 to 100 % of the sink rates of its strain in
  the first steps of the flux. Only the ghost edges join it to the rest: its sinks pull its pressure down by
  q / ΣĜ per iteration, and the momentum adds up the steps. In the next step the patch joins the network, which
  keeps the low pressure (the momentum gives every mode the same slow decay, 0.9955 per iteration).
- `e2c-island-map.gpu.test.ts`: the patch is part of a tail of tube body below the food whose cells lie at
  B = 0.04 to 0.05: the threshold 0.05 cuts it into pieces.
- The prototype has them too, with the start of the engine: 7 of 40 seeds of its dish (`e2c-proto.ts layout=dish
seeds=1-40 steps=60 scent=0`), −24,000 to −444,000 within 60 steps. With its own start none (0 of 40).
- `sinkTube=1` (sim.ts, ADR 0072): a sink must lie on a tube that reaches the edge of the square of 13 × 13 cells
  around it, or a port, over at most 12 steps between 4-neighbours. With the start of the engine the worst pressure
  of the 40 seeds is then −4,206; with the start of the prototype the 6 runs of its dish to step 1,500 stay the same,
  bit for bit.

## 3. The drift reads the level of a network against its ground

- Kirchhoff's law fixes the pressure of a network up to a constant against the ground beside it: only the ghost
  conductance (10⁻⁵) joins them, and the ground relaxes slowly. The drift reads the pressure at the cell of a sensor,
  on the network and on the ground alike. So the level of a network against its ground, which the history of the
  iteration sets, decides whether the sensors of the front see the ground below them (the front grows) or above them
  (it holds back).
- On the prototype (`e2c-proto.ts layout=dish seeds=1-6 steps=1500 shift=100:200`, the shift moves the pressure and
  the momentum of every tube cell, which changes no difference of the network): agents at step 1,500 without a
  shift 381 to 519, with +200 1,188 to 1,311, with −200 202 to 308.
- `driftOn=net` (sim.ts): a sensor reads the pressure of its cell less that of the agent's cell, and only where both
  hold a tube. A shift then changes nothing (none 84 to 300, +200 66 to 247, −200 70 to 211), but the colony grows a
  quarter as much: it loses the crown of ADR 0065.
- In the Y-maze the colony covers no food at first, and its tube cells pay what the sinks take (`colony=1`): its
  network floats −850 to +460 from the ground at step 100 (`e2c-proto.ts layout=ymaze seeds=1-6 steps=600`), with no
  patch that holds sinks. Its choice with slime on one arm stays 40 : 0: the weight of a sink on slime decides it.
- The reference cell of the recentring does not matter: it shifts every cell by one value, the network and the
  ground alike.

## 4. The engine starts the colony without a food scent; the prototype with its steady state

- The prototype runs the food scent 300 steps before the colony starts (sim.ts, `Params.scentSteps`); the app starts
  every scene with no scent. With the start of the app the prototype grows as the engine: 79 to 90 agents at step 25
  (the engine in the same dish 73 to 88), the first flux at step 7 to 10 (the engine 8 to 9), its far ground 100 to 700
  from its network, and 229 to 1,596 agents at step 1,501 (the engine in the same dish, `VITE_SCENE=dish160`, 73 to
  1,182; the prototype with its own start 381 to 519).
- So the engine computes as the prototype. The measured results of ADR 0065 and 0067 come from the start with a
  steady scent, which keeps the level of the network near its ground and makes no islands.

## 5. The fix and what it gave (ADR 0072)

- The engine: the test of the tube of a sink in both backends and the CPU copy (`tubeOut()` in `sinks.wgsl`,
  `sinks.frag` and `sinks-reference.ts`; the pass of the sinks binds the ports of the step). `sinks.gpu.test.ts` has a
  case for each arena; the wrong rules are TY214 to TY230.
- The spikes go: the least pressure of the first 30 steps is −315 to −3,801 in all 36 runs of a strain
  (`VITE_OUT=e2c-islands-after`). Seeds 1 to 18 at step 1,503: WebGPU median 1,486, WebGL2 1,531, WebGPU higher in 158
  of 324 pairs; 28 of the 36 runs keep their agents at every 500 steps, the 8 others had a patch.
- The prototype with `sinkTube=1` (`start.sh e2c-start`, the rule set of step 9 at the drift 1.5): with its start 1 of
  10 dish runs changes and no choice of the Y-maze; with the start of the app the targets hold (slime on one arm
  40 : 0, half of the dish after 5,500 steps), and the 7 spikes of the 40 seeds go.

## Next

- Open for the owner: the start of a colony with the rules (a steady scent as the prototype, or the start of the app
  and the records of `start.sh`), and a form of the drift that does not read the level of a network against its
  ground. `driftOn=net` is one: it does not read the level, but it loses the crown.
