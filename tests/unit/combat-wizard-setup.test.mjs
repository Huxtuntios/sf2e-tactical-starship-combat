import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import {
  installFoundryMock,
  loadContentFromDisk,
  makeShip,
  makeCharacter,
  makeStarshipCombat,
  MockActor,
  MockCombat
} from "../helpers/foundry-mock.mjs";
import { MODULE_ID as M, HOOK_EVENTS } from "../../scripts/constants.mjs";
import { startStarshipCombat, registerCombatHooks } from "../../scripts/combat/starship-combat.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { privateContacts, changePrivateContact, addPrivateCustom } from "../../scripts/sensor/private-contacts.mjs";

async function setup({ scope = "off" } = {}) {
  const ctx = installFoundryMock();
  globalThis.__hookErrors = [];
  await loadContentFromDisk();
  ctx.settings.set("crewInitiativeScope", scope);
  return ctx;
}
const shipData = (actor) => actor.flags[M].starship;
const copiesOf = (source) => game.actors.filter((actor) => actor.flags[M]?.sensorContactInstance?.sourceUuid === source.uuid);
const writesTo = (actor) => globalThis.__writes.filter((write) => write.doc === actor.uuid);
const combatantData = (combat) =>
  combat.combatants.map((c) => ({
    id: c.id,
    actorId: c.actorId,
    initiative: c.initiative,
    name: c.name,
    img: c.img,
    hidden: c.hidden,
    flags: structuredClone(c.flags)
  }));
const deferred = () => Promise.withResolvers();

async function richShip({ id = "source", role = "npc", ...options } = {}) {
  const actor = makeShip({
    id,
    name: `Secret ${id}`,
    role,
    hp: 19,
    sp: 7,
    effects: [{ id: "effect-1", slug: "off-guard", label: "Stored effect", conditions: ["off-guard"], modifiers: [] }],
    extra: { compromised: 2, offKilter: true, heading: "right", sp: { value: 7, max: 20 } },
    ...options
  });
  actor.system.attributes.hp.max = 40;
  await actor.createEmbeddedDocuments("Item", [{ _id: "item-1", name: "Weapon", type: "weapon", system: { damage: { dice: 2 } } }]);
  globalThis.__writes.length = 0;
  return actor;
}
function hazard({ id = "hazard-source", complex = true, stealth = false } = {}) {
  const actor = new MockActor({
    id,
    type: "hazard",
    name: `Secret ${id}`,
    img: `hazards/${id}.webp`,
    flags: { [M]: { starshipHazard: { isStarshipHazard: true } } },
    system: {
      details: { level: { value: 4 }, isComplex: complex },
      attributes: { hp: { value: 11, max: 30 }, ...(stealth ? { stealth: { value: 8, dc: 18 } } : {}) }
    }
  });
  game.actors.set(actor.id, actor);
  return actor;
}
function inPack(actor) {
  game.actors.delete(actor.id);
  actor.pack = "test.sources";
  const uuid = `Compendium.test.sources.Actor.${actor.id}`;
  Object.defineProperty(actor, "uuid", { get: () => uuid });
  globalThis.__extraUuids.set(uuid, actor);
  return actor;
}
async function populatedEncounter() {
  const pc = makeCharacter({ id: "existing-pc", name: "Existing PC" });
  const oldShip = makeShip({ id: "existing-ship", name: "Existing ship", effects: [{ slug: "keep", modifiers: [] }] });
  const combat = makeStarshipCombat({ objects: [{ key: oldShip.uuid, zone: 3, detection: { party: "identified" } }] });
  await combat.createEmbeddedDocuments("Combatant", [{ actorId: pc.id, initiative: 23, flags: { unrelated: { keep: true } } }]);
  const journal = await JournalEntry.create({ name: "Unrelated journal", ownership: { default: 0 }, flags: { keep: true } });
  const snapshot = {
    flags: structuredClone(combat.flags),
    entries: combatantData(combat),
    ship: oldShip.toObject(),
    journal: structuredClone(journal.flags)
  };
  globalThis.__writes.length = 0;
  return { combat, oldShip, journal, snapshot };
}
function assertExistingSurvives(existing) {
  const { combat, oldShip, journal, snapshot } = existing;
  assert.equal(game.combats.get(combat.id), combat);
  assert.equal(game.combat, combat);
  assert.equal(combat.active, true);
  assert.deepEqual(combat.flags, snapshot.flags);
  assert.deepEqual(combatantData(combat), snapshot.entries);
  assert.deepEqual(oldShip.toObject(), snapshot.ship);
  assert.equal(game.journal.get(journal.id), journal);
  assert.deepEqual(journal.flags, snapshot.journal);
}
function assertCleanFailure(existing, sources, snapshots) {
  assertExistingSurvives(existing);
  assert.equal(game.combats.size, 1);
  assert.equal(game.journal.size, 1);
  sources.forEach((source, i) => {
    assert.deepEqual(source.toObject(), snapshots[i]);
    assert.equal(copiesOf(source).length, 0);
    assert.deepEqual(writesTo(source), []);
  });
  assert.deepEqual(globalThis.__socket, []);
}

