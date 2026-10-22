# Help Center

Publish the Help Articles as a public Help Center on Cloudflare Pages: a static copy of the published entries, rebuilt whenever they change, with a contact form that turns a visitor's question into a ticket while the Box itself stays private.

## Highlights

- A fast static site (a home page listing Getting started, then Articles, then Questions; a page per article and guide; an FAQ page of expandable answers; search over every type) in a docs layout with light and dark themes, the team's title, logo and accent colour, on a pages.dev address or the team's own domain
- Published on publish: a change to a published entry rebuilds and deploys the site after a short quiet period, or at once with Publish now
- Only published entries leave the Box: never drafts, team notes, owners, tickets or requesters
- Images and videos an entry takes from the Box are copied into the site, so they show for visitors who cannot sign in
- A contact form whose submissions arrive as tickets through the automation webhook relay, behind Turnstile, rate limits and a daily cap
- A status check that proves the deploy token, the project, the live build and the form path

## Needs

- A Cloudflare account (the free Pages plan covers typical use)
- A Cloudflare API token limited to Cloudflare Pages: Edit, kept on the Box for publishing
- For the contact form: a Turnstile widget, and the Automation recipe with its Webhook relay powerup
- Optionally a domain on Cloudflare for the public address

## Requires

- Nothing beyond Support: Help Articles are part of the base recipe

## How it works

**Reading needs no Box.** On publish the Box renders a static export into `data/support/site/out/`:
HTML pages from the published entries (markdown rendered and sanitized on the Box, raw HTML
escaped): `articles/<id>/` for each published `article` and `getting_started` entry, `faq/index.html`
listing the published FAQ answers as expandable items with anchors `#<id>`, and
`getting-started/index.html` listing the published guides. The FAQ and Getting started pages, and
their links in the navigation, exist only when there is at least one published entry of that type.
The export also holds a search index as JSON covering every type, `sitemap.xml`, `robots.txt`,
`_headers` (a strict Content-Security-Policy, with `media-src 'self' https:` for videos) and `_redirects` (a retired article redirects to the
home page). Entries are listed featured first, then in Help Articles' manual order, then
by title; the home page groups them as Getting started, Articles, then Questions. It deploys the folder to the configured Pages project with `wrangler pages deploy`, using
the Pages token from `box.local.json` for that subprocess only. Visitors read Cloudflare's copy;
nothing on the site can call the Box, and the Box serves nothing to the internet. Each publish is a
row in `support_site_publishes`, and the export carries `build.json` with its id, so the status
check can prove the live site is the latest build.

**The look.** Every page but the home page is a docs layout: a top bar (logo, title, search with a
Cmd/Ctrl K shortcut, an optional link to the team's website, Contact, and a light/dark toggle), a
sidebar of the published entries by type, the page, and on wide screens an "On this page" outline of
an article's section headings (which get anchor ids). The home page is a search hero with cards for
the guides and articles and the FAQ answers below. Light and dark share one token set; a visitor's
choice is kept in the browser, and a first visit gets the site's `theme` (`system` follows the
device). The site's text and look (`title`, `intro`, `contactEmail`, `logoUrl`, `accentColor`,
`theme`, `websiteUrl`) are edited in the **Help Center** tab of Settings > Support, which saves them to `box.local.json`.
The logo is uploaded like editor media and copied into the export; SVG is not accepted. The CSP
allows no inline script or style, so a small blocking `theme.js` sets the theme before the first
paint, and Inter is self-hosted under `fonts/` from the root package's `@fontsource-variable/inter`.
A change to the design changes the content hash, so the next publish is not skipped as unchanged.

**One language.** The site speaks the language set in `language` (default `en`): it becomes the
`<html lang>` and picks the site's own words (search, navigation, headings, the contact form and
its answers) from `features/support/core/help-center/strings/<language>.ts`. The Stack ships `en`
and `id` (Bahasa Indonesia). For another language an agent copies `strings/en.ts`, translates every
value and registers it in `strings.ts`; the type check refuses a missing key, and a strings change
counts as a design change, so the next publish is not skipped. There is no settings page for it and
no multi-language site: the entries are published as written, and the Box's own screens stay
English. The contact Function answers with a `code` the page maps to its own words.

**Writing goes through the relay.** The contact form posts to a Pages Function on the same site
(`/api/contact`). The Function checks the request and forwards a signed submission to the Box's
relay Worker, which holds it until the Box collects it over its own outbound connection. The
`support-form` relay provider on the Box verifies the signature and the schema and records a
`support-form.submitted` event; Support turns it into a submission row and, unless it is held, a
ticket (`source: form`, the submission id as `source_ref`).

**Images and videos.** An image in an entry is either external (an `http(s)` address on another
site, left as written) or served by this Box (a path such as `/artifacts/<slug>/shot.png`, or an
address on the Box's own origin), which needs a sign-in and would be broken for visitors. The export
reads each Box image through the Box's own server as the system principal and copies it to
`assets/<hash>.<ext>` (PNG, JPEG, GIF, WebP, AVIF or SVG, up to 10 MB), then points the reference at
the copy. The image digests are part of the content hash, so a changed image publishes again. A Box
image that cannot be read (missing, not an image, too large, or redirecting away from the Box) fails
the publish with the reference named in the publish row's error, instead of shipping a broken
picture; the `images` check in the status shows the same problem beforehand. A video reference (`![alt](x.mp4)`; .mp4, .webm, .mov, .m4v or .ogv) renders as
`<video controls>` and is copied the same way (see the recipe SPEC.md, "Media"). A published image
or video is public: copy only files meant for visitors.

### Security model of the contact form

- **No Box credential leaves the Box.** The Pages project holds three secrets, set as Pages
  secrets and never in the exported files: the relay hook URL for the `support-form` source, the
  form signing secret, and the Turnstile secret. None of them can read anything from the Box. The
  worst a leak allows is posting submissions, which land as held submissions or tickets.
- **Spam and abuse at the edge.** The Function accepts only `POST` from the site's own origin,
  refuses bodies over 8 KB and fields over their limits, drops submissions with the honeypot field
  filled, verifies the Turnstile token with Cloudflare, and counts submissions per visitor (a hash of
  the IP address, never stored on the Box) in a KV namespace: by default 5 per hour.
- **Integrity in transit.** The submission is signed with HMAC-SHA256 over the raw body
  (`X-Box-Signature`). The Box refuses an unsigned or altered body. Each submission has a unique id
  generated by the Function; a replayed body is recognized by that id and records nothing new.
- **Limits on the Box.** Past `maxPerDay` accepted submissions, or from an address or domain in
  `blockedSenders`, a submission is kept as `held` (or `rejected` for a blocked sender) and makes no
  ticket until a person accepts it in the held banner above Support Tickets, shown whatever the preset.
- **Untrusted text.** The visitor's name, email and message are data, never instructions: agents
  see them inside the untrusted-content markers, and the email is unverified, so it can find a known
  requester but never changes that requester's details. No submission wakes an agent by itself.
- **The visitor gets no data back.** Once the relay has stored the submission, the Function answers
  "Thanks, we will get back to you", whatever the Box later decides; when the relay cannot be
  reached it asks the visitor to try again or write to `contactEmail`. The reply to the visitor is
  a person's.

Without the relay powerup the site has no form; its contact section shows `contactEmail`, and
Settings > Support names the missing relay powerup.
