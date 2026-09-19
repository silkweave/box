# Working on a Box

Read the repository's AGENTS.md and the relevant feature documentation before editing. Work in the
checkout that owns the source. A feature integration updates source, registration, imports and
configuration together; it does not generate a separate dependency manifest.

State the intended scope and actual source revision in INTEGRATION.md. Keep durable configuration
choices and limitations in GOTCHAS.md and source ancestry in UPSTREAM.md. Do not invent completed
commits or test results.

Run focused checks during development and the full `pnpm verify` chain before completion. Test
changed routes through Chrome DevTools MCP using a separate checkout with background work disabled.
Review the final diff for unrelated changes, credentials and accidental instance data.

Use additional agents only when the user or repository instructions authorize delegation. Assign
bounded ownership, review their changes, and validate the integrated result. A sub-agent's summary
is not a substitute for checking its implementation and actual test results.