for (const kind of ["npc", "hazard"]) {
  test(`${kind}-only count N creates independent Actors including first, provenance and per-copy zones`, async () => {
    await setup();
    const source = kind === "npc" ? await richShip() : hazard();
    if (kind === "hazard")
      await source.createEmbeddedDocuments("Item", [{ _id: "routine", name: "Routine", type: "action", system: { count: 2 } }]);
    const before = source.toObject();
    globalThis.__writes.length = 0;
    const combat = await startStarshipCombat({
      [kind === "npc" ? "enemies" : "hazards"]: [
        { uuid: source.uuid, count: 3, zones: [3, 5, 8], heading: "left", detection: "identified" }
      ]
    });
    const copies = copiesOf(source);
    assert.equal(copies.length, 3);
    assert.equal(new Set(copies.map((actor) => actor.id)).size, 3);
    assert.equal(combat.combatants.size, 3);
    assert.equal(game.actors.size, 4);
    assert.deepEqual(
      getTsc(combat).objects.map((object) => object.zone),
      [3, 5, 8]
    );
    for (const copy of copies) {
      assert.notEqual(copy.uuid, source.uuid);
      assert.equal(copy.flags[M].tacticalCopyOf, source.uuid);
      assert.deepEqual(copy.flags[M].sensorContactInstance, { combatId: combat.id, sourceUuid: source.uuid, privateContact: false });
      assert.deepEqual(copy.system.attributes.hp, source.system.attributes.hp);
      assert.deepEqual(copy.toObject().items, source.toObject().items);
      const entry = combat.combatants.find((c) => c.actorId === copy.id);
      assert.ok(entry);
      assert.equal(entry.hidden, false);
      assert.equal(entry.name, copy.name);
      assert.equal(entry.img, copy.img);
      if (kind === "npc") {
        assert.equal(readStarship(copy).role, "npc");
        assert.notEqual(shipData(copy).crew, shipData(source).crew);
        assert.notEqual(shipData(copy).stations, shipData(source).stations);
        assert.notEqual(shipData(copy).effects, shipData(source).effects);
        assert.notEqual(shipData(copy).sp, shipData(source).sp);
        assert.deepEqual(shipData(copy).sp, shipData(source).sp);
        assert.deepEqual(shipData(copy).effects, shipData(source).effects);
        assert.equal(readStarship(copy).heading, "left");
      }
    }
    await copies[0].update({
      "system.attributes.hp.value": 1,
      ...(kind === "npc" ? { [`flags.${M}.starship.sp.value`]: 0, [`flags.${M}.starship.effects`]: [] } : {})
    });
    copies[0].items.contents[0].system.changed = true;
    assert.deepEqual(copies[1].system.attributes.hp, source.system.attributes.hp);
    assert.deepEqual(copies[1].toObject().items, before.items);
    if (kind === "npc") {
      assert.deepEqual(shipData(copies[1]).sp, before.flags[M].starship.sp);
      assert.deepEqual(shipData(copies[1]).effects, before.flags[M].starship.effects);
    }
    assert.deepEqual(source.toObject(), before);
    assert.deepEqual(writesTo(source), []);
    assert.equal(combat.flags[M].combatSetup, undefined);
  });
}

test("mixed NPC/hazard counts total correctly; simple hazards have no turn", async () => {
  await setup();
  const npc = await richShip(),
    complex = hazard(),
    simple = hazard({ id: "simple", complex: false });
  const combat = await startStarshipCombat({
    enemies: [{ uuid: npc.uuid, count: 2, detection: "identified" }],
    hazards: [
      { uuid: complex.uuid, count: 3, detection: "identified" },
      { uuid: simple.uuid, count: 2, detection: "identified" }
    ]
  });
  assert.equal(getTsc(combat).objects.length, 7);
  assert.equal(combat.combatants.size, 5);
  assert.equal(copiesOf(simple).length, 2);
  for (const copy of copiesOf(simple))
    assert.equal(
      combat.combatants.some((c) => c.actorId === copy.id),
      false
    );
});

test("legacy player UUID strings, positions and detections retain world players and PC data without resets", async () => {
  await setup({ scope: "crew" });
  const pc = makeCharacter({ id: "pilot", name: "Pilot" });
  const source = await richShip({
    role: "player",
    crew: [{ actorUuid: pc.uuid, name: pc.name, role: "crew", stationId: "pilot" }],
    stations: [{ id: "pilot", type: "pilot", helmedBy: pc.uuid, malfunctioning: true, repairLockedUntilTurnOf: pc.uuid }]
  });
  const before = source.toObject(),
    pcBefore = pc.toObject();
  const empty = makeStarshipCombat();
  const combat = await startStarshipCombat({
    playerShips: [source.uuid],
    positions: { [source.uuid]: 7 },
    detections: { [source.uuid]: "hidden" }
  });
  assert.equal(combat, empty);
  assert.equal(game.actors.size, 2);
  assert.equal(getTsc(combat).objects[0].actorUuid, source.uuid);
  assert.equal(getTsc(combat).objects[0].zone, 7);
  assert.equal(getTsc(combat).objects[0].detection.party, "hidden");
  assert.equal(getTsc(combat).objects[0].alwaysVisible, undefined);
  assert.deepEqual(source.toObject(), before);
  assert.deepEqual(pc.toObject(), pcBefore);
  assert.deepEqual(writesTo(source), []);
  assert.deepEqual(writesTo(pc), []);
  assert.equal(combat.combatants.size, 1);
  assert.equal(combat.combatants.contents[0].actorId, pc.id);
});

for (const [role, pack] of [
  ["player", true],
  ["npc", true],
  ["npc", false]
]) {
  test(`${pack ? "compendium" : "world"} ${role} used as player creates one copy and changes only copy role/stations`, async () => {
    await setup({ scope: "crew" });
    const pc = makeCharacter({ id: "new-pilot", name: "New pilot" });
    let source = await richShip({ role, stations: [{ id: "pilot", type: "pilot", helmedBy: null }] });
    if (pack) source = inPack(source);
    const before = source.toObject(),
      pcBefore = pc.toObject();
    const combat = await startStarshipCombat({
      playerShips: [{ uuid: source.uuid, zone: 4, stationAssignments: [{ stationId: "pilot", actorUuid: pc.uuid }] }]
    });
    const [copy] = copiesOf(source);
    assert.equal(copiesOf(source).length, 1);
    assert.equal(copy.pack, null);
    assert.equal(readStarship(copy).role, "player");
    assert.equal(shipData(copy).stations[0].helmedBy, pc.uuid);
    assert.equal(shipData(copy).crew[0].stationId, "pilot");
    assert.deepEqual(copy.system.attributes.hp, source.system.attributes.hp);
    assert.deepEqual(shipData(copy).sp, shipData(source).sp);
    assert.deepEqual(shipData(copy).effects, shipData(source).effects);
    assert.deepEqual(source.toObject(), before);
    assert.deepEqual(pc.toObject(), pcBefore);
    assert.deepEqual(writesTo(source), []);
    assert.equal(getTsc(combat).objects[0].actorUuid, copy.uuid);
    assert.equal(combat.combatants.size, 1);
    assert.equal(combat.combatants.contents[0].actorId, pc.id);
    if (pack) assert.equal(copy.flags[M].contactImport.sourceUuid, source.uuid);
  });
}

test("compendium NPC source stays unchanged and each placement is a world instance", async () => {
  await setup();
  const source = inPack(await richShip());
  const before = source.toObject();
  const combat = await startStarshipCombat({ enemies: [{ uuid: source.uuid, count: 2, detection: "identified" }] });
  assert.equal(copiesOf(source).length, 2);
  assert.equal(game.actors.size, 2);
  assert.equal(combat.combatants.size, 2);
  for (const actor of copiesOf(source)) {
    assert.equal(actor.pack, null);
    assert.equal(actor.flags[M].contactImport.sourceUuid, source.uuid);
  }
  assert.deepEqual(source.toObject(), before);
  assert.deepEqual(writesTo(source), []);
});

