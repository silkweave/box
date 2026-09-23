# Automation

Cron schedules that run the Box's actions on time without anyone pressing Run. Every scheduled run goes through core's run funnel, so it shows up in the same run history as manual and agent runs.

## Highlights

- Cron schedules over any action in the Box's action registry
- A schedules editor in Settings with human-readable cron descriptions
- Run history and action pages in Settings
- An in-process scheduler with skip and orphan bookkeeping for missed or interrupted runs
- No tables of its own: schedules are configuration and runs are core's
