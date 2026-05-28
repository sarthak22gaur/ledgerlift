---
name: pipeline-patterns
description: Conventions for the ledgerlift Python ETL pipeline — enrichment ordering, transfer matching, net filtering, and reconciliation rules. Use before modifying parsing, enrichment, normalization, or reconciliation code.
---

# Pipeline Patterns

Conventions specific to the `src/ledgerlift/` Python pipeline. For repo-wide orientation see `ledgerlift-ground-truth`.

## Enrichment Order (do not reorder without cause)

`enrich/engine.py` `RuleEngine` applies, in sequence:
manual overrides → merchant rules → category rules → source category map → type fallback → default "Uncategorized" → fuzzy merchant match → heuristic merchant fallback → transfer/payment detection.

Earlier stages win; a later stage only fills what's still unset. Fuzzy matching uses rapidfuzz `token_set_ratio` over `clean_for_matching()` output (`enrich/text_cleaning.py`).

## Transfer Matching & Net Filtering

- `match_transfer_pairs()` (`enrich/transfers.py`): groups by `abs(amount)`, matches opposite-direction txns across accounts within a 3-day tolerance; sets `transfer_pair_id` + `transfer_match_confidence` (1.0 same day, 0.9 one-day, 0.8 two–three day).
- `filter_net_transactions()`: CC payments → exclude **both** sides; other transfers → keep the **debit** side only.

## Reconciliation (`reconciliation.py`)

- Checking: `begin + credits − debits = ending`
- Credit cards: `begin + debits − credits = ending`
- Tolerance `0.02`. Integrated into `validation.py`.

## Models

`models.py` holds the canonical types: `CanonicalTransaction`, `ParsedStatement`, `StatementMetadata`. A new transaction field must be added in lockstep across the pydantic model, `schema.sql` (the `transactions` table), and the dashboard `types.ts`.

## Storage (SQLite, single source of truth)

The pipeline reads and writes SQLite directly — there is no DuckDB warehouse, no Postgres, no separate sync/manifest step. `store.py` owns the connection, schema init/migration, and vault import/export; DDL lives in `schema.sql` (schema version 3, tracked in `schema_versions`). DB path resolves via `store.py:resolve_db_path` (explicit arg → `$LEDGERLIFT_DB` → `$LEDGERLIFT_VAULT/ledgerlift.sqlite` → `data/state/ledgerlift.sqlite`). Bump the version in both `store.py` and the dashboard `db.ts` when DDL changes. SQLite has no boolean type — flags are `INTEGER` 0/1, confidences `REAL`.

## Conventions

- pydantic v2 throughout; click commands defined in `cli.py` (`@cli.command()`); rule moves via the `rules` group (`import`, `export-yaml`).
- Parsers are institution-specific under `parsers/` — add a new module per institution, register it via `config.py` `SUPPORTED_SOURCES`.
- Pipeline stages run on a live connection: `run` = scan → parse → enrich → transfers → export; `e2e` prepends intake. `e2e --force` truncates derived state first.
- Run the suite with `pytest tests/ -q` before declaring pipeline work done.
