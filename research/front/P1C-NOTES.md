# The food pays the growth: study 1c

Study 1c of phase 1 of the [plan of 2026-11-22](PLAN-2026-11-22.md) (its part 3.3, option 2), which the owner approved
on 2026-11-22. It runs in the CPU prototype only: no rule, pass or scene of the app changes.
[ADR 0093](../../docs/adr/0093-the-food-pays-the-growth.md) holds what it recommends; the owner decides at gate 1. An
agent ran it on 2026-11-22.

## The story

**The question.** With the rules of the growth front, a fixed budget pays the births at the rim: 2 · I0 / 20 per step,
0.8 at a Flow strength of 8 (`docs/model.md`, 9.1). It does not grow with the food. Can it grow with each covered food,
so that more food gives more mass?

**The dish.** The dish of Food ring: 384 cells, a food in the middle and eight on a ring. The same dish with the food
of the middle alone. The rules of the growth front in the forms of the engine, a Flow strength of 8, 20,000 steps
(11 hours of model time). At the scene's strength of 2 the colony never reaches the ring (the survey). `feed.ts` keeps
a ledger of every birth and death by its kind.

**Where the paid births go.** Where every agent goes: it dies soon. With one food, from step 10,000 to step 20,000,
the colony of about 5,900 agents has 38 to 42 births of Jones' rule, 3.5 to 4.2 respawns and 0.8 paid births in each
step, and 42 to 46 deaths: 36 to 39 by starvation, 7 by crowding (6 seeds). An agent lives 120 steps on average: four
minutes. The budget itself is not lost. After step 2,000 the cap of the agents of the front cuts nothing, and 99 % of
the paid claims win their cell. A paid child lives 230 steps on average and then dies, half by starvation and half by
crowding, as its neighbours do. So the paid births are less than 2 % of the births, and the count of agents does not
follow them. It follows the ground on which agents can live: the ground that the flux feeds, and fresh ground while
its credit lasts. At step 20,000 a third of the agents sit on closed ground and starve. Study 1b measured the same
turnover in the engine (ADR 0092).

**Births alone give little mass.** The form `feed=foods` pays the births of one food for each covered food: nine
times the paid births. The colony with nine foods then holds 1.5 to 1.8 times the agents of the colony with one, and
its count falls in some windows of 2,000 steps (3 of 3 seeds). The extra children crowd the rim: the deaths by
crowding rise from 7 to 26–30 per step.

**More flux gives mass.** The form `feed=flux` lets each covered food give the front the flux that one food gives
today: the sinks take S = 2k · I0 times the covered foods, and the budget follows that flux, one birth for 20k of flux
as today. The flux feeds more ground. The deaths by starvation fall from 36–39 to 17–26 per step, and Jones'
births rise from 38–42 to 69–84. The colony with nine foods holds 3.7 to 4.4 times the agents of the colony with one,
on 6 of 6 seeds.

**The rate.** No source that this study found gives a gain of mass per food. Mohberg and Rusch (1969) grew plasmodia
on a rich medium: their mitoses came "about 8 hr" apart, and RNA and protein rose "essentially logarithmically". At
best the mass doubles in about 8 hours, 14,400 steps. The agents of the model are not mass. The colony with one food
grows from 50 to 5,900 agents in 11 hours of model time, 118 times, at the density of Jones' rule: it spreads, it does
not gain mass. So the rate of the rule is a choice of the app. The form `flux` adds no number: the flux of a food and
the price of a birth are those of today.

**The size of the colony.** The form has no term for it. A budget that grows with the agents changes the run of one
food, and the measures pass without one. It belongs to a model in which the agents are mass (below).

## The measures

The rules with one food: today's rule and both new forms give the same run, row for row (3,000 steps, `same` of
`p1c.sh`; the test of `research.test.ts`). So the row "one food" holds for all of them. Agents at step 20,000:

