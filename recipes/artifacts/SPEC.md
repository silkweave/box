# `artifacts` - static pages and web apps, served by the Box

An **artifact** is a static tree (one HTML document, or a built app with assets) published under a
**slug** and served at `/artifacts/<slug>/` on the Box's own origin. The slug is the artifact's
name, its URL and its identity. Pages are trusted: they run unsandboxed with the viewer's Box session
and the full browser platform (IndexedDB, cookies, service workers, WebGL, WASM, CDNs). The only
server behaviour is a fixed runtime API: per-artifact JSON state (`kv`), pinned comments
(annotations) and a file download helper. No artifact code ever runs on the server.

- **dependsOn**: nothing but core. It uses core's path-mount port (`registerPathMount`,
  `packages/core/src/path-mounts.ts`) to serve `/artifacts/<slug>/`, the user-cleanup port, the
  events spine (`recordEvent`) and the run funnel (one action).
- **Depended on by**: nothing.
- **Removal**: unregister it and remove `features/artifacts/`. Its tables, `data/artifacts.db` and
  `data/artifacts/` stay on disk until deleted by hand. Public copies stay on Cloudflare until purged
  (revoke them first).

## Tables

Warehouse (DuckDB), all created by the baseline:

| Table | Key | What |
|---|---|---|
| `artifacts` | `slug` | The catalogue: title, description, lucide `icon`, `entry`, `spa`, `owner` (a Box user id, never null), `tags` (json), `kind`, `source`, `folder`, size, file count, `published_at`, and the public-copy state (`is_public`, `password_hash`, `expires_at`, `revoked_at`, `public_synced_at`, `public_sync_error`). Audited. |
| `artifact_folders` | `id` | Flat drawers: `id` derived from the first name and frozen, `name`, `icon`. |
| `artifact_annotations` | `artifact, id` | One row per pinned thread. `data` is the pindrop `Comment` JSON the in-page toolbar reads and writes; `author` is the opener's Box user id. |

Feature-private SQLite, `data/artifacts.db` (WAL; schema ledger `PRAGMA user_version`):

| Table | Key | What |
|---|---|---|
| `kv` | `artifact, key` | A page's own persisted JSON (`artifact.kv`), at most 1 MB per value. |
| `views` | `artifact` | View count and last-viewed stamp, bumped on every entry-document load. |

These live outside the warehouse because pages write them at interactive rates; a warehouse write
is a serialized DuckDB connection plus a change event to every open dashboard.

## Files on disk

`data/artifacts/<slug>/` is the live tree. A publish stages in `data/artifacts/.staging-*`, moves the
old tree to `<slug>.old`, renames the new one in and deletes the old: a reader never sees half a
tree. Uploaded archives may be gzipped or not; a single top-level directory is hoisted; `__MACOSX`,
`.DS_Store`, `._*`, symlinks and hard links are dropped. Optional `manifest.json` fields: `slug`,
`title`, `description`, `icon`, `entry`, `spa`, `owner` (or `author`), `tags`, `kind`, `source`,
`folder`. Precedence: explicit argument, then manifest, then what the HTML declares.

The entry document is rewritten at publish: root-relative `src`, `href`, `poster`, `data-src`,
`action`, `srcset` and CSS `url(/...)` move under `/artifacts/<slug>/`, and the head gets
`<meta charset>`, `<base href="/artifacts/<slug>/">`, a title and description when missing, the
lucide icon as an inlined favicon, `window.__ARTIFACT__` and the runtime script.

## Serving

Core's path mount routes every `/artifacts/<slug>/...` request to the feature ahead of the SPA, in
dev and production, after authenticating it (Box session cookie or bearer token; a browser without a
session is sent to sign in and returned). The bare `/artifacts` stays the SPA gallery route. Mounted
responses get the trusted-content headers instead of the strict global CSP: any source, inline code,
eval, framing by the same origin.

