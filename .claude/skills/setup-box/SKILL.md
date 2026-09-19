---
name: setup-box
description: Stand up a new Silkweave Box from a fresh clone - check prerequisites, install core, help the team integrate selected reference features, boot it, create the first admin, sign in, wire the MCP connection, and seed the team's own starting state.
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

Read `README.md` and `../../../docs/FEATURES.md` before you start so you can answer questions. The short
version, which you may paraphrase:

- A **core** (DuckDB warehouse, auth and users, the events spine, the ops kernel, the app shell)
  plus **opt-in reference apps**.
- A default consumer clone starts with core only. The team chooses reference features from this
  stack and an agent integrates the selected `features/<id>/{core,server,web}` source into the Box.
  The result is owned and adapted by the team; there is no package download or registry adoption.
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
chosen name). If already on a team branch, keep it; do not reset or discard existing work. If this checkout already
carries apps in `features/`, it is not a fresh clone: say which apps are present
and ask before integrating more.

```bash
git switch -c box       # on a fresh clone only
bun install
bun run box:install
box build
```

`box verify` includes the workspace build before the tests, so it also works on a fresh checkout.
Build output is needed when a package resolves outside the source export condition.

**`bun run box:install`** puts the `box` command on their PATH, by symlinking `~/.local/bin/box` at
this checkout's `packages/cli/bin/box`. From here on, every command in this skill can be typed as `box ...`
for the supported public verbs - and more to the point, so can every command they will ever run against
their Box from outside the repo. Two things to watch and both are printed:

- If `~/.local/bin` is not on their PATH the script says so and gives them the export line. Until
  they add it and reopen the terminal, `box` is not a command and they should use `packages/cli/bin/box` from the checkout.
- If they already have a Box, this REPOINTS the default. It is only a default: `box` acts on the
  checkout you are standing in and falls back to the registered one, so the first Box keeps working
  from inside itself. `box where` answers the question at any time.

---

## 3. Choose the apps - ASK, do not assume

This is where the team chooses its working surface. Features are reference source, so read the
feature documentation and gotchas, then integrate the source into this Box and make it fit.

The short version is:

```bash
read features/<id>/ documentation        # inspect selected source and gotchas
integrate core, server and web source     # adapt paths and runtime wiring
update maintained registration and exports
bun install
box build
box verify
```

Offer core alone too - it is a supported answer. A blank Box shows Settings and still has auth,
users, warehouse, ops and the agent host; skip feature integration to keep it that way. Add the
packages required by a feature's imports to the workspace package.

Once verification passes, review `git diff` and `git status`, stage the setup changes and commit
on the team's branch. Never include credentials or tenant data, never absorb unrelated existing
work into that commit, and do not push customisations to upstream. Keep the branch for later core
merges.

**Tell them plainly: the feature code is now theirs.** Customising it is the intended use. Taking a
newer source revision later means reading its changes and applying the ones they want. Read
`../../../docs/FEATURES.md` and the feature's documentation for the detail.
If verification fails, fix it before booting or committing a claimed working setup.

---

## 4. Boot it

Before the first boot or auth command, choose the machine identity with the owner. Defaults are
Nova (`nova`), admin. `bun install` has already written `box.json`; edit its `agent` block,
`{"agent":{"id":"nova","name":"Nova","role":"admin"}}`. The ID cannot be renamed after
initialization. Explain that admin grants the agent credential/configuration and service controls;
member retains the previous restriction. Read `docs/AUTH.md`'s identity-and-role section. Do not
rewrite an existing identity or silently promote an existing Box when its config is missing.

```bash
box dev
```

Nest comes up on **:8190** and reverse-proxies the Vite dev server, so the browser only ever uses
:8190. Both ports come from `box.json` (`server.port`, `server.vitePort`) if 8190 is taken;
Use `box.local.json` for machine-specific port overrides.

`bun install` writes `box.json` on a fresh checkout. The first boot creates runtime stores and
the identity lock; missing signing keys are generated in gitignored `box.local.json`.

