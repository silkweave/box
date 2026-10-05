# artifacts gotchas

The feature id (`artifacts`, the same as the recipe id) is part of runtime registration, the
`/artifacts/` path mount and migration identity. Keep it stable. Existing migrations are byte-exact
source. The recipe's reference implementation is adapted by the receiving agent, so build and type
errors are expected integration work. Record local exceptions in the Box's docs/GOTCHAS.md.

## Recipe-specific operational details

- **Pages are trusted and same-origin.** A page runs with the viewer's Box session: its scripts can
  call `/trpc` and `/mcp` as that person, read `localStorage` and IndexedDB of the Box and of every
  other page, and set cookies. That is a deliberate trade for the full browser platform. The real
  exposure is third-party script: a compromised CDN a page loads runs as the viewer. Keep public
  copies (a different origin) for anything that should not have that reach, and do not adapt this
  recipe into a Box whose members should not trust each other's pages.
- **Browser storage is shared.** Pages must namespace `localStorage` keys, IndexedDB names and
  cookies (`path=/artifacts/<slug>/`). A page calling `localStorage.clear()` clears the Box's own
  keys too. The publish skill says so; review pages that ignore it.
- **`/artifacts/<slug>/` is not a client route.** Link to it with a plain `<a href>` (new tab), never a
  TanStack `Link`: the router would render a 404 inside the SPA. The SPA owns only the bare
  `/artifacts`.
- **The mount is authenticated in `main.ts`, not by the Nest guard.** A signed-out browser gets a
  302 to `/?next=<path>`; the SPA follows it after sign-in (`apps/web/src/lib/returnPath.ts`). A
  bearer token works too (rate limited like the API).
- **Headers.** Mounted responses replace the strict CSP with `setTrustedContentHeaders`. Under the
  Builder supervisor the app's CSP must be overwritten, not removed, or the supervisor's strict one
  stays.
- **The runtime shim is a `String.raw` template.** No backtick and no dollar-brace anywhere in it,
  comments included.
- **The toolbar is built by `Bun.build` on first request** and cached in memory (rebuilt on source
  change under `--dev`). A build failure serves a 503 script and the page carries on without a
  toolbar; check the server log.
- **Backups.** `box db backup` covers the warehouse only. Back up `data/artifacts/` and
  `data/artifacts.db` with it; restore all three together.
- **The public copy is a different tree.** It is rebuilt from the live tree at `/<slug>/` with
  `/rt/runtime.js`. A public page whose JavaScript hard-codes `/artifacts/` breaks there; use
  `artifact.base`.
- **Import re-stamps Mini pages.** Pages from the standalone host had `/<slug>/` and `/rt/runtime.js`
  baked in; the import moves both. A page without a `window.__ARTIFACT__` block is copied as-is and
  needs a republish.
- **`dir` publishing is admin-only** because it reads any directory the Box process can read.
