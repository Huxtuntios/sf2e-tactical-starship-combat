import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Content } from "../../scripts/content/loader.mjs";
import {
  installFoundryMock,
  loadContentFromDisk,
  makeShip,
  makeCharacter,
  makeStarshipCombat,
  MockRoll,
  dice
} from "../helpers/foundry-mock.mjs";
import { resolveStrike, resolveAreaFire, computeAttackModifiers, resolveWeapon } from "../../scripts/actions/strike.mjs";
import { rollAttackCardDamage, applyAttackCardDamage } from "../../scripts/chat/attack-card/service.mjs";
import { damagePartsFromRoll } from "../../scripts/rolls/typed-damage.mjs";
import { Reactions, resolveReactionResponse } from "../../scripts/actions/reactions.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { computeShipStats } from "../../scripts/starship/stats.mjs";
import { readStarship, patchStarship } from "../../scripts/starship/starship-state.mjs";
import { MODULE_ID as M, HOOK_EVENTS } from "../../scripts/constants.mjs";

// The shared mock has only a total. This fixture models the verified native instance type/total contract.
function nativeInstances({ failAfterMessage = false } = {}) {
  class DamageRoll extends MockRoll {
    async evaluate() {
      this.instances = [];
      for (const component of this.formula.slice(1, -1).split(",")) {
        const [, formula, type] = /^\((.*)\)\[([a-z-]+)\]$/.exec(component);
        const roll = await new MockRoll(formula).evaluate();
        this.instances.push({ type, total: roll.total, kinds: new Set(["damage"]) });
        this.dice.push(...roll.dice);
      }
      this.total = this.instances.reduce((sum, part) => sum + part.total, 0);
      this._evaluated = true;
      return this;
    }
    async toMessage(data, options) {
      this.messageOptions = options;
      const message = await super.toMessage(data);
      if (failAfterMessage) throw new Error("posted damage failure");
      return message;
    }
  }
  CONFIG.Dice.rolls = [DamageRoll];
}

async function scenario({ damage = "1d6 piercing plus 1d6 fire", traits = [], target = {}, attacker = {}, installed = false } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  Content.drones = JSON.parse(readFileSync(new URL("../../data/equipment/misc.json", import.meta.url), "utf8")).drones;
  nativeInstances();
  const crew = makeCharacter({ id: "gunner", name: "Gunner", owners: ["p1"] });
  const ship = makeShip({
    id: "attacker",
    name: "Attacker",
    role: "npc",
    weapons: installed ? [{ id: "w", name: "Audit weapon", die: "1d6", damageType: "piercing", range: 6, traits }] : [],
    extra: attacker
  });
  const defender = makeShip({ id: "defender", name: "Defender", role: "player", ac: 18, sp: 0, hp: 30, ...target });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 1, detection: { party: "identified" } },
      { key: defender.uuid, zone: 3, heading: "left", detection: { party: "identified" } }
    ]
  });
  const draft = new Draft(combat);
  const data = (await draft.ship(ship.uuid)).data;
  const ctx = {
    ship,
    shipUuid: ship.uuid,
    crew,
    data,
    draft,
    combat,
    tsc: draft.tsc,
    stats: computeShipStats(ship),
    stationRow: { damageDice: 1 },
    options: installed ? {} : { npcStrike: { name: "Audit strike", attack: 8, damage, traits, range: 6 } },
    action: { builtin: installed ? "strike" : "npc-strike" },
    target: { key: defender.uuid, uuid: defender.uuid, actor: defender, data: (await draft.ship(defender.uuid)).data },
    lines: [],
    reports: [],
    manual: [],
    strikeId: "audit-strike",
    rule: (key) => {
      throw new Error(key);
    }
  };
  return { ctx, ship, defender, combat, draft, crew, gm: game.users.get("gm") };
}
const cardOf = (message) => message.flags[M].attackCard;
async function deferred(s, crit = false) {
  s.ctx.options.sheetRoll = true;
  dice(crit ? 20 : 10);
  await resolveStrike(s.ctx);
  const message = await ChatMessage.create({
    flags: {
      [M]: {
        attackCard: {
          native: true,
          status: "resolved",
          request: { shipUuid: s.ship.uuid },
          ship: { name: s.ship.name },
          weapon: { name: "Audit strike" },
          action: s.ctx.action,
          result: { pendingDamage: s.ctx.pendingDamage }
        }
      }
    }
  });
  return { message, payload: { messageId: message.id }, user: s.gm };
}
const state = (s) => readStarship(s.defender);
const damageLog = (s) => s.draft.tsc.log.filter((entry) => entry.type === "damage");

