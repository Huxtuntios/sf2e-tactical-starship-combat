# Contributing

## Local setup

Use Node.js 22.13+ and `npm ci`. No Foundry installation is required for offline tests.

```sh
npm run format
npm run check
npm run build:release
```

For browser tests, install Chromium with `npx playwright install chromium`, then run `npm run test:ui`. `CHROMIUM_PATH` can point to an existing Chromium executable; it is not needed when Playwright installs its own browser.

## Code conventions

- UTF-8, LF, two spaces, double quotes, semicolons and ES modules. Prettier is the formatting authority; do not compress controllers to satisfy physical-line counts.
- Write developer comments in English. Explain contracts, rules decisions and non-obvious constraints rather than repeating code. Keep version history in CHANGELOG; retain migration/version comments only when the version is part of behavior.
- Keep domain engines in `scripts/engine/` pure. Foundry document writes belong in services, not templates or pure engines.
- UI controllers orchestrate helpers; reusable sheet logic lives under `scripts/ui/sheet/`, sensor logic under `scripts/sensor/` and attack-card logic under `scripts/chat/attack-card/`. Entry-controller size is guarded by a byte budget, not formatter-dependent line counts.
- Client preferences use Foundry client settings. Do not add browser storage, polling loops or new hard module dependencies.
- Validate state-changing requests on the active GM. Never trust a user ID supplied inside a socket payload.
- Add matching English/Russian UI keys and preserve placeholders. The `starship` trait is deliberately English in both languages.
- ApplicationV2 template parts must render one HTML root for every conditional branch. Add DOM fixtures for new windows and interaction paths.
- Keep existing IDs, flags and compendium IDs stable. Treat changes to them as migrations, not cleanup.

## Source layout

| Path                                                | Purpose                                                |
| --------------------------------------------------- | ------------------------------------------------------ |
| `scripts/engine/`                                   | Pure rules and validation                              |
| `scripts/actions/`, `combat/`, `crew/`, `starship/` | Foundry services and encounter operations              |
| `scripts/ui/`, `templates/`, `styles/`              | Controllers, Handlebars and presentation               |
| `data/`, `lang/`                                    | Canonical rules data and localization                  |
| `tools/build-packs.mjs`                             | Rebuilds LevelDB packs with stable document IDs        |
| `tools/build-release.mjs`                           | Produces Foundry-ready GitHub release assets           |
| `tests/`                                            | Unit, architecture and offline integration tests       |
| `tools/content-pipeline/`                           | Optional provenance tools; not part of normal releases |

Generated `packs/`, `packs-src/`, `node_modules/`, `.work/` and `dist/` must stay out of commits. Do not edit compiled LevelDB files. The release builder includes compiled packs in `module.zip`.

## Pull requests

Describe the user-facing change, data migrations and limits. Run `npm run check`; run UI tests for window/template/style changes. Mention which Foundry/system versions and player/GM scenarios were actually tested. Do not describe offline fixtures as live Foundry validation. Never include world data, credentials, source PDFs or third-party artwork.

Optional Python provenance tools use Python 3.11+ and Black (`tools/content-pipeline/requirements-dev.txt`). They are not needed to build packs or release the module.

Foundry Handlebars templates retain their existing layout: Prettier’s Glimmer parser does not support their conditional HTML attributes. They are excluded explicitly, not rewritten into a different template language. Template compilation and DOM fixtures validate them. Use two-space indentation for new markup and keep template-only structural changes separate from behavior changes.
