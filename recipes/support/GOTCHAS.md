# support gotchas

The feature id (`support`, the same as the recipe id) is part of runtime registration and migration
identity. Keep it stable. Record any local exception or custom path in the Box's `docs/GOTCHAS.md`
and leave current operation state in `_docs/INTEGRATION.md`.

- **Every write goes through `logSupportTicket` and the requester functions.** They normalize
  emails and phones, enforce one requester per email and per phone, and keep `source_ref`
  idempotent. A script that inserts rows directly creates duplicates the unique indexes then refuse
  at the worst moment.
- **Phone normalization needs `defaultCountryCode`.** Without it a national number (`0151...`) is
  stored as typed and will not match the same person's `+49 151...` from WhatsApp. Set it before the
  first ticket.
- **Working days follow the team time zone.** A Box whose team time zone is unset counts days in
  UTC, and tickets logged in the evening age a day early. Set it in core before adapting.
- **Uniqueness lives in the write path, not in indexes.** DuckDB refuses an `ON CONFLICT DO UPDATE`
  on a table with a secondary unique index even when the indexed column did not change, so the
  one-per-email, one-per-phone and one-per-`source_ref` rules are checked in `core/lock.ts`'s queue.
  Do not add a unique index to "make sure"; it breaks every later edit of the row.
- **Powerups own link tables, not base columns.** Do not add `crm_activity_id` or `article_id` to
  `support_tickets` to save a join: the base model must be the same in every Box, and a column that
  only exists when a powerup is present breaks `schema:check`'s enabled-later pass.
- **With the crm powerup the requester is a CRM contact.** `support_tickets.requester_id` then holds
  a `crm_contacts` id and the ticket's organization is the contact's account; `support_requesters`
  is not read. A Box that logged tickets before adding the powerup moves them with
  `support-crm-adopt` (dry run first); until then `support-status` reports the tickets that name
  requesters outside the CRM. Edit the person in the CRM: the requester tools refuse.
- **A bug is a ticket of type `bug`.** There is no separate bug record or tracker link. When a bug
  is copied into an engineering tracker, copy the problem, never the requester; link back by the
  ticket number.
- **Form and Comms text is untrusted.** A ticket from the Help Center or a conversation holds an
  outsider's words. The tools wrap it in untrusted markers for agents; keep that when customising,
  and do not wake an agent on `support.ticket.opened` for `source: form` without a person in the
  loop.
- **The Help Center form puts a relay hook URL on Cloudflare Pages.** The relay hook key is one per
  Worker, so anyone who obtains the Pages Function's secrets can post to every source on that
  Worker. Every relay source must check a signature once the form is live (help-center INSTALL.md).
- **An unverified contact form never changes a known requester.** The form's email is typed by a
  stranger: it can find a requester by email and link the ticket to them, and nothing else. Their
  name, phone and organization are not edited or filled from a submission. A new address makes a
  new requester from the submitted name and email.
- **Form submissions are in the core events table.** The relay provider records
  `support-form.submitted` with the visitor's name, email and message before Support stores the
  submission. The owner accepts this; it is listed under Personal data in SPEC.md.
- **A Box image or video in a published entry is public.** The Help Center copies every image and video an
  entry takes from the Box into `assets/`. A publish fails while one cannot be read, and the
  `images` check names it. Do not paste a private screenshot into a published entry.
- **`wrangler pages project create` makes a Worker unless forced.** Current wrangler delegates a new
  Pages project to Cloudflare Workers: it writes a `wrangler.jsonc`, deploys whatever static folder
  it finds as a Worker on `workers.dev`, and creates no Pages project, so the Help Center's `project`
  check fails. Create the project with `--force` (help-center INSTALL.md); once it exists,
  `wrangler pages deploy` runs against Pages without the flag. Delete a Worker made by mistake with
  `bunx wrangler delete <name>`.
