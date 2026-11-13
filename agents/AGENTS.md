# LedgerLift

Local-first ETL for personal statements and a Next.js dashboard over the same SQLite ledger. Python and TypeScript live in one repo. Base branch is `main`.

## Working in this repo

- Read `ledgerlift-ground-truth` for entry points and checks. Load `pipeline-patterns` or `dashboard-patterns` for the area you touch.
- Carry authorized work through verification. Use reversible assumptions for routine details and flag material decisions. Report progress when a finding changes the work, then continue.
- Keep statement contents, real transaction rows, vault YAMLs, and credentials out of prompts and artifacts. Use synthetic fixtures and temporary databases for repros.
- If this checkout has an approved `.envrc`, use `direnv exec . <command>` from the repo root when a project command needs that environment. Otherwise use the local virtualenv or the owning package's commands.

## Agents

<!-- agentsync:roles -->

Name the role, its task, the relevant files or diff, and its completion criteria when delegating. Ask for the result in the final response and collect it before calling the task complete. Run the applicable workflow directly if the client lacks delegation.

## Skills

- `ledgerlift-ground-truth` for architecture and verification, `pipeline-patterns` for ETL invariants, and `dashboard-patterns` for dashboard data and filters.
- `grill-plan` for a design review, `grill-converge` for a bounded adversarial review, and `orchestrate` for approved implementation.
- `diagnosing-bugs` for reproducible failures, `cleanup-loop` for a scoped audit, and `handoff` for continuing work in another session.

## Rules

<!-- agentsync:rules -->

Edit instructions in `agents/` and run `bash agents/scripts/sync_agents.sh`.
