# 0014: CI workflows and their hardening

- Status: accepted (repository settings pending, owner action); revised 2026-11-08 after the
  GitHub Actions and supply-chain audits
- Date: 2026-11-08

## Context

Workflows run third-party code (actions, npm packages) with access to tokens. The TanStack
incident (May 2026) chained `pull_request_target`, cache poisoning and an OIDC token read from
runner memory. Repository state on 2026-11-08: secret scanning and push protection on;
Dependabot alerts, CodeQL, rulesets, auto-merge and SHA-pinning enforcement off.

## Decision

Workflows (`.github/workflows/`):

| File                    | Trigger          | Jobs                                                                                                                                                                            |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | PR, push to main | `build`: npm ci, signatures, audit, build, Pages artifact; `verify` (needs `build`): lint, svelte-check, unit, GPU (SwiftShader), e2e on the `build` artifact; `deploy` on main |
| `security.yml`          | PR, main, weekly | `zizmor` (SARIF), `scorecard` (not on PRs)                                                                                                                                      |
| `dependency-review.yml` | PR               | blocks moderate+ vulnerabilities and unlisted licenses                                                                                                                          |
| `renovate.yml`          | hourly           | self-hosted Renovate (ADR 0015)                                                                                                                                                 |

Rules applied in every workflow (zizmor `--persona=pedantic` checks them in CI and in
pre-commit; actionlint runs in pre-commit only):

- `permissions: {}` at the top, minimal grants per job, each write grant commented.
- Every action pinned to a full commit SHA with a version comment (resolved via the GitHub API
  on 2026-11-08, kept current by Renovate).
- `persist-credentials: false`, `timeout-minutes` everywhere, concurrency groups.
- No `pull_request_target`, no `workflow_run`, no secrets in PR workflows.
- The deployed site is built in its own job, `build`, which runs only the build chain:
  `vite.config.ts` loads Vite, the Svelte plugin and the CSP plugin, and the test settings live
  in `vitest.config.ts`. Linters, test runners and Playwright's downloaded Chromium run in
  `verify`, which downloads the artifact and runs the e2e tests against exactly those files.
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
- Ruleset `main`: PR required, linear history, CodeQL gate, and the required checks `build`,
  `verify`, `zizmor` and `dependency-review`, bound to the GitHub Actions app (id 15368), so no
  other app or token can report them. `build` is required as well, because a job that is skipped
  after a failed dependency counts as passed. Conversation resolution is off: on a public
  repository anyone can open a review thread and would block every Renovate PR with it.
- Ruleset `code owners`: changes to the paths in `.github/CODEOWNERS` (workflows, Renovate
  config, `.npmrc`, pre-commit config, scripts) need the owner's approval, also after the last
  push. A pull request runs the workflow files it contains, so a PR that edits them can make its
  own checks pass; the binding to app 15368 does not prevent that. Admins may bypass this ruleset
  only through a pull request, so the owner can merge their own PRs while the checks of ruleset
  `main` still apply. Per GitHub's rules documentation, code owner review applies with an
  approval count of 0, so npm updates still merge without a review. Check it once with a test PR
  that touches `.github/`.

## Consequences

- Required check names are job names (`build`, `verify`, `zizmor`, `dependency-review`); renaming a
  job breaks the ruleset.
- `verify` starts after `build`, so a run takes about one `npm ci` and build longer.
- Residual risk: an npm update PR that passes the checks merges without review (ADR 0015).
- CodeQL does not read `.svelte` files; logic lives in `.ts`, and ESLint checks components.
