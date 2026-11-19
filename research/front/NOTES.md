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