for (const mode of ["immediate", "deferred"]) {
  for (const crit of [false, true]) {
    test(`${mode}: nonlethal reaches zero HP without compromised/destruction, critical=${crit}`, async () => {
      const s = await scenario({ damage: "1d6 piercing", traits: ["NonLethal"], target: { hp: 3 } });
      if (mode === "immediate") {
        dice(crit ? 20 : 10, 4);
        await resolveStrike(s.ctx);
        await s.draft.commit();
      } else {
        const card = await deferred(s, crit);
        dice(4);
        await rollAttackCardDamage(card);
        await applyAttackCardDamage(card);
      }
      assert.deepEqual([state(s).hp.value, state(s).compromised, state(s).inoperable, state(s).destroyed], [0, 0, true, false]);
    });
  }
  test(`${mode}: 4 piercing + 4 fire vs fire immunity applies only 4`, async () => {
    const s = await scenario({ target: { extra: { immunities: ["fire"] } } });
    if (mode === "immediate") {
      dice(10, 4, 4);
      await resolveStrike(s.ctx);
      assert.deepEqual(
        damageLog(s)[0].data.components.map((part) => [part.type, part.originalDamage, part.mitigatedDamage]),
        [
          ["piercing", 4, 4],
          ["fire", 4, 0]
        ]
      );
      await s.draft.commit();
    } else {
      const card = await deferred(s);
      dice(4, 4);
      await rollAttackCardDamage(card);
      assert.deepEqual(cardOf(card.message).damageRoll.parts, [
        { type: "piercing", amount: 4 },
        { type: "fire", amount: 4 }
      ]);
      await applyAttackCardDamage(card);
      await assert.rejects(() => applyAttackCardDamage(card), /already/i);
    }
    assert.equal(state(s).hp.value, 26);
  });
  test(`${mode}: actual unequal instance totals are preserved, never proportioned from total`, async () => {
    const s = await scenario({ target: { extra: { immunities: ["fire"] } } });
    if (mode === "immediate") {
      dice(10, 2, 6);
      await resolveStrike(s.ctx);
      await s.draft.commit();
    } else {
      const card = await deferred(s);
      dice(2, 6);
      await rollAttackCardDamage(card);
      assert.deepEqual(cardOf(card.message).damageRoll.parts, [
        { type: "piercing", amount: 2 },
        { type: "fire", amount: 6 }
      ]);
      await applyAttackCardDamage(card);
    }
    assert.equal(state(s).hp.value, 28);
  });
  for (const crit of [false, true]) {
    test(`${mode}: per-type resistance then hardness/shields and consequences once, critical=${crit}`, async () => {
      const s = await scenario({ target: { sp: 2, extra: { resistances: { piercing: 1, fire: 2 }, hardness: 1, compromised: 1 } } });
      let damaged = 0;
      Hooks.on(HOOK_EVENTS.damaged, () => damaged++);
      let result;
      if (mode === "immediate") {
        dice(crit ? 20 : 10, 4, 4);
        await resolveStrike(s.ctx);
        result = damageLog(s)[0].data;
        await s.draft.commit();
      } else {
        const card = await deferred(s, crit);
        dice(4, 4);
        await rollAttackCardDamage(card);
        assert.deepEqual(
          cardOf(card.message).damageRoll.parts.map((part) => part.amount),
          crit ? [8, 8] : [4, 4]
        );
        result = (await applyAttackCardDamage(card)).result;
      }
      assert.deepEqual(
        [result.resistanceReduction, result.hardnessReduction, result.shieldDamage, result.hullDamage],
        [3, 1, 2, crit ? 10 : 2]
      );
      assert.equal(state(s).compromised, crit ? 3 : 2);
      assert.equal(damaged, 1);
    });
  }
}

