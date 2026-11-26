import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import {
  addSensorContact,
  setPrivateContactZone,
  worldHazardChoices,
  importHazardCopy,
  compendiumHazardChoices,
  actorVisibleToPlayers
} from "../../scripts/sensor/contact-service.mjs";
import { defaultStarship } from "../../scripts/engine/validation.mjs";
import { privateContacts } from "../../scripts/sensor/private-contacts.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { contactEditorContext } from "../../scripts/sensor/contact-editor-model.mjs";
import { privacyProbe } from "../../scripts/sensor/privacy-probe.mjs";
import { T } from "../../scripts/utils/foundry.mjs";

// ВНИМАНИЕ: Foundry имитируется. Эти тесты проверяют логику оркестрации, а не приватность в настоящем Foundry.
const MODULE = "sf2e-tactical-starship-combat";
function setup() {
  installFoundryMock();
  return makeStarshipCombat();
}
function hazard(id, name = "Secret hazard", extra = {}) {
  const h = new MockActor({ id, type: "hazard", name, ...extra });
  game.actors.set(h.id, h);
  return h;
}
function starship(id, name = "Enemy ship", role = "npc", extra = {}) {
  const ship = new MockActor({
    id,
    type: role === "player" ? "vehicle" : "npc",
    name,
    flags: { [MODULE]: { starship: { ...defaultStarship(), role } } },
    ...extra
  });
  game.actors.set(ship.id, ship);
  return ship;
}
const text = (combat) => JSON.stringify(combat.flags);

for (const initiative of [false, true]) {
  test(`source permission changes do not mutate an existing private map snapshot${initiative ? " or hidden initiative" : ""}`, async () => {
    const combat = setup();
    const actor = starship("exposed-private-original");
    const placement = await addSensorContact(combat, { source: "world", uuid: actor.uuid, zone: 3, detection: "hidden" });
    if (initiative) {
      const { addSensorObjectToInitiative } = await import("../../scripts/sensor/initiative.mjs");
      await addSensorObjectToInitiative(combat.id, placement.key);
      await combat.combatants.contents[0].update({ initiative: 17 });
    }
    await actor.update({ "ownership.p1": 1 });
    assert.equal(actorVisibleToPlayers(actor), true);
    const beforeActor = actor.toObject();
    const beforeMap = getTsc(combat);
    const beforeJournal = structuredClone(game.journal.contents[0].flags);
    const beforeEntries = structuredClone(
      combat.combatants.contents.map((entry) => ({
        id: entry.id,
        name: entry.name,
        hidden: entry.hidden,
        initiative: entry.initiative,
        flags: entry.flags
      }))
    );
    const writes = globalThis.__writes.length;
    await assert.rejects(addSensorContact(combat, { source: "world", uuid: actor.uuid, zone: 5, detection: "hidden" }), {
      message: T("SF2eTSC.privateMap.actorExposed")
    });
    assert.equal(game.actors.size, 1);
    assert.deepEqual(actor.toObject(), beforeActor);
    assert.deepEqual(getTsc(combat), beforeMap);
    assert.deepEqual(game.journal.contents[0].flags, beforeJournal);
    assert.deepEqual(
      combat.combatants.contents.map((entry) => ({
        id: entry.id,
        name: entry.name,
        hidden: entry.hidden,
        initiative: entry.initiative,
        flags: entry.flags
      })),
      beforeEntries
    );
    assert.equal(globalThis.__writes.length, writes);
  });
}

