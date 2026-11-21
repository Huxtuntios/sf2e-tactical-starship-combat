import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat, MockActor, loadContentFromDisk } from "../helpers/foundry-mock.mjs";
import { defaultSensorState } from "../../scripts/engine/sensor-ops.mjs";
import { dropActorOnMap, sensorDragData } from "../../scripts/sensor/actor-drop.mjs";
import { visualTransform } from "../../scripts/sensor/appearance.mjs";
import { weaponSummary } from "../../scripts/ui/weapon-summary.mjs";
import { buildWeaponItemData, weaponEntry } from "../../scripts/content/weapon-docs.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { applySensorOp } from "../../scripts/sensor/map-model.mjs";

const empty = () => defaultSensorState({ enabled: true, zones: 12 });

test("Sensor Map world Actor reuse is a visible world setting enabled by default", async () => {
  installFoundryMock();
  const registrations = new Map();
  game.settings.register = (module, key, config) => {
    if (module === MODULE_ID) registrations.set(key, config);
  };
  const { registerSettings } = await import("../../scripts/settings.mjs");
  registerSettings();
  const option = registrations.get("reuseWorldActorsOnSensorMap");
  assert.ok(option);
  assert.equal(option.scope, "world");
  assert.equal(option.config, true);
  assert.equal(option.type, Boolean);
  assert.equal(option.default, true);
});

for (const role of ["npc", "player"]) {
  test(`copy mode creates independent public ${role} Actors even after the original was reused`, async () => {
    installFoundryMock();
    const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
    const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
    const actor = makeShip({ id: "mode-source", role });
    const before = actor.toObject();
    const combat = makeStarshipCombat();
    const drop = () =>
      sensorUpdate({
        user: game.user,
        payload: { combatId: combat.id, op: "dropActor", actorUuid: actor.uuid, zone: 3, publicActor: true }
      });
    await drop();
    await game.settings.set(MODULE_ID, "reuseWorldActorsOnSensorMap", false);
    await Promise.all([drop(), drop()]);
    assert.equal(game.actors.size, 3);
    const objects = getTsc(combat).objects;
    assert.equal(objects.length, 3);
    assert.equal(objects[0].actorUuid, actor.uuid);
    assert.equal(new Set(objects.map((object) => object.actorUuid)).size, 3);
    const copies = objects.slice(1).map((object) => fromUuidSync(object.actorUuid));
    assert.equal(
      copies.every((copy) => copy.flags[MODULE_ID].tacticalCopyOf === actor.uuid),
      true
    );
    await copies[0].update({ "system.attributes.hp.value": 4 });
    assert.equal(copies[1].system.attributes.hp.value, 30);
    assert.deepEqual(actor.toObject(), before);
    assert.equal(combat.combatants.size, role === "npc" ? 3 : 0);
  });
}

for (const via of ["public-drop", "contact-editor"]) {
  test(`${via} cleans up applied-but-rejected Combatant creation without deleting reused Actors or prior entries`, async () => {
    installFoundryMock();
    const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
    const { addSensorContact } = await import("../../scripts/sensor/contact-service.mjs");
    const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
    const actor = makeShip({ id: "failed-original", role: "npc", owners: ["p1"] });
    const other = makeShip({ id: "unrelated-original", role: "npc" });
    const before = actor.toObject();
    const combat = makeStarshipCombat();
    const [prior] = await combat.createEmbeddedDocuments("Combatant", [
      { actorId: other.id, initiative: 19, flags: { [MODULE_ID]: { sensorMapInitiative: { combatId: combat.id } } } }
    ]);
    const create = combat.createEmbeddedDocuments.bind(combat);
    combat.createEmbeddedDocuments = async (...args) => {
      await create(...args);
      throw new Error("applied creation rejection");
    };
    const operation =
      via === "public-drop"
        ? () =>
            sensorUpdate({
              user: game.user,
              payload: { combatId: combat.id, op: "dropActor", actorUuid: actor.uuid, zone: 2, publicActor: true }
            })
        : () => addSensorContact(combat, { source: "world", uuid: actor.uuid, zone: 2, detection: "identified" });
    await assert.rejects(operation(), /applied creation rejection/);
    assert.deepEqual(getTsc(combat).objects, []);
    assert.equal(combat.combatants.size, 1);
    assert.equal(combat.combatants.get(prior.id), prior);
    assert.equal(game.actors.get(actor.id), actor);
    assert.deepEqual(actor.toObject(), before);
  });
}

