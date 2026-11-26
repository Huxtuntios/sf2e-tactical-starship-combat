# PR #26 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every technically confirmed CodeRabbit finding and every live regression reported after PR #26, without changing unrelated behavior or world data.

**Architecture:** Keep the native-first design. Harden the chat render boundary, make Sensor Map projections explicit and permission-safe, serialize map-only writes against fresh records, stage hazard damage as commit-time deltas, and add optimistic conflict guards to full-map defense edits. UI changes remain scoped to existing ApplicationV2 templates and styles.

**Tech Stack:** JavaScript ES modules, Foundry VTT 14.370, SF2e 1.7.1, ApplicationV2, Handlebars, Node test runner, Playwright/Chromium fixtures, GitHub PR #26.

**Spec:** `docs/superpowers/specs/2026-11-25-v1.5.0-effects-integration-design.md`, PR #26 review snapshots in `dist/pr26-*.json`, and the live regression screenshots/messages from 2026-11-26.

## Global Constraints

- Work only on `rewrite/native-first-rebuild`; PR #26 remains the same PR.
- Preserve actor IDs, item IDs, flags, sockets, hooks, packs, optional integrations and user world data.
- Use TDD: write a focused failing regression, run it, implement the smallest fix, rerun focused and shared tests.
- Sensor-range restrictions remain player-only; the GM remains unrestricted.
- Private contacts, private snapshots and GM-only action results must never become public.
- Map-only placements remain independent records and must not create Actors Directory documents.
- Do not tag, publish a release, merge to `main`, or delete user data.
- Live Foundry changes are authorized only for reversible verification; record baselines and remove only owned fixtures.
- The compact-UI failure reported at `d80b2b0` is stale unless `npm run test:ui` reproduces it at the current head.

---

### Task T-053: Harden chat rendering and restore inline rolls/privacy

**Files:**

- Modify: `scripts/chat/card.mjs`
- Modify: `scripts/ui/inline-clicks.mjs`
- Modify: `scripts/actions/action-engine.mjs`
- Test: `tests/unit/chat-card-contract-012.test.mjs`
- Test: `tests/unit/chat-card-security.test.mjs` (new)
- Test: private-action coverage in `tests/unit/sensor-map-only-046.test.mjs`

**Interfaces:**

- Produces: `renderCard()` sanitizes `bodyHtml`; `registerCardRendering()` wires delegated inline controls; private action cards use `whisperGM`.
- Consumes: `foundry.utils.cleanHTML`, `checkLinksHTML`, `wireInlineClicks`, existing `cardData` flags.

- [ ] **Step 1: Add failing security tests**
  - Create a simple card whose `bodyHtml` contains `<img src=x onerror=...>`, `<script>`, and an `onclick` attribute.
  - Assert `renderStoredCard()` output contains none of the executable attributes/scripts while preserving `<p>` and safe `<strong>` markup when `cleanHTML` is available.
  - Assert the fallback escapes HTML when `cleanHTML` is unavailable.

- [ ] **Step 2: Add failing inline-roll tests**
  - Render an action card with manual text containing `@Damage[8d6[fire]]{8d6 fire}` and `@Check[reflex|dc:35|basic]{basic Reflex}`.
  - Assert the output contains `.tsc-damage` and `.tsc-check` controls rather than literal enricher source.
  - Assert `wireInlineClicks()` handles keyboard activation and posts validated chat content.

- [ ] **Step 3: Add failing privacy test**
  - Execute a manual action from a private map-only NPC and capture `ChatMessage.create`.
  - Assert `whisper` contains only GM users and the card is not public.

- [ ] **Step 4: Run focused tests and verify RED**
  - Run: `node --test tests/unit/chat-card-security.test.mjs tests/unit/chat-card-contract-012.test.mjs tests/unit/sensor-map-only-046.test.mjs`
  - Expected: new assertions fail on executable HTML, literal enrichers, or public private-action cards.

