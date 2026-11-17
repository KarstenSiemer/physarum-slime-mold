# 0054: A starved tube leaves starved ground, and the mark lasts six days

- Status: accepted (the owner asked on 2026-11-16, with the result of ADR 0053, to analyse the cause further and to fix
  it; the rule, the time and the flow strength of the Tokyo scenes are decisions of the coordinator of 2026-11-17, under
  the owner's delegation of 2026-11-12), built 2026-11-17
- Date: 2026-11-17
- Changes [ADR 0029](0029-flow-in-the-tubes.md): decision 7 (the flow memory of ground that lost its tube), decision
  12 (the flow strength of the Tokyo scene) and decision 19 (the time until starved ground is fresh again).
- Extends [ADR 0053](0053-no-child-onto-starved-ground.md), which found the cause. It is stage 1b of the plan of
  [ADR 0052](0052-the-sources-on-slime-mazes-and-the-growth-front.md).
- In short: [`research/flow/README.md`](../../research/flow/README.md), part 18, has the commands and the records.

## Context

The first aim of the plan of 2026-11-16: the colony does not grow back into dead ends that it left. ADR 0053 built the
rule of stage 1, no child onto starved ground, and measured that it does not reach the aim. It found the cause:

- Ground is closed for births while its flow memory D is below 0.01. D falls only while a cell holds a tube.
- A starved tube vanishes soon, so each cell stops at a D of its own. About a fifth of the ground of a dead end is
  open at any time, and the colony comes back as a wave: a blind branch of the Snail maze fills about twice in 10,000
  steps.
- One other rule, `floor`, kept the blind branches empty in runs of 30,000 steps: a starved tube that vanishes leaves
  its ground at the floor of the flow memory, 0.0001.

The owner read these results on 2026-11-16 and asked for more analysis and a fix, so that the aim is reached. The plan
also says that the rule of the tubes stays as it is. This record changes what **ground** holds after a tube is gone,
and for how long. The adaptation of a tube, its conductivity, the flux, starvation and respawn stay as they are.

**Words.** A cell is **starved** while D < 0.01. **Starved ground** is ground that a starved tube left; its low D is
its **mark**. The **floor** is the least flow memory, 0.0001. Ground is **closed** while it is starved: no child is
born onto it (ADR 0053), and an agent on it dies with 1 to 2 % per step.

## What the analysis found

Runs of 80,000 steps of the Snail maze, seeds 1 to 3 on WebGPU. The number is the mean trail of the six blind branches
over the trail of the route, per window of 10,000 steps, as the least and the most of the three seeds. "18 h" is the
time until starved ground is fresh again of ADR 0029. `summary.ts engine-mazes` prints the windows of this record from
the lines of its runs.

| Steps            | Before (ADR 0053) | `floor`, 18 h  | `mark`, 18 h   | `floor`, 6 days |
| ---------------- | ----------------- | -------------- | -------------- | --------------- |
| 10,000 to 20,000 | 0.15 to 0.18      | 0.09 to 0.10   | 0.004 to 0.006 | 0.05 to 0.06    |
| 20,000 to 30,000 | 0.16 to 0.17      | 0.005 to 0.022 | 0.08 to 0.10   | 0.004 to 0.008  |
| 30,000 to 40,000 | not run           | 0.11 to 0.15   | 0.01 to 0.03   | 0.005           |
| 40,000 to 80,000 | not run           | 0.01 to 0.19   | 0.02 to 0.11   | 0.004 to 0.017  |

- **Every mark that fades lets the colony come back when it has faded.** With `floor` and 18 h the blind branches are
  empty from step 20,000 to step 30,000. Then the first ground is open again: 20,025 steps after it was closed. The
  colony comes back, and from then on the blind branches hold 9 % of the trail of the route in the mean, half as much
  as before.
- **`mark` closes more ground and is out.** In this variant every tube that vanishes with a D below that of fresh
  ground leaves its ground at the floor, also a tube that was not starved yet. The blind branches are then closed to
  100 % after the first wave, and no child is born there. But the colony comes back after 20,025 steps too. And the
  Tokyo scene pays: its total length falls to 1.54 (1.86 with ADR 0053, the same seeds), and four cities whose foods
  were away for 100 min are joined again after up to 13,000 steps (1,000 before).
- **So the time of the mark decides.** The papers give no life time of the slime. A small plasmodium crosses its own
  trail from 3 h on (Tröger et al. 2024, p. 5). Slime of a large culture made very large plasmodia avoid it for up to
  6 days (Reid et al. 2013, as Tröger et al. 2024 cite it, p. 3). The 18 h of ADR 0029 came from the total length of
  the Tokyo scene, measured with the leaky mark.
- **With `floor` and 6 days the blind branches stay empty** for the 80,000 steps of the run. The pictures show one
  tube on the route with short twigs of 20 to 60 cells beside it, which are agents that walk off the tube and starve.

## Options

1. `floor` with 18 h. The colony comes back every 11 h of model time.
2. `floor` with a longer time, as a constant.
3. `floor`, and the time as a setting. The plan has this setting in stage 2, as the life time of the slime.
4. `mark`. It costs the Tokyo scene its regrowth.
5. Births that the flow must supply, so that a part of the colony without flux cannot grow. That is stage 4 of the
   plan.
6. Two times: a long one for starved ground and the 18 h for other ground whose flow memory is below that of fresh
   ground. Not measured. It is one more rule, and stage 2 decides whether the slime gets a field of its own.

## Decision

Option 2. The decisions are the coordinator's:

1. **A starved tube that vanishes leaves starved ground.** In the step in which the tube body of a cell falls below
   0.05, its flow memory falls to the floor, 0.0001, if it is below 0.01. `docs/model.md`, 8.4, has the exact rule.
   Reason: the mark was as deep as the tube happened to starve before its agents were gone. Now every cell of starved
   ground holds the same mark for the same time, which is what decision 7 of ADR 0029 meant.
2. **A tube that is not starved keeps its memory when it vanishes** (not `mark`). Reason: the measurements above. The
   colony must come back fast where a food comes back.
3. **Starved ground is fresh again after 6 days**, and open for births again after 3.7 days: the flow memory of
   ground grows by 0.002875 % per step, an eighth of the share of ADR 0029. Reason: with every time the colony comes
   back when the mark has faded, so the time says how often a colony looks into a dead end again. 6 days is the
   longest avoidance of slime that a source reports for a large plasmodium. It is second hand; no source measured the
   life time.
4. **No setting yet.** The time is the constant `FLOW.recover`. Reason: stage 2 of the plan gives the slime its life
   time as a setting and decides how the slime and this mark go together. A setting here would decide that first.
5. **The Tokyo scenes run a flow strength of 2.8** in place of 1.4. Reason: decision 12 of ADR 0029 chose the strength
   that gives the total length of the organism. With the new mark 1.4 gives a network that is too short (the table of
   the Tokyo scene below). The same method now gives 2.8. The scenes are Tokyo rail network, Tokyo with light and
   Tokyo, two networks.
6. **No setting, and no field of a link**, as in ADR 0053. A link of a scene with the flow that was made before this
   record runs with the new mark. A link holds its flow strength, so a link of a Tokyo scene keeps 1.4.

## Results

All runs: an M3 Pro, Chromium with Metal, 2026-11-17, on the branch of this record: the engine of `main` at `02c3772`
with the decisions above. "Before" is the record of ADR 0053. The records are `logs/engine/mark/` in the archive of
`research/flow/`. The runs of the analysis used the same lines in the flow pass, put there by `variant.ts`; the runs
of 80,000 steps of the campaign give their lines again, number for number.

### The two mazes: the dead ends empty

The campaign of ADR 0053 again: seeds 1 to 10 on WebGPU to step 30,000, a dump every 500 steps, the same measures
(`measure-mazes.ts`). The tail is the 20 dumps of the last 10,000 steps.

| Snail maze                                              | Before                  | With this record        |
| ------------------------------------------------------- | ----------------------- | ----------------------- |
| The colony joins both foods at step, median (range)     | 9,250 (7,500 to 11,000) | 8,750 (7,500 to 10,500) |
| The tube joins the foods in the tail                    | 200 of 200 dumps        | 200 of 200 dumps        |
| Dumps without a join after the first join               | 39 of 431               | 25 of 431               |
| Tube over the route                                     | 1.00 to 1.01            | 1.00 to 1.01            |
| Tube cells on the route                                 | 0.86 to 0.89            | 0.97                    |
| Trail of a blind branch over the route's, mean of 60    | 0.176                   | 0.004                   |
| The same, least and most                                | 0.09 to 0.25            | 0.00 to 0.03            |
| Blind branches below 0.10                               | 2 of 60                 | 60 of 60                |
| Dumps with every blind branch below 0.10                | 6 of 200                | 194 of 200              |
| A blind branch holds 0.10 or more, share of the dumps   | 0.44                    | 0.01                    |
| A blind branch fills, times in 10,000 steps             | 2.43                    | 0.08                    |
| Flow memory of a blind branch over the route's, at most | 0.018                   | 0.001                   |
| Agents at step 30,000                                   | 5,331 to 5,854          | 4,950 to 5,326          |

| Corn maze                                                  | Before                 | With this record       |
| ---------------------------------------------------------- | ---------------------- | ---------------------- |
| The colony joins both foods at step, median (range)        | 3,500 (3,000 to 4,500) | 3,500 (3,000 to 4,500) |
| Only the shortest route carries flow, steps after the join | 500 to 2,500           | 500 to 2,000           |
| Another route carries flow from end to end                 | 0 of 600 dumps         | 0 of 600 dumps         |
| Dumps without a join after the first join                  | 67 of 537              | 54 of 536              |
| Tube over the shortest route                               | 1.01 to 1.03           | 1.01 to 1.02           |
| Tube cells on the shortest route                           | 0.60 to 0.74           | 0.89 to 0.91           |
| Trail of the dead ends over the route's, mean of the tail  | 0.147                  | 0.0006                 |
| Tail dumps with the dead ends below 0.02 of the route      | 18 of 200              | 200 of 200             |
| Tail dumps with a tube on the route of 28 rooms            | 31 of 200              | 14 of 200              |
| on the route of 30 rooms                                   | 28 of 200              | 25 of 200              |
| on a route of 34, 36 or 40 rooms                           | 4 of 200               | 2 of 200               |
| Tail dumps in which only the shortest route holds a tube   | 142 of 200             | 163 of 200             |
| Doors that a tube crosses at step 30,000, of 102           | 35 to 68               | 32 to 37               |
| Agents at step 30,000                                      | 3,286 to 6,903         | 2,968 to 3,156         |

- **The blind branches of the Snail maze are empty in every seed.** A blind branch holds 0.4 % of the trail of the
  route in the mean (17.6 % before), and all 60 are below the 10 % at which the Maze calls a dead end empty.
- **The colony does not come back.** A blind branch fills 0.08 times in 10,000 steps (2.43 times before). In 6 of
  the 200 dumps of the tail one branch holds 10 % or more, 50 % at most (153 % before).
- **The tube does not pay for it.** It joins the foods in every dump of the tail, as before, and it breaks less often
  on the way there: 25 dumps without a join after the first join (39 before), the last one at step 19,500.
- **The Corn maze keeps its colony at the shortest route.** 89 to 91 % of the tube cells lie on it (60 to 74 %
  before), a tube crosses 32 to 37 of the 102 doors (35 to 68), and the colony has 2,968 to 3,156 agents at step
  30,000 (3,286 to 6,903). No other route carries flow, as before.
- **A longer route of the Corn maze still counts as one with a tube now and then**: the route of 28 rooms in 14 of
  the 200 dumps of the tail and the route of 30 rooms in 25. Both leave the shortest route for three or five rooms
  and join it again. No tube grew back there: in 16 such dumps of the seeds 1 to 3, the rooms of the side route are
  closed ground to 97 % or more ("Where a child is born", below). Agents walk off the tube into these rooms, and
  their trail crosses every door of the side route at the same time.
- **WebGL2**, seeds 1 and 2: the Snail maze joins its foods at the steps 8,000 and 8,500, its tube is 1.00 times the
  route, and its blind branches hold 0 to 1 % (11 to 26 % before). In the Corn maze the shortest route alone
  carries the flow from the steps 5,000 and 5,500, as before, and it alone holds a tube in 35 of 40 dumps (31).

**Runs of 80,000 steps**, seeds 1 to 3 on WebGPU, per window of 10,000 steps, the least and the most of the seeds:

| Steps            | Snail maze: blind branches over the route | Corn maze: dumps with a tube on a longer route |
| ---------------- | ----------------------------------------- | ---------------------------------------------- |
| up to 10,000     | 0.74 to 0.78                              | 7 to 9 of 20                                   |
| 10,000 to 20,000 | 0.05 to 0.06                              | 5 to 7 of 20                                   |
| 20,000 to 30,000 | 0.004 to 0.008                            | 3 to 7 of 20                                   |
| 30,000 to 80,000 | 0.004 to 0.017                            | 1 to 7 of 20                                   |

The tube joins the foods in every dump from step 14,000 on (Snail maze) and from step 9,500 on (Corn maze). The
pictures of the trail show one tube on the route and short twigs of 20 to 60 cells beside it: agents walk off the tube
onto closed ground and starve there.

### Where a child is born, and where an agent dies

`births.gpu.test.ts` of ADR 0053 again, with the code of the app: seeds 1 to 3 of the Snail maze on WebGPU, windows of
300 steps. The numbers are for the dead ends (26,506 cells), per 1,000 steps: the least and the most of the six
windows from the steps 20,000 and 28,000. "Before" is the record of ADR 0053, the same six windows.

| In the dead ends of the Snail maze                         | Before       | With this record |
| ---------------------------------------------------------- | ------------ | ---------------- |
| Children                                                   | 917 to 5,670 | 0                |
| Deaths                                                     | 740 to 5,547 | 13 to 77         |
| Closed ground, share of the cells                          | 70 to 76 %   | 94 to 97 %       |
| Ground without a tube with D from 0.01 to below 0.2, share | 14 to 24 %   | 3 to 6 %         |
| Fresh ground, share                                        | at most 1 %  | 0                |

- **No child is born in the dead ends** after the first wave. Before, births and deaths there were about equal, and
  they kept a colony alive.
- **What is left there walks in.** 13 to 77 agents die in the dead ends per 1,000 steps: agents that left the tube.
- **The mark of the dead ends ends when the measured return starts.** By the flow memory at step 28,300, half of
  their closed ground is open again 143,440 to 143,740 steps later, at about step 172,000. The blind branches fill
  from step 173,000 on (below).
- **3 to 6 % of the ground of the dead ends is open and holds no colony.** A tube that was not starved yet vanished
  there (decision 2). No child was born on it in the six windows. This ground can explain the three dumps before the
  fade in which a blind branch holds 10 % or more; the runs do not show it.
- **In the corridor of the route nothing changes**: 31,500 to 34,900 children per 1,000 steps are born onto fed cells
  (31,100 to 33,800 before), and 32,700 to 39,300 agents die (34,100 to 40,800). The colony renews about 0.7 % of
  its agents in every step, as before.

The same for the Corn maze, whose dead ends hold the longer routes (82,159 cells; no record of before): 0 to 337
children and 0 to 353 deaths per 1,000 steps in the six windows; 90 to 92 % of the ground is closed, and 8 to 10 % is
ground without a tube with D from 0.01 on, where a child can be born.

**The trail off the route lies on closed ground.** `GROUND=1` of `measure-mazes.ts` counts the cells with a tube
that do not lie on the shortest route, and of them the share on closed ground. Seeds 1 to 3 of each maze, the 20 dumps
of the tail: 0.99 to 1.00 in the Snail maze and 0.98 to 1.00 in the Corn maze. No child is born onto closed ground, so
the agents of these cells walked there.

### Past the fade of the mark

The first starved ground is open for births again 160,182 steps after it closed. Runs past that step, on WebGPU: the
two mazes with seeds 1 and 2 to step 220,000, a dump every 1,000 steps, and the Tokyo rail network with seeds 1 to 3
to step 224,000. The numbers of the mazes are per window of 10,000 steps, the least and the most of the two seeds.

| Steps              | Snail maze: blind branches over the route | Corn maze: tube cells on the shortest route |
| ------------------ | ----------------------------------------- | ------------------------------------------- |
| 30,000 to 170,000  | 0.003 to 0.015                            | 0.89 to 0.91                                |
| 170,000 to 180,000 | 0.065 and 0.091                           | 0.71 and 0.88                               |
| 180,000 to 220,000 | 0.005 to 0.024                            | 0.74 to 0.90                                |

- **When the mark has faded, the colony comes back once, and it leaves again.** In the Snail maze 10 of the 12 blind
  branches of the two seeds fill between the steps 173,000 and 183,000, to between 0.13 and 1.37 times the trail of
  the route, and each is empty again 1,000 to 3,000 steps later. One of them fills a second time, to 0.26. A starved
  tube then leaves the floor again, so the branch is closed for the next 160,182 steps. The first wave of a run fills
  the blind branches to 0.74 over a window; this one to 0.065 and 0.091.
- **Between the first wave and the fade the blind branches stay empty**: from step 20,000 to step 170,000 a branch
  holds 10 % or more in 3 of the 150 dumps of each seed.
- **The Corn maze** shows the same: the tube cells on the shortest route fall to 0.71 in one window of seed 1 and to
  0.82 and 0.74 in two windows of seed 2, and they are back at 0.88 to 0.90 after it.
- **The tube holds through it.** It joins the foods in every dump from step 20,000 on in all four runs, and in the
  Corn maze the shortest route alone carries the flow in every dump after step 10,000.
- A step is 2 s of model time (ADR 0029, decision 10), so the mark keeps ground closed for 89 h. At the default speed
  of the app, 120 steps per second, that is 22 minutes.

| Tokyo rail network, steps | TL           | MD           | FT           | Closed ground    |
| ------------------------- | ------------ | ------------ | ------------ | ---------------- |
| 48,000                    | 1.72         | 0.82         | 0.91         | 31,270           |
| 64,000 to 176,000         | 1.57 to 1.65 | 0.82 to 0.84 | 0.87 to 0.91 | 33,632 to 36,596 |
| 192,000 to 224,000        | 1.63 to 1.64 | 0.82         | 0.89 to 0.90 | 33,007 to 35,419 |

The numbers are the means of the three seeds at each sample (the closed ground: the median), a sample every 16,000
steps.

- **The total length settles at about 1.6 after step 48,000**, and it stays there to the end of the runs. All 33
  foods are joined in each of the 48 samples.
- **The organism has no number for these steps.** The experiment of Tero et al. 2010 shows its network at 26 h, which
  are 46,800 steps. So the sample of step 48,000 is the one that stands beside the organism's 1.75 ± 0.30, and there
  the scene has 1.72 ± 0.06 over 10 seeds.
- **The closed ground stops growing at about half of the land**: 36,596 of 70,868 cells at step 160,000. From then on
  the first marks fade.

### The Maze

The Maze has no growth, so only the mark and its time act on it. Seeds 1 to 10 on WebGPU to step 48,000, as ADR 0029
measured it (amendment 2026-11-15 (2), with 18 h): the tube joins the foods in 10 of 10 seeds from step 1,000 on, the
dead ends hold less than 2 % of the trail of the route from step 2,250 (2,000 to 3,000; before 2,000 to 4,000), and
the tube is 1.06 times the route at step 48,000, as before. On WebGL2, seeds 1 to 3 to step 15,000: joined in 3 of 3,
below 2 % from step 2,000.

### The Tokyo scenes

**The flow strength.** The Tokyo scene with the new mark and three flow strengths, seeds 1 to 3 on WebGPU. The samples
are those of the steps 16,000, 24,000, 32,000, 40,000 and 48,000.

| Flow strength          | TL          | MD          | FT          | Links |
| ---------------------- | ----------- | ----------- | ----------- | ----- |
| 1.4 (the scene before) | 1.53 ± 0.11 | 0.84        | 0.86        | 46.7  |
| 2                      | 1.60 ± 0.09 | 0.83        | 0.88        | 47.5  |
| 2.8                    | 1.74 ± 0.10 | 0.83        | 0.91        | 50.7  |
| The organism (21 runs) | 1.75 ± 0.30 | 0.85 ± 0.04 | 0.80 ± 0.13 |       |

With 1.4 the total length is at the low end of the organism's, and one seed falls to 1.31 at step 48,000. A run of
96,000 steps with 1.4 holds 1.45 to 1.51 from step 48,000 on (mean of the seeds), and all 33 foods are joined in every
sample from step 2,000 on. The FT of the organism is that of the runs without light.

**The campaign.** The Tokyo rail network with 2.8, seeds 1 to 10 on WebGPU to step 48,000. "Before" is the record of
ADR 0053, with 1.4.

| Tokyo rail network                              | Before                  | With this record        |
| ----------------------------------------------- | ----------------------- | ----------------------- |
| TL at step 48,000                               | 1.77 ± 0.07             | 1.72 ± 0.06             |
| MD at step 48,000                               | 0.82 ± 0.02             | 0.82 ± 0.01             |
| FT at step 48,000                               | 0.89 ± 0.03             | 0.91 ± 0.01             |
| TL, MD and FT over the 50 samples               | 1.84 ± 0.13, 0.82, 0.91 | 1.79 ± 0.10, 0.82, 0.91 |
| Links and agents over the 50 samples            | 54.7 and 4,027          | 52.6 and 4,033          |
| All 36 foods joined, samples from step 4,000 on | 77 of 80                | 75 of 80                |
| All 33 foods of Fig. 2 joined, the same samples | 80 of 80                | 80 of 80                |
| Closed ground, of 70,868 cells of land          | 22,289                  | 29,563                  |

- **The Tokyo scene keeps its measures with 2.8.** Every measure lies within one standard deviation of the organism's,
  the test of decision 12 of ADR 0029.
- **The total length still falls at step 48,000**: 1.90, 1.80, 1.76, 1.75 and 1.72 at the five steps of the samples
  (mean of the 10 seeds). The closed ground still grows: 31,806 cells at step 48,000.
- **WebGL2**, seeds 1 to 3 at step 24,000: TL 1.79 ± 0.10, MD 0.81 ± 0.01, FT 0.90 ± 0.03 (WebGPU: 1.80 ± 0.09,
  0.83 ± 0.03, 0.91 ± 0.02).
- **Tokyo with light**, seeds 1 to 3 on WebGPU: over the 15 samples TL 1.72 ± 0.07, MD 0.84 and FT 0.86 (before:
  1.72 ± 0.10, 0.84, 0.86); the network holds 1.13 % of its cells on lit ground (0.82 % before), below 5 % in 15 of
  15 samples, as before.
- **The scenes of ADR 0032**, seed 1 on WebGPU as their record: Food ring covers 9 of 9 food sites from step 2,001
  on, as before. In Rival networks each of the two strains covers all 10 foods from step 3,002 on (before: from step
  2,002 on). On the Tokyo map each of two strains covers 40 to 42 of the 42 food sites from step 2,002 on (before: 39
  to 42). The colonies are smaller where the flow strength stays: 2,402 agents in Food ring at step 12,001 (2,823
  before), 2,341 and 2,318 in Rival networks (3,225 and 3,135). On the Tokyo map, with 2.8: 4,483 and 4,817 at step
  14,002 (4,534 and 4,140).
- **The regrowth of ADR 0029** (the foods of four cities are away from step 24,000 to step 27,000; seeds 1 to 3): all
  33 foods are joined again at step 28,000 (27,300 to 29,000, median and range of the first measured step). Before:
  27,300 (27,300 to 28,000). With `mark`: 30,000 (27,600 to 40,000).

### The scenes that change their bytes

- **Every scene with the flow changes**, the eight scenes Maze, Snail maze, Corn maze, Tokyo rail network, Tokyo with
  light, Food ring, Rival networks and Tokyo, two networks. A scene without the flow keeps the bytes of `main`: its
  passes do not hold the lines of the flow.
- **After 500 steps** the digests of 42 of the 54 runs (27 on each backend, with the state of the flow) equal those of
  `main`. The 12 others are six of the eight scenes on both backends. The two mazes with growth still have the bytes
  of `main`: their colony does not cover its second food that early, and until then no flow memory changes.
- **After 3,000 steps** the same: the six scenes differ on both backends, and the two mazes still have the bytes of
  `main`. Their first starved tube vanishes later.
- The digests of `main`, made again on the same machine, equal the digests of the branch of ADR 0053: 54 of 54, and
  14 of 14 after 3,000 steps.

### Tests

- **The GPU test of the rule** (`flow.gpu.test.ts`, "leaves the ground of a starved tube that vanishes at the floor
  of the flow memory"): a field of cells with nine flow memories from the floor to 0.5 and four tube bodies, on both
  backends against the CPU reference. A cell falls to the floor only in the step in which its tube body passes
  below 0.05, and only if its flow memory is below 0.01 then.
- **Wrong rules**: FL1 to FL10 are five wrong forms of the rule in each backend (the tube keeps its memory; every
  tube leaves the floor; starved ground falls in every step; the tube falls before it vanishes; the tube leaves fresh
  ground). D1 to D6 are the wrong rules of the recovery of ADR 0029. Each of the 16 fails at least one test. The
  list has 298 wrong rules.
- **The unit test of the time** (`flow.test.ts`): starved ground is fresh again after 6 to 6.2 days of model time and
  open for births after 3.7 days.

## Consequences

- `docs/model.md` has the rule and the time (8.4 and 8.6) and the test (section 13). `docs/fidelity.md` has the new
  numbers in its rows 1, 2, 5, 13, 16, 20 and 23.
- **The first aim of the plan is reached for the life of the mark.** A colony does not grow back into a dead end that
  it left, for 89 h of model time. Then it comes back once, for 1,000 to 3,000 steps, and the dead end is closed
  again.
- **Starved ground is a wall for births for a fixed time.** Before, most of it opened again after some thousand
  steps. An agent can still walk onto it, and it starves there.
- **The eight scenes with the flow change their bytes** (Results). The three Tokyo scenes also have a new flow
  strength. A link holds the settings of its scene, so a link of a Tokyo scene that was made before this record keeps
  1.4. It runs with the new mark and gives a shorter network: TL 1.45 ± 0.14 at step 48,000.
- **A colony with growth is smaller**, because no child is born where a tube starved: at step 30,000 the Snail maze
  has 4,950 to 5,326 agents (5,331 to 5,854 before) and the Corn maze 2,968 to 3,156 (3,286 to 6,903).
- **Where a food comes back, the colony needs up to twice as long**: 300 to 2,000 steps in the regrowth test of
  ADR 0029 (300 to 1,000 before).
- **Tools.** The list of wrong rules has 298 entries (288 before). `variant.ts` has the variants `leaky`, the mark of
  before, and `mark`; its variants `floor`, `left+floor` and `parent+floor` are gone, because `floor` is the rule of
  the app. `measure-mazes.ts` has `WINDOW` and `UNTIL` for long runs and `GROUND` for the trail on closed ground.
  `births.ts` reads the time of the mark from the engine; it held the 18 h as a number of its own.
- `TODO.md` has what the stages 2 to 4 of the plan need from this record.

## Open points

- **The time of 6 days is second hand.** It is the longest avoidance of slime that a source of the docs reports, for
  a large culture. No source measured a life time. The owner can set another time; stage 2 of the plan makes it a
  setting.
- **The return after the fade.** With a mark that fades, the colony comes back when it has faded (Results). Measured
  with two seeds to step 220,000. Not measured: the returns after that.
- **One time for all ground below fresh.** The new time also slows ground that a tube left before it starved (D from
  0.01 to below 0.2): it is fresh again after up to 58 h, and after 7 h before. A child can be born there, but an
  agent starves faster there than on fresh ground. This can be a part of the shorter Tokyo network; no run takes it
  apart from the mark. Stage 2 decides whether the slime gets a field of its own. With one, the flow memory could
  recover in 18 h again, and the Tokyo scenes could go back to 1.4.
- **The flow strength of 2.8** gives the total length of the organism at the time of its experiment, step 48,000.
  It was chosen from three strengths on three seeds and then measured on ten. After that step the network is
  shorter, about 1.6. The owner can take another strength.
- **Agents walk onto closed ground.** They draw twigs of 20 to 60 cells beside a tube, and in the Corn maze the
  measure counts them as a tube on a side route in about a fifth of the dumps. The mark stops births and no moves.
  A rule for the moves belongs to the slime of stage 2.
- **Open ground inside the dead ends**: 3 to 6 % in the Snail maze and 8 to 10 % in the Corn maze, where a tube
  vanished before it starved. `mark` closes it, and it costs the Tokyo scene its regrowth (decision 2).
- **Not measured**: WebGL2 beyond step 30,000 in the mazes and beyond step 24,000 on the Tokyo map; the scenes of
  ADR 0032 with more than one seed; the Maze beyond step 48,000.
- The question to the owner of ADR 0052 stays open: what the owner meant by slime that "should also be perfused".