Leave this running and work in a second terminal.

---

## 5. Create the first admin

```bash
box auth token <their-id> --name "Their Full Name"    # or: box auth token <their-id> ...
```

On a Box with **no human users yet**, this creates that id as an **admin** and mints its token.
On a populated Box, use `box auth token <their-id> --create --name "Their Full Name" --quiet`
to explicitly add a **member** on the host. Add `--admin` only when an admin is intended. Existing
IDs are refused by `--create`; it cannot overwrite a person's profile or credential. These are
host commands; no network bootstrap endpoint is opened.

It prints **two different things**, and telling them apart is the whole point:

- **The access token.** Permanent, exactly one per user, and the credential for BOTH the browser
  login AND every MCP connection. Minting another revokes it and breaks all of them. Tell them to
  save it in a password manager now; it can be re-read later with `box auth reveal <id>`, but do
  not rely on that. It is a password: never in a URL, never in a chat message.
- **A sign-in link.** Short-lived (15 minutes) and single-use, so the first sign-in is a click
  rather than pasting a 32-character secret into a browser. It carries no permanent credential,
  which is what makes it safe to send. More with `box auth link <id>`.

If you are running this on someone's behalf, use `--quiet`: it prints ONLY the sign-in link, so the
permanent token never lands in your transcript. They run `box auth reveal <id>` themselves when
they need it for MCP.

---

## 6. Sign in

Open the sign-in link it printed. (It works once; if it expired, `box auth link <id>` mints
another.) Confirm in a browser that the shell renders.

**Check the browser console.** `box verify` has no runtime step - it cannot see a white screen. If
the page is blank, that is the failure mode to look for, not a server error.

---

## 7. Wire the MCP connection

This is what lets an agent read and write the Box directly.

```bash
cp docs/examples/mcp.json .mcp.json
```

Set the example's HTTP Authorization bearer header to the intended principal's token. The MCP
client config is gitignored because it contains credentials. For the local `box` proxy instead,
set `mcp.token` and optionally `mcp.url` in `box.local.json`.

The optional `warehouse` entry needs `uvx` and the absolute database path. Omit it if it is not
needed. Reconnect the MCP client and confirm the Box tools respond. A 401 means the supplied
principal token is missing, invalid or revoked.

---

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
- **`content`** - a topic and a draft if content is part of their work.

Then **walk them through the UI once**, opening what you just created. A person who has seen their
own initiative on the board understands this product; a person looking at an empty grid does not.

---

## 9. Tell them the truth about what is not wired up

Do not oversell. Read `docs/VALIDATION.md` and relay what is relevant to the features they kept.
The headline items:

- **Credentials.** Anything that reaches an external service needs
  the `credentials` section of `box.local.json`. Follow the shape in `docs/SETUP.md` and fill in only
  the channels they use. Every channel is optional.
- **The agent assistant** (a Claude/Codex seat inside chat) is **off by default** and is an advanced
  install: it needs the `workerdeck` section of `box.json` (start from `docs/examples/workerdeck.json`)
  AND their own Claude or Codex subscription.
- **Some pulls cannot be configured at all yet** - the reddit and browser-driven LinkedIn paths need
  an external gateway this repo does not ship, and there is no way to mint a LinkedIn member token
  from a fresh Box.
- **Tailscale is optional.** Everything above works on plain `localhost`. Tailscale as an identity
  source is designed but not built.

---

## 10. Hand over

Tell them where to go next:

- `features/<id>/AGENT.md` - how to customise a feature they kept. **This is the real product**: the
  Box is meant to be tailored, and those recipes are written for you to follow on their behalf.
- `docs/SETUP.md` - the reference version of everything you just did.
- `AGENTS.md` - the map of the repo, for the next agent session.

Offer to keep going: the natural next step is picking one feature and shaping it to how they
actually work, using its `AGENT.md`.

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
