# Upkeep

Send the wiki new material and an agent files it across every page it touches, one update at a time; daily and weekly sweeps on automation triggers keep links, index, frontmatter and stale claims in order, with each run in a maintenance history.

## Highlights

- `WikiUpdate` takes notes, a transcript, a decision or a correction and returns an id at once; an agent job files it as a source page, revises the pages it changes, updates `index.md` and logs every change as `<sender> via ingest <id>`
- One writer: updates and sweeps run one at a time in arrival order, so two jobs never revise the same pages against each other
- Durable records under `data/wiki/raw/updates/`: what waits survives a restart, and an interrupted job is tried once more, told what its first attempt already changed
- Each job closes with `WikiUpdateFinish`, which reruns the structural checks over what it touched (the whole wiki for a sweep) until they are clean
- Questions the job could not settle without a person are kept on the record, for `WikiUpdateGet` to relay
- `wiki-sweep-daily` (safe structural fixes, then an agent repairs broken links, index drift and frontmatter) and `wiki-sweep-weekly` (duplicates merged, stale claims and contradictions checked) as actions for automation triggers or Run Now
- Wiki > Health > Maintenance: every update and sweep with pages changed, questions, warnings, lint counts before and after, tokens and cost
- Jobs run as the agent principal on its default profile, under a floor of denied tools; prompt additions per kind in Settings > Wiki

## Needs

- The agent surface (`box.json` `workerdeck`) and an agent profile for the run-as principal (the Box agent by default) that takes session MCP servers
- `background.automation: true` on the one instance that should run the sweeps on schedule

## Requires

- [Automation](../../../automation/RECIPE.md)

## How it works

`WikiUpdate` (`wiki-update`) writes a record with status `received` under
`data/wiki/raw/updates/<id>.md` (frontmatter for state, body for the text) and queues it. The lane
starts one WorkerDeck job at a time as `features.wiki.upkeep.runAs` (null: `box.json` `agent`) on
that principal's preferred engine and default profile, with the Box's `box` MCP server, a floor of
denied tools, the unattended permission mode (`workerdeck.queue.permissionMode`) and questions
denied. Its working directory is `data/wiki` when a `workerdeck.cwdRoots` entry holds it, otherwise
the first root. The prompt is the shipped update or sweep instructions, this Box's addition for
that kind, what already landed on an earlier attempt, `index.md` and the last 20 log entries.

The job changes pages through the base page tools (`WikiPageWrite`, `WikiPageEdit`,
`WikiPageRename`, and `WikiPageDelete` in the weekly review), passing its id as `job`. The base
wiki asks the upkeep lane, through the core port `wikiUpkeepLane()`, whether the caller is that
job's principal and the job is running, and logs the change as `<requester> via <kind> <id>`. The
record's page tally comes from those log entries. `WikiUpdateFinish` records the job's summary and
questions and returns the structural findings still open; the job fixes them and calls it again.

A sweep action queues a sweep record (requester: the system principal) and returns at once: the
automation run reads "queued", and the sweep's outcome is in the maintenance history. A sweep of a
kind already waiting or running is not queued twice. Before its job starts, the server counts lint
findings, applies the safe structural fixes (attributed to the sweep) and hands the job the
remaining findings, the pages, those changed in the last 7 days, open query pages older than 30
days and recent failed updates. After it, the record gets the lint count again and `log.md` a
`sweep` entry.

Source: `features/wiki/core/upkeep/` (records, prompts, settings, the sweep actions),
`features/wiki/server/upkeep/` (`WikiUpkeepController`, `WikiUpkeepService`) and
`features/wiki/web/upkeep/UpkeepHistory.tsx`. The port is base source in
`features/wiki/core/powerups.ts`.

### Tools and actions

| MCP tool | CLI | tRPC | who | what |
|---|---|---|---|---|
| `WikiUpdate` | `wiki-update` | `wikiUpdate` | any principal | `text` (up to 65,536 characters, in full), optional `title` (120); returns the record and how many are `ahead` |
| `WikiUpdateGet` | `wiki-update-get` | `wikiUpdateGet` | any principal; the text only for the sender, the run-as principal or an admin | one update or sweep: status (`received`, `processing`, `done`, `failed`), progress, pages, summary, questions |
| `WikiUpdates` | `wiki-updates` | `wikiUpdates` | any principal | the history without text, newest first (`limit` 1 to 100, default 30), plus `waiting`, `running`, `held` |
| `WikiUpdateFinish` | `wiki-update-finish` | `wikiUpdateFinish` | the run-as principal, for the running record | the job's close |

