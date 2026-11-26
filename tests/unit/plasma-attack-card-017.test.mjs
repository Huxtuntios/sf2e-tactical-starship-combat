import test from "node:test";
import assert from "node:assert/strict";
import {
  dice,
  installFoundryMock,
  loadContentFromDisk,
  makeCharacter,
  makeShip,
  makeStarshipCombat,
  DamageRoll as MockDamageRoll,
  MockActor
} from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
let service;
async function loadService() {
  if (!service) service = await import("../../scripts/chat/attack-card/service.mjs");
  return service;
}

async function scenario({ traits = ["area (burst 1 zone)"], save, name = "Plasma cannon", group = "plasma", persistentParts = null } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  await loadService();
  const crew = makeCharacter({ id: "gunner", name: "Gunner", owners: ["p1"] });
  const weapon = { id: "w1", name, group, die: "1d6", damageType: "fire", range: 6, traits };
  if (save !== undefined) weapon.save = save;
  if (persistentParts) weapon.persistentParts = persistentParts;
  const ship = makeShip({
    id: "attacker",
    name: "Attacker",
    role: "player",
    stations: [{ id: "gun", type: "gunnery", grade: "commercial", helmedBy: crew.uuid, weaponId: "w1" }],
    weapons: [weapon],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "gun", userId: "p1" }]
  });
  const first = makeShip({ id: "first", name: "First", role: "npc", ac: 18, sp: 20, hp: 30 });
  const second = makeShip({ id: "second", name: "Second", role: "npc", ac: 18, sp: 20, hp: 30 });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 1, alwaysVisible: true, detection: { party: "identified" } },
      { key: first.uuid, zone: 3, heading: "left", detection: { party: "identified" } },
      { key: second.uuid, zone: 4, heading: "left", detection: { party: "identified" } }
    ]
  });
  return { crew, ship, first, second, combat, p1: game.users.get("p1"), p2: game.users.get("p2"), gm: game.users.get("gm") };
}

const declare = (s) =>
  service.declareAttack({
    user: s.p1,
    payload: { shipUuid: s.ship.uuid, actionId: "strike", crewUuid: s.crew.uuid, stationId: "gun", options: { sheetRoll: true } }
  });
const cardOf = (id) => game.messages.get(id).flags[M].attackCard;
const resolve = (s, messageId, targets = [s.first.uuid, s.second.uuid]) =>
  service.resolveAttackCard({ user: s.p1, payload: { messageId, targetUUIDs: targets } });
const state = (actor) => actor.flags[M].starship;

test("plasma declaration exposes data-driven shape and save without rolling or spending", async () => {
  const s = await scenario();
  const writes = globalThis.__writes.length;
  const { messageId } = await declare(s);
  const card = cardOf(messageId);
  assert.deepEqual(card.weapon.profile, {
    plasma: true,
    area: true,
    shape: { type: "burst", value: 1 },
    save: { type: "reflex", basic: true, dc: null, source: "crew" }
  });
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.contents.filter((message) => message.rolls?.length).length, 0);
});

test("plasma resolution binds every valid selected target once and defers one damage roll", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId, [s.first.uuid, s.second.uuid, s.first.uuid, "Actor.missing"]);
  const card = cardOf(messageId);
  assert.equal(card.status, "resolved");
  assert.equal(card.result.attack.total, 19);
  assert.deepEqual(card.result.pendingDamage.targets, [
    { targetUuid: s.first.uuid, targetKey: s.first.uuid },
    { targetUuid: s.second.uuid, targetKey: s.second.uuid }
  ]);
  assert.equal(card.result.pendingDamage.targetUuid, s.first.uuid, "legacy singular binding remains");
  assert.equal(card.result.pendingDamage.save.dc, 15, "area save uses crew class DC");
  assert.equal(card.result.pendingDamage.save.source, "crew");
  assert.equal(card.damageRoll, undefined);
  assert.equal(state(s.first).sp.value, 20);
  assert.equal(state(s.second).sp.value, 20);
  assert.equal(game.messages.contents.filter((message) => message.rolls?.some((roll) => roll.formula.startsWith("1d20"))).length, 1);
});

