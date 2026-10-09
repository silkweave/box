# Adapt the sso recipe

This is the adaptation guide for the sso recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's docs/UPSTREAM.md, and its current
_docs/INTEGRATION.md before changing files. These recipe documents ship with core, so a Box has them
at `recipes/sso/`. The reference implementation does not: it lives in the Stack at `features/sso/`.
In a Box, run `box stack fetch --ref <recorded Stack SHA>` and read `<fetched stack>/features/sso/`,
so the documents and the code come from the same Stack revision.

## Prerequisites

- Existing Box backup and a recorded restore path for both data and matching application source.
- Core at a revision that has the email rule: `email` admin-only in `user-upsert` and unique in
  `upsertUser` (`sameEmail`, `normalizeEmail`, `readUserByEmail` in `packages/core/src/users/state.ts`).
  An older core needs `$upgrade` first.
- Builds on: **none, core only**.
- Packages, installed latest into the root workspace package: `xml-crypto`, `xmlbuilder2`,
  `@xmldom/xmldom`, `@peculiar/x509`. `reflect-metadata` is already a root dependency.
- The Box is reached over **HTTPS** at a stable address (for example `tailscale serve` or a gateway),
  from every browser that will sign in.
- A recorded source SHA in docs/UPSTREAM.md, and an integration entry with scope, target SHA,
  intended changes, and state in _docs/INTEGRATION.md.

## Owner decisions

Ask before changing anything:

1. **Base URL**: the stable https origin people reach the Box at (`features.sso.baseUrl`). It becomes
   part of the identity provider's identity; changing it later means reconfiguring every provider.
2. **Allowed email domains** (`features.sso.allowedDomains`): only users whose email is in one of them
   can sign in anywhere.
3. **Which providers** to register now (Claude is the preset), and for Claude, which Claude role each
   group gets (`box-admins`, `box-members`).

## Owner-only steps

- Verify the email domain in Claude (Organization settings, Identity) if it is not verified yet.
- Open Claude's SSO setup (Organization settings, Authentication, Setup SSO, Custom SAML) and read
  out the **ACS URL** and **Service provider entity ID**; paste the Box's three values back in
  (agent step 5) and map the attributes and groups.
- Turn on "Require SSO" in Claude only after the Verify steps pass, and only while an owner can still
  recover access.

## Integration

1. Copy/adapt `<fetched stack>/features/sso/` into the Box's `features/sso/{core,server,web}`.
   Register it: `packages/core/src/generated/features.ts`, `packages/core/src/generated/exports.ts`,
   `apps/server/src/generated/features.ts`, `apps/web/src/generated/features.ts`. Do not create a
   feature package or manifest.
2. Install the four packages into the root workspace package, then run `bun run typegen`.
3. No shipped migrations: both tables come from the model baseline at boot. A later change is a new
   migration, never an edit.
4. Set `features.sso.baseUrl` and `features.sso.allowedDomains` in `box.json`, then restart (`box app
   restart` in a Builder session). The first boot generates the signing key and certificate into
   `box.local.json`. Never print either; `sso-status` reports the certificate without the key.
5. Make sure every person who should sign in has their email set, in an allowed domain (Settings,
   Users; admin only). `sso-status` lists who is missing one.
6. Register each provider in Settings, SSO (or `sso-provider-save` from a person's own session; the
   system principal is refused). For Claude, use "Add Claude" and paste the ACS URL and the bare entity
   ID from the owner's dialog. Give the owner the SSO URL, issuer and certificate from the same page.

## Validation

Run `box verify` (build, typecheck, lint, core tests including `features/sso/core/sso.test.ts`,
server tests, `schema:check`) and record the actual result.

## Verify

1. `box sso-status` reports `configured: true` with no problems.
2. Signed in to the Box in a browser, open `<baseUrl>/auth/saml/metadata` as an admin: it downloads
   XML whose `entityID` is `<baseUrl>/auth/saml`.
3. With a non-owner Claude account in an allowed domain: start "Log in with SSO" at claude.ai. The Box
   shows "Signing in to Claude" and Claude signs the person in. Settings, SSO lists an `issued` row.
4. Signed out of the Box, repeat: the Box asks for sign-in first, then completes the same flow.
5. A user without an allowed email gets the "No sign-in email" page and an `email-not-allowed` row.
6. Only then turn on SSO enforcement in Claude.

## Remove

Turn off SSO enforcement at every provider first. Then remove the registration lines, `features/sso/`,
`features.sso` from `box.json` and `box.local.json`, and the four packages if nothing else imports
them. The tables stay until dropped by hand. Remove the recipe from the `recipes` ledger.
