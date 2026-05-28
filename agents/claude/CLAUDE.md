# ledgerlift — Claude Rules

Local-first ETL pipeline for parsing personal financial statements (PDFs/CSVs) into a canonical transaction ledger, with a Next.js dashboard for visualization.

Languages: python, typescript. Default base branch: `main`.

---

## Skill Discipline

Consult `.claude/skills/ledgerlift-ground-truth/` first for project orientation. Do not invent project rules; if a skill covers the topic, follow it.

When loading skills, follow rules literally. "MUST" is a hard constraint. Apply rules to every file you touch, not just the first.

---

## Available Agents

- `/architect` — design authority, produces plans
- `/code-reviewer` — plan-driven code review
- `/librarian` — keeps `agents/` in sync with reality
- `/engineer` — feature and bug implementation

## Available Skills

- `/grill-plan` — stress-test a plan before delegating work
- `/ledgerlift-ground-truth` — project source of truth (read this first)

## Hard Rules

See `.claude/rules/` for binding constraints. The non-negotiable ones:
- `no-commit-attribution.md` — no AI attribution in commits or PRs
- `plan-before-code.md` — plan + approval before non-trivial implementation