test("Contact Editor serializes independent public and private placements without replacing either record", async () => {
  const combat = setup();
  const actor = starship("queued-private-original", "Queued NPC", "npc", { ownership: { p1: 1 } });
  const { serialize } = await import("../../scripts/utils/serial.mjs");
  const { addPrivateContact } = await import("../../scripts/sensor/private-contacts.mjs");
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const blocked = serialize(`sensor:${combat.id}`, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const privatePlacement = addPrivateContact(combat, actor, 3, { reuseActor: true });
  const publication = addSensorContact(combat, {
    source: "world",
    uuid: actor.uuid,
    zone: 5,
    detection: "identified",
    publicActor: true
  });
  await actor.update({ "ownership.p1": 0 });
  release.resolve();
  await blocked;
  await privatePlacement;
  const placed = await publication;
  assert.equal(privateContacts(combat.id).length, 1);
  assert.equal(privateContacts(combat.id)[0].actorUuid, actor.uuid);
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(getTsc(combat).objects[0].key, placed.key);
  assert.equal(getTsc(combat).objects[0].mapOnly, true);
  assert.equal(combat.combatants.size, 1);
  assert.equal(game.actors.get(actor.id), actor);
});

test("public placement adds a map-only object while an existing private snapshot stays unchanged", async () => {
  const combat = setup();
  const actor = starship("copy-private-original");
  await addSensorContact(combat, { source: "world", uuid: actor.uuid, zone: 3, detection: "hidden" });
  await actor.update({ "ownership.p1": 1 });
  const beforeActor = actor.toObject();
  const beforeContacts = structuredClone(privateContacts(combat.id));
  const placement = await addSensorContact(combat, { source: "world", uuid: actor.uuid, zone: 5, detection: "identified" });
  assert.notEqual(placement.actorUuid, actor.uuid);
  assert.equal(placement.actorUuid, placement.key);
  assert.equal(game.actors.size, 1);
  assert.deepEqual(privateContacts(combat.id), beforeContacts);
  assert.deepEqual(actor.toObject(), beforeActor);
  assert.equal(getTsc(combat).objects.filter((object) => object.actorUuid === actor.uuid).length, 0);
  assert.equal(getTsc(combat).objects.filter((object) => object.actorUuid === placement.actorUuid).length, 1);
  assert.equal(getTsc(combat).objects.find((object) => object.key === placement.key).mapOnly, true);
});

test("repeated private placements always remain independent map-only snapshots", async () => {
  const combat = setup();
  const actor = starship("mode-original");
  const before = actor.toObject();
  const spec = { source: "world", uuid: actor.uuid, zone: 2, detection: "hidden" };
  const original = await addSensorContact(combat, spec);
  const copies = await Promise.all([addSensorContact(combat, spec), addSensorContact(combat, { ...spec, zone: 4 })]);
  const repeated = await addSensorContact(combat, { ...spec, zone: 6 });
  assert.equal(game.actors.size, 1);
  assert.equal(privateContacts(combat.id).length, 4);
  assert.equal(new Set([original.key, ...copies.map((copy) => copy.key), repeated.key]).size, 4);
  assert.equal(
    privateContacts(combat.id).every((contact) => contact.mapOnly && contact.actorUuid === contact.key),
    true
  );
  assert.deepEqual(actor.toObject(), before);
});

for (const kind of ["npc", "player", "hazard"]) {
  test(`world ${kind} placements create isolated map-only snapshots without Actor creation or source writes`, async () => {
    const combat = setup();
    const actor = kind === "hazard" ? hazard("original") : starship("original", "Original", kind === "player" ? "player" : "npc");
    if (kind === "player") actor.owners = ["p1"];
    actor.folder = "original-folder";
    actor.flags.other = { manual: true };
    const before = actor.toObject();
    const count = game.actors.size;
    const spec = { source: "world", uuid: actor.uuid, zone: 3, detection: kind === "player" ? "identified" : "hidden" };
    const result = await addSensorContact(combat, spec);
    assert.equal(game.actors.size, count);
    assert.equal(result.actorUuid, result.key);
    assert.notEqual(result.actorUuid, actor.uuid);
    assert.equal(game.actors.get(actor.id), actor);
    assert.deepEqual(actor.toObject(), before);
    assert.deepEqual(
      globalThis.__writes.filter((write) => write.doc.startsWith("Actor.")),
      []
    );
    const repeat = await addSensorContact(combat, { ...spec, zone: 5, detection: kind === "player" ? "identified" : "undetected" });
    assert.notEqual(repeat.key, result.key);
    assert.equal(repeat.actorUuid, repeat.key);
    assert.equal(game.actors.size, count);
    if (kind !== "player") {
      assert.equal(privateContacts(combat.id).length, 2);
      assert.deepEqual(
        privateContacts(combat.id).map((contact) => contact.zone),
        [3, 5]
      );
      assert.equal(privateContacts(combat.id)[0].detection.party, "hidden");
      assert.equal(privateContacts(combat.id)[1].detection.party, "undetected");
    } else assert.equal(getTsc(combat).objects.length, 2);
  });
}

test("concurrent private world drops create separate snapshots and reveal/removal affect only the selected one", async () => {
  const combat = setup();
  const actor = starship("concurrent-original");
  const before = actor.toObject();
  const spec = { source: "world", uuid: actor.uuid, zone: 3, detection: "hidden" };
  const results = await Promise.all([addSensorContact(combat, spec), addSensorContact(combat, spec)]);
  assert.equal(game.actors.size, 1);
  assert.notEqual(results[0].key, results[1].key);
  assert.equal(results[0].actorUuid, results[0].key);
  assert.equal(results[1].actorUuid, results[1].key);
  assert.equal(privateContacts(combat.id).length, 2);
  const { addSensorObjectToInitiative } = await import("../../scripts/sensor/initiative.mjs");
  const { changePrivateContact } = await import("../../scripts/sensor/private-contacts.mjs");
  assert.equal((await addSensorObjectToInitiative(combat.id, results[0].key)).status, "added");
  const entry = combat.combatants.contents[0];
  await entry.update({ initiative: 17 });
  await changePrivateContact(combat, results[0].key, "reveal");
  assert.equal(getTsc(combat).objects.find((object) => object.key === results[0].key).actorUuid, results[0].key);
  assert.equal(getTsc(combat).objects.find((object) => object.key === results[0].key).mapOnly, true);
  assert.equal(combat.combatants.size, 1);
  assert.equal(combat.combatants.contents[0].id, entry.id);
  assert.equal(entry.initiative, 17);
  assert.equal(entry.hidden, false);
  assert.equal(privateContacts(combat.id).length, 1);
  assert.equal(privateContacts(combat.id)[0].key, results[1].key);
  assert.deepEqual(actor.toObject(), before);
  const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
  await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: results[0].key } });
  assert.equal(game.actors.get(actor.id), actor);
  assert.equal(combat.combatants.size, 0);
  assert.equal(privateContacts(combat.id).length, 1);
});

