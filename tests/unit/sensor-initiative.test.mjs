import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, makeShip, makeStarshipCombat, MockUser } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { addSensorContact } from "../../scripts/sensor/contact-service.mjs";
import { changePrivateContact, privateContacts } from "../../scripts/sensor/private-contacts.mjs";
import { addAllNpcShipsToInitiative, addSensorObjectToInitiative } from "../../scripts/sensor/initiative.mjs";

function setup() {
  installFoundryMock();
  return makeStarshipCombat();
}

function addInstance(combat, id, { role = "npc", detection = "identified", hidden = false, type = "starship" } = {}) {
  const source = makeShip({ id: `${id}-source`, name: `${id} source`, role });
  const actor = makeShip({ id, name: id, role });
  actor.flags[MODULE_ID].tacticalCopyOf = source.uuid;
  actor.flags[MODULE_ID].sensorContactInstance = {
    combatId: combat.id,
    sourceUuid: source.uuid,
    privateContact: false
  };
  combat.flags[MODULE_ID].tsc.objects.push({
    key: actor.uuid,
    actorUuid: actor.uuid,
    type,
    name: actor.name,
    zone: 2,
    hidden,
    detection: { party: detection }
  });
  return actor;
}

test("individual Sensor Map action creates a Combatant for its independent NPC Actor instance", async () => {
  const combat = setup();
  const actor = addInstance(combat, "npc-one");

  const result = await addSensorObjectToInitiative(combat.id, actor.uuid);

  assert.equal(result.status, "added");
  assert.equal(combat.combatants.size, 1);
  const [combatant] = combat.combatants.contents;
  assert.equal(combatant.actorId, actor.id);
  assert.notEqual(combatant.actorId, actor.flags[MODULE_ID].tacticalCopyOf);
  assert.equal(combatant.name, actor.name);
  assert.equal(combatant.flags[MODULE_ID].sensorMapInitiative.contactDesignation, false);
});

test("individual addition recognizes existing Combatants and remains idempotent under repeated and concurrent requests", async () => {
  const combat = setup();
  const actor = addInstance(combat, "npc-repeat");

  const repeated = await addSensorObjectToInitiative(combat.id, actor.uuid);
  assert.equal(repeated.status, "added");
  assert.equal((await addSensorObjectToInitiative(combat.id, actor.uuid)).status, "existing");

  const second = addInstance(combat, "npc-parallel");
  const parallel = await Promise.all([
    addSensorObjectToInitiative(combat.id, second.uuid),
    addSensorObjectToInitiative(combat.id, second.uuid),
    addSensorObjectToInitiative(combat.id, second.uuid)
  ]);
  assert.equal(parallel.filter((entry) => entry.status === "added").length, 1);
  assert.equal(parallel.filter((entry) => entry.status === "existing").length, 2);
  assert.equal(combat.combatants.filter((entry) => entry.actorId === second.id).length, 1);
});

test("bulk addition selects NPC ship instances, reports existing entries, and excludes player ships and marker-only objects", async () => {
  const combat = setup();
  const npc = addInstance(combat, "bulk-npc");
  const existing = addInstance(combat, "bulk-existing");
  await combat.createEmbeddedDocuments("Combatant", [{ actorId: existing.id }]);
  const player = addInstance(combat, "bulk-player", { role: "player" });
  combat.flags[MODULE_ID].tsc.objects.push({
    key: "marker-only",
    type: "starship",
    name: "Unbacked marker",
    detection: { party: "identified" }
  });
  combat.flags[MODULE_ID].tsc.objects.push({
    key: "custom-marker",
    type: "custom",
    name: "Custom marker",
    detection: { party: "identified" }
  });
  combat.flags[MODULE_ID].tsc.objects.push({
    key: "missing-actor",
    actorUuid: "Actor.missing",
    type: "starship",
    name: "Missing actor",
    detection: { party: "identified" }
  });

  const report = await addAllNpcShipsToInitiative(combat.id);

  assert.deepEqual(report, { added: 1, existing: 1, skipped: 3, failed: 1, reportCreated: true });
  const message = game.messages.contents[0];
  assert.ok(message.content.includes(npc.name));
  assert.ok(message.content.includes(player.name));
  assert.ok(message.content.includes("Unbacked marker"));
  assert.ok(message.content.includes("Missing actor"));
  assert.ok(message.whisper.includes(game.user.id));
  assert.equal(combat.combatants.filter((entry) => entry.actorId === player.id).length, 0);
  assert.equal(combat.combatants.filter((entry) => entry.actorId === npc.id).length, 1);
});

