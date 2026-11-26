import test from "node:test";
import assert from "node:assert/strict";
import { nativeConditionModifiers } from "../../scripts/starship/native-condition-adapter.mjs";

function actorWith(domains) {
  return {
    synthetics: { modifiers: domains },
    items: new Map([["condition", { id: "condition", uuid: "Item.condition", type: "condition", active: true, slug: "frightened" }]]),
    getRollOptions: () => []
  };
}

const modifier = { modifier: -2, source: "Item.condition", type: "status", label: "Frightened", slug: "frightened" };

test("broad all modifiers do not affect excluded starship statistics", () => {
  const actor = actorWith({ all: [() => modifier] });
  for (const selector of ["speed", "sensor-range", "station-damage", "damage"])
    assert.deepEqual(nativeConditionModifiers(actor, selector), [], selector);
  assert.equal(nativeConditionModifiers(actor, "ac").length, 1);
});

test("all-speeds still affects speed without the broad all domain", () => {
  const actor = actorWith({ "all-speeds": [() => modifier] });
  assert.equal(nativeConditionModifiers(actor, "speed").length, 1);
});
