import test from "node:test";
import assert from "node:assert/strict";
import { modifyOwnedMine } from "../../scripts/actions/mine-modification.mjs";
import { mineModificationStatus } from "../../scripts/actions/mine-modification-timing.mjs";
import { mineResolutionPlan, moveOwnedMine } from "../../scripts/actions/mine-resolution.mjs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

function fixture() {
  const operator = {
    uuid: "Actor.operator",
    name: "Operator",
    system: { details: { level: { value: 3 } }, abilities: { int: { mod: 4 } } },
    classDC: { dc: { value: 19 } }
  };
  const mine = {
    id: "m1",
    droneId: "d1",
    shipUuid: "Actor.ship",
    operatorUuid: operator.uuid,
    combatId: "c",
    zone: 3,
    state: "armed",
    legacy: { keep: true }
  };
  const data = {
    stations: [{ id: "s1", type: "drone-console", helmedBy: operator.uuid }],
    drones: [
      { id: "d1", stationId: "s1", tscVersion: 1, ref: "pyrotechnics-drone", deployed: true, mines: [mine, { id: "m2", untouched: true }] }
    ]
  };
  const combat = {
    id: "c",
    round: 1,
    turn: 1,
    turns: [
      { id: "a", actor: { uuid: "Actor.other" } },
      { id: "op", actor: operator },
      { id: "b", actor: { uuid: "Actor.third" } }
    ]
  };
  return {
    data,
    shipUuid: "Actor.ship",
    stationId: "s1",
    droneId: "d1",
    mineId: "m1",
    operator,
    combat,
    shipZone: 3,
    origin: 3,
    type: "smart",
    modificationId: "mineMod-abcdefgh",
    sensorRange: 3,
    combatId: "c"
  };
}

test("Smart is individual, preserves unknown fields, and expires at end of next operator turn", () => {
  const f = fixture();
  const m = f.data.drones[0].mines[0];
  assert.equal(modifyOwnedMine(f), true);
  assert.deepEqual(m.legacy, { keep: true });
  assert.deepEqual(f.data.drones[0].mines[1], { id: "m2", untouched: true });
  assert.equal(mineModificationStatus(m, f.combat, f.operator.uuid), "smart");
  assert.equal(mineResolutionPlan(f).modification, "smart");
  f.combat.turn = 2;
  assert.equal(mineModificationStatus(m, f.combat, f.operator.uuid), "smart");
  f.combat.round = 2;
  f.combat.turn = 0;
  assert.equal(mineModificationStatus(m, f.combat, f.operator.uuid), "smart");
  f.combat.turn = 1;
  assert.equal(mineModificationStatus(m, f.combat, f.operator.uuid), "smart");
  f.combat.turn = 2;
  assert.equal(mineModificationStatus(m, f.combat, f.operator.uuid), null);
  assert.equal(mineResolutionPlan(f).modification, undefined);
});

test("Targeting uses current Intelligence minimum one; missing statistic rejects plan", () => {
  const f = fixture();
  f.type = "targeting";
  assert.equal(modifyOwnedMine(f), true);
  assert.equal(mineResolutionPlan(f).bonus, 4);
  f.operator.system.abilities.int.mod = -2;
  assert.equal(mineResolutionPlan(f).bonus, 1);
  delete f.operator.system.abilities;
  assert.throws(() => mineResolutionPlan(f), /statistics/);
});

test("replay is a no-op, ID reuse with different parameters is rejected, and active effects cannot be overwritten", () => {
  const f = fixture();
  assert.equal(modifyOwnedMine(f), true);
  const before = structuredClone(f.data);
  assert.equal(modifyOwnedMine(f), false);
  assert.deepEqual(f.data, before);
  assert.throws(() => modifyOwnedMine({ ...f, type: "targeting" }), /duplicate/);
  assert.throws(() => modifyOwnedMine({ ...f, modificationId: "mineMod-other123", type: "targeting" }), /modified/);
  assert.deepEqual(f.data, before);
  f.combat.round = 3;
  f.combat.turn = 1;
  assert.equal(modifyOwnedMine({ ...f, modificationId: "mineMod-other123", type: "targeting" }), true);
  assert.equal(f.data.drones[0].mines[0].tscMineModification.type, "targeting");
});

test("invalid target, drone, station, operator, combat and prerequisites leave state unchanged", () => {
  const cases = [
    (f) => f.data.stations.push({ ...f.data.stations[0] }),
    (f) => f.data.drones.push({ ...f.data.drones[0] }),
    (f) => f.data.drones[0].mines.push({ ...f.data.drones[0].mines[0] }),
    (f) => (f.data.drones[0].deployed = false),
    (f) => (f.data.drones[0].ref = "repair-drone"),
    (f) => (f.data.destroyed = true),
    (f) => (f.data.stations[0].malfunctioning = true),
    (f) => (f.operator.uuid = "Actor.wrong"),
    (f) => (f.origin = 4),
    (f) => (f.combat.id = "else"),
    (f) => (f.combat.turn = 0),
    (f) => (f.type = "fake"),
    (f) => (f.modificationId = "bad"),
    (f) => (f.data.drones[0].mines[0].modification = { legacy: true }),
    (f) => (f.data.drones[0].mines[0].tscModificationReceipts = []),
    (f) => (f.data.drones[0].mines[0].tscModificationReceipts = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [String(i), "x"])))
  ];
  for (const change of cases) {
    const f = fixture();
    change(f);
    const before = structuredClone(f.data);
    assert.throws(() => modifyOwnedMine(f));
    assert.deepEqual(f.data, before);
  }
});

