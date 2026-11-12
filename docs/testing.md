# Testing

## Evidence and local commands

This is historical offline evidence and an **unexecuted live-world checklist**, not release certification. Consolidation date: **2026-11-11**; earlier stage reports did not record calendar dates. Their results are preserved as reported, not independently rerun by this cleanup. Manifest declarations, source review, Node mocks, Chromium fixtures and hosted CI are not live Foundry tests. The current manifest is **0.17.1-dev.13**, with **22 packs**; totals below belong to their recorded worktrees.

Use `npm ci`, then `npm run check`; install Chromium with `npx playwright install chromium`, then `npm run test:ui`. Linux CI uses `--with-deps`; `CHROMIUM_PATH` selects an existing browser. Packaging is not compatibility evidence. See [release readiness](release-readiness.md) and [reality check](reality-check.md) before any tagging/publishing.

## Post-wizard audit — local results, 2026-11-12

Review base `f87c983a9cbafd4a9aff086bd416ed77bef9d6d5`, branch `review/reality-check-1.0`, unchanged `0.17.1-dev.13`: `npm run check` passed **1,242/1,242** tests with zero failures, cancellations or skips, plus formatting, ESLint, content validation and 22 compiled packs. `npm run test:ui` passed **57/57** Chromium fixtures. Source/mock tests cover stale Draft/queued writes, current-occupant release permissions, copied Undo receipts, private resize, public/private cleanup retry, typed/nonlethal damage, attack modifiers, manual Protocol, catalogue defenses and Seek natural dice. EN/RU creator browser fixtures used mocked Documents; no real Foundry server or installed system was exercised. See [Reality Check](reality-check.md) and [release gates](release-readiness.md).

Package verification checked matching ZIP-root/external manifests, checksums and declared pack structures. All 22 packs extracted from the installation ZIP with the real LevelDB reader: 1,084 JSON records, nonempty packs and unique document IDs per pack. This does not load Foundry Document schemas. Guide headings were compared with the review base; all 45 EN/RU headings remain unchanged.

## Reliability follow-up — local results, 2026-11-11

Baseline `9e833adcb301769b40ba2cb696df1ad994b4c4bc`: `npm ci` succeeded; `npm run check` passed 815/815 Node tests and `npm run test:ui` passed 54/54 Chromium fixtures. The follow-up passed format, ESLint, content validation, all 22 pack builds and **1041/1041 Node tests** with no failures, cancellations or skips; **55/55 Chromium fixtures** passed without page errors. The production Sensor Map fixture contributes 49 assertions using an actual 8100×11700 PNG, 360 objects, retained full/partial renders, a native 512×512 image, cache invalidation/cleanup and explicit recovery success/failure/busy/player checks; it also passed through a local HTTP preview.

A full run caught the public-marker/invalid-private-journal regression; the implementation was corrected without changing the old assertion, and reserved-identity guards gained coverage. The native-attack fixture's GM mock was updated to the authenticated authority contract, preserving its original assertions and adding a real response/button-release check. No tests were disabled or thresholds relaxed. These are Node mocks and local production-code browser fixtures, not a live Foundry server or installed SF2e/PF2e/Toolbelt world.

## Reliability follow-up — live checklist (not executed)

Use a backed-up disposable world, Foundry **14.361** and separately the installed v14 build, **SF2e 1.6.1**, and a separate **PF2e 8.6.1 + SF2e Anachronism 2.4.0+** world. Record the exact installed builds and dependency versions; these are requested test configurations, not verified compatibility. Test with Toolbelt off and with a Toolbelt/libWrapper pair whose manifest supports that system. Use two GM accounts and a separate player client. Local Node mocks and Chromium fixtures do not load these systems or the Foundry server.

