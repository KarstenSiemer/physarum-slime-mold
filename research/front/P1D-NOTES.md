# The rules of 1b and 1c together, and the band at the wall: study 1d

Study 1d of phase 1 of the [plan of 2026-11-22](PLAN-2026-11-22.md), which the owner chose at gate 1 on 2026-11-23
([ADR 0096](../../docs/adr/0096-gate-1-study-1d-before-a-port.md)). It runs in the CPU prototype only: no rule, pass
or scene of the app changes. [ADR 0097](../../docs/adr/0097-paid-births-thin-the-sheet-and-fill-the-dish.md)
holds what it recommends; the owner decides at the next gate. An agent ran it on 2026-11-23.

## The story

**The rules.** Two options of `sim.ts`, off by default. Rule 1 (`payAll`, ADR 0092, option 3): every birth costs one
from the budget, Jones' births and the respawn too. Rule 2 (`refund`, ADR 0093, consequence 3): a dying agent gives one
back. Then the agents plus the budget change only by what the food credits (a test of `research.test.ts`). Both run
with `feed=flux` of study 1c. The forms port to a GPU: the respawns of a pass and the parents of Jones' rule of a growth
pass are counted, and each one claims with the chance min(1, B / n), a draw of its own; the front takes the whole part
of the budget by the ranks of `paid.ts`; each pass settles its births and deaths in the next, as atomic counts do. Two
orders: Jones' births first (`payAll=jones`) or the front first (`payAll=front`). Without the rules every run keeps its
bytes: the test, and the runs of today, which give the records of study 1c row for row over 20,000 steps.

**One food.** The colony grows by what the food credits, 0.8 agents per step: 7,860 to 7,954 agents at step 10,000,
against 4,220 to 4,331 today (3 seeds). The budget stays below 200 while the colony has room. The order decides where
the births go. With the front first, the plasm of the agents that die on old ground pays births at the front: per step
26 to 32 births at the front and 0.1 of Jones' rule, against 29 to 33 of Jones' rule today. The sheet behind the front
falls to 0.09 to 0.16 at step 10,000 (today 0.75 to 0.79): a ring of plasm at the rim, and veins inside. With Jones'
births first the sheet stays (0.51).

**The agents on old ground** are born there. Today 44 to 45 % of the agents sit on ground that the front reached more
than 1,500 steps before; 99 to 100 % of them were born on old ground, 91 to 93 % by Jones' rule, the rest respawns. So
in this dish they do not walk in from the front: the flux keeps old ground fed, and Jones' rule fills it. With the front
first only 11 to 20 % of the agents sit there, mostly respawns on veins (77 to 89 %).

**The full dish.** The rules fill the dish of Food ring early: with one food at step 12,000 (front first, 3 seeds) or
15,000 (Jones first), with nine foods at 10,000 to 14,000. Then no open ground lies beside the territory, the front has
no sink, and the flux to the front stops: with one food no flux flows at all, with nine the flux between the foods goes
on. The tubes starve, and the colony falls: with one food from about 9,150 agents to 2,465 to 4,177 at step 20,000
(−61 to −68 %), with nine foods from 28,000 to 29,600 to 2,895 to 3,166. The budget holds the rest of the mass: 6,105
to 8,009 with one food, 35,290 to 38,164 with nine. With nine foods a ring of tubes between the foods remains. Today's
`feed=flux` falls the same way once it fills the dish: 24,002 agents at step 20,000, 3,521 at step 26,000 (seed 1).

