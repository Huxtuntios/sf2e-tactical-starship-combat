# 0.16.1-dev.3 — experimental work in progress

Based on the dev.2 source archive; do not overwrite dev.2. Test only in a backed-up test world. The user reports the Sensor Map problem involved a large image. This version is not a release and does not establish that the Sensor Map, socket handling, journal privacy or Undo work correctly in a live Foundry world.

## Architecture and evidence

The player sheet renders stations from `sheet-context.mjs`; station actions flow through `action-engine.mjs` and a cloned `Draft`, then document writes and chat. Ship configuration uses socket handlers and per-actor queues. Drone records, when present, are ship flags (`data.drones`); no drone-specific UI or trustworthy transition engine exists. The local catalogue has only three manual base actions and incomplete drone descriptions. `drone-rules-matrix.md` distinguishes AoN snippets, local project records and the user's summary; the linked AoN full pages returned 403. The installed SF2e 1.7.0 files available locally do not provide the missing full drone descriptions. Do not treat the user's summary as a complete independent transcription or earlier AI answers as authority.

## Risk / outstanding work

No full drone tracking, type-specific actions, mines, timed effects or upgrade automation is implemented. All need per-instance state, permissions, retries, GM authority and regression tests, and direct source confirmation where the matrix marks uncertainty. The current combat `Draft` is not an atomic multi-document transaction, and actor queues do not cover every concurrent action path. No source data migration or deletion of legacy drone records is performed.

The user tested dev.1 in Foundry 14.370 / SF2e 1.7.0; dev.2 and dev.3 remain unconfirmed pending the user's tests. There is no live Foundry runtime here. The complete chat/no-op audit and actual multi-client tests remain unfinished. Action cards and rolls are intentionally distinct from optional change announcements. Large-image profiling must use Foundry with representative hardware and actual assets; synthetic results do not establish the root cause or fix.

## Implemented in dev.3

- The inventory display reads the existing console advancement rows and counts recorded drones without writing their data. With one console, legacy unassigned records count against it; with multiple consoles they are reported as unassigned, and records pointing to a removed console are reported separately as unresolved. Downgrades produce a GM warning without deleting records. There is no drone management interface or automatic deployment.
- Automatic offer/resolution of Drone Block for a Strike was disabled: the old implementation used the ship's level and did not retrieve or lock a specific drone. The action description remains available as a **manual** reminder; the GM must adjudicate the reaction and damage. This intentional safety change removes an existing automation, not an implementation of the complete reaction.
- All three catalogue frames and all their level rows are exercised by mock tests. Frame defaults count against capacity independently of record order, and duplicate legacy IDs cannot claim the exemption twice. Recognition still depends on the original deterministic IDs and standard stations; customized or remapped records require review.
- Reassigning an upgrade to its current station no longer clears approval or writes. A repeated map state does not update Combat, while first initialization remains possible. A crew claim no longer creates both a generic change announcement and a separate claim card; silent claims still record history but suppress the optional announcement. These changes do not prove that every module or integration operation is no-op safe.

## Chat source audit

Optional ship-change announcements originate in `scripts/history/history.mjs`; station claims previously added a second card and now use the central notifier. Rolls and explicit inline links (`scripts/rolls/ship-rolls.mjs`, `scripts/ui/inline-clicks.mjs`), action and damage cards (`scripts/chat/chat-cards.mjs`, `scripts/actions/action-engine.mjs`), attack cards and GM diagnostics (`scripts/chat/attack-card/service.mjs`), manual cards (`scripts/starship/ship-service.mjs`), sustain reminders (`scripts/combat/starship-combat.mjs`) and initiative failure warnings (`scripts/combat/initiative.mjs`) have separate paths. Their classification, mode policy and every no-op interaction are not yet fully resolved; no global completeness claim is made.

## Production-template Chromium profile (not Foundry)

`node tools/profile-sensor-map.mjs` uses the actual `templates/sensor-map-zones.hbs`, `styles/main.css` and `paintMapAppearance`, with mock Foundry settings, 12 zones, 48 buttons and generated 512×512 / 4096×4096 PNGs. It compares replacing the viewport with replacing only zones, using 10 warm-up and 60 measured updates, 4px blur, opacity 0.8, two animation frames per update. Local run: headless Chrome for Testing 153.0.8010.12, software rendering (`--disable-gpu`), 920×520; no Foundry process, actual actor logic, socket, production user asset or real GPU. The 4096 PNG was about 41 MiB and was decoded before timing. CDP layout/style sums include warm-up and setup; frame times are scheduling-dependent, not paint-only timings.

| Image | Viewport replacement: JS median / p95, two-frame median / p95 (ms) | Zone-only replacement: JS median / p95, two-frame median / p95 (ms) |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| none  | 0.7 / 1.0; 33.3 / 33.5                                             | 0.7 / 1.5; 33.3 / 36.3                                              |
| 512   | 0.6 / 1.0; 33.4 / 49.9                                             | 0.6 / 1.0; 33.4 / 50.2                                              |
| 4096  | 0.6 / 0.8; 33.3 / 33.6                                             | 0.7 / 1.1; 33.3 / 33.4                                              |

These measurements did not reproduce the user's large-image lag or identify whether replacement causes it; they do not contradict the user's observation in Foundry. Background replacement remains in the module. The fixture is a closer approximation than dev.2's but is not a substitute for live profiling. Running it requires Python Pillow, Playwright and Chromium, and temporarily generates large test files under `dist/sensor-profile`.

### Live profiling checklist

1. Back up and copy the world; record Foundry/SF2e/module versions, browser, OS, GPU, viewport, zoom, filters, exact image dimensions/format and memory. Save a copy of the original large asset.
2. In Chromium Performance, record map open and repeated object moves with no background, the original large background, and a visually similar downscaled copy; use the same scene and operations. Capture enough samples after the image has loaded and separately capture cold load.
3. Inspect scripting, image decoding, layout, paint/raster/compositing, memory and dropped frames. Note whether `.tsc-map-background` is replaced during zone refresh. Do not change the production world or infer causation solely from image size.
4. Compare a controlled prototype that preserves the background using the same world/hardware, then retest appearance changes, drag/drop, scrolling, zoom, permissions and multiple clients. Record traces and numbers before claiming a fix.
