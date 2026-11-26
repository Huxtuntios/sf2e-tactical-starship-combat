import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";

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

class ForcedDeletion {}
const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const valueAtPath = (target, path) => path.split(".").reduce((value, key) => value?.[key], target);
function mergeDocumentObject(current, patch) {
  const merged = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof ForcedDeletion) delete merged[key];
    else if (isPlainObject(merged[key]) && isPlainObject(value)) merged[key] = mergeDocumentObject(merged[key], value);
    else merged[key] = structuredClone(value);
  }
  return merged;
}
function installDocumentUpdateMock(actor) {
  foundry.data = { ...foundry.data, operators: { ...foundry.data?.operators, ForcedDeletion } };
  const update = actor.update.bind(actor);
  actor.update = async (changes, options = {}) => {
    const resolved = {};
    for (const [path, value] of Object.entries(changes)) {
      if (value instanceof ForcedDeletion) {
        const parts = path.split(".");
        const key = parts.pop();
        const parentPath = parts.join(".");
        const parent = valueAtPath(actor, parentPath);
        if (parent) {
          const replacement = structuredClone(parent);
          delete replacement[key];
          const containerParts = parentPath.split(".");
          const containerKey = containerParts.pop();
          valueAtPath(actor, containerParts.join("."))[containerKey] = replacement;
        }
      } else {
        const current = valueAtPath(actor, path);
        resolved[path] = isPlainObject(current) && isPlainObject(value) ? mergeDocumentObject(current, value) : value;
      }
    }
    return update(resolved, options);
  };
}
function installDefenseFoundryMock(options) {
  installFoundryMock(options);
  game.combat = { id: "defense-editor-test" };
}
async function shipSocketFixture() {
  installDefenseFoundryMock();
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  let requestNumber = 0;
  return async (userId, type, payload) => {
    const requestId = `defense-${requestNumber++}`;
    const emitted = [];
    await dispatchSocketMessage({ kind: "request", type, requestId, payload }, userId, {
      users: game.users,
      selfId: "gm",
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (message) => emitted.push(message)
    });
    return emitted.find((message) => message.requestId === requestId);
  };
}

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

test("defense actions add, edit and remove values through authoritative ship APIs", async () => {
  installDefenseFoundryMock();
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
  installDocumentUpdateMock(actor);
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
  await actions.removeDefenseEntry.call(sheet, null, { dataset: { defenseKind: "immunities", defenseIndex: "0" } });
  assert.deepEqual(actor.flags[M].starship.immunities, []);
});

test("numeric defense deletion follows the current row type and persists through Foundry-style nested merge", async () => {
  installDefenseFoundryMock();
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const actions = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  const actor = makeShip({
    id: "defense-delete-current-row",
    name: "Defense delete current row",
    role: "npc",
    extra: {
      resistances: { fire: 5, "Legacy Resistance": -2 },
      weaknesses: { electricity: 3 },
      skills: { computers: 8, "Legacy Skill": 4 }
    }
  });
  installDocumentUpdateMock(actor);
  const sheet = { document: actor };
  for (const [kind, previousKey, currentKey, rows, expected] of [
    [
      "resistances",
      "fire",
      "cold",
      [
        { key: "cold", value: "5" },
        { key: "Legacy Resistance", value: "-2" }
      ],
      { "Legacy Resistance": -2 }
    ],
    ["weaknesses", "electricity", "sonic", [{ key: "sonic", value: "3" }], {}],
    [
      "skills",
      "computers",
      "piloting",
      [
        { key: "piloting", value: "11" },
        { key: "Legacy Skill", value: "4" }
      ],
      { "Legacy Skill": 4 }
    ]
  ]) {
    actor.flags[M].starship[kind] = Object.fromEntries(rows.map((row) => [row.key, Number(row.value)]));
    const target = {
      dataset: { defenseKind: kind, defenseKey: previousKey },
      closest(selector) {
        assert.equal(selector, "[data-defense-row]");
        return {
          querySelector(field) {
            assert.equal(field, '[data-defense-property="type"]');
            return { value: currentKey };
          }
        };
      }
    };
    await actions.removeDefenseEntry.call(sheet, null, target);
    assert.deepEqual(actor.flags[M].starship[kind], expected, `${kind} deletion removed the wrong entry`);
  }
});

