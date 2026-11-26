import test from "node:test";
import assert from "node:assert/strict";
import {
  dice,
  installFoundryMock,
  loadContentFromDisk,
  makeCharacter,
  makeShip,
  makeStarshipCombat,
  MockActor
} from "../helpers/foundry-mock.mjs";
const M = "sf2e-tactical-starship-combat";
let Targeting;
let executeAction;
let sanitizeActionRequest;

async function loadModules() {
  if (Targeting) return;
  ({ Targeting } = await import("../../scripts/ui/targeting.mjs"));
  ({ executeAction, sanitizeActionRequest } = await import("../../scripts/actions/action-engine.mjs"));
}

function nativeToken(actor, id, { visible = true } = {}) {
  return {
    id,
    actor,
    visible,
    document: { actorUuid: actor?.uuid ?? null, uuid: `Scene.test.Token.${id}` },
    setTarget(targeted, { releaseOthers = true } = {}) {
      if (targeted) {
        if (releaseOthers) game.user.targets.clear();
        game.user.targets.add(this);
      } else game.user.targets.delete(this);
    }
  };
}

async function adapterScenario() {
  installFoundryMock();
  await loadModules();
  Targeting.end();
  const ship = makeShip({ id: "adapter-ship", name: "Adapter Ship" });
  const first = makeShip({ id: "adapter-first", name: "First", role: "npc" });
  const second = makeShip({ id: "adapter-second", name: "Second", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 1, alwaysVisible: true, detection: { party: "identified" } },
      { key: first.uuid, zone: 2, detection: { party: "identified" } },
      { key: second.uuid, zone: 3, detection: { party: "identified" } }
    ]
  });
  const firstToken = nativeToken(first, "token-first");
  const secondToken = nativeToken(second, "token-second");
  game.user.targets = new Set();
  canvas.ready = true;
  canvas.scene = { id: "test-scene" };
  canvas.tokens.placeables = [firstToken, secondToken];
  Targeting.begin({ shipUuid: ship.uuid, range: 99, enforceDetection: true, allowSelf: false, gm: false });
  return { ship, first, second, combat, firstToken, secondToken };
}

test("native adapter resolves current Token targets as deduplicated Actor UUIDs and drops stale tokens", async () => {
  const { first, second, firstToken } = await adapterScenario();
  const duplicate = nativeToken(first, "token-duplicate");
  const stale = nativeToken(second, "token-stale");
  game.actors.delete(second.id);
  canvas.tokens.placeables.push(duplicate, stale, nativeToken(null, "token-actorless"));
  game.user.targets.add(firstToken);
  game.user.targets.add(duplicate);
  game.user.targets.add(stale);

  assert.equal(typeof Targeting.targetUUIDs, "function", "the targeting adapter exposes native UUID resolution");
  assert.deepEqual(Targeting.targetUUIDs(), [first.uuid]);
});

test("Sensor Map picks toggle native Tokens, Shift adds, and removing one target preserves the others", async () => {
  const { first, second, combat, firstToken, secondToken } = await adapterScenario();
  const tsc = combat.flags[M].tsc;

  Targeting.pick(first.uuid, tsc, { additive: false });
  Targeting.pick(second.uuid, tsc, { additive: true });
  assert.deepEqual([...game.user.targets], [firstToken, secondToken]);

  Targeting.pick(first.uuid, tsc, { additive: true });
  assert.deepEqual([...game.user.targets], [secondToken]);
  assert.deepEqual(Targeting.targetUUIDs(), [second.uuid]);
});

test("map-only contacts use ephemeral keys without creating Tokens or persistent flags", async () => {
  const { combat } = await adapterScenario();
  const key = "Contact.map-only";
  combat.flags[M].tsc.objects.push({ key, type: "starship", zone: 4, detection: { party: "identified" } });
  const before = structuredClone(combat.flags);
  const tokenCount = canvas.tokens.placeables.length;

  Targeting.pick(key, combat.flags[M].tsc, { additive: true });

  assert.equal(typeof Targeting.targetUUIDs, "function", "the targeting adapter exposes native UUID resolution");
  assert.deepEqual(Targeting.targetUUIDs(), [key]);
  assert.equal(canvas.tokens.placeables.length, tokenCount);
  assert.deepEqual(combat.flags, before);
  Targeting.end();
  assert.deepEqual(Targeting.targetUUIDs(), []);
});

test("beginning or ending a targeting session never clears native Token targets", async () => {
  const { first, firstToken } = await adapterScenario();
  firstToken.setTarget(true);

  Targeting.begin({ shipUuid: first.uuid, range: 99 });
  assert.deepEqual([...game.user.targets], [firstToken]);
  Targeting.end();
  assert.deepEqual([...game.user.targets], [firstToken]);
});

