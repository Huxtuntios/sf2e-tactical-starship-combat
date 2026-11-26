import test from "node:test";
import assert from "node:assert/strict";
import * as strike from "../../scripts/actions/strike.mjs";

const profile = (weapon) => {
  assert.equal(typeof strike.weaponProfileOf, "function", "weapon profile helper is exposed");
  return strike.weaponProfileOf(weapon);
};

test("plasma detection reads actual weapon group, type, id, name and trait fields", () => {
  for (const weapon of [
    { group: "Plasma" },
    { type: "plasma" },
    { id: "plasma-cannon" },
    { name: "Dominion Plasma Cannon" },
    { traits: ["tech", "PLASMA"] }
  ])
    assert.equal(profile(weapon).plasma, true, JSON.stringify(weapon));

  for (const weapon of [{ group: "laser" }, { name: "Coilgun" }, { traits: ["tech", "area (burst 1 zone)"] }, null])
    assert.equal(profile(weapon).plasma, false, JSON.stringify(weapon));
});

test("attack shape uses actual area and volley values without inventing a size", () => {
  assert.deepEqual(profile({ traits: ["area (burst 2 zones)"] }).shape, { type: "burst", value: 2 });
  assert.deepEqual(profile({ traits: ["area (line)"] }).shape, { type: "line", value: null });
  assert.deepEqual(profile({ traits: ["area (cone)"] }).shape, { type: "cone", value: null });
  assert.deepEqual(profile({ traits: ["emanation 3"] }).shape, { type: "emanation", value: 3 });
  assert.deepEqual(profile({ traits: ["volley 2 zones"] }).shape, { type: "volley", value: 2 });
  assert.deepEqual(profile({ kind: "melee", range: 0 }).shape, { type: "single", value: null });
  assert.deepEqual(profile({ kind: "ranged", range: 5 }).shape, { type: "single", value: null });
});

test("area plasma gets a basic Reflex save with crew DC source and no fabricated DC", () => {
  const result = profile({ group: "plasma", traits: ["area (burst 1 zone)"] });
  assert.deepEqual(result.save, { type: "reflex", basic: true, dc: null, source: "crew" });
  assert.equal(result.area, true);
});

test("explicit non-area save metadata honors verified type, basic flag and DC", () => {
  const result = profile({ name: "Plasma cannon", save: { type: "Will", basic: false, dc: 33 } });
  assert.deepEqual(result.save, { type: "will", basic: false, dc: 33, source: "weapon" });
  assert.equal(result.area, false);
});

test("area saves remain basic Reflex while honoring an explicit verified DC", () => {
  const result = profile({ group: "plasma", traits: ["area (cone)"], save: { type: "will", dc: 29 } });
  assert.deepEqual(result.save, { type: "reflex", basic: true, dc: 29, source: "weapon" });
});

test("absent save DC stays null while explicit zero remains a weapon DC", () => {
  for (const dc of [undefined, null, ""])
    assert.deepEqual(profile({ name: "Plasma cannon", save: { type: "reflex", dc } }).save, {
      type: "reflex",
      basic: false,
      dc: null,
      source: "crew"
    });
  assert.deepEqual(profile({ name: "Plasma cannon", save: { type: "reflex", dc: 0 } }).save, {
    type: "reflex",
    basic: false,
    dc: 0,
    source: "weapon"
  });
});

test("non-area plasma without valid save metadata gets no invented save", () => {
  for (const save of [undefined, {}, { type: "mystery", dc: 20 }, { type: "reflex", dc: "not-a-dc" }])
    assert.equal(profile({ name: "Plasma rifle", save }).save, null);
});