test("identified world NPC and complex hazard placements create map-only initiative entries", async () => {
  const combat = setup();
  const actors = [starship("identified-npc"), hazard("identified-complex", "Complex", { system: { details: { isComplex: true } } })];
  const keys = [];
  for (const actor of actors) {
    const before = actor.toObject();
    const placement = await addSensorContact(combat, {
      source: "world",
      uuid: actor.uuid,
      zone: 2,
      detection: "identified",
      publicActor: true
    });
    keys.push(placement.key);
    assert.equal(game.actors.size, 2);
    assert.equal(combat.combatants.filter((entry) => entry.flags[MODULE].sensorMapObject?.key === placement.key).length, 1);
    assert.deepEqual(actor.toObject(), before);
  }
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.actorUuid),
    keys
  );
  assert.equal(
    getTsc(combat).objects.every((object) => object.mapOnly),
    true
  );
  assert.equal(
    combat.combatants.contents.every((entry) => entry.actorId === null),
    true
  );
});

test("failed world placement never deletes a reused source carrying a legacy copy flag", async () => {
  const combat = setup();
  const actor = starship("legacy-original");
  actor.flags[MODULE].sensorContactInstance = { combatId: combat.id, sourceUuid: "Actor.template", privateContact: false };
  const before = actor.toObject();
  combat.update = async () => {
    throw new Error("injected map failure");
  };
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: actor.uuid, zone: 2, detection: "identified" }));
  assert.equal(game.actors.size, 1);
  assert.equal(game.actors.get(actor.id), actor);
  assert.deepEqual(actor.toObject(), before);
});

test("world hazard: undetected stays private; hidden publishes anonymous category without art or heading", async () => {
  const combat = setup();
  const h = hazard("h1");
  const r = await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "undetected" });
  assert.equal(r.actorUuid, r.key);
  assert.notEqual(r.actorUuid, h.uuid);
  assert.equal(game.actors.get(h.id), h);
  assert.equal(privateContacts(combat.id)[0].zone, 4);
  assert.deepEqual(getTsc(combat).objects, []);
  const h2 = hazard("h2", "Other");
  await addSensorContact(combat, { source: "world", uuid: h2.uuid, zone: 5, detection: "hidden" });
  assert.notEqual(privateContacts(combat.id).find((o) => o.actorUuid !== r.actorUuid).key, r.key);
  const hidden = privateContacts(combat.id).find((o) => o.actorUuid !== r.actorUuid);
  assert.equal(hidden.detection.party, "hidden");
  assert.deepEqual(getTsc(combat).objects, [
    {
      key: hidden.key,
      zone: 5,
      type: "contact",
      objectType: "hazard",
      span: 1,
      name: "Contact",
      heading: null,
      detection: { party: "hidden" },
      tscPrivateProjection: true
    }
  ]);
  assert.equal(Object.hasOwn(getTsc(combat).objects[0], "art"), false);
  for (const secret of [h.name, h.uuid, h2.name, h2.uuid]) assert.equal(text(combat).includes(secret), false);
});

