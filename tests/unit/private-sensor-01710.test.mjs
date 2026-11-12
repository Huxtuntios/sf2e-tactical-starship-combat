import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { addPrivateContact, addPrivateCustom, privateContacts, changePrivateContact } from "../../scripts/sensor/private-contacts.mjs";
import { addSensorContact } from "../../scripts/sensor/contact-service.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { viewFor } from "../../scripts/engine/sensor-ops.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { sensorUpdate } from "../../scripts/sensor/map-handlers.mjs";
import { deleteSensorActorInstance } from "../../scripts/sensor/actor-instance.mjs";
import { addSensorObjectToInitiative } from "../../scripts/sensor/initiative.mjs";
import { T } from "../../scripts/utils/foundry.mjs";

function setup() {
  const ctx = installFoundryMock();
  const enemy = makeShip({ id: "secret", name: "Hidden dreadnought", role: "npc" });
  const combat = makeStarshipCombat();
  return { ctx, enemy, combat };
}
test("new private contact persists only in GM journal, never Combat flags or module socket", async () => {
  const { ctx, enemy, combat } = setup();
  const flagsBefore = structuredClone(combat.flags);
  assert.equal(await addPrivateContact(combat, enemy, 4), "added");
  const [obj] = privateContacts(combat.id);
  assert.equal(obj.detection.party, "undetected");
  assert.equal(obj.actorUuid, enemy.uuid);
  assert.deepEqual(combat.flags, flagsBefore);
  assert.deepEqual(globalThis.__socket, []);
  assert.equal(game.journal.contents[0].ownership.default, 0);
  ctx.setUser("p1");
  assert.deepEqual(privateContacts(combat.id), []);
  assert.deepEqual(viewFor(getTsc(combat), { isGM: false }), []);
  assert.equal(JSON.stringify(combat.flags).includes(enemy.uuid), false);
});
test("repeat add and move preserve identity; explicit reveal publishes exactly once", async () => {
  const { enemy, combat } = setup();
  await addPrivateContact(combat, enemy, 4);
  const original = privateContacts(combat.id)[0];
  assert.equal(await addPrivateContact(combat, enemy, 4), "unchanged");
  assert.equal(await addPrivateContact(combat, enemy, 6), "moved");
  assert.equal(privateContacts(combat.id)[0].key, original.key);
  assert.equal(privateContacts(combat.id)[0].detection.party, "undetected");
  await changePrivateContact(combat, original.key, "move", 7);
  assert.deepEqual(globalThis.__socket, []);
  assert.equal(getTsc(combat).objects.length, 0);
  await changePrivateContact(combat, original.key, "reveal");
  assert.equal(privateContacts(combat.id).length, 0);
  assert.equal(getTsc(combat).objects[0].actorUuid, enemy.uuid);
  assert.equal(getTsc(combat).objects[0].detection.party, "identified");
  assert.equal(viewFor(getTsc(combat), { isGM: false })[0].label, enemy.name);
});
test("exposed Actor, existing public contact, duplicates and unsafe ownership are rejected", async () => {
  const { enemy, combat } = setup();
  enemy.owners.push("p1");
  await assert.rejects(addPrivateContact(combat, enemy, 1));
  assert.equal(game.journal.contents.length, 0);
  enemy.owners = [];
  await addPrivateContact(combat, enemy, 2);
  const store = game.journal.contents[0];
  store.ownership.p1 = 1;
  assert.throws(() => privateContacts(combat.id));
  await assert.rejects(addPrivateContact(combat, enemy, 3));
  assert.equal(getTsc(combat).objects.length, 0);
  store.ownership.p1 = 0;
  const same = structuredClone(store.flags[MODULE_ID].privateSensor.contacts[0]);
  store.flags[MODULE_ID].privateSensor.contacts.push(same);
  assert.throws(() => privateContacts(combat.id));
});
test("non-GM and inactive GM cannot access or mutate private records", async () => {
  const { ctx, enemy, combat } = setup();
  await addPrivateContact(combat, enemy, 3);
  const [obj] = privateContacts(combat.id);
  ctx.setUser("p1");
  await assert.rejects(changePrivateContact(combat, obj.key, "move", 4));
  await assert.rejects(addPrivateContact(combat, enemy, 4));
  ctx.setUser("gm");
  game.user.active = false;
  await assert.rejects(changePrivateContact(combat, obj.key, "move", 4));
  assert.equal(privateContacts(combat.id)[0].zone, 3);
});

