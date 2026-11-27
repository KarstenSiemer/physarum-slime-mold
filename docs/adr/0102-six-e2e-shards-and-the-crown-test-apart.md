# 0102: Six e2e shards, and the test of the Crown of veins in a file of its own

- Status: accepted. Decision of an agent on 2026-11-27 under the owner's delegation of 2026-11-12; the owner asked
  that day to repair the shards. It changes `.github/workflows/ci.yml`, so it needs the owner's review (ADR 0014).
- Date: 2026-11-27
- Extends [ADR 0061](0061-the-tests-of-ci-run-in-eight-jobs.md), which made four e2e shards.

## Context

- CI stops a shard of the e2e tests after 30 minutes. On 2026-11-27 the third of the four shards reached that limit
  three times in a row on pull request #159, which changes one line of `renovate.yml`, and once on `main` (commit
  `e185dbf`). On other runners of the same day the same shard took 21.6 min (PR #116) and 20 min (PR #160).
- The log of a shard held a dot for each test and no time. The first commit of PR #160 adds the reporter `list` to
  CI, which prints a line with the time of each test. Run 46007306862 of that commit gave the times below.
- The 86 tests take 58.2 min. The six tests of `tubes.spec.ts` take 16.1 min of them (ADR 0061: about 9 min for five
  tests). The test of the Crown of veins (ADR 0087, ADR 0098, ADR 0100) is new since then and takes 5.4 min alone: it
  waits for 60 steps of a scene that SwiftShader runs at about one step per second.
- Playwright shares the tests out by their count, in the order of the files. The third shard held five tests of
  `tubes.spec.ts`: 19.5 min of tests. A runner 1.5 times slower takes that shard over the limit.

| Shards | As it was: minutes of each shard | With the Crown test in `veins.spec.ts` |
| ------ | -------------------------------- | -------------------------------------- |
| 4      | 16.4, 13.2, 19.5, 9.1            | 16.4, 13.2, 14.4, 14.2                 |
| 5      | 11.2, 11.1, 19.6, 8.1, 8.2       | 11.2, 11.1, 14.5, 8.3, 13.1            |
| 6      | 10.6, 9.7, 9.3, 16.2, 5.2, 7.2   | 10.6, 9.7, 9.3, 11.7, 4.6, 12.3        |

The left column is a split of the measured order by the count. The right column is the split that Playwright lists
(`--shard=i/n --list`) with the measured time of each test. A job needs 1 to 2 min more for its start.

## Options

1. **More shards alone.** The tests of `tubes.spec.ts` stay side by side: the longest shard keeps 16 to 20 min.
2. **A longer limit.** A run takes as long as its longest shard, and a shard that hangs holds a runner longer.
3. **The Crown test in a file that sorts after `ui.spec.ts`, four shards.** The longest shard takes 16.4 min. A
   runner 1.7 times slower reaches the limit.
4. **The same file, six shards.** The longest shard takes 12.3 min: a runner 2.3 times slower still fits.
5. **A shorter Crown test.** The 60 steps are the fewest that show growth with a margin (the comment at the test).

## Decision

Option 4. `tests/e2e/veins.spec.ts` holds the test of the Crown of veins, and `tests/e2e/colony.ts` holds the helpers
that it shares with `tubes.spec.ts`. The matrix of `verify-e2e` lists six shards. The tests grew by 7 min in nine
days, so the room of option 3 would not last. The reporter `list` stays in CI: the next time a shard is slow, its log
names the tests.

No test changes what it checks. The count of the tests stays 86.

## Consequences

- A run uses two more jobs, each with its start of 1 to 2 min. The time of a run falls, because it is the time of
  its longest shard.
- The split still follows the names of the files. A new file of tests that wait for steps can tip it again
  (ADR 0049). The times in the log show it.

## Results

Run 46011076488 of this pull request, with six shards: 8.3, 7.2, 12.1, 15.8, 7.4 and 10.9 min of tests. The estimate
was 10.6, 9.7, 9.3, 11.7, 4.6 and 12.3 min. The runners differ: the fourth shard ran 1.35 times slower than its
estimate, and the first two ran faster. The longest shard, with a start of 1 to 2 min, used a little more than half
of its limit.

Not measured: more runs. Each column of numbers comes from one run.