**Nine foods.** With the front first, nine foods credit 7.2 agents per step to a colony of 4,000. The agents rise by
102 to 114 % within 1,000 steps of the second food (Jones first +44 %, today's `feed=flux` +56 to +96 %). The front
cannot place all of it: per step 41 to 42 births at the front and 61 to 73 of Jones' rule, and 84 to 90 deaths by
crowding. The sheet comes back (0.75 to 0.79 at step 10,000). At step 20,000 nine foods hold 0.76 to 1.17 times the
agents of one, because both dishes are full; the mass, agents plus budget, is 3.65 to 3.92 times. At step 10,000,
before the nine foods fill the dish, the agents are 3.51 to 3.73 times.

**Question 1: the budget.** While the colony has room the budget stays small: below 200 with one food, and at the
second food about 100. It grows in two cases. The credit of nine foods outruns the births: with Jones first from 1,098
at step 10,000 to 9,986 at step 13,000, with room left. And a full dish: the plasm of the starving agents comes back,
and no birth can spend it (6,105 to 40,128 at step 20,000). In these runs no food came after the budget grew, so no
run shows a stored budget spent at once; the rise at the new foods is the credit itself. A cap follows from the model:
the budget of `docs/model.md` 9.1 never exceeds the agents of the front. Put on the credit (`feedCap`), it stops the food
while the front cannot spend, and it destroys no plasm. With nine foods it keeps the budget at 51 to 525 while the
colony has a front (cap-f9). It does not end the rise (+119 %), and it does not touch the plasm of a full dish (18,020
at step 20,000): no credit flows then. No rate of spending follows from the model; the only rate with a source is that
of question 2.

**Question 2: the rate of Mohberg and Rusch.** Under the limit (`double=14400`) the mass grows by at most
mass · ln 2 / 14,400 per step. Measured: 130 agents at step 20,000, with one food and with nine (seed 1; 50 · 2^(20,000 /
14,400) = 131). The colony never reaches the ring, and at step 20,000 it has left its own food. So the limit stops a
young colony. As a check, not a rule: 2,640 steps is the shortest doubling that keeps every rise within 30 % in 1,000
steps (1,000 · ln 2 / ln 1.3). With it one food grows to 6,413 agents (today 5,896) with a sheet of 0.06, and nine foods
to 9,349: 1.46 times. So no doubling passes both No boom and More food, more mass in this dish by step 20,000.

**What it means for the agents as mass.** The organism's front moves at about 1 cm/h ([fidelity.md](../../docs/fidelity.md),
row of the front), while its mass doubles in 8 hours at best: it covers ground by thinning, not by growth. Jones' rule
keeps the density of the agents (a child only with 1 to 10 agents in the 9 × 9 block, death above 20 in the 5 × 5
block), so an agent stands for an area of plasm. As mass, the colony of 50 agents could not cover the dish: to hold
today's 5,900 agents at step 20,000 at the rate of the source it must start with about 2,250. Rule 2 also hides mass:
at a full dish most of it lies in the budget, which no picture shows.

**The band at the wall.** It is the zone behind the front that the flux of nine foods makes wide. Each case changes one
thing; the table below has the numbers.

- Not the wall: in a dish of 512 cells, which the territory does not fill, the same zone lies at the rim.
- Not the paid births: with a flux that pays no birth (`paid=1e12`) the zone forms the same.
- Not more births: nine times the paid births with the flux of one food (`feed=foods`) give a narrow zone.
- The flux of nine foods keeps the ground fed: 87 to 100 % of the cells within 48 cells of the rim have D ≥ 0.01,
  against 7 to 71 % with the flux of one food.
- The drift of nine foods carries the agents into it: with the drift over the covered foods (`driftPerFood`), so that it
  reads the pressure of one food, the zone stays narrow, and the colony grows slower (7,520 agents at step 20,000).
- Free births fill it: under a limit of the growth (the check of 2,640 steps) the zone is fed but nearly empty.

So the guess of study 1c is half right. The drift reads a pressure nine times as steep, and that makes the zone; the
last open ground is not needed, as the zone forms before the territory meets the wall. At the wall the front stops,
and the zone lies along it. With rules 1 and 2 the zone forms too, before the dish is full (front first at step 9,000).

**The organism at the wall.** Two web searches found no report of a band along the wall of a dish. At a barrier the
plasmodium stops or turns and goes around it; with a full hydrophobic barrier it "showed almost no growth" (Lee et al.
2023). No source supports the band.

## The measures

Dish of Food ring, Flow strength 8, `feed=flux` unless named. Seeds 1 to 3 where three are named, else seed 1.