| action | label | group |
|---|---|---|
| `wiki-sweep-daily` | Wiki daily sweep | Wiki |
| `wiki-sweep-weekly` | Wiki weekly review | Wiki |

The actions are in the wiki's core manifest (`actions: WIKI_UPKEEP_ACTIONS`), so they are in the
ops registry for automation triggers and Run Now. Without the server lane in the process, they fail
with the reason.

### The lane

- **Single writer, FIFO.** The queue is the records with status `received`, oldest first.
- **Attempts.** At most 2 per record. A job that fails is retried once with a resume note listing
  what already landed. At boot, a record that was `processing` is tried once more (attempt + 1) or,
  on its last attempt, failed. A refusal before the job ran (no profile, no tools, toolset problem)
  fails at once.
- **Durations.** WorkerDeck stops a job after 20 minutes (update, daily sweep) or 45 minutes
  (weekly review). One silent 5 minutes past that is cancelled and treated as lost.
- **No worker yet.** The lane waits 30 seconds and tries again.
- **Boot hold.** With `background.automation` false at boot, waiting records stay held (Health
  shows a notice, `WikiUpdates` reports `held: true`); the next `WikiUpdate` or sweep releases them
  and they run first. With it true the lane resumes on its own.

### The floor

Always denied to upkeep jobs (as `mcp__box__<tool>`): `WikiAsk`, `WikiAskAnswer`,
`WikiAnswerSave`, `WikiUpdate`, `WikiSettingsSave`, `WikiLintFix`; `WikiPageDelete` too, except in
the weekly review (merging duplicates). Where the engine filters built-in tools (Claude), `Bash`,
`Edit`, `Write`, `NotebookEdit`, `Task` and `Agent` are denied, so the vault changes only through
the tools. A permission request is denied at once and noted in the record's progress. Every other
Box tool stays as the run-as principal holds it; `features.wiki.upkeep.toolset` adds other MCP
servers (a system of record to check claims against) and may deny more.

Web: the jobs use their engine's own web tools, sparingly, for public facts such as a vendor price
or a version, citing the URL. Under the unattended `auto` mode a Claude job's WebFetch is refused
unless the run-as profile allows it; INSTALL adds that rule.

### Settings

`box.json`:

```json
"features": { "wiki": { "upkeep": { "runAs": null, "model": null, "toolset": null } } }
```

- `runAs`: the principal the jobs run as; null is the Box agent (`box.json` `agent`).
- `model`: null is the profile's default.
- `toolset`: a toolset id from `agentMcp.toolsets`; null gives the jobs the Box's own tools only.

Prompt additions: `prompts.update`, `prompts.daily` and `prompts.weekly` in
`data/config/wiki.json`, edited in Settings > Wiki or with `WikiSettingsSave` (admins only); the
next job reads them. The schedule is the automation triggers' (`cron`, `timezone`), and the gate is
automation's `background.automation`.

### Without the powerup

`WikiStatus` reports `powerups.upkeep: false`. Wiki > Health shows a Maintenance section with the
upkeep powerup note, and Settings > Wiki shows the same note in place of the Update and sweep
prompt fields, each with an "Add the Upkeep powerup" Builder brief for administrators (members are told to ask an administrator). A page tool
call with `job` is refused. Agents still maintain the wiki by driving the page tools through the
`wiki` skill, and `WikiLintFix` applies the safe fixes by hand.

## Gotchas

- **A sweep run says "queued", not what it did.** Read the outcome in Wiki > Health > Maintenance
  or with `WikiUpdates`.
- **Nothing runs on a rehearsal checkout by itself.** With `background.automation` false the
  triggers do not fire and waiting records are held; Run Now and `WikiUpdate` still work.
- **Send the material, not a summary.** The job files what it is given; a summary loses the
  details the pages need.