- [ ] **Step 5: Implement the render-boundary policy**
  - Add `cleanCardHtml(value)` in `scripts/chat/card.mjs`: use `foundry.utils.cleanHTML(value)` when present, otherwise `escapeHtml(value)`.
  - Apply it to every `bodyHtml` insertion in `renderCard()`.
  - Replace plain-text `rich()` with `checkLinksHTML(value, { nativeChecks: false })` so Damage/Check/Condition tokens become module controls.
  - Import `wireInlineClicks` and call it on the rendered chat root after replacing the card slot.

- [ ] **Step 6: Make private-action detection defense-in-depth**
  - In `executeActionNow`, set `ctx.privateAction` when the attacker is present in `privateContacts(combat.id)` by `actorUuid`, in addition to target/object checks.
  - Keep `postActionCard({ whisperGM: !!ctx.privateAction })`.

- [ ] **Step 7: Verify GREEN and shared chat behavior**
  - Rerun the focused tests, then `node --test tests/unit/chat-card-contract-012.test.mjs tests/unit/description-links.test.mjs tests/unit/native-targeting-ui-010.test.mjs` if present.

### Task T-054: Restore private Sensor Map controls, vitals, drops and sheets

**Files:**

- Modify: `scripts/ui/sensor-map-app.mjs`
- Modify: `scripts/sensor/contact-service.mjs`
- Modify: `scripts/ui/sensor-drop-ui.mjs`
- Modify: `scripts/sensor/map-object.mjs`
- Modify: `scripts/sensor/actor-drop.mjs`
- Modify: `scripts/engine/sensor-ops.mjs`
- Modify: `templates/sensor-map-detail.hbs`
- Modify: `templates/sensor-map-bar.hbs`
- Modify: `styles/main.css`
- Test: `tests/unit/reveal-ui-reliability.test.mjs`
- Test: `tests/unit/sensor-map-only-046.test.mjs`
- Test: `tests/unit/sensor-map-gm-actions-048.test.mjs`
- Test: `tests/unit/templates-092.test.mjs`

**Interfaces:**

- Produces: GM-private contacts replace anonymous projections; public player-owned map placements expose a sanitized `publicActor` projection; `MapObjectActor.sheet` opens a transient read-only sheet.
- Consumes: existing `privateContacts`, `getTsc`, `mutateTsc`, `MapObjectActor`, `resolveSensorActorSync`.

- [ ] **Step 1: Add failing projection-control test**
  - Create a map-only private contact with `actorUuid === key`, publish its hidden projection, and prepare the GM app context.
  - Assert `_privateObjects` contains the contact and the rendered object is the private contact, not `tscPrivateProjection`.
  - Assert visibility controls and GM vitals are available.

- [ ] **Step 2: Add failing public player-drop tests**
  - Place a player-role ship with `publicActor: true` and no connected player owner.
  - Assert explicit public placement succeeds.
  - Exercise the drag/drop handler and assert it passes `publicActor: true` after disclosure confirmation.

- [ ] **Step 3: Add failing player-resolution tests**
  - Place a visible player-owned ship as a map-only object.
  - Switch to a non-GM user and assert `resolveSensorActorSync()` returns a map-keyed actor with the source permissions and starship data.
  - Assert `observerKeys()` includes the placement and `MapActorCache` can read it.
  - Assert private snapshot collections remain unavailable to the player.

- [ ] **Step 4: Add failing sheet/layout tests**
  - Assert a map-only actor exposes a sheet whose document reflects snapshot HP/SP and is rendered read-only.
  - Assert a world actor still opens its normal sheet.
  - Compile the detail/bar templates and assert zone movement controls share one `.tsc-zone-controls` row and the action picker option contains `positionLabel` without a separate position pill.

- [ ] **Step 5: Run focused tests and verify RED**
  - Run: `node --test tests/unit/reveal-ui-reliability.test.mjs tests/unit/sensor-map-only-046.test.mjs tests/unit/sensor-map-gm-actions-048.test.mjs tests/unit/templates-092.test.mjs`

- [ ] **Step 6: Fix GM projection merging**
  - In `_prepareContext`, exclude `p.tscPrivateProjection` from both actor-backed and custom public-identity suppression.
  - Keep identified public objects suppressing their private counterparts.