for (const kind of ["npc", "hazard"]) {
  for (const detection of ["observed", "hidden", "undetected"]) {
    test(`${detection} private ${kind} has no public identity; Reveal preserves anonymous turn ID`, async () => {
      await setup();
      const source = kind === "npc" ? await richShip({ owners: ["p1"] }) : hazard();
      const before = source.toObject();
      // An empty active encounter exercises the existing private initiative path independently of staging.
      const empty = makeStarshipCombat();
      const combat = await startStarshipCombat({ [kind === "npc" ? "enemies" : "hazards"]: [{ uuid: source.uuid, detection, zone: 5 }] });
      assert.equal(combat, empty);
      const [contact] = privateContacts(combat.id),
        [actor] = copiesOf(source);
      assert.equal(contact.actorUuid, actor.uuid);
      assert.equal(contact.detection.party, detection);
      assert.equal(contact.zone, 5);
      assert.equal(actor.ownership.default, 0);
      assert.equal(actor.testUserPermission(game.users.get("p1"), "LIMITED"), false);
      assert.equal(game.journal.contents[0].testUserPermission(game.users.get("p1"), "LIMITED"), false);
      const publicText = JSON.stringify({ flags: combat.flags, entries: combatantData(combat), socket: globalThis.__socket });
      for (const secret of [source.name, source.img, source.uuid, actor.name, actor.img, actor.uuid])
        assert.equal(publicText.includes(secret), false, `public leak: ${secret}`);
      assert.equal(getTsc(combat).objects.length, detection === "observed" ? 1 : 0);
      const [entry] = combat.combatants.contents;
      assert.ok(entry);
      assert.equal(entry.actorId, actor.id);
      assert.equal(entry.hidden, true);
      assert.equal(entry.name, "Contact");
      assert.equal(entry.img, "icons/svg/mystery-man.svg");
      assert.deepEqual(entry.flags[M], { sensorMapInitiative: { combatId: combat.id, contactDesignation: true } });
      await entry.update({ initiative: 17 });
      const id = entry.id;
      await changePrivateContact(combat, contact.key, "reveal");
      assert.equal(combat.combatants.size, 1);
      assert.equal(combat.combatants.contents[0].id, id);
      assert.equal(entry.initiative, 17);
      assert.equal(entry.hidden, false);
      assert.equal(entry.name, actor.name);
      assert.equal(entry.img, actor.img);
      assert.equal(getTsc(combat).objects[0].actorUuid, actor.uuid);
      assert.equal(privateContacts(combat.id).length, 0);
      assert.deepEqual(source.toObject(), before);
      assert.deepEqual(writesTo(source), []);
    });
  }
}

for (const detection of ["observed", "hidden", "undetected"]) {
  test(`new staged encounter can finish private NPC ${detection} initiative before activation`, async () => {
    await setup();
    const source = await richShip();
    const combat = await startStarshipCombat({ enemies: [{ uuid: source.uuid, detection }] });
    assert.equal(combat.active, true);
    assert.equal(combat.flags[M].combatSetup, undefined);
    assert.equal(privateContacts(combat.id).length, 1);
    assert.equal(combat.combatants.size, 1);
    assert.equal(combat.combatants.contents[0].name, "Contact");
  });
}

for (const detection of ["observed", "hidden", "undetected"]) {
  test(`explicit ${detection} custom object retains private art/type through Reveal`, async () => {
    await setup();
    const combat = await startStarshipCombat({
      objects: [{ name: "Secret moon", type: "planet", art: "secret/moon.webp", detection, zone: 6 }]
    });
    const [contact] = privateContacts(combat.id);
    assert.equal(contact.objectType, "planet");
    assert.equal(contact.art, "secret/moon.webp");
    const publicText = JSON.stringify(combat.flags);
    for (const secret of ["Secret moon", "secret/moon.webp", "planet"]) assert.equal(publicText.includes(secret), false);
    assert.equal(getTsc(combat).objects.length, detection === "observed" ? 1 : 0);
    assert.equal(combat.combatants.size, 0);
    await changePrivateContact(combat, contact.key, "reveal");
    assert.equal(privateContacts(combat.id).length, 0);
    const [object] = getTsc(combat).objects;
    assert.equal(object.type, "planet");
    assert.equal(object.art, "secret/moon.webp");
    assert.equal(object.name, "Secret moon");
    assert.equal(object.zone, 6);
    assert.equal(object.detection.party, "identified");
  });
}

test("legacy object without explicit detection keeps artwork; explicit identified object is public", async () => {
  await setup();
  const combat = await startStarshipCombat({
    objects: [
      { name: "Legacy moon", type: "planet", art: "moon.webp", zone: 5 },
      { name: "Beacon", type: "beacon", art: "beacon.webp", detection: "identified", zone: 7 }
    ]
  });
  assert.equal(privateContacts(combat.id).length, 0);
  assert.deepEqual(
    getTsc(combat).objects.map((o) => [o.name, o.type, o.art, o.detection.party]),
    [
      ["Legacy moon", "planet", "moon.webp", "observed"],
      ["Beacon", "beacon", "beacon.webp", "identified"]
    ]
  );
});

for (const kind of ["npc", "hazard"]) {
  test(`single identified world ${kind} explicit reuse reuses same role without source writes`, async () => {
    await setup();
    const source = kind === "npc" ? await richShip() : hazard();
    const before = source.toObject();
    const combat = await startStarshipCombat({
      [kind === "npc" ? "enemies" : "hazards"]: [{ uuid: source.uuid, reuse: true, detection: "identified" }]
    });
    assert.equal(copiesOf(source).length, 0);
    assert.equal(getTsc(combat).objects[0].actorUuid, source.uuid);
    assert.equal(combat.combatants.contents[0].actorId, source.id);
    assert.deepEqual(source.toObject(), before);
    assert.deepEqual(writesTo(source), []);
  });
}

for (const variant of ["count", "pack", "role", "observed", "hidden", "undetected", "token"]) {
  test(`explicit reuse refuses ${variant} before any writes`, async () => {
    await setup();
    let source = await richShip({ role: variant === "role" ? "player" : "npc" });
    if (variant === "pack") source = inPack(source);
    if (variant === "token") source.isToken = true;
    const before = source.toObject();
    await assert.rejects(
      startStarshipCombat({
        enemies: [
          {
            uuid: source.uuid,
            reuse: true,
            count: variant === "count" ? 2 : 1,
            detection: ["observed", "hidden", "undetected"].includes(variant) ? variant : "identified"
          }
        ]
      })
    );
    assert.deepEqual(globalThis.__writes, []);
    assert.deepEqual(source.toObject(), before);
    assert.equal(game.combats.size, 0);
  });
}

