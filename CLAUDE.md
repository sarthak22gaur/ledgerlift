# LedgerLift

Local-first ETL pipeline for parsing personal financial statements (PDFs/CSVs) into a canonical transaction ledger, with a Next.js dashboard for visualization. SQLite is the single source of truth — pipeline and dashboard read/write the same database.

## Project Structure

```
ledgerlift/
├── src/ledgerlift/           # Python pipeline (click CLI, pydantic models)
│   ├── cli.py                # Click CLI: scan, parse, enrich, export, run, e2e, reconcile, transfers, intake, coverage, status, unresolved, backup-zip, rules (group)
│   ├── models.py             # Core models: CanonicalTransaction, ParsedStatement, StatementMetadata
│   ├── pipeline.py           # Orchestration: scan → parse → enrich → transfers → export
│   ├── store.py              # SQLite store: connection, schema init/migration, vault import/export, DB path resolution
│   ├── schema.sql            # Shared DDL (schema version 3) — used by both pipeline and dashboard
│   ├── intake.py             # Copy statements from data/statements/ into data/raw/ (hashed, deduped)
│   ├── coverage.py           # Statement coverage report (queries the DB)
│   ├── hashing.py            # File/content hashing for dedup
│   ├── normalize.py          # Raw → Canonical transaction conversion
│   ├── validation.py         # Statement validation (balance reconciliation integrated)
│   ├── reconciliation.py     # Balance reconciliation: beginning + txns = ending
│   ├── exporters.py          # CSV/JSON export with dedup and sort
│   ├── config.py             # Paths, constants, SUPPORTED_SOURCES
│   ├── enrich/
│   │   ├── engine.py         # RuleEngine: overrides → merchant rules → category rules → fuzzy → heuristic
│   │   ├── text_cleaning.py  # clean_for_matching(), extract_merchant_candidate()
│   │   ├── fuzzy_match.py    # FuzzyMerchantMatcher (rapidfuzz token_set_ratio)
│   │   └── transfers.py      # match_transfer_pairs(), filter_net_transactions()
│   ├── parsers/              # Institution-specific parsers (chase, amex, capitalone, sofi, wealthfront, deserve)
│   └── utils/                # date, money, pdf, text utilities
├── apps/dashboard/           # Next.js 16 dashboard (React 19, ECharts, Tailwind, shadcn/ui)
│   └── src/
│       ├── app/              # Routes: /, /transactions, /categories, /merchants, /accounts, /rules
│       │   └── review/       # /review/unresolved, /review/transfers
│       ├── components/       # UI components (kpi-grid, charts, transaction-table, filter-bar, etc.)
│       ├── server/data/      # queries.ts (SQL builders), repository.ts (data access), types.ts, db.ts (libSQL client), db-path.ts
│       └── lib/              # filters.ts, currency.ts, date.ts, schemas.ts
├── data/                     # Runtime: raw/, statements/, exports/, state/, logs/, rules/
└── tests/                    # pytest suite
```

## Database

- **Engine**: SQLite (via Python stdlib `sqlite3`) — there is no DuckDB warehouse and no Postgres. The dashboard reads the same database through `@libsql/client`, which also supports remote Turso/`libsql://` URLs.
- **Single DB, single schema**: DDL lives in `src/ledgerlift/schema.sql` (schema version 3). Python applies it on `init_db`; the dashboard bootstraps tables on first connection via `ensureSchema()` and warns on version mismatch.
- **DB path resolution** (`store.py:resolve_db_path`): explicit arg → `$LEDGERLIFT_DB` → `$LEDGERLIFT_VAULT/ledgerlift.sqlite` → default `data/state/ledgerlift.sqlite`.
- **Vault**: `LEDGERLIFT_VAULT` is the canonical config env var — the vault directory holds both the DB and the rule/account YAMLs. Auto-imported on init, auto-exported after enrich. `LEDGERLIFT_DB` is an advanced override (e.g. a Turso URL); dashboard auth via `LIBSQL_AUTH_TOKEN`.
- **Tables**: `schema_versions`, `pipeline_meta`, `source_files`, `statements`, `raw_transactions`, `transactions`, `merchant_rules`, `category_rules`, `merchant_overrides`, `category_overrides`, `accounts`, `internal_counterparties`.
- **Rules in DB**: merchant/category rules and overrides live in SQLite (edited via the `/rules` page), with layered base/user semantics (composite PK `(id, source)`; user rows win, deleting a user override reveals the base). Base YAML seeds (`data/rules/merchants.base.yaml`, `categories.base.yaml`) are import-only; `ledgerlift rules import` / `rules export-yaml` move rules between the vault and the DB.
- **Account mappings**: SQLite is the source of truth (the `accounts` table); `accounts.yaml` auto-migrates on first `init_db`. Intake and coverage query the DB.

