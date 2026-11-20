# 0071: The births that the flux pays in the engine

- Status: accepted. The coordinator set the task on 2026-11-20: part E3 of the engine of stage 4, in both backends,
  behind the setting `territory`, which no scene turns on yet: the budget of each strain, the keys in `test`, the new
  pass `rank`, and the memory and the bindings of ADR 0067 (decisions 7 and 8). The rules are those of ADR 0065
  (decision 1) in the form of ADR 0067 (decision 1, `paidBy=rank`); the measured form is `paidByRank()` with the budget
  code of `research/front/sim.ts`. The choices below are an agent's, under the owner's delegation of 2026-11-12.
- Date: 2026-11-20
- Extends [ADR 0067](0067-the-rules-of-stage-4-in-the-forms-of-a-gpu.md) (decisions 1 and 6 to 8),
  [ADR 0069](0069-the-sinks-of-each-strain-in-the-engine.md) (the lanes of the state) and
  [ADR 0070](0070-the-flow-takes-the-sinks-in-the-engine.md) (the slot of what the sinks take).
- In short: [`docs/model.md`](../model.md), section 9.1, has the rules;
  [`research/front/ENGINE.md`](../../research/front/ENGINE.md) has the state of the parts and what part E4 needs.

## Context

ADR 0070 let the flow take the sinks, and the state of each strain says whether its front takes flux, but no rule
turned the flux into plasm. The prototype does (`paidByRank()` and `paidSinks()` with `paidBy=rank` and the rule set of
ADR 0065, which has `rim=1`): while the front takes flux, the budget B grows by S / 20 in each step; in a growth step,
after Jones' births, each agent of the front that could claim a child draws a key −ln(1 − u) / r, the ⌊B⌋ agents with
the least keys claim a child, and with B ≥ 1 the budget becomes min(B − the claims, the agents of the front).

## Decision

1. **The rules of `paidByRank()` as they ran in the prototype**, also in two points that the task does not name. The
   rim is that of `atRim()`: a neighbour is open, empty after the moves, and holds no tube body of the strain of the
   agent, with no rule of a corner. And the child goes out, as `claimChild(…, out)` lets it with `rim=1`: among the
   free cells it takes one without a tube body if there is one. The tube body is that of the strain of the agent:
   each strain grows a colony of its own.
2. **The key takes the sink rate as it is, not as R counted it**, and its size. The prototype draws
   `rankKey(rand(), sinkRate[c])` with the rate itself, also with `sums=fixed`, and ADR 0067 (decision 5) measured that
   form. A key only orders; the steps of 2^-16 of R would only round it. So a cell whose rate R counts as 0 (a rate
   below 2^-17) still gives a key, as in the prototype, at least 2^17 times above that of a full sink. The engine holds
   the rate of a sink of the step before with a minus sign (ADR 0069, decision 4): "a rate above 0" of the prototype is
   a rate that is not 0, and the key divides by its size.
3. **The passes compute −ln(1 − u) to a few units in the last place.** `log` of WGSL and of GLSL may err by 2^-21 for
   an argument between 0.5 and 2. Near u = 0, where the least keys lie and where the rank needs them most, that is
   up to 5 % of −ln(1 − u) at u = 10⁻⁵. Up to u = 1/2 the passes take the series of 2 · atanh(u / (2 − u)) to the term
   of t^15 (the next one is below 10⁻⁸ of the sum), above it −log(1 − u), whose error is 3 units in the last place
   there. In float32 the series errs by less than 5 · 10⁻⁷ over the draws (`paid.test.ts`).
4. **The tests compare the keys to 10⁻⁵ and the rest exactly.** A key comes from a log and a division, which need not
   round once (ADR 0069, decision 3), so no GPU need give the bits of the CPU, and the two backends may differ in the
   last bits. The CPU copy ranks the keys that a GPU wrote (`Sim.readPaidKeys()`); then the claims, the births, the
   counts and the budget are integers or floats that round once per operation, and they compare exactly. The same
   draw and the same rate give the same key on one GPU, so a tie there is a true tie. The test of ties finds a seed on
   the CPU with two agents of the same draw whose key lies 10⁻⁴ of it away from every other key of the strain: no error
   of a GPU in a key can change their place.
5. **An agent without a key holds the largest float32**, not infinity: WGSL lets an implementation assume that no
   infinity occurs. The largest key of the rule is 16.7 / 2^-24, below 3 · 10^8.
6. **A budget below 1 pays nothing and keeps what it has**, as in `paidByRank()`, which returns before it takes the
   claims off and holds the budget to the agents of the front; the order of ADR 0065 does the same. So the budget
   becomes min(B − K, F) only in a growth step with B ≥ 1. ADR 0067 writes the rule without this guard; the prototype
   measured it with the guard. Without it a strain without an agent of the front would lose its fraction of a birth
   in every growth step.
