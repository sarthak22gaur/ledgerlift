# LedgerLift

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Local-first ETL pipeline for parsing personal financial statements (PDFs/CSVs) into a canonical transaction ledger, with a Next.js analytics dashboard.

Everything runs on your laptop. Your statements, parsed transactions, and rules stay in `data/` (gitignored) — nothing is uploaded to a third party. The dashboard reads from the same SQLite database the pipeline writes to.

## Supported Sources

| Institution | Account Type | Format | Parser | Status |
|------------|-------------|--------|--------|--------|
| Chase | Checking | PDF | `chase_checking_pdf` | Supported |
| Chase | Credit | PDF | `chase_credit_pdf` | Supported |
| Capital One | Credit | PDF | `capital_one_credit_pdf` | Supported |
| Amex | Credit | CSV | `amex_credit_csv` | Supported |
| SoFi | Checking/Savings | PDF | `sofi_pdf` | Supported |
| Wealthfront | Cash Account | PDF | `wealthfront_cash_pdf` | Supported |
| Wealthfront | Cash (Green Dot) | PDF | `wealthfront_greendot_pdf` | Supported |
| Deserve | Credit | PDF | `deserve_credit_pdf` | Supported |

Other institutions need a contributed parser before they work — see [Adding New Institutions](#adding-new-institutions).

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+ (for the dashboard)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/sarthak22gaur/ledgerlift.git
cd ledgerlift
pip install -e ".[dev]"

# 2. Drop your statement files and run the pipeline
mkdir -p data/statements
# Copy your PDF/CSV statements into data/statements/
ledgerlift e2e --force   # intake → scan → parse → enrich → export (full rebuild)

# 3. Start the dashboard
cd apps/dashboard
cp .env.example .env.local  # defaults work fine; edit only if needed
npm install
npm run dev
# Open http://localhost:4005

# 4. Add your account mappings in the dashboard: /rules → Accounts tab
#    (map each statement's last-4 digits to an institution/account), then
#    re-run `ledgerlift e2e` to apply them.
```

To add more statements later, drop them in `data/statements/` and run `ledgerlift e2e` (no `--force` needed — only new files will be processed).

## Usage

### Full pipeline

```bash
# End-to-end: intake → scan → parse → enrich → export
ledgerlift e2e

# Force full rebuild (re-parse and re-enrich everything)
ledgerlift e2e --force

# Or just run (scan + parse + enrich + export) if files are already in data/raw/
ledgerlift run

# All commands also work via python -m
python -m ledgerlift run
```

### intake — Sort statements into the right directories

```bash
# Auto-sort files from data/statements/ into data/raw/
ledgerlift intake

# Preview what would be moved without actually moving
ledgerlift intake --dry-run

# Skip unrecognized files instead of prompting
ledgerlift intake --no-interactive
```

### scan — Discover and register source files

```bash
ledgerlift scan
ledgerlift scan --institution chase --account checking --year 2023
```

### parse — Parse statements into structured data

```bash
# Parse only new/changed statements
ledgerlift parse

# Filter by institution, account, or year
ledgerlift parse --institution chase --account credit --year 2025
ledgerlift parse --institution amex

# Force reparse everything (even already-parsed files)
ledgerlift parse --force
```

### enrich — Apply merchant and category rules

```bash
# Enrich all parsed transactions
ledgerlift enrich

# Force re-enrichment (e.g., after updating rules)
ledgerlift enrich --force
```

### export — Write canonical CSV and JSON

```bash
ledgerlift export

# Export with transfer-eliminated net files
ledgerlift export --net
```

### unresolved — Find transactions needing rules

```bash
# Show top unresolved merchants (helps you add merchant rules)
ledgerlift unresolved merchants

# Show top unresolved categories
ledgerlift unresolved categories --limit 50
```

### rules export-yaml — Back up rules to YAML

Exports the current rule state from SQLite to YAML files (useful for portability or versioning rules in a private repo):

```bash
ledgerlift rules export-yaml --out /path/to/backup/dir
# Writes: merchants.yaml, categories.yaml, merchant_overrides.yaml,
#         category_overrides.yaml, accounts.yaml, internal_counterparties.yaml
```

### transfers — Show matched transfer pairs

```bash
ledgerlift transfers
```

### reconcile — Show balance reconciliation

```bash
ledgerlift reconcile
```

### Verbose logging

Add `-v` before any command for debug output:

```bash
ledgerlift -v parse
ledgerlift -v run
```

## Dashboard

LedgerLift includes a Next.js analytics dashboard under `apps/dashboard/` that reads the SQLite database directly — no database server required.

### Local setup

```bash
# 1. Make sure the database exists
ledgerlift e2e   # or just `ledgerlift run` if files are already in data/raw/

# 2. Install and run the dashboard
cd apps/dashboard
cp .env.example .env.local  # defaults are fine for local use
npm install
npm run dev
# Open http://localhost:4005
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LEDGERLIFT_DB` | No | Path to `ledgerlift.sqlite`, or a `libsql://` URL for a hosted Turso database. Defaults to `../../data/state/ledgerlift.sqlite`. |
| `LIBSQL_AUTH_TOKEN` | No | Auth token for Turso / hosted libSQL. Not needed for local file access. |
| `APP_ACCESS_KEY` | No | Password gate (open access if unset). |
| `NEXT_PUBLIC_APP_NAME` | No | App display name. |
| `NEXT_PUBLIC_APP_ENV` | No | Environment label. |

### Hosted Turso database

To point the dashboard at a hosted [Turso](https://turso.tech/) database, set `LEDGERLIFT_DB=libsql://your-db.turso.io` and `LIBSQL_AUTH_TOKEN=<token>`. Any `libsql://`, `https://`, or `wss://` value in `LEDGERLIFT_DB` is passed through to `@libsql/client` unchanged; filesystem resolution only applies when no URL scheme is present.

### Dashboard pages

| Page | URL | Description |
|------|-----|-------------|
| Overview | `/` | KPI cards, cashflow chart, category breakdown, top merchants |
| Transactions | `/transactions` | Searchable, filterable transaction table with pagination |
| Categories | `/categories` | Category spending breakdown with chart and table |
| Merchants | `/merchants` | Merchant spending ranked by total |
| Accounts | `/accounts` | Institution/account summaries with net flow |
| Unresolved | `/review/unresolved` | Uncategorized transactions for review |
| Transfers | `/review/transfers` | Matched transfer pairs and candidates |
| Rules | `/rules` | Merchant and category rules editor |

### Dashboard stack

- Next.js 16 with App Router
- TypeScript
- Tailwind CSS + shadcn/ui
- ECharts for charts
- `@libsql/client` for SQLite access (server-side only)
- Zod for validation

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Laptop (local)                      │
│                                                      │
│  Statements ──► ETL Pipeline ──► ledgerlift.sqlite   │
│   (PDF/CSV)    (scan/parse/                 │        │
│                 enrich/export)              ▼        │
│                                    Next.js dashboard │
│                                    (reads SQLite     │
│                                     directly)        │
└──────────────────────────────────────────────────────┘
```

Everything runs locally. The pipeline and the dashboard share a single SQLite file (`data/state/ledgerlift.sqlite`) — no database server, no sync step, nothing to host. Bring your own statements, run the pipeline, open the dashboard.

## Purpose

LedgerLift takes raw bank statement PDFs and CSVs and converts them into clean, normalized transaction data. It's designed to be:

- **Additive**: Drop new statements in and re-run. Only new files get processed.
- **Idempotent**: Run it as many times as you want — no duplicates, no re-work.
- **Extensible**: Add new institutions by implementing a parser and registering it.

## Repository Structure

```
ledgerlift/
  src/ledgerlift/               # Python ETL pipeline
  apps/dashboard/               # Next.js analytics dashboard
  tests/                        # Python tests
  data/
    statements/                 # Drop folder — put files here, run `intake`
    raw/                        # Organized source files (auto-sorted by intake)
    exports/                    # Final canonical output (CSV + JSON)
    state/                      # ledgerlift.sqlite — pipeline state + transactions + rules
    rules/                      # *.base.yaml seed files (merchant/category defaults)
    logs/
```

All contents under `data/` (except the `*.base.yaml` seed files) are gitignored. Financial data stays local only.

## Intake auto-detection

Files are automatically routed by filename pattern or content inspection:

| Pattern | Institution | Account |
|---------|------------|---------|
| `YYYYMMDD-statements-LAST4-.pdf` | Chase | Checking/Credit (by last-4) |
| `Statement_MMYYYY_LAST4.pdf` | Capital One | Credit |
| `GREEN_DOT_STATEMENT_YYYY-MM_...pdf` | Wealthfront | Cash (Green Dot) |
| `STATEMENT_YYYY-MM_...pdf` | Wealthfront | Cash |
| `Month_YYYY_STATEMENT.pdf` | Deserve | Credit |
| `activity*.csv` (detected by column headers) | Amex | Credit |
| UUID-named PDFs (detected by content) | SoFi | Bank |

The last-4 digits in filenames map to specific accounts stored in the SQLite database. Add your account mappings via the dashboard `/rules` → Accounts tab after the first `ledgerlift e2e --force`.

## Enrichment

After parsing, the `enrich` step applies rules-based merchant normalization and category assignment.

### How it works

1. **Manual overrides** (highest priority) — match by transaction ID or description pattern
2. **Merchant rules** — regex/contains/prefix/exact match on cleaned descriptions → sets `merchant_normalized` and optionally `category_normalized`
3. **Category rules** — match on merchant, description, transaction type, direction, institution → sets `category_normalized`
4. **Fuzzy matching** — rapidfuzz token_set_ratio against known merchants
5. **Heuristic fallback** — cleaned description used as merchant candidate with low confidence
6. **Transfer detection** — cross-account transfer matching with `match_transfer_pairs()`

### Rule storage

Rules and account mappings live in the SQLite database (`data/state/ledgerlift.sqlite`), not in YAML files. The committed `data/rules/*.base.yaml` files are **seed data only** — they are read once at database initialization time and inserted into the rule tables with `source='base'`. Re-seeding is idempotent (INSERT OR IGNORE), so user edits survive re-runs.

Account mappings (last-4 → institution/account routing for intake, and opened/closed lifecycle dates for coverage) are stored in the `accounts` table. Edit them via the dashboard `/rules` → Accounts tab, or bulk-import from a YAML file with `ledgerlift accounts import [PATH]`.

The preferred way to add or edit merchant/category rules is the dashboard's `/rules` page. You can also edit rules directly via SQL.

To export the current DB rule state to YAML (for backup or private versioning):

```bash
ledgerlift rules export-yaml --out /path/to/backup/dir
```

### The vault pattern

If you want to version your rules and personal data separately from this public repo, point `LEDGERLIFT_DB` at a path inside a private repository:

```bash
export LEDGERLIFT_DB=~/my-private-finances/ledgerlift.sqlite
ledgerlift e2e --force
```

The dashboard picks up the same env var, so both the pipeline and dashboard read/write the same file. No separate vault directory or sync step needed.

## Output Schema

Each canonical transaction contains:

| Field | Description |
|-------|-------------|
| `transaction_id` | Stable hash-based ID |
| `transaction_date` | Date of the transaction |
| `description_raw` | Original description from statement |
| `description_normalized` | Parser-level cleaned description |
| `merchant_normalized` | Enrichment-level merchant name |
| `amount` | Signed amount (negative = debit, positive = credit) |
| `direction` | `debit` or `credit` |
| `transaction_type` | `purchase`, `ach`, `fee`, `transfer`, `atm`, `check`, etc. |
| `category_normalized` | Spending category (Groceries, Dining, etc.) |
| `is_transfer_candidate` | Likely a transfer between accounts |
| `transfer_pair_id` | Links matched transfer pairs across accounts |
| `institution` | Source institution (chase, capitalone, amex, etc.) |
| `account_name` | Account type (checking, credit, etc.) |

## Additive / Idempotent Behavior

- **Scan** registers files by SHA-256 hash. Renamed files with same content are recognized.
- **Parse** skips files already successfully parsed. Use `--force` to override.
- **Enrich** skips files already enriched. Use `--force` to re-apply rules after edits.
- **Export** deduplicates transactions and produces deterministic output. Uses enriched data when available.
- The SQLite database (`data/state/ledgerlift.sqlite`) tracks all state: parse status, enrichment status, timestamps, error counts, and rule tables.

## Adding New Institutions

See [CONTRIBUTING.md](CONTRIBUTING.md) for a detailed guide.

1. Create a new parser module in `src/ledgerlift/parsers/`
2. Subclass `BaseParser` from `ledgerlift.parsers.base`
3. Implement `name`, `version`, and `parse()` methods
4. Register it in `ledgerlift/parsers/__init__.py` `PARSER_REGISTRY`
5. Add the institution/account to `config.py` `SUPPORTED_SOURCES`
6. Add an account mapping via the dashboard `/rules` → Accounts tab (or `ledgerlift accounts import`) or add content-based detection in `intake.py`

### Parser types

- **PDF parsers** extract text with pdfplumber, then parse transaction lines with regex. See `chase_checking_pdf.py` or `capital_one_credit_pdf.py`.
- **CSV parsers** read structured data directly. See `amex_credit_csv.py` — much simpler since the data is already tabular.

## Running Tests

```bash
# Python ETL tests
pytest -v

# Dashboard tests
cd apps/dashboard && npm test
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## Known Limitations

- Only text-based PDF extraction — scanned/image PDFs won't work
- No OCR support yet
- Deduplication is conservative (within same source file only)
- Amex CSVs don't include card number, so all Amex CSVs map to a single account
- Dashboard hosting requires the SQLite file to be reachable by the server; the current setup is local-only (a hosted Turso path is on the roadmap)

## Roadmap

- [ ] OCR fallback for image-based PDFs
- [ ] Firefly III direct import
- [ ] ML-based category suggestions
- [ ] More institution parsers (contributions welcome!)
- [ ] Turso hosted deployment path

## Status & scope

LedgerLift is a personal project, released under the MIT license so others can use, fork, or contribute parsers. It is **not** a product:

- No hosted service, no signup, no managed offering.
- No support guarantees — issues and PRs are best-effort.
- Parsers exist for the institutions I personally use (Chase, Amex, Capital One, SoFi, Wealthfront, Deserve). Other institutions need a contributed parser before they work.
- Statement formats change. A parser that worked last quarter may break when your bank tweaks their PDF template. Reconciliation will catch most of these; fixing them is on you (or whoever contributes the parser).

If you want a polished, hands-off personal finance app, use Monarch, Copilot, or Tiller. If you want a hackable, local-first pipeline that never sends your financial data to anyone, this is for you.

## License

LedgerLift is released under the [MIT License](LICENSE). You're free to use, modify, and redistribute it — including commercially — as long as you retain the copyright and license notice. Provided as-is, without warranty.
