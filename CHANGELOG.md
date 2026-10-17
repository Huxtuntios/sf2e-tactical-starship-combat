# Changelog

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
- Release: the download zip only contains what Foundry needs (no `tests/`, build tools, PDF parsing pipeline, `ship-report.json`, `__pycache__` or internal audit docs). Tests that read `packs-src/` skip when it is not present.
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
- Two upgrades stay marked for review: Primal Shielding (text interrupted by a sidebar in the PDF) and Weapon Crystal (action glyphs).

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

- All 74 starships and 32 hazards rebuilt from the Tech Core PDF (bbox layout) cross-checked with Archives of Nethys;
  discrepancies recorded per entry and in `docs/data-audit.md` (e.g. Sovereign Dominator SP 32, not 132).
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
