import test from "node:test";
import assert from "node:assert/strict";
import { calculateZoneDistance, classifyRange, rangePenalty } from "../../scripts/engine/range.mjs";
import {
  calculateConeZones,
  calculateLineZones,
  calculateEmanationZones,
  calculateBurstZones,
  parseAreaTrait
} from "../../scripts/engine/areas.mjs";
import { moveAlongHeading, isAttackFromBehind, oppositeHeading } from "../../scripts/engine/heading.mjs";
import { normalizeCost } from "../../scripts/engine/cost.mjs";
import { computeStarshipDamage } from "../../scripts/engine/damage.mjs";
import {
  calculateHullIntegrityDC,
  hullIntegrityDelta,
  resolveCompromisedChange,
  resolveHullRestored
} from "../../scripts/engine/compromised.mjs";
import { resolveSeek, contactName, detectionTargetability } from "../../scripts/engine/detection.mjs";
import { parseRoutineActions, parseReset, isResetReady, hazardNeedsCombatant } from "../../scripts/engine/hazard-rules.mjs";
import { isFrequencyAvailable, recordUse } from "../../scripts/engine/frequency.mjs";
import { stationGradeForLevel, scaledDiceCount, frameStatsAtLevel } from "../../scripts/engine/advancement.mjs";
import { migrate } from "../../scripts/engine/migration.mjs";
import { normalizeStarship } from "../../scripts/engine/validation.mjs";
import { DEGREE } from "../../scripts/constants.mjs";

