# Ask

Ask the wiki a question and get one cited answer: an agent job reads the pages that matter (and, through a toolset, live systems and the web), checks every citation against the vault, and the asker can keep the answer as a query page.

## Highlights

- `WikiAsk` for any principal, from the graph's Ask box or as an MCP tool and `box wiki-ask`: waits up to 90 seconds for the answer, then hands back an id for `WikiAskGet`
- Each question is a WorkerDeck profile job on the Box worker, run as the agent principal on its default profile; no model keys of the wiki's own
- Answers cite pages as `[[slug]]`, web pages as Markdown links and live records as `(<system>: <id>)`, with a confidence: grounded, partial or none
- The server refuses an answer that cites a page the vault does not have, or a grounded or partial answer without citations, so the job fixes it before it counts
- Read-only by floor: the job never gets page mutations, `WikiAsk` itself or the shell
- Answers stay temporary for an hour; `WikiAnswerSave` keeps one as a query page linked to its sources and listed in `index.md`, attributed to the asker
- The graph narrows to the cited pages while an answer is open, with a live log while the job runs
- This Box's own instructions for every ask, edited in Settings > Wiki and read by the next job

## Needs

- The agent surface (`box.json` `workerdeck`) and an agent profile for the run-as principal (the Box agent by default) that takes session MCP servers
- Optionally, a toolset (Settings > Agent tools) for live systems of record the answers may read

## How it works

`WikiAsk` (`wiki-ask`) records the question in server memory and submits a WorkerDeck job as
`features.wiki.ask.runAs` (null: `box.json` `agent`) on that principal's preferred engine and
default profile. The session carries the Box's `box` MCP server as the run-as principal, with a
floor of denied tools, the unattended permission mode (`workerdeck.queue.permissionMode`) and
questions denied. Its working directory is `data/wiki` when a `workerdeck.cwdRoots` entry holds it,
otherwise the first root. The prompt is the shipped ask instructions, this Box's `ask` addition, the
question, any focus pages (up to 20, by path or slug) and `index.md` as a catalog.

The job reads with `WikiPage`, `WikiSearch`, `WikiPages` and `WikiGraph`, then reports once with
`WikiAskAnswer` (answer, confidence). Only the run-as principal may call it; the server checks every
`[[slug]]` against the vault and returns what to fix. A job that ends without reporting leaves its
final text as an `unchecked` answer. `WikiAskGet` (`wiki-ask-get`) follows an ask: status (`queued`,
`running`, `done`, `failed`), log lines, the answer and its token use.

Source: `features/wiki/core/ask/` (settings, prompt, answer check), `features/wiki/server/ask/`
(`WikiAskController`, `WikiAskService`) and `features/wiki/web/ask/` (ask box, answer pane,
`useWikiAsk`).

### Tools

| MCP tool | CLI | tRPC | who | what |
|---|---|---|---|---|
| `WikiAsk` | `wiki-ask` | `wikiAsk` | any principal | `question` (up to 4,000 characters), optional `pages`, `wait` (default true) |
| `WikiAskGet` | `wiki-ask-get` | `wikiAskGet` | the asker, the run-as principal, an admin | `askId`, optional `waitSeconds` 0 to 60 |
| `WikiAskAnswer` | `wiki-ask-answer` | `wikiAskAnswer` | the run-as principal | the ask job's own report |
| `WikiAnswerSave` | `wiki-answer-save` | `wikiAnswerSave` | the asker | writes the finished answer as a query page; saving again returns the same page |

`WikiAsk` and `WikiAskGet` read; `WikiAnswerSave` writes and belongs in internal toolsets only.

### Limits

- At most 3 asks in flight and 128 kept; beyond that `WikiAsk` answers 503 with when to retry.
- An ask is forgotten an hour after its job finished (a saved answer stays as its page). Asks live
  in the server process, so a restart forgets them too.
- A job with no result after 15 minutes is failed.
- `waitSeconds` is clamped to 0 to 600.

### The floor

Always denied to the job (as `mcp__box__<tool>`): `WikiPageWrite`, `WikiPageEdit`,
`WikiPageDelete`, `WikiPageRename`, `WikiLintFix`, `WikiAsk`, `WikiAnswerSave`, `WikiUpdate`,
`WikiUpdateFinish`, `WikiSettingsSave`. Where the engine filters built-in tools (Claude), `Bash`,
`Edit`, `Write`, `NotebookEdit`, `Task` and `Agent` are denied too. A permission request the
session raises is denied at once: nobody is there to approve it. Every other Box tool stays as the
run-as principal holds it; `features.wiki.ask.toolset` adds other MCP servers and may deny more.

### Web search

The wiki has no web backend of its own. A job uses its engine's own web tools when the profile
allows them (Claude WebSearch and WebFetch, Codex web search), only for public facts, sending only
the public topic. Under the unattended `auto` mode a fetch may be refused unless the run-as
profile's settings allow it; without web tools the answer says the web could not be checked. Any
other web provider joins Box-wide as an MCP connection (the mcp recipe) granted through a toolset.

Search inside the wiki uses the base recipe's search: by meaning and keyword when the OpenAI
embeddings key (`credentials.openai["*"].OPENAI_API_KEY`) is set, keyword-only otherwise.

### Settings

`box.json`:

```json
"features": { "wiki": { "ask": { "runAs": null, "model": null, "toolset": null, "waitSeconds": 90 } } }
```

- `runAs`: the principal the job runs as; null is the Box agent (`box.json` `agent`). It needs an
  agent profile for its preferred engine.
- `model`: null is the profile's default.
- `toolset`: a toolset id from `agentMcp.toolsets`; null gives the job the Box's own tools only. A
  toolset the engine cannot honour refuses the ask with the reason.
- `waitSeconds`: how long `WikiAsk` waits before returning the id, 0 to 600, default 90.

Prompt addition: `prompts.ask` in `data/config/wiki.json`, appended to the shipped instructions
under "This Box's instructions" (where they differ, it wins), up to 20,000 characters. Edit it in
Settings > Wiki or with `WikiSettingsSave` (admins only, because the job runs as the agent); read it
with `WikiSettings`. The next ask reads it; no restart.

### Without the powerup

`WikiStatus` reports `powerups.ask: false`. The graph has no Ask box: Find is its only input.
Settings > Wiki shows the Ask powerup note in place of the Ask prompt field, with an "Add the Ask
powerup" Builder brief for administrators (members are told to ask an administrator). Any
agent still answers from the wiki by driving the page and search tools through the `wiki` skill.

## Gotchas

- **The run-as principal needs a profile that takes session MCP servers.** Without one, `WikiAsk`
  answers 503 naming `features.wiki.ask.runAs` or the profile.
- **Saving is the asker's.** The run-as principal and admins can read an ask, but only the person
  who asked can save it.
- **A restart drops open answers.** Save what should last.
