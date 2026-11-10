import { test } from "node:test";
import assert from "node:assert/strict";
import { copyName, expandEntries, clampCount } from "../../scripts/combat/copies.mjs";
import { seekDC } from "../../scripts/engine/detection.mjs";
import { stationOptions } from "../../scripts/crew/station-options.mjs";
import { normalizePreset } from "../../scripts/combat/presets.mjs";

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