test("public drop cannot bypass the private contact lifecycle for a reused world Actor", async () => {
  installFoundryMock();
  const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
  const { addSensorContact } = await import("../../scripts/sensor/contact-service.mjs");
  const { privateContacts, changePrivateContact } = await import("../../scripts/sensor/private-contacts.mjs");
  const { addSensorObjectToInitiative } = await import("../../scripts/sensor/initiative.mjs");
  const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
  const actor = makeShip({ id: "private-original", role: "npc" });
  const combat = makeStarshipCombat();
  const placement = await addSensorContact(combat, { source: "world", uuid: actor.uuid, zone: 3, detection: "hidden" });
  await addSensorObjectToInitiative(combat.id, placement.key);
  const before = getTsc(combat);
  await assert.rejects(
    sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "dropActor", actorUuid: actor.uuid, zone: 5, publicActor: true } })
  );
  assert.deepEqual(getTsc(combat), before);
  assert.equal(privateContacts(combat.id).length, 1);
  await changePrivateContact(combat, placement.key, "reveal");
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(getTsc(combat).objects[0].actorUuid, actor.uuid);
  assert.equal(combat.combatants.size, 1);
});
for (const role of ["npc", "player"]) {
  test(`concurrent public world ${role} drops reuse the original UUID and never create an Actor`, async () => {
    installFoundryMock();
    const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
    const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
    const actor = makeShip({ id: "original-drop", role });
    const before = actor.toObject();
    const combat = makeStarshipCombat();
    const drop = (zone) =>
      sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "dropActor", actorUuid: actor.uuid, zone, publicActor: true } });
    await Promise.all([drop(2), drop(2)]);
    assert.equal(game.actors.size, 1);
    assert.deepEqual(
      globalThis.__writes.filter((write) => write.doc.startsWith("Actor.")),
      []
    );
    assert.equal(getTsc(combat).objects.length, 1);
    assert.equal(getTsc(combat).objects[0].actorUuid, "Actor.original-drop");
    assert.equal(combat.combatants.size, role === "npc" ? 1 : 0);
    assert.equal(await drop(4), "moved");
    assert.equal(getTsc(combat).objects[0].zone, 4);
    assert.deepEqual(actor.toObject(), before);
    await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: actor.uuid } });
    assert.equal(game.actors.get(actor.id), actor);
  });
}
for (const failure of ["reject", "silentVeto", "mapReject"]) {
  test(`public instance removal retains a retryable map reference after ${failure}`, async () => {
    installFoundryMock();
    const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
    const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
    const source = makeShip({ id: "remove-source", role: "npc" });
    const combat = makeStarshipCombat();
    const user = game.users.get("gm");
    const { createSensorActorInstance, ensureSensorActorCombatant } = await import("../../scripts/sensor/actor-instance.mjs");
    const { mutateTsc } = await import("../../scripts/combat/tsc-state.mjs");
    const actor = await createSensorActorInstance(source, combat);
    await mutateTsc(combat, (state) => dropActorOnMap(state, actor, 2, { publicActor: true }).state);
    await ensureSensorActorCombatant(combat, actor);
    const object = getTsc(combat).objects[0];
    const remove = () => sensorUpdate({ user, payload: { combatId: combat.id, op: "remove", key: object.key } });
    const doc = failure === "mapReject" ? combat : actor;
    const method = failure === "mapReject" ? "update" : "delete";
    const original = doc[method].bind(doc);
    doc[method] = async () => {
      if (failure === "silentVeto") return doc;
      throw new Error("injected removal failure");
    };
    await assert.rejects(remove());
    assert.equal(getTsc(combat).objects[0]?.actorUuid, actor.uuid);
    assert.equal(game.actors.get(source.id), source);
    if (failure !== "mapReject") assert.equal(game.actors.get(actor.id), actor);
    doc[method] = original;
    await remove();
    assert.deepEqual(getTsc(combat).objects, []);
    assert.equal(game.actors.has(actor.id), false);
    assert.equal(
      combat.combatants.some((entry) => entry.actorId === actor.id),
      false
    );
    assert.equal(game.actors.get(source.id), source);
  });
}
test("world Actor drop preserves an existing linked-token Combatant and manual initiative", async () => {
  installFoundryMock();
  const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
  const actor = makeShip({ id: "linked-original", role: "npc" });
  const combat = makeStarshipCombat();
  const [entry] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: actor.id, tokenId: "linked-token", initiative: 19, name: "Manual name" }
  ]);
  const before = actor.toObject();
  await sensorUpdate({
    user: game.user,
    payload: { combatId: combat.id, op: "dropActor", actorUuid: actor.uuid, zone: 2, publicActor: true }
  });
  assert.equal(game.actors.size, 1);
  assert.equal(combat.combatants.size, 1);
  assert.equal(combat.combatants.contents[0], entry);
  assert.equal(entry.tokenId, "linked-token");
  assert.equal(entry.initiative, 19);
  assert.equal(entry.name, "Manual name");
  assert.deepEqual(actor.toObject(), before);
  await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: actor.uuid } });
  assert.equal(game.actors.get(actor.id), actor);
  assert.equal(combat.combatants.contents[0], entry);
});