test("hidden and private NPC contacts use hidden generic Combatants and the Contact designation", async () => {
  const combat = setup();
  const hiddenMapNpc = addInstance(combat, "hidden-map-npc", { hidden: true });
  const unidentifiedMapNpc = addInstance(combat, "unidentified-map-npc", { detection: "hidden" });
  const privateSource = makeShip({ id: "private-source", name: "Unidentified raider", role: "npc" });
  const privatePlacement = await addSensorContact(combat, {
    source: "world",
    uuid: privateSource.uuid,
    zone: 4,
    detection: "undetected"
  });
  const privateActor = fromUuidSync(privatePlacement.actorUuid);

  const single = await addSensorObjectToInitiative(combat.id, hiddenMapNpc.uuid);
  const privateSingle = await addSensorObjectToInitiative(combat.id, privatePlacement.key);
  const report = await addAllNpcShipsToInitiative(combat.id);

  assert.equal(single.status, "added");
  assert.equal(privateSingle.status, "added");
  assert.deepEqual(report, { added: 1, existing: 2, skipped: 0, failed: 0, reportCreated: true });
  for (const actor of [hiddenMapNpc, unidentifiedMapNpc, privateActor]) {
    const combatant = combat.combatants.find((entry) => entry.actorId === actor.id);
    assert.ok(combatant);
    assert.equal(combatant.hidden, true);
    assert.equal(combatant.name, "Contact");
    assert.equal(combatant.img, "icons/svg/mystery-man.svg");
    assert.equal(combatant.flags[MODULE_ID].sensorMapInitiative.contactDesignation, true);
    assert.notEqual(combatant.name, actor.name);
  }
  const whisper = game.messages.contents[0];
  assert.ok(whisper.content.includes("Unidentified raider"));
  assert.ok(whisper.whisper.includes(game.user.id));
});

test("individual add resolves an observed private contact before its anonymous public projection", async () => {
  const combat = setup();
  const source = makeShip({ id: "observed-private-source", name: "Observed raider", role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "observed",
    confirmed: true
  });
  const projection = combat.flags[MODULE_ID].tsc.objects.find((object) => object.key === placement.key);
  assert.equal(projection.tscPrivateProjection, true);

  const remoteGM = new MockUser({ id: "observed-gm", name: "Observed GM", isGM: true });
  game.users.set(remoteGM.id, remoteGM);
  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerSensorHandlers();
  const socketPayloads = [];
  await dispatchSocketMessage(
    {
      kind: "request",
      type: "sensorAddInitiative",
      requestId: "add-observed-contact",
      payload: { combatId: combat.id, key: placement.key }
    },
    remoteGM.id,
    {
      users: game.users,
      selfId: game.user.id,
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (payload) => socketPayloads.push(payload)
    }
  );

  assert.deepEqual(socketPayloads[0].result, { status: "added" });
  assert.equal(JSON.stringify(socketPayloads).includes(source.name), false);
  const actor = fromUuidSync(placement.actorUuid);
  const combatant = combat.combatants.find((entry) => entry.actorId === actor.id);
  assert.ok(combatant);
  assert.equal(combatant.hidden, true);
  assert.equal(combatant.name, "Contact");
  assert.equal(privateContacts(combat.id).length, 1);
});

