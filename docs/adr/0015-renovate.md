# 0015: Dependency updates with Renovate

- Status: accepted (GitHub App pending, owner action); revised 2026-11-08 after the GitHub
  Actions audit
- Date: 2026-11-08

## Context

The user wants updates as pull requests that merge themselves when the tests pass. Facts
(Renovate docs, GitHub changelog, checked 2026-11-08):

- Pull requests created with the workflow `GITHUB_TOKEN` do not trigger workflows, and since
  2026-06-11 they wait for manual approval. `GITHUB_TOKEN` also cannot change workflow files.
- Renovate's `platformAutomerge` uses GitHub's native auto-merge. Without "Allow auto-merge"
  and required status checks, GitHub may merge failing pull requests.
- `config:best-practices` = `config:recommended` + pinned action digests, pinned dev
  dependencies, 3-day `minimumReleaseAge` for npm, config migration, weekly lockfile upkeep.
- The release age only works with a release date from the datasource
  (`docs/usage/key-concepts/minimum-release-age.md`). GHCR, Quay and ECR give none; since
  Renovate 42 (`minimumReleaseAgeBehaviour=timestamp-required`) their updates are held forever.
  Docker Hub gives `tag_last_pushed`, and a re-pushed tag restarts the delay. For git tags
  (`github-tags`, used for actions) Renovate takes the commit date, so a moved or backdated tag
  passes the age gate at once.
- `renovatebot/github-action` v46.3.12 runs `ghcr.io/renovatebot/renovate:44` (a floating tag)
  unless `renovate-image` holds a full reference (`src/docker.ts` at 1c0cf98).

## Options

1. Mend-hosted Renovate app — no maintenance; a third party holds write access to code and
   workflows.
2. **Self-hosted** `renovatebot/github-action` with a token from **our own GitHub App** —
   short-lived tokens (1 h), narrowed per run, Renovate image pinned and updated by Renovate.
3. Self-hosted with a fine-grained PAT — tied to a person, expires, gaps around checks.

## Decision

Option 2 (`.github/workflows/renovate.yml`, hourly; skipped until `vars.RENOVATE_CLIENT_ID`
exists). `renovate.json`: `config:best-practices`, pin everything except peer ranges, action
digests with semver comments, pre-commit hook updates, `rangeStrategy: pin`, 3-day release
age, OSV vulnerability alerts.

- Renovate's image: `docker.io/renovate/renovate:44.219.0@sha256:7ae45249…` (version and
  digest), updated by a regex custom manager. Docker Hub instead of GHCR, so the release age
  applies (see Context). It is the same image: both registries return the index digest
  `sha256:7ae452492cd2393dbb8d401c6a3e7569bb7e6b5a7d2783739a6e4af576fd248a` for 44.219.0
  (pushed 2026-11-05 12:17 UTC), and its cosign signature verifies against the GitHub Actions
  identity `https://github.com/renovatebot/…`. GitHub's Actions limits page (Enterprise Server
  edition, not confirmed for github.com) says Docker Hub's rate limit does not apply to public
  pulls from GitHub-hosted runners. If pulls fail, Renovate retries on the next hourly run.
- Auto-merge (squash) for minor, patch, digest and pin updates of packages ≥ 1.0 (versions
  matching `!/^v?0\./`; actions report `v0.8.1`, so the earlier `!/^0/` let 0.x actions
  through), `@webgpu/types` and lockfile maintenance.
- Never auto-merged: majors, 0.x, GitHub Actions, pre-commit hooks and Renovate's image. Actions
  and the image run with repository secrets (the App key is in the same job as the Renovate
  action), hooks run on the owner's machine, and their tags can be moved or backdated.
- `ignorePaths` adds `.claude/skills/**`: vendored skills stay identical to upstream (one of them
  has a `pyproject.toml`). The option replaces the preset's list instead of merging
  (`mergeable: false`), so the list from `:ignoreModulesAndTests` is repeated.
- Checked with Renovate 44.219.0 on 2026-11-08: `renovate-config-validator --strict --no-global`
  passes, and a local extract (`--platform=local --dry-run=extract`) finds the image with version
  and digest, `.node-version`, npm, actions and hooks, and nothing under `.claude/skills/`.

Owner setup:

1. Create a GitHub App (no webhook) with repository permissions: Contents, Pull requests,
   Issues, Workflows, Commit statuses, Checks: read & write; Administration, Dependabot
   alerts: read. Install it on this repository only.
2. Repository settings from ADR 0014 (`scripts/github-setup.sh settings`): auto-merge, the
   rulesets, and the environment `renovate` limited to `main`.
3. Repository variable `RENOVATE_CLIENT_ID`; secret `RENOVATE_PRIVATE_KEY` in the environment
   `renovate` (an environment secret, not a repository secret).

## Consequences

- OWASP advises against auto-merge; the age gate, required checks, SHA pinning and no
  auto-merge for majors reduce the risk but do not remove it.
- Residual risk: the App token can merge any PR whose checks pass, unless it touches a path in
  `.github/CODEOWNERS`. Whoever steals the token can therefore also change `package.json`
  scripts, which CODEOWNERS does not cover (npm updates must keep merging on their own). Only
  reviewed code receives the token: the image and the actions are pinned, and their updates need
  a review.
- Renovate does not age-check lockfile-only updates; `min-release-age` in `.npmrc` covers
  transitive versions during its `npm install`.
