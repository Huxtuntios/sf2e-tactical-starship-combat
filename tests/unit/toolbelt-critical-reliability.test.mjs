import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";
import { applyToolbeltDamage, CHAT_DAMAGE_FLAG, damageReceiptKey } from "../../scripts/integrations/toolbelt-damage-service.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";

// Native alter() marks manual x2/x3 terms but drops roll-level options, unlike the original stored degree.
function typedRoll(parts, options = {}) {
  return {
    options,
    instances: parts.map(({ amount, type }) => ({ total: amount, type, persistent: false, options: {}, kinds: new Set(["damage"]) })),
    alter(multiplier, addend) {
      const altered = typedRoll(
        parts.map((part, index) => ({ ...part, amount: Math.max(0, part.amount * multiplier + (index === 0 ? addend : 0)) }))
      );
      if ([2, 3].includes(multiplier)) for (const instance of altered.instances) instance.options.crit = multiplier;
      return altered;
    }
  };
}

const damageContext = (outcome, patch = {}) => ({ type: "damage-roll", sourceType: "attack", options: [], outcome, ...patch });

async function scenario({
  degree,
  context,
  systemId = "sf2e",
  hp = 5,
  sp = 0,
  extra = {},
  parts = [{ amount: 6, type: "piercing" }]
} = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  game.system = { id: systemId, version: systemId === "sf2e" ? "1.6.1" : "8.6.1" };
  game.modules.set("pf2e-toolbelt", { active: true, version: "3.60.0" });
  const actor = makeShip({ id: "critical-ship", name: "Critical Ship", hp, sp, extra });
  const roll = typedRoll(parts, { degreeOfSuccess: degree });
  const message = await ChatMessage.create({ rolls: [roll], flags: context ? { [systemId]: { context } } : {} });
  message.isDamageRoll = true;
  const payload = { messageId: message.id, targetUuid: actor.uuid, rollIndex: 0, multiplier: 1, mode: "hull" };
  const apply = (patch = {}) => applyToolbeltDamage({ user: game.user, payload: { ...payload, ...patch } });
  return { actor, message, roll, apply };
}

for (const multiplier of [2, 3]) {
  for (const degree of [undefined, null, 0, 1, 2]) {
    test(`Toolbelt critical: manual x${multiplier}, original degree ${degree}, is not critical`, async () => {
      const s = await scenario({ degree });
      await s.apply({ multiplier, criticalHit: true, amount: 100000 });
      const state = readStarship(s.actor);
      assert.equal(state.hp.value, 0);
      assert.equal(state.compromised, 1);
      assert.equal(state.inoperable, true);
      assert.equal(state.destroyed, false);
      assert.equal(s.roll.options.degreeOfSuccess, degree);
      assert.equal(s.roll.instances[0].total, 6, "manual scaling leaves the original evaluated roll intact");

      const existing = await scenario({ degree, hp: 0, extra: { compromised: 1, inoperable: true } });
      await existing.apply({ multiplier });
      assert.equal(readStarship(existing.actor).compromised, 2, "ordinary hull damage increments Compromised by one");
    });
  }
}

for (const multiplier of [0.5, 1, 2, 3]) {
  test(`Toolbelt critical: original critical degree survives manual x${multiplier} and addend`, async () => {
    const s = await scenario({ degree: 3, hp: 3 });
    await s.apply({ multiplier, addend: 1, criticalHit: false });
    assert.equal(readStarship(s.actor).compromised, 2);
    assert.equal(s.roll.options.degreeOfSuccess, 3);

    const existing = await scenario({ degree: 3, hp: 0, extra: { compromised: 1, inoperable: true } });
    await existing.apply({ multiplier, addend: 1 });
    assert.equal(readStarship(existing.actor).compromised, 3, "a real critical increments Compromised by two");
  });
}

test("Toolbelt critical: manual zero keeps critical identity but zero damage causes no transition", async () => {
  const s = await scenario({ degree: 3 });
  assert.deepEqual(await s.apply({ multiplier: 0 }), { shield: 0, hull: 0, mode: "hull" });
  assert.equal(readStarship(s.actor).hp.value, 5);
  assert.equal(readStarship(s.actor).compromised, 0);
  await assert.rejects(s.apply({ multiplier: 1 }), /already|уже/i);

  const existing = await scenario({ degree: 3, hp: 0, extra: { compromised: 1, inoperable: true } });
  await existing.apply({ multiplier: 0 });
  assert.equal(readStarship(existing.actor).compromised, 1);

  const addend = await scenario({ degree: 3, hp: 2 });
  await addend.apply({ multiplier: 0, addend: 2 });
  assert.equal(readStarship(addend.actor).compromised, 2, "positive addend still uses the original critical outcome");
});

