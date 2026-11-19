import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, MockChatMessage } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { CARD_FLAG, reconcileRerolledCard } from "../../scripts/chat/attack-card/model.mjs";
import {
  isNativeCheckContext,
  onRerollSourceDeleted,
  onRerollMessageCreated,
  registerRerollSupport,
  _resetRerollSupport
} from "../../scripts/chat/reroll-support.mjs";
import { rollNativeCheck } from "../../scripts/starship/stats.mjs";

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** A native attack-roll message as the system pipeline produces it: system context + module attackCard flag. */
function attackMessage({ system = "sf2e", outcome = "criticalSuccess", card = null, speaker = { actor: "ship1", token: "tok1" } } = {}) {
  const baseCard = {
    native: true,
    status: "resolved",
    createdBy: "gm",
    request: { shipUuid: "Actor.ship1", actionId: "strike", crewUuid: "Actor.crew1", stationId: "gun", options: {} },
    ship: { name: "Attacker" },
    weapon: { name: "Pulse" },
    result: { pendingDamage: { crit: true, formula: "1d6", critFormula: "(1d6)*2", damageType: "fire", targetUuid: "Actor.target" } }
  };
  return {
    id: "orig",
    speaker,
    author: "gm",
    rolls: [{ options: { type: "attack-roll" } }],
    flags: {
      [system]: {
        context: {
          type: "attack-roll",
          identifier: null,
          origin: { actor: "Actor.crew1" },
          target: { actor: "Actor.target" },
          outcome,
          isReroll: false
        },
        modifierName: "starship-strike"
      },
      [MODULE_ID]: { card: true, [CARD_FLAG]: card ?? baseCard }
    }
  };
}

/** The message the system re-posts after a reroll: cloned context with isReroll, no module flags. */
function rerolledMessage(source, { outcome = "success", author = "gm" } = {}) {
  const system = Object.keys(source.flags).find((k) => k !== MODULE_ID);
  const context = structuredClone(source.flags[system].context);
  context.isReroll = true;
  context.outcome = outcome;
  return {
    id: "rerolled",
    speaker: structuredClone(source.speaker),
    author,
    rolls: [{ options: { type: "attack-roll", isReroll: true } }],
    flags: { [system]: { ...structuredClone(source.flags[system]), context } },
    async update(changes) {
      for (const [k, v] of Object.entries(changes)) {
        if (k.startsWith(`flags.${MODULE_ID}`)) this.flags[MODULE_ID] = structuredClone(v);
      }
      this.updated = changes;
      return this;
    }
  };
}

/* ------------------------------------------------------------------ pure reconciliation rules */

test("reconcileRerolledCard maps the rerolled degree onto deferred damage", () => {
  const card = () => attackMessage().flags[MODULE_ID][CARD_FLAG];
  assert.equal(reconcileRerolledCard(card(), "criticalSuccess").result.pendingDamage.crit, true);
  assert.equal(reconcileRerolledCard(card(), "success").result.pendingDamage.crit, false);
  assert.equal(reconcileRerolledCard(card(), "failure").result.pendingDamage, undefined);
  assert.equal(reconcileRerolledCard(card(), "criticalFailure").result.pendingDamage, undefined);
});

test("reconcileRerolledCard never reopens applied damage and ignores non-native / unknown cards", () => {
  const applied = { ...attackMessage().flags[MODULE_ID][CARD_FLAG], damageApplied: true };
  assert.equal(reconcileRerolledCard(applied, "criticalFailure"), applied);
  const nonNative = { ...attackMessage().flags[MODULE_ID][CARD_FLAG], native: false };
  assert.equal(reconcileRerolledCard(nonNative, "success"), nonNative);
  const noPending = { native: true, result: {} };
  assert.equal(reconcileRerolledCard(noPending, "success"), noPending);
  const pending = attackMessage().flags[MODULE_ID][CARD_FLAG];
  assert.equal(reconcileRerolledCard(pending, null), pending);
  assert.equal(reconcileRerolledCard(pending, "bogus"), pending);
});

/* ------------------------------------------------------------------ eligibility contract */

test("isNativeCheckContext accepts check rolls and rejects damage / spell-cast / missing context", () => {
  for (const type of ["attack-roll", "skill-check", "saving-throw", "perception-check", "flat-check", "check"])
    assert.equal(isNativeCheckContext({ type }), true, type);
  for (const type of ["damage-roll", "spell-cast"]) assert.equal(isNativeCheckContext({ type }), false, type);
  assert.equal(isNativeCheckContext(null), false);
  assert.equal(isNativeCheckContext(undefined), false);
});

test("module checks delegate message creation to the native pipeline (reroll-eligible), fallback is plain", async () => {
  installFoundryMock();
  let passed;
  const statistic = {
    check: {
      roll: async (options) => {
        passed = options;
        return { total: 18, degreeOfSuccess: 2, dice: [{ total: 13 }] };
      }
    }
  };
  const native = await rollNativeCheck({ statistic, dc: 15, label: "Check", actor: null });
  assert.equal(native.native, true);
  assert.equal(passed.createMessage, true);
  assert.ok(passed.extraRollOptions.includes("starship"));

  const before = game.messages.contents.length;
  const fallback = await rollNativeCheck({ statistic: null, dc: 15, label: "Check", modifierOnly: 5 });
  assert.equal(fallback.native, false);
  assert.equal(game.messages.contents.length, before + 1);
});

