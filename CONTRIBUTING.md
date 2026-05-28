# Contributing to LedgerLift

Thanks for your interest in contributing to LedgerLift. This guide covers the essentials for getting started.

## Development Environment Setup

### Python Pipeline

Requires Python 3.12+.

```bash
git clone https://github.com/<your-fork>/ledgerlift.git
cd ledgerlift
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### Dashboard

Requires Node.js 18+.

```bash
cd apps/dashboard
npm install
npm run dev
```

## Adding a New Institution Parser

1. Create a new file in `src/ledgerlift/parsers/` (e.g., `mybank.py`).
2. Subclass `BaseParser` from `src/ledgerlift/parsers/base.py`.
3. Implement the required interface:
   - `name` -- institution identifier string
   - `version` -- parser version string
   - `parse()` -- accepts a file path and returns a `ParsedStatement`
4. Register your parser in `src/ledgerlift/parsers/__init__.py` by adding it to `PARSER_REGISTRY`.
5. Add the institution to `SUPPORTED_SOURCES` in `src/ledgerlift/config.py`.
6. Add intake detection logic in `src/ledgerlift/intake.py` so the pipeline can auto-route files to your parser.
7. Add tests in `tests/` covering your parser against sample statement data.

## Adding Merchant and Category Rules

Enrichment rules (merchant normalization and category assignment) live in the SQLite database, not in YAML files. The preferred way to add or edit them is the dashboard's `/rules` page.

Default seed rules ship in `data/rules/merchants.base.yaml` and `data/rules/categories.base.yaml`. These are read once at database initialization and inserted with `source='base'`; edit them to contribute new defaults.

After editing rules, re-run enrichment:

```bash
ledgerlift enrich --force
```

## Running Tests

### Python

```bash
pytest tests/ -q
```

### Dashboard

```bash
cd apps/dashboard
npm test
```

## Submitting a Pull Request

1. Fork the repository and create a feature branch from `main`.
2. Make your changes.
3. Run the full test suite (both Python and dashboard) and confirm everything passes.
4. Commit with a clear, descriptive message.
5. Open a pull request against `main` with a summary of what changed and why.

## Code Style

- **Python**: 3.12+, pydantic v2 for models, click for CLI commands.
- **TypeScript**: strict mode, Next.js app router with server components by default.
- **SQL**: query-builder functions in `apps/dashboard/src/server/data/queries.ts`, executed via `repository.ts`.
- **Filters**: parsed from URL search params and applied consistently across all queries.

Keep changes focused. One concern per PR.
