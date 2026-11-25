import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { moveObject } from "../../scripts/engine/sensor-ops.mjs";
import { mutateTsc } from "../../scripts/combat/tsc-state.mjs";

const MODULE_ID = "sf2e-tactical-starship-combat";

async function scenario({ isGM = false } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  game.user = game.users.get(isGM ? "gm" : "p1");
  const ship = makeShip({
    id: "range-owner",
    name: "Range owner",
    role: "player",
    owners: ["p1"],
    stations: [{ id: "scanner", type: "scanners", grade: "commercial" }],
    extra: { dataVersion: 3, sensorRange: 2 }
  });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 3, detection: { party: "identified" } },
      { key: "far-contact", type: "custom", zone: 12, designation: "Contact 12", detection: { party: "observed" } }
    ]
  });
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  return { ship, combat, app: new SensorMapApplication() };
}

test("production player context renders a range without omitting a distant detected contact", async () => {
  const { app } = await scenario();
  const context = await app._prepareContext({ parts: ["zones"] });
  assert.equal(context.rangeMode, "player");
  assert.equal(context.showRanges, true);
  assert.deepEqual(context.sensorRanges, [{ index: 0, zone: 3, range: 3, startZone: 1, endZone: 6, endColumn: 7, color: "#38bdf8" }]);
  assert.equal(context.zones[5].outsideRange, false);
  assert.equal(context.zones[6].outsideRange, true);
  assert.ok(context.zones.at(-1).objects.some((object) => object.key === "far-contact"));
  assert.equal(JSON.stringify(context.sensorRanges).includes("Range owner"), false);
  app._cleanup();
});

test("production GM context keeps the full map and never marks a zone outside range", async () => {
  const { app } = await scenario({ isGM: true });
  const context = await app._prepareContext({ parts: ["zones"] });
  assert.equal(context.rangeMode, "gm");
  assert.equal(context.sensorRanges.length, 1);
  assert.ok(context.zones.every((zone) => zone.outsideRange === false));
  assert.ok(context.zones.at(-1).objects.some((object) => object.key === "far-contact"));
  app._cleanup();
});

test("production context follows movement and scanner changes on the next render", async () => {
  const { ship, combat, app } = await scenario();
  const before = await app._prepareContext({ parts: ["zones"] });
  assert.equal(before.sensorRanges[0].zone, 3);
  assert.equal(before.sensorRanges[0].range, 3);

  game.user = game.users.get("gm");
  await mutateTsc(combat, (state) => moveObject(state, ship.uuid, 9));
  game.user = game.users.get("p1");
  const moved = await app._prepareContext({ parts: ["zones"] });
  assert.equal(moved.sensorRanges[0].zone, 9);
  assert.equal(moved.sensorRanges[0].startZone, 6);
  assert.equal(moved.sensorRanges[0].endZone, 12);

  await ship.update({ [`flags.${MODULE_ID}.starship.stations.0.grade`]: "advanced" });
  app.invalidateActorCache(ship);
  const upgraded = await app._prepareContext({ parts: ["zones"] });
  assert.equal(upgraded.sensorRanges[0].range, 4);
  assert.equal(upgraded.sensorRanges[0].startZone, 5);
  assert.equal(ship.flags[MODULE_ID].starship.sensorRange, 2);
  app._cleanup();
});