test("revealing a private NPC reuses and updates its hidden initiative Combatant", async () => {
  const combat = setup();
  const source = makeShip({ id: "reveal-private-source", name: "Hidden interceptor", role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 5,
    detection: "undetected"
  });
  const actor = fromUuidSync(placement.actorUuid);
  assert.equal((await addSensorObjectToInitiative(combat.id, placement.key)).status, "added");
  const original = combat.combatants.find((entry) => entry.actorId === actor.id);
  assert.ok(original);
  assert.equal(original.hidden, true);
  assert.equal(original.name, "Contact");

  await changePrivateContact(combat, placement.key, "reveal");

  const combatants = combat.combatants.filter((entry) => entry.actorId === actor.id);
  assert.equal(combatants.length, 1);
  assert.equal(combatants[0].id, original.id);
  assert.equal(combatants[0].hidden, false);
  assert.equal(combatants[0].name, actor.name);
  assert.equal(combatants[0].img, actor.img);
  assert.equal(combatants[0].flags[MODULE_ID].sensorMapInitiative.contactDesignation, false);
  assert.equal(combatants[0].flags[MODULE_ID].sensorMapInitiative.combatId, combat.id);
  assert.equal(actor.flags[MODULE_ID].sensorContactInstance.privateContact, false);
  assert.equal(privateContacts(combat.id).length, 0);
  assert.equal(combat.flags[MODULE_ID].tsc.objects.filter((object) => object.actorUuid === actor.uuid).length, 1);
});

test("legacy private initiative entries without combatId can be revealed in their owning Combat", async () => {
  const combat = setup();
  const source = makeShip({ id: "legacy-private-source", name: "Legacy interceptor", role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 4,
    detection: "undetected"
  });
  const actor = fromUuidSync(placement.actorUuid);
  assert.equal((await addSensorObjectToInitiative(combat.id, placement.key)).status, "added");
  const original = combat.combatants.find((entry) => entry.actorId === actor.id);
  delete original.flags[MODULE_ID].sensorMapInitiative.combatId;
  assert.equal(original.flags[MODULE_ID].sensorMapInitiative.contactDesignation, true);

  await changePrivateContact(combat, placement.key, "reveal");

  const combatants = combat.combatants.filter((entry) => entry.actorId === actor.id);
  assert.equal(combatants.length, 1);
  assert.equal(combatants[0].id, original.id);
  assert.equal(combatants[0].hidden, false);
  assert.equal(combatants[0].name, actor.name);
  assert.equal(combatants[0].flags[MODULE_ID].sensorMapInitiative.combatId, combat.id);
});

test("repeated private add backfills combatId on a legacy entry without creating a duplicate", async () => {
  const combat = setup();
  const source = makeShip({ id: "repeat-legacy-source", name: "Legacy scout", role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "undetected"
  });
  const actor = fromUuidSync(placement.actorUuid);
  assert.equal((await addSensorObjectToInitiative(combat.id, placement.key)).status, "added");
  const original = combat.combatants.find((entry) => entry.actorId === actor.id);
  delete original.flags[MODULE_ID].sensorMapInitiative.combatId;

  assert.equal((await addSensorObjectToInitiative(combat.id, placement.key)).status, "existing");

  assert.equal(combat.combatants.filter((entry) => entry.actorId === actor.id).length, 1);
  assert.equal(original.flags[MODULE_ID].sensorMapInitiative.combatId, combat.id);
  assert.equal(original.hidden, true);
  assert.equal(original.name, "Contact");
});

test("reveal rejects a private Actor Combatant that is not the safe generic hidden entry", async () => {
  const combat = setup();
  const source = makeShip({ id: "unsafe-private-source", name: "Exposed raider", role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "undetected"
  });
  const actor = fromUuidSync(placement.actorUuid);
  const [unrelated] = await combat.createEmbeddedDocuments("Combatant", [
    {
      actorId: actor.id,
      name: actor.name,
      img: actor.img,
      hidden: false,
      flags: { [MODULE_ID]: { sensorMapInitiative: { contactDesignation: true } } }
    }
  ]);

  await assert.rejects(changePrivateContact(combat, placement.key, "reveal"), /already a combatant/);

  assert.equal(combat.combatants.filter((entry) => entry.actorId === actor.id).length, 1);
  assert.equal(unrelated.hidden, false);
  assert.equal(unrelated.name, actor.name);
  assert.equal(privateContacts(combat.id).length, 1);
  assert.equal(combat.flags[MODULE_ID].tsc.objects.length, 0);
});