| Path | Serves |
|---|---|
| `/artifacts/_rt/runtime.js` | The runtime shim (`core/runtime.ts`). |
| `/artifacts/_rt/toolbar.js` | The in-page toolbar (`features/artifacts/toolbar/`), built by Bun on first request and cached. |
| `/artifacts/_rt/icon/<name>.svg` | A lucide icon with an explicit stroke for light and dark. |
| `/artifacts/<slug>` | 302 to `/artifacts/<slug>/`. |
| `/artifacts/<slug>/<path>` | A file from the tree; a directory's `index.html`; for an `spa` artifact, the entry document for unknown extension-less paths. |

Everything is `Cache-Control: no-cache`. Only `GET` and `HEAD`.

## Runtime API (in the page)

`window.artifact`: `slug`, `base`, `meta`, `capabilities {kv, save, toolbar}`, `kv.get/set/delete/all`
(REST under `/api/artifacts/rt/<slug>/kv`, session plus `x-box-csrf`), `save(filename, data)`.
Capabilities come from where a copy is served: the Box has all three, a public copy only `save`.
The toolbar (home, share, copy link, place comment, show pins, comment sidebar) mounts in a shadow
root and reads `GET /api/artifacts/rt/me` and `/api/artifacts/rt/<slug>/annotations`; it writes
annotations as diff patches (`POST`, `{upsert, delete}`) and polls every 20 seconds.

## Procedures and tools

Every row is REST `POST /api/artifacts/<path>`, tRPC `artifacts<Method>`, an MCP tool (listed to MCP
clients in PascalCase, `ArtifactPublish`) and a CLI verb (`box artifact-publish`). Names match the standalone host's. Domain refusals are 400s with the
reason; a missing slug is a 404.

| MCP tool | What |
|---|---|
| `artifact-list` | Filtered gallery: `folder` (`none` = unfiled), `tag`/`tags` (all must match), `kind`, `owner`, `isPublic`, `q`, `limit` (200, max 1000). Also returns the tag census, kinds, folders with counts, `unfiled`, and whether sharing is configured. |
| `artifact-info` | One artifact, with `url` and `publicUrl`. Never the password hash. |
| `artifact-get` | One file's text (the entry document by default). |
| `artifact-slug-available` | `{available, reason}`. |
| `artifact-icons` | Search lucide names: exact, then prefix, then substring. |
| `artifact-team` | Box users an artifact can belong to, and the default owner. |
| `artifact-publish` | Exactly one of `html`, `tarball` (base64), `dir` (admin only). `slug` required; a taken slug is an error without `replace`. A named icon must be real, a named folder must exist. A new page's owner is `owner` or the caller; a republish keeps the owner and keeps omitted filing fields. A public page's copy is re-synced. |
| `artifact-update` | Title, description, icon, tags (replace), kind, source, folder (`''` = root), owner (`''` = system principal). The only way to change an owner. |
| `artifact-rename` | New slug: entry document, tree, row, annotations, kv and views move; the public copy moves. No redirect. |
| `artifact-delete` | Purges the public copy, then the tree, row, annotations, kv and views. |
| `artifact-folders`, `artifact-folder-save`, `artifact-folder-delete` | List with counts; create (from `name`) or rename/re-icon (`folder`); delete and unfile. |
| `artifact-set-public` | `isPublic` with optional `password` and `expiresAt` in the same write. Private purges the copy. |
| `artifact-set-password`, `artifact-set-expiration` | Set or `clear`; re-syncs a public copy. |
| `artifact-revoke` | Alias for making it private. |
| `artifact-sharing-status` | Admin. Whether public sharing is set up and working: `configured`, `ok`, the `missing` keys with their files, and live `checks` (`worker`: reachable, token accepted, storage bound; `public-host`: the public address serves the Worker; `separate-origin`; `https`). Never returns the token. |
| `artifact-annotations`, `artifact-annotate`, `artifact-annotation-reply`, `artifact-annotation-resolve`, `artifact-annotation-delete` | Threads. The author is always the caller; `source` is `agent` for bearer callers, `human` for sessions. |
| `artifact-kv-list`, `artifact-kv-set` | A page's state; `value` is a JSON string, omitted deletes. |
| `artifact-import` | Admin. Import from a standalone host's data dir (`from`), with a roster map (`users`, `luna=nova,toby=toby`), `dryRun`, `replace`. |

