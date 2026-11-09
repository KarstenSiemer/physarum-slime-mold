# GitHub Pages facts

## The project site (checked 2026-11-09)

- Address: <https://karstensiemer.github.io/physarum-slime-mold/> (Pages API: `html_url`,
  `build_type: workflow`, `cname: null`). The first deployment came from `main` at `39123dd`.
- The Pages API reports `https_enforced: true` without a custom domain. Requests over `http://`
  get a `301` to the same address on `https://`. Requests to the address without the final `/`
  get a `301` to the address above. The redirect matters: with `base: './'`, `./assets/…`
  resolves against the directory of the page, and without the final `/` that directory is the
  root of the origin.
- Response headers: `strict-transport-security: max-age=31556952` (no `includeSubDomains`),
  `access-control-allow-origin: *` and `cache-control: max-age=600`. There is no
  `content-security-policy`, `x-content-type-options`, `x-frame-options`, `permissions-policy`
  or `referrer-policy` header.
- All Pages sites of the account without a custom domain share the origin
  `https://karstensiemer.github.io`. Project sites are at `/<repository>/`, and a user site is at
  the root. GitHub requires the lowercase repository name `karstensiemer.github.io` for the user
  site. A custom domain on the user site would move every project site without its own custom
  domain to that domain. Only `physarum-slime-mold` has a Pages site: `has_pages` is false for
  the 29 other repositories in `gh api --paginate 'user/repos?affiliation=owner'`, which also
  lists the 7 private ones.
- Headless Chromium (Playwright 1.64.1, `channel: 'chromium'`, Apple M3 Pro, Metal) ran the
  live site on WebGPU with 4.0 million agents. With `?backend=webgl2` it loaded
  `assets/backend-*.js`, and the startup check lowered the grid to 0.995 million agents. Both
  backends formed networks, with no console error and no failed request.

## Custom domain later

Checked in the GitHub Docs on 2026-11-09: [verifying a custom domain][verify], [managing a
custom domain][manage], [HTTPS][https], [troubleshooting custom domains][trouble] and the
[Pages API][rest]. The steps, in this order:

1. Profile Settings (not the repository) → Pages → "Add a domain": `karstensiemer.de`. The
   dialog shows the host `_github-pages-challenge-KarstenSiemer` and a code for the value of a
   TXT record. Create that record at OMCnet. Wait until the record resolves (up to 24 h). Then
   click "Verify". Keep the record afterwards, so that the domain stays verified. The
   verification also covers immediate subdomains such as `physarum.karstensiemer.de`.
2. Set the custom domain `physarum.karstensiemer.de` in the repository: Settings → Pages →
   Custom domain → Save, or `PUT /repos/{owner}/{repo}/pages` with `cname` (a fine-grained
   token needs Pages and Administration write). GitHub tells you to do this before step 3. If
   the CNAME record exists and no repository has the custom domain, GitHub warns that someone
   else can host a site on the subdomain.
3. Create the record `physarum CNAME karstensiemer.github.io.` at OMCnet. Its target is the
   host of the origin, without the repository name. `dig +short CNAME physarum.karstensiemer.de`
   must print `karstensiemer.github.io.` and not `karstensiemer.github.io.karstensiemer.de.`.
4. After a successful DNS check, GitHub requests a certificate from Let's Encrypt. The site can
   take up to an hour to become available over HTTPS. After a DNS change, GitHub says that you
   may need to remove the custom domain and add it again. So if no check mark appears beside the
   custom domain several minutes after the CNAME record resolves, click "Remove". Then type the
   custom domain again and click "Save". When "Enforce HTTPS" becomes available (up to 24 h),
   select it, or send `PUT /repos/{owner}/{repo}/pages` with `https_enforced=true`. Then read
   `https_enforced` and `https_certificate.state` from the Pages API.

- A deployment from GitHub Actions needs no `CNAME` file and ignores one.
- Do not add wildcard DNS records: GitHub warns that they allow takeovers even of a verified
  domain.
- With a custom domain set, the github.io address redirects to it. `twbs.github.io/bootstrap`
  redirected to its custom domain on 2026-11-09. The GitHub Docs do not say so.

DNS of `karstensiemer.de` on 2026-11-09 (queried through dns.google): nameservers
`ns1`–`ns3.pool2.omc-dns.de` and `ns4`–`ns6.pool2.omc-dns.com` (ADR 0012 lists all six under
`.de`). The zone is signed with DNSSEC. It has no CAA records, so Let's Encrypt may issue
certificates for it. It has no wildcard record and no `physarum` record yet.

[verify]: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages
[manage]: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
[https]: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
[trouble]: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages#https-errors
[rest]: https://docs.github.com/en/rest/pages/pages#update-information-about-a-github-pages-site
