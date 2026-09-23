# Documentation

Use these guides according to the work in front of you.

## Run a Box

- [Setup](SETUP.md): install, configure, start, and verify a checkout.
- [Configuration](CONFIGURATION.md): shared and local settings.
- [Authentication](AUTH.md): people, tokens, sessions, and sign-in links.
- [CLI](CLI.md): commands, terminal behavior, and Builder browser control.
- [Builder](BUILDER.md): the administrator development workspace.
- [Branding](BRANDING.md): product identity and generated assets.

## Maintain and extend this Box

- [Features](FEATURES.md): feature layout and composition model.
- [Source integration](INTEGRATION.md): integrating or upgrading source safely.
- [Core seam](core/SEAM.md): boundaries between core and optional features.
- [Server](SERVER.md), [Web](WEB.md), and [Warehouse](WAREHOUSE.md): runtime contracts.
- [Starter](STARTER.md): producing a core-only consumer Box.
- [Bun](BUN.md): runtime, package management, and local WorkerDeck development.
- [Validation](VALIDATION.md): required static and runtime checks.
- [Gotchas](GOTCHAS.md): cross-cutting hazards that are easy to miss.
- [Source ancestry](UPSTREAM.md): revisions used by consumer Boxes.

Feature-specific guidance arrives with integrated source under `features/<id>/`; the authoritative
reference remains in the upstream Stack. Committed documentation describes supported behavior and
durable constraints. Put active plans, temporary diagnostics, screenshots, and current run results
in gitignored `_docs/`, then remove them when the work ends.
