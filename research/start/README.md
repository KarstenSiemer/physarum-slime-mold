# The start of the app on WebGPU: why the e2e tests took so long, and how to check it

This folder belongs to [ADR 0049](../../docs/adr/0049-build-the-diffusion-and-outline-passes-at-their-first-use.md).
The first part of this page tells in plain words what was found. The rest is a reference: one command for each check.

## The story in one page

**The question.** CI runs the e2e tests in two jobs at the same time, each with a limit of 30 minutes. The first job
took 21 minutes, then 26, then 29, and then it ran out of time with no failed test. What takes the time?

**Step 1: the tests.** The whole suite ran in the image of CI, on 4 cores, like a runner of GitHub. It took 67
minutes for 83 tests. Almost every test took 40 to 45 seconds, also a test that only presses a few keys. So the time
did not go into what the tests do. It went into what every test does first: it starts the app.

**Step 2: the start.** A start on WebGPU took 36 to 38 seconds until the engine existed, and its first steps 2
seconds more. On WebGL2 the whole start took 5 seconds. In the image of CI, WebGPU runs on SwiftShader, a GPU made of
software. It compiles every pipeline on the CPU. The start built 30 pipelines. Built one at a time, ten of them took
about 4 seconds each: the ten versions of the diffusion pass, one for each way a step can spread the trail. Six
versions of the outline pass took 1 to 2 seconds each. The other 14 pipelines took 2.4 seconds together.

**Step 3: what a start needs.** A step runs one to three of the ten diffusion passes. A scene without food, light or
walls draws no outline at its start. The engine already built every other optional pass when it first needed it: the
passes for walls, the mean window, growth and the flow. The diffusion and outline passes were the exception.

**Step 4: a cache.** A second start could reuse the first one's work. It did not: a reload, a new page, a profile on
disk and three flags of Chromium and Dawn all gave the same 37 seconds.

**Step 5: the change.** Now the engine builds a diffusion or an outline pass the first time a step or a stroke needs
it, and keeps it. The engine exists after 2 to 3 seconds, and the first step waits about 4 seconds for its diffusion
pass. The 83 tests took 23 minutes instead of 67. The median test took 13 seconds instead of 44. Every scene keeps its
bytes: the digests after 500 steps are those of `main`.

**Step 6: the shards.** On GitHub the change saved less: there the start was faster and the steps slower than in the
container. The second job took 11 minutes instead of 19, but the first one still took 25. CI shares the tests out by
their count, in the order of the files, and the five tests of `flow.spec.ts`, which wait for steps, took 9 minutes of
it. The file is now `tubes.spec.ts`: it sorts after `scenes.spec.ts`, and four of its tests run in the second job. In
the container the two jobs then take 11.2 and 11.5 minutes. On GitHub they took 18 and 24 minutes: the second ran on
a slower runner, which took 49 seconds for `npm ci` instead of 34.

**What is not exact.** The times come from an M3 Pro, in a container of 4 cores, with the arm64 build of Chromium of
the image. GitHub runs its x86-64 build on other CPUs: it started the app faster, and stepped slower. The first run of
CI after the change gives its own times.

## The reference

### What you need

Node 26 and the packages of the repository (`npm ci`), Docker, and the image of CI (`run.sh` reads its name from
`.github/workflows/ci.yml`).

### The logs

The 7 logs are one archive, `logs.tar.gz`. Unpack it to `research/start/logs/`, which git ignores:

```bash
node --import ./research/flow/register.mjs research/start/logs.ts unpack
```

`list` shows what the archive holds, and `pack` packs the folder again after a new measurement.

| Files                        | What                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `logs/e2e/*.json`            | the JSON reports of Playwright of the e2e tests: `main`, here, shard 2 |
| `logs/start/start-*.txt`     | one start in parts, its pipelines one at a time, and a second start    |
| `logs/digest/digest-*.jsonl` | the digests of every scene after 500 steps, `main` and here            |

### Step 1: the e2e tests

`run.sh` copies a checkout into the image of CI, installs its packages, builds the site and runs a command as CI
does. The suite takes about 70 minutes on `main` and 25 minutes with the change. The report of the change in the
record is of `7a71a45`, before `flow.spec.ts` got its new name. Run one at a time, while no other GPU work runs:

```bash
git worktree add ../start-main 83d5fc2
git worktree add ../start-change 7a71a45
research/start/run.sh ../start-main e2e-main npx playwright test --project e2e --reporter=json,line
research/start/run.sh ../start-change e2e-branch npx playwright test --project e2e --reporter=json,line
node --import ./research/flow/register.mjs research/start/tables.ts research/start/out/e2e-main.json research/start/out/e2e-branch.json
```

The last command prints the table of the ADR and the split with the new name of the file; without files it reads the
logs of the record. Shard 2 alone, here (12 minutes):

```bash
research/start/run.sh . shard2 npx playwright test --project e2e --shard=2/2 --reporter=json,line
```

### Step 2 to 4: the start

`start.spec.ts` starts the small scene of the e2e tests and prints its times in lines that begin with `START`: one
start, the same start with its pipelines one at a time, a start on WebGL2, and second starts with a cache or a flag.
Only one page runs at a time: a page left open steps on and slows the compiler down. About 9 minutes on `main`, 2
here. On `main` it needs this folder:

```bash
cp -R research/start ../start-main/research/
research/start/run.sh ../start-main start-main npx playwright test --config research/start/playwright.config.ts
research/start/run.sh . start-branch npx playwright test --config research/start/playwright.config.ts
git worktree remove --force ../start-main
git worktree remove --force ../start-change
```

### Step 5: the bytes of the scenes

On `main` and on the branch, about a minute each on the GPU of the machine, then the comparison. It must print that
all 48 runs are equal (`research/flow/README.md`, part 6):

```bash
VITE_NAME=digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/digest-branch.jsonl research/start/logs/digest/digest-main.jsonl
```

`research.test.ts` checks the record with every `npm test`: it unpacks the archive, makes the table, and compares it
with the table of the ADR.