test("reveal rejects a generic hidden Combatant associated with another Combat", async () => {
  const combat = setup();
  const source = makeShip({ id: "other-combat-source", name: "Unrelated contact", role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "undetected"
  });
  const actor = fromUuidSync(placement.actorUuid);
  const [unrelated] = await combat.createEmbeddedDocuments("Combatant", [
    {
      actorId: actor.id,
      name: "Contact",
      img: "icons/svg/mystery-man.svg",
      hidden: true,
      flags: {
        [MODULE_ID]: {
          sensorMapInitiative: { contactDesignation: true, combatId: "another-combat" }
        }
      }
    }
  ]);

  await assert.rejects(changePrivateContact(combat, placement.key, "reveal"), /already a combatant/);

  assert.equal(combat.combatants.filter((entry) => entry.actorId === actor.id).length, 1);
  assert.equal(unrelated.name, "Contact");
  assert.equal(unrelated.flags[MODULE_ID].sensorMapInitiative.combatId, "another-combat");
  assert.equal(privateContacts(combat.id).length, 1);
  assert.equal(combat.flags[MODULE_ID].tsc.objects.length, 0);
});

test("a failed reveal restores the existing hidden initiative entry and can be retried", async () => {
  const combat = setup();
  const source = makeShip({ id: "rollback-private-source", name: "Hidden scout", role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "undetected"
  });
  const actor = fromUuidSync(placement.actorUuid);
  await addSensorObjectToInitiative(combat.id, placement.key);
  const original = combat.combatants.find((entry) => entry.actorId === actor.id);
  const doc = game.journal.contents[0];
  const update = doc.update.bind(doc);
  let shouldFail = true;
  doc.update = async (...args) => {
    if (shouldFail) {
      shouldFail = false;
      throw new Error("journal failed");
    }
    return update(...args);
  };

  await assert.rejects(changePrivateContact(combat, placement.key, "reveal"), /journal failed/);

  assert.equal(combat.combatants.filter((entry) => entry.actorId === actor.id).length, 1);
  assert.equal(original.hidden, true);
  assert.equal(original.name, "Contact");
  assert.equal(original.flags[MODULE_ID].sensorMapInitiative.contactDesignation, true);
  assert.equal(actor.flags[MODULE_ID].sensorContactInstance.privateContact, true);
  assert.equal(combat.flags[MODULE_ID].tsc.objects.length, 0);

  await changePrivateContact(combat, placement.key, "reveal");
  assert.equal(combat.combatants.filter((entry) => entry.actorId === actor.id).length, 1);
  assert.equal(original.id, combat.combatants.find((entry) => entry.actorId === actor.id).id);
  assert.equal(original.hidden, false);
  assert.equal(actor.flags[MODULE_ID].sensorContactInstance.privateContact, false);
});

test("uninstanced source Actors are not added, and non-GM requests are rejected", async () => {
  const combat = setup();
  const source = makeShip({ id: "shared-source", name: "Shared source", role: "npc" });
  combat.flags[MODULE_ID].tsc.objects.push({
    key: source.uuid,
    actorUuid: source.uuid,
    type: "starship",
    name: source.name,
    detection: { party: "identified" }
  });

  const result = await addSensorObjectToInitiative(combat.id, source.uuid);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "noIndependentActor");
  assert.equal(combat.combatants.size, 0);

  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerSensorHandlers();
  const responses = [];
  await dispatchSocketMessage(
    {
      kind: "request",
      type: "sensorAddInitiative",
      requestId: "player-add",
      payload: { combatId: combat.id, key: source.uuid }
    },
    "p1",
    { users: game.users, selfId: "p1", isActiveGM: true, clientEvents: new Map(), emit: (response) => responses.push(response) }
  );
  assert.equal(responses[0].ok, false);
  assert.equal(combat.combatants.size, 0);
});