test("observed publishes anonymous category and approved art; identified can be selected directly", async () => {
  const combat = setup();
  const h = hazard("h1");
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "observed" });
  const marker = getTsc(combat).objects[0];
  assert.deepEqual(Object.keys(marker).sort(), [
    "art",
    "detection",
    "heading",
    "key",
    "name",
    "objectType",
    "span",
    "tscPrivateProjection",
    "type",
    "zone"
  ]);
  assert.equal(marker.name, "Contact");
  assert.equal(marker.type, "contact");
  assert.equal(marker.objectType, "hazard");
  assert.equal(marker.art, h.img);
  assert.equal(marker.heading, null);
  assert.equal(marker.zone, 4);
  for (const secret of ["Secret hazard", h.uuid]) assert.equal(text(combat).includes(secret), false);
  // раскрытие переводит объект в публичный и очищает приватную запись
  const key = privateContacts(combat.id)[0].key;
  const instanceUuid = privateContacts(combat.id)[0].actorUuid;
  const { changePrivateContact } = await import("../../scripts/sensor/private-contacts.mjs");
  await changePrivateContact(combat, key, "reveal");
  assert.equal(getTsc(combat).objects[0].actorUuid, instanceUuid);
  assert.equal(getTsc(combat).objects[0].mapOnly, true);
  assert.equal(combat.combatants.size, 0);
  assert.deepEqual(privateContacts(combat.id), []);
});

test("identified placement immediately publishes the Actor selected in the editor", async () => {
  const combat = setup();
  const h = hazard("h1");
  const placement = await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 2, detection: "identified", publicActor: true });
  const o = getTsc(combat).objects[0];
  assert.equal(o.actorUuid, placement.key);
  assert.equal(o.mapOnly, true);
  assert.deepEqual([o.type, o.zone, o.detection.party], ["hazard", 2, "identified"]);
  assert.equal(game.actors.get(h.id), h);
  assert.deepEqual(privateContacts(combat.id), []);
});

test("world Starship Actors use private NPC contacts and identified public Player contacts", async () => {
  const combat = setup();
  const npcShip = starship("npc-ship");
  await addSensorContact(combat, { source: "world", uuid: npcShip.uuid, zone: 3, detection: "hidden" });
  const privateShipUuid = privateContacts(combat.id)[0].actorUuid;
  assert.equal(privateShipUuid, privateContacts(combat.id)[0].key);
  assert.notEqual(privateShipUuid, npcShip.uuid);
  assert.equal(game.actors.get(npcShip.id), npcShip);
  const [marker] = getTsc(combat).objects;
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(marker.name, "Contact");
  assert.equal(marker.objectType, "starship");
  assert.equal(marker.heading, null);
  assert.equal(Object.hasOwn(marker, "art"), false);
  for (const secret of [npcShip.name, npcShip.uuid]) assert.equal(text(combat).includes(secret), false);
  assert.equal(
    (combat.combatants ?? []).some((c) => c.flags[MODULE].sensorMapObject?.key === privateShipUuid),
    false
  );

  const playerShip = starship("player-ship", "Party ship", "player", { owners: ["p1"] });
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: playerShip.uuid, zone: 2, detection: "observed" }));
  await addSensorContact(combat, {
    source: "world",
    uuid: playerShip.uuid,
    zone: 2,
    detection: "identified"
  });
  const publicObject = getTsc(combat).objects.find((object) => object.detection.party === "identified");
  const publicShipUuid = publicObject.actorUuid;
  assert.equal(publicShipUuid, publicObject.key);
  assert.notEqual(publicShipUuid, playerShip.uuid);
  assert.equal(publicObject.mapOnly, true);
  assert.equal(
    (combat.combatants ?? []).some((c) => c.flags[MODULE].sensorMapObject?.key === publicShipUuid),
    false
  );
});

