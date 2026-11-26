# Native-first rebuild: API and architecture map

> Аудит T-003 и проверка контрактов T-004 от 2026-11-25. Это карта текущего checkout и точных проверенных версий, а не сертификат совместимости с будущими релизами. Раздел 12 фиксирует подтверждённые native-контракты; оставшиеся version-sensitive вопросы перечислены отдельно.

## 1. Baseline and evidence boundaries

| Item                          | Verified value                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                    | `C:\Users\kosth\Projects\FoundryVTT\sf2e-tactical-starship-combat`                                                                                                        |
| Branch                        | `rewrite/native-first-rebuild`                                                                                                                                            |
| HEAD                          | `fa3bb679ae908c08ce85483a76aa1726b976a3e3`                                                                                                                                |
| Module version                | `1.3.1`                                                                                                                                                                   |
| Manifest compatibility        | Foundry `14.361+`, verified `14`, maximum `14`; SF2e `1.6.0+`, verified `1.6.1`; PF2e `8.6.0+`, verified `8.6.1`; active SF2e Anachronism `2.4.0+` required only for PF2e |
| Runtime dependencies          | 0                                                                                                                                                                         |
| Direct devDependencies        | 9 in `package.json` and installed tree; the task baseline value 8 is inconsistent with the file                                                                           |
| Tracked JS/MJS/CSS/HBS        | 58,230 lines by `git ls-files ... \| xargs wc -l`                                                                                                                         |
| Tracked shape                 | 187 script modules, 102 unit-test files, 2 integration-test files, 1 architecture-test file, 20 HBS templates, 2 CSS files, 28 tool modules, 21 data JSON files, 29 docs  |
| Preserved user diff           | `scripts/actions/action-engine.mjs` +2 lines; `tests/unit/crew-weapon-proficiency.test.mjs` +47 lines; no other tracked changes before these two audit documents          |
| Installed versions identified | SF2e `1.7.1`, PF2e `8.7.1`, Anachronism `2.5.1`, Toolbelt `3.62.0`, Workbench `7.7.5`, HoloDock `1.0.1`, Aztec `1.0.3`, Causodes SF2e `1.5.2`                             |
| Live Foundry in this audit    | Not run. Historical live results are cited separately and are not a new execution.                                                                                        |

Evidence tiers used below: **source** = current file read; **mock** = Node/Chromium test executed; **historical source review** = repository record for an exact older provider version; **historical live** = repository record of a previous live run; **T-004** = unresolved native contract.

## 2. Repository and generated/source boundaries

- Runtime entry: `module.json` -> `scripts/main.mjs`; no bundler/transpiler.
- Canonical gameplay content: `data/*.json`; generated `packs-src/*.json`; compiled LevelDB `packs/*`; installable output `dist/*`. Do not hand-edit LevelDB.
- Source and generated packs are ignored by Git; tests skip some pack-source checks when `packs-src/` is absent.
- Local browser fixtures are generated under `dist/ui-tests/` by `tools/test-ui.mjs`; they render production templates with mocked Foundry boundaries.
- CI: Node 22, `npm ci`, `npm run check`, `npm run package`; separate Chromium job runs `npm run test:ui`.
- Release workflow runs after publication and attaches assets with `--clobber`; immutable releases require draft assets first.

## 3. Activation and lifecycle

```text
module.json esmodules
  -> scripts/main.mjs imported
  -> Hooks.once("init")
       systemSupport gate
       settings, Handlebars partials, Actor sheet registrations, templates
       public API, actor creation/tagging/themes, scene controls
  -> Hooks.once("ready")
       content + translations
       actor.getStatistic adapter
       native socket
       crew/action/reaction/ship/effect/sensor handlers
       attack cards, reroll support, Toolbelt, station items
       combat/crew hooks, conflict check, refresh hooks, pet monitor
       active GM: migration -> world repair -> schema stamp -> private projections
       render Combat Tracker
```

Important lifecycle constraints:

- Scene controls must register in `init`: Foundry 14.370 calls `getSceneControlButtons` before `ready` (`scripts/main.mjs:65-90`, commit `954e6ff`).
- State-changing socket requests execute on the active GM; documents broadcast their own updates.
- Open windows refresh from hooks/debounced channels, not polling (`scripts/ui/base-app.mjs:78-103`).
- `TscApp`/`LiveMixin` own delayed renders and close cleanup; Sensor Map additionally owns actor-cache/background cleanup.
- Migration/repair is active-GM only and separate from rendering.

## 4. Public project API

Source: `scripts/api.mjs:23-67`. The stable namespace remains `game.modules.get("sf2e-tactical-starship-combat").api`.

