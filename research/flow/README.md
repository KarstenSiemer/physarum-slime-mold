# Flow in the tubes: how the decision came about, and how to check it

This folder belongs to [ADR 0029](../../docs/adr/0029-flow-in-the-tubes.md). The first part of
this page tells in plain words how the decision came about. You need nothing else to follow it.
The rest of the page is a reference: one command for each step, for the day when you want to run
a step again.

## The story in one page

**The question.** In Jones' model the agents keep every corridor of a maze that they filled once.
The real slime mold does not: it empties the dead ends and keeps one tube on the short way. Tero
et al. explain this with a flow. A tube that carries much flow gets wider, and a tube without flow
dies. The task was to give the app that flow.

**What the flow needs.** We must know how much flows through every cell. For that, every cell
gets a pressure, and the pressures must fit together: what flows into a cell must flow out again.
That is one large system of equations, with one unknown per cell, and the app must solve it again
in every step, on the GPU.

**Three ways to solve it.**

1. Exact (conjugate gradients). It gives the right answer. But each of its iterations needs sums
   over the whole grid, and its good helper, the preconditioner, works cell after cell. A GPU is
   fast only when all cells can be computed at the same time.
2. Local (Jacobi iterations with a momentum). Each cell looks only at its four neighbours. A GPU
   does one such pass very fast. The price: news travels only one cell per pass.
3. Ma's walkers. Particles walk at random from one food to the other. No equations at all.

**Step 1: are all three correct?** On a small ring with a known answer, all three give the answer
of the paper (part 2 below). So a later difference comes from the size of a network, and not from
an error.

**Step 2: how much work is a real network?** We took the network that the agents build in the
Maze: 47,544 cells, and 754 cells from one food to the other (part 3). The exact solver needs
3,109 iterations in the form that a GPU can run. The local solver needs about 4,400 iterations
from a pressure of zero to come within 5 % of the exact flow. The walkers are still 89 % wrong
after 150,000 steps: they are out. So no solver can start from zero in every step. But the
network changes by only 0.35 % per step.
The idea that follows: do only 16 local passes per step, and keep the pressure of the step
before. Then the solver never has to start from zero.

**Step 3: do the agents see a difference?** This is the test that counts (part 4). The agents
built the Maze network with each solver, ten seeds each. With 16 local passes per step the dead
ends empty about as fast as with the exact solver (below 10 % of the route at step 2,500 against
step 2,250), and the same tube stays. With the walkers the network dies in 10 of 10 seeds. The
decision: Tero's flow, with the local solver and 16 passes per step.

**Step 4: the first version in the app failed.** In the Tokyo scene the pressure grew without end
while the colony grew, up to 10¹⁸. A small scene on the CPU showed the same fault and its causes
(part 5). The largest one: the momentum also ran on cells without a tube. Four rules stop the
growth, and with them the pressure stays small.

**Step 5: what the app does now** (part 6). In the Maze the dead ends hold less than 1 % of the
trail of the route by step 5,000, and one tube stays that is 1.10 times as long as the shortest
way. In the Tokyo scene the network is
as long as the network of the real slime mold (1.77 against 1.75 times the shortest tree that
joins all cities). With the flow switched off, every scene gives the same bytes as before.

**What it costs, and what is not exact.** The flow costs about 1.5 ms per step in the Maze and
about 2.3 ms in the Tokyo scene. The local solver is 3 to 7 % off the exact flow in a network
that has settled. It is further off while the colony grows and for about 100 steps after the
foods change their roles. The tubes react slowly, over hundreds of steps, so they average over
this error.

**What the second look found.** For this folder every number of the ADR was made again from saved
code. Most numbers held bit for bit. Five things did not, and the ADR now says so:

- The local solver has one tuning number, the radius. It was tuned for a form of the rule that
  the app does not use. With the form of the app another value is about three times as fast on a
  fixed network. The app keeps its value for now: this is an open point.
- One table held numbers from states of the prototype that no file kept. It is measured again.
- In one campaign, 7 of 60 runs had used an older state of the code. The campaign ran again, and
  one entry of one table changed.
- One line of a record was missing. Its run was made again.
- The cost per step moves by about a sixth from run to run.

## What is in this folder, and what you need to read

| Part                                               | Size        | Read it?                                                |
| -------------------------------------------------- | ----------- | ------------------------------------------------------- |
| This page, up to here                              | 1 page      | yes: it is the whole story                              |
| The ADR, section "The solvers and the mathematics" | 300 lines   | if you want the formulas                                |
| The rest of this page                              | 600 lines   | only to run a step again: it is a list of commands      |
| `prototype/`                                       | 3,300 lines | no: the CPU program that compared the three solvers     |
| `solvers.ts`, `rules.ts`, `bounded.ts`, `engine/`  | 1,200 lines | no: the scripts that made the other numbers of the ADR  |
| `logs/`                                            | 1.9 MB      | never: the raw output of the runs, which a script reads |
| `summary.ts`                                       | 370 lines   | no: it makes the tables of the ADR from `logs/`         |
| `research.test.ts`                                 | 240 lines   | no: it checks that the scripts still give the same rows |

