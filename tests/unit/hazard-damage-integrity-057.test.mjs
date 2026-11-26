import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { applyDamageInDraft } from "../../scripts/damage/damage-service.mjs";

function hazardFixture({ hp = 30, resistances = {} } = {}) {
  installFoundryMock();
  const combat = makeStarshipCombat();
  const hazard = new MockActor({
    id: "hazard-integrity",
    name: "Hazard",
    type: "hazard",
    system: {
      details: { isComplex: true },
      attributes: { hp: { value: hp, max: hp }, hasHealth: true, resistances }
    }
  });
  game.actors.set(hazard.id, hazard);
  return { combat, hazard };
}

test("hazard damage preserves existing all-damage resistance", async () => {
  const { combat, hazard } = hazardFixture({ hp: 20, resistances: { "all-damage": 5 } });
  const draft = new Draft(combat);
  const result = await applyDamageInDraft(draft, hazard.uuid, { amount: 10, damageType: "fire", silent: true });
  assert.equal(result.hullDamage, 5);
  assert.equal(draft.hazards.get(hazard.uuid).hpDelta, -5);
  await draft.commit();
  assert.equal(hazard.system.attributes.hp.value, 15);
});

test("repeated hazard damage in one draft accumulates", async () => {
  const { combat, hazard } = hazardFixture({ hp: 30 });
  const draft = new Draft(combat);
  await applyDamageInDraft(draft, hazard.uuid, { amount: 10, damageType: "fire", silent: true });
  await applyDamageInDraft(draft, hazard.uuid, { amount: 7, damageType: "fire", silent: true });
  await draft.commit();
  assert.equal(hazard.system.attributes.hp.value, 13);
});

test("concurrent hazard drafts apply both reductions to current HP", async () => {
  const { combat, hazard } = hazardFixture({ hp: 20 });
  const first = new Draft(combat);
  const second = new Draft(combat);
  await Promise.all([
    applyDamageInDraft(first, hazard.uuid, { amount: 5, damageType: "fire", silent: true }),
    applyDamageInDraft(second, hazard.uuid, { amount: 5, damageType: "fire", silent: true })
  ]);
  await Promise.all([first.commit(), second.commit()]);
  assert.equal(hazard.system.attributes.hp.value, 10);
});
