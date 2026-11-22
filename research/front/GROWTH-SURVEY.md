# What stops the growth: a survey of the scenes

Phase 0b of the plan of 2026-11-22 (its option 1 of section 3.3; the plan is not in git), which the owner approved on
2026-11-22. The owner sees many experiments stop near 25,000 agents with food and room left. This survey runs every
scene with growth and names the rule that stops it. It measures only: no rule, pass or scene changed. An agent ran it
on 2026-11-22.

## The answer

- **Without the rules of the growth front, the flow stops the growth.** Each scene with two foods or more peaks by
  step 4,650 and holds a fifth to four fifths of its peak at step 20,000. Once the colony covers two foods, the flow
  starves the tubes without flux, and their ground stays closed for children for about 160,000 steps (ADR 0054).
- **With one food or without the flow, Jones' rule holds a density.** The colony covers its ground and stops there
  (Crown of veins and Slime everywhere without the rules, and the two scenes of the Jones model).
- **With the rules, the colony still grows at step 20,000 in 10 of 16 runs, but slowly:** 0.03 to 0.30 agents per
  step. The flux that the front takes pays its births: the budget of these births grows by a tenth of the Flow
  strength per step, and each growth step spends it. Flow strength is the lever: 8 in place of 2 gave Food ring a
  peak of 10,932 agents in place of 1,232. In the 6 other runs with the rules, the flow has closed the ground.
- **The capacity is never the limit.** No strain held more than 87 % of its share, and twice the capacity left the
  peak of Three strains as it was.
- **Food is no limit either.** No rule eats food, and the colony covers the foods it reaches.

## How the survey ran

- The runner `growth-survey.gpu.test.ts` takes each scene whose settings have growth: 18 of the 33 scenes. It runs
  each on WebGPU with the scene's own seed and lattice, on the canvas of the digests (1280 × 800 pixels, so Foraging
  maze, the only scene without a lattice, has 512 × 320 cells), for 20,000 steps of `sim.run()` without frames.
- Each scene runs twice: as it is, and with the rules of the growth front switched by a patch of its settings
  (`territory`). The two scenes of the Jones model run once: the rules need the flow, and that model has none.
- The record: the alive agents every 50 steps, and every 500 steps per strain the capacity, the plasm, the open
  cells within 4 cells of plasm (reached), the tube cells, the open cells with a flow memory below 0.01 (closed for
  children), the covered food sites, and with the rules the territory and the state of the sinks with the budget.
  Pictures at the steps 5,000, 10,000 and 20,000.
- Five more runs change one setting each (the levers below). The 39 runs took about 30 minutes of GPU.
- `growth-table.ts` makes the table from the records:
  `node --import ./research/flow/register.mjs research/front/growth-table.ts research/front/out/survey md`.
  The records and the pictures are in `research/front/out/survey/` of the main checkout, outside git: `<run>.jsonl`,
  and `<run>-05000.png`, `-10000.png` and `-20000.png`.

## How a row gets its limit

A row gets the first limit that fits at step 20,000. **Capacity**: a strain held at least 95 % of its share of the
capacity. **The budget**: the rules run, and the count still rises: it is at least 85 % of its peak and 2 % above
the count of step 16,000. Each such row spends its budget at every growth step (less than 2 births per strain remain
after the step), and the levers show that a larger budget gives more growth. Without the rules such a row would get
**none**; no row did. **Closed ground**: the flow has closed at least a third of the ground that the colony holds or
held, that is of the closed cells and the reached cells together. **Density**: else. Then no ground is closed, and
Jones' rule holds the count on the ground that the colony covers.

## The table

"Scene" is the setting of the scene, and "patch" the switched one. Why: the share of the ground of the colony that is
closed, or the rise of the count against the growth of the budget.

