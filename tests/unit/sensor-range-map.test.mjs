import test from "node:test";
import assert from "node:assert/strict";
import * as mapModel from "../../scripts/sensor/map-model.mjs";
import { moveObject } from "../../scripts/engine/sensor-ops.mjs";
import { viewFor } from "../../scripts/engine/sensor-ops.mjs";
import { computeShipStats } from "../../scripts/starship/stats.mjs";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";

function presentation(tsc, options = {}) {
  assert.equal(typeof mapModel.sensorRangePresentation, "function");
  return mapModel.sensorRangePresentation(tsc, options);
}

function state(objects, zones = 12) {
  return { zones, objects };
}

test("player range presentation covers the effective range and blurs only outside zones", () => {
  const tsc = state([{ key: "Actor.friendly", type: "starship", zone: 3 }]);
  const result = presentation(tsc, {
    isGM: false,
    observerKeys: ["Actor.friendly"],
    resolve: () => ({ name: "Secret-friendly-name" }),
    rangeFor: () => 2
  });
  assert.equal(result.rangeMode, "player");
  assert.equal(result.blurOutside, true);
  assert.deepEqual(result.ranges, [{ index: 0, zone: 3, range: 2, startZone: 1, endZone: 5, endColumn: 6, color: "#38bdf8" }]);
  assert.deepEqual(
    result.zones.map((zone) => [zone.zone, zone.outsideRange, zone.rangeIndexes]),
    [
      [1, false, [0]],
      [2, false, [0]],
      [3, false, [0]],
      [4, false, [0]],
      [5, false, [0]],
      [6, true, []],
      [7, true, []],
      [8, true, []],
      [9, true, []],
      [10, true, []],
      [11, true, []],
      [12, true, []]
    ]
  );
});

test("GM receives the same separate outlines without blur or restricted zones", () => {
  const tsc = state([{ key: "Actor.friendly", type: "starship", zone: 3 }]);
  const result = presentation(tsc, {
    isGM: true,
    observerKeys: ["Actor.friendly"],
    resolve: () => ({}),
    rangeFor: () => 2
  });
  assert.equal(result.rangeMode, "gm");
  assert.equal(result.blurOutside, false);
  assert.equal(result.ranges.length, 1);
  assert.ok(result.zones.every((zone) => zone.outsideRange === false));
});

test("range presentation never omits or redacts detected contacts by distance", () => {
  const tsc = state([
    { key: "Actor.friendly", type: "starship", zone: 2, detection: { party: "identified" } },
    { key: "Actor.distant", name: "Distant identified ship", type: "starship", zone: 12, detection: { party: "identified" } }
  ]);
  const view = viewFor(tsc, { isGM: false, observerKeys: ["Actor.friendly"], resolve: () => null });
  const result = presentation(tsc, {
    isGM: false,
    observerKeys: ["Actor.friendly"],
    resolve: (uuid) => (uuid === "Actor.friendly" ? {} : null),
    rangeFor: () => 1
  });
  assert.deepEqual(
    view.map((object) => object.key),
    ["Actor.friendly", "Actor.distant"]
  );
  assert.equal(Object.hasOwn(result, "objects"), false);
  assert.equal(result.zones.at(-1).outsideRange, true);
});

test("multiple friendly ships keep separate ranges instead of sharing one sensor value", () => {
  const tsc = state([
    { key: "Actor.first", type: "starship", zone: 2 },
    { key: "Actor.second", type: "starship", zone: 8 }
  ]);
  const result = presentation(tsc, {
    isGM: false,
    observerKeys: ["Actor.first", "Actor.second"],
    resolve: (uuid) => ({ id: uuid.split(".").at(-1) }),
    rangeFor: (actor) => (actor.id === "first" ? 2 : 1)
  });
  assert.deepEqual(result.ranges, [
    { index: 0, zone: 2, range: 2, startZone: 1, endZone: 4, endColumn: 5, color: "#38bdf8" },
    { index: 1, zone: 8, range: 1, startZone: 7, endZone: 9, endColumn: 10, color: "#a78bfa" }
  ]);
  assert.notEqual(result.ranges[0].color, result.ranges[1].color);
  assert.deepEqual(result.zones[4].rangeIndexes, []);
  assert.deepEqual(result.zones[7].rangeIndexes, [1]);
});

