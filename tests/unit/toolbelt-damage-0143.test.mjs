import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";
import { computeStarshipDamagePacket } from "../../scripts/engine/damage-packet.mjs";
import { applyToolbeltDamage, damagePartsFromMessage, CHAT_DAMAGE_FLAG } from "../../scripts/integrations/toolbelt-damage-service.mjs";
import { hasDamageReceipt } from "../../scripts/integrations/toolbelt-damage.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { rollTypedDamage } from "../../scripts/rolls/typed-damage.mjs";

// Модель уже вычисленного DamageRoll. alter не бросает кости заново.
function typedRoll(parts, options = {}) {
  return {
    options,
    total: parts.reduce((sum, part) => sum + part.amount, 0),
    instances: parts.map((part) => ({
      total: part.amount,
      type: part.type,
      persistent: !!part.persistent,
      options: { evaluatePersistent: !!part.evaluated },
      kinds: new Set([part.healing ? "healing" : "damage"])
    })),
    alter(multiplier, addend) {
      return typedRoll(
        parts.map((part, index) => ({
          ...part,
          amount: Math.max(0, Math.floor(part.amount * multiplier + (index === 0 ? addend : 0)))
        })),
        options
      );
    }
  };
}
async function scenario({ sp = 12, extra = {}, parts = [{ amount: 8, type: "piercing" }] } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  game.modules.set("pf2e-toolbelt", { active: true });
  const actor = makeShip({ id: "ship", name: "Test Ship", sp, hp: 30, extra });
  const message = await ChatMessage.create({ content: "damage", rolls: [typedRoll(parts)], flags: {} });
  message.isDamageRoll = true;
  const token = { uuid: "Scene.scene.Token.ship", actor };
  globalThis.__extraUuids.set(token.uuid, token);
  const payload = { messageId: message.id, targetUuid: token.uuid, rollIndex: 0, multiplier: 1, mode: "shields" };
  const apply = (patch = {}, user = game.user) => applyToolbeltDamage({ user, payload: { ...payload, ...patch } });
  return { actor, message, token, payload, apply };
}

test("Toolbelt damage: shields absorb first; direct mode leaves shields intact", async () => {
  const a = await scenario();
  assert.deepEqual(await a.apply(), { shield: 8, hull: 0, mode: "shields" });
  assert.equal(readStarship(a.actor).sp.value, 4);
  assert.equal(a.actor.system.attributes.hp.value, 30);
  const b = await scenario();
  assert.deepEqual(await b.apply({ mode: "hull" }), { shield: 0, hull: 8, mode: "hull" });
  assert.equal(readStarship(b.actor).sp.value, 12);
  assert.equal(b.actor.system.attributes.hp.value, 22);
});

test("Toolbelt damage: excess shields damage reaches hull, not both pools in full", async () => {
  const s = await scenario({ parts: [{ amount: 20, type: "piercing" }] });
  const result = await s.apply();
  assert.equal(result.shield, 12);
  assert.equal(result.hull, 8);
  assert.equal(s.actor.system.attributes.hp.value, 22);
});

test("Toolbelt damage: IWR and Hardness still apply when bypassing shields", async () => {
  const s = await scenario({ extra: { resistances: { fire: 5 }, hardness: 3 }, parts: [{ amount: 20, type: "fire" }] });
  const result = await s.apply({ mode: "hull" });
  assert.equal(result.hull, 12);
  assert.equal(readStarship(s.actor).sp.value, 12);
});

test("damage packet preserves types, merges same-type instances and subtracts Hardness once", async () => {
  const s = await scenario({
    sp: 8,
    extra: { resistances: { fire: 5 }, hardness: 3 },
    parts: [
      { amount: 10, type: "piercing" },
      { amount: 10, type: "fire" }
    ]
  });
  const result = await s.apply();
  assert.equal(result.shield, 8);
  assert.equal(result.hull, 4);
  const one = computeStarshipDamagePacket({
    state: { hp: 30, sp: 8, resistances: { fire: 5 }, hardness: 3 },
    parts: [
      { amount: 6, type: "fire" },
      { amount: 6, type: "fire" }
    ]
  });
  assert.equal(one.mitigatedDamage, 4, "12 - 5 resistance - 3 Hardness");
});

test("damage packet applies immunity by type and critical state transition only once", () => {
  const immune = computeStarshipDamagePacket({
    state: { hp: 30, sp: 0, immunities: ["fire"], hardness: 2 },
    parts: [
      { amount: 10, type: "fire" },
      { amount: 6, type: "piercing" }
    ]
  });
  assert.equal(immune.hullDamage, 4);
  const compromised = computeStarshipDamagePacket({
    state: { hp: 30, sp: 0, compromised: 1 },
    parts: [
      { amount: 5, type: "fire" },
      { amount: 5, type: "piercing" }
    ],
    criticalHit: true
  });
  assert.equal(compromised.compromisedIncrease, 2);
  assert.equal(compromised.newState.compromised, 3);
});

test("Toolbelt damage: halves/doubles and Shift addend use the stored roll, not client amount", async () => {
  const s = await scenario({ parts: [{ amount: 9, type: "piercing" }] });
  await s.apply({ multiplier: 0.5, addend: 2, amount: 100000 });
  assert.equal(readStarship(s.actor).sp.value, 6, "floor(9 * .5 + 2) = 6");
  const d = await scenario();
  await d.apply({ multiplier: 2 });
  assert.equal(readStarship(d.actor).sp.value, 0);
  assert.equal(d.actor.system.attributes.hp.value, 26);
});

