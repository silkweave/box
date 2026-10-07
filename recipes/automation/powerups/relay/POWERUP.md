# Webhook relay

Receive webhooks from any service on a Box that is never reachable from the internet: a small Cloudflare Worker takes the webhook, and the Box collects it over one connection it dials out to itself.

## Highlights

- A hook URL per source, served by the Box's own `box-relay` Worker; the Box itself stays private
- Nothing is lost while the Box is offline: the Worker keeps each delivery until the Box confirms it, for up to 7 days
- Payloads pass through untouched; each source's provider checks the signature and the schema on the Box
- Every delivery becomes a Box event (`<source>.<kind>`), so event triggers act on it: run an action, an agent prompt, or deliver a message
- A webhook ledger in Settings shows every delivery, recorded or rejected with the reason, with its raw payload
- A `custom` provider for curl and scripts, so a sender's payload can be tried before its own provider exists
- Costs close to nothing: the connection hibernates on Cloudflare between deliveries

## Needs

- The Automation recipe
- A Cloudflare account (the free Workers plan covers typical use; Durable Objects on SQLite storage are included)
- A Cloudflare sign-in on the Box host for the deploy, by browser or a temporary API token
- One Worker per Box: never point two Boxes at one Worker

## How it works

A sender posts to `https://box-relay.<account>.workers.dev/hook/<source>/<hook key>`. The Worker
stores the raw request (body bytes and headers, minus credentials) and answers 202. The Box holds a
WebSocket open to the Worker, receives the delivery, looks up `<source>` in its config, and hands it
to that source's provider: the provider verifies the sender's signature, validates the payload
against the sender's schema and maps it to events. The Box records the events, writes a ledger row,
and acknowledges; only then does the Worker forget the delivery. A delivery that fails to record is
not acknowledged, so the Worker sends it again on the next connect.

The `custom` provider takes `{"kind": "deploy.done", "fields": {...}, "dedup_key": "...", "actor":
"...", "subject": "...", "url": "..."}` and records `<source>.deploy.done`. With a secret set for
the source, the body must carry `X-Box-Signature: sha256=<HMAC-SHA256 of the raw body>`.
