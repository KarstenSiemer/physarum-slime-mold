# 0014: CI workflows and their hardening

- Status: accepted; revised 2026-11-08 after the GitHub Actions and supply-chain audits, and
  2026-11-09 (ruleset `code owners`, CodeQL languages)
- Date: 2026-11-08

## Context

Workflows run third-party code (actions, npm packages) with access to tokens. The TanStack
incident (May 2026) chained `pull_request_target`, cache poisoning and an OIDC token read from
runner memory. Repository state on 2026-11-08: secret scanning and push protection on;
Dependabot alerts, CodeQL, rulesets, auto-merge and SHA-pinning enforcement off.

## Decision

Workflows (`.github/workflows/`):

| File                    | Trigger          | Jobs                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | PR, push to main | `build`: npm ci, signatures, audit, build, Pages artifact; `verify-gpu` in two parts: the GPU tests whose names hold `webgpu`, and the rest with lint, svelte-check and unit; `verify-e2e` (needs `build`) in two shards: e2e on the `build` artifact; all in the Playwright image; `verify`: passes when `build` and every part of both test jobs passed; `deploy` on main |
| `security.yml`          | PR, main, weekly | `zizmor` (SARIF), `scorecard` (not on PRs)                                                                                                                                                                                                                                                                                                                                  |
| `dependency-review.yml` | PR               | blocks moderate+ vulnerabilities and unlisted licenses                                                                                                                                                                                                                                                                                                                      |
| `renovate.yml`          | hourly           | self-hosted Renovate (ADR 0015)                                                                                                                                                                                                                                                                                                                                             |

Rules applied in every workflow (zizmor `--persona=pedantic` checks them in CI and in
pre-commit; actionlint runs in pre-commit only):

- `permissions: {}` at the top, minimal grants per job, each write grant commented.
- Every action pinned to a full commit SHA with a version comment (resolved via the GitHub API
  on 2026-11-08, kept current by Renovate).
- `persist-credentials: false`, `timeout-minutes` everywhere, concurrency groups.
- No `pull_request_target`, no `workflow_run`, no secrets in PR workflows.
- The deployed site is built in its own job, `build`, which runs only the build chain:
  `vite.config.ts` loads Vite, the Svelte plugin and the CSP plugin, and the test settings live
  in `vitest.config.ts`. Linters, test runners and Chromium run in the test jobs `verify-gpu`
  and `verify-e2e`; `verify-e2e` downloads the artifact and runs the e2e tests against exactly
  those files.
  `deploy` publishes the artifact of `build`. Before this split, every dev tool ran in the job
  that uploaded `dist/` (supply-chain audit, 2026-11-08).
- No dependency cache: `package-manager-cache: false` is set explicitly, because
  setup-node v7 caches automatically as soon as `package.json` names a package manager. A
  cache entry written by any action on main could otherwise reach the job that builds the site.
- zizmor's version is pinned (the action defaults to `latest`). zizmor-action v0.8.1 installs
  zizmor from a hash-locked wheel (`pip download --require-hashes`, `action.sh` at 45d7276), so
  the action's SHA pin also pins zizmor.
- Scorecard results go only to code scanning, not to the OpenSSF API: publishing needs
  `id-token: write`. Accepted risk: `ossf/scorecard-action` runs the image
  `ghcr.io/ossf/scorecard-action:v2.5.0` by tag, and that job can write code-scanning results
  (`security-events: write`).

Not adopted: step-security/harden-runner (adds a third party with root on the runner and
telemetry; our jobs hold no long-lived secrets), workflow lockfiles (GA 2026-10-28, tooling
support still experimental).

Repository settings for the owner to apply (`scripts/github-setup.sh settings`, once, before the
first push): allow auto-merge, squash only, delete merged branches, require SHA pinning,
Dependabot alerts on (Dependabot updates off: Renovate does that), private vulnerability
reporting, CodeQL default setup, and:

- Environments `renovate` and `github-pages` limited to `main`. A workflow pushed to any other
  branch could otherwise read the Renovate App key or deploy the site. A job that names a missing
  environment creates it without protection, so the script must run before the first push.
- Ruleset `main`: PR required, linear history, and the required checks `build`,
  `verify`, `zizmor` and `dependency-review`, bound to the GitHub Actions app (id 15368), so no
  other app or token can report them. `build` is required as well, because a job that is skipped
  after a failed dependency counts as passed. Conversation resolution is off: on a public
  repository anyone can open a review thread and would block every Renovate PR with it.
- Ruleset `code owners`: changes to the paths in `.github/CODEOWNERS` (workflows, Renovate
  config, `.npmrc`, pre-commit config, scripts) need the owner's approval. A change of the diff
  after the approval, for example a new push, dismisses the approval. A pull request runs the
  workflow files it contains, so a PR that edits them can make its own checks pass; the binding
  to app 15368 does not prevent that. The owner's own pull requests pass this ruleset without a
  review: GitHub's rule evaluation of the PR #7 merge (`scripts/`, rule suite 5003859265) shows
  `pass`, although the [rules documentation][rules] requires the code owner's approval. Admins
  may bypass this ruleset only through a pull request. The bypass stays in case GitHub enforces
  the documented approval: the owner, the only code owner, cannot approve their own pull
  requests. Ruleset `main` has no bypass, so its checks always apply.
- Ruleset `code owners` does not require an approval of the last push
  (`require_last_push_approval: false`, owner decision of 2026-11-09). Per the
  [rules documentation][rules], that option requires an approval from someone other than the
  person who pushed last. With 0 required approvals it still blocked pull requests without
  code-owned files: Renovate PR #3 (`.node-version`) waited with all required checks green.
  The same documentation calls the dismissal of stale approvals the safer protection against
  unapproved content in an approved pull request.
