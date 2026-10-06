# Automation

Triggers that run the Box's actions without anyone pressing Run: when a time comes, run an action. Every triggered run goes through core's run funnel, so it shows up in the same run history as manual and agent runs.

## Highlights

- Time triggers over any action in the Box's action registry, with per-trigger time zone and params
- A Triggers editor in Settings with human-readable cron descriptions; edits apply at once
- Admin-owned triggers: every trigger records the admin it belongs to
- Run history and action pages in Settings
- An in-process scheduler with skip and orphan bookkeeping for missed or interrupted runs
