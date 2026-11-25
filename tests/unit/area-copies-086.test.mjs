import { test } from "node:test";
import assert from "node:assert/strict";
import { expandEntries, parseZoneList } from "../../scripts/combat/copies.mjs";
import { normalizePreset } from "../../scripts/combat/presets.mjs";
import { areaTargets, calculateAreaZones } from "../../scripts/engine/areas.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { resolveAreaFire } from "../../scripts/actions/strike.mjs";
import { computeShipStats } from "../../scripts/starship/stats.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import {
  dice,
  installFoundryMock,
  loadContentFromDisk,
  makeCharacter,
  makeShip,
  makeStarshipCombat,
  MockActor
} from "../helpers/foundry-mock.mjs";

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

test("Area Fire uses scoped ship DC and Reflex while preserving hazard saves", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const crew = makeCharacter({ id: "gunner", name: "Gunner" });
  crew.classDC = { dc: { value: 15 } };
  const ship = makeShip({
    id: "attacker",
    name: "Attacker",
    stations: [{ id: "gun", type: "gunnery", grade: "commercial", helmedBy: crew.uuid, weaponId: "w1" }],
    weapons: [{ id: "w1", name: "Plasma cannon", die: "1d6", damageType: "fire", range: 6, traits: ["area (burst 1 zone)"] }],
    effects: [
      {
        id: "area-dc",
        manual: true,
        targets: { entire: false, actions: [{ stationId: "gun", actionId: "area-fire" }] },
        modifiers: [{ selector: "area-dc", value: 2, type: "untyped" }],
        conditions: []
      }
    ]
  });
  const target = makeShip({
    id: "target",
    name: "Target",
    role: "npc",
    sp: 10,
    effects: [
      {
        id: "reflex",
        manual: true,
        targets: { entire: true },
        modifiers: [{ selector: "reflex", value: -3, type: "untyped" }],
        conditions: []
      }
    ]
  });
  const hazard = new MockActor({
    id: "hazard",
    name: "Hazard",
    type: "hazard",
    system: {
      attributes: { hp: { value: 20, max: 20 }, ac: { value: 14 }, hardness: 0 },
      saves: { fortitude: { value: 5 }, reflex: { value: 6 }, will: { value: 4 } }
    }
  });
  game.actors.set(hazard.id, hazard);
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 3 },
      { key: target.uuid, zone: 4 },
      { key: hazard.uuid, type: "hazard", zone: 4 }
    ]
  });
  const data = readStarship(ship);
  const ctx = {
    ship,
    shipUuid: ship.uuid,
    crew,
    data,
    stats: computeShipStats(ship),
    station: data.stations[0],
    action: { id: "area-fire" },
    combat,
    draft: new Draft(combat),
    tsc: combat.flags["sf2e-tactical-starship-combat"].tsc,
    options: { areaOrigin: 4, skipDialog: true, gmOverride: true },
    lines: [],
    reports: [],
    damageResults: [],
    rule() {}
  };
  dice(4, 12, 10);
  await resolveAreaFire(ctx, "area-fire");
  await ctx.draft.commit();
  assert.equal(readStarship(target).sp.value, 8, JSON.stringify({ zones: ctx.areaZones, reports: ctx.reports, damage: ctx.damageResults }));
  assert.equal(hazard.system.attributes.hp.value, 16);
});