| Case                                        | Seeds | Agents at 10,000 | Agents at 20,000 | Budget at 20,000 | Nine against one | Rise from the second food; fall | Windows without growth | Sheet at 10,000; 20,000 |
| ------------------------------------------- | ----- | ---------------- | ---------------- | ---------------- | ---------------- | ------------------------------- | ---------------------- | ----------------------- |
| Today, one food (`feed=fixed`)              | 3     | 4,220–4,331      | 5,896–6,160      | 2                | –                | –; −1 to −2 %                   | none                   | 0.75–0.79; 0.43–0.46    |
| Today, nine foods (`feed=flux` of 1c)       | 3     | 4,269–5,320      | 22,686–26,395    | 15–23            | 3.68–4.43        | +56 to +96 %; 0 to −9 %         | none                   | 0.71–0.87; 0.56–0.73    |
| Rules 1 and 2, front first, one food        | 3     | 7,860–7,954      | 2,465–4,177      | 6,105–8,009      | –                | –; −61 to −68 %                 | 2 to 4, from 14,000    | 0.09–0.16; 0.13–0.20    |
| Rules 1 and 2, front first, nine foods      | 3     | 27,578–29,631    | 2,895–3,166      | 35,290–38,164    | 0.76–1.17        | +102 to +114 %; −50 to −55 %    | none (no room)         | 0.75–0.79; 0.14–0.15    |
| Rules 1 and 2, Jones first, one; nine       | 1     | 7,911; 14,677    | 2,711; 3,504     | 9,828; 40,128    | 1.29             | nine: +44 %; −60 %, −59 %       | 2; 3                   | 0.51, 0.92; 0.13, 0.17  |
| Front first, cap of 9.1 on the credit, nine | 1     | 21,228           | 3,608            | 18,020           | –                | +119 %; −49 %                   | 5                      | 0.65; 0.17              |
| Rule 1 alone, one food                      | 1     | 195              | 357              | about 0          | –                | –                               | 1                      | 0.29; 0.30              |
| Doubling of 14,400 steps, one; nine         | 1     | 80; 80           | 130; 130         | about 0          | 1.00             | –                               | none                   | 0.54; 0.36              |
| Check: doubling of 2,640, one; nine         | 1     | 679; 688         | 6,413; 9,349     | 103; 162         | 1.46             | nine: +32 %; 0 %                | none                   | 0.64, 0.67; 0.06, 0.33  |

- **More food, more mass** (at least 3 times at step 20,000): only today's `feed=flux` passes in agents. The rules fill
  the dish first; in mass they pass (3.65 to 3.92), and in agents at step 10,000 (3.51 to 3.73).
- **No stall**: the rules grow in every window until the dish is full, then they fall.
- **No boom** (within ±30 %): no case with nine foods passes but the check of 2,640 steps (+32 %, just above).
- **No sheet** (at most 0.3): the front first passes with one food on 3 of 3 seeds, before the dish is full.

Births and deaths per step, steps 5,001 to 10,000 (before any dish is full), one food:

| Case                    | Seeds | Jones' births | At the front | Respawns | Starved   | Crowded   |
| ----------------------- | ----- | ------------- | ------------ | -------- | --------- | --------- |
| Today                   | 3     | 28.5–32.6     | 0.8          | 0.6–1.1  | 16.7–20.2 | 13.2–13.5 |
| Rules 1 and 2, front    | 3     | 0.1–0.2       | 26.4–31.6    | 2.8–2.9  | 4.7–5.2   | 23.9–28.8 |
| Rules 1 and 2, Jones    | 1     | 38.8          | 14.9         | 1.2      | 25.0      | 29.0      |
| Front first, nine foods | 3     | 61.0–72.7     | 40.5–42.4    | 1.4–1.7  | 16.2–19.9 | 83.8–89.8 |

The band: agents per cell by the distance from the edge of the territory, and the share of fed cells (D ≥ 0.01):

