# ledgerlift

Local-first ETL pipeline for parsing personal financial statements (PDFs/CSVs) into a canonical transaction ledger, with a Next.js dashboard for visualization.

## Workspace

- Languages: python, typescript
- Default base branch: `main`
- Repo shape: single

## Agents

| Agent | Role |
|---|---|
| architect | Design authority — plans, ADRs, system boundaries |
| code-reviewer | Plan-driven review against project conventions |
| librarian | Keeps `agents/` source-of-truth in sync with reality |
| engineer | Implements features and fixes |

## Skills

- `grill-plan` — stress-test plans before execution
- `ledgerlift-ground-truth` — single source of truth for the project

## Conventions

- No AI attribution in commits or PR bodies.
- Plan before code: architect plan + user approval before non-trivial implementation.
- Source of truth for agents/skills is `agents/`. Edit there, then run `bash agents/scripts/sync_agents.sh`.
