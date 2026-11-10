import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
let mods;

/** Player ship: Ava helms gunnery, Bob has no station. The Raider sits two zones away, Far is out of weapon range. */
async function scenario(mode) {
  const env = installFoundryMock();
  await loadContentFromDisk();
  mods ??= {
    engine: await import("../../scripts/actions/action-engine.mjs"),
    runner: await import("../../scripts/ui/action-runner.mjs"),
    rules: await import("../../scripts/engine/target-rules.mjs"),
    card: await import("../../scripts/chat/attack-card.mjs")
  };
  env.settings.set("ruleEnforcement", mode);
  const ava = makeCharacter({ id: "ava", name: "Ava", owners: ["p1"] });
  const bob = makeCharacter({ id: "bob", name: "Bob", owners: ["p2"] });
  const aurora = makeShip({
    id: "aurora",
    name: "Aurora",
    role: "player",
    owners: [],
    stations: [
      { id: "gunnery-1", type: "gunnery", name: "Gunnery", grade: "commercial", helmedBy: "Actor.ava", weaponId: "w1" },
      { id: "pilot-1", type: "pilot", name: "Pilot", grade: "commercial", helmedBy: null }
    ],
    weapons: [{ id: "w1", weaponRef: "coilgun", name: "Coilgun" }],
    crew: [
      { actorUuid: "Actor.ava", name: "Ava", role: "crew", stationId: "gunnery-1", userId: "p1" },
      { actorUuid: "Actor.bob", name: "Bob", role: "crew", stationId: null, userId: "p2" }
    ]
  });
  const raider = makeShip({ id: "raider", name: "Raider", role: "npc", ac: 18, sp: 10, hp: 20 });
  const far = makeShip({ id: "far", name: "Far", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [
      { key: aurora.uuid, zone: 2, alwaysVisible: true, detection: { party: "identified" } },
      { key: raider.uuid, zone: 4, heading: "left", detection: { party: "identified" } },
      { key: far.uuid, zone: 11, detection: { party: "identified" } }
    ]
  });
  await combat.createEmbeddedDocuments("Combatant", [
    { actorId: "ava", initiative: 20 },
    { actorId: "bob", initiative: 15 },
    { actorId: "raider", initiative: 10 }
  ]);
  combat.turn = 0;
  return { ava, bob, aurora, raider, far, combat, p1: game.users.get("p1"), p2: game.users.get("p2"), gm: game.users.get("gm") };
}

/** Bob tries a pilot action while not helming the pilot station (a station rule, not a permission). */
const pilotAction = (s) =>
  mods.engine.executeAction({
    userId: "p2",
    shipUuid: s.aurora.uuid,
    actionId: "boost-thrusters",
    crewUuid: s.bob.uuid,
    stationId: null,
    options: {}
  });

test("strict mode: not helming the station refuses the action (as in 0.9.x)", async () => {
  const s = await scenario("strict");
  await assert.rejects(() => pilotAction(s), /helming/i);
});

test("warn mode: not helming only warns, the action runs and the warning leads the report list", async () => {
  const s = await scenario("warn");
  const res = await pilotAction(s);
  assert.equal(res.ok, true);
  assert.match(res.reports[0], /^⚠ .*helming/i);
});

test("warn mode never lets a player bypass permissions: a user without access is still refused", async () => {
  const s = await scenario("warn");
  s.aurora.ownership = {};
  await assert.rejects(
    () =>
      mods.engine.executeAction({
        userId: "p3",
        shipUuid: s.aurora.uuid,
        actionId: "boost-thrusters",
        crewUuid: null,
        stationId: null,
        options: {}
      }),
    /permission|access|allowed/i
  );
});

test("target rules: out-of-range is an unavailable target in strict mode and an available one with a warning in warn mode", async () => {
  const s = await scenario("strict");
  const tsc = (await import("../../scripts/combat/tsc-state.mjs")).getTsc(s.combat);
  const input = { tsc, shipKey: s.aurora.uuid, obj: tsc.objects.find((o) => o.key === s.far.uuid), range: 3 };
  const strict = mods.rules.evaluateTarget(input);
  assert.deepEqual([strict.available, strict.reason, strict.warning], [false, "outOfRange", undefined]);
  const soft = mods.rules.evaluateTarget({ ...input, soft: true });
  assert.deepEqual([soft.available, soft.warning, soft.reason], [true, "outOfRange", null]);
  assert.ok(soft.distance > 3, "the distance is still reported");
  // hard reasons stay hard in warn mode
  const self = mods.rules.evaluateTarget({ ...input, soft: true, obj: tsc.objects.find((o) => o.key === s.aurora.uuid) });
  assert.deepEqual([self.available, self.reason], [false, "self"]);
});

test("attack declaration card (warn mode): the out-of-range ship is a selectable target marked with a warning", async () => {
  const s = await scenario("warn");
  const res = await mods.card.declareAttack({
    user: s.p1,
    payload: { shipUuid: s.aurora.uuid, actionId: "strike", crewUuid: s.ava.uuid, stationId: "gunnery-1", options: {} }
  });
  const card = game.messages.get(res.messageId).flags[M].attackCard;
  const far = card.targets.find((t) => t.key === s.far.uuid);
  assert.deepEqual([far.available, far.warning], [true, "outOfRange"]);
  assert.ok(res.targets.includes(s.far.uuid));
});

test("preview (warn mode): rule problems are warnings on an enabled button, 'no combat' still blocks", async () => {
  const s = await scenario("warn");
  const action = (await import("../../scripts/content/loader.mjs")).Content.actions.get("boost-thrusters");
  const station = s.aurora.flags[M].starship.stations.find((x) => x.id === "pilot-1");
  station.malfunctioning = true;
  const withCombat = mods.runner.previewAction(action, { ship: s.aurora, crew: s.bob, station, combat: s.combat });
  assert.equal(withCombat.enabled, true);
  assert.ok(withCombat.warnings.length >= 1);
  assert.deepEqual(withCombat.reasons, []);
  const noCombat = mods.runner.previewAction(action, { ship: s.aurora, crew: s.bob, station, combat: null });
  assert.equal(noCombat.enabled, false);
  game.settings.set(M, "ruleEnforcement", "strict");
  const strict = mods.runner.previewAction(action, { ship: s.aurora, crew: s.bob, station, combat: s.combat });
  assert.equal(strict.enabled, false);
  assert.deepEqual(strict.warnings, []);
});
