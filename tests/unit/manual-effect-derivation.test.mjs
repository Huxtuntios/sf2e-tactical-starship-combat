import test from "node:test";
import assert from "node:assert/strict";
import { makeShip } from "../helpers/foundry-mock.mjs";
import { installNativeEffectsFixture, nativeActor } from "../helpers/native-effects-fixture.mjs";
import * as Effects from "../../scripts/starship/effects.mjs";
const { effectModifiers, hasCondition } = Effects;

test("pending and failed applications never claim successful ship mechanics", () => {
  const fx = ["pending", "failed"].map((status) => ({
    id: status,
    status,
    manual: true,
    kind: "condition",
    slug: "off-guard",
    conditions: ["off-guard"],
    modifiers: [{ selector: "ac", type: "circumstance", value: -2 }]
  }));
  assert.deepEqual(effectModifiers(fx, "ac"), []);
  assert.equal(hasCondition(fx, "off-guard", { selector: "ac" }), false);
});
test("native-derived conditions refresh rules and real station ability context", () => {
  const { definitions } = installNativeEffectsFixture();
  const ship = nativeActor(makeShip({ id: "ship" }));
  const fx = [
    {
      id: "a",
      manual: true,
      kind: "condition",
      slug: "clumsy",
      conditionValue: 3,
      targets: { entire: false, stations: ["pilot"] },
      modifiers: []
    }
  ];
  assert.equal(effectModifiers(fx, "station-check", { actor: ship, stationId: "pilot", skill: "piloting" })[0]?.value, -3);
  assert.deepEqual(effectModifiers(fx, "station-check", { actor: ship, stationId: "pilot", skill: "arcana" }), []);
  definitions.get("clumsy").rules[0].value = -8;
  assert.equal(effectModifiers(fx, "station-check", { actor: ship, stationId: "pilot", skill: "piloting" })[0]?.value, -8);
});
test("effective ship states preserve physical values and scoped manual sources", () => {
  assert.equal(typeof Effects.effectiveEffectStates, "function");
  const data = {
    compromised: 0,
    wrecked: 2,
    inoperable: false,
    offKilter: false,
    destroyed: false,
    stations: [
      { id: "pilot", malfunctioning: false },
      { id: "gun", malfunctioning: true }
    ],
    effects: [
      {
        id: "a",
        manual: true,
        slug: "compromised",
        kind: "condition",
        conditionValue: 4,
        conditions: ["compromised"],
        targets: { entire: true }
      },
      {
        id: "b",
        manual: true,
        slug: "malfunctioning",
        kind: "condition",
        conditions: ["malfunctioning"],
        targets: { entire: false, stations: ["pilot"] }
      },
      { id: "c", manual: true, slug: "off-kilter", conditions: ["off-kilter"], targets: { entire: false, crew: ["Actor.pc"] } }
    ]
  };
  const before = structuredClone(data);
  const overlay = Effects.effectiveEffectStates(data);
  assert.equal(overlay.compromised, 4);
  assert.equal(overlay.inoperable, true);
  assert.equal(overlay.wrecked, 2);
  assert.equal(overlay.offKilter, false);
  assert.equal(overlay.stations[0].malfunctioning, true);
  assert.equal(overlay.stations[1].malfunctioning, true);
  assert.deepEqual(data, before);
  const removed = Effects.effectiveEffectStates({ ...data, effects: [] });
  assert.equal(removed.compromised, 0);
  assert.equal(removed.stations[0].malfunctioning, false);
  assert.equal(removed.stations[1].malfunctioning, true);
});
test("numeric all and native skill/save selectors match checks and DC but not damage", () => {
  installNativeEffectsFixture();
  const fx = [
    {
      id: "a",
      slug: "manual",
      manual: true,
      kind: "bonus",
      modifiers: [
        { selector: "all", type: "status", value: 1 },
        { selector: "saving-throw", type: "item", value: 2 },
        { selector: "skill-check", type: "circumstance", value: 3 }
      ]
    }
  ];
  assert.deepEqual(
    effectModifiers(fx, "reflex").map((m) => m.value),
    [1, 2]
  );
  assert.deepEqual(
    effectModifiers(fx, "station-check", { skill: "piloting" }).map((m) => m.value),
    [1, 3]
  );
  assert.deepEqual(effectModifiers(fx, "station-damage"), []);
});