test("the actual drop listener creates independent private Actors without publishing source UUID", async () => {
  const { enemy, combat } = setup();
  const { wireSensorMapDragDrop } = await import("../../scripts/ui/sensor-drop-ui.mjs");
  const handlers = {};
  const zone = { dataset: { zone: "5" }, classList: { add() {}, remove() {} }, addEventListener: (n, fn) => (handlers[n] = fn) };
  const root = { querySelectorAll: (s) => (s.startsWith(".tsc-zone") ? [zone] : []) };
  let calls = 0;
  wireSensorMapDragDrop(
    root,
    { combatId: combat.id, movableKeys: [] },
    { resolve: async () => enemy, send: async () => calls++, warn: () => {} }
  );
  const drop = () =>
    handlers.drop({ preventDefault() {}, dataTransfer: { getData: () => JSON.stringify({ type: "Actor", uuid: enemy.uuid }) } });
  await drop();
  await drop();
  assert.equal(calls, 0);
  const contacts = privateContacts(combat.id);
  assert.equal(contacts.length, 2);
  assert.notEqual(contacts[0].actorUuid, enemy.uuid);
  assert.notEqual(contacts[0].actorUuid, contacts[1].actorUuid);
  assert.equal(fromUuidSync(contacts[0].actorUuid).flags[MODULE_ID].tacticalCopyOf, enemy.uuid);
  assert.equal(fromUuidSync(contacts[1].actorUuid).flags[MODULE_ID].tacticalCopyOf, enemy.uuid);
  assert.equal(fromUuidSync(contacts[0].actorUuid).ownership.default, 0);
  assert.equal(combat.combatants.size, 0);
  assert.equal(JSON.stringify(combat.flags).includes(enemy.uuid), false);
  assert.deepEqual(globalThis.__socket, []);
});

test("failed reveal finalization retains durable intent and consistent public instance for retry", async () => {
  const { enemy, combat } = setup();
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: enemy.uuid,
    zone: 2,
    detection: "undetected"
  });
  const instance = fromUuidSync(placement.actorUuid);
  const [obj] = privateContacts(combat.id),
    doc = game.journal.contents[0];
  const update = doc.update.bind(doc);
  let fail = true;
  doc.update = async (...args) => {
    if (fail && Object.hasOwn(args[0], `flags.${MODULE_ID}.privateSensor.completedReveals`)) {
      fail = false;
      throw new Error("journal failed");
    }
    return update(...args);
  };
  await assert.rejects(changePrivateContact(combat, obj.key, "reveal"));
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(privateContacts(combat.id).length, 1);
  assert.equal(privateContacts(combat.id)[0].pendingReveal, true);
  assert.equal(privateContacts(combat.id)[0].reveal.stage, "consistent");
  assert.equal(combat.combatants.filter((c) => c.actorId === instance.id).length, 1);
  const combatantId = combat.combatants.find((c) => c.actorId === instance.id).id;
  assert.equal(instance.flags[MODULE_ID].sensorContactInstance.privateContact, false);
  await changePrivateContact(combat, obj.key, "reveal");
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(privateContacts(combat.id).length, 0);
  assert.equal(combat.combatants.filter((c) => c.actorId === instance.id).length, 1);
  assert.equal(combat.combatants.find((c) => c.actorId === instance.id).id, combatantId);
  assert.equal(instance.flags[MODULE_ID].sensorContactInstance.privateContact, false);
});

