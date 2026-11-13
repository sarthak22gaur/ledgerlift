# LedgerLift agents

This is the source of truth for role prompts, rules, and skills. AgentSync 0.4.1 generates Codex, Claude Code, and OpenCode configuration and the shared skill directory.

- `roles/` holds one prompt per agent and native overrides for tool access, reasoning effort, and display.
- `rules/` and `skills/` hold shared instructions. `AGENTS.md` is the workspace guide template.
- `claude/` and `codex/configs/` hold client-specific configuration.

Run `bash agents/scripts/sync_agents.sh` from the repo root after checkout or after editing the sources. The generated client directories and root `AGENTS.md` are local. Commit the source changes when authorized. The tracked root `CLAUDE.md` is the checkout entry point.

## Model selection

Run from the repo root with the client and account that provide the target model.

```sh
codex --model gpt-6.1-sol
claude --model claude-opus-5-5
```

In an existing session, select the matching model in the client's model picker. Subagents inherit that selection. Codex uses high effort for the architect, reviewer, and engineer, and medium for the librarian. Claude uses medium for each role as the Opus 5.5 baseline. Change the launch model for a session without changing the shared prompts.

The roles use explicit scope, code evidence, and observable completion criteria. Verify the behavior touched by a task and expand checks when a shared contract or failure requires it.

- [OpenAI GPT-6.1 Sol guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.1-sol)
- [Claude Opus 5.5 prompting guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)
- [AgentSync 0.4.1 source](https://github.com/sarthak22gaur/agentsync/commit/83b5ab07140b9fe26a2d7dc05fb714625bead4a4)
