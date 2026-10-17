# Testing

## Current automated checks (0.14.0)

- `npm run check`: Prettier-supported source files, ESLint with zero warnings, content/reference validation, 11 compiled packs and **311 Node tests**. Pack tests reopen all packs with the actual LevelDB reader.
- `npm run test:ui`: **33 local Chromium pages** — 20 ship-sheet fixtures, one interaction fixture, eight Station HUD/Crew Manager fixtures, two Sensor Map assertion fixtures and two static appearance-form previews. The two static previews are not full interaction tests.
- `npm run build:release`: portable runtime ZIP, matching root/external manifest, 11 packs and SHA-256 checksums. Packaging regression tests reject version mismatches and developer-only payloads.
- Optional Python provenance tools: nine files pass Python syntax checks and Black. The original extraction pipeline was **not** rerun against the source PDFs/dumps.
- `npm audit`: no reported vulnerabilities in the installed development dependency tree at preparation time; audit results can change later.

Use `npm ci` from a clean checkout, then `npm run check`. Install Chromium once with `npx playwright install chromium` before UI checks. Linux CI uses `--with-deps`. `CHROMIUM_PATH` can select an existing Chromium executable for local runs.

The GitHub workflows are supplied but have not been executed on GitHub before publication. Local testing used Linux; Windows path handling is portable by construction, not a claim of an executed Windows test. Foundry templates with conditional attributes are explicitly excluded from Prettier's incompatible Glimmer parser, and covered by template compilation/DOM tests instead.

These checks do **not** replace the following live Foundry checklist.

`npm test` runs, in plain Node (no Foundry):

- **unit** — range, areas, headings/movement, action economy, damage/shields/bypassing, compromised/hull integrity, detection, hazards, frequency, advancement, migration, stacking, sensor-map operations (≈25 tests);
- **architecture** — no polling, no browser storage, no system patching, no hard dependencies, pure engine modules, all `SF2eTSC.*` keys present in `en.json`/`ru.json`, every `import {name}` resolves;
- **integration (offline)** — imports every module with Foundry stubs and builds every actor from the content (catches syntax/link errors; **does not run Foundry**).
- **0.4.0 suites** — `attack-card-040` (card build/visibility/whisper, preview spends nothing, revalidation, double-execution guard,
  per-creature MAP), `security-crew-040` (socket sender spoofing, GM-only responses, request sanitizing, reaction ownership,
  crew↔station consistency, portraits, crew→initiative planning/sync), `i18n-040` (same keys EN/RU, placeholders, no stray Latin
  in RU, all code/template keys exist, 100 % content dictionary coverage, labels/designations).
- **0.4.1** — `npc-rows-041` (NPC sheet regression: Engaged Strike binding, all 74 ships render Strike rows, ships without
  attacks / only abilities / station-linked abilities / unlisted Strikes, missing or invalid `kind`, empty/partial data, no data mutation).
  Total in 0.14.0: **311 tests** (all passing in the offline build, no skips).
  `node tools/validate-content.mjs` validates starships/hazards/stations/actions/weapons/frames (`validate-starships` …).

## Manual test plan inside Foundry v14 + sf2e 1.6.0 (not executed during development)

1. Ordinary creature combat and an ordinary vehicle still behave normally with the module enabled.
2. 3 PCs + 1 player ship: Crew Manager shows 9 ship actions per round; the ship has no combatant.
3. Initiative order PC1, NPC ship, PC2, complex hazard, PC3, NPC ship — the player ship gets no extra turn.
4. Ship at zone 2, enemy at zone 8 → distance 6 in the target preview.
5. Boost Thrusters → Change Heading → Boost Thrusters moves out and back; map updates on all clients.
6. SP 10 / HP 30, take 14 → SP 0 / HP 26; 10 bypassing → SP 10 / HP 20; HP 0 → Compromised 1, inoperable, stations malfunctioning, ship appears in initiative before the current turn and rolls the integrity check.
7. Simple hazard (no combatant) and complex hazard (combatant, routine prompt).
8. Player A (gunner) attacks, Player B (pilot) sees HP/SP, target and sensor map update. Reload / reconnect mid-combat: state restores.
9. With/without HoloDock, Aztec, Causodes.

### Manual scenario for 0.4.0 (Foundry v14 + SF2e 1.6.0; not executed)

1. **Language**: set client language to Русский, reload. Open settings, Station HUD, Sensor Map, Hazard Browser, ship sheet,
   builder, combat wizard — no English UI strings, station/action/weapon/hazard names in Russian, check links show "КС N …".
   Switch to English — everything back to English.
