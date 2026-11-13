# Changelog

## Unreleased — post-1.0.0 fixes

- Scene-control buttons (Sensor Map, Station HUD, Start Combat, Toolbox) are registered during `init`: Foundry 14.370 calls `getSceneControlButtons` once, before `ready`, so the previous late registration left the buttons missing. Found and fix-verified in a live Foundry 14.370 / SF2e 1.7.0 world. This fix is **not** part of the published `v1.0.0` pre-release.
- Toolbelt damage row: the ship controls (multiplier select + Through shields / Direct to hull) wrap onto their own line instead of squeezing Toolbelt's native apply-damage buttons inside its nowrap flex row. The multiplier select is kept for starship targets. Found via live Toolbelt 3.61.3 inspection; guarded by a Playwright layout fixture. Not part of the published `v1.0.0` pre-release.
- Removed the history Undo restore action. Live verification showed it could not reliably reverse changes (the combat guard drifted between recording and undo), and the GM can adjust ship state directly. The GM-only history journal remains as a read-only audit log; damage and critical states stay non-reversible. Not part of the published `v1.0.0` pre-release.
- Toolbelt ship damage: a GM-only "Undo damage" button on the damage chat message returns exactly the shields/hull that one application removed. It is refused when the application caused a critical state, when the ship or combat changed since, or on repeat; per-application receipts prevent double undo. This is a narrow guarded reversal, distinct from the removed general history Undo. Not part of the published `v1.0.0` pre-release.
- Weapon Strikes open only the system roll dialog by default. The module's six-row situational-modifier form is now behind the world setting "Extra situational-modifier dialog" (off by default); the system dialog already provides modifier rows, so the extra window no longer stacks on top of it. Player-proposed modifiers still require GM approval when the form is enabled. Not part of the published `v1.0.0` pre-release.
- Drone Block from the sheet/HUD is now soft-automated: the deploying player (or GM) confirms on their own client, then the drone returns aboard, its 10-minute cooldown starts and a manual receipt is recorded; resistance is reported for the GM to apply against the triggering Strike. Nothing is spent and no damage is applied by this path; the Strike-reaction path is unchanged. Not part of the published `v1.0.0` pre-release.
- Action execution is serialized per ship instead of one global queue, so an open roll dialog on one ship no longer stalls unrelated ships' actions; cross-ship writes remain guarded by the per-actor write queue and per-combat sensor serialization. Removing a drone console now also removes its bound drones and mine-frequency entries, and is refused while any of its drones still has an armed mine on the map (station-bound upgrades stay unassigned by design). Found via live round-3 drone/mine verification. Not part of the published `v1.0.0` pre-release.
- Draft commits coordinate the shared combat write instead of failing on any concurrent change: the combat delta is rebased onto the current state (disjoint edits merge, overlapping edits of the same entity still refuse), and the combat write is saved before any ship write so a conflict aborts without partial ship writes. Dialogs/rolls stay independent per ship. Review follow-up to the per-ship queue change. Not part of the published `v1.0.0` pre-release.
- Removing a drone console is refused while any bound drone mine still has a live map contact or a stale Hazard Actor (i.e. its cleanup failed), so the mine record is retained and "Sync contact" can still repair the projection; resolved mines whose projection is gone are removed with the console. Review follow-up to the station-cleanup change. Not part of the published `v1.0.0` pre-release.
- Draft success hooks and after-commit callbacks run after the commit write-lock is released, so a callback that itself commits (e.g. a hazard trigger) no longer deadlocks the queue. The combat rebase also refuses to restore a map object or knowledge entry deleted concurrently while the draft edits it; deletions of untouched entries are preserved. Review follow-up to the Draft coordination change. Not part of the published `v1.0.0` pre-release.
- The four scene-control buttons (Sensor Map, Station HUD, Start Combat wizard, Toolbox) now toggle: pressing a button again while its window is open closes it instead of stacking another. The Toolbox dialog is located in Foundry's ApplicationV2 instance registry, so repeated presses close it reliably. Not part of the published `v1.0.0` pre-release.
- Auto-mirroring now works for ship art out of the box: a new starship map object takes its base direction from the ship's sheet heading instead of "unknown", so reversing course mirrors the art when the setting is on. The object orientation menu offers left/right base direction (rotation and horizontal/vertical flips are kept) and preserves any previously saved direction until the GM explicitly changes it, so saving an unrelated image or arrow edit no longer flips the art. An edited orientation is remembered on the Actor itself so later placements and copies inherit it. Not part of the published `v1.0.0` pre-release.

## 1.0.0 — 2026-11-12