## Pipeline

- **Enrichment order**: manual overrides → merchant rules → category rules → source category map → type fallback → default "Uncategorized" → fuzzy merchant match → heuristic merchant fallback → transfer/payment detection
- **Transfer matching**: `match_transfer_pairs()` groups by abs(amount), matches across accounts with opposite direction within 3-day tolerance, assigns `transfer_pair_id` + confidence
- **Net filtering**: `filter_net_transactions()` — CC payments: exclude both sides; other transfers: keep debit only
- **Reconciliation**: checking = begin + credits - debits; credit cards = begin + debits - credits; tolerance 0.02

## Dashboard

- **Database**: SQLite/libSQL via `@libsql/client` (`server/data/db.ts`). No Postgres, no `pg` dependency. Connects to a filesystem SQLite file by default; a `libsql://`/`https://` URL in `LEDGERLIFT_DB` targets Turso, with auth via `LIBSQL_AUTH_TOKEN`.
- **Tech**: Next.js 16, React 19, ECharts, Tailwind 4, shadcn/ui, `@libsql/client`, zod
- **Key queries** (in `queries.ts`):
  - `overviewMetricsQuery`: income/expenses/net/uncategorized — excludes categories 'Transfers' and 'Credit Card Payment'
  - `cashflowSeriesQuery`: monthly income/expenses/net — same exclusion
  - `categoryBreakdownQuery`: expense breakdown by category
  - `topMerchantsQuery`: top merchants by spend
  - `transferCandidatesQuery`: transactions where is_transfer_candidate or is_internal_payment_candidate
- **Transaction type** (in `types.ts`): mirrors the `transactions` table in `schema.sql`, including `transfer_pair_id` and `transfer_match_confidence`.
- **KPI Grid**: 4 cards (Income, Expenses, Net Cashflow, Uncategorized) — uses category-based exclusion for double-count avoidance
- **Rerun banner**: reads `pipeline_meta.enrichment_dirty` to prompt a re-enrich after rule edits.
- **Pages**: Overview (KPIs + cashflow chart + category pie + top merchants + recent txns), Transactions (paginated table), Categories, Merchants, Accounts, Rules (rule editor), Review/Unresolved, Review/Transfers

## Key Data Fields

The `transactions` table has 33 columns. SQLite has no native boolean — flags are `INTEGER` (0/1) and confidences are `REAL`. Transfer-related fields:
- `is_transfer_candidate` (INTEGER 0/1) — flagged during enrichment
- `is_internal_payment_candidate` (INTEGER 0/1) — CC payments, autopay, etc.
- `transfer_pair_id` (TEXT, nullable) — set by match_transfer_pairs() when two transactions across accounts are matched
- `transfer_match_confidence` (REAL, nullable) — 1.0 same day, 0.9 one-day gap, 0.8 two-three day gap

## Commands

```bash
# Pipeline
ledgerlift e2e          # Full: intake → scan → parse → enrich → transfers → export
ledgerlift e2e --force  # Clean reparse + re-enrich of every file (truncates derived state first)
ledgerlift run          # scan → parse → enrich → transfers → export
ledgerlift reconcile    # Show balance reconciliation table
ledgerlift transfers    # Show matched transfer pairs
ledgerlift export --net # Export with transfer-eliminated net files
ledgerlift rules import # Import rules from the vault YAMLs into the DB

# Dashboard
cd apps/dashboard && npm run dev   # serves on port 4005

# Tests
pytest tests/ -q
```

## Conventions

- Python 3.12+, pydantic v2 models, click CLI
- TypeScript strict, Next.js app router (server components by default)
- SQL queries built via functions in queries.ts, executed via repository.ts
- Filters parsed from URL search params, applied to all queries
- Pipeline and dashboard share one SQLite DB and one schema (`schema.sql`); change DDL there and bump the schema version in both `store.py` and `db.ts`
