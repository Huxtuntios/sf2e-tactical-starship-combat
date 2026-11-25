import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
const catalogs = {
  immunities: { poison: "PF2E.Damage.IWR.Type.poison", void: "PF2E.Damage.RollFlavor.void" },
  resistances: { fire: "PF2E.Damage.RollFlavor.fire", cold: "PF2E.Damage.RollFlavor.cold", custom: "PF2E.Damage.IWR.Type.custom" },
  weaknesses: { electricity: "PF2E.Damage.RollFlavor.electricity", sonic: "PF2E.Damage.RollFlavor.sonic" },
  skills: {
    computers: { label: "PF2E.Skill.Computers", attribute: "int" },
    piloting: { label: "PF2E.Skill.Piloting", attribute: "dex" }
  }
};
const nativeCatalogs = {
  immunityTypes: catalogs.immunities,
  resistanceTypes: catalogs.resistances,
  weaknessTypes: catalogs.weaknesses,
  skills: catalogs.skills
};

async function contextFixture(lang = "en") {
  installFoundryMock({ lang });
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  const actor = makeShip({
    id: `defense-${lang}`,
    name: "Defense fixture",
    role: "npc",
    extra: {
      immunities: ["poison", "legacy-immunity"],
      resistances: { fire: 5, cold: 0, "Legacy Resistance": -2 },
      weaknesses: { electricity: 3 },
      skills: { computers: 12, "Legacy Skill": 4 }
    }
  });
  const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
  const sheet = { document: actor, isNpc: true, tab: "config", tabs: ["overview", "config"] };
  return { actor, sheet, context: await buildSheetContext(sheet) };
}

function renderEditor(context) {
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => game.i18n.localize(key));
  h.registerHelper("eq", (a, b) => a === b);
  return h.compile(fs.readFileSync("templates/ship-editor.hbs", "utf8"))(context);
}

test("numeric defense rows round-trip known and existing custom entries without changing map values", async () => {
  const edit = await import("../../scripts/ui/sheet-edit.mjs");
  assert.equal(typeof edit.numericMapFromRows, "function", "numeric defense row model is missing");
  const result = edit.numericMapFromRows(
    [
      { key: "fire", value: "5" },
      { key: "cold", value: 0 },
      { key: "Legacy Resistance", value: "-2" }
    ],
    { knownKeys: ["fire", "cold"], existingKeys: ["Legacy Resistance"] }
  );
  assert.deepEqual(result, { fire: 5, cold: 0, "Legacy Resistance": -2 });
});

test("numeric defense rows reject duplicates, unknown new types and non-integer or empty values", async () => {
  const edit = await import("../../scripts/ui/sheet-edit.mjs");
  assert.equal(typeof edit.numericMapFromRows, "function", "numeric defense row model is missing");
  const options = { knownKeys: ["fire", "cold"], existingKeys: [] };
  assert.throws(
    () =>
      edit.numericMapFromRows(
        [
          { key: "fire", value: 5 },
          { key: "fire", value: 6 }
        ],
        options
      ),
    /duplicate/i
  );
  assert.throws(() => edit.numericMapFromRows([{ key: "unknown", value: 5 }], options), /unknown/i);
  for (const value of ["", "1.5", "NaN", "Infinity", null, undefined, true]) {
    assert.throws(
      () => edit.numericMapFromRows([{ key: "fire", value }], options),
      (error) => error.i18nKey === "SF2eTSC.errors.defenseValueInvalid"
    );
  }
});

test("immunity tag operations preserve order and existing duplicates while refusing new duplicates or unknown types", async () => {
  const edit = await import("../../scripts/ui/sheet-edit.mjs");
  assert.equal(typeof edit.addListValue, "function", "immunity tag model is missing");
  assert.equal(typeof edit.removeListValueAt, "function", "immunity removal model is missing");
  const options = { knownKeys: ["poison", "void"] };
  assert.deepEqual(edit.addListValue(["poison"], "void", options), ["poison", "void"]);
  assert.throws(() => edit.addListValue(["poison"], "poison", options), /duplicate/i);
  assert.throws(() => edit.addListValue([], "legacy", options), /unknown/i);
  assert.deepEqual(edit.removeListValueAt(["poison", "poison", "void"], 0), ["poison", "void"]);
  assert.throws(() => edit.removeListValueAt(["poison"], 2), /index/i);
});

test("numeric map add and remove keep the existing map contract", async () => {
  const edit = await import("../../scripts/ui/sheet-edit.mjs");
  assert.equal(typeof edit.addMapValue, "function", "numeric map add model is missing");
  assert.equal(typeof edit.removeMapValue, "function", "numeric map remove model is missing");
  const options = { knownKeys: ["fire", "cold"] };
  assert.deepEqual(edit.addMapValue({ fire: 5 }, "cold", "10", options), { fire: 5, cold: 10 });
  assert.throws(() => edit.addMapValue({ fire: 5 }, "fire", 6, options), /duplicate/i);
  assert.throws(() => edit.addMapValue({}, "unknown", 6, options), /unknown/i);
  assert.deepEqual(edit.removeMapValue({ fire: 5, cold: 10 }, "fire"), { cold: 10 });
});