test("remote bulk socket response contains counts only while the active GM receives the detail whisper", async () => {
  const combat = setup();
  const secretSource = makeShip({ id: "secret-source", name: "Unrevealed dreadnought", role: "npc" });
  const hiddenNpc = addInstance(combat, "hidden-socket-npc", { hidden: true });
  const hiddenObject = combat.flags[MODULE_ID].tsc.objects.find((object) => object.actorUuid === hiddenNpc.uuid);
  hiddenObject.name = "Secret hidden map name";
  combat.flags[MODULE_ID].tsc.objects.push({
    key: "secret-marker",
    type: "custom",
    name: "Secret marker label",
    detection: { party: "undetected" }
  });
  await addSensorContact(combat, {
    source: "world",
    uuid: secretSource.uuid,
    zone: 3,
    detection: "undetected"
  });
  const remoteGM = new MockUser({ id: "gm2", name: "GM 2", isGM: true });
  game.users.set(remoteGM.id, remoteGM);
  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerSensorHandlers();
  const sentSocketPayloads = [];
  await dispatchSocketMessage(
    {
      kind: "request",
      type: "sensorAddAllNpcInitiative",
      requestId: "private-report",
      payload: { combatId: combat.id }
    },
    remoteGM.id,
    {
      users: game.users,
      selfId: game.user.id,
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (payload) => sentSocketPayloads.push(payload)
    }
  );

  assert.equal(sentSocketPayloads.length, 1);
  assert.deepEqual(sentSocketPayloads[0].result, {
    added: 2,
    existing: 0,
    skipped: 1,
    failed: 0,
    reportCreated: true
  });
  assert.equal(JSON.stringify(sentSocketPayloads).includes(secretSource.name), false);
  assert.equal(JSON.stringify(sentSocketPayloads).includes(hiddenObject.name), false);
  assert.equal(JSON.stringify(sentSocketPayloads).includes("Secret marker label"), false);
  const whisper = game.messages.contents[0];
  assert.ok(whisper.content.includes(secretSource.name));
  assert.ok(whisper.content.includes(hiddenObject.name));
  assert.ok(whisper.content.includes("Secret marker label"));
  assert.ok(whisper.whisper.includes(game.user.id));
  assert.equal(whisper.whisper.includes(remoteGM.id), true);

  const markerResponse = [];
  await dispatchSocketMessage(
    {
      kind: "request",
      type: "sensorAddInitiative",
      requestId: "private-marker",
      payload: { combatId: combat.id, key: "secret-marker" }
    },
    remoteGM.id,
    {
      users: game.users,
      selfId: game.user.id,
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (payload) => markerResponse.push(payload)
    }
  );
  assert.deepEqual(markerResponse[0].result, { status: "skipped", reason: "markerOnly" });
  assert.equal(JSON.stringify(markerResponse).includes("Secret marker label"), false);
});

test("initiative controls render only in GM Sensor Map UI", () => {
  const hb = Handlebars.create();
  hb.registerHelper("localize", (key) => key);
  const bar = hb.compile(fs.readFileSync("templates/sensor-map-bar.hbs", "utf8"));
  const detail = hb.compile(fs.readFileSync("templates/sensor-map-detail.hbs", "utf8"));
  assert.match(bar({ noCombat: false, isGM: true }), /data-action="addAllNpcInitiative"/);
  assert.doesNotMatch(bar({ noCombat: false, isGM: false }), /data-action="addAllNpcInitiative"/);
  const ctx = { noCombat: false, isGM: true, detail: { label: "NPC", key: "Actor.npc", canAddToInitiative: true } };
  assert.match(detail(ctx), /data-action="addInitiative" data-key="Actor\.npc"/);
  assert.doesNotMatch(detail({ ...ctx, isGM: false }), /data-action="addInitiative"/);
  assert.match(
    detail({
      noCombat: false,
      isGM: true,
      detail: { label: "Contact", key: "private-key", privateContact: true, canAddToInitiative: true }
    }),
    /data-action="addInitiative" data-key="private-key"/
  );
});
