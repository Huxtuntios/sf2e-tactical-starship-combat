import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { addSensorContact } from "../../scripts/sensor/contact-service.mjs";
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
  assert.equal(combatant.flags[MODULE_ID].sensorMapInitiative.actorUuid, actor.uuid);
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

  assert.deepEqual(
    report.added.map((item) => item.name),
    [npc.name]
  );
  assert.deepEqual(
    report.existing.map((item) => item.name),
    [existing.name]
  );
  assert.ok(report.skipped.some((item) => item.name === player.name && item.reason === "playerShip"));
  assert.ok(report.skipped.some((item) => item.name === "Unbacked marker" && item.reason === "markerOnly"));
  assert.ok(report.skipped.some((item) => item.name === "Custom marker" && item.reason === "markerOnly"));
  assert.ok(report.failed.some((item) => item.name === "Missing actor" && item.reason === "actorMissing"));
  assert.equal(combat.combatants.filter((entry) => entry.actorId === player.id).length, 0);
  assert.equal(combat.combatants.filter((entry) => entry.actorId === npc.id).length, 1);
});

test("bulk and individual addition keep hidden and private contacts out of the shared Combat Tracker", async () => {
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
  const report = await addAllNpcShipsToInitiative(combat.id);

  assert.equal(single.status, "skipped");
  assert.equal(single.item.reason, "hiddenContact");
  assert.ok(report.skipped.some((item) => item.name === hiddenMapNpc.name && item.reason === "hiddenContact"));
  assert.ok(report.skipped.some((item) => item.name === unidentifiedMapNpc.name && item.reason === "privateContact"));
  assert.ok(report.skipped.some((item) => item.name.startsWith("Unidentified raider") && item.reason === "privateContact"));
  assert.equal(
    combat.combatants.some((entry) => entry.actorId === hiddenMapNpc.id),
    false
  );
  assert.equal(
    combat.combatants.some((entry) => entry.actorId === unidentifiedMapNpc.id),
    false
  );
  assert.equal(
    combat.combatants.some((entry) => entry.actorId === privateActor.id),
    false
  );
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
  assert.equal(result.item.reason, "noIndependentActor");
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
});
