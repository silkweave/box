# `sso` - the Box as the team's identity provider

The Box becomes a **SAML 2.0 identity provider** for outside services, starting with Claude (Team and
Enterprise SSO run through WorkOS). Box users are the directory: a person who is signed in to the
Box, and whose `users.email` is in an allowed domain, signs in to a registered service provider
without another password. Revoking the Box user stops their next SSO sign-in.

Everything stays behind the Box's own address. SAML moves every message through the user's browser,
so no service provider ever connects to the Box; the Box only has to be reachable from the
browsers of the people signing in (for example over the tailnet).

- **dependsOn**: nothing but core. It uses core's path-mount port (`registerPathMount`,
  `packages/core/src/path-mounts.ts`) to serve `/auth/`, the Box session, the users directory and the
  events spine (`recordEvent`). It relies on core's email rule (below).
- **Depended on by**: nothing.
- **Removal**: turn off SSO enforcement at every registered service provider **first**, or their
  users are locked out. Then unregister it, remove `features/sso/` and `features.sso` from
  `box.json` and `box.local.json`. Its tables stay until deleted by hand.

## Scope

- SAML 2.0 IdP: HTTP-Redirect binding for the AuthnRequest, HTTP-POST binding for the Response.
- SP-initiated sign-in, and IdP-initiated sign-in from the Box per provider (off by default).
- A service-provider registry with a Claude preset, an assertion audit log, IdP metadata XML.

Not in scope: single logout, encrypted assertions, SCIM, signed AuthnRequest verification, acting as
a service provider. Later protocols (OIDC, OAuth 2) are powerups under the same `/auth/` prefix.

## URLs

The feature owns the top-level prefix `/auth/` as **one** path mount (id `sso`,
`server/sso/serve.ts`) and dispatches by protocol. The bare `/auth` stays an SPA path; no client
route may be added under `/auth/`. Core's own auth API is `/api/auth/` and is unaffected. Builder's
Preview browser refuses `/auth/...`.

| Path | Method | What |
|---|---|---|
| `/auth/saml` | - | The IdP entity ID (an identifier, never fetched). |
| `/auth/saml/sso` | GET | SSO endpoint: `SAMLRequest` (deflated, base64) and optional `RelayState`. |
| `/auth/saml/start/<provider>` | GET | IdP-initiated sign-in to `<provider>`, when that provider allows it. |
| `/auth/saml/metadata` | GET | IdP metadata XML, as a download. Admin only. |
| anything else under `/auth/` | - | 404 page. Methods other than GET and HEAD: 405. HEAD never issues an assertion. |

All URLs are absolute against `features.sso.baseUrl`. The entity ID, base URL and signing
certificate are **frozen once a provider is registered**: changing any of them breaks every provider
configured against them.

## The sign-in flow

1. A provider redirects the browser to `/auth/saml/sso?SAMLRequest=...&RelayState=...`.
2. Core's path mount authenticates the request. A browser without a Box session is sent to
   `/?next=<path and query>`, signs in (token or sign-in link), and the SPA returns it to the full
   SSO URL (`apps/web/src/lib/returnPath.ts`). The `box_session` cookie is `SameSite=Lax`, so it is
   sent on the provider's top-level redirect.
3. `answerAuthnRequest` (`core/flow.ts`) checks the caller, then the request.
4. The mount answers with a small page that POSTs `SAMLResponse` and `RelayState` to the provider's
   registered ACS URL. It submits itself and also shows a "Continue" button.
5. Every decision, issued or refused, is one audit row and one `sso.assertion` event.

A refusal is an HTML page with a title, the reason, the next step and the refusal code, never a raw
error.

**Top-level navigations only.** `/auth/saml/sso` and `/auth/saml/start/...` answer only when
`Sec-Fetch-Dest` is `document` and `Sec-Fetch-Mode` is `navigate` (or the headers are absent, as from
curl). Pages on the Box's origin, artifacts above all, run unsandboxed with the viewer's session; a
script fetch or a frame would otherwise read the signed response. Refused with `not-top-level`
(not logged). The Builder supervisor rewrites every HTML page to `frame-ancestors 'self'` for its
Preview, so the page's own `frame-ancestors 'none'` does not hold in a supervised Box; this check
does.