test("Toolbelt damage: concurrent clicks and switching mode cannot apply the same hit twice", async () => {
  const s = await scenario();
  const results = await Promise.allSettled([s.apply(), s.apply({ mode: "hull" })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(readStarship(s.actor).sp.value, 4);
  assert.equal(s.actor.system.attributes.hp.value, 30);
  assert.ok(hasDamageReceipt(s.message, s.actor, 0));
  await assert.rejects(s.apply(), /already|уже/i);
});

test("Toolbelt damage: different messages queue on one ship and preserve both updates", async () => {
  const s = await scenario();
  const message2 = await ChatMessage.create({ content: "second", rolls: [typedRoll([{ amount: 8, type: "piercing" }])], flags: {} });
  message2.isDamageRoll = true;
  await Promise.all([s.apply(), s.apply({ messageId: message2.id })]);
  assert.equal(readStarship(s.actor).sp.value, 0);
  assert.equal(s.actor.system.attributes.hp.value, 26);
});

test("Toolbelt damage: actor receipt protects a saved application if chat update fails", async () => {
  const s = await scenario();
  s.message.update = async () => {
    throw new Error("chat unavailable");
  };
  await s.apply();
  assert.equal(s.actor.flags[MODULE_ID][CHAT_DAMAGE_FLAG].length, 1);
  await assert.rejects(s.apply({ mode: "hull" }), /already|уже/i);
  assert.equal(s.actor.system.attributes.hp.value, 30);
});

test("Toolbelt damage: failed actor update does not stamp a receipt or consume the hit", async () => {
  const s = await scenario();
  const update = s.actor.update;
  s.actor.update = async () => {
    throw new Error("update unavailable");
  };
  await assert.rejects(s.apply());
  assert.equal(s.actor.flags[MODULE_ID][CHAT_DAMAGE_FLAG], undefined);
  assert.equal(readStarship(s.actor).sp.value, 12);
  s.actor.update = update;
  await s.apply();
  assert.equal(readStarship(s.actor).sp.value, 4);
});

test("Toolbelt damage: permissions, private messages and ordinary actors are checked on the GM side", async () => {
  const s = await scenario();
  const player = game.users.get("p1");
  await assert.rejects(s.apply({}, player));
  s.actor.owners.push(player.id);
  s.message.whisper = ["gm"];
  await assert.rejects(s.apply({}, player));
  s.message.whisper = [];
  s.message.blind = true;
  await assert.rejects(s.apply({}, player));
  s.message.blind = false;
  const pc = makeCharacter({ id: "ordinary", name: "Ordinary", owners: [player.id] });
  await assert.rejects(s.apply({ targetUuid: pc.uuid }, player));
  assert.equal(readStarship(s.actor).sp.value, 12);
  await s.apply({}, player);
  assert.equal(readStarship(s.actor).sp.value, 4);
});

test("Toolbelt damage: malformed requests and unavailable integration cannot mutate the ship", async () => {
  const s = await scenario();
  for (const patch of [
    { mode: "anything" },
    { multiplier: 1000 },
    { multiplier: "1" },
    { rollIndex: -1 },
    { addend: NaN },
    { rollIndex: 99 }
  ])
    await assert.rejects(s.apply(patch));
  game.modules.set("pf2e-toolbelt", { active: false });
  await assert.rejects(s.apply());
  assert.equal(readStarship(s.actor).sp.value, 12);
});

test("Toolbelt damage: unsupported persistent, healing-only and split splash rolls fail explicitly", async () => {
  const s = await scenario();
  for (const part of [
    { amount: 8, type: "fire", persistent: true },
    { amount: 8, type: "vitality", healing: true }
  ]) {
    s.message.rolls = [typedRoll([part])];
    assert.throws(() => damagePartsFromMessage(s.message, 0, 1));
  }
  s.message.rolls = [typedRoll([{ amount: 8, type: "fire" }], { splashOnly: true })];
  await assert.rejects(s.apply());
  assert.equal(readStarship(s.actor).sp.value, 12);
});

test("Toolbelt damage: bypassing trait from the source weapon bypasses shields in either mode", async () => {
  const s = await scenario();
  s.message.item = { flags: { [MODULE_ID]: { packWeapon: { starshipTraits: ["bypassing"] } } } };
  await s.apply();
  assert.equal(readStarship(s.actor).sp.value, 12);
  assert.equal(s.actor.system.attributes.hp.value, 22);
});

test("module attack-card damage uses its existing application path, not a second Toolbelt button", async () => {
  installFoundryMock();
  await rollTypedDamage("{8[piercing]}", { attackCardId: "attack-message" });
  const message = game.messages.contents.at(-1);
  assert.equal(message.flags.sf2e.suppressDamageButtons, true);
  assert.equal(message.flags[MODULE_ID].attackCardDamage, "attack-message");
  message.isDamageRoll = true;
  assert.throws(() => damagePartsFromMessage(message, 0, 1));
});

test("Toolbelt damage: message receipt protects after bounded actor receipts are pruned", async () => {
  const s = await scenario();
  await s.apply();
  s.actor.flags[MODULE_ID][CHAT_DAMAGE_FLAG] = [];
  assert.equal(hasDamageReceipt(s.message, s.actor, 0), true);
  await assert.rejects(s.apply({ targetUuid: s.actor.uuid, mode: "hull" }));
  assert.equal(readStarship(s.actor).sp.value, 4);
  assert.equal(s.actor.system.attributes.hp.value, 30);
});
