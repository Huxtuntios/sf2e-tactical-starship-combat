import test from "node:test";
import assert from "node:assert/strict";
import { makeCharacter, makeShip } from "../helpers/foundry-mock.mjs";
import { installNativeEffectsFixture, nativeActor } from "../helpers/native-effects-fixture.mjs";
import { createNativeEffect } from "../../scripts/starship/native-effect-adapter.mjs";
import { effectModifiers } from "../../scripts/starship/effects.mjs";

test("one numerical application uses the same native and ship element identity, while independent applications stack", async () => {
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }));
  const ship = nativeActor(makeShip({ id: "ship" }));
  const record = {
    id: "application",
    manual: true,
    kind: "bonus",
    slug: "bonus",
    label: "Bonus",
    targets: { entire: true, allCrew: true },
    modifiers: [{ selector: "attack", value: 2, type: "untyped" }]
  };
  const item = await createNativeEffect(actor, record);
  const shipMods = effectModifiers([record], "attack", { actor: ship, weaponId: "laser" });
  assert.equal(shipMods[0].slug, item.system.rules[0].slug);
  const union = new Map([
    [item.system.rules[0].slug, item.system.rules[0].value],
    ...shipMods.map((modifier) => [modifier.slug, modifier.value])
  ]);
  assert.equal(
    [...union.values()].reduce((sum, value) => sum + value, 0),
    2
  );
  const second = { ...record, id: "independent" };
  for (const modifier of effectModifiers([record, second], "attack", { actor: ship, weaponId: "laser" }))
    union.set(modifier.slug, modifier.value);
  assert.equal(
    [...union.values()].reduce((sum, value) => sum + value, 0),
    4
  );
});
test("native condition FlatModifier elements share identity with the derived ship modifier", async () => {
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }));
  const ship = nativeActor(makeShip({ id: "ship" }));
  const record = {
    id: "application",
    manual: true,
    kind: "condition",
    slug: "frightened",
    label: "Frightened",
    conditionValue: 2,
    targets: { entire: true, allCrew: true }
  };
  const item = await createNativeEffect(actor, record);
  const mods = effectModifiers([record], "reflex", { actor: ship });
  assert.equal(mods[0].slug, item.system.rules[0].slug);
  assert.equal(mods[0].value, -2);
});
