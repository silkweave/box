# Public sharing

Share an artifact with anyone on the internet through a public copy on Cloudflare, with a password and an expiry if you want them, while the Box itself stays private.

## Highlights

- A public link per artifact, served by a small Cloudflare Worker from R2 storage
- Optional password and expiry, set before the link ever opens
- Revoke or make private at any time; the link stops answering on the next request
- The Box is never exposed: it pushes copies out, and nothing on Cloudflare can call back in
- A status check that proves the setup end to end, and points at the failing part when it breaks

## Needs

- A Cloudflare account with R2 enabled (the free allowance covers typical use)
- A Cloudflare sign-in on the Box host for the deploy, by browser or a temporary API token
- Optionally a domain on Cloudflare for a custom public address; otherwise a workers.dev address