test("an Actor already visible to players can only be placed as identified", async () => {
  const combat = setup();
  const h = hazard("h1", "Known hazard", { owners: ["p1"] });
  assert.equal(actorVisibleToPlayers(h), true);
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 3, detection: "undetected" }));
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 3, detection: "observed" }));
  assert.deepEqual(getTsc(combat).objects, []);
  const placement = await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 3, detection: "identified" });
  assert.equal(getTsc(combat).objects[0].actorUuid, placement.key);
  assert.equal(getTsc(combat).objects[0].mapOnly, true);
});

test("intentional private NPC copies stay independent, reveal gets initiative, and removal cleans up only that copy", async () => {
  const combat = setup();
  const source = hazard("complex", "Complex hazard", {
    system: { details: { isComplex: true }, attributes: { hp: { value: 18, max: 18 } } }
  });
  const { createSensorActorInstance } = await import("../../scripts/sensor/actor-instance.mjs");
  const { addPrivateContact, changePrivateContact } = await import("../../scripts/sensor/private-contacts.mjs");
  const first = await createSensorActorInstance(source, combat, { privateContact: true });
  const second = await createSensorActorInstance(source, combat, { privateContact: true });
  await addPrivateContact(combat, first, 2);
  await addPrivateContact(combat, second, 5);
  const two = privateContacts(combat.id).find((entry) => entry.actorUuid === second.uuid);
  await changePrivateContact(combat, two.key, "detect", "hidden");
  assert.notEqual(first.uuid, second.uuid);
  assert.equal(first.flags[MODULE].tacticalCopyOf, source.uuid);
  assert.equal(second.flags[MODULE].tacticalCopyOf, source.uuid);
  assert.equal(first.ownership.default, 0);
  assert.equal(second.ownership.default, 0);
  assert.equal(combat.combatants.size, 0);
  assert.deepEqual(getTsc(combat).objects, [
    {
      key: two.key,
      zone: 5,
      type: "contact",
      objectType: "hazard",
      span: 1,
      name: "Contact",
      heading: null,
      detection: { party: "hidden" },
      tscPrivateProjection: true
    }
  ]);
  for (const secret of [source.name, source.uuid, first.uuid, second.uuid]) assert.equal(text(combat).includes(secret), false);

  await first.update({ "system.attributes.hp.value": 6 });
  assert.equal(second.system.attributes.hp.value, 18);
  assert.equal(source.system.attributes.hp.value, 18);
  assert.equal(game.actors.get(first.id), first);
  assert.equal(privateContacts(combat.id).length, 2);

  const contact = privateContacts(combat.id).find((entry) => entry.actorUuid === first.uuid);
  await changePrivateContact(combat, contact.key, "reveal");
  assert.equal(combat.combatants.filter((c) => c.actorId === first.id).length, 1);
  assert.equal(
    combat.combatants.some((c) => c.actorId === second.id),
    false
  );
  assert.equal(
    getTsc(combat).objects.some((o) => o.actorUuid === first.uuid),
    true
  );

  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerSensorHandlers();
  const replies = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (r) => replies.push(r) };
  await dispatchSocketMessage(
    {
      kind: "request",
      type: "sensorUpdate",
      requestId: "remove-first",
      payload: { combatId: combat.id, op: "remove", key: first.uuid }
    },
    "gm",
    env
  );
  assert.equal(replies[0].ok, true);
  assert.equal(game.actors.has(first.id), false);
  assert.equal(
    combat.combatants.some((c) => c.actorId === first.id),
    false
  );
  assert.equal(game.actors.has(second.id), true);
  assert.equal(game.actors.has(source.id), true);
  assert.equal(
    getTsc(combat).objects.some((o) => o.actorUuid === first.uuid),
    false
  );
  const secondContact = privateContacts(combat.id).find((entry) => entry.actorUuid === second.uuid);
  await changePrivateContact(combat, secondContact.key, "remove");
  assert.equal(game.actors.has(second.id), false);
  assert.equal(
    privateContacts(combat.id).some((entry) => entry.actorUuid === second.uuid),
    false
  );
  assert.equal(game.actors.has(source.id), true);
});

