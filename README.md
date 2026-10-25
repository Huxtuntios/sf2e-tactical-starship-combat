# SF2e Tactical Starship Combat

[Русская версия](README.ru.md) · [User guide](docs/guide-en.md) · [Releases](https://github.com/Huxtuntios/sf2e-tactical-starship-combat/releases) · [Report a bug](https://github.com/Huxtuntios/sf2e-tactical-starship-combat/issues)

![Foundry VTT 14](https://img.shields.io/badge/Foundry_VTT-14-informational)
![Starfinder 2e](https://img.shields.io/badge/System-Starfinder_2e-orange)
![License ORC](https://img.shields.io/badge/License-ORC-blue)

Tactical starship combat for **Starfinder Second Edition** in **Foundry VTT 14**: player and NPC starships, battle stations, crew management, starship hazards and a zone-based Sensor Map.

Each character keeps their own initiative and spends their normal actions. By default, the player starship does not gain a separate turn; compromised ships have the rules-specific hull-integrity exception.

> **Experimental, AI-assisted project.** Automated checks and local browser fixtures are available. Back up your world and test a copy before using it in a campaign. No system files are modified.

## Requirements

| Requirement                               | Version / notes                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| Foundry Virtual Tabletop                  | v14, minimum 14.361                                                              |
| Starfinder Second Edition system (`sf2e`) | 1.6.0 or newer; newer system releases still need compatibility testing           |
| Other modules                             | None required                                                                    |
| Optional integrations                     | HoloDock; coexistence checks for Aztec's Engines of War and Causodes Ship Combat |

## Toolbelt and Workbench

Ship checks are exposed through the native `actor.getStatistic` API. This allows SF2e inline save links and **PF2e Toolbelt Target Helper** to request Fortitude, Reflex and Will for vehicle-based player ships as well as NPC ships. Perception and stored ship skills use the same adapter as the ship sheet. Select the **ship token**, not a crew token, when making a ship save.

The bridge chains the existing lookup only for actors explicitly marked as module starships. Ordinary actors, unknown statistics and external module settings are unchanged. Statistics are read on demand; NPC native modifiers are preserved. It does not create duplicate chat rolls or apply damage automatically.

With **PF2e Toolbelt active**, typed damage messages gain two controls for module starships:

- **Through shields**: use the ship damage engine, with shield overflow going to hull.
- **Direct to hull**: bypass shields, but retain applicable immunities, resistances, weaknesses and Hardness.

Native positive damage buttons (full, half, double and triple damage) in ship target rows also use the ship engine, through shields by default. Choose a multiplier explicitly; hold **Shift** when applying damage to enter a numeric adjustment. Types are read from the stored roll, not from client-supplied damage totals. Multi-type damage applies type defenses before applying Hardness and the shield/hull transition once. Repeated application of the same message roll to the same ship is guarded against, including switching between the two modes. Application requires an active GM and permission to adjust that ship’s vitals.

Ordinary actors and native healing buttons retain their existing behavior. Toolbelt’s personal **Shield Block** is not a starship shield action: use the two ship controls instead. A generic row with a mixed ship/non-ship selection is blocked; use individual Toolbelt target rows or select ships separately. Unevaluated persistent damage, healing-only rolls and split splash messages are not supported by this bridge; apply those using the appropriate manual workflow. No persistent-damage condition is created automatically.

Module attack cards keep their existing **Apply Damage** workflow. Newly generated attack-card damage rolls suppress duplicate native application buttons. Do not apply both paths from older chat cards created before this update. Reload the world after installing.

Source review covered Toolbelt **3.59.2** and Workbench **7.7.5**. Workbench’s spell/creature automation is not a starship action engine: automatic station actions and CR scaling of module ship data are not added. Neither module is required. Automated mocks and local interface fixtures do not replace an in-world integration test.

## Install

1. Open **Add-on Modules → Install Module** and paste the manifest URL:

   ```text
   https://github.com/Huxtuntios/sf2e-tactical-starship-combat/releases/latest/download/module.json
   ```

2. Enable **SF2e Tactical Starship Combat** in a Starfinder 2e world.
3. Open **Guide / Руководство** in the compendiums or follow [Setup](#setup).

The `latest` address works after a **regular, non-prerelease** GitHub release is published. To install a specific release, including the first prerelease, use the `module.json` asset on that release:

```text
https://github.com/Huxtuntios/sf2e-tactical-starship-combat/releases/download/v0.14.0/module.json
```

For manual installation, create `Data/modules/sf2e-tactical-starship-combat/` and extract **`module.zip`** into it. `module.json` must be directly inside that directory. GitHub's automatic **Source code** archives are development sources, not installable module packages.

The module ID remains `sf2e-tactical-starship-combat`; existing settings and flags use the same ID.

## Setup

1. Create a player ship with **Starship Builder**, or convert a `vehicle` actor through its context menu. Ordinary vehicles are not converted automatically.
2. Import enemy ships and hazards from the content browser or the supplied compendiums.
3. Drop characters onto the ship's **Stations** tab and assign stations. Players can also claim free stations they are allowed to operate.
4. Start **Tactical Starship Combat** with the wizard: select ships, crew, detection states, hazards and custom contacts.
5. Roll initiative normally. Open the **Sensor Map** and use its station-action dock, the ship's **Stations** tab or the separate **Station Actions** window.

## What it does

- **Two maps, one encounter.** The normal scene remains the interior Ship Map. The Sensor Map handles abstract space zones, range, heading, areas and detection.
- **Battle stations and crew.** Pilot's Console, Generator, Gunnery, Scanners, Magic Conduit, Drone Console and custom stations. A separate Crew Manager shows occupants, assignments and readiness.
- **Station actions.** Data-driven actions use native SF2e checks where supported. Rule enforcement warns by default; strict enforcement is optional. Unknown/custom abilities fall back to manual adjudication.
- **Damage and ship states.** Shield Points, Hull Points, resistances, weaknesses, immunities, compromised/wrecked states and hull-integrity checks. Use the module's damage tools for ships: native SF2e damage application does not account for module shields.
- **Hazards.** Simple triggers and complex routines, with configurable GM prompts or automatic execution. Only supported text patterns are automated; other effects are reported for the GM.
- **Content.** 74 starships, 32 hazards, 37 actions, 17 weapons, 34 upgrade entries and three frames, with English and Russian compendiums. Upgrades have station compatibility and capacity checks; not every upgrade effect is automated.
- **Sensor Map appearance.** Combat-scoped light/dark themes, custom text/accent colors, portraits or simple symbols, object art overrides and an optional background with opacity, desaturation and blur. Unknown contacts do not reveal identifying artwork.
- **Local themes.** Ship sheets, Station Actions, module action Item sheets and Crew Manager share a client-local light/dark preference. Other clients and the Sensor Map theme remain independent.
- **Soft effect timing.** Turn-start/end anchors, round durations, manually confirmed conditions and sustain reminders. Evade displays actions spent. Reminders do not spend actions or extend effects automatically.
- **Change history and guarded undo.** Up to 80 GM-only records of module ship-state changes, pool deltas and reasons, with navigation to ships/stations/effects. Only a narrow, compatible subset can be undone; rolls, costs, chat and revealed information cannot.
- **Rule-text interactions.** Conditions can be sent to chat and dragged onto characters with their values. Damage links create native typed SF2e rolls without applying damage. Contextual DCs use the actual station operator where the rule identifies a statistic; missing or ambiguous DCs remain manual.
- **Client memory.** Window dimensions and ship tabs are remembered locally. Catalog, upgrade and history searches remain available.
- **Multiplayer authority.** State-changing requests are validated and written by the active GM. Players need the appropriate ship/station access; no socketlib dependency is required.

## Settings

| Setting                  | Scope                    | Purpose                                                      |
| ------------------------ | ------------------------ | ------------------------------------------------------------ |
| Starship sheet theme     | Client                   | Shared light/dark preference for ship/crew/action windows    |
| Sensor Map appearance    | Encounter, GM-controlled | Theme, art and background for the current combat             |
| Rule enforcement         | World                    | Warn by default, or strictly enforce supported station rules |
| Automatic hazard routine | World                    | Off, GM prompt or automatic                                  |
| Crew initiative scope    | World                    | Crew participation and synchronization                       |
| Player ship initiative   | World                    | Optional alternative to the normal no-extra-turn behavior    |

See [the guide](docs/guide-en.md) for all settings and controls.

## Documentation and API

- [English guide](docs/guide-en.md) / [Русское руководство](docs/guide-ru.md)
- [Known limitations](docs/known-limitations.md) and [manual test checklist](docs/testing.md)
- [Rules decisions](docs/rules-decisions.md), [integrations](docs/integrations.md) and [API](docs/api.md)
- [Changelog](CHANGELOG.md), [contributing](docs/CONTRIBUTING.md) and [publishing with GitHub Desktop](docs/RELEASING.md)

```js
const api = game.modules.get("sf2e-tactical-starship-combat").api;
```

Consult the API documentation before invoking state-changing methods.

## Known limits

- A live Foundry v14 / SF2e multiplayer test is still required. Offline mocks are not proof of complete system compatibility.
- Native system damage buttons bypass module Shield Points. Typed damage rolls do not apply damage automatically.
- Non-strike NPC abilities and many upgrade effects require GM adjudication.
- Undo is conservative, not an atomic multi-document rollback. Direct system/other-module edits are not recorded and can prevent undo.
- Arbitrary effect conditions, removed turn anchors and unusual initiative skips may require GM correction.
- An active GM client is required for state-changing requests.

## Development

Use **Node.js 22.13+** and npm. There is no runtime transpilation or bundling step.

```sh
npm ci
npm run format
npm run check
npm run build:release
```

`npm run check` verifies formatting, lint, content, all compiled packs and the Node tests. `npm run build:release` writes `dist/module.json`, `dist/module.zip`, checksums and release notes. The ZIP has runtime files at its root, ready for Foundry installation.

```sh
npx playwright install chromium
npm run test:ui
```

UI checks render actual templates in local Chromium; they do not start Foundry. Generated packs, dependencies, reports and ZIP files are ignored by Git. Canonical content is in `data/`; rebuild packs rather than editing LevelDB files. Optional historical content-extraction tools are documented separately in [the provenance pipeline](tools/content-pipeline/README.md).

## Credits and license

Maintained by **[Huxtuntios](https://github.com/Huxtuntios)** with AI assistance and contributions from the module's contributors.

Rules content is based on Starfinder Second Edition, © Paizo Inc., using the ORC License. This is an unofficial fan project, not endorsed by Paizo or Foundry Gaming. No Paizo artwork, source PDFs, system code or other modules are bundled.

See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The existing **ORC** licensing is preserved; this repository is not MIT-licensed.
