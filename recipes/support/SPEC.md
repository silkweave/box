# `support` - tickets, requesters and help articles

The single place where everything the team hears from its users is recorded once. A **ticket** is
one request from one person: a question, a problem, a bug report, feedback, a billing matter; a bug
report is simply a ticket of type `bug`. A **requester** is the person who asked, kept once and
found again by email or phone. A ticket's organization is its requester's. A **help article** is
one entry the team writes for its users (an article, an FAQ answer or a Getting started guide),
with a lifecycle, linked to the tickets it answered.

The tickets are read through one view, built like Planning's Initiatives: the team's saved
**presets** (what is open, what is mine, what is late) over a grid or a board, with the age of every
open ticket in working days. Help Articles are read the same way, through their own presets.

- **Feature id**: `support` (the recipe id). Tables prefixed `support_`, migration keys
  `support:<name>`, settings under `features.support`.
- **dependsOn**: nothing. Core only. The base imports no other feature.
- **Powerups** (`recipes/support/powerups/`): `crm` (the requester is a CRM contact, tickets link to CRM touches
  and show on the account page), `comms` (a Comms conversation becomes a ticket, linked
  back) and `help-center` (the published Help Articles as a public **Help Center** on Cloudflare
  Pages, with a contact form that creates tickets). The base names their absence (see "Absence")
  and imports nothing from them.
- **Agent skill**: `features/support/skills/support/SKILL.md`, how to log a ticket from a call or chat
  summary, find or merge the requester, and work the open tickets.
