# Notes of the prototype of stage 4 (working file, 2026-11-19)

Commands: `node --import ./research/flow/register.mjs research/front/comb.ts scene=dish side=160 steps=6000 pics=2000,4000 key=value ...`
and `research/front/ymaze.ts case=one seeds=1-40 ...`. Pictures and logs go to `research/front/out/` (ignored by git).

Found so far (CPU prototype `sim.ts`, one strain, the rules of forager()):

1. The prototype gives the app's Y-maze: first food after 60 to 65 steps, about 300 agents, no preference.
2. A hold on the trail (no move onto a cell with trail below the low level, chance p) gives 0.24 cells per step: the
   trail halo creeps. A hold on the tube body (B >= 0.05) gives 0.03 to 0.04 cells per step in the Y-maze and about
   0.01 in a dish without scent. p hardly matters (the body creeps); p = 0 never starts.
3. With the hold, a colony on its food stays there (the food scent holds it): no scouts.
4. Births onto ground without slime are about 0 with the hold: the trail stamps the slime before a child comes. So the
   front must be read as "within R cells of ground without slime" (reach) or "young ground" (front stamp age).
5. Sink + colony source in the Y-maze: the colony migrates as a tube with a club head; the rear retracts.
6. Agents that read minus w times the pressure (drift with the flow) leave the food and spread as a fan. With the
   app's lagged solver the drift run dies (the pressure is wrong where the network changes); with the exact solver
   (CG) it works.
7. Best so far (dish-n2-d1.25): hold body 0.01, reach 6, rim 1, norm 2 (S = 16), paid 20, drift 1.25, exact solver:
   a trunk from the food with a fan at its head; veins (D, flux) run from the trunk end to the rim; later the fan
   moves on and leaves tubes. Speed 0.028 cells per step (2.7 cm/h). Veins are parallel streaks, little forking.
8. Problem for target 3: the drift and the sink speed the front up 3 times (no drift: 0.009 c/s). On slime there is
   no sink, so no drift. Next: a territory that the front opens at a fixed speed v, the same on slime.
9. Territory (`speed`): the colony moves and is born only on its territory; an open cell joins it beside territory.
   With a fixed chance v per cell the front runs at about 2v whatever plasm lies there: both arms of the Y-maze grow
   alike (no choice, target 1 fails) even when the drift gives the blank arm 1.7 times the agents.
10. A jam: drift pushes agents against the rim; blocked agents leave no trail, so the rim loses its plasm. Fixed:
    a rim agent is a sink only with a free cell of the territory beside it ("room").
11. The tip of an arm always stands on cells with fresh flow memory (D = 0.2): starvation cannot stop an advancing
    front; only the drift can take the plasm away.
12. `speedOn=push`: each agent beside an outside cell pushes it into the territory with the chance v (speed grows with
    the thickness, Kuroda et al. 2015). With v = 0.004, drift 5: the blank arm leads 66 : 45 cells at step 3,400
    (slime weight 0) and 72 : 34 (weight 0.025). Measures in the lane (drift 1.25, fixed v): veins along the flow
    |cos| 0.98 to 0.99; delay from the front to D >= 0.5: median 1,339 to 1,856 steps (organism about 1,500).
13. The conflict: the owner's rule (only fresh ground is a sink) and target 3 (same time on slime everywhere): on
    slime everywhere there is no sink, so no drift, so less plasm at the front and a slower front with `push`.
    A weight for slime (normalized shares) would keep the speed. To measure: y2-w0-* and y2-w0.025-*.
14. The owner took the slime weight 0.025 and every form of the drift as a setting (2026-11-19). The three forms with
    the births only at the fresh rim (`out/y4`, 40 runs per case): the blank arm 39 : 1 (drift 0), 40 : 0 (1.5) and
    40 : 0 (5). Slime everywhere (the new case `all`) is 2.23, 1.48 and 1.32 times slower than no slime, and slower
    than slime on both arms (1.92, 1.27 and 1.24 times): the fresh base of the maze is not the cause (note 13 was
    wrong). Mann-Whitney p below 3e-7 for every case with slime.