The app does not load this folder, and the build does not hold it.

## The reference starts here

The prototype keeps the rule that it had on 2026-11-12, because the ADR holds its numbers.
Decision 16 of the ADR lists what changed on 2026-11-13: the paths, some names, one switch in
`prototype/flow.ts`, one parameter in `prototype/tokyo.ts`, the second half of
`prototype/static.ts`, which was written again, and the light on the Tokyo map, which no run used
and which went away. `research.test.ts` checks that the scripts still give the rows of the logs.

## What you need

- Node 26 and the packages of the repository: `npm ci`. Checked with Node 26.10, 26.13 and 26.13.1.
- For part 6 and for the browser tests of part 7: the browser of the tests,
  `npx playwright install chromium`.
- Run every command from the root of the repository.

Every script starts in the same way. The option `--import ./research/flow/register.mjs` lets Node
run the TypeScript files of this folder and of `src/`:

```bash
node --import ./research/flow/register.mjs research/flow/prototype/ring.ts
```

Most scripts print their result to the terminal and write no file. The runs of the agent model
(`prototype/run-*.ts`, `prototype/campaign.ts`) and the runs of the real engine (`engine/`) write
their logs and pictures to `research/flow/out/`, which git ignores. The folder
`research/flow/logs/` holds the logs of the runs that the ADR quotes.

The times are those of an M3 Pro with 12 cores.

## Words

The ADR has these words with their formulas, most of them in the section "The solvers and the
mathematics". In short:

- **Flux**: how much flows through a tube or a cell per step. A food source gives a fixed flux
  I0 (the setting Flow strength of the app), or it takes that flux.
- **Pressure**: one number per cell. The flux between two cells is their conductance times the
  difference of their pressures.
- **Kirchhoff's law**: what flows into a cell flows out of it again. Only a food source adds flux
  or takes it away. The pressures are right when this law holds in every cell.
- **Flow memory**, `D`: how well a cell with a tube conducts. It is the conductivity of Tero et
  al. The **adaptation** is the rule that changes it: D moves toward f(Q), a number between 0 and
  1 that rises with the flux Q of the cell. So the flow memory grows where the flux is large and
  falls where the flux is small.
- **Starvation and births**: an agent on a cell with a small flow memory dies with a chance of up
  to 2 % per step: it starves. A dead agent comes to life on a cell with a flow memory above 0.5.
  So the agents leave the tubes without a flux and fill the tubes that carry one.
- **Food source** and **food site**: a food source is one food of a scene, for example a city of
  the Tokyo scene. A site is the cell where a flux enters or leaves the network: the centre cell
  of a food stroke. The Tokyo scene has 36 food sources and 42 sites, because Tokyo is seven
  sites.
- **Solver**: the code that computes the pressures from the foods and the conductivities.
- **Exact solver**, `exact`: the method of conjugate gradients. It takes Kirchhoff's law of all
  cells as one system of equations, and it iterates until the law holds in every cell within a
  tolerance. A preconditioner is a cheap, rough solve that lowers the number of its iterations.
  `"preconditioner":"mic"` is the modified incomplete Cholesky preconditioner.
  `"preconditioner":"jacobi"` is the simplest one, each cell by itself (the diagonal of the
  system).
- **Local solver**, `lag` in the prototype: Jacobi iterations with a momentum, a fixed number per
  step. One iteration sets the pressure of each cell from its four neighbours. Its pressure lags
  behind the exact one, hence the name. `"solver":"jacobi"` in the output of `static.ts` is this
  solver without the momentum.
- **Momentum** and **radius**: each iteration of the local solver adds a part of the change of
  the iteration before. The radius, 0.99999 in the app, sets how large that part is.
- **Ma's walkers**, `ma` or `walkers`: the solver of Ma et al. 2013. Particles walk at random
  from the food that gives to the food that takes, and the number of walkers on a cell stands for
  its pressure.
- **Field**, `lane` in the code of the prototype: the app solves four pressures side by side. In
  each field every food site has a role: it gives, it takes, or it rests.
- **Ghost conductivity**: a conductivity of 0.00001 that every open cell has for the pressure
  only. With it a cell beside a tube has a pressure too.
- **Reference cell**: Kirchhoff's law fixes the pressures only up to a constant. The solver takes
  the pressure of one cell, the reference cell, off the whole field.
