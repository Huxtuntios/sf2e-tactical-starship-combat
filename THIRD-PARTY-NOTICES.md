# Third-party notices

## Starfinder Second Edition rules content

The starship rules, actions, stations, weapons, upgrades, hazards and ship statblocks shipped in `data/` and `packs/` reference
**Starfinder Second Edition** (Starfinder Tech Core and related books), © Paizo Inc. **Archives of Nethys**
(<https://2e.aonsrd.com>) is a rules reference, not evidence that all bundled material originated there. The repository also contains
printed-text extraction and reconciliation tooling. Applicable publisher notices, rights to individual extracts and any reserved
material require maintainer review before publication; the module's **ORC License** declaration (<https://paizo.com/orclicense>)
does not resolve those questions. See [release readiness](docs/release-readiness.md).

This product is licensed under the ORC License held in the Library of Congress at TX 9-307-067 and available online at various
locations including paizo.com/orclicense and www.azoralaw.com/orclicense. All warranties are disclaimed as set forth therein.

Paizo, Pathfinder and Starfinder are trademarks of Paizo Inc. This module is an unofficial fan work: it is not published, endorsed
or specifically approved by Paizo Inc. Russian texts (`lang/ru.json`, `lang/content/ru.json`, the `ru` document folders in the
packs) include translations. Commit attribution alone does not establish their creative authorship or review by a Russian speaker;
those confirmations remain required before publication.

> Maintainer note: if Paizo's official ORC Notice for the books used here requires different wording, replace the paragraph above
> with that notice verbatim.

## Foundry Virtual Tabletop and the system

Foundry Virtual Tabletop is a trademark of Foundry Gaming LLC. The module runs on the community **sf2e** system (built on the
**pf2e** system code) and uses its public APIs; no system code is bundled.

## Other modules

Causodes' Ship Combat, Aztec's siege module and HoloDock are detected at runtime so that the modules can coexist. This module
neither requires nor bundles them.

## Development tools (not shipped in the release zip)

ESLint, Prettier, Handlebars and `@foundryvtt/foundryvtt-cli` are used only during development (their own licenses apply).