test("sheet context exposes localized native type options and preserves legacy custom rows", async () => {
  const { context } = await contextFixture("ru");
  assert.ok(context.edit.defenses, "structured defense editor context is missing");
  const resistance = context.edit.defenses.numeric.find((entry) => entry.kind === "resistances");
  assert.equal(resistance.label, "Сопротивления");
  assert.deepEqual(
    resistance.rows.map((row) => [row.key, row.value]),
    [
      ["fire", 5],
      ["cold", 0],
      ["Legacy Resistance", -2]
    ]
  );
  assert.equal(resistance.rows[2].known, false);
  assert.equal(resistance.rows[0].options.find((option) => option.key === "cold").disabled, true);
  assert.equal(
    resistance.addOptions.some((option) => option.key === "custom"),
    false
  );
  assert.equal(context.edit.defenses.immunities.entries[1].label, "legacy-immunity");
});

test("starship editor renders tag chips and type/value rows instead of CSV or KV text inputs", async () => {
  const { context } = await contextFixture("ru");
  const html = renderEditor(context);
  assert.match(html, /data-defense-editor="immunities"/);
  assert.match(html, /data-defense-kind="resistances"/);
  assert.match(html, /data-defense-kind="weaknesses"/);
  assert.match(html, /data-defense-kind="skills"/);
  assert.match(html, /data-defense-property="type"/);
  assert.match(html, /data-defense-property="value"/);
  assert.doesNotMatch(html, /data-field="(?:immunities|resistances|weaknesses|skills)"/);
  assert.doesNotMatch(html, /data-defense-property="(?:exceptions|doubleVs)"/);
  assert.ok(html.includes("Иммунитеты"));
  assert.ok(html.includes("Сопротивления"));
  assert.ok(html.includes("Навыки"));
});

test("defense actions add, edit and remove values through the existing ship patch path", async () => {
  installFoundryMock();
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const actions = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  assert.equal(typeof actions.addDefenseEntry, "function", "add defense action is missing");
  assert.equal(typeof actions.saveDefenseRows, "function", "save defense rows action is missing");
  assert.equal(typeof actions.removeDefenseEntry, "function", "remove defense action is missing");
  const actor = makeShip({
    id: "defense-actions",
    name: "Defense actions",
    role: "npc",
    extra: { immunities: ["poison"], resistances: { fire: 5 }, weaknesses: {}, skills: {} }
  });
  const sheet = { document: actor, element: { querySelector: () => ({ value: "cold" }) } };
  await actions.addDefenseEntry.call(sheet, null, { dataset: { defenseKind: "resistances" } });
  assert.deepEqual(actor.flags[M].starship.resistances, { fire: 5, cold: 5 });
  await actions.saveDefenseRows(sheet, "resistances", [
    { key: "fire", value: "7" },
    { key: "cold", value: 5 }
  ]);
  assert.deepEqual(actor.flags[M].starship.resistances, { fire: 7, cold: 5 });
  await actions.removeDefenseEntry.call(sheet, null, { dataset: { defenseKind: "resistances", defenseKey: "fire" } });
  assert.deepEqual(actor.flags[M].starship.resistances, { cold: 5 });
  sheet.element.querySelector = () => ({ value: "piloting" });
  await actions.addDefenseEntry.call(sheet, null, { dataset: { defenseKind: "skills" } });
  assert.deepEqual(actor.flags[M].starship.skills, { piloting: 0 });
  await actions.saveDefenseRows(sheet, "skills", [{ key: "piloting", value: "-3" }]);
  assert.deepEqual(actor.flags[M].starship.skills, { piloting: -3 });
});

test("defense actions require configureShip and reject invalid rows without writing", async () => {
  installFoundryMock();
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const actions = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  assert.equal(typeof actions.addDefenseEntry, "function", "add defense action is missing");
  const actor = makeShip({ id: "defense-permission", name: "Defense permission", role: "npc", extra: { resistances: { fire: 5 } } });
  const sheet = { document: actor, element: { querySelector: () => ({ value: "cold" }) } };
  const before = structuredClone(actor.flags[M].starship.resistances);
  await assert.rejects(
    () =>
      actions.saveDefenseRows(sheet, "resistances", [
        { key: "fire", value: 5 },
        { key: "fire", value: 6 }
      ]),
    /duplicate/i
  );
  assert.deepEqual(actor.flags[M].starship.resistances, before);
  game.user = game.users.get("p1");
  await assert.rejects(() => actions.addDefenseEntry.call(sheet, null, { dataset: { defenseKind: "resistances" } }), /permission/i);
  assert.deepEqual(actor.flags[M].starship.resistances, before);
});

test("legacy KV and CSV helpers remain compatible", async () => {
  const { parseKv, formatKv, parseCsv } = await import("../../scripts/ui/sheet-edit.mjs");
  assert.deepEqual(parseKv("fire 5, cold 10, physical: 3"), { fire: 5, cold: 10, physical: 3 });
  assert.equal(formatKv({ fire: 5, cold: 10 }), "fire 5, cold 10");
  assert.deepEqual(parseCsv(" tech, , undead "), ["tech", "undead"]);
});
