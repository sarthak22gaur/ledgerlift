# Verify With the CLI, Not the Editor (Hard Rule)

Editor and language-server diagnostics (inline type errors, lint highlights) are not a source of truth. They lag, miss project configuration, and produce false positives and false negatives. Run the relevant checks from the ground-truth skill. Start with the affected behavior, and broaden verification when a shared contract changes or a failure calls for it. Report commands, outcomes, and any gaps.

Make sure the command actually checks something:
- **TypeScript with project references.** If the root `tsconfig.json` has `"files": []` and a `references` list, plain `tsc --noEmit` checks zero files and always exits 0, which is a false green. Use `tsc -b` (or the project's build script, if it runs `tsc -b`).
- **Scoped commands.** A type-checker or test runner pointed at the wrong directory passes trivially. Run it from the package that owns the config.

If a tool reports "command not found", check whether the project's environment is loaded (for example direnv or Nix) before you conclude the tool is missing or install anything.
