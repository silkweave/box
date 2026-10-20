# Help Center powerup: install

Publishes the Help Articles as a public Help Center on Cloudflare Pages and, optionally, connects its contact form to the
Box. Read [POWERUP.md](POWERUP.md) (especially "Security model of the contact form"), the recipe
[GOTCHAS.md](../../GOTCHAS.md) and, for the form, the automation recipe's
`powerups/relay/INSTALL.md` first. Do as much as possible yourself; stop only for the owner-only
steps.

## Detect

Run `box support-site-status` (admin). `configured: true` means the Box has the powerup; `ok: true`
means every check passes: `token` (the Pages token is accepted), `project` (the Pages project
exists), `live` (the public address serves the latest build's `build.json`) and, with the form on,
`form` (`background.relay` is on, the relay source exists with provider `support-form` and a
secret, and the provider is registered; whether the relay is connected right now is
`box webhooks-status`). Configured but not ok is a repair: read the failing check, fix that part,
run Verify. `features/support/cloudflare/functions/` in the Box holds the deployed Function's
source; each publish stages it, the export (`out/`) and a generated `wrangler.toml` in
`data/support/site/`.

## Requires

- The Support recipe, adapted and validated, with at least one published help article.
- `bunx wrangler` on the Box host (fetched on first use).
- For the contact form: the Automation recipe and its Webhook relay powerup, verified, with
  `background.relay` on in this Box.

## Owner decisions

Ask these together, before any Cloudflare step:

1. **Project name and address.** The Pages project name (`<team>-help`, giving
   `https://<team>-help.pages.dev`), and an optional custom domain (`help.example.com`).
2. **Site text and look.** Title, a one-paragraph introduction, the contact email shown when there
   is no form or the form is unavailable, and optionally a logo (PNG, JPEG, WebP, GIF or AVIF), an
   accent colour (default Silkweave's `#7b7ef5`), a first-visit theme (`system`, `light` or
   `dark`) and a link to the team's website. All of these can change later in the Help Center tab of Settings > Support.
3. **Contact form.** On or off. If on: the daily cap before submissions are held (default 50), the
   per-visitor hourly limit (default 5), and any blocked addresses or domains.
4. **Publishing.** Automatic after changes (default, after 120 quiet seconds) or only with Publish
   now.

## Owner-only steps

Ask for each when it is needed, then wait:

1. **Cloudflare sign-in for setup**, one of: `bunx wrangler login` on the Box host, or a temporary
   API token with Cloudflare Pages: Edit and Workers KV Storage: Edit for this session, deleted after
   Verify.
2. **The publishing token.** In Cloudflare, My Profile > API Tokens > Create Token, a custom token
   with only Account > Cloudflare Pages > Edit, for this one account. This one stays: the Box
   publishes with it. The owner writes it to `box.local.json` at
   `credentials.cloudflare["*"].PAGES_API_TOKEN`, or hands it over for the agent to write without
   printing it.
3. **Turnstile widget** (form only). In Cloudflare, Turnstile > Add widget, for the site's
   hostnames (the pages.dev address and the custom domain), mode Managed. The site key is public;
   the secret key is handed over once, for step 6 below, and never written to a Box file.
4. **Custom domain** (optional). In the Pages project, Custom domains > Set up a domain; the DNS
   change is the owner's.

## Steps

Run from the Box root. With a temporary token, prefix each `bunx wrangler` command with
`CLOUDFLARE_API_TOKEN=<token>` for this session. Never write a token to a file other than
`box.local.json`, and never print it.

1. **Source.** Copy/adapt `core/help-center/`, `server/help-center/`, `web/help-center/` and
   `cloudflare/` (the Pages Function) from `<fetched stack>/features/support/`. The export renders
   markdown with `micromark` and `micromark-extension-gfm`: add them to the root package when the
   Box does not have them.
   Register them: `export * from './help-center/index.js'` in `core/index.ts`, the two models in
   `core/manifest.ts` and, with the form, `dependsOn: ['automation']` and the provider registration
   in `server/help-center/`; `SupportHelpCenterModule` in `server/support/support.module.ts`; in
   `web/index.tsx` the slot contributions: the Help Center button (`support.help.actions`), the
   Settings tab (`support.settings.help-center`) and the held submissions banner
   (`support.tickets.banner`).
2. **Project.** From an empty directory outside the Box workspace (wrangler refuses to run its
   project detection at a workspace root), `bunx wrangler pages project create <project>
   --production-branch main --force` (skip when `bunx wrangler pages project list` shows it). Without
   `--force`, current wrangler creates and deploys a Worker instead of a Pages project (GOTCHAS.md).
   With more than one Cloudflare account, prefix `CLOUDFLARE_ACCOUNT_ID=<id>`. Note the account id
   from `bunx wrangler whoami`.
3. **Configure** `box.json` (shared, no secret):
   ```json
   "features": { "support": { "helpCenter": {
     "project": "<project>",
     "accountId": "<cloudflare account id>",
     "publicUrl": "https://<project>.pages.dev",
     "title": "Acme Help",
     "intro": "Answers to common questions about Acme.",
     "contactEmail": "help@example.com",
     "accentColor": "#7b7ef5",
     "theme": "system",
     "websiteUrl": "https://www.example.com",
     "language": "en",
     "autoPublish": true,
     "publishDelaySeconds": 120,
     "form": {
       "enabled": true,
       "relaySource": "support-form",
       "turnstileSiteKey": "<site key>",
       "maxPerDay": 50,
       "perVisitorPerHour": 5,
       "blockedSenders": [],
       "kvNamespaceId": "<id from step 6>"
     }
   } } }
   ```
   Leave out `form` until step 6 (publishing refuses a form without its KV namespace and site key),
   and leave it out for good without the form. Test checkouts set `autoPublish: false`.
   `language` is the site's language (`en`, `id`; POWERUP.md "One language"); a language the Stack
   does not ship needs its strings file first.
4. **First publish without the form.** `box support-site-publish`, then open `publicUrl`: the
   published articles are there.

### The contact form

5. **Relay source.** Add `"support-form": { "provider": "support-form" }` to
   `features.automation.relay.sources` in `box.json`. Every other source on this relay Worker must
   have a secret too (GOTCHAS.md): check `box webhooks-status` and add one where a source has none.
6. **Secrets and storage.** Generate the form secret and hand every secret over in one shell, so
   none is printed:
   ```bash
   FORM="$(openssl rand -hex 32)"
   bunx wrangler kv namespace create support-form-limits   # note the id for box.json
   printf %s "$FORM" | bunx wrangler pages secret put FORM_SECRET --project-name <project>
   bun -e '
     const c = require("./box.json"), l = require("./box.local.json")
     const url = l.features?.automation?.relay?.url ?? c.features.automation.relay.url
     process.stdout.write(`${url}/hook/support-form/${l.features.automation.relay.hookKey}`)' \
     | bunx wrangler pages secret put RELAY_HOOK_URL --project-name <project>
   bunx wrangler pages secret put TURNSTILE_SECRET --project-name <project>   # the owner pastes it at the prompt
   FORM="$FORM" bun -e '
     const fs = require("fs"); const f = "box.local.json"
     const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}
     const s = ((((d.features ??= {}).automation ??= {}).relay ??= {}).sources ??= {})
     s["support-form"] = { ...(s["support-form"] ?? {}), secret: process.env.FORM }
     fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 })'
   ```
   Put the KV namespace id into `box.json` at `features.support.helpCenter.form.kvNamespaceId`; the
   Box writes it into the generated `wrangler.toml` as the `FORM_LIMITS` binding. Rotating the form secret later is the first, third and last command again.
7. **Reconnect and publish.** `box relay-reconnect`, then `box support-site-publish`: the export now
   includes the form and the Function.
8. **Record** the powerup, its Stack revision, the project name, account id and public address in
   `docs/UPSTREAM.md`, and the session in `_docs/INTEGRATION.md`. No secret goes in either.

## Tools

`support-site-status` (admin), `support-site-publish` (admin; `force`), `support-site-publishes`
(the publish history), `support-form-submissions` (`verdict`, `since`) and `support-form-decide`
(`id`, `decision`: `accept` or `reject`). The Help Articles list's top bar has a **Help Center** button
(the `support.help.actions` slot): it opens the Help Center tab of Settings > Support, and its
dropdown shows the site's state and the last publish and, for an admin, Publish now and Publish
even if unchanged. The **Help Center** tab of Settings > Support (`support/help-center`, the
`support.settings.help-center` slot) shows the checks, the site's text and look (admins edit
them; saved to `box.local.json`, `support-site-settings` and `support-site-settings-save`) and the
publish history. Its settings footer carries Preview, Save and Reset while the appearance has
unsaved changes, and Publish now otherwise. Preview renders the saved settings' export without
deploying and opens it in a new tab from the signed-in path mount `/support-site-preview/` (on
the server port, not the bare Vite port). The logo is set with Upload there (`logoUrl` is then a `/api/support/media/` path the publish
copies); in `box.json` it can also be an `https` URL.

