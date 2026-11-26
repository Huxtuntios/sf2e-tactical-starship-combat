import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  installFoundryMock,
  loadContentFromDisk,
  makeCharacter,
  makeShip,
  makeStarshipCombat,
  MockActor,
  dice
} from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { addSensorContact } from "../../scripts/sensor/contact-service.mjs";
import { privateContacts, changePrivateContact } from "../../scripts/sensor/private-contacts.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { loadStarship, readStarship } from "../../scripts/starship/starship-state.mjs";
import { patchStarship } from "../../scripts/starship/starship-state.mjs";
import { executeAction } from "../../scripts/actions/action-engine.mjs";
import { addSensorObjectToInitiative } from "../../scripts/sensor/initiative.mjs";
import { sensorUpdate } from "../../scripts/sensor/map-handlers.mjs";
import { HazardEngine, placeHazard } from "../../scripts/hazards/hazard-engine.mjs";
import { deleteMapObjectSource, mapObjectSources } from "../../scripts/sensor/map-object.mjs";
import { ensurePrivateStore } from "../../scripts/sensor/private-store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const setup = () => {
  installFoundryMock();
  return makeStarshipCombat();
};
const ship = (id, { role = "npc", owners = [], name = id } = {}) => makeShip({ id, name, role, owners, sp: 12, hp: 24 });
const hazard = (id, extra = {}) => {
  const actor = new MockActor({
    id,
    name: id,
    type: "hazard",
    system: { details: { isComplex: true }, attributes: { hp: { value: 20, max: 20 }, hasHealth: true } },
    ...extra
  });
  game.actors.set(actor.id, actor);
  return actor;
};

class FoundryForcedDeletion {}
class FoundryForcedReplacement {
  constructor(value) {
    this.value = value;
  }
  static get(operator) {
    return operator.value;
  }
}
const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function mergeDocumentObject(current, patch) {
  const merged = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof FoundryForcedDeletion) delete merged[key];
    else if (value instanceof FoundryForcedReplacement) merged[key] = structuredClone(FoundryForcedReplacement.get(value));
    else if (isPlainObject(value)) merged[key] = mergeDocumentObject(isPlainObject(merged[key]) ? merged[key] : {}, value);
    else merged[key] = structuredClone(value);
  }
  return merged;
}
function installFoundryJournalUpdateMock(journal, { injectGMOwner = false, dropUndefined = false } = {}) {
  foundry.data = {
    ...foundry.data,
    operators: { ...foundry.data?.operators, ForcedDeletion: FoundryForcedDeletion, ForcedReplacement: FoundryForcedReplacement }
  };
  journal.update = async (changes) => {
    const expanded = {};
    for (const [path, value] of Object.entries(changes)) {
      const parts = path.split(".");
      let target = expanded;
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = value;
    }
    const merged = mergeDocumentObject({ flags: journal.flags }, expanded);
    if (injectGMOwner) {
      const gm = game.users.activeGM;
      const sources = merged.flags?.[MODULE_ID]?.privateSensor?.mapObjects ?? {};
      for (const record of Object.values(sources)) if (record?.data?.ownership) record.data.ownership[gm.id] = 3;
    }
    journal.flags = dropUndefined ? JSON.parse(JSON.stringify(merged.flags)) : merged.flags;
    globalThis.__writes.push({ doc: `JournalEntry.${journal.id}`, changes: structuredClone(changes) });
    Hooks.callAll("updateJournalEntry", journal, changes);
    return journal;
  };
}

async function dropHandler(combat, source, { confirm = async () => true } = {}) {
  const { wireSensorMapDragDrop } = await import("../../scripts/ui/sensor-drop-ui.mjs");
  const handlers = {};
  const warnings = [];
  const zone = {
    dataset: { zone: "2" },
    classList: { add() {}, remove() {} },
    addEventListener: (name, handler) => (handlers[name] = handler)
  };
  const element = { querySelectorAll: (selector) => (selector.startsWith(".tsc-zone") ? [zone] : []) };
  wireSensorMapDragDrop(
    element,
    { combatId: combat.id, movableKeys: getTsc(combat).objects.map((object) => object.key) },
    {
      resolve: async () => source,
      confirm,
      send: async () => {},
      warn: (key, data) => warnings.push({ key, data }),
      info: () => {}
    }
  );
  return {
    warnings,
    zone,
    drop: (payload = { type: "Actor", uuid: source.uuid }) =>
      handlers.drop({ preventDefault() {}, dataTransfer: { getData: () => JSON.stringify(payload) } })
  };
}

