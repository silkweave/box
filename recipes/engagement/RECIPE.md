# Engagement

Help the team respond and amplify once content is flowing: pods of people who support each other's posts, one inbox of replies that need an answer, and verification that an engagement actually happened. Adapt it after Content is in use.

## Highlights

- Pods with members and curated pieces, and a derived engage queue per person
- A tactical inbox of replies and mentions with done, snooze and draft reply state
- Agent skills that draft replies and engagement comments for a human to post
- Verification of engagements from the engager's own side before karma is recorded
- Polls that put Reddit inbox items, GitHub notifications, LinkedIn comments and traction spikes on the events spine, for the inbox and any event trigger

## Builds on

- [Content](../content/RECIPE.md)

The tactical inbox fills from pulls of the [Data Sync](../data-sync/RECIPE.md) recipe (Hacker News in the base recipe, GitHub and Reddit engagement with its `github` and `reddit` powerups). The Reddit and LinkedIn polls need the matching Data Sync powerup (`reddit`, `linkedin`) at runtime; without it the poll says which powerup to add. Verifying x and LinkedIn engagements, and reading comments on members' LinkedIn posts, in the person's own browser uses core's browser lease.
