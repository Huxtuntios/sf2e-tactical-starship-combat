import test from "node:test";
import assert from "node:assert/strict";
import { makeShip, makeCharacter, MockRoll, dice, loadContentFromDisk } from "../helpers/foundry-mock.mjs";
import { installNativeEffectsFixture, nativeActor } from "../helpers/native-effects-fixture.mjs";
import { applyManualEffect, removeManualEffect, registerApplicationService } from "../../scripts/starship/application-service.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { applyDamageInDraft } from "../../scripts/damage/damage-service.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { wireToolbeltDamage, registerToolbeltDamage } from "../../scripts/integrations/toolbelt-damage.mjs";
import { dispatchSocketMessage } from "../../scripts/socket.mjs";
import { makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import * as combatService from "../../scripts/combat/starship-combat.mjs";
import { executeAction } from "../../scripts/actions/action-engine.mjs";
import { Content } from "../../scripts/content/loader.mjs";
import { applyAttackCardDamage } from "../../scripts/chat/attack-card/service.mjs";
const service = await import("../../scripts/starship/persistent-damage.mjs").catch(() => ({}));
const persistentError = (key) => (err) => err.message.startsWith(game.i18n.localize(`SF2eTSC.persistent.errors.${key}`));

async function setup(extra = {}) {
  installNativeEffectsFixture();
  await loadContentFromDisk();
  CONFIG.PF2E.damageTypes.cold = "Cold";
  globalThis.__persistentRolls = [];
  class DamageRoll {
    constructor(formula, data, options) {
      this.formula = formula;
      this.options = options;
      const match = /^\((.+)\)\[persistent,([a-z-]+)\]$/.exec(formula);
      this.expression = match[1];
      this.type = match[2];
      this.expectedValue =
        Number(
          this.expression
            .replace(/(\d+)d(\d+)/g, (_, n, f) => (n * (Number(f) + 1)) / 2)
            .split("+")
            .reduce((a, b) => a + Number(b), 0)
        ) * (options.degreeOfSuccess === 3 ? 2 : 1);
    }
    async evaluate() {
      const roll = await new MockRoll(this.expression).evaluate();
      this.total = roll.total * (this.options.degreeOfSuccess === 3 ? 2 : 1);
      this.instances = [{ type: this.type, total: this.total, persistent: true, options: this.options }];
      globalThis.__persistentRolls.push(this);
      return this;
    }
    toJSON() {
      return { class: "DamageRoll", formula: this.formula, total: this.total, options: this.options };
    }
  }
  CONFIG.Dice = { rolls: [DamageRoll] };
  game.pf2e.CheckModifier = class {
    constructor(label, statistic, modifiers = []) {
      assert.ok(Array.isArray(statistic.modifiers), "native CheckModifier takes a statistic-like object");
      this.label = label;
      this.modifiers = [...statistic.modifiers, ...modifiers];
    }
  };
  globalThis.__recoveryContexts = [];
  game.pf2e.Check = {
    async roll(check, context) {
      globalThis.__recoveryContexts.push(context);
      assert.equal(check.modifiers.length, 0);
      assert.equal(context.type, "flat-check");
      const roll = await new MockRoll("1d20").evaluate();
      roll.degreeOfSuccess = roll.total >= context.dc.value ? 2 : 1;
      return roll;
    }
  };
  registerApplicationService();
  service.registerPersistentDamageService?.();
  const pc = nativeActor(makeCharacter({ id: "pc" }));
  const ship = nativeActor(makeShip({ id: "ship", sp: 3, hp: 30, crew: [{ actorUuid: pc.uuid, role: "crew" }], extra }));
  return { ship, pc };
}
async function add(ship, formula = "1d6", damageType = "fire", extra = {}) {
  return applyManualEffect(ship.uuid, {
    operationId: foundry.utils.randomID(),
    kind: "persistent-damage",
    persistent: { formula, damageType, ...extra.persistent },
    ...extra
  });
}
const process = (ship, intervalKey = "one") => service.processPersistentDamage(ship.uuid, { intervalKey });

test("native persistent strongest same type preserves identities and critical roll options", async () => {
  assert.equal(typeof service.processPersistentDamage, "function");
  const { ship } = await setup();
  const low = await add(ship, "1d4");
  const high = await add(ship, "2d4+2");
  const cold = await add(ship, "1d4", "cold", { persistent: { formula: "1d4", damageType: "cold", dc: 17, criticalHit: true } });
  const receipt = await process(ship);
  assert.equal(receipt.status, "pending");
  assert.deepEqual(
    receipt.components.map((c) => c.applicationId),
    [high.applicationId, cold.applicationId]
  );
  assert.equal(globalThis.__persistentRolls.length, 2);
  assert.equal(globalThis.__persistentRolls[1].options.evaluatePersistent, true);
  assert.equal(globalThis.__persistentRolls[1].options.degreeOfSuccess, 3);
  assert.equal(readStarship(ship).effects.find((e) => e.id === low.applicationId).shipPersistent.suppressedBy, high.applicationId);
  assert.equal(readStarship(ship).effects.length, 3);
});
test("process interval receipt survives duplicate calls and reload without reroll", async () => {
  assert.equal(typeof service.processPersistentDamage, "function");
  const { ship } = await setup();
  await add(ship);
  const [a, b] = await Promise.all([process(ship), process(ship)]);
  assert.equal(a.id, b.id);
  assert.equal(globalThis.__persistentRolls.length, 1);
  service.registerPersistentDamageService();
  const again = await process(ship);
  assert.equal(again.id, a.id);
  assert.equal(globalThis.__persistentRolls.length, 1);
});
test("typed packet applies IWR hardness shields overflow and one noncritical compromised increment", async () => {
  assert.equal(typeof service.applyPersistentDamage, "function");
  const { ship } = await setup({ hardness: 2, resistances: { fire: 2, "all-damage": 1 }, weaknesses: { fire: 1 }, compromised: 1 });
  await add(ship, "1d2+5");
  await add(ship, "1d2+3", "cold");
  const receipt = await process(ship);
  const applied = await service.applyPersistentDamage(ship.uuid, receipt.id);
  assert.equal(applied.result.shieldDamage, 3);
  assert.equal(applied.result.hullDamage, 3);
  assert.equal(applied.result.hardnessReduction, 2);
  assert.equal(readStarship(ship).compromised, 2);
  await assert.rejects(service.applyPersistentDamage(ship.uuid, receipt.id), persistentError("alreadyApplied"));
});
test("deleted component old card is excluded while another active type still applies", async () => {
  assert.equal(typeof service.applyPersistentDamage, "function");
  const { ship } = await setup();
  const fire = await add(ship, "1d2+7");
  await add(ship, "1d2+3", "cold");
  const receipt = await process(ship);
  await removeManualEffect(ship.uuid, fire.applicationId);
  const result = await service.applyPersistentDamage(ship.uuid, receipt.id);
  assert.equal(result.result.originalDamage, 4);
  assert.equal(ship.system.attributes.hp.value, 29);
});
test("ship successful recovery clears all same type but leaves crew and other damage types", async () => {
  assert.equal(typeof service.recoverPersistentDamage, "function");
  const { ship, pc } = await setup();
  const mixed = await add(ship, "1d2+5", "fire", { targets: { entire: true, crew: [pc.uuid] } });
  await add(ship, "1d2+2");
  const cold = await add(ship, "1d2+3", "cold");
  const receipt = await process(ship);
  await service.applyPersistentDamage(ship.uuid, receipt.id);
  dice(18);
  const result = await service.recoverPersistentDamage(ship.uuid, mixed.applicationId);
  assert.equal(result.status, "recovered");
  assert.equal(pc.items.size, 1);
  const effects = readStarship(ship).effects;
  assert.equal(effects.length, 2);
  assert.equal(effects.find((e) => e.id === mixed.applicationId).shipRecovered, true);
  assert.ok(effects.find((e) => e.id === cold.applicationId));
  const next = await process(ship, "two");
  assert.deepEqual(
    next.components.map((c) => c.type),
    ["cold"]
  );
});
test("staging validates formula and immunity in exact Draft without immediate damage or early writes", async () => {
  assert.equal(typeof service.stagePersistentDamage, "function");
  const { ship } = await setup();
  const draft = new Draft(null);
  const ids = await service.stagePersistentDamage(
    draft,
    {
      targetUuid: ship.uuid,
      parts: [{ formula: "1d6", type: "fire", category: "persistent" }],
      source: { shipUuid: "Actor.attacker", strikeId: "hit" },
      criticalHit: true
    },
    { operationId: "hit" }
  );
  assert.equal(ids.length, 1);
  assert.equal(readStarship(ship).effects.length, 0);
  await draft.commit();
  assert.equal(readStarship(ship).effects[0].persistent.criticalHit, true);
  assert.equal(ship.system.attributes.hp.value, 30);
  const invalid = new Draft(null);
  await assert.rejects(
    service.stagePersistentDamage(invalid, {
      targetUuid: ship.uuid,
      parts: [{ formula: "1d6;alert(1)", type: "fire", category: "persistent" }]
    }),
    persistentError("invalidPersistentDamage")
  );
  const again = new Draft(null);
  assert.deepEqual(
    await service.stagePersistentDamage(
      again,
      {
        targetUuid: ship.uuid,
        parts: [{ formula: "1d6", type: "fire", category: "persistent" }],
        source: { shipUuid: "Actor.attacker", strikeId: "hit" },
        criticalHit: true
      },
      { operationId: "hit" }
    ),
    ids
  );
});
test("manual compromised overlay never bakes untouched flags but actual damage transitions persist", async () => {
  const { ship } = await setup();
  const state = await applyManualEffect(ship.uuid, { operationId: "comp", kind: "condition", slug: "compromised", conditionValue: 1 });
  const hit = new Draft(null);
  await applyDamageInDraft(hit, ship.uuid, { amount: 2, damageType: "cold", silent: true });
  await hit.commit();
  assert.equal(readStarship(ship).compromised, 0);
  assert.equal(readStarship(ship).inoperable, false);
  const overflow = new Draft(null);
  await applyDamageInDraft(overflow, ship.uuid, { amount: 2, damageType: "cold", silent: true });
  await overflow.commit();
  assert.equal(readStarship(ship).compromised, 2);
  await removeManualEffect(ship.uuid, state.applicationId);
  assert.equal(readStarship(ship).compromised, 2);
});
test("effect immunity override does not bypass damage immunity or ship shields", async () => {
  const { ship } = await setup({ immunities: ["fire"] });
  await add(ship, "1d6", "fire", { ignoreImmunities: true });
  const receipt = await process(ship);
  const applied = await service.applyPersistentDamage(ship.uuid, receipt.id);
  assert.equal(applied.result.immune, true);
  assert.equal(readStarship(ship).sp.value, 3);
  assert.equal(ship.system.attributes.hp.value, 30);
});
test("failed actor commit leaves receipt pending for retry; failed chat cannot reopen roll", async (t) => {
  t.mock.method(console, "error", () => {});
  const { ship } = await setup();
  await add(ship);
  const create = ChatMessage.create;
  ChatMessage.create = async () => {
    throw new Error("chat unavailable");
  };
  const receipt = await process(ship);
  ChatMessage.create = create;
  assert.equal(receipt.status, "pending");
  assert.equal(globalThis.__persistentRolls.length, 1);
  const update = ship.update.bind(ship);
  ship.update = async () => {
    throw new Error("write unavailable");
  };
  await assert.rejects(service.applyPersistentDamage(ship.uuid, receipt.id));
  assert.equal(readStarship(ship).persistentDamageReceipts[0].status, "pending");
  assert.equal(readStarship(ship).sp.value, 3);
  ship.update = update;
  await service.applyPersistentDamage(ship.uuid, receipt.id);
  assert.equal((await process(ship)).status, "applied");
  assert.equal(globalThis.__persistentRolls.length, 1);
});
test("native crew recovery synchronizes exact handles and never clears ship recipient", async () => {
  const { ship, pc } = await setup();
  const application = await add(ship, "1d6", "fire", { targets: { entire: true, crew: [pc.uuid] } });
  const item = pc.items.get(application.nativeTargets[0].itemId);
  item.rollRecovery = async () => {
    await pc.deleteEmbeddedDocuments("Item", [item.id]);
  };
  const result = await service.recoverPersistentDamage(ship.uuid, application.applicationId, { actorUuid: pc.uuid });
  assert.equal(result.status, "recovered");
  const record = readStarship(ship).effects[0];
  assert.notEqual(record.shipRecovered, true);
  assert.equal(record.nativeTargets[0].status, "ended");
  assert.equal((await process(ship)).components.length, 1);
});
test("manual recovery requires actual applied damage and failure cannot reroll in same interval", async () => {
  const { ship } = await setup();
  const application = await add(ship);
  await assert.rejects(service.recoverPersistentDamage(ship.uuid, application.applicationId), persistentError("applyFirst"));
  const receipt = await process(ship);
  await service.applyPersistentDamage(ship.uuid, receipt.id);
  dice(1);
  const first = await service.recoverPersistentDamage(ship.uuid, application.applicationId);
  dice(20);
  const again = await service.recoverPersistentDamage(ship.uuid, application.applicationId);
  assert.equal(first.status, "active");
  assert.deepEqual(again, first);
  assert.equal(globalThis.__dice.length, 1);
});
test("ship recovery waits for the latest same-type packet before ending effects", async () => {
  const { ship } = await setup();
  const application = await add(ship, "1d2");
  const first = await process(ship, "one");
  await service.applyPersistentDamage(ship.uuid, first.id);
  const next = await process(ship, "two");
  const before = structuredClone(readStarship(ship));
  dice(20);
  await assert.rejects(service.recoverPersistentDamage(ship.uuid, application.applicationId), persistentError("applyFirst"));
  assert.deepEqual(readStarship(ship), before);
  assert.equal(globalThis.__recoveryContexts.length, 0);
  const applied = await service.applyPersistentDamage(ship.uuid, next.id);
  assert.equal(applied.result.originalDamage, next.components[0].amount);
  assert.equal((await service.recoverPersistentDamage(ship.uuid, application.applicationId)).status, "recovered");
});
test("cached recovery failure cannot bypass the next same-type pending packet", async () => {
  const { ship } = await setup();
  const application = await add(ship, "1d2");
  const first = await process(ship, "one");
  await service.applyPersistentDamage(ship.uuid, first.id);
  dice(1);
  const failed = await service.recoverPersistentDamage(ship.uuid, application.applicationId);
  assert.equal(failed.status, "active");
  const next = await process(ship, "two");
  await assert.rejects(service.recoverPersistentDamage(ship.uuid, application.applicationId), persistentError("applyFirst"));
  assert.equal(globalThis.__recoveryContexts.length, 1);
  await service.applyPersistentDamage(ship.uuid, next.id);
  dice(20);
  const recovered = await service.recoverPersistentDamage(ship.uuid, application.applicationId);
  assert.equal(recovered.receiptId, next.id);
  assert.equal(recovered.status, "recovered");
});
test("Toolbelt alternate positive apply routes same persistent receipt and custom repeat rejects", async () => {
  const { ship } = await setup();
  await add(ship);
  const receipt = await process(ship);
  const message = { flags: { [MODULE_ID]: { persistentDamage: { shipUuid: ship.uuid, receiptId: receipt.id } } } };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  let listener;
  const root = {
    dataset: {},
    querySelectorAll: () => [],
    addEventListener: (type, fn) => (listener = fn),
    removeEventListener() {},
    contains: () => true
  };
  const sent = [];
  wireToolbeltDamage(message, root, {
    send: async (type, payload) => {
      sent.push(type);
      return service.applyPersistentDamage(payload.shipUuid, payload.receiptId);
    }
  });
  const button = { dataset: { action: "applyDamage", multiplier: "2" }, closest: () => null };
  let stopped = 0;
  await listener({
    target: { closest: () => button },
    preventDefault() {},
    stopImmediatePropagation() {
      stopped++;
    }
  });
  assert.deepEqual(sent, ["applyPersistentDamage"]);
  assert.equal(stopped, 1);
  await assert.rejects(service.applyPersistentDamage(ship.uuid, receipt.id), persistentError("alreadyApplied"));
});
test("Toolbelt socket route also shares receipt and rejects changed target or player", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { ship, pc } = await setup();
  game.modules.set("pf2e-toolbelt", { active: true });
  registerToolbeltDamage();
  await add(ship);
  const receipt = await process(ship);
  const message = game.messages.contents.at(-1);
  async function send(targetUuid = ship.uuid, sender = "gm") {
    let response;
    await dispatchSocketMessage(
      {
        kind: "request",
        type: "toolbeltDamage",
        requestId: "alternate",
        payload: { messageId: message.id, targetUuid, rollIndex: 0, multiplier: 1, mode: "shields" }
      },
      sender,
      { users: game.users, selfId: "gm", isActiveGM: true, emit: (r) => (response = r) }
    );
    return response;
  }
  assert.equal((await send(pc.uuid)).ok, false);
  assert.equal((await send(ship.uuid, "p1")).ok, false);
  const applied = await send();
  assert.equal(applied.ok, true);
  assert.equal(applied.payload?.status ?? applied.result?.status, "applied");
  await assert.rejects(service.applyPersistentDamage(ship.uuid, receipt.id), persistentError("alreadyApplied"));
});
test("native creation preparation synchronizes visible suppression state", async () => {
  const { ship, pc } = await setup();
  const first = await add(ship, "1d4", "fire", { targets: { entire: false, crew: [pc.uuid] } });
  const second = await add(ship, "2d6", "fire", { targets: { entire: false, crew: [pc.uuid] } });
  pc.items.get(first.nativeTargets[0].itemId).active = false;
  const created = pc.items.get(second.nativeTargets[0].itemId);
  for (const handler of Hooks._hooks.get("createItem") ?? []) await handler(created);
  assert.equal(readStarship(ship).effects.find((e) => e.id === first.applicationId).nativeTargets[0].status, "suppressed");
});
test("independently ended native item updates durable handle and is never recreated", async () => {
  const { ship, pc } = await setup();
  const application = await add(ship, "1d6", "fire", { targets: { entire: true, crew: [pc.uuid] } });
  const item = pc.items.get(application.nativeTargets[0].itemId);
  await pc.deleteEmbeddedDocuments("Item", [item.id]);
  for (const handler of Hooks._hooks.get("deleteItem") ?? []) await handler(item);
  assert.equal(readStarship(ship).effects[0].nativeTargets[0].status, "ended");
  await process(ship);
  assert.equal(pc.items.size, 0);
});
test("new stronger same type invalidates a suppressed old receipt component", async () => {
  const { ship } = await setup();
  await add(ship, "1d4");
  const receipt = await process(ship);
  await add(ship, "2d6");
  await assert.rejects(service.applyPersistentDamage(ship.uuid, receipt.id), persistentError("staleReceipt"));
  assert.equal(readStarship(ship).sp.value, 3);
});
test("removal during native ship recovery cannot clear a replacement application", async () => {
  const { ship } = await setup();
  const app = await add(ship);
  const receipt = await process(ship);
  await service.applyPersistentDamage(ship.uuid, receipt.id);
  const roll = game.pf2e.Check.roll;
  let replacement;
  game.pf2e.Check.roll = async (...args) => {
    const result = await roll(...args);
    await removeManualEffect(ship.uuid, app.applicationId);
    replacement = await add(ship, "2d6");
    return result;
  };
  dice(20);
  await assert.rejects(service.recoverPersistentDamage(ship.uuid, app.applicationId), persistentError("staleReceipt"));
  assert.equal(readStarship(ship).effects[0].id, replacement.applicationId);
});
test("ship recovery keeps private ship data in GM message mode", async () => {
  const { ship } = await setup();
  const app = await add(ship);
  const receipt = await process(ship);
  await service.applyPersistentDamage(ship.uuid, receipt.id);
  dice(1);
  await service.recoverPersistentDamage(ship.uuid, app.applicationId);
  assert.equal(globalThis.__recoveryContexts[0].messageMode, "gm");
});
test("automatic staging honors effect immunity but never damage-type immunity bypass", async () => {
  const { ship } = await setup();
  nativeActor(ship, { immune: ["persistent-damage"] });
  const draft = new Draft(null);
  const result = await service.stagePersistentDamage(
    draft,
    { targetUuid: ship.uuid, parts: [{ formula: "1d6", type: "fire", category: "persistent" }] },
    { operationId: "immune" }
  );
  assert.deepEqual(result, []);
  await draft.commit();
  assert.equal(readStarship(ship).effects.length, 0);
});
test("origin critical formula is rolled once and recurring hit increases compromised only once", async () => {
  const { ship } = await setup({ compromised: 1 });
  await add(ship, "1d4", "fire", { persistent: { formula: "1d4", damageType: "fire", criticalHit: true } });
  dice(2);
  const receipt = await process(ship);
  assert.equal(receipt.components[0].amount, 4);
  const results = await Promise.allSettled([
    service.applyPersistentDamage(ship.uuid, receipt.id),
    service.applyPersistentDamage(ship.uuid, receipt.id)
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(readStarship(ship).compromised, 2);
  assert.equal(ship.system.attributes.hp.value, 29);
});
test("durable in-flight roll reservation cannot reopen on failover", async () => {
  const { ship } = await setup();
  await add(ship);
  const receipt = await process(ship);
  ship.flags[MODULE_ID].starship.persistentDamageReceipts[0].status = "rolling";
  service.registerPersistentDamageService();
  const again = await process(ship);
  assert.equal(again.id, receipt.id);
  assert.equal(again.status, "rolling");
  assert.equal(globalThis.__persistentRolls.length, 1);
  await assert.rejects(service.applyPersistentDamage(ship.uuid, again.id), persistentError("staleReceipt"));
});
test("manual world-time interval cannot reroll after apply without a new interval", async () => {
  const { ship } = await setup();
  await add(ship);
  const first = await service.processPersistentDamage(ship.uuid);
  await service.applyPersistentDamage(ship.uuid, first.id);
  const repeated = await service.processPersistentDamage(ship.uuid);
  assert.equal(repeated.id, first.id);
  game.time.worldTime += 6;
  const next = await service.processPersistentDamage(ship.uuid);
  assert.notEqual(next.id, first.id);
  assert.equal(globalThis.__persistentRolls.length, 2);
});
test("combat interval chooses true own turn or round, never crew or compromised turn", async () => {
  const { ship, pc } = await setup();
  const combat = makeStarshipCombat();
  const [crew] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: pc.id, initiative: 20 }]);
  const [synthetic] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: ship.id, initiative: 10, flags: { [MODULE_ID]: { compromisedEntry: true, shipUuid: ship.uuid } } }
  ]);
  combat.round = 1;
  combat.turn = 1;
  assert.equal(service.persistentIntervalForShip(combat, ship.uuid, { id: crew.id, round: 1, turn: 0 }), null);
  combat.round = 2;
  combat.turn = 0;
  assert.equal(
    service.persistentIntervalForShip(combat, ship.uuid, { id: synthetic.id, round: 1, turn: 1 }),
    `combat:${combat.id}:round:1`
  );
  const [own] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: ship.id, initiative: 15 }]);
  combat.round = 1;
  combat.turn = 2;
  assert.equal(service.persistentIntervalForShip(combat, ship.uuid, { id: own.id, round: 1, turn: 1 }), `combat:${combat.id}:round:1`);
  assert.equal(service.persistentIntervalForShip(combat, ship.uuid, { id: synthetic.id, round: 2, turn: 2 }), null);
});
test("combat cleanup removes timed manual native mirrors but retains indefinite and foreign Items", async () => {
  const { ship, pc } = await setup();
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid }] });
  const [crew] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: pc.id, initiative: 20 }]);
  await add(ship, "1d6", "fire", { targets: { entire: true, crew: [pc.uuid] } });
  await applyManualEffect(ship.uuid, {
    operationId: "timed-clean",
    kind: "condition",
    slug: "frightened",
    conditionValue: 1,
    targets: { entire: false, crew: [pc.uuid] },
    timing: { mode: "turn-end", combatantId: crew.id }
  });
  const [foreign] = await pc.createEmbeddedDocuments("Item", [{ type: "condition", name: "Foreign", system: { slug: "clumsy" } }]);
  await combatService.cleanupEndedCombat(combat);
  assert.equal(pc.items.size, 2);
  assert.equal(pc.items.has(foreign.id), true);
  assert.equal(readStarship(ship).effects.length, 1);
});
test("true NPC ship tick occurs at own end only and backwards initiative cannot reroll", async () => {
  const { ship, pc } = await setup();
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid }] });
  const [crew, own] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: pc.id, initiative: 20 },
    { actorId: ship.id, initiative: 10 }
  ]);
  await add(ship);
  combat.flags[MODULE_ID].tsc.lastEffectTurn = { id: crew.id, round: 1, turn: 0 };
  combat.flags[MODULE_ID].tsc.lastTurnKey = "old";
  combat.turn = 1;
  await combatService.onTurnChange(combat);
  assert.equal(globalThis.__persistentRolls.length, 0);
  combat.round = 2;
  combat.turn = 0;
  await combatService.onTurnChange(combat);
  assert.equal(globalThis.__persistentRolls.length, 1);
  combat.round = 1;
  combat.turn = 1;
  await combatService.onTurnChange(combat);
  combat.round = 2;
  combat.turn = 0;
  await combatService.onTurnChange(combat);
  assert.equal(globalThis.__persistentRolls.length, 1);
  assert.equal(
    combat.turns.some((c) => c.id === own.id),
    true
  );
});
test("combat lifecycle includes private ships, dedups public entries and expires exact native mirrors", async () => {
  assert.equal(typeof combatService.onTurnChange, "function");
  assert.equal(typeof combatService.cleanupEndedCombat, "function");
  const { ship, pc } = await setup();
  const hidden = nativeActor(makeShip({ id: "hidden" }));
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, actorUuid: ship.uuid, type: "starship" },
      { key: "copy", actorUuid: ship.uuid, type: "starship" }
    ]
  });
  await JournalEntry.create({
    name: "Private",
    ownership: { default: 0 },
    flags: {
      [MODULE_ID]: {
        privateSensor: {
          schema: 1,
          combatId: combat.id,
          contacts: [{ key: "private-hidden", actorUuid: hidden.uuid, zone: 1, detection: { party: "undetected" } }]
        }
      }
    }
  });
  const [crew] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: pc.id, initiative: 20 }]);
  await add(ship);
  await add(hidden);
  await applyManualEffect(ship.uuid, {
    operationId: "timed",
    kind: "condition",
    slug: "frightened",
    conditionValue: 1,
    targets: { entire: true, crew: [pc.uuid] },
    timing: { mode: "turn-end", combatantId: crew.id }
  });
  const tsc = combat.flags[MODULE_ID].tsc;
  tsc.lastEffectTurn = { id: crew.id, round: 1, turn: 0 };
  tsc.lastTurnKey = "old";
  combat.round = 2;
  combat.turn = 0;
  await combatService.onTurnChange(combat);
  assert.equal(pc.items.size, 0);
  assert.equal(globalThis.__persistentRolls.length, 2);
  assert.equal(readStarship(ship).effects.length, 1);
  await combatService.cleanupEndedCombat(combat);
  assert.equal(readStarship(ship).effects.length, 1);
  assert.equal(readStarship(hidden).effects.length, 1);
});
test("damage-service deferred seam stages persistent parts with target receipt and separates instant damage", async () => {
  const { ship } = await setup();
  const draft = new Draft(null);
  const entry = await draft.ship(ship.uuid);
  entry.data.appliedStrikeReceipts = ["chat:hit"];
  await applyDamageInDraft(draft, ship.uuid, {
    amount: 2,
    parts: [{ amount: 2, type: "cold" }],
    persistentParts: [{ formula: "1d2+7", type: "fire", category: "persistent" }],
    source: "laser",
    silent: true
  });
  await draft.commit();
  assert.equal(readStarship(ship).effects.length, 1);
  assert.equal(readStarship(ship).sp.value, 1);
  assert.deepEqual(readStarship(ship).appliedStrikeReceipts, ["chat:hit"]);
});

