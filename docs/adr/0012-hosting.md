# 0012: Hosting on GitHub Pages at physarum.karstensiemer.de

- Status: accepted (DNS step pending, owner action)
- Date: 2026-11-08

## Context

The site is static (HTML, JS, CSS), has no backend and needs no cross-origin isolation:
WebGPU works without COOP/COEP. The domain `karstensiemer.de` is hosted at OMCnet
(nameservers `ns1-6.pool2.omc-dns.de`), `physarum` is unused (checked 2026-11-08).

## Options

|                     | GitHub Pages           | Cloudflare Pages     | Netlify        | Home server          |
| ------------------- | ---------------------- | -------------------- | -------------- | -------------------- |
| Cost                | free                   | free                 | credit-limited | hardware, power      |
| DNS at OMCnet       | CNAME + TXT verify     | CNAME                | CNAME          | A/AAAA + dynamic DNS |
| HTTPS               | automatic              | automatic            | automatic      | self-managed         |
| Response headers    | none                   | `_headers`           | `_headers`     | full control         |
| Deploy auth         | OIDC, no stored secret | long-lived API token | token          | inbound access       |
| Takeover protection | verified domains       | not documented       | not documented | n/a                  |

## Decision

GitHub Pages, deployed by the `deploy` job in `.github/workflows/ci.yml` after all checks pass
on `main`. Vite uses `base: './'`, so the same build works at
`karstensiemer.github.io/physarum-slime-mold/` and at the custom domain. Security headers that
need HTTP are replaced where possible: CSP as the first `<meta>` in `<head>` (ADR 0013),
`<meta name="referrer">`.

Owner steps (they change account and DNS settings, so they are not automated):

1. GitHub → Settings → Pages → verified domains: add `karstensiemer.de`, create the TXT record
   `_github-pages-challenge-KarstenSiemer` at OMCnet, verify, keep the record.
2. Repository → Settings → Pages → Source: GitHub Actions; custom domain
   `physarum.karstensiemer.de` (the `CNAME` file is ignored for Actions deployments).
3. OMCnet: `physarum CNAME karstensiemer.github.io.`
4. After the certificate is issued: Enforce HTTPS.

## Consequences

- No HSTS, `frame-ancestors`, `X-Content-Type-Options` or `Permissions-Policy` headers. The
  site has no session, no cookies and no sensitive actions, so clickjacking and MIME
  sniffing have nothing to attack. Cloudflare Pages is the switch if headers become necessary.
- No PR preview deployments; CI tests the built `dist` instead.
