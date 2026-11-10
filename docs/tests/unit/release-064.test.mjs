import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeStarshipDamage, normalizeDamageType, iwrMatches, normalizeIwr } from "../../scripts/engine/damage.mjs";
import { normalizePreset, clampZones } from "../../scripts/combat/presets.mjs";

const R = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const base = { shields: 0, maxShields: 0, hp: 100, maxHp: 100, isPlayer: false };

test("0.6.4 damage type normalisation", () => {
  assert.equal(normalizeDamageType("Electric"), "electricity");
  assert.equal(normalizeDamageType("all"), "all-damage");
  assert.ok(iwrMatches("physical", "piercing"));
  assert.ok(iwrMatches("energy", "fire"));
  assert.ok(!iwrMatches("energy", "piercing"));
  assert.deepEqual(
    normalizeIwr([
      { type: "fire", value: 5 },
      { type: "Fire", value: 3 }
    ]),
    { fire: 5 }
  );
});

test("0.6.4 resistances / weaknesses / immunities use groups", () => {
  const r = computeStarshipDamage({ state: { ...base, resistances: { physical: 5 } }, amount: 10, damageType: "piercing" });
  assert.equal(r.resistanceReduction, 5);
  const w = computeStarshipDamage({ state: { ...base, weaknesses: { energy: 4 } }, amount: 10, damageType: "fire" });
  assert.equal(w.weaknessIncrease, 4);
  const i = computeStarshipDamage({ state: { ...base, immunities: ["Electricity"] }, amount: 10, damageType: "electricity" });
  assert.ok(i.immune);
  const n = computeStarshipDamage({ state: { ...base, resistances: { fire: 5 } }, amount: 10, damageType: "cold" });
  assert.equal(n.resistanceReduction, 0);
});

test("0.6.4 presets normalise and zones default to 12", () => {
  assert.equal(clampZones(undefined), 12);
  assert.equal(clampZones(999), 50);
  const p = normalizePreset({
    name: " A ",
    zones: "8",
    playerShips: [{ uuid: "Actor.x", zone: "3" }],
    objects: [{ name: "Rock", zone: 4 }, { zone: 1 }]
  });
  assert.equal(p.name, "A");
  assert.equal(p.zones, 8);
  assert.deepEqual(p.playerShips, [{ uuid: "Actor.x", zone: 3, detection: "identified" }]);
  assert.equal(p.objects.length, 1);
  assert.equal(p.objects[0].type, "custom");
});

test("0.6.4 wizard template: single zone field, start zones, balanced fieldsets", () => {
  const t = R("templates/start-wizard.hbs");
  assert.ok(!t.includes("zonePreset") && !t.includes("customZones"));
  assert.ok(t.includes('name="zones"') && t.includes("shipZone.") && t.includes("data-obj-rows") && t.includes("presetPick"));
  const count = (re) => (t.match(re) ?? []).length;
  assert.equal(count(/<fieldset/g), count(/<\/fieldset>/g));
  assert.equal(count(/<div\b/g), count(/<\/div>/g));
});

test("0.6.4 setting is a plain number, presets registered, no auto move, combat end closes apps", () => {
  const s = R("scripts/settings.mjs");
  assert.ok(!/sensorMapSize[^\n]*range/.test(s));
  assert.ok(s.includes('"combatPresets"'));
  const fx = R("scripts/actions/effects-exec.mjs");
  const mv = fx.slice(fx.indexOf("async moveAlongHeading"), fx.indexOf("async reverseHeading"));
  assert.ok(!mv.includes("moveObjectAlongHeading("));
  const sc = R("scripts/combat/starship-combat.mjs");
  assert.ok(sc.includes("closeTacticalApps") && sc.includes("config.objects"));
  assert.ok(R("templates/station-hud.hbs").includes("tsc-action-desc"));
});
