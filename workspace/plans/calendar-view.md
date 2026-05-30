# Plan: Calendar / Temporal Spending Explorer

## Goal
Add a top-level `/calendar` dashboard page that lets the user explore spending across time with a year → month → day drill-down (linkable via URL params), a month calendar heatmap whose cells are clickable to reveal that day's transactions, and temporal-analytics panels (day-of-week, month-of-year, meteorological season). A page-level Expenses/Net toggle switches every metric on the page. Dashboard-only; no Python/pipeline/schema changes.

## Non-Goals
- Time-of-day analytics ("daytime vs night", hourly buckets). NOT FEASIBLE: `transactions.transaction_date`/`posted_date` are date-only TEXT (`schema.sql:49,66`; Python uses `datetime.date`). Explicitly out of scope.
- Any pipeline/Python change, any `schema.sql` DDL change, any schema-version bump.
- New cross-cutting filter dimensions. The Expenses/Net metric toggle is a page-local URL param, not a `FilterParams` field.
- Southern-hemisphere season remapping (assume northern hemisphere — stated assumption).
- Multi-currency handling beyond what existing queries already do (they sum `amount` raw).

## Assumptions
- Canonical bucketing date = `transaction_date` (matches every existing aggregate: `cashflowSeriesQuery` uses `strftime('%Y-%m', transaction_date)` at `queries.ts:197`; `buildWhereClause` filters on `transaction_date` at `queries.ts:68,73`). `posted_date` is an alternative but is rejected to stay consistent with the rest of the dashboard.
- Dates are ISO `YYYY-MM-DD` TEXT, so `strftime('%Y'|'%m'|'%w'|'%Y-%m-%d', transaction_date)` and lexical comparison are valid.
- "Expenses" reuses the established double-count convention. Two conventions exist (`queries.ts:5-58`): the LOOSE `NOT_INTERNAL_FLOW` (used by `overviewMetricsQuery`/`cashflowSeriesQuery`) and the STRICT `NOT_DOUBLE_COUNTED` (used by category/merchant breakdowns). The user's wording ("debits excluding categories 'Transfers' and 'Credit Card Payment'") describes the STRICT `NOT_EXCLUDED_CATEGORY` predicate. Decision: the calendar's Expenses and Net definitions use the **same expressions as `cashflowSeriesQuery`** (LOOSE `NOT_INTERNAL_FLOW` + income/expense/reimbursement expressions) so the page reconciles exactly with the Overview KPI cards and monthly cashflow chart. Rationale: a temporal "you spend more" explorer must tie out to the headline cashflow numbers; using the strict predicate would silently disagree with the Overview page. This is a deliberate interpretation of the user's intent ("match existing dashboard double-count-avoidance convention" → match the cashflow/overview convention specifically). Flag for user confirmation in review.

## Approach
- One new server route `app/calendar/page.tsx` reads `searchParams` (filters + `metric` + `year` + `month`), runs a small set of new repository calls, and renders server components for charts/panels plus client islands for the ECharts heatmap and the metric toggle.
- Five new SQL builders in `queries.ts`, each: (a) calls `buildWhereClause(filters)` so all existing URL filters apply; (b) appends the same real-flow predicate and income/expense expressions as `cashflowSeriesQuery`; (c) takes a `metric: "expenses" | "net"` arg that selects which aggregate column to expose as `value`.
- Drill-down state lives entirely in the URL (`year`, `month`) so back-button and sharing work. No client routing state.
- Reuse `TransactionTable` for the day-detail list and `FilterBar` for the standard filters. Reuse `formatCurrency`/`formatMonth`/`formatDate` and `useChartColors`.

## Metric Definition (shared expression block, reused by all five builders)
Lift the exact expressions from `cashflowSeriesQuery` (`queries.ts:190-201`):
- real-flow predicate: `clause ? "${clause} AND ${NOT_INTERNAL_FLOW}" : "WHERE ${NOT_INTERNAL_FLOW}"`.
- `incomeExpression = CASE WHEN amount > 0 AND ${NOT_UNPAIRED_CC_PAYMENT_CREDIT} AND ${NOT_REIMBURSEMENT_IN} THEN amount ELSE 0 END`.
- `expensesExpression = SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) - SUM(${REIMBURSEMENT_IN_AMOUNT})`.
- `value` column selected by metric: `expenses` → `expensesExpression`; `net` → `SUM(income) - expensesExpression`.
Factor these into a private helper `metricExpressions(metric)` in `queries.ts` returning `{ valueExpr }` to avoid copy-paste drift, but keep it in the same file (no new module). `NOT_INTERNAL_FLOW` etc. are already module constants.

