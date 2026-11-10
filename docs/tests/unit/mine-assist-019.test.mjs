import test from "node:test";
import assert from "node:assert/strict";
import { mineResolutionPlan } from "../../scripts/actions/mine-resolution.mjs";

function fixture() {
  const operator = { uuid: "Actor.operator", system: { details: { level: { value: 3 } } }, classDC: { dc: { value: 19 } } };
  const mine = {
    id: "m1",
    droneId: "d1",
    shipUuid: "Actor.ship",
    operatorUuid: operator.uuid,
    combatId: "combat1",
    zone: 3,
    state: "armed"
  };
  const drone = { id: "d1", stationId: "s1", tscVersion: 1, ref: "pyrotechnics-drone", deployed: true, mines: [mine] };
  return {
    data: { stations: [{ id: "s1", type: "drone-console", helmedBy: operator.uuid }], drones: [drone] },
    shipUuid: "Actor.ship",
    stationId: "s1",
    droneId: "d1",
    mineId: "m1",
    combatId: "combat1",
    shipZone: 5,
    sensorRange: 2,
    operator
  };
}
test("resolution computes each level without mutating stored data", () => {
  const f = fixture(),
    before = structuredClone(f.data);
  assert.deepEqual(mineResolutionPlan(f), { zone: 3, dc: 19, dice: 3 });
  for (const [level, dice] of [
    [1, 2],
    [2, 2],
    [3, 3],
    [5, 4],
    [20, 11]
  ]) {
    f.operator.system.details.level.value = level;
    assert.equal(mineResolutionPlan(f).dice, dice);
  }
  assert.deepEqual(f.data, before);
});
test("refuses wrong combat, range, station, operator, drone, mine and unknown modifications", () => {
  const cases = [
    (f) => (f.combatId = "other"),
    (f) => (f.shipZone = 6),
    (f) => (f.sensorRange = null),
    (f) => (f.data.stations[0].malfunctioning = true),
    (f) => (f.data.destroyed = true),
    (f) => f.data.stations.push({ ...f.data.stations[0] }),
    (f) => (f.data.stations[0].helmedBy = "Actor.other"),
    (f) => (f.operator.uuid = "Actor.other"),
    (f) => (f.data.drones[0].deployed = false),
    (f) => (f.data.drones[0].ref = "repair-drone"),
    (f) => (f.data.drones[0].mines[0].state = "detonated"),
    (f) => (f.data.drones[0].mines[0].shipUuid = "Actor.other"),
    (f) => f.data.drones[0].mines.push({ ...f.data.drones[0].mines[0] }),
    (f) => (f.data.drones[0].mines[0].modifications = [{ type: "smart" }]),
    (f) => (f.data.drones[0].mines[0].modifications = {}),
    (f) => delete f.operator.classDC,
    (f) => (f.operator.system.details.level.value = 0)
  ];
  for (const change of cases) {
    const f = fixture();
    change(f);
    assert.throws(() => mineResolutionPlan(f));
  }
});
test("original drone may be aboard if another pyrotechnics drone grants the action", () => {
  const f = fixture();
  f.data.drones[0].deployed = false;
  f.data.drones.push({ id: "d2", stationId: "s1", tscVersion: 1, ref: "pyrotechnics-drone", deployed: true });
  assert.equal(mineResolutionPlan(f).dice, 3);
});

