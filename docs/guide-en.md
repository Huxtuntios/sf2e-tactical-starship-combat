# Using the module in Foundry

## 1. Install and enable

- Unzip into `Data/modules/` (folder `sf2e-tactical-starship-combat`), restart Foundry and enable the module in **SF2e**, or in **PF2e 8.6.0+ with active SF2e Anachronism 2.4.0+**. In PF2e, use the **Tactical Starship Combat (PF2e)** packs; Anachronism supplies Computers and Piloting. This does not convert existing worlds between systems.
- The compendium folder **Tactical Starship Combat** contains the Tech Core starships, starship hazards, station action items, starship weapons, station/frame/equipment references, the tactical starship combat rules (EN/RU), the starship exploration activities (EN/RU, reference items without automation) and this guide. The starship, hazard, action, weapon, upgrade and exploration packs have _English_ and _Русский_ folders.
- Module tools are in the **Token** controls (left): **Sensor Map**, **Station HUD**, and for the GM **Start Combat** and a **Toolbox** (Crew manager, Hazard Browser, Starship Builder, Encounter Builder, Diagnostics).

## Sensor Map contacts

Use the Sensor Map add menu to choose a world Hazard or Starship Actor, a Compendium entry, or a custom contact, then choose its initial detection state. That choice applies immediately without an extra confirmation. Each world or Compendium Actor placement creates an independent world Actor copy; the source entry is unchanged. Actors already accessible to players can only be placed as identified. Detection controls the zone map, while Foundry Actor and JournalEntry ownership continue to govern document access. This workflow is not a guarantee of strict confidentiality, and real multi-client behavior has not been verified.

If no heading is present it is not guessed. The GM can select its initial left/right course in the object's GM tools; this also updates a world ship, but a Compendium Actor is left untouched. The base direction of new ship art starts Unknown; set it explicitly to left or right in the object's image settings for autoMirror. When a course arrow is absent, the artwork is centered within its card.

Weapon selections and the installed-weapon list display the catalogue category (Simple, Martial, Advanced) separately from an explicitly provided required proficiency rank. The generated Item stores category in `system.category`; no rank is inferred from it.

## Sensor Map visual controls (0.17.0, experimental)

The GM opens the palette in the Sensor Map toolbar. Course arrows support None, Text, Emoji and Custom Image; use the Foundry File Picker, then Save. The global arrow format sets the defaults for all objects. In an identified object's appearance editor, choose **Inherit global format** or **Use custom format** to override the complete arrow format (display, custom image, size, gap, position and opacity) for that object. Inherited objects follow later global changes; **Reset arrow to global** clears a custom format. A missing custom image falls back to text. The object's artwork controls also set its image angle, horizontal/vertical flips, the direction the unmodified artwork faces, and whether auto-mirroring inherits the combat-wide setting or is enabled/disabled for that object. The reset controls operate on the form; Save persists the changes. Transformations affect artwork, not the Actor/Token source art, course, clickable object or game coordinates. Only GM users can edit appearance; existing movement permissions are unchanged.

Auto Mirror compares the current **left/right** game heading to a left/right artwork base direction. The per-object override takes precedence over the global setting; unset legacy values inherit it. Manual and automatic horizontal flips combine rather than overwrite one another, and mirroring is recomputed from each object's current heading without accumulating transforms. Artwork whose base direction is up/down is not automatically mirrored: the current game model has no up/down heading. Background angle and flips are purely visual and do not move zones or objects. Appearance is saved to the combat and synced via the active GM; changing other clients or losing the active GM still requires live testing. These controls apply to existing Sensor Map objects. Drones have no separate map marker; deployed mines do have Hazard Actor/contact projections, synchronized from their mine records.

The appearance form uses `arrowAppearanceMode` for inherit/override and `autoMirrorOverride` for inherit/on/off; resets take effect when saved (`scripts/ui/map-appearance-app.mjs`, `scripts/sensor/appearance.mjs`). Mine contact synchronization is implemented in `scripts/sensor/mine-contact.mjs`.

Very large backgrounds may freeze the map; an 8100 × 11700 image caused problems in a user test. Real Foundry performance profiling has not been completed.

## 2. Creating a starship

There are four ways:

1. **Actors tab → Create Actor**: the type list contains a _Tactical Starship Combat_ group: _Starship (player)_, _Starship (NPC)_, _Starship hazard_. The module creates the closest system type (vehicle / npc / hazard) and marks it as a starship.
2. **Create Starship** button at the top of the Actors tab: name, kind, level and frame in one dialog, with a shortcut to the Starship Builder.
3. **Starship Builder** (token controls): level, frame, size, statistics, stations, weapons, bays and crew in one step.
4. **Actor context menu → Make player / NPC starship** for an existing vehicle or npc.