15. The cause: on slime the flux pays no birth. With the births at every sink, in the share of its flux
    (`paidOn=sinks`, `out/y5`): slime everywhere 1.00, 0.95 and 0.96 times (p 0.82, 0.15 and 0.33); the blank arm
    33 : 7 (drift 0; Fisher p 0.057 against 39 : 1), 40 : 0 and 40 : 0; the first food without slime 5 to 9 % later.
    The owner decides (ADR 0065, decision 7), because the rule touches "only a birth onto fresh ground counts".
16. The owner decided on 2026-11-19 that the births follow every sink: a colony in a dish full of slime must still
    give birth. A dish of 160 cells with one food in the middle, 20,000 steps, 10 seeds (`dish.ts`, `out/dish1`):
    with the births at every sink the territory covers half of the dish as fast on slime everywhere as without slime
    (drift 1.5: 0.94 times, p 0.23; drift 5: 0.96 times, p 0.45); with the births only at the fresh rim it is 1.18
    times slower (p 0.034). No colony dies: when the dish is full, 600 to 1,100 agents live, and Jones' births go on
    (3,000 to 4,700 per 1,000 steps); the flux pays no birth then, because no sink has room. Drift 0 covers only 31 to
    40 % of the dish in 20,000 steps.
17. On slime the sinks sat nearer the rim than on fresh ground: within 2 cells of the edge of the territory, against
    within 6 cells of ground without slime. Drift 0 then grew a little faster on slime (7,117 against 5,587 cells at
    step 20,000; p 0.11). `sinkAt=edge` puts every sink at the edge of the territory and lets the fresh ground set only
    its weight (`out/y6`, `out/dish2`).
18. `sinkAt=edge` (decision 8, `out/y6`, `out/dish2`): slime everywhere gives the same runs as `sinkAt=fresh`, as it
    must. The Y-maze: 31 : 9 (tree), 40 : 0 and 40 : 0; slime everywhere 1.01, 0.98 and 1.01 times. The dish: the
    tree covers 40 % on slime and without slime (p 0.41); the crown 1.04 times (p 0.71), the fan 0.96 times (p 0.17).
19. Slime on both arms at drift 5 gave 28 : 12 in seeds 1 to 40 (p 0.017) and 32 : 47 in seeds 41 to 120: chance.
    120 seeds give 60 : 59 at drift 1.5 and at drift 5 (`out/both120`). The fresh base of the maze makes slime on both
    arms 1.07 to 1.08 times slower (p below 0.003).
20. The forms of a GPU (ADR 0067), the first try of the paid births: after the step before a growth step every cell
    with a sink rate gets a mark with the chance min(1, B · r / R), R the sum over all tube cells, and in the growth
    step the agent of the front on a marked cell claims a child. It loses most of its marks. At the end of a step
    (seed 1, steps 300 to 2,000) R is 30, 75 and 70 at drift 0, 1.5 and 5, but only 1.0, 1.7 and 1.5 of it lie on
    cells whose agent is at the rim (8 to 14 agents), and 0.6, 1.1 and 0.9 on cells whose agent also has a free cell
    beside it (5 to 9 agents). So the budget climbed to its cap, the number of sinks (50 to 120), and the paid births
    were 66 to 140 per 250 steps in place of 200 (drift 1.5). The first food came after 4,369 and 4,142 steps (seeds 1
    and 2 of the case one; 3,313 and 2,973 with the order). Not kept as an option.
21. The second try (`paidBy=ahead`): the marks go only to the cells whose agent could claim a child at the end of the
    step before, and P is the sum of their sink rates. Then about 3 cells get a mark per growth step, three of four
    marks give a claim, the budget stays between 0 and 6, and the paid births are 189 to 205 per 250 steps (drift 1.5).
    The campaign (`out/y7`, `out/dish3`) ran it with `fresh=box sums=fixed start=agents`; its records name it
    `paidBy=chance`, the word that it had then. The Y-maze keeps every result
    (Fisher p 0.25 to 1.0, Mann-Whitney p 0.078 to 0.84 against `out/y6`). The dish does not: the tree ends with 5,563
    and 5,341 cells of territory in place of 7,117 and 7,177 (slime everywhere and none; p 0.028 and 0.00088), and the
    fan covers half of the dish with slime everywhere after 4,435 steps in place of 4,128 (1.07 times, p 0.00088). In
    the dish at drift 0 the colony has about 50 agents and fewer than one agent per growth step that could claim a
    child, and that one walks on before the growth step: the paid births were 27 to 96 per 1,000 steps in the first
    10,000 steps (seed 1); with the order they were 195 to 273 in the first 5,000 steps and about 780 after. Alone,
    without `start=agents`, the second try gives the tree 20 to 53 paid births per 500 steps in its first 2,000 steps,
    the order 91 to 161 (seeds 1 and 3, no slime).