test("move is one zone, range-limited, and exact duplicates are no-ops", async () => {
  const { moveOwnedMine } = await import("../../scripts/actions/mine-resolution.mjs");
  const f = fixture();
  const args = { ...f, zones: 10, destination: 4, origin: 3, moveId: "move1", operatorUuid: f.operator.uuid };
  assert.equal(moveOwnedMine(args), true);
  assert.equal(f.data.drones[0].mines[0].zone, 4);
  assert.equal(moveOwnedMine(args), false);
  assert.throws(() => moveOwnedMine({ ...args, origin: 4, moveId: "move2", destination: 6 }), /zone/);
  assert.throws(() => moveOwnedMine({ ...args, origin: 4, moveId: "move2", destination: 0 }), /zone/);
  assert.throws(() => moveOwnedMine({ ...args, destination: 3, operatorUuid: "Actor.other" }), /station/);
  assert.equal(f.data.drones[0].mines[0].zone, 4);
  assert.equal(moveOwnedMine({ ...args, origin: 4, destination: 3, moveId: "move2" }), true);
  assert.equal(moveOwnedMine(args), false); // stale delivery after a later move cannot move it again
  assert.equal(f.data.drones[0].mines[0].zone, 3);
});

test("GM mine controls revalidate, respect privacy, and socket duplicates do not rewrite", async () => {
  const { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } =
    await import("../helpers/foundry-mock.mjs");
  installFoundryMock();
  await loadContentFromDisk();
  const pc = makeCharacter({ id: "operator", name: "Operator" });
  pc.system.details = { level: { value: 5 } };
  pc.classDC = { dc: { value: 22 } };
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, role: "crew", stationId: "s1" }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  const { patchStarship, readStarship } = await import("../../scripts/starship/starship-state.mjs");
  await patchStarship(
    ship,
    (d) => {
      d.drones = [
        {
          id: "d1",
          stationId: "s1",
          ref: "pyrotechnics-drone",
          tscVersion: 1,
          deployed: true,
          mines: [{ id: "m1", droneId: "d1", shipUuid: ship.uuid, operatorUuid: pc.uuid, combatId: combat.id, zone: 3, state: "armed" }]
        }
      ];
    },
    { history: false }
  );
  const { prepareMineDetonation } = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  const button = { dataset: { stationId: "s1", droneId: "d1", mineId: "m1" } };
  const startWrites = globalThis.__writes.length,
    startMessages = game.messages.size;
  foundry.applications.api.DialogV2.prompt = async () => ({ type: "fire", reaction: false });
  await prepareMineDetonation.call({ document: ship }, null, button);
  assert.equal(globalThis.__writes.length, startWrites);
  assert.equal(game.messages.size, startMessages + 1);
  const msg = [...game.messages.values()].at(-1);
  assert.deepEqual(msg.whisper, ["gm"]);
  assert.match(msg.content, /@Damage\[4d8\[fire\]\]/);
  assert.match(msg.content, /@Check\[reflex\|dc:22\|basic\]/);
  assert.equal(readStarship(ship).drones[0].mines[0].state, "armed");
  foundry.applications.api.DialogV2.prompt = async () => {
    await patchStarship(
      ship,
      (d) => {
        d.drones[0].mines[0].state = "removed";
      },
      { history: false }
    );
    return { type: "fire", reaction: false };
  };
  await assert.rejects(() => prepareMineDetonation.call({ document: ship }, null, button));
  assert.equal(game.messages.size, startMessages + 1);
  await patchStarship(
    ship,
    (d) => {
      d.drones[0].mines[0].state = "armed";
    },
    { history: false }
  );
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerShipHandlers();
  const output = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (m) => output.push(m) };
  const payload = {
    shipUuid: ship.uuid,
    stationId: "s1",
    droneId: "d1",
    mineId: "m1",
    destination: 4,
    origin: 3,
    moveId: "move1",
    confirmPrerequisite: true
  };
  const send = (who) => dispatchSocketMessage({ kind: "request", type: "moveDroneMine", requestId: who, payload }, who, env);
  await send("p1");
  assert.equal(output.at(-1).ok, false);
  await send("gm");
  assert.equal(output.at(-1).ok, true);
  assert.equal(readStarship(ship).drones[0].mines[0].zone, 4);
  const writes = globalThis.__writes.length,
    messages = game.messages.size;
  await send("gm");
  assert.equal(output.at(-1).result, false);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
});