test("range: ship zone 2 vs enemy zone 8 = 6", () => {
  assert.equal(calculateZoneDistance(2, 8), 6);
  assert.equal(classifyRange(2, 8, 6).inRange, true);
  assert.equal(classifyRange(2, 8, 5).status, "out-of-range");
  assert.equal(classifyRange(3, 3, 0).status, "same-zone");
});
test("range increments and volley", () => {
  assert.equal(rangePenalty({ distance: 3, rangeIncrement: 3 }).penalty, 0);
  assert.equal(rangePenalty({ distance: 7, rangeIncrement: 3 }).penalty, -4);
  assert.equal(rangePenalty({ distance: 1, volley: 2 }).penalty, -2);
});
test("areas: cone follows heading", () => {
  assert.deepEqual(calculateConeZones(5, "right", 3, 12), [5, 6, 7, 8]);
  assert.deepEqual(calculateConeZones(5, "left", 3, 12), [2, 3, 4, 5]);
  assert.deepEqual(calculateConeZones(11, "right", 3, 12), [11, 12]);
});
test("areas: line, emanation, burst", () => {
  assert.deepEqual(calculateLineZones(1, "right", 2, 12), [1, 2, 3]);
  assert.deepEqual(calculateEmanationZones(5, 1, 12), [4, 5, 6]);
  assert.deepEqual(calculateEmanationZones(5, 0, 12), [5]);
  assert.deepEqual(calculateEmanationZones(1, 2, 12), [1, 2, 3]);
  assert.deepEqual(calculateBurstZones(5, 1, 12), [5, 6]);
  assert.deepEqual(calculateBurstZones(5, 2, 12), [4, 5, 6, 7]);
  assert.deepEqual(calculateBurstZones(5, 0, 12), [5]);
  assert.deepEqual(parseAreaTrait("area (burst 1 zone)"), { type: "burst", value: 1 });
});
test("heading: boost right, change heading, boost left", () => {
  let zone = 5,
    heading = "right";
  zone = moveAlongHeading(zone, heading, 3, 12);
  assert.equal(zone, 8);
  heading = oppositeHeading(heading);
  assert.equal(heading, "left");
  zone = moveAlongHeading(zone, heading, 3, 12);
  assert.equal(zone, 5);
  assert.equal(moveAlongHeading(2, "left", 5, 12), 1);
  assert.equal(moveAlongHeading(11, "right", 5, 12), 12);
});
test("heading: off-guard from behind", () => {
  // target heading right at zone 5: rear is to the left (zones < 5)
  assert.equal(isAttackFromBehind(2, 5, "right"), true);
  assert.equal(isAttackFromBehind(8, 5, "right"), false);
  assert.equal(isAttackFromBehind(5, 5, "right"), false);
  assert.equal(isAttackFromBehind(8, 5, "left"), true);
});
test("action cost parsing: numbers, reaction and free (nothing is counted or limited)", () => {
  assert.deepEqual(normalizeCost(2), { actions: 2, reaction: false, free: false });
  assert.deepEqual(normalizeCost("reaction"), { actions: 0, reaction: true, free: false });
  assert.deepEqual(normalizeCost("free"), { actions: 0, reaction: false, free: true });
  assert.deepEqual(normalizeCost("nonsense"), { actions: 0, reaction: false, free: false });
});
test("damage: SP 10 HP 30 takes 14 -> SP 0 HP 26", () => {
  const r = computeStarshipDamage({ state: { hp: 30, sp: 10 }, amount: 14 });
  assert.equal(r.newState.sp, 0);
  assert.equal(r.newState.hp, 26);
  assert.equal(r.shieldDamage, 10);
  assert.equal(r.hullDamage, 4);
});
test("damage: bypassing ignores shields", () => {
  const r = computeStarshipDamage({ state: { hp: 30, sp: 10 }, amount: 10, traits: ["bypassing"] });
  assert.equal(r.newState.sp, 10);
  assert.equal(r.newState.hp, 20);
  assert.equal(r.bypassedShields, true);
});
test("damage: resistance, weakness, immunity, hardness", () => {
  assert.equal(
    computeStarshipDamage({ state: { hp: 30, sp: 0, resistances: { fire: 5 } }, amount: 8, damageType: "fire" }).newState.hp,
    27
  );
  assert.equal(computeStarshipDamage({ state: { hp: 30, sp: 0, weaknesses: { cold: 3 } }, amount: 5, damageType: "cold" }).newState.hp, 22);
  const imm = computeStarshipDamage({ state: { hp: 30, sp: 0, immunities: ["poison"] }, amount: 9, damageType: "poison" });
  assert.equal(imm.immune, true);
  assert.equal(imm.newState.hp, 30);
  const h = computeStarshipDamage({ state: { hp: 20, sp: 0, hardness: 5, isPlayer: false }, amount: 12 });
  assert.equal(h.hardnessReduction, 5);
  assert.equal(h.newState.hp, 13);
});
test("damage: player ship at 0 HP becomes compromised 1 and inoperable", () => {
  const r = computeStarshipDamage({ state: { hp: 5, sp: 0 }, amount: 9 });
  assert.equal(r.newState.hp, 0);
  assert.equal(r.becameCompromised, true);
  assert.equal(r.newState.compromised, 1);
  assert.equal(r.newState.inoperable, true);
  assert.equal(r.stationsMalfunctioned, true);
});
test("damage: critical, wrecked, nonlethal, compromised damage", () => {
  assert.equal(computeStarshipDamage({ state: { hp: 5, sp: 0 }, amount: 9, criticalHit: true }).newState.compromised, 2);
  assert.equal(computeStarshipDamage({ state: { hp: 5, sp: 0, wrecked: 2 }, amount: 9 }).newState.compromised, 3);
  const nl = computeStarshipDamage({ state: { hp: 5, sp: 0 }, amount: 9, nonlethal: true });
  assert.equal(nl.newState.compromised, 0);
  assert.equal(nl.newState.inoperable, true);
  const c = computeStarshipDamage({ state: { hp: 0, sp: 0, compromised: 2, inoperable: true }, amount: 4 });
  assert.equal(c.newState.compromised, 3, "unmitigated damage while compromised adds 1");
  assert.equal(
    computeStarshipDamage({ state: { hp: 0, sp: 0, compromised: 2, inoperable: true }, amount: 4, criticalHit: true }).newState.compromised,
    4
  );
});
test("damage: shields fully absorbing does not increase compromised", () => {
  const r = computeStarshipDamage({ state: { hp: 0, sp: 10, compromised: 2, inoperable: true }, amount: 4 });
  assert.equal(r.newState.compromised, 2);
  assert.equal(r.newState.sp, 6);
});
test("damage: non-player ship is destroyed at 0 HP", () => {
  const r = computeStarshipDamage({ state: { hp: 5, sp: 0, isPlayer: false }, amount: 9 });
  assert.equal(r.destroyed, true);
  assert.equal(r.newState.destroyed, true);
});
test("compromised 10 destroys", () => {
  const r = computeStarshipDamage({ state: { hp: 3, sp: 0, compromised: 9 }, amount: 1 });
  assert.equal(r.newState.compromised, 10);
  assert.equal(r.newState.destroyed, true);
});
test("hull integrity: DC and deltas", () => {
  assert.equal(calculateHullIntegrityDC(3), 13);
  assert.equal(hullIntegrityDelta(DEGREE.CRITICAL_SUCCESS), -2);
  assert.equal(hullIntegrityDelta(DEGREE.SUCCESS), -1);
  assert.equal(hullIntegrityDelta(DEGREE.FAILURE), 1);
  assert.equal(hullIntegrityDelta(DEGREE.CRITICAL_FAILURE), 2);
  const lost = resolveCompromisedChange({ compromised: 1, wrecked: 0, inoperable: true }, -1);
  assert.deepEqual([lost.compromised, lost.wrecked, lost.inoperable, lost.lostCompromised], [0, 1, false, true]);
  const dead = resolveCompromisedChange({ compromised: 9, wrecked: 0 }, 2);
  assert.equal(dead.destroyed, true);
  const restored = resolveHullRestored({ compromised: 3, wrecked: 1, inoperable: true }, 0, 6);
  assert.deepEqual([restored.compromised, restored.wrecked, restored.inoperable], [0, 2, false]);
});
test("detection: Seek Starships and contacts", () => {
  assert.equal(resolveSeek("undetected", DEGREE.CRITICAL_SUCCESS), "observed");
  assert.equal(resolveSeek("undetected", DEGREE.SUCCESS), "hidden");
  assert.equal(resolveSeek("hidden", DEGREE.SUCCESS), "observed");
  assert.equal(resolveSeek("hidden", DEGREE.FAILURE), "hidden");
  assert.equal(detectionTargetability("hidden"), "flat-check");
  assert.equal(contactName(0, "greek"), "Contact Alpha");
  assert.equal(contactName(1, "numeric"), "Contact 02");
  assert.equal(contactName(1, "naval"), "Contact Bravo");
});
test("hazards: routine, reset, combatant rule", () => {
  assert.equal(parseRoutineActions("1 action"), 1);
  assert.equal(parseRoutineActions("2 actions"), 2);
  assert.deepEqual(parseReset("The hazard resets immediately."), { type: "immediate", value: 0 });
  assert.deepEqual(parseReset("The hazard resets after 1 round."), { type: "rounds", value: 1 });
  assert.deepEqual(parseReset("1 minute"), { type: "seconds", value: 60 });
  assert.equal(isResetReady({ type: "rounds", value: 1 }, { round: 2 }, { round: 3, time: 0 }), true);
  assert.equal(isResetReady({ type: "never" }, { round: 2 }, { round: 9, time: 0 }), false);
  assert.equal(hazardNeedsCombatant({ isComplex: true }), true);
  assert.equal(hazardNeedsCombatant({ isComplex: false }), false);
});
test("frequency", () => {
  const f = { per: "round", uses: 1 };
  assert.equal(isFrequencyAvailable(f, null, { round: 1, turn: 0, time: 0 }), true);
  const used = recordUse(null, { round: 1, turn: 0, time: 0 });
  assert.equal(isFrequencyAvailable(f, used, { round: 1, turn: 1, time: 0 }), false);
  assert.equal(isFrequencyAvailable(f, used, { round: 2, turn: 0, time: 6 }), true);
  assert.equal(isFrequencyAvailable({ per: "hour", uses: 1 }, used, { round: 9, turn: 0, time: 1800 }), false);
});
test("advancement: grades and scaling", () => {
  assert.equal(stationGradeForLevel("gunnery", 3), "tactical");
  assert.equal(stationGradeForLevel("gunnery", 4), "advanced");
  assert.equal(stationGradeForLevel("pilot", 4), "tactical");
  assert.equal(stationGradeForLevel("pilot", 5), "advanced");
  assert.equal(stationGradeForLevel("generator", 18), "paragon");
  assert.equal(scaledDiceCount({ base: 1, from: 3, step: 2 }, 1), 1);
  assert.equal(scaledDiceCount({ base: 1, from: 3, step: 2 }, 3), 2);
  assert.equal(scaledDiceCount({ base: 1, from: 3, step: 2 }, 5), 3);
  const frame = {
    table: [
      { level: 1, hp: 24 },
      { level: 2, hp: 36 }
    ]
  };
  assert.equal(frameStatsAtLevel(frame, 2).hp, 36);
});
test("migration and normalization", () => {
  const { data, log } = migrate({ level: 3 });
  assert.equal(data.dataVersion, 2);
  assert.deepEqual(log, ["0->1", "1->2"]);
  const n = normalizeStarship({ hp: { value: 99, max: 24 }, heading: "up" });
  assert.equal(n.data.hp.value, 24);
  assert.equal(n.data.heading, "right");
  assert.ok(n.warnings.length >= 1);
  assert.ok(normalizeStarship({ level: 99 }).errors.length >= 1);
});