| Case (seed 1 unless named)                        | Step   | 0–6 cells | 6–12 | 12–24 | 24–48 | Beyond | Fed, 0–6 / 6–12 / 12–24 / 24–48 |
| ------------------------------------------------- | ------ | --------- | ---- | ----- | ----- | ------ | ------------------------------- |
| One food, today (seed 2)                          | 15,000 | 0.48      | 0.09 | 0.07  | 0.07  | 0.05   | 0.71 / 0.07 / 0.24 / 0.25       |
| Nine foods, the flux of one (today's rule)        | 20,000 | 0.38      | 0.31 | 0.14  | 0.04  | 0.05   | 0.85 / 0.85 / 0.58 / 0.14       |
| Nine foods, the births of nine (`feed=foods`)     | 20,000 | 0.41      | 0.23 | 0.15  | 0.15  | 0.07   | 0.77 / 0.50 / 0.53 / 0.52       |
| `feed=flux`                                       | 15,000 | 0.57      | 0.38 | 0.35  | 0.31  | 0.10   | 1.00 / 1.00 / 1.00 / 0.87       |
| `feed=flux`, no paid birth                        | 20,000 | 0.57      | 0.37 | 0.26  | 0.11  | 0.05   | –                               |
| `feed=flux`, dish of 512 cells                    | 20,000 | 0.67      | 0.53 | 0.35  | 0.27  | 0.07   | –                               |
| `feed=flux`, the drift of one food                | 20,000 | 0.26      | 0.30 | 0.13  | 0.06  | 0.07   | 0.72 / 0.81 / 0.50 / 0.23       |
| Rules 1 and 2, front first                        | 9,000  | 0.69      | 0.50 | 0.31  | 0.23  | 0.08   | –                               |
| Check: doubling of 2,640, front first             | 20,000 | 0.33      | 0.26 | 0.10  | 0.03  | 0.00   | 0.98 / 0.98 / 0.97 / 0.97       |
| `feed=flux`, from the wall of the dish (the band) | 20,000 | 0.21      | 0.37 | 0.31  | 0.35  | 0.11   | –                               |

A dash: the run was made before the runner counted the fed cells.

## Not measured

- Six seeds: today and the front first ran on seeds 1 to 3, every other case on seed 1. All rules fail at step 20,000
  for the full dish, which the plan says runs no campaign. About 20 runs of 15 to 35 minutes, CPU only.
- The rules in a dish that the territory does not fill in 20,000 steps: More food and No stall without the full dish.
  A dish of 640 to 768 cells, 1 to 2 hours per run on the CPU.
- A stored budget spent at a new food: no run had a food that came after the budget grew. A scene with a food that
  appears after the dish is full, 2 runs.
- Jones first with the cap (`jcap-f9`): stopped unfinished to close the study.
- The engine and WebGL2.

## Commands

From the root of the repository. Records and pictures go to `research/front/out/p1d/`, which git ignores.

- `bash research/front/p1d.sh probe [case...]`: seed 1 of each case; `SEEDS="2 3" bash research/front/p1d.sh campaign
front-f1 base-f1`: more seeds. The script names the cases and their words. A run of 20,000 steps takes 15 to 40 minutes.
- `node --import ./research/flow/register.mjs research/front/p1d-table.ts research/front/out/p1d/probe
research/front/out/p1d/c6 [ledger=5000-10000]`: the tables.
- `bash research/front/p1d-montage.sh`: the pictures of seed 1, with copies of 2,000 pixels in width.

## Sources

- J. Mohberg and H. P. Rusch (1969), Growth of large plasmodia of the myxomycete _Physarum polycephalum_, Journal of
  Bacteriology 97 (3): 1411–1418, [doi:10.1128/jb.97.3.1411-1418.1969](https://doi.org/10.1128/jb.97.3.1411-1418.1969).
- T. Lee, D. Kang, M. Kim et al. (2023), Hydrophobic barriers for directing _Physarum polycephalum_ propulsion and
  navigation, ACS Omega, [PMC10634242](https://pmc.ncbi.nlm.nih.gov/articles/PMC10634242).