1. Open Sensor Map with an ordinary 512-pixel background, then an **8100 × 11700** raster and at least 300 objects. Repeatedly select, move, change zones, edit Actors/Items and switch station docks. Inspect the background DOM identity and network panel: unrelated renders must not reload it. Check rotation, flips, transparency, blur, themes and portrait quality. Change/remove the background during loading, close/reopen the map, and test inaccessible and remote/CORS-restricted images. The original file and stored path must remain unchanged.
2. Change/delete/recreate mapped Actors, embedded Items, effects, token/synthetic Actors and compendium content. Revoke user ownership and switch the active combat. Confirm HP/SP, status, artwork, targeting and statistics refresh without exposing unknown/private identities or retaining deleted documents.
3. From the player client start a GM-owned check dialog; leave it open past the initial request deadline but finish before the result deadline. Then test a never-completed handler, disconnected player socket, GM disconnect and active-GM replacement. The waiting UI must settle; late or duplicate results must not complete a newer request. Inspect the documents and chat before retrying: a timeout does not cancel a server operation or guarantee exactly-once execution.
4. In Toolbelt apply ordinary noncritical typed damage with manual ×2 and ×3, including direct-to-hull and shields. Compare IWR, Hardness and HP/SP with the existing engine; manual scaling alone must not increase Compromised. Test an actual native critical result with ×1 and ×0.5, missing/conflicting metadata, zero damage and repeat-application receipts. A critical success on a save/check is not a critical hit. Separately verify the starship's own critical save failure (+2 Compromised) through the existing target-bound save paths or explicit GM damage; Toolbelt's manual ×2 does not prove that target's save result. Critical ship-state and initiative transitions still require live verification.
5. For an eligible heading/effect/off-kilter Undo, simulate a failure before the Actor write and after Actor restoration but before history finalization. Retry the same record, including after reload; restore only once and finalize its audit record. Change Actor or Combat state before retry and confirm refusal. Confirm identical objects with reordered keys pass guards, while array ordering and actual value changes do not. HP, SP, damage, critical states and unsafe drone changes must remain non-undoable. Check GM-only journal and legacy whisper history, and the 80-record bound.
6. Reveal NPC, simple/complex hazard and custom private contacts. Inject failures at each JournalEntry, Combat, Actor and Combatant stage, including an update that saved but whose response was lost. Use explicit GM recovery, then repeat it: retain Actor/Combatant IDs, initiative and unrelated map edits; never duplicate placements. Test an existing anonymous initiative entry, deleted Actor, ambiguous duplicate objects/Combatants, invalid journal permissions and GM loss midway. Conflicts must leave durable progress and an actionable GM error, not claim a multi-document transaction. Verify private journal filtering and already-revealed information on the separate player client.
7. Regression: independent Actor copies/source immutability, player/NPC initiative, ships/crew/stations, drones, mines and contact sync, native attacks, Toolbelt normal-actor/healing behavior, English/Russian text, optional integrations absent/present. No action or reaction accounting is added.

Stop on unexpected resource changes, private-data exposure or conflicting documents; preserve the evidence and reconcile from a backup rather than blindly repeating an operation.

## Historical dev evidence (consolidated 2026-11-11)

The obsolete dev.5–9 and dev.13 reports are consolidated here and in [dev.13 release history](releases/0.17.1-dev.13.md). Dev.5/6 began from source archives without Git history; dev.7–9 used preceding session worktrees, not the original dev.1 ZIP. No live Foundry installation or AoN archive was supplied. Inputs included user-provided Tech Core printed pp.179, 184 and 192–193, personal Mine Exocortex pp.36–37, static SF2e 1.6.0 source review and indexed AoN builder excerpts. Earlier Huiji Wiki translation was a secondary cross-check with lost cost glyphs, not official text. Printed wording took precedence over paraphrases; this is not an AoN-exclusive source claim or a reproduced extraction.

Repair interpretation retained from dev.4/7: printed p.193 supports two actions, base DC 15, critical success 2d6, success 1d6, critical failure 1d6 piercing, expert/master/legendary DC 20/30/40 with +10/+30/+50 healing. The paraphrased extra 1-hour/1-day extension was not confirmed and was not added. Operator-level Drone Block was confirmed from printed p.179; a regression uses operator level 9, ship level 2 and resistance 4. Personal Mine Exocortex effects were not substituted for starship Smart/Targeting or Install Mine. See [rules decisions](rules-decisions.md) and [current limitations](known-limitations.md).