Tech Core NPC ships are easiest to take from the **Starships (Tech Core)** compendium or **Hazard Browser → Starships → Import**. Ship names include their level, e.g. _Raider (Lv 5)_.

## 3. The starship sheet

- **Overview**: AC, saves, speed, sensor range, Hull Points (HP) and Shield Points (SP), conditions. GMs get HP/SP fields, _compromised_ / _wrecked_ and the Damage, Repair and Hull Integrity Check buttons.
- **Crew** (player ships, _Stations_ tab): drag characters from the Actors tab onto the sheet. Roles: captain, crew, observer.
- **Stations**: claim or release a station, assign a character (GM), malfunction, scene location, grade. During active starship combat, a character sheet also offers _Crew Stations_ to claim a free station on an accessible combat ship or leave the character's current station. This uses the same Crew service as the ship sheet; a concurrent claim is revalidated against the current station state.
- **Installed Upgrades** (each station card on the _Stations_ tab): the number of used / available slots comes from the station grade. Search the selector, pick an upgrade and press _Install_; only upgrades whose Usage matches the station are offered. Click an upgrade's name to expand its full rules. Escape pods and other ship-wide upgrades are installed at ship level on the _Equipment_ tab. Over-capacity or incompatible upgrades are marked with a warning and are never removed automatically; the GM can install beyond the rules as a _GM override_. Effects are not automated. The items themselves are in the _Starship Upgrades_ compendium (price 0 — the GM sets it).
- **Drag & drop**: a starship upgrade dragged from the _Starship Upgrades_ compendium onto a ship is installed in a battle station of the right type that still has a free slot (escape pods at ship level). If several stations qualify, a dialog asks which one it should go into (closing it installs nothing); with a single candidate it is installed straight away. If the ship has no such station or every one is full, nothing is installed and the reason is posted to the chat (whispered to you and the GM). Starship weapons work the same way. Every item and action of the module carries the real **starship** trait (also retained in _Other tags_).
- **Actions** (NPC): statblock action buttons. NPC Strikes roll automatically, other abilities post a chat card. Expand _Description_ to see the text; checks in the text are clickable.
- **Edit**: everything on the sheet — name, portrait and token image, level, size, role, heading, traits, faction, all statistics, HP/SP, conditions, immunities, resistances, weaknesses, skills, stations and their actions, weapons, strikes, abilities and bays. Changes save immediately. GMs also have _Edit raw data (JSON)_.
- **Image**: click the portrait in the sheet header or use _Change image_ on the Edit tab. A token that used the old portrait is updated too. Hazards change their image in their own sf2e sheet or with the image button in the Hazard Browser.

## 4. Starting combat