test("custom contact without an Actor: placement, zone change, detection and no leakage", async () => {
  const combat = setup();
  const r = await addSensorContact(combat, { source: "custom", name: "Secret anomaly", zone: 6, detection: "undetected" });
  assert.equal(r.actorUuid, null);
  assert.equal(privateContacts(combat.id)[0].name, "Secret anomaly");
  assert.equal(await setPrivateContactZone(combat, r.key, 8), true);
  assert.equal(privateContacts(combat.id)[0].zone, 8);
  await assert.rejects(setPrivateContactZone(combat, r.key, 99));
  await assert.rejects(addSensorContact(combat, { source: "custom", name: "  ", zone: 2, detection: "undetected" }));
  const r2 = await addSensorContact(combat, {
    source: "custom",
    name: "Visible beacon",
    zone: 2,
    detection: "identified"
  });
  assert.equal(getTsc(combat).objects.find((o) => o.key === r2.key).name, "Visible beacon");
  assert.equal(text(combat).includes("Secret anomaly"), false);
});

test("explicit hazard import still copies, while Sensor Map placements use independent private snapshots", async () => {
  const combat = setup();
  const source = {
    documentName: "Actor",
    type: "hazard",
    pack: "pf2e.hazards",
    uuid: "Compendium.pf2e.hazards.Actor.abc",
    name: "Orbital trap",
    img: "hazard.webp",
    ownership: { default: 0 },
    testUserPermission: (user, level) =>
      user?.isGM === true ||
      Number(source.ownership?.[user?.id] ?? source.ownership?.default ?? 0) >= ({ LIMITED: 1, OBSERVER: 2, OWNER: 3 }[level] ?? 0),
    toObject: () => ({
      _id: "abc",
      name: "Orbital trap",
      type: "hazard",
      folder: "f",
      sort: 5,
      ownership: { default: 2 },
      flags: { other: 1 }
    })
  };
  const created = [];
  const deps = {
    resolve: async () => source,
    createActor: async (data) => {
      assert.equal(data._id, undefined);
      assert.equal(data.folder, undefined);
      assert.deepEqual(data.ownership, { default: 0 });
      const a = new MockActor({ type: data.type, name: data.name, flags: data.flags });
      a.delete = async () => {
        a.deleted = true;
        game.actors.delete(a.id);
      };
      game.actors.set(a.id, a);
      created.push(a);
      return a;
    }
  };
  const copy = await importHazardCopy(source.uuid, deps);
  assert.equal(copy.flags[MODULE].contactImport.sourceUuid, source.uuid);
  assert.equal(copy.flags.other, 1);
  assert.equal(actorVisibleToPlayers(copy), false);
  game.actors.delete(copy.id);
  const createActor = async () => {
    throw new Error("Sensor Map placement must not create an Actor");
  };
  const mapDeps = { resolve: deps.resolve, createActor };
  const a = await addSensorContact(combat, { source: "compendium", uuid: source.uuid, zone: 2, detection: "hidden" }, mapDeps);
  const b = await addSensorContact(combat, { source: "compendium", uuid: source.uuid, zone: 4, detection: "hidden" }, mapDeps);
  assert.notEqual(a.actorUuid, b.actorUuid);
  assert.equal(a.actorUuid, a.key);
  assert.equal(b.actorUuid, b.key);
  assert.equal(privateContacts(combat.id).length, 2);
  assert.equal(
    privateContacts(combat.id).every((contact) => contact.mapOnly),
    true
  );
  assert.equal(game.actors.size, 0);
  assert.equal(created.length, 1);
  assert.equal(text(combat).includes("Orbital trap"), false);
  const before = structuredClone(game.journal.contents[0].flags);
  await assert.rejects(
    addSensorContact(combat, { source: "compendium", uuid: "Compendium.pf2e.hazards.Actor.missing", zone: 2, detection: "hidden" }, mapDeps)
  );
  assert.deepEqual(game.journal.contents[0].flags, before);
  // не компендий и не опасность
  await assert.rejects(importHazardCopy("Actor.h", { resolve: async () => ({ documentName: "Actor", type: "hazard", pack: null }) }));
});