Historical `check` results include formatting, ESLint, content validation, pack builds and the stated Node tests. Dev.5–9 used `npm ci --no-audit --no-fund` and `CHROMIUM_PATH=/usr/local/bin/chromium npm run test:ui`; npm warned about classic-level's install script not being in allowScripts, and packs were checked separately. All results are mocks/fixtures, not live certification; older report dates were not recorded.

| Stage                     | Recorded local results                                                   | Meaningful coverage                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dev.2–3                   | Baseline 446 Node / 41 UI; dev.3 **454/454 / 41/41**                     | Drone capacity/ambiguous IDs; same-ID socket coalescing, payload conflicts/stale replay, cross-station mine ambiguity, rejected repair, revoked permission, save/initiative order and legacy HP/SP Undo refusal.                                                                                                                                                                                        |
| dev.4                     | Baseline 454 / 41; final **473/473 / 41/41**                             | `drone-repair-0174`: own-ship/active-map route, four degrees, rank/DC tiers, native-roll failure, permissions, ambiguous IDs, target restrictions, state conflicts, repeated/concurrent requests, modifier scoping, receipt caps, old fields, UI-to-handler mock and save/cleanup failures.                                                                                                             |
| dev.5                     | Baseline 473 / 41; final **484/484 / 43/43**, 22 packs                   | 11 `mine-modification-0175` tests plus GM/player template fixtures: Smart/Targeting, expiry, preserved fields, movement, replay/payload conflicts, GM-only cards, cancellation and operator-level Drone Block. Localization/formula issues fixed before final pass.                                                                                                                                     |
| dev.6                     | Baseline 484 / 43; final **493/493 / 45/45**, 22 packs                   | Nine `mine-targets-0176` tests plus two generated-dialog fixtures: mapped source/targets, hazards, duplicate IDs, invalid zones, unknown/unresolvable Actors, Smart exception, GM whispers/escaping, stale dialog, cancellation and same-client concurrency. No new mine fields/migration.                                                                                                              |
| dev.7                     | Baseline 493 / 45; final **512/512 / 47/47**                             | `drone-soft-0177` and two dialogue fixtures: basic-save degrees, Targeting/Smart, manual fallback, stale state, partial/cancelled progress, Harry outcomes/DC, GM permission, per-drone Intercept, replays, receipt caps and same-process concurrency. Mine damage/Harry conditions still manually applied at that stage.                                                                               |
| dev.8                     | Baseline 512 / 47; final **528/528 / 47/47**                             | `drone-assist-0178`: guided mine damage/per-target receipts, duplicate/concurrent requests, stale state, Harry module effects/timing, potential Intercept hints, per-drone protocol/Fetch/cooldown, pet cabin and movement hints. Two Russian localization/dialog-class issues fixed before final pass.                                                                                                 |
| dev.9                     | Baseline 528 / 47; final **536/536 / 47/47**                             | `pet-monitor-0179`: observed endings, persistent end marker, duplicate station rejection, stale session, no-op/non-GM; `toolbelt-0142`: Harry on PC/NPC adapters without repeated stacking/native-stat mutation; `toolbelt-damage-0143`: Better Chat refusal. Chromium modeled asynchronous target rows and a previously recognized target becoming unresolvable. ESLint issue fixed before final pass. |
| dev.10–11                 | Exact totals not retained in these pairs                                 | Private-store/drag mocks did not model server-side JournalEntry filtering. Install Mine notes tested confirmation, preserved fields, invalid/duplicate inputs, non-GM refusal, replays and stale-plan rejection; notes were not inventory/effects.                                                                                                                                                      |
| dev.12 detection UX       | **790/790 / 49/49**                                                      | `sensor-contacts-01712`: all four placement states, changes, anonymous observed projection, identified reveal, legacy Combat flags and mocked ownership. Editor/map tests ensure observed/reveal actions do not call confirmation dialogs.                                                                                                                                                              |
| dev.13 original follow-up | **767 Node / 49/49 UI**; `npm run package` and `git diff --check` passed | Crew claim/release service integration and competing same-station claims, native Drone Block/cooldown and placement/source immutability. Not a new hosted run; see CI diagnosis below.                                                                                                                                                                                                                  |