- [ ] **Step 7: Fix explicit public placement**
  - Allow `forcePublic` player-role ships even when no player currently has permission.
  - Pass `publicActor: true` from the confirmed public drag/drop path.

- [ ] **Step 8: Add a safe public projection**
  - Add `publicMapActorData(data)` in `map-object.mjs`, limited to player/ally ships with non-GM visibility.
  - Remove `gmNotes`, private notes, history receipts and damage-application internals.
  - Store the sanitized projection on the public combat object as `publicActor`.
  - Resolve non-GM `map-*` keys from that projection; never expose `mapObjectSources()`.
  - Keep the projection synchronized after snapshot updates.

- [ ] **Step 9: Open sheets through resolved actors**
  - Add a cached transient `CONFIG.Actor.documentClass` sheet getter to `MapObjectActor`.
  - Render snapshot sheets with `{ editable: false }`.
  - Change `#openSheet` and `#privateOpen` to use `resolveSensorActor()` instead of `fromUuidSafe()`.

- [ ] **Step 10: Fix the scoped layout**
  - Wrap private zone select/arrows and normal zone/arrows in `.tsc-zone-controls`.
  - Add nowrap flex rules in `styles/main.css`.
  - Include `positionLabel` in each GM action-object `<option>` and remove the separate `.tsc-action-position` span.

- [ ] **Step 11: Verify GREEN**
  - Rerun focused tests and the `sensor-gm-actions`, `sensor-drop`, and `compact-ui` Chromium fixtures.

### Task T-055: Fix map-only concurrency, cleanup and current-turn identity

**Files:**

- Modify: `scripts/sensor/map-object.mjs`
- Modify: `scripts/starship/starship-state.mjs`
- Modify: `scripts/sensor/map-handlers.mjs`
- Modify: `scripts/ui/sensor-map-app.mjs`
- Test: `tests/unit/sensor-map-only-046.test.mjs`
- Test: `tests/unit/sensor-map-gm-actions-048.test.mjs`

**Interfaces:**

- Produces: `mapObjectSource(combatId, key)`, fresh map-only actor refresh inside write queues, pending map-cleanup markers, current-turn key matching.
- Consumes: existing serialized store writes and `deleteSensorActorInstance`.

- [ ] **Step 1: Add failing concurrent-handle test**
  - Load two handles for one placement at HP 24/SP 12.
  - Save HP 5 through the first and SP 2 through the second.
  - Assert final HP 5 and SP 2.

- [ ] **Step 2: Add failing queued-patch test**
  - Queue two `patchStarship` calls from separate stale wrappers, changing notes and speed.
  - Assert both changes survive.

- [ ] **Step 3: Add failing cleanup-retry test**
  - Inject a one-time failure in snapshot/combatant deletion after map removal.
  - Assert a second removal or any subsequent `sensorUpdate` completes cleanup without leaving an orphan snapshot.

- [ ] **Step 4: Add failing keyed-read/current-turn tests**
  - Put an uncloneable getter on an unrelated snapshot and assert keyed lookup still returns the requested record.
  - Give a map-only combatant `actorId: null` and `sensorMapObject.key`; assert the map object is current.

- [ ] **Step 5: Run focused tests and verify RED**
  - Run: `node --test tests/unit/sensor-map-only-046.test.mjs tests/unit/sensor-map-gm-actions-048.test.mjs`

- [ ] **Step 6: Refactor snapshot access**
  - Split validation from cloning: `validatedMapObjectSources()` returns raw validated records; `mapObjectSources()` clones all; `mapObjectSource()` clones only the requested key.
  - Move partial `applyUpdate()` into the same `sensor-source:${combatId}` serialized operation that reads the latest record.

- [ ] **Step 7: Refresh queued map actors**
  - Add `freshStarshipActor(actor)` in `starship-state.mjs`.
  - Call it before `patchStarship`, `deleteStarshipMapKey`, `replaceStarshipMap`, and `performWrite` read state.

