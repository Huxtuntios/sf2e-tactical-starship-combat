# 0.16.1-dev.8 — interactive descriptions (experimental)

Use in a **test world**; back up the world first. This is not a release and does not confirm earlier Drone Console, socket, GM privacy, Undo, or Sensor Map work. The user reported that a very large 8100 × 11700 background can freeze the map; this version does not fix or profile that issue.

## Source and scope

The local `data/equipment/upgrades.json` is the source of the bindings. Ramming Prow's Ram explicitly deals bludgeoning damage; Nova Prow's Nova Ram has two separate effects: graviton bludgeoning and photon fire. For tactical through elite variants the action's displayed dice and variant's links use that variant's dice. Nova presents two separately labelled alternatives, **not** two simultaneous damage components. Commercial retains its original 2d8. Thasteron Burst variants already state fire damage explicitly; both the base action display and variant display use the chosen upgraded dice, while the other variant rules still need to be read and applied manually. Translation is presentation-only; source and existing actors are not rewritten.

A rendering helper can inherit a type from one explicitly supplied structured source component (or a uniquely selected component ID). It does not scan a whole station for a plausible weapon, pick a type by name, or combine types. Explicitly typed expressions retain their own type; extra untyped damage, unknown types, and multiple untyped or ambiguous components remain plain text. Only the verified catalogue bindings are automatically attached to variants; arbitrary custom upgrades and other action–upgrade relationships are not automatically bound.

Normal fixed typed formulas generate native system DamageRoll messages without applying damage. Fixed explicit `[[/r NdM +/- N]]` rolls use Foundry Roll without changing actor data; the Solar Generator Crystal's clickable **base** 1d8 is not automatically scaled by operator level, so calculate any additional dice manually. Telepod's 1d4 is a travel-time roll, not damage. Do not treat progression increments as individual effects. Current action and reaction costs remain tracked manually.

Module-window checks and explicit `@UUID`, `@Template`, `@Localize`, and `@act` expressions are passed to the system TextEditor when available. If a check cannot be enriched, its existing fallback posts a check link to chat; click it there. Existing supported conditions use the module's condition link, chat and drag mechanism. Inline token handling preserves existing links and does not interpret plain numbers as actions. Expressions with unknown types, variable or complex formulas, unbound action context, and unsupported native damage options are not promised to be clickable; resolve them manually rather than guessing. TextEditor, permission and target selection behavior depend on Foundry/SF2e. Explicit area-template or system-action links can invoke their native behavior only when clicked, subject to system permissions.

## Evidence

The catalogue and available SF2e **1.6.0** installed source were inspected. The target SF2e **1.7.0** and Foundry **14.370** were not available as a live world. Unit tests use mocks; the Chromium UI fixture uses mocked native APIs and is not a Foundry or SF2e integration test. AoN was unavailable earlier (HTTP 403), so these bindings are based on local project data, not newly verified official text.

## Live test checklist

1. In Foundry v14.370 / SF2e 1.7.0, install the module in a backup test world; test EN and RU with GM and player ownership.
2. Install each Ramming Prow variant and check both base action and variant link. Roll and inspect native DamageRoll formula/type; check commercial still uses 2d8. Confirm no automatic HP/SP application.
3. Test each Nova Prow grade and both attunements separately: inspect dice, bludgeoning/fire and localization. Ensure using one does not trigger the other. Check the fire damage and other variant text of each Thasteron Burst grade.
4. Open generated compendium items as well as installed station descriptions. Test the typed damage, flat/skill/save checks with selected tokens and contextual operator DC, valued condition chat and drag, and supported native content/action/template links. Exercise missing operator and permission failures.
5. Check Solar Generator's base die and Telepod's die; apply level increases manually. Verify ambiguous or unsupported expressions remain readable. Test repeated rendering, mouse and keyboard activation, cancellation, and exactly one roll per click.
6. Recheck existing attack and damage flows and earlier features independently. No multiplayer, persistence, Undo or map performance confirmation is implied by this work.
