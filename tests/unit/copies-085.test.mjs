import { test } from "node:test";
import assert from "node:assert/strict";
import { copyName, expandEntries, clampCount } from "../../scripts/combat/copies.mjs";
import { seekDC } from "../../scripts/engine/detection.mjs";
import { stationOptions } from "../../scripts/crew/station-options.mjs";
import { normalizePreset, savePreset, listPresets, deletePreset } from "../../scripts/combat/presets.mjs";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";

test("copy names keep the level suffix", () => {
  assert.equal(copyName("Corsair (Lv 3)", 2), "Corsair #2 (Lv 3)");
  assert.equal(copyName("Mine", 3), "Mine #3");
});
test("entries expand to one per copy, count clamped", () => {
  const x = expandEntries([{ uuid: "A", zone: 4, count: 3 }, { uuid: "B" }]);
  assert.deepEqual(
    x.map((e) => [e.uuid, e.copyIndex, e.zone]),
    [
      ["A", 1, 4],
      ["A", 2, 4],
      ["A", 3, 4],
      ["B", 1, undefined]
    ]
  );
  assert.equal(clampCount(99), 10);
  assert.equal(clampCount(0), 1);
  assert.equal(clampCount("x"), 1);
});
test("presets keep the copy count", () => {
  const p = normalizePreset({ zones: 8, enemies: [{ uuid: "A", count: 3 }], hazards: [{ uuid: "H", count: 2 }] });
  assert.equal(p.enemies[0].count, 3);
  assert.equal(p.hazards[0].count, 2);
});
test("wizard presets retain course, detection, instance placement and station choices idempotently", () => {
  const preset = normalizePreset({
    zones: 15,
    playerShips: [
      {
        uuid: "Actor.player",
        heading: "right",
        stationAssignments: [
          { stationId: "pilot", actorUuid: "Actor.pc" },
          { stationId: "gun", actorUuid: "" }
        ]
      }
    ],
    enemies: [{ uuid: "Compendium.world.ships.Actor.enemy", count: 3, zone: 10, zones: [9, 10, 11], heading: "left", detection: "hidden" }],
    hazards: [{ uuid: "Actor.hazard", count: 2, zones: [4, 5], detection: "undetected" }],
    objects: [{ name: "Moon", type: "planet", zone: 6, art: "moon.webp", detection: "observed" }],
    crew: ["Actor.pc", "Actor.pc"],
    excludeCrew: ["Actor.other"]
  });
  assert.deepEqual(normalizePreset(preset), preset);
  assert.deepEqual(preset.playerShips[0].stationAssignments, [
    { stationId: "pilot", actorUuid: "Actor.pc" },
    { stationId: "gun", actorUuid: null }
  ]);
  assert.equal(preset.enemies[0].heading, "left");
  assert.deepEqual(
    expandEntries(preset.enemies).map((e) => e.zone),
    [9, 10, 11]
  );
  assert.equal(preset.hazards[0].detection, "undetected");
  assert.equal(preset.objects[0].detection, "observed");
  assert.equal(preset.objects[0].art, "moon.webp");
  assert.deepEqual(preset.crew, ["Actor.pc"]);
  assert.deepEqual(preset.excludeCrew, ["Actor.other"]);
  const invalid = normalizePreset({ enemies: [{ uuid: "Actor.x", heading: "up", reuse: "true" }] });
  assert.ok(!("heading" in invalid.enemies[0]));
  assert.ok(!("reuse" in invalid.enemies[0]));
});

test("wizard presets save, overwrite by name, load and delete without creating Actors", async () => {
  installFoundryMock();
  const saved = await savePreset({
    name: " Battle ",
    zones: 20,
    enemies: [{ uuid: "Compendium.world.ships.Actor.x", count: 5, zones: [11, 12], heading: "left", detection: "observed" }]
  });
  assert.ok(saved.id);
  assert.equal(saved.name, "Battle");
  assert.deepEqual(listPresets(), [saved]);
  const replacement = await savePreset({ ...saved, zones: 25, enemies: [{ uuid: "Actor.y", count: 2, detection: "hidden" }] });
  assert.equal(replacement.id, saved.id);
  assert.equal(listPresets().length, 1);
  assert.equal(listPresets()[0].enemies[0].uuid, "Actor.y");
  await deletePreset(saved.id);
  assert.deepEqual(listPresets(), []);
  assert.equal(game.actors.size, 0);
  assert.equal(game.combats.size, 0);
});

test("failed preset writes preserve the last saved configuration", async () => {
  installFoundryMock();
  const saved = await savePreset({ name: "Battle", zones: 12, enemies: [{ uuid: "Actor.x" }] });
  game.settings.set = async () => {
    throw new Error("setting write failed");
  };
  await assert.rejects(savePreset({ ...saved, zones: 40 }), /setting write failed/);
  assert.deepEqual(listPresets(), [saved]);
  await assert.rejects(deletePreset(saved.id), /setting write failed/);
  assert.deepEqual(listPresets(), [saved]);
  assert.equal(game.actors.size, 0);
});

test("seek DC never 0: stealth skill, else level DC", () => {
  assert.equal(seekDC({ stealthMod: 12, level: 5 }), 22);
  assert.equal(seekDC({ stealthMod: null, level: 5 }), 20);
  assert.equal(seekDC({ level: 0 }), 14);
  assert.equal(seekDC({ stealthDC: 0, level: 3 }), 18);
  assert.equal(seekDC({ stealthDC: 25, stealthMod: 3 }), 25);
});
test("station options mark occupied / own / free", () => {
  const d = {
    crew: [
      { actorUuid: "a", name: "Ann" },
      { actorUuid: "b", name: "Bob" }
    ],
    stations: [
      { id: "p", name: "Pilot", helmedBy: "a" },
      { id: "s", name: "Scan", helmedBy: "b" },
      { id: "g", name: "Gun", helmedBy: null }
    ]
  };
  const o = stationOptions(d, "a");
  assert.deepEqual(
    o.map((x) => [x.id, x.mine, x.occupied, x.occupantName]),
    [
      ["p", true, false, null],
      ["s", false, true, "Bob"],
      ["g", false, false, null]
    ]
  );
});
