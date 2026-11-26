import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";
import { postActionCard } from "../../scripts/chat/chat-cards.mjs";
import { applyToolbeltDamage, CHAT_DAMAGE_FLAG } from "../../scripts/integrations/toolbelt-damage-service.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";

function targetHelper({ enabled = true, targets = true, partial = false } = {}) {
  const calls = [];
  const api = {
    setMessageFlagTargets(updates, uuids) {
      calls.push({ updates, uuids });
      updates.flags ??= {};
      updates.flags["pf2e-toolbelt"] ??= {};
      updates.flags["pf2e-toolbelt"].targets = uuids;
      return updates;
    }
  };
  if (!partial)
    api.getMessageTargets = (message) =>
      (message.flags?.["pf2e-toolbelt"]?.targets ?? []).map((uuid) => globalThis.__extraUuids?.get(uuid)).filter(Boolean);
  game.toolbelt = {
    api: { targetHelper: api },
    getToolSetting(tool, key) {
      if (tool !== "targetHelper") return undefined;
      return key === "enabled" ? enabled : key === "targets" ? targets : undefined;
    }
  };
  return calls;
}

async function cardScenario() {
  installFoundryMock();
  const ship = makeShip({ id: "aurora", name: "Aurora" });
  const token = { id: "ship-token", uuid: "Scene.scene.Token.aurora", actor: ship };
  const duplicate = { ...token };
  const ordinary = { id: "pc-token", uuid: "Scene.scene.Token.pc", actor: { uuid: "Actor.pc", type: "character" } };
  globalThis.__extraUuids = new Map([
    [token.uuid, token],
    [duplicate.uuid, duplicate],
    [ordinary.uuid, ordinary]
  ]);
  return { ship, token, ordinary };
}

test("Target Helper receives only valid deduplicated Token UUIDs on compatible module cards", async () => {
  const { token, ordinary } = await cardScenario();
  game.modules.set("pf2e-toolbelt", { active: true });
  const calls = targetHelper();
  await postActionCard({
    actor: token.actor,
    action: { id: "evade", name: "Evade" },
    targetUUIDs: [token.uuid, token.uuid, "Actor.aurora", "Scene.scene.Token.missing", ordinary.uuid]
  });
  const message = game.messages.contents.at(-1);
  assert.deepEqual(message.flags["pf2e-toolbelt"].targets, [token.uuid, ordinary.uuid]);
  assert.deepEqual(calls[0].uuids, [token.uuid, ordinary.uuid]);
  assert.equal(calls[0].updates.flags[MODULE_ID].card, true);
  assert.deepEqual(message.flags[MODULE_ID].cardData.targetUUIDs, [token.uuid, "Actor.aurora", "Scene.scene.Token.missing", ordinary.uuid]);
});

test("Target Helper absence, disabled settings and partial APIs leave module cards usable", async () => {
  for (const mode of ["absent", "disabled", "targets-disabled", "partial"]) {
    const { token } = await cardScenario();
    if (mode !== "absent") game.modules.set("pf2e-toolbelt", { active: true });
    if (mode === "disabled") targetHelper({ enabled: false });
    if (mode === "targets-disabled") targetHelper({ targets: false });
    if (mode === "partial") targetHelper({ partial: true });
    await postActionCard({ actor: token.actor, action: { id: "evade", name: "Evade" }, targetUUIDs: [token.uuid] });
    const message = game.messages.contents.at(-1);
    assert.match(message.content, /pf2e chat-card/);
    assert.equal(message.flags["pf2e-toolbelt"]?.targets, undefined, mode);
    assert.deepEqual(message.flags[MODULE_ID].cardData.targetUUIDs, [token.uuid], mode);
  }
});

function typedRoll(amount = 8, type = "piercing") {
  return {
    options: {},
    total: amount,
    instances: [{ total: amount, type, persistent: false, options: {}, kinds: new Set(["damage"]) }],
    alter(multiplier, addend) {
      return typedRoll(Math.max(0, Math.floor(amount * multiplier + addend)), type);
    }
  };
}

async function damageScenario({ toolbelt = "absent" } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  if (toolbelt !== "absent") game.modules.set("pf2e-toolbelt", { active: true });
  if (toolbelt === "partial") game.toolbelt = { api: {} };
  const actor = makeShip({ id: "aurora", name: "Aurora", sp: 12, hp: 30 });
  const message = await ChatMessage.create({ content: "damage", rolls: [typedRoll()], flags: {} });
  message.isDamageRoll = true;
  const payload = { messageId: message.id, targetUuid: actor.uuid, rollIndex: 0, multiplier: 1, mode: "shields" };
  return { actor, message, apply: () => applyToolbeltDamage({ user: game.user, payload }) };
}

test("native SF2e starship damage is captured even when Toolbelt is absent", async () => {
  const { actor, apply } = await damageScenario();
  assert.deepEqual(await apply(), { shield: 8, hull: 0, mode: "shields" });
  assert.equal(readStarship(actor).sp.value, 4);
  assert.equal(actor.system.attributes.hp.value, 30);
});

test("partial Toolbelt APIs do not disable the starship damage adapter", async () => {
  const { actor, apply } = await damageScenario({ toolbelt: "partial" });
  await apply();
  assert.equal(readStarship(actor).sp.value, 4);
});

test("starship damage receipts identify the adapter version and remain idempotent", async () => {
  const { actor, message, apply } = await damageScenario({ toolbelt: "present" });
  await apply();
  const receipt = actor.flags[MODULE_ID][CHAT_DAMAGE_FLAG][0];
  assert.equal(receipt.adapter, "sf2e-starship-damage-v1");
  assert.equal(message.flags[MODULE_ID].damageReceipts[`${actor.uuid.replace(/\./g, "_")}_0`].adapter, receipt.adapter);
  await assert.rejects(apply(), /already|уже/i);
  assert.equal(readStarship(actor).sp.value, 4);
});

test("ordinary actors never enter the starship damage service", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const ordinary = { uuid: "Actor.pc", type: "character", flags: {}, system: { attributes: { hp: { value: 20 } } } };
  globalThis.__extraUuids = new Map([[ordinary.uuid, ordinary]]);
  const message = await ChatMessage.create({ content: "damage", rolls: [typedRoll()], flags: {} });
  message.isDamageRoll = true;
  await assert.rejects(
    applyToolbeltDamage({
      user: game.user,
      payload: { messageId: message.id, targetUuid: ordinary.uuid, rollIndex: 0, multiplier: 1, mode: "shields" }
    }),
    /ship|корабл/i
  );
  assert.equal(ordinary.system.attributes.hp.value, 20);
});
