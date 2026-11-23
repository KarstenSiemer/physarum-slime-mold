# 0097: Paid births thin the sheet and fill the dish

- Status: proposed. Study 1d of phase 1 of the plan of 2026-11-22, which the owner chose at gate 1
  ([ADR 0096](0096-gate-1-study-1d-before-a-port.md)). An agent ran it on 2026-11-23 under the owner's delegation of
  2026-11-12; the owner decides at the next gate.
- Date: 2026-11-23
- Extends [ADR 0092](0092-the-boom-at-a-new-food-is-jones-births-without-starvation.md) (every birth from the budget),
  [ADR 0093](0093-the-food-pays-the-growth.md) (`feed=flux`, the plasm of the dead back to the budget) and
  [ADR 0096](0096-gate-1-study-1d-before-a-port.md) (the scope of study 1d): it measures their proposals together.
- In short: the story and the tables are in [research/front/P1D-NOTES.md](../../research/front/P1D-NOTES.md).
  `research/front/p1d.sh` runs the cases, `research/front/p1d-table.ts` prints the tables, and
  `research/front/p1d-montage.sh` makes the pictures. No rule, pass or scene of the app changed.

## Context

Study 1b proposed that every birth comes from the budget of the paid births while the rules of the growth front run
(rule 1). Study 1c proposed `feed=flux`, and found that rule 1 needs a second rule: a dying agent gives its plasm back
to the budget (rule 2). The owner chose to measure them together before a port (ADR 0096), in the dish of Food ring
with one food and with nine, at a Flow strength of 8, to step 20,000, with two questions: does a budget that the colony
cannot spend make a boom of its own, and what does the rate of Mohberg and Rusch do. And the band at the wall.

## Findings

1. **Rules 1 and 2 are exact, and they port.** The agents plus the budget change only by what the food credits. The
   respawns of a pass and the parents of Jones' rule of a growth pass are counted, and each claims with the chance
   min(1, B / n); the front takes the whole part of the budget by the ranks of `paid.ts`; each pass settles its births
   and deaths in the next, as atomic counts do. The colony grows by the credit, 0.8 agents per step per covered food:
   7,860 to 7,954 agents at step 10,000 with one food, against 4,220 to 4,331 today (3 seeds).