test("new populated encounter remains active until complete staged setup; marker starts at creation and is removed on success", async (t) => {
  await setup({ scope: "crew" });
  const existing = await populatedEncounter();
  const pc = makeCharacter({ id: "setup-pc", name: "Setup PC" });
  const source = await richShip();
  const created = [],
    started = [];
  Hooks.on("createCombat", (combat) => {
    created.push(combat);
    assert.equal(combat.active, false);
    assert.equal(combat.flags[M].combatSetup, true);
    assert.equal(game.combat, existing.combat);
  });
  Hooks.on("createActor", (actor) => {
    assert.equal(game.combats.get(actor.flags[M].sensorContactInstance.combatId).flags[M].combatSetup, true);
    assert.equal(game.combat, existing.combat);
  });
  Hooks.on(HOOK_EVENTS.combatStarted, (combat) => started.push([combat.id, combat.flags[M].combatSetup]));
  const gate = deferred(),
    reached = deferred();
  const activate = MockCombat.prototype.activate;
  t.mock.method(MockCombat.prototype, "activate", async function () {
    assert.equal(this.active, false);
    assert.equal(this.flags[M].combatSetup, true);
    assert.equal(getTsc(this).objects.length, 1);
    assert.equal(this.combatants.size, 2);
    reached.resolve();
    await gate.promise;
    return activate.call(this);
  });
  const pending = startStarshipCombat({ enemies: [{ uuid: source.uuid, detection: "identified" }], crew: [pc.uuid] });
  try {
    await Promise.race([reached.promise, pending]);
    assertExistingSurvives(existing);
    assert.equal(created.length, 1);
    assert.deepEqual(started, []);
  } finally {
    gate.resolve();
  }
  const combat = await pending;
  assert.notEqual(combat, existing.combat);
  assert.equal(game.combat, combat);
  assert.equal(combat.active, true);
  assert.equal(existing.combat.active, false);
  assert.equal(combat.flags[M].combatSetup, undefined);
  assert.deepEqual(started, [[combat.id, undefined]]);
  assert.deepEqual(globalThis.__hookErrors, []);
  assert.deepEqual(combatantData(existing.combat), existing.snapshot.entries);
  assert.deepEqual(existing.oldShip.toObject(), existing.snapshot.ship);
});

test("setup marker guards auto-detect, turn processing and end cleanup hooks", async () => {
  await setup();
  const source = await richShip({ role: "player" });
  const before = source.toObject();
  registerCombatHooks();
  const staging = await Combat.create({ active: false, flags: { [M]: { combatSetup: true } } });
  await staging.createEmbeddedDocuments("Combatant", [{ actorId: source.id }]);
  await setImmediate();
  assert.equal(staging.flags[M].tsc, undefined, "auto-detect must not initialize staged state");
  const empty = makeStarshipCombat({ objects: [{ key: source.uuid, zone: 3 }] });
  empty.flags[M].combatSetup = true;
  const flags = structuredClone(empty.flags);
  globalThis.__writes.length = 0;
  Hooks.callAll("updateCombat", empty, { turn: 1, round: 2 });
  Hooks.callAll("deleteCombat", empty);
  await setImmediate();
  assert.deepEqual(empty.flags, flags);
  assert.deepEqual(source.toObject(), before);
  assert.deepEqual(globalThis.__writes, []);
});

test("station assignments add/release crew, mirror both sides, leave HP/SP/effects and PCs alone", async () => {
  await setup({ scope: "crew" });
  const old = makeCharacter({ id: "old", name: "Old pilot" }),
    fresh = makeCharacter({ id: "fresh", name: "New pilot" }),
    extra = makeCharacter({ id: "extra", name: "Extra" });
  const source = await richShip({
    role: "player",
    crew: [{ actorUuid: old.uuid, name: old.name, role: "crew", stationId: "pilot" }],
    stations: [
      { id: "pilot", type: "pilot", helmedBy: old.uuid, autoHelmed: true },
      { id: "gunner", type: "gunner" }
    ]
  });
  const before = source.toObject(),
    pcBefore = [old, fresh, extra].map((pc) => pc.toObject());
  const combat = await startStarshipCombat({
    playerShips: [
      {
        uuid: source.uuid,
        heading: "left",
        stationAssignments: [
          { stationId: "pilot", actorUuid: null },
          { stationId: "gunner", actorUuid: fresh.uuid }
        ]
      }
    ],
    crew: [extra.uuid, fresh.uuid],
    excludeCrew: [old.uuid]
  });
  const data = shipData(source);
  assert.equal(data.stations[0].helmedBy, null);
  assert.equal(data.stations[0].autoHelmed, false);
  assert.equal(data.stations[1].helmedBy, fresh.uuid);
  assert.equal(data.crew.find((c) => c.actorUuid === old.uuid).stationId, null);
  assert.equal(data.crew.find((c) => c.actorUuid === fresh.uuid).stationId, "gunner");
  assert.equal(new Set(data.crew.map((c) => c.actorUuid)).size, data.crew.length);
  assert.deepEqual(combat.combatants.map((c) => c.actorId).sort(), [fresh.id, extra.id].sort());
  assert.deepEqual(source.system, before.system);
  assert.deepEqual(data.sp, before.flags[M].starship.sp);
  assert.deepEqual(data.effects, before.flags[M].starship.effects);
  assert.equal(data.heading, before.flags[M].starship.heading);
  assert.equal(writesTo(source).length, 1);
  assert.deepEqual(Object.keys(writesTo(source)[0].changes).sort(), [`flags.${M}.starship.crew`, `flags.${M}.starship.stations`].sort());
  [old, fresh, extra].forEach((pc, i) => assert.deepEqual(pc.toObject(), pcBefore[i]));
});

test("existing crew shared by legacy player ships and extra list produces only one PC Combatant", async () => {
  await setup({ scope: "crew" });
  const pc = makeCharacter({ id: "shared", name: "Shared legacy crew" });
  const crew = [{ actorUuid: pc.uuid, name: pc.name, role: "crew", stationId: null }];
  const a = makeShip({ id: "a", crew }),
    b = makeShip({ id: "b", crew });
  const before = [a.toObject(), b.toObject(), pc.toObject()];
  const combat = await startStarshipCombat({ playerShips: [a.uuid, b.uuid], crew: [pc.uuid, pc.uuid] });
  assert.equal(combat.combatants.size, 1);
  assert.equal(combat.combatants.contents[0].actorId, pc.id);
  [a, b, pc].forEach((actor, i) => assert.deepEqual(actor.toObject(), before[i]));
});