test("changed combat, initiative order or damaged timing fails closed", () => {
  for (const change of [
    (f) => (f.combat.id = "other"),
    (f) => f.combat.turns.reverse(),
    (f) => f.combat.turns.splice(1, 1),
    (f) => (f.combat.round = 0),
    (f) => (f.data.drones[0].mines[0].tscMineModification.expiresRound = 99)
  ]) {
    const f = fixture();
    modifyOwnedMine(f);
    change(f);
    assert.throws(() => mineModificationStatus(f.data.drones[0].mines[0], f.combat, f.operator.uuid));
  }
});

test("movement keeps modification, receipts, owner, mine identity and unknown fields", () => {
  const f = fixture();
  modifyOwnedMine(f);
  const mine = f.data.drones[0].mines[0],
    before = structuredClone(mine);
  assert.equal(moveOwnedMine({ ...f, zones: 12, destination: 4, moveId: "move1", operatorUuid: f.operator.uuid }), true);
  assert.equal(mine.zone, 4);
  delete mine.moveReceipts;
  mine.zone = 3;
  assert.deepEqual(mine, before);
});

test("GM-authoritative handler rejects players, confirms feature, coalesces repeats and whispers one card", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const pc = makeCharacter({ id: "operator", name: "Operator" });
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, role: "crew", stationId: "s1" }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  await combat.createEmbeddedDocuments("Combatant", [{ _id: "op", actorId: pc.id, initiative: 20 }]);
  const { patchStarship, readStarship } = await import("../../scripts/starship/starship-state.mjs");
  await patchStarship(
    ship,
    (d) => {
      d.drones = [
        {
          id: "d1",
          stationId: "s1",
          tscVersion: 1,
          ref: "pyrotechnics-drone",
          deployed: true,
          mines: [{ id: "m1", droneId: "d1", shipUuid: ship.uuid, operatorUuid: pc.uuid, combatId: combat.id, zone: 3, state: "armed" }]
        }
      ];
    },
    { history: false }
  );
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerShipHandlers();
  const replies = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (m) => replies.push(m) };
  const payload = {
    shipUuid: ship.uuid,
    stationId: "s1",
    droneId: "d1",
    mineId: "m1",
    origin: 3,
    type: "smart",
    modificationId: "mineMod-abcdefgh",
    confirmPrerequisite: true
  };
  const send = (who, p = payload) =>
    dispatchSocketMessage({ kind: "request", type: "modifyDroneMine", requestId: "r", payload: p }, who, env);
  const writes = globalThis.__writes.length,
    messages = game.messages.size;
  await send("p1");
  assert.equal(replies.at(-1).ok, false);
  await send("gm", { ...payload, confirmPrerequisite: false });
  assert.equal(replies.at(-1).ok, false);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  await Promise.all([send("gm"), send("gm")]);
  assert.equal(replies.at(-1).ok, true);
  assert.equal(readStarship(ship).drones[0].mines[0].tscMineModification.type, "smart");
  assert.equal(game.messages.size, messages + 1);
  assert.deepEqual([...game.messages.values()].at(-1).whisper, ["gm"]);
  const after = globalThis.__writes.length;
  await send("gm");
  assert.equal(replies.at(-1).result, false);
  assert.equal(globalThis.__writes.length, after);
  assert.equal(game.messages.size, messages + 1);
  await send("gm", { ...payload, type: "targeting" });
  assert.equal(replies.at(-1).ok, false);
});

test("Drone Block remains based on operator level, not ship level", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const pc = makeCharacter({ id: "operator", name: "Operator" });
  pc.system.details = { level: { value: 9 } };
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, role: "crew", stationId: "s1" }],
    extra: { level: 2, drones: [{ id: "d1", stationId: "s1", tscVersion: 1, ref: "repair-drone", deployed: true }] }
  });
  const { stageDroneBlock } = await import("../../scripts/actions/drone-block.mjs");
  const { Draft } = await import("../../scripts/actions/draft.mjs");
  assert.equal(
    await stageDroneBlock({
      draft: new Draft(null),
      targetUuid: ship.uuid,
      stationId: "s1",
      crew: pc,
      droneId: "d1",
      strikeId: "unique",
      worldTime: 0
    }),
    4
  );
});