- **Removal**: remove `features/support/` and its registration lines. The `support_*` tables stay
  in the warehouse until someone deliberately drops them (the data is the team's).

## Intake

Every path ends in the same domain function, `logSupportTicket`, so the rules below hold whoever
writes the ticket.

| Path | Where | Needs |
|---|---|---|
| Manual | New ticket dialog, opened from the Support Tickets top bar | base |
| Agent | `support-ticket-log` (MCP, CLI, tRPC) from a call, meeting or chat summary | base |
| Comms conversation | "Create ticket" on a Comms conversation (a dialog prefilled with the quoted messages), or `support-ticket-from-conversation` | `comms` powerup |
| CRM touch | "Log support ticket" on a CRM touch or account (the New ticket dialog, prefilled) | `crm` powerup |
| Help Center contact form | the public site's form, through the automation relay | `help-center` powerup with its form |

Each ticket records where it came from in `source` and `source_ref`. The pair is unique when
`source_ref` is set, which makes every machine path idempotent: logging the same call, message,
touch or form submission twice returns the existing ticket instead of a second one. A ticket logged
by a person is `manual`, by an agent `agent`, from a CRM touch `crm` (the touch, not `source_ref`,
makes it unique).

## Tables

Created from the ModelSpecs on boot (`CREATE TABLE IF NOT EXISTS`). Every table carries
`timestamps: true` and `audit: true`, so the record layer keeps `created_at`, `updated_at`,
`created_by` and `updated_by`.

### Base

| table | pk | what it holds |
|---|---|---|
| `support_tickets` | `id` (integer, the ticket number shown as `#42`, assigned as max + 1 inside the write) | `subject` (one line), `summary` (markdown: what was asked and what was said), `requester_id` (nullable: an anonymous or unknown asker; a `support_requesters` id, or with the `crm` powerup a `crm_contacts` id), `channel` (`email`, `phone`, `whatsapp`, `chat`, `form`, `in_person`, `other`), `type` (`how_to`, `problem`, `bug`, `feedback`, `billing`, `other`), `status` (`pending`, `active`, `blocked`, `done`, `dropped`), `resolution` (nullable free text: what closed it), `owner` (nullable `users.id`: who works it), `opened_on` (date, default team today), `closed_on` (date, set when it becomes done or dropped), `source` (`manual`, `agent`, `comms`, `crm`, `form`, `import`), `source_ref` (nullable text), `logged_by` (the principal), `external` (JSON provenance bag) |
| `support_requesters` | `id` (uuid) | `name` (optional), `email` (lower case, trimmed; nullable), `phone` (digits with country code, `4915112345678`; nullable), `organization` (free text: the requester's company, school or household as typed), `notes`, `merged_into` (nullable: a requester merged away points at the survivor), `external` |
| `support_articles` | `id` (slug, made from the title, the public URL slug, never changes) | `type` (`article`, `faq`, `getting_started`; for an `faq` the title is the question and the body the answer), `title`, `one_liner`, `body` (markdown), `status` (`draft`, `published`, `retired`), `needs_update` (bool), `featured` (bool), `owner`, `team_notes` (markdown, never published), `sort`, `published_on`, `retired_on`, `content_updated_on`, `external` |
| `support_ticket_articles` | `ticket_id` | `article_id`, `linked_by`, `linked_at`: the entry that answered the ticket |

No baseline DDL and no unique indexes: DuckDB checks a unique index eagerly inside the record
layer's `ON CONFLICT DO UPDATE` and refuses rows that did not change the indexed column, and it has
no partial indexes. One requester per email and per phone (among live, unmerged requesters), one
ticket per `(source, source_ref)` and the next ticket number
are enforced in the write path, which every writer goes through, inside one in-process queue
(`core/lock.ts`; the server is the one writer).

### Powerup tables

Each powerup owns its tables and adds them to the manifest's models when it is added. A powerup
never adds a column to a base table: a link table keeps the base model identical in every Box, and
removing the powerup leaves the base untouched. The `crm` powerup adds no requester table either: it
swaps the requester directory (see "Rules").

| table | powerup | what it holds |
|---|---|---|
| `support_ticket_crm` | `crm` | `ticket_id` (pk), `activity_id` (the CRM touch the ticket came from; one ticket per touch, checked in the write path) |
| `support_ticket_conversations` | `comms` | `ticket_id` (pk), `conversation_id`, `channel`, `anchor_message_id` (the newest message when the ticket was made), `linked_at` |
| `support_site_publishes` | `help-center` | `id`, `requested_by`, `started_at`, `finished_at`, `status` (`running`, `ok`, `failed`, `skipped` when nothing changed), `deployment_id`, `deployment_url`, `article_count`, `faq_count`, `content_hash` (the published content, the site settings and the digest of every copied image), `error` (a Box image that could not be read fails the publish and is named here) |
| `support_form_submissions` | `help-center` | `id` (the submission id from the site, also the ticket's `source_ref`), `received_at`, `name`, `email`, `message`, `page_url`, `country`, `verdict` (`accepted`, `held`, `rejected`), `reason`, `ticket_id`, `decided_by`, `decided_at` |

### Migrations

| key | what |
|---|---|
| `support:001-drop-ticket-bug-id` | `ALTER TABLE support_tickets DROP COLUMN IF EXISTS bug_id` |
| `support:002-drop-ticket-next-step` | `ALTER TABLE support_tickets DROP COLUMN IF EXISTS next_step` |
| `support:003-drop-bugs` | `DROP TABLE IF EXISTS support_bugs` |
| `support:004-drop-ticket-theme` | `ALTER TABLE support_tickets DROP COLUMN IF EXISTS theme_id` |
| `support:005-drop-article-theme` | `ALTER TABLE support_articles DROP COLUMN IF EXISTS theme_id` |
| `support:006-drop-faq-theme` | `ALTER TABLE support_faqs DROP COLUMN IF EXISTS theme_id` |
| `support:007-drop-form-submission-theme` | `ALTER TABLE support_form_submissions DROP COLUMN IF EXISTS theme_id` |
| `support:008-drop-themes` | `DROP TABLE IF EXISTS support_themes` |
| `support:009-drop-ticket-organization` | `ALTER TABLE support_tickets DROP COLUMN IF EXISTS organization` |
| `support:010-drop-ticket-crm-account` | `ALTER TABLE support_ticket_crm DROP COLUMN IF EXISTS account_id` |
| `support:011-drop-ticket-crm-contact` | `ALTER TABLE support_ticket_crm DROP COLUMN IF EXISTS contact_id` |
| `support:012-drop-requester-crm` | `DROP TABLE IF EXISTS support_requester_crm` |
| `support:013-article-type` | `ALTER TABLE support_articles ADD COLUMN IF NOT EXISTS type VARCHAR DEFAULT 'article'` |
| `support:014-faqs-into-articles` | copies each row of `support_faqs`, when that table exists, into `support_articles` as an entry of type `faq` (question as title, answer as body, a slug id from the question) |
| `support:015-drop-faqs` | `DROP TABLE IF EXISTS support_faqs` |
| `support:016-drop-article-audiences` | `ALTER TABLE support_articles DROP COLUMN IF EXISTS audiences` |

The manifest's `retiredTables` lists `support_bugs`, `support_themes`, `support_requester_crm` and `support_faqs`.

They drop or add columns and tables so the model above is the one stored, one table-altering statement
each (`014` moves rows instead). On a fresh Box, and on one that adapts the recipe later, each is a
no-op. A later change to a shipped table appends a new migration with the next free name
(`support:017-...`); shipped migrations are never edited.

## Rules (`core/tickets.ts`, `core/requesters.ts`, `core/crm/directory.ts`)

- **A new ticket** needs a subject or a summary, a channel and a type. The subject defaults to the
  summary's first line. Channel and type cannot be blanked later.
- **Requesters.** A requester needs an email or a phone; the name is optional. Emails are stored
  lower case and trimmed. Phones are stored as digits with the country code: `+49 151 ...`,
  `0049151...` and, with `defaultCountryCode` `49`, `0151...` all become `49151...`. One requester
  per email and one per phone: creating or editing a second refuses and names who has it.
  `logSupportTicket` finds or creates the requester: by email first, then by phone; when the two
  match different people it uses the email match and returns a warning naming both. A machine path
  (agent, form, comms) never overwrites a known requester's name, phone or organization; it only
  fills blanks. A requester named on a ticket cannot be deleted; **merge** repoints every ticket to
  the survivor and marks the other `merged_into`.
- **Organization.** A ticket has none of its own: it is its requester's. Ticket lists and the
  ticket decorate each row with `organization`, read through the requester directory.
- **The requester directory** (`SupportRequesterDirectory` in `core/ports.ts`): who
  `support_tickets.requester_id` names. The base directory (`SUPPORT_BASE_DIRECTORY`) is the
  `support_requesters` table above. With the `crm` powerup the directory is the CRM's contacts
  (`SUPPORT_CRM_DIRECTORY`, `core/crm/directory.ts`): the requester IS a CRM contact,
  `requester_id` holds a `crm_contacts` id, and the organization is the contact's account name. One
  directory is active; every ticket path reads and resolves people through it
  (`supportRequesterDirectory`, `resolveSupportPerson`, `searchSupportPeople` in `core/requesters.ts`).
  A requester named by details is found by email, then phone, among the contacts; otherwise it is
  created as a contact. Its account is `requester_account_id` when given, else the account whose
  name equals the requester's organization (compared case-insensitively), created with source
  `inbound` when none has it; with no organization the account is named after the person. A known
  contact's name, phone and email are only filled when blank. A requester needs a name, an email or
  a phone as a contact; in the base an email or a phone.
- **Bugs.** A bug report is a ticket of type `bug`; it is worked and closed like any other ticket.
- **Statuses.** `pending` (logged, nobody on it yet), `active` (being worked), `blocked` (waiting on
  someone else: the requester, a developer, a supplier), `done` (answered or fixed) and `dropped`
  (needs no answer: spam, gone quiet, logged twice). Pending, active and blocked are **open**; done
  and dropped are **closed**. A new ticket is `active` when logged with an owner, else `pending`;
  `status` on the log sets it (a call answered on the spot is logged `done`, closed on its open
  day). Becoming done or dropped stamps `closed_on` (team today unless given); done to dropped keeps
  it; opening again clears it. The `status` filter takes one status, or `open` / `closed` for the
  group. Late and the open counts cover the three open statuses.
- **Possible duplicates** (same requester, same day, same channel) are shown in the form, never
  refused.
- **Events.** `support.ticket.opened` (dedup `<id>`) and `support.ticket.closed` (dedup
  `<id>:<closed_on>`), each with the ticket fields minus personal data (`ticket_id`, `channel`,
  `type`, `status`, `source`, `opened_on`, `closed_on`), so automation triggers can act on
  them where automation is adapted. Support never needs them itself.

## Working days

The age of an open ticket is the number of working days from `opened_on` (exclusive) to team
today (inclusive), skipping days not in `workingDays` and dates in `holidays`. A ticket opened today
is 0. It is late when its age exceeds `lateAfterDays`. "Team today" is core's team day (the Box's
team time zone); the feature never uses UTC dates for this.

## Help Articles (`core/articles/`)

One list of entries, each an article, an FAQ answer or a Getting started guide (its `type`), with
the same fields: markdown body, one-liner, owner, team notes. Entries are warehouse rows, not files,
because their lifecycle, sort order, flags and links to tickets are what the views query. The id is
the public slug, made from the title, and never changes. The list order is featured first, then the
manual `sort`, then the title.

- **Lifecycle**: `draft`, `published`, `retired`, with the Needs update and Featured flags.
  Publishing stamps `published_on`; retiring stamps `retired_on` and clears Needs update; changing
  the title, one-liner or body stamps `content_updated_on`, flags do not.
- **Tickets**: `support_ticket_articles` links a ticket to the entry that answered it, and the entry
  counts the tickets it answered. A retired entry is not offered anew; an entry a ticket links is
  retired, not deleted. The link is a ticket extension (`articles`, `core/ports.ts`), registered by
  `server/articles/`, so the ticket code stays the same whether a Box keeps the articles or not.
- **Nothing is public.** Publishing an entry marks it ready for readers; the `help-center` powerup
  is what puts published entries on the internet.

### Media

Article bodies and FAQ answers can show images and videos. Both are written as markdown images,
`![alt](url)`; a URL whose path ends in `.mp4`, `.webm`, `.mov`, `.m4v` or `.ogv` is a video and is
drawn as a player. In the editor, paste or drop a file, or use the Media button, to upload it; type
`![alt](url)` to insert one by URL. Uploads accept PNG, JPEG, GIF, WebP and AVIF images up to
10 MB and MP4, WebM, QuickTime and Ogg videos up to 25 MB, the largest file Cloudflare Pages serves
(SVG is refused). They are stored in the Box instance under `data/support/media/`, named by a
content hash so the same file uploaded twice is one file, and served to signed-in members at
`/api/support/media/<file>` (`server/articles/media.controller.ts`). Publishing the Help Center
copies every Box-served image and video an entry references into the site.

### Help Articles and the wiki

Deliberately separate from the [Wiki](../wiki/RECIPE.md) recipe, and linked to it only by
reference. The wiki is the team's internal knowledge, written for and largely by agents, as files
with free links and no publication state; help articles are written for the team's users, reviewed
one by one and published. Keeping them apart means an internal page can never reach the public Help
Center by being filed in the wrong folder, and Help Articles need no wiki to work. Where both
recipes are present, an agent searches the wiki (read only) for facts when drafting an article, and
an article's team notes may cite wiki pages as `[[slug]]`; nothing is copied or synced between them.

## Views (`/support`, nav "Support Tickets", order 650)

Support has two sidebar items: **Support Tickets** and **Help Articles** (`/support/help`, order
655, id `support-help`). The Box places both under a "Support" heading in its sidebar sections
(`apps/web/src/lib/nav.ts`). The routes under `/support/help` carry `shellGroup: 'support-help'`, so
the deepest match makes Help Articles the active item there; one layout publishes the secondary
navigation for both.

- **Support Tickets** (`/support`): one view over every ticket, built like Planning's Initiatives.
  The bar carries the preset select, the List / Board toggle, search (subject, summary, requester,
  organization, `#42`), filters (status, type, owner with Me and Unassigned, age, channel,
  requester, organization), group by (status, owner, type, channel), sort (opened, updated,
  age, either direction) and the columns. Age buckets run on working days: Late, 0 to 2, 3 to 7,
  8 to 30 and over 30.
  - **List**: a grid. Ticket (number and subject, opening the ticket), Status and Owner are always
    shown; the optional columns are Requester, Organization (the requester's), Type, Channel, Age
    (red when late), Opened and Updated, in the order the view stores. Status, owner, type and
    channel edit in place. Groups collapse.
  - **Board**: one column per value of the group-by (status when grouping by nothing): every owner
    with Unassigned, every type or channel.
    Dragging a card to another column sets that field through `support-ticket-update` (to Done or
    Dropped closes the ticket). A filter on the board's own axis picks the columns.
  - **Presets** are the team's, shared in the `support-tickets` preset module and seeded the first
    time anybody opens the view: Open (pending, active and blocked, oldest first, the landing
    view), Mine (open, owned by whoever looks), Unassigned, Late (open past `lateAfterDays`, longest
    waiting first), Blocked, Closed (done and dropped, most recently updated first) and Everything. Which preset is on is `?preset=<name>`; arriving
    on `/support` without one lands on Open. The live view stays in this browser.
  - The sidebar lists the presets under **Presets**, then **Recent Tickets**: the last ten tickets
    opened in this browser. The `support.tickets.banner` slot renders above the tickets whatever
    the preset (the `help-center` powerup's held submissions).
  - `?requester=<id>` (with a preset) narrows the view to one requester's tickets, then the address
    returns to `?preset=` alone.
- **A ticket** (`/support/tickets/<id>`): a page laid out like a Help Article. The breadcrumb is
  `Support Tickets > <subject>`, and the subject crumb is the subject field (click to edit). The top
  bar carries the status select (each status with its icon and color) and, for administrators,
  Delete, beside New ticket. Left: the number, open and close dates and age, then the details card:
  the **requester panel** (with the requester's organization), the requester's other tickets,
  owner (a user picker with avatars, as everywhere in Support), type, channel, the resolution once
  done or dropped, the `support.ticket.panel` slot (below) and the source. Right, in a split pane
  that can collapse: the summary, a markdown document saved as you type.
- **New ticket** is a dialog styled like Planning's New initiative (`components/TicketDialog.tsx`),
  opened from the Support Tickets top bar; there is no page for it. The `crm` powerup opens it
  prefilled from an account or a touch. Creating the ticket opens its page.
- **The requester field** (`components/RequesterField.tsx`), in the dialog and on the ticket page,
  is one autocomplete: type to search people (with `crm`, CRM contacts by name, email, phone or
  company), pick one, or choose **New requester** (**New CRM contact** with `crm`) from the typed
  text and fill name, email, phone and organization (company with `crm`). A new person whose email
  or phone a known one has shows "Already known" with **Use them**, so a second record is never made
  by accident.
- **The requester panel** (`components/RequesterPanel.tsx`). Requesters have no page of their own.
  On the ticket page the same field changes the requester. A base requester has an edit (pencil)
  for name, email, phone and organization in place; an edit that collides with another requester's
  email or phone (the write path refuses it, naming who) offers the **merge** of the two, keeping
  either. With `crm` the requester is a contact, edited in the CRM, and the panel links to its
  account there. **All tickets from ...** opens the tickets view filtered to them.
- **Help Articles** (`/support/help`), built like Support Tickets: one saved-view bar with the
  preset select, the List and Board layouts, search over title, one-liner and body, filters (type,
  status, needs update, featured, owner), grouping (none, type, status, owner, needs update,
  featured), sort (manual order, title, or last updated) and columns. The list is a grid edited in
  place (type, status, owner, featured, needs update); the board draws one column per value of the
  group-by (status when grouped by nothing), and dropping a card writes that field. Presets are the
  team's, shared in the `support-articles` preset module; the built-ins are Drafts, Published, Needs
  update, Featured and Everything, none of which filters by type, and the bare `/support/help`
  lands on Everything. A preset that filters by type puts an "FAQ" or "Getting started" lens in the
  sidebar. Which preset is on is `?preset=<name>`. The sidebar lists Presets, then **Recent
  Articles** (the last ten opened in this browser). The list's top bar carries the
  `support.help.actions` slot and New article; without a contribution the base shows a plain
  **Help Center** button that opens the Help Center tab of Settings > Support (see "Absence").
- **An entry** (`/support/help/articles/<id>`), laid out like an initiative. The top bar holds the
  status and, for admins, a delete button; the title is edited in the breadcrumb. The left side
  holds the details: the slug (read-only), Type, Owner, one-liner, flags, sort, team notes and the
  tickets it answered. The right side is the markdown editor, with media uploads ("Media").
  **New article** opens a dialog with a Type select, the title, one-liner, status, owner and
  Featured, then opens the new entry. On a ticket, the `support.ticket.panel` contribution
  (`web/articles/TicketArticlePanel.tsx`) picks the answering entry.
- **Settings > Support** (order 825, `support/<tab>`), tabbed like Automation, with each tab's
  actions in the settings footer: **Working week** (working days, holidays; Save / Reset),
  **Support Tickets** (late threshold, default country code; Save / Reset) and **Help Center**
  (the `support.settings.help-center` slot; see "Absence" for a Box without the powerup).

Every list reloads on the change feed's `table:support_*`. The web feature reads other features'
registrations lazily (WEB.md, "The TDZ rule").

### Extension points

Support owns four web slots (`features/support/web/lib/supportExtensions.ts`), read at render in
feature order, and a server port:

| slot | props | where it renders |
|---|---|---|
| `support.ticket.panel` | `{ ticket, onChanged }` | the ticket page's right column (the base's answering article, `comms` the conversation) |
| `support.tickets.banner` | none | above the tickets in either layout, whatever the preset (`help-center` the held submissions) |
| `support.settings.help-center` | `{ isAdmin }` | the Help Center tab of Settings > Support (`help-center` its checks, appearance and publish history, with Preview, Save and Publish now in the footer) |
| `support.help.actions` | none | the Help Articles list's top bar, before New article (`help-center` the Help Center button with its publish dropdown) |

On the server, `registerSupportExtension` (`core/ports.ts`) lets a powerup own input keys of
`support-ticket-log` and `support-ticket-update` (`crm_activity_id`), check them, make a machine
path idempotent on its own key, add its links to `support-ticket`, and clean up on ticket delete and
requester merge; `setSupportRequesterDirectory` lets the `crm` powerup replace the requester
directory; `markSupportPowerup` reports a powerup
and its problems to `support-status`. A key no present powerup owns is refused, naming the powerup.
A Box's own feature can use the same seams.

## Absence

Where a powerup's capability would appear, the base says so instead of hiding it:

- Settings lists no powerups: the Recipe Gallery shows which a Box has, and `support-status` reports
  each one's state (`added`, `not_added`, `needs_attention` with its problems).
- Without `help-center`, the Help Articles list's top bar shows a plain **Help Center** button, and
  the Help Center tab of Settings > Support says what the powerup adds: administrators get "Add with
  Builder" (a prefilled Builder brief), members "ask an administrator".
- At the point of use, only when the neighbour recipe is adapted but the powerup is not: a CRM Box
  shows "Requesters as CRM contacts, with their company: add the CRM link powerup" on the ticket
  page. A Box without CRM sees no hint: it would point at two steps, not one.

## Procedures and tools

One controller method, three transports (tRPC, MCP, CLI), named like the other recipes. All
require a signed-in user (`AuthGuard`, deny by default). A clearable field takes `''` to clear it.

| Tool | Role | What |
|---|---|---|
| `support-status` | member | powerups present, settings problems, counts (open, unassigned, late) |
| `support-tickets` | member | newest first, with filters (`status`, `type`, `channel`, `owner` (an id, `me` or `none`), `requester`, `since`, `until`, `search`, `late`, `ids`, `limit`) |
| `support-ticket` | member | one ticket with requester, the requester's other tickets, links and age |
| `support-ticket-log` | member | create from a summary: `summary`, `subject`, `channel`, `type`, the requester as `requester_id` or `requester_email` / `requester_phone` / `requester_name` (with `requester_organization`, and `requester_account_id` with `crm`), `owner`, `status`, `resolution`, `opened_on`, `source_ref`; answers with the ticket, `created` (false when `source_ref` matched) and warnings |
| `support-ticket-update` | member | partial update of subject, summary, channel, type, owner, status, resolution, dates and requester (the same `requester_*` keys, or `clear_requester`) |
| `support-ticket-delete` | admin | for mistakes; done or dropped is the normal end |
| `support-requesters` | member | search by name, email, organization or phone (normalized before matching), with ticket counts; answers `{ directory: 'support' \| 'crm', requesters }` |
| `support-requester-upsert` | member | create or edit a support requester; refuses a duplicate email or phone naming who has it |
| `support-requester-merge` | member | `from`, `into` |
| `support-requester-delete` | admin | only without tickets |

| `support-articles` | member | Help Articles entries, featured first, then `sort`, then title, with filters (`type`, `status`, `needs_update`, `featured`, `search`) and each entry's answered-ticket count |
| `support-article` | member | one entry with its body, team notes and the tickets it answered |
| `support-article-upsert` | member | create or edit an entry: `type`, `title`, `one_liner`, `body`, `status`, `needs_update`, `featured`, `owner`, `team_notes`, `sort`; `import_key` makes an importer's re-run update the entry it made |
| `support-article-delete` | admin | refuses an entry a ticket links; retire it instead |
| `support-ticket-article-set` | member | `ticket_id`, `article_id` (`''` unlinks) |

The three requester write tools refuse with the `crm` powerup: requesters are CRM contacts then,
edited with the CRM tools.

Summaries are returned wrapped in the Box's untrusted-content markers, with `untrusted: true`, when
the ticket came from outside the team (`form`, `comms`), because the text is the requester's, not
an instruction. The web strips the markers for display.

tRPC only, for the views: `supportRequester` (one requester with their tickets and its `directory`) and
`supportSettingsSave` (admin; the Working week and Support Tickets tabs).

The powerups add their own tools (their POWERUP.md and INSTALL.md list them).

## Settings

Shared, in `box.json`:

```json
"features": { "support": {
  "workingDays": [1, 2, 3, 4, 5],
  "holidays": ["2026-12-25", "2026-12-26"],
  "lateAfterDays": 1,
  "defaultCountryCode": "49"
} }
```

`workingDays` are ISO weekdays (1 Monday to 7 Sunday), default Monday to Friday. `holidays` are
`YYYY-MM-DD` dates, default none. `lateAfterDays` defaults to 1. `defaultCountryCode` (digits, no
`+`) turns a national number with a leading `0` into an international one; without it such a number
is stored as typed digits and flagged in the requester form. Settings > Support writes these to
`box.local.json` like the other settings pages (each tab only its own keys); the shared values
belong in `box.json`.

The base keeps no secret. The powerups' settings and secrets are in their INSTALL.md.

## Personal data

| table | categories |
|---|---|
| `support_requesters` | full name, **email address**, **phone number**, organization, free-text notes |
| `crm_contacts` (CRM, with the `crm` powerup) | the requesters themselves; the CRM recipe's SPEC.md lists them |
| `support_tickets` | summaries of what a person asked or reported, which can name other people |
| `support_form_submissions` | name, email and message as submitted on the public site, country from the request |
| `support_ticket_conversations` | links only; the messages stay in Comms |
| `events` (core) | `support-form.submitted` events carry the submission's name, email and message, because the relay provider records the delivery as an event before Support stores it. Accepted by the owner: the events table keeps them under core's event retention |

Internal users only. Personal data never leaves the Box through this feature: the Help Center publishes only published entries, plus the Box-served images those reference (copied into the site, so they are public once published). Support's own
events (`support.ticket.*`) carry ids and enums, never names or addresses.

## What a team customises

The ticket types and channels (code enums, `AGENT.md` § 2), working days and
holidays, the late threshold, the default country code, the built-in presets, the nav labels and
order, and the agent skill's wording. A team that does not want Help Articles (or, rarely, tickets)
asks its agent to hide or drop that part in the Box's own `features/support/`: the Box keeps the
change, and the recipe carries no switch for it.
