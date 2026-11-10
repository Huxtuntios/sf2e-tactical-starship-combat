import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";
import { stageDroneBlock } from "../../scripts/actions/drone-block.mjs";
import { moveOwnedMine } from "../../scripts/actions/mine-resolution.mjs";
import { changeDrone } from "../../scripts/engine/drone-state.mjs";

// Аудит Drone Block (dev.12). Тесты фиксируют ТЕКУЩЕЕ поведение, включая спорные места: они не доказывают соответствие
// напечатанному тексту Tech Core (текст в этом пакете не проверялся по источнику заново).
const crew = (level) => ({ uuid: "Actor.op", system: { details: { level: { value: level } } } });
function draftOf(extra = {}) {
  const data = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op" }],
    upgrades: [],
    drones: [
      { id: "d1", stationId: "s", tscVersion: 1, ref: "scramble-drone", deployed: true, tscInterceptUsed: true },
      {
        id: "d2",
        stationId: "s",
        tscVersion: 1,
        ref: "pyrotechnics-drone",
        deployed: true,
        mines: [{ id: "m1", droneId: "d2", operatorUuid: "Actor.op", combatId: "c", zone: 3, state: "armed" }]
      }
    ],
    ...extra
  };
  const entry = { data, before: structuredClone(data) };
  return { entry, draft: { ship: async () => entry } };
}
const stage = (draft, over = {}) =>
  stageDroneBlock({
    draft,
    targetUuid: "Actor.ship",
    stationId: "s",
    crew: crew(7),
    droneId: "d1",
    strikeId: "strike-1",
    worldTime: 1000,
    ...over
  });

test("resistance is half the operator's level rounded down; the drone is retrieved for 10 minutes", async () => {
  installFoundryMock();
  for (const [level, expected] of [
    [1, 0],
    [2, 1],
    [7, 3],
    [20, 10]
  ]) {
    const { draft, entry } = draftOf();
    assert.equal(await stage(draft, { crew: crew(level) }), expected, `level ${level}`);
    const d = entry.data.drones[0];
    assert.deepEqual([d.deployed, d.availableAt], [false, 1600]);
    assert.deepEqual(entry.data.droneBlockReceipts, [{ strikeId: "strike-1", droneId: "d1", stationId: "s", crewUuid: "Actor.op" }]);
    assert.ok(entry.writeOptions.expected);
  }
});

test("invalid requests change nothing: wrong crew, undeployed or foreign drone, malfunction, protocol, replay, bad level/time", async () => {
  installFoundryMock();
  const cases = [
    [{ crew: { ...crew(7), uuid: "Actor.other" } }],
    [{ droneId: "missing" }],
    [{ strikeId: "" }],
    [{ worldTime: NaN }],
    [{ crew: crew(0) }],
    [{ crew: crew(2.5) }],
    [{}, (d) => (d.drones[0].deployed = false)],
    [{}, (d) => (d.drones[0].tscVersion = 2)],
    [{}, (d) => (d.stations[0].malfunctioning = true)],
    [{}, (d) => (d.destroyed = true)],
    [{}, (d) => d.upgrades.push({ ref: "drone-shield-protocol", stationId: "s" })],
    [{}, (d) => (d.droneBlockReceipts = [{ strikeId: "strike-1" }])],
    [{}, (d) => (d.droneBlockReceipts = "broken")]
  ];
  for (const [over, mutate] of cases) {
    const { draft, entry } = draftOf();
    mutate?.(entry.data);
    const before = structuredClone(entry.data);
    await assert.rejects(stage(draft, over), JSON.stringify(over));
    assert.deepEqual(entry.data, before, JSON.stringify(over));
  }
});

test("OPEN QUESTION (current behavior): Drone Block does not reset a recorded Intercept Munitions use", async () => {
  installFoundryMock();
  const { draft, entry } = draftOf();
  await stage(draft);
  assert.equal(entry.data.drones[0].tscInterceptUsed, true);
  // Обычное действие Retrieve сбрасывает её (для сравнения).
  const data = structuredClone(entry.before);
  changeDrone(
    data,
    "retrieve",
    { stationId: "s", id: "d1" },
    { droneTypes: [{ id: "scramble-drone" }, { id: "pyrotechnics-drone" }], definition: {}, worldTime: 0 }
  );
  assert.equal(data.drones[0].tscInterceptUsed, false);
});

test("OPEN QUESTION (current behavior): after Drone Block on a pyrotechnics drone its armed mines cannot be moved by the helper until redeployment", async () => {
  installFoundryMock();
  const { draft, entry } = draftOf();
  await stage(draft, { droneId: "d2" });
  const mine = entry.data.drones[1].mines[0];
  assert.equal(mine.state, "armed"); // мина не снимается автоматически
  assert.throws(
    () =>
      moveOwnedMine({
        data: entry.data,
        shipUuid: "Actor.ship",
        stationId: "s",
        droneId: "d2",
        mineId: "m1",
        combatId: "c",
        shipZone: 3,
        sensorRange: 6,
        zones: 12,
        destination: 4,
        origin: 3,
        moveId: "move1",
        operatorUuid: "Actor.op"
      }),
    /drone|mine/
  );
});