test("numeric defense row replacement is exact and atomic under Foundry-style nested merge", async () => {
  installDefenseFoundryMock();
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const actions = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  const actor = makeShip({
    id: "defense-replace-exact",
    name: "Defense replace exact",
    role: "npc",
    extra: { resistances: { fire: 5, "Legacy Resistance": -2 }, weaknesses: {}, skills: {} }
  });
  installDocumentUpdateMock(actor);
  const sheet = { document: actor };
  const { historyEntries } = await import("../../scripts/history/history.mjs");
  const actorWrites = () => globalThis.__writes.filter((write) => write.doc === actor.uuid).length;
  const writesBefore = actorWrites();
  await actions.saveDefenseRows(sheet, "resistances", [
    { key: "cold", value: "5" },
    { key: "Legacy Resistance", value: "-2" }
  ]);
  assert.deepEqual(actor.flags[M].starship.resistances, { cold: 5, "Legacy Resistance": -2 });
  assert.equal(actorWrites(), writesBefore + 1, "replacement must use one actor update");
  const [replacement] = historyEntries(actor.uuid);
  assert.deepEqual(replacement.flags[M].history.before.resistances, { fire: 5, "Legacy Resistance": -2 });
  assert.deepEqual(replacement.flags[M].history.after.resistances, { cold: 5, "Legacy Resistance": -2 });
  const writesAfterReplacement = actorWrites();
  await actions.saveDefenseRows(sheet, "resistances", []);
  assert.deepEqual(actor.flags[M].starship.resistances, {});
  assert.equal(actorWrites(), writesAfterReplacement + 1, "clearing the map must use one actor update");
  const [cleared] = historyEntries(actor.uuid);
  assert.deepEqual(cleared.flags[M].history.before.resistances, { cold: 5, "Legacy Resistance": -2 });
  assert.deepEqual(cleared.flags[M].history.after.resistances, {});
});

test("numeric defense replacement API rejects non-starships, unauthorized users, invalid kinds and invalid maps", async () => {
  const send = await shipSocketFixture();
  const actor = makeShip({
    id: "defense-replace-validation",
    name: "Defense replace validation",
    role: "npc",
    extra: { resistances: { fire: 5 } }
  });
  const character = makeCharacter({ id: "defense-replace-pc", name: "Not a ship" });
  const notShip = await send("gm", "replaceDefense", { shipUuid: character.uuid, kind: "resistances", map: {} });
  assert.equal(notShip.ok, false);
  assert.match(notShip.error, /notStarship|not a starship/i);
  const denied = await send("p2", "replaceDefense", { shipUuid: actor.uuid, kind: "resistances", map: {} });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /permission/i);
  for (const kind of ["immunities", "customModifiers"]) {
    const reply = await send("gm", "replaceDefense", { shipUuid: actor.uuid, kind, map: {} });
    assert.equal(reply.ok, false, `${kind} must not use numeric map replacement`);
  }
  for (const map of [null, [], { fire: 1.5 }, { fire: "lots" }, JSON.parse('{"__proto__":1}'), { "a.b": 5 }, { "-=fire": 5 }, { "": 5 }]) {
    const reply = await send("gm", "replaceDefense", { shipUuid: actor.uuid, kind: "resistances", map });
    assert.equal(reply.ok, false, `invalid map ${JSON.stringify(map)} must be rejected`);
  }
  assert.deepEqual(actor.flags[M].starship.resistances, { fire: 5 });
  assert.equal(globalThis.__writes.length, 0);
});