test("installed immediate Strike passes lowercased nonlethal independently of critical", async () => {
  const s = await scenario({ installed: true, traits: ["NONLETHAL"], target: { role: "npc", hp: 3 } });
  dice(20, 4);
  await resolveStrike(s.ctx);
  await s.draft.commit();
  assert.deepEqual([state(s).hp.value, state(s).inoperable, state(s).destroyed], [0, true, false]);
});

test("area fire passes nonlethal on a critical save failure", async () => {
  const s = await scenario({ installed: true, traits: ["Nonlethal"], target: { hp: 3 } });
  s.ctx.options.areaOrigin = 3;
  dice(4, 1);
  await resolveAreaFire(s.ctx, "area-fire");
  await s.draft.commit();
  assert.equal(s.ctx.damageResults[0].rolled, 8);
  assert.deepEqual([state(s).hp.value, state(s).compromised, state(s).inoperable, state(s).destroyed], [0, 0, true, false]);
});

test("same-type NPC components group before resistance and hardness", async () => {
  const s = await scenario({ damage: "1d6 piercing plus 1d6 piercing", target: { extra: { resistances: { piercing: 3 }, hardness: 1 } } });
  dice(10, 4, 4);
  await resolveStrike(s.ctx);
  await s.draft.commit();
  assert.equal(state(s).hp.value, 26);
});

for (const crit of [false, true]) {
  test(`native unavailable: evaluate each mixed component once, typed and secret, critical=${crit}`, async () => {
    const s = await scenario({ target: { extra: { immunities: ["fire"] } } });
    s.ctx.tsc.objects[0].detection.party = "hidden";
    CONFIG.Dice.rolls = [];
    const posted = [];
    globalThis.Roll = class extends MockRoll {
      async toMessage(data, options) {
        posted.push({ formula: this.formula, options });
        return super.toMessage(data);
      }
    };
    dice(crit ? 20 : 10, 4, 4);
    await resolveStrike(s.ctx);
    await s.draft.commit();
    const damage = posted.filter((roll) => !roll.formula.includes("d20"));
    assert.deepEqual(
      damage.map((roll) => roll.formula),
      crit ? ["(1d6)*2", "(1d6)*2"] : ["1d6", "1d6"]
    );
    assert.ok(damage.every((roll) => roll.options.messageMode === "gm" && roll.options.rollMode === "gmroll"));
    assert.equal(state(s).hp.value, crit ? 22 : 26);
    assert.equal(globalThis.__dice.length, 0);
  });
}

test("single plain-roll fallback retains the damage pipeline's existing type normalization", async () => {
  const s = await scenario({ installed: true, target: { extra: { immunities: ["fire"] } } });
  s.ctx.data.weapons[0].damageType = "Fire";
  dice(19, 4);
  await resolveStrike(s.ctx);
  await s.draft.commit();
  assert.equal(state(s).hp.value, 30);
  assert.equal(s.ctx.damageResults[0].immune, true);
  assert.equal(game.messages.filter((message) => message.rolls[0]?.formula === "1d6").length, 1);
});

test("invalid native formula chooses per-part fallback before any evaluation", async () => {
  const s = await scenario({ target: { extra: { immunities: ["fire"] } } });
  CONFIG.Dice.rolls[0].validate = () => false;
  dice(10, 4, 4);
  await resolveStrike(s.ctx);
  await s.draft.commit();
  assert.equal(state(s).hp.value, 26);
  assert.equal(game.messages.filter((message) => message.rolls[0]?.formula === "1d6").length, 2);
});

test("native secret instances post once; failures after posting never retry an aggregate", async () => {
  const s = await scenario();
  s.ctx.tsc.objects[0].detection.party = "hidden";
  nativeInstances({ failAfterMessage: true });
  dice(10, 4, 4);
  await assert.rejects(() => resolveStrike(s.ctx), /posted damage failure/);
  const damage = game.messages.filter((message) => message.rolls[0]?.instances);
  assert.equal(damage.length, 1);
  assert.equal(damage[0].rolls[0].formula, "{(1d6)[piercing],(1d6)[fire]}");
  assert.deepEqual(damage[0].rolls[0].messageOptions, { messageMode: "gm", rollMode: "gmroll" });
  assert.equal(state(s).hp.value, 30);
  assert.equal(damageLog(s).length, 0);
});

