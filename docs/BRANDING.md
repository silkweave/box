# Branding a Box

Branding is the `brand` section of `box.json`, the one file a Box is configured in, alongside
the agent identity, the ports and the background switches ([SETUP](SETUP.md)). It is still a
BUILD-TIME choice: the SPA bakes these values into the bundle, so a change reaches the browser only
after a rebuild. The section supplies the product name, short install name, description, wordmark
text, optional suffix (use an empty string to omit it), artwork URLs and installed-app colours.
The JSON Schema that ships with core (`packages/core/box.schema.json`, referenced from the file's
own `$schema` key) describes the whole shape, so an editor autocompletes the keys and flags a typo
before a boot does.

Core reads the section at call time through `boxBrand()`; the SPA gets the same values from the
`virtual:box-brand` module that [`apps/web/branding.ts`](../apps/web/branding.ts) generates at build
time. Server code calls `boxBrand()` when the value is needed.

Replace the four assets it names under `apps/web/public`, or point the fields at your own files
there. URLs must start with one `/` and use local paths, with no parent-directory traversal.
The build refuses missing files. The default assets are:

| Field | File | Used for |
|---|---|---|
| `logoUrl` | `brand-logo.svg` | Sign-in, expanded/collapsed sidebar and mobile header |
| `icon192` | `push-icon.png` | 192x192 PNG install icon and push fallback |
| `icon512` | `app-icon-512.png` | 512x512 PNG install icon and favicon |
| `appleTouchIcon` | `apple-touch-icon.png` | 180x180 opaque PNG iOS home-screen icon |

Provide the stated PNG dimensions yourself; the build checks existence, not image dimensions or
appearance, and does not resize artwork. SVG marks render as separate images, so repeated marks
cannot collide on internal gradient/filter IDs. Keep replacement artwork readable in both themes.

The configuration covers the browser title, sign-in and shell wordmarks, install manifest and
Apple title/icon, service-worker fallback title/icon, server startup label, backend description,
and the ready-to-copy sign-in/token messages. It does not send an invitation or a notification.
The manifest is generated in production and served from the same object in Vite development;
there is no separately edited `public/manifest.webmanifest`.

Run `pnpm build && pnpm verify`, then restart the server. In development restart Vite and the
server after changing branding. Rebuild **both** web and server for production: old web output
and a new server can otherwise display different names. Browse the sign-in page, expanded and
collapsed sidebar, and mobile header, inspect `/manifest.webmanifest`, and check dark mode. If
notifications is installed, inspect `/api/push/sw.js` too. OS-installed app names/icons and old
service workers can remain cached; refresh/update the worker and, if necessary, reinstall the
home-screen app before judging the result.

The colours in this configuration affect install/browser chrome. App light/dark design tokens
remain in [`packages/ui/src/styles/tokens.css`](../packages/ui/src/styles/tokens.css); Storybook
has its own library branding. `BrandProvider` lets the UI library render a consumer's identity
without depending on core. Standalone components fall back to neutral `Box` text without a logo.

Branding does not rename npm packages, framework/MCP identifiers, storage keys, auth cookies,
agent IDs or database rows. Changing the product name therefore preserves preferences and
credentials. `box.json` can be tracked; local overrides belong in gitignored `box.local.json`. Commit artwork
under `apps/web/public` with the shared brand settings.