First stable release. It consolidates the published `v0.16.0` stable release, the `0.17.0` build, the `0.17.1-dev.1–13` experimental series (published as pre-release `v0.17.1-dev.13`), the reliability follow-up (PR #12/#13), the combat-wizard improvements (PR #14) and the post-wizard reality-check audit (PR #15). Per-build details are preserved in the sections below. Compatibility declarations, the module ID, pack names and document IDs are unchanged; no world migration is required.

### Added

- Combat wizard: improved roster selection and safe bulk encounter setup. Drafts stay write-free until confirmation; NPC ships and hazards become independent instances; existing world Actors are preserved with checked compensating cleanup; review totals sit beside their labels.
- Sensor Map: one GM window to add world hazards, compendium hazards or custom contacts with an initial detection state. Private contacts are staged in a GM-only journal; observed publishes an anonymous marker; full reveal is confirmed, staged and recoverable, with an explicit GM pending-identification recovery control.
- Sensor Map: every Actor placement creates a persistent independent world Actor copied from its template; repeated placements no longer move one UUID; removing a contact cleans up its copy and initiative entry.
- Sensor Map: initiative controls with private/anonymous entries, legacy private-initiative support and restoration on reveal failure.
- Sensor Map appearance: four combat-scoped course-arrow formats (none, text, emoji, custom image) with size, spacing, placement and opacity; per-object auto-mirror overrides; per-object angle, flips and base direction; background rotation/flips that do not affect zones or coordinates.
- Character-sheet station claim/release during active starship combat through the existing Crew service.
- Drone Console: individual tracked drones with capacity checks, Deploy/Retrieve, base Drone Block on supported Strikes, GM-confirmed Drone Block from native Strike damage cards with operator-level resistance and the 10-minute return, and a manual-only Drone Shield Protocol path with a strike receipt.
- Mines: Install Mine stock inside the undeployed Pyrotechnics Drone with GM-confirmed modifications; Deploy Starship Mine creates a dedicated Hazard Actor and a linked public map contact; GM resolution, movement and modification helpers remain manual-confirm tools.
- Native SF2e check dialogs for ship rolls and the native SF2e attack card on supported ship-weapon paths.
- GM-only bounded history journal with configurable chat announcements; station-scoped Boost Battle Station and GM-approved per-roll situational modifiers.
- Frame-provided upgrade recognition, weapon-selector damage/proficiency display and interactive rule links with conservative damage-type inheritance.
- API: `addSensorContact`, `syncMineContact`, `privacyProbe`.

### Changed

- Detection UX: selecting a contact state applies it immediately, without an extra checkbox or confirmation dialog.
- Station actions are scoped to the current encounter; explicitly reused retained ships keep their actions through current map participation instead of the instance's original combat ID.
- Toolbelt manual ×2/×3 scales damage but no longer establishes a critical hit; critical evidence uses the original stored roll degree or an unambiguous native attack-damage outcome.
- Socket waits are bounded: a 15-second initial wait, then one 120-second result deadline after the first eligible acknowledgement; disconnected or changed-GM requests are rejected and late replies ignored.
- Undo persists a private intent and one bounded Actor receipt for guarded recovery after history-finalization failure; snapshots compare structurally. HP/SP, damage and critical states remain non-undoable.
- Reveal uses journal-only staged intent with guarded finish-forward recovery instead of whole-Combat rollback.

### Fixed

- Stale Draft snapshots and queued writes are guarded; station release reauthorizes against the current occupant; independent copies no longer inherit the source's Undo receipt.
- `setZone` routes through Sensor Map authority/reveal guards; map shrink cannot strand private contacts; public/private removal keeps its references until owned-document cleanup succeeds, including silent deletion vetoes and explicit retries.
- Evaluated NPC damage components are preserved, nonlethal damage propagates, typed attack modifiers apply once, and Seek honors natural-20/1 adjustments.
- Level zero is preserved for NPC/hazard creation; the player minimum and cancellation behavior are retained.
- The Sensor Map background DOM survives part replacement; giant rasters use a PNG display copy capped at 4096 pixels without changing the source; window-owned actor caches invalidate on document/permission/catalog changes.
- Unnamed Sensor Map environment objects, actor picker sizing/overlap, damage reaction deadlines and unrelated background reloads.
- The release ZIP no longer includes transient or stale LevelDB files.

### Improved

- Packaging builds only manifest-declared compiled packs and rejects incomplete LevelDB structures; the release workflow re-downloads and verifies uploaded assets.
- Unambiguous catalogue defenses are imported into mechanical flags with source notes retained; old worlds are not rewritten automatically.
- Documentation is consolidated without deleting release history or attribution; EN/RU guides are corrected; pinned-source, offline-test and policy/provenance evidence is recorded in `docs/reality-check.md` and `docs/release-readiness.md`.

### Compatibility

- Declarations are unchanged: Foundry v14 (minimum `14.361`, verified `14`, maximum `14`); SF2e `1.6.0+` (verified `1.6.1`); PF2e `8.6.0+` (verified `8.6.1`) with active SF2e Anachronism `2.4.0+`. No dependency or system version was raised for this release.
- No action/reaction accounting is added; the GM and players track the 3 actions + reaction themselves.
- Live Foundry multiplayer, real Toolbelt integration and the human-content/policy gates in `docs/release-readiness.md` remain unexecuted. This release records automated, fixture and source-review evidence, not live certification. Tagging, publication and catalog submission are separate maintainer decisions after those gates.

## Post-wizard Reality Check — shipped in 1.0.0 (2026-11-12)

- Preserve level zero in NPC/hazard creation; retain player minimum and cancellation behavior.
- Guard changed Draft snapshots in Actor/Combat queues, skip unchanged snapshots, and reauthorize queued station release against its current occupant. Independent copies no longer inherit the source's Undo receipt.
- Route `setZone` through Sensor Map authority/reveal/mine guards; refuse map shrink that strands private contacts. Retain public/private removal references until owned-document cleanup succeeds, including silent deletion vetoes and explicit retries.
- Preserve evaluated NPC damage components, propagate nonlethal damage, apply typed attack modifiers once, honor manual-only Drone Shield Protocol, and include natural-20/1 adjustments in Seek. Import unambiguous catalogue defenses while retaining source notes; old worlds are not rewritten automatically.
- Package only declared compiled packs and reject incomplete LevelDB structures. Consolidate duplicate documentation and obsolete WIP reports without deleting release history, attribution or unique safety notes.
- Record pinned-source, offline-test and policy/provenance evidence in `docs/reality-check.md` and `docs/release-readiness.md`. Kept `0.17.1-dev.13` and all compatibility declarations unchanged at audit time; real Foundry, multi-client, integration and human-content gates still block publication and catalog submission.

## Reliability follow-up to 0.17.1-dev.13 — shipped in 1.0.0

- Retain the Sensor Map background DOM through full/partial part replacement; use one source/revision loader and an aspect-preserving PNG display copy capped at 4096 pixels for giant images. Preserve ordinary image quality and original paths/files; release blobs/images/canvases on change/close. Cache only visible known Actor resolutions/data/statistics per window, with document/permission/catalog invalidation and stale-result rejection; skip unrequested parts. Chromium exercises an actual 8100×11700 PNG and 360 objects.
- Add an explicit GM pending-identification recovery control and public mutation/initiative guards while a reveal is pending. Recovery reports conflicts locally and releases busy controls on success/failure; render/hooks never initiate recovery writes.
- Bound socket waits after the first eligible accepted acknowledgement to one 120-second result deadline; keep the initial 15-second wait. Bound local GM handlers, reject disconnected/changed-GM requests, remove pending timers/listeners and ignore late/duplicate replies. Preserve authenticated sender checks. Timeout does not cancel the handler or guarantee exactly-once processing.
- Toolbelt manual ×2/×3 no longer implies a critical hit. Use the original selected roll degree or unambiguous native single-roll attack damage outcome; contradictory/malformed evidence stays noncritical. Do not treat save/check critical success as a critical hit. Preserve manual scaling, typed defenses, shields, receipts and existing target-bound critical-save-failure consequences.
- Persist private Undo intent and one narrow Actor receipt with restoration, so a retry can finish a failed history update without restoring again. Compare snapshots structurally without object-key-order sensitivity, retaining Actor/Combat guards, GM-only history and the 80-record bound. Do not enable HP/SP, damage or critical-state Undo.
- Replace whole-Combat reveal rollback with journal-only staged intent and guarded finish-forward recovery. Preserve original Actor/Combatant identity and initiative, inspect actual documents after partial failure, refuse conflicts/duplicates and retain pending evidence. Completed reveal receipts are bounded to 64; no distributed transaction or confidentiality guarantee is claimed.
- Add failure-injection and regression coverage. Manifest version, compatibility declarations, dependencies and action/reaction accounting are unchanged. Live Foundry, Toolbelt and multiplayer verification remain outstanding; follow the ordered checklist in `docs/testing.md`.

## 0.17.1-dev.13 — experimental, unpublished

- Simplify Sensor Map contact detection: selecting a state applies it immediately, without an extra checkbox or confirmation dialog. Keep the existing private journal, anonymous map projection, Actor ownership, and combat data formats.
- Fix CI UI regression: update the mine-modification smoke fixture to select the actual `installMineStock` action without weakening GM/player assertions.
- Every Sensor Map Actor placement now creates a persistent independent world Actor copied from its template; repeated placements no longer move the same UUID. Copies retain template provenance, private contacts receive no player permissions or Combatant until revealed, NPC ships and complex hazards receive their own Combatant when public, and removing a contact cleans up its copy and initiative entry. Compendium imports and combat-start copies share the same Actor-copy helper.
- Sensor Map copy regression coverage verifies two placements of one NPC remain independent after HP changes, with source state unchanged; privacy, reveal, initiative and deletion are covered by Foundry mocks. No real Foundry or multiplayer validation.
- Add character-sheet station chooser during active starship combat. Claim and release use the existing Crew service and revalidate station occupancy through its per-ship serialized updates.
- Add GM-confirmed Drone Block from native Strike damage cards, with drone and Strike selection, operator-level resistance through the existing damage pipeline, a manual-resolution path, and the 10-minute return/cooldown. Preserve Intercept and mine state; show a GM warning where Tech Core does not specify the effect of automatic retrieval.
- With Drone Shield Protocol installed, offer a GM-confirmed manual-only path and strike receipt. Do not apply base retrieval/cooldown or invent shield/use-count state; show the required manual follow-up on the attack card.
- Add English/Russian UI text, unit/UI coverage, a concurrent `Crew.claim`/`Crew.release` service integration test, the dev.13 manual checklist and source/limitation documentation. No action/reaction accounting; no real Foundry or multiplayer validation.

## 0.17.1-dev.12 — experimental, unpublished

- Sensor Map: one GM window to add objects — world hazard, compendium hazard (private world copy per placement, deleted if placement fails) or custom contact — with an initial detection state (undetected/hidden stay private; observed and identified need confirmation). Private contacts gain an absolute zone selector; public hazards with known identity open their existing Hazard sheet. The previous quick-add for environment objects stays as a separate button.
- Install Mine: prepared mines are now stored inside the undeployed Pyrotechnics Drone (`drone.mineStock`) with GM-confirmed modifications chosen from the operator's known Mine Exocortex modifications (`station.tscKnownMineMods`). Up to four mines per action, replay-safe, mechanic class checked when it can be determined (GM override). Personal modifications stay opaque notes: they are not Smart/Targeting and have no automatic effect. Old dev.10/11 plan notes are left untouched.
- Deploy Starship Mine: a stored mine can be deployed under its own id keeping its modifications; plain deployment is unchanged. Each deployed mine gets its own Hazard Actor (players OBSERVER, in a "Starship mines" folder) and a public Sensor Map contact linked by `mineRef`. Move, detonation and removal of the mine update or remove the contact and mark the Actor. The contact cannot be moved, retyped or removed directly, and generic hazard automation skips it. Projection failures never roll back the saved mine; `syncMineContact` is idempotent.
- `api.addSensorContact`, `api.syncMineContact`, `api.privacyProbe` added. The probe only reports what the current client sees and never claims security.
- Drone Block reviewed; no behavior changed. The follow-up work in [historical dev.13 evidence](docs/testing.md#historical-dev13-ci-diagnosis) records the source review and resolves/flags open questions. No action/reaction accounting. Not verified in real Foundry; Chromium fixtures not run for that build.

## 0.17.1-dev.11 — experimental, unpublished

- Stage new world hazards and NPC ships from drag/drop and the content browser; private custom contacts can be created, renamed, moved and removed. Observed publishes only an anonymous marker; Hidden and Unnoticed remain withheld. Full reveal needs confirmation. No real multiplayer privacy verification.
- Guard the public hazard API against accidental disclosure, preserve old zone GM notes but stop accepting new GM notes through the shared socket, and guard Install Mine plan edits against stale snapshots. Install Mine remains manual notes, not inventory or actual effects.
- Existing Toolbelt safeguards and Drone Block are unchanged. No action/reaction economy. See [historical dev.10–11 evidence and manual test plan](docs/testing.md#historical-dev-evidence-consolidated-2026-11-11).

## 0.17.1-dev.10 — experimental, unpublished

- Added experimental GM-only staging of new world NPC ship contacts outside shared Combat flags and module socket messages. Full identification can be explicitly published; intermediate detection, full integration and real multiplayer privacy remain unverified. Do not use for actual secrets until live verification.
- Added a GM-confirmed Install Mine preparation record for up to four individually labelled mines and personal mechanic mods. These are notes, not automatic onboard inventory or applied mine effects.
- No action/reaction economy. Existing Toolbelt safeguards and Drone Block remain unchanged. See [historical dev.10–11 evidence and manual test plan](docs/testing.md#historical-dev-evidence-consolidated-2026-11-11).

## 0.17.1-dev.9 — experimental, unpublished

- Compare Toolbelt 3.60.0 and 3.61.3 source and release manifests. For ship damage, explicitly refuse Better Chat merged, injected or split cards: Toolbelt can replace message IDs or change rolls, so old receipts cannot reliably establish whether damage was already applied. A previously recognized target row whose token UUID becomes unresolvable also fails closed instead of falling through to native damage. Ordinary actors retain their native path. This is a limited integration, not full Toolbelt compatibility.
- The active GM now records the end of an onboard-pet session when it observes world-time expiry, loss of helm, pet HP reaching zero, deletion, or loss of the upgrade. The end marker cannot reactivate after recovery; session replacement is guarded. Native quickened, voluntary exit, companion movement, cleanup and events missed while no active GM remain manual.
- New GM-side and browser-mock tests; no real Foundry or Toolbelt execution. Sensor Map secrets, Install Mine and other dev.8 gaps remain. No action/reaction spending. Back up and install the supplied ZIP manually; the manifest points to an unpublished future release. See [historical dev.9 evidence](docs/testing.md#historical-toolbelt-source-review).

## 0.17.1-dev.8 — experimental, unpublished

- Extend the existing mine guide: GM-confirmed per-target application via the ship damage engine, progress and bounded target receipts; confirm closure separately. The map may omit targets. A GM-only local movement hint proposes manual consideration of a reaction; it is not automatic detonation and does not cover every movement path.
- Harry Sensors can apply module-only ship effects, not native SF2e conditions; success requires a unique ship combatant for expiry. Intercept receives a limited pre-roll hint but remains a manually applied penalty. Shield Protocol and Fetch and Fix add per-drone, GM-confirmed manual records and combat-anchored cooldown; they do not integrate resistance with attacks. Pet cabin adds a GM-confirmed session and derived status; quickened and final cleanup are manual.
- New Sensor Map contacts are **not private**: existing Combat flags are replicated to players. The requested unnoticed-by-default feature is not implemented; do not place undiscovered secrets on the map. Install Mine and other listed gaps remain. No action/reaction spending is tracked.
- Optional module flags change on use, without migration. Receipts are bounded and cannot guarantee distributed exactly-once. No live Foundry or multiplayer validation; back up a test world and install the supplied ZIP manually. Manifest download is a future, unpublished URL. See [historical dev.8 evidence](docs/testing.md#historical-dev-evidence-consolidated-2026-11-11).

## 0.17.1-dev.7 — experimental, unpublished

- Extend the GM mine helper with optional native typed damage and per-target Reflex rolls, manual input when unavailable, basic-save raw damage and a single private progress card. The GM must verify all targets, apply defenses and damage, and separately close the mine. No automatic reaction, mine detonation, HP/SP write, recovery or exactly-once guarantee.
- Add a GM Harry Sensors helper: resolve the higher class/spell DC when available, select a mapped same-zone target, roll Will or enter a result manually, and show the outcome. Conditions and expiration remain manual.
- Add a GM-confirmed record of a manually applied Intercept Munitions penalty. It does not modify or recalculate an attack. Per-drone use resets on Retrieve; bounded receipts reduce repeat writes. Optional fields are added to the individual drone on use, without migration; Actor flags are not secret. No action/reaction spending is tracked.
- Experimental only, not verified in real Foundry or multiplayer. Install the supplied ZIP manually in a backed-up test world; the manifest URL is for an unpublished future release. See [historical dev.7 evidence](docs/testing.md#historical-dev-evidence-consolidated-2026-11-11).

## 0.17.1-dev.6 — experimental, unpublished

- GM-only mine resolution aid lists mapped ships in the mine zone, including the source ship, and allows zero or one explicitly selected Smart Mine exception. It rejects ambiguous or invalid map records and stale dialogs. This is a preview and private manual instruction, not automatic saves, damage, mine detonation or a complete list of unrecorded ships.
- Prevent concurrent openings for the same mine within one client while the dialog is pending. This is not deduplication between GMs, durable exactly-once or a guarantee against repeated intentional cards. No Actor/Combat data fields or migrations are added; Repair Hull, Drone Block and dev.5 mine modification storage remain unchanged.
- All other requested drone effects remain unimplemented or manual. No real Foundry/multiplayer verification was possible. Install the supplied ZIP manually in a backed-up test world; the manifest points to a future, unpublished release. See [historical dev.6 evidence](docs/testing.md#historical-dev-evidence-consolidated-2026-11-11).

## 0.17.1-dev.5 — experimental, test worlds only

- Add a GM-confirmed, limited Modify Starship Mine helper for an individual deployed mine: Smart and Targeting are recorded on that mine and checked against the operator’s next turn. The GM confirms the Modify class feature; no action or reaction spending is tracked. Detonation, exclusion, saves and damage remain manual. Targeting’s manual damage formula includes the Intelligence bonus, minimum 1.
- Require the operator’s current turn, a deployed pyrotechnics drone, same zone, a unique mine/station/drone and an unchanged combat order. Changed or unverifiable timing is refused for GM review. Existing unknown modifications are not overwritten. New optional per-mine modification and bounded 512-ID receipt fields are added only on use; no migration. Replays do not apply twice within these receipts, but this is not a distributed transaction.
- Drone Block continues to use half the operator’s level; the user confirmed the printed wording. Added a regression with different ship and operator levels. Protocol, Fetch and Fix, Harry Sensors, Intercept Munitions, Install Mine and Onboard Pet are not automated. Repair Hull is unchanged.
- GM/player template fixtures and mock tests do not prove Foundry behavior or multiplayer safety. This is unpublished; the manifest URL points to a future release and the ZIP must be installed manually. See [historical dev.5 evidence and manual test plan](docs/testing.md#historical-dev-evidence-consolidated-2026-11-11).

## 0.17.1-dev.4 — experimental, test worlds only

- Partial Repair Hull: an authorized operator at a helmed console with an unambiguously deployed repair drone can repair **that console’s own ship only**, on the active combat map. Native Crafting check, DC tiers with proficiency, all four outcomes and module damage handling; no action/reaction spending is tracked. Other ships require GM adjudication.
- A bounded durable operation-ID map is added to the ship Actor on a completed attempt, including an unsuccessful roll; a matching replay never repeats it. The process-local socket receipt also covers this action. This changes module-owned ship flags, not drone or mine records; no migration. At 512 receipts it fails closed. Neither receipt nor queue guarantees atomicity during GM failover or external writes.
- Other drone abilities and upgrades remain manual; no live Foundry test was available. The supplied Tech Core text says Drone Block is half the operator’s level; the user’s summary says ship level. Existing behavior is unchanged pending clarification. The manifest download URL is an unpublished-release placeholder; install the delivered ZIP manually.

## 0.17.1-dev.3 — experimental, test worlds only

- Reject ambiguous mine, drone and station IDs across the ship in mine planning, movement and closing. Keep orphaned records for GM review. No migration.
- For three drone socket actions only, coalesce exact duplicate authenticated requests using a short-lived in-memory receipt. This is not exactly-once across GM failover, reconnect, new request IDs, local GM calls, cache eviction or expiry.
- Validate GM repair inputs and recheck permissions inside the ship queue. Save repair before initiative cleanup; a failed cleanup requires manual GM correction without repeating repair.
- Refuse Undo of HP/SP changes, including old records: their source and external side effects cannot be safely reconstructed. Other existing narrow guards remain. No action/reaction economy was added.
- Drone effects and upgrades are still incomplete; no live Foundry multiplayer certification. See [historical dev.3 evidence](docs/testing.md#historical-dev-evidence-consolidated-2026-11-11). The dev.3 download URL is an unpublished release placeholder; install the delivered ZIP manually.

## 0.17.1-dev.2 — experimental, test worlds only

- Harden existing drone actions: reject ambiguous drone and station IDs, and block new deployment when a console is over capacity, has an unknown capacity or has unassigned/orphaned records. Retrieval remains available in over-capacity situations. Existing data are not migrated or deleted.
- Deploy/Retrieve availability and selection use the same state checks; this is a preview and the active GM still validates the request. Reject ambiguous drone IDs for mine placement and Drone Block and duplicate mine IDs on retry.
- The full Drone Console, protocol effects, action economy, complete no-op audit, security/failover and live Foundry multiplayer remain unfinished. See [historical dev.2–3 evidence](docs/testing.md#historical-dev-evidence-consolidated-2026-11-11).

## 0.17.1-dev.1 — experimental, test worlds only

- GM can drop a world or Compendium starship Actor or hazard Actor directly on a Sensor Map zone. The active GM resolves and validates the Actor and zone, associates its UUID without importing or modifying it, and moves an existing matching record instead of duplicating it. Existing map-object drag remains available. Before adding a **new, publicly identified** object, an explicit disclosure confirmation is required.
- Secret placement is **not implemented**: the Combat flag is replicated to clients, and UI redaction is not a security boundary. Do not use this drop feature for hidden hazards or unidentified ships. Existing map entries and detection behavior are not migrated. Compendium-linked documents may be read-only; gameplay operations that modify them must be tested or use a world Actor.
- Center the image/fallback in each card when there is no course arrow, including crowded zones. Use the existing autoMirror implementation; for new Actor drops the base artwork direction is initially Unknown and absent headings are not guessed. The GM can choose an initial left/right course in object details; world ship and map updates are separate writes. Set a known left/right base direction to enable automatic mirroring. Existing maps retain their old defaults.
- The generated starship-weapon Items expose `system.category` (simple/martial/advanced); the shipped catalogue has no required rank. Show this category as a category, not as a fabricated required rank. Resolve installed weapon metadata via `weaponRef`, and show a rank only when explicitly provided. Existing weapon records are not migrated.
- Added GM-authority, mocked concurrent/repeated request, Compendium, malformed input, category and offline DOM tests. Real Foundry v14.370/SF2e 1.7.0, multi-client sockets, hidden-information security and Compendium gameplay remain unverified. Previously documented unfinished drone actions, upgrades, no-op audit, GM Override, Undo and performance profiling remain incomplete.

## 0.17.0 — experimental build, test worlds only

This numbered build consolidates the changes since 0.16.0 and extends Sensor Map presentation. It is **not a verified release**: back up worlds and test with Foundry and all clients before production. No GitHub release is published by this build.

### Sensor Map

- Four combat-scoped course-arrow modes: none, text, emoji, or a custom image selected in Foundry's File Picker. The GM can adjust size, spacing, placement and opacity; missing images fall back to a text arrow.
- Per-object image angle, horizontal/vertical flips and base direction are independent of game heading and position. Relative 90° buttons, a precise angle input and independent resets are available. Automatic horizontal mirroring composes with manual flipping and follows the existing left/right heading; up/down base artwork is not auto-mirrored because the game model has no vertical heading.
- Background rotation and flips affect only the image, not zones or game coordinates. Existing settings and unknown fields are retained; older combats acquire default visual settings without migration. GM-authorized map requests are serialized per combat; editing uses absolute field patches. This is not a cross-document transaction or a failover guarantee.
- Very large backgrounds (user-reported 8100 × 11700) may freeze; reduce image size. Zone redraws may still replace the background. No real Foundry profile or final performance confirmation is claimed.

### Consolidated work since 0.16.0

- Recognize narrowly scoped frame-provided upgrades, preserve other compatibility checks and warn about capacity; GM Override and standard frames still need live validation.
- GM-only history storage, configurable Chat Announcements, no-op guards for several operations and improved duplicate request handling. Audits, privacy, socket behavior and Undo remain incomplete or unverified in live multiplayer.
- Native SF2e attack card on supported ship-weapon paths replaces the duplicate module result card; actual damage remains separate. MAP and different attacks are not globally suppressed; the native API fallback and live behavior still require testing.
- Individual drones, capacity checks, deploy/retrieve and limited base Drone Block for supported single-target ship-weapon Strikes. Mine deployment, manual resolution assistance, GM movement and post-resolution removal/marking are available. Full actions and the three upgrade effects are not implemented; reactions/action costs are tracked manually.
- Improved weapon selector damage and explicit proficiency, supported interactive links and conservative damage-type inheritance for specific station upgrades. Not all descriptions or ambiguous damage types are covered.
- Station-specific Boost Battle Station and GM-approved per-roll situational modifier assistance, with documented coverage and timing limits.

### Validation and caveats

- Automated tests and offline Chromium fixtures exercise model, rendering, permissions and mocked socket concurrency; they do not prove native Foundry/SF2e or real multiplayer behavior.
- Full Drone Console, complete no-op/chat audit, real Foundry profiling, GM Override, frame compatibility, log privacy, sockets, failover and Undo need further work or verification. See [limitations](docs/known-limitations.md) and [live test plans](docs/testing.md) for the retained scope and verification boundaries.

## 0.16.1-dev.10 — experimental, test worlds only

- Boost Battle Station now selects an installed station, stores separate station-scoped effects, refreshes without stacking duplicates, and shows the effect in the sheet, HUD and map dock. An active combat on the generator operator’s turn is required for safe expiration; legacy unscoped boosts are preserved but ignored.
- Add up to six per-attack situational modifiers, with name, optional source, signed value, type and attack/damage/both scope. Player proposals require active GM approval. Normal weapon attacks use native attack modifiers; PC-weapon damage folds the stacked flat modifier into its typed formula. NPC damage modifiers, standalone damage, and fully native damage-modifier UI are not implemented.
- Add mock tests for scope, expiration, validation, permissions, approval, damage stacking, duplicate requests and persistence. No real Foundry or multiplayer verification is claimed. Full Drone Console and previous unresolved work remain incomplete. See [limitations](docs/known-limitations.md) and [testing](docs/testing.md).

## 0.16.1-dev.9 — experimental, test worlds only

- Add GM-only preparation of native damage and basic Reflex check links for a tracked, armed Pyrotechnics mine. Validate operator, current combat, range, drone and known statistics; the GM confirms a reaction trigger and resolves targets, damage and mine closure manually. This does not automatically detonate or spend actions.
- Add GM-adjudicated Mobile Exocortex mine movement by one zone, with combat/range/ownership checks, origin guards and persistent duplicate-operation receipts. No automatic Undo; unknown mine fields are retained.
- Add focused mock tests. Drone actions and upgrade mechanics remain incomplete; no live Foundry, SF2e 1.7.0, privacy or multiplayer verification is claimed. See [limitations](docs/known-limitations.md) and [testing](docs/testing.md).

## 0.16.1-dev.8 (experimental; test worlds only)

- Interactive station-upgrade descriptions: bind scaled Ramming Prow damage to the local Ram action's bludgeoning type, present Nova Prow damage separately for graviton (bludgeoning) and photon (fire) attunements, and show the explicitly typed upgraded Thasteron Burst dice. The action text shows the selected variant's dice. No actor data is migrated or modified.
- Add conservative, explicit structured-component inheritance; unknown, multiple or additional untyped effects are not assigned a guessed type. Literal numeric dice and known typed damage are validated before rolling.
- Render explicit native checks and supported SF2e/Foundry links in module windows via the native text editor when available; preserve a chat-based check fallback. Preserve existing enrichers and linked content. Solar Generator Crystal's base shield die and Telepod's travel die can be rolled without applying points.
- Added EN/RU catalogue tests, ambiguous-input and security tests, and a browser fixture for single-click behavior. See [limitations](docs/known-limitations.md) and [testing](docs/testing.md) for constraints and the live Foundry test plan.

## 0.16.1-dev.7 — experimental, test worlds only

- Add base Drone Block to module-resolved single-target weapon Strikes against player ships: the operator chooses one deployed drone, the resistance is applied as attack-scoped IWR, and the drone return/cooldown and damage are saved in one conflict-guarded target actor update. Reactions remain tracked manually. The Shield Protocol interaction, other attack paths and live multiplayer remain unverified and require GM handling.
- Add GM-only, idempotent controls for removing an armed mine or recording a manually resolved detonation. The control does not execute the explosion, save or damage. Mine data is retained.
- Guard sheet-damage application against duplicate application after a chat update failure. Add mock tests for permissions, duplicate requests, stale writes, cooldown and damage; no live Foundry verification. Remaining drone actions and all three upgrades are incomplete. See [limitations](docs/known-limitations.md) and [testing](docs/testing.md).

## 0.16.1-dev.6 — experimental, test worlds only

- Correct dev.5: weapon Strikes from the ship sheet and station runner use a native system attack roll as the primary chat message; no module declaration or duplicate result card is posted on those paths. Select the target on the Sensor Map and choose MAP before rolling. Existing declaration API and spell cards are retained for compatibility.
- Preserve a separate damage roll and, for sheet attacks, append restricted deferred-damage controls to the native attack message. Station damage prefers the system typed DamageRoll and falls back to the previous Foundry roll when unavailable; its result remains separate.
- Check permissions on the GM, revalidate the target, and deduplicate matching event IDs in memory and via a GM-authored chat receipt where the system supplies a message. This is not an atomic transaction or proof of multi-client failover.
- Add mock tests and an offline browser fixture; Foundry v14.370 / SF2e 1.7.0, real multi-client sockets, privacy, Undo, and Sensor Map profiling remain unverified. The other outstanding tasks, including full Drone Console mechanics, are not complete. See [limitations](docs/known-limitations.md) and [testing](docs/testing.md).

## 0.16.1-dev.5 — experimental, incomplete

- Make Deploy Drone and Retrieve Drone station actions operate on individual tracked drones with GM-authoritative permissions, idempotency and guarded Undo for isolated movement. Action/reaction costs remain tracked manually.
- Grant Deploy Starship Mine only for a deployed Pyrotechnics Drone; persist an individually identified mine, its owner/operator/combat/zone, and a per-station round limit. Do not automatically detonate; older map records are preserved for GM review. Placement is not Undoable.
- Suppress the separate native attack-check chat message when an existing ship attack card supplies the result; damage rolls remain separate.
- Document unresolved drone actions, upgrades, damage/reaction transaction issues, chat coverage, real multiplayer and Foundry profiling; see [limitations](docs/known-limitations.md) and [testing](docs/testing.md). No live Foundry verification is claimed.

## 0.16.1-dev.4 — incomplete experimental work

- Added individual drone inventory records and manual deployment/retrieval tracking using the authoritative ship queue, permissions and per-console capacity. Action expenditure and all drone-specific effects remain manual. Legacy records are preserved and require GM review.
- Blocked player raw-list drone mutations; GM raw editing remains available for recovery. Added no-op and concurrent-request mock tests.
- Weapon selection now shows explicit damage, type, required proficiency when explicitly available, and item level; it never infers a rank from weapon category. Existing rules links remain native; checks alongside existing enrichers and keyboard access are improved.
- Very large Sensor Map images may cause freezes (reported example 8100 × 11700); root cause and live performance are not established. Only for test worlds. See [limitations](docs/known-limitations.md) and [testing](docs/testing.md).

## 0.16.1-dev.3 — incomplete experimental work

- Added a sourced drone rules matrix and non-destructive, read-only capacity warnings. Full drone mechanics remain unimplemented.
- Disabled the unsafe automatic Drone Block Strike offer until an individual drone, correct operator level and attack-scoped effect can be tracked; manual adjudication remains available.
- Checked all catalogue frames and levels; frame equipment occupies its slot regardless of list ordering, and duplicate IDs do not receive duplicate exemptions.
- Suppressed same-station upgrade reassignment and unchanged map writes; eliminated duplicate crew-claim announcements and retained silent-claim history. Other no-op and chat paths still need audit.
- Profiled the production template and painting function in an offline Chromium fixture. This is not a Foundry profile and does not confirm a Sensor Map fix. See [limitations](docs/known-limitations.md) and [testing](docs/testing.md).

## 0.16.1-dev.2 — incomplete experimental work

- Recognize narrowly identified frame-provided upgrades without suppressing unrelated validation; avoid folding the same legacy upgrade twice.
- Store new history in a bounded GM-only JournalEntry, retaining read/undo compatibility with trusted legacy GM whispers; optional change announcements have Log Only, Important Only and All Changes modes. Action and roll cards are separate.
- Serialize actor read-modify-write operations and suppress no-op actor writes, repeat station-claim announcements, and rejected upgrade-drop chat messages.
- Correct the existing Drone Block manual reminder to use the operator’s level. Full drone mechanics remain unimplemented.
- Record an offline Chromium rendering experiment; the real Foundry Sensor Map performance and multiplayer behavior remain unverified. This is not a release; see [limitations](docs/known-limitations.md) and [testing](docs/testing.md).

## 0.16.1-dev.1 — work in progress

Partial experimental fixes only; see [limitations](docs/known-limitations.md) and [testing](docs/testing.md) for incomplete requirements and testing limitations.

## 0.16.0 — unified client UI themes

- Extended the existing client sheet theme setting to Follow Foundry, Light and Dark for module windows, dialogs, builder, history and Sensor Map. Removed per-window theme selectors; existing stored light/dark preferences retain their values.
- Preserved combat-scoped map artwork, background and optional custom colors; the old stored map theme no longer selects a UI palette. Native select popup appearance still depends partly on the operating system.
- Added regression tests and offline browser fixtures. Live Foundry testing is still required.

## 0.15.0 — PF2e with SF2e Anachronism

- Added conditional support for PF2e 8.6.0+ with active SF2e Anachronism 2.4.0+; standalone SF2e behavior and requirements are retained.
- Added startup validation and localized messages for missing/outdated Anachronism and unavailable Computers/Piloting skills.
- Added eleven system-scoped PF2e compendiums, derived reproducibly with matching IDs, native icon paths, system provenance and remapped internal UUIDs. Existing SF2e packs keep their names and IDs.
- Adapted damage chat flags, Toolbelt damage context, compromised initiative priority, hazard/action images and installed-upgrade lookup to the active system.
- Extended condition lookup to include available Anachronism conditions after native PF2e conditions.
- Added regression tests for both environments and pack transformations. This is not a world-conversion tool.

## 0.14.3 — Toolbelt ship damage controls

- Added optional Toolbelt controls for damage through ship shields or directly to hull; native positive damage buttons in ship rows use the same engine.
- Preserved typed damage, multipliers and Shift adjustments; grouped multi-type damage applies Hardness and the shield/hull transition once.
- Added GM-side validation, per-ship queues, state checks and application receipts to guard repeated clicks. Ordinary actors and native healing remain unchanged.
- Kept module attack cards on their existing application path and suppressed duplicate native buttons on new associated rolls.
- Added regression mocks and a local DOM fixture; documented unsupported persistent/split-splash workflows and mixed-selection handling.

## 0.14.2 — Toolbelt statistics and inline checks

- Exposed the existing starship save, Perception and skill adapter through native `actor.getStatistic`, fixing missing Reflex/Will for vehicle-based ships in SF2e inline checks and Toolbelt Target Helper.
- Added a narrowly scoped, chained lookup wrapper for flagged vehicle/NPC starships only. Ordinary actors and unknown statistics retain the previous implementation; no actor data or external module settings are rewritten.
- Kept native NPC modifiers and the existing module modifier calculations; lookups use current crew/effects without stacking the adjustment repeatedly.
- Removed duplicate DC text and redundant parentheses around inline check links in action cards and generated descriptions, including Barrow Dirgesinger’s fragment launcher. Area/trait parentheses, basic-save parameters, visibility and typed damage remain intact.
- Reviewed Toolbelt 3.59.2 and Workbench 7.7.5 integration paths. No duplicate damage-roll listener, automatic damage application or new dependency was added. Native damage-application buttons do not replace the starship shield/hull engine.
- Added regression tests for native lookups, callback forwarding, ordinary actors, live penalties, NPC modifiers and EN/RU check markup; rebuilt compendiums.

## 0.14.1 — Compatibility declarations and release integrity

- Declared Foundry v14 and SF2e compatibility explicitly, without widening support to Foundry v13 or PF2e worlds.
- Added packaging guards against missing compatibility declarations.
- Added an installer-archive verifier and a post-upload check of the actual GitHub release assets.
- Bumped the release version so existing 0.14.0 installations can receive the corrected manifest.
- No gameplay-rule changes. Compatibility declarations do not replace live-world testing.

## 0.14.0 — Repository and release preparation

- Added English/Russian project pages, contributor conventions and a GitHub Desktop publishing guide.
- Standardized source formatting and comments; fixed a corrupted Russian Success heading in ability parsing.
- Replaced Bash packaging with a portable Node release builder, root-level manifest, matching-version checks and SHA-256 sums.
- Added CI/release workflows and a local Chromium fixture runner; made optional Python provenance paths portable.
- Preserved gameplay behavior and ORC notices. Full live Foundry validation remains a manual release gate.

## 0.13.2

- Keep the starship trait label exactly `starship` in every interface language, including native SF2e weapon/action Item sheets and module trait lists. Override existing runtime trait dictionary labels rather than only filling absent keys. Trait data/slugs are unchanged; ordinary ship/object-type translations are preserved.

## 0.13.1

- Fixed Station Actions failing to open in ApplicationV2: the theme selector is now inside the single template root rather than a sibling element.
- Added light/dark themes and a selector to the separate Crew Manager window, sharing the existing client-local sheet preference. Other clients and encounter appearance remain unchanged.
- Added regression checks for both empty/populated window templates and theme switching, including the ApplicationV2 single-element contract.

## 0.13.0

- Centered ship overview labels/values; fixed light-theme header/table contrast. Removed ship global search, Compact mode and their handlers while retaining catalog/upgrade/history searches and window/tab memory.
- Client-local themes now cover Station Actions and native module action Item sheets.
- Registered real Starship traits in module item/action data, rebuilt compendiums and migrated existing module items without touching unrelated items.
- Start Combat supports per-ship detection and custom object artwork; GM map details allow object type changes, redacted until identified for players.
- Station-tab actions execute via the existing workflow; installed upgrades can open their compendium Item. Contextual operator skill/class/spell DCs preserve missing or ambiguous values for manual adjudication.
- Conditions in enriched action/upgrade text support chat, native valued-condition drops and document opening. Damage uses native typed SF2e DamageRolls, including mixed-type NPC strikes; no automatic HP/SP application.
- 300 offline tests and 21 local Chromium fixtures; live Foundry validation remains required.

## 0.12.0

- Soft effect timing: stable combatant anchors for turn start/end and round durations; custom conditions confirmed by GM; once-per-round sustaining reminders with explicit confirmation and no automatic action spending. Evade retains and displays the actions spent.
- Bounded GM-whispered history for module starship writes, HP/SP deltas and optional manual-damage reason. Conservative snapshot-guarded undo for a narrow reversible subset; actions, critical transitions and multi-document operations remain audit-only. Player-authored history flags are rejected.
- History navigation to ships/stations/effects, local window/tab memory, searchable lists, station/history filters and client-local compact mode.

## 0.11.1

- Client-local dark/light themes for player and NPC starship sheets. Switch in the sheet header or Module Settings; available to players, GMs and read-only observers. Uses Foundry client settings, never actor/combat data or GM socket requests.
- Changes refresh open starship sheets on this client without changing their active tab; newly opened sheets inherit the saved local preference. Sensor Map appearance and other clients remain untouched.
- Light theme covers inputs, tables, station/warning panels, portraits, active tabs and HP/SP bar labels, not just the page background. Default remains dark.

## 0.11.0

- Sensor Map: dark/light themes, optional custom main/secondary/accent colors, art/simple display modes and adjustable artwork size (32–128 px). GM settings are saved on each combat and synchronized through the existing authoritative socket path.
- Known ships and hazards show their actor portraits. Each object supports a map-only artwork override, chosen through Foundry’s image picker; custom contacts can place independent art without an actor. Missing/broken images fall back to the existing symbols. Unidentified contacts retain neutral symbols.
- Optional map background with opacity, desaturation and blur. Defaults: 0.35 opacity, 0.25 desaturation, 2 px blur. Effects affect only the background. Clear its path to remove it; restore defaults to reset all appearance settings.
- Russian glossary alignment: Armor Class is «КД», Traits are «Признаки» throughout UI, descriptions, guides, dictionaries and rebuilt compendiums. Internal rule identifiers and English text are unchanged.
- Existing worlds and combats need no schema migration; old combats use default appearance until configured. Existing imported descriptions are not rewritten automatically.

## 0.10.3

- **Tag `starship` everywhere.** The compendiums already carried it in _Other tags_ (356 items, checked in the compiled packs), but items made by earlier
  versions did not: world items imported before 0.10.1, station action items on characters, hazard abilities and strikes. A one-time world
  repair (_world fix 5_, run by the active GM at load) now adds the tag to all of them, including unlinked token actors, and every module item
  created from now on (compendium drop, import) is tagged in `preCreateItem`. _Toolbox → Diagnostics_ lists any module item that still lacks the tag.
- **Class requirements in upgrade descriptions.** Ten upgrades are for one class and now say so in the statistic line (_Requirements: Mechanic class_, RU
  _Требования: класс механик_): Gunnery Turret Mount, Mine Deployment Shell, Mechanic Generator Module (mechanic); Mystic Magic Module (mystic);
  Technomancer Magic Module (technomancer); Witchwarper Magic Module (witchwarper); Solar Generator Crystal, Starship Weapon Crystal, Solar Thrusters,
  Nova Prow (solarian). Six are named in the Tech Core text itself; Solar Thrusters and Nova Prow name the class only in their activation
  (solarian DC / solar weapon) and the Witchwarper module only in its name.
- **Magic Conduit** station: the full Tech Core text (amplifies spellcasters' magic; spell repository of starship spells; if you have the spellcasting
  feature you can cast starship spells with your own spell slots, only of a tradition your spellcasting lets you learn), EN and RU.
- **Cosmic spells**: Cosmic Bombardment, Cosmic Fortification and Cosmic Repairs (rank 1) now state that the caster expends a spell slot of the rank they choose.
  Cosmic Cannon is a _cantrip_ in the book (Cantrip 1), so it states that it does not expend a spell slot.
- English station tables no longer show the raw column key `helmedWill`.

## 0.10.2

- **Upgrade drop: choose the station.** When several battle stations of the right type have a free slot, a dialog lists them (name, quality,
  used slots) and the upgrade goes into the chosen one; closing the dialog installs nothing and posts nothing. With one candidate the upgrade is
  installed straight away, with none the reason still goes to the chat. Full stations are not offered.

## 0.10.1 — feedback fixes

Verified with Node tests (238), the compiled packs and screenshots of the new markup in headless Chromium; **not** run in a live Foundry world.

- **Sensor Map**: contact names are readable again. The chip put the name on one line next to the icon and the heading arrow, so in the
  narrow zone columns it was cut to one letter (also for unidentified contacts such as "Contact α"). The name now has its own row and wraps; zone
  columns are a little wider (a regression of the 0.10.0 chip layout).
- **Tag `starship`** (_Other tags_, `system.traits.otherTags`) on every item and action the module creates or ships: station action items on PCs,
  starship weapons, upgrades, exploration activities, hazard abilities and strikes (238 pack documents + 118 embedded items checked by a test).
  Station action items made earlier are replaced on the next sync; items imported into a world before this version keep their old data
  until they are imported again.
- **Upgrades by drag & drop**, like weapons: an upgrade dropped on a ship is installed in the first battle station of the right type with a free
  slot (escape pods at ship level). No suitable station or no free slot: nothing is installed, the reason is whispered to the player and the GM.
  The weapon and upgrade drop handling is one module (`pack-drop.mjs`).
- **Piloting DC** on the sheet: 10 + the Piloting modifier of the pilot at the console (AC is never lower; "—" while nobody helms it). Three buttons
  Fort / Ref / Will post a save at that DC to the chat (inline check, rolled by whoever clicks it).
- **Overview**: saves and Perception are cells of the stat grid and roll on click; the list is now called **Checks** and holds skills only.
- **Station quality at creation**: ships created above level 1 (Create Starship, conversion, catalogue NPC ships) get their stations from the level
  advancement table instead of always _commercial_ (`buildPlayerShipData` ignored the level). Existing ships: _Edit → apply frame_ with
  _Set station grades from level_.

## 0.10.0 — interface and release pass

Verified with Node tests (227, none skipped), real LevelDB read-back of all packs and Handlebars rendering. **Not run in a live Foundry
v14 / sf2e 1.6.0 world** — see the 0.10.0 checklist in `docs/testing.md`.

### Interface

- **Starship sheet**: one template for player and NPC ships (the two 13 KB copies are gone); tabs reduced from 8 / 6 to **5 / 6**
  (Overview, [Actions], Stations, Equipment, Notes, Edit). Crew lives with the stations, weapons and ship upgrades with the equipment,
  active effects and the combat log with the overview (log and GM controls are collapsible).
- **Vitals in the sheet header**: Hull / Shield bars always visible, direct input of the current values and damage / repair / hull-check
  buttons for everyone who may adjust vitals.
- **Sensor Map**: an **action dock** at the bottom with the actions of the station you helm (same model as the Station HUD), mini Hull / Shield
  bars on contacts instead of numbers, icon-only GM tools, collapsed _GM tools_ in the detail panel (state is remembered), `Esc` cancels targeting,
  crew can edit the current Hull / Shield of their own ship right on the map.
- **Scene controls**: 8 buttons → 4 (Sensor Map, Station HUD, Start Combat, Toolbox). The Toolbox (GM) opens the crew manager, hazard
  browser, starship builder, encounter builder and the new **Diagnostics** window.
- The **Dashboard** now opens the Sensor Map (and the crew manager for the GM); the HUD is embedded in the map.

### Automation never restricts the table

- New world setting **Rule enforcement** (default _Warn only_; replaces _Strict station requirements_ and _Require free hand_). Station
  rules, frequency, range and detection become ⚠ warnings on buttons and chat cards; _Strict_ restores the refusals.
  Permissions and "no starship combat" are always enforced. **Existing worlds switch to _Warn only_** — set _Strict_ to keep the old behaviour.
- New permission **adjustVitals** (GM, owner, captain, crew): current Hull / Shield, manual damage / repair / hull check and off-kilter
  without waiting for the GM. Maxima, compromised / wrecked / inoperable and malfunction clearing stay GM / `configureShip`.

### Fixes

- Secret checks: the fallback roll passed `rollMode` in the wrong argument of `toMessage`, so it was public; both `messageMode` (v14) and `rollMode` are sent now.
- One `updateActor` hook instead of two, a cached crew index instead of scanning every starship on each item / effect / actor update,
  no document-wide click handler (check / condition links are wired inside the module's windows), no duplicate context-menu entries
  (`getActorDirectoryEntryContext` removed), one sheet class per actor type, no injection into the system's _Create Actor_ dialog.
- Release: `LICENSE` and `THIRD-PARTY-NOTICES.md` added, `package-release.sh` fixed and verifies the zip, all packs rebuilt with the official CLI
  (the Python LevelDB writer is removed), the 10 tests that were skipped without `packs-src` now run.

### Removed

- Dead code: the old action pool / budget, MAP tracking, the unused HoloDock write bridge, ~40 unreferenced exports, 217 unused imports,
  41 `void x;` keep-alives, ~30 orphaned localization keys, the `data-*` aliases `toggleReady` / `removeCrew`.
- Tooling added: ESLint (unused imports are errors), Prettier config, GitHub Actions workflow, `npm run lint | test:full | package`.

## 0.9.1

- New compendium _Starship Upgrades / Улучшения звездолётов_: all 34 Tech Core starship upgrades and their 33 variants as native sf2e equipment items (one item per variant, like weapon/armor upgrades), in English and Russian folders grouped by battle station and escape pods. Each item has level, traits, rarity, usage, source page and the full rules text (actions with action glyphs, Trigger / Requirements / Effect, degrees of success, attunements, variant text). Price is 0 as a placeholder with a localized "the GM determines the price" note; it can be edited after import. There is no purchase system.
- Data: `data/equipment/upgrades.json` is now the single upgrade catalog, regenerated from the Tech Core text and cross-checked against Archives of Nethys (`tools/content-pipeline/parse_upgrades.py`). Corrected stations: Gravity Toggle and Tractor Beam → generator, Munitions Deflection Unit → gunnery, Security Relay → scanners. Escape pods (Executive Escape Pod, Explorer Survival Pod, Magnepod, Telepod, Interplanar Pod) are ship-level upgrades.
- Sheets (player and NPC): every station card has an _Installed Upgrades_ section — used / available slots from the station grade's advancement row, searchable selector with only compatible upgrades, install / remove, expandable full rules (open state is kept across re-renders). The Upgrades tab shows all stations plus the ship-level escape pod section and any unassigned upgrades (with an Assign control).
- Capacity and compatibility are enforced on the GM side (`stationUpgrade` socket request). Over-capacity or incompatible upgrades (lowered grade, old data) are flagged, never removed. GMs can install beyond the rules as an explicit, stored _GM override_. Raw edits of the upgrade list are GM-only.
- Data version 2: per-station upgrade ids are folded into the ship-wide list (stable ids, no localized names); removing a station keeps its upgrades as unassigned; _Update from content_ re-points upgrades at renamed stations. Upgrade effects are not automated.
- i18n: all new UI strings in EN and RU; all upgrade texts translated through the content dictionary (`tools/i18n/ru/05-upgrade-items.json`). New sf2e usage labels (installed in a pilot's console / generator / gunnery / scanners / magic conduit / drone console).
- Fix: the content dictionary (`lang/content/<lang>.json`) and the data catalog are fetched with the module version in the URL and without the HTTP cache. After an update browsers kept the previous files, so new texts (upgrades) stayed English. Language codes like `ru-RU` fall back to `ru`; load failures are logged in the console instead of being silently ignored.
- Russian compendiums: _Starships_, _Starship Hazards_, _Starship Actions_ and _Starship Weapons_ now have _English_ and _Русский_ root folders. The Russian copies (names, notes, strikes, actions, station/group folders, damage and trait labels) are generated at build time from the content dictionary; rules data and flags stay English, so drag & drop, "Perform on the ship" and weapon drops behave identically. English documents keep their ids (existing links stay valid). Before, these four packs were English-only — the content dictionary only applied to module windows and to world imports. Already imported world actors/items do not change: import them again from the _Русский_ folder.
- Data: Raider Rustbringer (_Cryo Corrosion_) and Hivebound Behemoth (_Bilgebiters_) — the ability text that had leaked into a strike's damage is now a separate passive action; hazard `special` texts are translated.
- Tests: 215 (`tests/unit/upgrades-091.test.mjs`, `tests/unit/upgrades-sheet-091.test.mjs`, `tests/unit/ru-packs-091.test.mjs`); `npm run validate` checks the upgrade catalog.

## 0.9.0

- New compendium _Tactical Starship Combat Rules / Правила космического боя_: the Tech Core rules for tactical starship combat (pp. 165–174) as journals in English and Russian — overview, starship and sensor maps, battle stations, combat structure, new traits, helming, zones, movement and heading, areas, Hull / Shield Points, saves, immunities, compromised, hull integrity checks, repairs and destruction.
- New compendium _Starship Exploration Activities / Исследование на звездолёте_: Emergency Repairs, Fly the Ship, Lock and Load, Power Up, Operate Drone, Scan for Magic and Scan Surroundings as sf2e exploration activities (passive `action` items, English and Russian folders) with links to the matching station action items, inline Crafting checks and Hull Point rolls. They are reference items: the module does not automate them.
- Inline links: plain statblock text is turned into sf2e inline enrichers in EN and RU — damage ("2d8+7 fire damage", "1d10 урона огнём") becomes `@Damage[…]`, conditions ("frightened 2", "off-guard", "напугано 2") become `@TscCondition[…]`, which resolves at render time to the system's condition item. Module windows render them as clickable damage / condition links.
- Security: players can no longer join or control ships they have no access to. `addCrew` and `claimStation` now require GM, ship ownership or the Captain role (`assignCrew`); the only self-service exception is a _player_ starship shared with the user (Observer or better). NPC / enemy ships are never joinable through the API or the socket.
- Security: every ship / crew / action handler loads its target through a starship check, so starship data can no longer be written onto an ordinary PC, NPC or vehicle.
- Validation: `patchShip`, `setStation`, `equipment`, `addStation` and `applyFrame` type-check every value before it is stored (integers for level, AC, saves, speed…, known grades / station types / sizes / roles, lists and maps of the right shape). Wrong-type values are rejected with the field name instead of breaking the sheets. `addStation` can no longer seat a crew member or set runtime state.
- Combat tracker: exact Hull and Shield Points are shown only to the GM and to users who can view the ship (owner, observer, crew); enemy pools are hidden from players, matching the sensor map.
- Chat: labels of clicked check / damage links are escaped again before the chat message is built; only `@Damage[…]` payloads are posted from damage links.
- Release: the download zip only contains what Foundry needs (no `tests/`, build tools, print-source parsing pipeline, `ship-report.json`, `__pycache__` or internal audit docs). Tests that read `packs-src/` skip when it is not present.
- Docs: known limitations and README updated (test count, ship-joining rules, tracker visibility).

## 0.8.9

- Starship sheet: the Stations and Crew tabs have "Station Actions" and "Crew Manager" buttons, so both windows can be reopened at any time (not only at initiative start). Reopening brings an already open Crew Manager to the front.
- Starship sheet Crew tab now shows the same card as the Crew Manager (station strip, station select, take a free station, ready, release, remove; role select for crew managers).
- Crew Manager: removed the non-working GM "+1 / -1" buttons.
- Shared crew card partial `templates/crew-ship.hbs` and view model `scripts/crew/crew-view.mjs`.

## 0.8.8

- Hazards: actions, reactions, free actions and passive abilities are now embedded sf2e "action" items and appear in the Actions block of the hazard sheet instead of the description. Their text uses the system layout (Trigger / Requirements, Effect, Critical Success ... Critical Failure), with inline @Check and @Damage rolls.
- Hazard strikes (e.g. Infernal Vice "infernal chain") are embedded "melee" strike items with attack bonus, damage rolls and attack effects (chain wrap) instead of a description line.
- "Update from content" replaces the generated hazard items on already imported hazards; items added by hand are kept.

## 0.8.7

- Fix: the station selector in the crew manager closed and lost the choice because the window re-rendered on every update of a crew member (combat, HUD, items, effects). Windows now postpone refreshes while a dropdown or text field inside them is focused.
- Crew manager: every crew member that may change station (own character, or GM / crew managers for anyone) has "Take a free station" buttons under the row, also when already on a station; the window refreshes right after the change.

## 0.8.6

- Start combat wizard: "Zones of the copies" field per enemy ship / hazard ("6, 7, 8" = copy #1, #2, #3); presets store it.
- Crew manager: players can move their crew member to any free station (selector or the button on a free station in the station strip); occupied stations are disabled for players. The player assigned to a crew entry may do this even without owning the actor.
- Area Fire / Auto-Fire: the options dialog lists the starships on the sensor map (players only see detected ones, by contact designation); checked ones are excluded from the area, your own side is pre-checked. Destroyed starships are no longer hit; the chat card shows how many were excluded.

## 0.8.5

- Start combat wizard: a copy count for every enemy ship and hazard. Extra copies are created as separate actors (folder "Tactical combat copies", named "Name #2") and act independently: own HP, SP, status, sensor contact, hazard state and combatant. Presets store the count.
- Crew manager: every crew member has a station selector; each station is marked as free, current or occupied (by whom). The GM / crew managers can reassign an occupied station.
- Fix: Seek Starships rolled against "DC 0"; every contact is now compared to its own Stealth DC (ship Stealth skill, hazard Stealth, otherwise the level-based DC).
- Fix: a successful Seek did not change the contact to Observed in the GM panel and player views (result was stored for the scanning ship only); it now updates the shared party detection.
- Fix: hazard Stealth DC on the sensor map used the Stealth modifier instead of 10 + modifier.

## 0.8.4

- Fix: dialogs used the deprecated global `FormDataExtended` (Foundry v13+ warning); now `foundry.applications.ux.FormDataExtended`.
- Hazards: the level is shown in the name ("Name (Lv N)"), like ships; hazards now carry traits and publication data, so the sf2e compendium browser lists them.
- Fix: dragging a character onto the ship sheet to add crew stopped working after the sheet was closed and reopened.

## 0.8.3

- Fix: the starship sheet failed to render (`wireWeaponDrop` called without the sheet, 0.8.1 regression).
- Sensor map: the GM can edit a selected starship's Hull Points, Shield Points, heading and status directly in the detail panel.
- Sensor map: more space between objects in the same zone; object buttons no longer overlap.

## 0.8.2

### Encounter builder: threat indicators for hazards

- Every enemy in the world (starships, simple and complex hazards, creatures) now shows its XP and a colour-coded threat badge: the threat it poses on its own against the party budget ("Below trivial" when it does not reach the trivial budget). The tooltip shows its share of the target-threat budget; a warning marks enemies more than 4 levels above the party.
- New "Suggested hazards" table: compendium hazards that fit the remaining budget of the target threat, those that close the gap listed first, each with its threat badge and an Import button (GM).
- Ship suggestions also show the threat badge of one ship.

## 0.8.1

### Partial re-rendering

- Starship sheet renders in three parts (header / tabs / body). A tab switch re-renders only tabs + body; combat, targeting and crew refreshes re-render header + body (targeting: body only). The body keeps its scroll position.
- Sensor map renders in three parts (bar / zones / detail). Targeting changes refresh bar + zones, actor/crew changes and selection refresh zones + detail; combat and settings changes still do a full render. Hover preview stays DOM-only.
- `refreshApps` merges pending part requests per app (a full render always wins) and renders only the needed parts.
- Sheet inputs are wired once per element, so partial renders never duplicate change handlers.

### Code structure

- `scripts/chat/attack-card.mjs` is now a facade over `attack-card/{model,view,render,service,client}.mjs`.
- `scripts/ui/sensor-map-app.mjs` uses `scripts/sensor/map-model.mjs` (pure rules) and `map-handlers.mjs` (socket handlers).
- `scripts/ui/starship-sheet.mjs` uses `scripts/ui/sheet/{sheet-model,sheet-rows,sheet-context,sheet-listeners,sheet-actions}.mjs`.
- Public exports are unchanged.
- New unit tests for the pure modules (merge of parts, part plans, sheet helpers, attack card model).

## 0.8.0

### Added

- **Update from compendium** (GM): button on the NPC starship sheet and _Update all_ in the Hazard Browser. Imported ships and hazards get current data and the level in their name; crew, station assignments, damage taken, conditions, custom name/image and the actor UUID (sensor map position, tracker) are kept.
- **Encounter budget** in the Encounter Builder: trivial/low/moderate/severe/extreme XP budgets by party level and size (Tech Core small-crew reduction for 3 or fewer, PF2e per-character adjustment for 5+), threat rating of the current lineup and Tech Core ship suggestions.
- Single Russian glossary `lang/content/glossary.json` (station grades, traits, damage types, weapon categories/groups, advancement, costs) used by the build and checked against the interface by tests.
- Russian descriptions for all 34 station upgrades; full English upgrade texts extracted from Tech Core.
- _Import all_ now puts the level in ship names.

### Changed

- Threat rating follows the PF2e convention (highest budget reached).
- Russian terms unified: force = силовой, razing = разрушительное, tech = технологическое, forceful = силовое, volley = залповое, ultimate = предельная.
- The English guide now matches the Russian one (portraits, attack card, crew, GM tools, language); version history moved out of both guides into this changelog.

### Removed

- Leftovers of the removed action pool / station MAP / vertical orientation: unused settings strings (`ui.actionPool`, `ui.orientation`, `sensorOrientation`, `settings.actionEconomyMode`, `settings.sensorOrientation`), unused imports and variables.

### Notes

- Ship saves were re-checked against Tech Core: they already depend on the crew (helmed station item bonus), as does AC (pilot).
- Two upgrades stay marked for review: Primal Shielding (text interrupted by a sidebar in the printed text) and Weapon Crystal (action glyphs).

## 0.7.2

### Fixed

- Empty compendiums in the 0.7.0 / 0.7.1 archives: the packaging step deleted the LevelDB data files (`*.log`) of
  every pack. Packs are now shipped intact and the release check verifies that each pack contains data.

## 0.7.1

### Added

- NPC starship names show their level: "Name (Lv 5)" in the compendium, "Name (ур. 5)" when imported with the
  Russian UI. Ships in each faction folder are sorted by level. Token names stay without the level.
- Russian versions of the rules reference journals: "Боевые станции (RU)", "Каркасы звездолётов (RU)",
  "Снаряжение звездолётов (RU)"; bilingual compendium labels.

## 0.7.0 — release

### Changed

- Attacks (starship sheet and attack card): the multiple-attack-penalty dropdown is replaced by buttons
  "1st / 2nd / 3rd+ attack" that show the final attack modifier and the penalty (agile −4/−8).
  The choice made on the card is kept when you pick the target on the Sensor Map.

### Fixed

- Sensor Map: picking a target did not work — hovering re-rendered the window and swallowed the click.
  The range preview is now updated in place.
- Crew synchronisation: ship sheets, Station HUD and Sensor Map refresh when a crew member's actor, items or effects
  change (skills, saves, proficiencies, level, gear, conditions), so attack bonuses, check modifiers, DCs and the
  pilot-based AC are always current.

## 0.6.4

### Fixed

- Start wizard: sections 4–5 were nested inside section 3 (unclosed tags).
- Ending the encounter now ends tactical combat: sensor map, station HUD and crew manager close on every client,
  temporary ship effects and malfunctions are cleared.
- Ship damage uses system damage slugs (`CONFIG.PF2E.damageTypes` labels); immunities, weaknesses and resistances are
  normalised and support the system groups `physical`, `energy`, `non-physical`, `all-damage` plus the actor's own sf2e IWR.

### Changed

- Zone count is a single number field (default 12) in the wizard, the sensor map and the module setting.
- Movement actions (Boost Thrusters…) no longer move the ship automatically; the chat card tells how far it may move.

### Added

- Start zone for every player ship, a section for sensor-map objects, and combat presets (save / load / delete) in the
  start wizard.
- Station HUD: expandable description for every station action.

## 0.6.3

### Added

- Compendium **Starship Weapons / Орудия кораблей** (Item pack): every catalogue starship weapon as an sf2e `weapon` item,
  in folders per weapon group. Drag it onto a starship sheet (module or any other sheet) and it is added to the ship's
  weapon list; no embedded item is created.
- Traits use the system trait dictionaries (`CONFIG.PF2E.weaponTraits` etc.) for labels; pack weapons carry system weapon
  trait slugs, module-only starship traits (area, ordnance, volley, boost…) stay on the ship entry. Starship actors get the
  system `starship` creature trait. Typo `ordinance` → `ordnance`.

## 0.6.2

### Fixed

- **Start tactical starship combat** crashed: `"sf2e-tactical-starship-combat.sensorOrientation" is not a registered game setting`
  (`start-wizard.mjs:42`). The setting was removed in 0.6.1 together with the vertical sensor map, but the wizard still read it.
  A unit test now checks that every `moduleSetting(...)` key used in `scripts/` is registered.
- **sf2e 1.6.0 migration warning on world load** ("documents remain on an older schema"): starships and hazards built by the
  module (player ship builder, importer, compendium packs) had no `system._migration.version`, so the system treated them as
  outdated on every load. All module-built actors now carry the current sf2e schema version (0.959, read live from the system
  when available); on load the active GM stamps existing module starships/hazards that have no version (an existing version is
  never changed). All compendium packs were rebuilt with the stamp.

### Changed

- The combat tracker no longer has the **Tactical starship combat** on/off toggle. The GM sees only **Start tactical starship
  combat**; it opens the start wizard, and after a successful start the wizard closes and the dashboard opens (sensor map,
  station HUD and, for the GM, the crew manager). While a starship combat runs, the tracker shows the sensor map and crew sync
  buttons.

### Sensor map (0.6.1 changes, included here)

- Drag and drop: drag a starship to another zone. The GM can move anything; players can move only their own player/ally
  ship (checked by the GM side). Players also get the ◀ ▶ buttons for their ship.
- The map keeps its scroll position on re-render (it no longer jumps back to the start after an action); on first open it
  scrolls to the ship whose turn it is.
- Vertical orientation removed (button, setting, wizard option, CSS).

### Added

- Compendium **Starship Actions / Действия кораблей** (Item pack): all catalogue actions as native sf2e `action` items, in folders
  per battle station, "Any station" and "NPC starships". Each item has a **Perform on the ship** link: it finds the station you
  occupy that has this action; the GM can instead select the starship token. Pack copies use the `packAction` flag, so the
  automatic station-item sync never deletes them.
- `tools/leveldb_pack.py`: dependency-free LevelDB pack compiler; `tools/build-packs.mjs` uses it when
  `@foundryvtt/foundryvtt-cli` is not installed.

## 0.6.0

### Removed (simpler, less rigid)

- Token-position markers on the map (the green boxes with "[object Object]"; they could not be selected or deleted). Cause: a PIXI v8-style `new PIXI.Text({text, style})` call on the PIXI v7 canvas.
- "Go to station" and "Set station by token" buttons, automatic helming by token position and its prompt.
- Action / reaction counters, the shared ship action pool, turn gating ("not your turn").
- Automatic multiple attack penalty counting (including counting native sf2e rolls).
- Settings: action economy mode, automatic helming, apply MAP.

### Added

- Station actions on the character sheet: during a starship combat each crew member gets the actions of the occupied station as native sf2e `action` items (Actions tab), with icons, traits, cost and a "Perform on the ship" link. Removed automatically when the station changes, the crew member leaves, or the combat ends.
- MAP is always chosen manually: 1st (default) / 2nd / 3rd+ attack on the attack card and on the ship sheet; the weapon profile (agile, rule elements) is respected.

## 0.5.0

**New: rolls from the starship sheet** (overview tab of player and NPC sheets)

- Perception, Fortitude/Reflex/Will and the ship's skill modifiers with a Roll button and an optional DC; native sf2e Statistic
  (modifiers, roll options, degree of success). No DC → no degree. Missing statistics are not shown (no fake checks).
- Attacks from installed weapons (through their battle station and crew) and NPC Strikes: modifier, type, range, traits,
  damage, MAP selector (auto / 1st / 2nd / 3rd+). Uses the existing attack card, Sensor Map targeting and validation.
- Damage: free damage/critical rolls from the sheet (roll only); on a hit from a sheet attack the card offers
  Roll/Reroll damage and a GM-only "Apply damage" button (once, bound target, full starship damage pipeline).
- Sheet rolls never spend, count or block actions or reactions; repeats are allowed.

**Fixes / audit** (see docs/audit-0.5.0.md)

- NPC saves/Perception: sf2e effects on the NPC actor were cancelled by the ship adjustment (delta vs. final modifier).
- Checks without DC computed a degree against undefined.
- NPC damage strings: every component is rolled ("2d6 piercing plus 1d6 fire").
- Sheet: drop handler was re-registered on every render (one drop added a crew member several times).
- Removed dead code in the attack card.

## 0.4.1

**Fix (reported in Foundry v14 / SF2e 1.6.0)**

- NPC starship sheets did not open: `labels.mjs:42 TypeError: Cannot read properties of undefined (reading 'kind')`.
  Cause: `#npcActionRows()` adds the catalogue action `engaged-strike` to every NPC ship. It has `builtin: "npc-strike"` but, being a
  generic Tech Core template, no `strike` object; `push()` treated every `npc-strike` action as a statblock Strike and called
  `strikeLine(a.strike)` with `undefined`. Running it would also have rolled without a Strike (falling back to player weapons).
- New pure module `scripts/actions/npc-rows.mjs`: collects NPC actions from all sources (catalogue, station lists, `strikes`,
  `npcActions`), validates every Strike (`normalizeNpcStrike`: name, melee/ranged kind, numeric attack, damage dice, traits) and binds
  Engaged Strike to the ship's own Strike named in its ability text ("claw", "cluster maw"), or its only melee Strike.
- Engaged Strike is shown only for ships whose statblock lists it, as "Engaged Strike: <strike>", and is no longer duplicated as a
  manual ability. The GM-side engine binds it the same way and refuses unbound/invalid NPC Strikes with a clear error.
- Incomplete records (missing/invalid kind without a range trait, non-numeric attack, damage without dice, unnamed entries, bad
  station action entries) are shown as disabled rows with a localized warning; the rest of the sheet is prepared normally. The only
  default applied: a missing kind becomes _ranged_ when a range trait proves it (with a warning). Ship data is never modified.
- `strikeLine()` throws a descriptive error for non-Strike input instead of reading `undefined.kind`.
  **Tests**: 96 (new `npc-rows-041`).

## 0.4.0

**Localization**

- Full RU/EN: templates, windows, settings, dialogs, chat cards, notifications/errors in JS; no hard-coded UI strings.
- Game data (stations, 37 actions, weapons, frames, upgrades, drones, factions, 32 hazards, 74 NPC starships) translated via
  `lang/content/ru.json` (display-time, keyed by English source; slugs untouched; SF2e terminology). Tools: `tools/i18n/`.
- Trait, damage-type, zone, skill labels localized (`scripts/utils/labels.mjs`); RU strings cleaned of English fragments.
  **Portraits & crew**
- Portraits of helming creatures on all station views with placeholder and live refresh; `crew.stationId` ↔ `station.helmedBy`
  consistency (`engine/crew-assignments.mjs`) with world repair.
- Crew of participating player ships joins initiative automatically (`crewInitiativeScope`), tracker sync button, wizard rework.
  **Attacks**
- Attack declaration chat card with eligible targets, hidden/undetected filtering for players, GM whisper diagnostics, card and
  Sensor Map share one validation, revalidation before roll, double-execution guard, preview spends nothing (`attackCards`).
- MAP per creature per SF2e rules (`engine/map.mjs`, `combat/attack-tracker.mjs`).
  **Security**
- Socket sender taken from Foundry (not payload), GM-only responses/events, request sanitizing, reaction ownership checks.
  **Tests**: 87 (new `attack-card-040`, `security-crew-040`, `i18n-040`).

## 0.3.0

**Fixes (reported in Foundry v14)**

- Sheet tabs other than Overview did not open (`You must pass both the tab and tab group identifier`): the sheet used the
  reserved ApplicationV2 action name `tab`; renamed to `tscTab` on both starship sheets.
- Tactical combat toggle in the Combat Tracker threw `Combat id … does not exist in the CombatEncounters collection`: the
  button now resolves a live encounter from `game.combats` at click time (creates one if none exists) and never updates a stale document.
- Hull Integrity button "did nothing" when the ship was not compromised: it now explains why (only while compromised) and shows the DC.
- `GET /icons/svg/ship.svg` 404 on every refresh: Foundry v14 has no such icon. Module icons (`assets/icons/`) are used; a one-time
  world repair fixes existing actors, prototype tokens and placed tokens.
  **New**
- Clickable checks: statblock text like "DC 32 Will save" / "DC 18 Computers (trained)" is converted to `@Check[...]` enrichers in
  hazard/starship descriptions (packs rebuilt, existing world hazards repaired) and chat cards; in the module's own windows check
  links post the check to chat.
- Change images: click the sheet portrait, _Change image_ / _Change token image_ in the Edit tab, image button in the Hazard Browser.
- Full editor (Edit tab) on player and NPC starship sheets: name, image, level, size, role, heading, traits, faction, all statistics,
  HP/SP, conditions, immunities/resistances/weaknesses, skills, stations (name/type/grade/actions), weapons, strikes, abilities, bays,
  plus a validated raw-JSON editor for GMs.
- Starship creation from Foundry's _Create Actor_ dialog (Starship (player) / Starship (NPC) / Starship hazard) and a _Create Starship_
  button in the Actors tab.
- In-Foundry user guide: compendium _Guide / Руководство_ (RU + EN), sources `docs/guide-ru.md`, `docs/guide-en.md`.
- Tests: 54 (new `tests/unit/ui-030.test.mjs`).

## 0.2.0

**Content**

- All 74 starships and 32 hazards rebuilt from the Tech Core text (bbox layout) cross-checked with Archives of Nethys;
  discrepancies historically recorded per entry and in a `docs/data-audit.md` report that is absent from the current repository (e.g. Sovereign Dominator SP 32, not 132); this extraction was not rerun in the 2026-11-12 audit.
- NPC strikes now carry traits and range increments; 30 non-standard stations (Hangar Bay, organelles, …) kept as custom stations.
- Hazards: correct simple/complex flags, stealth DC/modifier, AC/saves/HP/hardness, routines, resets, strikes, special rules.
- Compendium packs rebuilt.

**Rules fixes**

- Per-turn processing is keyed by round + combatant: inserting a compromised ship no longer resets the current PC's actions.
- Compromised entry keeps the current combatant active (as SF2e does).
- Multiple attack penalty for starship Strikes (setting).
- Station-action frequency is tracked per battle station.
- Target Lock: success = off-guard to _your next_ Strike (consumed); failure/crit failure only against your starship.
- Lock On restricted to the source ship.
- Hack Battle Station critical-failure backlash moved to Hack Munition (where the book puts it).
- NPC Strikes are executable from the NPC sheet (automated attack + damage); range from range increment / weapon table / sensors.
- NPC station malfunction blocks the station's statblock actions; shared (*) actions blocked if any involved station malfunctions.

**Security / robustness**

- NPC "inline" actions are rebuilt on the GM from ship data; clients can no longer send action definitions (this also fixes
  0.1.0, where inline actions never reached the engine).
- New tests (46 total): MAP, turn key, per-station frequency, Target Lock, NPC action builder, content completeness, syntax check
  of every script.

## 0.1.0

Initial Tactical Starship Combat implementation.

- Zone-based Sensor Map, detection, contacts, zone features; Range/Burst/Cone/Emanation/Line engines.
- Player starships (vehicle actors) and NPC starships (npc actors) marked by module flags; ordinary actors untouched.
- Battle stations with grades, 37 data-driven actions, transactional action pipeline, reactions window.
- Damage engine (resistance/weakness/immunity/hardness/bypassing/shields), Compromised, Wrecked, Hull Integrity with initiative entry.
- Starship hazards (simple/complex), routines, disable modes, reset timers, hazard browser.
- Crew manager, helming (claim / token square), permission layer, station markers, Combat Tracker decoration.
- 74 starships, 32 hazards, 3 frames, 6 stations, 17 weapons, 34 upgrade index entries; five compendium packs; validators.
- English and Russian localization; public API and hooks; data versioning and migrations.

## Archive: former guide notes

### Added in 0.4.0

- **Portraits on battle stations**: the ship sheet, Station HUD, crew window, combat wizard and Sensor Map show the portrait of the
  creature helming each station (neutral placeholder when empty). Portraits refresh on image change, station assignment/release and
  crew removal. `crew.stationId` is the source of truth; `station.helmedBy` is kept in sync and repaired on world load.
- **Attack card**: single-target attacks first post a chat card (attacker, station, weapon, attack type, range/zone, traits, damage,
  modifiers, attacks this turn and next MAP, eligible targets). Hidden/undetected targets are never listed for players; the GM gets a
  whispered diagnostic. Card buttons and the Sensor Map use the same validation, everything is re-checked before the roll, nothing is
  spent until the attack resolves, and a second click cannot execute it twice. Setting _Attack declaration cards_.
- **MAP** is tracked per creature (−5/−10, agile −4/−8).
- **Crew in initiative**: crew of participating player starships is added to the encounter automatically (setting _Crew in
  initiative_); Combat Tracker button _Sync crew with initiative_ (idempotent, keeps the current turn).
- **Language**: UI and module game data follow the client language (English/Russian); slugs are never translated. Actors imported
  through the browser/builder are written in the GM's language; compendium documents stay English.

### How to use (0.6.0)

1. **Setup.** Ship sheet → Crew: add characters and assign each a station (or a player claims a free station on the ship sheet / crew panel). There is no token-position binding any more.
2. **Start of combat.** Start the starship combat. Every crew member on a station immediately gets that station's actions on the character sheet, **Actions** tab, as normal sf2e action items (like Compendium.sf2e.actions).
3. **Performing.** Open the action (or post it to chat) and click **Perform on the ship**; the module rolls and applies the effect. The ship sheet and station window still work too.
4. **Changing stations.** Moving to another station swaps the actions; leaving removes them; ending the combat removes all module actions.
5. **Action economy.** The module no longer counts actions or reactions and has no turn gate; track 3 actions + reaction yourselves.
6. **Multiple attack penalty.** Pick 1st / 2nd / 3rd+ attack on the attack card or ship sheet (default 1st). Nothing is counted between attacks.

### Changes in 0.6.2

- The tracker toggle is gone: only **Start tactical starship combat**. The needed windows open after the start.
- New compendium **Starship Actions**: every station action and NPC starship action as an action item. Drag it to a character sheet or post it to chat and click **Perform on the ship**. It runs from the station you occupy; the GM can select the starship token instead.
- Module starships and hazards carry the current system schema version, so the migration warning on world load is gone.

### Changes in 0.6.3

- New compendium "Starship Weapons": drag a weapon onto a starship sheet to add it to the ship weapon list.
- Trait labels come from the sf2e system dictionaries.
