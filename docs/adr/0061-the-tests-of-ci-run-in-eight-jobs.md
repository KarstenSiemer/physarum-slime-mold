# 0061: The tests of CI run in eight jobs: four e2e shards and four GPU parts

- Status: accepted. Decision of an agent under the owner's delegation of 2026-11-12. It changes
  `.github/workflows/ci.yml`, so it needed the owner's review (ADR 0014): the owner approved it on 2026-11-18, and
  it went into `main` with PR #109 on that day.
- Date: 2026-11-18
- Extends [ADR 0014](0014-ci-hardening.md), which made two e2e shards and two GPU parts, and
  [ADR 0049](0049-build-the-diffusion-and-outline-passes-at-their-first-use.md), which balanced the shards.
- Extended by [ADR 0102](0102-six-e2e-shards-and-the-crown-test-apart.md).

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
- The two GPU jobs have the same limit and are as close to it. In the same five runs of `main` the WebGPU part took
  20.5 to 28.5 min and the other part 13.6 to 28.7 min. At one commit of PR #108 the WebGPU part was cancelled at
  30 min with every test passed until then (run 44337465044). In the same hour that part took 23.7 min with the code
  of `main` (run 44337639190 of this pull request).
- In CI the files of the GPU project run one after the other (`fileParallelism` in `vitest.config.ts`). One file,
  `src/engine/sim.gpu.test.ts`, takes 44 % of the time of all of them: 582 of 1,334 s in the image of CI, with the
  code of PR #108 on 2026-11-18.
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

- **The e2e tests: option 5, four shards.** The longest shard takes a little more than half of its limit, so a slow
  runner and the tests of the next weeks fit. A fifth shard gains 2 min. The workflow takes the number of the shards
  from its matrix (`strategy.job-total`), so the list `shard` is the one place that holds it. With a number in two
  places, a change of one of them would run a part of the tests twice or not at all.
- **The GPU tests: four parts.** The two halves by the backend in the name of a test stay (ADR 0014). Each half
  splits by the file again: `src/engine/sim.gpu.test.ts` alone, and the other files. A test has one name and lies in
  one file, so each test runs exactly once. Lint, the type check and the unit tests stay in the part `rest`. A
  longer limit was the other way: it keeps a run as long as its longest job, 25 to 30 min.
- The limit stays 30 min for every job.

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
- The GPU parts by the file: `vitest list --project gpu` names 347 tests, 184 of them in `src/engine/sim.gpu.test.ts`
  and 163 in the other files (the list does not fill in the names of the backends, so it cannot check the halves).
- On GitHub the four e2e shards took 12.8, 8.1, 10.6 and 11.3 min with the start in the first run of the pull
  request (run 44333749052), 11.8, 11.0, 17.9 and 9.9 min in the second (run 44337639190) and 12.3, 11.2, 16.4 and
  11.3 min in the third (run 44348279489). Every test passed. The runners differ: the third shard took 10.6 and
  17.9 min for the same tests.
- On GitHub the four GPU parts took 7.2 min (`webgpu-sim`), 14.2 min (`webgpu-rest`), 7.6 min (`rest-sim`) and
  16.0 min (`rest`, with lint, the type check and the unit tests) in run 44348279489. With two parts the same code
  took 23.7 and 16.1 min in the run before.
- In that run `src/engine/sim.gpu.test.ts` took 742 of the 2,195 s of the GPU tests, a third.
- Each GPU test runs once: the two parts for WebGPU passed 449 and 197 tests, and the WebGPU part of the run before 646. The two other parts passed 444 and 250 tests, and the other part of the run before 694.
- The longest of the eight jobs took 16.4 min: a little more than half of the limit.
- The linters of the workflows pass (`actionlint`, `zizmor`, `check-github-workflows` of the commit hooks).
- The GPU parts by the file: `vitest list --project gpu` names 347 tests, 184 of them in `src/engine/sim.gpu.test.ts`
  and 163 in the other files (the list does not fill in the names of the backends, so it cannot check the halves).
- On GitHub the four shards of the pull request took 12.8, 8.1, 10.6 and 11.3 min with the start (run 44333749052), and
  every test passed. The first shard took 5 min more than the estimate and the third 6 min less: one run, and the
  runners differ. The longest shard took less than half of its limit.

## Consequences

- A run of CI starts four more runners. Each takes 1 to 2 min to start (`npm ci`, the built site). The result of
  the e2e tests comes after about 15 min, not after 25 to 30.
- A GPU test in a new file runs in the parts for the other files. A file that grows as large as
  `src/engine/sim.gpu.test.ts` needs a part of its own.
- The check `verify` needs every shard, as before: it reads the result of the whole matrix job. The ruleset requires
  `verify` alone (ADR 0014), so the new names of the shards change nothing there.
- `AGENTS.md` says four shards and four GPU parts.
- To watch (ADR 0049): the split is still by count in the order of the files. A new file of slow tests beside
  `tubes.spec.ts` makes its shard longer.
