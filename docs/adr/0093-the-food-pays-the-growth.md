# 0093: The food pays the growth: each covered food gives the front its flux

- Status: proposed. Study 1c of phase 1 of the plan of 2026-11-22, which the owner approved on that day: all three studies side by side.
  An agent ran it on 2026-11-22 under the owner's delegation of 2026-11-12. It records what the study found and what it
  recommends for phase 2. The owner decides at gate 1.
- Date: 2026-11-22
- Would extend [ADR 0071](0071-the-births-that-the-flux-pays-in-the-engine.md) (the births that the flux pays) and
  [ADR 0086](0086-three-levers-of-the-crown-as-settings.md) (the flux to the front).
- Extended by [ADR 0096](0096-gate-1-study-1d-before-a-port.md) (2026-11-23): at gate 1 the owner chose study 1d
  before a port.
- Extended by [ADR 0097](0097-paid-births-thin-the-sheet-and-fill-the-dish.md) (2026-11-23): study 1d measured `feed=flux`
  with rules 1 and 2. The rate of Mohberg and Rusch stops a young colony, and the band at the wall comes from the
  drift of nine foods.
- In short: the story is [research/front/P1C-NOTES.md](../../research/front/P1C-NOTES.md). `research/front/p1c.sh`
  and `research/front/feed.ts` make its numbers again; `research/front/feed-table.ts` prints the table.

## Context

- **The rule today** (`docs/model.md`, 9.1). With the rules of the growth front, the budget of the paid births grows by
  2 · I0 / 20 in each step in which the front takes flux: 0.2 at a Flow strength of 2, and 0.8 at 8. It does not grow
  with the covered foods or with the colony.
- **The survey** ([GROWTH-SURVEY.md](../../research/front/GROWTH-SURVEY.md), phase 0b). With the rules, 10 of 16 runs
  still grow at step 20,000, by 0.03 to 0.30 agents per step: 7 to 57 % of what the budget pays. Where the rest goes was
  not measured.
- **The owner** (2026-11-22): the organism should gain mass, and many experiments stop growing with food and room left.
- **The prototype.** The dish of Food ring (384 cells; a food in the middle and eight on a ring at 115 cells) and the
  same dish with the middle food alone. The rules in the forms of the engine (`driftOn=take`, drift 1.5, `paidBy=rank`,
  the sinks on a tube), a Flow strength of 8, 20,000 steps, a ledger of every birth and death by its kind. At the
  scene's strength of 2 the colony covers one food in 20,000 steps.

## Findings

1. **The paid births die as every agent dies.** With one food, from step 10,000 to 20,000, a colony of about 5,900
   agents has per step 38 to 42 births of Jones' rule, 3.5 to 4.2 respawns and 0.8 paid births, and 42 to 46 deaths:
   36 to 39 by starvation (22 to 24 of them on closed ground) and 7 by crowding (6 seeds). The mean age at death is 118
   to 122 steps. The budget is spent: after step 2,000 the cap of the agents of the front cuts nothing, and 99 % of the
   paid claims win their cell. A paid child dies after 230 to 235 steps on average, half of them by starvation. So the
   paid births are less than 2 % of the births, and the count follows the ground that the flux feeds and the fresh
   ground with its credit, not the births. A third of the agents sit on closed ground at step 20,000. Study 1b found
   the same in the engine: about 10,000 births of Jones' rule and 12,000 deaths per 500 steps on 5,000 agents, and 0.8
   paid claims per step ([ADR 0092](0092-the-boom-at-a-new-food-is-jones-births-without-starvation.md)). This caps
   any budget of paid births alone.
2. **No source gives a gain of mass per food.** Mohberg and Rusch (1969, J. Bacteriol. 97: 1411) grew plasmodia whose
   mitoses came "about 8 hr" apart, with RNA and protein rising "essentially logarithmically": at best the mass doubles
   in about 8 hours, 14,400 steps (30 steps a minute, `docs/model.md` 8.6). The agents of the model are not mass: with
   one food the colony grows from 50 to 5,900 agents in 11 hours of model time at the density of Jones' rule. So the
   rate of a rule of growth is a choice of the app.
