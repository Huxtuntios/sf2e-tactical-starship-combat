import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { applyDamageInDraft } from "../../scripts/damage/damage-service.mjs";
import { HazardEngine } from "../../scripts/hazards/hazard-engine.mjs";
import { HOOK_EVENTS, MODULE_ID } from "../../scripts/constants.mjs";

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

test("hazard destruction hooks follow committed HP transitions across drafts", async () => {
  const { combat, hazard } = hazardFixture({ hp: 10 });
  const first = new Draft(combat);
  const second = new Draft(combat);
  await applyDamageInDraft(first, hazard.uuid, { amount: 6, damageType: "fire", silent: true });
  await applyDamageInDraft(second, hazard.uuid, { amount: 6, damageType: "fire", silent: true });
  const destroyed = [];
  const listener = (actor) => destroyed.push(actor.uuid);
  Hooks.on(HOOK_EVENTS.destroyed, listener);
  try {
    await first.commit();
    assert.deepEqual(destroyed, []);
    await second.commit();
    assert.equal(hazard.system.attributes.hp.value, 0);
    assert.deepEqual(destroyed, [hazard.uuid]);
  } finally {
    Hooks.off(HOOK_EVENTS.destroyed, listener);
  }
});

test("fulfilled hazard destruction hooks survive a partial commit failure", async () => {
  const { combat, hazard } = hazardFixture({ hp: 5 });
  const failing = new MockActor({
    id: "hazard-failing-write",
    name: "Failing Hazard",
    type: "hazard",
    system: { details: { isComplex: true }, attributes: { hp: { value: 5, max: 5 }, hasHealth: true } }
  });
  game.actors.set(failing.id, failing);
  failing.update = async () => {
    throw new Error("hazard write failed");
  };
  const draft = new Draft(combat);
  await applyDamageInDraft(draft, hazard.uuid, { amount: 10, damageType: "fire", silent: true });
  await applyDamageInDraft(draft, failing.uuid, { amount: 10, damageType: "fire", silent: true });
  const destroyed = [];
  const listener = (actor) => destroyed.push(actor.uuid);
  Hooks.on(HOOK_EVENTS.destroyed, listener);
  try {
    await assert.rejects(draft.commit(), /commitFailed|Commit failed|Saving failed/i);
    assert.equal(hazard.system.attributes.hp.value, 0);
    assert.deepEqual(destroyed, [hazard.uuid]);
  } finally {
    Hooks.off(HOOK_EVENTS.destroyed, listener);
  }
});

test("partial failure dispatches destruction only for fulfilled writes", async () => {
  const { combat, hazard } = hazardFixture({ hp: 5 });
  const ship = makeShip({ id: "rejected-ship", name: "Rejected Ship", role: "npc", hp: 5, sp: 0 });
  ship.update = async () => {
    throw new Error("ship write failed");
  };
  const draft = new Draft(combat);
  await applyDamageInDraft(draft, ship.uuid, { amount: 10, damageType: "fire", silent: true });
  await applyDamageInDraft(draft, hazard.uuid, { amount: 10, damageType: "fire", silent: true });
  const destroyed = [];
  const listener = (actor) => destroyed.push(actor.uuid);
  Hooks.on(HOOK_EVENTS.destroyed, listener);
  try {
    await assert.rejects(draft.commit(), /commitFailed|Commit failed|Saving failed/i);
    assert.equal(ship.system.attributes.hp.value, 5);
    assert.equal(hazard.system.attributes.hp.value, 0);
    assert.deepEqual(destroyed, [hazard.uuid]);
  } finally {
    Hooks.off(HOOK_EVENTS.destroyed, listener);
  }
});

test("hazard enable and disable reject missing Combat state without writing", async () => {
  installFoundryMock();
  game.combat = null;
  game.combats.clear();
  await assert.rejects(HazardEngine.disable("Actor.missing"), /noCombat|No tactical starship combat/i);
  await assert.rejects(HazardEngine.enable("Actor.missing"), /noCombat|No tactical starship combat/i);
  assert.equal(game.combats.size, 0);
});

test("hazard turn routines run only for complex hazards", async () => {
  installFoundryMock();
  await game.settings.set(MODULE_ID, "autoRoutine", "automatic");
  const calls = [];
  const original = HazardEngine.executeRoutine;
  HazardEngine.executeRoutine = async (uuid) => calls.push(uuid);
  const hazard = (id, isComplex) => ({
    uuid: `Actor.${id}`,
    name: id,
    type: "hazard",
    flags: { [MODULE_ID]: { starshipHazard: { isStarshipHazard: true, isComplex } } }
  });
  try {
    await HazardEngine.onHazardTurn({ combat: makeStarshipCombat(), actor: hazard("simple", false), flags: {} });
    await HazardEngine.onHazardTurn({
      combat: makeStarshipCombat(),
      actor: {
        uuid: "Actor.legacy-simple",
        name: "Legacy Simple",
        type: "hazard",
        flags: { [MODULE_ID]: { starshipHazard: { isStarshipHazard: true } } },
        system: { details: { isComplex: false } }
      },
      flags: {}
    });
    await HazardEngine.onHazardTurn({ combat: makeStarshipCombat(), actor: hazard("complex", true), flags: {} });
    assert.deepEqual(calls, ["Actor.complex"]);
  } finally {
    HazardEngine.executeRoutine = original;
  }
});