- **Pressure limit**: a food site gives less flux when its pressure is far from the mean pressure
  of the sites.
- **Growth gate**: with Growth and shrinkage on, an agent divides only on a cell whose flow memory
  is at least 0.01.
- **μ** in part 2: the exponent of the adaptation in Tero's ring, f(Q) = Q^μ (ADR, "The
  prototype"). The ADR's section on the solvers uses μ for another number: the factor by which
  one iteration multiplies a pattern of the error.
- **TL, MD, FT**: the measures of Tero et al. 2010 for a network between food sources. TL is the
  total length of the tubes and MD is the mean distance between two food sources along the tubes,
  both over the same number of the minimum spanning tree. FT is the share of the links whose loss
  leaves all food sources joined.
- **The review**: a second reader went through the code before PR #44 was merged (ADR, "Review
  before the merge"). Some runs exist with the code before it and with the code after it.

## The shortest check

1. The unit tests run the scripts of this folder for a few steps and compare them with the logs,
   bit for bit (`research.test.ts`). The reruns of the prototype take 30 to 40 s, so they run
   on CI and with `RESEARCH=full`. Without it only the quick checks run (2 s).

   ```bash
   RESEARCH=full npm test
   ```

2. The tables of the ADR come from the logs. This prints table (a), the Maze, in a second:

   ```bash
   node --import ./research/flow/register.mjs research/flow/summary.ts maze-campaign research/flow/logs/maze-pair base exact lag8 lag16 lag32 ma
   ```

3. The three solvers on one fixed network, with the rule of the app (2 to 3 minutes):

   ```bash
   node --import ./research/flow/register.mjs research/flow/solvers.ts
   ```

## The way to the decision, step by step

Each part names the question, the command, the time, what you must see, and what the result
meant for the decision. The section of the ADR that uses the result is in brackets.

### 1. What do the papers say? [Context, Options]

No command. `docs/knowledge-base/flow-in-the-tubes.md` lists each fact with its paper and its
section. The ADR has the formulas ("The solvers and the mathematics").

Result: the model of Tero et al. needs the pressure of the whole network in every step. That is a
system of equations with one unknown per cell. The ADR lists four options. Three of them compute a
flux, and the prototype has all three: Tero's model with an exact solver, Tero's model with a
local solver, and Ma's walkers. The fourth, a rule without a flux, was not built: no paper gives
such a rule, and from inside a dead end looks like a route.

### 2. Do the three solvers compute the same thing? [The prototype]

Tero's ring (2007, Sec. 5.2) has a closed form: two tubes of length 10 and 16 between two foods.
For μ = 0.8 the flow memory of the two tubes ends at D1 = 0.9297 and D2 = 0.1419, and for μ = 1
at 1 and 0.

```bash
node --import ./research/flow/register.mjs research/flow/prototype/ring.ts
```

1 s. Six lines, one per solver (`exact`, `lag`, `ma`) and μ. `D1` and `D2` must equal `expect`,
the closed form. The walkers (`ma`) are samples and are right to three places. `Q1` and `Q2` are
the fluxes of the two tubes.

Result: all three solvers are correct on a small network. So a difference on a large network
comes from the size of the network, and not from an error in a solver.

### 3. How much work is each solver on a real network? [The pressure on a fixed network]

The network is the Maze after 1,000 steps of the agent model, seed 1. Nothing moves, and the flux
runs between the two foods.

```bash
node --import ./research/flow/register.mjs research/flow/prototype/static.ts plain=2000
```

1 minute. One line per solver. `stats.iterations` is the number of iterations of the exact solver.
`hit` holds the first number of iterations at which the error of the local solver is below 20 %,
5 % and 1 %. `err` is the error at the end: the sum of the differences to the exact flux over the
sum of the exact flux. You must see: `exact` with `mic` 496 iterations and with `jacobi` 3,109;
`lag` with the radius 0.99999 reaches 5 % after 4,410 iterations, with 0.9999 after 14,970 and
with 0.999999 after 4,620. This `lag` solver holds the two foods at fixed pressures. The last
line is the same solver without the momentum: with `plain=2000` it stops after 2,000 iterations,
at an error of 0.947. Without `plain=2000` it runs to 400,000 iterations (10 minutes more) and
is then at 0.426.

The script keeps the network in `research/flow/out/trail-s1-1000.f32` and reads that file in the
next call. Delete the file to make the network again.

```bash
node --import ./research/flow/register.mjs research/flow/solvers.ts
```