| Scene                | Rules       | Peak (step)     | Step 20,000 | Limit         | Why                                                                               |
| -------------------- | ----------- | --------------- | ----------- | ------------- | --------------------------------------------------------------------------------- |
| Three strains        | off (scene) | 29,434 (900)    | 9,202       | closed ground | 86 % closed; a strain at 81 % of its capacity                                     |
| Three strains        | on (patch)  | 21,505 (19,300) | 20,811      | budget        | +0.16 per step, budget 0.80 per step and strain; a strain at 87 % of its capacity |
| Two strains          | off (scene) | 29,311 (3,050)  | 6,663       | closed ground | 87 % closed; a strain at 79 % of its capacity                                     |
| Two strains          | on (patch)  | 14,120 (14,850) | 11,445      | closed ground | 66 % closed                                                                       |
| Fleeing light        | off (scene) | 6,634 (1,750)   | 1,342       | closed ground | 93 % closed                                                                       |
| Fleeing light        | on (patch)  | 1,139 (19,400)  | 1,103       | budget        | +0.05 per step, budget 0.20 per step                                              |
| Foraging maze        | off (scene) | 17,994 (3,300)  | 3,304       | closed ground | 96 % closed                                                                       |
| Foraging maze        | on (patch)  | 5,116 (19,750)  | 5,062       | budget        | +0.13 per step, budget 0.80 per step                                              |
| Snail maze           | off (scene) | 15,223 (4,650)  | 5,852       | closed ground | 86 % closed                                                                       |
| Snail maze           | on (patch)  | 3,785 (19,350)  | 3,354       | budget        | +0.09 per step, budget 0.80 per step                                              |
| Corn maze            | off (scene) | 11,351 (3,850)  | 3,233       | closed ground | 95 % closed                                                                       |
| Corn maze            | on (patch)  | 2,979 (20,000)  | 2,979       | budget        | +0.13 per step, budget 0.80 per step                                              |
| Tokyo rail network   | off (scene) | 8,096 (1,300)   | 3,878       | closed ground | 66 % closed                                                                       |
| Tokyo rail network   | on (patch)  | 1,891 (19,150)  | 1,841       | budget        | +0.11 per step, budget 0.28 per step                                              |
| Tokyo with light     | off (scene) | 7,086 (1,150)   | 4,125       | closed ground | 52 % closed                                                                       |
| Tokyo with light     | on (patch)  | 2,019 (19,950)  | 2,019       | budget        | +0.16 per step, budget 0.28 per step                                              |
| Food ring            | off (scene) | 8,638 (1,300)   | 2,085       | closed ground | 90 % closed                                                                       |
| Food ring            | on (patch)  | 1,232 (19,950)  | 1,199       | budget        | +0.03 per step, budget 0.20 per step                                              |
| Rival networks       | off (scene) | 19,060 (2,450)  | 4,184       | closed ground | 91 % closed; a strain at 52 % of its capacity                                     |
| Rival networks       | on (patch)  | 2,594 (20,000)  | 2,594       | budget        | +0.04 per step, budget 0.20 per step and strain                                   |
| Tokyo, two networks  | off (scene) | 15,283 (2,600)  | 9,120       | closed ground | 60 % closed                                                                       |
| Tokyo, two networks  | on (patch)  | 4,487 (18,700)  | 4,040       | closed ground | 57 % closed                                                                       |
| Y-maze with slime    | on (scene)  | 1,010 (5,500)   | 610         | closed ground | 63 % closed                                                                       |
| Y-maze with slime    | off (patch) | 823 (900)       | 639         | closed ground | 39 % closed                                                                       |
| Y-maze, both slimed  | on (scene)  | 1,078 (4,300)   | 638         | closed ground | 62 % closed                                                                       |
| Y-maze, both slimed  | off (patch) | 737 (1,050)     | 531         | closed ground | 45 % closed                                                                       |
| Y-maze without slime | on (scene)  | 997 (4,350)     | 613         | closed ground | 63 % closed                                                                       |
| Y-maze without slime | off (patch) | 768 (900)       | 583         | closed ground | 37 % closed                                                                       |
| Slime everywhere     | on (scene)  | 1,934 (11,300)  | 361         | closed ground | 94 % closed                                                                       |
| Slime everywhere     | off (patch) | 2,658 (850)     | 1,777       | density       | no ground closed (one food: no flux)                                              |
| Crown of veins       | on (scene)  | 8,641 (19,900)  | 8,599       | budget        | +0.30 per step, budget 0.80 per step                                              |
| Crown of veins       | off (patch) | 14,914 (13,850) | 13,987      | density       | no ground closed (one food: no flux); the box is full                             |
| Coarsening network   | off (scene) | 27,194 (50)     | 29          | density       | Jones model: the network closes to a spot (ADR 0045)                              |
| Voronoi diagram      | off (scene) | 12,105 (50)     | 4,857       | density       | Jones model                                                                       |

