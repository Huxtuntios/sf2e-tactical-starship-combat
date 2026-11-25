import test from "node:test";
import assert from "node:assert/strict";
import {
  DamageRoll as MockDamageRoll,
  dice,
  installFoundryMock,
  loadContentFromDisk,
  makeShip,
  makeStarshipCombat
} from "../helpers/foundry-mock.mjs";
import { executeAction } from "../../scripts/actions/action-engine.mjs";
import { Content } from "../../scripts/content/loader.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";

class DamageRoll extends MockDamageRoll {
  constructor(formula) {
    super(formula);
    const match = /\((\d+)d(\d+)(?:\s*\+\s*(\d+))?\)\[persistent,([a-z-]+)\]/.exec(formula);
    const count = Number(match?.[1] ?? 0);
    const faces = Number(match?.[2] ?? 0);
    const bonus = Number(match?.[3] ?? 0);
    this.expectedValue = (count * (faces + 1)) / 2 + bonus;
  }
}

test("strike stages persistent parts once in the same draft", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  CONFIG.Dice = { rolls: [DamageRoll] };
  CONFIG.PF2E = { damageTypes: { fire: "Fire" } };
  game.pf2e.ConditionManager = { getCondition: (slug) => ({ slug }) };

  const target = makeShip({ id: "target", name: "Target", sp: 3, hp: 30 });
  const attacker = makeShip({ id: "attacker", name: "Attacker", role: "npc" });
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
      { key: target.uuid, zone: 2, alwaysVisible: true }
    ]
  });

  const run = () =>
    executeAction({
      user: game.user,
      shipUuid: attacker.uuid,
      actionId: "test-persistent-strike",
      strikeId: "stable-burn",
      options: { targetUUIDs: [target.uuid], skipDialog: true, skipReactions: true, gmOverride: true }
    });

  dice(15);
  const result = await run();
  assert.equal(result.degree, 2);
  const effects = readStarship(target).effects.filter((effect) => effect.kind === "persistent-damage");
  assert.equal(effects.length, 1);
  assert.equal(effects[0].persistent.formula, "1d6");
  assert.equal(effects[0].persistent.damageType, "fire");
  assert.equal(effects[0].operationId, "stable-burn");
  assert.equal(readStarship(target).sp.value, 3);

  dice(15);
  await run();
  assert.equal(readStarship(target).effects.filter((effect) => effect.kind === "persistent-damage").length, 1);
  assert.equal(readStarship(target).sp.value, 3);
});
