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
  fixed network. The app kept its value as an open point; part 12 measured it (below).
- One table held numbers from states of the prototype that no file kept. It is measured again.
- In one campaign, 7 of 60 runs had used an older state of the code. The campaign ran again, and
  one entry of one table changed.
- One line of a record was missing. Its run was made again.
- The cost per step moves by about a sixth from run to run.

**After the merge: a scene with several strains**
([ADR 0031](../../docs/adr/0031-a-flow-for-every-strain.md), part 8). The owner tried the flow with
a second strain. Agents of a strain that had no living agent appeared on the tubes of the first
strain. The cause: the flow took all strains for one slime mold. The rule that brings dead agents
to life did not look at the strain, and the flux ran through the tubes of all strains together.
Now every strain is a slime mold of its own: the flow runs once for each strain, on the trail of
that strain alone. A scene with one strain gives the same bytes as before (18 of 18 runs). The
price: each strain costs the time and the memory of the flow again, about 1.8 ms per step in the
Maze. One case was open: in the start scene with three strains and one agent per cell the trail
was too weak for a tube, so the flow did nothing there.

**Scenes for the flow** ([ADR 0032](../../docs/adr/0032-scenes-for-the-flow.md), part 9). The trail
of that scene is weak because it decays fast: 60 % in a step, where Jones' trail loses 10 %. The
level from which a cell holds a tube was a fixed number of deposits. Now it follows the decay of
the strain, and the flow acts in that scene too. Three new scenes use the flow: one colony on a
ring of foods, and two scenes with two rival strains that each build a network of their own on
the same foods. For them, each strain starts on a food of its own.

**The picture of the tubes** ([ADR 0034](../../docs/adr/0034-the-picture-of-the-tubes.md), part
10). The owner saw tubes vanish, but no tube looked thicker than another: the picture showed the
trail, and a tube of Jones' agents has about the same width everywhere. The flow keeps a number
for every cell that says how well its tube conducts, the flow memory. It grows where much flow
runs, and it falls where little flow runs. Now the picture draws every tube as wide and as bright
as that number says. The radius follows the law for a liquid in a round tube: where a tube
conducts 16 times as well, the picture draws a disc with twice the radius. A tube that keeps much
flow stays thick, and a tube with little flow gets thin and faint. A new tube starts thick: the
model gives it a middle value. This changes the picture only, and a switch turns it off. The rule
was chosen with pictures of saved states, made on the CPU. Four other rules were drawn and
rejected, and the script can still draw them.

**A food site is a stroke** ([ADR 0029](../../docs/adr/0029-flow-in-the-tubes.md), amendment
2026-11-14 (2), part 11). The flux of a food entered at one cell: the start of its stroke. A
dragged line of food is many strokes, one for each half radius of the drag, so it was many
sites, each with the whole flux, and a strain covered a dab only at its centre. Now a site is a
dab or a whole drag, with every cell that it paints. A strain covers it from any of these cells,
and the flux enters at the covered cell nearest the start of the stroke. The engine finds the
strokes in the list of edits by their geometry: a segment of a drag starts where the one before
ends. So a link of before gives the same sites. The Maze and the Tokyo scene give the numbers of before within
the spread of the seeds. On the Tokyo map the network at step 48,000 is a little longer (TL 1.89
against 1.77; over the samples from step 16,000 on 1.84 against 1.80), and all 36 food sources
are joined in more samples (78 of 80 against 73). The first build of the pass that finds the
cell of the flux looked at the cells of a site one after the other: a large food that no tube
covers cost 128 ms per step. Now the pass looks at blocks of 64 cells side by side, and its cost
is below the noise of the measurement. With the flow off, every scene keeps its bytes.

**The radius of the solver** ([ADR 0029](../../docs/adr/0029-flow-in-the-tubes.md), amendment
2026-11-15, part 12). The local solver has one number to tune, the radius of its momentum. A larger
radius lets the smooth patterns of the pressure settle sooner, those that carry the flux between far
foods, and lets every other pattern swing longer. On a network that holds still, the candidate
0.999999 settles two to three times as fast as 0.99999. But while the colony of the Tokyo scene
grows, cells join its network in every step, and their errors then swing three times as long and add
up: the flux of the solver ran to hundreds of times the right one, and about half of the tubes got a
flow memory at which dead agents come to life: in part the fault of step 4. Radii between gave less
of both, and already the smallest of them, 0.999993, raised the flow memory of hundreds of tube
cells in four of five seeds, where 0.99999 raised almost none. In the Maze even 0.999999 did not
empty the dead ends sooner. So the app keeps 0.99999. The flux of the Tokyo scene had been chosen
with this radius and the sites of before: measured again with the sites of decision 17, a flux of 1
gives a network a little nearer to the organism's length, but not by more than two sets of seeds
differ, and it leaves a food source without a tube more often. The scene keeps its flux of 1.4.
**How long starved ground stays closed** ([ADR 0029](../../docs/adr/0029-flow-in-the-tubes.md),
amendment 2026-11-15 (2), part 13). Where a tube starved, its ground keeps a low flow memory: agents
die there and do not divide there, until the memory has grown back to that of fresh ground, 18 h of
model time after the deepest starvation. The record said that faint strands lived for ever when the
ground was fresh again at once, but no run had shown it. Now the Tokyo scene ran with 18, 12, 6, 3
and 1 h and the Maze with 18, 6, 3 and 1 h, ten seeds each. With every shorter time the ground
between the tubes of the Tokyo map opens again, the growth rule of the agents fills it with a mesh
that no flux feeds, and the mesh stays: from step 16,000 on the network is 1.95 times as long as the
shortest tree with 12 h and 2.3 to 2.6 times with 6, 3 and 1 h, where it is 1.84 with 18 h and 1.75
for the organism. In the Maze, which has no growth, only 1 h lets the dead ends fill again while
they empty. So the app keeps 18 h. And the colony does grow back into a region that it lost: where
the network around four cities is taken off, it joins them again within 7 to 13 minutes of model
time, and where their foods are taken away for 100 minutes and come back, within 10 to 33 minutes.
What stays closed is the ground between the tubes, where no tube is needed. The Cut tool of the app
was no help for this test: it threw the agents of its wound to random points of the whole dish,
also into the sea, where they grew into colonies. Since ADR 0039 it kills them while growth runs,
and the same run keeps the sea empty.
**Light on the mountains** ([ADR 0042](../../docs/adr/0042-a-second-tokyo-scene-with-light.md),
part 14). Tero and colleagues also ran their experiment with light on the mountains and the lakes,
because the slime mould avoids bright light. A second scene, Tokyo with light, has this light: 53
cells of 9 × 10 km that lie 200 m or more above the sea, and Lake Kasumigaura, every lit cell
equally bright. Ten seeds ran beside the ten of the scene without light. The colony first grows
over the lit ground as over dark ground: the light of this app turns an agent only at the edge of
a lit area, and growth does not read it. Then the tubes on lit ground go first. From step 16,000
on the network holds 4.6 % of its cells on lit ground, which is a quarter of the land; the network
without light holds 9.1 % there. Its length, its directness and its fault tolerance do not change
by more than two sets of seeds differ. No light strength from 0.02 to 0.5 kept the network off the
lit ground better. The scene made the list of a scene's shapes longer than one byte counts, so a
link now writes that number in a new way, and old links still open.
**Light stops growth** ([ADR 0050](../../docs/adr/0050-light-stops-growth.md), part 15). The
colony grew over the lit ground because it spreads by births, and a birth did not read light. A
new rule of the extended model lets a birth onto a lit cell fail with a chance: the setting Light
stops growth times the brightness of the cell. The scene Tokyo with light runs it at 1. Then the
young network holds 3.3 % of its cells on lit ground in place of 15.9 %, and the old network 1.3 %
in place of 4.6 %. Half a chance changes little: growth is far faster than the front needs. One
food, Ito, lay on dark land that the lit mountains and the coast enclosed, and the colony no
longer joined it. So two lit cells on the coast from Odawara to Ito are dark now, and one seed on
that map joins all 36 foods. The default of the setting is 1. The rule of Jones for light, which TODO.md proposed first, would not have helped:
it acts only at the edge of a lit area, as the repellent does.
**Two mazes with growth** ([ADR 0051](../../docs/adr/0051-the-scenes-snail-maze-and-corn-maze.md),
part 16). The Maze has one route, so it cannot show a choice. Two new scenes start as a small
colony on one food, with growth and the flow. The Snail maze is a spiral with one route and eight
blind branches. The Corn maze has rooms with loops: six routes join its two foods, and the longest
is 1.47 times as long as the shortest. Ten seeds ran for each. In the Corn maze the shortest route
alone carries the flow in every run, 500 to 2,500 steps after the colony joins the foods, and its
tube is at most 2 % longer than the shortest way. In the Snail maze the tube follows the one
route. But the dead ends do not empty as in the Maze: the colony keeps growing short branches
into the corridors that the flow has left, and they hold 11 to 36 % of the route's trail.
**No child onto starved ground** ([ADR 0053](../../docs/adr/0053-no-child-onto-starved-ground.md),
part 17). Why does the colony come back into the dead ends of the two mazes? The plan of
2026-11-16 had read one cause in the code: an agent on a fed tube could place a child onto starved
ground beside it. A count of the births showed that this was a third of the births in the dead
ends. A new rule stops them: a starved neighbour is not free. Then ten seeds of each maze and of
the Tokyo scene ran again, and no measure moved by more than the seeds differ. The blind branches
of the Snail maze hold 9 to 25 % of the trail of the route, as before. The cause is the mark of
starved ground. Ground is closed for births while its flow memory is below 0.01. The memory falls
only while a cell holds a tube, and a starved tube is gone soon. So each cell stops at a memory of
its own, and about a fifth of the ground of a dead end is open at any time. The colony comes back
as a wave: a blind branch fills about twice in 10,000 steps and starves again. Seven other rules
ran on three seeds each. One keeps the blind branches empty: a starved tube that vanishes leaves
its ground at the floor of the flow memory. It is not built, because it changes the rule of the
flow memory: the owner decides. The rule that the plan has for the slime, a lower weight for
marked ground in the pick of a birth, changes nothing in a dead end: there every free neighbour
has the mark.
**A starved tube leaves starved ground**
([ADR 0054](../../docs/adr/0054-a-starved-tube-leaves-starved-ground.md), part 18). The owner read
that result and asked for a fix that reaches the aim. So that one rule ran in runs of 80,000 steps.
The blind branches of the Snail maze were empty for 10,000 steps, and then the colony came back:
the mark had faded, 20,025 steps after the ground had closed. A wider mark, on every ground that a
tube left, did the same, and it cost the Tokyo scene its regrowth. So every mark that fades lets
the colony come back when it has faded, and its time decides. The papers give no life time of the
slime; the longest avoidance that one of them reports is 6 days. With the rule and a mark of 6
days in place of 18 h, ten seeds of each maze ran again: a blind branch of the Snail maze holds
0.4 % of the trail of the route, where it held 17.6 %, no child is born in the dead ends, and the
tube joins the foods as before. Runs of 220,000 steps show the end of the mark: after 160,182 steps
each blind branch fills once, for 1,000 to 3,000 steps, and it is closed again. What stays beside
the tube are short twigs: agents walk onto closed ground and starve there, because the mark stops
births and no moves. The long mark makes the Tokyo network leaner, so its flow strength was chosen
again, as ADR 0029 chose it: 2.8 in place of 1.4 gives the total length of the organism at the
time of its experiment. Both are choices of the coordinator, and the owner can change them.
**The slime field** ([ADR 0055](../../docs/adr/0055-the-slime-field.md), part 19). The plasmodium
leaves slime where it was, and the plan gives the model a field for it. The extended model now
keeps, for every cell, the step in which the cell last held plasm. A cell has slime for the
setting Slime life time after that step, 144 hours at the start. A brush paints slime, and the
picture shows the slime as a pale layer on the ground. The slime and the mark of starved ground
are two fields, as the organism has two cues, and the same setting gives the mark its time. No
rule reads the slime yet: every scene keeps its bytes, and with 18 hours the Snail maze gives the
runs of ADR 0054 with 18 h, line for line. The rule of avoidance comes next, after a measurement
in a Y-maze: a lower weight in the pick of a birth acts only where blank ground meets slime, so
its design is not safe without that measurement.
**The Y-maze** ([ADR 0056](../../docs/adr/0056-the-avoidance-of-slime-waits-for-the-growth-front.md),
part 20). Reid et al. 2012 let plasmodia choose between an arm with slime and a blank arm. 39 of
40 took the blank arm, with slime on both arms they had no preference, and slime did not slow
them. A Y-maze of that size ran here as research code, with 40 seeds. The app has no preference:
19 to 20. The rule of the plan, a lower weight for slime in the pick of a birth, gives 26 to 11,
and no rule of the births does better. Agents that walk carry the front: they cross an arm of 4 cm
in 65 steps, and the children follow them. A rule for the moves gives 40 to 0, and no preference
with slime on both arms. But its colony then needs 233 steps to the food in place of 65: the
choice of that rule comes from a slower colony, and the plasmodium is not slower. So no rule is
built. The plasmodium chooses as one body, whose plasm goes to the part of its front that moves
on, and the model gets that with the growth front of stage 4.
**The film of the slime** ([ADR 0057](../../docs/adr/0057-the-film-of-the-slime.md), part 21). The
owner looked at the pale layer of the slime and found it flat and jagged. The stamp says when
plasm was in a cell, not how much, and a colony covers most ground once: the layer was the same
everywhere. The slime field now also holds an amount of slime per cell, for the picture alone. A
cell under a full tube gains 1 of 4,095 per step, up to the level of its plasm. So the amount is
high where a tube stayed, and the picture draws a wet film that keeps the shape of the tube. The
organism leaves the coat of slime of a tube behind in the same way. An amount that grows fast is
flat, as the stamp is: with a sum that is full after 500 steps, 96.5 % of the cells with slime
are above 0.9 after 22,000 steps of the Snail maze. With the rule, 16.4 % are. No run changes.
**The growth front in the picture** ([ADR 0060](../../docs/adr/0060-the-growth-front-in-the-picture.md),
part 22). A real slime mold has a sheet at its front, then fine veins, then one tube. The model
grows arms of full plasm with blunt ends, so its picture had none of that. The slime field now
holds a front stamp per cell: the step at which plasm came onto ground without slime. Plasm that
comes back onto slime gets no new stamp. Such plasm is no front, as a birth there will be no sink
of the flow in stage 4. The picture reads the age of the stamp. Around young ground it draws a
skirt: a thin clear veil of slime below the plasm, which a cell joins over about 20 steps and
leaves with 150. The first build drew a sheet and a net of fine veins from a pattern. The owner
took the veins out: in the organism they form in the crown at the head of a tube, so the model
must grow them, and that is stage 4. This is a picture: the model grows no sheet. Two faults of
the picture went on the way: the film of the slime lay over the tubes, and the edge of the gel
had a tooth for each cell. No run changes.

## What is in this folder, and what you need to read

| Part                                               | Size        | Read it?                                                |
| -------------------------------------------------- | ----------- | ------------------------------------------------------- |
| This page, up to here                              | 1 page      | yes: it is the whole story                              |
| The ADR, section "The solvers and the mathematics" | 300 lines   | if you want the formulas                                |
| The rest of this page                              | 1,900 lines | only to run a step again: it is a list of commands      |
| `prototype/`                                       | 3,300 lines | no: the CPU program that compared the three solvers     |
| `solvers.ts`, `rules.ts`, `bounded.ts`, `engine/`  | 3,200 lines | no: the scripts that made the other numbers of the ADR  |
| `logs.tar.gz`                                      | 1.4 MB      | never: the raw output of the runs, which a script reads |
| `summary.ts`                                       | 470 lines   | no: it makes the tables of the ADR from the logs        |
| `research.test.ts`                                 | 300 lines   | no: it checks that the scripts still give the same rows |

The app does not load this folder, and the build does not hold it.

## The reference starts here

The prototype keeps the rule that it had on 2026-11-12, because the ADR holds its numbers.
Decision 16 of the ADR lists what changed on 2026-11-13: the paths, some names, one switch in
`prototype/flow.ts`, one parameter in `prototype/tokyo.ts`, the second half of
`prototype/static.ts`, which was written again, and the light on the Tokyo map, which no run used
and which went away. `research.test.ts` checks that the scripts still give the rows of the logs.

## What you need

- Node 26 and the packages of the repository: `npm ci`. Checked with Node 26.10, 26.13 and 26.13.1.
- The browser of the tests, `npx playwright install chromium`, for every run in a browser: the
  runs of the real engine (the commands with `research/vitest.config.ts`, parts 6 and 8 to 10),
  the GPU tests (`--project gpu`) and the commands with `playwright`.
- Run every command from the root of the repository.
- Unpack the logs once. The logs of the runs that the ADR quotes are one archive,
  `research/flow/logs.tar.gz`. This command writes them to `research/flow/logs/`, which git
  ignores:

  ```bash
  node --import ./research/flow/register.mjs research/flow/logs.ts
  ```

Every script starts in the same way. The option `--import ./research/flow/register.mjs` lets Node
run the TypeScript files of this folder and of `src/`:

```bash
node --import ./research/flow/register.mjs research/flow/prototype/ring.ts
```

