#!/usr/bin/env bash
# GitHub repository settings (docs/adr/0014-ci-hardening.md, 0015-renovate.md, 0018-hosting-at-github-io.md).
# Every mode can run again; rulesets are updated by name.
# Usage:
#   scripts/github-setup.sh settings   # before the first push: merge rules, security features, CodeQL,
#                                      # Pages source, environments limited to main, rulesets
#   scripts/github-setup.sh codeql     # after the first merge: CodeQL merge gate (needs an analysis of main)
set -euo pipefail

REPO="${REPO:-KarstenSiemer/physarum-slime-mold}"

# Creates or updates the ruleset with this name from the JSON on stdin.
ruleset() {
  local name=$1 body id
  body=$(cat)
  id=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$name\") | .id")
  if [ -n "$id" ]; then
    gh api -X PUT "repos/$REPO/rulesets/$id" --input - <<<"$body" >/dev/null
  else
    gh api -X POST "repos/$REPO/rulesets" --input - <<<"$body" >/dev/null
  fi
}

# CodeQL default setup with the languages of ADR 0014 (python: the vendored .claude/skills/ scripts). Both
# modes call it, so a second run of either mode keeps the same languages.
codeql_setup() {
  gh api -X PATCH "repos/$REPO/code-scanning/default-setup" -f state=configured -f query_suite=extended \
    -f 'languages[]=actions' -f 'languages[]=javascript-typescript' -f 'languages[]=python' >/dev/null
}

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

  # Before the first push main has no code: on 2026-11-08 this call started no analysis. codeql repeats it.
  echo "CodeQL default setup (Actions, JavaScript/TypeScript, Python)"
  if ! codeql_setup; then
    echo "  CodeQL default setup failed; run '$0 codeql' after the first merge." >&2
  fi

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

  echo "Ruleset main: pull requests, linear history, required checks"
  # integration_id 15368 = GitHub Actions; only Actions can report these checks. build is required too:
  # verify needs build, and a job skipped after a failed dependency would count as passed.
  # require_extra_approval_for_unattributed_changes is GitHub's default, set explicitly. It requires one
  # more approval for a Copilot PR that is not attributed to a person; with 0 approvals it has no effect.
  ruleset main <<'JSON'
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
        "require_extra_approval_for_unattributed_changes": true,
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
    }
  ]
}
JSON

  # A pull request runs the workflow files it contains, so green checks prove nothing about a PR that edits
  # them. Changes to the files in .github/CODEOWNERS need the owner's approval; the owner's own PRs pass
  # without one (ADR 0014). Admins may bypass this ruleset only through a pull request, in case GitHub
  # starts to require the documented code owner approval. Ruleset main has no bypass, so its checks apply.
  # A new push that changes the diff dismisses the approval. require_last_push_approval is false, because it
  # requires an approval on every PR, also on PRs without code-owned files (ADR 0014).
  echo "Ruleset code owners: owner review for CI, Renovate, npm and hook settings"
  ruleset "code owners" <<'JSON'
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
        "require_last_push_approval": false,
        "require_extra_approval_for_unattributed_changes": true,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
      }
    }
  ]
}
JSON
  echo "Done. Store the Renovate App key as a secret of the environment renovate, not of the repository."
  echo "After the first merge and CodeQL analysis of main, run: $0 codeql"
}

# The gate blocks every merge while the required tool has no analysis, and ruleset main has no bypass,
# so it is added only once main has a CodeQL analysis.
codeql() {
  echo "CodeQL default setup (Actions, JavaScript/TypeScript, Python)"
  codeql_setup
  if [ -z "$(gh api "repos/$REPO/code-scanning/analyses?tool_name=CodeQL&ref=refs/heads/main&per_page=1" --jq '.[0].id' 2>/dev/null)" ]; then
    echo "No CodeQL analysis of main yet. Wait until the first one finishes, then run: $0 codeql" >&2
    exit 1
  fi
  echo "Ruleset codeql: block merges with new CodeQL errors or high and critical security alerts"
  ruleset codeql <<'JSON'
{
  "name": "codeql",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
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
  echo "Done."
}

case "${1:-}" in
  settings | codeql) "$1" ;;
  *)
    echo "usage: $0 settings|codeql" >&2
    exit 2
    ;;
esac