2. **Portraits**: create a player starship, drag 3 PCs into crew, assign two to stations. Portraits appear on sheet, HUD, crew
   window, wizard, Sensor Map. Change a PC's image → all views update without reload. Release a station → placeholder. Remove a
   PC from crew → their station frees. Open the raw JSON: `crew[].stationId` and `stations[].helmedBy` agree.
3. **Crew → initiative**: start combat with the player ship and one NPC ship via the wizard → each non-observer crew member is a
   combatant; add a PC mid-combat → added once, current turn unchanged; press _Sync crew with initiative_ twice → no duplicates.
   Change setting to _stationed_ / _off_ and re-check.
4. **Attack card**: on a gunner's turn, use a Strike → card in chat with weapon, range, traits, damage, modifiers, MAP, targets.
   Make one NPC ship hidden for the players: as a player it is absent from the card; GM sees a whispered diagnostic. Pick a target
   from the card → roll with correct MAP; click again → "already resolved". Declare another attack and pick the target on the
   Sensor Map → same result. Declare, then end the turn → card becomes stale, nothing spent. Second Strike shows −5 (agile −4),
   third −10/−8; another crew member's first Strike shows 0.
5. **Socket security**: from a player console call `game.socket.emit("module.sf2e-tactical-starship-combat", {type:"request", userId:<GM id>, …})`
   for a ship the player does not own → GM rejects it (debug log), nothing changes.

## 0.5.0

`tests/unit/sheet-rolls-050.test.mjs`: check rows (only existing statistics, final skill values), rolls with/without DC,
attack rows and request payload, NPC damage components, sanitizer (`sheetRoll`, `mapChoice`), manual MAP (once),
off-turn sheet attack with no actions/reactions spent, hidden targets, deferred damage (roll/reroll, GM-only apply, once,
bound target), station strikes unchanged, EN/RU parity. These run against the Foundry mock, not real Foundry.

## 0.10.0 manual checklist (interface pass — Node tests cover logic and template rendering only)

1. **Sheet**: open a player starship and an NPC starship. Five / six tabs (Overview, [Actions], Stations, Equipment, Notes, Edit). The header
   shows Hull and Shield bars; as a crew member (not GM) the two number inputs and the damage / repair buttons work and a change is
   saved; maxima and status flags are GM-only. _GM controls_ and _Combat log_ are collapsed `<details>` and keep working after a refresh.
2. **Sensor Map**: the bottom dock lists the actions of the station you helm (several stations → picker chips); clicking an action with a
   target starts targeting on the map, `Esc` or _Cancel_ stops it. A button with a ⚠ is enabled; after the action the chat card starts with the ⚠ line.
3. **Rule enforcement**: _Warn only_ — act from a station you do not helm / on a malfunctioning station / out of range: it works and warns.
   _Strict_ — the same attempts are refused with the reason (GM can still override).
4. **Scene controls** (Token group): Sensor Map, Station HUD, and for the GM Start Combat and Toolbox (crew manager, hazard browser, builder,
   encounter builder, diagnostics). One click opens each window once (no double window).
5. **Actors directory**: right-click a vehicle / npc → _Convert to … starship_ appears **once**; _Create Starship_ button works.
6. **Secret checks** (Scan Target, secret roll toggle): the result goes to the GM only.
7. **Diagnostics** (Toolbox): shows versions, GM online, data problems.

## 0.10.3 manual checklist

1. Load a world that already has station action items on characters / imported upgrades: after the load their the visible trait list and _Other tags_ contain `starship`
   (_Toolbox → Diagnostics_ shows "Every module item carries the starship tag"). Drag an upgrade or weapon from the compendium into the world: tagged.
2. _Magic Conduit_ in the Battle Stations journal (EN and RU): full text including the spell repository and tradition sentence.
3. _Cosmic Bombardment / Fortification / Repairs_: the spell-slot sentence; _Cosmic Cannon_: the cantrip sentence.
4. Open _Mystic Magic Module_, _Nova Prow_, _Gunnery Turret Mount_: the statistic line has _Requirements: … class_; _Powerful Thrusters_ has none.

## 0.10.1 manual checklist

