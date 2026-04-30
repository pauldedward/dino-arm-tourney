# GitHub branch protection — `main`

One-time setup. Owner does this in the GitHub web UI; takes ~2 minutes.

> Source of truth for the workflow: [PLAN-DEPLOY.md](../PLAN-DEPLOY.md) §4.

## Steps

1. Open https://github.com/pauldedward/dino-arm-tourney/settings/branches.
2. **Branch protection rules → Add rule**.
3. **Branch name pattern**: `main`.
4. Tick the following:
   - **Require a pull request before merging**
     - Required approvals: **1** (or 0 if you're solo — still forces the PR step).
     - **Dismiss stale pull request approvals when new commits are pushed**.
   - **Require status checks to pass before merging**
     - **Require branches to be up to date before merging**.
     - Search and add the check **`web-ci / typecheck + test + build`**
       (after the first PR runs, the check name will appear in the list).
   - **Require conversation resolution before merging**.
   - **Require linear history** (forces fast-forward / squash; matches `git merge --ff-only` workflow).
   - **Do not allow bypassing the above settings** (applies to admins too — yes, including the owner).
5. Leave **everything else unticked** (no signed commits, no deployments gating, no force-push allowance).
6. **Create**.

## Verifying

- `git push origin main` from your laptop should now be **rejected**
  with "protected branch hook declined". That's correct.
- A PR with a red CI run shows the **Merge** button greyed out.
- After CI goes green, the green **Merge pull request** button appears.

## Emergency override (match-day only)

If something is on fire and CI is broken for a reason unrelated to the
fix:

1. Settings → Branches → **Edit** the `main` rule.
2. Untick **Do not allow bypassing**.
3. Merge the PR.
4. **Re-tick the bypass-prevention immediately afterwards.**

Document the override in the PR description. Don't make it a habit.