| API                                                                                                                       | Current implementation / authority                                      | Transfer note                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `version`, `events`                                                                                                       | Manifest version and `HOOK_EVENTS`                                      | Preserve names and payload compatibility                                                                                        |
| `openSensorMap`, `openStarshipSheet`, `openNPCStarshipSheet`, `openHazardBrowser`, `openStarshipBuilder`, `openDashboard` | UI launchers                                                            | Preserve; prefer Foundry window registry                                                                                        |
| `startStarshipCombat(config)`                                                                                             | Direct service call; requires active GM                                 | Keep GM guard; preserve wizard config                                                                                           |
| `isStarship`, `isStarshipHazard`, `isStarshipCombat`                                                                      | Read-only predicates                                                    | Preserve                                                                                                                        |
| `getStarshipState`, `getSensorState`                                                                                      | Normalized read models                                                  | Preserve; do not persist derived values                                                                                         |
| `moveStarship`, `changeHeading`                                                                                           | Socket request to GM                                                    | Preserve authority and reveal guards                                                                                            |
| `executeStarshipAction`                                                                                                   | Socket request to GM                                                    | Replace singular target payload with native target resolution where appropriate                                                 |
| `executeStarshipActionAsGM`                                                                                               | Direct `executeAction` as current user; name does not itself enforce GM | Audit authorization semantics before preserving                                                                                 |
| `syncCrewCombatants`                                                                                                      | Direct service; explicit GM check                                       | Preserve idempotency                                                                                                            |
| `repairCrewAssignments`                                                                                                   | Direct service; explicit GM check                                       | Preserve as explicit repair                                                                                                     |
| `declareAttack`                                                                                                           | Socket request; no roll/write                                           | Preserve no-side-effect declaration                                                                                             |
| `applyStarshipDamage`                                                                                                     | Socket request; `adjustVitals`/GM validation                            | Preserve single damage path                                                                                                     |
| `triggerHazard`, `disableHazard`, `placeHazard`                                                                           | Direct service calls                                                    | High-risk API boundary: add/verify authority before any roll or write; `triggerHazard` can roll before a later GM write failure |
| `addSensorContact`                                                                                                        | Direct service; active-GM guard                                         | Preserve privacy/reuse/copy semantics                                                                                           |
| `pendingPrivateReveals`, `recoverPrivateReveals`                                                                          | GM-only diagnostics/recovery                                            | Preserve explicit, non-render recovery                                                                                          |
| `syncMineContact`                                                                                                         | GM-only idempotent projection repair                                    | Preserve                                                                                                                        |
| `privacyProbe`                                                                                                            | Any user; reports what this client sees                                 | Diagnostic only, not a security proof                                                                                           |
| `distance`                                                                                                                | Pure zone distance                                                      | Preserve                                                                                                                        |
| `convertToStarship`                                                                                                       | Direct Actor update; UI caller is GM-gated                              | Audit direct API authorization and data migration                                                                               |
| `crew`, `ship`                                                                                                            | Client facades over socket requests                                     | Preserve request names and server checks                                                                                        |
| `content`, `importer`                                                                                                     | Registry and direct document import/update helpers                      | `importer` methods rely on Foundry permissions rather than one uniform module guard; audit before exposing mutators             |

## 5. Project hooks

Source: `scripts/constants.mjs:92-107`. These are module contracts, not Foundry core hooks.

| Hook                             | Current emitter                                  | Status                                                       |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `sf2eTsc.starshipCombatStarted`  | `starship-combat.mjs:410,524`                    | Active                                                       |
| `sf2eTsc.starshipCombatEnded`    | `starship-combat.mjs:523,649`                    | Active                                                       |
| `sf2eTsc.starshipMoved`          | Declared; no emission found                      | Contract drift: verify historical intent before implementing |
| `sf2eTsc.starshipHeadingChanged` | Action effect path `effects-exec.mjs:52`         | Partial: map flip/heading writes do not emit it              |
| `sf2eTsc.starshipActionExecuted` | `action-engine.mjs:501`                          | Active after Draft commit                                    |
| `sf2eTsc.starshipDamaged`        | `damage-service.mjs:82`                          | Active                                                       |
| `sf2eTsc.starshipDestroyed`      | `damage-service.mjs:93`, `hull-integrity.mjs:32` | Active                                                       |
| `sf2eTsc.starshipCompromised`    | `damage-service.mjs:90`                          | Active                                                       |
| `sf2eTsc.stationMalfunctioned`   | Damage/effect paths                              | Active                                                       |
| `sf2eTsc.hazardTriggered`        | `hazard-engine.mjs:108,128`                      | Active                                                       |
| `sf2eTsc.hazardDisabled`         | `hazard-engine.mjs:152`                          | Active                                                       |
| `sf2eTsc.targetIdentified`       | `effects-exec.mjs:206`                           | Active for supported action path                             |
| `sf2eTsc.crewChanged`            | `crew-service.mjs:60,70,81,152`                  | Active                                                       |
| `sf2eTsc.stationClaimed`         | `crew-service.mjs:126`                           | Active                                                       |

## 6. Native socket transport and project handlers

Transport source: `scripts/socket.mjs`.

- Event: `module.sf2e-tactical-starship-combat`.
- Message kinds: `request`, `response`, `accepted`, `event`.
- Sender identity comes from the server-appended socket argument, never `msg.userId`.
- Only active GM executes requests; responses/events require a GM sender and matching pending GM/request.
- Initial wait 15 s; eligible attack/action requests receive one 120 s result deadline after first acknowledgement.
- Disconnect/GM change rejects pending waits. Timeout does not cancel a handler that may still write.
- Exact drone transport replays are coalesced for 120 s/512 entries; this is not distributed exactly-once.
- Local per-ship, per-combat and history queues are process-local, not cross-GM locks.

Registered request types (49):

| Group             | Types                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crew              | `repairCrewAssignments`, `addCrew`, `removeCrew`, `setCrewRole`, `claimStation`, `releaseStation`, `setReady`, `addStation`                                                                                   |
| Attack/chat       | `declareAttack`, `previewNativeAttack`, `executeNativeAttack`, `resolveAttackCard`, `rollAttackCardDamage`, `applyAttackCardDamage`                                                                           |
| Toolbelt          | `toolbeltDamage`, `undoToolbeltDamage`                                                                                                                                                                        |
| Combat/initiative | `setReadyDone`, `syncCrewCombatants`                                                                                                                                                                          |
| Sensor Map        | `sensorAddInitiative`, `sensorAddAllNpcInitiative`, `sensorUpdate`                                                                                                                                            |
| Reaction          | `reactionResponse`                                                                                                                                                                                            |
| Action            | `executeAction`                                                                                                                                                                                               |
| Effect            | `effectTiming`                                                                                                                                                                                                |
| Ship/equipment    | `patchShip`, `setStation`, `removeStation`, `equipment`, `droneState`, `stationUpgrade`, `actorBasics`, `replaceShip`, `applyFrame`                                                                           |
| Drone/mine/pet    | `markManualIntercept`, `installMinePlan`, `installMineStock`, `mineKnownMod`, `discardStoredMine`, `syncMineContact`, `modifyDroneMine`, `moveDroneMine`, `protocolDroneManual`, `petCabin`, `closeDroneMine` |
| Vitals/output/map | `gmDamage`, `gmRepair`, `hullIntegrity`, `manualCard`, `setZone`                                                                                                                                              |