2 to 3 minutes. The same network with the rule of the app: each food gives or takes a fixed flux.
The script first checks that its loop gives the bits of `flowPressure()` in
`src/engine/flow-reference.ts`. You must see: exact 3,068 iterations; the ghost conductivity
changes the exact flux by 0.037 %; the pressure reaches 2, 50 and 962 cells after 1, 4 and 16
iterations; as the app runs it, the error is 43.7 % at step 260, below 20 % from step 570, and
6.7 % at step 1,000; with the radius 0.999999 it is below 5 % from step 348. `plain=25000` runs
the last part, without the momentum, to 400,000 iterations (17 minutes more): 62.3 % off.

```bash
node --import ./research/flow/register.mjs research/flow/prototype/static-ma.ts 2000 150000
```

About 35 minutes. Ma's walkers on the same network: the source gets 2,000 new walkers per step,
for 150,000 steps. The script needs the file that `static.ts` wrote. Every 5,000 steps it prints
one line: `err` is the error against the exact flux, `arrive` is the number of walkers that reach
the far food in a step over the 2,000 new walkers of a step, `held` is the number of walkers on
the grid, and `min` is the time in minutes. You must see `err` 0.888 at the end, and `arrive` 0 in
every line.

Two smaller measurements of the same section, on the network while the agents move:

```bash
node --import ./research/flow/register.mjs research/flow/prototype/vary.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/prototype/track.ts
```

1 and 2 minutes. `vary.ts` prints how much the exact flux changes from one step to the next:
`dQ` is the change as a share of the whole flux, 0.0032 to 0.0037. `track.ts` prints how well the
prototype's local solver follows the exact flux: `err` is 0.068 at step 300, 0.043 at step 400
and 0.011 at step 1,500.

Result: the exact solver needs 496 iterations with the preconditioner `mic`. That preconditioner
goes through the cells one after the other, so a GPU cannot run it as one pass. With the
diagonal, which a GPU can run, the solver needs 3,109 iterations, and each iteration needs two
sums over the whole grid. Ma's walkers are far too slow on a network of this length. The local
solver with a momentum needs thousands of iterations from a pressure of 0. But the network changes
little per step, so 16 iterations per step, from the pressure of the step before, can follow it.

The two rules for the foods differ much. With fixed pressures at the two foods (`static.ts`) only
the shape of the flux field has to settle. With a fixed flux, the rule of the app (`solvers.ts`),
the height of the pressure has to build up too, and that takes longer. The radius 0.99999 of the
app was chosen with fixed pressures. With a fixed flux the radius 0.999999 is about three times
as fast on this network. The app keeps 0.99999, because every result is measured with it. This is
an open point of the ADR (decision 3 and the Consequences).

### 4. Does the solver change what the agents build? [(a) The Maze, (b) A layout like Tokyo]

One run of the Maze: the agent model with a flux field, seed 1, the local solver with 16
iterations. 6 to 8 minutes.

```bash
node --import ./research/flow/register.mjs research/flow/prototype/run-maze.ts name=lag16-s1 seed=1 steps=10000 flowFrom=500 death=0.02 birth=0.2 rate=0.003 solver=lag iterations=16
```

It writes `research/flow/out/lag16-s1.jsonl`, one row every 250 steps, and pictures. The first row
holds the arguments. In the other rows, `ratio` is the trail in the corridor of the shortest route
over the trail in the dead ends, `joined` says if a tube joins the two foods, `tube` is the length
of that tube over the shortest route, and `fade` holds the first step at which the dead ends are
below 10 % and below 2 % of the route. You must see `"fade":{"10%":2500,"2%":3500}` in the last
row. The arguments of a run are at the top of the script: `flowFrom` is the step at which the flow
starts, `death` and `birth` are the largest chances of the starvation and of the births, and
`rate` is the rate of the adaptation. `solver=exact` and `solver=ma walkers=2000` run the two
other solvers; `flowFrom=99999999` runs no flow.

A campaign runs many such runs, several at a time:

```bash
node --import ./research/flow/register.mjs research/flow/prototype/campaign.ts maze-pair jobs=7
```

```bash
node --import ./research/flow/register.mjs research/flow/prototype/campaign.ts maze-sites jobs=7
```

```bash
node --import ./research/flow/register.mjs research/flow/prototype/campaign.ts tokyo jobs=7
```

65, 65 and 19 minutes. `jobs=7` runs 7 runs at a time; without it the script takes
half of the cores. `seeds=1,2` runs only these seeds, and `dry=1` prints the runs and starts none.
The logs go to `research/flow/out/<campaign>/`.

- `maze-pair` is table (a), 60 runs: ten seeds each of no flow (`base`), the exact solver, the
  local solver with 8, 16 and 32 iterations and fixed pressures at the two foods, and Ma's walkers.
- `maze-sites` is the last sentence below table (a), 30 runs: ten seeds each of the local solver
  with 8, 16 and 32 iterations, where each food gives or takes a fixed flux, as in the app.
