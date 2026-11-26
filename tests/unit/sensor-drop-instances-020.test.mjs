import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { getTsc, mutateTsc } from "../../scripts/combat/tsc-state.mjs";
import { privateContacts } from "../../scripts/sensor/private-contacts.mjs";

function sourceActor(kind, { visible = false } = {}) {
  const owners = visible ? ["p1"] : [];
  if (kind === "hazard") {
    const actor = new MockActor({
      id: "repeat-hazard",
      name: "Repeat hazard",
      type: "hazard",
      owners,
      system: { details: { isComplex: false }, attributes: { hp: { value: 20, max: 20 } } }
    });
    game.actors.set(actor.id, actor);
    return actor;
  }
  return makeShip({ id: `repeat-${kind}`, name: `Repeat ${kind}`, role: kind, owners });
}

async function dropHarness(actor, combat, { confirm = async () => true, movableKeys = [] } = {}) {
  const { wireSensorMapDragDrop } = await import("../../scripts/ui/sensor-drop-ui.mjs");
  const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
  const handlers = {};
  const zone = {
    dataset: { zone: "2" },
    classList: { add() {}, remove() {} },
    addEventListener: (name, handler) => (handlers[name] = handler)
  };
  const root = { querySelectorAll: (selector) => (selector.startsWith(".tsc-zone") ? [zone] : []) };
  const warnings = [];
  wireSensorMapDragDrop(
    root,
    { combatId: combat.id, movableKeys },
    {
      resolve: async (uuid) => globalThis.fromUuidSync(uuid),
      confirm,
      send: (type, payload) => sensorUpdate({ user: game.user, payload }),
      warn: (key, data) => warnings.push({ key, data }),
      info: () => {}
    }
  );
  return {
    zone,
    warnings,
    drop: (payload = { type: "Actor", uuid: actor.uuid }) =>
      handlers.drop({ preventDefault() {}, dataTransfer: { getData: () => JSON.stringify(payload) } })
  };
}

for (const kind of ["npc", "player", "hazard"]) {
  test(`repeated visible ${kind} directory drops add independent map-only objects`, async () => {
    installFoundryMock();
    const actor = sourceActor(kind, { visible: true });
    const before = actor.toObject();
    const combat = makeStarshipCombat();
    let confirmations = 0;
    let approved = true;
    const harness = await dropHarness(actor, combat, {
      confirm: async () => {
        confirmations++;
        return approved;
      }
    });

    await harness.drop();
    harness.zone.dataset.zone = "6";
    await harness.drop();

    assert.equal(confirmations, 2);
    assert.equal(harness.warnings.length, 0);
    assert.equal(game.actors.size, 1);
    const objects = getTsc(combat).objects;
    assert.equal(objects.length, 2);
    assert.deepEqual(
      objects.map((object) => object.zone),
      [2, 6]
    );
    assert.notEqual(objects[0].key, actor.uuid);
    assert.notEqual(objects[1].key, objects[0].key);
    assert.deepEqual(
      objects.map((object) => object.actorUuid),
      [objects[0].key, objects[1].key]
    );
    assert.equal(
      objects.every((object) => object.mapOnly === true),
      true
    );
    assert.equal(actor.flags[MODULE_ID]?.sensorContactInstance, undefined);
    assert.deepEqual(actor.toObject(), before);

    approved = false;
    harness.zone.dataset.zone = "9";
    const beforeCancel = structuredClone(getTsc(combat));
    await harness.drop();
    assert.equal(confirmations, 3);
    assert.deepEqual(getTsc(combat), beforeCancel);
    assert.equal(game.actors.size, 1);
  });
}

for (const kind of ["npc", "hazard"]) {
  test(`repeated private ${kind} directory drops keep separate private map snapshots without creating an Actor`, async () => {
    installFoundryMock();
    const actor = sourceActor(kind);
    const combat = makeStarshipCombat();
    const harness = await dropHarness(actor, combat, {
      confirm: async () => {
        throw new Error("private placement must not request public disclosure");
      }
    });

    await harness.drop();
    harness.zone.dataset.zone = "6";
    await harness.drop();

    assert.equal(harness.warnings.length, 0);
    assert.equal(game.actors.size, 1);
    const contacts = privateContacts(combat.id);
    assert.equal(contacts.length, 2);
    assert.equal(new Set(contacts.map((contact) => contact.key)).size, 2);
    assert.equal(
      contacts.every((contact) => contact.mapOnly && contact.actorUuid === contact.key),
      true
    );
    assert.deepEqual(
      contacts.map((contact) => contact.zone),
      [2, 6]
    );
    assert.deepEqual(getTsc(combat).objects, []);
    assert.equal(globalThis.__writes.filter((write) => write.doc.startsWith("Actor.") && write.create).length, 0);
  });
}