test("plasma rolls damage once, saves per target and applies each basic-save result once", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId);
  assert.equal(typeof service.rollAttackCardSaves, "function", "plasma save handler is exposed");
  dice(8);
  await service.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  assert.equal(cardOf(messageId).damageRoll.total, 8);
  dice(20, 1);
  await service.rollAttackCardSaves({ user: s.p1, payload: { messageId } });
  const saves = cardOf(messageId).saveRolls;
  assert.deepEqual(
    saves.map((save) => save.degree),
    [3, 0]
  );
  assert.deepEqual(
    saves.map((save) => save.multiplier),
    [0, 2]
  );
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });
  assert.deepEqual(
    cardOf(messageId).damageResults.map((result) => result.rolled),
    [0, 16]
  );
  assert.equal(state(s.first).sp.value, 20);
  assert.equal(state(s.second).sp.value, 4);
  assert.ok(state(s.first).appliedStrikeReceipts.includes(`chat:${messageId}:${s.first.uuid}`));
  assert.ok(state(s.second).appliedStrikeReceipts.includes(`chat:${messageId}:${s.second.uuid}`));
  await assert.rejects(() => service.applyAttackCardDamage({ user: s.gm, payload: { messageId } }), /already/i);
  assert.equal(state(s.second).sp.value, 4);
});

test("ordinary sheet attacks apply damage to a hazard without starship receipts", async () => {
  const s = await scenario({ name: "Coilgun", group: "projectile", traits: ["agile"] });
  const hazard = new MockActor({
    id: "card-hazard",
    name: "Card Hazard",
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
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId, [hazard.uuid]);
  dice(5);
  await service.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });
  assert.equal(hazard.system.attributes.hp.value, 15);
  assert.equal(hazard.flags[M]?.starship, undefined);
  assert.deepEqual(hazard.flags[M]?.starshipHazard?.appliedStrikeReceipts, [`chat:${messageId}`]);
});

test("plasma saves and damage use a hazard target's native Reflex and Hull Points", async () => {
  const s = await scenario({ traits: ["tech"], save: { type: "reflex", basic: true, dc: 30 } });
  const hazard = new MockActor({
    id: "plasma-hazard",
    name: "Plasma Hazard",
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
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId, [hazard.uuid]);
  dice(8, 24);
  await service.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  await service.rollAttackCardSaves({ user: s.p1, payload: { messageId } });
  const save = cardOf(messageId).saveRolls[0];
  assert.equal(save.targetUuid, hazard.uuid);
  assert.equal(save.degree, 2, "native hazard Reflex makes the DC 30 save a success");
  assert.equal(save.multiplier, 0.5);
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });
  assert.equal(hazard.system.attributes.hp.value, 16);
  assert.equal(hazard.flags[M]?.starship, undefined);
});

test("explicit non-area plasma save honors Will and its verified DC", async () => {
  const s = await scenario({ traits: ["tech"], save: { type: "Will", basic: false, dc: 20 } });
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId);
  assert.deepEqual(cardOf(messageId).result.pendingDamage.save, { type: "will", basic: false, dc: 20, source: "weapon" });
  dice(6, 12, 1);
  await service.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  await service.rollAttackCardSaves({ user: s.p1, payload: { messageId } });
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });
  assert.equal(cardOf(messageId).saveRolls.find((save) => save.targetUuid === s.first.uuid).saveType, "will");
  assert.deepEqual(
    cardOf(messageId).damageResults.map((result) => result.rolled),
    [3, 12]
  );
});

test("non-area plasma without save metadata applies damage without a save step", async () => {
  const s = await scenario({ traits: ["tech"] });
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId);
  assert.equal(cardOf(messageId).result.pendingDamage.save, null);
  dice(6);
  await service.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });
  assert.deepEqual(
    cardOf(messageId).damageResults.map((result) => result.rolled),
    [6, 6]
  );
});

