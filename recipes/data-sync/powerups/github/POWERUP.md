# GitHub

GitHub numbers as signals: followers, repo stars and traffic and external PRs for each team member's GitHub account, plus the issue and PR threads awaiting a reply.

## Highlights

- One channel per account: the default account is `github`, every other one `github@<id>` with its own signals
- Followers, public repos, org followers, and per repo stars, views and unique visitors
- External OSS PRs counted from a search query the team writes
- An engagement pull that collects the last 14 days of threads involving the account and its participating notifications, stored as a snapshot other recipes may read
- Backfills for star history and a monthly OSS PR curve
- Each account uses its own token; a run never borrows whoever is logged in to `gh`

## Needs

- The Data Sync recipe
- The `gh` CLI installed on the Box host
- A GitHub classic personal access token per account, created by its owner

## How it works

The platform lives in `features/data-sync/core/github/` and is listed in `core/platforms.ts`. Its
actions are `github`, `github-engagement`, `backfill-prs` and `backfill-stars`. Each call runs
`gh api` with the account's `GH_TOKEN` from `box.local.json credentials.github.<account>` in the
environment, so the ambient `gh` login is never used. The `github` pull reads every account in
`box.json accounts.github` with a non-blank `login`: the profile, the `org` when set, each repo in
`repos` (stars, forks, and traffic where the token has push access), and the count for `ossPrQuery`.
It stores one snapshot per account channel and re-derives its signals. GitHub keeps only 14 days of
traffic, so traffic history exists only from regular pulls.

`github-engagement` uses the default account only and stores the `github-engagement` snapshot, with
no signals; other recipes may read it. Planning's PR rows ride the
`github` channel through core's signal hooks and are kept on every re-derive.
