import { test } from "node:test";
import assert from "node:assert/strict";
import { expandEntries, parseZoneList } from "../../scripts/combat/copies.mjs";
import { normalizePreset } from "../../scripts/combat/presets.mjs";
import { areaTargets, calculateAreaZones } from "../../scripts/engine/areas.mjs";

test("copies take their own zones, missing ones fall back", () => {
  assert.deepEqual(parseZoneList("6, 7;8 x 0"), [6, 7, 8]);
  const x = expandEntries([{ uuid: "A", zone: 4, count: 3, zones: [6, 8] }]);
  assert.deepEqual(
    x.map((e) => e.zone),
    [6, 8, 4]
  );
  assert.deepEqual(normalizePreset({ zones: 10, enemies: [{ uuid: "A", count: 2, zones: "3,5" }] }).enemies[0].zones, [3, 5]);
});
test("area hits starships and hazards in the zones except self and excluded", () => {
  const objs = [
    { key: "me", type: "starship", zone: 3 },
    { key: "e1", type: "starship", zone: 4 },
    { key: "e2", type: "starship", zone: 4 },
    { key: "e3", type: "starship", zone: 5 },
    { key: "al", type: "starship", zone: 4 },
    { key: "hz", type: "hazard", zone: 4 },
    { key: "private-hz", type: "contact", objectType: "hazard", tscPrivateProjection: true, zone: 4 },
    { key: "custom", type: "contact", objectType: "custom", tscPrivateProjection: true, zone: 4 },
    { key: "far", type: "starship", zone: 9 }
  ];
  const zones = calculateAreaZones({ type: "burst", value: 1, border: 4 }, 3, "right", 10);
  assert.ok(zones.includes(4));
  const r = areaTargets(objs, zones, "me", ["al"]);
  for (const key of ["e1", "e2", "hz", "private-hz"])
    assert.ok(
      r.hit.some((o) => o.key === key),
      `${key} is in the area`
    );
  assert.ok(!r.hit.some((o) => ["me", "al", "custom", "far"].includes(o.key)));
  assert.deepEqual(
    r.excluded.map((o) => o.key),
    ["al"]
  );
});
