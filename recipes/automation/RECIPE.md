# Automation

Triggers that run the Box's work without anyone pressing Run: when a time comes or a Box event arrives, run an action or an agent prompt, or (with Alerts) deliver a message. Every triggered run lands in the same run history as manual and agent runs.

## Highlights

- Time triggers over any action in the Box's action registry, with per-trigger time zone and params
- Event triggers on any kind the Box records (exact or `prefix.*`), with field filters, a daily cap and a chain depth limit that stops trigger loops
- Agent triggers: a prompt that runs unattended as a WorkerDeck job under an admin's agent profile, with a success marker line and an optional cheap gate prompt that decides whether the run goes ahead
- Deliveries: with the Alerts recipe, an event trigger posts a rendered message to a person or chat room (the alert rules)
- A Triggers editor in Settings with human-readable cron descriptions; edits apply at once
- Admin-owned triggers: every trigger records the admin it belongs to, and an agent trigger names who it runs as
- Run history and action pages in Settings
- An in-process scheduler with skip and orphan bookkeeping for missed or interrupted runs
