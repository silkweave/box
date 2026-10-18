# Branding a Box

Branding is the `brand` section of `box.json`, the Box's shared configuration file, alongside
the agent identity and the background switches ([CONFIGURATION](CONFIGURATION.md)). It is still a
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

Run `box build && box verify`, then restart the server. In development restart Vite
(`box app restart --frontend`) and the server (`box app restart`) after changing branding. Rebuild **both** web and server for production: old web output
and a new server can otherwise display different names. Browse the sign-in page, expanded and
collapsed sidebar, and mobile header, inspect `/manifest.webmanifest`, and check dark mode. If
notifications is installed, inspect `/api/push/sw.js` too. OS-installed app names/icons and old
service workers can remain cached; refresh/update the worker and, if necessary, reinstall the
home-screen app before judging the result.

The colours in this configuration affect install/browser chrome. The app's own look is the theme
below; Storybook has its own library branding.

## Theme

The app's light and dark design tokens live in the UI library
([`packages/ui/src/styles/tokens.css`](../packages/ui/src/styles/tokens.css)), which is core: a Box
does not edit it. A Box restyles the app in `theme/theme.css` at the checkout root. The web app
imports it after the library's stylesheets, so any token set there wins, and core upgrades never
touch it (a new Box gets the commented default). Set only what differs: `[data-theme='light']` and
`[data-theme='dark']` for colours, `:root` for fonts and anything shared by both modes. Never set a
colour under `:root`: the theme loads after the dark tokens, so a `:root` colour wins in dark mode
too.

```css
@import '@fontsource/poppins/400.css';
@import '@fontsource/poppins/600.css';

:root { --cp-font-sans: 'Poppins', system-ui, sans-serif; }
[data-theme='light'] { --accent: #2d85de; --accent-hover: #1f6fc2; --accent-bg: #eaf3fc; }
[data-theme='dark'] { --accent: #4a96e4; --accent-hover: #6fabeb; --accent-bg: #102a4a; }
```

The tokens worth overriding are the backgrounds (`--bg`, `--bg-surface*`), borders, text (`--fg-1`
to `--fg-4`), the accent family, the semantic colours, the chart series (`--chart-1` to `--chart-8`;
re-validate the order for colour-vision safety after changing them), the shadows, the sidebar
(`--sidebar*`, see [WEB](WEB.md)) and the silk gradient. A font comes from an `@fontsource` package
in the root `package.json` or from files kept in `theme/`; `@import` lines go first in the file.
Token edits hot-reload in `box dev`; production picks them up on the next web build. The Builder
shell keeps the library's look, so a broken theme never hides the recovery surface. `BrandProvider` lets the UI library render a consumer's identity
without depending on core. Standalone components fall back to neutral `Box` text without a logo.

Branding does not rename npm packages, framework/MCP identifiers, storage keys, auth cookies,
agent IDs or database rows. Changing the product name therefore preserves preferences and
credentials. `box.json` can be tracked; local overrides belong in gitignored `box.local.json`. Commit artwork
under `apps/web/public` with the shared brand settings.