## Season Definition (precise)
Meteorological, northern hemisphere, bucketed by `strftime('%m', transaction_date)`:
- Winter: 12, 01, 02
- Spring: 03, 04, 05
- Summer: 06, 07, 08
- Autumn: 09, 10, 11
Implement with `CASE` on the two-digit month string. State the northern-hemisphere assumption in the panel subtitle and in code via a WHY comment.

## New SQL Builders (in `apps/dashboard/src/server/data/queries.ts`)
All return `QueryParts`; all take `(filters: FilterParams, metric: "expenses" | "net", ...)`. All thread `buildWhereClause` params first.

1. `calendarYearSeriesQuery(filters, metric)` — one row per calendar year present.
   - `GROUP BY strftime('%Y', transaction_date)`, select `year` + `value`. `ORDER BY year`.
2. `calendarMonthSeriesQuery(filters, metric, year)` — 12 rows for a fixed year (months with no data omitted by SQL; client zero-fills 1–12).
   - Adds `AND strftime('%Y', transaction_date) = ?` (param = 4-digit year). `GROUP BY strftime('%m', ...)`, select `month` (`'01'..'12'`) + `value`.
3. `calendarDayHeatmapQuery(filters, metric, year, month)` — one row per day in a fixed `YYYY-MM`.
   - Adds `AND strftime('%Y-%m', transaction_date) = ?` (param = `"${year}-${month}"`). `GROUP BY transaction_date`, select `date` (full `YYYY-MM-DD`) + `value` + `txn_count`.
