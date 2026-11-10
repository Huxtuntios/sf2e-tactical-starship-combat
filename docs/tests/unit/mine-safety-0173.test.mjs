import test from "node:test";
import assert from "node:assert/strict";
import { mineResolutionPlan, moveOwnedMine, uniqueOwnedMine } from "../../scripts/actions/mine-resolution.mjs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

const make = () => {
  const operator = { uuid: "Actor.operator", system: { details: { level: { value: 3 } } }, classDC: { dc: { value: 19 } } };
  const mine = { id: "m1", droneId: "d1", shipUuid: "Actor.ship", operatorUuid: operator.uuid, combatId: "c", zone: 3, state: "armed" };
  return {
    data: {
      stations: [{ id: "s1", type: "drone-console", helmedBy: operator.uuid }],
      drones: [{ id: "d1", stationId: "s1", tscVersion: 1, ref: "pyrotechnics-drone", deployed: true, mines: [mine] }]
    },
    shipUuid: "Actor.ship",
    stationId: "s1",
    droneId: "d1",
    mineId: "m1",
    combatId: "c",
    shipZone: 3,
    sensorRange: 2,
    operator
  };
};

test("ambiguous IDs elsewhere on the same ship are refused by all mine paths", () => {
  const cases = [
    (f) => f.data.stations.push({ id: "s1", type: "generator" }),
    (f) => f.data.drones.push({ id: "d1", stationId: "other", tscVersion: 1, ref: "repair-drone", deployed: false }),
    (f) =>
      f.data.drones.push({ id: "other", stationId: "other", tscVersion: 1, mines: [{ id: "m1", droneId: "other", shipUuid: f.shipUuid }] }),
    (f) => {
      f.data.drones[0].deployed = false;
      f.data.drones.push(
        { id: "d2", stationId: "s1", tscVersion: 1, ref: "pyrotechnics-drone", deployed: true },
        { id: "d2", stationId: "other" }
      );
    }
  ];
  for (const [index, change] of cases.entries()) {
    const f = make();
    change(f);
    const before = structuredClone(f.data);
    assert.throws(() => mineResolutionPlan(f), `plan ${index}`);
    assert.throws(
      () => moveOwnedMine({ ...f, operatorUuid: f.operator.uuid, zones: 10, origin: 3, destination: 4, moveId: "move" }),
      `move ${index}`
    );
    if (index <= 2) assert.throws(() => uniqueOwnedMine(f.data, f), `close ${index}`);
    assert.deepEqual(f.data, before);
  }
});

test("GM close refuses cross-drone duplicate mine ID without write, history, or message", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const pc = makeCharacter({ id: "operator", name: "Operator" });
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: pc.uuid }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  const { patchStarship, readStarship } = await import("../../scripts/starship/starship-state.mjs");
  const mine = { id: "m1", droneId: "d1", shipUuid: ship.uuid, operatorUuid: pc.uuid, combatId: combat.id, zone: 3, state: "armed" };
  await patchStarship(
    ship,
    (d) => {
      d.drones = [
        { id: "d1", stationId: "s1", tscVersion: 1, ref: "pyrotechnics-drone", deployed: true, mines: [mine] },
        { id: "d2", stationId: "else", tscVersion: 1, mines: [{ ...mine, droneId: "d2" }] }
      ];
    },
    { history: false }
  );
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { historyEntries } = await import("../../scripts/history/history.mjs");
  registerShipHandlers();
  let reply;
  const env = {
    users: game.users,
    selfId: "gm",
    isActiveGM: true,
    clientEvents: new Map(),
    emit: (r) => {
      reply = r;
    }
  };
  const before = structuredClone(readStarship(ship)),
    writes = globalThis.__writes.length,
    messages = game.messages.size,
    history = historyEntries(ship.uuid).length;
  await dispatchSocketMessage(
    {
      kind: "request",
      type: "closeDroneMine",
      requestId: "close1",
      payload: { shipUuid: ship.uuid, stationId: "s1", droneId: "d1", mineId: "m1", resolution: "detonated" }
    },
    "gm",
    env
  );
  assert.equal(reply.ok, false);
  assert.deepEqual(readStarship(ship), before);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  assert.equal(historyEntries(ship.uuid).length, history);
});
