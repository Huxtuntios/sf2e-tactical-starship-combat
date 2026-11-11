import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { addPrivateContact, privateContacts, changePrivateContact } from "../../scripts/sensor/private-contacts.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { viewFor } from "../../scripts/engine/sensor-ops.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";

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

test("the actual drop listener keeps new NPC UUID out of module socket and Combat", async () => {
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
  await handlers.drop({ preventDefault() {}, dataTransfer: { getData: () => JSON.stringify({ type: "Actor", uuid: enemy.uuid }) } });
  assert.equal(calls, 0);
  assert.equal(privateContacts(combat.id)[0].actorUuid, enemy.uuid);
  assert.equal(JSON.stringify(combat.flags).includes(enemy.uuid), false);
  assert.deepEqual(globalThis.__socket, []);
});

test("failed reveal write preserves private state; retry does not duplicate public contact", async () => {
  const { enemy, combat } = setup();
  await addPrivateContact(combat, enemy, 2);
  const [obj] = privateContacts(combat.id),
    doc = game.journal.contents[0];
  const update = doc.update.bind(doc);
  let fail = true;
  doc.update = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error("journal failed");
    }
    return update(...args);
  };
  await assert.rejects(changePrivateContact(combat, obj.key, "reveal"));
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(privateContacts(combat.id).length, 1);
  await changePrivateContact(combat, obj.key, "reveal");
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(privateContacts(combat.id).length, 0);
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