1. **Sensor Map**: every contact shows its full name (or its designation for an unidentified one) inside its zone; long names wrap to a second line.
2. **Item tag**: open an action item of a PC created by the module, a starship weapon and an upgrade from the compendium: the visible trait list and _Other tags_ contain `starship`.
3. **Upgrade drop**: drag an upgrade from _Starship Upgrades_ onto a player ship (sheet and token/actor): with one suitable station it is installed there; with several (e.g. two gunnery stations with free slots) a dialog lists them with their quality and used slots, and the chosen one gets it; closing the dialog installs nothing. On a ship
   without that station, or with the slots full, nothing is installed and a whispered chat message names the reason.
4. **Overview**: Piloting DC shows `10 + pilot's Piloting modifier` once a character helms the pilot console and follows changes of the skill; Fort / Ref / Will
   post `@Check[...|dc:N]` to the chat and clicking it rolls. Perception and the saves in the grid roll with their displayed modifier; _Checks_ lists skills only.
5. **New ship at level 5+** (Create Starship): the station cards show the quality from the level table (not _commercial_).

## 0.11.0 appearance checks

Completed offline:

- `npm test`: 259 passed, 0 failed, 0 skipped (15 new appearance/glossary regression tests).
- `npm run validate`: 0 errors, 0 warnings in all six validators.
- `npm run build:packs`: all 11 packs rebuilt, including the updated bilingual guide.
- `npm run lint`: 0 errors; 22 existing style warnings (line length / an unnecessary escape).
- Chromium DOM smoke: 12 checks for each of dark/light (24 passed). Theme colors, artwork sizing, broken-image fallback, background-only blur, scrolling, partial render, custom colors, clearing/resetting the background. Rendered map and settings form inspected locally.

To generate the same local fixtures (not a live Foundry simulation):
`node tools/smoke-map-appearance.mjs`
Then open `dist/ui-smoke/map-dark.html` and `map-light.html` in Chromium with local-file module access enabled. The result line must show `"passed":true`. Sample illustrations are generated only in the smoke directory; they are not module assets.

Required manual checks in Foundry v14 + sf2e 1.6.0 (not executed here):

1. Back up the world, install 0.11.0, open a pre-existing starship combat. Existing objects, detection, initiative and movement must remain intact.
2. On a GM and two player clients, change the theme, mode, colors, artwork size and background. Confirm all maps update; reload/reconnect and confirm settings persist on that combat, not on an unrelated combat.
3. Use the image picker for a ship, hazard, planet and custom contact. Confirm map overrides do not alter actor portraits or prototype token images. Clear the override to restore the portrait/symbol.
4. Use an unavailable image: it must show the old symbol. Switch to Simple mode, then back: assigned art must survive.
5. Set the background opacity/desaturation/blur to both extremes, clear it, then restore defaults. Labels and object art must remain crisp. Horizontally scroll and select targets; the background must remain fixed in the viewport.
6. A hidden or merely observed contact must not expose its portrait or custom art to players. Identify it and confirm its image then appears. A player must not be able to change artwork or appearance through a socket request.
7. Re-import a Russian upgrade/ship from the rebuilt compendium (preserve custom edits first). Confirm «КД» and «Признаки». Previously imported descriptions intentionally remain unchanged.

## 0.11.1 client-local sheet themes

Completed offline:

- `npm test`: 268 tests, including 9 new regressions for client setting scope, independent clients, read-only theme selectors, duplicate-listener prevention, failed saves, refresh of other open sheets, player/NPC contexts and no actor/combat/socket writes.
- Local Chromium: actual player/NPC sheet templates in both themes on Overview, Stations, Equipment, Notes and Configuration (20 fixtures, 180 DOM assertions). Verified theme colors, form backgrounds, immediate switching, active-tab/draft preservation, replacement-header wiring and Sensor Map isolation. Light Overview, Stations and Configuration screenshots inspected.
- Fixture generator: `node tools/smoke-sheet-theme.mjs`; generated files are in `dist/sheet-smoke/`. These use test doubles, not a Foundry server.

Required manual checks in Foundry v14 + sf2e 1.6.0 (not executed here):

1. Open player and NPC ships on a GM client and two player clients. Pick a different sheet theme on each client; verify no other client changes its theme.
2. Change **Module Settings → Starship sheet theme**. Every open ship sheet on that client should update without a reload and retain its active tab. A newly opened sheet should use the saved preference.
3. Change the theme directly in a sheet header, including a read-only observer sheet. Other editing controls must remain governed by the original permissions.
4. Close/reopen the sheet and reload the browser. The selected theme should persist for that client. Another browser/client can have a different preference.
5. Inspect station warning panels, inputs, notes, equipment tables, active tabs and HP/SP bar labels in both themes. Confirm unsaved notes survive a header theme change.
6. Change a sheet theme while the Sensor Map is open: its theme/background/mode must not change, and no actor/combat updates should be emitted for the theme choice.

