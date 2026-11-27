# Part E2e of the engine of stage 4: notes of the build (2026-11-20)

The brief of the coordinator: the owner chose the form `take` of the drift on 2026-11-20 (ADR 0074, option 2); build
it in both backends behind the setting `territory`, with a CPU copy, GPU tests, wrong rules, `docs/model.md` and the
digests, and measure the start scene on both backends over 12 seeds. These notes hold the state, so that a fresh agent
can go on from them. The decision is ADR 0075.

## 1. The rule

While the rules of stage 4 run, an agent of strain s on a cell a reads at a sensor that is not blocked:

- nothing more than V (7.3 of `docs/model.md`) if a holds no tube of s: G_s(a) = 0;
- else V − δ · P̄(c) if the cell c of the sensor holds a tube of s (G_s(c) > 0), with P̄ the mean pressure of the four
  lanes of the flow of s;
- else V − δ · (P̄(a) − SO · t_a / G_s(a)): t_a = S · r_a / R_s, what the sink of a took in the flow of the step before
  (0 while the front of s took no flux), SO the sensor offset.

G_s is lane z of the memory after the update of the step before (G > 0 exactly where the tube body is 0.05 or more,
lane y against `U.c.z`). The prototype decides a tube by `G > 0` (`driftPressure()` of `research/front/sim.ts`) and
subtracts P̄(a) from every sensor of the agent, which changes no choice; the engine leaves it out.

## 2. Where it is

| What                                  | WebGPU                                                          | WebGL2                                                     |
| ------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| the share S · r / R of a cell         | `taken()`, `shaders/flow.wgsl:235`, shared by `sinksAndSources` | `taken()`, `gl/glsl/flow.frag:110`, the same               |
| take / G for the sensors              | entry point `takes`, `flow.wgsl:456`, binding 15 `takeOut`      | PASS 5, `flow.frag:419`, with the mean pressure (MRT)      |
| the run of it, at the start of a step | `encodeTakes()`, `src/engine/sim.ts:1950`, from `:1672`         | `encodeDrift()`, `src/engine/gl/sim.ts:1992`, from `:1776` |
| the texture                           | `sinks.takes`, `r32float`, a layer per strain (`ensureSinks()`) | `sinks.pressures`, `sinks.takes`: `RGBA32F`, lane s        |
| the reads of the agent pass           | `driftOf()`, `sense()`, `agents.wgsl:208`, `:218`, `:235`       | `driftOf()`, `sense()`, `agents.frag:122`, `:157`, `:174`  |
| the CPU copy                          | `takesOf()`, `meanPressure()`, `groundOf()`, `drifted()`        | `src/engine/flow-reference.ts:261`, `:370`, `:380`, `:392` |
| the memory                            | `SINK_BYTES_PER_CELL` 8 (`sizing.ts:197`)                       | `DRIFT_BYTES_PER_CELL_GL` 32 (`sizing.ts:217`)             |

- WebGL2 samples 14 textures in the agent pass now, in place of 16: the four samplers `flowPressure` to
  `flowPressure3` gave way to `pressures` (lane s the mean pressure of strain s) and `takes` (lane s take / G).
  PASS 5 draws per strain with its block into its lane of both targets (`gl.colorMask`), as two targets of one
  framebuffer (`driftTarget()`).
- The pass reads the state as the flow of the step before left it (WebGPU in place, WebGL2 the current copies `sr`,
  `st`, `flowM`, `flowP`). So `writeFlow()`, `writeSinks()`, `writeSinkState()` and `writePressure()` of a test reach
  the sensors of the next step, and no copy can go stale. Nothing clears the textures: each step writes them first.
- `claim` binds 5 storage buffers (agents, env, occ, claims, clearance), not 8: `settle` binds 8. Two more buffers
  would fit `claim`; the texture was the brief, and it keeps one function of the share per backend, the same pass on
  both backends, and one texel per sensor (ADR 0075, decision 2).

## 3. Tests and wrong rules

- `src/engine/flow-sinks.gpu.test.ts`, both backends: `driftCase()` (64 × 64 cells, 256 agents, tubes on half of the
  cells with G 1 or 2, rates k / 16, R 16 with flux for strain 0 and none for strain 1, whole pressures: every value
  exact) for the turns against the CPU copy at drift 1.5 and 0; a shift of +200 / −200 of every tube cell of each
  strain, which moves no agent while the form of before turns more than 20 otherwise; and the memory of each backend.
- `src/engine/flow-reference.test.ts`: `takesOf()` against `sinksAndSources()`, and the reads on cases made by hand.
- `src/engine/shaders/variant.test.ts`: TERRITORY replaces 4 lines of `agents.wgsl` now (the three calls of the
  sensors in `steer()`).