- [ ] **Step 8: Make cleanup retryable**
  - Mark a map snapshot with `pendingCleanup` before removing its placement.
  - Expose pending keys and retry only when the placement/contact no longer references the key.
  - Retry pending cleanups at the start of `sensorUpdate` and immediately after successful placement removal.

- [ ] **Step 9: Fix current-turn matching**
  - Compare `combat.combatant.flags[MODULE_ID].sensorMapObject.key` with `o.key` in addition to the existing Actor-ID comparison.

- [ ] **Step 10: Verify GREEN**
  - Rerun focused tests and the full map-only suite.

### Task T-056: Fix targeting and action context regressions

**Files:**

- Modify: `scripts/ui/sensor-map-app.mjs`
- Modify: `scripts/ui/targeting.mjs`
- Modify: `scripts/ui/action-runner.mjs`
- Modify: `scripts/ui/action-controls.mjs`
- Test: `tests/unit/native-targeting-ui-010.test.mjs`
- Test: action-runner/action-control tests covering target stations and NPC descriptions

**Interfaces:**

- Produces: stable hover key across rerenders; `{ actor }` target wrapper; complete NPC description text.
- Consumes: existing `Targeting`, `promptOptions`, `npcActionDescription`.

- [ ] **Step 1: Add failing tests**
  - Rerender the Sensor Map while an object is hovered and assert `Targeting.hoverKey` remains the same key.
  - Select tokenless A, then token-backed B without Shift; assert only B remains.
  - Start a new targeting session while an older `onExecute` promise is pending; assert completion does not clear the new session.
  - Call `runAction` with a target Actor and assert `promptOptions` receives `{ actor }`.
  - Send an NPC ability with `text: "DC 25"` and `familyText: "Targets attempt a basic Reflex save."`; assert both reach chat.

- [ ] **Step 2: Run focused tests and verify RED**
  - Run: `node --test tests/unit/native-targeting-ui-010.test.mjs tests/unit/action-controls.test.mjs` (use the actual existing action-control test file if named differently).

- [ ] **Step 3: Implement minimal fixes**
  - Preserve `this._hover` in `_onRender` when the same key still exists.
  - Clear `mapOnlyTargets` after successful non-additive token selection.
  - Guard `Targeting.end()` with `this.current === session`.
  - Build `const target = targetObjs[0] ? { actor: targetObjs[0] } : null` once in `execute`.
  - Use `npcActionDescription(action, ct)` for NPC chat text and retain `action.text` for catalog actions.

- [ ] **Step 4: Verify GREEN**
  - Rerun focused tests and the `native-attack`/`action-controls` UI fixtures.

### Task T-057: Fix hazard damage and defense editor data integrity

**Files:**

- Modify: `scripts/damage/damage-service.mjs`
- Modify: `scripts/actions/draft.mjs`
- Modify: `scripts/starship/starship-state.mjs`
- Modify: `scripts/starship/ship-service.mjs`
- Modify: `scripts/ui/sheet/sheet-actions.mjs`
- Modify: `scripts/ui/sheet/sheet-listeners.mjs`
- Modify: `templates/ship-editor.hbs`
- Test: hazard damage tests in `tests/unit/native-targeting-010.test.mjs` and `tests/unit/plasma-attack-card-017.test.mjs`
- Test: `tests/unit/starship-defense-editor-026.test.mjs`

**Interfaces:**

- Produces: hazard `hpDelta` staging; `replaceStarshipMap(..., { expected })`; `Ship.replaceDefense(..., expected)`; keyed immunity removal.
- Consumes: existing damage computation, `tsc-commit` serialization, rendered defense baseline.

- [ ] **Step 1: Add failing hazard tests**
  - Hazard resistance 5 plus strike resistance 0 takes 5 damage from a 10-damage hit.
  - Hazard at 30 HP takes 10 then 7 in one draft and commits 13.
  - Two drafts read HP 20 before either commits; two 5-damage hits commit 10.