7. **The growth of the budget is one float32 that the CPU computes**: S / 20 = 2 · I0 / 20 births in lane y of the
   slot of what the sinks take (`packPaid()`, `FLOW_TAKE_SLOT`), so no pass divides (a division of WGSL errs by 2.5
   units). The pass `state` takes the claims off, holds the budget to F and adds the growth, each operation rounding
   once: both backends and the CPU give the same float. It reads the step and the growth test from the parameters.
8. **Light stops a paid birth as it stops one of Jones' rule**, with the same draw (stream 10) for the cell that the
   paid child picks. The prototype has no light; ADR 0050 stops a birth onto lit ground, and a paid birth is a birth.
   A claim that light stops is no claim and does not count, as a held claim of the prototype (`claimChild()` returns
   false). An agent whose birth of Jones' rule light stopped is no parent of Jones' rule and can be paid, as an agent
   whose birth the hold stopped in the prototype.
9. **The paid child takes the draw of Jones' rule** (stream 4), as `claimChild()` takes `GROW` for both. The key has
   a stream of its own, 12.
10. **A claim key of 0 makes no paid claim.** On WebGPU the claim key of one id in 2^32 is 0 in a step, and the
    buffer of the claims cannot tell a claim with it from no claim. Such an agent gets no key, and `win` does not
    search for it. On WebGL2 no claim key is 0. The test on WebGPU finds the seed that gives agent 5 the claim key 0,
    with the inverse of pcg.
11. **`win` finds a paid parent by its claim key in a neighbour**: an agent without a child of Jones' rule whose key
    one of its 8 neighbours holds. Only its paid claim can have put the key there, onto the cell that its child takes;
    the search reads 8 claims and no texture, where the cell itself needs the territory, the memory and the occupancy
    of 8 neighbours. So `win` needs no new input, as ADR 0067 says. On WebGL2 the pass `rank` marks the paid parent with
    `GROWS` and the neighbour of its child, so that the points of the claims and of the births of Jones' rule take it.
12. **The buffers and the bindings of ADR 0067** (decisions 7 and 8), in these forms. WebGPU: the buffer of the state of
    the sinks holds the state of 4 strains (128 B), then F and K of each strain (32 B, which every step clears), then
    the keys by id; `test` binds 8 storage buffers, `rank` 5, `win` 8, and the pass `state` also the parameters.
    `test` counts F and `rank` counts K with atomics of the buffer. WebGL2: the test writes the keys into a second
    target of its framebuffer (`R32F`, a texel per agent) and marks an agent of the front with the bit `FRONT`; `rank`
    (PASS 5) marks a paid parent with `PAID`; `paid.vert` counts both with points into an `RGBA32F` target of 2 × 1
    texels with a lane per strain, which every growth step clears, and the state reads it only in a growth step. The
    test samples 13 textures, `rank` 10 and the state 4.
13. **Memory**: 4 B per agent while the rules run (`PAID_BYTES_PER_AGENT`), on both backends. The keys of WebGPU lie by
    id, where ADR 0067 says by slot: the agents of a strain are a range of ids, which `rank` reads in a row, and the
    sort moves the agents between slots (ADR 0005). On WebGL2 the slot is the id.
14. **`rank` reads the keys of WebGPU in blocks of 16** (`RANK_BLOCK`). The pass lasts as long as the agent with the
    least key takes to read all n keys of its strain (ADR 0067, decision 1). With one key per round of its loop, each
    load waits for the count that the load before decided, and the pass took 4.9 ms in the start scene (below). The 16
    loads of a block wait for none of each other; a key past ⌊B⌋ changes no decision, since the count only has to reach
    ⌊B⌋, so the births stay the same. Blocks of 64 and 256 keys were no faster (0.60 to 0.98 ms at b = 1 to 64), and
    keys read in fours were slower (0.78 to 1.35 ms). WebGL2 reads the keys from a texture and needs no blocks (0.04
    ms).

## Results

- **Both backends follow the CPU copy** (`paid.gpu.test.ts`, 5 tests on WebGPU and 4 on WebGL2, M3 Pro): two colonies
  of two strains with starved cells, a thin wall and light, where the keys agree to 10⁻⁵ and the agents, the budget,
  F and K exactly, with paid parents beside parents of Jones' rule, claims that light stops, and agents of the front
  without a key; a step without the growth test and one without a sink rate; two agents with the same key, of which the
  one with the smaller id is paid, and a budget of 10⁶ that pays every agent with a key and falls to the agents of the
  front; agents beside the corner between two walls in each of the four diagonal directions; a budget below 1, which
  pays nothing and stays without an agent of the front; and on WebGPU an agent whose claim key is 0.