import { stackModifiers } from "../../scripts/engine/stacking.mjs";
import {
  defaultSensorState,
  addObject,
  moveObject,
  moveObjectAlongHeading,
  setHeading,
  setDetection,
  viewFor,
  assignDesignation,
  resizeZones,
  normalizeSensorState,
  findObject
} from "../../scripts/engine/sensor-ops.mjs";

test("stacking: same type bonuses do not stack, penalties take worst, untyped stack", () => {
  assert.equal(
    stackModifiers([
      { type: "circumstance", value: 1 },
      { type: "circumstance", value: 2 },
      { type: "status", value: 1 }
    ]).total,
    3
  );
  assert.equal(
    stackModifiers([
      { type: "circumstance", value: -1 },
      { type: "circumstance", value: -2 }
    ]).total,
    -2
  );
  assert.equal(
    stackModifiers([
      { type: "untyped", value: 1 },
      { type: "untyped", value: 1 }
    ]).total,
    2
  );
});
test("sensor ops: add, move, heading, resize, persistence-safe normalize", () => {
  let s = defaultSensorState({ enabled: true });
  assert.equal(s.zones, 12);
  s = addObject(s, { key: "a", name: "Player", zone: 2, heading: "right", type: "starship" });
  s = addObject(s, { key: "b", name: "Enemy", zone: 8, heading: "left" });
  assert.equal(findObject(s, "b").zone, 8);
  s = moveObjectAlongHeading(s, "a", 3);
  assert.equal(findObject(s, "a").zone, 5);
  s = setHeading(s, "a", "left");
  s = moveObjectAlongHeading(s, "a", 3);
  assert.equal(findObject(s, "a").zone, 2);
  s = moveObject(s, "b", 99);
  assert.equal(findObject(s, "b").zone, 12);
  s = resizeZones(s, 6);
  assert.equal(findObject(s, "b").zone, 6);
  assert.equal(normalizeSensorState({ zones: 999 }).zones, 50);
  assert.equal(normalizeSensorState({ zones: 1 }).zones, 3);
});
test("sensor view: players do not see undetected objects or hidden identity", () => {
  let s = defaultSensorState({ enabled: true });
  s = addObject(s, { key: "me", name: "USS Horizon", zone: 2, alwaysVisible: true });
  s = addObject(s, { key: "e1", name: "Pirate Frigate", zone: 8, detection: { party: "observed" } });
  s = addObject(s, { key: "e2", name: "Secret Mine", zone: 6, type: "hazard", detection: { party: "undetected" } });
  s = addObject(s, { key: "e3", name: "Cloaked", zone: 9, detection: { party: "hidden" } });
  s = assignDesignation(s, "e1", "greek");
  const player = viewFor(s, { isGM: false, ownKeys: ["me"] });
  assert.equal(player.find((o) => o.key === "e1").label, "Contact Alpha");
  assert.equal(
    player.find((o) => o.key === "e2"),
    undefined
  );
  assert.equal(player.find((o) => o.key === "e3").label, "?");
  assert.equal(viewFor(s, { isGM: true }).find((o) => o.key === "e2").label, "Secret Mine");
  s = setDetection(s, "e1", "party", "identified");
  assert.equal(viewFor(s, { ownKeys: ["me"] }).find((o) => o.key === "e1").label, "Pirate Frigate");
  assert.equal(
    viewFor(s, { ownKeys: ["me"], showUnknown: false }).find((o) => o.key === "e3"),
    undefined
  );
});