- `tokyo` is table (b), 6 runs: the Tokyo layout with the land full of agents at the start. Two
  seeds with the flux 8, one seed with the flux 4, and three seeds with Ma's walkers.

Then compare the logs of each campaign with the record:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts compare research/flow/out/maze-pair research/flow/logs/maze-pair
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts compare research/flow/out/maze-sites research/flow/logs/maze-sites
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts compare research/flow/out/tokyo research/flow/logs/tokyo
```

`compare` must print "all … rows equal" for every log, and at its end "60 of 60", "30 of 30" and
"6 of 6 logs of the rerun equal the record". It names every log that differs, that is shorter, or
that the record does not have, and it then ends with an error. After a run with fewer seeds it
also lists the logs of the record that the rerun does not have; that is no error.

The tables come from the logs. These commands read the record; give them `research/flow/out/…`
to read your rerun. The command for table (a) is in "The shortest check".

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts maze-campaign research/flow/logs/maze-sites mz-lag8 mz-lag16 mz-lag32
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts tokyo-campaign research/flow/logs/tokyo tk-i8 tk-i4 tk-walk
```

A line of a Maze table gives the median over the seeds, and in brackets the least, the most and
the number of runs. You must see:

- Table (a), `lag16`:
  `dead ends below 10% of the route: 10 of 10 runs; step 2500 (2500 to 3250, n 10)`. With `exact`
  the step is 2250 (2250 to 2500).
- Table (a), `ma`: `joined 0 of 10` from step 2,500 on, and the line `NO NETWORK in 10 of 10 runs`.
  The ADR writes "(no network)" in this row: the whole trail fades, so the steps of "below" in
  this block do not show a route.
- `mz-lag16`: `dead ends below 10% of the route: 10 of 10 runs; step 2125 (2000 to 2250, n 10)`.
- The Tokyo table has one line per run and measured step. `tk-i8`, run 1, step 2,000: 3,947
  agents alive and `33: 33 joined, 49 links, TL 1.60 MD 0.83 FT 0.88`. Every line of `tk-walk`
  from step 2,000 on holds `33: 1 joined`: the network is dead.

A run gives the same numbers again: it has no thread, no clock, and no random numbers but those
of its seed. Checked with Node 26.10 on macOS (ARM), Node 26.13 on Linux (x64 and ARM), and Node
26.13.1 on GitHub (Linux x64). The language does not fix some functions of a run to the last bit
(`Math.sin`, `Math.cos`, `Math.pow`, `Math.hypot`), so another version of Node can give other
last digits.

The rules that decisions 5 and 8 of the ADR reject are arguments of the same scripts. Each ran
once with seed 1, as the campaign `alternatives` (9 minutes):

```bash
node --import ./research/flow/register.mjs research/flow/prototype/campaign.ts alternatives jobs=7
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts compare research/flow/out/alternatives research/flow/logs/alternatives
```

| Log                    | The rule                                                         | What you must see in the two tables below                                     |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `maze-deposit-only-s1` | the flow memory scales the deposit of an agent; no agent starves | `dead ends below 10% of the route: 0 of 1 runs`; the trail ratio stays near 4 |
| `maze-no-births-s1`    | agents starve, and no dead agent comes to life                   | at step 10,000: `alive 258`, `joined 0 of 1`, and the line `NO NETWORK`       |
| `tokyo-pairs-s1`       | one random pair of foods per field, held for 300 steps           | 1,044 agents alive at step 2,000, 152 at step 3,000; then `1 joined`          |
| `tokyo-pressure-s1`    | each food at a fixed pressure, and not with a fixed flux         | 301 agents alive at step 2,000; from then on `1 joined` or `2 joined`         |