## The levers

Each lever run is a row of the table with one setting changed. It says which setting moves which limit.

| Lever                             | Scene and rules          | Peak (step)     | Step 20,000 | The row without the lever |
| --------------------------------- | ------------------------ | --------------- | ----------- | ------------------------- |
| Flow strength 8 in place of 2     | Food ring, rules on      | 10,932 (14,650) | 6,911       | 1,232 (19,950), 1,199     |
| Flow strength 16 in place of 8    | Crown of veins, rules on | 13,935 (19,850) | 13,892      | 8,641 (19,900), 8,599     |
| Flow strength 8 in place of 2     | Food ring, rules off     | 9,162 (1,300)   | 2,994       | 8,638 (1,300), 2,085      |
| Slime life time 12 hours, not 144 | Food ring, rules off     | 9,868 (1,450)   | 2,809       | 8,638 (1,300), 2,085      |
| Capacity 0.5 in place of 0.25     | Three strains, rules off | 29,547 (1,150)  | 11,206      | 29,434 (900), 9,202       |

- **The budget is the lever with the rules.** Four times the Flow strength gave Food ring nine times the peak, and
  twice the strength gave the Crown of veins 1.6 times the agents. With strength 8, Food ring with the rules reached
  all 9 foods; then the flow closed half of its ground, and the count fell from its peak.
- **Closed ground moves with Slime life time and Flow strength.** A slime life time of 12 hours opens the closed
  ground again after about 13,000 steps: Food ring then holds 2,809 agents at step 20,000 in place of 2,085. A
  stronger flow keeps more side routes: 2,994 agents.
- **The capacity does not move the peak.** Three strains fills its dish at the peak: fresh ground, open and not
  reached, is 7 % of the dish then.

## What the help texts say now

`src/model/params.ts`, each statement with its rows:

- **Growth and shrinkage**: the rule holds a density, so the colony stops when it covers its ground (Crown of veins
  and Slime everywhere without the rules); with the flow the count falls after its peak (every row "closed ground"
  without the rules); the rules let it grow on at a rate that Flow strength sets (rows "budget", levers); no scene filled
  its capacity.
- **Capacity**: each strain gets its share; growth stops there only when all of a strain's agents live; no strain
  held more than 87 %, and twice the capacity left the peak of Three strains as it was.
- **Flow strength**: with the rules it sets how fast the colony grows (lever of Food ring and of the Crown of veins);
  without them a higher strength keeps more of the colony after the pruning (lever of Food ring).
- **Rules of the growth front**: the births that the flux pays come as fast as the budget grows; the colony keeps a
  part of them and still grew in 10 of 16 runs; where it covers foods, the flow closes ground and the count falls
  (Y-mazes, Slime everywhere, Two strains, Tokyo, two networks).
- **Flux to the front**: Flow strength sets the number of the paid births.
- **Flow in the tubes** and **Slime life time**: the closed ground ends the growth of most scenes, and a shorter slime
  life time lets a colony grow back sooner (lever of Food ring).

## Limits that the plan did not name

1. **With the rules, the flow closes ground too.** At step 20,000, 49 to 93 % of the territory of each run with the
   rules is closed for children. In 6 of the 16 runs with the rules, this and not the budget holds the count. The plan
   (3.1 c) named only the budget for the rules.
2. **Most paid births do not stay.** A colony with the rules gains 7 to 57 % of the agents that its budget can pay
   (Three strains 0.16 of 2.40 per step, Tokyo with light 0.16 of 0.28). The rest is lost again; this survey does not
   measure where.
3. **A full dish.** The Y-mazes fill their maze before the flow closes part of it: the plasm reaches 82 to 96 % of it
   at step 20,000. The plan named the size of the dish (3.1 e), but no run had shown it.

## Where 25,000 may come from

Two strains and Three strains peak near 29,400 agents, at steps 3,050 and 900, and then fall to 6,663 and 9,202. The
other scenes peak lower. The owner's link of Food ring on 1536 × 864 cells peaks at 35,498 (plan, 3.1 b). This is a
guess: the scenes of the owner's number are not known.