test("multiple friendly ranges never create a shared blur union", () => {
  const tsc = state([
    { key: "Actor.first", type: "starship", zone: 2 },
    { key: "Actor.second", type: "starship", zone: 8 }
  ]);
  const result = presentation(tsc, {
    isGM: false,
    observerKeys: ["Actor.first", "Actor.second"],
    resolve: () => ({}),
    rangeFor: () => 2
  });
  assert.equal(result.ranges.length, 2);
  assert.equal(result.blurOutside, false);
  assert.ok(result.zones.every((zone) => zone.outsideRange === false));
});

test("range projection exposes no contact key, UUID, name or actor data", () => {
  const result = presentation(state([{ key: "Actor.private-uuid", name: "Private identity", type: "starship", zone: 4 }]), {
    isGM: false,
    observerKeys: ["Actor.private-uuid"],
    resolve: () => ({ id: "private-uuid", name: "Private identity", img: "secret.webp" }),
    rangeFor: () => 3
  });
  const text = JSON.stringify(result);
  for (const secret of ["Actor.private-uuid", "Private identity", "private-uuid", "secret.webp"])
    assert.equal(text.includes(secret), false);
});

test("movement reclamps and moves the outline on the next projection", () => {
  const original = state([{ key: "Actor.friendly", type: "starship", zone: 2 }], 6);
  const moved = moveObject(original, "Actor.friendly", 6);
  const options = { isGM: false, observerKeys: ["Actor.friendly"], resolve: () => ({}), rangeFor: () => 2 };
  assert.equal(presentation(original, options).ranges[0].endZone, 4);
  assert.deepEqual(presentation(moved, options).ranges[0], {
    index: 0,
    zone: 6,
    range: 2,
    startZone: 4,
    endZone: 6,
    endColumn: 7,
    color: "#38bdf8"
  });
});

test("scanner equipment changes update the effective outline without changing the stored base", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const ship = makeShip({
    id: "friendly",
    role: "player",
    stations: [{ id: "scanner", type: "scanners", grade: "commercial" }],
    extra: { dataVersion: 3, sensorRange: 2 }
  });
  const tsc = state([{ key: ship.uuid, type: "starship", zone: 6 }]);
  const options = { isGM: false, observerKeys: [ship.uuid], resolve: () => ship, rangeFor: (actor) => computeShipStats(actor).sensorRange };
  assert.equal(presentation(tsc, options).ranges[0].range, 3);
  await ship.update({ "flags.sf2e-tactical-starship-combat.starship.stations.0.grade": "advanced" });
  assert.equal(presentation(tsc, options).ranges[0].range, 4);
  assert.equal(ship.flags["sf2e-tactical-starship-combat"].starship.sensorRange, 2);
});

test("unavailable or invalid range produces no invented outline or full-map blur", () => {
  const tsc = state([{ key: "Actor.friendly", type: "starship", zone: 6 }]);
  for (const range of [null, undefined, -1, 1.5, "4"]) {
    const result = presentation(tsc, {
      isGM: false,
      observerKeys: ["Actor.friendly"],
      resolve: () => ({}),
      rangeFor: () => range
    });
    assert.deepEqual(result.ranges, []);
    assert.equal(result.blurOutside, false);
  }
});

test("hiding range presentation removes outlines and player blur", () => {
  const result = presentation(state([{ key: "Actor.friendly", type: "starship", zone: 3 }]), {
    isGM: false,
    observerKeys: ["Actor.friendly"],
    resolve: () => ({}),
    rangeFor: () => 2,
    showRanges: false
  });
  assert.deepEqual(result.ranges, []);
  assert.equal(result.blurOutside, false);
  assert.ok(result.zones.every((zone) => zone.outsideRange === false));
});
