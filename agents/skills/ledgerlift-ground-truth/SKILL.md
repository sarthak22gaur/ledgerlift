---
name: ledgerlift-ground-truth
description: LedgerLift architecture, entry points, shared SQLite schema, and verification commands. Load before non-trivial work.
---

# LedgerLift Ground Truth

LedgerLift turns personal PDF and CSV statements into a canonical ledger. The Python pipeline parses, enriches, reconciles, and exports it. The Next.js dashboard reads the same ledger and edits rules.

## Entry points

- `src/ledgerlift/cli.py` is the Click CLI. `pipeline.py` orchestrates scan, parse, enrichment, transfers, and export. `intake.py` handles statement intake and `coverage.py` reports statement coverage.
- `src/ledgerlift/parsers/` contains institution parsers. `models.py`, `normalize.py`, `validation.py`, and `reconciliation.py` define and check parsed and canonical records. Use `pipeline-patterns` for pipeline changes.
- `src/ledgerlift/store.py` handles SQLite and vault YAML import/export. `src/ledgerlift/schema.sql` is the shared DDL. Version 3 is tracked in Python and expected by the dashboard.
- `apps/dashboard/` uses Next.js 16, React 19, TypeScript, ECharts, shadcn/ui, and Tailwind 4. Routes live in `src/app/`. SQL flows through `src/server/data/queries.ts` → `repository.ts` → `db.ts`. Use `dashboard-patterns` for dashboard changes.
- `tests/` holds the pytest suite. `agents/` holds the agent sources. `data/` holds runtime data and base rule seeds.

## Storage contracts

- Python uses `sqlite3`. Its DB path order is explicit argument, `LEDGERLIFT_DB`, `LEDGERLIFT_VAULT/ledgerlift.sqlite`, then `data/state/ledgerlift.sqlite`.
- The dashboard uses `@libsql/client`. `db-path.ts` resolves `LEDGERLIFT_DB`, then the vault, then the default file. Only the dashboard supports a remote libSQL URL, with auth via `LIBSQL_AUTH_TOKEN`.
- The vault holds the DB and rule YAMLs. SQLite owns live rules and account mappings. Rule reads honor user rows over base rows. Check import and export behavior in `store.py` before changing this contract.
- For schema changes, update the shared DDL, check Python store and dashboard bootstrap/mismatch handling, and keep version expectations and affected row types aligned.

## Commands

| Area | From | Command |
|---|---|---|
| Pipeline setup | repo root | `python -m pip install -e ".[dev]"` using Python 3.12+ |
| Pipeline tests | repo root | `python -m pytest tests/ -q` or `python -m pytest tests/<file>.py::<test> -q` |
| Dashboard setup | `apps/dashboard/` | `npm ci` |
| Dashboard tests | `apps/dashboard/` | `npm test` or `npm test -- <file>` |
| Dashboard type-check | `apps/dashboard/` | `npx tsc --noEmit` |
| Dashboard lint, build, dev | `apps/dashboard/` | `npm run lint`, `npm run build`, `npm run dev` (port 4005) |
| Agent sync | repo root | `bash agents/scripts/sync_agents.sh` |

Use synthetic statement fixtures and temporary SQLite databases for tests. Run live ETL commands only when the task calls for changes to the user's ledger. `ledgerlift e2e --force` rebuilds derived state.