test("GM manual detonation card reports Smart and Targeting without claiming automatic application", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const pc = makeCharacter({ id: "operator", name: "Operator" });
  pc.system.details = { level: { value: 3 } };
  pc.system.abilities = { int: { mod: 4 } };
  pc.classDC = { dc: { value: 19 } };
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, role: "crew", stationId: "s1" }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  await combat.createEmbeddedDocuments("Combatant", [{ _id: "op", actorId: pc.id, initiative: 20 }]);
  const { patchStarship, readStarship } = await import("../../scripts/starship/starship-state.mjs");
  await patchStarship(
    ship,
    (d) => {
      d.drones = [
        {
          id: "d1",
          stationId: "s1",
          tscVersion: 1,
          ref: "pyrotechnics-drone",
          deployed: true,
          mines: [{ id: "m1", droneId: "d1", shipUuid: ship.uuid, operatorUuid: pc.uuid, combatId: combat.id, zone: 3, state: "armed" }]
        }
      ];
      modifyOwnedMine({
        data: d,
        shipUuid: ship.uuid,
        stationId: "s1",
        droneId: "d1",
        mineId: "m1",
        operator: pc,
        combat,
        shipZone: 3,
        origin: 3,
        type: "smart",
        modificationId: "mineMod-abcdefgh"
      });
    },
    { history: false }
  );
  const { prepareMineDetonation } = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  const button = { dataset: { stationId: "s1", droneId: "d1", mineId: "m1" } };
  foundry.applications.api.DialogV2.prompt = async () => ({ type: "fire", reaction: false });
  await prepareMineDetonation.call({ document: ship }, null, button);
  let card = [...game.messages.values()].at(-1);
  assert.match(card.content, /Smart Mine/);
  assert.match(card.content, /@Damage\[3d8\[fire\]\]/);
  assert.deepEqual(card.whisper, ["gm"]);
  combat.round = 3;
  await patchStarship(
    ship,
    (d) =>
      modifyOwnedMine({
        data: d,
        shipUuid: ship.uuid,
        stationId: "s1",
        droneId: "d1",
        mineId: "m1",
        operator: pc,
        combat,
        shipZone: 3,
        origin: 3,
        type: "targeting",
        modificationId: "mineMod-abcdefgh2"
      }),
    { history: false }
  );
  await prepareMineDetonation.call({ document: ship }, null, button);
  card = [...game.messages.values()].at(-1);
  assert.match(card.content, /3d8 \+ 4/);
  assert.doesNotMatch(card.content, /@Damage/);
  assert.match(card.content, /@Check\[reflex\|dc:19\|basic\]/);
  assert.equal(readStarship(ship).drones[0].mines[0].state, "armed");
});

test("cancelling or refusing prerequisite in UI has no socket, history, or state writes", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const pc = makeCharacter({ id: "operator", name: "Operator" });
  const ship = makeShip({ id: "ship", name: "Ship" });
  const { modifyDroneMine } = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  const button = { dataset: { stationId: "s1", droneId: "d1", mineId: "m1", zone: "3" } };
  const writes = globalThis.__writes.length,
    messages = game.messages.size;
  foundry.applications.api.DialogV2.prompt = async () => null;
  await modifyDroneMine.call({ document: ship }, null, button);
  foundry.applications.api.DialogV2.prompt = async () => ({ type: "smart", confirmed: false });
  await modifyDroneMine.call({ document: ship }, null, button);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  assert.ok(pc);
});

test("external Actor change while waiting rejects modification without overwriting it", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const pc = makeCharacter({ id: "operator", name: "Operator" });
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, role: "crew", stationId: "s1" }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  await combat.createEmbeddedDocuments("Combatant", [{ _id: "op", actorId: pc.id, initiative: 20 }]);
  const { patchStarship, readStarship } = await import("../../scripts/starship/starship-state.mjs");
  await patchStarship(
    ship,
    (d) => {
      d.drones = [
        {
          id: "d1",
          stationId: "s1",
          tscVersion: 1,
          ref: "pyrotechnics-drone",
          deployed: true,
          mines: [{ id: "m1", droneId: "d1", shipUuid: ship.uuid, operatorUuid: pc.uuid, combatId: combat.id, zone: 3, state: "armed" }]
        }
      ];
    },
    { history: false }
  );
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerShipHandlers();
  const old = globalThis.fromUuid;
  let interrupted = false;
  globalThis.fromUuid = async (uuid) => {
    if (uuid === pc.uuid && !interrupted) {
      interrupted = true;
      const flags = structuredClone(ship.flags["sf2e-tactical-starship-combat"].starship);
      flags.sensorRange = 99;
      await ship.update({ "flags.sf2e-tactical-starship-combat.starship": flags });
    }
    return old(uuid);
  };
  const replies = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (m) => replies.push(m) };
  const payload = {
    shipUuid: ship.uuid,
    stationId: "s1",
    droneId: "d1",
    mineId: "m1",
    origin: 3,
    type: "smart",
    modificationId: "mineMod-abcdefgh",
    confirmPrerequisite: true
  };
  try {
    await dispatchSocketMessage({ kind: "request", type: "modifyDroneMine", requestId: "r", payload }, "gm", env);
  } finally {
    globalThis.fromUuid = old;
  }
  assert.equal(replies.at(-1).ok, false);
  assert.equal(readStarship(ship).sensorRange, 99);
  assert.equal(readStarship(ship).drones[0].mines[0].tscMineModification, undefined);
  assert.equal(game.messages.size, 0);
});
