# 0061: The e2e tests run in four shards

- Status: proposed. It changes `.github/workflows/ci.yml`, which needs the owner's review (ADR 0014). Decision of an
  agent under the owner's delegation of 2026-11-12.
- Date: 2026-11-18
- Extends [ADR 0014](0014-ci-hardening.md), which made two shards, and
  [ADR 0049](0049-build-the-diffusion-and-outline-passes-at-their-first-use.md), which balanced them.

## Context

- CI stops a shard of the e2e tests after 30 minutes. With two shards, the second took 24.8 to 28.3 min in the last
  five runs of `main` (runs 44084725019, 44105435013, 44155977388, 44174718673 and 44247478625). The first took 11.4
  to 19.0 min.
- The runners differ. One commit of PR #108 passed 36 of the 42 tests of its second shard in 30 min and was
  cancelled, with no failed test. Its second attempt took 20.1 min for all 42 (run 44247952871). So a pull request
  can fail for the limit with no fault of its own, and each new attempt takes half an hour.
- The second shard grows: 23.0 and 24.1 min on 2026-11-16 (ADR 0049), 24.8 to 28.3 min two days later. A pull
  request that makes a start or a frame a little slower fails. The second half of PR #108 takes 12.4 min in the
  image of CI, against 11.1 min for `main`, and its second shard was cancelled at the limit in three of five
  attempts (runs 44196494552, 44247952871 and 44257790978; in the last one a test of the branch failed too).
- ADR 0049 moved a file from one shard to the other. It said that the split tips again with new tests, and that
  more shards leave more room.
- Playwright shares the tests out by their count, in the order of the files. The five tests of `tubes.spec.ts` run
  many steps: about 3 min in the image and about 9 min on GitHub. No split makes a shard shorter than that.

## Options

1. **Keep two shards and the limit.** Runs fail for the time now and then, on `main` too.
2. **A longer limit**, 45 min. A run still takes as long as its longest shard: 25 to 30 min, and more with every
   new test. A test that hangs holds a runner for 45 min.
3. **Order the files again** (ADR 0049, option 5). The two shards of `main` take 36 to 46 min together, so the best
   split leaves up to 23 min for each. That is 7 min of room, and the second shard grew by 3 min in two days.
4. **Three shards.** The longest takes about 19 min.
5. **Four shards.** The longest takes about 17 min, and each of the others 12 min at most.
6. **Five shards.** The longest takes about 15 min: it holds the five tests of `tubes.spec.ts`.

## Decision

Option 5: four shards. The longest shard takes a little more than half of its limit, so a slow runner and the tests
of the next weeks fit. A fifth shard gains 2 min. The limit stays 30 min. The workflow takes the number of the shards
from its matrix (`strategy.job-total`), so the list `shard` is the one place that holds it. With a number in two
places, a change of one of them would run a part of the tests twice or not at all.

## Results

The estimate comes from the five runs of `main` above. A job starts in 1 to 2 min. Without the start, the second
shard (4 tests of `tubes.spec.ts`, the 38 of `ui.spec.ts`) takes 25.2 min in the mean and the first (the other 42
tests) 13.9 min. The five tests of `tubes.spec.ts` took 8.6 to 9.1 min on GitHub (ADR 0049). So a test of
`tubes.spec.ts` takes about 1.8 min, a test of `ui.spec.ts` about 0.5 min and another test about 0.3 min.
`npx playwright test --project=e2e --shard=<k>/<n> --list` gives the tests of a shard.

| Shards | The tests of each shard                                                            | Minutes with the start, estimated  |
| ------ | ---------------------------------------------------------------------------------- | ---------------------------------- |
| 2      | 41 others and 1 of `tubes`; 4 of `tubes` and 38 of `ui`                            | 15, 27 (the mean of the five runs) |
| 3      | 28 others; 13 others, 5 of `tubes` and 10 of `ui`; 28 of `ui`                      | 10, 19, 15                         |
| 4      | 21 others; 20 others and 1 of `tubes`; 4 of `tubes` and 17 of `ui`; 21 of `ui`     | 8, 9, 17, 12                       |
| 5      | 17 others; 17 others; 7 others, 5 of `tubes` and 5 of `ui`; 17 of `ui`; 16 of `ui` | 7, 7, 15, 10, 9                    |

- The linters of the workflows pass (`actionlint`, `zizmor`, `check-github-workflows` of the commit hooks).
- Not measured before the pull request: the times of four shards on GitHub. The run of the pull request shows them.

## Consequences

- A run of CI starts two more runners. Each takes 1 to 2 min to start (`npm ci`, the built site). The result of the
  e2e tests comes after about 15 min, not after 25 to 30.
- The check `verify` needs every shard, as before: it reads the result of the whole matrix job. The ruleset requires
  `verify` alone (ADR 0014), so the new names of the shards change nothing there.
- `AGENTS.md` says four shards.
- To watch (ADR 0049): the split is still by count in the order of the files. A new file of slow tests beside
  `tubes.spec.ts` makes its shard longer.