test("mixed typed roll without evaluated instances fails closed, without a repeated roll", async () => {
  const s = await scenario();
  CONFIG.Dice.rolls[0].prototype.evaluate = async function () {
    this.total = 8;
    return this;
  };
  dice(10);
  await assert.rejects(() => resolveStrike(s.ctx), new RegExp(game.i18n.localize("SF2eTSC.rolls.invalidDamage")));
  assert.equal(game.messages.size, 2);
  assert.equal(damageLog(s).length, 0);
});

test("legacy mixed total-only card refuses application before reactions/receipts; reroll repairs it", async () => {
  const s = await scenario({ target: { extra: { immunities: ["fire"] } } });
  const card = await deferred(s);
  cardOf(card.message).damageRoll = { total: 8 };
  const writes = globalThis.__writes.length;
  await assert.rejects(() => applyAttackCardDamage(card), new RegExp(game.i18n.localize("SF2eTSC.rolls.invalidDamage")));
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(state(s).appliedStrikeReceipts, undefined);
  assert.equal(cardOf(card.message).damageApplied, undefined);
  dice(4, 4);
  await rollAttackCardDamage(card);
  await applyAttackCardDamage(card);
  assert.equal(state(s).hp.value, 26);
});

test("legacy single-type card still applies its total", async () => {
  const s = await scenario({ damage: "1d6 piercing" });
  const card = await deferred(s);
  cardOf(card.message).damageRoll = { total: 4 };
  await applyAttackCardDamage(card);
  assert.equal(state(s).hp.value, 26);
});

for (const shieldAbsorb of ["half", "full"]) {
  test(`typed reaction ${shieldAbsorb} absorption reduces real components deterministically`, async () => {
    const s = await scenario({ traits: ["bypassing"], target: { sp: 6, extra: { immunities: ["fire"] } } });
    const ask = Reactions.ask;
    Reactions.ask = async () => ({ shieldAbsorb });
    try {
      dice(10, 4, 4);
      await resolveStrike(s.ctx);
      const components = damageLog(s)[0].data.components;
      assert.deepEqual(
        components.map((part) => part.originalDamage),
        shieldAbsorb === "half" ? [1, 4] : [0, 2]
      );
      await s.draft.commit();
      assert.equal(state(s).hp.value, shieldAbsorb === "half" ? 29 : 30);
      assert.equal(state(s).sp.value, 6);
      assert.equal(s.ctx.damageResults[0].rolled, shieldAbsorb === "half" ? 5 : 2);
    } finally {
      Reactions.ask = ask;
    }
  });
}

