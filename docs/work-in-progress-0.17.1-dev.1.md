# 0.17.1-dev.1 — experimental, test worlds only

Based on the source archive 0.17.0. It is not a release. Back up the world and install manually. The previous archives are untouched. No Git commit, push, or GitHub release. Packaged URLs refer to a release which has not been published. No `.git` directory was supplied, so a real Git diff was unavailable; compare the source archive in GitHub Desktop.

## Actor drop and privacy

The GM can drag a world or Compendium Actor onto a map zone. The UI uses Foundry's TextEditor drag parser where available, and sends only the UUID, zone and a disclosure acknowledgement. The active GM checks sender, resolves the UUID again, verifies `documentName`, starship flag or hazard type, the zone, and duplicates. A new map object references the original Actor; no Actor/Token is created. If the Actor is already on the map the existing entry moves without losing transforms and no state write occurs when already in the target zone. Multiple pre-existing duplicates are rejected rather than silently merged. Map requests are serialized per combat on the active GM, not across all subsystems.

**Security limitation:** combat flags replicate to clients. `viewFor` redacts presentation but does not prevent inspection of underlying shared data. New drops explicitly require confirmation of public identification; **hidden hazard / secret ship placement is not implemented**. Existing legacy hidden map records may already expose information and are not migrated. Do not use the Sensor Map to keep those records secret. Fixing this needs a permission-separated source of truth and carefully redesigned player-safe views, actions, detection and synchronization. The confirmation is an intentional safety compromise, not completion of the requested hidden-hazard requirement.

Compendium Actor artwork is resolved asynchronously for known objects; access to files and documents can differ across clients. A compendium Actor remains linked to its original document, not a writable world copy. Locked pack documents cannot be treated as ordinary writable Actors: on course flip only the map heading changes for a pack Actor; other combat operations may require a writable world Actor and are not verified. No combatant or initiative is created. Existing GM/hazard engine behavior is otherwise not redesigned.

## Visuals

The new no-arrow CSS state centers image or fallback icon in each object card, even in crowded zones. Rendering does not change coordinates, course or artwork source. Existing Auto Mirror is reused. For a newly dropped ship, `baseDirection` is explicitly Unknown so the module never guesses an artwork's nose; the GM can set Left or Right. Manual flip X/Y and rotation remain separate, and auto horizontal mirror is calculated from the actual left/right heading and base direction using XOR. If the source heading is missing, the new object has no heading and is not mirrored; no vertical headings are invented. The GM can set the initial course in the object detail panel. This updates a writable world ship and the map in separate writes, not an atomic transaction; a Compendium Actor itself remains untouched. A stale initial-course request cannot overwrite an already chosen course. Older objects retain their legacy default.

## Weapon data

The 17 canonical weapons have 7 simple, 6 martial and 4 advanced entries in `data/equipment/weapons.json`; none has an explicit required rank. The module's pack builder writes the category to Item `system.category`. A central summary shows that category as **Weapon category**, and shows an explicitly provided custom required rank alongside the category when both are available. Existing installed `weaponRef` records fall back to the canonical catalogue for missing metadata without rewriting actor data. Custom or malformed/unknown category and missing rank get a localized fallback. No category-to-rank mapping is invented. Unrelated externally modified compendium data are not guaranteed to be reflected by the catalogue.

## Verification and remaining work

The v14 official API documents `foundry.applications.ux.TextEditor.getDragEventData(event)` as extracting JSON from a DragEvent: https://foundryvtt.com/api/v14/classes/foundry.applications.ux.TextEditor.html. The implementation supports the class and the project's existing implementation/fallback pattern. Static source and mock/DOM tests do not establish actual Foundry behavior.

Required live plan: see `docs/testing.md`. Real Foundry 14.370 / SF2e 1.7.0, actual directory and pack drags, permissions, multiplayer, GM failover, pack images and read-only gameplay were not tested. No hidden-Actor secrecy guarantee is possible in the current architecture. All previous open issues remain, including complete drone actions/upgrades, the full chat/no-op audit, GM Override, Undo, and performance profiling with very large backgrounds.
