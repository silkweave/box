---
name: consult
description: >
  The Box concierge - consult on any Box-related intent or flow. Use when someone asks "how do I…",
  "where do I put…", "what's the status of…", "what should I do next", "which skill do I use", "who
  do I ask about…", or states an intent without knowing the flow ("I want to post about X", "someone
  replied to my post", "I have an idea"). Also "/consult" followed by a question. Answers with where things live,
  where their work is in the pipeline, and the ONE next action - it explains and routes; it NEVER
  mutates state itself.
---

# /consult - the Box concierge

Map any intent onto the right Box flow, grounded in live state. This skill exists because of the
2026-07-20 first-run lesson: the pipeline worked, but nobody told the operator where they were, what
was next, or where things go. `/consult` is the answer to every "where / how / what now" question -
for a CEO as much as a developer.

**Hard rule: consult is read-only.** Query the warehouse, read docs and config *shapes* (never
secret values), and explain. Do not upsert, ingest, draft, verify, publish, send, or move anything.
When the answer is "run flow X", OFFER to kick it off and wait for an explicit yes - then invoke the
skill (which has its own guardrails) rather than doing the work inline.

## Mode - local checkout or remote plugin?

Decide where you are running before anything else. **Local** = the CWD is the Box checkout
(`data/docs/` exists on disk): follow the steps as written. **Remote** = this skill was installed on
a machine with no checkout: the repo, `bun run cli`, and the read-only `warehouse` MCP do not exist
here. Work over the `mcp__box__*` tools (`https://box.example.ts.net` over the tailnet, authed by
your `mcp.token` from `box.local.json`): ground state via `content-list` / `content-get` / `initiatives-get` instead of
SQL, docs via `doc-read`, voice styles via `voice-read`. Dashboard links are ALWAYS
`https://box.example.ts.net/<path>` - plain paths (e.g. `/content/<slug>`); the SPA moved off
hash routes on 2026-09-14, and an old `/#/<path>` link still lands right but do not write new
ones. Works from anywhere on the tailnet - Tailscale must be connected;
never hand out a `127.0.0.1` URL, that address is the Box host's own loopback and resolves nowhere
else. If an answer requires something with no remote path (anything that reads or writes repo files,
or any `bun run` script), say so and route that step to a session on the Box host - never fake it.

## Input

`$ARGUMENTS` is a free-form question or intent. Empty input means "orient me": show the operator
their in-flight work and the one next action for each.

## Step 1 - Know who is asking

The answer's shape depends on the operator:

- Resolve the acting user (the session's principal; if genuinely unclear, ask). Query
  `SELECT id, name, role FROM users` (read-only `warehouse` MCP) for context.
- **Calibrate the register by ROLE, not by name.** For an `admin` who works in the checkout: file
  paths, CLI and internals are fine. For everyone else: dashboard-first, plain language, the three
  verbs (**pick / answer / approve**), zero repo internals unless they ask. A non-dev should never
  be told to open a terminal as the primary path - if the terminal is currently the only path, say
  so honestly, name it as friction, and route that step to an admin.
  (Do not hard-code a person here. This skill ships to every Box; it named one team's developer
  until 2026-09-15.)

## Step 2 - Know what this Box HAS, then classify the intent

**Read the installed feature set before you route anything.** A Box starts with core and gains
features through agent-led source integration. A feature is present when its registered source is
in the Box; do not assume the full stack is installed.
Routing someone to a flow their Box does not have is worse than saying "not installed", because
they will go looking for it.

- **Local:** the directory names under `features/` ARE the installed set.
  A feature is installed when its directory carries `manifest.ts`. The entire parent directory
  can be absent on a fresh core-only clone; that means no features are installed.
- **Remote:** infer it from the tools you actually have. No `content-*` tools means no content; no
  `initiative-*` means no planning; and so on. Do not assume the full ten.

Then route against this table. **The `Needs` column is a gate, not a note**: skip any row whose
feature this Box does not have, and if the person asked for exactly that, say it is not installed
and route them to the feature integration instructions in `docs/FEATURES.md` and the selected
feature's documentation. Do not invent a package or registry workflow.
Rows with `-` are core and are always there.

The flows' own docs are the source of truth - read the linked doc before answering anything
non-trivial.

| Intent sounds like | Needs | Flow | Where it happens | Deep-dive doc |
|---|---|---|---|---|
| "I have an idea / a doc / an article worth something" | `sink` | Sink → ingest | drop in `data/docs/sink/` (or paste it), then `/ingest-sink <file>` | `features/sink/SPEC.md` |
| "I want to post about X / turn this into content" | `content` | Content pipeline | `/ingest-sink` → `/draft-content <slug>` | `features/content/OPERATOR.md` (operator map) |
| "improve / change / fix my draft" | `content` | Refine | `/refine-content <id> <direction>` | `features/content/SPEC.md` |
| "is it ready? check it" | `content` | The gate | `/verify-content <id>` | `features/content/SPEC.md` |
| "publish / ship it" | `content` | Human-gated publish | approve in dashboard → publish path per channel | `features/content/SPEC.md` § Actions |
| "someone replied / commented on my post" | `engagement` | Inbox | dashboard Inbox → `/draft-reply <item-id>` | `features/engagement/SPEC.md` |
| "support a teammate's post" | `engagement` | Pods / engagement | engage queue → `/engage <pod-content-id>` | `features/engagement/SPEC.md` |
| "how are my posts / numbers doing" | `data` | Signals | dashboard Signals; "update signals" = fresh snapshot | `docs/WAREHOUSE.md` |
| "track this work / what are we working on" | `planning` | Planning | dashboard Initiatives; `/ingest-sink` (work route) | `features/planning/SPEC.md` |
| "I can't log in / need access / a link" | - | Users/auth | Send a sign-in link: Settings → Users → **Send sign-in link**, `bun run cli user-link`, or `box auth login <id>`. Short-lived, single-use, safe to send | `docs/AUTH.md` § 1.7 |
| "lost my token / my MCP config needs it" | - | Users/auth | an admin reveals it (Settings → Users → **View access token**, or `box auth reveal <id>` on the host). NEVER `user-invite` - that rotates. Read Step 2a first | `docs/AUTH.md` § First run |
| "my MCP won't connect / no `box` tools / everything 401s" | - | Access | diagnose with Step 2b before anything else | `docs/SERVER.md` § 7 (running and serving) |
| "run this automatically / on a schedule" | `automation` | Automation | schedules + alert rules (an admin arms them) | `features/automation/SPEC.md` + `features/alerts/SPEC.md` |
| "add / install a feature this Box lacks" | - | Integration | Read the feature source and gotchas, integrate its core/server/web code, update registration, then run the validation chain | `../../../docs/FEATURES.md` |
| "how does the whole thing work" | - | Orientation | this skill's Step 4 output, plus the SPEC of each INSTALLED feature | `../../../docs/FEATURES.md`, then `features/<id>/SPEC.md` |

Multiple intents in one question is normal - answer each, but keep ONE primary next action.

## Step 2a - Access tokens (the most common self-inflicted outage)

Any question that touches signing in, MCP setup, "my connection stopped working", or "can I get a
token" gets this model stated plainly, because getting it wrong takes the asker's other integrations
down. The facts (`docs/AUTH.md` § First run):

- **One token per person, forever.** A user has exactly ONE access token. It is the single credential
  for BOTH the dashboard login and every MCP/CLI connection they have configured.
- **It never expires.** There is no TTL on the token. Keep it and you never need another.
- **Minting is a password reset, not "add a device".** `user-invite` / `box auth token` OVERWRITES
  the token; the previous one dies instantly and every place it was pasted (each machine's MCP
  config, saved magic links, scripts) breaks. Browser sessions already signed in are unaffected
  (they hold a cookie, not the token) - which is why the damage shows up as a dead MCP, never as a
  logout. Sessions no longer expire either (2026-07-29), so a signed-in browser stays signed in.
- **A lost token is recoverable - reveal it, do not reset it.** The token is encrypted at rest,
  reversibly, exactly so an admin can re-read it. Settings → Users → **…** → **View access token** (the
  dashboard route, and what a non-dev should be told) or `box auth reveal <id>` on the Box host.
  Both re-print the SAME token and break nothing. There is deliberately NO MCP tool for this since
  2026-09-15: an agent must not be able to read anyone's permanent credential. If the person only
  needs to GET IN, send a sign-in link instead - that IS available to an agent (`user-link`).
- **Rotate only when it leaked**, or when it is genuinely unrecoverable (revoked user). Say out loud
  what will break and who has to re-paste it before offering that path.

So the answer to "I need a token" is almost always **"you already have one, here is how to see it
again"**, followed by: save it in a password manager (1Password/Keychain), not in a chat thread. If
the asker is not an admin, this is an admin's action to run, routed - never assigned to them.

## Step 2b - "my MCP isn't connecting" / how a machine reaches the Box

**Establish WHICH MACHINE first. Everything below branches on it, and answering the wrong branch is
itself one of the dead ends** (seen 2026-07-29: someone was told to run a plugin command in a session
that had the checkout on disk and therefore no plugin). The test: is the Box checkout on this
machine - does `<checkout>/data/docs/` exist?

### A. The checkout is right here (the Box host, or any clone of it)

- **Skills come from the checkout**, symlinked per teammate
  (`~/<user>/.claude/skills/consult` → `.claude/skills/consult`). They are **unprefixed**
  (`/consult`, never `/<box>:consult`) and **live**: a `git pull` in the checkout updates them
  immediately - no install, no plugin update, no restart.
- **There is no plugin and no marketplace here, deliberately.** `/plugin marketplace update <box>`
  answers `Marketplace '<box>' not found. Available marketplaces:` - that is **correct output where
  the checkout is, not a fault**. Never "fix" it by installing the plugin: that shadows the
  unprefixed skills with duplicate `/<box>:*` copies of the same thing.
- **Data access is `bun run cli <tool>`** plus the read-only `warehouse` MCP from the repo's
  `.mcp.json`. **`mcp__box__*` is OPTIONAL here** - some teammates carry a personal entry in
  `~/<user>/.claude.json`, some do not. Its absence on a machine with the checkout is **not** a
  fault to fix, because every skill's Local mode runs on `bun run cli`.
- A failing `bun run cli` here has **three** causes, and only one is the service:
  1. **The harness permission fence** (most confusing, found 2026-07-29). A Claude session whose CWD
     is a *different* repo has **Bash** against the checkout path denied by the auto-mode
     classifier, so `bun run cli` and direct DuckDB reads all refuse. The fence is **tool-shaped, not
     path-shaped**: `Read` and `Edit` work fine on those same paths, which makes it look arbitrary
     from inside. **Match on the denial text - it names the classifier, not a connection error.**
     Fix: start the session inside the checkout.
     Do NOT touch the service or anyone's token.
  2. **The server is down** - only after the denial text has been ruled out. Check the service.
  3. **Access** - almost never an issue here, since `bun run cli` reads the local warehouse.
  Ask which one before acting: restarting a healthy service because a session was started in the
  wrong directory is the exact wrong move (it happened, and blocked an `/ingest-sink` run).

### B. Remote, over Tailscale

Configure the MCP client's HTTP endpoint to the Box's `/mcp` URL and its Authorization bearer
header to the intended principal's access token. Follow that client's configuration format.
When using the local `box` proxy, configure `mcp.url` and `mcp.token` in `box.local.json`.
Do not print token values or place them in tracked configuration.

If tools return 401, check the configured principal and whether its token was revoked. If the
endpoint cannot be reached, check Tailscale connectivity and server availability. Do not restart
a healthy service to fix a missing client configuration.

Two rules worth stating in the answer: the token is **per person** (borrowing someone else's makes
every write attribute to them), and changing the env var needs a **session restart** to take effect.

## Step 3 - Ground in live state (read-only)

Never answer "where are you" from memory. For anything about the asker's work in flight:

```sql
SELECT id, status, title FROM content WHERE json_extract_string(metadata,'$.author') = '<user>'
  OR initiative_id IN (SELECT id FROM initiatives WHERE owner = '<user>');
SELECT id, status, kind FROM initiatives WHERE owner = '<user>' AND status IN ('planned','active');
SELECT id, status, title FROM tasks WHERE assignee = '<user>' AND status NOT IN ('done','dropped');
```

Adapt as needed. For setup questions, run the read-only parts of the ingest-sink preflight (user row
status, voice overlay existence, credentials.json **key shape only** - never print values) so the
answer includes real blockers, not guesses.

## Step 4 - Answer

Structure every answer as:

1. **The direct answer** in the operator's register - what this is, where it lives, how the flow
   works, in a few sentences. Name which of their three verbs (pick/answer/approve) it involves, if
   any.
2. **Where they are** - for anything in flight, the stage map with a you-are-here marker per piece
   (`features/content/OPERATOR.md` operator rule 1):
   ```
   IDEA ──▶ DRAFT ──▶ APPROVED ──▶ SCHEDULED ──▶ PUBLISHED
              ▲ ai-checked-the-founder/linkedin (2 findings still to accept)
   ```
3. **ONE next action** - dashboard link first, slash command second. If several things are in
   flight, one action per item, most urgent first.
4. **Blockers + owners** - anything ahead that will stop them (credentials, approvals, a revoked or
   mislaid access token - tokens never expire, see Step 2a), each with who fixes it. A blocker only
   an admin can clear gets routed, not assigned to the asker.
5. **The offer** - "want me to start <flow>?" Only on an explicit yes, invoke the skill. If the yes
   would trigger work owned by a different author (their pick, their approval), apply operator rule
   2: route the decision to that author instead.

## Step 5 - Capture the gap

If the question exposed a hole - an intent with no flow, a flow that needed the terminal for a
non-dev, a doc that answered wrongly - say so in one line and offer to log it (a sink note for
ideas if this Box has `sink`, an initiative if it has `planning`, otherwise just say it plainly and
name who owns it). Consult is where the map's gaps get
discovered; don't let them evaporate.
