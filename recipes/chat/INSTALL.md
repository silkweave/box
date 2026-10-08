# Adapt the chat recipe

This is the adaptation guide for the chat recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's docs/UPSTREAM.md, and its current
_docs/INTEGRATION.md before changing files. These recipe documents ship with core, so a Box has them
at `recipes/chat/`. The reference implementation does not: it lives in the Stack at
`features/chat/`. In a Box, run `box stack fetch --ref <recorded Stack SHA>` and read
`<fetched stack>/features/chat/`, so the documents and the code come from the same Stack revision.

## Prerequisites

- Existing Box backup and a recorded restore path for both data and matching application source.
- Core, plus every recipe this one builds on already adapted and registered in the target Box. Builds on: **none, core only**.
- Feature-specific package imports include: `better-sqlite3` and `@types/better-sqlite3` (core), `@workerdeck/client` and `@workerdeck/protocol` (server), and `@tiptap/core`, `@tiptap/extensions`, `@tiptap/markdown`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `react-markdown`, and `remark-gfm` (web). Install latest into the root workspace package; record any necessary compatibility pin and its reason in the Box gotchas. Also declare shared framework/UI packages imported directly by this feature: dependencies declared only under apps/server or apps/web do not resolve from the shared feature tree.
- A recorded source SHA in docs/UPSTREAM.md, and an integration entry with scope, target SHA,
  intended changes, and state in _docs/INTEGRATION.md.
- A disposable instance for build, typecheck, tests, schema checks, and boot verification.

## Integration

Before copying unrelated feature code, inspect migrations and complete their staged backup,
application and boot-compatibility check below. Stage only the runner, registration, imports and
dependencies needed to run them. On resume, compare the running record with actual files and
ledgers before replaying an operation.

1. Copy/adapt the reference implementation from `<fetched stack>/features/chat/` into the Box's
   features/chat/{core,server,web}. Keep existing runtime
   contracts, registrations, dependency order, and package manifests. Register the result as the
   `chat` feature. Do not create a feature package, a symlink, or a release catalogue entry.
2. Declare imported third-party packages in root workspace manifests when the consolidated layout
   requires it. Resolve imports and production output from source; fix integration errors in the
   target Box as part of the adaptation.
3. Preserve local customizations and write durable findings to the Box's docs/GOTCHAS.md. Record
   path mappings and skipped changes; update _docs/INTEGRATION.md as each step completes. Advance
   the completed upstream SHA in docs/UPSTREAM.md only after the full validation and boot pass.
4. Chat has a private SQLite migration ledger keyed by migration object name, with no checksum. Preserve every shipped name, body, order, and runner.
5. For migrations, stage the runner, registration, and minimum code first. Test against a restored
   backup in isolation, confirm completion and boot compatibility, then continue with unrelated
   changes. Never edit or rename an applied migration.

## The agent's Box MCP server

The chat agent reaches the Box through its own MCP surface, as the agent principal.

- **Claude profile:** nothing to configure. The session carries the `box` server, its auto-approval
  and the floor (SPEC.md "The agent's Box MCP server"). Leave any other MCP servers the agent should
  have (a wiki, WhatsApp reads) in the profile's own `.claude.json`, and their allow rules in its
  `settings.json`. A `box` entry there is replaced for chat sessions; drop it rather than keep a
  second copy of the agent's token.
- **Codex profile:** Codex takes no per-session MCP servers, so the profile's `config.toml` declares
  it, with the same floor as `CHAT_AGENT_BOX_MCP_FLOOR`:
  ```toml
  [mcp_servers.box]
  url = "http://127.0.0.1:<server.port>/mcp"
  bearer_token_env_var = "BOX_MCP_TOKEN"
  # Unattended: without this every Box call asks a question nobody can answer and the turn stalls.
  default_tools_approval_mode = "approve"
  disabled_tools = ["ServiceRestart", "UserDelete", "UserSetRole", "UserAccessRevoke"]
  ```
  The token comes from the profile's `mcpTokensPath` env file (`BOX_MCP_TOKEN=<token>`, mode 0600)
  in the `workerdeck` section of `box.json`. The owner writes it with the agent's token from
  `box auth token <agent id> --quiet`; never print it into a transcript. `mcpTokensPath` applies to
  Claude profiles too: their `.claude.json` headers may use `${VAR}` instead of a copied token.

## Validation

Run the target Box's normal build, typecheck, tests, lint, and schema:check commands, then boot a
disposable instance and exercise this feature's documented surface. With the agent armed, mention
it with a question only a Box tool answers (for example "which triggers are enabled?"): the answer
should come from an `mcp__box__*` call, with no approval card and no shell command. Record actual commands and
results. Do not describe a migration, latest-dependency check, or consumer rehearsal as complete
until it has actually run.