| Case                     | Seeds | Agents, median (range)    | Nine against one, seed by seed     | No stall: windows without growth |
| ------------------------ | ----- | ------------------------- | ---------------------------------- | -------------------------------- |
| One food                 | 6     | 5,909 (5,780 to 6,160)    | –                                  | none                             |
| Nine foods, today        | 3     | 7,482 (6,968 to 8,119)    | 1.18, 1.26, 1.32                   | on 2 of 3 seeds                  |
| Nine foods, `feed=foods` | 3     | 9,656 (9,469 to 10,797)   | 1.83, 1.62, 1.54                   | on 3 of 3 seeds                  |
| Nine foods, `feed=flux`  | 6     | 24,320 (22,686 to 26,395) | 4.07, 4.43, 3.68, 4.12, 4.39, 4.23 | one window on seed 5             |

- **More food, more mass**: `feed=flux` passes on 6 of 6 seeds (at least 3 times). Today and `feed=foods` fail.
- **No stall**: one food grows in every window, by 62 to 416 agents in the last one. With `feed=flux` the count falls
  once, on seed 5 from step 14,000 to 16,000 (16,124 to 15,880): the boom at the ninth food and its fall, the subject
  of study 1b. The two other forms stall more often.
- **No number fitted**: the rate is a choice of the app; `feed=flux` adds no number.
- **Not measured**: with `feed=flux` the territory fills the dish by step 20,000 on every seed (1 to 401 open cells
  left beside it), so the dish caps the ratio. Food ring at its own strength of 2 covers one food in 20,000 steps, so
  the form does not change it in that time.

## The look

`research/front/out/p1c/p1c-seed1.png` and `p1c-seed2.png` of the main checkout (not in git): the rows are one food,
nine foods today, `feed=foods` and `feed=flux`; the columns the steps 5,000, 10,000 and 20,000. Up to the second food
all rows look alike. Today nine foods give a network between the foods. With `feed=flux` the colony fills the dish,
and a thick band of plasm lies along its wall, with veins that stream along it; the network inside thins. The band
comes once the territory meets the wall: the last open ground then takes the flux of nine foods, and the drift reads a
pressure nine times as steep.

## What it means for phase 2

1. **Port `feed=flux`.** It passes the measures and adds no number. The scenes with the rules keep their bytes while
   they cover one food or none: the Crown of veins always, the Y-mazes and Slime everywhere until a second food. Watch
   the band at the wall and the drift of a large flux in the scenes.
2. **With study 1b.** Study 1b proposes that every birth comes from the budget while the rules run (ADR 0092). Then the
   turnover above needs pay: today about 45 births per step hold 5,900 agents, against a budget of 0.8. At today's
   deaths the colony would shrink to about the budget times the lifetime, 0.8 · 120 ≈ 100 agents. So that rule needs
   the deaths to give their plasm back to the budget, as the organism pulls the plasm of a dying branch back into its
   tubes. Then the mass changes by what the food pays and by nothing else, the agents become mass, and the rate of
   Mohberg and Rusch becomes a limit: at most one doubling in 14,400 steps, N · ln 2 / 14,400 births per step. That
   limit is the term for the size of the colony, and it changes the run of one food (0.8 per step is more than it
   below 16,600 agents). It needs a study of its own; this one did not run it.
3. **Not `feed=foods`**: more births without more flux crowd the rim and give little mass.

## Commands

From the root of the repository. Records and pictures go to `research/front/out/p1c/`, which git ignores.

- `bash research/front/p1c.sh probe`: seed 1 of today with one and nine foods, and of both new forms with nine.
- `SEEDS="2 3" bash research/front/p1c.sh campaign "fixed 1" "flux 9" "fixed 9" "foods 9"`, then `SEEDS="4 5 6"`
  with `"fixed 1" "flux 9"`: the campaign; a run of 20,000 steps takes 16 to 30 minutes on a busy machine.
- `bash research/front/p1c.sh same`: one food gives today's run with each form.
- The table: `node --import ./research/flow/register.mjs research/front/feed-table.ts research/front/out/p1c/probe
research/front/out/p1c/c6`; `feed.ts table=<record> span=2000` prints the ledger of one run.

## Source

J. Mohberg and H. P. Rusch (1969), Growth of large plasmodia of the myxomycete _Physarum polycephalum_, Journal of
Bacteriology 97 (3): 1411–1418, [doi:10.1128/jb.97.3.1411-1418.1969](https://doi.org/10.1128/jb.97.3.1411-1418.1969).
