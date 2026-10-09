# sso gotchas

The feature id (`sso`) is part of runtime registration, the path-mount id and the table names. Keep
it stable. The base URL, the IdP entity ID derived from it and the signing certificate are held by
every registered provider: changing any of them breaks sign-in at all of them until each is
reconfigured.

## Lockout

- **Turn off enforcement before removing anything.** With "Require SSO" on at a provider, a Box that
  is down, misconfigured, or has lost its signing key locks everyone out of that provider. Keep an
  owner able to recover access, and test a sign-in while the Box is stopped before enforcing.
- **The signing key is instance state.** It lives only in `box.local.json`, which warehouse backups
  deliberately exclude. Back it up separately with the rest of the local configuration, or a restore
  onto a new machine generates a new certificate and every provider must be updated.
- **A half-present pair is left alone.** If only one of `signingKey` and `signingCert` exists, the
  Box logs it and SSO stays off; it never guesses. Restore the missing half or remove both.

## Protocol details

- **WorkOS's RelayState is about 500 bytes.** Return it unchanged; do not enforce the SAML 80-byte
  limit.
- **`form-action` must allow redirects.** Browsers check the CSP `form-action` against the redirect
  chain after the POST, and WorkOS redirects to claude.ai. Restricting it to the ACS origin breaks
  the sign-in silently in the browser.
- **POST-bound AuthnRequests are not supported.** A signed-out browser POSTing to a path mount gets a
  401, not the sign-in redirect. All known providers in use send HTTP-Redirect.
- **Replay memory is per process.** A restart forgets answered request IDs. The provider's own
  `InResponseTo` check covers the gap.
- **Reloading the hand-off page refuses** with `request-replayed`: the request ID was spent. Start
  again from the provider.
- **IdP-initiated sign-in to Claude is unverified.** It is off by default per provider; confirm WorkOS
  accepts an unsolicited response and which `RelayState` it wants before turning it on.

- **Keep the top-level navigation check.** Artifacts share the Box origin and the viewer's session.
  Without `isTopLevelNavigation` in `server/sso/serve.ts`, any artifact could `fetch()` a sign-in URL
  and read a signed assertion for whoever views it. CSP framing rules do not cover this, and the
  supervisor relaxes `frame-ancestors` on HTML anyway.

## Identity

- **The email is the NameID; the Box user id is the `id` attribute.** Changing a person's email
  changes who they are at providers that key by email. Claude keys by `id`.
- **Emails are unique and admin-only to change** (core). A Box that already holds duplicates keeps
  them until one is changed; `sso-status` does not report duplicates.
- **A Box session is sufficient** (SPEC.md, Accepted risk). An admin principal that mints a sign-in
  link for someone can then sign in as them at every provider.

## Packages

- `@peculiar/x509` needs the `reflect-metadata` polyfill loaded before it. `keys.ts` imports it
  dynamically for that reason; keep the order if you move the code.
