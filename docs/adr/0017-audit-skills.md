# 0017: Audit skills for Claude Code

- Status: accepted; revised 2026-11-09 (lockfiles of `supply-chain-risk-auditor`, CodeQL alerts)
- Date: 2026-11-08

## Context

The owner asked for skills from GitHub that let Claude audit this TypeScript project for
security and quality. Research on 2026-11-08 compared Trail of Bits, Anthropic, Cloudflare,
Sentry, OpenAI (via Trail of Bits' curated set), Semgrep, Snyk and Svelte sources. Findings:

- None of the scanners or skills parse `.svelte`, WGSL or GLSL.
- Semgrep's skills forbid redistribution; Semgrep Guardian uploads written code; Snyk's
  recipes install via `curl | bash`; Anthropic's `claude-security` plugin has a proprietary
  license. These were not adopted.
- Trail of Bits' `supply-chain-risk-auditor` reads npm, PyPI and Go projects. For npm it reads
  `package.json` with `package-lock.json` or `npm-shrinkwrap.json`. It detects `pnpm-lock.yaml`
  and `yarn.lock`, but does not read them (one reason for npm in ADR 0011). Its scripts need
  only the Python standard library.

## Decision

Vendor six reviewed skills, unchanged, into `.claude/skills/` with their licenses and source
commits (see `.claude/skills/README.md`): Cloudflare `security-audit`, Sentry
`gha-security-review`, Trail of Bits `sharp-edges` and `supply-chain-risk-auditor`, OpenAI
`security-best-practices`, Svelte `svelte-core-bestpractices`. The pre-commit fixers and linters,
Prettier and ESLint exclude the folder so it stays byte-identical to upstream. The secret
scanners (gitleaks, detect-private-key) still check it.

Audits run report-only (no file changes); findings are verified in the code before a fix.

## Consequences

- The skills are available to every Claude Code session in this repository.
- Updates are manual: copy a newer upstream commit and read the diff for unsafe instructions.
- Trail of Bits skills are CC-BY-SA-4.0: changes to those files must keep that license.
- CodeQL analyses the vendored Python scripts (ADR 0014). An alert in them is checked in the
  code. If it has no impact on this project, it is dismissed with the reason, and the copy stays
  unchanged. The owner decided on 2026-11-11 not to report the findings of the current copy
  upstream (TODO.md). A new upstream copy can bring new alerts.
