import test from "node:test";
import assert from "node:assert/strict";
import { keepDamage, mergeStarshipFlag, chooseName, stripLevelSuffix } from "../../scripts/content/ship-update.mjs";
import { budgetFor, rateXP, estimateEncounter, suggestShips } from "../../scripts/engine/encounter.mjs";

test("update from compendium: damage taken is kept and clamped", () => {
  assert.equal(keepDamage(30, 50, 60), 40);
  assert.equal(keepDamage(50, 50, 60), 60);
  assert.equal(keepDamage(5, 50, 30), 0);
  assert.equal(keepDamage(undefined, undefined, 60), 60);
});

test("update from compendium: crew, station helms and shields survive", () => {
  const old = {
    crew: [{ actorUuid: "Actor.a", stationId: "s-old" }],
    sp: { value: 4, max: 10 },
    stations: [{ id: "s-old", type: "pilot", helmedBy: "Actor.a", malfunctioning: true }]
  };
  const fresh = {
    sp: { max: 12 },
    stations: [
      { id: "s-new", type: "pilot" },
      { id: "g", type: "gunnery" }
    ]
  };
  const out = mergeStarshipFlag(old, fresh);
  assert.deepEqual(out.sp, { value: 6, max: 12 });
  assert.equal(out.stations[0].helmedBy, "Actor.a");
  assert.equal(out.stations[0].malfunctioning, true);
  assert.equal(out.stations[1].helmedBy, undefined);
  assert.equal(out.crew[0].stationId, "s-new");
});

test("update from compendium: GM renames are kept, content names get the level", () => {
  assert.equal(stripLevelSuffix("Raider (ур. 5)"), "Raider");
  assert.equal(chooseName("Raider", "Raider (Lv 5)"), "Raider (Lv 5)");
  assert.equal(chooseName("Рейдер", "Raider (Lv 5)", ["Рейдер"]), "Raider (Lv 5)");
  assert.equal(chooseName("Мой корабль", "Raider (Lv 5)"), "Мой корабль");
});

test("encounter budget: party size and small crew", () => {
  assert.equal(budgetFor("moderate", 4), 80);
  assert.equal(budgetFor("moderate", 5), 100);
  assert.equal(budgetFor("severe", 6), 180);
  assert.equal(budgetFor("moderate", 3), 60);
  assert.equal(budgetFor("extreme", 2), 140);
});

test("encounter threat: highest budget reached", () => {
  assert.equal(rateXP(30).threat, "trivial");
  assert.equal(rateXP(80).threat, "moderate");
  assert.equal(rateXP(119).threat, "moderate");
  assert.equal(rateXP(120).threat, "severe");
  assert.equal(rateXP(200).beyond, true);
  assert.equal(estimateEncounter({ partyLevel: 5, partySize: 4, entries: [{ kind: "ship", level: 7 }] }).threat, "moderate");
});

test("encounter suggestions stay inside the target band", () => {
  const ships = [
    { id: "a", name: "A", level: 5 },
    { id: "b", name: "B", level: 7 },
    { id: "c", name: "C", level: 12 }
  ];
  const s = suggestShips({ partyLevel: 5, partySize: 4, threat: "moderate", ships });
  assert.ok(s.length > 0);
  for (const x of s) assert.ok(x.total >= 80 && x.total < 120, JSON.stringify(x));
  assert.ok(s.some((x) => x.id === "a" && x.count === 2));
  assert.ok(!s.some((x) => x.id === "c"));
  assert.deepEqual(suggestShips({ partyLevel: 5, threat: "low", ships, currentXP: 200 }), []);
});
