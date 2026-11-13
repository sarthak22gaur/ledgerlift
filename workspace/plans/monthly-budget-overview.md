# Plan: Monthly spending overview for budget decisions

Status: implemented, independently reviewed, and verified.

## Goal

Add a Monthly Overview page that answers where spending went in one selected month and which categories grew compared with recent months, with merchant and transaction drilldowns so the user can infer where to make changes. Keep the view explainable, grounded in imported ledger data, and useful without requiring budget setup.

## Non-Goals

- Interactive reduction scenarios, persistent budgets, targets, notifications, forecasting, savings-account balances, financial advice, or automated transaction changes.
- Database/schema changes, ETL changes, reclassification, or rewriting existing overview/category metric semantics.
- A comprehensive account/statement completeness audit or claims that imported transactions prove a month is complete.
- Changes to the calendar or existing overview beyond adding the navigation entry.
- The isolated Header theme hydration fix is separate work owned by the main session; this plan does not expand that fix.

## Approach

### Navigation and month scope

- Add **Monthly Overview** to the shared sidebar and a dedicated `/monthly` server-rendered route. Existing shared navigation covers desktop and the mobile sheet (`apps/dashboard/src/components/layout/sidebar.tsx:26`, `apps/dashboard/src/components/layout/app-shell.tsx:25`).
- Use validated `month=YYYY-MM` URL state, a labeled month picker, and previous/next buttons. The month owns the date range: derive inclusive first/last dates, replacing any incoming `startDate`/`endDate` rather than intersecting accidentally with stale dates. Preserve valid non-date filters when moving between months and show when the view is filtered. Existing URL filtering and serialization live in `apps/dashboard/src/lib/filters.ts:8` and `apps/dashboard/src/lib/filters.ts:51`.
- Default to the latest month with imported transactions in the selected non-date scope. If no scoped data exists, use the current month and show an honest empty state. Explicit valid month selection wins. Invalid month values fall back safely without allowing invalid dates into SQL.
- Keep monthly controls focused on month and institution/account scope; honor other supported non-date URL filters and make their presence visible instead of adding a second general transaction filter UI.

### Visible content

1. Month heading, date range, latest imported transaction date, and a concise notice that results reflect imported transactions and may omit statements.
2. Summary cards: **Category spending**, **Income & other inflows**, **Cash outflow after reimbursements**, and **Net cashflow**. Separate spending analysis from cashflow rather than presenting their different totals as interchangeable.
3. Ranked category table with amount, share of category spending, transaction count, prior-month difference in dollars/percent, and prior-three-month average where history supports it. Reuse the existing category chart if it improves scanning; the ranked table is the required comparison surface.
4. A small **What changed** section: largest category spending increases, newly appearing categories, and the largest spending category. Wording must state measured differences, not judge a category as excessive without a user target.
5. Category and merchant details link to existing `/transactions` with the selected month and scoped filters. A category row must drill into the contributing debit rows, replacing conflicting category/direction filters as necessary; links must not pretend ordinary transaction results apply hidden spending exclusions. Keep existing rows visible where needed to explain exclusions. Treat all categories equally; comparisons and drilldowns let the user infer where to make changes.

### Metric contract

Reuse current predicates inside `queries.ts`; SQL remains in query builders and execution in `repository.ts`, following the existing boundary (`apps/dashboard/src/server/data/repository.ts:43`). Add monthly result types separately from the stored transaction row shape.

