# Vendored audit skills

Third-party [Agent Skills](https://docs.claude.com/en/docs/claude-code/skills) used to audit this
project. Copied unchanged from the sources below on 2026-11-08, after reading them for unsafe
instructions. Each folder keeps its upstream license. Update by copying a newer commit and
re-reading the diff.

| Skill | Purpose | Source (commit) | License |
|---|---|---|---|
| `security-audit` | Whole-repo audit: client-side, resource exhaustion, supply chain, CI | [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) (`c1c8a8c`) | MIT |
| `gha-security-review` | GitHub Actions: injection, triggers, tokens, poisoning | [getsentry/skills](https://github.com/getsentry/skills) (`e94f222`) | Apache-2.0 |
| `sharp-edges` | Dangerous APIs and footguns, incl. JavaScript/TypeScript | [trailofbits/skills](https://github.com/trailofbits/skills) (`e4dd0bb`) | CC-BY-SA-4.0 |
| `supply-chain-risk-auditor` | npm dependency risk from `package-lock.json` | [trailofbits/skills](https://github.com/trailofbits/skills) (`e4dd0bb`) | CC-BY-SA-4.0 |
| `openai-security-best-practices` | Web frontend security practices | [trailofbits/skills-curated](https://github.com/trailofbits/skills-curated) (`6d05be4`) | Apache-2.0 |
| `svelte-core-bestpractices` | Correct Svelte 5 code | [sveltejs/ai-tools](https://github.com/sveltejs/ai-tools) (`d3e755b`) | MIT |

Notes:

- `supply-chain-risk-auditor` scripts need only the Python ≥ 3.11 standard library; run them with
  `python3 …/scripts/collect.py` when `uv` is not installed.
- None of these skills can parse `.svelte`, WGSL or GLSL; ESLint (`eslint-plugin-svelte`),
  `svelte-check` and the GPU tests cover those files.
- The built-in `/security-review` skill is the zero-install baseline for a quick review of a diff.
