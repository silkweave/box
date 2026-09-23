# Artifacts

Artifacts is not a recipe yet, so this folder has no `RECIPE.md` and the onboarding recipe catalog
does not list it. The Stack carries a web-only placeholder workspace at `/artifacts`. It has no
upload, listing or storage behavior, no core models, migrations, server module or settings. This
note records what exists so that the placeholder is not mistaken for an offering. Add a
`RECIPE.md` here once Artifacts has behavior worth adapting.

If a team still wants the placeholder route, fetch the Stack with `box stack fetch` and copy
`<fetched stack>/features/artifacts/web/` into the Box's `features/artifacts/web/`, adapting its
imports. Register its entry in `apps/web/src/generated/features.ts`, including `WEB_FEATURES` and
`WEB_ROUTES`. Place its `artifacts` navigation entry under the receiving Box's Workspace heading.
It uses React, TanStack Router, lucide-react and the shared Box UI already supplied by the root
workspace. No core export registration is needed until Artifacts exposes core behavior.

Run `box verify` and load `/artifacts` in a browser after integration to check route registration.