| Metric or transaction class | Monthly behavior |
|---|---|
| Category spending and merchant/category comparisons | Sum absolute debit amounts under `NOT_DOUBLE_COUNTED`, matching existing category breakdown semantics. Category shares use the same total and sum to 100% within rounding. Current implementation is debit-only (`apps/dashboard/src/server/data/queries.ts:210`). |
| Income, expense cashflow, net cashflow | Reuse `overviewMetricsQuery` and `NOT_INTERNAL_FLOW` semantics. Keep an explanatory distinction from category spending (`apps/dashboard/src/server/data/queries.ts:141`). |
| Matched transfers and Internal Sweep subcategory | Excluded from both spending and cashflow (`apps/dashboard/src/server/data/queries.ts:27`, `apps/dashboard/src/server/data/queries.ts:30`). |
| Unmatched Transfers / Credit Card Payment categories | Excluded from category spending; existing cashflow treatment stays intact, including unmatched external debits. Orphan card-payment credits remain excluded from income (`apps/dashboard/src/server/data/queries.ts:32`, `apps/dashboard/src/server/data/queries.ts:36`). |
| Inbound reimbursement | Offsets cashflow expenses, not income; does not get arbitrarily allocated back to an expense category. Outbound reimbursement remains debit spending in its category (`apps/dashboard/src/server/data/queries.ts:38`). |
| Positive refund or other credit outside reimbursement/card-payment rules | Does not reduce the debit-only category amount; follows existing positive-inflow treatment in the cashflow cards. Explain this in concise calculation help rather than silently introducing a new refund allocation policy (`apps/dashboard/src/server/data/queries.ts:150`, `apps/dashboard/src/server/data/queries.ts:215`). |
| Security deposit / one-off expense | No special inference or exclusion: count according to its existing category and amount, as current spending queries do. Do not label the amount recurring or readily reducible. |
| Uncategorized / NULL category | Keep in an explicit Uncategorized row and share denominator. Show its amount so users see attribution limits (`apps/dashboard/src/server/data/queries.ts:221`). |

### Comparison windows and limited data

- Historical selected months compare full calendar-month imported totals to the immediately preceding month and the arithmetic average of the preceding three calendar months.
- For the current month, compare through the earlier of today's day and the latest imported transaction date in that month. For the newest imported month that ends before its calendar end, use its latest imported transaction day as a conservative comparison cutoff. Truncate each comparison month to the same day number or its own month end, whichever is earlier. Label these comparisons **through day N**, not full-month totals or forecasts.
- Display actual selected-month spending separately from the comparison cutoff where needed; do not hide later imported selected-month rows to improve a trend. In the ordinary current/latest partial case these windows coincide.
- Absence of all scoped transactions in a comparison month means **No imported data**, not a zero-spending baseline. Suppress that month's percentage change; show the three-month average only when all three comparison windows have imported data. A category absent within a window that has scoped ledger data may be zero, labeled **New** rather than dividing by zero.
- When the selected month has no imported data, show the empty state and month controls, with no reassuring under-budget conclusion.
- State that comparison windows align calendar days but do not establish complete account coverage. Do not infer complete statement coverage from last transaction date.

## Phases

1. **Month selection and data contract.** Add monthly URL/date helper validation, result types, focused monthly query builders and repository functions, and synthetic SQL integration tests. Preserve existing predicates; no changes to shared money classification policy.
2. **Monthly page and interactions.** Add route, focused monthly components, sidebar entry, category comparisons, explanatory calculation help, and month-scoped drilldowns. Use existing cards, typography, money formatter, and chart components. Client components are limited to controls that require interaction.
3. **Review and verification.** Independently review the cumulative diff against the approved scope. Test the page using a temporary synthetic database; fix reproduced in-scope issues and report adjacent findings without expanding the work.

## Expected files

- `apps/dashboard/src/app/monthly/page.tsx` and focused monthly components under `src/components/monthly/` or the route directory.
- `apps/dashboard/src/components/layout/sidebar.tsx` for the navigation entry.
- `apps/dashboard/src/lib/filters.ts` / `schemas.ts` where the month parsing contract belongs, plus a focused month-window helper if needed.
- `apps/dashboard/src/server/data/queries.ts`, `repository.ts`, and `types.ts` for monthly data.
- Focused synthetic tests in `apps/dashboard/src/__tests__/` for month windows, actual SQL arithmetic/predicates, insight conditions, and URL/drilldown behavior.
- No changes to `schema.sql`, Python ETL, existing category/merchant query semantics, vault files, or unrelated agent infrastructure.

## Risks