Most scripts print their result to the terminal and write no file. The runs of the agent model
(`prototype/run-*.ts`, `prototype/campaign.ts`) and the runs of the real engine (`engine/`) write
their logs and pictures to `research/flow/out/`, which git ignores.

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
  falls where the flux is small. **Fresh ground** is ground that never held a tube: its flow
  memory is 0.2.
- **Tube body**: how much of a tube a cell holds, from 0 to 1. It follows the trail of the strain,
  and a cell holds a tube from 0.05 on.
- **Strength**, **factor** and **disc** (part 10): the picture of the tubes takes the strength
  across a tube from the tube body times the flow memory of the 3 × 3 cells around a cell. The
  factor is the fourth root of that strength, from 0 to 1. The picture draws every cell with a
  tube as a disc with a radius of 3.5 cells times its factor.
- **Starvation and births**: an agent on a cell with a small flow memory dies with a chance of up
  to 2 % per step: it starves. A dead agent comes to life on a cell with a flow memory above 0.5.
  So the agents leave the tubes without a flux and fill the tubes that carry one.
- **Food source** and **food site**: a food source is one food of a scene, for example a city of
  the Tokyo scene. A site is one painted food stroke, a dab or a whole drag, with every cell that
  it paints (part 11; before 2026-11-14 the one cell at the start of the stroke). The **port** of a
  site is the cell where the flux of a strain enters or leaves the network: the covered cell
  nearest the start of the stroke. The Tokyo scene has 36 food sources and 42 sites, because
  Tokyo is seven sites.
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

2. The tables of the ADR come from the logs. Unpack them first ("What you need"). This prints
   table (a), the Maze, in a second:

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
as fast on this network. The app kept 0.99999, because every result was measured with it, and
the ADR had it as an open point (decision 3 and the Consequences). Part 12 measured it on
2026-11-15: the app keeps 0.99999.

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
npm run build && npx playwright test --project=e2e tests/e2e/tubes.spec.ts
```

You must see 24, 77 and 5 tests pass (27 and 47 before the food sites of part 11, 71 before the
test of starved ground of part 13, and 73 before the tests of respawn while the cut is held of
ADR 0041).

- `flow.test.ts` (Node, 1 s): the roles of the foods, the uniform block of each strain, the time
  scale, and the growing mesh of part 5 with all rules on.
- `flow.gpu.test.ts` (headless browser, 13 s; its 27 tests of ADR 0029 took 51.0 to 66.5 s on
  GitHub, which has no GPU). Both backends follow the CPU copy of the passes step by step;
  Kirchhoff's law; the shorter of two tubes wins; starvation and births; the pressure limit; the
  same bytes for the same seed; and a flow for every strain (part 8).
- `tubes.spec.ts` (headless browser, `flow.spec.ts` before ADR 0049): the switch, the strength and the Tokyo scene in the built
  app.

A test is worth what it catches. This script puts 93 wrong rules of the flow, of its food sites, of
its radius and of starved ground into the code of the app, one at a time, and runs the tests of the
flow for each one (about 55 minutes; the 42 of the food sites are part 11, the 4 of the radius part
12, the 6 of starved ground part 13). Without a
name it also runs the 93 wrong rules of the picture of the tubes (part 10), and the 8 wrong rules of
an agent under a painted wall (ADR 0038, `U1` to `U8`) and the 10 of the cut and a wall while
growth runs (ADR 0039, `K1` to `K10`) against the tests of the agents in `sim.gpu.test.ts`, and
the 10 of respawn while the cut is held (ADR 0041, `N1` to `N10`) against the tests of the flow:

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts
```

It changes files below `src/` while it runs and writes each one back as it was. You must see a
test that fails, marked `×`, for every wrong rule, and no line `NO TEST FAILS`. The record is
`logs/engine/mutations-0031.txt` for 39 of them, and `logs/engine/scenes-mutations.txt` for the
two of ADR 0032, `logs/engine/sites-mutations*.txt` for all 83 with the food sites (part 11), and
`logs/engine/radius/mutations.txt` for the 4 of the radius (part 12), and
`logs/engine/recover/mutations.txt` for the 6 of starved ground (part 13);
`logs/engine/mutations.txt` is the record of the first 22 rules with the 27 tests of ADR 0029. ADR
0029 and ADR 0031 have their rules as a table.

Result: parts 2 to 6 are measurements that were made once. These tests run on every change. They
hold the rule that the app got: a change that breaks Kirchhoff's law, the adaptation, the two
backends against each other, or the bytes of a scene without the flow fails in CI.

### 8. Does every strain have a flow of its own? [ADR 0031]

The fault that the owner saw, as a test (4 s). Two strains, a tube in the trail of one of them,
and 200 dead agents of each strain:

```bash
npx vitest run --project gpu src/engine/flow.gpu.test.ts -t "own strain"
```

You must see 6 tests pass. With the code before ADR 0031, 197 agents of the strain without a tube
came to life.

The owner's case in the real engine (1 minute): the Foraging maze with the flow and a second
strain like the first one.

```bash
VITE_SCENE=foraging-maze VITE_STRAINS=2 VITE_STEPS=8000 VITE_NAME=strains-foraging npx vitest run --config research/vitest.config.ts research/flow/engine/strains.gpu.test.ts
```

It writes `research/flow/out/engine/strains-foraging.jsonl`: per sample of 500 steps the living
agents of each strain (`alive`), the cells with a tube of the strain (`tubes`), and the food sites
that give or take in its flow (`sites`). You must see `"alive":[...,0]` in every line: the second
strain has no agent. The record is `logs/engine/strains-foraging-after.jsonl`. In
`strains-foraging-before.jsonl`, made with `main` at `7d3a5ee`, the second strain has 560 agents at
step 4,001 and 10,953 at step 5,001. That code had one flow for all strains, so its lines repeat
the numbers of the flow for the second strain.

One strain gives the bytes of before (2 minutes): the digests of nine runs on each backend after
2,500 steps, with the state of the flow.

```bash
VITE_FLOW=1 VITE_STEPS=2500 VITE_ONLY=maze,tokyo VITE_NAME=flow-scenes npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
VITE_FLOW=1 VITE_STEPS=2500 VITE_ONLY=foraging-maze,shortest-path,network,light VITE_PATCH='{"flow":true,"model":"extended"}' VITE_NAME=flow-patched npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
VITE_FLOW=1 VITE_STEPS=2500 VITE_ONLY=maze VITE_PATCH='{"collisions":false}' VITE_NAME=flow-norule npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
VITE_FLOW=1 VITE_STEPS=2500 VITE_ONLY=maze,tokyo VITE_PATCH='{"trailSaturation":20}' VITE_NAME=flow-saturated npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
for n in scenes patched norule saturated; do node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/flow-$n.jsonl research/flow/logs/engine/strains-digest-7d3a5ee-$n.jsonl; done
```

The last command compares the four files with the digests of `main` at `7d3a5ee`, the code before
ADR 0031 (made on an M3 Pro). It must print that 4, 8, 2 and 4 runs are equal. On another GPU,
make the digests of `7d3a5ee` on your machine too, in a second checkout (part 6 has the way).

The time of a step with one to four strains (1 minute each):

```bash
for n in 1 2 3 4; do VITE_SCENES=maze VITE_STRAINS=$n VITE_NAME=bench-strains-$n npx vitest run --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts; done
```

The open case of the ADR, the start scene Three strains with two foods in a dish (1 minute each):
with one agent per cell and growth, and as the scene is.

```bash
VITE_SCENE=three-strains VITE_STRAINS=0 VITE_PATCH='{"collisions":true,"growth":true,"boundary":"dish","resolution":512}' VITE_FOODS='[[-0.15,0,0.02],[0.15,0,0.02]]' VITE_STEPS=6000 VITE_EVERY=1000 VITE_NAME=strains-three-dish npx vitest run --config research/vitest.config.ts research/flow/engine/strains.gpu.test.ts
```

```bash
VITE_SCENE=three-strains VITE_STRAINS=0 VITE_PATCH='{"boundary":"dish","resolution":512}' VITE_FOODS='[[-0.15,0,0.02],[0.15,0,0.02]]' VITE_STEPS=3000 VITE_EVERY=1000 VITE_NAME=strains-three-norule npx vitest run --config research/vitest.config.ts research/flow/engine/strains.gpu.test.ts
```

`top` is the largest trail of each strain, in deposits of the strain; a cell holds a tube from 0.2
on. With one agent per cell `top` stays below 0.27 and `tubes` is 0 for every strain: the flow does
nothing. Without the rule `top` is above 30 at step 1,000, every strain has tubes, and almost all
agents starve by step 3,000. The Maze has a `top` of about 2
(`logs/engine/strains-maze-one.jsonl`).

The record (`logs/engine/strains-bench-maze-*.jsonl`, two series): with the flow a step of the Maze
takes 2.0, 3.8, 5.5 and 7.3 ms on WebGPU with one to four strains, and 2.4, 4.5, 6.6 and 8.7 ms on
WebGL2; without the flow 0.2 and 0.4 ms.

Result: every strain has a flow of its own, and a scene with one strain runs as before.

### 9. Do the new scenes keep a network for each strain? [ADR 0032]

The owner's second case (1 minute): the start scene Three strains in a dish with one agent per
cell, growth, the flow and two foods.

```bash
VITE_SCENE=three-strains VITE_STRAINS=0 VITE_PATCH='{"collisions":true,"growth":true,"boundary":"dish","resolution":512}' VITE_FOODS='[[-0.15,0,0.02],[0.15,0,0.02]]' VITE_STEPS=8000 VITE_EVERY=1000 VITE_NAME=scenes-three-dish npx vitest run --config research/vitest.config.ts research/flow/engine/strains.gpu.test.ts
```

You must see `tubes` above 40,000 for every strain at step 1,000, and `"sites":[2,2,2]` from then
on: every strain covers both foods. The record is `logs/engine/scenes-three-dish.jsonl`. With the
levels of before, `tubes` was 0 in every line (`logs/engine/strains-three-dish.jsonl`, part 8).

The three scenes (1 minute each):

```bash
for scene in food-ring rival-networks; do VITE_SCENE=$scene VITE_STRAINS=0 VITE_STEPS=12000 VITE_EVERY=1000 VITE_NAME=scenes-$scene npx vitest run --config research/vitest.config.ts research/flow/engine/strains.gpu.test.ts; done
```

```bash
VITE_SCENE=tokyo-rivals VITE_STRAINS=0 VITE_STEPS=14000 VITE_EVERY=1000 VITE_NAME=scenes-tokyo-rivals npx vitest run --config research/vitest.config.ts research/flow/engine/strains.gpu.test.ts
```

In the scenes with rivals you must see two numbers of about the same size in `alive` in every
line, and in `sites` 10 and 10 for Rival networks from step 4,002 on, and 38 or more of 42 for the
Tokyo map from step 2,002 on. The records are `logs/engine/scenes-*.jsonl`: these runs, Rival
networks on WebGL2 (`VITE_KIND=webgl2`) and with a third strain (`VITE_STRAINS=3`), and Food ring
with the flow strengths 0.5 and 8 (`VITE_PATCH='{"flowStrength":0.5}'`).

The bytes of the scenes with one strain: the commands of part 8, which must again print that 4,
8, 2 and 4 runs are equal.

The time of a step of the three scenes (3 minutes); the record is `logs/engine/scenes-bench.jsonl`:

```bash
VITE_SCENES=food-ring,rival-networks,tokyo-rivals VITE_NAME=bench-scenes npx vitest run --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts
```

Result: in the scenes with rivals each strain keeps a network of its own on the foods, and the
scenes with one strain and Jones' decay run as before.

### 10. Does the picture show how thick a tube is? [ADR 0034]

The states for the pictures (1 minute): the trail and the memory of the flow of a scene at some
steps, written to `out/engine/` (these files are large and not in the record). They are the Maze,
the Food ring, and three strains in a dish without food. In the last one no flux runs, so every
cell keeps the flow memory of fresh ground: it shows how the picture draws a new tube.

```bash
VITE_SCENE=maze VITE_STEPS=4000 VITE_DUMP_P=1 VITE_NAME=v-maze-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts
```

```bash
VITE_SCENE=food-ring VITE_STEPS=2000,6000,12000 VITE_DUMP_P=1 VITE_NAME=v-ring-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts
```

```bash
VITE_SCENE=three-strains VITE_PATCH='{"boundary":"dish","collisions":true,"growth":true,"lattice":[512,512]}' VITE_STEPS=2000 VITE_DUMP_P=1 VITE_NAME=v-three-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts
```

The Tokyo states are those of part 6 (`g-tk-i1.4-s1`). A picture of a state, with the rule of the
app: the trail alone, the strength of the tubes, and the picture of the tubes, side by side in
`out/view/`. The script takes the size of the grid and its boundary from the file `<name>.jsonl`
that the dump wrote.

```bash
node --import ./research/flow/register.mjs research/flow/view/tubes.ts v-ring-s1 12000
```

You must see a line of numbers, and the path of a picture in which the network between the foods
is thick and the strands outside it are thin. The numbers are for the cells with a tube:
`memoryOnTubes` is the flow memory, `belowFresh` the share of the cells below the 0.2 of fresh
ground, `factorOnTubes` the factor of the radius, and `bandWidth` the width of a band of cells
with a tube. The lines of eight states are the record `logs/view/states.jsonl`. This makes them
again:

```bash
printf '%s\n' "v-maze-s1 4000" "g-tk-i1.4-s1 2000" "g-tk-i1.4-s1 8000" "g-tk-i1.4-s1 24000" "v-ring-s1 2000" "v-ring-s1 6000" "v-ring-s1 12000" "v-three-s1 2000" | while read name step; do node --import ./research/flow/register.mjs research/flow/view/tubes.ts $name $step | head -1; done
```

How wide the picture draws a straight tube, by the width of its band of cells and by its flow
memory (the table of decision 2). The record is `logs/view/widths.jsonl`, and a unit test compares
it with the script on every change (`research.test.ts`):

```bash
node --import ./research/flow/register.mjs research/flow/view/widths.ts
```

The rules that were rejected, on the same state. `RULE` names one: `largest` is the largest value
of the discs, which shows scales on a thick tube; `fresh` is fresh ground as the zero point;
`bright` is the brightness alone. `PANELS=view` draws the picture alone, `CROP` is the part of the
grid as x,y,width,height in cells, and `SCALE` is the count of pixels for a cell.

```bash
for rule in largest fresh bright; do RULE=$rule PANELS=view CROP=150,40,160,160 SCALE=4 node --import ./research/flow/register.mjs research/flow/view/tubes.ts v-maze-s1 4000; done
```

The largest value of the discs with a window of 9 × 9 cells for the strength across a tube
(`WINDOW=4`), where a strength of 3 gets the largest radius (`REF=3`):

```bash
RULE=largest WINDOW=4 REF=3 PANELS=view node --import ./research/flow/register.mjs research/flow/view/tubes.ts v-ring-s1 12000
```

The pictures of the app with the switch off and on (3 minutes), written to
`test-results/pictures/`. A file has the name of its scene, its step, its style, and `off` or
`on`. You must see what "The pictures" of the ADR says for each scene. The command starts the
built app on port 4173:

```bash
npm run build && npx playwright test --project=pictures tests/pictures/tubes.spec.ts
```

The time of a frame with and without the picture (4 minutes). The run prints only that its one
test passed: it writes its lines to `research/flow/out/engine/picture.jsonl`. The record is
`logs/view/picture.jsonl`:

```bash
VITE_NAME=picture npx vitest run --config research/vitest.config.ts research/flow/engine/picture.gpu.test.ts
```

The cost on a large grid (amendment of 2026-11-15; 6 minutes): the passes of the picture alone, in
the start scene (three strains on 1,536 × 960 cells, which a canvas of 2560 × 1600 pixels picks)
and on the Tokyo rail network, after 1,500 steps with the flow on. The simulation rests, and the
passes run 50 times per sample on its last state. A line has the median of 11 samples (`median`,
ms per picture), the share of the cells with a disc (`discs`), the tiles of 8 × 8 cells, and
`window`: how many tiles have no disc in their window, and how many have one whose disc reaches
0, 1, 2 or 3 cells. `read` is a digest of what the passes read, so that two checkouts compare the
same state. `VITE_DUMP=1` writes the picture, the factors and the stream of the last state beside
the lines, and `VITE_AGAINST=<name>` compares them with those of a run of another checkout:

```bash
VITE_NAME=passes npx vitest run --config research/vitest.config.ts research/flow/engine/picture-passes.gpu.test.ts
```

The parts of the passes in the Context of the amendment came from this command with one change at
a time in `1cd1c56`, the code before the change, on WebGPU (`VITE_KINDS=webgpu
VITE_SCENES=three-strains`): `picture` that stores a quarter of the trail and returns at once;
`wallOnLine(...)` in `picture` as `false && wallOnLine(...)`; then also `openCells(p)` in `roots`
as `511u`; then also `stream` that stores 0 and returns at once; and `encodeTubes` in `sim.ts`
with one pass only. The choice of `roots` on each backend (decision 4) came from the same command
on the GLSL and on the WGSL of this change, with and without the change of `roots`, twice each in
turns (`VITE_WARM=1000`). The lines of these runs are at the head of the record below.

