# The Y-maze lost its choice under the port of option 1: the cause and the rule

ADR 0100, part A. An agent ran it on 2026-11-26 in the CPU prototype, then ported the rule to both backends. The ADR
holds the tables; this page tells the story and has the commands.

## The story

The port of option 1 of ADR 0097 gave 5 : 5 in the Y-maze with slime on one arm, where `main` gave 10 : 0 and the
organism 39 : 1. The prototype shows the same with the rules of the port (`ywhy.sh`, 40 seeds): 28 : 12.

One change at a time finds the cause. Every birth from the budget alone keeps 40 : 0. The refund, the plasm of a dead
agent back to the budget, gives 24 : 16. With it the budget covers the agents of the front in 66 to 96 % of the steps,
and the rank of the keys then pays every one of them. The arm with slime then gets more paid births than the blank
arm. Many agents of its front sit on cells whose rate is near 0: sinks on slime, and old sinks whose rate decays. The
keys still order them last, but a full budget reaches the last one.

So the front needs a limit that holds when the budget is full, and that leaves Food ring as it was. Six forms of a
limit were tried (`frontPay` of `sim.ts`). A limit with a scale of its own starves the front of Food ring, because a
sink at a moving front is young and its rate, a mean over 100 steps, is small: what the flux earned (`take`), the sum
of the rates (`rates`), a chance 1 − e^(−r) (`step`), and the threshold B / R over all tube cells (`shareR`). The sum
of the weights of the sinks (`weights`) is larger than the front, so it limits nothing. The threshold B / P, P the sum
of the rates of the agents with a key (`share`), has no scale of its own: an agent is paid while k · P < B, with the
chance 1 − e^(−B · r / P) at most. At the rim of Food ring the rates are alike, and a full budget pays most agents; in
the Y-maze the rates on slime are 40 times smaller, and those agents are paid seldom. It gives 40 : 0, the first food
after 3,057 steps (`main` 3,292), and in Food ring the look of option 1 with a smaller rise at the second food.

In the engine the test sums the rates in steps of 2^-12 in two counts, and the rank asks k · P < B; WebGL2 adds the
counts with a pass of points between the test and the rank. The Y-maze with slime then gives 10 : 0 on each backend.

## Commands

From the root of the repository; the records go to `research/front/out/` (git ignores it).

- `bash research/front/ywhy.sh ywhy today= "port=payAll=front refund=1 feedCap=1 feed=flux" "share=payAll=front
refund=1 feedCap=1 feed=flux frontPay=share"`: the Y-maze, 40 seeds per case, a few minutes on 10 cores.
- `node --import ./research/flow/register.mjs research/front/ywhy-table.ts research/front/out/ywhy`: the table.
- `bash research/front/p1f.sh share`: Food ring with nine foods, seed 1, about 25 minutes per form.
- `bash research/front/p100.sh y`: the Y-maze in the engine, 10 seeds per backend.