for (const systemId of ["sf2e", "pf2e"]) {
  test(`Toolbelt critical: ${systemId} native damage context confirms the original critical outcome`, async () => {
    for (const degree of [undefined, null, 3]) {
      const s = await scenario({ systemId, degree, context: damageContext("criticalSuccess", { unadjustedOutcome: "success" }) });
      await s.apply({ multiplier: 1, criticalHit: false });
      assert.equal(readStarship(s.actor).compromised, 2);
    }
    const existing = await scenario({
      systemId,
      context: damageContext("criticalSuccess"),
      hp: 0,
      extra: { compromised: 1, inoperable: true }
    });
    await existing.apply({ multiplier: 0.5 });
    assert.equal(readStarship(existing.actor).compromised, 3);

    const wrongNamespace = await scenario({ systemId });
    wrongNamespace.message.flags[systemId === "sf2e" ? "pf2e" : "sf2e"] = { context: damageContext("criticalSuccess") };
    wrongNamespace.message.flags.system = { context: damageContext("criticalSuccess") };
    await wrongNamespace.apply({ multiplier: 2, criticalHit: true });
    assert.equal(readStarship(wrongNamespace.actor).compromised, 1);
  });
}

for (const [label, degree, context] of [
  ["critical roll contradicts success context", 3, damageContext("success")],
  ["success roll contradicts critical context", 2, damageContext("criticalSuccess")],
  ["failure roll contradicts critical context", 1, damageContext("criticalSuccess")],
  ["string degree", "3", damageContext("criticalSuccess")],
  ["out of range degree", 4, damageContext("criticalSuccess")],
  ["NaN degree", NaN, damageContext("criticalSuccess")],
  ["malformed native outcome", 3, damageContext("critical-success")],
  ["numeric native outcome", 3, damageContext(3)],
  ["save critical failure is not an original critical attack", undefined, damageContext("criticalFailure", { sourceType: "save" })],
  ["check message is not damage context", undefined, damageContext("criticalSuccess", { type: "check" })],
  ["missing context discriminator", undefined, { outcome: "criticalSuccess", options: [] }],
  ["unknown damage source", undefined, damageContext("criticalSuccess", { sourceType: "unknown" })],
  ["success and unadjusted critical are not critical", undefined, damageContext("success", { unadjustedOutcome: "criticalSuccess" })],
  ["missing outcome and client critical are not evidence", undefined, damageContext(null)]
]) {
  test(`Toolbelt critical: ${label} conservatively stays noncritical`, async () => {
    const s = await scenario({ degree, context });
    await s.apply({ criticalHit: true });
    assert.equal(readStarship(s.actor).compromised, 1);
  });
}

for (const sourceType of ["save", "check", "unknown"]) {
  for (const degree of [undefined, 3]) {
    for (const outcome of ["criticalSuccess", "success", null]) {
      test(`Toolbelt critical: ${sourceType} context, degree ${degree}, outcome ${outcome} cannot prove a critical hit`, async () => {
        const s = await scenario({ degree, context: damageContext(outcome, { sourceType }) });
        await s.apply({ multiplier: 2 });
        assert.equal(readStarship(s.actor).compromised, 1);
      });
    }
  }
}

for (const context of [{}, { type: "check", sourceType: "attack", outcome: "criticalSuccess" }]) {
  test(`Toolbelt critical: malformed associated discriminator ${JSON.stringify(context)} rejects original degree 3`, async () => {
    const s = await scenario({ degree: 3, context });
    await s.apply();
    assert.equal(readStarship(s.actor).compromised, 1);
  });
}

test("Toolbelt critical: attack context without outcome preserves valid original degree", async () => {
  const s = await scenario({ degree: 3, context: damageContext(null), hp: 3 });
  await s.apply({ multiplier: 0.5 });
  assert.equal(readStarship(s.actor).compromised, 2);
});