- Checked on 2026-11-09 after the change: auto-merge merged PR #3 without a review. Renovate
  PR #4 (`.pre-commit-config.yaml`) stayed blocked with all required checks green and a review
  request to the owner, and GitHub reports no errors in `.github/CODEOWNERS`. So code owner
  review applies with an approval count of 0, and updates without code-owned files merge
  without a review.
- CodeQL default setup analyses `actions`, `javascript-typescript` and `python`. Both modes of
  the script name these languages, so a second run of either mode keeps them. The call in
  `settings` on 2026-11-08, before the first push, started no analysis. The first CodeQL run
  followed `scripts/github-setup.sh codeql` on 2026-11-09. That call named no languages, and
  GitHub then analysed every detected language, also `python` (the vendored `.claude/skills/`
  scripts).
- `python` stays (owner decision of 2026-11-09). The vendored `supply-chain-risk-auditor`
  scripts run with the owner's GitHub token (`gh auth token`), so CodeQL keeps checking them: a
  flaw in a later upstream version then raises an alert. CodeQL found 3 high alerts in them: a
  ReDoS (9, `collect.py:500`) and two incomplete URL checks (10 and 11, `sources.py:406` and
  `:551`). Alerts 10 and 11 cannot send a request or the token to another host: every request
  with the token goes to the literal `https://api.github.com`. Alert 9 only costs CPU time and
  needs a crafted `go.mod` in an audited project. The alerts are dismissed as "won't fix" with
  these reasons, because the copy stays byte-identical to upstream (ADR 0017). The owner
  reports the findings to Trail of Bits. Merge protection counts an alert only if all its lines
  are in the pull request diff, so PRs #3 and #4 passed the CodeQL check while these alerts
  were open.
- Ruleset `codeql` (`scripts/github-setup.sh codeql`, after the first merge): blocks merges with
  new CodeQL errors or high and critical security alerts. GitHub blocks every merge while a
  required code scanning tool has no analysis, and ruleset `main` has no bypass, so this gate is
  added only once `main` has a CodeQL analysis.
- Both rulesets set `require_extra_approval_for_unattributed_changes: true`. GitHub applied
  this default when the script ran on 2026-11-08, and the script now writes it explicitly. Per
  the [rules documentation][rules] (checked 2026-11-09), this public-preview option requires one
  more approval for a pull request that Copilot opens without attribution to a person. With 0
  required approvals it has no effect.
- The script can run again: rulesets are created or updated by name.

- The test jobs run in the Playwright image `mcr.microsoft.com/playwright`, pinned by version and
  digest (owner decision, 2026-11-11). Before, each run installed Chromium and about 50 system
  packages with `npx playwright install --with-deps`, which needs an Ubuntu mirror. On 2026-11-11
  the runners could not resolve `archive.ubuntu.com` and `security.ubuntu.com` from 14:20 to at
  least 15:05 UTC, in two regions, while `packages.microsoft.com` resolved; three runs failed
  before a test started. The image comes from Microsoft's registry and holds the browsers. Its
  version must equal `@playwright/test` in `package.json`, so Renovate groups the image with
  `@playwright/test` and `playwright` in one pull request that is not auto-merged. The image is
  Ubuntu 24.04 on an Ubuntu 26.04 runner, the same image that local checks in the CI image use
  (ADR 0010). `--ipc=host` gives Chromium the shared memory it needs in a container.

## Consequences

- Required check names are job names (`build`, `verify`, `zizmor`, `dependency-review`); renaming a
  job breaks the ruleset.
- `verify` is a gate: it passes only when `build`, `verify-gpu` and `verify-e2e` passed (2026-11-11,
  owner decision after one job ran into its 30 min on a slow runner). `verify-gpu` (lint, check,
  unit, GPU) starts at once; `verify-e2e` starts after `build`, so the two test suites run at the
  same time.
- Each test job runs in two parts at the same time (2026-11-12, owner decision: "Ja, aufteilen").
  On GitHub the GPU job had taken 10 to 25 min and the e2e job 14 to 30 min of their 30 min, and the
  same code on `main` varied by about 2 times between runs (GPU 11 and 19 min). Two runs of PR #31
  and #35 ran into the limit: the e2e job of #35 had passed 55 of 56 tests when it was stopped.
  - The e2e tests use Playwright's `--shard=1/2` and `2/2`: `fullyParallel` shares them out by test,
    28 and 28 of 56, and together the two shards list every test once.
  - The GPU tests do not split by file: the four files already run at the same time, and
    `sim.gpu.test.ts` alone took 21 of the job's 21 min (PR #34). They split by the backend in
    their full names: one part runs `--testNamePattern webgpu`, the other `^(?!.*webgpu)`, so every
    test runs in exactly one part, also a test added later. On 2026-11-12 the parts ran 276 and 308
    tests; together 584 ran and 1 was skipped, the 585 of one job before.
  - Lint, svelte-check and the unit tests run in the GPU part `rest` only.
  - The parts are matrix jobs. Their check names gain the part (`verify-gpu (webgpu)`,
    `verify-e2e (1/2)`); the ruleset requires `verify`, whose name stays, and `needs.<job>.result`
    of a matrix job is success only when every part succeeded. Each part keeps the limit of 30 min.
    The cost is two more runners per run, and `npm ci` and the image start once more each.
- Residual risk: a Renovate PR with auto-merge and without code-owned files (npm packages,
  `.node-version`) merges without review once the checks pass (ADR 0015).
- CodeQL does not read `.svelte` files; logic lives in `.ts`, and ESLint checks components.

[rules]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
