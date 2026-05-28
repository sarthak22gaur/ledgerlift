---
name: ledgerlift-ground-truth
description: The single source of truth for ledgerlift architecture, repo layout, primary stack, and project-wide conventions. Use when an agent needs orientation before any non-trivial work.
---

# LedgerLift Ground Truth

Local-first ETL pipeline that parses personal financial statements (PDFs/CSVs) into a canonical transaction ledger, then enriches, reconciles, and exports them. A Next.js dashboard visualizes the result from the same database. Single-repo, single-user, runs entirely on the owner's machine. SQLite is the single source of truth — no DuckDB warehouse, no Postgres.

## Layout

- `src/ledgerlift/` — Python pipeline (click CLI + pydantic v2 models)
  - `cli.py` — command surface; `pipeline.py` — orchestration (scan → parse → enrich → transfers → export)
  - `parsers/` — per-institution statement parsers (chase, amex, capitalone, sofi, wealthfront, deserve)
  - `enrich/` — RuleEngine, text cleaning, fuzzy matching, transfer pairing
  - `normalize.py`, `validation.py`, `reconciliation.py`, `exporters.py` — raw→canonical, checks, balance recon, CSV/JSON out
  - `store.py` + `schema.sql` — SQLite store (connection, schema init/migration, vault import/export) and shared DDL; `intake.py`, `coverage.py`, `hashing.py` — statement intake, coverage report, dedup hashing
- `apps/dashboard/` — Next.js 16 dashboard (React 19, ECharts, Tailwind 4, shadcn/ui)
- `data/` — runtime artifacts: `raw/ statements/ exports/ state/ logs/ rules/`
- `tests/` — pytest suite

## Primary Stack

- **Python 3.12+**: pipeline core; pydantic v2 models, click CLI, pdfplumber, rapidfuzz
- **TypeScript / Next.js 16**: dashboard (app router, server components by default), ECharts, zod
- **Data**: one SQLite DB shared by pipeline (`sqlite3`) and dashboard (`@libsql/client`). No DuckDB, no Postgres. Schema lives in `src/ledgerlift/schema.sql` (version 3). `LEDGERLIFT_VAULT` (vault dir holding DB + YAMLs) is the canonical config; `LEDGERLIFT_DB` overrides the path and may be a Turso `libsql://` URL.

## Entry Points

- CLI group: `src/ledgerlift/cli.py:44` (`@click.group`); installed as `ledgerlift` (`pyproject.toml` `[project.scripts]`)
- Pipeline orchestration: `src/ledgerlift/pipeline.py`; DB path resolution: `src/ledgerlift/store.py:resolve_db_path`
- Dashboard routes: `apps/dashboard/src/app/` (`/`, `/transactions`, `/categories`, `/merchants`, `/accounts`, `/rules`, `/review/*`)
- Dashboard data layer: `apps/dashboard/src/server/data/queries.ts` (SQL builders) → `repository.ts` (access) → `db.ts` (libSQL client)

## Conventions

- Base branch `main`. No AI attribution in commits/PRs.
- Python: pydantic v2, click; tests via `pytest tests/ -q` (`pythonpath=src`).
- Dashboard: TypeScript strict, server components by default; tests via `vitest`, dev on port 4005.
- Pipeline and dashboard share one schema (`schema.sql`); change DDL there and bump the version in both `store.py` and `db.ts`.
- Enrichment runs in a fixed order (overrides → merchant → category → fuzzy → heuristic → transfer/payment). See `pipeline-patterns`.
- Dashboard SQL lives in `queries.ts`; filters come from URL search params. See `dashboard-patterns`.

## What This Skill Is Not

Live code behaviour, current bug list, or in-flight work. For those, read the code, `CLAUDE.md`, or the relevant plan. For pipeline internals see `pipeline-patterns`; for dashboard internals see `dashboard-patterns`.