### Historical safety inputs retained from dev.5–9

- Modify Mine is evaluated through the next operator turn, not automatically deleted. Missing/changed order, another combat or malformed timing fail closed; rewinding can change apparent expiry and needs GM review. One active modification is a conservative module limit, not a game rule. `tscModificationReceipts` caps 512 IDs per mine; payload conflicts/full or malformed stores refuse rather than evicting evidence.
- The map only lists registered ships; GM verifies missing targets, range, exception, timing and defenses. Dev.6 produced instructions, dev.7 raw basic-save damage, dev.8 confirmed ship IWR/Hardness/SP/HP application plus separate closure. No automatic movement detonation, all-path reaction coverage or safe resume UI. Rolls/system hooks may already have happened after card failure: inspect before retrying.
- Harry uses module off-kilter/off-guard, not native conditions; timed success needs one unambiguous ship combatant. Intercept hints cover a supported pre-roll route only; GM establishes hit/trigger, manually sets −2 before resolution and records use. Fetch is a separate same-turn confirmation with conservative order/cooldown guards. Pet quickened, type/proximity/relationship and voluntary departure stay manual; dev.9's observed `ended: true` narrowed dev.8's reactivation hazard, but missed events without a GM cannot be reconstructed.
- On-use fields, not a new bulk migration: `tscMineModification`, `tscModificationReceipts`, `tscInterceptUsed`, `tscInterceptReceipts`, `tscMineDamageReceipts`, `tscHarryReceipts`, `tscProtocolBlocks`, `tscProtocolFetchPending`, `tscProtocolPendingTurn`, `tscProtocolCooldown`, `tscProtocolReceipts`, `tscPetOnboard`, `tscPetReceipts`. Existing fields and `droneRepairReceipts` were preserved. Bounded receipts/one-GM queues are not distributed locks/exactly-once; clearing receipts can permit old requests.
- Actor/Combat flags do not become private because a control/card is GM-only. Actor, Combat, history, chat, roll hooks and multiple targets are separate writes. Reconnection, cross-GM concurrency, external writers/failover and old worlds were not live-verified. No new action/reaction accounting or unsafe damage/condition Undo was claimed; use backups.

### Historical Toolbelt source review