`prototype/campaign.ts` has the arguments of each run.

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts maze-campaign research/flow/logs/alternatives maze-deposit-only maze-no-births
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts tokyo-campaign research/flow/logs/alternatives tokyo-pairs tokyo-pressure
```

Result: with 16 iterations per step the agents build the network that they build with the exact
solver, within the spread of the seeds. With Ma's walkers the network dies in every seed. So the
app got the local solver with 16 iterations. Each of the four rejected rules fails as the ADR
says: the dead ends stay, or the network dies.

### 5. Why did the pressure run away, and what holds it? [Decisions 3 and 6]

The first version of the app let the pressure grow without limit while the colony grew. Four
rules stop that (decision 6):

1. A food cell conducts only while it holds a tube.
2. Only the food sites that the colony covers give or take, and as many give as take.
3. A site gives or takes only within its pressure limit.
4. Only a cell with a tube takes the momentum of the iteration.

`bounded.ts` runs a small scene on a CPU copy of the app's passes (`rules.ts`) with single rules
switched off. In every run it checks that the copy with all rules on gives the bits of the app's
own CPU copy.

```bash
node --import ./research/flow/register.mjs research/flow/bounded.ts scene=grow
```

2 minutes. A mesh of tubes grows over four foods. One line per rule that is off; the numbers are
the largest pressure on the cells with a tube. You must see it stay below 45 "as built", and
reach 7.8e+7 at step 150 with all four rules off.

```bash
node --import ./research/flow/register.mjs research/flow/bounded.ts scene=isolated
```

1 minute. This scene is for another rule: which cell is the reference cell (decision 3). The
first food of the list lies under a wall. In the first version the reference cell was the first
food site of the list: then the mean pressure of the network is `-2.86e+4` at step 3,000. As built
it is the first site that gives or takes, and the mean pressure is 18 at step 6,000 (`1.82e+1`).

Result: rule 4 is the one that matters most. With the momentum on every cell the pressure grows
without end. Without rule 2 the pressure is in the thousands while the colony has not reached all
foods. Rule 1 alone changes little in this scene, and rule 3 changes nothing here: it stops a
site that no tube joins to the others. The reference cell must be a cell of the network, or the
mean pressure drifts away.

### 6. Does the real engine do the same? [Results in the app, decision 6]

The engine runs in a headless browser. A run is a test file for Vitest, with a configuration of
its own: `research/vitest.config.ts`. Only a command that names this configuration starts a run;
`npm test` and `npm run test:gpu` cannot. The settings of a run are environment variables
(`engine/dump.gpu.test.ts` lists them).

The Maze, seed 1, flow strength 8, on WebGPU (30 s to 1 minute):

```bash
VITE_KIND=webgpu VITE_SCENE=maze VITE_FLOW=1 VITE_I0=8 VITE_SEED=1 VITE_STEPS=500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000 VITE_NAME=g-mz-webgpu-i8-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/measure-maze.ts g-mz-webgpu-i8-s1
```

The second command prints one line per step: the agents alive, `ratio` (the trail on the route
over the trail in the dead ends), `tP` and `tD` (the mean trail on the route and in the dead
ends), `joined`, `tube` (the length of the tube over the shortest route), `dP` and `dD` (the mean
flow memory on the route and in the dead ends), and the time of the run in milliseconds. On an M3
Pro the lines equal those of `g-mz-webgpu-i8-s1` in `logs/engine/maze-webgpu-flux8.txt` but for
the time at their end. The line of step 15,000 must hold `alive 4480` and `tube 1.11`. Another GPU
can round some operations in another way; then single numbers differ, and the run is still the
same for the same seed on that GPU.

The Tokyo scene, seed 1, flow strength 1.4, to step 48,000 (4 minutes; with a list of steps that
ends at 8000 it takes 25 s). With `VITE_DUMP_P=1` the run also writes the pressure, for the
comparison with the exact solution:

```bash
VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=1 VITE_STEPS=500,1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_DUMP_P=1 VITE_NAME=g-tk-i1.4-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g-tk-i1.4-s1 1.5 99999
```

```bash
LANES=0,1 node --import ./research/flow/register.mjs research/flow/engine/exact-flux.ts g-tk-i1.4-s1 512 512 1.4 500 2000 4000 8000
```

`measure-tokyo.ts` prints the measures of Tero et al. 2010 per step. Its arguments: the name of
the run, the trail above which a cell is part of the network (1.5), and the steps that get a
picture (99999: none). A line holds the agents alive; after `33:` the food sources that are
joined, the links, TL, MD and FT for the 33 food sources of the paper's Fig. 2; after `36:` the
same for all 36; and `sea`, the cells with a trail outside the land, which must be 0. On an M3 Pro
the lines from step 1,000 on equal those of `g-tk-i1.4-s1` in `logs/engine/tokyo-flux1.4.txt` but
for the time; the record has no line for step 500. The line of step 8,000 holds 4,217 agents
alive, and after `33:` it holds `33 joined 59 links TL 1.99 MD 0.84 FT 0.95`. The line of step
48,000 holds 3,969 agents alive and `33 joined 46 links TL 1.69 MD 0.91 FT 0.89`.

`exact-flux.ts` (75 s) compares the flux of the app's solver with an exact solution on the same
network. It prints the four rows of the table of decision 6 for the flux 1.4, two lines per row:
one for each field. Its arguments: the name of the run, the width and the height of the grid, the
flow strength, and the steps. `LANES=0,1` takes the first two of the four fields. You must see,
for step 8,000, a median error of 7 % in field 0 and of 6 % in field 1, and for step 500 a median
error of 47 % and of 26 %. The four rows for the flux 2 come from the same three commands with
`VITE_I0=2`, with the name `g-tk-i2-s1`, and with `2` in place of `1.4`.

The tables over many seeds come from such lines, kept in `logs/engine/`:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-maze research/flow/logs/engine/maze-webgpu-flux8.txt research/flow/logs/engine/maze-webgl2-flux8.txt research/flow/logs/engine/maze-webgpu-no-flow.txt
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo research/flow/logs/engine/tokyo-flux1.4.txt
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo-end research/flow/logs/engine/tokyo-flux1.txt research/flow/logs/engine/tokyo-flux1.4.txt research/flow/logs/engine/tokyo-flux2.txt
```

