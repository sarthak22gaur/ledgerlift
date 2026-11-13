# Working in LedgerLift

Load `ledgerlift-ground-truth` for architecture and commands. Load `pipeline-patterns` for ETL changes and `dashboard-patterns` for dashboard changes. Shared rules load from `.claude/rules/`.

Carry authorized work through verification. Use reversible assumptions for routine details and flag material decisions. Give progress updates when findings change the work. When delegating, provide the role with its scope, evidence, and expected final output. Collect the result before reporting completion.

Keep real statements, transactions, vault YAMLs, and credentials out of prompts and artifacts. Use synthetic fixtures and temporary databases for repros. If this checkout uses an approved `.envrc`, use `direnv exec . <command>` when the project environment is needed.

Edit prompts, roles, and skills under `agents/`, then run `bash agents/scripts/sync_agents.sh`.