test("compendium Starship Actor copies are independent and the index exposes them", async () => {
  setup();
  const flags = { [MODULE]: { starship: { ...defaultStarship(), role: "npc" } } };
  const source = {
    documentName: "Actor",
    type: "npc",
    pack: "world.starships",
    uuid: "Compendium.world.starships.Actor.enemy",
    flags,
    toObject: () => ({ _id: "enemy", name: "Enemy ship", type: "npc", flags: structuredClone(flags) })
  };
  const original = JSON.stringify(source.toObject());
  const copy = await importHazardCopy(source.uuid, {
    resolve: async () => source,
    createActor: async (data) => {
      assert.equal(data._id, undefined);
      assert.deepEqual(data.ownership, { default: 0 });
      return new MockActor({ type: data.type, name: data.name, flags: data.flags });
    }
  });
  assert.notEqual(copy.uuid, source.uuid);
  assert.equal(JSON.stringify(source.toObject()), original);
  assert.equal(copy.flags[MODULE].starship.role, "npc");

  game.packs = [
    {
      documentName: "Actor",
      collection: "world.starships",
      metadata: { label: "Starships" },
      getIndex: async ({ fields }) => {
        assert.ok(fields.includes(`flags.${MODULE}.starship.isStarship`));
        return [
          { _id: "enemy", uuid: source.uuid, name: source.name, type: source.type, flags },
          { _id: "ordinary", name: "Ordinary NPC", type: "npc" },
          ...Array.from({ length: 520 }, (_, i) => ({
            _id: `hazard-${i}`,
            name: `Large compendium hazard ${String(i).padStart(3, "0")}`,
            type: "hazard"
          }))
        ];
      }
    }
  ];
  const choices = await compendiumHazardChoices();
  assert.deepEqual(
    choices.filter((choice) => choice.kind === "starship").map((choice) => [choice.uuid, choice.kind, choice.role]),
    [[source.uuid, "starship", "npc"]]
  );
  const last = choices.find((choice) => choice.uuid === "Compendium.world.starships.Actor.hazard-519");
  const context = contactEditorContext({ source: "compendium", uuid: last.uuid }, { zones: 3, world: [], compendium: choices });
  assert.equal(choices.length, 521);
  assert.equal(context.choices.find((choice) => choice.uuid === last.uuid).selected, true);
});

test("input validation and mine-managed actors are rejected", async () => {
  const combat = setup();
  const h = hazard("h1");
  for (const spec of [
    { source: "nope", uuid: h.uuid, zone: 2, detection: "undetected" },
    { source: "world", uuid: h.uuid, zone: 0, detection: "undetected" },
    { source: "world", uuid: h.uuid, zone: 13, detection: "undetected" },
    { source: "world", uuid: h.uuid, zone: 2, detection: "secret" },
    { source: "world", uuid: "Actor.missing", zone: 2, detection: "undetected" }
  ])
    await assert.rejects(addSensorContact(combat, spec));
  const mine = hazard("m1", "Mine", { flags: { [MODULE]: { starshipMine: { mineId: "x" } } } });
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: mine.uuid, zone: 2, detection: "undetected" }));
  assert.deepEqual(
    worldHazardChoices().map((c) => c.uuid),
    [h.uuid]
  );
});

test("editor view model filters and selects a detection state without confirmation fields", () => {
  installFoundryMock();
  const world = [
    { uuid: "Actor.a", name: "Alpha trap", visible: false },
    { uuid: "Actor.b", name: "Beta mine", visible: true }
  ];
  const ctx = contactEditorContext(
    { source: "world", filter: "beta", uuid: "Actor.b", zone: 3, detection: "observed" },
    { zones: 5, world, compendium: [] }
  );
  assert.deepEqual(
    ctx.choices.map((c) => [c.uuid, c.selected]),
    [["Actor.b", true]]
  );
  assert.equal(ctx.zones.length, 5);
  assert.equal(ctx.zones.find((z) => z.selected).id, 3);
  assert.equal(Object.hasOwn(ctx, "needsConfirm"), false);
  assert.equal(Object.hasOwn(ctx, "confirmed"), false);
  assert.equal(contactEditorContext({ source: "custom" }, { zones: 3, world, compendium: [] }).isCustom, true);
});