Client events: `openSensorMap`, `reactionPrompt`.

Action input is whitelisted in `scripts/actions/action-engine.mjs:535-587`; it currently accepts singular `targetKey`, not a native multi-target list. Area exclusions are a separate action-specific list.

## 7. Settings inventory and compatibility

Source: `scripts/settings.mjs`. All keys must remain registered during migration even if their UI is later hidden or removed.

| Key                           | Scope          | Default      | Current use                                                                                         |
| ----------------------------- | -------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| `starshipSheetTheme`          | client         | `foundry`    | Module window theme                                                                                 |
| `chatAnnouncements`           | world          | `important`  | History announcements                                                                               |
| `historyStoreId`              | world, hidden  | `""`         | GM history Journal ID                                                                               |
| `sensorMapSize`               | world          | `12`         | Wizard/auto-detect zone count                                                                       |
| `reuseWorldActorsOnSensorMap` | world          | `true`       | Approved original-Actor reuse fallback                                                              |
| `combatPresets`               | world, hidden  | `{}`         | Wizard presets                                                                                      |
| `ruleEnforcement`             | world          | `warn`       | Warn/strict station rules                                                                           |
| `attackCards`                 | world          | `true`       | Legacy declaration-card path                                                                        |
| `nativeModifierDialog`        | world          | `false`      | Extra manual modifier form; native dialog remains default                                           |
| `autoOpenSensorMap`           | client         | `true`       | Open map after combat start                                                                         |
| `autoOpenCombatReview`        | client         | `true`       | Auto-open separate review dialog                                                                    |
| `autoRoutine`                 | world          | `prompt`     | Hazard routine off/prompt/automatic                                                                 |
| `contactDesignation`          | world          | `greek`      | Anonymous contact labels                                                                            |
| `showUnknownContacts`         | world          | `true`       | Registered but no runtime read found; preserve key, review UI honestly                              |
| `playerShipInitiative`        | world          | `disabled`   | Optional ship combatant before/after crew/manual                                                    |
| `crewInitiativeScope`         | world          | `crew`       | Crew/stationed/off participation                                                                    |
| `movementMode`                | world          | `clamp`      | Registered but no runtime read found; movement currently clamps                                     |
| `autoFireConeZones`           | world          | `0`          | Auto-Fire cone fallback size                                                                        |
| `areaWeaponZones`             | world          | `0`          | Area weapon fallback size                                                                           |
| `smallCrewWarning`            | world          | `true`       | Wizard warning below four active crew                                                               |
| `causodesConflict`            | world          | `warn`       | Permanent GM conflict warning                                                                       |
| `debugLogging`                | world          | `false`      | Debug log gate                                                                                      |
| `worldFixVersion`             | world, hidden  | `0`          | One-time repair version, current 6                                                                  |
| `dataVersion`                 | world, hidden  | `0`          | Starship migration version, current 2                                                               |
| `customContent`               | world, hidden  | empty arrays | Loader merges actions/weapons/stations/upgrades; declared `ships`/`hazards` arrays are not consumed |
| `uiState`                     | client, hidden | `{}`         | Last 100 window/tab/position records                                                                |

## 8. Sheets, windows and UI registration

Sheet registration: `scripts/main.mjs:76-79` via `DocumentSheetConfig.registerSheet` for `vehicle` and `npc`, both non-default.

| Class                                 | Role                                | Main template(s)                                                             |
| ------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `StarshipSheet`, `NPCStarshipSheet`   | `ActorSheetV2` ship sheets          | `starship-sheet`, header, tabs, `ship-editor`                                |
| `SensorMapApplication`                | Zone map, detail, dock, GM tools    | `sensor-map-bar`, `sensor-map-zones`, `sensor-map-detail`, `sensor-map-dock` |
| `StationHUD`                          | Helmed station actions              | `station-hud`                                                                |
| `StartCombatWizard`                   | Encounter draft/browser/presets     | `start-wizard`                                                               |
| `CombatReviewApp`                     | Separate pre-combat review          | `combat-review`                                                              |
| `CrewManager`                         | Cross-ship crew/station management  | `crew-panel`, `crew-ship`                                                    |
| `CrewStationsApplication`             | Character-sheet station companion   | `crew-stations-panel`                                                        |
| `StarshipBuilder`                     | Player/NPC ship creation            | `starship-builder`                                                           |
| `ContentBrowser`                      | Hazards/starships/equipment browser | `hazard-browser`                                                             |
| `EncounterBuilder`                    | Party/encounter guidance            | `encounter-builder`                                                          |
| `MapAppearanceApplication`            | Combat-scoped map appearance        | `map-appearance`                                                             |
| `SensorContactEditor`                 | Add world/compendium/custom contact | `sensor-contact-editor`                                                      |
| `HistoryApplication`                  | Read-only GM audit                  | `history`                                                                    |
| Diagnostics/effect/mine/Harry dialogs | Foundry `DialogV2`                  | Generated form content                                                       |

