# 0096: Gate 1: study 1d before a port

- Status: accepted. The owner wrote on 2026-11-23, after the pictures and the numbers of studies 1a, 1b and 1c:
  "Wie empfohlen weiter machen. Dokumentieren was noch fehlt bitte" (go on as recommended; please write down what is
  still missing). The recommendation was the coordinator's, under the owner's delegation of 2026-11-12.
- Date: 2026-11-23
- Extends [ADR 0091](0091-the-credit-of-fresh-ground.md),
  [ADR 0092](0092-the-boom-at-a-new-food-is-jones-births-without-starvation.md) and
  [ADR 0093](0093-the-food-pays-the-growth.md): the owner's answer to their proposals at gate 1.

## Context

At gate 1 the owner says which rules of phase 1 go into the engine
([the plan of 2026-11-22](../../research/front/PLAN-2026-11-22.md), section 5). The three studies found:

1. Study 1a (ADR 0091): a lower credit of fresh ground gives more and finer veins. It gives no thinner sheet, no arms
   and no end of the boom. Its proposal: no port of the credit on its own.
2. Study 1b (ADR 0092): the boom at a new food comes from Jones' births, which go on when the starvation stops. Its
   proposal: while the rules run, every birth comes from the budget of the paid births.
3. Study 1c (ADR 0093): with `feed=flux`, 9 foods give 3.7 to 4.4 times the agents of 1 food. Its proposal: port
   `feed=flux`. Its pictures show a thick band of plasm along the wall of the dish. It also found that the proposal of
   1b needs a third rule: a dying agent gives its plasm back to the budget. Without it the colony shrinks to about
   100 agents.

So the proposals depend on each other, and no study measured them together.

## Options

The coordinator sent three options with the pictures:

1. Study 1d in the prototype first: the rules of 1b and 1c and the return of the plasm together, and the cause of the
   band at the wall. About 400,000 tokens, CPU only.
2. Port `feed=flux` now: about 300,000 tokens and 1.5 hours of GPU (ADR 0093). The band and the boom stay.
3. Arms first, phase 3 of the plan: about 600,000 tokens.

## Decision

Option 1. No rule goes into the engine at this gate, and the proposals of ADR 0091, ADR 0092 and ADR 0093 stay
proposed. After study 1d the owner says again which rules go into the engine. Phase 3 comes after study 1d.

The reason: each port changes the passes of both backends, `docs/model.md` and the digests of every scene. Rules
that depend on each other need one measured form, so that the engine changes once. A port of `feed=flux` alone brings
the band at the wall into the app and keeps the boom.

## Study 1d

- The dish of Food ring with one food and with nine, the rules in the forms of the engine, a Flow strength of 8,
  6 seeds and 20,000 steps, as in study 1c.
- The rules: `feed=flux`; every birth paid from the budget; the plasm of a dying agent back to the budget.
- Two questions, to answer with numbers:
  1. A budget that the colony cannot spend grows. A new food can then spend it at once, and that is a boom of its own.
  2. The rate of Mohberg and Rusch (ADR 0093, consequence 3) allows one doubling of the mass in 14,400 steps. Under
     that limit a colony of 50 agents grows to about 130 agents in 20,000 steps. Today one food grows it to about
     5,900. So the limit would stop the growth of a young colony, unless the agents are not mass.
- The measures: More food, more mass and No stall (the plan, 3.4); No boom from the second covered food, and the fall
  (ADR 0092); the sheet in the dish (the plan, 2.5). Pictures with one food and with nine.
- The band at the wall: a study that isolates its cause, and what the organism does at the wall of a dish, with a
  source.
- Its record is ADR 0097, and its notes are `research/front/P1D-NOTES.md`.

## Consequences

- No rule, pass or scene of the app changes at this gate.
- `TODO.md` has phase 1d, and phase 2 waits for it. The points that are still open after phase 1 are in `TODO.md`, in
  the section of the owner's feedback of 2026-11-22.