test("numeric defense replacement waits for earlier actor writes and removes keys added by them", async () => {
  const send = await shipSocketFixture();
  const actor = makeShip({ id: "defense-replace-queue", name: "Defense replace queue", role: "npc", extra: { resistances: { fire: 5 } } });
  installDocumentUpdateMock(actor);
  const { patchStarship } = await import("../../scripts/starship/starship-state.mjs");
  let entered;
  let release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const earlier = patchStarship(
    actor,
    async (data) => {
      entered();
      await gate;
      data.resistances.fire = 9;
      data.resistances.sonic = 2;
    },
    { history: false }
  );
  await started;
  const replacement = send("gm", "replaceDefense", { shipUuid: actor.uuid, kind: "resistances", map: { cold: 5 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(actor.flags[M].starship.resistances, { fire: 5 }, "the earlier write must still be pending");
  release();
  await earlier;
  const reply = await replacement;
  assert.equal(reply.ok, true);
  assert.equal(reply.result, true);
  assert.deepEqual(actor.flags[M].starship.resistances, { cold: 5 });
});

test("numeric defense deletion API rejects non-starships, unauthorized users, invalid kinds and unsafe keys", async () => {
  const send = await shipSocketFixture();
  const actor = makeShip({
    id: "defense-api-validation",
    name: "Defense API validation",
    role: "npc",
    extra: { resistances: { fire: 5 }, weaknesses: { electricity: 3 }, skills: { computers: 8 } }
  });
  const character = makeCharacter({ id: "defense-api-pc", name: "Not a ship" });
  const notShip = await send("gm", "deleteDefense", { shipUuid: character.uuid, kind: "resistances", key: "fire" });
  assert.equal(notShip.ok, false);
  assert.match(notShip.error, /notStarship|not a starship/i);
  const denied = await send("p2", "deleteDefense", { shipUuid: actor.uuid, kind: "resistances", key: "fire" });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /permission/i);
  for (const kind of ["immunities", "customModifiers"]) {
    const reply = await send("gm", "deleteDefense", { shipUuid: actor.uuid, kind, key: "fire" });
    assert.equal(reply.ok, false, `${kind} must not use numeric map deletion`);
  }
  for (const key of ["", "   ", "__proto__", "constructor", "prototype", "a.b", "-=fire", "==fire", 5, "x".repeat(201)]) {
    const reply = await send("gm", "deleteDefense", { shipUuid: actor.uuid, kind: "resistances", key });
    assert.equal(reply.ok, false, `unsafe key ${JSON.stringify(key)} must be rejected`);
  }
  assert.deepEqual(actor.flags[M].starship.resistances, { fire: 5 });
  assert.deepEqual(actor.flags[M].starship.weaknesses, { electricity: 3 });
  assert.deepEqual(actor.flags[M].starship.skills, { computers: 8 });
  assert.equal(globalThis.__writes.length, 0);
});

test("numeric defense deletion API honors configureShip, records history and ignores missing keys", async () => {
  const send = await shipSocketFixture();
  const actor = makeShip({
    id: "defense-api-history",
    name: "Defense API history",
    role: "npc",
    owners: ["p1"],
    extra: { resistances: { fire: 5, "Legacy Resistance": -2 }, weaknesses: {}, skills: {} }
  });
  installDocumentUpdateMock(actor);
  const { historyEntries } = await import("../../scripts/history/history.mjs");
  const reply = await send("p1", "deleteDefense", { shipUuid: actor.uuid, kind: "resistances", key: "Legacy Resistance" });
  assert.equal(reply.ok, true);
  assert.equal(reply.result, true);
  assert.deepEqual(actor.flags[M].starship.resistances, { fire: 5 });
  const [entry] = historyEntries(actor.uuid);
  assert.deepEqual(entry.flags[M].history.before.resistances, { fire: 5, "Legacy Resistance": -2 });
  assert.deepEqual(entry.flags[M].history.after.resistances, { fire: 5 });
  const writes = globalThis.__writes.length;
  const history = historyEntries(actor.uuid).length;
  const missing = await send("p1", "deleteDefense", { shipUuid: actor.uuid, kind: "resistances", key: "Legacy Resistance" });
  assert.equal(missing.ok, true);
  assert.equal(missing.result, false);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(historyEntries(actor.uuid).length, history);
});

test("numeric defense deletion waits for earlier actor writes and removes the latest queued value", async () => {
  const send = await shipSocketFixture();
  const actor = makeShip({ id: "defense-api-queue", name: "Defense API queue", role: "npc", extra: { resistances: { fire: 5 } } });
  installDocumentUpdateMock(actor);
  const { patchStarship } = await import("../../scripts/starship/starship-state.mjs");
  let entered;
  let release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const earlier = patchStarship(
    actor,
    async (data) => {
      entered();
      await gate;
      data.resistances.fire = 9;
    },
    { history: false }
  );
  await started;
  const deletion = send("gm", "deleteDefense", { shipUuid: actor.uuid, kind: "resistances", key: "fire" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(actor.flags[M].starship.resistances.fire, 5, "the earlier write must still be pending");
  release();
  await earlier;
  const reply = await deletion;
  assert.equal(reply.ok, true);
  assert.equal(reply.result, true);
  assert.deepEqual(actor.flags[M].starship.resistances, {});
});

test("defense actions require configureShip and reject invalid rows without writing", async () => {
  installDefenseFoundryMock();
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