test("repeated visible world drops create independent map-only records without Actor documents", async () => {
  const combat = setup();
  const source = ship("visible-source", { owners: ["p1"] });
  const before = source.toObject();

  const first = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });
  const second = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 5,
    detection: "identified"
  });

  assert.notEqual(first.key, second.key);
  assert.equal(first.actorUuid, first.key);
  assert.equal(second.actorUuid, second.key);
  assert.deepEqual(
    getTsc(combat).objects.map((object) => [object.key, object.actorUuid, object.mapOnly, object.zone]),
    [
      [first.key, first.key, true, 2],
      [second.key, second.key, true, 5]
    ]
  );
  assert.equal(game.actors.size, 1);
  assert.deepEqual(
    globalThis.__writes.filter((write) => write.doc.startsWith("Actor.")),
    []
  );
  assert.deepEqual(source.toObject(), before);
  const publicMap = JSON.stringify(getTsc(combat));
  assert.equal(publicMap.includes(source.uuid), false);
  assert.equal(publicMap.includes("sourceUuid"), false);
  assert.equal(publicMap.includes("sensorContactInstance"), false);
});

test("repeated private world drops retain separate GM-private map snapshots", async () => {
  const combat = setup();
  const source = ship("private-source");
  const before = source.toObject();
  const spec = { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" };

  const first = await addSensorContact(combat, spec);
  const second = await addSensorContact(combat, { ...spec, zone: 6 });

  assert.notEqual(first.key, second.key);
  const contacts = privateContacts(combat.id);
  assert.equal(contacts.length, 2);
  assert.deepEqual(
    contacts.map((contact) => [contact.key, contact.actorUuid, contact.mapOnly, contact.zone]),
    [
      [first.key, first.key, true, 3],
      [second.key, second.key, true, 6]
    ]
  );
  assert.equal(game.actors.size, 1);
  assert.deepEqual(source.toObject(), before);
  assert.equal(JSON.stringify(getTsc(combat)).includes(source.name), false);
  assert.equal(JSON.stringify(getTsc(combat)).includes(source.uuid), false);
  assert.equal((await loadStarship(first.key)).uuid, first.key);
  assert.equal((await loadStarship(second.key)).uuid, second.key);
});

test("map-only configuration, heading and vitals edits stay isolated per record and from the source", async () => {
  const combat = setup();
  const source = ship("edit-source", { owners: ["p1"] });
  const before = source.toObject();
  const first = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });
  const second = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 4,
    detection: "identified"
  });

  await sensorUpdate({
    user: game.user,
    payload: {
      combatId: combat.id,
      op: "objectVisual",
      key: first.key,
      visual: { transform: { rotation: 37, flipX: true }, art: "first.webp", autoMirrorOverride: true }
    }
  });
  await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "flip", key: first.key } });
  const firstActor = await loadStarship(first.key);
  await patchStarship(firstActor, (data) => {
    data.hp.value = 5;
    data.sp.value = 2;
  });

  const [firstObject, secondObject] = getTsc(combat).objects;
  assert.equal(firstObject.mapTransform.rotation, 37);
  assert.equal(firstObject.mapTransform.flipX, true);
  assert.equal(firstObject.art, "first.webp");
  assert.equal(firstObject.autoMirrorOverride, true);
  assert.equal(firstObject.heading, "left");
  assert.equal(secondObject.heading, "right");
  assert.notEqual(secondObject.mapTransform.rotation, 37);
  assert.equal(secondObject.art, undefined);
  assert.equal(readStarship(await loadStarship(second.key)).hp.value, 24);
  assert.equal(readStarship(await loadStarship(second.key)).sp.value, 12);
  assert.equal(readStarship(firstActor).hp.value, 5);
  assert.equal(readStarship(firstActor).sp.value, 2);
  assert.deepEqual(source.toObject(), before);
});