const invalidCases = [
  ["missing source", (s) => ({ playerShips: [s.uuid, "Actor.missing"] })],
  ["ordinary nonship source", () => ({ playerShips: [makeCharacter({ id: "not-ship", name: "PC" }).uuid] })],
  ["missing station", (s, pc) => ({ playerShips: [{ uuid: s.uuid, stationAssignments: [{ stationId: "missing", actorUuid: pc.uuid }] }] })],
  [
    "missing assignment crew",
    (s) => ({ playerShips: [{ uuid: s.uuid, stationAssignments: [{ stationId: "pilot", actorUuid: "Actor.missing" }] }] })
  ],
  ["missing extra crew", (s) => ({ playerShips: [s.uuid], crew: ["Actor.missing"] })],
  [
    "duplicate station",
    (s, pc) => ({
      playerShips: [
        {
          uuid: s.uuid,
          stationAssignments: [
            { stationId: "pilot", actorUuid: pc.uuid },
            { stationId: "pilot", actorUuid: null }
          ]
        }
      ]
    })
  ],
  [
    "same crew at two stations",
    (s, pc) => ({
      playerShips: [
        {
          uuid: s.uuid,
          stationAssignments: [
            { stationId: "pilot", actorUuid: pc.uuid },
            { stationId: "gunner", actorUuid: pc.uuid }
          ]
        }
      ]
    })
  ],
  [
    "observer assigned",
    (s, pc) => {
      shipData(s).crew = [{ actorUuid: pc.uuid, name: pc.name, role: "observer" }];
      return { playerShips: [{ uuid: s.uuid, stationAssignments: [{ stationId: "pilot", actorUuid: pc.uuid }] }] };
    }
  ],
  ["duplicate reused player", (s) => ({ playerShips: [s.uuid, s.uuid] })],
  ["out-of-map zone", (s) => ({ playerShips: [{ uuid: s.uuid, zone: 13 }], zones: 12 })],
  ["empty roster", () => ({})],
  ["blank roster entry beside valid source", (s) => ({ playerShips: [s.uuid, {}] })],
  ["blank station ID", (s, pc) => ({ playerShips: [{ uuid: s.uuid, stationAssignments: [{ stationId: "", actorUuid: pc.uuid }] }] })],
  [
    "missing stored crew",
    (s) => {
      shipData(s).crew = [{ actorUuid: "Actor.missing", name: "Missing", role: "crew" }];
      return { playerShips: [s.uuid] };
    }
  ]
];
for (const [name, config] of invalidCases) {
  test(`invalid ${name} rejects before any document writes`, async () => {
    await setup({ scope: "crew" });
    const pc = makeCharacter({ id: "crew", name: "Crew" });
    const source = await richShip({
      role: "player",
      stations: [
        { id: "pilot", type: "pilot" },
        { id: "gunner", type: "gunner" }
      ]
    });
    const input = config(source, pc),
      before = source.toObject();
    await assert.rejects(startStarshipCombat(input));
    assert.deepEqual(globalThis.__writes, [], "invalid input must not write then roll back a partial roster");
    assert.deepEqual(source.toObject(), before);
    assert.equal(game.combats.size, 0);
    assert.equal(game.journal.size, 0);
  });
}

test("service double-submit guard rejects a second call while source resolution is deferred", async (t) => {
  await setup();
  const source = await richShip();
  const resolve = fromUuid,
    gate = deferred(),
    reached = deferred();
  t.mock.method(globalThis, "fromUuid", async (uuid) => {
    reached.resolve();
    await gate.promise;
    return resolve(uuid);
  });
  const input = { enemies: [{ uuid: source.uuid, detection: "identified" }] };
  const first = startStarshipCombat(input);
  try {
    await reached.promise;
    await assert.rejects(startStarshipCombat(input));
    assert.deepEqual(globalThis.__writes, []);
  } finally {
    gate.resolve();
  }
  const combat = await first;
  assert.equal(game.combats.size, 1);
  assert.equal(combat.combatants.size, 1);
  assert.equal(copiesOf(source).length, 1);
});

for (const operation of [
  "Actor create",
  "Combat create",
  "saveTsc update",
  "partial Combatant create",
  "crew create",
  "activation",
  "private journal then activation"
]) {
  test(`${operation} failure cleans owned startup documents and preserves populated combat/source docs`, async (t) => {
    await setup({ scope: "crew" });
    const existing = await populatedEncounter();
    const npc = await richShip();
    const player = await richShip({ id: "player-source", role: "player" });
    const pc = makeCharacter({ id: "new-crew", name: "New crew" });
    const sources = [npc, player],
      snapshots = sources.map((s) => s.toObject());
    const failure = new Error(`injected ${operation}`);
    const cfg = { enemies: [{ uuid: npc.uuid, count: 2, detection: "identified" }], playerShips: [player.uuid], crew: [pc.uuid] };
    let injected = false;
    if (operation === "Actor create") {
      const create = Actor.create;
      let calls = 0;
      t.mock.method(Actor, "create", async (...args) => {
        if (++calls === 2) {
          injected = true;
          throw failure;
        }
        return create(...args);
      });
    } else if (operation === "Combat create") {
      t.mock.method(MockCombat, "create", async () => {
        injected = true;
        throw failure;
      });
    } else if (operation === "saveTsc update") {
      const update = MockCombat.prototype.update;
      t.mock.method(MockCombat.prototype, "update", async function (changes) {
        if (!injected && this !== existing.combat && Object.hasOwn(changes, `flags.${M}.tsc`)) {
          injected = true;
          throw failure;
        }
        return update.call(this, changes);
      });
    } else if (["partial Combatant create", "crew create"].includes(operation)) {
      const create = MockCombat.prototype.createEmbeddedDocuments;
      t.mock.method(MockCombat.prototype, "createEmbeddedDocuments", async function (type, docs) {
        if (!injected && this !== existing.combat && (operation !== "crew create" || docs.some((d) => d.actorId === pc.id))) {
          injected = true;
          await create.call(this, type, docs.slice(0, 1));
          throw failure;
        }
        return create.call(this, type, docs);
      });
    } else {
      if (operation === "private journal then activation")
        cfg.objects = [{ name: "Secret anomaly", type: "custom", detection: "observed", zone: 6 }];
      const activate = MockCombat.prototype.activate;
      t.mock.method(MockCombat.prototype, "activate", async function () {
        if (this === existing.combat) return activate.call(this);
        injected = true;
        if (operation === "private journal then activation") assert.equal(privateContacts(this.id).length, 1);
        throw failure;
      });
    }
    await assert.rejects(startStarshipCombat(cfg), (error) => {
      assert.equal(error, failure, "successful cleanup rethrows original failure, not AggregateError");
      return true;
    });
    assert.equal(injected, true);
    assertCleanFailure(existing, sources, snapshots);
    assert.deepEqual(writesTo(pc), []);
  });
}