- [ ] **Step 2: Add failing defense tests**
  - Render resistance `cold`, delete it through another editor, then save a stale row edit; assert conflict and no resurrection.
  - Display immunities `[fire, cold, poison]`, remove `fire`, then click stale `cold`; assert `cold` is removed and `poison` remains.

- [ ] **Step 3: Run focused tests and verify RED**
  - Run: `node --test tests/unit/starship-defense-editor-026.test.mjs tests/unit/native-targeting-010.test.mjs tests/unit/plasma-attack-card-017.test.mjs`

- [ ] **Step 4: Fix hazard resistance and delta staging**
  - Use `Math.max(normalized all-damage, strikeResistance)`.
  - Store cumulative `hpDelta` in `draft.hazards`.
  - Make `Draft.target()` include staged deltas in repeated reads.
  - At commit, resolve the latest hazard and apply the delta to its current HP inside `tsc-commit`.

- [ ] **Step 5: Add optimistic map conflict guards**
  - Compare `current` with `expected` inside `replaceStarshipMap` before writing.
  - Pass `expected` through `Ship.replaceDefense`.
  - Capture the rendered map baseline on each defense editor root in `wireSheetInputs`.
  - Send that baseline from `saveDefenseRows`.

- [ ] **Step 6: Remove immunities by key**
  - Replace `data-defense-index` with `data-defense-key`.
  - Filter the latest immunity list by key.

- [ ] **Step 7: Verify GREEN**
  - Rerun focused tests and the `defense-editor` UI fixture.

### Task T-058: Fix combat, normalization and native-effect correctness

**Files:**

- Modify: `scripts/combat/starship-combat.mjs`
- Modify: `scripts/engine/validation.mjs`
- Modify: `scripts/actions/weapon-profile.mjs`
- Modify: `scripts/actions/result-text.mjs`
- Modify: `scripts/actions/action-engine.mjs`
- Modify: `scripts/ui/effect-manager.mjs`
- Modify: `scripts/starship/stats.mjs`
- Modify: `scripts/starship/native-condition-adapter.mjs`
- Test: existing station-reset, sensor-range, weapon-profile, result-text, effect and native-condition tests

**Interfaces:**

- Produces: persisted `stationResetEncounter`; nullish save DC/modifier handling; map-aware reaction attacker lookup; filtered condition/domain options.

- [ ] **Step 1: Add focused failing tests**
  - Reclaim a station, advance to round 2, return to round 1/turn 0, and assert it is not cleared again.
  - Normalize `{ role: "npc", sensorRange: null }` and assert missing size remains missing; explicit `size: "medium"` and `sensorRange: 0` remain valid.
  - Assert absent/empty save DC remains `null`, explicit zero remains zero.
  - Assert `formatActionDescription` forwards `translate` to outcome text.
  - Assert a map-only reaction attacker supplies the DC level.
  - Assert persistent damage is absent from native-condition options.
  - Assert `modifierOnly: 0` produces a `+0` fallback roll.
  - Assert broad `all` does not affect speed, sensor-range, station-damage or damage, while `all-speeds` still affects speed.

- [ ] **Step 2: Run focused tests and verify RED**
  - Run the exact existing test files for station reset, sensor range, weapon profile, result text and native effects.

- [ ] **Step 3: Implement the isolated corrections**
  - Set `state.stationResetEncounter = combat.id` on the first configured reset.
  - Preserve `d.size = null` when both size and range are absent/null.
  - Use `hasExplicitDC ? saveDC(Number(explicit.dc)) : null`.
  - Pass `{ localize, translate }` to `formatActionResultText`.
  - Replace reaction attacker lookup with `resolveSensorActorSync(ctx.combat, uuid)`.
  - Filter `persistent-damage` from `getConditionOptions`.
  - Use nullish fallback for `mod_`.
  - Add `all` only for non-excluded selectors; retain `all-speeds`.

- [ ] **Step 4: Verify GREEN**
  - Rerun all affected effect/combat/action suites.

### Task T-059: Preserve plasma retries and render manual results

**Files:**

- Modify: `scripts/chat/attack-card/service.mjs`
- Modify: `scripts/chat/attack-card/view.mjs`
- Test: `tests/unit/plasma-attack-card-017.test.mjs`

