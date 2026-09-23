# sink gotchas

Sink files live in the Box data directory and survive feature removal. Preserve the team's archive and ingestion command customizations.

The feature id (`sink`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- The editor chunk is lazy on purpose. Import `SinkBodyEditorLazy`, never `SinkBodyEditor`, or the
  queue view pulls TipTap in with it.
- Filenames are validated (`^[a-z0-9][a-z0-9._-]*\.md$`) and every path is re-checked to stay under
  `docs/sink/`. If you add an operation, route it through `state.ts`'s helpers rather than building
  a path yourself - that guard is the feature's only security surface.
- `index.tsx` sits on the web feature-registry import cycle. Never read a registry binding at module
  scope there, and load the app in a browser after touching it (`AGENTS.md`).
