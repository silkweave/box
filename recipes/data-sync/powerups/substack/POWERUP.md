# Substack

The team's Substack publication as signals: posts, drafts, views, subscribers and open rate, plus the Substack client a publishing recipe uses.

## Highlights

- Published posts, drafts, views, subscribers, paid subscribers and the 30-day open rate
- The session comes from the owner's own signed-in browser, so no password handling in the usual case
- The session cookie is cached and checked before use; a rejected cookie is re-minted once mid-run
- Statistics Substack has not opened for a young publication are named in the run summary and appear once Substack opens them
- Registers the `substack` client that Substack publishing uses

## Needs

- The Data Sync recipe
- Core's browser lease configured, with the publication owner's browser identity signed in to Substack ([docs/BROWSERS.md](../../../../docs/BROWSERS.md)), or a session cookie the owner copies by hand

## How it works

The platform lives in `features/data-sync/core/substack/` and is listed in `core/platforms.ts`. Its
action is `substack-pull`; it has no ingest tool, so it runs through core's run funnel
(`box run-now --action_id substack-pull`) and Automation triggers. Substack has no OAuth and no token
for its publisher API, so the private JSON API is authenticated by the `substack.sid` session cookie.
The default `substack` account in `box.json accounts` names the `publication` origin and the `user`
whose browser holds the session.

The session resolves cheapest first: `SUBSTACK_SID` (and `SUBSTACK_CONNECT_SID`) cached in
`box.local.json credentials.substack.<account>`; cookies read from that user's browser identity
(`browsers.users.<users.id>`); and, when `SUBSTACK_EMAIL` and `SUBSTACK_PASSWORD` (and
`SUBSTACK_2FA_SECRET` with 2FA) are stored, the sign-in form driven in that browser. Every candidate
is checked against `/user/profile/self` before it is accepted, because Substack sets the cookie on
anonymous visitors too, and each success is cached back. A captcha leaves the tab open for a person.

The platform's `register` adds the `substack` client (`selfProfile`, `createDraft`, `updateDraft`,
`publishDraft`, `uploadImage`) to core's platform port; without this powerup Substack
publishing refuses with "add the Data Sync substack powerup".