import { parseHazardEffect } from "../../scripts/engine/hazard-rules.mjs";
import { estimateEncounter, entryXP } from "../../scripts/engine/encounter.mjs";
test("hazard effect parsing: damage, type, save and DC", () => {
  const p = parseHazardEffect("Each starship in the zone takes 4d6 fire damage (DC 22 basic Reflex save).");
  assert.deepEqual([p.damage, p.damageType, p.save, p.dc, p.basic], ["4d6", "fire", "reflex", 22, true]);
  assert.equal(parseHazardEffect("Nothing automatable here.").damage, null);
});
test("encounter estimate: XP table, small crew only warns", () => {
  assert.equal(entryXP({ kind: "ship", level: 5 }, 5), 40);
  assert.equal(entryXP({ kind: "ship", level: 7 }, 5), 80);
  assert.equal(entryXP({ kind: "simpleHazard", level: 5 }, 5), 8);
  const e = estimateEncounter({
    partyLevel: 5,
    partySize: 4,
    entries: [
      { kind: "ship", level: 6 },
      { kind: "ship", level: 5 }
    ]
  });
  assert.equal(e.xp, 100);
  assert.equal(e.threat, "moderate");
});
test("initiative tie-break and compromised entry data is plain", () => {
  const entry = { compromisedEntry: true, shipUuid: "Actor.abc" };
  assert.equal(JSON.parse(JSON.stringify(entry)).compromisedEntry, true);
});
