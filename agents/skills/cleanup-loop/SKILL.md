---
name: cleanup-loop
description: Structured audit, fix, and verify cycle for code and UI cleanup. Scopes the work, audits it against concrete criteria, applies the user’s cleanup criteria, fixes the authorized items, and re-verifies until clean. Use when asked to clean up, tidy, or de-cruft a file, feature area, or branch diff.
argument-hint: "[scope: files, a feature area, or \"all changed files on this branch\"]"
---

# Cleanup Loop

A repeatable audit → triage → fix → verify cycle that runs until the reviewer reports CLEAN. Cleanup removes problems; it doesn't add features.

## Process

1. **Scope.** Take it from the argument, or ask: a set of files, a feature area, or a branch diff (`git diff --name-only <base>...HEAD`).
2. **Audit.** Delegate to the area's `code-reviewer` with the scope and the criteria below. It returns a numbered list, each item with `path:line`, the problem, and a suggested fix, grouped as **Critical** (must fix), **Improvement** (should fix), and **Nitpick**, plus a one-line count.
3. **Triage.** Apply the user’s stated cleanup criteria. When a finding requires a new scope or design decision, report it and continue the authorized items.
4. **Fix.** Delegate the approved items, by number with `path:line`, to the area's `engineer`. It fixes each one and runs the project's verification.
5. **Verify.** Send it back to the same reviewer to confirm each item is resolved and the fixes introduced nothing new. It returns **CLEAN** or a new numbered list.
6. **Loop.** CLEAN means done: report a summary. Otherwise return to triage and fix each confirmed in-scope issue. After 3 rounds, hand the remaining items to the user to decide.

## Rules

- Use separate engineer and reviewer roles when delegation is available. Otherwise do a separate review pass and report the limitation.
- Don't expand scope mid-loop. Issues outside the scope are noted separately as scope candidates.
- Commit only when explicitly authorized and verification passes.
- No "while we're here" features, and no comments, docstrings, or type annotations added to code the cleanup didn't touch.
- Do add a concise comment where the cleanup creates or touches non-obvious behavior: a cross-boundary contract, a concurrency or resource limit, a security constraint, an invariant the names don't show. Don't narrate obvious code.

## Audit criteria

**Dead code**: unused imports, variables, functions, components, props, and dependencies; commented-out code (not TODOs); unreachable branches; state that's set but never read.

**Structure**: logic leaking across layers (business rules in handlers, controllers, or UI components; queries outside the data layer); functions or components doing several jobs; implicit dependencies on global state; circular imports or import-time side effects; internal imports that bypass a module's public interface.

**Consistency**: mixed patterns for the same thing (response shapes, error handling); names that don't match behavior (a `get_` that mutates).

**Type safety and suppressions**: escape-hatch types (`any`, `Any`, casts) where a concrete type is knowable; missing types on public functions; lint or type suppressions without a reason.

**Duplication**: copy-pasted blocks that should share one function; the same transformation done differently in several places.

**Error handling**: swallowed errors, messages that lose context ("something went wrong"), and paths that crash where they should degrade.

**Naming**: abbreviations that hurt reading (beyond `id`, `url`, `db`), booleans not phrased as questions, names describing implementation rather than intent.

**Useless tests** (delete, don't fix): snapshot tests of serialization, create-then-read-back tests of the ORM, tests that mock everything and verify only the wiring, assertions on exact log or format strings, trivial constructor tests, duplicate coverage, tautologies, tests of framework behavior, and snapshots that cement current rather than intended behavior.

**UI** (where in scope): business logic in components, state duplicated from props, effects where derived state or a handler would do, unstable list keys, inconsistent spacing and typography for same-level elements, interactive elements without keyboard support or labels, color as the only signal.

**Project-specific**: Check parser registration, rule precedence, and shared schema contracts in the pipeline. Check SQL placement, URL filters, and cashflow versus spending attribution in the dashboard.