**Interfaces:**

- Produces: retry result merge by target UUID; manual plasma result rendering.
- Consumes: existing `damageResults`, receipts, `manualDamage` records.

- [ ] **Step 1: Add failing tests**
  - Card has saved result A; retry skips A by receipt and completes B; assert final `damageResults` contains A and B once each.
  - Card has `{ manual: true, rolled: 12, resistance: 5, protocolManual: true }`; assert rendered text includes the manual result and protocol instruction, not zero SP/HP loss.

- [ ] **Step 2: Run the plasma suite and verify RED**
  - Run: `node --test tests/unit/plasma-attack-card-017.test.mjs`

- [ ] **Step 3: Implement the fixes**
  - Initialize retry `results` from `card.damageResults ?? []` and merge by target UUID.
  - Branch on `d.manual` before automatic shield/hull rendering and show the existing manual-result/protocol strings.

- [ ] **Step 4: Verify GREEN**
  - Rerun the plasma suite and `plasma-attack` UI fixture.

### Task T-060: Restore Toolbelt ordinary-character and healing behavior

**Files:**

- Modify: `scripts/integrations/toolbelt-damage.mjs`
- Test: `tests/unit/toolbelt-damage-0143.test.mjs`
- Test: `tools/smoke-toolbelt-damage.mjs`

**Interfaces:**

- Produces: ordinary-character fallback before Better Chat rejection; visible negative-multiplier healing controls.
- Consumes: existing target classification and native button list.

- [ ] **Step 1: Add failing tests**
  - Merged Better Chat message with only an ordinary character target reaches the native handler.
  - Merged message with a starship target is still rejected.
  - Starship row negative-multiplier native button remains visible; positive damage and shield-block buttons remain hidden.

- [ ] **Step 2: Run focused tests and verify RED**
  - Run: `node --test tests/unit/toolbelt-damage-0143.test.mjs`

- [ ] **Step 3: Implement the minimal changes**
  - Move the Better Chat rejection after the no-ships return.
  - Skip hiding when `Number(button.dataset.multiplier) < 0`.

- [ ] **Step 4: Verify GREEN**
  - Rerun focused tests and the `toolbelt` UI fixture.

### Task T-061: Fix UI test filtering, reporting and accessibility coverage

**Files:**

- Create: `tools/ui-fixture-filter.mjs`
- Modify: `tools/test-ui.mjs`
- Modify: `tools/smoke-starship-defense-editor.mjs`
- Modify: `tests/unit/sensor-initiative.test.mjs`
- Modify: `tests/unit/sensor-drop-instances-020.test.mjs`
- Modify: `tests/unit/starship-defense-editor-026.test.mjs`
- Modify: `tests/unit/strike-trait-selector-050.test.mjs`
- Modify: `tests/unit/effect-ui-140.test.mjs`
- Test: `tests/unit/ui-fixture-filter.test.mjs` (new)

**Interfaces:**

- Produces: strict fixture selection, accurate failed-check reports, accessible-name checks, manager Add handoff coverage.
- Consumes: existing fixture list and test helpers.

- [ ] **Step 1: Add failing filter tests**
  - `"defense-editor, strike-traits"` selects both.
  - Unknown names and an all-whitespace list throw before browser startup.
  - Unset filter selects all fixtures.

- [ ] **Step 2: Strengthen the confirmed weak tests**
  - Persist transforms with `mutateTsc` and assert baseline values.
  - Count duplicate Combatants by direct Actor ID/key filters.
  - Stage defense mock deletions inside `update` and assert rejected updates leave state unchanged.
  - Start queued deletion test without `fire`; let the earlier queued write add it.
  - Assert Strike actor write count is unchanged while the trait dialog is open and after cancellation.
  - Stub `DialogV2.prompt` and `EffectTargetDialog.render`; assert manager Add opens the target dialog with the configured input.