test("failure on reused empty combat restores exactly its original flags and no owned copies survive", async (t) => {
  await setup();
  const npc = await richShip();
  const combat = makeStarshipCombat();
  combat.flags.unrelated = { keep: true };
  const before = structuredClone(combat.flags);
  const create = combat.createEmbeddedDocuments.bind(combat);
  t.mock.method(combat, "createEmbeddedDocuments", async (...args) => {
    await create(...args);
    throw new Error("partial create");
  });
  await assert.rejects(startStarshipCombat({ enemies: [{ uuid: npc.uuid, detection: "identified" }] }), /partial create/);
  assert.equal(game.combat, combat);
  assert.equal(game.combats.size, 1);
  assert.deepEqual(combat.flags, before);
  assert.equal(combat.combatants.size, 0);
  assert.equal(copiesOf(npc).length, 0);
});

for (const cleanupOperation of ["Combatant delete", "Journal delete", "Combat delete", "Actor delete"]) {
  test(`cleanup ${cleanupOperation} failure raises AggregateError and retains remaining owned docs`, async (t) => {
    await setup();
    const existing = await populatedEncounter(),
      npc = await richShip();
    const before = npc.toObject();
    const original = new Error("startup activation failed"),
      cleanupError = new Error(`injected ${cleanupOperation}`);
    let failedCombat;
    const activate = MockCombat.prototype.activate;
    t.mock.method(MockCombat.prototype, "activate", async function () {
      if (this === existing.combat) return activate.call(this);
      failedCombat = this;
      throw original;
    });
    if (cleanupOperation === "Combatant delete") {
      const remove = MockCombat.prototype.deleteEmbeddedDocuments;
      t.mock.method(MockCombat.prototype, "deleteEmbeddedDocuments", async function (...args) {
        if (this !== existing.combat) throw cleanupError;
        return remove.apply(this, args);
      });
    } else if (cleanupOperation === "Journal delete") {
      const remove = JournalEntry.prototype.delete;
      t.mock.method(JournalEntry.prototype, "delete", async function () {
        if (this !== existing.journal) throw cleanupError;
        return remove.call(this);
      });
    } else if (cleanupOperation === "Combat delete") {
      t.mock.method(MockCombat.prototype, "delete", async function () {
        throw cleanupError;
      });
    } else {
      const remove = MockActor.prototype.delete;
      t.mock.method(MockActor.prototype, "delete", async function () {
        if (this.flags[M]?.sensorContactInstance) throw cleanupError;
        return remove.call(this);
      });
    }
    await assert.rejects(
      startStarshipCombat({
        enemies: [{ uuid: npc.uuid, detection: "identified" }],
        objects: [{ name: "Secret custom", detection: "observed", zone: 5 }]
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], original);
        assert.ok(error.errors.includes(cleanupError));
        return true;
      }
    );
    assertExistingSurvives(existing);
    assert.deepEqual(npc.toObject(), before);
    assert.equal(copiesOf(npc).length, 1);
    if (cleanupOperation !== "Actor delete") {
      assert.equal(game.combats.get(failedCombat.id), failedCombat);
      assert.equal(failedCombat.flags[M].combatSetup, true);
    }
    if (cleanupOperation === "Combatant delete") assert.equal(failedCombat.combatants.size, 1);
    if (cleanupOperation === "Journal delete") assert.equal(game.journal.size, 2);
    assert.deepEqual(globalThis.__socket, []);
  });
}

test("rollback only restores startup crew/stations, never unrelated concurrent HP/SP/effect changes", async (t) => {
  await setup({ scope: "crew" });
  const existing = await populatedEncounter();
  const pc = makeCharacter({ id: "assigned", name: "Assigned crew" });
  const player = await richShip({ role: "player", stations: [{ id: "pilot", type: "pilot", helmedBy: null }] });
  const before = player.toObject();
  const activate = MockCombat.prototype.activate;
  t.mock.method(MockCombat.prototype, "activate", async function () {
    if (this === existing.combat) return activate.call(this);
    await player.update({
      "system.attributes.hp.value": 3,
      [`flags.${M}.starship.sp.value`]: 2,
      [`flags.${M}.starship.effects`]: [{ slug: "concurrent", modifiers: [] }]
    });
    throw new Error("activation failed");
  });
  await assert.rejects(
    startStarshipCombat({ playerShips: [{ uuid: player.uuid, stationAssignments: [{ stationId: "pilot", actorUuid: pc.uuid }] }] }),
    /activation failed/
  );
  assertExistingSurvives(existing);
  assert.deepEqual(shipData(player).crew, before.flags[M].starship.crew);
  assert.deepEqual(shipData(player).stations, before.flags[M].starship.stations);
  assert.equal(player.system.attributes.hp.value, 3);
  assert.equal(shipData(player).sp.value, 2);
  assert.equal(shipData(player).effects[0].slug, "concurrent");
  assert.equal(game.combats.size, 1);
  const rollback = writesTo(player).at(-1).changes;
  assert.deepEqual(Object.keys(rollback).sort(), [`flags.${M}.starship.crew`, `flags.${M}.starship.stations`].sort());
});