- Spending and cashflow totals differ intentionally; clear labels and calculation help are required so an account transfer, reimbursement, or refund is not mistaken for category overspending.
- Sparse imports can mimic a spending reduction. Missing baseline windows suppress comparisons, and all trends remain explicitly based on imported data.
- Category labels encode the user's rules. Do not guess discretionary spending from arbitrary merchant text or classify transactions anew for the monthly page.
- A period-filtered transaction drilldown can include rows excluded from category aggregates. State its scope honestly and avoid silently promising exact equality where the existing transaction filter contract cannot express it.

Rollback: remove the additive monthly route/components/query functions and sidebar entry. No data restoration or schema rollback is required because the feature does not modify ledger or budget data. Preserve the separately completed Header hydration fix.

## Verification

- Execute generated monthly SQL against a temporary SQLite/libSQL database seeded with synthetic rows. Cover matched pairs, internal sweep, unmatched card debits, orphan card credits, reimbursements in both directions, positive refunds, security deposits, NULL categories, and scoped filters. Assert monetary outputs and category denominators, not just SQL string fragments.
- Test December/January rollover, leap February, invalid months, current-month same-day comparisons, shorter comparison months, latest imported partial month, missing baseline months, zero prior-category spend, and no-data selections.
- Test drilldowns preserving month/institution/account scope and updating category/direction coherently. Check merchant drilldowns only where a merchant detail is rendered; no requirement to build an additional merchant dashboard.
- From the dashboard package, run focused tests, `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`. This package's `tsconfig.json` includes the source files and has no project-reference-only empty root configuration (`apps/dashboard/tsconfig.json:27`). Use `direnv exec .` from the repo root if the approved environment is needed, otherwise the owning package commands.
- Browser-check `/monthly` with a synthetic database on desktop and mobile: picker/previous/next, empty month, partial month label, category table/drilldown, keyboard labels, and light/dark themes. Confirm no hydration errors and no access to private financial rows for screenshots or artifacts.
- Report commands, outcomes, and any environment-limited checks. No commits, pushes, or server lifecycle changes are authorized by this plan itself.

## Decisions and open items

- Recommended default: latest imported month, rather than a potentially empty current month.
- Recommended first version: read-only spending analysis; interactive scenarios and persistent category budgets are separate features.
- Existing refund/reimbursement/cashflow semantics remain unchanged and visible. No blocking product question remains for writing the implementation once the user approves this scope.

## Execution tracking

- Baseline preserved: the existing Header hydration fix/test and Samsung Pay category-seed correction predate this implementation.
- Data/helpers/SQL and synthetic regression tests: complete; owned by engineer monthly_data.
- Monthly route/components/navigation and UI tests: complete; owned by engineer monthly_ui.
- Independent cumulative review: complete; no findings meeting the defect bar.
- Dashboard tests, type-check, lint, production webpack build, and synthetic browser QA: complete; default Turbopack build limitation recorded below.
- All implementation and review subagents use gpt-6.1-sol, as explicitly requested.

## Verification results

- `npm test` in the dashboard package: 159 passed.
- `npx tsc --noEmit` and `npm run lint` in the dashboard package: passed.
- `npm run build -- --webpack`: passed with TypeScript checks retained, using an isolated snapshot and synthetic database.
- Default Turbopack production build compiles, then receives SIGKILL during Next type-check startup; the same failure reproduces on pristine HEAD. The cause is undetermined and is not attributed to the monthly feature. No source/config workaround or skipped checks was added.
- Synthetic real-browser desktop/mobile checks passed: month picker and arrows, account filter preservation, debit transaction drilldowns, empty/partial months, dark/light toggle, no hydration/page errors in the production build, and zero control geometry changes while a month navigation request was deliberately delayed.
- Temporary preview servers were stopped; the user's existing port-4005 server was preserved.
- User-reported loading-label layout shift fixed with a persistent screen-reader-only status and a regression test.
- Separate user-reported ACH category issue repaired: generic withdrawal text no longer implies cash, explicit ATM/cash and dated teller forms remain supported, and six synthetic regressions were added. Eight known ACH debits were corrected in the backed-up local ledger; source amounts/dates/IDs were preserved. Full Python suite: 250 passed.
- Final independent review of the loading-status and category-rule follow-ups found no defects; reviewer independently passed 10 monthly UI tests and 33 enrichment tests.
- No commits or pushes performed.
