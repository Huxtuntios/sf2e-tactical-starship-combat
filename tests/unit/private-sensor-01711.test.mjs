import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import { addPrivateContact, addPrivateCustom, changePrivateContact, privateContacts } from "../../scripts/sensor/private-contacts.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { viewFor } from "../../scripts/engine/sensor-ops.mjs";
import { applySensorOp } from "../../scripts/sensor/map-model.mjs";
import { placeHazard } from "../../scripts/hazards/hazard-engine.mjs";
import { saveInstallMinePlan } from "../../scripts/actions/install-mine-plan.mjs";

function setup() {
  const ctx = installFoundryMock();
  return { ctx, combat: makeStarshipCombat(), ship: makeShip({ id: "secret", name: "Secret Dreadnought", role: "npc" }) };
}
test("intermediate detection projects only anonymous position; move, hide, reveal and remove", async () => {
  const { combat, ship } = setup();
  await addPrivateContact(combat, ship, 4);
  const { key } = privateContacts(combat.id)[0];
  await changePrivateContact(combat, key, "detect", "hidden");
  assert.equal(getTsc(combat).objects.length, 0);
  await changePrivateContact(combat, key, "detect", "observed");
  const text = JSON.stringify(combat.flags);
  for (const secret of [ship.name, ship.uuid, ship.img]) assert.equal(text.includes(secret), false);
  assert.equal(viewFor(getTsc(combat))[0].known, false);
  await changePrivateContact(combat, key, "move", 6);
  assert.equal(getTsc(combat).objects[0].zone, 6);
  await changePrivateContact(combat, key, "detect", "undetected");
  assert.equal(getTsc(combat).objects.length, 0);
  await changePrivateContact(combat, key, "detect", "observed");
  await changePrivateContact(combat, key, "reveal");
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(getTsc(combat).objects[0].actorUuid, ship.uuid);
  assert.equal(privateContacts(combat.id).length, 0);
  assert.deepEqual(globalThis.__socket, []);
});
test("custom private contacts can be renamed, detected and removed without publishing identity", async () => {
  const { combat } = setup();
  const key = await addPrivateCustom(combat, "Secret mine", 2);
  await changePrivateContact(combat, key, "rename", "Secret anomaly");
  await changePrivateContact(combat, key, "detect", "observed");
  assert.equal(JSON.stringify(combat.flags).includes("Secret"), false);
  await changePrivateContact(combat, key, "remove");
  assert.deepEqual(getTsc(combat).objects, []);
  assert.deepEqual(privateContacts(combat.id), []);
});
test("hazard API places unopened Actor privately; unsafe public modes fail", async () => {
  const { combat } = setup();
  const hazard = new MockActor({ id: "h", type: "hazard", name: "Secret hazard" });
  game.actors.set(hazard.id, hazard);
  await placeHazard(hazard, { zone: 3 });
  assert.equal(privateContacts(combat.id)[0].actorUuid, hazard.uuid);
  assert.equal(JSON.stringify(combat.flags).includes(hazard.uuid), false);
  await assert.rejects(placeHazard(hazard, { map: "both" }));
  await assert.rejects(placeHazard(hazard, { detection: "observed", publicActor: true }));
});
test("partial projection failure can be reconciled without exposing an Actor", async () => {
  const { combat, ship } = setup();
  await addPrivateContact(combat, ship, 4);
  const key = privateContacts(combat.id)[0].key,
    doc = game.journal.contents[0],
    update = doc.update.bind(doc);
  doc.update = async () => {
    throw new Error("failed");
  };
  await assert.rejects(changePrivateContact(combat, key, "detect", "observed"));
  assert.equal(getTsc(combat).objects.length, 1);
  doc.update = update;
  await changePrivateContact(combat, key, "detect", "undetected");
  assert.equal(getTsc(combat).objects.length, 0);
  assert.equal(JSON.stringify(combat.flags).includes(ship.uuid), false);
});
test("private contact store follows Foundry JournalEntry permissions", async () => {
  const { combat, ship } = setup();
  await addPrivateContact(combat, ship, 2);
  const journal = game.journal.contents[0];
  assert.equal(journal.ownership.default, 0);
  assert.equal(journal.testUserPermission(game.users.get("p1"), "LIMITED"), false);
  journal.ownership.p1 = 2;
  assert.throws(() => privateContacts(combat.id));
});
test("legacy GM zone notes are retained, not overwritten from a socket payload", () => {
  const before = { zoneInfo: { 1: { gmNotes: "old", oldField: 1 } } };
  const after = applySensorOp(before, { op: "zoneInfo", zone: 1, info: { gmNotes: "new" } });
  assert.equal(after.zoneInfo[1].gmNotes, "old");
  assert.equal(after.zoneInfo[1].oldField, 1);
});
test("Install Mine rejects stale plan replacement while replay remains idempotent", () => {
  const data = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op" }],
    upgrades: [{ ref: "mine-deployment-shell", stationId: "s" }],
    drones: [{ id: "d", stationId: "s", ref: "pyrotechnics-drone", deployed: false, tscVersion: 1 }]
  };
  const req = {
    stationId: "s",
    droneId: "d",
    operatorUuid: "Actor.op",
    entries: [{ mine: "A", mod: "Big Boom" }],
    operationId: "install-12345678",
    expectedPlanFingerprint: null,
    confirmed: true
  };
  assert.equal(saveInstallMinePlan(data, req), true);
  const before = structuredClone(data);
  assert.equal(saveInstallMinePlan(data, req), false);
  assert.throws(() => saveInstallMinePlan(data, { ...req, operationId: "install-87654321" }), /stale/);
  assert.deepEqual(data, before);
});