### Caller checks (`checkCaller`)

| Code | Refused when |
|---|---|
| `not-configured` | `baseUrl`, `allowedDomains`, the signing key or the certificate is missing. |
| `bearer-refused` | The credential is a bearer token (MCP clients, scripts, agents). Only a browser session signs in. |
| `system-refused` | The principal is the configured system principal. |
| `user-inactive` | The user is not active. |
| `email-not-allowed` | `users.email` is empty or outside `allowedDomains` (exact domain match, case-insensitive). |

### AuthnRequest checks

| Code | Refused when |
|---|---|
| `request-malformed` | Not base64 raw DEFLATE, over 16 KB decoded, contains a DTD or entity, not a SAML 2.0 `AuthnRequest`, or no `ID` or `Issuer`. |
| `unknown-provider` | `Issuer` matches no registered entity ID. |
| `provider-disabled` | The provider is turned off. |
| `acs-mismatch` | `AssertionConsumerServiceURL` is present and differs from the registered ACS URL. A request without one is answered at the registered URL. |
| `destination-mismatch` | `Destination` is present and is not `<baseUrl>/auth/saml/sso`. |
| `binding-unsupported` | `ProtocolBinding` asks for anything but HTTP-POST. |
| `request-clock` | `IssueInstant` is in the future beyond the clock skew. |
| `request-expired` | `IssueInstant` is older than 30 minutes plus skew. The window is long because a signed-out person signs in to the Box first. |
| `request-replayed` | The provider's request `ID` was already answered (process-local memory; a restart forgets it). |

A `Signature` on a request is ignored, not verified. `ForceAuthn` and `IsPassive` are not acted on.

## The assertion

| Element | Value |
|---|---|
| Response `Destination` | the provider's ACS URL |
| `Issuer` | the IdP entity ID |
| `InResponseTo` | the request `ID` (absent for IdP-initiated) |
| `Status` | `Success` |
| `NameID` | `users.email`, lowercased, format `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` |
| `SubjectConfirmationData` | bearer, `Recipient` = ACS URL, `NotOnOrAfter` = now + 5 min, `InResponseTo` |
| `Conditions` | `NotBefore` = now - skew (at most 5 min), `NotOnOrAfter` = now + 5 min, `AudienceRestriction` = provider entity ID |
| `AuthnStatement` | `AuthnInstant` = now, a random `SessionIndex`, context class `unspecified` |
| `AttributeStatement` | `id` (Box user id), `email`, `firstName`, `lastName` (each omitted when blank), `groups` (multi-valued), renamed per provider by `attribute_map` |

**Groups** come from the Box role. Every user gets `members`; admins also get `admins`. A provider
maps these to its own names with `group_map` (`{"members": "box-members", "admins": "box-admins"}`);
an unmapped group is not sent, and without a map the Box names are sent. The provider decides what a
group means: in Claude, the SSO settings assign roles per group. The role is read at every sign-in.

**`id` is the Box user id**, which never changes. A provider that keys accounts by `id` keeps the
same account when an email changes.

Signing: RSA-SHA256, SHA-256 digests, exclusive canonicalization, enveloped signatures with the
certificate in `KeyInfo`. The assertion is always signed; the Response is signed too unless the
provider turns `sign_response` off. XML is built with `xmlbuilder2`, never from strings. IDs are `_`
plus 32 random hex characters.

### Page headers