test("a confirmed directory drop can publish a player starship hidden from players", async () => {
  installFoundryMock();
  const actor = sourceActor("player");
  const combat = makeStarshipCombat();
  const harness = await dropHarness(actor, combat);

  await harness.drop();

  assert.equal(harness.warnings.length, 0);
  assert.equal(game.actors.size, 1);
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(getTsc(combat).objects[0].type, "starship");
});

test("dragging an existing Sensor Map object moves only that object without creating an Actor", async () => {
  installFoundryMock();
  const actor = sourceActor("player", { visible: true });
  const combat = makeStarshipCombat();
  const harness = await dropHarness(actor, combat);
  await harness.drop();
  harness.zone.dataset.zone = "6";
  await harness.drop();
  await mutateTsc(combat, (state) => {
    state.objects[0].mapTransform = { rotation: 37, flipX: true, flipY: false, baseDirection: "right" };
    state.objects[0].autoMirrorOverride = true;
    state.objects[1].mapTransform = { rotation: 280, flipX: false, flipY: true, baseDirection: "left" };
    state.objects[1].autoMirrorOverride = false;
    return state;
  });
  const [first, second] = getTsc(combat).objects;
  assert.deepEqual(first.mapTransform, { rotation: 37, flipX: true, flipY: false, baseDirection: "right" });
  assert.equal(first.autoMirrorOverride, true);
  assert.deepEqual(second.mapTransform, { rotation: 280, flipX: false, flipY: true, baseDirection: "left" });
  assert.equal(second.autoMirrorOverride, false);
  const orientation = getTsc(combat).objects.map(({ mapTransform, autoMirrorOverride, heading }) => ({
    mapTransform: structuredClone(mapTransform),
    autoMirrorOverride,
    heading
  }));
  const { wireSensorMapDragDrop } = await import("../../scripts/ui/sensor-drop-ui.mjs");
  const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
  const handlers = {};
  const zone = {
    dataset: { zone: "7" },
    classList: { add() {}, remove() {} },
    addEventListener: (name, handler) => (handlers[name] = handler)
  };
  const root = { querySelectorAll: (selector) => (selector.startsWith(".tsc-zone") ? [zone] : []) };
  const warnings = [];
  wireSensorMapDragDrop(
    root,
    { combatId: combat.id, movableKeys: [first.key, second.key] },
    {
      resolve: async (uuid) => globalThis.fromUuidSync(uuid),
      send: (type, payload) => sensorUpdate({ user: game.user, payload }),
      warn: (key, data) => warnings.push({ key, data }),
      info: () => {}
    }
  );

  await handlers.drop({
    preventDefault() {},
    dataTransfer: { getData: () => JSON.stringify({ tscKey: second.key }) }
  });

  assert.equal(warnings.length, 0);
  assert.equal(game.actors.size, 1);
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.zone),
    [2, 7]
  );
  assert.deepEqual(
    getTsc(combat).objects.map(({ mapTransform, autoMirrorOverride, heading }) => ({
      mapTransform,
      autoMirrorOverride,
      heading
    })),
    orientation
  );
});

test("a failed repeated map-reference placement rolls back without creating an Actor", async () => {
  installFoundryMock();
  const actor = sourceActor("npc", { visible: true });
  const combat = makeStarshipCombat();
  const harness = await dropHarness(actor, combat);
  await harness.drop();
  const before = structuredClone(getTsc(combat));
  const update = combat.update.bind(combat);
  combat.update = async (changes) => {
    const result = await update(changes);
    if (getTsc(combat).objects.length > before.objects.length) throw new Error("injected placement failure");
    return result;
  };

  harness.zone.dataset.zone = "6";
  await harness.drop();

  assert.equal(harness.warnings.length, 1);
  assert.match(harness.warnings[0].data.message, /injected placement failure/);
  assert.equal(game.actors.size, 1);
  assert.equal(game.actors.get(actor.id), actor);
  assert.deepEqual(getTsc(combat), before);
  combat.update = update;
});

test("removing one map-only object preserves the source Actor and the other object's Combatant", async () => {
  installFoundryMock();
  const actor = sourceActor("npc", { visible: true });
  const combat = makeStarshipCombat();
  const harness = await dropHarness(actor, combat);
  await harness.drop();
  harness.zone.dataset.zone = "6";
  await harness.drop();
  const [first, second] = getTsc(combat).objects;
  const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
  assert.equal(combat.combatants.size, 2);

  await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: first.key } });

  assert.equal(game.actors.size, 1);
  assert.equal(game.actors.get(actor.id), actor);
  assert.equal(combat.combatants.size, 1);
  assert.equal(combat.combatants.contents[0].flags[MODULE_ID].sensorMapObject.key, second.key);
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.key),
    [second.key]
  );

  await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: second.key } });

  assert.equal(game.actors.size, 1);
  assert.equal(game.actors.get(actor.id), actor);
  assert.equal(combat.combatants.size, 0);
  assert.deepEqual(getTsc(combat).objects, []);
});
