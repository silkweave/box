# content gotchas

Voice files and channel profiles are team customizations. Preserve them while adapting source, and add migrations for schema changes after rows exist.

The feature id (`content`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **`approved` arms nothing.** The only armed state is `scheduled`, which always carries an explicit
  `scheduled_at` (`isPublishDue`). This is a scar: a status dropdown once made picking "Approved"
  post publicly within five minutes. Do not add a publisher that fires on `approved`.
- **Move a piece with `content-transition`, not `content-set-status`.** `availableTransitions()` is
  the single source of truth and ships with each row, so the UI renders buttons instead of
  re-deriving the machine. `upsertContent` still enforces `allowedContentTransitions`; the `force`
  escape hatch exists in `ContentInput` and is deliberately not exposed over tRPC/MCP.
- **Verify findings are positional.** A re-verify replaces the array and every tick resets with it.
  That is intended - findings regenerated against an edited draft are new findings.
- **`@Mcp()` inputs must be scalars or arrays with a concrete JSON-schema type**, so lists travel
  comma-separated (`target_channels`, `signal_ids`, `tags`, `requires`) and `metadata` / `findings`
  travel as a JSON string. Both controllers carry a note where this bites.
- **`metadata` deep-merges** on `content-upsert`. Passing only `{"flair": "x"}` keeps `subreddit`
  and `assets`; a key whose value is `null` is deleted.
- **The publishers really send.** `linkedin-publish`, `linkedin-article-publish` and
  `substack-publish` demand `confirm:"true"`; the two scheduled ones dry-run unless
  `features.content.linkedinPublishLive` or `features.content.substackPublishLive` is `true`. The article path drives the author's own browser over CDP - it needs
  a real logged-in profile, not a headless one.
- **A topic auto-closes.** Publishing the last outstanding piece moves a `planned`/`active` topic to
  `done`; a `blocked` or `dropped` topic is a human decision and a publish does not overrule it.
- `index.tsx` sits on the web feature-registry import cycle. Never read a registry binding at module
  scope there, and load the app in a browser after touching it (`AGENTS.md`) - `box verify` has no
  runtime step.
- After changing either controller, boot once (or run `bun run typegen`) so `appRouter.d.ts` is
  regenerated, or the web typecheck is stale.
- Dev is Nest **:8190** / Vite **:5190**. Never point a Box or a skill at a port a *different* Box
  may hold: two Boxes a default apart either collide loudly or sit beside each other on different
  address families and get mistaken for one another (`apps/server/src/agent/loopback-guard.ts`).
  A second Box gets its own `server.port` / `server.vitePort`.