test("dragging a selected map-only record moves only that record", async () => {
  const combat = setup();
  const source = ship("drag-source", { owners: ["p1"] });
  const first = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "identified" });
  const second = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 4, detection: "identified" });
  const { wireSensorMapDragDrop } = await import("../../scripts/ui/sensor-drop-ui.mjs");
  const handlers = {};
  const zone = {
    dataset: { zone: "7" },
    classList: { add() {}, remove() {} },
    addEventListener: (name, handler) => (handlers[name] = handler)
  };
  const element = { querySelectorAll: (selector) => (selector.startsWith(".tsc-zone") ? [zone] : []) };
  wireSensorMapDragDrop(
    element,
    { combatId: combat.id, movableKeys: [first.key, second.key] },
    {
      send: (_type, payload) => sensorUpdate({ user: game.user, payload })
    }
  );

  await handlers.drop({
    preventDefault() {},
    dataTransfer: { getData: () => JSON.stringify({ tscKey: second.key }) }
  });

  assert.deepEqual(
    getTsc(combat).objects.map((object) => [object.key, object.zone]),
    [
      [first.key, 2],
      [second.key, 7]
    ]
  );
  assert.equal(game.actors.size, 1);
});

test("private map-only initiative and reveal preserve the map identity without an Actor", async () => {
  const combat = setup();
  const source = ship("reveal-source");
  const before = source.toObject();
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "undetected"
  });

  assert.equal((await addSensorObjectToInitiative(combat.id, placement.key)).status, "added");
  const [combatant] = combat.combatants.contents;
  assert.equal(combatant.actorId, null);
  assert.equal(combatant.flags[MODULE_ID].sensorMapObject.key, placement.key);
  assert.equal(combatant.hidden, true);

  await changePrivateContact(combat, placement.key, "reveal");

  const [object] = getTsc(combat).objects;
  assert.equal(object.key, placement.key);
  assert.equal(object.actorUuid, placement.key);
  assert.equal(object.mapOnly, true);
  assert.equal(object.detection.party, "identified");
  assert.equal(privateContacts(combat.id).length, 0);
  assert.equal(combat.combatants.size, 1);
  assert.equal(combat.combatants.contents[0].id, combatant.id);
  assert.equal(combatant.hidden, false);
  assert.equal(game.actors.size, 1);
  assert.deepEqual(source.toObject(), before);
  assert.equal(JSON.stringify(getTsc(combat)).includes(source.uuid), false);
});

test("a non-first document from the real starship LevelDB pack drops through the UI as an independent map object", async () => {
  const combat = setup();
  const { extractPack } = await import("@foundryvtt/foundryvtt-cli");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tsc-map-only-046-"));
  try {
    const out = path.join(temp, "starships");
    await extractPack(path.join(root, "packs/starships"), out, { log: false });
    const actors = fs
      .readdirSync(out, { recursive: true })
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(fs.readFileSync(path.join(out, file), "utf8")))
      .filter((doc) => doc._key?.startsWith("!actors!") && doc.flags?.[MODULE_ID]?.starship?.isStarship);
    assert.ok(actors.length > 1, "the real pack must contain multiple starship Actors");
    const data = actors[1];
    const uuid = `Compendium.${MODULE_ID}.starships.Actor.${data._id}`;
    const source = {
      ...structuredClone(data),
      documentName: "Actor",
      uuid,
      pack: `${MODULE_ID}.starships`,
      isToken: false,
      toObject: () => structuredClone(data),
      testUserPermission: (user, level) => {
        if (user?.isGM) return true;
        const granted = data.ownership?.[user?.id] ?? data.ownership?.default ?? 0;
        return granted >= ({ LIMITED: 1, OBSERVER: 2, OWNER: 3 }[level] ?? 0);
      }
    };
    globalThis.__extraUuids.set(uuid, source);
    const original = JSON.stringify(data);
    const handler = await dropHandler(combat, source, {
      confirm: async () => {
        throw new Error("a private compendium NPC must not request public disclosure");
      }
    });

    await handler.drop();
    handler.zone.dataset.zone = "6";
    await handler.drop();

    assert.deepEqual(handler.warnings, []);
    const contacts = privateContacts(combat.id);
    assert.equal(contacts.length, 2);
    assert.equal(new Set(contacts.map((contact) => contact.key)).size, 2);
    assert.equal(
      contacts.every((contact) => contact.mapOnly && contact.actorUuid === contact.key),
      true
    );
    assert.equal(game.actors.size, 0);
    assert.equal(globalThis.__writes.filter((write) => write.doc.startsWith("Actor.") && write.create).length, 0);
    assert.equal(JSON.stringify(data), original);
    assert.equal(JSON.stringify(getTsc(combat)).includes(uuid), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("legacy Actor-backed map records keep resolving while new placements remain map-only", async () => {
  installFoundryMock();
  const source = ship("legacy-source", { owners: ["p1"] });
  const combat = makeStarshipCombat({
    objects: [{ key: source.uuid, actorUuid: source.uuid, type: "starship", name: source.name, zone: 2 }]
  });
  const before = source.toObject();

  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 5,
    detection: "identified"
  });

  assert.equal(await loadStarship(source.uuid), source);
  const objects = getTsc(combat).objects;
  assert.equal(objects.length, 2);
  assert.equal(objects[0].actorUuid, source.uuid);
  assert.equal(objects[0].mapOnly, undefined);
  assert.equal(objects[1].key, placement.key);
  assert.equal(objects[1].mapOnly, true);
  assert.deepEqual(source.toObject(), before);
});

test("missing and non-GM sources are rejected, while a placed snapshot survives source deletion", async () => {
  const combat = setup();
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: "Actor.missing", zone: 2, detection: "hidden" }));
  assert.equal(game.journal.size, 0);
  const source = ship("deleted-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const journalBefore = structuredClone(game.journal.contents[0].flags);
  game.user = game.users.get("p1");
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 4, detection: "hidden" }));
  assert.deepEqual(game.journal.contents[0].flags, journalBefore);
  game.user = game.users.get("gm");

  await source.delete();
  const snapshot = await loadStarship(placement.key);
  assert.equal(snapshot.mapOnly, true);
  await patchStarship(snapshot, (data) => {
    data.hp.value = 7;
  });
  assert.equal(readStarship(await loadStarship(placement.key)).hp.value, 7);
  assert.equal(game.actors.size, 0);
});