test("initial GM heading is explicit, validated and cannot overwrite a later course", () => {
  const s = { ...empty(), objects: [{ key: "ship", type: "starship", zone: 2, heading: null }] };
  assert.equal(applySensorOp(s, { op: "setHeading", key: "ship", heading: "up" }), s);
  const set = applySensorOp(s, { op: "setHeading", key: "ship", heading: "left" });
  assert.equal(set.objects[0].heading, "left");
  const flipped = applySensorOp(set, { op: "flip", key: "ship" });
  assert.equal(flipped.objects[0].heading, "right");
  assert.equal(applySensorOp(flipped, { op: "setHeading", key: "ship", heading: "left" }), flipped);
});
test("Foundry drag adapter prioritizes the native parser and rejects malformed input", () => {
  installFoundryMock();
  let called = 0;
  foundry.applications.ux = {
    TextEditor: {
      getDragEventData: () => {
        called++;
        return { type: "Actor", uuid: "Actor.x" };
      }
    }
  };
  assert.equal(sensorDragData({}).uuid, "Actor.x");
  assert.equal(called, 1);
  delete foundry.applications.ux;
  assert.deepEqual(sensorDragData({ dataTransfer: { getData: () => '{"tscKey":"Actor.x"}' } }), { tscKey: "Actor.x" });
  assert.equal(sensorDragData({ dataTransfer: { getData: () => "{broken" } }), null);
});
test("world and compendium starships and public hazards use their actual actor data", () => {
  installFoundryMock();
  const ship = makeShip({ id: "ship", name: "Real ship" });
  ship.flags[MODULE_ID].starship.heading = "left";
  const before = structuredClone(ship.flags);
  assert.throws(() => dropActorOnMap(empty(), ship, 3), /disclosureRequired/);
  let s = dropActorOnMap(empty(), ship, 3, { publicActor: true }).state;
  assert.equal(s.objects[0].key, ship.uuid);
  assert.equal(s.objects[0].name, "Real ship");
  assert.equal(s.objects[0].heading, "left");
  assert.equal(s.objects[0].mapTransform.baseDirection, "left");
  assert.equal(visualTransform(s.objects[0].mapTransform, "left", true).auto, false);
  assert.equal(visualTransform(s.objects[0].mapTransform, "right", true).auto, true);
  assert.deepEqual(ship.flags, before);
  const hazard = new MockActor({ id: "hz", name: "Hazard", type: "hazard" });
  assert.throws(() => dropActorOnMap(s, hazard, 5), /disclosureRequired/);
  s = dropActorOnMap(s, hazard, 5, { publicActor: true }).state;
  assert.equal(s.objects[1].type, "hazard");
  assert.equal(s.objects[1].detection.party, "identified");
  assert.equal(s.hazardState[hazard.uuid].placement, "sensor");
  const comp = {
    documentName: "Actor",
    uuid: "Compendium.test.ships.Actor.abc",
    name: "Pack Ship",
    type: "vehicle",
    flags: structuredClone(ship.flags),
    pack: "test.ships"
  };
  s = dropActorOnMap(s, comp, 7, { publicActor: true }).state;
  assert.equal(s.objects[2].actorUuid, comp.uuid);
});
test("duplicate drop moves the existing record without resetting settings; rejected input never changes state", () => {
  installFoundryMock();
  const actor = makeShip({ id: "ship" });
  let s = dropActorOnMap(empty(), actor, 3, { publicActor: true }).state;
  s.objects[0].mapTransform = { rotation: 45, flipX: true, baseDirection: "left" };
  s.objects[0].hidden = true;
  const same = dropActorOnMap(s, actor, 3);
  assert.equal(same.result, "unchanged");
  assert.equal(same.state, s);
  const moved = dropActorOnMap(s, actor, 6);
  assert.equal(moved.result, "moved");
  assert.equal(moved.state.objects.length, 1);
  assert.deepEqual(moved.state.objects[0].mapTransform, s.objects[0].mapTransform);
  assert.equal(moved.state.objects[0].hidden, true);
  for (const zone of [0, 13, 1.5, NaN, "1"]) assert.throws(() => dropActorOnMap(s, actor, zone, { publicActor: true }), /invalidZone/);
  assert.throws(() => dropActorOnMap(s, new MockActor({ type: "character" }), 2, { publicActor: true }), /unsupportedActor/);
  assert.throws(() => dropActorOnMap(s, { documentName: "Item", uuid: "Item.x", name: "fake" }, 2, { publicActor: true }), /invalidActor/);
  const duplicate = { ...s, objects: [...s.objects, { ...s.objects[0] }] };
  assert.throws(() => dropActorOnMap(duplicate, actor, 2), /duplicateActors/);
});
test("GM-authoritative drop validates sender, UUID and zone; repeated placement references the same Actor", async () => {
  installFoundryMock();
  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
  const ship = makeShip({ id: "ship", name: "Actual", role: "npc" });
  ship.items.set("weapon", {
    _id: "weapon",
    name: "Source weapon",
    type: "melee",
    system: { charges: { value: 2 } }
  });
  const combat = makeStarshipCombat();
  registerSensorHandlers();
  const responses = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (r) => responses.push(r) };
  const send = (id, user, extra) =>
    dispatchSocketMessage(
      {
        kind: "request",
        type: "sensorUpdate",
        requestId: id,
        userId: user,
        payload: { combatId: combat.id, op: "dropActor", actorUuid: ship.uuid, zone: 4, publicActor: true, ...extra }
      },
      user,
      env
    );
  const start = globalThis.__writes.length;
  await send("player", "p1", {});
  await send("missing", "gm", { actorUuid: "Actor.missing" });
  await send("badzone", "gm", { zone: 22 });
  assert.equal(globalThis.__writes.length, start);
  assert.equal(
    responses.every((r) => !r.ok),
    true
  );
  await Promise.all([send("one", "gm", { name: "Fake", type: "hazard" }), send("two", "gm", {})]);
  const t = getTsc(combat);
  assert.equal(t.objects.length, 1);
  assert.equal(t.objects[0].name, "Actual");
  assert.equal(t.objects[0].type, "starship");
  assert.equal(t.objects[0].actorUuid, ship.uuid);
  assert.equal(game.actors.size, 1);
  assert.equal(combat.combatants.filter((c) => c.actorId === ship.id).length, 1);
  const reused = fromUuidSync(t.objects[0].actorUuid);
  assert.equal(reused, ship);
  await ship.update({ "system.attributes.hp.value": 4 });
  assert.equal(reused.system.attributes.hp.value, 4);
  ship.items.get("weapon").system.charges.value = 0;
  assert.equal(reused.items.get("weapon").system.charges.value, 0);
  assert.equal(responses.find((r) => r.requestId === "one").result, "added");
  assert.equal(responses.find((r) => r.requestId === "two").result, "unchanged");
});
test("dropping an Actor already on the public map moves its existing record without copying", async () => {
  installFoundryMock();
  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
  const ship = makeShip({ id: "legacy-map-ship", name: "Existing NPC", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [{ key: ship.uuid, actorUuid: ship.uuid, type: "starship", name: ship.name, zone: 2 }]
  });
  registerSensorHandlers();
  const replies = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (r) => replies.push(r) };
  await dispatchSocketMessage(
    {
      kind: "request",
      type: "sensorUpdate",
      requestId: "move-existing",
      userId: "gm",
      payload: { combatId: combat.id, op: "dropActor", actorUuid: ship.uuid, zone: 7, publicActor: false }
    },
    "gm",
    env
  );
  assert.equal(replies[0].ok, true);
  assert.equal(replies[0].result, "moved");
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(getTsc(combat).objects[0].actorUuid, ship.uuid);
  assert.equal(getTsc(combat).objects[0].zone, 7);
  assert.equal(game.actors.size, 1);
  assert.equal(combat.combatants.size, 0);
});
test("initial heading is GM-authoritative and stale requests do not overwrite it (mock)", async () => {
  installFoundryMock();
  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { getTsc, mutateTsc } = await import("../../scripts/combat/tsc-state.mjs");
  const ship = makeShip({ id: "heading" });
  const combat = makeStarshipCombat();
  await mutateTsc(combat, (s) => ({ ...s, objects: [{ key: ship.uuid, actorUuid: ship.uuid, type: "starship", zone: 1, heading: null }] }));
  registerSensorHandlers();
  const replies = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (r) => replies.push(r) };
  const send = (id, user, heading) =>
    dispatchSocketMessage(
      {
        kind: "request",
        type: "sensorUpdate",
        requestId: id,
        userId: user,
        payload: { combatId: combat.id, op: "setHeading", key: ship.uuid, heading }
      },
      user,
      env
    );
  await send("player", "p1", "left");
  assert.equal(replies[0].ok, false);
  assert.equal(getTsc(combat).objects[0].heading, null);
  await send("gm", "gm", "left");
  assert.equal(getTsc(combat).objects[0].heading, "left");
  assert.equal(ship.flags[MODULE_ID].starship.heading, "left");
  const writes = globalThis.__writes.length;
  await send("stale", "gm", "right");
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(getTsc(combat).objects[0].heading, "left");
});
test("all shipped compendium categories match catalogue and rank is never guessed", async () => {
  installFoundryMock();
  const content = await loadContentFromDisk();
  for (const w of content.weapons.values()) {
    const pack = buildWeaponItemData(w);
    const fromPack = weaponSummary(pack);
    const installed = weaponSummary({ id: "installed", weaponRef: w.id, name: w.name });
    assert.equal(pack.system.category, w.category);
    assert.equal(fromPack.category, installed.category);
    assert.equal(installed.hasCategory, true);
    assert.equal(installed.hasRank, false);
    assert.doesNotMatch(installed.option, /undefined|\[object Object\]|Not specified.*Weapon category/);
  }
  const custom = weaponSummary({ name: "Custom", requiredProficiency: "expert", category: "simple" });
  assert.equal(custom.rank, "Expert");
  assert.match(custom.proficiencyText, /Expert/);
  assert.match(custom.proficiencyText, /Simple/);
  assert.equal(weaponEntry({ id: "custom", name: "Custom", requiredProficiency: "expert" }, "x").requiredProficiency, "expert");
  assert.equal(weaponSummary({ name: "Legacy", category: { bad: true } }).hasCategory, false);
});