- `sizing.test.ts`, `engine.test.ts`: the memory of the drift on each backend, and the fit.
- `research/flow/engine/mutate.ts`: 19 wrong rules follow the new code (S2, L1, TY96, TY104, TY105, TY108, TY110,
  TY113, TY114, TY117, TY119 to TY125, TY133, TY139), and TY231 to TY270 are new. Run them with

  ```bash
  node --import ./research/flow/register.mjs research/flow/engine/mutate.ts S2 L1 TY96 TY104 TY105 TY108 TY110 TY113 TY114 TY117 TY119 TY120 TY121 TY122 TY123 TY124 TY125 TY133 TY139 $(seq -f 'TY%g' 231 270)
  ```

## 4. The checks so far

- `npm test` with `RESEARCH=full`: 978 tests pass. `npm run test:gpu`: 1,426 pass on both backends.
- The digests of every scene after 500 steps on both backends (`research/flow/README.md`, part 32): 62 of 62 equal to
  the record of ADR 0072 (`logs/engine/tube-0072/digest-branch.jsonl`).

  ```bash
  VITE_FLOW=1 VITE_NAME=g75-digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
  node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/g75-digest-branch.jsonl research/flow/logs/engine/tube-0072/digest-branch.jsonl
  ```

## 5. The measure

The start scene `three-networks` with the rules on both backends, seeds 1 to 12, to step 1,503 (174 s on an M3 Pro),
and its summary: per backend and strain the median and the range of the live agents, the Mann-Whitney p between the
backends, and the least pressure of the first 30 steps.

```bash
VITE_OUT=e2e-backends npx vitest run --config research/vitest.config.ts research/front/e2e-backends.gpu.test.ts
node --import ./research/flow/register.mjs research/front/e2e-summary.ts research/front/out/e2e-backends.txt
```

| Strain | WebGPU        | WebGL2          | p    | WebGPU higher in |
| ------ | ------------- | --------------- | ---- | ---------------- |
| A      | 291 (259–424) | 307.5 (244–396) | 0.64 | 64 of 144 pairs  |
| B      | 296 (224–374) | 316.5 (226–403) | 0.27 | 52 of 144 pairs  |
| C      | 328 (241–382) | 299.5 (261–430) | 0.89 | 69 of 144 pairs  |
| sum    | 954.5         | 964.5           | 0.60 | 63 of 144 pairs  |

- The backends agree within the spread of the seeds, and the spread is narrow: every strain of the 24 runs ends with
  224 to 430 agents. The prototype gave one strain alone in the dish of the start scene, with `take`, 284 to 435 agents
  at step 1,500 (ADR 0074, finding 6); the engine with the form `all` 124 to 1,593 per strain at step 1,503 (ADR 0072).
- The least mean pressure of a strain in the first 30 steps: −346 to −2,513 on WebGPU, −258 to −3,801 on WebGL2. After
  the fix of ADR 0072 it was −315 to −3,801 over seeds 1 to 6; 25 of the 36 values of those seeds are the same to the
  unit (`logs/engine/tube-0072/islands-after.txt`).
- The record is `logs/engine/take-0075/backends.txt` in `research/flow/logs.tar.gz`.

## 6. The time of a step

The start scene at capacity 1, seed 1, step 1,833 (`bench.gpu.test.ts`), this branch and `main` in turns, two runs
each, on an M3 Pro without other load: WebGPU 3.74 and 3.72 ms against 3.67 and 3.63 ms, WebGL2 8.06 and 7.96 ms
against 7.84 and 7.80 ms; this branch without the rules 2.89 and 3.78 ms. So `takes` and PASS 5 with the reads of the
sensors cost about 2 to 3 % of a step with the rules. The agents differ too: 1,387 and 1,372 alive with `take`, 4,356
and 1,314 with `all` (records `logs/engine/take-0075/steps-*.jsonl`).

```bash
git archive origin/main | (mkdir -p .main-src && tar -x -C .main-src)
run() { (cd $1 && VITE_SCENES=three-networks VITE_FLOWS=on VITE_WARM=1500 VITE_BATCH=30 VITE_BATCHES=11 VITE_NAME=$2 VITE_PATCH='{"territory":true,"capacity":1}' npx vitest run --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts); }
run . e2e-steps-branch-r1; run .main-src e2e-steps-main-r1; run . e2e-steps-branch-r2; run .main-src e2e-steps-main-r2
```

A trap: the copy of `main` must lie outside `research/`. A file of a command is a filter on the paths that the
configuration finds, so with a copy under `research/` the command runs the file of the copy as well, and both runs
write the same record (here the first timing of this branch was that of `main`). The log of a run must say
`Tests 1 passed (1)`.

## 7. Next

- Part E4 (`research/front/ENGINE.md`): the scenes turn the rules on, with the drift of each scene; the panel; the
  measures of the scenes with growth and the flow; the e2e tests of Reid et al.
- Not measured here: any scene with the rules but the start scene; the drift `take` at the weights 0, 1.25 and 5 in
  the engine; the look in the app.