test("player selection rejects undetected and invisible native targets before they remain selected", async () => {
  const { first, combat, firstToken } = await adapterScenario();
  combat.flags[M].tsc.objects.find((o) => o.key === first.uuid).detection = { party: "undetected" };

  Targeting.pick(first.uuid, combat.flags[M].tsc, { additive: true });
  assert.equal(game.user.targets.has(firstToken), false);

  combat.flags[M].tsc.objects.find((o) => o.key === first.uuid).detection = { party: "identified" };
  firstToken.visible = false;
  Targeting.pick(first.uuid, combat.flags[M].tsc, { additive: true });
  assert.equal(game.user.targets.has(firstToken), false);
});

async function actionScenario() {
  installFoundryMock();
  await loadModules();
  await loadContentFromDisk();
  Targeting.end();
  const crew = makeCharacter({ id: "targeting-crew", name: "Gunner", owners: ["p1"] });
  const ship = makeShip({
    id: "targeting-ship",
    name: "Targeting Ship",
    role: "player",
    stations: [{ id: "gun", name: "Gunnery", type: "gunnery", grade: "commercial", helmedBy: crew.uuid, weaponId: "w1" }],
    weapons: [{ id: "w1", weaponRef: "coilgun", name: "Coilgun" }],
    crew: [{ actorUuid: crew.uuid, name: crew.name, role: "crew", stationId: "gun", userId: "p1" }]
  });
  const first = makeShip({ id: "target-first", name: "First Target", role: "npc", sp: 10, hp: 20 });
  const second = makeShip({ id: "target-second", name: "Second Target", role: "npc", sp: 10, hp: 20 });
  const undetected = makeShip({ id: "target-undetected", name: "Undetected Target", role: "npc" });
  const far = makeShip({ id: "target-far", name: "Far Target", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 2, alwaysVisible: true, detection: { party: "identified" } },
      { key: first.uuid, zone: 3, detection: { party: "identified" } },
      { key: second.uuid, zone: 4, detection: { party: "identified" } },
      { key: undetected.uuid, zone: 3, detection: { party: "undetected" } },
      { key: far.uuid, zone: 11, detection: { party: "identified" } }
    ]
  });
  const user = game.users.get("p1");
  const payload = { shipUuid: ship.uuid, actionId: "strike", crewUuid: crew.uuid, stationId: "gun", options: {} };
  return { crew, ship, first, second, undetected, far, combat, user, payload };
}

test("action sanitizer accepts bounded deduplicated targetUUIDs while retaining legacy targetKey", async () => {
  installFoundryMock();
  await loadModules();
  const user = game.users.get("p1");
  const result = sanitizeActionRequest(
    {
      shipUuid: "Actor.ship",
      actionId: "strike",
      options: { targetKey: "Actor.legacy", targetUUIDs: ["Actor.one", "Actor.one", 4, "Actor.two", "x".repeat(400)] }
    },
    user
  );

  assert.deepEqual(result.options.targetUUIDs, ["Actor.one", "Actor.two", "x".repeat(300)]);
  assert.equal(result.options.targetKey, "Actor.legacy");
});

test("action execution consumes targetUUIDs, ignores a conflicting legacy key, and drops duplicate or missing entries", async () => {
  const s = await actionScenario();
  dice(19, 5);

  const result = await executeAction({
    ...s.payload,
    user: s.user,
    options: { targetKey: s.second.uuid, targetUUIDs: [s.first.uuid, s.first.uuid, "Actor.missing"] }
  });

  assert.equal(s.first.flags[M].starship.sp.value, 5);
  assert.equal(s.second.flags[M].starship.sp.value, 10);
  assert.deepEqual(result.summary.targetUUIDs, [s.first.uuid]);
  assert.deepEqual(result.summary.targetKeys, [s.first.uuid]);
  assert.equal(game.messages.contents.filter((m) => m.rolls?.some((r) => r.formula.startsWith("1d20"))).length, 1);
});

test("manually hidden identified targets remain valid while undetected targets are rejected", async () => {
  const s = await actionScenario();
  const hidden = makeShip({ id: "target-hidden", name: "Hidden Target", role: "npc", sp: 10, hp: 20 });
  s.combat.flags[M].tsc.objects.push({
    key: hidden.uuid,
    actorUuid: hidden.uuid,
    type: "starship",
    zone: 3,
    hidden: true,
    detection: { party: "identified" }
  });
  dice(19, 5);
  const result = await executeAction({
    ...s.payload,
    user: s.user,
    options: { targetUUIDs: [hidden.uuid] }
  });
  assert.deepEqual(result.summary.targetUUIDs, [hidden.uuid]);
  await assert.rejects(
    executeAction({
      ...s.payload,
      user: s.user,
      options: { targetUUIDs: [s.undetected.uuid] }
    }),
    /targetUndetected|undetected/i
  );
});