Additional UI integrations: Actor Directory create button/context menu, system sheet header buttons, Token HUD map button, Combat Tracker decoration, native Item sheet action context, chat card render hooks, station action Items on crew sheets.

Current density is already substantial: base font 13 px, map object 11 px, common gaps 2–8 px. Compactness work must be measured and targeted, not implemented by globally shrinking fonts (`styles/main.css:42-80,130-318,595-780`).

## 9. Data ownership, flags and migrations

| Data                                                             | Owner/store                                                                                                                            | Notes                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Starship marker/config/SP/crew/stations/weapons/upgrades/effects | `Actor.flags[MODULE_ID].starship`                                                                                                      | `isStarship: true` required; ordinary vehicles/NPCs untouched    |
| Hull Points                                                      | `Actor.system.attributes.hp`                                                                                                           | Mirrored into read model; native token bars/XP stay system-owned |
| NPC saves/AC/skills                                              | Native actor system fields plus module read model                                                                                      | Import mirrors values; adapter adds only module delta            |
| Hazard config                                                    | `Actor.flags[MODULE_ID].starshipHazard`                                                                                                | Hazard Actor remains native `hazard` type                        |
| Encounter map/knowledge/log/hazard state                         | `Combat.flags[MODULE_ID].tsc`                                                                                                          | Shared document; public projections only for private contacts    |
| Private contact identities/reveal intents                        | GM-only `JournalEntry.flags[MODULE_ID].privateSensor`                                                                                  | Ownership NONE; not a strict raw-client confidentiality boundary |
| History                                                          | GM-only Journal `historyStore` plus trusted legacy GM whispers                                                                         | 80 records; read-only                                            |
| Station action Items                                             | Crew Actor embedded `Item.flags[MODULE_ID].stationAction`                                                                              | Generated idempotently from current assignments                  |
| Content provenance                                               | `flags[MODULE_ID].content`, `packAction`, `packWeapon`, `explorationActivity`, `hazardItem`, `tacticalCopyOf`, `sensorContactInstance` | Preserve stable IDs/provenance                                   |
| Chat metadata                                                    | `card`, `attackCard`, `nativeAttackReceipt`, `damageReceipts`, `attackCardDamage`, `autoAppliedDamage`                                 | Duplicate-application and reroll correlation                     |
| Client UI preferences                                            | Setting `uiState`                                                                                                                      | Client-local, bounded                                            |

Migrations:

- `DATA_VERSION = 3`; `MIGRATIONS[0]` adds containers/version, `MIGRATIONS[1]` folds station upgrade IDs into ship-wide records, and `MIGRATIONS[2]` repairs a missing base sensor range from a verified frame or size source (`scripts/engine/migration.mjs`).
- Active GM runs world migration once; `readStarship` also migrates in memory.
- `worldFixVersion = 6` repairs icons, inline links and `starship` tags.
- New module Actors receive the current system schema stamp; old module Actors without one are stamped, never downgraded.
- No general Contact/Combat flag rewrite exists.
- Documentation drift: `docs/starship-schema.md:3` still says dataVersion 1; `docs/combat-schema.md:5,25` still shows version 1 and removed action `budget`.

## 10. Compendiums and content

`module.json` declares 22 packs: 11 SF2e and 11 PF2e counterparts. Generated `packs-src` currently contains 1,084 JSON records including folders/language variants.

| Pack pair               | Per-system generated records |
| ----------------------- | ---------------------------- |
| `guide`                 | 2 JournalEntries             |
| `starship-combat-rules` | 2 JournalEntries             |
| `starships`             | 148 Actors + 26 folders      |
| `starship-hazards`      | 64 Actors + 6 folders        |
| `starship-actions`      | 78 Items + 18 folders        |
| `starship-weapons`      | 34 Items + 10 folders        |
| `battle-stations`       | 2 JournalEntries             |
| `starship-frames`       | 2 JournalEntries             |
| `starship-equipment`    | 2 JournalEntries             |
| `starship-exploration`  | 14 Items + 2 folders         |
| `starship-upgrades`     | 116 Items + 16 folders       |

Canonical catalog validation: 74 starships, 32 hazards, 39 actions, 17 weapons, 34 upgrades, 3 frames. English and Russian copies share rules flags; RU document IDs are derived separately. PF2e packs use `-pf2e` names and remapped UUIDs; no world conversion is provided.

## 11. Optional integrations

| Integration            | Current project use                                                                                                              | Verification boundary                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| PF2e Toolbelt          | Ship damage controls, native positive-damage interception, Target Helper `getStatistic`, Better Chat refusal, narrow damage undo | T-004 verified 3.62.0 API, Target Helper defaults, damage bypass and Better Chat risks; live recheck remains a release gate |
| Workbench              | No direct bridge; documented non-goal                                                                                            | Installed 7.7.5; do not add station automation implicitly                                                                   |
| HoloDock               | Button tries `openDashboard/open/openProfile/openShip`; read-only coexistence                                                    | T-004 verified only `open()` in 1.0.1; unsupported methods must be removed from claims/feature detection                    |
| Aztec's Engines of War | Refuse conversion when `flags.pf2e-aztecs-siege.isSiegeWeapon`                                                                   | Installed 1.0.3; source/mock only here                                                                                      |
| Causodes Ship Combat   | Warn GM; never convert Causodes actor types                                                                                      | Installed SF2e 1.5.2/core; coexistence only                                                                                 |
| SF2e Anachronism       | Required for PF2e; Computers/Piloting skill gate; active-system namespace                                                        | Installed 2.5.1; live PF2e+Anachronism not run in this audit                                                                |
| Native Foundry API     | Sheets, hooks, sockets, documents, chat, rolls, packs, permissions                                                               | Core contracts used by the rebuild are verified in §12; window/effect/reroll details remain implementation-time gates       |

