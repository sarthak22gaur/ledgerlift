# LedgerLift

LedgerLift parses personal financial statements into a canonical SQLite ledger and serves a Next.js dashboard over that ledger. Python CLI entry point is `src/ledgerlift/cli.py`. The dashboard lives in `apps/dashboard/`.

For architecture, commands, and data invariants, use the canonical skills under `agents/skills/`. Run `bash agents/scripts/sync_agents.sh` after checkout or after editing `agents/` to generate the Claude Code rules, roles, and skills. Project workflow and setup live in `agents/AGENTS.md` and `agents/README.md`.