The old passes against the new ones in one page, on one state, in turns of one sample each (8
minutes): the load of other sessions then falls on both alike. `VITE_OLD` is a folder with the
`tubes.wgsl` and the `tubes.frag` of the old checkout; the code around them is this checkout's. A
line has the medians of both (`old`, `new`, ms per picture) and the values of the picture, the
factors and the stream that differ between them (`differ`):

```bash
mkdir -p research/flow/out/old && git show 1cd1c56:src/engine/shaders/tubes.wgsl > research/flow/out/old/tubes.wgsl && git show 1cd1c56:src/engine/gl/glsl/tubes.frag > research/flow/out/old/tubes.frag
```

```bash
VITE_OLD=research/flow/out/old VITE_NAME=ab npx vitest run --config research/vitest.config.ts research/flow/engine/picture-ab.gpu.test.ts
```

With `VITE_FRAME=1` it times a whole frame in place of the passes alone: one step and one drawn
picture with the picture of the tubes on, as `picture.gpu.test.ts` does (12 minutes).

The map of WebGL2 in two passes (decision 3) came from this command with `VITE_KINDS=webgl2` on four
builds of this change: the map in one pass of 14 × 14 reads per tile or in two passes, each with the
`roots` of `1cd1c56` and with the new one. Its lines are in the record too.

A whole frame on the same canvas, as the check of ADR 0028 of 2026-11-14 measured it (8 minutes):

```bash
VITE_SIZE=2560,1600 VITE_WARM=1500 VITE_BATCHES=11 VITE_SCENES=three-strains,tokyo VITE_NAME=frame npx vitest run --config research/vitest.config.ts research/flow/engine/picture.gpu.test.ts
```

Other sessions used the GPU at the same time, so the old build and the new build ran in turns: the
checkout of `main` before the change (`1cd1c56`, in a worktree of its own, with
`picture-passes.gpu.test.ts` copied into it) and then this one, four rounds of the passes alone and
four of a frame. The first round of the old build ran with `VITE_DUMP=1`, the first of the new
build with `VITE_AGAINST`. The WebGPU rounds of the passes ran with `97a7078`, whose WGSL is that
of this change; the WebGL2 rounds ran again after the map of WebGL2 went to two passes (`18c28e6`).
The record is `logs/view/cost-2026-11-15.txt`: each run with its start, its end and the load of the
machine (`uptime`), then its lines.

The tests of the picture: you must see 19 tests pass, and 64 with 4 skipped. The test of the switch
in the built app is one of the tests of `tests/e2e/tubes.spec.ts` (part 7).

```bash
npx vitest run --project unit src/engine/tubes.test.ts
```

```bash
npx vitest run --project gpu src/engine/tubes.gpu.test.ts
```

The tests of a measurement of the levels, of a picture and of a PNG, while a restart or a rebuild
starts a new run: you must see 6 tests pass, and then 8.

```bash
npx vitest run --project unit src/engine/engine.test.ts -t "a measurement of the levels while"
```

```bash
npx vitest run --project gpu src/engine/engine.gpu.test.ts -t "a PNG while"
```

The 93 wrong rules of the picture (10 minutes): every block must name at least one test that fails,
marked `×`, and no block may say `NO TEST FAILS`. The script changes files below `src/` while it
runs, and it writes each one back as it was: do not change those files while it runs. The record
is `logs/view/mutations.txt`.

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts $(seq -f "V%g" 1 93)
```

Result: the picture draws a tube with a large flow memory thick, and a tube with a small one thin
and faint, on both backends as the rule on the CPU says. A new tube is thick until its flow memory
follows its flux. No result of a simulation changes.

### 11. Is a food site one stroke? [ADR 0029, amendment 2026-11-14 (2)]

The sites of the scenes, and the time that the engine spends on the sites after a paint, on the
CPU (10 s):

```bash
node --import ./research/flow/register.mjs research/flow/sites.ts
```

You must see 2 sites of 106 cells each for the Maze and 42 sites of 59 to 65 cells for the Tokyo
scene; `entries` counts the list with the ends of its blocks. The last three lines are a drag across the default grid of 1,536 × 960 cells with a brush
of 6, 30 and 90 cells: `msPerSegment` is the time of one call while the drag goes on,
`msNothingNew` that of a call after a paint of another kind, and `msNewGrid` that of a call on a
new grid. The times are those of the machine; the record is `logs/engine/sites-cpu.jsonl`.

The tests of the rule (2 s and 1 minute):

```bash
npx vitest run --project unit src/engine/sites.test.ts src/engine/engine-env.test.ts
```

```bash
npx vitest run --project gpu src/engine/flow.gpu.test.ts
```

The time of the passes of the ports for a large food stroke (5 minutes): the default grid of
1,536 × 960 cells, a tube between two small dabs, and a third dab of about 10,000, 100,000 and
250,000 cells that no tube covers, or covers at its centre. The record is
`logs/engine/sites-bench.jsonl`; every line must have about the time of the line without the
large dab (`"cells":0`).

```bash
VITE_NAME=sites-bench npx vitest run --config research/vitest.config.ts research/flow/engine/sites-bench.gpu.test.ts
```

The time of a step of the Maze and of the Tokyo scene is the command of table (c) in part 6; the
records of this part are `logs/engine/bench-sites-1.jsonl` and `bench-sites-2.jsonl`, and the
same two runs with `main` on the same evening `logs/engine/bench-main-1.jsonl` and
`bench-main-2.jsonl`.

The bytes with the flow off: the two commands of part 6 with the digests of `main` made on the
same machine (`logs/engine/digest-main-flow-off.jsonl`). They must print that all 42 runs are
equal. With the flow as each scene has it (`logs/engine/digest-sites.jsonl` against
`digest-main.jsonl`), the four scenes with the flow on differ on both backends: Tokyo, Food ring,
Rival networks and Tokyo, two networks. The Maze is still equal at step 500.

```bash
VITE_NAME=digest-flow-off VITE_PATCH='{"flow":false}' npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/digest-flow-off.jsonl research/flow/logs/engine/digest-main-flow-off.jsonl
```

The campaigns of part 6 again: the Maze with 10 seeds on WebGPU and 3 on WebGL2, the Tokyo scene
with 10 seeds on WebGPU and 3 on WebGL2. The names start with `g17-`. Two WebGPU runs can run at
a time; run the WebGL2 runs when no other run uses the GPU, as they are about eight times as slow
beside a Tokyo run. A Maze run takes about 1 minute, a Tokyo run 4 to 6 minutes on WebGPU.

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_KIND=webgpu VITE_SCENE=maze VITE_FLOW=1 VITE_I0=8 VITE_SEED=$seed VITE_STEPS=500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000 VITE_NAME=g17-mz-webgpu-i8-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-maze.ts g17-mz-webgpu-i8-s$seed >> research/flow/out/maze-webgpu-flux8-sites.txt; done
```

```bash
for seed in 1 2 3; do VITE_KIND=webgl2 VITE_SCENE=maze VITE_FLOW=1 VITE_I0=8 VITE_SEED=$seed VITE_STEPS=500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000 VITE_NAME=g17-mz-webgl2-i8-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-maze.ts g17-mz-webgl2-i8-s$seed >> research/flow/out/maze-webgl2-flux8-sites.txt; done
```

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=$seed VITE_STEPS=1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_NAME=g17-tk-i1.4-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g17-tk-i1.4-s$seed 1.5 99999 >> research/flow/out/tokyo-flux1.4-sites.txt; done
```

```bash
for seed in 1 2 3; do VITE_KIND=webgl2 VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=$seed VITE_STEPS=2000,4000,8000,12000,16000,24000 VITE_NAME=g17-tkgl-i1.4-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g17-tkgl-i1.4-s$seed 1.5 99999 >> research/flow/out/tokyo-webgl2-flux1.4-sites.txt; done
```

The tables of the amendment, the new runs beside the record (each command a second):

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-maze research/flow/logs/engine/maze-webgpu-flux8.txt research/flow/logs/engine/maze-webgpu-flux8-sites.txt research/flow/logs/engine/maze-webgl2-flux8.txt research/flow/logs/engine/maze-webgl2-flux8-sites.txt
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo research/flow/logs/engine/tokyo-flux1.4.txt research/flow/logs/engine/tokyo-flux1.4-sites.txt research/flow/logs/engine/tokyo-webgl2-flux1.4.txt research/flow/logs/engine/tokyo-webgl2-flux1.4-sites.txt
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo-end research/flow/logs/engine/tokyo-flux1.4.txt research/flow/logs/engine/tokyo-flux1.4-sites.txt
```

The scenes of ADR 0032 with the sites of the amendment (3 minutes): the commands of part 9 with
the names `sites-scenes-food-ring`, `sites-scenes-rival-networks` and
`sites-scenes-tokyo-rivals`; the records are `logs/engine/sites-scenes-*.jsonl`.