## 12. Native contracts verified by T-004

T-004 checked Foundry `14.370`, SF2e `1.7.1`, PF2e `8.7.1`, Toolbelt `3.62.0` and the installed optional modules. Evidence below is source-backed for those exact versions; it is not a claim about untested future versions.

| Provider                                               | Contract                                                                                                         | Exposure / version                                                                                                                           | Evidence                                                                                                                                                     | Rebuild decision                                                                                                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry v14                                            | `Document.create/createDocuments`, `update/updateDocuments`, `delete/deleteDocuments`; embedded equivalents      | Public async API; single operations return `Document \| undefined`, batches return `Document[]`                                              | `App/resources/app/common/abstract/document.mjs:608-736,748-769,865-907`; `client/hooks.mjs:610-705`                                                         | Use document APIs and `testUserPermission`/`canUserModify`; never mutate prepared data as persistent source.                                                                                |
| Foundry v14                                            | `Combat.startCombat/nextTurn/nextRound/endCombat/rollInitiative`; `combatStart/Turn/Round` vs `combatTurnChange` | Public lifecycle; pre-update hooks are initiator-only, post-update hooks reach all clients                                                   | `App/resources/app/client/documents/combat.mjs:211-335,388-440`; `client/hooks.mjs:1240-1297`                                                                | Preserve initiator-only assumptions; synchronize crew after post-update `combatTurnChange`.                                                                                                 |
| Foundry v14                                            | `Token#setTarget(targeted,{releaseOthers})`, `game.user.targets`, `Token#targeted`                               | Public targeting API; targets are ephemeral, not `TokenDocument` data                                                                        | `App/resources/app/client/canvas/placeables/token.mjs:3882-3919`; `tokens/targets.mjs:20-66`; `client/documents/user.mjs:251-276`                            | Use native target state. `setTarget` does not enforce game visibility, so the module must validate targets before calling it.                                                               |
| Foundry v14                                            | Core `T` toggles hovered token; `Shift` adds without releasing others                                            | Editable core keybinding `KeyT`; `Shift` is reserved for additive selection                                                                  | `App/resources/app/client-keybindings.mjs:155-167,411-418,808-819`                                                                                           | Do not replace core `T`. Register any module-specific binding in `init`; prefer native behavior.                                                                                            |
| SF2e 1.7.1                                             | Encounter Tracker `data-action="toggleTarget"` and `refreshTargetDisplay`                                        | System UI implementation; tokenless/invisible combatants do not get fake tokens                                                              | `Data/systems/sf2e/sf2e.mjs:58223-58394`                                                                                                                     | Reuse this control and native target set; add module permission/detection validation only where needed.                                                                                     |
| Foundry v14                                            | `ChatMessage.create`, `Roll#evaluate`, `Roll#toMessage`, `renderChatMessageHTML`                                 | Public async APIs; evaluated rolls are immutable                                                                                             | `common/documents/chat-message.mjs:41-88`; `client/dice/roll.mjs:253-290,887-953`; `client/documents/chat-message.mjs:402-459`; `client/hooks.mjs:1422-1432` | Use standard chat messages and system rendering; chat-only descriptions must not evaluate rolls or write documents.                                                                         |
| SF2e 1.7.1                                             | `Statistic.check.roll(options)`                                                                                  | System API; resolves `CheckRoll \| null`; cancellation/invalid context can return `null`                                                     | `Data/systems/sf2e/sf2e.mjs:14884-15176,19311-19523`                                                                                                         | Pass starship targets explicitly; native auto-target does not select vehicles.                                                                                                              |
| SF2e/PF2e                                              | `game.pf2e` compatibility namespace vs system flag namespace                                                     | SF2e exposes `game.pf2e`/`CONFIG.PF2E`, but flags are `sf2e`; PF2e flags are `pf2e`                                                          | `Data/systems/sf2e/sf2e.mjs:118156-118213`                                                                                                                   | Never write `flags.system` as an alias; branch only where structures differ.                                                                                                                |
| SF2e 1.7.1                                             | Native `VehiclePF2e` and `SenseRuleElement`                                                                      | Vehicle prepares Fortitude only; Sense RE excludes vehicles; no native starship type, SP, `sensorRange` or Fortify                           | `Data/systems/sf2e/sf2e.mjs:40754-40810,43776-43824`                                                                                                         | Keep native vehicle/NPC/hazard actor types; module owns only starship-specific data and adapters.                                                                                           |
| Module + SF2e rules                                    | Sensor range source and missing-NPC baseline                                                                     | Persistent module field `starship.sensorRange`; official NPC size table is a fallback, not a hidden global default                           | `scripts/starship/stats.mjs:13-28,71-86`; `data/starships/*.json`; AoN Tech Core pg.206 `/rules/1411-speed-and-sensors`                                      | Explicit statblock value wins. Missing valid size may use Tiny 3, Small/Medium 4, Large 5, Huge 6, Gargantuan 7 with migration audit recording the source; otherwise leave `null` and warn. |
| Module + SF2e rules                                    | Sensor visibility semantics                                                                                      | Sensor Map is visible to GM and all players; Seek scans within range; Gunnery may target outside sensor range                                | AoN Tech Core pg.168 `/rules/1339-sensor-map`; pg.182 `/actions/604-seek-starships`; pg.207 `/rules/1416-gunnery`                                            | Range is not blanket invisibility. Boundary/blur are optional player UX; detection state controls information secrecy; GM is unrestricted.                                                  |
| Module                                                 | Fortify source                                                                                                   | Module NPC field `starship.fortify`; not Fortitude save and not native derived data                                                          | `docs/starship-schema.md:23`; `scripts/actions/dice.mjs:4-18`; `scripts/actions/requirements.mjs:30-35`; `data/actions/station-actions.json:1596-1621`       | Display `readStarship(actor).fortify ?? 0`; do not invent an alternative calculation.                                                                                                       |
| SF2e 1.7.1                                             | `ActorPF2e.applyDamage` and native chat damage buttons                                                           | Native HP/IWR/hardness path; shield item handling is for character/NPC, not vehicle SP                                                       | `Data/systems/sf2e/sf2e.mjs:33900-34089,55680-55720`                                                                                                         | Native damage buttons are unsafe for starship SP. Keep one capture/versioned adapter and one receipt/idempotency path.                                                                      |
| Toolbelt 3.62.0                                        | `game.toolbelt.api.{targetHelper,actionable,betterChat}`                                                         | Public API after init; module active alone does not prove a feature is enabled                                                               | `scripts/main.js.map` → `../src/main.ts:61-65,92`; `foundry-helpers/dist/module.js:24-76,138-154`                                                            | Feature-detect module active + exact function + relevant setting.                                                                                                                           |
| Toolbelt 3.62.0                                        | Target Helper `getMessageTargets`, `setMessageFlagTargets`, pre-create target capture                            | Public helper; dedupes valid Token UUIDs; supports creature/hazard/vehicle targets                                                           | source map `../src/tools/target-helper/tool/tool.ts:82-169,172-217,347-385`; `data/targets-data.ts:29-37`                                                    | Use for compatible card target display/capture; do not create a second target store.                                                                                                        |
| Toolbelt 3.62.0                                        | Target Helper saves and damage buttons                                                                           | Saves call `Statistic.check.roll`; damage calls internal `applyDamageFromMessage` and bypasses module SP                                     | `_saves.ts:56-163`; `damage.ts:308-435`                                                                                                                      | Custom starship Reflex/Will need module handling; intercept damage before native application.                                                                                               |
| Toolbelt 3.62.0                                        | Actionable and Better Chat                                                                                       | Actionable RE is character/physical-item only; Better Chat merge/inject can invalidate receipts                                              | `actionable/tool.ts:197-292,295-330`; `rule-elements/actionable.ts:17-73`; `better-chat/tool.ts:65-105`                                                      | Do not use Actionable as a starship engine; refuse Better Chat transformations for starship damage receipts.                                                                                |
| Workbench 7.7.5                                        | `game.PF2eWorkbench`; target-clearing/remembering settings                                                       | Exposed on ready; settings can clear or restore native targets                                                                               | `xdy-pf2e-workbench.js:189-215,7524-7611,6712-6748,10895-10950`                                                                                              | Detect settings and avoid fighting target persistence; do not add a hard dependency.                                                                                                        |
| HoloDock 1.0.1                                         | `game.holodock` / module API `open()`                                                                            | Exposed on ready; `openDashboard/openProfile/openShip` are absent in 1.0.1                                                                   | `holodock/dist/main.js:2207-2237,2281-2285`                                                                                                                  | Only feature-detect `open()` for read-only dashboard access; remove unsupported API claims.                                                                                                 |
| Aztec 1.0.3 / Causodes 2.5.3+1.5.2 / Anachronism 2.5.1 | Siege flag, conflict API, UUID redirects                                                                         | Aztec `flags.pf2e-aztecs-siege.isSiegeWeapon`; Causodes `globalThis.ShipCombat` + `shipCombatApiReady`; Anachronism has no combat/target API | Aztec `scripts/utils.mjs:49-55`, `ui/sheet-ui.mjs:335-355`; Causodes core `js:76-137`, SF2e `js:157-266`; Anachronism `anachronism.mjs:2-9`                  | Preserve conversion refusal/conflict warning; do not invent shared state or combat integration.                                                                                             |

