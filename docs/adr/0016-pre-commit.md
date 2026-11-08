# 0016: pre-commit hooks

- Status: accepted
- Date: 2026-11-08

## Context

The owner already uses the `pre-commit` framework (4.6.2 installed). Hooks must be fast and
catch what CI would reject, without hiding CI failures.

## Decision

`.pre-commit-config.yaml`, revisions frozen to commit SHAs (updated by Renovate):

| Stage      | Hooks                                                                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pre-commit | file hygiene (large files > 500 KB, merge markers, YAML/JSON, line endings), `detect-private-key`, gitleaks, actionlint, zizmor (pedantic, offline), workflow + Renovate schema, typos (report only), Prettier, ESLint, WGSL compile check (Tint in headless Chromium, only when `.wgsl` changes), no commits to `main` |
| pre-push   | `svelte-check`, unit tests                                                                                                                                                                                                                                                                                              |

`pre-commit install` sets up both stages (`default_install_hook_types`).

## Consequences

- First run downloads Go and Python tool environments (a few minutes, once).
- Accepted risk (web security audit, 2026-11-08): the hook revisions are frozen, but pre-commit
  resolves the Python hooks' own dependencies (for example `ruamel.yaml`, `jsonschema`) from PyPI
  without pins or hashes when it builds an environment. That happens on the first run and after
  a hook update. Hook updates are therefore never auto-merged (ADR 0015), so the owner decides
  when a new environment is built.
- Vendored skills in `.claude/skills/` are excluded from the fixers and linters only; gitleaks and
  `detect-private-key` scan them too (ADR 0017).
- typos does not rewrite text: it once changed the journal abbreviation "Nat. Comput."
  Exceptions live in `_typos.toml`.
- GPU tests and e2e stay in CI and the manual loop (`npm run verify`); they are too slow for
  every commit.
