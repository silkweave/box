---
name: setup-box
description: Stand up a new Silkweave Box from a fresh clone - check prerequisites, install core, help the team adapt selected recipes from the Stack, boot it, create the first admin, sign in, wire the MCP connection, and seed the team's own starting state.
---

# Set up a Silkweave Box

You are standing up a **Box**: one team's private instance of this stack. Your job is to get the
person from a fresh clone to a Box they are signed into, with the apps they actually want, with
their own starting state in it.

**Take this in order.** Each step's failure mode is called out because most of them fail silently.

**Talk to them like a colleague doing the install with them.** Ask the questions in step 3 and step
8 rather than guessing - the whole point of this product is that the Box is shaped to the team, and
you are the one shaping it. Do not dump a wall of commands and walk away.

---

## 0. Know what you are installing

Read `README.md` and `../../../docs/RECIPES.md` before you start so you can answer questions. The short
version, which you may paraphrase:

- A **core** (DuckDB warehouse, auth and users, the events spine, the ops kernel, the app shell)
  plus **recipes**: capabilities the Stack offers, such as Planning, CRM or Chat.
- A default consumer clone starts with core only. The open recipes' documentation ships in
  `recipes/<id>/`, and the Recipe Gallery adds whatever the recipe registry offers this Box. The
  team chooses recipes and an agent adapts each one: it fetches the recipe's docs and reference
  implementation with `box recipe fetch <id>`, integrates `features/<id>/` into the Box, and
  registers it as a feature. The result is source the team owns and adapts; there is no one-click
  install.
- Every Box also has a **mobile app** (`apps/mobile`, Flutter, optional). With core alone it is an
  empty shell with sign-in and Settings; recipes with a `mobile` powerup (chat, planning,
  notifications, artifacts) add their screens when the team chooses to include them. See
  `docs/MOBILE.md`.
- A Box is **one team's instance**: a checkout plus its own ignored `data/`, always beside the
  code. A second Box, or a throwaway, is a second checkout.

---

## 1. Prerequisites

```bash
bun --version       # must be 1.4.2 or newer; CI pins 1.4.2
```

- **Bun 1.4.2+** is the runtime and package manager (`engines` and `packageManager` in root `package.json`).
- **Nothing else is required.** DuckDB is in-process (`@duckdb/node-api`) - no database to install,
  no connection string.

Optional, only if they later want the feature that needs it: the `gh` CLI (GitHub signal pulls),
`uv`/`uvx` (the warehouse MCP server).

If Bun is older than 1.4.2, update it first. Everything downstream fails confusingly.

---

## 2. Create the team's branch and install

Check `git status` and the current branch first. On a fresh clone, create `box` (or the team's
chosen name). If already on a team branch, keep it; do not reset or discard existing work. If this
checkout already carries code in `features/`, it is not a fresh clone: say which recipes are
already adapted before continuing.

```bash
git switch -c box       # on a fresh clone only
bun install
bun run box:install
```

`bun install` writes `box.json` on a fresh checkout. `bun run box:install` puts the `box`
command on PATH by linking this checkout's shim into `~/.local/bin`. If that directory is not on
PATH, follow the printed instruction or use `bun run box -- <verb>` from the checkout until the
shell is reopened. If another Box was registered, the installer repoints only the default; commands
run inside a checkout still select that checkout. `box where` explains the selection.

## 3. Run guided first setup

Before opening the warehouse, review the machine principal in `box.json`. Its default is Nova
(`nova`), admin. The ID cannot be renamed after initialization. Then run:

```bash
bun setup --no-start
```

An owner who runs plain `bun setup` (or the `box.silkweave.dev` installer) in their own terminal
gets the same steps, after which setup starts `bun dev` and opens the sign-in link in the browser
when the Box is ready. An agent passes `--no-start` and boots the Box itself in step 4, so the
server stays visible and stoppable in the owner's shell tools.

Setup is a host-only operation. It:

1. names the machine principal (pass `--review` to confirm it before binding its identity);
2. asks for the first owner's user name and display name, suggested from the computer account;
3. offers the agents (Claude, Codex, both, or not now) as one menu;
4. creates a config dir of their own inside the Box, `data/agent/accounts/<owner>/<engine>`
   (0700), unless the owner explicitly reuses an existing `~/.claude` or `~/.codex` login;
5. writes `workerdeck` and `agentProfiles` to mode-0600 `box.local.json`;
6. creates the first human as an administrator;
7. stores the permanent owner token for the local Box CLI without printing it; and
8. prints a short-lived, single-use sign-in link (with `--no-start`; otherwise it starts the Box
   and opens the link).

A Box-only profile starts without a sign-in: the owner connects it in Settings > Profile (Claude
runs `claude setup-token`, Codex a device sign-in), and the dashboard's provider quest points
there. Setup never changes `~/.claude` or `~/.codex`. Detection of existing dirs reads directory
and login-marker existence only, never credential contents. No profile is also a supported result;
the provider quest remains open.

Setup refuses a populated Box and never rotates an existing credential or silently replaces a
custom owner mapping. A run interrupted before human creation can be resumed. For non-interactive
rehearsals use explicit `--owner`, `--name`, `--profiles codex,claude` (Box-only; the default
is Claude), `--existing-profiles codex,claude` (reuse this computer's login) or `--no-profiles`,
plus `--yes`.

## 4. Boot it

```bash
bun dev
```

The supervisor comes up on **:8190** and reverse-proxies Vite, so the browser uses one public port.
Both ports come from `box.json`; machine-specific overrides belong in `box.local.json`. Missing
signing keys are generated in that ignored local file. Background automation, chat, relay and every
feature capability under `background.features` remain off by default.

If setup configured a provider, the agent surface boots it. A configured directory without working
provider authentication remains a visible readiness failure instead of being reported as ready.
Leave the server running while signing in.

## 5. Manual owner fallback

The signed-out page retains a recovery path for installations that skipped `bun setup`:

```bash
box auth token <their-id> --name "Their Full Name" --quiet
```

On a Box with no human users, this creates the first administrator and prints a short-lived sign-in
link without printing the permanent token. The person can reveal that token later with
`box auth reveal <id>`. On a populated Box, adding another person requires `--create` and defaults
to member; add `--admin` only when intended. Existing IDs are refused, and replacing a live token
requires explicit `--rotate`.

There is no password and no network signup window. First-owner creation remains a process on the
Box host.

## 6. Sign in, then choose the first recipe

Open the sign-in link printed by setup. It works once and normally lasts 15 minutes; if it expires,
run `box auth login` (add the id when the Box has several people). Confirm the onboarding dashboard renders and check the browser console.
A blank page is a runtime failure that `box verify` cannot detect.

The owner quest is now complete. If setup configured a working Codex or Claude profile, the provider
quest is complete too. Otherwise finish provider sign-in or configuration before asking Builder to
change the Box.

Now ask which working surface the team wants. Core alone is supported. The onboarding dashboard
recommends a few recipes and links the Recipe Gallery (Work menu, `/recipes`), which lists the
recipes in `recipes/*/RECIPE.md` plus what the recipe registry offers this Box; **Adapt recipe**
opens Builder with a draft brief the owner reviews and sends. Whether it starts there or here, the
adaptation follows `$adapt`: run `box recipe fetch <id>` for the recipe's docs and implementation,
adapt `features/<id>/{core,server,web}`, update maintained registration and exports, install actual
imports, run `box verify`, and record the recipe with its fetched version and sha256 in the
`recipes` ledger of `box.json`. If the owner has an access key for more recipes and setup did not
store one (`box registry status` shows it), ask them to run `box registry key` in the Box folder
themselves: it reads the key from a hidden prompt and checks it. Never ask for the key in the
conversation and never print it. Migrations are the hard boundary: back up first and preserve every
shipped identity and body byte-for-byte.

When a recipe has powerups (folders under `recipes/<id>/powerups/`, such as `mobile`), ask which
they want now; each can be added later, and the adapt skill covers the steps, including recording each verified
powerup in the ledger. If they want the app at all, mention
that it needs the Flutter SDK to build and its own identity (bundle id, name, icon) before anyone
installs it, and point at `docs/MOBILE.md`. Core alone is a valid answer here too.

Tell the team plainly that adapted feature code is now theirs. Review the diff and validation
before committing it on the team's branch. Never include credentials or instance data and never
push customizations to upstream.

## 7. Wire external MCP clients

Guided setup stores the owner token as `mcp.token` in mode-0600 `box.local.json`, so the local
`box` proxy works without printing the credential. For an external MCP client, copy
`docs/examples/mcp.json` to the client's ignored configuration and have the owner privately obtain
the same token:

```bash
box auth reveal <owner-id>
```

Set the HTTP Authorization bearer header to that token. The optional warehouse entry needs
`uvx` and the absolute database path. Reconnect and confirm the Box tools respond. A 401 means the
principal token is missing, invalid or revoked.

## 8. Seed THEIR starting state - this is the part that matters

A fresh Box is empty, and an empty Box looks like a broken one. **Do not leave them staring at it,
and do not invent demo data.** Interview them and create real state through the MCP tools you just
wired up.

Ask what they are actually working on, then create it:

- **`planning`** - their real initiatives, with the tasks they already have in their head. This is
  the highest-value seed: it is the feature that works fully on day one and the one they will open
  tomorrow. Ask "what are the three or four things your team is working on right now?"
- **`crm`** - a handful of real accounts if they sell to anyone.
- **`chat`** - a room or two that match how the team already talks.
- **`sink`** - drop in a note they already have lying around.

Then **walk them through the UI once**, opening what you just created. A person who has seen their
own initiative on the board understands this product; a person looking at an empty grid does not.

---

## 9. Tell them the truth about what is not wired up

Do not oversell. Read `docs/VALIDATION.md` and relay what is relevant to the recipes they adapted.
The headline items:

- **Credentials.** Anything that reaches an external service needs
  the `credentials` section of `box.local.json`. Follow the shape in `docs/SETUP.md` and fill in only
  the channels they use. Every channel is optional.
- **Builder providers.** Guided setup declares Box-only Codex and Claude profiles; each still needs
  a valid subscription, connected in Settings > Profile. A declared profile is not a readiness
  claim. The in-chat assistant remains a separate feature decision.
- **Some pulls cannot be configured at all yet** - the reddit and browser-driven LinkedIn paths need
  an external gateway this repo does not ship, and there is no way to mint a LinkedIn member token
  from a fresh Box.
- **Tailscale is optional.** Everything above works on plain `localhost`. Tailscale as an identity
  source is designed but not built.

---

## 10. Hand over

Tell them where to go next:

- `recipes/<id>/AGENT.md` - how to customise a recipe they adapted. **This is the real product**:
  the Box is meant to be tailored, and those guides are written for you to follow on their behalf.
- `recipes/README.md` - every recipe the Stack offers, for the next one they want.
- `docs/SETUP.md` - the reference version of everything you just did.
- `AGENTS.md` - the map of the repo, for the next agent session.

Offer to keep going: the natural next step is picking one adapted recipe and shaping it to how
they actually work, using its `AGENT.md`.

---

## Failure modes, in the order you will hit them

| Symptom | Cause |
|---|---|
| Confusing module resolution errors after a rename | Stale `packages/core/build/`. Run `box build`. |
| Blank page, empty `#root` | A module-scope registry read. Check the console - `box verify` cannot see this. |
| Port collision with another Box | Set `server.port` and `server.vitePort` in `box.local.json`, then run `box dev`. **Never put a second Box on a port the first may hold.** |
| The UI shows old behaviour after a pull | The server serves a prebuilt `apps/web/dist`. Run `bun run --filter @silkweave/box-web build`, or use `box dev`. |

## Optional product branding

For a team name and artwork, follow [Branding a Box](../../../docs/BRANDING.md): edit the
build-time `brand` block of `box.json`, supply all four public artwork assets, then rebuild web
and server. The brand sits beside the agent identity in that file but is a separate choice, and
`box.json` can be tracked; local overrides belong in gitignored `box.local.json`; the artwork under `apps/web/public` is, so commit it on the team
branch.