22. The third try, one run: the marks on every cell with a sink rate, and P the sum over the agents that could claim a
    child in the last growth step. In the same dish (seed 1, drift 0) it gave 11 to 78 paid births per 1,000 steps in
    the first 6,000 steps. Per growth step P was 0.01 to 0.02, 19 to 40 cells got a mark, and 0.2 to 0.5 claims came
    of them; the order gave about 0.6 paid births per growth step. A P of one growth step does not fit the few agents
    of the next one. Not kept as an option.
23. The fourth try (`paidBy=chance`): a chance per agent in the growth step, min(1, B · r / P) with P the sum over
    the agents that could claim a child in this growth step, and the budget at most the number of agents of the front,
    as the order has it. A GPU sums P in one pass over the agents and draws in the next one. In the same dish it gives
    86 to 118 paid births per 500 steps, and the order 91 to 127; the budget is 1.05 to 1.32, and with the order 1.10
    to 1.22 (seed 1). With `fresh=box sums=fixed` it gives 73 to 152 (seeds 1 and 3; the order 91 to 161). The
    campaign with `fresh=box sums=fixed` (`out/y8`, `out/dish4`, 80 more seeds with slime on both arms in
    `out/both120gpu-chance`) keeps every choice of the Y-maze (Fisher p 0.57 to 1.0; with slime on both arms 57 : 63 and
    55 : 65 in 120 runs), but five times leave the spread: the tree with slime on both arms reaches the first food 1.13
    times later (p 0.00032) and ends in the open dish without slime with 0.69 times the territory (p 0.0025); with
    slime everywhere the crown is 1.09 times slower in the Y-maze (p 0.0038) and the fan 1.08 times in the dish (p
    0.0052), and in the Y-maze slime everywhere is 1.07 and 1.05 times slower than no slime at drift 1.5 and 5 (p
    0.00041 and 0.040; the rule set: 0.98 and 1.01). The likely cause: where few agents can claim a child and one of
    them has the most sink rate, its chance reaches 1, and the others keep theirs, so a growth step spends less than
    the order, which gives the whole part of B in births, or one to each of them; the cap of the budget then cuts the
    rest. With r = (0.8, 0.1, 0.1) and B = 2.4 the chances add up to 1.48, and the order gives 2.
24. The start of the agents (`start=agents`, every open cell within 3 cells of a start agent) is no form for the engine.
    Its territory has 271 and 272 cells in place of 240, but every start agent lies at least 4 cells from its edge, and
    a sink lies within 2 cells of the edge: so no agent is a sink until one walks out. The tree in the open dish then
    gets 24 and 26 paid births in its first 500 steps in place of 104 and 119 (the order; seeds 1 and 3), and 19 to 23
    with the chance per agent. The disc of the start and a rim of 3 cells leaves the agents near its diagonals within
    reach of the edge. A first campaign of the chance per agent with `start=agents` was stopped for this after 11 dish
    runs: the tree ended with 3,208 to 8,354 cells of territory (the rule set: 4,906 to 8,435).
25. The box of 13 × 13 cells gives the same answer as the chamfer transform on every open cell of a Y-maze with slime on
    all but one cell in 300, and the same run in a dish with slime on one half (`research.test.ts`). The defaults of
    the new options give the records of `out/y6` bit for bit (seeds 1 and 2 of d1.5-one, seed 1 of d5-both), and
    `paidBy=ahead` gives the record of `out/y7` (seed 1 of d1.5-one).
