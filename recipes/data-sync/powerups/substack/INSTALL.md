# Substack powerup: install

Adds the Substack pull and the Substack platform client to Data Sync. Read [POWERUP.md](POWERUP.md),
the recipe [GOTCHAS.md](../../GOTCHAS.md) and [docs/BROWSERS.md](../../../../docs/BROWSERS.md) first.
Do as much as possible yourself; stop only for the owner-only steps.

## Detect

`features/data-sync/core/substack/` exists and `core/platforms.ts` lists `substack`.
`box run-now --action_id substack-pull` then either pulls or names what is missing: `has no
publication` means the account entry is incomplete; `needs a session cookie and "<user>" has no
browser` means neither a cached cookie nor a browser identity is available; a sign-in or captcha
message means the owner's browser is not signed in. All are repair, not a new install.

## Requires

- The Data Sync recipe, adapted and validated.
- Core's browser lease configured (`browsers.url`, `browsers.identity`, `browsers.token`), with the
  publication owner's identity under `browsers.users.<users.id>`, and `box cdp-check` passing. See
  [docs/BROWSERS.md](../../../../docs/BROWSERS.md). Without a browser, the owner can paste a session
  cookie instead (owner-only step 2).
- `playwright-core` in the root workspace package.

## Owner decisions

1. **Publication**: its origin (`https://<name>.substack.com`, or the custom domain it answers on) and
   the Box user who owns it.
2. **Session source**: the owner's browser identity (recommended), or a cookie pasted by hand.
3. Whether to store the Substack email and password (and 2FA secret) so the Box can sign in again in
   that browser when the session ends. Without them a lapsed session waits for the owner.

## Owner-only steps

Ask for the one that applies, then wait:

1. **Sign in to Substack in the browser.** The owner takes over a tab of their own browser identity
   at the browser gateway, signs in to substack.com as the publication's owner, and closes the tab.
   The Box reads the cookie from that profile on the next pull.
2. **Or paste the cookie.** Signed in on substack.com, the owner copies the `substack.sid` cookie
   (DevTools > Application > Cookies) into `box.local.json` as `SUBSTACK_SID` themselves; never into
   the transcript. A pasted cookie expires; the browser path keeps working.
3. **Optional sign-in credentials.** The owner adds `SUBSTACK_EMAIL`, `SUBSTACK_PASSWORD` and, with
   2FA, `SUBSTACK_2FA_SECRET` (the base32 secret behind the 2FA QR code) to `box.local.json`
   themselves.

## Steps

1. **Source.** `box stack fetch --ref <sha>`, then copy `<fetched stack>/features/data-sync/core/substack/`
   into the Box's `features/data-sync/core/substack/`.
2. **Register.** In `features/data-sync/core/platforms.ts` add
   `import { substack } from './substack/index.js'` and `substack` to the `installedPlatforms()` list.
   There are no ingest controller methods for Substack.
3. **Account and browser.** In `box.json`:
   ```json
   "accounts": { "substack": [{ "id": "alice", "user": "alice", "default": true, "login": "alice",
                                "publication": "https://acme.substack.com" }] },
   "browsers": { "users": { "alice": "<alice's browser identity>" } }
   ```
4. Restart the server so the client registers. Then the owner-only step that applies.
5. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md`, the session in
   `_docs/INTEGRATION.md`. No cookie or password goes in either.

## Verify

1. `box run-now --action_id substack-pull` finishes with the published and draft counts, and names
   any statistics Substack refused. `credentials.substack.<account>.SUBSTACK_SID` is now set in
   `box.local.json` (check presence only, never print it), so later runs use the cached cookie.
2. `substack.posts` and the other `substack.*` signals Substack answered for appear in
   `box signals-list` and the Signals view. Compare the post count with the publication's archive.
3. A recipe that publishes to Substack no longer refuses to save a draft with "add the Data Sync
   substack powerup".
4. After these checks and the validation chain pass, add `substack` to `recipes.data-sync.powerups`
   in `box.json`.

## Remove

Delete `features/data-sync/core/substack/` and its import and entry in `platforms.ts`; remove
`accounts.substack` if nothing else uses it, the `credentials.substack` entries from `box.local.json`,
and `substack` from `recipes.data-sync.powerups`. The derived signals keep their points and stop
refreshing; Substack publishing then refuses with the powerup name. The browser stays
signed in to Substack until the owner signs out.
