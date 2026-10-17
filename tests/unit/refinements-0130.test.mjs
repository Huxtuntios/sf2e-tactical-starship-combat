import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFoundryMock, makeShip, makeCharacter, makeStarshipCombat, loadContentFromDisk } from "../helpers/foundry-mock.mjs";
import { MODULE_ID as M } from "../../scripts/constants.mjs";
import { normalizePreset, normalizeDetection } from "../../scripts/combat/presets.mjs";
import { applySensorOp, sanitizeSensorPayload } from "../../scripts/sensor/map-model.mjs";
import { viewFor } from "../../scripts/engine/sensor-ops.mjs";
import { contextDCs, linkContextDCs, stationDCRows } from "../../scripts/rolls/context-dc.mjs";
import { typedDamageFormula, inlineDamageFormula, rollTypedDamage } from "../../scripts/rolls/typed-damage.mjs";
import { conditionDragData } from "../../scripts/content/condition-enricher.mjs";
import { itemTagFix, registerItemTagging } from "../../scripts/content/world-maintenance.mjs";
const read = (p) => fs.readFileSync(p, "utf8");

test("0.13 per-ship detection and object artwork round-trip; unsafe art and unsupported types are refused", () => {
  const preset = normalizePreset({
    playerShips: [{ uuid: "Actor.p", detection: "hidden" }],
    enemies: [{ uuid: "Actor.e", detection: "identified" }],
    objects: [
      { name: "Moon", type: "planet", art: "worlds/demo/moon.webp", zone: 4 },
      { name: "Bad", type: "starship", art: "javascript:alert(1)" }
    ]
  });
  assert.equal(preset.playerShips[0].detection, "hidden");
  assert.equal(preset.enemies[0].detection, "identified");
  assert.equal(preset.objects[0].art, "worlds/demo/moon.webp");
  assert.equal(preset.objects[1].art, "");
  assert.equal(preset.objects[1].type, "custom");
  assert.deepEqual(normalizePreset(preset), preset);
  assert.equal(normalizeDetection("unnoticed"), "observed");
});
test("0.13 object type edits cannot turn contacts into actors; players see the type only after identification", () => {
  const state = {
    zones: 12,
    objects: [
      { key: "moon", type: "planet", zone: 4, name: "Moon", detection: { party: "observed" } },
      { key: "ship", type: "starship", zone: 6, detection: { party: "observed" } }
    ]
  };
  const edited = applySensorOp(state, { op: "type", key: "moon", type: "beacon" });
  assert.equal(state.objects[0].type, "planet");
  assert.equal(edited.objects[0].type, "beacon");
  assert.equal(applySensorOp(state, { op: "type", key: "moon", type: "starship" }), state);
  assert.equal(applySensorOp(state, { op: "type", key: "ship", type: "beacon" }), state);
  assert.equal(sanitizeSensorPayload({ isGM: false }, state, { op: "type", key: "moon", type: "debris" }), null);
  assert.equal(viewFor(edited)[0].type, "contact");
  const known = applySensorOp(edited, { op: "detect", key: "moon", level: "identified" });
  assert.equal(viewFor(known)[0].type, "beacon");
});
test("0.13 start combat seeds object artwork and independent ship detections without always-visible bypass", async () => {
  const { settings } = installFoundryMock();
  await loadContentFromDisk();
  const a = makeShip({ id: "a", name: "A" }),
    b = makeShip({ id: "b", name: "B", role: "npc" });
  const combat = makeStarshipCombat();
  settings.set("crewInitiativeScope", "off");
  settings.set("playerShipInitiative", "disabled");
  const { startStarshipCombat } = await import("../../scripts/combat/starship-combat.mjs");
  await startStarshipCombat({
    playerShips: [a.uuid],
    detections: { [a.uuid]: "hidden" },
    enemies: [{ uuid: b.uuid, detection: "identified" }],
    zones: 12,
    objects: [{ name: "Moon", type: "planet", art: "moon.webp", zone: 5 }]
  });
  const objects = combat.flags[M].tsc.objects;
  assert.equal(objects.find((o) => o.key === a.uuid).detection.party, "hidden");
  assert.ok(!objects.find((o) => o.key === a.uuid).alwaysVisible);
  assert.equal(objects.find((o) => o.key === b.uuid).detection.party, "identified");
  assert.equal(objects.find((o) => o.name === "Moon").art, "moon.webp");
  assert.equal(viewFor(combat.flags[M].tsc, { ownKeys: [a.uuid] }).find((o) => o.key === a.uuid).known, true);
});
const operator = () => ({
  skills: { crafting: { dc: { value: 27 }, mod: 17 }, piloting: { mod: 9 }, computers: { dc: { value: 24 } } },
  classDC: { dc: { value: 25 } },
  spellcasting: { contents: [{ name: "Arcane", statistic: { dc: { value: 26 } } }] }
});
test("0.13 contextual saves use Crafting / class / spell DCs, not the pilot's DC (EN and RU)", () => {
  installFoundryMock();
  const crew = operator();
  assert.equal(contextDCs(crew).piloting, 19);
  assert.match(linkContextDCs("basic Fortitude save against your Crafting DC", { crew }), /@Check\[fortitude\|dc:27\|basic\]/);
  assert.match(linkContextDCs("простой спасбросок Рефлекса против вашего КС Ремесла", { crew }), /@Check\[reflex\|dc:27\|basic\]/);
  assert.match(linkContextDCs("Reflex save against your spell DC", { crew }), /dc:26/);
  assert.match(linkContextDCs("basic Reflex save against your class DC", { crew }), /dc:25/);
  assert.match(linkContextDCs("Fortitude save against your Piloting DC", { crew }), /dc:19/);
});
test("0.13 missing or ambiguous DCs never invent values; target DCs and existing links stay unchanged", () => {
  installFoundryMock();
  const crew = operator();
  crew.spellcasting.contents.push({ name: "Primal", statistic: { dc: { value: 23 } } });
  const text = "Reflex save against your spell DC";
  assert.equal(linkContextDCs(text, { crew }), text);
  assert.equal(stationDCRows(crew).filter((row) => row.slug === "spell").length, 2);
  assert.equal(linkContextDCs("your Crafting DC", {}), "your Crafting DC");
  const target = "Computers against the intruder's Stealth DC";
  assert.equal(linkContextDCs(target, { crew }), target);
  const existing = "@Check[reflex|dc:30]{your Crafting DC}";
  assert.equal(linkContextDCs(existing, { crew }), existing);
  const linked = linkContextDCs("Reflex save against your Crafting DC", { crew });
  assert.equal(linkContextDCs(linked, { crew }), linked);
});
test("0.13 typed damage uses native instance pools and damage message flags; mixed types are not merged", async () => {
  installFoundryMock();
  const formula = typedDamageFormula([
    { formula: "2d6+2", type: "fire" },
    { formula: "1d4", type: "cold" }
  ]);
  assert.equal(formula, "{(2d6+2)[fire],(1d4)[cold]}");
  const roll = await rollTypedDamage(formula);
  assert.equal(roll.total, 10);
  const message = game.messages.contents.at(-1);
  assert.equal(message.flags.sf2e.context.type, "damage-roll");
  assert.equal(message.rolls[0].formula, formula);
  assert.equal(inlineDamageFormula("@Damage[(2d6+2)[fire]]"), "{(2d6+2)[fire]}");
  assert.equal(inlineDamageFormula("@Check[reflex|dc:22]"), null);
  CONFIG.Dice.rolls = [];
  await assert.rejects(rollTypedDamage(formula));
});
test("0.13 sheet NPC damage preserves each type on critical rolls and never changes HP", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const ship = makeShip({
    id: "npc",
    name: "NPC",
    role: "npc",
    extra: { strikes: [{ name: "Mixed", attack: 12, damage: "2d6 fire plus 1d4 cold" }] }
  });
  const { sheetDamageFormula, rollSheetDamage } = await import("../../scripts/rolls/ship-rolls.mjs");
  const normal = sheetDamageFormula(ship, "s:0");
  assert.equal(normal.weapon.damageParts.length, 2);
  const before = JSON.stringify(ship.flags);
  await rollSheetDamage(ship, "s:0", { crit: true });
  assert.equal(JSON.stringify(ship.flags), before);
  assert.match(game.messages.contents.at(-1).rolls[0].formula, /\[fire\]/);
  assert.match(game.messages.contents.at(-1).rolls[0].formula, /\[cold\]/);
});
test("0.13 condition drag data uses native Item UUID and preserves severity", () => {
  assert.deepEqual(conditionDragData("Compendium.sf2e.conditions.Item.abc", "2"), {
    type: "Item",
    uuid: "Compendium.sf2e.conditions.Item.abc",
    value: 2
  });
  assert.equal(Object.hasOwn(conditionDragData("x", "NaN"), "value"), false);
});
test("0.13 migration adds the actual starship trait to old tags-only actions and spells, preserves unrelated traits", () => {
  installFoundryMock();
  const item = {
    id: "a",
    type: "spell",
    flags: { [M]: { packAction: {} } },
    system: { traits: { value: ["concentrate"], otherTags: ["starship"] } }
  };
  const fix = itemTagFix(item);
  assert.deepEqual(fix["system.traits.value"], ["concentrate", "starship"]);
  assert.deepEqual(fix["system.traits.otherTags"], ["starship"]);
  assert.equal(itemTagFix({ ...item, flags: {} }), null);
  CONFIG.PF2E = { actionTraits: {}, equipmentTraits: {} };
  registerItemTagging();
  assert.ok(CONFIG.PF2E.actionTraits.starship);
  assert.ok(CONFIG.PF2E.equipmentTraits.starship);
});
test("0.13 station action rows have real descriptions and operator context; installed upgrades open by stable key", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const crew = makeCharacter({ id: "operator", name: "Operator" });
  Object.assign(crew, operator());
  const ship = makeShip({
    id: "station",
    name: "Station",
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "g" }],
    stations: [{ id: "g", name: "Generator", type: "generator", grade: "tactical", helmedBy: crew.uuid }]
  });
  const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
  const ctx = await buildSheetContext({ document: ship, tab: "stations", tabs: ["stations"], isNpc: false });
  assert.ok(ctx.stations[0].actionList.length);
  assert.ok(ctx.stations[0].actionList.every((row) => row.html));
  assert.equal(ctx.stations[0].dcRows.find((row) => row.slug === "crafting").value, 27);
  const npc = makeShip({
    id: "npc-station",
    name: "NPC",
    role: "npc",
    stations: [{ id: "g", name: "Generator", type: "generator", grade: "tactical", actions: ["Repair Self"] }]
  });
  const npcCtx = await buildSheetContext({ document: npc, tab: "stations", tabs: ["stations"], isNpc: true });
  assert.ok(npcCtx.stations[0].actionList.length);
  assert.ok(npcCtx.stations[0].actionList.every((row) => row.stationId === "g"));
  const { openUpgrade } = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  let opened = null;
  game.i18n.lang = "ru";
  game.packs = new Map();
  const rows = ["en", "ru"].map((lang) => ({ _id: lang, flags: { [M]: { upgrade: { key: "key", lang } } } }));
  game.packs.set(`${M}.starship-upgrades`, {
    getIndex: async () => rows,
    getDocument: async (id) => ({
      sheet: {
        render: () => {
          opened = id;
        }
      }
    })
  });
  await openUpgrade(null, { dataset: { key: "key" } });
  assert.equal(opened, "ru");
});
test("0.13 ship search and compact code are removed without removing client window memory or history search", () => {
  const source = read("scripts/ui/client-ui.mjs");
  assert.ok(!/compactMode|data-qol-toolbar|data-qol-compact|createElement/.test(source));
  assert.match(source, /saveUiState/);
  assert.match(read("templates/history.hbs"), /data-qol-search/);
  assert.match(read("templates/start-wizard.hbs"), /pickObjectArt/);
  assert.match(read("templates/start-wizard.hbs"), /shipDetection/);
});