- **Option A**: _Start Combat_ in the token controls. The wizard picks player ships, NPC ships and hazards, map size, creates the encounter and opens the Sensor Map.
- **Option B**: press **Start tactical starship combat** above the combat tracker list. The start wizard opens; after the start, the Sensor Map (with your station's actions in its dock) and, for the GM, the Crew manager open automatically.
- Every character keeps their own initiative and turn. The player starship has no separate turn.

## 5. A character's turn

- Open the **Sensor Map**: the **dock** at its bottom lists the actions of the station you helm, so a whole turn (pick an action, pick a target on the map, roll) happens in one window. The separate **Station HUD** shows the same list. By default the module never blocks an action: a broken station rule (not your station, malfunction, frequency, range, detection, requirements) shows as a ⚠ warning on the button and on the chat card. The _Rule enforcement_ setting can switch to _Strict_ (the module refuses; the GM can still override).
- Station actions are sf2e action items (compendium _Station Actions_). Actions, reactions and the multiple attack penalty are tracked by the system and the players; the module checks station requirements and frequency.
- DCs, attacks, skills and saves of a player starship are calculated per Tech Core from the characters at the stations (for example, a helmed station's item bonus applies to the save, and AC depends on the pilot).
- **Sensor Map** (horizontal): zones, heading, range, detection. Drag ships with the mouse: the GM can move any ship, a player can move their own ship. Nothing moves automatically.

## 5a. Portraits on battle stations

- The starship sheet, Station HUD, Crew window, combat wizard and Sensor Map show the portrait of whoever helms each station (or a neutral placeholder if the station is free or has no portrait). Hover to see the name.
- The portrait updates by itself when the actor's image changes, when someone is assigned to or leaves a station, or is removed from the crew — no reload needed.
- The station's `helmedBy` field is the source of truth; `crew.stationId` is its synchronized mirror. Stale and duplicate assignments are repaired during normalization and on world load.

## 5b. Attack card

- A single-target attack (a gunnery or NPC Strike) first posts a card to chat: attacker, station, weapon, attack type, range and zone, traits, damage, modifiers and the list of valid targets.
- Targets that are hidden or undetected are not shown to players; the GM gets a whispered diagnostic explaining why a target is or isn't valid.
- Pick the target with a button on the card or on the Sensor Map — the checks are the same. Turn, range and visibility are re-checked before the roll. The module does not spend actions or reactions. Card locks and saved status guard repeated clicks, but do not guarantee exactly-once processing after network failure; inspect chat and documents before retrying.
- Attack modifiers (including the penalty for a second and third attack) are chosen with buttons on the card.
- The _Attack declaration cards_ setting turns this step off (the attack rolls immediately).
- When the GM applies damage from a supported native Strike card to a player Starship, the defender's authorized crew can choose a deployed drone for Drone Block. The GM confirms the exact Strike, target, rolled damage and operator-level resistance, then chooses automatic application through the starship damage engine or manual resolution. Base Drone Block returns the drone for 10 minutes even when resistance is 0. With Drone Shield Protocol, the GM receives a manual-only confirmation: apply resistance and adjudicate shield destruction and Fetch and Fix/redeployment consequences. The existing per-drone ledger records block uses and pending Fetch and Fix for the sheet; the module does not apply base retrieval/cooldown or automatic shield handling. Intercept Munitions and Pyrotechnics Drone mine interactions with base automatic retrieval are not resolved by the printed text and are flagged for GM review. The module does not count actions or reactions.

## 5c. Crew and initiative

- Crew members of player starships in the combat are added to initiative automatically (when combat starts, when a ship is added, when the crew changes). The _Crew in initiative_ setting: all crew except observers / only those at a station / off.
- The combat tracker has a _Sync crew with initiative_ button. Syncing again does not duplicate combatants or change the current turn.

## 6. Damage and conditions

- Damage goes through immunities, weaknesses, resistances and hardness, then shields (except damage that _bypasses shields_), then hull.
- A player starship at 0 HP becomes **compromised** and gets its own initiative entry.
- A **hull integrity check** (DC 10 + compromised value) is only made while the ship is compromised; otherwise the button shows a warning.
- Restoring at least 1 HP removes compromised and adds wrecked +1.

## 7. Hazards

- Place a hazard from the **Hazard Browser** (crosshair button) or add it in the combat wizard. Complex hazards get initiative and routines.
- Checks in descriptions (e.g. "DC 32 Will save", "DC 18 Computers") are clickable links. Clicking posts the check to chat, where any player can roll it for their selected token.

## 8. GM tools

- Hull and Shield Points sit in the sheet header with quick buttons for damage, repair and the hull integrity check; crew members and owners can type the current values directly (maximums and status flags stay with the GM / ship owner). The GM-only fields are in a collapsed _GM controls_ block of the Overview tab. Damage uses damage types and IWR (immunities, weaknesses, resistances).
- The Overview grid shows AC, **Piloting DC** (10 + the Piloting modifier of the pilot at the console; the ship's AC is never lower), Perception and the three saves. Click Perception or a save to roll it. The **Fort / Ref / Will** buttons under the Piloting DC post a save at that DC to the chat for whoever clicks it. _Checks_ lists skill checks only. New ships get their station quality from the level table (a level-5 ship starts with advanced gunnery and pilot stations).
- **Update from compendium** (NPC starship sheet, or Hazard Browser → _Update all_): already imported ships and hazards get the current data and the level in their name. Crew, station assignments, damage taken, conditions, a custom name and image are kept; the actor is not recreated, so its place on the Sensor Map and in the tracker does not change.
- **Encounter Builder**: enter the party level and size — the module shows the XP budget (trivial / low / moderate / severe / extreme), rates the current lineup and suggests matching Tech Core ships. For a small crew (3 or fewer) the budget is reduced per Tech Core; for 5+ it grows per character as in PF2e.
- Module settings: map size, attack cards, crew in initiative, hazard routines, contact designations and more.

## 8a. Language

- The interface, settings, windows, dialogs, chat cards and the module's game data (stations, actions, weapons, frames, upgrades, hazards, starships) are shown in the client's language (Russian or English). Internal identifiers (slugs) are not translated.
- Actors imported from the Hazard Browser or the builder are created in the GM's language. The starship, hazard, station-action, weapon, upgrade and exploration packs contain English and Русский folders; references and rules are bilingual too. Existing world imports are not translated automatically.
- Russian terms (station grades, traits, damage types) come from a single glossary, so the interface, items and journals use the same words.

## 9. Troubleshooting

- Open the console (F12). Module messages start with `[SF2e Tactical Starship Combat]`. Enable _Debug logging_ in the settings.
- All changes are executed by the active GM. If no GM is online, players get a "No GM" message.
- If the system sheet opens instead: use the **Starship Sheet** button in the system sheet header or _Configure Sheet_ → choose the starship sheet.

## Soft automation and local UI (0.12.0)

Evade displays actions spent. On Overview, the GM can edit a managed effect's Duration: a named combatant's turn start/end, several rounds (expiry at the selected turn start), or a manually confirmed condition. Round offsets are relative to now; a passed start/end moves to the next round. Stable combatant IDs resist initiative index changes. If the anchor combatant is removed, reassign it manually. Arbitrary skipped turns may need GM correction. Sustaining sends one reminder per new round to GMs; confirmation records the round but neither spends actions nor extends/removes the effect.

Change history is in the sheet header and Toolbox. The latest 80 module starship-state changes are stored in a GM-only JournalEntry with HP/SP deltas, reason, changed fields and navigation to ships/stations/effects. Trusted legacy GM-whisper records remain readable. Manual damage supports a reason. History is read-only: there is no Undo button; the GM corrects ship state directly on the sheet. A damage undo writes its own history entry whose reason references the source damage message; the original damage entry is left unchanged. HP/SP, damage, action drafts, configuration, crew, critical transitions and expiry are audit-only (`scripts/history/history.mjs`). Rolls, costs, initiative, map changes, chat and revealed information are never rolled back. Deleting an old history whisper removes only that legacy record, not the current journal history. No pre-update history can be reconstructed. A guarded per-application damage undo lives on the Toolbelt damage card (GM only): it returns exactly the shields/hull of one application and refuses critical states, intervening ship/combat changes and repeats.

Window sizes save on close, ship tabs on selection (per ship/client). Ship-sheet global search and Compact mode have been removed. Existing catalog/upgrade filters and the history search remain available. Back up the world before installing; the offline tests do not replace live Foundry validation.

## Interface and actions (0.13.0)

- Use Module Settings → Module UI Theme to select Follow Foundry, Light or Dark for all module windows, including the Sensor Map. The choice is client-local; earlier saved light/dark choices remain in place.
- Start Combat: choose detection for each ship separately; custom objects support artwork paths and the image picker. In the Sensor Map details the GM can change a custom object’s type. Players see that type only once identified.
- On the Stations tab, click a station action to run the existing action workflow. The book button next to an installed upgrade opens its compendium Item. Upgrade effects still require adjudication; this does not automate every upgrade activation.
- Contextual DCs use the station operator’s actual skill, class or spell DC rather than substituting Piloting. Without an operator/statistic, or with ambiguous spell DCs, use the original text and choose manually. Target-owned DCs are not guessed.
- In enriched action/upgrade text, click a condition to send it to chat, drag it onto a character to apply it through SF2e, or right-click to open its definition. Valued conditions retain their value.
- Click damage to post a native typed SF2e DamageRoll. This rolls only; it does not apply damage. Native system damage buttons do not account for module Shield Points: use the module’s starship damage tools.

### 0.13.1: Crew Manager

Crew Manager uses the same client-local Module UI Theme setting as the rest of the module. Combat-scoped custom Sensor Map colors and artwork remain separately configurable; custom colors can reduce contrast in a different client theme.

> **Historical dev.5 drone scope:** Deploy/Retrieve update an individual drone; a deployed Pyrotechnics Drone can record a mine. Track action costs manually. Other drone and upgrade effects were not automated at that stage. See [current limitations](known-limitations.md) and [testing](testing.md) before testing.

### Experimental: boosting a station and situational modifiers (dev.10)

Use Boost Battle Station on the generator operator's active combat turn and select the installed station. An indicator shows a +1 status bonus for one round; operator changes do not transfer the bonus elsewhere. For a single-target weapon Strike, the optional pre-roll dialog accepts up to six modifiers. Player entries require GM approval. See [current limitations](known-limitations.md) and [testing](testing.md) for unsupported damage paths, persistence, and live-test limitations.