test("editor view model keeps matching actors beyond 400 results selectable", () => {
  installFoundryMock();
  const world = Array.from({ length: 520 }, (_, i) => ({
    uuid: `Actor.${i}`,
    name: `Hazard ${String(i).padStart(3, "0")}`
  }));
  const selected = world[519];
  const all = contactEditorContext({ source: "world", uuid: selected.uuid }, { zones: 3, world, compendium: [] });
  assert.equal(all.choices.length, 520);
  assert.equal(all.choices.at(-1).uuid, selected.uuid);
  assert.equal(all.choices.at(-1).selected, true);
  const filtered = contactEditorContext({ source: "world", filter: "519", uuid: selected.uuid }, { zones: 3, world, compendium: [] });
  assert.deepEqual(
    filtered.choices.map((choice) => [choice.uuid, choice.selected]),
    [[selected.uuid, true]]
  );
});

test("observed and identify actions apply without confirmation dialogs", async () => {
  const combat = setup();
  const h = hazard("h1");
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "undetected" });
  const contact = privateContacts(combat.id)[0];
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const dialog = foundry.applications.api.DialogV2;
  const confirm = dialog.confirm;
  let confirmations = 0;
  dialog.confirm = async () => {
    confirmations++;
    throw new Error("unexpected confirmation");
  };
  const app = {
    selected: contact.key,
    _privateObjects: [contact],
    render() {}
  };
  try {
    await SensorMapApplication.DEFAULT_OPTIONS.actions.privateDetect.call(
      app,
      {},
      {
        dataset: { key: contact.key, level: "observed" }
      }
    );
    assert.equal(privateContacts(combat.id)[0].detection.party, "observed");
    await SensorMapApplication.DEFAULT_OPTIONS.actions.privateReveal.call(
      app,
      {},
      {
        dataset: { key: contact.key }
      }
    );
  } finally {
    dialog.confirm = confirm;
  }
  assert.equal(confirmations, 0);
  assert.equal(privateContacts(combat.id).length, 0);
  assert.equal(getTsc(combat).objects[0].detection.party, "identified");
});

test("legacy Sensor Map flags and objects survive new contact writes", async () => {
  const combat = setup();
  const flags = combat.flags[MODULE];
  flags.legacySensorData = { oldSchema: true };
  flags.tsc.objects.push({
    key: "legacy-contact",
    type: "custom",
    name: "Old contact",
    zone: 1,
    heading: null,
    span: 1,
    detection: { party: "observed" }
  });
  const legacy = structuredClone(flags.tsc.objects[0]);
  await addSensorContact(combat, { source: "custom", name: "New contact", zone: 2, detection: "identified" });
  assert.deepEqual(combat.flags[MODULE].legacySensorData, { oldSchema: true });
  assert.deepEqual(
    getTsc(combat).objects.find((o) => o.key === legacy.key),
    legacy
  );
});

test("privacy probe reports findings for a player client and never claims 'secure'", async () => {
  const combat = setup();
  const h = hazard("h1");
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "observed" });
  const gm = privacyProbe({ user: game.users.get("gm"), combats: [combat] });
  assert.deepEqual(gm.findings, []);
  assert.equal(gm.counts.anonymousProjections, 1);
  // Имитация утечки: клиент игрока «видит» закрытое хранилище.
  const player = privacyProbe({ user: game.users.get("p1"), combats: [combat] });
  assert.equal(player.note, "FINDINGS");
  assert.ok(player.findings.some((f) => f.code === "private-store-present"));
  assert.ok(player.findings.some((f) => f.code === "private-contacts-readable"));
  // Утечка полей в анонимном маркере.
  combat.flags[MODULE].tsc.objects[0].actorUuid = h.uuid;
  assert.ok(privacyProbe({ user: game.users.get("gm"), combats: [combat] }).findings.some((f) => f.code === "projection-leaks-fields"));
  // Чистый клиент: нет находок, но вердикт не «безопасно».
  // В имитации клиент игрока «держит» актёра без прав: зонд обязан это заметить.
  assert.ok(privacyProbe({ user: game.users.get("p1"), combats: [combat] }).findings.some((f) => f.code === "actors-below-limited"));
  game.journal.clear();
  game.actors.clear();
  combat.flags[MODULE].tsc.objects = [];
  const clean = privacyProbe({ user: game.users.get("p1"), combats: [combat] });
  assert.equal(clean.note, "NO_FINDINGS_IN_THIS_PROBE_NOT_A_SECURITY_PROOF");
  assert.equal(JSON.stringify(clean).toLowerCase().includes('secure"'), false);
});