test("an unsafe private store blocks map snapshots but not unrelated world Actors", async () => {
  const combat = setup();
  const source = ship("store-boundary-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  game.journal.contents[0].ownership.p1 = 1;

  assert.equal(await loadStarship(source.uuid), source);
  await assert.rejects(loadStarship(placement.key), /invalid|unsafe|permissions/i);
  assert.equal(game.actors.get(source.id), source);
});

test("a stale map snapshot cannot recreate its deleted private source", async () => {
  const combat = setup();
  const source = ship("stale-snapshot-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const stale = await loadStarship(placement.key);
  await changePrivateContact(combat, placement.key, "remove");

  await assert.rejects(stale.update({ "system.attributes.hp.value": 1 }), /invalid|store|missing/i);
  assert.equal(mapObjectSources(combat.id)[placement.key], undefined);
  await assert.rejects(loadStarship(placement.key));
  assert.equal(game.actors.get(source.id), source);
});

test("Foundry GM ownership normalization permits public snapshot persistence without losing player ownership", async () => {
  const combat = setup();
  const source = ship("gm-owner-public-source", { owners: ["p1"] });
  await ensurePrivateStore(combat.id);
  installFoundryJournalUpdateMock(game.journal.contents[0], { injectGMOwner: true });
  const gmId = game.users.activeGM.id;

  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });

  const stored = mapObjectSources(combat.id)[placement.key];
  assert.equal(stored.data.ownership.default, 0);
  assert.equal(stored.data.ownership.p1, 3);
  assert.equal(stored.data.ownership[gmId], 3);
  assert.equal(game.actors.size, 1);
  assert.equal(getTsc(combat).objects[0].mapOnly, true);
  const actor = await loadStarship(placement.key);
  await actor.update({ "system.attributes.hp.value": 7 });
  const updated = mapObjectSources(combat.id)[placement.key];
  assert.equal(updated.data.system.attributes.hp.value, 7);
  assert.equal(updated.data.ownership.p1, 3);
  assert.equal(updated.data.ownership[gmId], 3);
});

test("Foundry GM ownership normalization permits private hazard snapshot persistence without player access", async () => {
  const combat = setup();
  const source = hazard("gm-owner-private-hazard", { ownership: { default: 0 } });
  await ensurePrivateStore(combat.id);
  installFoundryJournalUpdateMock(game.journal.contents[0], { injectGMOwner: true });
  const gmId = game.users.activeGM.id;

  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "hidden"
  });

  const stored = mapObjectSources(combat.id)[placement.key];
  assert.equal(stored.data.ownership.default, 0);
  assert.equal(stored.data.ownership[gmId], 3);
  assert.equal(stored.data.ownership.p1, undefined);
  assert.equal(privateContacts(combat.id)[0].mapOnly, true);
  assert.equal(game.actors.size, 1);
  const [projection] = getTsc(combat).objects;
  assert.equal(projection.tscPrivateProjection, true);
  assert.equal(JSON.stringify(projection).includes(source.uuid), false);
  assert.equal(JSON.stringify(projection).includes(source.name), false);
});

