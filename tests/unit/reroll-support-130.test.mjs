import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, MockChatMessage } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { CARD_FLAG, reconcileRerolledCard } from "../../scripts/chat/attack-card/model.mjs";
import {
  isNativeCheckContext,
  onSystemReroll,
  onRerollMessageCreated,
  registerRerollSupport,
  _resetRerollSupport
} from "../../scripts/chat/reroll-support.mjs";
import { rollNativeCheck } from "../../scripts/starship/stats.mjs";

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** Evaluated-roll double: `id` makes the serialized roll key unique. */
const mkRoll = (id, total = 10) => ({
  options: { type: "attack-roll" },
  toJSON: () => ({ class: "CheckRoll", formula: "1d20+5", total, dice: [{ faces: 20, total }], options: { type: "attack-roll", id } })
});

const BOUND = {
  damageParts: null,
  formula: "1d6",
  critFormula: "(1d6)*2",
  damageType: "piercing",
  extraTypes: [],
  traits: [],
  targetUuid: "Actor.target",
  targetKey: "Actor.target",
  source: "Coilgun"
};

function nativeCard({ crit = true, pending = true, applicationId = "app-1", damageRoll = null } = {}) {
  const card = {
    native: true,
    status: "resolved",
    createdBy: "gm",
    applicationId,
    request: { shipUuid: "Actor.ship", actionId: "strike", crewUuid: "Actor.crew", stationId: "gun", options: {} },
    ship: { name: "Attacker" },
    weapon: { name: "Coilgun" },
    boundDamage: { ...BOUND },
    result: { pendingDamage: pending ? { ...BOUND, crit } : null }
  };
  if (damageRoll) card.damageRoll = damageRoll;
  return card;
}

/** A native attack-roll message as the system pipeline produces it. */
function sourceMessage(
  roll,
  { system = "sf2e", card = nativeCard(), outcome = "criticalSuccess", speaker = { actor: "ship1", token: "tok1" } } = {}
) {
  return MockChatMessage.create({
    speaker,
    rolls: [roll],
    flags: {
      [system]: {
        context: {
          type: "attack-roll",
          identifier: null,
          origin: { actor: "Actor.crew" },
          target: { actor: "Actor.target" },
          outcome,
          isReroll: false
        },
        modifierName: "starship-strike"
      },
      [MODULE_ID]: { card: true, [CARD_FLAG]: card, nativeAttackReceipt: { eventId: "evt", userId: "gm", status: "resolved" } }
    }
  });
}

/** The message the system re-posts: cloned context with isReroll, the kept roll, no module flags. */
function rerolledMessage(roll, { system = "sf2e", outcome = "success", author = "gm", speaker = { actor: "ship1", token: "tok1" } } = {}) {
  return {
    id: "rerolled",
    speaker,
    author,
    rolls: [roll],
    flags: {
      [system]: {
        context: {
          type: "attack-roll",
          identifier: null,
          origin: { actor: "Actor.crew" },
          target: { actor: "Actor.target" },
          outcome,
          isReroll: true
        },
        modifierName: "starship-strike"
      }
    },
    async update(changes) {
      const key = `flags.${MODULE_ID}`;
      if (key in changes) this.flags[MODULE_ID] = structuredClone(changes[key]);
      this.updated = changes;
      return this;
    }
  };
}

/* ------------------------------------------------------------------ pure reconciliation (Issues 2 & 3) */

test("reconcile builds pending damage from bound data on a miss rolled into a hit", () => {
  const miss = nativeCard({ pending: false });
  const hit = reconcileRerolledCard(miss, "success");
  assert.equal(hit.result.pendingDamage.crit, false);
  assert.equal(hit.result.pendingDamage.targetUuid, "Actor.target");
  const crit = reconcileRerolledCard(miss, "criticalSuccess");
  assert.equal(crit.result.pendingDamage.crit, true);
  assert.equal(reconcileRerolledCard(miss, "failure").result.pendingDamage, null);
});

test("reconcile clears stale unapplied damage when the requirement changes, keeps it otherwise", () => {
  const rolled = { formula: "(1d6)*2", total: 10, parts: [{ type: "piercing", amount: 10 }], crit: true, by: "gm" };
  const critCard = nativeCard({ crit: true, damageRoll: rolled });
  const downgraded = reconcileRerolledCard(critCard, "success");
  assert.equal(downgraded.result.pendingDamage.crit, false);
  assert.equal(downgraded.damageRoll, undefined, "downgraded critical must re-roll damage");
  const upgraded = reconcileRerolledCard(nativeCard({ crit: false, damageRoll: { ...rolled, crit: false } }), "criticalSuccess");
  assert.equal(upgraded.result.pendingDamage.crit, true);
  assert.equal(upgraded.damageRoll, undefined);
  const same = reconcileRerolledCard(critCard, "criticalSuccess");
  assert.equal(same, critCard, "unchanged degree keeps the rolled damage");
  const hitToMiss = reconcileRerolledCard(critCard, "failure");
  assert.equal(hitToMiss.result.pendingDamage, undefined);
  assert.equal(hitToMiss.damageRoll, undefined);
});

