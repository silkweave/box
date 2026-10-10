# Content

A writing pipeline that takes an idea from topic to published piece on each channel, with a human sign-off before anything goes out. Agent skills draft, refine and verify pieces against the team's voice and each channel's rules.

## Highlights

- Topics with briefs, owners and target channels, and one piece per channel
- A named transition machine where only a scheduled piece with a visible time can publish
- Per-channel profiles and layered voice files that drafts are checked against
- Gated publishers for LinkedIn and Substack
- Agent skills for drafting, refining, verifying, illustrating and publishing

## Builds on

- [Planning](../planning/RECIPE.md)

Publishing to LinkedIn needs the [Data Sync](../data-sync/RECIPE.md) `linkedin` powerup and publishing to Substack its `substack` powerup at runtime; without one, that publisher says which powerup to add. The LinkedIn newsletter-article path also drives the author's own browser through core's browser lease.
