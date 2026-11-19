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
