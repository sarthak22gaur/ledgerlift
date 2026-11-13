# Plan: Detect incomplete statement parsing and repair affected imports

Status: implemented, independently reviewed, verified, and applied to the live ledger.

## Goal

Recover the 64 confirmed missed transactions, accept the legitimate empty Green Dot statement, and prevent future format changes from silently producing successful but incomplete imports. Validate replacements before committing them, reprocess statements when their parser changes, and preserve existing transactions and overrides when a repair fails.

Confirmed diagnostic acceptance counts: Chase April–November recovers 45 transactions; Wealthfront Cash August–October recovers 19; all 11 statements reconcile to $0.00 afterward. No private statement contents, real transaction rows, vault YAML contents, or credentials belong in this document or regression fixtures.

## Non-Goals

- OCR, new institutions, parser framework rewrite, dashboard redesign.
- Changes to transfer matching or enrichment order.
- Database schema migration or global transaction ID algorithm change.
- Blanket `e2e --force`: it resets derived state before parsing (`src/ledgerlift/cli.py:892`).
- Agent infrastructure changes or modification of unrelated existing work.

## Approach

- Tolerate demonstrated layout variations while checking whether each relevant transaction row was accounted for.
- Separate blocking extraction errors from advisory warnings. Current validation returns warning strings (`src/ledgerlift/validation.py:13`), and the pipeline persists results afterward (`src/ledgerlift/pipeline.py:246`).
- Use existing statement parser metadata and source-file error/status fields; no schema migration is needed for version selection and failed-attempt reporting (`src/ledgerlift/schema.sql:15`, `src/ledgerlift/schema.sql:38`).
- Treat a file replacement as one atomic operation. Store helpers currently commit independently, and statement upsert uses `INSERT OR REPLACE` (`src/ledgerlift/store.py:928`); statement children have cascade-delete foreign keys (`src/ledgerlift/schema.sql:45`, `src/ledgerlift/schema.sql:60`).

## Phases

### 1. Fix the demonstrated parser variations

- Chase: accept optional whitespace in both start/end markers; retain existing recovery of digits embedded in malformed end markers. Current start matching requires a space, and end handling repeats its own space-sensitive expression (`src/ledgerlift/parsers/chase_checking_pdf.py:63`, `src/ledgerlift/parsers/chase_checking_pdf.py:285`).
- Wealthfront Cash: parse the old layout and new optional Initiator column; preserve useful initiator information in descriptions. Handle the demonstrated wrapped method continuation and narrowly recognized footnote suffixes. Continue excluding Program Bank movement (`src/ledgerlift/parsers/wealthfront_cash_pdf.py:63`, `src/ledgerlift/parsers/wealthfront_cash_pdf.py:201`).
- Increment changed parser versions.

### 2. Make incomplete extraction fail visibly

- Add an internal validation result with errors and warnings, preserving the existing warnings API where useful.
- For Chase checking and Wealthfront Cash, track unmatched date/amount candidates inside relevant activity sections, with section and source-line context. Do not scan all dates globally: statement daily balances and Program Bank tables must stay excluded.
- Block persistence on unmatched activity rows, unexplained zero extraction, normalization dropping a parsed row, or failed applicable balance reconciliation. Normalization currently skips invalid rows and returns the remainder (`src/ledgerlift/normalize.py:103`).
- For these updated parsers, require expected activity section structure and statement period; unknown layout must yield an actionable failure rather than a guessed empty result.
- Explicit empty evidence must be scoped to the transaction section and checked against nonzero activity/balance evidence. Green Dot's valid empty case should not receive a generic empty warning; it currently does (`src/ledgerlift/parsers/wealthfront_greendot_pdf.py:108`).
- Preserve intentional reconciliation exclusions for Green Dot and mixed SoFi statements (`src/ledgerlift/reconciliation.py:18`). Do not infer Green Dot completeness from its balance alone.
- Summarize failed files and advisory warnings in `parse`, `run`, and `e2e`. On blocking failures, return nonzero and leave existing exports unchanged; replace the unconditional successful `Done` path (`src/ledgerlift/cli.py:913`, `src/ledgerlift/cli.py:936`).

### 3. Reprocess safely after parser updates

- Share one eligibility check between `parse_file` and `parse_all`: parse new/failed files, explicitly forced files, and files whose stored parser name/version differs. Both current skip checks inspect only `parse_status` (`src/ledgerlift/pipeline.py:224`, `src/ledgerlift/pipeline.py:320`).
- Parse, validate, and normalize entirely before replacing saved rows.
- Add one narrowly scoped store replacement operation: update statement using `ON CONFLICT DO UPDATE`; delete/reinsert raw rows even when the new list is empty; replace canonical rows; mark parsing complete and enrichment pending; commit once. Existing empty raw insertion returns before cleanup (`src/ledgerlift/store.py:945`).
- On parser/validation/storage failure, roll back replacement, retain prior statement/raw/canonical data, record failure reason in existing source-file status, and leave the old successful parser version unchanged.
- Preserve existing IDs for confidently matched unchanged transactions within the same source file using account/date/direction/amount/normalized-description and duplicate occurrence counts. Existing IDs include sequence and description, so inserting earlier rows changes regenerated IDs (`src/ledgerlift/normalize.py:67`).
- Retain override tables. If an override references an old transaction that cannot be matched unambiguously, fail that file with review details; never silently remap an override to an uncertain transaction. Existing override tables support transaction ID references (`src/ledgerlift/schema.sql:142`).