test("JSON persistence drops undefined embedded Item fields without failing exact snapshot readback", async () => {
  const combat = setup();
  const source = hazard("undefined-item-hazard");
  source.items.set("toggle-item", {
    _id: "toggle-item",
    name: "Toggle item",
    type: "item",
    system: {
      toggles: undefined,
      deathNote: undefined,
      frequency: undefined,
      selfEffect: undefined,
      enabled: true,
      nested: { value: 1, absent: undefined }
    }
  });
  await ensurePrivateStore(combat.id);
  installFoundryJournalUpdateMock(game.journal.contents[0], { injectGMOwner: true, dropUndefined: true });

  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "hidden"
  });

  const stored = mapObjectSources(combat.id)[placement.key];
  const item = stored.data.items.find((entry) => entry._id === "toggle-item");
  assert.equal(Object.hasOwn(item.system, "toggles"), false);
  assert.equal(Object.hasOwn(item.system, "deathNote"), false);
  assert.equal(Object.hasOwn(item.system, "frequency"), false);
  assert.equal(Object.hasOwn(item.system, "selfEffect"), false);
  assert.equal(item.system.enabled, true);
  assert.deepEqual(item.system.nested, { value: 1 });
  assert.equal(Object.keys(mapObjectSources(combat.id)).length, 1);
  assert.equal(game.actors.size, 1);
});

test("Foundry merge semantics delete exactly one mapObjects key and preserve the other snapshots", async () => {
  const combat = setup();
  const source = ship("merge-delete-source");
  const first = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const second = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 4, detection: "hidden" });
  const journal = game.journal.contents[0];
  installFoundryJournalUpdateMock(journal, { injectGMOwner: true });

  await deleteMapObjectSource(combat.id, first.key);

  const sources = mapObjectSources(combat.id);
  assert.equal(sources[first.key], undefined);
  assert.equal(sources[second.key].key, second.key);
  assert.deepEqual(Object.keys(journal.flags[MODULE_ID].privateSensor.mapObjects), [second.key]);
});

test("Foundry merge semantics replace one snapshot record exactly without retaining removed nested fields", async () => {
  const combat = setup();
  const source = ship("merge-replace-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const actor = await loadStarship(placement.key);
  await actor.update({ "system.attributes.obsolete": { nested: true } });
  installFoundryJournalUpdateMock(game.journal.contents[0], { injectGMOwner: true });
  const replacement = { attributes: { hp: { value: 9, max: 9 } } };

  await actor.update({ system: new FoundryForcedReplacement(replacement) });

  const stored = mapObjectSources(combat.id)[placement.key].data.system;
  assert.deepEqual(stored, replacement);
  assert.equal(Object.hasOwn(stored, "value"), false);
  assert.equal(Object.hasOwn(stored.attributes, "obsolete"), false);
});

test("MapObjectActor honors dotted ForcedDeletion and ForcedReplacement without storing operator objects", async () => {
  const combat = setup();
  const source = ship("operator-source");
  source.flags[MODULE_ID].starship.resistances = { fire: 5, cold: 7 };
  source.flags[MODULE_ID].starship.skills = { old: { base: 2 }, computers: { base: 3 } };
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const actor = await loadStarship(placement.key);
  installFoundryJournalUpdateMock(game.journal.contents[0]);
  const prefix = `flags.${MODULE_ID}.starship`;

  await actor.update({ [`${prefix}.resistances.fire`]: new FoundryForcedDeletion() });
  await actor.update({ [`${prefix}.skills`]: new FoundryForcedReplacement({ computers: { base: 4 } }) });

  const stored = mapObjectSources(combat.id)[placement.key].data.flags[MODULE_ID].starship;
  assert.deepEqual(stored.resistances, { cold: 7 });
  assert.deepEqual(stored.skills, { computers: { base: 4 } });
  assert.equal(Object.hasOwn(stored.resistances, "value"), false);
  assert.equal(Object.hasOwn(stored.skills, "value"), false);
});

test("failed map-only removal retains a retryable map record, snapshot and Combatant", async () => {
  const combat = setup();
  const source = ship("retry-remove-source");
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified",
    publicActor: true
  });
  const before = structuredClone(getTsc(combat));
  const update = combat.update.bind(combat);
  combat.update = async () => {
    throw new Error("injected map removal failure");
  };

  await assert.rejects(
    sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: placement.key } }),
    /injected map removal failure/
  );

  assert.deepEqual(getTsc(combat), before);
  assert.equal((await loadStarship(placement.key)).mapOnly, true);
  assert.equal(
    combat.combatants.contents.some((entry) => entry.flags[MODULE_ID].sensorMapObject?.key === placement.key),
    true
  );
  combat.update = update;
  await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: placement.key } });
  assert.deepEqual(getTsc(combat).objects, []);
  assert.equal(combat.combatants.size, 0);
  await assert.rejects(loadStarship(placement.key));
  assert.equal(game.actors.get(source.id), source);
});

