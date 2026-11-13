---
name: dashboard-patterns
description: Conventions for the ledgerlift Next.js dashboard — data layer, query exclusions, filter handling, and double-count avoidance. Use before modifying anything under apps/dashboard.
---

# Dashboard Patterns

Conventions specific to `apps/dashboard/` (Next.js 16, React 19). For repo-wide orientation see `ledgerlift-ground-truth`.

## Data Layer

- SQL is built by functions in `src/server/data/queries.ts`, executed via `repository.ts`. Do not inline SQL in components.
- The row shape lives in `src/server/data/types.ts` and mirrors the `transactions` table in `src/ledgerlift/schema.sql` at the repo root. When the Python model/schema gains a column, add it here too.
- DB connection in `src/server/data/db.ts` via `@libsql/client` — the dashboard opens the **same** SQLite file the pipeline writes. A `libsql://`/`https://` URL targets Turso; auth via `LIBSQL_AUTH_TOKEN`. `db-path.ts` resolves the path; `ensureSchema()` bootstraps tables from `schema.sql` on first connect and warns on schema-version mismatch (expected version 3).

## Cashflow and spending attribution

- Total cashflow (overview, series, calendar) uses `NOT_INTERNAL_FLOW` to exclude matched pairs and internal sweeps. Preserve unpaired external flows, including unpaired card-payment debits. Orphan card-payment credits do not count as income.
- Inbound reimbursements offset expenses. Outbound reimbursements count as expenses.
- Category and merchant spending breakdowns use `NOT_DOUBLE_COUNTED`, which also excludes the Transfers and Credit Card Payment categories. Reuse the predicate that matches the metric.
- Transfer review uses candidate flags. Check both candidate and paired views when changing transfer review behavior.

## Filters

Filters are parsed from URL search params (`src/lib/filters.ts`) and passed to the relevant queries. New filterable dimensions go through this path, not per-component state.

## Routes & Components

- Routes: `src/app/` — `/`, `/transactions`, `/categories`, `/merchants`, `/accounts`, `/rules`, `/calendar`, `/login`, `/review/unresolved`, `/review/transfers`.
- Server components by default; only opt into client components when interactivity requires it.
- Charts use ECharts (`echarts-for-react`); UI uses shadcn/ui + Tailwind 4.

## Conventions

- TypeScript strict. Validate external/query input with zod (`src/lib/schemas.ts`).
- Dev server runs on port 4005 (`npm run dev`); tests via `vitest run`; lint via `eslint`.
