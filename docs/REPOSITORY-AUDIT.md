# Repository preparation audit — 0.14.0

## Scope

Prepared a separate working copy from 0.13.2 for `Huxtuntios/sf2e-tactical-starship-combat`. This pass focuses on maintainability, reproducible packaging and public documentation, not a full rules redesign or security/legal certification. No GitHub repository or release was created remotely.

## Completed changes

- Unified JavaScript, styles, JSON configuration and Markdown formatting; documented English developer comments, pure engines, GM-authoritative writes and stable identifiers.
- Removed redundant version prefixes from runtime comments while preserving behavior-relevant migration references.
- Resolved all ESLint errors/warnings without suppressing the individual reported problems; aligned ESLint 10 with its configuration package and removed the legacy peer-dependency workaround.
- Repaired the corrupted Russian `Успех` ability heading and added a regression test.
- Replaced Bash packaging with Node/fflate, validated matching versions, generated SHA-256 sums, and placed the installer manifest at the archive root.
- Added release-manifest URLs, author/repository metadata, CI/release workflows, bug/feature/PR templates and EN/RU READMEs.
- Excluded generated packs, build output, dependencies and private inputs from Git. Runtime ZIPs include the compiled packs but not development tools.
- Made browser fixture paths portable and added one runner for all UI fixture groups.
- Removed developer-specific absolute paths from the optional Python provenance tools; outputs are isolated under a configurable working directory.
- Replaced outdated current-limitations text with the actual soft-automation boundaries.

## Validation results

- Formatting: all supported files pass Prettier; Foundry-specific Handlebars conditional attributes are deliberately excluded from its incompatible Glimmer parser.
- ESLint: zero errors, zero warnings.
- Canonical content/reference validation: zero errors, zero warnings.
- Node tests: **311 passed, zero failed, zero skipped** after rebuilding packs.
- Compendiums: **11 packs** rebuilt and opened with the real LevelDB reader; stable IDs retained by the existing deterministic builders.
- Chromium: **33 local pages passed**, including two static form previews, not 33 live-world scenarios.
- Python: nine files pass syntax and Black checks; original licensed inputs/extraction were not reprocessed.
- Installed development dependencies: npm audit reported **zero vulnerabilities** at preparation time. This is not a guarantee against future advisories.

A clean source-only checkout is used to repeat dependency installation, checks and release packaging before handing off the files. Generated runtime files and their matching manifest/checksums are delivered separately from the source repository.

## Remaining manual gates

1. **Live Foundry:** not executed. Check registration, ApplicationV2, chat enrichers, typed damage, socket authority, permissions, turn transitions and separate GM/player clients in a backed-up test world.
2. **GitHub:** workflows and public URLs cannot be proven active before the owner publishes the repository. First CI and release runs must be reviewed on GitHub.
3. **Windows/macOS:** no executed OS-specific smoke run; Node paths and packaging avoid Bash/system zip requirements, but local platform testing is still recommended.
4. **Licensing:** ORC/license notices preserved, not replaced with the example repository's MIT license. Verify official source-publication notices and licensed/reserved materials before public distribution; the existing maintainer note is intentionally visible.
5. **Content provenance:** historical parsing reports are retained, not represented as newly reproduced imports. Check unusual text against the source book.

See `RELEASING.md`, `testing.md`, `known-limitations.md` and `THIRD-PARTY-NOTICES.md`.