- **The CPU copy** (`paid.test.ts`): three agents with the rates 1, 2 and 5 come first in 1 / 8, 2 / 8 and 5 / 8 of
  40,000 steps; the key, the budget and the rules on cases made by hand.
- **The wrong rules** TY141 to TY213 of `research/flow/engine/mutate.ts` each fail at least one test, and so do LG3,
  LG8, TY15, TY26, TY31 and TY94, whose texts follow the code of growth and of the step now
  (`research/flow/logs/engine/paid-0071/mutations.txt`).
- **No scene changes**: the digests of every scene after 500 steps on both backends equal those of the record of ADR
  0070 in 62 of 62 runs (`research/flow/README.md`, part 30).
- **The time of `rank`**: the next section.

## The time of `rank`

The start scene with the rules on, seed 1, after 1,504 steps, on an M3 Pro with no other GPU work
(`research/front/rank.gpu.test.ts`, `research/flow/logs/engine/paid-0071/rank.jsonl`): the pass alone, 200 times in
one submission, with the keys of the last growth step and a budget of b for every strain; the median of 5 batches.
Capacity 1 is the most agents that the scene holds, one per cell of its dish of 384 × 384 cells: 147,456 agents, n =
49,152 per strain. Its own capacity is 0.25 (n = 12,288). Few agents have a key at that step: the colonies grow about
ten times slower with the rules (ADR 0065, consequences), 3,441 agents live on WebGPU and 1,072 on WebGL2.

| Backend, capacity | Agents with a key F | ⌊B⌋ of the step | b = 1    | b = 4    | b = 16   | b = 64   | b = 0    |
| ----------------- | ------------------- | --------------- | -------- | -------- | -------- | -------- | -------- |
| WebGPU, 1         | 14, 37, 27          | 1, 1, 1         | 0.74 ms  | 0.75 ms  | 0.87 ms  | 0.92 ms  | 0.02 ms  |
| WebGPU, 0.25      | 5, 26, 19           | 1, 1, 1         | 0.16 ms  | 0.17 ms  | 0.18 ms  | 0.19 ms  | 0.009 ms |
| WebGL2, 1         | 8, 11, 3            | 1, 1, 1         | 0.047 ms | 0.045 ms | 0.044 ms | 0.047 ms | 0.01 ms  |
| WebGL2, 0.25      | 5, 2, 1             | 1, 2, 3         | 0.018 ms | 0.019 ms | 0.017 ms | 0.019 ms | 0.006 ms |

- **The time follows n, not the reads of the estimate.** At capacity 1 the estimate b · n · (1 + ln(F / b)) grows from
  0.62 to 3.8 million keys between b = 1 and 64, and the time by 1.25 times: the pass lasts as long as one agent takes
  to read n keys, about 15 ns per key on WebGPU and 1 ns on WebGL2, and 4 times fewer agents take 4.6 times less.
- **Per growth step** the scene at capacity 1 spends 0.74 ms on WebGPU in `rank` and 0.047 ms on WebGL2. Its whole step
  takes 3.24 ms with the rules and 2.89 ms without them on WebGPU, 7.69 ms and 3.76 ms on WebGL2 (median of 11 batches
  of 30 steps after 1,500 steps, `bench.gpu.test.ts`, `steps.jsonl`): with a growth test in every third step, `rank`
  is about 0.25 ms of the 0.35 ms that the rules add to a step on WebGPU.
- **With one key per round** (`RANK_BLOCK` 1, `rank-block1.jsonl`) the pass took 4.9 ms at capacity 1 and 1.19 ms at
  0.25 on WebGPU, for every b: 100 ns per key, 1.6 ms per step on average, half of a whole step.

## Consequences

- With the rules on, the flux that the front of a strain takes becomes births at its rim. How a scene runs with that is
  not measured: part E4 turns the rules on in scenes and measures them (`research/front/ENGINE.md`).
- The agent pass of WebGL2 still samples 16 textures, the test of growth 13 and `rank` 10.
- Not measured: the time of `test` and `win` apart from the step, and of a step with the rules in any scene but the
  start scene.

## Open points

- Two keys within a few units in the last place can rank otherwise on the two backends, so a run with the rules may
  differ between them in a birth where it did not before; the claim keys differ between them anyway (docs/model.md,
  section 12).
- WebGPU spends 15 ns per key of a strain in `rank`. At step 1,504 of the start scene only 14 to 37 of the 49,152 agents
  of a strain had a key: a list of the agents with a key, or the pyramid of the least keys of ADR 0067, would read far
  fewer keys, but it needs other buffers than decision 7 of ADR 0067 names.
- On WebGL2 the rules make a step of the start scene twice as long (7.69 against 3.76 ms), and `rank` is 0.016 ms of
  it per step: the cost lies in the passes of parts E1 to E2b, which nobody has timed one by one.