Source/release review, **not live execution**, compared Toolbelt **3.60.0** (`6e4b48c9371b6f5dc64af4d0e0b202d832c6c8a0`) and **3.61.3** (`58302c799c7bf8b66cdf9e1ca2b65e7760d45f92`). The [3.60.0 manifest](https://raw.githubusercontent.com/reonZ/pf2e-toolbelt/3.60.0/module.json) declared Foundry 14.361+, SF2e 1.4.0+, PF2e 8.4.0+. The [3.61.3 release ZIP](https://github.com/reonZ/pf2e-toolbelt/releases/tag/3.61.3) declared SF2e 1.7.0+, PF2e 8.7.0+ and required libWrapper; its checked-in tag manifest reported 3.61.2, unlike the ZIP's 3.61.3. Thus 3.61.3 did not declare support for the project's older SF2e 1.6.0/PF2e 8.6.0 minimums. Inspect the installed ZIP; do not upgrade a world silently.

The inspected [Target Helper damage file](https://github.com/reonZ/pf2e-toolbelt/blob/3.61.3/src/tools/target-helper/tool/damage.ts) was identical in both tags: `data-target-uuid`, `data-target-roll-index`, `target-applyDamage`/`target-shieldBlock`; [saves](https://github.com/reonZ/pf2e-toolbelt/blob/3.61.3/src/tools/target-helper/tool/_saves.ts) requested `actor.getStatistic`. [Better Chat](https://github.com/reonZ/pf2e-toolbelt/blob/3.61.3/src/tools/better-chat/merge/process.ts) merge removes originals/creates messages, inject changes rolls, split recreates messages. Ship damage with `betterChat.mergeDamage`, `betterChat.injected` or `betterChat.splitted` was refused even before original application because message-ID/roll-index receipts cannot safely follow those transformations. Previously recognized ships becoming unresolvable were blocked; never-recognized rows could not be classified. Unknown transformations/programmatic APIs remain outside that guarantee.

Mine/Harry helpers use `createMessage: false` and GM module cards, not normal Target Helper cards. Separate system cards have independent receipts: do not apply one physical effect through both workflows. The ship engine does not reproduce Toolbelt `getContextualClone`, ephemeral effects, complete system IWR or necessarily its applied indicator. No Toolbelt/system code was bundled or changed by that review.

### Historical dev.13 CI diagnosis

Development source `c64ffd4bb5c9ea3d18d85bdca02b8f39942eeb8c`, parent `d6589c7e706f4c534c92caf86281f875249e4a76`; CI #23 (`42905167760`, head `c64ffd4`) passed `check` and failed `ui` at **46/47**, only `mine-modification/gm.html` → `install-gm-only`. The fixture searched `data-action="installMinePlan"`, while the template used `data-action="installMineStock"`. Selector corrected without reducing count/strictness. Negative local control with the old selector: **48/49**, same sole failure; restored selector: **49/49**. Chromium did start.

Node.js 20 action deprecation concerned `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` run by the runner on Node.js 24; job runtime was Node.js 22. `punycode`/`url.parse` warnings were not the assertion's cause; no `ubuntu-latest` warning was found. Workflow versions were not changed. The original worktree was intentionally uncommitted/unpushed: local results did not constitute an updated hosted run or live Foundry test. Follow [the unexecuted dev.13 Russian checklist](MANUAL-TEST-0.17.1-dev.13-ru.md) and the reliability checklist above.

Historical artifact check: `dist/module.zip` had root `module.json`, release/manual docs and no extra top directory; SHA-256 was in accompanying `dist/SHA256SUMS.txt` (no exact artifact hash retained here). This is not a claim about a newly built ZIP. Other inspected sources: `Huxtuntios/sf2e-missing-tech-pets` for engineering patterns only (no drone rules/dependency), and PF2e AppV1/AppV2 character-sheet header hooks, not live API execution.

## 0.16.1-dev.6 — historical native-attack checks

`tests/unit/native-attack-0166.test.mjs` exercises chat modes, target validation, four attack degrees, MAP, separate events/weapons, deferred damage, system callback, duplicate receipts, simulated socket authorization and no blind retry after ambiguous failure. `tools/smoke-native-attack.mjs` checks preserved native HTML and nonduplicated controls after rerender. Mocks/local Chromium, not live SF2e 1.7.0; use the live checklist above.

## Earlier historical checks and manual scenarios

The following version-specific records have no calendar dates in the originals; consolidated 2026-11-11 as offline evidence and unexecuted plans. Later sections supersede old theme pickers, public-only contact drops and HP/SP/damage Undo expectations. None certifies a current live world.

### 0.14.1 compatibility-release checks

`npm run check` passes 315 Node tests with no skips. Four new tests cover core/system declarations, rejection of missing metadata, equality of the external/ZIP manifests, and the post-upload verification workflow. This validates packaging, not live Foundry activation. The module still requires Foundry v14 and an SF2e 1.6.0+ world; no v13/PF2e compatibility is claimed.

## Historical automated checks (0.14.0; not current totals)

- `npm run check`: Prettier-supported source files, ESLint with zero warnings, content/reference validation, 11 compiled packs and **311 Node tests**. Pack tests reopen all packs with the actual LevelDB reader.
- `npm run test:ui`: **33 local Chromium pages** — 20 ship-sheet fixtures, one interaction fixture, eight Station HUD/Crew Manager fixtures, two Sensor Map assertion fixtures and two static appearance-form previews. The two static previews are not full interaction tests.
- `npm run build:release`: portable runtime ZIP, matching root/external manifest, 11 packs and SHA-256 checksums. Packaging regression tests reject version mismatches and developer-only payloads.
- Optional Python provenance tools: nine files pass Python syntax checks and Black. The original extraction pipeline was **not** rerun against the source materials/dumps.
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
4. Apply manual laser damage with a reason. Verify shield/hull deltas and ship/station/effect links. Confirm HP/SP/damage Undo is refused; use an eligible heading/effect edit to test refusal after incompatible edits or a new turn.
5. Check action/critical/crew/configuration entries are audit-only; the current history Journal and trusted legacy GM-whisper records are inaccessible to players. Reopen the world and test history retention, duplicate clicks and failure notifications.

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

## 0.16.0: unified client UI theme

The previous version-specific theme instructions elsewhere in this document document historical behavior and are superseded by this section. `starshipSheetTheme` remains client-scoped, now with Follow Foundry, Light and Dark; there are no per-window theme pickers. Offline unit tests cover selection, core setting changes, isolated repaint, retained map custom colors and the absence of selectors. The browser fixture renders the actual builder and history templates in both colors; existing fixtures cover sheets, HUD, crew, action, map and interactions. Native select rendering is platform-dependent; a headless browser cannot establish the appearance of every OS popup.

Live checklist (not executed by the offline test suite):

1. Back up and use a disposable Foundry v14 world, with SF2e or supported PF2e + Anachronism. Open player/NPC sheets, builder, history, Crew Manager, Station Actions, module action Item, Sensor Map and dialogs. Inspect all three modes.
2. In Follow Foundry switch the Foundry application theme while windows are open and after reopening. Check both explicitly selected and default application themes; test unsaved fields and tab state.
3. Use two independent clients with opposite module preferences; reload each and verify persistence and independence. Confirm earlier saved Light/Dark is retained. Confirm unrelated Foundry windows do not change.
4. Open select menus on each target OS: selected, hovered, disabled and long entries; use arrows, Enter, Escape and Tab. Validate actual native popup contrast and assistive technology.
5. On the map retain art, custom colors, background and filters; switch both client themes and re-open the appearance editor. Custom colors can be incompatible with a chosen palette.
6. Create and edit a ship, crew assignments, stations, weapons and bays; search history and exercise guarded undo in a disposable world. Verify no gameplay or document changes result from theme changes. Repeat with optional integrations on/off.

## 0.17.1-dev.1 verification plan

Automated: `npm run check` and `CHROMIUM_PATH=/usr/local/bin/chromium npm run test:ui`. Mock tests cover input validation, world/Compendium UUID resolution, permission checks, duplicate requests, disclosure and preserving visual state; a local DOM fixture exercises drag events. These do not exercise Foundry.

Live test (not performed): back up a disposable Foundry 14.370 / SF2e 1.7.0 world, with a GM and at least two player clients. Drag a visible player ship, NPC ship, and hazard from the directory and from a compendium; cancel and confirm disclosure. Check zone, artwork, source UUID, duplicate moves, no-op repeats, invalid zones/types/UUIDs, player permissions and reload. Never use this feature for secret hazards: the underlying Combat flags are not private. Test locked Compendium Actors separately and use world Actors for gameplay writes.

Hide course arrows with single and crowded zones, test art and fallback alignment. Choose left/right base direction, switch headings with Auto Mirror on/off, check manual X/Y flips, rotation, repeated renders, absent heading and Unknown base; verify old maps retain their orientation. Compare each catalogue weapon's `system.category` with builder and installed summary, custom explicit ranks, unknown/malformed entries, and English/Russian. Repeat concurrent client operations, GM disconnect/failover and all old regression plans; mocks do not establish safety.

## Additional current live regressions (not executed)

Use [the dev.13 manual checklist](MANUAL-TEST-0.17.1-dev.13-ru.md) and the reliability plan above for native Drone Block, source copies, station claims and contact recovery. Also test Repair Hull self-ship/active-map restrictions, four degrees and DC/rank combinations, cancellation/failed saves, preserved old fields and receipts; Mine Stock/Install Mine versus old notes, mine deployment/contact sync after deletion/failure, shrinking the map, modification expiry and partial detonation. Check Protocol block/Fetch flags without automatic resistance, Intercept reset only on explicit Retrieve, and preserved stock/armed mines while a drone is returned. Test Pet observed endings/missed events/manual quickened and Harry module versus native conditions. Repeat on separate GM/player clients, GM disconnect/failover, and SF2e versus PF2e + Anachronism. These are still plans, not new results.
