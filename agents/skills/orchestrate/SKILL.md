---
name: orchestrate
description: Drive an approved LedgerLift plan through scoped implementation, independent review, and verification. Use when asked to execute a plan end-to-end.
argument-hint: "[path to the approved plan]"
---

# Orchestrate

Run in the main session. Load the approved plan and the relevant LedgerLift skills. Combine tightly coupled phases when one diff makes review clearer. Record each phase's goal, files, non-goals, verification, and status. Capture the baseline so review can distinguish the phase from existing work.

1. **Implement.** Delegate the phase to the `engineer` with its scope, relevant code, and success criteria. Use the session model and role effort. Keep work through verification inside the phase.
2. **Review.** Give the `code-reviewer` the phase diff, approved decisions, and non-goals. Ask it to return complete findings with a trigger, consequence, evidence, and proposed correction. Wait for its report.
3. **Resolve.** Check findings against the scope-discipline rule. Return confirmed in-scope defects to the engineer. Record adjacent issues separately and keep the approved work moving. Limit fix and review rounds to three per phase. At the cap, report confirmed open defects and preserve verified work.
4. **Verify.** Run the plan's checks. Record the commands and outcomes. Check the behavior and any unresolved conditions before moving to the next phase. Commit only when explicitly authorized.
5. **Review across phases when needed.** For a shared contract, migration, or other consequential boundary, review the cumulative diff once for interactions the phase reviews could miss. Give the reviewer the same decisions and non-goals. Verify any resulting fix.

If delegation is unavailable, implement and perform a separate review pass against the diff. State how review was done. Finish after the authorized phases meet their success criteria or a material blocker requires input. Report phase outcomes, verification, and open items.
