# 0011: npm and toolchain versions

- Status: accepted; revised 2026-11-09 (lockfiles of the audit skill)
- Date: 2026-11-08

## Context

The 2025–2026 npm incidents (chalk/debug crypto-drainer in the browser bundle, the Shai-Hulud
install-script worm, the TanStack trusted-publishing compromise) all used fresh releases or
install scripts. Every window closed within about three days. Node 25+ no longer ships
Corepack. Node 26.13 is LTS and bundles npm 11.20.

Verified on 2026-11-08: npm 11.19 has `min-release-age` (days), `ignore-scripts` and
`allow-git` (`npm help config`). Trail of Bits' `supply-chain-risk-auditor` skill reads npm's
`package-lock.json` or `npm-shrinkwrap.json`. It detects `pnpm-lock.yaml` and `yarn.lock`, but
does not read them (checked 2026-11-09: `collect.py:71` and `:1301`).

## Options

1. **npm** with `.npmrc` hardening — ships with Node, no extra tool; release-age gate, no
   install scripts, no git dependencies.
2. **pnpm 12** — strict `node_modules`, `trustPolicy: no-downgrade`, release-age gate on by
   default; needs a separate install locally and in CI; the audit skill cannot read its
   lockfile.

## Decision

npm. `.npmrc`: `min-release-age=3`, `ignore-scripts=true`, `allow-git=none`,
`engine-strict=true`, `save-exact=true`. Renovate also waits 3 days (ADR 0015). CI runs
`npm ci`, `npm audit signatures` and `npm audit --omit=dev --audit-level=low`. `svelte` is a
runtime dependency because its runtime ships in the bundle; everything else is a dev
dependency.

TypeScript stays on **6.0.x**: TypeScript 7.0.2 shipped on 2026-11-08, but
`typescript-eslint` 8.72 accepts `<6.1.0` and `svelte-check` 4.7 accepts `^5 || ^6`
(`npm view … peerDependencies`). Renovate's major-update PR shows when the ecosystem is ready.

`npm run dev` names its config file: `vite --config vite.config.ts`. Vite restarts the dev
server when `vite.config.ts` or `svelte.config.js` changes or disappears, for example during a
`git checkout`. Without `--config`, a restart that finds no config file runs on without plugins.
That server no longer reacts when `vite.config.ts` comes back, and without the Svelte plugin
nothing watches `svelte.config.js`. Every `.svelte` request then fails with "Failed to parse
source for import analysis" until the server restarts for another reason, by hand or after a
`.env` change (Vite 8.3.6 `dist/node/chunks/node.js:37942–37951` and `:25381`,
vite-plugin-svelte 7.3.1 `src/utils/watch.js:64–66`). With `--config`, the missing file fails
the restart and Vite keeps the running server (`node.js:25192–25205`). The restored file then
restarts it. A restart request during a running restart is not lost: Vite runs one more
restart afterwards (`node.js:24905–24924`). Verified on 2026-11-09: both files removed and
restored after 0, 30 and 300 ms, two runs each. Without the flag, 300 ms left the server without
plugins in both runs. With the flag, every run ended on the restored config. The rebase onto
the old `main` (no project files) on 2026-11-08 broke the dev server this way.

## Consequences

- New releases are invisible for 3 days, including fixes; Renovate's vulnerability PRs
  bypass the age gate.
- Accepted dev-only advisories (supply-chain audit, 2026-11-08). OSV and `npm audit` agree that
  these two are the only ones in the 218-package tree; `--omit=dev` is clean. Neither package
  sees input from outside the repository: they read our own globs and config, which already run
  as code.
  - `minimatch` 10.2.6, GHSA-g3hv-75wg-m249: fixed from 11.0.1, no fix in 10.x. The way out is
    upstream: eslint#21492 and eslint/rewrite#535 (merged 2026-11-07, not released) and
    typescript-eslint#13145 (open). `npm audit fix --force` would downgrade eslint to 9.39.5 and
    typescript-eslint to 8.36.0, which still pulls in an affected minimatch. An `overrides`
    entry for 11.0.5 was rejected: it adds a new package, `@isaacs/nonrecursive-glob-match`
    (created 2026-10-26, one maintainer, no provenance), which is a larger risk than the
    advisory.
  - `deepmerge` 4.3.1, GHSA-gcqx-w48m-w2h4: no fixed release exists (4.3.1 is the latest);
    vite-plugin-svelte#1415 removes it.
  - Renovate proposes the upstream releases when they appear (ADR 0015).