3. **Three forms**, the option `feed` of `research/front/sim.ts`; nine foods against one at step 20,000:

   | Form                                                                    | Seeds | Nine against one           | Windows of 2,000 steps without growth     |
   | ----------------------------------------------------------------------- | ----- | -------------------------- | ----------------------------------------- |
   | `fixed`: today                                                          | 3     | 1.18 to 1.32               | on 2 of 3 seeds                           |
   | `foods`: the budget grows by today's rate per covered food              | 3     | 1.54 to 1.83               | on 3 of 3 seeds                           |
   | `flux`: the sinks take 2k · I0 per covered food, and the budget follows | 6     | 3.68 to 4.43 (median 4.17) | once, seed 5 (the boom at the ninth food) |

   With `flux` the deaths by starvation fall from 36–39 to 17–26 per step, and Jones' births rise from 38–42 to
   69–84. With `foods` the deaths by crowding rise from 7 to 26–30 per step: more children without more fed ground
   crowd the rim.

4. **One food keeps its run.** With one covered food or none, both forms give today's run row for row (3,000 steps on
   the dish, and the test of `research/front/research.test.ts`).
5. **The look.** With `flux` the territory fills the dish by step 20,000 on every seed, and a thick band of plasm lies
   along the wall with veins that stream along it. The last open ground takes the flux of nine foods, and the drift
   reads a pressure nine times as steep. The dish caps the ratio of finding 3.

## Options

1. **Keep the fixed budget.** More food gives no more mass (finding 3).
2. **`foods`**: more births, the same flux. It fails the measure More food, more mass, and the count stalls.
3. **`flux`**: each covered food gives the front the flux that one food gives today, and the budget follows that flux
   at today's price of 20k of flux per birth. It passes More food, more mass on 6 of 6 seeds, and No stall but for
   one window after a new food. It adds no number.
4. **A budget that grows with the size of the colony.** It changes the run of one food, and the measures pass without
   it. It fits a model in which the agents are mass (consequences, item 3).

## Recommendation

Option 3 for phase 2, while the rules run. The owner decides at gate 1, after the pictures
`research/front/out/p1c/p1c-seed1.png` and `p1c-seed2.png` of the main checkout.

## Consequences

1. **The port** (phase 2): the sinks take S · max(1, P_s) and the sources give 2k · I0 at each covered port (8.7); the
   budget grows by today's increment times max(1, P_s) (9.1). P_s is in the state of the sinks. The passes of the flow
   and of the state on both backends, `flow-reference.ts` and `paid.ts`, `docs/model.md` 8.7 and 9.1, wrong rules in
   `mutate.ts`, the digests of every scene, and the measures in Food ring at a Flow strength of 8 on the engine. Cost:
   about 300,000 tokens and about 1.5 hours of GPU.
2. **Bytes.** A scene with the rules keeps its bytes while it covers one food or none: the Crown of veins always, the
   Y-mazes and Slime everywhere until a second food. The digests decide.
3. **With study 1b.** ADR 0092 proposes that every birth comes from this budget while the rules run. Today about 45
   births per step hold 5,900 agents. At today's deaths a budget of 0.8 per step would hold about 0.8 · 120 ≈ 100
   agents. So that rule needs the deaths to give their plasm back to the budget, as the organism pulls the plasm of a
   dying branch back into its tubes. Then the mass changes by what the food pays, the agents are mass, and the rate of
   Mohberg and Rusch becomes a limit: at most N · ln 2 / 14,400 births per step. That limit is the term for the size of
   the colony; it changes the run of one food, because 0.8 per step is more than it below 16,600 agents. It needs a
   study of its own.
4. **To watch**: the band at the wall and the drift of a large flux; the boom at a new food (ADR 0092).
5. **Not verified**: the engine and WebGL2; other dishes and strengths; 3 seeds only for today with nine foods and for
   `foods`.
