# Workspace Guidelines — Dino Arm Tourney

These instructions apply to **every** Copilot prompt and session in this workspace.
Treat them as standing orders: load them silently, act on them, and only mention them
when routing decisions change the user's outcome.

---

## 1. Always evaluate skills before acting

This workspace ships its own skills under the repo root. Before taking any action,
match the user's request against each skill's `description` frontmatter and **load every
applicable `SKILL.md` with `read_file` BEFORE generating a response or edits**. Multiple
skills can apply to one request — load all of them.

| Skill | Folder | Load when the request involves… |
|---|---|---|
| `frontend-design` | [frontend-design/SKILL.md](frontend-design/SKILL.md) | Building/modifying UI in `web/` — components, pages, layouts, styling, Tailwind, design direction, visual polish |
| `tdd` | [tdd/SKILL.md](tdd/SKILL.md) | New features, bug fixes, refactoring, anything that changes behavior of code under `web/src/` or `supabase/`. Follow red-green-refactor and the supporting notes in [tdd/tests.md](tdd/tests.md), [tdd/mocking.md](tdd/mocking.md), [tdd/refactoring.md](tdd/refactoring.md), [tdd/interface-design.md](tdd/interface-design.md), [tdd/deep-modules.md](tdd/deep-modules.md) |
| `code-reviewer` | [code-reviewer/SKILL.md](code-reviewer/SKILL.md) | Reviewing diffs, PRs, existing code quality, security audits, before declaring a task "done" on non-trivial changes. Reference [code-reviewer/references/code_review_checklist.md](code-reviewer/references/code_review_checklist.md), [code-reviewer/references/coding_standards.md](code-reviewer/references/coding_standards.md), [code-reviewer/references/common_antipatterns.md](code-reviewer/references/common_antipatterns.md) |
| `valyu-best-practices` | [valyu-best-practices/SKILL.md](valyu-best-practices/SKILL.md) | Any web/academic/medical/financial research, content extraction from URLs, citations, deep research reports. Output goes in `research/` |
| `caveman` | [caveman/SKILL.md](caveman/SKILL.md) | **DEFAULT ON** for every response in this workspace. Load on session start and apply to all replies (intensity `full` unless user says otherwise). Disable only when the user explicitly opts out ("stop caveman", "normal mode", "no caveman", "be verbose", "full prose") — stay off for the rest of that session unless they re-enable it |

**Blocking rule:** if a skill applies, `read_file` on its `SKILL.md` is your first tool
call, before search/edit/terminal operations on the task itself.

### Combinations that usually co-apply

- New UI feature → `frontend-design` + `tdd` (+ `code-reviewer` before finishing)
- Bug fix in app code → `tdd` + `code-reviewer`
- Research task → `valyu-best-practices` (write artifact under `research/NN-topic.json|md`)
- PR review → `code-reviewer` (+ `tdd` if tests are missing/weak)

---

## 2. Always use the right MCPs / tool categories

Activate these tool groups as soon as the task touches their domain. Prefer the custom
VS Code tools (`grep_search`, `file_search`, `read_file`, `list_dir`, `semantic_search`)
over raw terminal `grep`/`find`/`cat`.

| Domain | Preferred tools / MCPs |
|---|---|
| **Python env / deps** (anything under `code-reviewer/scripts/` or new Python) | `configure_python_environment` first, then `activate_python_environment_tools`, `activate_python_syntax_validation_tools`, `activate_python_import_analysis_tools`, `activate_python_workspace_management_tools`, Pylance MCP (`mcp_pylance_mcp_s_*`) |
| **Supabase** (migrations in `supabase/migrations/`, DB schema, RLS) | `activate_database_migration_tools`, `activate_database_management_tools`, `activate_branch_management_tools`, `activate_edge_function_management_tools`. Use `apply_migration` for DDL; `execute_sql` only for read-only checks |
| **Frontend verification** (visual QA of `web/` pages) | `activate_page_navigation_tools`, `activate_page_capture_tools`, `activate_snapshot_analysis_tools`, `activate_user_interaction_tools`, `activate_browser_interaction_tools`, `activate_keyboard_interaction_tools`, `activate_form_and_file_management_tools`. Use Playwright MCP (`mcp_microsoft_pla_*`) and Chrome DevTools MCP (`mcp_io_github_chr_*`) to open the dev server, screenshot, and inspect console |
| **Perf / a11y audits** on `web/` | `activate_performance_audit_tools`, then `mcp_io_github_chr_lighthouse_audit` |
| **Research / external knowledge** | Valyu CLI via [valyu-best-practices/scripts/valyu.mjs](valyu-best-practices/scripts/valyu.mjs). Save raw output under `research/`. `fetch_webpage` only for a single known URL |
| **GitHub ops** (PRs, issues, releases) | Activate the matching `activate_pull_request_*`, `activate_repository_*`, `activate_branch_and_commit_*`, `activate_release_management_*`, `activate_search_and_discovery_*`, `activate_copilot_task_management_*` groups instead of raw `gh`/`git` when available |
| **Notebooks** (if any `.ipynb` appears) | `create_new_jupyter_notebook`, `edit_notebook_file`, `run_notebook_cell`, `copilot_getNotebookSummary` — never `jupyter` in terminal |
| **Multi-step planning** | `manage_todo_list` for any task with >2 real steps |
| **Heavy read-only exploration** | Delegate to the `Explore` subagent via `runSubagent` instead of chaining many searches inline |

