#!/usr/bin/env bash
# One-time GitHub repository settings (docs/adr/0012-hosting.md, 0014-ci-hardening.md, 0015-renovate.md).
# Usage:
#   scripts/github-setup.sh settings   # run before the first push: merge rules, security features, CodeQL,
#                                      # Pages source, environments limited to main, rulesets
#   scripts/github-setup.sh domain     # custom domain + HTTPS; only after the DNS records exist
set -euo pipefail

REPO="${REPO:-KarstenSiemer/physarum-slime-mold}"
DOMAIN="${DOMAIN:-physarum.karstensiemer.de}"

settings() {
  echo "Merge settings: squash only, auto-merge (Renovate), delete merged branches"
  gh api -X PATCH "repos/$REPO" \
    -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
    -F allow_auto_merge=true -F delete_branch_on_merge=true >/dev/null

  echo "Actions: require actions pinned to full commit SHAs"
  gh api -X PUT "repos/$REPO/actions/permissions" \
    -F enabled=true -f allowed_actions=all -F sha_pinning_required=true

  echo "Dependabot alerts (Renovate makes the update PRs) and private vulnerability reporting"
  gh api -X PUT "repos/$REPO/vulnerability-alerts"
  gh api -X PUT "repos/$REPO/private-vulnerability-reporting"

  echo "CodeQL default setup"
  gh api -X PATCH "repos/$REPO/code-scanning/default-setup" -f state=configured -f query_suite=extended >/dev/null

  echo "GitHub Pages: build and deploy from GitHub Actions"
  gh api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 ||
    gh api -X PUT "repos/$REPO/pages" -f build_type=workflow

  # A workflow on any other branch could otherwise read the Renovate App key or deploy the site.
  # A job that names a missing environment creates it without protection, so this runs before the first push.
  echo "Environments renovate and github-pages: only the main branch may use them"
  for env in renovate github-pages; do
    gh api -X PUT "repos/$REPO/environments/$env" --input - >/dev/null <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
    if ! gh api "repos/$REPO/environments/$env/deployment-branch-policies" --jq '.branch_policies[].name' | grep -qx main; then
      gh api -X POST "repos/$REPO/environments/$env/deployment-branch-policies" -f name=main -f type=branch >/dev/null
    fi
  done

  echo "Ruleset for main: pull requests, linear history, required checks, CodeQL gate"
  # integration_id 15368 = GitHub Actions; only Actions can report these checks. build is required too:
  # verify needs build, and a job skipped after a failed dependency would count as passed.
  gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "build", "integration_id": 15368 },
          { "context": "verify", "integration_id": 15368 },
          { "context": "zizmor", "integration_id": 15368 },
          { "context": "dependency-review", "integration_id": 15368 }
        ]
      }
    },
    {
      "type": "code_scanning",
      "parameters": {
        "code_scanning_tools": [
          { "tool": "CodeQL", "alerts_threshold": "errors", "security_alerts_threshold": "high_or_higher" }
        ]
      }
    }
  ]
}
JSON

  # A pull request runs the workflow files it contains, so green checks prove nothing about a PR that edits
  # them. Changes to the files in .github/CODEOWNERS need the owner's approval. Admins may bypass this
  # ruleset only through a pull request, so the owner can merge their own PRs; the checks above still apply.
  echo "Ruleset for main: code owner review for CI, Renovate, npm and hook settings"
  gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null <<'JSON'
{
  "name": "code owners",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
      }
    }
  ]
}
JSON
  echo "Done. Store the Renovate App key as a secret of the environment renovate, not of the repository."
}

domain() {
  echo "Custom domain $DOMAIN (DNS: CNAME ${DOMAIN%%.*} → ${REPO%%/*}.github.io.)"
  gh api -X PUT "repos/$REPO/pages" -f cname="$DOMAIN"
  echo "Waiting for the certificate can take up to an hour. Then run: $0 https"
}

https() {
  gh api "repos/$REPO/pages/health" || true
  gh api -X PUT "repos/$REPO/pages" -F https_enforced=true
}

case "${1:-}" in
  settings | domain | https) "$1" ;;
  *)
    echo "usage: $0 settings|domain|https" >&2
    exit 2
    ;;
esac
