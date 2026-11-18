# Guide for agents

A slime-mold simulation in the browser (Jones 2010 agents, WebGPU with a WebGL2 fallback, Svelte 5, TypeScript). Every
agent loads this file in every turn, so it stays short. It says where things are and which rules hold. The reasons
are in the ADRs it names.

## Aims of the owner

- The model behaves like the real slime mold _Physarum polycephalum_ (`docs/fidelity.md` compares the two).
- Two models: `jones` follows the papers of Jones; `extended` adds growth, the flow in the tubes and more (ADR 0022).
  The Jones scenes follow their papers.
- Every decision is recorded with its date and its reason (ADR 0001, ADR 0040).

## Where things are

| Path                                         | What                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/engine/sim.ts`, `src/engine/shaders/`   | WebGPU: the simulation and its WGSL passes                                             |
| `src/engine/gl/sim.ts`, `src/engine/gl/glsl` | WebGL2: the same passes in GLSL, one for one (`agents.wgsl` ↔ `agents.frag` + `.glsl`) |
| `src/engine/pack.ts`, `sizing.ts`            | the uniforms of every pass; the memory per cell and the fit of the grid                |
| `src/engine/*-reference.ts`                  | CPU references that the GPU tests compare with                                         |
| `src/model/`                                 | settings and their help texts (`params.ts`), scenes (`presets.ts`), links (`link.ts`)  |
| `src/ui/`                                    | the Svelte panel                                                                       |
| `docs/model.md`                              | the rules of the model in force (ADR 0030)                                             |
| `docs/fidelity.md`                           | the model against the organism, with sources                                           |
| `docs/adr/`                                  | the decisions, one file each; `0000-template.md`                                       |
| `research/<topic>/`                          | the scripts behind the numbers of an ADR; `research/flow/README.md` tells the story    |
| `TODO.md`                                    | open points, also the owner's open decisions                                           |

## Commands

- `npm test` (unit), `npm run test:gpu` (both backends, headless Chromium), `npm run lint`, `npm run check`.
- `npm run test:e2e` after `npm run build`; `npm run verify` runs all of it.
- Research runs: `npx vitest run --config research/vitest.config.ts research/flow/engine/<file>` (never in `npm test`).
- Logs: `node --import ./research/flow/register.mjs research/flow/logs.ts` unpacks `research/flow/logs.tar.gz` to
  `research/flow/logs/`; add `pack` to pack it again.
- Wrong rules: `node --import ./research/flow/register.mjs research/flow/engine/mutate.ts check`, then with the names of
  the rules to run them (`research/flow/README.md`, part 7).

## Rules of a change

- Both backends compute the same. A change of a pass changes its WGSL and its GLSL in the same pull request, and the
  GPU tests compare both with the CPU reference.
- A change of a rule changes `docs/model.md` in the same pull request; a new measurement against the organism changes
  `docs/fidelity.md` (ADR 0030).
- Scenes keep their bytes unless the pull request says why. Check with the digests of every scene
  (`research/flow/engine/digest.gpu.test.ts`, `research/flow/README.md` part 6).
- A new rule gets wrong rules in `research/flow/engine/mutate.ts`, and each must fail at least one test.
- A decision gets a new short ADR (ADR 0040): the date, the reason, and who decided (the owner, or an agent under the
  owner's delegation of 2026-11-12). An extended ADR gets one line "Extended by ADR NNNN" in its header list. Take the
  number from `ls docs/adr` on a fetched `main`; parallel branches agree on numbers first.
- Research: the story of a decision on one page first, scripts in `research/<topic>/`, raw logs only in the archive.
  To add logs: unpack the archive of `main`, add the files, pack, and set the count and digest in
  `research/flow/research.test.ts`.
- Docs and code comments are plain, simple English: short sentences, one name for one thing, active voice.

## Git and pull requests

- Commit with `git commit -s` (DCO); GPG signing is on; never `--no-verify`. No AI attribution lines in commits or
  pull requests.
- Bring `main` in with a merge, never a rebase or a force push. `git fetch origin` before a pull request and before a
  merge.
- Squash merge only, title `<PR title> (#n)`, body only the `Signed-off-by:` line.
- Paths in `.github/CODEOWNERS` (`.github/`, `renovate.json`, `.npmrc`, `.pre-commit-config.yaml`, `scripts/`) need
  the owner's review first (ADR 0014).
- Prettier rewrites a whole Markdown table when a new row is longer than its longest row: keep new rows shorter.

## CI and this machine

- CI runs the GPU tests on SwiftShader in the Playwright image of `.github/workflows/ci.yml`. A test that fails only
  there: reproduce it in that image before a fix.
- An e2e test waits for a number of steps, not for a time, before it reads a result of the simulation: a slow runner
  of CI makes few steps per second (`tests/e2e/tubes.spec.ts`).
- CI shares the e2e tests out to four shards by their count, in the order of the files, and runs the GPU tests in
  four parts: by the backend in the name of a test, and `src/engine/sim.gpu.test.ts` apart from the other files
  (ADR 0061). A start of the app builds only the passes that it runs, and a new file of tests that wait for steps can
  tip the shards (ADR 0049).
- Never start a server on the ports 4173, 5173 or 5001. Use another port and do not commit a change of
  `.claude/launch.json`.
- One heavy GPU campaign at a time. WebGL2 runs slow down about 8 times beside heavy WebGPU runs. Never measure the
  time of a step while other GPU work runs; measure builds in turns (`research/flow/engine/turns.sh`).

## Sources and code of others

- Do not commit papers, their text or their figures; quote a few words at most; link a figure, do not copy it.
  `artl.2010.16.2.pdf` in the root stays untracked.
- Do not copy code of Sage Jenson or Bleuje. `.claude/skills/` stays as vendored (its `README.md`).

## Work with less usage

Every step of an agent reads its whole history again. A long history that wakes up often costs the most (ADR 0040).

- Read a big file in parts: search first, then read a range of lines. `docs/adr/0029-flow-in-the-tubes.md` has more
  than 2,000 lines, `research/flow/README.md` more than 1,400, `docs/model.md` about 600.
- Keep command output short (`tail`, `head`, `grep -c`, `git diff --stat`).
- Start a long run in the background and let its end wake you. Do not poll with `sleep` or with short waits.
- One task per agent. At the end of a phase write a short notes file, so that a fresh agent can go on from it.
- Stop a campaign early when its result lies far outside the spread of the seeds.
