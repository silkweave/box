# Builder

Builder is the permanent shared workspace for Box administrators at **/builder**. The stable
supervisor serves a standalone Builder shell and its **/builder-assets/** assets while the editable
Box application runs separately. The shell embeds that application in a named same-origin iframe
for live Preview. Navigation across the boundary reloads the document so the recovery surface
remains reachable when an application build is unhealthy.

The current slice provides one shared Builder session for all administrators. Every administrator
in Builder can send turns, edit files, navigate their own Preview, review changes and use host
controls. Members are blocked from the Builder navigation and control APIs.

## Start and use a session

Start the Box with **box dev**, sign in as an administrator, and choose **Work → Build**. The supervisor
reports provider readiness and the application state. A missing provider profile or provider
sign-in is shown as a repairable readiness state; Builder does not silently choose another
administrator's credentials.

Starting a session is explicit. Opening Builder or loading its state does not submit a model turn.
Builder sessions prefer the provider's `auto` permission mode and fall back to `acceptEdits` when
automatic decisions are unavailable. They use a workspace-write capable profile. Administrators
can send turns that edit the dedicated Builder branch through the real WorkerDeck workspace
controls; provider permission requests remain visible in the shared conversation.

The Builder shell keeps the shared conversation in a persistent right-hand panel. Its workspace
views are:

- **Preview** embeds the editable Box application. The preview path follows ordinary in-app
  navigation, so the shell can return to the page that was being edited.
- **Files** provides the Builder session's repository file tree and editor. Administrators can
  inspect and edit files; unsaved editor changes block verification and finish in that browser.
- **Review** shows the current branch, changed files, checkpoints and diff, then runs verification
  before offering checkpoint and finish actions.

Closing the Builder panel returns to the previewed page without ending the shared session.

All administrators can send turns and respond to requests in the shared conversation. The shared
session keeps one provider profile, credential and billing context while multiple browsers can
participate.

The normal Box shell remains flat until its ordinary Assistant opens. **Work** opens Assistant; its
adjacent dropdown offers **Build** to administrators, even when Assistant is disabled. While
Assistant is open, the shell puts the full application, including its sidebar, inside an inset frame and places Assistant
outside that frame on the right. Closing or pressing Escape hides Assistant and preserves its
session. Ending a session is a separate explicit control. Builder Preview suppresses the Work control, so the embedded
application cannot create a second Builder loop.

## Preview browser control

Browser control is automatically available from Builder. When multiple administrators have a
Preview open, the broker binds the first eligible Preview and keeps that binding while it remains
available. The binding ends when that Preview navigates or reloads, when the browser disconnects,
or after five minutes without a browser action. Switching to Files or Review does not disable the
embedded Preview. The next command uses the first available Preview. Each administrator can still
navigate their own Preview manually.

The control channel supports both Codex and Claude Builder sessions. It is separate from the
WorkerDeck conversation and does not inject an MCP server into either engine. An agent with the
session id supplied by Builder can use the owner-local CLI:

Builder supplies this tool guidance once through WorkerDeck session instructions. It is not
appended to each administrator message and does not appear as repeated user content.

```sh
box builder browser --session <session-id> snapshot
box builder browser --session <session-id> inspect '{"ref":"dom-preview-1"}'
box builder browser --session <session-id> type '{"ref":"dom-preview-1","text":"hello"}'
box builder browser --session <session-id> select '{"ref":"dom-preview-2","value":"active"}'
box builder browser --session <session-id> scroll '{"x":0,"y":600}'
box builder browser --session <session-id> style '{"ref":"dom-preview-1","styles":{"backgroundColor":"#eef"}}'
box builder browser --session <session-id> navigate '{"path":"/signals"}'
box builder browser --session <session-id> screenshot
```

The available operations are `snapshot`, `inspect`, `click`, `type`, `select`, `scroll`, `style`,
`navigate`, and `screenshot`. Snapshots expose bounded DOM references for later inspect, click,
write, select, scroll, and style actions. Screenshots are DOM captures saved by the CLI as private
PNG files in `_docs/browser/`; they are not OS-level screen captures. The capture omits marked
private fields, secret-like controls, authentication and settings routes, scripts, frames, media,
and cross-origin assets. It is capped at 1600 pixels per side and 4 MB and does not embed fonts.
Clicks reject native form submission, links that open a new tab, and downloads. Secret detection
is heuristic, DOM capture is bounded, and this feature is not an OS sandbox.

The CLI talks to the owner-only local browser socket and requires the supplied session id and an
active Preview grant for every command. Its local transport is separate from WorkerDeck frames;
WorkerDeck messages are never accepted as browser-control commands.

## Host controls

The supervisor exposes the current application state and these administrator actions:

- **Maintenance pause** pauses Box automation, chat and relay/background work while the host is
  being reviewed or changed. The server enforces the pause and blocks non-admin access while it
  is active.
- **Backup** creates a host snapshot and reports its timestamp.
- **Restart** runs the repository's typecheck, lint and build checks, then asks the supervisor to
  restart the editable application and reports the resulting state. The authenticated control
  API accepts `check: false` for host repair when those checks cannot run; the Builder UI always
  uses the checked path.
- **End session** stops the shared Builder session while retaining its host record.
- **Restore a backup** is available to administrators. Select a snapshot timestamp and confirm the
  operation. Restore replaces Box instance data and configuration; the server requires
  an idle Builder runner and a clean Box at the matching source revision. It stops the editable
  process before restoring and rejects the operation when those preconditions are not met.

## Review and finish

Review is a server-backed gate over the current Git state. It displays the Builder live branch,
the integration target, changed files, checkpoints and a bounded diff. **Verify changes** records
the exact review fingerprint only after the repository verification command passes. If a dependency
file changed, verification first runs a frozen Bun install with scripts disabled while the editable
application is stopped. A missing lockfile, a failed command, a stale fingerprint or a source
change during verification leaves a failed record and requires a fresh review.

A checkpoint commits the reviewed work to the dedicated Builder branch and leaves the shared
session open. Finish requires that the submitted fingerprint is still the current passed
verification. The server rechecks the live branch and current worktree, creates a final checkpoint
when reviewed changes remain uncommitted, and fast-forwards the integration target locally. The
target branch is captured when Builder starts and its expected revision is carried through the
Builder lifecycle; unrelated movement or divergence is rejected.

After the local fast-forward, the supervisor restarts the editable application and requires a
healthy result. It then checks that the reviewed live revision and integration target are unchanged
and switches the checkout to the integrated target branch. A failed restart leaves the Builder live
branch and shared session available for repair. Finish never pushes to a remote.

Recovery is bounded to existing administrators. The stable supervisor should remain reachable
through an application failure. Existing administrator authentication uses a bounded fifteen-minute
lease while the application is unavailable, so the recovery surface can remain usable during an
outage. This is an authentication lease, not a recovery-time objective.

## Operating boundaries

The shared session is one host-level control surface on a dedicated live Builder branch. Starting
Builder requires a clean Git checkout, creates a new dedicated `builder/live/...` branch, captures
the integration branch and revision, and takes an offline backup before recording the session. The
server owns session selection, administrator access, maintenance state, backup, review, verification
and restore preconditions. The browser displays those states and never invents execution,
verification or recovery results.

Do not start a second server against the live instance's stores. Keep provider credentials and
permanent Box tokens out of transcripts. Builder backups include the instance database, uploads,
`box.json`, and `box.local.json`, so they can contain credentials and other secrets. Store them in
the private backup area and protect access to that storage. Before migrations, follow [Warehouse](WAREHOUSE.md)
and [Validation](VALIDATION.md), including complete store and upload backups and a rehearsed
recovery path.

Builder does not implement onboarding or feature installation. Attachment uploads are not
supported by the Builder gateway, although the upstream composer currently displays its attachment
control. Those workflows remain outside the Builder surface and must not be represented as
completed stages.

The file editor loads local language workers for syntax support. It does not load the complete
repository dependency graph as a language server, so TypeScript import diagnostics in the editor
are not a substitute for the repository typecheck.

The Builder WorkerDeck host belongs to the stable supervisor, outside the restartable editable
application. An editable application restart therefore leaves the shared Builder conversation
available. Restarting the supervisor itself is a different boundary: resuming a provider session
requires durable provider state, and an active turn can still be interrupted during shutdown. If an
idle session has no such state, Builder reports it as unavailable so an administrator can end it
and start anew. A cold supervisor with invalid configuration or no usable authentication needs
host-level repair.

The ordinary Box Assistant has a different boundary. Its WorkerDeck host is mounted inside the
editable application, so it does not provide Builder's supervisor-level restart guarantee. A
restart can interrupt an active Assistant turn; the normal shell reattaches an available session
when it regains focus, but a missing or terminal session must be started again. Closing the
Assistant panel preserves its session and is not the same as ending it.

## Preview bridge boundary

The embedded editable application sends the Builder shell its current route and document title
through the same-origin preview bridge, and advertises a versioned browser-control readiness state.
The shell binds a selected tab to the supervisor's separate browser-control channel. That channel
supports bounded DOM snapshots and references, inspect, click, type, select, scroll, style,
navigation, and DOM screenshot commands automatically for the first available Builder Preview.

Navigation is queued and then changes the iframe document. The route notification invalidates the
old generation and its references; the agent must take a fresh snapshot. Navigation does not return
a full after snapshot. The bridge still rejects arbitrary
JavaScript, eval, script injection, shell commands, unrestricted selectors, network proxying and
WorkerDeck frames as browser commands.

## Refresh the Builder UI

The live Preview iframe is the editable Box application. In development, branding and application
changes arrive through the app's build and Vite HMR; a normal app reload may be needed when a module
cannot be hot-replaced. The outer Builder shell is a saved build, so changes to its shell,
navigation or Builder-only presentation require `box builder refresh`.
That refresh does not rebuild the embedded application. A successful checked application restart
also refreshes the Builder snapshot. On success, each open tab offers **Reload Builder**; the
running shared session stays connected to its supervisor host, and WorkerDeck restores the composer
draft saved in that browser's local storage. No reload is forced during a turn or while someone is
typing. Save any editor changes before reloading.

A local coding agent or host operator can run `box builder refresh` from the checkout. This command
uses an owner-only Unix socket in `data/builder/`; it permits UI refresh only and does not need
Box credentials or permission to signal the supervisor. It is a local host capability, separate
from the authenticated browser control, which remains administrator-only. The supervisor must already
be running a version that supports this command.

New builds use versioned asset URLs, including branding artwork. A build failure leaves the current
UI available and reports the error. Previous releases remain in `data/builder/ui-releases/` so open
tabs can load their original assets. These generated releases are excluded from Builder data
backups; remove obsolete releases only after old tabs are closed, keeping the version named by
`data/builder/ui-current`. Legacy unversioned snapshots remain available for older tabs.