## 0.12.0 regression additions

`tests/unit/qol-0120.test.mjs`: 21 tests for Evade costs, stable turn anchors/round rollover, backwards navigation, duration validation, reminders, real mocked turn events, GM-only lifecycle handlers, explicit condition/sustain confirmation, audit deltas/permissions/forgery rejection/retention, guarded undo and client UI state/filtering. The original search/compact UI was removed in 0.13.0; current `tools/smoke-qol.mjs` tests theme, condition/damage interactions and client memory. These are offline tests, not live Foundry.

Additional live checks before production use:

1. With a GM and two players, resize/reopen each module window and reopen different ship tabs. Confirm that theme/window/tab memory never changes another client's UI.
2. Perform 1- and 2-action Evade. Check stored cost, AC bonus and expiry at the correct creator turn after an initiative insertion and the last turn of a round.
3. Set beginning/end of another combatant's turn, a three-round expiry, a custom condition and sustaining. Check that only GM confirmation ends custom conditions; reminders occur once per round and spend nothing.
4. Apply manual laser damage with a reason. Verify shield/hull deltas and ship/station/effect links. Undo a noncritical hit, then confirm undo is refused after incompatible manual edits or a new turn.
5. Check action/critical/crew/configuration entries are audit-only; history whispers and snapshot flags are invisible to players. Reopen the world and test history retention, duplicate clicks and failure notifications.

## 0.13.0 regression additions

`tests/unit/refinements-0130.test.mjs`: 11 tests for per-ship detection, custom-object artwork/type redaction, actual operator DCs, native typed damage, valued condition drops, real starship traits, station actions and upgrade compendium navigation. `tools/smoke-sheet-theme.mjs` renders 20 real-template fixtures (player/NPC × light/dark × five tabs); `tools/smoke-qol.mjs` adds one interaction fixture. All 21 passed in local Chromium, not live Foundry.

### Required live Foundry v14 / SF2e checks

1. As GM and as players, switch ship/HUD/native module action themes; verify input drafts, tabs, contrast and independent client preferences. Unrelated Item sheets must remain unchanged.
2. On world load and on import/create, inspect real Starship trait chips on module actions, upgrades, weapons and hazard actions, including existing tags-only items.
3. Start combat with different detection states for party/enemy ships and custom object art. Check identified/observed/hidden views from a non-owner player. Change an object's type as GM and verify player redaction.
4. Run player station actions from Stations, open installed upgrades via the book button, and verify save DCs with different operators/class/spell DCs; test missing and ambiguous statistics.
5. Click conditions in action/upgrade descriptions; drag valued conditions from both sheet and chat onto a character; right-click opens the system document. Confirm no duplicate handlers after rerender.
6. Click typed damage in text, ship strikes and attack cards; inspect native DamageRoll/chat buttons, multiple damage types and critical results. No HP/SP changes until explicitly applied; use module tools for Shield Points.
7. Confirm ship global search/Compact mode are absent, but catalog/upgrade/history searches still work; window/tab memory and conservative undo still work.

## 0.13.1 HUD / Crew Manager regression

`tests/unit/hud-crew-theme-0131.test.mjs`: three tests for the HUD single-root regression and Crew Manager theme/context wiring. `tools/smoke-window-themes.mjs`: eight real-template local Chromium fixtures (HUD/Crew Manager × dark/light × empty/populated). Chromium parses each part and requires exactly one top-level element with its selector inside; checks immediate switching, a single client-setting write, preserved controls/drafts, reopened theme and readable headers. All eight passed offline.

Live Foundry follow-up: open Station Actions with and without a helmed station, then open Crew Manager with and without ships. Switch light/dark from each window as player and GM; confirm theme is client-local and crew assignment/ready buttons still work. These checks have not yet been executed in a live world.

## 0.13.2 trait-label regression

`tests/unit/starship-label-0132.test.mjs`: checks existing SF2e localized dictionaries, absent module trait labels, both CONFIG namespaces and module EN/RU labels. Only the starship trait label changes; unrelated traits and object-type translations remain intact. In live Foundry, restart the world and refresh all clients, then inspect native weapons, actions, upgrades and creature/vehicle trait chips in Russian and English. Existing items do not need reimporting: stored trait slugs are unchanged. Live Foundry validation remains outstanding.
