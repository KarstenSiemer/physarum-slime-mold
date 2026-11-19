# How the agents make a crown, and why the rules follow the organism

This page belongs to [ADR 0065](../../docs/adr/0065-the-growth-front-takes-the-flow-a-prototype.md). It tells how the
agents of Jones and the new rules of stage 4 work together, and which behaviour of the organism each rule copies.
The rules run in the prototype (`sim.ts`). The app does not have them yet. [README.md](README.md) tells how the
prototype found them.

**In one sentence:** the rim of the colony that grows onto fresh ground pulls the flow of the tubes, and the agents
move with that flow, so the plasm streams into the head of a tube, spreads there as a sheet, and the flow forms veins
in the sheet.

## The two parts that the app has

- **The agents of Jones** (Jones 2010 and 2011; `docs/model.md`, parts 7 and 9). An agent is a piece of plasm on one
  cell, and a cell holds one agent at most. In each step an agent reads three sensors ahead of it, turns toward the
  strongest trail, steps one cell forward if that cell is free, and drops trail. The trail spreads and fades. Every
  third step an agent with few others near it gets a child on a free cell beside it, and an agent in a crowd dies.
  Agents gather on their own trail, so they form bands, and the bands form a network.
- **The flow in the tubes** (Tero et al. 2010; `docs/model.md`, part 8). The cells with plasm form a network that
  conducts. Covered foods push flux into it and take flux out. Where much flux runs, a cell becomes a thick tube; where
  little runs, it thins. An agent on a very thin cell starves, and a thick tube brings dead agents back to life.

Before stage 4 the flux ran only from food to food, and a growing arm got none. So the head of an arm was blunt and
had no veins (`docs/fidelity.md`, row 24; ADR 0060).

## What stage 4 adds, and what the organism does

1. **The growing rim takes flux.** An agent within 6 cells of ground without slime, with a free cell of the territory
   beside it, is a sink: it takes flux out of the network. On slime, an agent at the edge of the territory with a
   free cell beside it is a sink of the weight 0.025, against 1 on fresh ground (the owner, 2026-11-19). All sinks
   together take 2 times the flow strength, shared by their weights.
   **The organism:** the front is the sink that gives the flow its direction (Schenz 2019, doctoral thesis, Sec. 5.1).
   The flow is pushed into the thin sheet at the front, the fan (Le Verge-Serandour and Alim 2023, Sec. 2.2).
2. **The colony pays for it.** The covered foods give the flux that the front takes. Without a covered food, every
   cell of the network gives an equal share. **The organism:** the plasm that reaches the front comes from the body
   behind it, which is thinner than the front (Kuroda et al. 2015: the plasmodium is thickest close to the front).
3. **The agents move with the flow (the drift).** A sensor reads the trail, the food scent and minus a weight times
   the pressure. The pressure is high at the sources and low at the sinks, so an agent turns toward the sinks, as a
   ball rolls down a slope. **The organism:** its plasm does not walk; the flow in the tubes carries it to the front.
4. **The front gets its own speed.** The colony lives on a territory: an agent steps and a child is born only onto
   it. Each agent beside open ground outside the territory pushes that ground in, with the chance 0.004 per step. So
   the rim moves the faster, the more agents lie at it. **The organism:** the front moves the faster, the thicker the
   plasm at it (Kuroda et al. 2015: 0.17 · h^0.94 mm per min at a largest thickness of h mm). Without the territory,
   agents walk ahead of the colony, and the front of the app runs about ten times too fast (`docs/fidelity.md`, row
   6).
5. **The flux pays for new plasm.** Every 20 of flux that the front takes is one child at an agent of the front.
   Today the child comes only at the fresh rim: a rim on slime takes flux, but that flux pays no child, because only
   a birth onto fresh ground counts (the owner, 2026-11-16). A variant gives the children to every sink in the share
   of its flux, also on slime; the owner decides (ADR 0065, decision 7). **The organism:** the flow brings mass to
   the front, and the front grows with it. The model of de Almeida 2021 has the same idea: a node at the rim stores
   the flux it takes and spends it on new veins beyond the rim.
6. **The rule of the tubes stays as it is.** The flow adapts while the front takes flux, also without two covered
   foods. **The organism:** in the sheet at the front, the veins along the direction of the flow get stronger and
   the others disappear (Le Verge-Serandour and Alim 2023, Sec. 4.1).