test("a newly exposed Actor is not published by the staged reveal", async () => {
  const { enemy, combat } = setup();
  await addPrivateContact(combat, enemy, 2);
  const [obj] = privateContacts(combat.id);
  enemy.owners.push("p1");
  await assert.rejects(changePrivateContact(combat, obj.key, "reveal"));
  assert.equal(getTsc(combat).objects.length, 0);
  assert.equal(privateContacts(combat.id).length, 1);
});

for (const detection of ["undetected", "hidden", "observed"]) {
  test(`resize refuses to strand ordinary ${detection} private contacts without writes`, async () => {
    const { enemy, combat } = setup();
    await addPrivateContact(combat, enemy, 12);
    const { key } = privateContacts(combat.id)[0];
    await changePrivateContact(combat, key, "detect", detection);
    const before = structuredClone(combat.flags);
    const journalBefore = structuredClone(game.journal.contents[0].flags);
    const writes = globalThis.__writes.length;
    const resize = (zones) => sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "resize", zones } });
    await assert.rejects(resize(3), { message: T("SF2eTSC.mapDrop.invalidZone") });
    assert.equal(globalThis.__writes.length, writes);
    assert.deepEqual(combat.flags, before);
    assert.deepEqual(game.journal.contents[0].flags, journalBefore);
    await resize(20);
    assert.equal(getTsc(combat).zones, 20);
    assert.equal(privateContacts(combat.id)[0].zone, 12);
    await changePrivateContact(combat, key, "move", 4);
    const fractionalWrites = globalThis.__writes.length;
    await assert.rejects(resize(3.9), { message: T("SF2eTSC.mapDrop.invalidZone") });
    assert.equal(globalThis.__writes.length, fractionalWrites);
    await changePrivateContact(combat, key, "move", 3);
    await resize(1); // Existing reducer/normalizer clamps the requested count to three.
    assert.equal(getTsc(combat).zones, 3);
    assert.equal(privateContacts(combat.id)[0].zone, 3);
    if (detection === "observed") assert.equal(getTsc(combat).objects[0].zone, 3);
    assert.equal(game.actors.get(enemy.id), enemy);
  });
}

test("resize protects private custom contacts with the same identity-free invalid-zone error", async () => {
  const { combat } = setup();
  const key = await addPrivateCustom(combat, "Secret anomaly", 12);
  const writes = globalThis.__writes.length;
  const resize = () => sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "resize", zones: 3 } });
  await assert.rejects(resize(), { message: T("SF2eTSC.mapDrop.invalidZone") });
  assert.equal(globalThis.__writes.length, writes);
  await changePrivateContact(combat, key, "move", 3);
  await resize();
  assert.equal(getTsc(combat).zones, 3);
  assert.equal(privateContacts(combat.id)[0].zone, 3);
});

test("resize with an empty private store permits shrink and growth", async () => {
  const { combat } = setup();
  for (const zones of [3, 20]) {
    await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "resize", zones } });
    assert.equal(getTsc(combat).zones, zones);
    assert.deepEqual(privateContacts(combat.id), []);
  }
});

async function removalSetup() {
  const { enemy, combat } = setup();
  const placement = await addSensorContact(combat, { source: "world", uuid: enemy.uuid, zone: 4, detection: "observed" });
  const actor = fromUuidSync(placement.actorUuid);
  await addSensorObjectToInitiative(combat.id, placement.key);
  const entry = combat.combatants.find((c) => c.actorId === actor.id);
  return { enemy, combat, actor, entry, key: placement.key, journal: game.journal.contents[0] };
}

