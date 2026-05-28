---
name: dashboard-patterns
description: Conventions for the ledgerlift Next.js dashboard — data layer, query exclusions, filter handling, and double-count avoidance. Use before modifying anything under apps/dashboard.
---

# Dashboard Patterns

Conventions specific to `apps/dashboard/` (Next.js 16, React 19). For repo-wide orientation see `ledgerlift-ground-truth`.

## Data Layer

- SQL is built by functions in `src/server/data/queries.ts`, executed via `repository.ts`. Do not inline SQL in components.
- The row shape lives in `src/server/data/types.ts` and mirrors the `transactions` table in `src/ledgerlift/schema.sql`. When the Python model/schema gains a column, add it here too.
- DB connection in `src/server/data/db.ts` via `@libsql/client` — the dashboard opens the **same** SQLite file the pipeline writes (no DuckDB warehouse, no Postgres, no sync step). A `libsql://`/`https://` URL targets Turso; auth via `LIBSQL_AUTH_TOKEN`. `db-path.ts` resolves the path; `ensureSchema()` bootstraps tables from `schema.sql` on first connect and warns on schema-version mismatch (expected version 3).

## Double-Count Avoidance (critical)

Cashflow/overview metrics must exclude internal money movement, or income/expenses double-count.
- `overviewMetricsQuery` and `cashflowSeriesQuery` exclude categories `'Transfers'` and `'Credit Card Payment'`.
- `transferCandidatesQuery` surfaces `is_transfer_candidate` / `is_internal_payment_candidate` rows for the review pages.
Any new aggregate over income/expenses/net must apply the same category exclusion.

## Filters

Filters are parsed from URL search params (`lib/filters.ts`) and applied across all queries. New filterable dimensions go through this path, not per-component state.

## Routes & Components

- Routes: `src/app/` — `/`, `/transactions`, `/categories`, `/merchants`, `/accounts`, `/review/unresolved`, `/review/transfers`.
- Server components by default; only opt into client components when interactivity requires it.
- Charts use ECharts (`echarts-for-react`); UI uses shadcn/ui + Tailwind 4.

## Conventions

- TypeScript strict. Validate external/query input with zod (`lib/schemas.ts`).
- Dev server runs on port 4005 (`npm run dev`); tests via `vitest run`; lint via `eslint`.