Every page the mount writes replaces the trusted-content headers core set on mounted paths:
`Content-Security-Policy: default-src 'none'; script-src 'nonce-<n>'; style-src 'nonce-<n>';
img-src 'self' (plus the logo's origin when `brand.logoUrl` is absolute); form-action https: (refusals: 'none'); frame-ancestors 'none'; base-uri 'none'`, `X-Frame-Options:
DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. `form-action` allows any https
destination, not only the ACS origin, because browsers apply it to the redirects that follow the
POST (WorkOS redirects on to claude.ai).

The pages carry the Box look without the app bundle: `brand` from box.json (logo, wordmark, suffix,
name, theme color), the login page's layout (wordmark over one card), inline copies of the
`packages/ui` tokens for light and dark, and the person's light/dark choice from the app's theme
key, read by a nonce script before first paint. Icons are inline SVG.

## Tables

Warehouse, created by the feature's model baseline (no migrations yet):

| Table | Key | What |
|---|---|---|
| `sso_providers` | `id` | A service provider: `id` (slug, frozen), `name`, `protocol` (`saml`), `entity_id` (unique, checked on write), `acs_url` (https), `attribute_map` (json), `group_map` (json), `sign_response`, `allow_idp_initiated`, `enabled` (ints, 0 or 1), `default_relay_state`, `note`. Audited. |
| `sso_assertions` | `id` | The audit log: `occurred_at`, `user_id`, `email` (as asserted), `provider_id`, `request_id`, `outcome` (`issued` or a refusal code), `client_ip`, `user_agent`. Append-only. Deleting a Box user keeps their rows. |

## Email is the identity

`users.email` is the NameID. Core enforces two rules for every Box, so a person's identity does not
change by accident:

- **Changing `email` is admin-only** in `user-upsert`, like `tailscale_login`. A member's profile
  form shows it read-only; an unchanged value in the body passes.
- **`email` is unique across users, case-insensitively**, checked in `upsertUser` on change.

Changing a user's email changes who they are at every provider that keys by email. Claude keys by
`id`, which does not change.

## Settings

`features.sso` in `box.json`:

```json
{
  "features": {
    "sso": {
      "baseUrl": "https://box.example.com",
      "allowedDomains": ["example.com"],
      "clockSkewSeconds": 300
    }
  }
}
```

`box.local.json` (never printed, never in a warehouse backup): `features.sso.saml.signingKey` and
`features.sso.saml.signingCert`, PEM.

On boot, once `baseUrl` is set and **both** are absent, the feature generates an RSA-2048 key and a
self-signed certificate (`CN=<baseUrl host> SAML`, valid 10 years) and writes them to
`box.local.json`, mode 0600, the way core creates its auth secrets. It never overwrites a value, and
it leaves a half-present pair alone and logs it. Rotation is deliberate: remove both, restart, paste
the new certificate into every provider. Everything else is read per request.

## Procedures and tools

Every row is REST under `/api/sso/`, tRPC `sso<Method>`, an MCP tool and a CLI verb.

| MCP tool | Tier | What |
|---|---|---|
| `sso-status` | admin | Set up or not, missing keys with their files, problems (certificate unreadable, mismatched or expiring), URLs, allowed domains, certificate subject, fingerprint and validity, provider count, users without an allowed email, outcome counts for 24 h. Never key material. |
| `sso-providers` | admin | The IdP values to paste into a provider (entity ID, SSO URL, metadata URL, certificate PEM), the providers with their start URLs, and the presets. |
| `sso-provider-save` | human admin | Create or update a provider. `attribute_map` and `group_map` are JSON strings. `preset: claude` fills name, maps and flags. |
| `sso-provider-delete` | human admin | Remove a provider. |
| `sso-assertions` | admin | The audit log, newest first, filtered by user, provider and outcome, plus each user's last sign-in per provider. |
| `sso-me` | any | The caller's email, whether it is allowed, and the enabled providers with a start URL where allowed. |

**Human admin** is an admin principal that is not the configured system principal. A person's own
assistant session (their Claude profile, on their own token) can manage providers for them; the chat
agent, which runs as the system principal, cannot, whatever its role. Emails are set with core's
`user-upsert`.

## Events

`sso.assertion`, `source` = `sso`, `actor` = user id, `subject` = provider id, fields `provider`,
`outcome`, `user`. Route them with an alerts rule; sso does not depend on notifications.

## UI

Settings, SSO (order 830). Everyone sees **Your sign-in**: the email they sign in as, or why they
cannot, and an "Open" button per provider that allows sign-in from the Box. Administrators also see
**Identity provider** (status, missing keys and problems, SSO URL and issuer with copy buttons,
certificate expiry with copy and download, fingerprint, allowed domains, metadata download),
**Service providers** (list, editor, "Add Claude" preset), **People** (who cannot sign in) and
**Recent sign-ins** (the last 50 decisions).

## Claude (WorkOS)

Claude's SSO dialog (Organization settings, Authentication, Setup SSO, Custom SAML) shows the
provider side and asks for the IdP side:

| WorkOS shows | Provider field |
|---|---|
| Assertion consumer service (ACS) URL, `https://auth.workos.com/sso/saml/acs/<connection>` | `acs_url` |
| Service provider entity ID, the bare `<connection>` id (not a URL) | `entity_id` |

