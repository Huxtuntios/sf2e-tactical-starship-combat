import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  installFoundryMock,
  loadContentFromDisk,
  makeCharacter,
  makeShip,
  makeStarshipCombat,
  MockRoll,
  dice
} from "../helpers/foundry-mock.mjs";
import { stackModifiers } from "../../scripts/engine/stacking.mjs";
import { sheetAttackBonus, damageFormula } from "../../scripts/actions/strike.mjs";
import { sheetAttackRows } from "../../scripts/rolls/ship-rolls.mjs";
import { executeAction } from "../../scripts/actions/action-engine.mjs";
import { executeNativeAttack } from "../../scripts/chat/native-attack.mjs";
import { onSystemReroll, onRerollMessageCreated, _resetRerollSupport } from "../../scripts/chat/reroll-support.mjs";

const M = "sf2e-tactical-starship-combat";
let event = 0;
class WeaponDocument {
  constructor(source, { parent }) {
    Object.assign(this, source);
    this.actor = parent;
  }
  isOfType(type) {
    return type === "weapon";
  }
  get category() {
    return this.system.category;
  }
  get group() {
    return this.system.group;
  }
  get baseType() {
    return this.system.baseItem;
  }
  getRollOptions() {
    return [
      `item:category:${this.system.category}`,
      `item:group:${this.system.group}`,
      ...this.system.traits.value.map((t) => `item:trait:${t}`)
    ];
  }
}
class Modifier {
  constructor(data) {
    Object.assign(this, { adjustments: [], predicate: [] }, data);
    this.original = data.modifier;
  }
  clone(data = {}) {
    return new Modifier({ ...this, modifier: this.original, ...data });
  }
}
class CheckModifier {
  constructor(_slug, statistic, extras = [], options = new Set()) {
    this.modifiers = [...statistic.modifiers, ...extras].map((m) => m.clone());
    const active = this.modifiers.filter((m) => !m.ignored && m.predicate.every((p) => options.has(p)));
    for (const m of active) for (const adjustment of m.adjustments) m.modifier = adjustment.getNewValue(m.modifier);
    this.totalModifier = stackModifiers(active.map((m) => ({ ...m, value: m.modifier }))).total;
  }
}
function preparedStrike(rank, modifiers = []) {
  return {
    options: [`item:proficiency:rank:${rank}`, "action:strike", "self:action:slug:strike", "ranged"],
    domains: ["attack", "attack-roll", "ranged-attack-roll"],
    modifiers: [
      new Modifier({ slug: "dex", type: "ability", ability: "dex", modifier: 3 }),
      new Modifier({ slug: "proficiency", type: "proficiency", modifier: rank === 0 ? 0 : 7 + rank * 2 }),
      ...modifiers
    ]
  };
}
function nativeCrew(id, ranks = { simple: 1, martial: 1, advanced: 0 }) {
  const crew = makeCharacter({ id, name: id, owners: ["p1"] });
  crew.skills = { acrobatics: {} };
  crew.getRollOptions = () => [];
  crew.getSelfRollOptions = () => [];
  crew.getActiveTokens = () => [];
  crew.rules = [];
  Object.assign(crew.synthetics, {
    modifiers: {},
    modifierAdjustments: {},
    rollNotes: {},
    rollTwice: {},
    rollSubstitutions: {},
    degreeOfSuccessAdjustments: {}
  });
  crew.nativeRanks = ranks;
  crew.prepareStrike = (item) => {
    const rank =
      crew.nativeRanks[item.system.group] ?? crew.nativeRanks[item.system.baseItem] ?? crew.nativeRanks[item.system.category] ?? 0;
    const modifiers = (crew.attackModifiers ?? []).map((m) => new game.pf2e.Modifier(m));
    return preparedStrike(rank, modifiers);
  };
  return crew;
}
async function scenario(system = "sf2e", ranks) {
  installFoundryMock();
  await loadContentFromDisk();
  game.system.id = system;
  game.modules.set("sf2e-anachronism", { active: system === "pf2e", version: "2.5.1" });
  Object.assign(game.pf2e, {
    Modifier,
    CheckModifier,
    Check: {
      roll: async (check, context, _event, callback) => {
        const roll = await new MockRoll(`1d20 + ${check.totalModifier}`).evaluate();
        roll.options = { identifier: context.identifier, type: context.type };
        roll.toJSON = () => ({ formula: roll.formula, total: roll.total, dice: structuredClone(roll.dice), options: { ...roll.options } });
        if (context.createMessage) {
          const message = await roll.toMessage({});
          message.content = `Attack ${check.totalModifier}`;
          if (callback) await callback(roll, "success", message);
        }
        return roll;
      }
    }
  });
  CONFIG.Item = { documentClass: WeaponDocument };
  CONFIG.PF2E = {
    weaponTraits: { agile: "Agile", starship: "Starship", tech: "Tech" },
    weaponGroups: { laser: "Laser", projectile: "Projectile", custom: "Custom" }
  };
  const crew = nativeCrew("gunner", ranks);
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: crew.uuid, weaponId: "w" }],
    weapons: [
      {
        id: "w",
        name: "Custom gun",
        category: "simple",
        group: "projectile",
        range: 4,
        die: "1d6",
        damageType: "fire",
        stationId: "g",
        traits: ["starship"]
      }
    ],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "g" }]
  });
  const target = makeShip({ id: "enemy", name: "Enemy", role: "npc", ac: 18 });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 2, alwaysVisible: true },
      { key: target.uuid, zone: 3, detection: { party: "identified" } }
    ]
  });
  const payload = {
    shipUuid: ship.uuid,
    actionId: "strike",
    crewUuid: crew.uuid,
    stationId: "g",
    combatId: combat.id,
    eventId: `proficiency_${++event}`,
    options: { weaponId: "w", sheetRoll: true, targetKey: target.uuid, mapChoice: "0", skipDialog: true }
  };
  return { crew, ship, target, combat, payload, user: game.users.get("p1") };
}
for (const system of ["sf2e", "pf2e"]) {
  for (const [rank, bonus] of [
    [0, 3],
    [1, 12],
    [2, 14],
    [3, 16],
    [4, 18]
  ]) {
    test(`${system} adapter: native rank ${rank} changes the actual d20 and displayed modifier`, async () => {
      const s = await scenario(system, { simple: rank, martial: 4 });
      const [row] = sheetAttackRows(s.ship);
      assert.equal(row.bonusText, `+${bonus}`);
      dice(10);
      const result = await executeNativeAttack({ user: s.user, payload: s.payload });
      const message = game.messages.get(result.messageId);
      assert.equal(message.rolls[0].total, 10 + bonus);
      assert.equal(message.content, `Attack ${bonus}`);
      assert.equal(message.rolls[0].formula, `1d20 + ${bonus}`);
    });
  }
  test(`${system} adapter: categories, native group/base overrides and custom groups are independent`, async () => {
    const s = await scenario(system, { simple: 1, martial: 2, advanced: 3, laser: 4, "custom-base": 4, custom: 2 });
    for (const [weapon, expected] of [
      [{ category: "simple", group: "projectile" }, 12],
      [{ category: "martial", group: "projectile" }, 14],
      [{ category: "advanced", group: "projectile" }, 16],
      [{ category: "simple", group: "laser" }, 18],
      [{ category: "simple", group: "projectile", baseItem: "custom-base" }, 18],
      [{ category: "simple", group: "custom" }, 14]
    ]) {
      assert.equal(sheetAttackBonus(s.crew, { id: "custom", name: "Custom", die: "1d6", range: 4, ...weapon }), expected);
    }
  });
  test(`${system} adapter: missing category proficiency stays untrained`, async () => {
    const s = await scenario(system, { martial: 4 });
    assert.equal(sheetAttackRows(s.ship)[0].bonusText, "+3");
  });
  test(`${system} adapter: updated proficiency and replaced operator are resolved at execution`, async () => {
    const s = await scenario(system);
    const replacement = nativeCrew("replacement", { simple: 4 });
    s.crew.nativeRanks.simple = 2;
    assert.equal(sheetAttackRows(s.ship)[0].bonusText, "+14");
    await s.ship.update({
      [`flags.${M}.starship.crew`]: [{ actorUuid: replacement.uuid, role: "crew", stationId: "g" }],
      [`flags.${M}.starship.stations`]: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: replacement.uuid, weaponId: "w" }]
    });
    dice(10);
    const result = await executeNativeAttack({ user: s.user, payload: s.payload });
    assert.equal(game.messages.get(result.messageId).rolls[0].total, 28, "stale request must not use the previous gunner");
    assert.equal(sheetAttackRows(s.ship)[0].crewUuid, replacement.uuid);
  });
  test(`${system} adapter: station/item/status/circumstance/MAP stack without changing damage`, async () => {
    const s = await scenario(system, { simple: 2 });
    s.crew.attackModifiers = [
      { slug: "item", type: "item", modifier: 1 },
      { slug: "status", type: "status", modifier: 2 },
      { slug: "circumstance", type: "circumstance", modifier: 1 }
    ];
    await s.ship.update({ [`flags.${M}.starship.customModifiers`]: [{ selector: "attack", type: "item", value: 3, label: "Tracking" }] });
    dice(10);
    const result = await executeNativeAttack({
      user: s.user,
      payload: { ...s.payload, options: { ...s.payload.options, mapChoice: "1" } }
    });
    assert.equal(game.messages.get(result.messageId).rolls[0].total, 25);
    assert.equal(game.messages.get(result.messageId).flags[M].attackCard.boundDamage.formula, "1d6");
    assert.equal(damageFormula({ stationRow: { damageDice: 2 }, data: { effects: [] } }, { die: "1d6" }, true), "(2d6)*2");
  });
}
test("native weapon options reach proficiency predicates without assigning a required rank", async () => {
  const s = await scenario();
  s.crew.prepareStrike = (item) => preparedStrike(item.getRollOptions().includes("item:trait:tech") ? 3 : 0);
  assert.equal(
    sheetAttackBonus(s.crew, {
      name: "Tech gun",
      category: "simple",
      group: "laser",
      traits: ["tech"],
      requiredProficiency: "legendary",
      range: 4
    }),
    16
  );
});
test("complete native Strike options keep conditional attack bonuses enabled", async () => {
  const s = await scenario();
  s.crew.attackModifiers = [{ slug: "strike-bonus", type: "untyped", modifier: 2, predicate: ["self:action:slug:strike"] }];
  dice(10);
  const result = await executeNativeAttack({ user: s.user, payload: s.payload });
  assert.equal(game.messages.get(result.messageId).rolls[0].total, 24);
});
test("identical d20 results preserve the selected attack's receipt through a native reroll", async () => {
  const s = await scenario();
  _resetRerollSupport();
  dice(10, 10);
  await executeNativeAttack({ user: s.user, payload: s.payload });
  const selected = await executeNativeAttack({ user: s.user, payload: { ...s.payload, eventId: `proficiency_${++event}` } });
  const message = game.messages.get(selected.messageId),
    oldRoll = message.rolls[0];
  const newRoll = { toJSON: () => ({ ...oldRoll.toJSON(), total: oldRoll.total + 1 }) };
  onSystemReroll(oldRoll, newRoll);
  const rerolled = await ChatMessage.create({
    rolls: [newRoll],
    flags: { sf2e: { context: { type: "attack-roll", isReroll: true, outcome: "success" } } }
  });
  await onRerollMessageCreated(rerolled);
  assert.equal(rerolled.flags[M].nativeAttackReceipt.eventId, message.flags[M].nativeAttackReceipt.eventId);
});
test("operator origin roll options keep existing conditional bonuses", async () => {
  const s = await scenario();
  s.crew.getSelfRollOptions = () => ["origin:level:7"];
  s.crew.attackModifiers = [{ slug: "origin-bonus", type: "untyped", modifier: 2, predicate: ["origin:level:7"] }];
  assert.equal(sheetAttackBonus(s.crew, s.ship.flags[M].starship.weapons[0]), 14);
});
test("native modifier adjustments are applied once", async () => {
  const s = await scenario();
  s.crew.attackModifiers = [
    { slug: "weapon-potency", type: "item", modifier: 1, adjustments: [{ slug: "weapon-potency", getNewValue: (v) => v + 1 }] }
  ];
  s.crew.synthetics.modifierAdjustments["attack-roll"] = s.crew.attackModifiers[0].adjustments;
  assert.equal(sheetAttackBonus(s.crew, s.ship.flags[M].starship.weapons[0]), 14);
});
test("ship Dexterity remains enabled after native brutal Strength selection", async () => {
  const s = await scenario();
  s.crew.prepareStrike = () => {
    const strike = preparedStrike(1, [new Modifier({ slug: "str", type: "ability", ability: "str", modifier: 5 })]);
    strike.modifiers[0].ignored = true;
    return strike;
  };
  assert.equal(sheetAttackBonus(s.crew, s.ship.flags[M].starship.weapons[0]), 12);
});
test("additional starship domains adjust native proficiency without duplicating native adjustments", async () => {
  const s = await scenario();
  s.crew.synthetics.modifierAdjustments["starship-strike"] = [{ slug: "proficiency", getNewValue: (v) => v + 2 }];
  assert.equal(sheetAttackBonus(s.crew, s.ship.flags[M].starship.weapons[0]), 14);
});
test("weapon-referencing station modifiers receive item context without disabling rules", async () => {
  const s = await scenario();
  const rule = { ignored: false };
  s.crew.rules.push(rule);
  s.crew.synthetics.modifiers["starship-strike"] = [
    (options) => {
      const item = options.resolvables?.weapon;
      if (!item) {
        rule.ignored = true;
        return null;
      }
      return new Modifier({ slug: "weapon-dice", type: "untyped", modifier: item.system.damage.dice });
    }
  ];
  assert.equal(sheetAttackBonus(s.crew, s.ship.flags[M].starship.weapons[0]), 13);
  assert.equal(rule.ignored, false);
});
test("an unoccupied assigned weapon never borrows the request's character", async () => {
  const s = await scenario();
  await s.ship.update({
    [`flags.${M}.starship.stations`]: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: null, weaponId: "w" }]
  });
  const result = await executeAction({
    ...s.payload,
    user: game.users.get("gm"),
    dryRun: true,
    options: { ...s.payload.options, gmOverride: true }
  });
  assert.equal(result.ctx.crew, null);
  assert.equal(sheetAttackRows(s.ship)[0].enabled, false);
});
for (const system of ["sf2e", "pf2e"]) {
  for (const enforcement of ["strict", "warn"]) {
    for (const unavailable of ["unoccupied", "deleted"]) {
      test(`${system} ${enforcement}: ${unavailable} gunner refuses actual attack execution without side effects`, async () => {
        const s = await scenario(system);
        await game.settings.set(M, "ruleEnforcement", enforcement);
        if (unavailable === "unoccupied") {
          await s.ship.update({
            [`flags.${M}.starship.stations`]: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: null, weaponId: "w" }]
          });
        } else {
          game.actors.delete(s.crew.id);
          await s.ship.update({ [`flags.${M}.starship.crew`]: [{ ...s.ship.flags[M].starship.crew[0], userId: s.user.id }] });
        }
        const before = structuredClone({ ship: s.ship.flags[M], target: s.target.flags[M], combat: s.combat.flags[M] });
        dice(20);
        await assert.rejects(
          () => executeNativeAttack({ user: s.user, payload: { ...s.payload, options: { ...s.payload.options, gmOverride: true } } }),
          /must be helming|нужно занимать станцию/i
        );
        assert.equal(game.messages.size, 0);
        assert.deepEqual({ ship: s.ship.flags[M], target: s.target.flags[M], combat: s.combat.flags[M] }, before);
      });
    }
  }
  test(`${system}: explicit GM override retains unoccupied station attack execution`, async () => {
    const s = await scenario(system);
    await s.ship.update({
      [`flags.${M}.starship.stations`]: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: null, weaponId: "w" }]
    });
    dice(20);
    const result = await executeNativeAttack({
      user: game.users.get("gm"),
      payload: { ...s.payload, options: { ...s.payload.options, gmOverride: true } }
    });
    assert.ok(game.messages.get(result.messageId).flags[M].nativeAttackReceipt);
  });
}
test("GM without explicit override cannot fire an unoccupied player weapon", async () => {
  const s = await scenario();
  await s.ship.update({
    [`flags.${M}.starship.stations`]: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: null, weaponId: "w" }]
  });
  dice(20);
  await assert.rejects(
    () => executeNativeAttack({ user: game.users.get("gm"), payload: s.payload }),
    /must be helming|нужно занимать станцию/i
  );
  assert.equal(game.messages.size, 0);
});
test("NPC statblock attacks never use crew weapon proficiency", async () => {
  const s = await scenario();
  await s.ship.update({
    [`flags.${M}.starship.role`]: "npc",
    [`flags.${M}.starship.strikes`]: [{ name: "NPC laser", attack: 9, kind: "ranged", damage: "1d6 fire", traits: ["range 4 zones"] }]
  });
  const row = sheetAttackRows(s.ship).find((r) => r.kind === "strike");
  assert.equal(row.bonusText, "+9");
  dice(10);
  const result = await executeNativeAttack({
    user: game.users.get("gm"),
    payload: { ...s.payload, actionId: row.actionId, options: { ...s.payload.options, gmOverride: true } }
  });
  assert.equal(game.messages.get(result.messageId).rolls[0].total, 19);
});
test("a weapon configuration change updates the next attack without editing the operator", async () => {
  const s = await scenario("sf2e", { simple: 1, martial: 3 });
  await s.ship.update({ [`flags.${M}.starship.weapons`]: [{ ...s.ship.flags[M].starship.weapons[0], category: "martial" }] });
  dice(10);
  const result = await executeNativeAttack({ user: s.user, payload: s.payload });
  assert.equal(game.messages.get(result.messageId).rolls[0].total, 26);
});
test("the weapon's station wins over a different requested station and character", async () => {
  const s = await scenario();
  const other = nativeCrew("other-gunner", { simple: 4 });
  await s.ship.update({
    [`flags.${M}.starship.crew`]: [...s.ship.flags[M].starship.crew, { actorUuid: other.uuid, role: "crew", stationId: "custom-g" }],
    [`flags.${M}.starship.stations`]: [
      ...s.ship.flags[M].starship.stations,
      { id: "custom-g", type: "gunnery", grade: "commercial", helmedBy: other.uuid }
    ]
  });
  dice(10);
  const result = await executeNativeAttack({ user: s.user, payload: { ...s.payload, crewUuid: other.uuid, stationId: "custom-g" } });
  assert.equal(game.messages.get(result.messageId).rolls[0].total, 22);
});
test("failed native proficiency resolution refuses the attack rather than rolling a guessed rank", async () => {
  const s = await scenario();
  s.crew.prepareStrike = () => ({ options: [], domains: [], modifiers: [] });
  await assert.rejects(() => executeNativeAttack({ user: s.user, payload: s.payload }), /system attack roll|бросок атаки/i);
  assert.equal(game.messages.size, 0);
});
for (const system of ["sf2e", "pf2e"]) {
  test(
    `${system} installed native helper: category, group, equivalent base and predicate proficiency`,
    { skip: !process.env.TSC_SYSTEMS_PATH },
    async () => {
      const s = await scenario(system);
      const source = fs.readFileSync(path.join(process.env.TSC_SYSTEMS_PATH, system, `${system}.mjs`), "utf8");
      const start = source.indexOf("function getItemProficiencyRank(");
      const end = source.indexOf("function createForceOpenPenalty(", start);
      if (start < 0 || end < 0) throw new Error("Installed system proficiency helper contract changed");
      CONFIG.PF2E.equivalentWeapons = { "equivalent-gun": "base-gun" };
      const resolveRank = vm.runInNewContext(`${source.slice(start, end)}; getItemProficiencyRank`, { CONFIG });
      s.crew.system.proficiencies = {
        attacks: {
          simple: { rank: 1 },
          martial: { rank: 2 },
          advanced: { rank: 0 },
          "weapon-group-laser": { rank: 3 },
          "weapon-base-base-gun": { rank: 4 },
          "special-ranged": { rank: 3, definition: { test: (options) => options.has("item:trait:tech") } }
        }
      };
      s.crew.prepareStrike = (item) => preparedStrike(resolveRank(s.crew, item));
      for (const [weapon, expected] of [
        [{ category: "simple", group: "projectile" }, 12],
        [{ category: "martial", group: "projectile" }, 14],
        [{ category: "advanced", group: "projectile" }, 3],
        [{ category: "simple", group: "laser" }, 16],
        [{ category: "simple", group: "projectile", baseItem: "equivalent-gun" }, 18],
        [{ category: "simple", group: "projectile", traits: ["tech"] }, 16]
      ])
        assert.equal(sheetAttackBonus(s.crew, { name: "Ship gun", range: 4, ...weapon }), expected);
    }
  );
}