/* ------------------------------------------------------------------ flag restoration across the native reroll */

test("reroll restores module attack flags and reconciles deferred damage (sf2e)", async () => {
  installFoundryMock();
  _resetRerollSupport();
  const source = attackMessage();
  onRerollSourceDeleted(source);
  const rerolled = rerolledMessage(source, { outcome: "success" });
  await onRerollMessageCreated(rerolled);
  const card = rerolled.flags[MODULE_ID][CARD_FLAG];
  assert.ok(card, "attackCard flag restored");
  assert.equal(card.result.pendingDamage.crit, false);
  assert.equal(rerolled.flags[MODULE_ID].card, true);
});

test("reroll to a miss removes pending damage; applied damage is preserved", async () => {
  installFoundryMock();
  _resetRerollSupport();
  const missSource = attackMessage();
  onRerollSourceDeleted(missSource);
  const miss = rerolledMessage(missSource, { outcome: "failure" });
  await onRerollMessageCreated(miss);
  assert.equal(miss.flags[MODULE_ID][CARD_FLAG].result.pendingDamage, undefined);

  _resetRerollSupport();
  const appliedCard = { ...attackMessage().flags[MODULE_ID][CARD_FLAG], damageApplied: true, damageResult: { hull: 4 } };
  const appliedSource = attackMessage({ card: appliedCard });
  onRerollSourceDeleted(appliedSource);
  const applied = rerolledMessage(appliedSource, { outcome: "criticalFailure" });
  await onRerollMessageCreated(applied);
  assert.equal(applied.flags[MODULE_ID][CARD_FLAG].damageApplied, true);
  assert.deepEqual(applied.flags[MODULE_ID][CARD_FLAG].damageResult, { hull: 4 });
  assert.ok(applied.flags[MODULE_ID][CARD_FLAG].result.pendingDamage, "applied card keeps its original pending data");
});

test("reroll restoration works under pf2e namespace", async () => {
  installFoundryMock();
  game.system.id = "pf2e";
  _resetRerollSupport();
  const source = attackMessage({ system: "pf2e" });
  onRerollSourceDeleted(source);
  const rerolled = rerolledMessage(source, { outcome: "criticalSuccess" });
  await onRerollMessageCreated(rerolled);
  assert.equal(rerolled.flags[MODULE_ID][CARD_FLAG].result.pendingDamage.crit, true);
});

test("only the rerolling client restores flags (no multi-client duplicate write)", async () => {
  installFoundryMock();
  _resetRerollSupport();
  const source = attackMessage();
  onRerollSourceDeleted(source);
  const rerolled = rerolledMessage(source, { outcome: "success", author: "gm" });
  game.user = game.users.get("p1");
  await onRerollMessageCreated(rerolled);
  assert.equal(rerolled.flags[MODULE_ID], undefined);
  assert.equal(rerolled.updated, undefined);
});

test("damage rolls and ordinary messages are left untouched", async () => {
  installFoundryMock();
  _resetRerollSupport();
  const damage = {
    id: "dmg",
    speaker: { actor: "ship1" },
    author: "gm",
    rolls: [{}],
    flags: { sf2e: { context: { type: "damage-roll" } }, [MODULE_ID]: { autoAppliedDamage: true } }
  };
  onRerollSourceDeleted(damage);
  const rerolledDamage = { ...damage, id: "dmg2", flags: { sf2e: { context: { type: "damage-roll", isReroll: true } } } };
  await onRerollMessageCreated(rerolledDamage);
  assert.equal(rerolledDamage.flags[MODULE_ID], undefined);

  const plain = { id: "plain", speaker: {}, author: "gm", rolls: [], flags: { [MODULE_ID]: { card: true } } };
  onRerollSourceDeleted(plain);
  const plainReroll = { id: "plain2", speaker: {}, author: "gm", rolls: [], flags: { sf2e: { context: { isReroll: true } } } };
  await onRerollMessageCreated(plainReroll);
  assert.equal(plainReroll.flags[MODULE_ID], undefined);
});

test("missing speaker actor still matches via the system origin", async () => {
  installFoundryMock();
  _resetRerollSupport();
  const source = attackMessage({ speaker: {} });
  onRerollSourceDeleted(source);
  const rerolled = rerolledMessage(source, { outcome: "success" });
  await onRerollMessageCreated(rerolled);
  assert.ok(rerolled.flags[MODULE_ID][CARD_FLAG]);
});

/* ------------------------------------------------------------------ registration + hook wiring */

test("registerRerollSupport is idempotent and wires public document hooks", async () => {
  installFoundryMock();
  registerRerollSupport();
  registerRerollSupport();
  assert.equal(Hooks._hooks.get("deleteChatMessage").length, 1);
  assert.equal(Hooks._hooks.get("createChatMessage").length, 1);

  const source = attackMessage();
  const created = await MockChatMessage.create(source);
  Hooks.callAll("deleteChatMessage", created);
  const system = "sf2e";
  const context = structuredClone(created.flags[system].context);
  context.isReroll = true;
  context.outcome = "success";
  const rerolled = await MockChatMessage.create({
    speaker: created.speaker,
    rolls: [{}],
    flags: { [system]: { ...structuredClone(created.flags[system]), context } }
  });
  await flush();
  assert.equal(rerolled.flags[MODULE_ID][CARD_FLAG].result.pendingDamage.crit, false);
});