If a required MCP category isn't active yet, call its `activate_*` tool **before** the
first operation in that domain.

---

## 3. Memory hygiene

- Consult `/memories/` (user), `/memories/session/`, `/memories/repo/` at the start of
  non-trivial tasks.
- Record durable repo facts (build commands, schema quirks, conventions) to
  `/memories/repo/` as you learn them.
- Record cross-workspace lessons to `/memories/` (keep entries short).
- Use `/memories/session/` for in-flight plans on multi-step work.

---

## 4. Repo-specific conventions

- **App code lives in `web/`** (Next.js + Tailwind + Supabase). Run dev server from that
  folder: `cd web; npm run dev`.
- **DB changes** go in a new file under `supabase/migrations/` (numeric prefix, SQL).
  Never edit an applied migration; add a new one.
- **Research artifacts** go in `research/` as `NN-topic.json` (Valyu raw) or
  `NN-topic.md` (synthesized). Reference them from `PLAN.md` / `PLAN-WEEK1.md` /
  `PLAN-PARITY.md`.
- **Planning docs** (`PLAN*.md`) are the source of truth for scope — update them when
  scope changes, don't silently drift.
- **Scripts** belong in `web/scripts/` (app-adjacent) or the skill's own `scripts/`
  folder. Don't scatter one-off scripts at the repo root.

---

## 4a. Branch & deploy workflow (PROD IS LIVE since 2026-04-30)

`main` auto-deploys to Vercel production. **Never commit or push directly to `main`.**
GitHub branch-protection ruleset `protect-main` enforces this — direct push is rejected
with "Changes must be made through a pull request." Workflow source of truth:
[PLAN-DEPLOY.md](../PLAN-DEPLOY.md) §4. Operator-facing recipe: [DEPLOY-GUIDE.md](../DEPLOY-GUIDE.md).

**Mandatory loop for every change:**

1. `git checkout main; git pull --ff-only`
2. `git checkout -b feat/<topic>` (or `fix/`, `chore/`, `hotfix/<event-slug>`)
3. Edit + `cd web; npm test` locally (red-green-refactor per `tdd` skill).
4. `git push -u origin <branch>` → opens PR.
5. CI (`.github/workflows/test.yml` → `typecheck + test + build`) must go green;
   smoke-test the Vercel preview URL.
6. **Merge via Squash or Rebase** (linear-history rule rejects merge commits).
7. Delete the branch.

**Migrations — folder location is the state.** See [supabase/migrations/README.md](../supabase/migrations/README.md).

- `supabase/migrations/legacy/*.sql` = already applied to `dino-prod` and bundled
  into `supabase/schema.sql`. Don't edit, don't re-apply, don't move out.
- `supabase/migrations/*.sql` (root, NOT under `legacy/`) = **PENDING** = not yet on prod.
- A clean repo has **zero pending files**. If you see one when you start, it means
  the previous PR didn't finish its migration step — surface it before continuing.
- New migrations:
  1. Author at `supabase/migrations/<NNNN>_<topic>.sql` (next free number).
  2. **Additive + idempotent**: `create … if not exists`, `add column if not exists`.
     Never drop a column / table / function the previous deploy still reads. Two-phase
     for breaking changes (PR A adds new shape + dual-write; PR B backfills + drops).
  3. Apply to `dino-prod` *before* merging the PR — SQL Editor on the prod project, or
     `node scripts/apply-migrations.mjs --target prod --file <NNNN>_x.sql --apply`
     (needs `SUPABASE_DB_URL` env on prod).
  4. In the same PR: `git mv supabase/migrations/<NNNN>_x.sql supabase/migrations/legacy/`
     then `cd web; npm run schema:bundle` and commit the refreshed `supabase/schema.sql`.
  5. Then merge.
- A fresh prod DB is *always* reproducible from `supabase/schema.sql` + `supabase/seed.sql`
  + applying any pending files (none in a clean state). The bundler reads `legacy/` only.

**Environments stay isolated:** local dev uses `dino-dev` Supabase + `tournament-manager*`
R2; production uses `dino-prod` Supabase + `tm-prod-*` R2. Seeders / `users:reset` /
`drop-all-users.mjs` are dev-only and must never run against prod credentials.

**Match-day freeze**: when the user says "freeze production" (typically T-2 days before
an event), no merges to `main` until "unfreeze". Hot-fixes only via `hotfix/<slug>`
branch → preview → manual promote ([PLAN-DEPLOY.md](../PLAN-DEPLOY.md) §5).

---

## 5. Safety & quality gates

- Follow the `tdd` red-green-refactor loop for behavior changes; don't ship code without
  tests when the skill applies.
- Run the `code-reviewer` pass on your own diff before declaring a task complete on
  non-trivial changes.
- Never run destructive commands (`rm -rf`, `git push --force`, `git reset --hard`,
  dropping tables, deleting migrations) without explicit user confirmation.
- Never bypass safety flags (`--no-verify`, `--force`) as a shortcut.

---

## 6. When in doubt

1. Re-read this file.
2. Check the relevant `SKILL.md`.
3. Check `PLAN.md` / `PLAN-WEEK1.md` / `PLAN-PARITY.md` for current scope.
4. Then ask — but only if a real ambiguity blocks progress.