test("Toolbelt critical: formula/term crit markers and altered-roll options are not original outcome evidence", async () => {
  const s = await scenario({ degree: 2 });
  s.roll.formula = "2 * 3[piercing]";
  s.roll.options.critRule = "double-damage";
  s.roll.instances[0].options.crit = 2;
  const alter = s.roll.alter;
  s.roll.alter = (...args) => {
    const result = alter(...args);
    result.options.degreeOfSuccess = 3;
    return result;
  };
  await s.apply({ multiplier: 2 });
  assert.equal(readStarship(s.actor).compromised, 1);
});

test("Toolbelt critical: only the selected original roll counts; message context cannot label additional rolls", async () => {
  const s = await scenario({ degree: 3, context: damageContext("criticalSuccess") });
  s.message.rolls.push(typedRoll([{ amount: 6, type: "piercing" }], { degreeOfSuccess: 2 }));
  await s.apply({ rollIndex: 1, multiplier: 2 });
  assert.equal(readStarship(s.actor).compromised, 1);

  const selectedCritical = await scenario({ degree: 2 });
  selectedCritical.message.rolls.push(typedRoll([{ amount: 6, type: "piercing" }], { degreeOfSuccess: 3 }));
  await selectedCritical.apply({ rollIndex: 1 });
  assert.equal(readStarship(selectedCritical.actor).compromised, 2);

  const ambiguous = await scenario({ context: damageContext("criticalSuccess") });
  ambiguous.message.rolls.push(typedRoll([{ amount: 6, type: "fire" }]));
  await ambiguous.apply();
  assert.equal(readStarship(ambiguous.actor).compromised, 1, "native context fallback requires an unambiguous single damage roll");
});

test("Toolbelt critical: critical identity does not bypass typed IWR or shields", async () => {
  const s = await scenario({
    degree: 3,
    hp: 3,
    sp: 3,
    extra: { resistances: { fire: 2 }, hardness: 1 },
    parts: [
      { amount: 4, type: "fire" },
      { amount: 4, type: "piercing" }
    ]
  });
  assert.deepEqual(await s.apply({ mode: "shields" }), { shield: 3, hull: 2, mode: "shields" });
  assert.equal(readStarship(s.actor).compromised, 0);
  assert.equal(readStarship(s.actor).hp.value, 1);

  const bypass = await scenario({
    context: damageContext("criticalSuccess", { options: ["item:trait:bypassing"] }),
    hp: 3,
    sp: 10
  });
  await bypass.apply({ mode: "shields", multiplier: 0.5 });
  assert.equal(readStarship(bypass.actor).sp.value, 10);
  assert.equal(readStarship(bypass.actor).compromised, 2);
});

test("Toolbelt critical: receipts deny repeated critical state changes in either mode", async () => {
  const s = await scenario({ degree: 3 });
  await s.apply();
  const key = damageReceiptKey(s.actor.uuid, 0);
  assert.equal(s.actor.flags[MODULE_ID][CHAT_DAMAGE_FLAG].length, 1);
  assert.ok(s.message.flags[MODULE_ID].damageReceipts[key]);
  const writes = globalThis.__writes.length;
  await assert.rejects(s.apply({ mode: "shields", multiplier: 3 }), /already|уже/i);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(readStarship(s.actor).compromised, 2);

  s.actor.flags[MODULE_ID][CHAT_DAMAGE_FLAG] = [];
  await assert.rejects(s.apply(), /already|уже/i);
  assert.equal(readStarship(s.actor).compromised, 2);
});

test("Toolbelt critical: failed commit leaves hull, Compromised and receipts untouched, retry applies once", async () => {
  const s = await scenario({ context: damageContext("criticalSuccess") });
  const update = s.actor.update;
  s.actor.update = async () => {
    throw new Error("critical update unavailable");
  };
  await assert.rejects(s.apply());
  assert.equal(readStarship(s.actor).hp.value, 5);
  assert.equal(readStarship(s.actor).compromised, 0);
  assert.equal(s.actor.flags[MODULE_ID][CHAT_DAMAGE_FLAG], undefined);
  assert.equal(s.message.flags[MODULE_ID]?.damageReceipts, undefined);
  s.actor.update = update;
  await s.apply();
  assert.equal(readStarship(s.actor).compromised, 2);
  await assert.rejects(s.apply(), /already|уже/i);
});