| WorkOS asks (Manual configuration) | The Box gives |
|---|---|
| Identity provider Single Sign-On URL | `<baseUrl>/auth/saml/sso` |
| Identity provider issuer | `<baseUrl>/auth/saml` |
| X.509 certificate | the signing certificate (PEM) |

Use **Manual configuration**. "Dynamic configuration" makes WorkOS fetch the IdP metadata from a
URL, which its servers cannot reach on a private network. WorkOS requires the attributes `id` and
`email`, accepts `firstName` and `lastName`, and requires `groups` for role assignment. The Claude
preset sends all five under those names.

The AuthnRequest WorkOS sends (observed 2026-10-09, kept as a test fixture):

- HTTP-Redirect binding, unsigned: only `SAMLRequest` and `RelayState`.
- `Issuer` is the bare connection id; `AssertionConsumerServiceURL` the registered ACS URL;
  `Destination` the Box's SSO URL; `ProtocolBinding` HTTP-POST.
- `NameIDPolicy` asks for `emailAddress`, `AllowCreate="true"`; no `ForceAuthn`, no `IsPassive`.
- `RelayState` is a WorkOS-signed JWT of about 500 bytes with a 4-hour expiry, returned
  byte-for-byte. The SAML 80-byte RelayState limit is not enforced, because WorkOS exceeds it.

## Accepted risk: a Box session is sufficient

The recipe trusts the Box session. Any principal that can obtain a person's Box session can sign in
as that person at every registered provider, and an admin principal, including an admin agent, can
mint a sign-in link for any user (`user-link`). The recipe adds no second factor; the Box agent's
own safeguards carry that responsibility. Teams that want a step-up add the planned Google sign-in
powerup.

Provider registration is narrower: it is refused for the system principal, so the chat agent cannot
point assertions at a new destination.

## Why the shapes are what they are

- **SAML, not OIDC.** OIDC needs the provider's servers to reach the token and key endpoints. SAML
  runs entirely through the browser, so a Box on a private network can serve a public SaaS.
- **One mount under `/auth/`.** Later protocols are siblings (`/auth/oidc/...`), not new prefixes.
- **Redirect binding only.** A path-mount POST without a session answers 401 rather than the
  sign-in redirect, so a POST-bound request from a signed-out browser could not complete.
- **The ACS URL comes from the registry, never from the request.** Posting to a request-supplied URL
  would hand a signed assertion to anyone who can craft a link.
- **`users.email`, not a second identity table.** One email per person, kept by admins and unique.
- **Human admins, not every admin.** Provider registration decides where signed assertions go.

## Powerups (planned)

- `google`: Sign in with Google for the Box, with an `hd` check; a per-provider step-up.
- `passkeys`: WebAuthn sign-in for people without a Google account.
- `oidc`: an OpenID Connect provider at `/auth/oidc` for internal tools on the Box's network.

## Packages

`xml-crypto` (signing), `xmlbuilder2` (building), `@xmldom/xmldom` (parsing AuthnRequests),
`@peculiar/x509` (generating the certificate; it needs `reflect-metadata`, imported first), with
`node:zlib` and `node:crypto`. No SAML framework.
