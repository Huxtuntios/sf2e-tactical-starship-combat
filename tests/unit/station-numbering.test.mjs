import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
const flag = (ship) => ship.flags[M].starship;

async function setupRuntime() {
  installFoundryMock();
  await loadContentFromDisk();
  const socket = await import("../../scripts/socket.mjs");
  (await import("../../scripts/crew/crew-service.mjs")).registerCrewHandlers();
  const emitted = [];
  let requestNumber = 0;
  const send = (type, payload) => {
    const requestId = `r${requestNumber++}`;
    return socket
      .dispatchSocketMessage({ kind: "request", type, requestId, payload }, "p1", {
        users: game.users,
        selfId: "gm",
        isActiveGM: true,
        clientEvents: new Map(),
        emit: (message) => emitted.push(message)
      })
      .then(() => emitted.find((message) => message.requestId === requestId));
  };
  return { send };
}

const addStation = (send, ship, station) => send("addStation", { shipUuid: ship.uuid, station });

test("nextStationName keeps first names and numbers only later stations of the same type", async () => {
  const { nextStationName } = await import("../../scripts/engine/station-names.mjs");
  const stations = [
    { id: "g1", type: "gunnery", name: "Alpha" },
    { id: "p1", type: "pilot", name: "Helm" }
  ];
  const before = structuredClone(stations);

  assert.equal(nextStationName({ type: "gunnery", name: "Alpha" }, stations), "Alpha 2");
  assert.equal(nextStationName({ type: "gunnery", name: "Alpha" }, [...stations, { type: "gunnery", name: "Alpha 2" }]), "Alpha 3");
  assert.equal(nextStationName({ type: "scanners", name: "Scanners" }, stations), "Scanners");
  assert.equal(nextStationName({ type: "gunnery", name: "Alpha" }, []), "Alpha");
  assert.deepEqual(stations, before);
});

test("nextStationName skips case-insensitive collisions across station names", async () => {
  const { nextStationName } = await import("../../scripts/engine/station-names.mjs");
  const stations = [
    { type: "gunnery", name: "Alpha" },
    { type: "pilot", name: "ALPHA 2" },
    { type: "custom", name: "alpha 3" }
  ];

  assert.equal(nextStationName({ type: "gunnery", name: "Alpha" }, stations), "Alpha 4");
  assert.equal(nextStationName({ type: "scanners", name: "alpha" }, stations), "alpha 4");
});

test("runtime addStation numbers duplicate types without changing IDs or existing names", async () => {
  const { send } = await setupRuntime();
  const ship = makeShip({
    id: "numbering",
    name: "Numbering",
    owners: ["p1"],
    stations: [
      { id: "g1", type: "gunnery", name: "Alpha" },
      { id: "p1", type: "pilot", name: "Helm" }
    ]
  });
  const existing = flag(ship).stations.map(({ id, name }) => ({ id, name }));

  assert.equal((await addStation(send, ship, { id: "g2", type: "gunnery", name: "Alpha" })).ok, true);
  assert.equal((await addStation(send, ship, { id: "g3", type: "gunnery", name: "Alpha" })).ok, true);
  assert.equal((await addStation(send, ship, { id: "s1", type: "scanners", name: "Scanners" })).ok, true);

  assert.deepEqual(
    flag(ship).stations.map(({ id, name }) => ({ id, name })),
    [...existing, { id: "g2", name: "Alpha 2" }, { id: "g3", name: "Alpha 3" }, { id: "s1", name: "Scanners" }]
  );
});

test("runtime addStation avoids case-insensitive collisions with other station types", async () => {
  const { send } = await setupRuntime();
  const ship = makeShip({
    id: "numbering-collision",
    name: "Numbering Collision",
    owners: ["p1"],
    stations: [
      { id: "g1", type: "gunnery", name: "Alpha" },
      { id: "p1", type: "pilot", name: "ALPHA 2" }
    ]
  });

  assert.equal((await addStation(send, ship, { id: "g2", type: "gunnery", name: "Alpha" })).ok, true);
  assert.deepEqual(
    flag(ship).stations.map(({ id, name }) => ({ id, name })),
    [
      { id: "g1", name: "Alpha" },
      { id: "p1", name: "ALPHA 2" },
      { id: "g2", name: "Alpha 3" }
    ]
  );
});

test("concurrent runtime addStation requests receive distinct sequential names", async () => {
  const { send } = await setupRuntime();
  const ship = makeShip({ id: "numbering-concurrent", name: "Numbering Concurrent", owners: ["p1"] });

  const results = await Promise.all([
    addStation(send, ship, { id: "g1", type: "gunnery", name: "Alpha" }),
    addStation(send, ship, { id: "g2", type: "gunnery", name: "Alpha" })
  ]);

  assert.deepEqual(
    results.map((result) => result.ok),
    [true, true]
  );
  assert.deepEqual(
    flag(ship).stations.map(({ id, name }) => ({ id, name })),
    [
      { id: "g1", name: "Alpha" },
      { id: "g2", name: "Alpha 2" }
    ]
  );
});

test("stationsFromContent numbers duplicate types while preserving labels, IDs and input", async () => {
  const { stationsFromContent } = await import("../../scripts/content/ship-docs.mjs");
  const ship = {
    level: 5,
    stations: [
      { type: "gunnery", label: "Alpha" },
      { type: "pilot", label: "Helm" },
      { type: "gunnery", label: "Alpha" },
      { type: "gunnery", label: "Alpha" }
    ]
  };
  const before = structuredClone(ship);

  const stations = stationsFromContent(ship);
  assert.deepEqual(
    stations.map(({ id, name }) => ({ id, name })),
    [
      { id: "gunnery-1", name: "Alpha" },
      { id: "pilot-1", name: "Helm" },
      { id: "gunnery-2", name: "Alpha 2" },
      { id: "gunnery-3", name: "Alpha 3" }
    ]
  );
  assert.deepEqual(ship, before);
});

test("buildPlayerShipData numbers duplicate types while preserving custom names, IDs and input", async () => {
  const { buildPlayerShipData } = await import("../../scripts/content/ship-docs.mjs");
  const stations = [
    { type: "gunnery", name: "Alpha" },
    { type: "pilot", name: "Helm" },
    { type: "gunnery", name: "Alpha" },
    { type: "gunnery", name: "Alpha" }
  ];
  const before = structuredClone(stations);
  const frame = {
    id: "test-frame",
    size: "medium",
    sensorRange: 6,
    description: "Test frame",
    traits: [],
    expansionBays: 0,
    table: [{ level: 1, speed: 3, ac: 10, fort: 0, ref: 0, will: 0, hp: 24, sp: 11 }]
  };

  const data = buildPlayerShipData({ name: "Test", frame, level: 1, stations });
  assert.deepEqual(
    data.flags[M].starship.stations.map(({ id, name }) => ({ id, name })),
    [
      { id: "gunnery-1", name: "Alpha" },
      { id: "pilot-2", name: "Helm" },
      { id: "gunnery-3", name: "Alpha 2" },
      { id: "gunnery-4", name: "Alpha 3" }
    ]
  );
  assert.deepEqual(stations, before);
});
