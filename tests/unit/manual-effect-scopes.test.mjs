import test from "node:test";
import assert from "node:assert/strict";
import { effectModifiers, hasCondition, offGuardAgainst, stationEffects } from "../../scripts/starship/effects.mjs";

const effect = (targets, id = "a") => ({
  id,
  manual: true,
  slug: "focus",
  targets,
  conditions: ["off-guard"],
  modifiers: [
    { selector: "ac", type: "status", value: -1 },
    { selector: "attack", type: "status", value: 2 },
    { selector: "station-check", type: "status", value: 2 }
  ]
});
test("crew-only selections never modify ship AC or grant ship conditions", () => {
  const fx = [effect({ entire: false, allCrew: true, crew: ["Actor.pc"] })];
  assert.deepEqual(effectModifiers(fx, "ac"), []);
  assert.equal(hasCondition(fx, "off-guard", { selector: "ac" }), false);
  assert.equal(offGuardAgainst(fx, "Actor.enemy"), false);
});
test("missing targets defaults entire while explicit false remains empty", () => {
  assert.equal(effectModifiers([effect(undefined)], "ac").length, 1);
  assert.equal(effectModifiers([effect({ entire: false })], "ac").length, 0);
});
test("station and exact action selections require real check context, never global AC", () => {
  const fx = [
    effect({ entire: false, stations: ["pilot"] }),
    effect({ entire: false, actions: [{ stationId: "gun", actionId: "shoot" }] }, "b")
  ];
  assert.equal(effectModifiers(fx, "ac", { stationId: "pilot" }).length, 0);
  assert.equal(effectModifiers(fx, "station-check", { stationId: "pilot", actionId: "fly" }).length, 1);
  assert.equal(effectModifiers(fx, "station-check", { stationId: "gun", actionId: "shoot" }).length, 1);
  assert.equal(effectModifiers(fx, "station-check", { stationId: "gun", actionId: "aim" }).length, 0);
  assert.equal(stationEffects(fx, "gun", null, { selector: "station-check", actionId: "shoot" }).length, 1);
});
test("weapon attacks remain independent of other station checks and weapon defenses", () => {
  const fx = [
    effect({ entire: false, weapons: ["laser"] }),
    effect({ entire: false, weaponAttacks: true }, "b"),
    effect({ entire: false, weaponDefenses: true }, "c")
  ];
  assert.equal(effectModifiers(fx, "attack", { weaponId: "laser" }).length, 2);
  assert.equal(effectModifiers(fx, "attack", { weaponId: "missile" }).length, 1);
  assert.equal(effectModifiers(fx, "station-check", { stationId: "gun", actionId: "aim" }).length, 0);
  assert.equal(effectModifiers(fx, "ac", { weaponId: "laser" }).length, 0);
});
test("scope union returns an application once and preserves distinct modifier slugs", () => {
  const a = effect({ entire: true, mechanics: ["ac"], stations: ["pilot"] });
  const b = effect({ entire: true }, "b");
  const mods = effectModifiers([a, a, b], "ac");
  assert.equal(mods.length, 2);
  assert.notEqual(mods[0].slug, mods[1].slug);
});
test("other defensive statistics affect defensive skill DCs independently of AC and saves", () => {
  globalThis.CONFIG = { PF2E: { skills: { stealth: { attribute: "dex" } } } };
  const fx = [{ ...effect({ entire: false, mechanics: ["defenses"] }), modifiers: [{ selector: "all", type: "status", value: 1 }] }];
  assert.equal(effectModifiers(fx, "ac", { statistic: "dc" }).length, 0);
  assert.equal(effectModifiers(fx, "reflex", { statistic: "dc" }).length, 0);
  assert.equal(effectModifiers(fx, "perception", { statistic: "dc" }).length, 1);
  assert.equal(effectModifiers(fx, "stealth", { statistic: "dc" }).length, 1);
  assert.equal(effectModifiers(fx, "stealth", { statistic: "check" }).length, 0);
});

test("mechanics AC selection excludes saves and crew and legacy against remains restricted", () => {
  const fx = [effect({ entire: false, mechanics: ["ac"] })];
  assert.equal(effectModifiers(fx, "ac").length, 1);
  assert.equal(effectModifiers(fx, "attack").length, 0);
  assert.equal(hasCondition([{ slug: "old", conditions: ["off-guard"], against: "Actor.enemy" }], "off-guard"), false);
  assert.equal(offGuardAgainst([{ slug: "old", conditions: ["off-guard"], against: "Actor.enemy" }], "Actor.enemy"), true);
});
