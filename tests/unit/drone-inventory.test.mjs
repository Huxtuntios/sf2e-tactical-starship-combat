import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { droneInventory } from "../../scripts/engine/drone-inventory.mjs";
import { installFoundryMock, loadContentFromDisk } from "../helpers/foundry-mock.mjs";
import { Reactions } from "../../scripts/actions/reactions.mjs";

const def = JSON.parse(readFileSync("data/stations/stations.json", "utf8")).stations.find((s) => s.id === "drone-console");
test("all console grades use catalogue drone capacity without rewriting records", () => {
  assert.deepEqual(
    def.advancement.map((r) => [r.grade, r.drones, r.upgrades]),
    [
      ["commercial", 1, 0],
      ["tactical", 2, 1],
      ["advanced", 3, 2],
      ["superior", 4, 2],
      ["elite", 4, 3],
      ["ultimate", 5, 3],
      ["paragon", 5, 4]
    ]
  );
  for (const row of def.advancement) {
    const st = { id: "console", type: "drone-console", grade: row.grade };
    const data = { stations: [st], drones: Array.from({ length: row.drones + 1 }, (_, id) => ({ id })) };
    const before = JSON.stringify(data);
    const result = droneInventory(data, st, def);
    assert.deepEqual([result.count, result.capacity, result.over], [row.drones + 1, row.drones, true]);
    assert.equal(JSON.stringify(data), before);
  }
});
test("legacy drones are not silently assigned to multiple consoles", () => {
  const a = { id: "a", type: "drone-console", grade: "commercial" };
  const b = { id: "b", type: "drone-console", grade: "commercial" };
  const data = { stations: [a, b], drones: [{ id: "legacy" }, { id: "bound", stationId: "a" }, { id: "orphan", stationId: "deleted" }] };
  assert.deepEqual(droneInventory(data, a, def), { capacity: 1, count: 1, unassigned: 2, over: false });
  assert.deepEqual(droneInventory(data, b, def), { capacity: 1, count: 0, unassigned: 2, over: false });
  assert.equal(droneInventory(data, { ...a, grade: "unknown" }, def).capacity, null);
});
test("unsafe untracked Drone Block is not offered for automatic Strike resolution", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const data = {
    role: "player",
    sp: { value: 0 },
    stations: [{ id: "d", type: "drone-console", grade: "commercial", helmedBy: "Actor.p" }],
    drones: [{ id: "drone", deployed: true }]
  };
  assert.deepEqual(Reactions.eligible(data, null, null), []);
});