Still version-sensitive and not certified by T-004: exact `ApplicationV2`/`DialogV2` lifecycle for every module window, `ActiveEffect` adapter design, `prepareStrike` replacement, `DamageRoll.alter` semantics, reroll hook signatures and the installed `getStatistic` prototype patch. These require focused implementation-time tests before changing shared behavior.

### 12.1 Historical T-003 research queue

The table below is retained as an audit trail of the questions T-003 raised. Where T-004 verified a contract above, the verified table and its rebuild decision take precedence.

| Provider    | Symbol/mechanism                                                                   | Initial project assumption                                      | Historical research question                                     |
| ----------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Foundry v14 | `ApplicationV2`, `ActorSheetV2`, `DocumentSheetConfig.registerSheet`               | Current sheets/windows                                          | Exact lifecycle, render hooks, options, cleanup                  |
| Foundry v14 | `foundry.applications.instances`                                                   | V2 window lookup/toggle                                         | Registry behavior across versions                                |
| Foundry v14 | `DialogV2.prompt/confirm/wait`                                                     | Options, hazards, modifiers                                     | Callback/close semantics; no hanging waits                       |
| Foundry v14 | `Hooks` and typed document hooks                                                   | Refresh, permissions, lifecycle                                 | Exact hook names/signatures/order                                |
| Foundry v14 | `game.socket.on` server sender argument                                            | Authenticated request dispatch                                  | Verify exact v14 socket signature and malformed payload behavior |
| Foundry v14 | `Combat`, `Combatant`, `turn`, `round`, `createEmbeddedDocuments`                  | Crew/NPC/compromised initiative                                 | Tokenless/linked/synthetic actors, insertion order, reload       |
| Foundry v14 | Token target state, `T`, multi-target, Keybindings                                 | **Not used by module today**                                    | Public target APIs and keybinding conflict policy                |
| Foundry v14 | `Combat Tracker` target controls                                                   | **Not implemented**                                             | Supported selectors/hooks and permission behavior                |
| Foundry v14 | `ChatMessage`, `Roll`, `DataModel`, `ActiveEffect`, `Compendium`, UUID/permissions | Mixed current usage                                             | Prefer native cards/effects/validation where contracts match     |
| SF2e/PF2e   | `Statistic.check.roll`, `actor.getStatistic`                                       | Ship/crew checks and Toolbelt saves                             | Public vs internal; clone/modifier behavior; exact versions      |
| SF2e/PF2e   | `CheckModifier`, `Check.roll`, `prepareStrike`                                     | Weapon-specific crew proficiency                                | `prepareStrike` is internal/high-risk; verify safe alternative   |
| SF2e/PF2e   | `DamageRoll`, evaluated `instances`, `alter`                                       | Typed damage and Toolbelt bridge                                | Exact formula/instance/critical semantics                        |
| SF2e/PF2e   | `DegreeOfSuccess`, `pf2e.reroll`                                                   | Checks and reroll receipt restore                               | Hook signature and message lifecycle                             |
| SF2e/PF2e   | Conditions, Rule Elements, `flags.<system>.overridePriority`, `_migration` schema  | Conditions, initiative ties, schema stamp                       | Exact target schema and native effect mapping                    |
| SF2e        | Sensor range source and ship/Fortify fields                                        | Module stores `sensorRange` and `fortify`; Fortify not rendered | Find authoritative fields/derivation; do not invent duplicates   |
| Toolbelt    | Target Helper rows and damage selectors                                            | `data-target-uuid`, roll index, apply/shield buttons            | Exact installed DOM and supported versions                       |
| Toolbelt    | Better Chat merge/inject/split flags                                               | Refuse transformed ship damage                                  | Verify transformations and ordinary-actor isolation              |
| Anachronism | Additional skills/conditions and PF2e namespace                                    | Computers/Piloting gate                                         | Exact 2.4/2.5 behavior in PF2e 8.6/8.7                           |