tRPC also has `artifactsGallery` (query, everything, for the dashboard). REST only:
`POST /api/artifacts/rt/upload` (multipart `file` plus publish fields; `tags` comma-separated) for
trees too large for an MCP argument, capped by `features.artifacts.maxUploadMb`.

## Events

`artifact.annotated` and `artifact.replied`, recorded with `subject` = slug, `actor` = author and
fields `slug`, `title`, `owner`, `author`, `thread`, `thread_author`, `text` (280 chars), `url`. Route
them with a deliver trigger; artifacts does not depend on notifications.

## Actions

`artifacts-expire` withdraws public copies whose expiry has passed (the Worker already refuses them;
this removes the bytes and corrects the Box's state). Schedulable.

## Public copies

The Public sharing powerup (`recipes/artifacts/powerups/public-sharing/`). The Worker in
`features/artifacts/cloudflare/` serves public copies from R2; the Box only calls outward
(`POST <workerUrl>/_sync/<slug>` with a gzipped tree and an `x-artifact-meta` header holding the
password hash, expiry, entry and SPA flag; `/_sync/<slug>/purge`; `/_sync/health` for the status
check, protocol 1). The copy is the live
tree moved to `/<slug>/` with `/rt/runtime.js` and public capabilities. Missing, revoked and expired
all answer 410; a password opens a 12-hour signed cookie. Every sync outcome is stamped on the row.

Without the powerup, making an artifact public refuses with a message naming the powerup. The Share
dialog says sharing is not set up; administrators get "Set up public sharing", which drafts the
powerup's Builder brief, and members are told to ask an administrator. A copy made before sharing
was removed can still be made private.

## Why the shapes are what they are

- **The slug is required and a taken slug refuses.** There is no history, so a silent overwrite is
  permanent, and the caller is usually an agent inventing plausible names.
- **Same origin, unsandboxed.** Teams use artifacts for real web-app prototypes, which need the full
  platform. The cost is accepted trust: a page runs with the viewer's session. See GOTCHAS.md.
- **Owners are Box users, authors are callers.** Nothing on the wire can attribute words or pages to
  someone else; a publish can fill an owner in, never replace one.
- **kv beside the warehouse.** Interactive writes do not belong on the warehouse's single writer.
- **Annotations are rows, not kv.** A page can clobber its own kv; review feedback must survive it.

## UI

`/artifacts` is the gallery: folder bar (Root and one chip per folder), All/Public scope, kind,
owner (with Mine), tags (AND), free text; rows with icon, title, badges, description, meta line,
tags and owner; details, share and remove dialogs; folder dialog. Pages open in a new tab at their
own URL with the toolbar.

## Mobile module

`features/artifacts/mobile` (`box_artifacts`): an Artifacts tab (order 30) with the gallery, folder
chips, kind and tag filters, search and a details sheet, and a full-screen WebView viewer at
`artifacts/view/<slug>`. The WebView gets its own `box_session` cookie by posting the app's token to
`POST /api/auth/login` from a bootstrap page on the Box origin, then loads `/artifacts/<slug>/`. It
reads `GET /api/artifacts/gallery` and `POST /api/artifacts/info`, and reloads on `table:artifacts`.

## Settings

`features.artifacts` in `box.json`: `maxUploadMb` (64) and `public.workerUrl`,
`public.publicBaseUrl`; `public.syncToken` in `box.local.json`. Sharing is off until all three are
set; they are read on each request, so no restart is needed.

## Admin-only

`dir` publishing (reads the Box machine's filesystem), `artifact-import` and `artifact-sharing-status` (it calls out to the configured hosts).

## What a team customises

The `kind` vocabulary (`core/rules.ts`), reserved slugs, the toolbar's controls, upload limits, the
public Worker's domain, and deliver triggers for comment events.