test("deleted selected targets are dropped before saves and cannot receive replay damage", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId);
  game.actors.delete(s.second.id);
  dice(8, 5);
  await service.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  await service.rollAttackCardSaves({ user: s.p1, payload: { messageId } });
  assert.deepEqual(
    cardOf(messageId).saveRolls.map((save) => save.targetUuid),
    [s.first.uuid]
  );
  assert.deepEqual(cardOf(messageId).saveTargetUUIDs, [s.first.uuid], "deleted targets do not block the remaining save set");
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });
  assert.equal(cardOf(messageId).damageResults.length, 1);
  assert.equal(state(s.first).sp.value, 12);
});

test("plasma save respects card permission and revalidates target detection", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId);
  await assert.rejects(() => service.rollAttackCardSaves({ user: s.p2, payload: { messageId } }), /permission/i);
  const tsc = s.combat.flags[M].tsc;
  tsc.objects.find((object) => object.key === s.second.uuid).detection.party = "undetected";
  await s.combat.update({ [`flags.${M}.tsc`]: tsc });
  const before = game.messages.contents.filter((message) => message.rolls?.some((roll) => roll.formula.startsWith("1d20"))).length;
  await assert.rejects(() => service.rollAttackCardSaves({ user: s.p1, payload: { messageId } }), /undetected/i);
  const after = game.messages.contents.filter((message) => message.rolls?.some((roll) => roll.formula.startsWith("1d20"))).length;
  assert.equal(after, before, "no save is rolled before all bound targets revalidate");
});

test("partial retry skips per-target receipts instead of applying damage twice", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId);
  dice(8, 20, 1);
  await service.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  await service.rollAttackCardSaves({ user: s.p1, payload: { messageId } });
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });
  const before = [state(s.first).sp.value, state(s.second).sp.value];
  const card = cardOf(messageId);
  const savedResults = structuredClone(card.damageResults);
  card.damageApplied = false;
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });
  assert.deepEqual([state(s.first).sp.value, state(s.second).sp.value], before);
  assert.equal(cardOf(messageId).damageApplied, true);
  assert.deepEqual(cardOf(messageId).damageResults, savedResults);
});

test("plasma cards render manual damage and protocol instructions", async () => {
  const { makeCardRenderer } = await import("../../scripts/chat/attack-card/view.mjs");
  const { renderAttackCard: render } = makeCardRenderer({
    t: (key, data) =>
      key === "SF2eTSC.droneBlock.manualResult"
        ? `Manual ${data.amount} after resistance ${data.resistance}`
        : key === "SF2eTSC.droneBlock.protocolManualTitle"
          ? "Finish protocol damage manually"
          : key,
    actionLabel: (action) => action.name,
    ct: (text) => text,
    esc: (text) => String(text ?? "")
  });
  const html = render({
    flags: {
      [M]: {
        attackCard: {
          status: "resolved",
          action: { builtin: "strike", name: "Plasma" },
          ship: { name: "Attacker", publicName: "Attacker" },
          crew: null,
          station: null,
          attackType: "ranged",
          range: { zones: 6, increment: null, fromZone: 1 },
          weapon: {
            name: "Plasma cannon",
            traits: [],
            damage: "1d6",
            damageType: "fire",
            profile: { plasma: true, area: true, shape: { type: "burst", value: 1 }, save: null }
          },
          result: { targetLabel: "Target" },
          damageApplied: true,
          damageResults: [{ target: "Target", manual: true, rolled: 12, resistance: 5, protocolManual: true }]
        }
      }
    }
  });
  assert.match(html, /Manual 12 after resistance 5/);
  assert.match(html, /Finish protocol damage manually/);
});