4. `dayOfWeekSeriesQuery(filters, metric)` — 7 rows. SQLite `strftime('%w', ...)` returns `'0'`(Sun)..`'6'`(Sat).
   - `GROUP BY strftime('%w', transaction_date)`, select `dow` + `value` + `txn_count` + `avg_value` (`value / NULLIF(COUNT(DISTINCT date),0)` — use average per active day so a frequent-but-small day isn't mislabeled; expose both total and avg, panel chooses). Client maps `0..6` → labels and reorders to Mon-first for display.
5. `seasonSeriesQuery(filters, metric)` — 4 rows via the season `CASE`. `GROUP BY` the season expression, select `season` + `value` + `txn_count`. (Also reuse this same `CASE` inline for a month-of-year 12-row series if desired; if so add `monthOfYearSeriesQuery(filters, metric)` grouping by `strftime('%m')` across all years for the seasonal/MoY panel. Decision: include `monthOfYearSeriesQuery` — cheap and the "spend more in this season" claim is clearer with the 12-month bars beneath it.)

Filter interaction note: builders 1, 4, 5, MoY ignore `year`/`month` (whole-dataset within active filters). Builders 2 and 3 add the year / year-month predicate ON TOP of `buildWhereClause`. If the user also has `startDate`/`endDate` filters active they compose with AND (intersection) — acceptable and expected.

## Metric toggle representation
- URL search param `metric` ∈ `{expenses, net}`, default `expenses`. NOT a `FilterParams` field (it changes aggregation semantics, not the row set), so do NOT add it to `filterSchema`/`parseFilters`/`filtersToSearchParams`. Parse it directly in `page.tsx` with a local guard (`params.metric === "net" ? "net" : "expenses"`).
- A small client component `CalendarMetricToggle` (shadcn `Tabs` or two `Button`s) sets `metric` via `router.push` preserving all other params (same `buildHref` pattern as `transaction-table.tsx:65`). Server re-renders with new metric.
- Drill-down params `year` (4-digit string) and `month` (`'01'..'12'`) also live in the URL, parsed/guarded in `page.tsx`, preserved by all navigation links.

## Drill-down navigation model
- No `year` param → **Year view**: bar chart of yearly `value` (builder 1). Clicking a bar pushes `?year=YYYY` (+ existing params).
- `year` set, no `month` → **Month view**: 12-month bar chart for that year (builder 2). Breadcrumb `All years / {year}`. Clicking a month bar pushes `&month=MM`.
- `year` + `month` → **Day view**: calendar heatmap grid for that month (builder 3) + day-detail panel. Breadcrumb `All years / {year} / {Month}`.
- Day-of-week, month-of-year, season panels render at ALL levels (they describe the whole filtered dataset), below the drill-down area.
- Day-detail: clicking a heatmap cell sets a `day` param (`YYYY-MM-DD`); `page.tsx` then also calls `getTransactions` with `{...filters, startDate: day, endDate: day}` and renders `TransactionTable` (non-paginated or pageSize 100). Reuses existing `transactionsQuery` — no new builder needed for the detail list.

## New repository functions (`apps/dashboard/src/server/data/repository.ts`)
Thin wrappers mirroring `getCashflowSeries` (`repository.ts:48`):
- `getCalendarYearSeries(filters, metric)`
- `getCalendarMonthSeries(filters, metric, year)`
- `getCalendarDayHeatmap(filters, metric, year, month)`
- `getDayOfWeekSeries(filters, metric)`
- `getSeasonSeries(filters, metric)` and `getMonthOfYearSeries(filters, metric)`
Each `query<RowType>(sql, params)`.

## New types (`apps/dashboard/src/server/data/types.ts`)
```
type CalendarBucket = { year?: string; month?: string; date?: string; value: number; txn_count?: number };
type CalendarYearPoint = { year: string; value: number };
type CalendarMonthPoint = { month: string; value: number };
type CalendarDayPoint = { date: string; value: number; txn_count: number };
type DayOfWeekPoint = { dow: string; value: number; txn_count: number; avg_value: number };
type SeasonPoint = { season: "Winter"|"Spring"|"Summer"|"Autumn"; value: number; txn_count: number };
type MonthOfYearPoint = { month: string; value: number; txn_count: number };
```
(Prefer the specific named types over the union; drop `CalendarBucket` if unused.)

## New components (`apps/dashboard/src/components/calendar/`)
Client components (ECharts / interactivity), mirroring `cashflow-chart.tsx` structure (`echarts/core` + `echarts-for-react/lib/core`, `useChartColors`, `Card` wrapper):
- `calendar-heatmap.tsx` — ECharts `HeatmapChart` + `CalendarComponent` + `VisualMapComponent`, one month grid; `onEvents.click` → push `day` param. Intensity = `value`; `VisualMap` min/max from data.
- `drilldown-chart.tsx` — reusable bar chart for Year and Month views; `onEvents.click` pushes `year` or `month`. (Could reuse a generic bar; a dedicated small component is simpler.)
- `drilldown-breadcrumb.tsx` — links that drop `month` then `year` from the URL.
- `metric-toggle.tsx` — Expenses/Net switch (client; `router.push`).
- `day-of-week-panel.tsx` — bar chart, Mon-first reorder, label `0..6`→`Sun..Sat`, highlight max ("you spend more on {day}").
- `season-panel.tsx` — 4 season bars + optional 12 month-of-year bars; highlight max season; northern-hemisphere note.
Server-side day-detail uses existing `TransactionTable` directly in `page.tsx`; no new component.

Register new ECharts modules per chart: `HeatmapChart`, `CalendarComponent`, `VisualMapComponent` for the heatmap; `BarChart` etc. for the bar panels (same `echarts.use([...])` pattern as `cashflow-chart.tsx:19`).

## Nav
Add to `mainNav` in `apps/dashboard/src/components/layout/sidebar.tsx:25` a `{ label: "Calendar", href: "/calendar", icon: CalendarDays }` entry (import `CalendarDays` from `lucide-react`). `isActive` (`sidebar.tsx:60`) already handles prefix matching.

## Schema / index
NO schema change. `idx_txn_date ON transactions(transaction_date)` already exists (`schema.sql:93-94`) and covers the `strftime` GROUP BYs and the day-detail range scan. SQLite can't use the index for `strftime()` expressions directly (full scan over the filtered set), but dataset size is personal-scale (tens of thousands of rows) — acceptable, matches `cashflowSeriesQuery` which already full-scans. Do not add an expression index; unjustified for this scale and would require a schema-version bump per CLAUDE.md DDL rule.

## File-by-file change list
- `apps/dashboard/src/server/data/queries.ts` — add `metricExpressions` helper + 6 builders (year, month, day-heatmap, day-of-week, season, month-of-year). No edits to existing builders.
- `apps/dashboard/src/server/data/repository.ts` — add 6 wrapper functions; extend imports.
- `apps/dashboard/src/server/data/types.ts` — add the calendar/temporal row types.
- `apps/dashboard/src/app/calendar/page.tsx` — NEW server page: parse `searchParams` (filters via `parseFilters`, plus `metric`/`year`/`month`/`day` guards), `Promise.all` the repo calls, render `AppShell` + `FilterBar` (via a small client wrapper like `transactions-client.tsx`) + toggle + breadcrumb + drill-down chart/heatmap + panels + optional day-detail `TransactionTable`. Include `EmptyState` + try/catch like `transactions/page.tsx:42-54`.
- `apps/dashboard/src/app/calendar/calendar-client.tsx` — NEW client wrapper rendering `FilterBar` + `CalendarMetricToggle` (mirrors `transactions-client.tsx`).
- `apps/dashboard/src/components/calendar/*.tsx` — NEW (6 components above).
- `apps/dashboard/src/components/layout/sidebar.tsx` — add nav item.
- Tests: `apps/dashboard/` uses vitest; add `queries` unit tests asserting each builder's SQL contains the metric expression, the correct `GROUP BY strftime(...)`, and that `buildWhereClause` params precede the year/month params (mirror existing `route.test.ts` style under `app/api/rules/merchants/`).

## Phases (for engineer agent)
1. Data layer: types + `metricExpressions` + 6 query builders + 6 repository wrappers. Vitest unit tests on SQL shape and param ordering. (No UI.)
2. Page scaffold: `app/calendar/page.tsx` + `calendar-client.tsx` + sidebar nav entry. Render raw JSON/tables of all six datasets to verify data end-to-end (`npm run dev`, port 4005).
3. Drill-down: `drilldown-chart.tsx` (year/month bar + click→URL), `drilldown-breadcrumb.tsx`, `metric-toggle.tsx`. Verify back-button + shareable URLs.
4. Heatmap + day-detail: `calendar-heatmap.tsx`, wire cell click → `day` param → existing `TransactionTable`.
5. Temporal panels: `day-of-week-panel.tsx`, `season-panel.tsx` (+ month-of-year). Highlight-max styling and northern-hemisphere note.
6. Polish: empty/error states, loading skeletons, dark-mode colors via `useChartColors`, lint/typecheck.

## Risks
- Metric-convention mismatch: chosen LOOSE (cashflow-matching) predicate differs from the STRICT predicate the user's literal wording implies. If user wants strict, swap `NOT_INTERNAL_FLOW` → `NOT_DOUBLE_COUNTED` and add `AND amount < 0` for expenses in the four builders — isolated change. Confirm in review.
- `strftime('%w')` Sunday=0: easy to mis-order to Mon-first; cover with a unit test on the label map.
- Timezone: render labels with `formatMonth`/`formatDate` from `lib/date.ts` (already local-time-safe per `date.ts:6-18`); never `new Date(isoString)` raw in components.
- Heatmap with sparse months: zero-fill day grid client-side so empty days render as a zero cell, not a gap.
- ECharts module registration: forgetting `CalendarComponent`/`VisualMapComponent` yields a blank chart; called out in Phase 4.
- Net values can be negative (income < expenses); `VisualMap`/bar colors must handle a diverging scale, not just positive intensity.

## Verification
- Unit (vitest): each builder emits expected `strftime` grouping, includes `NOT_INTERNAL_FLOW`, threads filter params before year/month params, and `metric=net` vs `expenses` selects different value expressions.
- Reconciliation: with no filters, `metric=expenses` summed across `calendarYearSeriesQuery` equals total expenses from `overviewMetricsQuery`; sum across `calendarMonthSeriesQuery` for a year equals that year's slice of `cashflowSeriesQuery`. This is the acceptance gate proving the convention choice ties out.
- Manual: drill Year→Month→Day, toggle Expenses/Net (page-wide), click a heatmap cell → correct day's transactions in `TransactionTable`; back-button restores prior level; copy URL reproduces exact view; day-of-week panel highlights the true max day.
- `npm run lint` and `tsc` clean; dark mode legible.
