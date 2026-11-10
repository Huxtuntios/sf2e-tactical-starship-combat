import test from "node:test";
import assert from "node:assert/strict";
import { saveInstallMinePlan } from "../../scripts/actions/install-mine-plan.mjs";
function setup() {
  return {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.operator", old: 1 }],
    upgrades: [{ ref: "mine-deployment-shell", stationId: "s" }],
    drones: [{ id: "d", stationId: "s", ref: "pyrotechnics-drone", deployed: false, tscVersion: 1, mines: [], old: "keep" }]
  };
}
const request = {
  stationId: "s",
  droneId: "d",
  operatorUuid: "Actor.operator",
  operationId: "install-12345678",
  confirmed: true,
  entries: [
    { mine: "A", mod: "Smart Mine" },
    { mine: "B", mod: "Targeting Mine" }
  ]
};
test("GM confirmed plan saves individual notes without changing mine mechanics or old fields", () => {
  const data = setup();
  assert.equal(saveInstallMinePlan(data, request), true);
  assert.equal(data.drones[0].old, "keep");
  assert.deepEqual(data.drones[0].mines, []);
  assert.deepEqual(data.drones[0].tscInstallMinePlan.entries, request.entries);
  const before = structuredClone(data);
  assert.equal(saveInstallMinePlan(data, request), false);
  assert.deepEqual(data, before);
  assert.throws(() => saveInstallMinePlan(data, { ...request, entries: [{ mine: "X", mod: "Y" }] }));
  assert.deepEqual(data, before);
});
test("validation fails without mutations for bad station, drone, upgrade, duplicate labels, limits or confirmation", () => {
  const cases = [
    (d) => d.stations.push({ ...d.stations[0] }),
    (d) => d.drones.push({ ...d.drones[0] }),
    (d) => (d.drones[0].deployed = true),
    (d) => (d.upgrades = []),
    (d) => (d.stations[0].helmedBy = "other"),
    (d) => (d.stations[0].malfunctioning = true),
    (d) => (d.destroyed = true)
  ];
  for (const mutate of cases) {
    const d = setup();
    mutate(d);
    const before = structuredClone(d);
    assert.throws(() => saveInstallMinePlan(d, request));
    assert.deepEqual(d, before);
  }
  for (const req of [
    { ...request, confirmed: false },
    { ...request, entries: [] },
    { ...request, entries: Array(5).fill({ mine: "x", mod: "y" }) },
    {
      ...request,
      entries: [
        { mine: "A", mod: "x" },
        { mine: "a", mod: "y" }
      ]
    }
  ]) {
    const d = setup(),
      before = structuredClone(d);
    assert.throws(() => saveInstallMinePlan(d, req));
    assert.deepEqual(d, before);
  }
});
test("old replay cannot overwrite a later plan", () => {
  const data = setup();
  saveInstallMinePlan(data, request);
  saveInstallMinePlan(data, { ...request, operationId: "install-87654321", entries: [{ mine: "C", mod: "Big Boom" }] });
  const before = structuredClone(data);
  assert.equal(saveInstallMinePlan(data, request), false);
  assert.deepEqual(data, before);
});

test("GM-authoritative handler refuses player and replays without extra Actor writes or cards", async () => {
  const { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter } = await import("../helpers/foundry-mock.mjs");
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { readStarship } = await import("../../scripts/starship/starship-state.mjs");
  installFoundryMock();
  await loadContentFromDisk();
  const operator = makeCharacter({ id: "operator", name: "Mechanic" });
  const ship = makeShip({
    id: "ship",
    stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: operator.uuid }],
    crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "s" }],
    extra: {
      upgrades: [{ ref: "mine-deployment-shell", stationId: "s" }],
      drones: [{ id: "d", stationId: "s", ref: "pyrotechnics-drone", deployed: false, tscVersion: 1, mines: [] }]
    }
  });
  registerShipHandlers();
  const results = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (m) => results.push(m) };
  const send = (who, p = request) =>
    dispatchSocketMessage({ kind: "request", type: "installMinePlan", requestId: "r", payload: { ...p, shipUuid: ship.uuid } }, who, env);
  await send("p1");
  assert.equal(results.at(-1).ok, false);
  assert.equal(globalThis.__writes.length, 0);
  await Promise.all([send("gm"), send("gm")]);
  assert.ok(results.every((r, i) => i === 0 || r.ok));
  assert.equal(game.messages.size, 1);
  assert.deepEqual(readStarship(ship).drones[0].tscInstallMinePlan.entries, request.entries);
  const writes = globalThis.__writes.length;
  await send("gm");
  assert.equal(results.at(-1).result, false);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, 1);
});