for (const target of ["combatant", "actor", "journal", "projection"]) {
  for (const mode of ["reject", "silentVeto", "lostGM"]) {
    if (target === "journal" && mode !== "reject") continue;
    if (target === "projection" && mode !== "lostGM") continue;
    test(`private removal retains its retry reference on ${target} ${mode}`, async () => {
      const env = await removalSetup();
      const { enemy, combat, actor, entry, key, journal } = env;
      const events = [];
      const restores = [];
      let faultAt;
      for (const [doc, method, kind] of [
        [combat, "update", "projection"],
        [combat, "deleteEmbeddedDocuments", "combatant"],
        [actor, "delete", "actor"],
        [journal, "update", "journal"]
      ]) {
        const original = doc[method].bind(doc);
        restores.push(() => (doc[method] = original));
        doc[method] = async (...args) => {
          events.push(kind);
          if (kind === target) {
            faultAt = events.length;
            if (mode === "reject") throw new Error("injected removal failure");
            if (mode === "silentVeto") return doc;
          }
          const result = await original(...args);
          if (kind === target && mode === "lostGM") game.user.active = false;
          return result;
        };
      }
      await assert.rejects(changePrivateContact(combat, key, "remove"));
      assert.equal(events.length, faultAt, "no next write after failure or GM loss");
      assert.equal(privateContacts(combat.id)[0].actorUuid, actor.uuid);
      assert.equal(privateContacts(combat.id)[0].key, key);
      assert.equal(game.actors.get(enemy.id), enemy);
      if (target === "combatant" || target === "projection") assert.equal(game.actors.get(actor.id), actor);
      if (target === "combatant" && mode !== "lostGM") assert.equal(combat.combatants.get(entry.id), entry);
      for (const restore of restores) restore();
      game.user.active = true;
      await changePrivateContact(combat, key, "remove");
      assert.deepEqual(privateContacts(combat.id), []);
      assert.deepEqual(getTsc(combat).objects, []);
      assert.equal(game.actors.has(actor.id), false);
      assert.equal(combat.combatants.has(entry.id), false);
      assert.equal(game.actors.get(enemy.id), enemy);
      assert.equal(
        globalThis.__writes.some((write) => write.doc === enemy.uuid && write.delete),
        false
      );
    });
  }
}

test("missing instance retry removes only known owned Combatants and preserves source and manual entries", async () => {
  const { enemy, combat, actor, entry, key } = await removalSetup();
  const [owned, manual, foreign] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: actor.id, flags: { [MODULE_ID]: { sensorContactInstance: { combatId: combat.id, actorUuid: actor.uuid } } } },
    { actorId: actor.id },
    { actorId: actor.id, flags: { [MODULE_ID]: { sensorMapInitiative: { combatId: "other-combat" } } } }
  ]);
  await actor.delete();
  await changePrivateContact(combat, key, "remove");
  assert.equal(combat.combatants.has(entry.id), false);
  assert.equal(combat.combatants.has(owned.id), false);
  assert.equal(combat.combatants.get(manual.id), manual);
  assert.equal(combat.combatants.get(foreign.id), foreign);
  assert.deepEqual(privateContacts(combat.id), []);
  assert.equal(game.actors.get(enemy.id), enemy);
});

test("private removal never deletes a direct source Actor or its unowned Combatant", async () => {
  const { enemy, combat } = setup();
  await addPrivateContact(combat, enemy, 4);
  const { key } = privateContacts(combat.id)[0];
  const [manual] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: enemy.id }]);
  await changePrivateContact(combat, key, "remove");
  assert.equal(game.actors.get(enemy.id), enemy);
  assert.equal(combat.combatants.get(manual.id), manual);
  assert.deepEqual(privateContacts(combat.id), []);
});

test("instance cleanup does not delete foreign, compendium or synthetic Actors", async () => {
  for (const context of ["foreign", "compendium", "synthetic"]) {
    const { enemy, combat } = setup();
    enemy.flags[MODULE_ID].sensorContactInstance = { combatId: context === "foreign" ? "other-combat" : combat.id };
    if (context === "compendium") enemy.pack = "source-pack";
    if (context === "synthetic") enemy.isToken = true;
    await deleteSensorActorInstance(combat, enemy.uuid);
    assert.equal(game.actors.get(enemy.id), enemy);
    assert.equal(enemy.deleted, undefined);
  }
});