test("concurrent crew/station edit causes cleanup conflict instead of overwriting it; owned copies remain", async (t) => {
  await setup({ scope: "crew" });
  const existing = await populatedEncounter();
  const pc = makeCharacter({ id: "assigned", name: "Assigned crew" }),
    concurrent = makeCharacter({ id: "concurrent", name: "Concurrent crew" });
  const npc = await richShip(),
    player = await richShip({ id: "player-source", role: "player", stations: [{ id: "pilot", type: "pilot", helmedBy: null }] });
  const original = new Error("activation failed");
  let changed;
  const activate = MockCombat.prototype.activate;
  t.mock.method(MockCombat.prototype, "activate", async function () {
    if (this === existing.combat) return activate.call(this);
    const crew = structuredClone(shipData(player).crew),
      stations = structuredClone(shipData(player).stations);
    crew.push({ actorUuid: concurrent.uuid, name: concurrent.name, role: "crew", stationId: "pilot" });
    crew.find((c) => c.actorUuid === pc.uuid).stationId = null;
    stations[0].helmedBy = concurrent.uuid;
    await player.update({ [`flags.${M}.starship.crew`]: crew, [`flags.${M}.starship.stations`]: stations });
    changed = { crew, stations };
    throw original;
  });
  await assert.rejects(
    startStarshipCombat({
      enemies: [{ uuid: npc.uuid, detection: "identified" }],
      playerShips: [{ uuid: player.uuid, stationAssignments: [{ stationId: "pilot", actorUuid: pc.uuid }] }]
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], original);
      assert.ok(error.errors.length > 1);
      return true;
    }
  );
  assertExistingSurvives(existing);
  assert.deepEqual({ crew: shipData(player).crew, stations: shipData(player).stations }, changed);
  assert.equal(copiesOf(npc).length, 1);
  assert.equal(game.combats.size, 2);
  assert.equal(game.combats.find((c) => c !== existing.combat).flags[M].combatSetup, true);
});

for (const operation of ["persisted Actor create", "persisted Combat create", "persisted saveTsc update", "activation after applied"]) {
  test(`${operation} rejection still cleans only owned startup mutations`, async (t) => {
    await setup();
    const existing = await populatedEncounter(),
      source = await richShip();
    const before = source.toObject(),
      failure = new Error(`injected ${operation}`);
    let injected = false;
    if (operation === "persisted Actor create") {
      const create = Actor.create;
      t.mock.method(Actor, "create", async (...args) => {
        await create(...args);
        injected = true;
        throw failure;
      });
    } else if (operation === "persisted Combat create") {
      const create = Combat.create;
      t.mock.method(Combat, "create", async (...args) => {
        await create(...args);
        injected = true;
        throw failure;
      });
    } else if (operation === "persisted saveTsc update") {
      const update = MockCombat.prototype.update;
      t.mock.method(MockCombat.prototype, "update", async function (changes) {
        const result = await update.call(this, changes);
        if (!injected && this !== existing.combat && Object.hasOwn(changes, `flags.${M}.tsc`)) {
          injected = true;
          throw failure;
        }
        return result;
      });
    } else {
      const activate = MockCombat.prototype.activate;
      t.mock.method(MockCombat.prototype, "activate", async function () {
        const result = await activate.call(this);
        if (this !== existing.combat) {
          injected = true;
          throw failure;
        }
        return result;
      });
    }
    await assert.rejects(startStarshipCombat({ enemies: [{ uuid: source.uuid, detection: "identified" }] }), (error) => {
      assert.equal(error, failure);
      return true;
    });
    assert.equal(injected, true);
    assertCleanFailure(existing, [source], [before]);
  });
}

for (const applied of [false, true]) {
  test(`crew/station update ${applied ? "after" : "before"} applied failure restores startup assignments without source resource writes`, async (t) => {
    await setup({ scope: "crew" });
    const existing = await populatedEncounter();
    const pc = makeCharacter({ id: "assigned", name: "Assigned" });
    const source = await richShip({ role: "player", stations: [{ id: "pilot", type: "pilot", helmedBy: null }] });
    const before = source.toObject(),
      update = source.update.bind(source),
      failure = new Error("assignment update failed");
    let injected = false;
    t.mock.method(source, "update", async (changes) => {
      if (!injected && Object.hasOwn(changes, `flags.${M}.starship.crew`)) {
        injected = true;
        if (applied) await update(changes);
        throw failure;
      }
      return update(changes);
    });
    await assert.rejects(
      startStarshipCombat({ playerShips: [{ uuid: source.uuid, stationAssignments: [{ stationId: "pilot", actorUuid: pc.uuid }] }] }),
      (error) => {
        assert.equal(error, failure);
        return true;
      }
    );
    assert.equal(injected, true);
    assertExistingSurvives(existing);
    assert.deepEqual(source.toObject(), before);
    for (const write of writesTo(source))
      assert.deepEqual(Object.keys(write.changes).sort(), [`flags.${M}.starship.crew`, `flags.${M}.starship.stations`].sort());
    assert.equal(game.combats.size, 1);
  });
}

test("unchanged station assignment does not normalize or reset the reused player source", async () => {
  await setup({ scope: "crew" });
  const pc = makeCharacter({ id: "pilot", name: "Pilot" });
  const source = await richShip({
    role: "player",
    crew: [{ actorUuid: pc.uuid, name: pc.name, role: "crew", stationId: "pilot", custom: "retain" }],
    stations: [{ id: "pilot", type: "pilot", helmedBy: pc.uuid, malfunctioning: true, custom: "retain" }]
  });
  const before = source.toObject();
  const combat = await startStarshipCombat({
    playerShips: [{ uuid: source.uuid, stationAssignments: [{ stationId: "pilot", actorUuid: pc.uuid }] }]
  });
  assert.deepEqual(source.toObject(), before);
  assert.deepEqual(writesTo(source), []);
  assert.equal(combat.combatants.contents[0].actorId, pc.id);
});

for (const kind of ["npc", "hazard"]) {
  test(`${kind} omitted detection still defaults to private independent instances`, async () => {
    await setup();
    const source = kind === "npc" ? await richShip() : hazard({ stealth: true });
    const before = source.toObject();
    makeStarshipCombat();
    const combat = await startStarshipCombat({
      [kind === "npc" ? "enemies" : "hazards"]: [{ uuid: source.uuid, count: 2, zones: [4, 9] }]
    });
    assert.equal(copiesOf(source).length, 2);
    const contacts = privateContacts(combat.id);
    assert.deepEqual(
      contacts.map((contact) => contact.zone),
      [4, 9]
    );
    assert.deepEqual(
      contacts.map((contact) => contact.detection.party),
      [kind === "npc" ? "observed" : "undetected", kind === "npc" ? "observed" : "undetected"]
    );
    assert.equal(combat.combatants.size, 2);
    assert.deepEqual(source.toObject(), before);
    assert.deepEqual(writesTo(source), []);
  });
}