for (const protocol of [true, false]) {
  test(`immediate real Drone Block ${protocol ? "Protocol manual skips all automatic damage/riders" : "base automatic still applies"}`, async () => {
    const s = await scenario({ damage: "1d6 piercing", target: { sp: 2 } });
    s.crew.system.details = { level: { value: 4 } };
    await s.combat.createEmbeddedDocuments("Combatant", [{ actorId: s.crew.id, initiative: 20 }]);
    await patchStarship(
      s.defender,
      (data) => {
        data.stations = [{ id: "dc", type: "drone-console", helmedBy: s.crew.uuid, grade: "commercial" }];
        data.crew = [{ actorUuid: s.crew.uuid, stationId: "dc", role: "crew" }];
        data.drones = [{ id: "drone", stationId: "dc", ref: "repair-drone", tscVersion: 1, deployed: true }];
        data.upgrades = protocol ? [{ ref: "drone-shield-protocol", stationId: "dc" }] : [];
      },
      { history: false }
    );
    // Refresh the draft entry after fixture setup, before any production resolution.
    s.draft.ships.delete(s.defender.uuid);
    s.ctx.target.data = (await s.draft.ship(s.defender.uuid)).data;
    s.ctx.data.effects.push({
      slug: "rider",
      modifiers: [],
      rider: { kind: "targetStation", targetUuid: s.defender.uuid, stationId: "dc" }
    });
    game.socket.emit = (_event, message) => {
      if (message.kind === "event" && message.type === "reactionPrompt")
        resolveReactionResponse({
          user: game.users.get("p1"),
          payload: { requestId: message.payload.requestId, use: true, droneId: "drone" }
        });
    };
    foundry.applications.api.DialogV2.prompt = async () => (protocol ? "manual" : "automatic");
    dice(10, 6);
    await resolveStrike(s.ctx);
    await s.draft.commit();
    if (protocol) {
      assert.deepEqual([state(s).hp.value, state(s).sp.value], [30, 2]);
      assert.equal(damageLog(s).length, 0);
      assert.equal(s.ctx.damageResults, undefined);
      assert.equal(s.ctx.data.effects.length, 1);
      assert.equal(state(s).stations[0].malfunctioning, false);
      assert.equal(state(s).drones[0].tscProtocolBlocks, 1);
      assert.equal(state(s).drones[0].deployed, true);
      assert.equal(state(s).drones[0].availableAt, undefined);
      assert.ok(s.ctx.reports.includes(game.i18n.format("SF2eTSC.droneBlock.manualResult", { amount: 6, resistance: 2 })));
      assert.ok(s.ctx.reports.includes(game.i18n.format("SF2eTSC.droneBlock.protocolManualResult", { resistance: 2 })));
    } else {
      assert.deepEqual([state(s).hp.value, state(s).sp.value], [28, 0]);
      assert.equal(damageLog(s).length, 1);
      assert.equal(state(s).droneBlockReceipts[0].strikeId, "audit-strike");
      assert.equal(state(s).drones[0].deployed, false);
      assert.equal(state(s).drones[0].availableAt, game.time.worldTime + 600);
    }
  });
}

test("attack effects retain their original types exactly once; off-kilter and custom stacking remain independent", async () => {
  const s = await scenario({ attacker: { effects: [{ slug: "status", modifiers: [{ selector: "attack", type: "status", value: 2 }] }] } });
  let pre = computeAttackModifiers(s.ctx, resolveWeapon(s.ctx), s.ctx.target);
  assert.equal(s.ctx.stats.attackModifier, 2);
  assert.equal(pre.total, 2);
  assert.deepEqual(
    pre.mods.map((mod) => [mod.type, mod.value]),
    [["status", 2]]
  );
  s.ctx.stats.offKilter = true;
  s.ctx.data.customModifiers = [
    { selector: "attack", label: "Status custom", type: "status", value: 3 },
    { selector: "attack", label: "Circumstance bonus", type: "circumstance", value: 1 },
    { selector: "attack", label: "Worse penalty", type: "circumstance", value: -3 },
    { selector: "attack", label: "Untyped", type: "untyped", value: 2 },
    { selector: "damage", label: "Not attack", type: "item", value: 99 }
  ];
  s.ctx.stationRow.tracking = 1;
  pre = computeAttackModifiers(s.ctx, resolveWeapon(s.ctx), s.ctx.target);
  assert.equal(pre.total, 4); // status 3 + circumstance 1 - 3 + untyped 2 + item 1
  assert.equal(pre.mods.filter((mod) => mod.slug === "tsc-status").length, 1);
  assert.equal(pre.mods.find((mod) => mod.slug === "tsc-off-kilter").value, -2);
  assert.deepEqual(
    pre.mods.filter((mod) => mod.slug.startsWith("tsc-custom")).map((mod) => mod.type),
    ["status", "circumstance", "circumstance", "untyped"]
  );
  assert.equal(
    pre.mods.some((mod) => mod.value === 99),
    false
  );
});

test("typed extraction permits total-only single damage but rejects ambiguous/invalid native instances", () => {
  installFoundryMock();
  assert.deepEqual(damagePartsFromRoll({ total: 4 }, "piercing"), [{ type: "piercing", amount: 4 }]);
  for (const roll of [
    { total: 8 },
    { instances: [{ type: "fire", total: NaN }] },
    { instances: [{ type: "fire", total: -1 }] },
    { instances: [{ type: "fire", total: 4, persistent: true }] },
    { instances: [{ type: "fire", total: 4, kinds: new Set(["healing"]) }] }
  ])
    assert.throws(() => damagePartsFromRoll(roll));
});