test("plasma save records persist without dotted Actor UUID keys", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  dice(19);
  await resolve(s, messageId);
  dice(8, 20, 1);
  await service.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  await service.rollAttackCardSaves({ user: s.p1, payload: { messageId } });
  const saves = cardOf(messageId).saveRolls;
  assert.ok(Array.isArray(saves), "save records must not use Actor UUID object keys");
  assert.deepEqual(
    saves.map((save) => save.targetUuid),
    [s.first.uuid, s.second.uuid]
  );
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });
  assert.equal(cardOf(messageId).damageApplied, true);
});

test("native T-012 message keeps plasma multi-target binding and the same damage controls", async () => {
  const s = await scenario();
  const { executeNativeAttack } = await import("../../scripts/chat/native-attack.mjs");
  const eventId = "plasma_native_017";
  dice(19);
  const result = await executeNativeAttack({
    user: s.p1,
    payload: {
      shipUuid: s.ship.uuid,
      actionId: "strike",
      crewUuid: s.crew.uuid,
      stationId: "gun",
      eventId,
      options: { sheetRoll: true, targetUUIDs: [s.first.uuid, s.second.uuid] }
    }
  });
  const message = game.messages.get(result.messageId);
  const card = message.flags[M].attackCard;
  assert.equal(card.native, true);
  assert.equal(card.applicationId, eventId);
  assert.deepEqual(
    card.boundDamage.targets.map((target) => target.targetUuid),
    [s.first.uuid, s.second.uuid]
  );
  assert.equal(card.result.pendingDamage.save.type, "reflex");
  assert.equal(message.content, "19", "native system message content is preserved");
});

test("non-plasma sheet attacks still refuse multiple targets before any roll", async () => {
  const s = await scenario({ name: "Coilgun", group: "projectile", traits: ["agile"] });
  const { messageId } = await declare(s);
  const before = structuredClone([state(s.first), state(s.second)]);
  await assert.rejects(() => resolve(s, messageId), /valid target/i);
  assert.deepEqual([state(s.first), state(s.second)], before);
  assert.equal(game.messages.contents.filter((message) => message.rolls?.length).length, 0);
});

test("plasma cards carry effective bonuses and stage persistent parts for every target", async () => {
  const persistentParts = [{ formula: "1d4", type: "cold", category: "persistent" }];
  const s = await scenario({ persistentParts });
  class DamageRoll extends MockDamageRoll {
    constructor(formula) {
      super(formula);
      const match = /(\d+)d(\d+)/.exec(formula);
      this.expectedValue = (Number(match?.[1] ?? 0) * (Number(match?.[2] ?? 0) + 1)) / 2;
    }
  }
  CONFIG.Dice = { rolls: [DamageRoll] };
  CONFIG.PF2E = { damageTypes: { fire: "Fire", cold: "Cold" } };
  game.pf2e.ConditionManager = { getCondition: (slug) => ({ slug }) };

  const { messageId } = await declare(s);
  const declaration = cardOf(messageId);
  assert.ok(Object.hasOwn(declaration.targets[0], "effectiveAttackBonus"));
  dice(19);
  await resolve(s, messageId);
  assert.deepEqual(cardOf(messageId).result.pendingDamage.persistentParts, persistentParts);
  dice(6, 20, 1);
  await service.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  await service.rollAttackCardSaves({ user: s.p1, payload: { messageId } });
  await service.applyAttackCardDamage({ user: s.gm, payload: { messageId } });

  for (const target of [s.first, s.second]) {
    const effects = state(target).effects.filter((effect) => effect.kind === "persistent-damage");
    assert.equal(
      effects.length,
      1,
      JSON.stringify({ target: target.uuid, effects: state(target).effects, results: cardOf(messageId).damageResults })
    );
    assert.equal(effects[0].persistent.formula, "1d4");
    assert.equal(effects[0].persistent.damageType, "cold");
    assert.equal(effects[0].operationId, `chat:${messageId}:${target.uuid}`);
    assert.deepEqual(effects[0].source, { label: "Plasma cannon", strikeId: `chat:${messageId}:${target.uuid}`, shipUuid: s.ship.uuid });
  }
  assert.deepEqual(
    cardOf(messageId).damageResults.map((result) => result.rolled),
    [0, 12]
  );
});