- [ ] **Step 3: Run focused tests and verify RED**
  - Run: `node --test tests/unit/ui-fixture-filter.test.mjs tests/unit/sensor-initiative.test.mjs tests/unit/sensor-drop-instances-020.test.mjs tests/unit/starship-defense-editor-026.test.mjs tests/unit/strike-trait-selector-050.test.mjs tests/unit/effect-ui-140.test.mjs`

- [ ] **Step 4: Fix the UI runner**
  - Import and use `selectUiFixtures`.
  - Read `#result` before effect-target keyboard follow-up; skip follow-up on recorded failure.
  - Include failed non-measurement checks in `failedChecks` and preserve measurement width prefixes.

- [ ] **Step 5: Fix accessible-name coverage**
  - Compute names from `aria-label`, `aria-labelledby`, associated label text, or button text; never option text.
  - Add a negative unlabeled-select assertion.

- [ ] **Step 6: Verify GREEN**
  - Rerun focused tests, then `npm run test:ui`.

### Task T-062: Correct documentation and confirmed test/performance nits

**Files:**

- Modify: `docs/releases/1.5.0.md`
- Modify: `docs/migration-notes.md`
- Modify: `docs/rewrite-summary-ru.md`
- Modify: `docs/api.md`
- Modify: `docs/guide-en.md`
- Modify: `docs/rebuild-native-api-map.md`
- Modify: `docs/superpowers/plans/2026-11-25-v1.5.0-effects-integration.md`
- Modify: `tests/unit/effect-ui-140.test.mjs`
- Modify: `tests/unit/effect-calculations-140.test.mjs`
- Modify: `tests/unit/manual-effect-derivation.test.mjs`
- Modify: `tests/unit/manual-effect-union.test.mjs`
- Modify: `tests/unit/native-effect-adapter.test.mjs`
- Create: `tests/helpers/native-effect-fixture.mjs`

**Interfaces:**

- Produces: accurate public documentation and shared native-effect fixtures.
- Consumes: current `DATA_VERSION = 3`, map-only implementation and guarded Toolbelt routes.

- [x] **Step 1: Correct the documentation**
  - State that `DATA_VERSION` increases 2 → 3 and fills missing base sensor range when resolvable.
  - Mark version 2 as previous baseline and version 3 as current.
  - Limit Russian native-damage interception claims to guarded routes and direct other damage through the module dialog.
  - Describe `addSensorContact` world/compendium results as map-object records, not world Actor copies.
  - Change the documented expected damage types to `["cold", "fire"]`.

- [x] **Step 2: Extract repeated native-effect fixtures**
  - Move the repeated fixture and `nativeActor` helper into `tests/helpers/native-effect-fixture.mjs`.
  - Keep `installFoundryMock()` inside the fixture factory.
  - Update all five test files to import the shared helper.

- [x] **Step 3: Verify documentation and tests**
  - Run: `npx prettier --write` on changed Markdown/JS files, then the five native-effect suites.

### Task T-064: Restore player Sensor Map targeting before actions

**Files:**

- Modify: `scripts/ui/targeting.mjs`
- Modify: `scripts/ui/sensor-map-app.mjs`
- Modify: `scripts/ui/action-runner.mjs`
- Modify: `scripts/engine/target-rules.mjs`
- Modify: `scripts/sensor/actor-drop.mjs`
- Modify: `tests/unit/native-targeting-ui-010.test.mjs`
- Modify: `tests/unit/sensor-map-only-046.test.mjs`

**Interfaces:**

- Produces: player pre-targeting through English `T` and pointer selection without an action session.
- Consumes: visible Sensor Map objects, native Token targets and map-only target keys.

- [x] **Step 1: Reproduce and fix test-first**
  - Permit non-GM pre-targeting without a targeting session while preserving GM detail-only pointer behavior.
  - Resolve pre-targeted map-only contacts in `runAction` and map public placements back to their source Actor UUID.

- [x] **Step 2: Verify player and GM behavior**
  - Run focused targeting/map-only tests and the full Node suite.
  - Verify English `T`, pointer selection and the target marker as real `Player3`; verify private identities remain anonymous.
  - Remove only the owned live fixtures and confirm no target, Actor, Macro, placement, snapshot or Combatant remains.

