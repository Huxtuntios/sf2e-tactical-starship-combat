# Release readiness and Foundry submission gates

Assessment date: 2026-11-12. This is technical preparation, not a public listing description, legal clearance, a compatibility certificate or a stable release announcement.

The review branch starts at `f87c983a9cbafd4a9aff086bd416ed77bef9d6d5`, after PR #14 merged. Module, package and lockfile remain `0.17.1-dev.13`. No `1.0.0` tag, release, catalog submission or compatibility increase is authorized by this assessment.

## Technical package information

- Module ID / installation folder: `sf2e-tactical-starship-combat`.
- Repository: <https://github.com/Huxtuntios/sf2e-tactical-starship-combat>.
- Source manifest: `module.json`. The package builder writes an external manifest and an identical ZIP-root manifest.
- Declared Foundry compatibility: minimum `14.361`, verified `14`, maximum `14`. These are inherited declarations, not results of this audit.
- Declared SF2e: minimum `1.6.0`, verified `1.6.1`.
- Declared PF2e: minimum `8.6.0`, verified `8.6.1`; runtime support additionally requires active supported SF2e Anachronism. It is conditional on the selected system, not a global mandatory dependency.
- 22 compiled packs: 11 SF2e and 11 PF2e counterparts. Pack extraction is an offline data check, not a system Document/schema import test.
- EN/RU interfaces and guide content are included. Translation-review status remains unconfirmed.
- Optional modules are not bundled or made mandatory. Exact-version integration tests remain required.
- Packaging retains LICENSE and THIRD-PARTY-NOTICES.md. Retaining them is not evidence that their assertions are legally sufficient.

Build and inspect without publishing:

```sh
npm ci
npm run check
npm run test:ui
npm run package
node tools/verify-release.mjs dist v0.17.1-dev.13
```

The builder writes `dist/module.json`, `dist/module.zip` and `dist/SHA256SUMS.txt`. The version-specific external manifest will be an asset of its matching release only after an authorized upload. Generated GitHub download/update URLs describe intended endpoints; this review does not establish that those assets are publicly available. Do not use an unpublished artifact's `latest` URL as installation or update evidence.

A source archive for GitHub Desktop must retain workflows, tools, tests, documentation and runtime sources, but omit `.git`, dependencies, generated packs, build outputs, temporary files and secrets. An installation ZIP is distinct: `module.json` at root, declared compiled packs and runtime resources, no source-development tooling.

## Blocking human confirmations

| Material / claim                                                    | Repository evidence                                                                             | Required confirmation                                                                                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prepared rules manuscripts, descriptions, actions and guide/UI text | Bundled data, templates and dictionaries; book/page references; printed-text extraction tooling | Human creative authorship where required, source rights and the applicable publisher notices for each material category                                                      |
| New wizard interface text from PR #14                               | EN/RU strings were produced with AI assistance in this development session                      | Human authoring of the prepared interface originals before catalog submission; proofreading or approval alone cannot convert AI-generated originals into human-authored text |
| Russian translations                                                | EN/RU files and translation mappings; contributor commits                                       | Human-authored originals and accuracy review by a Russian speaker; commit authorship alone is insufficient                                                                   |
| Five SVG assets                                                     | Bundled source files without authorship/license metadata                                        | Authorship, rights and ability to understand, modify and maintain SVG code; do not classify SVG automatically as AI raster imagery                                           |
| Code and generated technical documentation                          | Source, tests and AI-assisted changes in this development work                                  | Maintainer understands, can explain, modify and support the submitted code; review generated technical documentation                                                         |
| Manifest description and future catalog/release marketing           | Existing description; creative authorship not established by history                            | Human-written public marketing; do not submit AI-generated listing copy                                                                                                      |
| ORC and reserved material                                           | LICENSE and notices; named ships/factions and narrative content                                 | Correct verbatim publisher ORC notices, scope of licensed material and reserved text/names; the claim that reserved setting text is absent needs review                      |
| Source attribution                                                  | AoN links and a printed-stat/text pipeline                                                      | Distinguish reference, extraction, original implementation and user content; do not claim everything came from AoN                                                           |

No unresolved material has been replaced with newly generated gameplay prose, UI text or images to disguise provenance. The existing license grant and copyright/trademark notices are retained. No Zero AI claim is made.

Inventory at the review baseline: 21 data JSON files, 74 ship records, 32 hazards, 39 actions, 17 weapons, 34 upgrade records, 3 frames, 7 station types including custom, 3 drone records, 3 expansion bays, 7 bilingual exploration activities, 2 rules manuscripts, 5 SVGs, 19 templates, 1,599 interface locale leaves per language and 1,259 content translation mappings. Counts identify review scope, not human authorship or redistribution permission. Generated pack records include folders, translated variants and embedded Documents; their counts are not source-content counts.

## Live acceptance gates

Run on disposable copies with backups. Record exact Foundry build, SF2e/PF2e commit/version, Anachronism version, optional-module versions, browser, account permissions and errors. Do not change existing worlds merely to obtain a passing result.