## 13. Architectural findings and high-risk boundaries

1. **Sensor confidentiality vs specification:** private identities are kept out of public Combat projections, but Foundry ownership does not prevent raw client document reads. Historical live testing confirmed this (`docs/testing.md:26-30`). The attached specification requires stronger non-disclosure; current architecture does not meet that requirement. This also conflicts with the older memory note accepting standard Foundry visibility, so the current specification takes precedence.
2. **Sensor range is not blanket invisibility:** `computeShipStats` derives `sensorRange` from stored ship data plus scanner grade (`scripts/starship/stats.mjs:13-28,71-86`). Official rules make the Sensor Map visible to GM and all players, limit Seek to sensor range, and explicitly allow Gunnery outside sensor range. Therefore range-based player masking is a module/UX choice, not an SF2e visibility rule. Keep detection-based secrecy, make any boundary/blur player-only, keep GM unrestricted, and migrate missing NPC range only from the official size baseline.
3. **Native targeting already exists:** Foundry core `T` toggles a hovered Token and `Shift` adds targets without releasing others; SF2e Encounter Tracker already renders `toggleTarget` and target indicators (`token.mjs:3882-3919`; `sf2e.mjs:58223-58394`). The module currently bypasses this with `Targeting.current` and singular `targetKey` (`scripts/ui/targeting.mjs`, `action-engine.mjs:84-104,535-587`). Rebuild on `game.user.targets`/`Token#setTarget`, with module validation for visibility and detection.
4. **Chat is not unified:** native attack messages, legacy module attack cards, action/damage/hazard/integrity cards and direct `ChatMessage.create` calls coexist. Native attack duplication was historically reduced, but standardization is incomplete.
5. **Action descriptions are view-only:** `showActionDescription` opens a native Item sheet (`scripts/ui/action-controls.mjs:24-67`); no chat-only description handler exists.
6. **Fortify is stored but not displayed:** imported/editable at `ship-docs.mjs:179`, `ship-service.mjs:60`, `ship-editor.hbs:41`; Overview stat cells exclude it (`ship-rolls.mjs:83-89`). T-004 confirms the source of truth is the module field `starship.fortify`, not Fortitude save or a native derived value.
7. **Prototype patch:** `registerStarshipStatistics` replaces `vehicle`/`npc` `getStatistic` (`scripts/starship/statistics-bridge.mjs:12-32`). It is narrowly scoped but remains a global internal boundary with no teardown.
8. **Non-atomic multi-document writes:** Draft rebases/saves Combat before ship writes and uses conflict guards, but partial failure remains possible (`scripts/actions/draft.mjs:42-103`).
9. **Direct API mutators:** several public API methods call services directly rather than the socket authority layer. Foundry permissions may block writes, but module-specific authorization and pre-roll side effects need explicit tests.
10. **Stale contracts:** `showUnknownContacts` and `movementMode` have no runtime readers; `customContent.ships/hazards` are declared but ignored; `starshipMoved` is declared but not emitted; two schema docs are stale.
11. **Manual MAP/action economy is intentional:** current code does not count actions/reactions/MAP (`action-engine.mjs:434-455`); do not restore the removed budget as a “fix.”
12. **General Undo is intentionally removed:** history is read-only (`history.mjs:1`); only narrow Toolbelt per-application damage undo remains. Do not restore general Undo without a new requirement.
13. **Native damage bypasses starship shields:** SF2e `applyDamage` and Toolbelt damage buttons do not know vehicle SP. A single capture/versioned adapter must route starship damage through the module engine before native application, with receipts and no duplicate buttons (`sf2e.mjs:33900-34089,55680-55720`; Toolbelt `damage.ts:308-435`).

## 14. Relevant Git evidence