The cost of a step, table (c) (1 minute; close other programs first):

```bash
npx vitest run --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts
```

It writes `research/flow/out/engine/bench.jsonl`: per scene and backend the median time of a step
in milliseconds, without and with the flow. The record is 1.66 ms for the Maze with the flow on
WebGPU (`logs/engine/bench-1.jsonl` and `bench-2.jsonl`). Six later runs on the same machine gave
1.27 to 1.93 ms (`bench-3.jsonl` to `bench-8.jsonl`): the time depends on what else the machine
does, also on its GPU. So expect the size of the numbers of table (c), and not their last digit.

The bytes with the flow off (1 minute): the digests of every scene after 500 steps, with the flow
switched off in every scene.

```bash
VITE_NAME=digest-flow-off VITE_PATCH='{"flow":false}' npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/digest-flow-off.jsonl research/flow/logs/engine/digest-main-377f428.jsonl
```

The second command compares them with the digests of `main` before the flow (commit `377f428`,
made on an M3 Pro). It must print that all 34 runs are equal.

On another GPU the digests of both sides can differ from the record. Then make the digests of the
old commit on your machine too, in a second checkout beside the repository (2 minutes):

```bash
git worktree add ../before-flow 377f428
```

```bash
(cd ../before-flow && npm ci && mkdir -p research/flow/out/engine)
```

```bash
sed -e "s#'../../../src/engine/#'./#" -e "s#'../../../src/model/#'../model/#" research/flow/engine/digest.gpu.test.ts > ../before-flow/src/engine/digest.gpu.test.ts
```

```bash
(cd ../before-flow && VITE_NAME=digest-before npx vitest run --project gpu src/engine/digest.gpu.test.ts)
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/digest-flow-off.jsonl ../before-flow/research/flow/out/engine/digest-before.jsonl
```

```bash
git worktree remove --force ../before-flow
```

The `sed` command copies the test to the old checkout and changes its import paths, because the
file lies in `src/engine/` there. The comparison must again print that all 34 runs are equal.

Result: the real engine gives what the prototype gave. In the Maze the dead ends empty, and one
tube stays between the two foods. In the Tokyo scene the network is as long as the organism's (TL
1.77 against 1.75). With the flow off the engine gives the bytes that it gave before.

### 7. Which tests hold the rule? [How to check this record]

```bash
npx vitest run --project unit src/engine/flow.test.ts
```

```bash
npx vitest run --project gpu src/engine/flow.gpu.test.ts
```

```bash
npm run build && npx playwright test --project e2e tests/e2e/flow.spec.ts
```

You must see 22, 27 and 3 tests pass.

- `flow.test.ts` (Node, 1 s): the roles of the foods, the uniform block, the time scale, and the
  growing mesh of part 5 with all rules on.
- `flow.gpu.test.ts` (headless browser, 7 s; 51.0 to 66.5 s on GitHub, which has no GPU). Both
  backends follow the CPU copy of the passes step by step; Kirchhoff's law; the shorter of two
  tubes wins; starvation and births; the pressure limit; the same bytes for the same seed.
- `flow.spec.ts` (headless browser): the switch, the strength and the Tokyo scene in the built
  app.

Result: parts 2 to 6 are measurements that were made once. These tests run on every change. They
hold the rule that the app got: a change that breaks Kirchhoff's law, the adaptation, the two
backends against each other, or the bytes of a scene without the flow fails in CI.

## The logs