### Task T-065: Resolve independent pre-commit review blockers

**Files:**

- Modify: `scripts/sensor/private-contacts.mjs`, `scripts/chat/chat-cards.mjs`, `scripts/ui/action-controls.mjs`
- Modify: `scripts/hazards/hazard-engine.mjs`, `scripts/combat/hull-integrity.mjs`, `scripts/starship/stats.mjs`, `scripts/damage/damage-service.mjs`
- Modify: `scripts/sensor/map-object.mjs`, `scripts/sensor/map-actor-cache.mjs`, `scripts/engine/sensor-ops.mjs`, `scripts/main.mjs`
- Modify: `scripts/starship/starship-state.mjs`
- Modify: `docs/releases/1.5.0.md`
- Create/Modify: focused privacy, projection, cache, concurrency and targeting regressions

**Interfaces:**

- Produces: consistent private-chat policy, permission-safe public projections, fresh player caches and conflict-safe map-only writes.
- Consumes: existing private-contact registry, public Combat projections and map-only snapshot store.

- [x] **Step 1: Close private chat/card/roll leaks**
  - Centralize the private-sensor actor predicate.
  - Whisper action descriptions, hazard/integrity/manual/damage cards and related rolls for private actors.

- [x] **Step 2: Sanitize public projections and existing stored data**
  - Allowlist public Actor fields, remove foreign flags/private notes and omit non-public embedded Items.
  - Re-sanitize on resolution and repair existing public Combat projections on active-GM ready.

- [x] **Step 3: Invalidate stale player caches and prevent mixed-write overwrites**
  - Version cache entries by `publicActor` content.
  - Reject map-only patch writes when a newer direct update changed the source snapshot.

- [x] **Step 4: Preserve the user's targeting rule**
  - Manually hidden identified targets remain valid.
  - Undetected targets remain rejected.

- [x] **Step 5: Re-run focused/full gates and live privacy checks**

### Task T-063: Full gates, live Foundry verification and PR update

**Files:**

- Modify as needed: release docs, `dist/module.zip`, `dist/module.json`, `dist/release-info.json`, `dist/SHA256SUMS.txt`
- No source changes unless a gate exposes a real defect.

**Interfaces:**

- Produces: verified package, live evidence and an updated PR head.
- Consumes: completed T-053 through T-062, T-064 and T-065.

- [x] **Step 1: Run full static/unit gates**
  - Run: `TSC_SYSTEMS_PATH="C:/Program Files/FoundryVTT-WindowsPortable-14/Data/systems" npm run check`
  - Run: `npm run test:ui`
  - Fix only reproduced failures; record any stale review finding with evidence.

- [x] **Step 2: Build and verify release**
  - Run: `npm run build:release`
  - Run: `node tools/verify-release.mjs dist v1.5.0`
  - Record archive size and SHA-256.

- [x] **Step 3: Deploy and verify live Foundry**
  - Record actor/item/combat/scene/message/macro/journal baselines.
  - Copy the verified module to the authorized Foundry modules directory and reload.
  - Verify English T targeting, target marker, zone controls, GM HP/SP editing, visibility changes, public/private drops, snapshot/world Open Sheet, inline Damage/Check controls and GM-only private NPC cards.
  - Verify player perspective does not receive private identities/snapshots and receives own range/control for public player-owned map placements.
  - Remove only owned fixtures and restore baselines.

- [x] **Step 4: Update docs and checksums**
  - Record final test counts, live results, package hashes and PR status in release artifacts.
  - Keep version `1.5.0`; do not create a tag or publish a release.

- [ ] **Step 5: Review and commit**
  - Run `git status`, `git diff --check`, and inspect all staged files for secrets or generated artifacts.
  - Commit the verified changes to `rewrite/native-first-rebuild`.

- [ ] **Step 6: Push to the same PR and verify remote head**
  - Push only after all gates and live checks pass.
  - Use `gh pr view 26 --json headRefOid,state,url` and confirm the remote head matches the local commit.
  - Do not merge, tag or publish.