### 4. Regression tests and controlled repair

- Add sanitized extracted-text fixtures covering old/new formats, marker corruption, wrapped descriptions, nonempty unknown formats, valid emptiness, balanced-but-missed offsetting rows, and Program Bank exclusion.
- Add pipeline/store tests for stale-version selection, atomic rollback, failed repair preserving prior data, zero-row replacement cleanup, normalization loss detection, override/ID preservation, CLI failure summaries, and idempotence.
- Create a consistent SQLite backup using SQLite's backup API, plus copies of vault YAMLs and exports, before modifying the user ledger.
- First run the full changed-parser corpus against a temporary database copy. Inspect any historical failures before touching the live ledger.
- Apply verified reprocessing to the live ledger, enrich changed files, recompute transfer pairs, regenerate exports, and rerun unchanged to confirm no additional work or duplicates.

## Risks

- False positive completeness checks: restrict row detection to recognized transaction sections and prove behavior with valid-empty and nontransaction-table fixtures.
- Override identity shifts: refuse ambiguous mappings instead of guessing; retain the existing global ID generation contract.
- Historical layout variants: changed parser versions revisit older statements. Use a temporary database rehearsal before live repair.
- Downstream totals: recovered transactions change transfer matching, categorization totals, and exports; verify these separately from raw recovery.

Rollback: restore the SQLite backup through a controlled SQLite restore with all readers/writers stopped, then restore paired YAML/export copies. Never copy a live SQLite main file independently of its WAL.

## Verification

- All existing Python tests plus new regression/integration tests pass.
- Chase affected statements contain `3, 12, 6, 2, 7, 6, 6, 3` transactions and reconcile exactly.
- Wealthfront Cash August/September/October contain `8, 7, 9` transactions and reconcile exactly.
- November Green Dot imports successfully as an evidenced empty statement.
- Expected ledger count is 3,971 (`3,907 + 64`), assuming the historical corpus reveals no additional missed rows; report additional recovery separately.
- A second ordinary run leaves transaction IDs, raw counts, rules, override bindings, and exported transaction content unchanged.
- Unknown activity formats cause a nonzero command result and useful file-specific diagnostics while preserving previous saved data and exports.

## Execution checklist

The approved scope above is frozen. Routine implementation choices use the smaller sufficient interpretation. Findings outside scope are recorded separately unless the approved fix cannot work without them.

| Work | Scope and expected files | Non-goals | Checks | Status |
|---|---|---|---|---|
| Parser compatibility | `src/ledgerlift/parsers/chase_checking_pdf.py`, `wealthfront_cash_pdf.py`, `wealthfront_greendot_pdf.py`; focused synthetic parser tests | Other institutions, global text transformations | Old/new layout, corrupted markers, wrapped method, section exclusion, valid empty cases | Complete |
| Completeness and reporting | `src/ledgerlift/models.py`, `validation.py`, `reconciliation.py`, `pipeline.py`, `cli.py`; focused validation and CLI tests | Dashboard/schema changes, altered transfer/enrichment rules | Missed rows and normalization loss block replacement; warning/error distinction; nonzero CLI result; unchanged exports on failure | Complete |
| Safe version reprocessing and replacement | `src/ledgerlift/pipeline.py`, `store.py`; focused pipeline/store tests | Global ID redesign, speculative recovery framework | Stale versions reprocess; atomic rollback; empty raw cleanup; confident ID preservation; ambiguous overridden matches fail safely | Complete |
| Independent review and verification | Cumulative implementation diff against this approved scope | Unrelated cleanup or expanding scope from hypothetical findings | Reviewer findings require trigger, consequence, evidence, and test/reproduction; affected checks then full `python -m pytest tests/ -q` | Complete |
| Backed-up rehearsal and live repair | Temporary SQLite database copy, consistent local backup, existing ETL and export paths | Blanket forced rebuild, publication of private data | Confirm 64 known recovered transactions, all 11 exact reconciliations, historical corpus review, unchanged rules/overrides, second-run idempotence | Complete |

Use `direnv exec . <command>` from the repository root if the checkout's `.envrc` is approved and its environment is needed; otherwise use the local virtualenv. No commits or pushes are authorized by this plan.

## Verification results

- `direnv exec . python -m pytest tests/ -q`: 244 passed.
- Independent review: no findings meeting the defect bar; 41 focused tests passed.
- Scoped `git diff --check -- src tests`: passed.
- Temporary database rehearsal and live application each reprocessed 109 statements with zero failures or advisory warnings, recovering the expected 64 transactions for 3,971 total.
- All 11 affected statements reconcile exactly. November Green Dot is an evidenced empty statement.
- Second parse skipped all 220 files; second enrichment processed zero files. Canonical/raw records and export bytes remained unchanged.
- Rules, overrides, counterparties, and account mappings preserved; SQLite integrity and foreign-key checks passed.
- Consistent pre-repair backup with paired vault YAMLs and exports retained in ignored local runtime storage under `data/state/repair-backups/20261113T061842Z/`.
- No commits or pushes performed. Unrelated agent-infrastructure work preserved.