| Folder                       | What                                                                   | Made                                                  |
| ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `logs/maze-pair/`            | 60 runs of the prototype: table (a) and the numbers of the Context     | 2026-11-13, `campaign.ts maze-pair`                   |
| `logs/maze-sites/`           | 30 runs of the prototype: a fixed flux at each food                    | 2026-11-12, `campaign.ts maze-sites`                  |
| `logs/tokyo/`                | 6 runs of the prototype: table (b)                                     | 2026-11-12, `campaign.ts tokyo`                       |
| `logs/alternatives/`         | 4 runs of the prototype: the rules that decisions 5 and 8 reject       | 2026-11-13, `campaign.ts alternatives`                |
| `logs/engine/*.txt`          | the lines of `measure-maze.ts` and `measure-tokyo.ts` per run          | 2026-11-13, commit `92a63e7`, M3 Pro, Chromium, Metal |
| `logs/engine/bench-*.jsonl`  | table (c): runs 1 and 2 are the table, runs 3 to 8 are later runs      | 2026-11-13; runs 3 to 8 with the code of `main`       |
| `logs/engine/digest-*.jsonl` | the digests of `main` at `377f428`, and of `92a63e7` with the flow off | the same                                              |
| `logs/engine/before-review/` | the Tokyo runs with the code before the review (commit `6ffed4b`)      | 2026-11-13                                            |

The first row of a prototype log holds the arguments of its run, and `s` in a row is the time of
the run in seconds. The name of an engine run says what it is: `g-mz-webgpu-i8-s3` is the Maze on
WebGPU with flow strength 8 and seed 3, and `g-tk-i1.4-s3` is the Tokyo scene with flow strength
1.4 and seed 3. The engine runs without the flow are `g-mz-base` and `g-tk-base`.

Notes on the record:

- The commits `92a63e7` and `6ffed4b` are commits of the branch of PR #44. The PR went into `main`
  as one commit (`e273749`), so `main` does not hold them. GitHub keeps them:
  `git fetch origin pull/44/head` gets them. The code of the engine in `92a63e7` is that of `main`
  at `e273749`: the two differ in one comment in `src/model/presets.ts` and in the test file
  `src/engine/flow.gpu.test.ts`.
- The campaigns `maze-sites`, `tokyo` and `alternatives` ran again in full on 2026-11-13 with the
  code of this folder. Every row equals the record (30 of 30, 6 of 6 and 4 of 4 logs). The first
  row of a Tokyo log of 2026-11-12 also holds `light`, an option that `run-tokyo.ts` no longer
  has.
- The Maze campaign `maze-pair` started on 2026-11-12 two minutes before the last change of
  `prototype/flow.ts`. The 7 runs that had started before the change used the older state. Both
  states hold the same rule; they round floats in another order. The logs of these 7 runs
  differed from what the code of this folder gives: from the 11th digit on with the local solver
  and with the walkers, and from the 8th digit on with the exact solver, where the number of
  agents alive in seed 1 differs from step 4,250 on. The other 53 logs were equal. So the whole
  campaign ran again on 2026-11-13 with the code of this folder, and table (a) of the ADR has
  these numbers.
- One check of the ADR is not in the record: the Tokyo run without the growth gate (decision 9). It
  needs a build without the two lines of the gate in `growth.wgsl` and `growth.frag`.

## The files

| File                      | What it is                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `register.mjs`            | lets Node run the TypeScript files                                                                |
| `prototype/world.ts`      | the grid of a scene as the app paints it, distances along the maze, pictures                      |
| `prototype/jones.ts`      | a CPU copy of the agent model (not bit-equal to the GPU)                                          |
| `prototype/flow.ts`       | three solvers for one pair of foods: exact, local with fixed pressures, Ma's walk                 |
| `prototype/flow-multi.ts` | the local solver for several fields and sites: the rule that the app got                          |
| `prototype/maze.ts`       | the Maze, its shortest route, its dead ends and its measures                                      |
| `prototype/tokyo.ts`      | the Tokyo layout and the measures TL, MD and FT of Tero et al. 2010                               |
| `prototype/campaign.ts`   | the campaigns: the runs of the record with their arguments, several at a time                     |
| `prototype/*.ts` (others) | one script per measurement; each says at its top what it measures                                 |
| `data/tokyo_scene.json`   | the map of the prototype: stations from Wikidata (CC0), coast © OpenStreetMap contributors (ODbL) |
| `solvers.ts`              | the solvers on one network with the rule of the app (2026-11-13)                                  |
| `rules.ts`, `bounded.ts`  | the passes with single rules as switches, and two scenes for them (2026-11-13)                    |
| `engine/*.gpu.test.ts`    | runs of the real engine: dumps, the time of a step, digests                                       |
| `../vitest.config.ts`     | the Vitest configuration of the runs of the real engine                                           |
| `engine/measure-*.ts`     | the measures of a dump                                                                            |
| `engine/exact-flux.ts`    | the local solver against an exact solution, on a dump                                             |
| `summary.ts`              | the tables of the ADR from the logs, and the comparison of a rerun with the record                |
| `research.test.ts`        | the unit test that keeps the scripts and the logs together                                        |

Not in this folder: the papers (copyright; the knowledge base has the references), and the dumps
of the engine runs (some gigabytes; a run writes them again).
