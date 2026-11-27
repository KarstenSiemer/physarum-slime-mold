# 0103: A longer wait for the steps of the Crown test

- Status: accepted. Decision of an agent on 2026-11-27 under the owner's delegation of 2026-11-12.
- Date: 2026-11-27
- Extends [ADR 0102](0102-six-e2e-shards-and-the-crown-test-apart.md), which put the test in a file of its own.

## Context

- The e2e test of the Crown of veins (`tests/e2e/veins.spec.ts`) waits for 60 steps of its scene. The tests of
  `tubes.spec.ts` wait for 30 steps. All of them had the same limit of the wait: 300 s (`WAIT` in
  `tests/e2e/colony.ts`).
- The limit is only a guard against a simulation that stands still (ADR 0010). SwiftShader runs the Crown scene at
  about one step per second in the image of CI on 4 cores of an M3 Pro (ADR 0087), and GitHub is about 3 times slower.
- On 2026-11-27 the wait went past 300 s in two runs of CI, each time in the retry too: run 46030127319 (pull request
  #148) and run 46046474304 (`main`, commit `35e686e`). The simulation did not stand still: the runner was slow.
- In five runs of that day that passed, the whole test took 5.4, 3.5, 5.9, 3.4 and 5.6 min (runs 46007306862,
  46011076488, 46013790198, 46029636923, 46050243365). A test of 5.9 min is close to the limit: the start of the app
  takes the rest of the time. The log does not give the time of the wait alone.

## Options

1. **Fewer steps.** The 60 steps are the fewest that show growth with a margin (the comment at the test).
2. **A longer `WAIT` for all tests.** The tests of 30 steps did not reach the limit. A longer guard only makes a
   stalled simulation cost more time in each of them.
3. **A limit of its own for the Crown test: 600 s.** Twice the steps get twice the limit.

## Decision

Option 3. `steps()` and `grow()` take a limit, with `WAIT` as the default. The Crown test waits for at most 600 s
(`CROWN_WAIT`), and its test limit grows by the same 300 s, to 780 s.

## Consequences

- A runner that makes the 60 steps in 300 to 600 s now passes. The two failed runs give no time above 300 s, so the
  margin of the new limit is not measured.
- On a slow runner the sixth e2e shard takes longer: its other tests took about 12 min, and the Crown test can take
  up to 13 min. That fits the 30 min of the job once. A Crown test that fails and runs again at that speed does not
  fit: the job then stops at its limit, and the log shows the first failure.
- No scene and no rule of the model changes.