test("reconcile never reopens applied damage and ignores non-native / unknown cards", () => {
  const applied = { ...nativeCard(), damageApplied: true, damageResult: { hull: 4 } };
  assert.equal(reconcileRerolledCard(applied, "criticalFailure"), applied);
  const nonNative = { ...nativeCard(), native: false };
  assert.equal(reconcileRerolledCard(nonNative, "success"), nonNative);
  const card = nativeCard();
  assert.equal(reconcileRerolledCard(card, null), card);
  assert.equal(reconcileRerolledCard(card, "bogus"), card);
});

/* ------------------------------------------------------------------ eligibility contract */

test("isNativeCheckContext accepts check rolls and rejects damage / spell-cast / missing context", () => {
  for (const type of ["attack-roll", "skill-check", "saving-throw", "perception-check", "flat-check", "check"])
    assert.equal(isNativeCheckContext({ type }), true, type);
  for (const type of ["damage-roll", "spell-cast"]) assert.equal(isNativeCheckContext({ type }), false, type);
  assert.equal(isNativeCheckContext(null), false);
});

test("module checks delegate message creation to the native pipeline (reroll-eligible), fallback is plain", async () => {
  installFoundryMock();
  let passed;
  const statistic = { check: { roll: async (o) => ((passed = o), { total: 18, degreeOfSuccess: 2, dice: [{ total: 13 }] }) } };
  const native = await rollNativeCheck({ statistic, dc: 15, label: "Check" });
  assert.equal(native.native, true);
  assert.equal(passed.createMessage, true);
  assert.ok(passed.extraRollOptions.includes("starship"));
  const before = game.messages.contents.length;
  const fallback = await rollNativeCheck({ statistic: null, dc: 15, label: "Check", modifierOnly: 5 });
  assert.equal(fallback.native, false);
  assert.equal(game.messages.contents.length, before + 1);
});

/* ------------------------------------------------------------------ exact source correlation (Issue 1) */

test("a reroll restores its own source even after an identical attack was ordinarily deleted", async () => {
  installFoundryMock();
  _resetRerollSupport();
  const a = await sourceMessage(mkRoll("A", 10), { card: nativeCard({ applicationId: "app-A" }) });
  await sourceMessage(mkRoll("B", 12), { card: nativeCard({ applicationId: "app-B" }) });
  // Ordinary deletion of A (same speaker/weapon/target as B) must not enter any reroll queue.
  game.messages.delete(a.id);
  Hooks.callAll("deleteChatMessage", a);
  // Reroll B: only B's flags may be restored.
  onSystemReroll(mkRoll("B", 12), mkRoll("B2", 18));
  const rerolled = rerolledMessage(mkRoll("B2", 18));
  await onRerollMessageCreated(rerolled);
  assert.equal(rerolled.flags[MODULE_ID][CARD_FLAG].applicationId, "app-B");
});

test("consecutive rerolls of identical attacks each restore their own source", async () => {
  installFoundryMock();
  _resetRerollSupport();
  await sourceMessage(mkRoll("A", 10), { card: nativeCard({ applicationId: "app-A" }) });
  await sourceMessage(mkRoll("B", 10), { card: nativeCard({ applicationId: "app-B" }) });
  onSystemReroll(mkRoll("A", 10), mkRoll("A2", 15));
  const ra = rerolledMessage(mkRoll("A2", 15));
  await onRerollMessageCreated(ra);
  assert.equal(ra.flags[MODULE_ID][CARD_FLAG].applicationId, "app-A");
  onSystemReroll(mkRoll("B", 10), mkRoll("B2", 16));
  const rb = rerolledMessage(mkRoll("B2", 16));
  await onRerollMessageCreated(rb);
  assert.equal(rb.flags[MODULE_ID][CARD_FLAG].applicationId, "app-B");
});

test("keep-higher that keeps the old roll still matches the source", async () => {
  installFoundryMock();
  _resetRerollSupport();
  await sourceMessage(mkRoll("A", 18), { card: nativeCard({ applicationId: "app-A" }) });
  // new roll is lower; the system posts the OLD roll when keeping higher
  onSystemReroll(mkRoll("A", 18), mkRoll("A2", 5));
  const rerolled = rerolledMessage(mkRoll("A", 18), { outcome: "criticalSuccess" });
  await onRerollMessageCreated(rerolled);
  assert.equal(rerolled.flags[MODULE_ID][CARD_FLAG].applicationId, "app-A");
});