## Verify

1. `box support-site-status` reports `ok: true` with every check passing.
2. Images: put an image from the Box (an artifact or content asset path) in a published article,
   Preview, and check the page source: the image sits under `assets/<hash>.<ext>` and loads in the
   signed-out site after publishing. An external `https` image is unchanged. Point an article at a
   missing Box image: `box support-site-status` shows a failing `images` check and a publish fails
   naming it. Fix it and publish again.
3. Retire a test article and publish another: after `publishDelaySeconds` (or Publish now) the live
   site shows the new one, the retired one redirects to the home page, and `build.json` carries the new
   publish id. View the page source: no team notes, owner or draft text.
4. Form, in a browser signed out of the Box: submit with a test address. Within seconds the
   relay ledger shows a `recorded` `support-form.submitted` row, and Support Tickets shows a ticket from
   `form` with the message in it. Submit again past `perVisitorPerHour`: the Function refuses.
5. Post the same signed body twice with curl (the Function's logged test body, or one built with
   the form secret): one submission, one ticket. Post it unsigned or altered: the ledger shows it
   `rejected`.
6. Set `maxPerDay` to 0 and submit: the submission is `held`, with no ticket, in the held banner above Support Tickets (Review);
   Accept makes the ticket. Restore the setting.
7. Stop the Box server, submit, start it: the ticket arrives after the relay reconnects.
8. Delete the temporary setup token, if one was used; keep the publishing token.
9. After these checks and the validation chain pass, add `help-center` to `recipes.support.powerups`.

## Remove

1. Turn the form off first: remove `features.support.helpCenter.form`, publish once (the site keeps
   only `contactEmail`), remove the `support-form` relay source and its secret, and delete the Pages
   secrets.
2. Remove `features.support.helpCenter` and `credentials.cloudflare["*"].PAGES_API_TOKEN`, the
   registration lines and the `help-center/` and `cloudflare/` folders, and `help-center` from
   `recipes.support.powerups`. The tables stay.
3. In the owner's account: delete the Pages project (`bunx wrangler pages project delete
   <project>`), the KV namespace, the Turnstile widget and the publishing token. Until the project is
   deleted the last published copy stays online.