| Commit                                     | Evidence and transfer decision                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c704392`                                  | Correct operator weapon-specific native proficiency; preserve. User's uncommitted guard/tests extend this behavior.                                                                                                             |
| `0fc230c`, `edc8124`, `57eb2ca`, `b043c59` | Unidentified/hidden target handling, four detection states, private Seek serialization; preserve approved policy and regression tests.                                                                                          |
| `6ff53b6`                                  | Independent Sensor Map Actor instances; preserve for explicit copy mode.                                                                                                                                                        |
| `de09772`, `552958a`                       | Configurable world-Actor reuse default ON and private collision guard; preserve approved fallback.                                                                                                                              |
| `954e6ff`                                  | Scene controls moved to `init` after live 14.370 failure; preserve.                                                                                                                                                             |
| `c67c362`, `ce99cad`                       | Native SF2e check dialogs and follow-up fixes; preserve system-owned dialog.                                                                                                                                                    |
| `1155055`, `b36bc6f`, `d26d79a`            | Native reroll context and stable receipt correlation; preserve.                                                                                                                                                                 |
| `93f08cf`                                  | Reality-check fixes: level zero, typed/nonlethal damage, modifiers once, Seek natural dice, Draft/removal guards; preserve tests.                                                                                               |
| `22aad62`, `4319cc9`                       | Combat Draft rebase, cross-write ordering and callback deadlock fixes; preserve.                                                                                                                                                |
| `3eb7af8`, `caaad38`, `f116935`            | Simplified wizard, separate review, live crew assignment baseline; preserve.                                                                                                                                                    |
| `3aa4b7c`                                  | Soft Drone Block and per-ship queues; preserve confirmation/manual boundaries.                                                                                                                                                  |
| `f3e237d`                                  | General Undo removed after live guard drift; do not restore.                                                                                                                                                                    |
| `021482c`, `9f6eb29`, `213b019`            | Narrow guarded Toolbelt damage undo on post-application card; preserve, not general Undo.                                                                                                                                       |
| `fcb1d5a`                                  | Exclude transient LevelDB files from release ZIP; preserve.                                                                                                                                                                     |
| `9950b56`, `0c4352f`, `90328d0`            | Unmerged `feat/v1.4.0-starship-effects`: native effect adapter, persistent damage, effect manager. Useful research input only; +5,717 lines in the feature commit, so do not cherry-pick wholesale into a minimization rewrite. |

Git history begins at `218d170` (0.14.0-era import). Older removals such as the 0.6.0 manual MAP and 0.10.0 action-budget removal are documented in `CHANGELOG.md`/`docs/rules-decisions.md`, but their pre-removal implementations are not available in this repository history.

## 15. Executed baseline checks

| Command                                                                                   | Result                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                | 1,490 tests; 1,488 pass; 0 fail; 0 cancelled; 2 skipped (installed-system helper checks); 49.856 s                      |
| `TSC_SYSTEMS_PATH="C:/Program Files/FoundryVTT-WindowsPortable-14/Data/systems" npm test` | 1,490/1,490 pass; 0 fail/cancelled/skipped; 50.049 s; SF2e 1.7.1/PF2e 8.7.1 helper source checks executed               |
| `npm run test:ui`                                                                         | 63/63 Chromium fixture checks; mocked Foundry boundary                                                                  |
| `npm run lint`                                                                            | Pass, zero warnings                                                                                                     |
| `npm run validate`                                                                        | Pass; 0 errors/0 warnings in all validators; catalog counts 74/32/39/17/34/3                                            |
| `npm run format:check`                                                                    | Fail only on preserved user edit `tests/unit/crew-weapon-proficiency.test.mjs`; not modified                            |
| `npm run check` / `npm run build:packs` / release build                                   | Not run in this audit because `check` regenerates packs and the task permits only the two documentation files to change |

No runtime source, tests, manifests, packs, settings, world data or user changes were modified by T-003.

## 16. T-004 verification evidence

- Exact inspected runtime: Foundry `14.370`, SF2e `1.7.1`, PF2e `8.7.1`, Toolbelt `3.62.0`, Workbench `7.7.5`, HoloDock `1.0.1`, Aztec Engines of War `1.0.3`, Causodes Core `2.5.3` / SF2e `1.5.2`, Anachronism `2.5.1`.
- Parent independently verified `Token#setTarget` at `App/resources/app/client/canvas/placeables/token.mjs:3882-3919` and SF2e Tracker target controls at `Data/systems/sf2e/sf2e.mjs:58223-58394`.
- Parent independently scanned `data/starships/*.json`: 74 candidates, 74 integer `sensorRange` values, 0 missing.
- Official rules fetched and checked: [Sensor Map](https://2e.aonsrd.com/rules/1339-sensor-map) (Tech Core pg.168), [Seek Starships](https://2e.aonsrd.com/actions/604-seek-starships) (pg.182), [Speed and Sensors](https://2e.aonsrd.com/rules/1411-speed-and-sensors) (pg.206), [Gunnery](https://2e.aonsrd.com/rules/1416-gunnery) (pg.207).
- Official conclusions: Sensor Map is visible to GM and all players; Seek scans within sensor range; Gunnery may target outside sensor range; missing NPC sensor values may use the size table Tiny 3, Small 4, Medium 4, Large 5, Huge 6, Gargantuan 7, with GM adjustment allowed.
- T-004 additionally reported passing Node assertions for native targets, vehicle Fortitude-only behavior, absence of native starship sensor/SP/Fortify fields, Toolbelt API exposure, sensor derivation and the 74/74 NPC range inventory. The parent did not rerun every assertion; the independent checks above are the verified subset.
- T-004 was read-only: no repository source/test/manifest/pack or live-world changes.