test("starship attacks accept a hazard target and damage its native Hull Points", async () => {
  const s = await actionScenario();
  const hazard = new MockActor({
    id: "target-hazard",
    name: "Target Hazard",
    type: "hazard",
    system: {
      attributes: { hp: { value: 20, max: 20 }, ac: { value: 14 }, hardness: 0 },
      saves: { fortitude: { value: 5 }, reflex: { value: 6 }, will: { value: 4 } }
    }
  });
  game.actors.set(hazard.id, hazard);
  s.combat.flags[M].tsc.objects.push({
    key: hazard.uuid,
    actorUuid: hazard.uuid,
    type: "hazard",
    zone: 3,
    detection: { party: "identified" }
  });
  dice(19, 5);

  const result = await executeAction({
    ...s.payload,
    user: s.user,
    options: { targetUUIDs: [hazard.uuid] }
  });

  assert.deepEqual(result.summary.targetUUIDs, [hazard.uuid]);
  assert.equal(hazard.system.attributes.hp.value, 15);
  assert.equal(hazard.flags[M]?.starship, undefined, "hazard damage never writes starship flags");
});

test("legacy targetKey remains the fallback when targetUUIDs is absent", async () => {
  const s = await actionScenario();
  dice(19, 5);

  const result = await executeAction({ ...s.payload, user: s.user, options: { targetKey: s.first.uuid } });

  assert.equal(s.first.flags[M].starship.sp.value, 5);
  assert.deepEqual(result.summary.targetUUIDs, [s.first.uuid]);
});

test("deleted targets are dropped and the remaining current target is executed", async () => {
  const s = await actionScenario();
  game.actors.delete(s.second.id);
  dice(19, 5);

  const result = await executeAction({
    ...s.payload,
    user: s.user,
    options: { targetUUIDs: [s.second.uuid, s.first.uuid] }
  });

  assert.equal(s.first.flags[M].starship.sp.value, 5);
  assert.deepEqual(result.summary.targetUUIDs, [s.first.uuid]);
});

test("single-target SF2e attacks refuse multiple current targets instead of silently using the first", async () => {
  const s = await actionScenario();
  const before = structuredClone({ first: s.first.flags, second: s.second.flags, ship: s.ship.flags });

  await assert.rejects(
    () => executeAction({ ...s.payload, user: s.user, options: { targetUUIDs: [s.first.uuid, s.second.uuid] } }),
    /valid target/i
  );

  assert.deepEqual({ first: s.first.flags, second: s.second.flags, ship: s.ship.flags }, before);
  assert.equal(game.messages.size, 0);
});

test("current target lists revalidate detection and strict range rules on the GM", async () => {
  const s = await actionScenario();
  await assert.rejects(() => executeAction({ ...s.payload, user: s.user, options: { targetUUIDs: [s.undetected.uuid] } }), /undetected/i);
  await game.settings.set(M, "ruleEnforcement", "strict");
  await assert.rejects(() => executeAction({ ...s.payload, user: s.user, options: { targetUUIDs: [s.far.uuid] } }), /out of range/i);
  assert.equal(game.messages.size, 0);
});

test("warn mode keeps a real range warning while executing the current target once", async () => {
  const s = await actionScenario();
  await game.settings.set(M, "ruleEnforcement", "warn");
  dice(19, 5);

  const result = await executeAction({ ...s.payload, user: s.user, options: { targetUUIDs: [s.far.uuid] } });

  assert.equal(s.far.flags[M].starship.sp.value, 5);
  assert.ok(result.reports.some((line) => /out of range/i.test(line)));
});

test("the existing unoccupied crew-weapon guard still runs before target-list attacks without side effects", async () => {
  const s = await actionScenario();
  await s.ship.update({
    [`flags.${M}.starship.stations`]: [{ id: "gun", type: "gunnery", grade: "commercial", helmedBy: null, weaponId: "w1" }]
  });
  const before = structuredClone({ ship: s.ship.flags, target: s.first.flags, combat: s.combat.flags });

  await assert.rejects(
    () => executeAction({ ...s.payload, crewUuid: null, user: s.user, options: { targetUUIDs: [s.first.uuid] } }),
    /must be helming/i
  );

  assert.deepEqual({ ship: s.ship.flags, target: s.first.flags, combat: s.combat.flags }, before);
  assert.equal(game.messages.size, 0);
});