2. **The front first thins the sheet.** When the budget pays the front before Jones' births, the plasm of the agents
   that die on old ground pays births at the front (26 to 32 per step, Jones' rule 0.1), and the sheet behind the front
   falls to 0.09 to 0.16 at step 10,000 (today 0.75 to 0.79; the aim is at most 0.3). With Jones' births first the sheet
   stays (0.51). Today the agents on old ground are born there (99 to 100 %, 91 to 93 % by Jones' rule): in this dish
   they do not walk in from the front.
3. **A full dish ends the growth.** The rules fill the dish of Food ring at step 10,000 to 15,000. Then the front has no
   sink, the flux to the front stops, the tubes starve, and the agents fall by 50 to 68 % within 5,000 to 8,000 steps,
   while the budget holds the rest of the mass (6,105 to 40,128 at step 20,000). With nine foods the flux between the
   foods goes on and holds a ring of tubes between them; with one food no flux flows. Today's `feed=flux` falls the same
   way after it fills the dish: 24,002 agents at step 20,000, 3,521 at step 26,000.
4. **Nine foods.** The credit of nine foods, 7.2 per step, meets a colony of 4,000 agents. The agents rise by 102 to
   114 % within 1,000 steps of the second food (front first, 3 seeds; Jones first +44 %). The front cannot place it all:
   Jones' births come back (61 to 73 per step) and the sheet too (0.75 to 0.79). At step 20,000 nine foods hold 0.76 to
   1.17 times the agents of one, because both dishes are full; the mass is 3.65 to 3.92 times, and at step 10,000 the
   agents are 3.51 to 3.73 times.
5. **Question 1.** While the colony has room the budget stays below 200, and about 100 at the second food: the rise at
   the new foods is the credit itself, not a stored budget. The budget grows where no birth can spend it: when the
   credit of nine foods outruns the births (Jones first: 1,098 to 9,986 from step 10,000 to 13,000, with room left), and
   in a full dish. No run had a food after that, so no run spent a stored budget. The cap that follows from the model,
   the budget of `docs/model.md` 9.1 at most the agents of the front, put on the credit so that it destroys no plasm,
   keeps the budget at 51 to 525 while the colony has a front. It does not end the rise (+119 %) or touch a full dish.
6. **Question 2.** Under the doubling of Mohberg and Rusch the colony holds 130 agents at step 20,000, with one food and
   with nine, never reaches the ring, and leaves its own food. The limit stops a young colony. As a check, not a rule:
   the shortest doubling that keeps every rise within 30 % in 1,000 steps, 2,640 steps, gives one food 6,413 agents and
   nine foods 1.46 times as many. The agents of the model are not mass: Jones' rule fixes their density, so an agent
   stands for an area of plasm, and the organism covers ground by thinning (its front moves at about 1 cm/h, its mass
   doubles in 8 hours at best). As mass, a colony needs a start of about 2,250 agents to hold today's 5,900 at step
   20,000.
7. **The band at the wall** is the zone behind the front that the flux of nine foods makes wide: 0.3 to 0.6 agents per
   cell over 48 cells, against 6 cells with one food. It forms in a dish that the territory does not fill, and without
   the paid births. Its ground is fed (87 to 100 % of the cells with D ≥ 0.01, against 7 to 71 % with the flux of one
   food). With the drift over the covered foods, so that it reads the pressure of one food, the zone stays narrow. Under
   a limit of the growth it is fed but nearly empty. So the drift of nine foods carries the agents into fed ground, and
   Jones' births fill it; at the wall the front stops, and the zone lies along it. Rules 1 and 2 keep it.
8. **The organism.** Two searches found no report of a band along the wall of a dish. At a barrier the plasmodium stops
   or turns (Lee et al. 2023, ACS Omega, [PMC10634242](https://pmc.ncbi.nlm.nih.gov/articles/PMC10634242)).

No form reaches the four aims in this dish. More food, more mass passes in agents only for today's `feed=flux`; No
stall fails once a dish is full; No boom fails for every form with nine foods but the check of 2,640 steps (+32 %); the
sheet passes only with the front first and one food.

## Options for phase 2

1. **Rules 1 and 2, the front first, the cap of 9.1 on the credit, and `feed=flux`**, as one pull request. It gives the
   mass from the food alone and a thin sheet with one food. It keeps the rise and the sheet at nine foods and the fall
   of a full dish, and most of the mass of a full dish lies in a budget that no picture shows. Cost: the port of
   `feed=flux` (ADR 0093: about 300,000 tokens and 1.5 hours of GPU), and the counts and draws of the agent pass and
   the growth pass, the settling of the budget and the cap on both backends, `docs/model.md` 9 and 9.1, wrong rules and
   the digests of every scene: about 500,000 tokens and 2.5 hours of GPU in all (an estimate).
2. **`feed=flux` alone** (ADR 0093): about 300,000 tokens and 1.5 hours of GPU. The band, the boom of study 1b and the
   fall of a full dish stay.
3. **A rate bound to the size of the colony.** The rate of the source stops a young colony, and the shortest rate that
   passes No boom gives nine foods 1.46 times one food. No port.
4. **No port now.** The owner first decides whether an agent is mass. If it is, rules 1 and 2 and the rate of the
   organism belong together, and the scenes with growth must start with the mass that covers their arena. If it is
   not, the rules of growth count area, and no rate of the organism binds them.

## Recommendation

Option 4. A port of option 1 now would change the engine twice: the answer to the question of mass changes the rate,
the start of the scenes and the picture of the budget. Phase 3 (arms) does not wait for the answer. The agent
recommends it; the owner decides at the next gate.

## Consequences

- `research/front/sim.ts` has the options `payAll`, `refund`, `double`, `feedCap` and `driftPerFood`, off by default.
  Runs without them keep their bytes: a test of `research/front/research.test.ts`, and the runs of today, which give
  the records of study 1c row for row over 20,000 steps.
- The runner `research/front/feed.ts` records the sheet, the agents on old ground by origin, the band, and every 100
  steps the agents, the budget and the covered foods.
- `TODO.md` holds what was not measured: six seeds, a dish that the rules do not fill, a stored budget spent at a new
  food, nine foods with the cap and Jones' births first or only at the edge (`jones=edge`; both runs stopped to close
  the study), the engine and WebGL2.