## How the parts work together

1. The fresh rim takes flux, so the pressure falls from the tube toward the rim.
2. The agents turn down the pressure and stream out of the tube into its head.
3. Many agents reach the rim and push the territory open. A head with much plasm grows faster than a thin side.
4. The flux that the rim takes pays children at the rim, so the head fills with new plasm: a sheet wider than the
   tube.
5. The flux runs from the end of the tube to many sinks along the rim, so it spreads out like a fan. Where it runs,
   the rule of the tubes makes veins: they fork toward the rim, get finer there, and lie along the flow.
6. The trail rule of Jones keeps the agents in bands on these veins, and the bands keep the flux on the veins.
7. When the rim moves on, the cells behind it stop being sinks. Their flux falls, and the rule of the tubes thins
   them. The veins behind the head join into the tube. In the runs a cell becomes a vein 400 to 1,900 steps after the
   front passed it; in the organism the main vein shows about 50 min (about 1,500 steps) after the front (Schenz 2019).

**The choice of the Y-maze.** The rim in the blank arm lies on fresh ground and takes flux with the weight 1. The rim
in the arm with slime takes it with the weight 0.025. So the flux and the stream of agents go into the blank arm,
and its front moves faster. With the drift 5 the colony reaches the food of the blank arm first in 40 of 40 runs; the
organism did it in 39 of 40 (Reid et al. 2012).

## The three forms

The weight of the drift sets how strongly the flow pulls the agents, against the pull of their own trail:

- **0, a tree of tubes**: the agents follow only the trail and the scent. The flow brings no plasm to the head, so a
  tube ends in a small head, and the colony branches.
- **1.25 to 1.5, a tube with a crown**: the stream fills the head, and the trail still holds the tube.
- **5, a fan that migrates**: the stream is stronger than the trail. The agents leave the back, and the whole colony
  moves as a fan.

What each form keeps of the Y-maze (40 runs per case; the tables are in [README.md](README.md), step 6):

| Births that the flux pays        | Drift 0: a tree | Drift 1.5: a crown | Drift 5: a fan | The organism     |
| -------------------------------- | --------------- | ------------------ | -------------- | ---------------- |
| Only at the fresh rim: blank arm | 39 of 40        | 40 of 40           | 40 of 40       | 39 of 40         |
| Only at the fresh rim: slime all | 2.23 times      | 1.48 times         | 1.32 times     | as fast as blank |
| At every sink: blank arm         | 33 of 40        | 40 of 40           | 40 of 40       | 39 of 40         |
| At every sink: slime all         | 1.00 times      | 0.95 times         | 0.96 times     | as fast as blank |

"Slime all" is the time to the first food with slime on every open cell, against no slime. Every form shows no
preference with slime on both arms and without slime.

The organism takes such forms in different conditions. On a rich medium it grows a mesh with a sheet at the front,
and under starvation or with repellents it grows trees of branches (Takamatsu et al. 2009). On ground that is poor in
nutrients it migrates fast and keeps main branches (Le Verge-Serandour and Alim 2023, Sec. 4.2.1). Nobody measured
whether a weight of the model matches one of these conditions. The owner decided on 2026-11-19 that the panel offers
every form (ADR 0065, decision 6).

## Where the model is not the organism

- The territory is a tool of the model. The organism pushes its front with its plasm; the model counts the agents at
  the rim.
- The front is the rim within 6 cells of ground without slime. The organism senses slime at contact or up to 1 mm,
  about 2 cells (`docs/knowledge-base/slime-mazes-and-the-front.md`, "For the model"). The model needs the 6 cells
  because the trail of the agents spreads a few cells ahead of them, and the slime of the model follows the trail.
- The organism avoids slime as a choice at contact (Reid et al. 2012). The model gives a rim on slime a weak pull.
  With the births only at the fresh rim, a colony on slime everywhere is 1.32 to 2.23 times slower than without
  slime; the organism is as fast. The births at every sink close this gap (ADR 0065, decision 7).
- The flow of the model is steady. The organism pumps its plasm to and fro with a period of about 2 min
  (`docs/fidelity.md`, row 17).
- The grid shows: in an open dish the front is an octagon, and the veins prefer the axes of the grid.
- The numbers 0.004, 6 cells, 2 times the flow strength, 20 per birth, 0.025 and the weights of the drift are choices
  made on the runs of the prototype.
