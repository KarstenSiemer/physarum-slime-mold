# 0018: Hosting at karstensiemer.github.io without a custom domain

- Status: accepted
- Date: 2026-11-09

## Context

The site is static and needs no cross-origin isolation, because WebGPU works without COOP/COEP
(ADR 0012). ADR 0012 chose GitHub Pages at `physarum.karstensiemer.de`. The owner never created
the DNS records for that custom domain. On 2026-11-09 the owner decided that the github.io
address is enough for now. The first deployment from `main` published the site that day at
<https://karstensiemer.github.io/physarum-slime-mold/>. Facts with sources:
[github-pages](../knowledge-base/github-pages.md).

## Options

1. **github.io address** — no DNS records and no domain verification. The site shares the
   origin `https://karstensiemer.github.io` with every other Pages site of the account that has
   no custom domain.
2. Custom domain `physarum.karstensiemer.de` (ADR 0012) — an origin of its own and a short
   address. The owner verifies `karstensiemer.de`, creates two DNS records at OMCnet and waits
   for the certificate.

## Decision

Option 1: the github.io address is enough for the owner, and the build already runs under the
repository path. This ADR supersedes ADR 0012. From ADR 0012 it keeps GitHub Pages and the
`deploy` job in `.github/workflows/ci.yml`, which publishes the site after `build` and `verify`
pass on `main`. Vite uses `base: './'`, so the same build runs at `/physarum-slime-mold/` and
at the root of a custom domain. A CSP as the first `<meta>` in `<head>` (ADR 0013) and
`<meta name="referrer">` replace two headers that the owner cannot set on GitHub Pages.
`scripts/github-setup.sh settings` sets the Pages source. The script has no mode for a custom
domain.

## Consequences

- One origin for the account: the CSP source `'self'` (ADR 0013) also allows the other Pages
  sites of the account that have no custom domain. A script on a page of that origin can read
  and change this page. Only the owner and the collaborators of the account's repositories can
  publish there. The app keeps no data in the browser (no cookies, Web Storage, IndexedDB or
  Cache API). No other repository of the account has a Pages site (checked 2026-11-09). Review
  this consequence again before another repository gets a Pages site or the app stores data in
  the browser.
- GitHub sends `Strict-Transport-Security: max-age=31556952` for this site. It sends no CSP
  header (so no `frame-ancestors`), no `X-Frame-Options`, no `X-Content-Type-Options` and no
  `Permissions-Policy`. The site has no session, no cookies and no sensitive actions, so
  clickjacking and MIME sniffing have nothing to attack. Cloudflare Pages is the alternative
  host if the site needs these headers (ADR 0012).
- No PR preview deployments; CI tests the built `dist` instead.
- A custom domain needs no code change later. The checked steps, in GitHub's order, and the
  DNS facts of `karstensiemer.de` are in
  [github-pages](../knowledge-base/github-pages.md#custom-domain-later).