test("compendium Actor UUID is resolved by GM and copied into an independent world Actor (mock)", async () => {
  installFoundryMock();
  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
  const combat = makeStarshipCombat();
  const uuid = "Compendium.test.hazards.Actor.h1";
  const hazard = {
    uuid,
    documentName: "Actor",
    type: "hazard",
    name: "Actual hazard",
    img: "hazard.webp",
    pack: "test.hazards",
    system: {},
    flags: {},
    toObject: () => ({ _id: "h1", name: "Actual hazard", type: "hazard", img: "hazard.webp", system: {}, flags: {} })
  };
  globalThis.__extraUuids.set(uuid, hazard);
  registerSensorHandlers();
  const replies = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (r) => replies.push(r) };
  const msg = (id, publicActor) => ({
    kind: "request",
    type: "sensorUpdate",
    requestId: id,
    payload: { combatId: combat.id, op: "dropActor", actorUuid: uuid, zone: 8, publicActor }
  });
  const before = JSON.stringify(hazard);
  await dispatchSocketMessage(msg("no", false), "gm", env);
  assert.equal(replies[0].ok, false);
  assert.equal(getTsc(combat).objects.length, 0);
  await dispatchSocketMessage(msg("yes", true), "gm", env);
  assert.equal(replies[1].ok, true);
  const actorUuid = getTsc(combat).objects[0].actorUuid;
  assert.notEqual(actorUuid, uuid);
  const instance = fromUuidSync(actorUuid);
  assert.equal(instance.flags[MODULE_ID].tacticalCopyOf, uuid);
  assert.equal(instance.flags[MODULE_ID].contactImport.sourceUuid, uuid);
  assert.equal(JSON.stringify(hazard), before);
  assert.equal(game.actors.size, 1);
});
test("missing heading defaults the art to right-facing; no course means no automatic flip", () => {
  installFoundryMock();
  const ship = makeShip({ id: "unknown" });
  delete ship.flags[MODULE_ID].starship.heading;
  const o = dropActorOnMap(empty(), ship, 1, { publicActor: true }).state.objects[0];
  assert.equal(o.heading, null);
  assert.equal(o.mapTransform.baseDirection, "right");
  assert.equal(visualTransform(o.mapTransform, o.heading, true).auto, false);
  assert.equal(visualTransform(o.mapTransform, "left", true).auto, true);
  assert.equal(visualTransform(o.mapTransform, "right", true).auto, false);
  assert.equal(visualTransform({ ...o.mapTransform, flipX: true }, "left", true).scaleX, 1);
});