The wrong rules of the flow, with the 42 new ones of the food sites. The script changes files below
`src/` while it runs: start no other run and change no file while it runs. The records are
`logs/engine/sites-mutations.txt`, a run of the 41 rules of the flow and the first 30 of the sites
with the first build, in which two rules were not caught until a test came for them, and
`logs/engine/sites-mutations-blocks.txt`, the 38 rules of the food sites and of the passes of the
ports with the passes in blocks and every test of this part (25 minutes), and
`logs/engine/sites-mutations-review.txt`, the rules of the tests that a review asked for (10
minutes):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts W5 W9 F5 F9 P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11 P12 S4 Q1 Q2 Q3 Q4 Q5 Q6 Q7 Q8 Q9 Q10 Q11 Q12 L4 C1 C2 C3 C4 C5 C6 E1 E2
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts C1 C2 C3 C4 C5 C6 C7 C8 P13 P14 R1 Q13 Q14 Q15
```

Every block must name a test that fails, marked `×`, and no block may say `NO TEST FAILS`.
`mutate.ts check` checks in a second that the text of every wrong rule still fits its file.

Result: a dragged line of food is one site, and a strain covers a site from any of its cells.
In the Maze the dead ends empty and one tube remains as before, within the spread of the seeds.
On the Tokyo map the network keeps the measures of the organism, a little longer at step 48,000,
and all 36 food sources are joined in 78 of 80 samples. The passes of the ports cost less than
the noise of the bench, also for a food of 250,000 cells that no tube covers.

### 12. Which radius for the momentum? [ADR 0029, amendment 2026-11-15]

The radius on fixed networks. The Maze network of part 3 with the rule of the app, for seven radii
(3 minutes):

```bash
node --import ./research/flow/register.mjs research/flow/solvers.ts radii=0.9999,0.999993,0.999995,0.999997,0.999998,0.999999 plain=1
```

You must see the error at step 1,000 fall from 6.7 % (0.99999, the app) to 4.1, 2.4, 0.8, 0.3 and
0.0 %, and 37.2 % for 0.9999. The record is `logs/engine/radius/solvers.txt`.

The real engine takes another radius from `VITE_RADIUS`, in `engine/dump.gpu.test.ts`; each line of
the log of a dump names it. Names: `r5` is 0.99999 and `r6` is 0.999999; the other runs name their
radius in full. The dumps of seed 1 with the pressure, for the flux 1.4 and 2 (1 minute each):

```bash
for i0 in 1.4 2; do for t in 5:0.99999 6:0.999999; do VITE_SCENE=tokyo VITE_I0=$i0 VITE_SEED=1 VITE_RADIUS=${t#*:} VITE_STEPS=250,500,1000,2000,4000,8000,12000 VITE_DUMP_P=1 VITE_NAME=g18-tk-i$i0-r${t%%:*}-p-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done; done
```

```bash
for i0 in 1.4 2; do for r in 0.999993 0.999995 0.999997 0.999998; do VITE_SCENE=tokyo VITE_I0=$i0 VITE_SEED=1 VITE_RADIUS=$r VITE_STEPS=250,500,1000,2000,4000,8000 VITE_DUMP_P=1 VITE_NAME=g18-tk-i$i0-r$r-p-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done; done
```

The growth of the Tokyo scene with seeds 2 to 5 (30 s each):

```bash
for seed in 2 3 4 5; do for r in 0.99999 0.999993 0.999995 0.999997 0.999999; do VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=$seed VITE_RADIUS=$r VITE_STEPS=250,500,1000,2000 VITE_DUMP_P=1 VITE_NAME=g18-tk-i1.4-r$r-g-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done; done
```

The local flux against the exact one on each dump (2 to 4 minutes each; four can run at once).
`exact-flux.ts` now also prints the range of the pressure on the tubes and the count of the tube
cells with a flow memory above 0.5. For a dump of seed 1:

```bash
LANES=0,1,2,3 node --import ./research/flow/register.mjs research/flow/engine/exact-flux.ts g18-tk-i1.4-r5-p-s1 512 512 1.4 250 500 1000 2000 4000 8000 12000 >> research/flow/out/radius-exact-flux.txt
```

and the same for every other dump, with its flux and its steps. The table of all dumps:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts exact-flux research/flow/logs/engine/radius/exact-flux.txt
```

It prints one block per flux and radius, and one line per step: the median over the seeds of the
median over the four fields, with the least and the most of the seeds. You must see, for
`g18-tk-i1.4-r0.99999` at step 250, `tube cells with a flow memory above 0.5 0.0 % (0.0 to 0.1)`,
and for `g18-tk-i1.4-r0.999999` at step 500 `46.7 % (39.5 to 50.6)`.

The iteration on the fixed network of the dump of step 8,000, from a pressure of 0 and after a new
draw of the roles, for four radii (40 minutes; the record is `logs/engine/radius/tokyo-8000.txt`):

```bash
RADII=0.99999,0.999993,0.999995,0.999999 node --import ./research/flow/register.mjs research/flow/engine/radius.ts g18-tk-i1.4-r5-p-s1 8000 1.4 1
```

The tests of the bounded pressure (decision 6) with each radius, on the CPU copy of the passes (2
minutes each; the record is `logs/engine/radius/bounded.txt`):

```bash
for r in 0.99999 0.999993 0.999995 0.999997 0.999998 0.999999; do node --import ./research/flow/register.mjs research/flow/bounded.ts scene=grow radius=$r; done
```

```bash
node --import ./research/flow/register.mjs research/flow/bounded.ts scene=mesh radii=0.99999,0.999993,0.999995,0.999997,0.999998,0.999999
```

`scene=mesh` is the growing mesh of the unit test in `src/engine/flow.test.ts`, to step 600. The GPU
tests with another radius: write it into `FLOW.radius` in `src/engine/flow.ts`, run
`npx vitest run --project gpu src/engine/flow.gpu.test.ts`, and put the file back. The wrong rules
M1 to M4 of `mutate.ts` do this for 0.999999, 0.999998 and 0.999997:

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts M1 M2 M3 M4
```

You must see a test that fails for each of them: the unit test of the mesh for M1 and M2, and the GPU
test of the pressure limit for M3 and M4. The record is `logs/engine/radius/mutations.txt`.

The campaigns of part 6 with the radius in the name. The Maze, 10 seeds, both radii (about 1 minute
each):

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do for t in 5:0.99999 6:0.999999; do VITE_KIND=webgpu VITE_SCENE=maze VITE_FLOW=1 VITE_I0=8 VITE_SEED=$seed VITE_RADIUS=${t#*:} VITE_STEPS=500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000 VITE_NAME=g18-mz-webgpu-i8-r${t%%:*}-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-maze.ts g18-mz-webgpu-i8-r${t%%:*}-s$seed >> research/flow/out/maze-webgpu-flux8-r${t%%:*}.txt; done; done
```

The Tokyo scene, 10 seeds: the radius of the app with the fluxes 1 and 2, and 0.999999 with the
flux 1.4 (4 to 6 minutes each; two can run at a time):

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do for i0 in 1 2; do VITE_SCENE=tokyo VITE_I0=$i0 VITE_SEED=$seed VITE_RADIUS=0.99999 VITE_STEPS=1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_NAME=g18-tk-i$i0-r5-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g18-tk-i$i0-r5-s$seed 1.5 99999 >> research/flow/out/tokyo-flux$i0-r5.txt; done; done
```

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=$seed VITE_RADIUS=0.999999 VITE_STEPS=1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_NAME=g18-tk-i1.4-r6-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g18-tk-i1.4-r6-s$seed 1.5 99999 >> research/flow/out/tokyo-flux1.4-r6.txt; done
```

The runs with 0.99999 and the flux 1.4 are those of part 11 (`logs/engine/tokyo-flux1.4-sites.txt`):
`main` gives their lines again, seed 1 to step 48,000 is
`logs/engine/radius/tokyo-flux1.4-r5-s1.txt`. The tables:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-maze research/flow/logs/engine/radius/maze-webgpu-flux8-r5.txt research/flow/logs/engine/radius/maze-webgpu-flux8-r6.txt
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo-end research/flow/logs/engine/radius/tokyo-flux1-r5.txt research/flow/logs/engine/tokyo-flux1.4-sites.txt research/flow/logs/engine/radius/tokyo-flux2-r5.txt research/flow/logs/engine/radius/tokyo-flux1.4-r6.txt
```

On WebGL2, with no WebGPU run on the GPU: the GPU tests as above, and the growth of seed 1 with both
radii (2 minutes each), then `exact-flux.ts` on both dumps as above:

```bash
for t in 5:0.99999 6:0.999999; do VITE_KIND=webgl2 VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=1 VITE_RADIUS=${t#*:} VITE_STEPS=250,500,1000,2000 VITE_DUMP_P=1 VITE_NAME=g18-tkgl-i1.4-r${t%%:*}-g-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done
```

The record of the GPU tests with each radius is `logs/engine/radius/gpu-tests.txt`; the lines of
`exact-flux.ts` on the WebGL2 dumps are in `logs/engine/radius/exact-flux.txt`, under the names
`g18-tkgl-…`.

Result: a larger radius settles a network that holds still sooner, and lets the errors of a growing
colony swing longer. Every radius above 0.99999 gives the growing Tokyo colony tube cells with a
flow memory at which dead agents come to life, where 0.99999 gives almost none, and 0.999999 lets
the pressure run far off and fails two tests of decision 6. The Maze does not get its result sooner
with 0.999999. So the app keeps 0.99999. The Tokyo scene keeps its flux of 1.4: with the sites of
decision 17 the flux 1 is a little shorter and nearer to the organism, within the spread of two sets
of seeds, and it loses a food source more often.

### 13. How long does starved ground stay closed? [ADR 0029, amendment 2026-11-15 (2)]

A run with another time sets the share by which the flow memory of ground without a tube grows per
step, `VITE_RECOVER` (`FLOW.recover`; 0.00023 in the app then, 0.00002875 since ADR 0054): 0.00023, 0.00035, 0.0007, 0.0014 and
0.0042 take 18.4, 12.1, 6.0, 3.0 and 1.0 h of model time from the floor to fresh ground. With
`VITE_GROUND=1` a run also writes the flow memory of every cell, which `engine/strands.ts` reads.
The logs of the record are in `logs/engine/recover/`; their names say the time, `r18` for 18 h.

The Tokyo scene with each time and the Maze with each time but 12 h, ten seeds each, to step 48,000.
With three to five runs on the GPU at a time a Tokyo run took 7 to 10 minutes and a Maze run 4 to 6;
the dumps of a run take about 56 and 42 MB:

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do for t in 18:0.00023 12:0.00035 6:0.0007 3:0.0014 1:0.0042; do VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=$seed VITE_RECOVER=${t#*:} VITE_GROUND=1 VITE_STEPS=1000,2000,4000,8000,12000,16000,20000,24000,28000,32000,36000,40000,44000,48000 VITE_NAME=g19-tk-r${t%%:*}-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g19-tk-r${t%%:*}-s$seed 1.5 99999 >> research/flow/out/recover-tokyo.txt && node --import ./research/flow/register.mjs research/flow/engine/strands.ts g19-tk-r${t%%:*}-s$seed tokyo >> research/flow/out/recover-tokyo-strands.jsonl; done; done
```

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do for t in 18:0.00023 6:0.0007 3:0.0014 1:0.0042; do VITE_SCENE=maze VITE_I0=8 VITE_SEED=$seed VITE_RECOVER=${t#*:} VITE_GROUND=1 VITE_STEPS=500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,24000,32000,40000,48000 VITE_NAME=g19-mz-r${t%%:*}-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-maze.ts g19-mz-r${t%%:*}-s$seed >> research/flow/out/recover-maze.txt && node --import ./research/flow/register.mjs research/flow/engine/strands.ts g19-mz-r${t%%:*}-s$seed maze >> research/flow/out/recover-maze-strands.jsonl; done; done
```

The tables of the amendment (each command a second):

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo-end research/flow/logs/engine/recover/tokyo.txt
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-maze research/flow/logs/engine/recover/maze.txt
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts strands research/flow/logs/engine/recover/tokyo-strands.jsonl research/flow/logs/engine/recover/maze-strands.jsonl
```

`engine-tokyo-end` prints per time TL, MD and FT at step 48,000 and the mean over the samples from
step 16,000 on; `engine-tokyo` (same file) prints every step. `strands` prints per time and step the
cells of the land with a tube, of them those whose flow memory is below 0.01 (`faint`), the ground
without a tube below 0.01 (`closed`: no agent divides there) and below 0.2 (`marked`), and for the
Maze the dead ends over the route and whether they fill again from step 5,000 on.

The regrowth (part of the amendment): seeds 1 to 3 with each time, the network taken off a disc
around four cities at step 24,000 (`VITE_REMOVE`), and the foods of the same four cities erased at
step 24,000 and painted again at step 27,000 (`VITE_EDITS`). One run holds the Cut tool over the
same disc for 100 steps (`VITE_CUT`). `REMOVE`, `EDITS` and `CUT` are the JSON of the record:

```bash
REMOVE='[-0.229790625,-0.22624425,0.085,24000]'
EDITS='[[24000,"erase",-0.2743495,-0.234109,0.0107],[24000,"erase",-0.292781,-0.211335,0.0107],[24000,"erase",-0.1948335,-0.2446275,0.0107],[24000,"erase",-0.1571985,-0.2149055,0.0107],[27000,"food",-0.2743495,-0.234109,0.008685],[27000,"food",-0.292781,-0.211335,0.008685],[27000,"food",-0.1948335,-0.2446275,0.008685],[27000,"food",-0.1571985,-0.2149055,0.008685]]'
CUT='[-0.229790625,-0.22624425,0.085,24000,24100]'
```

```bash
for seed in 1 2 3; do for t in 18:0.00023 6:0.0007 3:0.0014 1:0.0042; do VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=$seed VITE_RECOVER=${t#*:} VITE_GROUND=1 VITE_REMOVE=$REMOVE VITE_STEPS=16000,24000,24001,24050,24100,24200,24400,24700,25000,26000,27000,28000,30000,32000,36000,40000,44000,48000 VITE_NAME=g19-remove-r${t%%:*}-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g19-remove-r${t%%:*}-s$seed 1.5 99999 >> research/flow/out/recover-remove.txt && node --import ./research/flow/register.mjs research/flow/engine/strands.ts g19-remove-r${t%%:*}-s$seed tokyo 138.3472,140.1629,43.52 >> research/flow/out/recover-remove-strands.jsonl; done; done
```

```bash
for seed in 1 2 3; do for t in 18:0.00023 6:0.0007 3:0.0014 1:0.0042; do VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=$seed VITE_RECOVER=${t#*:} VITE_GROUND=1 VITE_EDITS=$EDITS VITE_STEPS=16000,24000,25000,26000,27000,27300,27600,28000,29000,30000,32000,36000,40000,44000,48000 VITE_NAME=g19-starve-r${t%%:*}-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g19-starve-r${t%%:*}-s$seed 1.5 99999 >> research/flow/out/recover-starve.txt && node --import ./research/flow/register.mjs research/flow/engine/strands.ts g19-starve-r${t%%:*}-s$seed tokyo 138.3472,140.1629,43.52 >> research/flow/out/recover-starve-strands.jsonl; done; done
```

```bash
VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=1 VITE_GROUND=1 VITE_CUT=$CUT VITE_STEPS=16000,24000,24100,24300,24600,25000,26000,27000,28000,30000,32000,36000,40000,44000,48000 VITE_NAME=g19-cut-r18-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g19-cut-r18-s1 1.5 99999 >> research/flow/out/recover-cut.txt
```

The same run with the code of ADR 0039, in which the cut kills the agents of its wound while growth
runs (without `VITE_GROUND`; the record is `logs/engine/cut-growth/tokyo-cut.txt` and its log
`tokyo-cut.jsonl`, both 2026-11-15 on WebGPU):

```bash
VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=1 VITE_CUT=$CUT VITE_STEPS=16000,24000,24100,24300,24600,25000,26000,27000,28000,30000,32000,36000,40000,44000,48000 VITE_NAME=g39-cut-r18-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g39-cut-r18-s1 1.5 99999
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts regrowth research/flow/logs/engine/recover/remove.txt research/flow/logs/engine/recover/remove-strands.jsonl 24001
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts regrowth research/flow/logs/engine/recover/starve.txt research/flow/logs/engine/recover/starve-strands.jsonl 27000
```

`regrowth` prints per time the first measured step from the step of its last argument on at which
all 33 and all 36 food sources are joined: from step 24,001 for the network taken off, and from step
27,000, when the foods are painted again, for the foods taken away. Then per step the cells of the
network and of the tubes in the disc over those of step 24,000.

The test of the rule, on both backends (10 s), and its wrong rules (D1 to D6, 10 minutes; the record
is `logs/engine/recover/mutations.txt`; `mutations-before.txt` is the same run with the new test
skipped, in which D1, D2, D4 and D5 pass every test):

```bash
npx vitest run --project gpu src/engine/flow.gpu.test.ts -t "starved ground"
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts D1 D2 D3 D4 D5 D6
```

You must see, in `engine-tokyo-end`, `TL 1.84 ± 0.13` from step 16,000 on with `g19-tk-r18`, `1.95`
with `r12`, `2.29` with `r6`, `2.45` with `r3` and `2.55` with `r1`; in `engine-maze` the dead ends
below 2 % of the route first at step `2250 (2000 to 4000)` with `g19-mz-r18` and `6250 (4000 to
10000)` with `r1`; and in `regrowth` the four cities joined again from step `24400 (24200 to 24400)`
with `g19-remove-r18` and from `27600 (27300 to 28000)` with `g19-starve-r18`. The runs with 18 h
give the lines of the record of part 11 (`logs/engine/maze-webgpu-flux8-sites.txt` and
`tokyo-flux1.4-sites.txt`) at its steps.

Result: every time shorter than 18 h brings back the mesh between the tubes of the Tokyo map, and 1
h also the dead ends of the Maze. With 18 h the colony grows back into a region that it lost within
half an hour of model time. The app keeps its factor.

### 14. Does light on the mountains change the network? [ADR 0042]

The scene Tokyo with light (`tokyo-light`) on WebGPU, seeds 1 to 10, to step 48,000. A run alone on
the GPU took under 3 minutes. `LIT=tokyo-light` lets `measure-tokyo.ts` add the share of the
network on lit ground to each line (`lit`: light byte above 0; `bright`: 128 or more):

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_SCENE=tokyo-light VITE_SEED=$seed VITE_STEPS=1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_NAME=g42-tl-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && LIT=tokyo-light node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g42-tl-s$seed 1.5 99999 >> research/flow/out/tokyo-light.txt; done
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo-end research/flow/out/tokyo-light.txt
```

The other runs use the same two commands with these changes; the records are in
`logs/engine/light/`:

| Record                         | Runs                                                             | Change of the command                                              |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `tokyo-light.txt`              | the scene, seeds 1 to 10                                         | none                                                               |
| `tokyo-dark.txt`               | the scene without light, seeds 1 to 3: where the light would be  | `VITE_SCENE=tokyo`, the name `g42-tk`                              |
| `tokyo-light-strength<s>.txt`  | Light strength 0.02, 0.2 and 0.5, seeds 1 and 2                  | `VITE_PATCH='{"lightStrength":0.5}'`, the name `g42-tl-L0.5`       |
| `tokyo-light-dabs.txt`         | one disc per lit cell (`engine/light-dabs.ts`), seeds 1 and 2    | `VITE_SHAPES=dabs`, `LIT=dabs`, the name `g42-td`                  |
| `tokyo-light-webgl2.txt`       | the scene on WebGL2, seeds 1 to 3, to step 24,000                | `VITE_KIND=webgl2`, the steps 2,000 to 24,000, the name `g42-tlgl` |
| `check-merged.txt`             | seed 1 again on both backends after the last merge of `main`     | the steps to 4,000                                                 |
| `digest-branch.jsonl`, `-main` | the digests of every scene after 500 steps, branch and `main`    | part 6, with `VITE_FLOW=1`                                         |
| `srtm-centres.json`            | the SRTM 90 m samples at the centres of the 400 cells of the map | column, row, metres (Open Topo Data, read 2026-11-15)              |

From step 16,000 on (the 50 samples of steps 16,000 to 48,000; for 2 or 3 seeds, 10 or 15):

| Runs                             | TL          | MD   | FT   | Links | Agents | On lit ground       |
| -------------------------------- | ----------- | ---- | ---- | ----- | ------ | ------------------- |
| With light, 0.05 (10 seeds)      | 1.77 ± 0.13 | 0.83 | 0.88 | 54.2  | 4,077  | 4.6 % (1.3 to 8.7)  |
| Without light (ADR 0029)         | 1.84 ± 0.13 | 0.83 | 0.91 | 53.9  | 4,010  |                     |
| Without light, seeds 1 to 3      | 1.81 ± 0.13 | 0.83 | 0.90 | 51.8  | 3,981  | 9.1 % (6.2 to 16.2) |
| Light strength 0.02              | 1.81 ± 0.15 | 0.83 | 0.90 | 52.0  | 4,056  | 4.5 % (2.0 to 7.6)  |
| Light strength 0.2               | 1.79 ± 0.16 | 0.83 | 0.87 | 53.9  | 4,156  | 3.8 % (2.4 to 8.4)  |
| Light strength 0.5               | 1.87 ± 0.15 | 0.83 | 0.91 | 55.8  | 4,276  | 5.1 % (2.5 to 12.1) |
| One disc per cell                | 1.66 ± 0.13 | 0.85 | 0.86 | 54.3  | 3,867  | 3.3 % (2.6 to 5.3)  |
| WebGL2 (steps 16,000 and 24,000) | 1.76 ± 0.11 | 0.82 | 0.89 | 52.0  | 4,129  | 4.5 % (3.4 to 6.4)  |

The share of the runs with one disc per cell counts the cells that the discs light, 24.0 % of the
land; the scene lights 23.9 %. The runs of the scene without light of seeds 1 and 2, and those
with the strengths 0.02 and 0.2, ran on 2026-11-15 before `main` was merged (their dumps were named
`g20-`). They hold for the merged code: the scene without light gives the lines of the record of
part 11 (`g17-tk-i1.4-s1`, equal in every number), and seeds 1 and 2 of the scene with light gave
the same lines before and after the merge.

### 15. Does the colony keep off the light when light stops growth? [ADR 0050]

The scene Tokyo with light with the setting Light stops growth (`lightGrowth`) at 1, 0.98, 0.9 and
0.5, on WebGPU to step 48,000, on the first map of the scene with 53 lit cells. The default is 1 now; a run of the time before the rule is the
record of part 14. For G = 1 (10 seeds), and with seeds 1 to 3 for the three other values:

```bash
G=1; for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_SCENE=tokyo-light VITE_PATCH="{\"lightGrowth\":$G}" VITE_SEED=$seed VITE_STEPS=1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_NAME=g50-tl-G$G-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && LIT=tokyo-light node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g50-tl-G$G-s$seed 1.5 99999 >> research/flow/out/tokyo-light-growth$G.txt; done
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo-end research/flow/out/tokyo-light-growth1.txt
```

| G    | Seeds | On lit ground, step 2,000 | On lit ground, from 16,000 | All 36 foods joined, from 4,000 |
| ---- | ----- | ------------------------- | -------------------------- | ------------------------------- |
| 0    | 10    | 15.9 % (13 to 18)         | 4.6 % (1.3 to 8.7)         | 73 of 80 samples                |
| 0.5  | 3     | 13.0 % (12.6 to 13.6)     | 3.4 % (1.3 to 8.7)         | 12 of 24                        |
| 0.9  | 3     | 7.4 % (5.3 to 8.8)        | 1.9 % (1.2 to 4.7)         | 2 of 24                         |
| 0.98 | 3     | 5.5 % (4.8 to 6.2)        | 1.6 % (1.0 to 2.8)         | 2 of 24                         |
| 1    | 10    | 3.3 % (2.7 to 4.4)        | 1.3 % (0.9 to 1.9)         | 8 of 80                         |

With G = 1 from step 16,000 on (50 samples): TL 1.73 ± 0.10, MD 0.83, FT 0.86, 53.2 links, 3,908
agents. The food that stayed unjoined on that map was Ito. So the cells [0, 16] and [0, 17] of the
grid of elevations are dark now (51 lit cells). This command prints the parts of the dark land and
the foods that do not lie in the largest part (1 second):

```bash
node --import ./research/flow/register.mjs research/flow/engine/light-islands.ts
```

It must print `1 dark parts of the land, cells: 54496` and no food. On the first map it printed two
parts, of 53,458 and 480 cells, with Ito in the small one. On the map of 51 cells only seed 1 ran
(the command above with the name `g50b-tl-G1-s1`): all 36 foods joined in 8 of the 9 samples from
step 2,000 on, and 0.8 to 1.4 % of the network on lit ground from step 4,000 on. Ten seeds, WebGL2
and the digests with the default 1 are open (`TODO.md`). The records are in `logs/engine/light-growth/`:

| Record                           | Runs                                                          |
| -------------------------------- | ------------------------------------------------------------- |
| `tokyo-light-growth<G>.txt`      | the lines of `measure-tokyo.ts` for each G                    |
| `tokyo-light-growth1-webgl2.txt` | the scene on WebGL2, seeds 1 and 2, to step 16,000            |
| `digest-branch.jsonl`, `-main`   | the digests of every scene after 500 steps, branch and `main` |
| `mutations.txt`                  | the wrong rules LG1 to LG11 and the tests that fail with them |

### 16. Do the mazes with growth keep one tube on the shortest route? [ADR 0051]

The layout of the Corn maze, as text, with its routes and the list of walls that the scene holds
(`CORN_MAZE` in `src/model/presets.ts`); without a seed the script takes the first seed that fits:

```bash
node --import ./research/flow/register.mjs research/flow/engine/corn-maze.ts
```

The scenes Snail maze (`snail-maze`) and Corn maze (`corn-maze`) on WebGPU, seeds 1 to 10, to step
30,000 with a dump every 500 steps. A run alone on the GPU took 45 to 50 s, and the dumps of all
runs take 2.5 GB:

```bash
STEPS=$(seq -s, 500 500 30000 | sed 's/,$//'); for scene in snail-maze corn-maze; do for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_SCENE=$scene VITE_SEED=$seed VITE_STEPS=$STEPS VITE_NAME=$scene-webgpu-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done; done
```

```bash
for scene in snail-maze corn-maze; do node --import ./research/flow/register.mjs research/flow/engine/measure-mazes.ts $scene $(for seed in 1 2 3 4 5 6 7 8 9 10; do echo $scene-webgpu-s$seed; done) > research/flow/out/engine/$scene-webgpu.txt; done
```

`measure-mazes.ts` prints one line per dump and one line per run, which starts with the name of
the run and `run:`; its head says what each number is. The line of a run holds means over the
dumps of its last 10,000 steps. You must see in every line of a run of the Snail maze `joined in
the tail 1.00` and `tube 1.00` or `1.01`, and in every line of a run of the Corn maze `flow on
each route 1.00,0.00,0.00,0.00,0.00,0.00`. Called with a scene and no run, the script writes a
picture of the maze with its route and its dead ends (`out/engine/<scene>-zones.png`).

The same on WebGL2 for seeds 1 and 2 (`VITE_KIND=webgl2`, names `<scene>-webgl2-s<seed>`), and
with the flow strengths 2 and 4 for seed 1 (`VITE_I0=2`, names `<scene>-webgpu-i2-s1`). The record
is `logs/engine/mazes/`: `<scene>-webgpu.txt`, `<scene>-webgl2.txt` and `<scene>-strength.txt`.

Result: the tube follows the shortest route in both mazes, and the flow runs on that route alone.
The dead ends thin out but do not empty, because growth goes on (ADR 0051 has the tables).

### 17. Does the colony stay out of the dead ends when no child is born onto starved ground? [ADR 0053]

The records of this part are those of the app at the commit `02c3772`. Since ADR 0054 the mark of
starved ground is another one (part 18), so the commands of this part give these records only in a
checkout of that commit.

**Where children are born.** The Snail maze, stepped one step at a time for 300 steps from the steps
12,000, 20,000 and 28,000. Each child counts by the flow memory of its cell: starved (below 0.01),
open (0.01 to 0.5) or fed (above 0.5). A run takes 1 minute.

```bash
for seed in 1 2 3; do VITE_SCENE=snail-maze VITE_SEED=$seed VITE_AT=12000,20000,28000 VITE_NAME=g53-births-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/births.gpu.test.ts; done
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/births.ts snail-maze g53-births-s1 g53-births-s2 g53-births-s3
```

`births.ts` prints one line per window, with a part for all cells, one for the corridor of the route
and one for the dead ends; its head says what each number is. With the rule you must see
`born starved 0` in every part. `opens` is the time until the closed ground of the part is open for
births again, as three quartiles in steps.

The same with the rule of before, where only the cell of the parent decides. `variant.ts` puts
another rule into the WGSL passes of the app, runs the command, and puts the files back:

```bash
for seed in 1 2 3; do VITE_SCENE=snail-maze VITE_SEED=$seed VITE_AT=12000,20000,28000 VITE_NAME=g53-births-parent-s$seed node --import ./research/flow/register.mjs research/flow/engine/variant.ts parent npx vitest run --config research/vitest.config.ts research/flow/engine/births.gpu.test.ts; done
```

**The two mazes with the rule.** The commands of part 16, with the names `g53-<scene>-webgpu-s<seed>`
(seeds 1 to 10) and `g53-<scene>-webgl2-s<seed>` (seeds 1 and 2, `VITE_KIND=webgl2`). The lines of
`measure-mazes.ts` are the records `snail-maze-webgpu.txt`, `corn-maze-webgpu.txt` and the two of
WebGL2.

**Other rules.** `variant.ts` had seven of them when this part ran, at the commit `02c3772`; its
head there says what each one is. Since ADR 0054 the variant `floor` is the rule of the app (part
18), so run the commands of this paragraph in a checkout of that commit. The Snail maze with each,
seeds 1 to 3, with the dumps of the last 10,000 steps only (15 minutes in all). The line of a run
is then the line of a full run but for `joined at`:

```bash
STEPS=$(seq -s, 20500 500 30000 | sed 's/,$//'); for v in parent child left weight floor left+floor parent+floor; do for seed in 1 2 3; do VITE_SCENE=snail-maze VITE_SEED=$seed VITE_STEPS=$STEPS VITE_NAME=g53-snail-maze-$v-s$seed node --import ./research/flow/register.mjs research/flow/engine/variant.ts $v npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done; done
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/measure-mazes.ts snail-maze $(for v in parent child left weight floor left+floor parent+floor; do for seed in 1 2 3; do echo g53-snail-maze-$v-s$seed; done; done) | grep ' run:'
```

The three lines of `parent` must equal the lines of the seeds 1 to 3 of the record of part 16
(`logs/engine/mazes/snail-maze-webgpu.txt`) from `tube` on. This command checks that every text
that a variant replaces is still in its file:

```bash
node --import ./research/flow/register.mjs research/flow/engine/variant.ts check
```

**The Tokyo scenes.** The Tokyo scene with the rule, seeds 1 to 10 on WebGPU to step 48,000
(4 minutes per run), as part 15 measures Tokyo with light:

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_GROUND=1 VITE_SCENE=tokyo VITE_SEED=$seed VITE_STEPS=1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_NAME=g53-tokyo-webgpu-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g53-tokyo-webgpu-s$seed 1.5 99999 >> research/flow/out/g53-tokyo-webgpu.txt; done
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo-end research/flow/out/g53-tokyo-webgpu.txt
```

The record of before is `logs/engine/tokyo-flux1.4-sites.txt`; the same command prints its summary.
The same runs with `VITE_SCENE=tokyo-light` (seeds 1 to 3, `LIT=tokyo-light` before
`measure-tokyo.ts`), with `VITE_KIND=webgl2` to step 24,000 (seeds 1 to 3), and with the variant
`floor` (seeds 1 to 3, the command with `variant.ts floor` before `npx`, in a checkout of `02c3772`).

**The bytes of the scenes.** The digests of every scene after 500 steps on both backends, with the
state of the flow (3 minutes), on the branch and on `main` on the same machine:

```bash
VITE_FLOW=1 VITE_NAME=g53-digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g53-digest-branch.jsonl research/flow/logs/engine/starved-ground/digest-main.jsonl
```

It must print that all 54 runs are equal: no cell is starved in the first 500 steps. The seven
scenes with growth and the flow after 3,000 steps (4 minutes); the digests of `main` for it are the
record `digest-3000-main.jsonl`, made on the same machine with the two growth passes of `main`:

```bash
VITE_FLOW=1 VITE_STEPS=3000 VITE_ONLY=snail-maze,corn-maze,tokyo,tokyo-light,food-ring,rival-networks,tokyo-rivals VITE_NAME=g53-digest-3000-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g53-digest-3000-branch.jsonl research/flow/logs/engine/starved-ground/digest-3000-main.jsonl
```

**The wrong rules** SG1 to SG10, with G1, G2, F8, F13 and F16, which change the same lines (4 minutes):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts SG1 SG2 SG3 SG4 SG5 SG6 SG7 SG8 SG9 SG10 G1 G2 F8 F13 F16
```

The regrowth of part 13, the foods of four cities away from step 24,000 to step 27,000, with the
rule and with the variant `floor` (seeds 1 to 3, names `g53-starve-rule-s<seed>` and
`g53-starve-floor-s<seed>`): the second command of the regrowth in part 13 without `VITE_RECOVER`,
and for `floor` with `variant.ts floor` before `npx`, at `02c3772`. `summary.ts regrowth` with the
two files of a rule and the step 27000 prints when the foods are joined again.

Result: the rule stops every birth onto a starved cell, a third of the births in the dead ends,
and it changes no measure of the mazes or of the Tokyo scenes. The dead ends do not empty. Of the
other rules only `floor` empties them (ADR 0053 has the tables). The records are in
`logs/engine/starved-ground/`:

| Record                                            | Runs                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `births.txt`                                      | the lines of `births.ts`: the Snail maze, seeds 1 to 3, the rule and `parent`     |
| `snail-maze-webgpu.txt`, `corn-maze-webgpu.txt`   | the lines of `measure-mazes.ts` with the rule, seeds 1 to 10                      |
| `snail-maze-webgl2.txt`, `corn-maze-webgl2.txt`   | the same on WebGL2, seeds 1 and 2                                                 |
| `variants-snail.txt`, `variants-corn.txt`         | the run lines of the Snail maze with each variant, and the Corn maze with `floor` |
| `tokyo-webgpu.txt`, `tokyo-strands.jsonl`         | the Tokyo scene with the rule, seeds 1 to 10: the measures and the closed ground  |
| `tokyo-webgl2.txt`, `tokyo-light.txt`             | the Tokyo scene on WebGL2, and Tokyo with light, seeds 1 to 3                     |
| `tokyo-floor.txt`                                 | the Tokyo scene with the variant `floor`, seeds 1 to 3                            |
| `starve-rule.txt`, `starve-floor.txt`, `-strands` | the regrowth of part 13 with the rule and with `floor`, seeds 1 to 3              |
| `scenes-*.jsonl`                                  | the three scenes of part 9 with the rule, seed 1                                  |
| `digest-branch.jsonl`, `digest-main.jsonl`        | the digests of every scene after 500 steps, branch and `main`                     |
| `digest-3000-branch.jsonl`, `digest-3000-main`    | the same after 3,000 steps for the seven scenes with growth and the flow          |
| `mutations.txt`                                   | the wrong rules SG1 to SG10, G1, G2, F8, F13 and F16, and the tests that fail     |

### 18. Does the colony stay out of the dead ends when the mark is the same everywhere and lasts? [ADR 0054]

Since ADR 0054 a starved tube that vanishes leaves its ground at the floor of the flow memory, and
starved ground is fresh again after 6 days (`FLOW.recover` in `src/engine/flow.ts`). `VITE_RECOVER`
of `dump.gpu.test.ts` sets another time for a run: 0.00023 is the 18 h of before.

**The analysis: which mark, and for how long.** The Snail maze and the Corn maze to step 80,000,
seeds 1 to 3 (2.5 minutes per run), with the time of before:

```bash
STEPS=$(seq -s, 500 500 80000 | sed 's/,$//'); for scene in snail-maze corn-maze; do for seed in 1 2 3; do VITE_RECOVER=0.00023 VITE_SCENE=$scene VITE_SEED=$seed VITE_STEPS=$STEPS VITE_NAME=g54-$scene-floor-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done; done
```

```bash
for scene in snail-maze corn-maze; do WINDOW=10000 node --import ./research/flow/register.mjs research/flow/engine/measure-mazes.ts $scene $(for seed in 1 2 3; do echo g54-$scene-floor-s$seed; done) | grep window; done
```

`WINDOW=10000` makes `measure-mazes.ts` print one line per window of 10,000 steps. With the time
of before you must see `blind` below 0.03 in the window 30000 of the Snail maze and above 0.10 in
the window 40000: the colony comes back when the mark has faded. The same runs with the variant
`mark` (the command with `node --import ./research/flow/register.mjs research/flow/engine/variant.ts mark`
before `npx`, names `g54-<scene>-mark-s<seed>`), and where the children are born with each
(`births.gpu.test.ts` as in part 17 with `VITE_RECOVER=0.00023`, names `g54-births-floor-s<seed>`
and `g54-births-mark-s<seed>`; then `births.ts` with `RECOVER=0.00023` before `node`).

The Tokyo scene with the mark of the app and the flow strengths of before, 1.4, and 2 (the scene
has 2.8 since ADR 0054), seeds 1 to 3. The runs with 1.4 of the record go on to step 96,000, with
a sample every 8,000 steps:

```bash
for i0 in 1.4 2; do for seed in 1 2 3; do VITE_I0=$i0 VITE_GROUND=1 VITE_SCENE=tokyo VITE_SEED=$seed VITE_STEPS=1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_NAME=g54-tokyo-floor6d-i$i0-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g54-tokyo-floor6d-i$i0-s$seed 1.5 99999 >> research/flow/out/g54-tokyo-floor6d-i$i0.txt; done; done
```

The records of the analysis are the files `analysis-*` of `logs/engine/mark/`. They ran before the
rule was in the app, with the same lines in `flow.wgsl`, put there by the variant `floor` of
`variant.ts` at the commit `02c3772`;
the names of their runs say `floor` for the mark of the app with 18 h, `floor6d` for the app, and
`mark` for the variant with 18 h. The runs of 80,000 steps of the campaign give the lines of the
runs `floor6d` of the mazes again, so these are not in the record a second time.

**The campaign with the app.** The two mazes as in part 16, with the names
`g54-<scene>-webgpu-s<seed>`; the seeds 1 to 3 run to step 80,000, and `UNTIL=30000` gives the
lines of a run of 30,000 steps for all ten seeds:

```bash
for scene in snail-maze corn-maze; do UNTIL=30000 node --import ./research/flow/register.mjs research/flow/engine/measure-mazes.ts $scene $(for seed in 1 2 3 4 5 6 7 8 9 10; do echo g54-$scene-webgpu-s$seed; done) > research/flow/out/engine/g54-$scene-webgpu.txt; done
```

Where children are born and where agents die, as in part 17, for both mazes (1 minute per run):

```bash
for scene in snail-maze corn-maze; do for seed in 1 2 3; do VITE_SCENE=$scene VITE_SEED=$seed VITE_AT=12000,20000,28000 VITE_NAME=g54-births-$scene-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/births.gpu.test.ts; done; node --import ./research/flow/register.mjs research/flow/engine/births.ts $scene g54-births-$scene-s1 g54-births-$scene-s2 g54-births-$scene-s3; done
```

You must see `born starved 0 open 0 fed 0` in the dead ends of the Snail maze in the windows from
the steps 20,000 and 28,000. `births.ts` takes the time of the mark from the app; `RECOVER=0.00023`
before `node` gives the `opens` of a run with the time of before.

The trail on closed ground: the dumps of the last 10,000 of 30,000 steps, seeds 1 to 3 (50 s per
run), measured with `GROUND=1`:

```bash
STEPS=$(seq -s, 20500 500 30000 | sed 's/,$//'); for scene in snail-maze corn-maze; do for seed in 1 2 3; do VITE_SCENE=$scene VITE_SEED=$seed VITE_STEPS=$STEPS VITE_NAME=g54-ground-$scene-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done; GROUND=1 node --import ./research/flow/register.mjs research/flow/engine/measure-mazes.ts $scene g54-ground-$scene-s1 g54-ground-$scene-s2 g54-ground-$scene-s3 | grep ' run:'; done
```

`offClosed` is the share of the cells with a tube off the shortest route that lie on closed
ground: you must see 0.98 to 1.00. But for `offClosed`, `detours` and the time, the lines of the
dumps are the lines of the same steps in the record of the campaign.

**Past the fade of the mark.** The two mazes to step 220,000 with a dump every 1,000 steps, seeds
1 and 2 (5 minutes per run), and the Tokyo scene to step 224,000, seeds 1 to 3 (9 minutes per run):

```bash
STEPS=$(seq -s, 1000 1000 220000 | sed 's/,$//'); for scene in snail-maze corn-maze; do for seed in 1 2; do VITE_SCENE=$scene VITE_SEED=$seed VITE_STEPS=$STEPS VITE_NAME=g54-$scene-fade-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done; WINDOW=10000 node --import ./research/flow/register.mjs research/flow/engine/measure-mazes.ts $scene g54-$scene-fade-s1 g54-$scene-fade-s2 | grep window; done
```

```bash
for seed in 1 2 3; do VITE_GROUND=1 VITE_SCENE=tokyo VITE_SEED=$seed VITE_STEPS=16000,24000,32000,40000,48000,64000,80000,96000,112000,128000,144000,160000,176000,192000,208000,224000 VITE_NAME=g54-tokyo-fade-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts g54-tokyo-fade-s$seed 1.5 99999 >> research/flow/out/g54-tokyo-fade.txt; done
```

In the Snail maze you must see `blind` below 0.02 in the windows 30000 to 170000, and 0.06 to 0.10
in the window 180000: the first ground is open again 160,182 steps after it closed. The windows of
a record, for all its seeds, come from its lines:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-mazes research/flow/logs/engine/mark/snail-maze-fade.txt research/flow/logs/engine/mark/analysis-snail-maze-floor.txt
```

The Maze, seeds 1 to 10 to step 48,000 (1.5 minutes per run), as part 13 measures it:

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_SCENE=maze VITE_I0=8 VITE_SEED=$seed VITE_STEPS=500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,24000,32000,40000,48000 VITE_NAME=g54-mz-webgpu-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-maze.ts g54-mz-webgpu-s$seed >> research/flow/out/g54-maze-webgpu.txt; done
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-maze research/flow/out/g54-maze-webgpu.txt
```

The Tokyo scenes, the scenes of part 9 and the regrowth of part 13 as in part 17, with the names
`g54-…` and without `VITE_I0`: the scenes hold their flow strength. The digests as in part 17, after
500 steps for every scene and after 3,000 steps for the eight scenes with the flow
(`VITE_ONLY=maze,snail-maze,corn-maze,tokyo,tokyo-light,food-ring,rival-networks,tokyo-rivals`).
After 500 steps 42 of the 54 runs must equal those of `main` at `02c3772`, and the two mazes with
growth still equal them after 3,000 steps.

**The wrong rules** FL1 to FL10, and D1 to D6 of the recovery (5 minutes):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts FL1 FL2 FL3 FL4 FL5 FL6 FL7 FL8 FL9 FL10 D1 D2 D3 D4 D5 D6
```

Result: with the mark of the app the blind branches of the Snail maze hold 0.4 % of the trail of
the route (17.6 % before), no child is born in the dead ends, and the Maze and the Tokyo scenes
keep their measures, the Tokyo scenes with a flow strength of 2.8. When the mark has faded, the
colony comes back once. ADR 0054 has the tables. The records are in `logs/engine/mark/`:

| Record                                               | Runs                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `analysis-<scene>-floor.txt`, `-mark.txt`            | the mazes to step 80,000 with 18 h: the mark of the app, and the variant        |
| `analysis-births.txt`                                | the lines of `births.ts` for these two, the Snail maze, seeds 1 to 3            |
| `analysis-tokyo-i1.4.txt`, `-i2.txt`, `-i2.8.txt`    | the Tokyo scene with the mark of the app and three flow strengths, seeds 1 to 3 |
| `analysis-tokyo-mark.txt`, `analysis-starve-mark.*`  | the Tokyo scene and the regrowth with the variant `mark` and 18 h               |
| `snail-maze-webgpu.txt`, `corn-maze-webgpu.txt`      | the lines of `measure-mazes.ts`, seeds 1 to 10, to step 30,000                  |
| `<scene>-webgpu-long.txt`, `<scene>-webgl2.txt`      | seeds 1 to 3 to step 80,000 with their windows; WebGL2, seeds 1 and 2           |
| `<scene>-fade.txt`                                   | seeds 1 and 2 to step 220,000 with their windows                                |
| `births-<scene>.txt`, `ground-<scene>.txt`           | the lines of `births.ts`, and of `measure-mazes.ts` with `GROUND=1`             |
| `maze-webgpu.txt`, `maze-webgl2.txt`                 | the Maze, seeds 1 to 10 to step 48,000, and seeds 1 to 3 on WebGL2              |
| `tokyo-webgpu.txt`, `tokyo-strands.jsonl`            | the Tokyo scene, seeds 1 to 10: the measures and the closed ground              |
| `tokyo-webgl2.txt`, `tokyo-light.txt`                | the Tokyo scene on WebGL2, and Tokyo with light, seeds 1 to 3                   |
| `tokyo-fade.txt`, `tokyo-fade-strands.jsonl`         | the Tokyo scene to step 224,000, seeds 1 to 3                                   |
| `starve.txt`, `starve-strands.jsonl`                 | the regrowth of part 13, seeds 1 to 3                                           |
| `scenes-*.jsonl`                                     | the three scenes of part 9, seed 1                                              |
| `digest-branch.jsonl`, `digest-main.jsonl`           | the digests of every scene after 500 steps, branch and `main`                   |
| `digest-3000-branch.jsonl`, `digest-3000-main.jsonl` | the same after 3,000 steps for the eight scenes with the flow                   |
| `mutations.txt`                                      | the wrong rules FL1 to FL10 and D1 to D6, and the tests that fail               |

### 19. Does the slime field change a run, and what does it cost? [ADR 0055]

Since ADR 0055 the extended model has a slime field: a stamp per cell, the step in which the cell
last held plasm. No rule reads it yet. The setting Slime life time also gives the mark of starved
ground its time: `recoverShare()` in `src/engine/flow.ts` scales `FLOW.recover` by 144 over the
hours of the setting.

**The tests of the rule** (Node 1 s, headless browser 20 s, and the built app):

```bash
npx vitest run --project unit src/engine/slime.test.ts src/engine/slime-reference.test.ts src/engine/render.test.ts
```

```bash
npx vitest run --project gpu src/engine/slime.gpu.test.ts
```

```bash
npm run build && npx playwright test --project=e2e tests/e2e/ui.spec.ts -g "Slime tool"
```

You saw 36, 96 and 1 tests pass with the layer of ADR 0055. Part 21 has the counts with the film
of ADR 0057. `slime.gpu.test.ts` holds both backends to the CPU copy `slime-reference.ts`: the
stamps step by step, the brush, and the picture.

**The bytes of the scenes.** The digests as in part 17, with the names `g55-digest-branch` and
`g55-digest-3000-branch`, after 500 steps for every scene and after 3,000 steps for the eight
scenes with the flow (the list of part 18). The digests of `main` for it are those of the branch
of ADR 0054:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g55-digest-branch.jsonl research/flow/logs/engine/mark/digest-branch.jsonl
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g55-digest-3000-branch.jsonl research/flow/logs/engine/mark/digest-3000-branch.jsonl
```

They must print that all 54 runs and all 16 runs are equal.

**A life time of 18 hours gives the runs of ADR 0054 with 18 hours.** The Snail maze to step
80,000, seeds 1 to 3, with the setting in place of `VITE_RECOVER` (2 minutes per run):

```bash
STEPS=$(seq -s, 500 500 80000 | sed 's/,$//'); for seed in 1 2 3; do VITE_PATCH='{"slimeLife":18}' VITE_SCENE=snail-maze VITE_SEED=$seed VITE_STEPS=$STEPS VITE_NAME=g55-snail-maze-life18-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts; done
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/measure-mazes.ts snail-maze g55-snail-maze-life18-s1 g55-snail-maze-life18-s2 g55-snail-maze-life18-s3 > research/flow/out/g55-life18-snail-maze.txt
```

Every line of that file must equal its line in `logs/engine/mark/analysis-snail-maze-floor.txt`,
but for the name of the run at its start and the time of the run, `ms`, at its end.

**The time of a step** with the pass of the stamps and without it. A life time of 0 runs no pass.
The two cases run in turns (with, without, without, with), 2 minutes per run, and nothing else
may use the GPU then:

```bash
run() { VITE_NAME=$1 VITE_SCENES=maze,tokyo,cyclones VITE_WARM=1000 VITE_PATCH="$2" npx vitest run --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts; }; run g55-bench-slime-r1 '{}' && run g55-bench-none-r1 '{"slimeLife":0}' && run g55-bench-none-r2 '{"slimeLife":0}' && run g55-bench-slime-r2 '{}'
```

**The time of a draw** with the layer of the slime and without it, on a canvas of 2,560 × 1,600
pixels. `slime-draw.gpu.test.ts` draws one state 21 × 50 times with the switch off and on in
turns. The first command draws the Snail maze and Three strains in the glow and gel styles at
four views, the second Three strains in the glow style at six views from 0.15 to 4.8 cells per
pixel. Since ADR 0057 the file times the film, with a third case (part 21); a checkout of
`17d3ac6` times the layer:

```bash
VITE_NAME=g55-draw npx vitest run --config research/vitest.config.ts research/flow/engine/slime-draw.gpu.test.ts
```

```bash
VITE_SCENES=three-strains VITE_STYLES=glow VITE_ZOOMS=0.25,1,2,3,4,8 VITE_NAME=g55-draw-zooms npx vitest run --config research/vitest.config.ts research/flow/engine/slime-draw.gpu.test.ts
```

**The wrong rules** SL1 to SL119: 31 of the stamps and of the time of the mark, 46 of the brush
and 42 of the picture. Since ADR 0057 the numbers from SL78 on name wrong rules of the film
(part 21), and the record of the 42 of the layer is `mutations-picture.txt`:

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts $(for i in $(seq 1 77); do echo SL$i; done)
```

**The pictures** of the layer in each style, from the built app (`test-results/pictures/`).
Since ADR 0057 the command makes the pictures of the film:

```bash
npm run build && npx playwright test --project=pictures tests/pictures/slime.spec.ts
```

Result: no scene changes a byte, and a life time of 18 hours gives the runs of ADR 0054 line
for line. The pass of the stamps costs 0.01 to 0.23 ms of a step on WebGPU. The layer costs about
a tenth of a draw in a view that fits the grid, and up to 2.5 ms on WebGL2 in a view that is
zoomed far out. Each of the 119 wrong rules fails at least one test. ADR 0055 has the tables. The
records are in `logs/engine/slime/`:

| Record                                         | Runs                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `digest-branch.jsonl`, `digest-3000-branch`    | the digests of every scene after 500 steps, and of eight after 3,000   |
| `life18-snail-maze.txt`                        | the lines of `measure-mazes.ts` with a life time of 18 h, seeds 1 to 3 |
| `bench-with-pass-r*.jsonl`, `bench-without-*`  | the time of a step with the pass of the stamps and without it          |
| `draw.jsonl`, `draw-zooms.jsonl`               | the time of a draw with the layer and without it                       |
| `draw-before.jsonl`, `draw-before-zooms.jsonl` | the same before the reads of the layer got cheaper (commit `f353ee8`)  |
| `mutations.txt`, `-brush.txt`, `-picture.txt`  | the wrong rules SL1 to SL31, SL32 to SL77 and SL78 to SL119            |

### 20. Does a colony choose the arm without slime in a Y-maze? [ADR 0056]

The Y-maze of Reid et al. 2012 as research code: `engine/y-maze.ts` is the layout, with a unit
test of its mirror image, and `engine/y-maze.gpu.test.ts` runs it in the real engine, on WebGPU.
A run paints the slime, waits 18,000 steps, places about 50 agents on the base and reads after
every step which food holds plasm first. 40 seeds take 3 minutes. The rules are variants of
`engine/variant.ts` with names that start with `slime-`. A variant changes files below `src/`
while its command runs and puts them back: no growth pass of the app binds the slime field.

```bash
npx vitest run --project unit research/flow/engine/y-maze.test.ts
```

```bash
run() { npx vitest run --config research/vitest.config.ts research/flow/engine/y-maze.gpu.test.ts; }; rule() { node --import ./research/flow/register.mjs research/flow/engine/variant.ts "$1" npx vitest run --config research/vitest.config.ts research/flow/engine/y-maze.gpu.test.ts; }
```

The app with slime on one arm, on both arms and on no arm, and with arms of 9 cells. The side of
the slime changes with the seed:

```bash
for c in one both none; do VITE_CASE=$c VITE_SEEDS=1-40 run; done; VITE_CASE=one VITE_WIDTH=9 VITE_SEEDS=1-40 run
```

The rules of the births and of the moves with slime on one arm, and the rule of the moves with
slime on both arms and with arms of 9 cells:

```bash
for r in slime-weight slime-old-300 slime-wall-300 slime-stay-300 slime-stay-300-0.25; do VITE_CASE=one VITE_SEEDS=1-40 rule $r; done; for r in slime-stay-300 slime-stay-300-0.25; do VITE_CASE=both VITE_SEEDS=1-40 rule $r; done; VITE_CASE=one VITE_WIDTH=9 VITE_SEEDS=1-40 rule slime-stay-300
```

The runs with 10 seeds are the same commands with `VITE_SEEDS=1-10`: `slime-ban-300`,
`slime-sense-300-10`, `slime-sense-300-100`, `slime-old-3000` and `slime-wall-3000` with slime on
one arm; the rules of the births with `VITE_CASE=both` and `VITE_CASE=none`; `VITE_FRESH=1` for
slime of the age 0; and `slime-bind`, which reads the field and must give the runs of the app.
The age of the slime of the free neighbours of a parent, with no painted slime and with slime on
one arm:

```bash
for c in none one; do VITE_CASE=$c VITE_SEEDS=1-10 VITE_BIRTHS=1 VITE_NAME=births-$c rule births; done
```

The tables, one line per record, and the ages:

```bash
node --import ./research/flow/register.mjs research/flow/engine/measure-y-maze.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/measure-y-maze.ts births births-none births-one
```

The script reads `out/engine/y-maze/`. To make the tables from the archive, copy the files
`*.jsonl` of `logs/engine/y-maze/` there.

Result: the app has no preference (19 : 20 for the blank arm and the arm with slime). The rules of
the births reach 26 : 11 to 28 : 12. The rule of the moves reaches 40 : 0, and 39 : 1 with arms of
9 cells, and no preference with slime on both arms, where its colony needs 233 steps to the first
food in place of 65. ADR 0056 has the tables and the decision. The records are in
`logs/engine/y-maze/`:

| Record                          | Runs                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| `none-<case>-s<seeds>.jsonl`    | the app: one line per run; `-w9` arms of 9 cells, `-fresh` slime of age 0 |
| `slime-<rule>-<case>-s<seeds>`  | the same with a rule; a `+` joins two rules                               |
| `births-none-*`, `births-one-*` | the runs that wrote their births; the dumps of the births are not kept    |
| `nogrowth-*`                    | a colony without growth, with no rule and with the rule of the sensors    |
| `tables.txt`, `births.txt`      | the lines of `measure-y-maze.ts` for all records, and the ages            |

### 21. Does the film show where a tube stayed, and what does it cost? [ADR 0057]

Since ADR 0057 the slime field also holds an amount of slime per cell, a whole number from 0 to
4,095, and the picture draws the slime as a wet film whose thickness is that amount. No rule
reads the amount. The flat layer of part 19 is gone, and so are its wrong rules SL78 to SL119:
these numbers now name wrong rules of the film.

**The tests of the rule** (Node 1 s, headless browser 30 s, and the built app):

```bash
npx vitest run --project unit src/engine/slime.test.ts src/engine/slime-reference.test.ts src/engine/render.test.ts
```

```bash
npx vitest run --project gpu src/engine/slime.gpu.test.ts
```

```bash
npm run build && npx playwright test --project=e2e tests/e2e/ui.spec.ts -g "Slime tool"
```

You must see 86, 126 and 1 tests pass. `slime.gpu.test.ts` holds both backends to the CPU
copy `slime-reference.ts`: the amount step by step and under the brush, the map of the film and
its coarse map, and the picture of the film in each style.

**Which amount keeps the shape of a tube?** The Snail maze with the seed 1 to step 22,000, with
candidate amounts kept on the CPU (1 minute). It writes each candidate as a grey picture, and
the table of the ADR to `test-results/pictures/amount-snail-maze-22000.txt`:

```bash
npm run build && npx playwright test --project=pictures tests/pictures/slime-amount.spec.ts
```

**The bytes of the scenes.** The digests as in part 17, with the names `g57-digest-branch` and
`g57-digest-3000-branch`. The digests of `main` for it are those of part 19:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g57-digest-branch.jsonl research/flow/logs/engine/slime/digest-branch.jsonl
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g57-digest-3000-branch.jsonl research/flow/logs/engine/slime/digest-3000-branch.jsonl
```

They must print that all 54 runs and all 16 runs are equal.

**The time of a step** with the amount, against `main` and against a life time of 0, which runs
no pass. `../main` is a checkout of `main` at `a6ffe64` with `node_modules`. The three cases run
in turns, in another order in each of three rounds, 2 minutes per run, and nothing else may use
the GPU then:

```bash
run() { (cd $1 && VITE_NAME=$2 VITE_SCENES=maze,tokyo,cyclones VITE_WARM=1000 VITE_PATCH="$3" npx vitest run --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts); }; film() { run . g57-bench-film-r$1 '{}'; }; main() { run ../main g57-bench-main-r$1 '{}'; }; none() { run . g57-bench-none-r$1 '{"slimeLife":0}'; }; film 1; main 1; none 1; none 2; main 2; film 2; main 3; film 3; none 3
```

**The time of a draw** on a canvas of 2,560 × 1,600 pixels. `slime-draw.gpu.test.ts` draws one
state 21 × 50 times in each of three cases in turns: `off`, with the switch Show slime off;
`on`, with the film and its maps filled; and `fill`, where every draw fills the maps again, as
the first frame after a step does. The first command draws the Snail maze and Three strains in
the glow and gel styles at four views, the second Three strains in the glow style at six views
from 0.15 to 4.8 cells per pixel, and the third the paper and agents styles. The same two first
commands in `../main`, with the names `g57-draw-main` and `g57-draw-zooms-main`, time the layer
of ADR 0055:

```bash
VITE_NAME=g57-draw npx vitest run --config research/vitest.config.ts research/flow/engine/slime-draw.gpu.test.ts
```

```bash
VITE_SCENES=three-strains VITE_STYLES=glow VITE_ZOOMS=0.25,1,2,3,4,8 VITE_NAME=g57-draw-zooms npx vitest run --config research/vitest.config.ts research/flow/engine/slime-draw.gpu.test.ts
```

```bash
VITE_SCENES=three-strains VITE_STYLES=paper,agents VITE_ZOOMS=1,4 VITE_NAME=g57-draw-styles npx vitest run --config research/vitest.config.ts research/flow/engine/slime-draw.gpu.test.ts
```

**The wrong rules** SL1 to SL222: 31 of the stamps and of the time of the mark, 46 of the brush,
102 of the picture (SL78 to SL179) and 43 of the amount (SL180 to SL222):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts $(for i in $(seq 1 222); do echo SL$i; done)
```

**The pictures** of the film in each style, from the built app (`test-results/pictures/`):

```bash
npm run build && npx playwright test --project=pictures tests/pictures/slime.spec.ts
```

Result: no scene changes a byte. With the rule of the app 16.4 % of the cells with slime are
above 0.9 after 22,000 steps of the Snail maze; with a sum that is full after 500 steps 96.5 %
are. The amount costs 0.01 to 0.37 ms of a step on WebGPU. Where the film covers a picture of
2,560 × 1,600 pixels it costs 2 ms of a draw on WebGPU and 4 ms on WebGL2, and the first frame
after a step 0.6 to 1.1 ms more for the maps of 1.5 million cells. Each of the 222 wrong rules
fails at least one test. ADR 0057 has the tables. The records are in `logs/engine/film/`:

| Record                                           | Runs                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `digest-branch.jsonl`, `digest-3000-branch`      | the digests of every scene after 500 steps, and of eight after 3,000  |
| `amount-snail-maze-22000.txt`                    | the table of the candidate amounts                                    |
| `bench-film-r*`, `bench-main-r*`, `bench-none-*` | the time of a step with the amount, on `main`, and without the pass   |
| `draw.jsonl`, `draw-zooms`, `draw-styles`        | the time of a draw without the film, with it, and with a fill         |
| `draw-main.jsonl`, `draw-zooms-main.jsonl`       | the time of a draw with the layer of ADR 0055 and without it, on main |
| `mutations-stamps-brush.txt`, `-picture-*.txt`   | the wrong rules SL1 to SL77 and SL78 to SL179                         |
| `mutations-amount.txt`                           | the wrong rules SL180 to SL222                                        |

### 22. Does the picture show the growth front, and does a run change? [ADR 0060]

The slime field holds a front stamp per cell, and the picture draws a skirt around young ground.
This part has no measurement of the model: no rule reads the front stamp.

**The pictures** of the growth front in each style, from the built app (`test-results/pictures/`,
1 minute). `FRONT=tokyo,maze` makes those cases only, and `STYLES=gel` that style only. The cases
are Tokyo at the steps 600, 1,500 and 4,000, the Foraging maze, Three strains, Rival networks, the
edge of the gel 10 times closer, and Tokyo on WebGL2:

```bash
npm run build && npx playwright test --project=pictures tests/pictures/front.spec.ts
```

**The tests** of the front stamp on both backends against the CPU reference, and of the skirt in
the picture (20 seconds); then the tests of the film, which hold the frames without the skirt:

```bash
npx vitest run --project gpu src/engine/front.gpu.test.ts
```

```bash
npx vitest run --project gpu src/engine/slime.gpu.test.ts
```

**In the image of CI.** The first run of CI failed in `front.gpu.test.ts`: SwiftShader, the GPU
of CI, drew a black tube where the M3 Pro drew a normal picture (ADR 0060, Results). To run the
file as CI does, copy the commit into an empty folder with `git archive HEAD | tar -x -C <folder>`
and run it there in the image that `.github/workflows/ci.yml` pins (1 minute after `npm ci`):

```bash
docker run --rm -v <folder>:/work -w /work -e CI=1 <image> bash -lc "npm ci && npx vitest run --project gpu src/engine/front.gpu.test.ts"
```

**The time of the e2e tests** of the second shard in the image of CI, here and in a checkout of
`main`, one after the other with nothing else on the machine (12 minutes each, after `npm ci`):

```bash
docker run --rm --ipc=host -v <folder>:/work -w /work -e CI=1 <image> bash -lc "npm run build && npx playwright test --project=e2e --reporter=list --shard=2/2"
```

**The bytes of the scenes.** The digests as in part 17, with the names `g59-digest-branch` and
`g59-digest-3000-branch`. The digests of `main` for it are those of part 21:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g59-digest-branch.jsonl research/flow/logs/engine/film/digest-branch.jsonl
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g59-digest-3000-branch.jsonl research/flow/logs/engine/film/digest-3000-branch.jsonl
```

They must print that all 54 runs and all 16 runs are equal.

**The wrong rules** of the front stamp, of the skirt, of the film below the plasm, of the copies of
a lattice and of the scent view over the film (GF1 to GF26), and the 16 wrong rules of the slime whose
lines changed (part 7 has the tool):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts SL17 SL20 SL60 SL92 SL94 SL132 SL134 SL159 SL162 SL170 SL176 SL177 SL178 SL219 SL220 SL222 GF1 GF2 GF3 GF4 GF5 GF6 GF7 GF8 GF9 GF10 GF11 GF12 GF13 GF14 GF15 GF16 GF17 GF18 GF19 GF20 GF21 GF22 GF23 GF24 GF25 GF26
```

**The time of a step** with the front stamp, against `main`: the command of part 21 with the
names `g59-bench-front-r1` and `-r2` here and `g59-bench-main-r1` and `-r2` in a checkout of
`main` at `07b295e`, two rounds in turns, 2.7 minutes per run, with nothing else on the GPU.

Result: no scene changes a byte. Each of the 42 wrong rules fails at least one test (GF11 to GF26
ran with the skirt of decision 14 of the ADR, the other 26 before it). Two rounds do
not resolve the cost of the front stamp in a step: the means of the medians differ by −0.2 to
+0.02 ms on WebGPU and by −0.1 to +0.4 ms on WebGL2, and two rounds of one case differ by as
much. The second shard of the e2e tests takes 12.4 min here and 11.1 min on `main` in the image of
CI. Not measured: the time of a draw with the skirt. ADR 0060 has the rest. The records are in
`logs/engine/front/`:

| Record                                      | Runs                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `digest-branch.jsonl`, `digest-3000-branch` | the digests of every scene after 500 steps, and of eight after 3,000 |
| `mutations.txt`                             | the 42 wrong rules of the command above                              |
| `e2e-half2-main.txt`, `e2e-half2-branch`    | the second shard of the e2e tests in the image of CI, `main`, here   |
| `bench-front-r*`, `bench-main-r*`           | the time of a step with the front stamp, and on `main`               |

### 23. Does the black level cut the plasm? [ADR 0062]

The owner saw tubes tear as soon as they covered a certain share of the work surface. The black
level of the picture was the 65th percentile of the trail over all cells. Above a cover of 35 %
it rose into the plasm. Now, with one agent per cell, it is at most half of the median trail of
the cells that hold an agent. This part has no measurement of the model: no rule reads the levels.

**The pictures and the numbers**: eleven cases, each with the black level of before and with the
one of the app, from the built app (`test-results/pictures/`, 1 minute). `LEVELS=sheet,spots`
makes those cases only, and `BACKEND=webgl2` runs the app on WebGL2. A line per case says how
many of the cells with an agent each black level draws black:

```bash
npm run build && npx playwright test --project=pictures tests/pictures/levels.spec.ts
```

**The tests** of the rule on the CPU, and of a sheet, a network, agents without trail and a scene
without the rule on both backends (15 seconds):

```bash
npx vitest run --project unit src/engine/exposure.test.ts
```

```bash
npx vitest run --project gpu src/engine/levels.gpu.test.ts
```

**The bytes of the scenes.** The digests as in part 17, with the name `g62-digest-branch`. The
digests of `main` for it are those of part 22:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g62-digest-branch.jsonl research/flow/logs/engine/front/digest-branch.jsonl
```

It must print that all 54 runs are equal.

**The wrong rules** of the black level (BL1 to BL11), and the six wrong rules of the picture of
the tubes whose lines changed (part 7 has the tool):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts BL1 BL2 BL3 BL4 BL5 BL6 BL7 BL8 BL9 BL10 BL11 V51 V52 V53 V54 V57 V58
```

Result: in the owner's case the black level of before drew 19 % of the cells with an agent black,
and the one of the app 0.6 %. A sheet of agents went from 48 % to 1.2 %. Six cases keep their
level: there the 65th percentile lies below the limit. Each of the 17 wrong rules fails at least
one test. Not measured: the time of a measurement of the levels. ADR 0062 has the table. The
records are in `logs/view/levels/`:

| Record                     | Runs                                          |
| -------------------------- | --------------------------------------------- |
| `webgpu.txt`, `webgl2.txt` | the lines of the eleven cases on each backend |
| `mutations.txt`            | the 17 wrong rules of the command above       |

### 24. Does a scene move after a switch to one agent per cell? [ADR 0063]

With the rule, Agents per cell is the share of the cells that hold an agent. A switch to the rule
from 1 agent per cell or more gave 1: an agent in every cell, and no agent could move. Now the
switch gives such a scene Jones' 0.15, and a switch back puts the value of before back. This part
has no measurement of the engine: the rule is in the settings and in the panel.

**The tests** of the rule in the settings and of the switch in the panel (2 seconds):

```bash
npx vitest run --project unit src/model/params.test.ts src/ui/state.test.ts
```

**The wrong rules** of the density at the switch (DR1 to DR11; part 7 has the tool):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts DR1 DR2 DR3 DR4 DR5 DR6 DR7 DR8 DR9 DR10 DR11
```

Result: each of the 11 wrong rules fails at least one test. ADR 0063 has the numbers of the
owner's two links. The record is `logs/panel/density-mutations.txt`.

### 25. Do the start scenes and the experiments show tubes with the rules of the organism? [ADR 0064]

The owner wanted smooth, calm tubes in every scene of Start here and of Experiments, as in the Corn
maze. Those scenes now run one rule set: one agent per cell, growth, the flow and the slime, with
Jones' agent. Two new start scenes grow three and two rival colonies from food. Fleeing light
and the Foraging maze got the rules that they lacked. The Maze keeps its settings: it follows
the protocol of the maze of 2000, and growth makes it worse.

**The numbers and the pictures** of the two start scenes and of Fleeing light, from the built app
(`test-results/pictures/`, 1.5 minutes): the agents of every strain, the foods that every strain
covers and the share of the cells with trail, every 250 to 500 steps, and pictures of four steps.
`SCENES=light` makes one scene only, `LONG=1` adds the steps 20,000 and 40,000:

```bash
npm run build && npx playwright test --project=pictures tests/pictures/scenes.spec.ts
```

**The Foraging maze with the flow**, 10 seeds on WebGPU (6 minutes), then the table of the seeds:

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_KIND=webgpu VITE_SCENE=foraging-maze VITE_SEED=$seed VITE_STEPS=1000,2000,3000,4000,5000,6000,8000,10000,15000,20000 VITE_NAME=g64-fm-webgpu-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-maze.ts g64-fm-webgpu-s$seed >> research/flow/out/g64-foraging-maze-webgpu.txt; done
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-maze research/flow/out/g64-foraging-maze-webgpu.txt
```

**The Maze with growth**, the option that ADR 0064 rejects: the Maze with growth, a Capacity of
0.25 and no random shrinkage, 10 seeds on WebGPU (5 minutes); with `VITE_KIND=webgl2` and the
seeds 1 to 3 the same on WebGL2. The table of the Maze as it is comes from the record of part 11:

```bash
for seed in 1 2 3 4 5 6 7 8 9 10; do VITE_KIND=webgpu VITE_SCENE=maze VITE_SEED=$seed VITE_PATCH='{"growth":true,"capacity":0.25,"shrink":0}' VITE_STEPS=500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000 VITE_NAME=g64-mz-webgpu-s$seed npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts && node --import ./research/flow/register.mjs research/flow/engine/measure-maze.ts g64-mz-webgpu-s$seed >> research/flow/out/g64-maze-webgpu.txt; done
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-maze research/flow/out/g64-maze-webgpu.txt research/flow/logs/engine/maze-webgpu-flux8-sites.txt
```

**The bytes of the scenes.** The digests as in part 17, with the name `g64-digest-branch`. The
digests of `main` for it are those of part 22:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g64-digest-branch.jsonl research/flow/logs/engine/front/digest-branch.jsonl
```

It must print that 50 of 54 runs are equal, and name Fleeing light and the Foraging maze on both
backends: the two scenes that this record changes. The file holds 58 runs: 4 are the two new
scenes.

Result: every strain of Three strains covers all 12 foods at step 1,003, and three networks stay
to step 40,000 in pictures. The Foraging maze joins its two foods by step 5,000 in 10 of 10
seeds, and its tube is 1.03 times as long as the shortest route from step 15,000. With growth the
dead ends of the Maze fall below a tenth of the route's trail at step 12,500 (7,500 to 15,000),
against step 1,500 (1,500 to 2,000) without it, and its tube is 1.17 times the shortest route at
step 15,000, against 1.10. Not measured: the two start scenes and Fleeing light with more than
one seed in numbers, and any of the new scenes on WebGL2 in numbers. ADR 0064 has the tables.
The records are in `logs/engine/scenes-0064/`:

| Record                     | Runs                                                           |
| -------------------------- | -------------------------------------------------------------- |
| `numbers-webgpu.txt`       | the lines of `scenes.spec.ts` for the three scenes, seed 1     |
| `foraging-maze-webgpu.txt` | the lines of `measure-maze.ts` for the Foraging maze, 10 seeds |
| `maze-growth-webgpu.txt`   | the same for the Maze with growth, 10 seeds                    |
| `maze-growth-webgl2.txt`   | the same on WebGL2, 3 seeds                                    |
| `digest-branch.jsonl`      | the digests of every scene after 500 steps on both backends    |

### 26. Do the scenes of Reid et al. 2012 show what the app does with slime? [ADR 0066]

The owner asked for a Y-maze with slime on one arm and a dish with slime everywhere: the test beds of
stage 4 (ADR 0065). Both scenes start their colony on a start spot without food, as the plasmodium of
the paper starts. No rule reads the slime, so the runs must not change when the slime goes.

**The runs**, both scenes with 5 seeds on WebGPU and 6,000 steps (30 s), and with 2 seeds on WebGL2
and 3,000 steps (40 s); each with the slime and without it (`VITE_SLIME=0`), with pictures:

```bash
VITE_KINDS=webgpu VITE_SEEDS=1-5 VITE_STEPS=6000 VITE_SNAPS=200,1000,3000,6000 VITE_NAME=g66-webgpu npx vitest run --config research/vitest.config.ts research/flow/engine/reid.gpu.test.ts
VITE_KINDS=webgpu VITE_SEEDS=1-5 VITE_STEPS=6000 VITE_SLIME=0 VITE_NAME=g66-webgpu-blank npx vitest run --config research/vitest.config.ts research/flow/engine/reid.gpu.test.ts
VITE_KINDS=webgl2 VITE_SEEDS=1-2 VITE_STEPS=3000 VITE_SNAPS=1000,3000 VITE_NAME=g66-webgl2 npx vitest run --config research/vitest.config.ts research/flow/engine/reid.gpu.test.ts
VITE_KINDS=webgl2 VITE_SEEDS=1-2 VITE_STEPS=3000 VITE_SLIME=0 VITE_NAME=g66-webgl2-blank npx vitest run --config research/vitest.config.ts research/flow/engine/reid.gpu.test.ts
```

The table of each run: the step at which each food holds plasm, and the agents and the cells with
plasm at some steps, in the Y-maze also on the base and on each arm. With a second record it says
whether each run ends with the bytes of the run of the same seed there:

```bash
node --import ./research/flow/register.mjs research/flow/engine/measure-reid.ts g66-webgpu g66-webgpu-blank
node --import ./research/flow/register.mjs research/flow/engine/measure-reid.ts g66-webgl2 g66-webgl2-blank
```

They must print that 10 of 10 and 4 of 4 runs have the bytes of the runs without the slime. A
picture is the PNG of the canvas as base64 in `out/engine/`:
`base64 --decode < <file>.png.b64 > <file>.png` makes the image.

**The bytes of the scenes.** The digests as in part 17, with the name `g66-digest-branch`. The
digests of `main` for it are those of part 25:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g66-digest-branch.jsonl research/flow/logs/engine/scenes-0064/digest-branch.jsonl
```

It must print that 58 of 58 runs are equal. The file holds 62 runs: 4 are the two new scenes.

**The wrong rules** of the start spot and of the film of the Y-maze (5 minutes):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts SP1 SP2 SP3 SP4 SP5 SP6 SP7 SP8 SP9 SP10 SP11 SP12 SP13 SP14 SP15
```

Each must fail at least one test.

Result: in the Y-maze the colony reaches the first food after 64 to 140 steps, the food of the arm
with slime first in 2 of 7 runs, and one tube joins the two foods from about step 3,000. In the dish
it reaches the glucose after 115 to 511 steps, and a network of loops remains. Every run with the
slime has the bytes of the run without it. Not measured: more seeds, and slime on both arms or on
none. ADR 0066 has the tables. The records are in `logs/engine/reid-0066/`:

| Record                      | Runs                                                          |
| --------------------------- | ------------------------------------------------------------- |
| `scenes-webgpu.jsonl`       | the lines of `reid.gpu.test.ts` for both scenes, seeds 1 to 5 |
| `scenes-webgpu-blank.jsonl` | the same without the slime                                    |
| `scenes-webgl2.jsonl`       | the same on WebGL2, seeds 1 and 2, with the slime             |
| `scenes-webgl2-blank.jsonl` | the same without the slime                                    |
| `digest-branch.jsonl`       | the digests of every scene after 500 steps on both backends   |
| `mutations.txt`             | the tests that fail for each of the wrong rules SP1 to SP15   |

### 27. Does the territory of each strain keep the bytes of every scene? [ADR 0068]

The territory of each strain is the first of the four parts of the engine of stage 4
(`research/front/ENGINE.md`). Its rules run only while the setting `territory` is on, and no scene
turns it on yet, so every scene must keep its bytes.

**The bytes of the scenes.** The digests as in part 17, with the name `g68-digest-branch` (75 s).
The digests of `main` for it are those of part 26:

```bash
VITE_FLOW=1 VITE_NAME=g68-digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g68-digest-branch.jsonl research/flow/logs/engine/reid-0066/digest-branch.jsonl
```

It must print that 62 of 62 runs are equal.

**The wrong rules** of the territory, with S1 and L3, whose texts follow the code of the territory
now (5 minutes):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts TY1 TY2 TY3 TY4 TY5 TY6 TY7 TY8 TY9 TY10 TY11 TY12 TY13 TY14 TY15 TY16 TY17 TY18 TY19 TY20 TY21 TY22 TY23 TY24 TY25 TY26 TY27 TY28 TY29 TY30 TY31 TY32 TY33 TY34 TY35 TY36 TY37 TY38 S1 L3
```

Each must fail at least one test.

Result: 62 of 62 runs are equal, and each of the 40 wrong rules fails at least one test. The
records are in `logs/engine/territory-0068/`:

| Record                | Runs                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `digest-branch.jsonl` | the digests of every scene after 500 steps on both backends            |
| `mutations.txt`       | the tests that fail for each of the wrong rules TY1 to TY38, S1 and L3 |

### 28. Do the sinks of each strain keep the bytes of every scene? [ADR 0069]

The sinks of each strain and the rule of a corner in the push are part E2a of the engine of stage 4
(`research/front/ENGINE.md`). They run only while the setting `territory` is on, which no scene turns
on, so every scene must keep its bytes.

**The bytes of the scenes.** The digests as in part 27, with the name `g69-digest-branch`. The
digests of `main` for it are those of part 27, whose code `main` holds:

```bash
VITE_FLOW=1 VITE_NAME=g69-digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g69-digest-branch.jsonl research/flow/logs/engine/territory-0068/digest-branch.jsonl
```

It must print that 62 of 62 runs are equal.

**The wrong rules** of the sinks and of the corner, with TY31, whose text follows the code of
`packTerritory()` now:

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts TY31 $(seq -f 'TY%g' 39 101)
```

Each must fail at least one test.

Result: 62 of 62 runs are equal, and each of the 64 wrong rules fails at least one test. The
records are in `logs/engine/sinks-0069/`:

| Record                | Runs                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `digest-branch.jsonl` | the digests of every scene after 500 steps on both backends            |
| `mutations.txt`       | the tests that fail for each of the wrong rules TY39 to TY101 and TY31 |

### 29. Does the flow that takes the sinks keep the bytes of every scene? [ADR 0070]

The flow with the sinks and the sources, the adaptation while the front took flux, and the drift in
the sensors are part E2b of the engine of stage 4 (`research/front/ENGINE.md`). They run only while
the setting `territory` is on, which no scene turns on, so every scene must keep its bytes. The
parameters of every pass gain the slot of the drift, and the uniform block of the flow a slot of
what the sinks take: no pass of the code before reads them.

**The bytes of the scenes.** The digests as in part 28, with the name `g70-digest-branch`. The
digests of the code before are those of part 28, whose code this branch starts from:

```bash
VITE_FLOW=1 VITE_NAME=g70-digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g70-digest-branch.jsonl research/flow/logs/engine/sinks-0069/digest-branch.jsonl
```

It must print that 62 of 62 runs are equal.

**The wrong rules** of the flow with the sinks and of the drift, with TY36 and TY37, whose texts
follow the code of the link and of the Jones model now (3 minutes on an M3 Pro):

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts TY36 TY37 $(seq -f 'TY%g' 102 140)
```

Each must fail at least one test.

Result: 62 of 62 runs are equal, and each of the 41 wrong rules fails at least one test. The
records are in `logs/engine/flow-sinks-0070/`:

| Record                | Runs                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| `digest-branch.jsonl` | the digests of every scene after 500 steps on both backends                   |
| `mutations.txt`       | the tests that fail for each of the wrong rules TY36, TY37 and TY102 to TY140 |

### 30. Do the births that the flux pays keep the bytes of every scene? [ADR 0071]

The budget of each strain, the keys in `test`, the pass `rank` and the paid parents of `win` are part E3 of the engine
of stage 4 (`research/front/ENGINE.md`). They run only while the setting `territory` is on, which no scene turns on,
so every scene must keep its bytes. The uniform block of the flow gains the growth of the budget in a lane that no
pass of the code before reads.

**The bytes of the scenes.** The digests as in part 29, with the name `g71-digest-branch`. The digests of the code
before are those of part 29, whose code this branch starts from:

```bash
VITE_FLOW=1 VITE_NAME=g71-digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g71-digest-branch.jsonl research/flow/logs/engine/flow-sinks-0070/digest-branch.jsonl
```

It must print that 62 of 62 runs are equal.

**The wrong rules** of the paid births, with LG3, LG8, TY15, TY26, TY31 and TY94, whose texts follow the code of
growth and of the step now:

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts LG3 LG8 TY15 TY26 TY31 TY94 $(seq -f 'TY%g' 141 213)
```

Each must fail at least one test.

**The time of `rank`** (ADR 0071, on a quiet machine; `bench.gpu.test.ts` with `VITE_SCENES=three-networks
VITE_FLOWS=on VITE_WARM=1500 VITE_BATCH=30 VITE_BATCHES=11` and `VITE_PATCH` `{"territory":true,"capacity":1}` and
`{"territory":false,"capacity":1}` for the steps):

```bash
VITE_NAME=rank npx vitest run --config research/vitest.config.ts research/front/rank.gpu.test.ts
```

Result: 62 of 62 runs are equal, and each of the 79 wrong rules fails at least one test. The records are in
`logs/engine/paid-0071/`:

| Record                | Runs                                                                                |
| --------------------- | ----------------------------------------------------------------------------------- |
| `digest-branch.jsonl` | the digests of every scene after 500 steps on both backends                         |
| `mutations.txt`       | the tests that fail for each of TY141 to TY213, LG3, LG8, TY15, TY26, TY31 and TY94 |
| `rank.jsonl`          | the time of `rank` in the start scene on both backends, capacities 1 and 0.25       |
| `rank-block1.jsonl`   | the same on WebGPU with one key per round of the loop (`RANK_BLOCK` 1)              |
| `steps.jsonl`         | the time of a step of the start scene at capacity 1, with and without the rules     |

## The logs

The logs are one archive in the repository, `logs.tar.gz`: 429 files, 8.7 MB of text. Unpacked,
they are these folders. After a new campaign, copy its logs from `out/` into `logs/`, and make
the archive again with `logs.ts pack`. The unit test holds a digest of the archive, so it then
asks for the new digest.

| Folder                                               | What                                                                                                                                                                                                                            | Made                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `logs/maze-pair/`                                    | 60 runs of the prototype: table (a) and the numbers of the Context                                                                                                                                                              | 2026-11-13, `campaign.ts maze-pair`                   |
| `logs/maze-sites/`                                   | 30 runs of the prototype: a fixed flux at each food                                                                                                                                                                             | 2026-11-12, `campaign.ts maze-sites`                  |
| `logs/tokyo/`                                        | 6 runs of the prototype: table (b)                                                                                                                                                                                              | 2026-11-12, `campaign.ts tokyo`                       |
| `logs/alternatives/`                                 | 4 runs of the prototype: the rules that decisions 5 and 8 reject                                                                                                                                                                | 2026-11-13, `campaign.ts alternatives`                |
| `logs/engine/*.txt`                                  | the lines of `measure-maze.ts` and `measure-tokyo.ts` per run                                                                                                                                                                   | 2026-11-13, commit `92a63e7`, M3 Pro, Chromium, Metal |
| `logs/engine/bench-*.jsonl`                          | table (c): runs 1 and 2 are the table, runs 3 to 8 are later runs                                                                                                                                                               | 2026-11-13; runs 3 to 8 with the code of `main`       |
| `logs/engine/digest-*.jsonl`                         | the digests of `main` at `377f428`, and of `92a63e7` with the flow off                                                                                                                                                          | the same                                              |
| `logs/engine/before-review/`                         | the Tokyo runs with the code before the review (commit `6ffed4b`)                                                                                                                                                               | 2026-11-13                                            |
| `logs/engine/mutations.txt`                          | the tests that fail for each of 22 wrong rules (part 7)                                                                                                                                                                         | 2026-11-13, `engine/mutate.ts`, the code of `main`    |
| `logs/engine/mutations-0031.txt`                     | the same for 39 wrong rules, with the tests of ADR 0031                                                                                                                                                                         | 2026-11-13, the code of ADR 0031                      |
| `logs/engine/strains-*.jsonl`                        | the runs of part 8: the strains of the Foraging maze (`-before` with `main` at `7d3a5ee`), of Three strains with two foods and of the Maze; the digests of 18 runs with one strain at `7d3a5ee`; the time of a step (`-bench-`) | 2026-11-13, M3 Pro                                    |
| `logs/engine/scenes-*.jsonl`, `scenes-mutations.txt` | the runs of part 9: the strains of the new scenes and of the owner's second case, the time of a step, and the two wrong rules of ADR 0032                                                                                       | 2026-11-13, M3 Pro                                    |
| `logs/view/`                                         | the runs of part 10: the numbers of eight saved states, the widths of a straight tube, the time of a frame with and without the picture of the tubes, its 93 wrong rules, and its cost on a large grid                          | 2026-11-13 and 2026-11-15, M3 Pro                     |
| `logs/engine/*sites*`, `*-main*`                     | the runs of part 11: the campaigns, the scenes of ADR 0032, the time of a step and of the passes of the ports, the digests, the wrong rules, and the same runs of `main` on the same evening                                    | 2026-11-14, M3 Pro, `main` at `5195079`               |
| `logs/engine/radius/`                                | the runs of part 12: the radii on fixed networks, the tests of the bounded pressure, the local flux against the exact one on the dumps, the campaigns, the GPU tests and the wrong rules of the radius                          | 2026-11-15, M3 Pro, `main` at `3f579ff`               |
| `logs/engine/recover/`                               | the runs of part 13: the campaigns with each time until starved ground is fresh again, the regrowth and the Cut tool on WebGPU and WebGL2, and the wrong rules D1 to D6 with and without the new test                           | 2026-11-15, M3 Pro, `main` at `623fb36`, `71b0161`    |
| `logs/engine/cut-growth/`                            | the runs of ADR 0039: the digests of every scene on the branch and on `main`, its wrong rules K1 to K10 with U1 to U8, and the Tokyo case of the Cut tool                                                                       | 2026-11-15, M3 Pro, `main` at `71b0161` and `281d69e` |
| `logs/engine/wall-cost/`                             | the time of a step before and after the rule for an agent under a painted wall, with its flag clear and set, and of its first build (ADR 0038, check of 2026-11-15)                                                             | 2026-11-15, M3 Pro, a free GPU                        |
| `logs/engine/cut-cost/`                              | the time of a step before and after the rule of ADR 0039, with the flag of ADR 0038 clear and set (check of 2026-11-15)                                                                                                         | 2026-11-15, M3 Pro, a free GPU                        |
| `logs/engine/respawn-wound/`                         | the runs of ADR 0041: the digests of every scene on the branch and on `main`, and its wrong rules N1 to N10                                                                                                                     | 2026-11-15, M3 Pro, `main` at `b93584e`               |
| `logs/engine/light/`                                 | the runs of part 14 (ADR 0042): the scene Tokyo with light and the runs beside it, the digests of every scene on the branch and on `main`, and the SRTM samples                                                                 |
| `logs/engine/light-growth/`                          | the runs of part 15 (ADR 0050): Tokyo with light with Light stops growth at 1, 0.98, 0.9 and 0.5, the digests of every scene, and the wrong rules LG1 to LG11                                                                   | 2026-11-16, M3 Pro                                    |
| `logs/engine/mazes/`                                 | the runs of part 16 (ADR 0051): the lines of `measure-mazes.ts` for the Snail maze and the Corn maze                                                                                                                            | 2026-11-16, M3 Pro                                    |
| `logs/engine/starved-ground/`                        | the runs of part 17 (ADR 0053): where children are born, the two mazes and the Tokyo scenes with the rule, the other rules, the digests and the wrong rules SG1 to SG10                                                         | 2026-11-16, M3 Pro                                    |
| `logs/engine/mark/`                                  | the runs of part 18 (ADR 0054): the analysis of the mark and its time, the campaign with the app, the runs past the fade of the mark, the digests and the wrong rules FL1 to FL10                                               | 2026-11-17, M3 Pro                                    |
| `logs/engine/slime/`                                 | the runs of part 19 (ADR 0055): the digests of every scene, the Snail maze with a life time of 18 h, the time of a step and of a draw, and the wrong rules SL1 to SL119                                                         | 2026-11-17, M3 Pro                                    |
| `logs/engine/y-maze/`                                | the runs of part 20 (ADR 0056): the Y-maze with the app and with each rule of the births, of the sensors and of the moves, and the ages of the slime at a birth                                                                 | 2026-11-17, M3 Pro                                    |
| `logs/engine/film/`                                  | the runs of part 21 (ADR 0057): the digests of every scene, the table of the candidate amounts, the time of a step and of a draw, and the wrong rules SL1 to SL222                                                              | 2026-11-17, M3 Pro                                    |
| `logs/engine/front/`                                 | the runs of part 22 (ADR 0060): the digests of every scene, the wrong rules, and the e2e times                                                                                                                                  |
| `logs/view/levels/`                                  | the runs of part 23 (ADR 0062): the black level in eleven cases on each backend, and the wrong rules                                                                                                                            |
| `logs/panel/`                                        | the wrong rules of part 24 (ADR 0063): the density at a switch to one agent per cell                                                                                                                                            |
| `logs/engine/scenes-0064/`                           | the runs of part 25 (ADR 0064): the new scenes, the Foraging maze with the flow, the Maze with growth, the digests                                                                                                              |
| `logs/engine/reid-0066/`                             | the runs of part 26 (ADR 0066): the two scenes of Reid et al. 2012 with the slime and without it, the digests, and the wrong rules SP1 to SP15                                                                                  |
| `logs/engine/territory-0068/`                        | the runs of part 27 (ADR 0068): the digests of every scene, and the wrong rules TY1 to TY38                                                                                                                                     |
| `logs/engine/sinks-0069/`                            | the runs of part 28 (ADR 0069): the digests of every scene, and the wrong rules TY39 to TY101                                                                                                                                   |
| `logs/engine/flow-sinks-0070/`                       | the runs of part 29 (ADR 0070): the digests of every scene, and the wrong rules TY102 to TY140, TY36 and TY37                                                                                                                   |

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
| `register.mjs`            | lets Node run the TypeScript files, and read the shaders that the engine imports as text          |
| `logs.tar.gz`, `logs.ts`  | the logs of the runs as one archive, and the script that unpacks and packs it                     |
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
| `rules.ts`, `bounded.ts`  | the passes with single rules as switches, and three scenes for them (2026-11-13, 2026-11-15)      |
| `sites.ts`                | the food sites of the scenes, and the time of the sites on the CPU (2026-11-14)                   |
| `engine/*.gpu.test.ts`    | runs of the real engine: dumps, the time of a step, a frame and the picture, digests, strains     |
| `../vitest.config.ts`     | the Vitest configuration of the runs of the real engine                                           |
| `engine/measure-*.ts`     | the measures of a dump                                                                            |
| `engine/corn-maze.ts`     | the seeded generator of the layout of the scene Corn maze, and its routes (ADR 0051)              |
| `engine/strands.ts`       | the tubes that the flux has left, and the ground that their starvation marks, on a dump           |
| `engine/light-dabs.ts`    | the light of Tokyo with light as one disc per lit cell, which the scene does not use (ADR 0042)   |
| `engine/light-islands.ts` | the parts of the dark land of Tokyo with light, and the foods that light encloses (ADR 0050)      |
| `engine/exact-flux.ts`    | the local solver against an exact solution, on a dump                                             |
| `engine/radius.ts`        | the local solver with other radii on the fixed network of a dump (2026-11-15)                     |
| `engine/turns.sh`         | `bench.gpu.test.ts` in checkouts of several commits, in turns (ADR 0038, 2026-11-15)              |
| `engine/mutate.ts`        | 633 wrong rules, one at a time, against the tests of the flow, the tubes, the agents, the slime   |
| `engine/births.*`         | where the children of a run are born, by the flow memory of the cell and by zone (ADR 0053)       |
| `engine/variant.ts`       | other rules in the passes for one run, for the measurements of ADR 0053, ADR 0054 and ADR 0056    |
| `engine/y-maze.*`         | the Y-maze of Reid et al. 2012: its layout, its runs, and `measure-y-maze.ts` for its tables      |
| `view/tubes.ts`           | pictures of the tubes from a saved state, with the rule of the app and with the rejected rules    |
| `view/widths.ts`          | how wide the picture of the tubes draws a straight tube, by its band and by its flow memory       |
| `summary.ts`              | the tables of the ADR from the logs, and the comparison of a rerun with the record                |
| `research.test.ts`        | the unit test that keeps the scripts and the logs together                                        |

Not in this folder: the papers (copyright; the knowledge base has the references), and the dumps
of the engine runs (some gigabytes; a run writes them again).