1. Clean install the local ZIP into the matching module folder. Enable SF2e with optional integrations absent. Confirm initial load, both languages, sheets, all applicable packs, links, imports and no console errors.
2. Upgrade a copied pre-wizard world and a world saved after PR #14. Compare Actor/Item IDs, HP/SP, crew/stations, manual edits, private stores and combat state before/after reload. Test migration twice and a failed/vetoed write; never stamp a success solely because a Promise resolved.
3. Wizard: world player reused, compendium player and NPC copies independent, repeated enemies/hazards, custom contacts/art, zones/headings/detection, mandatory review, cancellation, rapid double confirmation, permission loss and cleanup failures.
4. End/start/reload encounters. Explicitly reuse a retained player instance with ship initiative disabled and enabled; check station actions remain linked only to participating public ships. Unmapped/private copies and inactive failed setup must not leak actions or freeze sync.
5. Use GM plus two player clients, then two GMs. Check actor/token ownership, crew/station permissions, secret contacts and anonymous initiative before and after Reveal. Test disconnect, active-GM change, duplicate messages and result deadlines; a deadline does not cancel in-flight document writes.
6. Exercise native attack/check/save dialogs, cancellation, no-roll declarations, normal/critical/typed damage, Toolbelt multipliers and damage application with optional integrations absent and present at recorded versions. Confirm no automatic action/reaction budget spending.
7. Exercise Sensor Map movement, scans, manual additions, appearance overrides, hazards, drones, mines, inventory/protocol changes and related failure paths. Check close/reopen/repeated render, large maps and player visibility.
8. Test narrow Undo and partial Reveal recovery across reload and conflict. No automatic Undo of HP/SP/damage/critical state and no cross-document transaction or exactly-once guarantee.
9. Repeat relevant install, upgrade, sheets, skills, rolls and packs tests in PF2e + supported Anachronism. Also check unsupported/missing integration refusal. Separate this result from SF2e.
10. Confirm usable packaged guide pages and persistent UUID links after documentation changes. Existing guide-page IDs are heading-derived; imported world journals are not silently migrated.

## Remaining build / publication checks

- Local executable reports Node `24.16.0`, npm `12.0.2`; session metadata naming `24.22.1` is not execution evidence. GitHub workflows currently select Node 22. Remote workflow results for this branch are not yet verified.
- `npm audit` reports four moderate entries in the development-only ESLint/minimatch chain. The installed minimatch is `10.2.6`; the advisory range ends at `11.0.1`, outside current upstream dependency ranges. No forced downgrade, major override or unsafe `audit fix --force` was applied. Track <https://github.com/advisories/GHSA-g3hv-75wg-m249> and re-evaluate upstream fixes. These tools are not in the installation ZIP.
- The current publication workflow triggers after a release is published and checks re-downloaded assets after upload. Human policy/live gates and immutable-release draft asset preparation must be satisfied separately before using it. This audit does not invoke or bypass that workflow.
- The guide Markdown converter has limited syntax support; tables, fenced blocks and Markdown links require visual/live review. No broad converter rewrite is included.
- Resolve all critical defects and the human/policy/live gates above before synchronizing `1.0.0` in module/package/lockfile, tag and release assets. Do not increase `verified` merely to satisfy packaging.
- Catalog placement requires a separate maintainer submission and manual Foundry approval. Neither submission nor acceptance is claimed.

## Official references reviewed

Foundry AI policy states that all user-facing prepared written text must be human-authored, permits AI translation of human originals only with target-language human review, treats SVG as software code, and requires human-written marketing. The policy page identifies revision 2026-03-18. Maintainer code comprehension/support and redistribution rights remain mandatory; the checklist above is not a substitute for the official policies.

- <https://foundryvtt.com/article/ai-policy/>
- <https://foundryvtt.com/article/licensing-guide/>
- <https://foundryvtt.com/article/module-development/>
- <https://foundryvtt.com/article/package-management/>
- <https://foundryvtt.com/packages/>
- SF2e rules reference, not blanket provenance: <https://2e.aonsrd.com/>

See [Reality Check](reality-check.md) for inspected paths, confirmed defects and executed evidence. Maintainer-only workflow instructions remain in the source repository's `docs/RELEASING.md`.

## 1.0.0 preparation addendum — 2026-11-12

The maintainer merged PR #15 into `main` (`0cdf1b65c838799304f0553ee288efefcef5c798`, hosted CI green) and directed release preparation. Branch `release/1.0.0` synchronizes version `1.0.0` in `module.json`, `package.json` and both `package-lock.json` version fields, adds the categorized `1.0.0` CHANGELOG section and `docs/releases/1.0.0.md`, and updates the README banners, publishing guide and current-version wording. Compatibility declarations, dependencies, the module ID, repository URLs, pack names and document IDs are unchanged; no gameplay mechanic was changed. The `release-070` version-format test now accepts stable semver while keeping the historical `>= 0.7.0` minimum and the manifest/package match.

Executed local evidence is recorded in [testing](testing.md#100-release-preparation--local-results-2026-11-12): baseline and post-change `npm run check` **1,242/1,242**, `npm run test:ui` **57/57**, `npm run build:release` and `node tools/verify-release.mjs dist v1.0.0` passed. This synchronizes the version for a review PR; it is not publication authorization.

**The blocking human confirmations and live acceptance gates above remain unexecuted.** They still condition any `v1.0.0` tag, GitHub Release publication, `latest`-channel availability and Foundry catalog submission. In particular: live Foundry v14/SF2e multiplayer and PF2e + Anachronism sessions, real Toolbelt/libWrapper integration, human authorship of the PR #14 wizard interface originals, Russian translation review, SVG rights, ORC/reserved-material legal review and human-written catalog marketing. Do not treat the green automated checks or this addendum as a substitute for those gates.

Live verification round 1 (2026-11-12, Foundry 14.370 / SF2e 1.7.0, test world with maintainer-confirmed backup) found and fixed a real compatibility defect: module scene-control buttons were missing because 14.370 calls `getSceneControlButtons` once before `ready`; registration moved to `init`, regression-tested and live-verified. Wizard setup, copy independence, crew/station actions, private-contact staging and anonymous initiative passed document-level live checks; player raw-collection read access was confirmed as the documented confidentiality limitation. Reveal, live damage/Toolbelt, Undo, multi-GM failover, PF2e, upgrade and performance gates remain unexecuted. Details: [testing](testing.md#100-live-verification--round-1-foundry-14370--sf2e-170-2026-11-12).
