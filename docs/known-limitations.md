# Known limitations

## Validation scope

This release has been checked with Node tests, content validation, compiled LevelDB packs and local Chromium fixtures. It has **not** been validated in a live Foundry v14 / SF2e world with separate GM and player clients. Offline stubs cannot certify socket behavior, hooks, PIXI, system enrichers or sheet registration. Follow `docs/testing.md` before marking a public release stable.

## Gameplay and integration boundaries

- Native SF2e damage applied directly to a ship does not use the module's Shield Point handling. Use the module's own damage tools.
- Module-managed effects support turn/round timing with stable combatant anchors. Arbitrary conditions and sustaining require explicit confirmation; the module does not infer whether narrative conditions happened. Removing an anchored combatant or changing an encounter manually warrants a GM review of pending effects.
- Undo is limited to writes recorded by the module, and is refused when the affected state has changed incompatibly. It is not a general Foundry/world rollback.
- Station and upgrade rules can expose executable actions, contextual checks, damage and condition links, but this is not full rules automation. Unrecognized prose, source references and nonstandard effects remain GM adjudications. Placeholder prices require GM review. Drones and expansion bays remain limited.
- Multiple attack penalty is tracked for supported module actions and system rolls with readable flags. Mixed workflows, custom rolls and shared-crew economies may require manual correction.
- Hazard routines automate supported damage/check patterns; other effects are posted for GM resolution. Family abilities and book references may remain descriptive.
- Station markers and automatic helming on the scene map assume square grids.
- The Sensor Map is a zone-based module window, not a replacement for every Foundry canvas feature. Image paths must be accessible to players; arbitrary remote hosts may block loading.
- Detection and player visibility depend on GM-authoritative encounter state. Test them with a separate player account, not only the GM preview.
- UI themes and window preferences are client-side; encounter appearance settings are shared as documented in the map settings.
- Conditions and typed damage rely on supported SF2e APIs and enrichers. Validate behavior after system updates.
- Modules detected for coexistence are not bundled or required, and compatibility with arbitrary module combinations is not guaranteed.

## Content and licensing

Content was parsed and reconciled from Tech Core/AoN sources. Review unusual wording against the source book; preserved provenance reports are historical, not proof of a newly reproduced extraction. English and Russian compendium copies share stable source identifiers but are separate documents. Text manually edited by the GM is shown as written.

`starship` deliberately remains English in both interface languages. Core Russian terminology uses the project's glossary (including КД and Признаки).

ORC notices were preserved, not legally certified. Before public distribution, verify the exact attribution and licensed/reserved material notices for the source publications. No source PDFs or third-party character/ship art are bundled.

## Publication

GitHub URLs are configured for `Huxtuntios/sf2e-tactical-starship-combat`; they only become available after the owner publishes the repository and release assets. GitHub's `latest` endpoint excludes prereleases. Generated source-code archives do not contain compiled packs and are not installation packages. See `RELEASING.md` in the source repository.
