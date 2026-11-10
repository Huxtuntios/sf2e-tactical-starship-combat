import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";
import { registerItemTagging } from "../../scripts/content/world-maintenance.mjs";
import { traitLabel, traitsText } from "../../scripts/utils/labels.mjs";
test("0.13.2 native trait dictionaries keep starship English even when the system already defined a translated label", () => {
  installFoundryMock({ lang: "ru" });
  const primary = {
    weaponTraits: { starship: "PF2E.TraitStarship", agile: "PF2E.TraitAgile" },
    actionTraits: {},
    equipmentTraits: {},
    creatureTraits: { starship: "Звездолёт" },
    vehicleTraits: { starship: "PF2E.TraitStarship" }
  };
  const secondary = { spellTraits: { starship: "Переведённый признак" }, npcAttackTraits: {} };
  CONFIG.PF2E = primary;
  CONFIG.SF2E = secondary;
  registerItemTagging();
  for (const cfg of [primary, secondary]) for (const table of Object.values(cfg)) assert.equal(table.starship, "starship");
  assert.equal(primary.weaponTraits.agile, "PF2E.TraitAgile");
  primary.traitDescriptions = { starship: "Описание признака" };
  registerItemTagging();
  assert.equal(primary.traitDescriptions.starship, "Описание признака");
  delete CONFIG.SF2E;
});
test("0.13.2 module trait labels stay English in RU/EN without changing ordinary ship labels", () => {
  for (const lang of ["ru", "en"]) {
    installFoundryMock({ lang });
    CONFIG.PF2E = { weaponTraits: { starship: "SF2eTSC.objectTypes.starship" } };
    assert.equal(traitLabel("starship"), "starship");
    assert.equal(traitLabel("Starship"), "starship");
    assert.equal(traitsText(["starship"]), "starship");
    assert.equal(game.i18n.localize("SF2eTSC.traits.starship"), "starship");
    assert.equal(game.i18n.localize("SF2eTSC.objectTypes.starship"), lang === "ru" ? "Космический корабль" : "Starship");
  }
});