26. The integer sums were wrong at first: R counted each rate in steps of 2^-16, but each sink took its share with its
    own rate, so the sinks missed S by the rounding of R: by up to 8 · 10⁻⁵ of the flux in a dish with slime
    everywhere, and 3 · 10⁻⁶ without slime (10⁻⁹ in floats). The likely way, not measured: the ghost conductance of
    10⁻⁵ lets no such rest leave the network, so its pressure drifts from the ground beside it, and the drift of the
    agents reads that ground as higher. With slime everywhere every rate is 40 times smaller, and the crown and the fan
    grew slower: with the order and
    these sums alone, the Y-maze with slime everywhere took 1.10 times as long at drift 1.5 (p 0.0040, `out/split`),
    and the dish 1.07 times at drift 5 (p 0.15); the campaigns `out/y7`, `out/y8` and `out/y9` with these sums showed
    1.04 to 1.10 times. At drift 0 nothing changed: the tree does not read the pressure. Now a sink takes its share with
    the rate that R counted, and the sinks miss S by 10⁻⁹, as in floats; the Y-maze with slime everywhere then took
    1.03 and 1.00 times as long at drift 1.5 and 5 (p 0.45 and 0.61, `out/quick-fixed`).
27. The fifth try (`paidBy=fill`): the chances min(1, λ · r) with λ such that they add up to the smaller of B and the
    number of agents that could claim a child, as the order gives; λ comes from a few rounds that count the agents
    whose chance is 1 and sum their rates. With the box and the first integer sums of note 26 (`out/y9`, `out/dish5`,
    `out/both120gpu-fill`) the tree keeps its results: slime on both arms 1.03 times (p 0.86), the territory in the
    open dish 0.87 and 0.78 times (p 0.13 and 0.11). Slime everywhere stayed slower (1.07 to 1.10 times), from the
    sums of note 26.
28. The filled chances with the box and the balanced sums (`out/y10`, `out/dish6`, `out/both120gpu-final`; more seeds
    in `out/more/forms` and in `out/more2/forms`, those of the rule set in `out/more/rules` and `out/more2/rules`).
    The Y-maze keeps every result against the rule set: slime on one arm 32 : 8, 40 : 0 and 40 : 0; in 120 runs at the
    drift 1.5 and 5 the choices with slime on both arms, everywhere and none give Fisher p 0.15 to 0.70, and the first
    food 0.97 to 1.02 times as late (p 0.22 to 0.98); without slime at drift 5, 240 runs give 111 : 129 (the rule set
    127 : 113); 45 : 75 in the first 120 was chance. In the dish the crown and the fan keep theirs (p 0.36 to 0.71).
    The tree does not, with slime everywhere: in 40 runs its territory at step 20,000 is 5,429 cells in place of
    6,522 (0.83 times, p 0.0075), 30 % of the dish against 37 % without slime (0.81 times, p 0.0097; 20 runs without
    slime); the rule set gives 36 % and 40 % (0.91 times, p 0.10). So the filled chances leave one target: the tree in
    an open dish on slime grows less than without slime. The likely cause: the order spreads its births over the agents
    that could claim one (an order without replacement), and the chances follow the rates more closely. The extra
    seeds: `more.sh more "paidBy=fill fresh=box sums=fixed"` (seeds 11 to 20 of the dish), and `ymaze.ts case=none
seeds=121-240 drift=5` and `dish.ts slime=all seeds=21-40 drift=0`, each with the rule set and with the forms
    (`out/more2`).
29. The sixth try, the form of ADR 0067 (`paidBy=rank`): the order itself, with a key of its own per agent, so a GPU can
    rank the agents in parallel. It gives the births of the order in distribution, with other draws. With the box and
    the balanced sums (`out/y11`, `out/dish7`, `out/both120gpu-rank`, `out/more-rank`) every result stays in the spread
    of the seeds against the rule set: the Y-maze in 40 runs per case (Fisher p 0.22 to 1.0, the first food 0.98 to
    1.05 times as late, p 0.18 to 0.99) and in 120 runs at the drift 1.5 and 5 (Fisher p 0.24 to 1.0, 0.99 to 1.02
    times, p 0.44 to 0.95); slime everywhere 1.02 and 1.01 times as slow as no slime at drift 1.5 and 5 (p 0.11 and
    0.37). The dish: the crown and the fan as before (p 0.082 to 0.94); the tree 32 % of the dish with slime
    everywhere and 33 % without (40 and 20 runs; 0.96 times, p 0.57), the rule set 36 % and 40 % (p 0.29 and 0.079
    between them). Two runs of the same rules can thus differ by 15 % in the median of the tree, with 20 or 40 seeds.