for (const nonempty of ["combatants", "objects"]) {
  test(`existing ${nonempty}-only encounter is not reused or overwritten`, async () => {
    await setup();
    const pc = makeCharacter({ id: "existing-pc", name: "Existing PC" });
    const old = makeStarshipCombat({ objects: nonempty === "objects" ? [{ key: "marker", name: "Existing marker", zone: 5 }] : [] });
    if (nonempty === "combatants") await old.createEmbeddedDocuments("Combatant", [{ actorId: pc.id, initiative: 13 }]);
    const before = structuredClone(old.flags),
      entries = combatantData(old);
    const source = await richShip();
    const combat = await startStarshipCombat({ enemies: [{ uuid: source.uuid, detection: "identified" }] });
    assert.notEqual(combat, old);
    assert.deepEqual(old.flags, before);
    assert.deepEqual(combatantData(old), entries);
    assert.equal(game.combats.size, 2);
  });
}

test("legacy enemy and hazard UUID strings create independent private placements", async () => {
  await setup();
  const npc = await richShip(),
    threat = hazard();
  makeStarshipCombat();
  const combat = await startStarshipCombat({ enemies: [npc.uuid], hazards: [threat.uuid] });
  assert.equal(copiesOf(npc).length, 1);
  assert.equal(copiesOf(threat).length, 1);
  assert.equal(privateContacts(combat.id).length, 2);
  assert.equal(combat.combatants.size, 2);
  assert.equal(
    combat.combatants.some((c) => c.actorId === npc.id || c.actorId === threat.id),
    false
  );
});

test("vetoed rollback marker removal reports incomplete cleanup and retains owned copies", async (t) => {
  await setup();
  const source = await richShip();
  const combat = makeStarshipCombat();
  const create = MockCombat.prototype.createEmbeddedDocuments;
  t.mock.method(MockCombat.prototype, "createEmbeddedDocuments", async function (...args) {
    await create.apply(this, args);
    throw new Error("partial entry creation");
  });
  const update = MockCombat.prototype.update;
  t.mock.method(MockCombat.prototype, "update", async function (changes) {
    if (Object.hasOwn(changes, `flags.${M}.-=combatSetup`)) return this;
    return update.call(this, changes);
  });
  await assert.rejects(startStarshipCombat({ enemies: [{ uuid: source.uuid, detection: "identified" }] }), AggregateError);
  assert.equal(combat.flags[M].combatSetup, true);
  assert.equal(copiesOf(source).length, 1);
  assert.deepEqual(globalThis.__socket, []);
});

test("concurrent station changes during crew resolution are rejected before overwriting original data", async (t) => {
  await setup();
  const pc = makeCharacter({ id: "assigned", name: "Assigned" });
  const player = await richShip({ role: "player", stations: [{ id: "pilot", type: "pilot", helmedBy: null }] });
  const resolve = globalThis.fromUuid;
  let calls = 0,
    changed;
  t.mock.method(globalThis, "fromUuid", async (uuid) => {
    if (uuid === pc.uuid && ++calls === 2) {
      const stations = structuredClone(shipData(player).stations);
      stations[0].name = "Concurrent station name";
      await player.update({ [`flags.${M}.starship.stations`]: stations });
      changed = structuredClone(shipData(player));
    }
    return resolve(uuid);
  });
  await assert.rejects(
    startStarshipCombat({ playerShips: [{ uuid: player.uuid, stationAssignments: [{ stationId: "pilot", actorUuid: pc.uuid }] }] }),
    /Encounter data changed/
  );
  assert.ok(changed);
  assert.deepEqual(shipData(player), changed);
  assert.equal(writesTo(player).length, 1);
  assert.equal(game.combats.size, 0);
});

test("authority loss during activation prevents setup completion and cleans staged documents", async (t) => {
  await setup();
  const source = await richShip();
  const activate = MockCombat.prototype.activate;
  t.mock.method(MockCombat.prototype, "activate", async function () {
    await activate.call(this);
    game.user = game.users.get("p1");
    return this;
  });
  await assert.rejects(startStarshipCombat({ enemies: [{ uuid: source.uuid, detection: "identified" }] }), /active GM/);
  assert.equal(game.combats.size, 0);
  assert.equal(copiesOf(source).length, 0);
  assert.deepEqual(globalThis.__socket, []);
});

test("active setup marker rejects a new request without altering preexisting docs", async () => {
  await setup();
  const source = await richShip();
  const combat = makeStarshipCombat();
  combat.flags[M].combatSetup = true;
  const before = structuredClone(combat.flags);
  await assert.rejects(startStarshipCombat({ enemies: [{ uuid: source.uuid, detection: "identified" }] }));
  assert.deepEqual(globalThis.__writes, []);
  assert.deepEqual(combat.flags, before);
  assert.equal(copiesOf(source).length, 0);
});

for (const kind of ["npc", "hazard"]) {
  test(`partial Combatant create for explicitly reused ${kind} rolls back the entry, not its source`, async (t) => {
    await setup();
    const source = kind === "npc" ? await richShip() : hazard();
    const before = source.toObject(),
      combat = makeStarshipCombat(),
      flags = structuredClone(combat.flags);
    const create = combat.createEmbeddedDocuments.bind(combat);
    t.mock.method(combat, "createEmbeddedDocuments", async (...args) => {
      await create(...args);
      throw new Error("partial reused Combatant create");
    });
    await assert.rejects(
      startStarshipCombat({ [kind === "npc" ? "enemies" : "hazards"]: [{ uuid: source.uuid, detection: "identified", reuse: true }] }),
      /partial reused Combatant create/
    );
    assert.equal(game.combat, combat);
    assert.equal(combat.combatants.size, 0);
    assert.deepEqual(combat.flags, flags);
    assert.deepEqual(source.toObject(), before);
    assert.deepEqual(writesTo(source), []);
    assert.equal(game.actors.get(source.id), source);
  });
}

test("failure does not leave startup contacts in a preexisting private JournalEntry", async (t) => {
  await setup();
  const source = await richShip(),
    combat = makeStarshipCombat();
  const key = await addPrivateCustom(combat, "Preexisting secret", 2);
  const journal = game.journal.contents[0],
    before = structuredClone(journal.flags);
  const create = MockCombat.prototype.createEmbeddedDocuments;
  t.mock.method(MockCombat.prototype, "createEmbeddedDocuments", async function (...args) {
    await create.apply(this, args);
    throw new Error("partial private initiative");
  });
  await assert.rejects(startStarshipCombat({ enemies: [{ uuid: source.uuid, detection: "hidden" }] }));
  assert.equal(game.journal.get(journal.id), journal);
  assert.equal(copiesOf(source).length, 0);
  assert.equal(combat.combatants.size, 0);
  assert.deepEqual(journal.flags, before, "retain old contacts without dangling startup actor references");
  assert.equal(privateContacts(combat.id)[0].key, key);
});