test("direct NPC persistent-only strike stages into the action Draft exactly once", async () => {
  const { ship } = await setup();
  const attacker = makeShip({ id: "attacker", role: "npc" });
  Content.actions.set("test-persistent-strike", {
    id: "test-persistent-strike",
    name: "Burn",
    builtin: "npc-strike",
    npcOnly: true,
    station: "npc",
    cost: 1,
    targeting: { type: "starship", range: "weapon" },
    strike: { name: "Burn", kind: "ranged", attack: 8, damage: "1d6 persistent fire", range: 6, traits: [] }
  });
  makeStarshipCombat({
    objects: [
      { key: attacker.uuid, zone: 1 },
      { key: ship.uuid, zone: 2, alwaysVisible: true }
    ]
  });
  dice(15);
  const result = await executeAction({
    user: game.user,
    shipUuid: attacker.uuid,
    actionId: "test-persistent-strike",
    strikeId: "stable-burn",
    options: { targetKey: ship.uuid, skipReactions: true }
  });
  assert.equal(result.degree, 2);
  assert.equal(readStarship(ship).effects.length, 1);
  assert.equal(readStarship(ship).effects[0].operationId, "stable-burn");
  assert.equal(readStarship(ship).sp.value, 3);
  dice(15);
  await executeAction({
    user: game.user,
    shipUuid: attacker.uuid,
    actionId: "test-persistent-strike",
    strikeId: "stable-burn",
    options: { targetKey: ship.uuid, skipReactions: true }
  });
  assert.equal(readStarship(ship).effects.length, 1);
});

test("deferred attack-card application stages persistent parts in its guarded damage receipt", async () => {
  const { ship } = await setup();
  const message = await ChatMessage.create({
    flags: {
      [MODULE_ID]: {
        attackCard: {
          status: "resolved",
          native: true,
          ship: { name: "Attacker" },
          action: { builtin: "npc-strike" },
          damageRoll: { total: 2, parts: [{ amount: 2, type: "cold" }] },
          result: {
            pendingDamage: {
              targetUuid: ship.uuid,
              damageType: "cold",
              source: "Burn",
              crit: false,
              damageParts: [{ formula: "2", type: "cold" }],
              persistentParts: [{ formula: "1d6", type: "fire", category: "persistent" }]
            }
          }
        }
      }
    }
  });
  await applyAttackCardDamage({ user: game.user, payload: { messageId: message.id } });
  assert.equal(readStarship(ship).effects.length, 1);
  assert.equal(readStarship(ship).sp.value, 1);
  assert.deepEqual(readStarship(ship).appliedStrikeReceipts, [`chat:${message.id}`]);
  await assert.rejects(applyAttackCardDamage({ user: game.user, payload: { messageId: message.id } }));
  assert.equal(readStarship(ship).effects.length, 1);
});