/* ------------------------------------------------------------------ restoration behaviour (Issues 2, 3, 4) */

test("reroll restores flags, reconciles degree and keeps the stable applicationId", async () => {
  installFoundryMock();
  _resetRerollSupport();
  await sourceMessage(mkRoll("A", 18), { card: nativeCard({ crit: true, applicationId: "app-A", damageRoll: { total: 9, crit: true } }) });
  onSystemReroll(mkRoll("A", 18), mkRoll("A2", 12));
  const rerolled = rerolledMessage(mkRoll("A2", 12), { outcome: "success" });
  await onRerollMessageCreated(rerolled);
  const card = rerolled.flags[MODULE_ID][CARD_FLAG];
  assert.equal(card.applicationId, "app-A", "stable damage-application id survives the reroll");
  assert.equal(card.result.pendingDamage.crit, false);
  assert.equal(card.damageRoll, undefined, "stale critical damage discarded");
  assert.equal(rerolled.flags[MODULE_ID].nativeAttackReceipt.eventId, "evt");
});

test("miss rolled into a hit gains damage controls; pf2e namespace works", async () => {
  installFoundryMock();
  game.system.id = "pf2e";
  _resetRerollSupport();
  await sourceMessage(mkRoll("A", 4), { system: "pf2e", card: nativeCard({ pending: false }), outcome: "failure" });
  onSystemReroll(mkRoll("A", 4), mkRoll("A2", 19));
  const rerolled = rerolledMessage(mkRoll("A2", 19), { system: "pf2e", outcome: "criticalSuccess" });
  await onRerollMessageCreated(rerolled);
  assert.equal(rerolled.flags[MODULE_ID][CARD_FLAG].result.pendingDamage.crit, true);
});

test("only the rerolling client restores flags (no multi-client duplicate write)", async () => {
  installFoundryMock();
  _resetRerollSupport();
  await sourceMessage(mkRoll("A", 18));
  onSystemReroll(mkRoll("A", 18), mkRoll("A2", 12));
  const rerolled = rerolledMessage(mkRoll("A2", 12), { author: "gm" });
  game.user = game.users.get("p1");
  await onRerollMessageCreated(rerolled);
  assert.equal(rerolled.flags[MODULE_ID], undefined);
  assert.equal(rerolled.updated, undefined);
});

test("damage rolls and ordinary messages are left untouched", async () => {
  installFoundryMock();
  _resetRerollSupport();
  const damage = await MockChatMessage.create({
    speaker: { actor: "ship1" },
    rolls: [mkRoll("D", 7)],
    flags: { sf2e: { context: { type: "damage-roll" } }, [MODULE_ID]: { autoAppliedDamage: true } }
  });
  onSystemReroll(mkRoll("D", 7), mkRoll("D2", 8));
  const rerolledDamage = rerolledMessage(mkRoll("D2", 8));
  rerolledDamage.flags.sf2e.context.type = "damage-roll";
  await onRerollMessageCreated(rerolledDamage);
  assert.equal(rerolledDamage.flags[MODULE_ID], undefined);
  assert.ok(damage.flags[MODULE_ID].autoAppliedDamage);
});

/* ------------------------------------------------------------------ registration + hook wiring */

test("registerRerollSupport is idempotent and wires the system reroll + create hooks", async () => {
  installFoundryMock();
  registerRerollSupport();
  registerRerollSupport();
  assert.equal(Hooks._hooks.get("pf2e.reroll").length, 1);
  assert.equal(Hooks._hooks.get("createChatMessage").length, 1);
  await sourceMessage(mkRoll("A", 18), { card: nativeCard({ crit: true }) });
  Hooks.callAll("pf2e.reroll", mkRoll("A", 18), mkRoll("A2", 12), null, { keep: "new" });
  const rerolled = await MockChatMessage.create({
    speaker: { actor: "ship1", token: "tok1" },
    rolls: [mkRoll("A2", 12)],
    flags: {
      sf2e: {
        context: {
          type: "attack-roll",
          origin: { actor: "Actor.crew" },
          target: { actor: "Actor.target" },
          outcome: "success",
          isReroll: true
        },
        modifierName: "starship-strike"
      }
    }
  });
  await flush();
  assert.equal(rerolled.flags[MODULE_ID][CARD_FLAG].result.pendingDamage.crit, false);
});