test("map-only starship targets participate in action validation and damage without mutating the source", async () => {
  const combat = setup();
  await loadContentFromDisk();
  const crew = makeCharacter({ id: "map-gunner", owners: ["p1"] });
  const attacker = makeShip({
    id: "map-attacker",
    role: "player",
    owners: ["p1"],
    stations: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: crew.uuid, weaponId: "w" }],
    weapons: [{ id: "w", weaponRef: "coilgun", name: "Coilgun" }],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "g" }]
  });
  const source = ship("map-target", { owners: ["p1"] });
  const sourceBefore = source.toObject();
  const target = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "identified"
  });
  combat.flags[MODULE_ID].tsc.objects.push({
    key: attacker.uuid,
    actorUuid: attacker.uuid,
    type: "starship",
    name: attacker.name,
    zone: 2,
    heading: "right",
    detection: { party: "identified" }
  });
  const request = {
    shipUuid: attacker.uuid,
    crewUuid: crew.uuid,
    actionId: "strike",
    stationId: "g",
    user: game.users.get("p1"),
    options: { targetKey: target.key, weaponId: "w", skipDialog: true }
  };

  const dry = await executeAction({ ...request, dryRun: true, validateTarget: true });
  assert.equal(dry.ctx.target.key, target.key);
  assert.equal(dry.ctx.target.actor.mapOnly, true);
  const before = readStarship(await loadStarship(target.key)).sp.value;
  dice(20, 6);
  const result = await executeAction(request);
  assert.equal(result.ok, true);
  assert.ok(readStarship(await loadStarship(target.key)).sp.value < before);
  assert.deepEqual(source.toObject(), sourceBefore);
});

test("map-only complex hazards use their own snapshot state and zone during automation", async () => {
  const combat = setup();
  const source = hazard("map-hazard", {
    flags: {
      [MODULE_ID]: {
        starshipHazard: {
          isStarshipHazard: true,
          isComplex: true,
          effectText: "1d6 fire damage",
          routine: { cost: "1 action", text: "1d6 fire damage" }
        }
      }
    }
  });
  const target = ship("hazard-target", { role: "player", owners: ["p1"] });
  combat.flags[MODULE_ID].tsc.objects.push({
    key: target.uuid,
    actorUuid: target.uuid,
    type: "starship",
    name: target.name,
    zone: 3,
    heading: "right",
    detection: { party: "identified" }
  });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "identified",
    publicActor: true
  });
  const before = target.flags[MODULE_ID].starship.sp.value;
  dice(6, 1);

  const result = await HazardEngine.trigger(placement.key);

  assert.equal(result.applied, true);
  assert.equal(result.targets, 1);
  assert.ok(target.flags[MODULE_ID].starship.sp.value < before);
  assert.equal(source.system.attributes.hp.value, 20);
  assert.equal(game.actors.size, 2);
});

test("map-only hazard placement preserves span, level, stealth, icon and hazard placement metadata", async () => {
  const combat = setup();
  const source = hazard("placed-hazard", {
    system: { details: { level: { value: 4 }, isComplex: false } },
    flags: { [MODULE_ID]: { starshipHazard: { stealthDC: 13 } } }
  });
  const before = source.toObject();

  await placeHazard(source, { zone: 3, span: 2, map: "both", detection: "identified", publicActor: true });

  const [object] = getTsc(combat).objects;
  assert.equal(object.mapOnly, true);
  assert.equal(object.span, 2);
  assert.equal(object.level, 4);
  assert.equal(object.stealthDC, 13);
  assert.equal(object.icon, "⚠");
  assert.deepEqual(getTsc(combat).hazardState[object.key], { disabled: false, placement: "both" });
  assert.deepEqual(source.toObject(), before);
  assert.equal(game.actors.size, 1);
});
