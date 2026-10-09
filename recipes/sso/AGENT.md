# Adapting the `sso` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the feature is; this is how it gets into
a Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/sso/`; the reference implementation lives in the
Stack at `features/sso/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md) and
[GOTCHAS.md](./GOTCHAS.md), and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** core only, at a revision with the email rule (INSTALL.md, Prerequisites).

The feature has three parts:

- `core/`: settings, key generation (`keys.ts`), SAML parsing, building and signing (`saml.ts`), the
  provider registry, the audit log, the sign-in decision (`flow.ts`) and status. Everything security
  relevant is here and covered by `sso.test.ts`.
- `server/`: the `/auth/` path mount (`serve.ts`) that turns a decision into a page, and the admin
  controller.
- `web/`: one settings section, no routes.

Record the source SHA, path mapping and skipped upstream changes in the Box's `docs/UPSTREAM.md`;
write the active scope and state to `_docs/INTEGRATION.md`.

## 2. Customise for the team

1. **Another provider.** Most SAML services need only an entity ID and an ACS URL; add them in
   Settings, SSO. If a service wants other attribute names, set `attribute_map`. To ship a preset,
   add it beside `CLAUDE_PRESET` in `core/providers.ts` and to the editor in `web/views/SsoSettings.tsx`.
2. **More groups.** Groups come from the Box role (`userAttributes` in `core/flow.ts`). A team group
   concept would be a new users field or table; add the group names to `BOX_GROUPS` and the editor.
3. **Lifetimes.** Assertions live 5 minutes (`buildSamlResponse`), requests may be 30 minutes old
   (`REQUEST_MAX_AGE_SECONDS`) so a signed-out person can sign in first.
4. **Branding the pages.** They take the Box's `brand` (box.json) and the `packages/ui` tokens, copied
   into `STYLE` in `server/sso/serve.ts`; keep those values in step when the tokens change. Layout is
   in `page()`, `refusal()` and `postForm()`. Keep the nonce-based CSP: no external scripts, styles
   or fonts, and images only from the Box (or the logo's own origin).

## 3. Prove it

```bash
bun run cli sso-status
bun run cli sso-providers
```

Then follow the Verify steps in [INSTALL.md](./INSTALL.md) with a real provider. Without one, a
browser signed in to the Box can still check the refusal paths: `<baseUrl>/auth/saml/sso` without a
request shows "This sign-in request cannot be used", and `<baseUrl>/auth/saml/start/claude` shows
"Not available" until sign-in from the Box is allowed for that provider.

## 4. Adapt or remove

To update, compare the Box with the recorded upstream SHA, preserve local presets and branding, and
apply source changes by hand; record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`.
To remove, follow INSTALL.md, Remove: enforcement at the providers goes off first.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md).
