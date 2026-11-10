import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeStarshipCombat, MockCombat } from "../helpers/foundry-mock.mjs";
import { getTsc, saveTsc, mutateTsc } from "../../scripts/combat/tsc-state.mjs";
import { moveObject, defaultSensorState } from "../../scripts/engine/sensor-ops.mjs";

test("unchanged map operations do not update combat, and real changes still do", async () => {
  installFoundryMock();
  const combat = makeStarshipCombat({ objects: [{ key: "Actor.ship", zone: 3 }] });
  let updates = 0;
  const update = combat.update.bind(combat);
  combat.update = async (...args) => {
    updates++;
    return update(...args);
  };
  await mutateTsc(combat, (s) => moveObject(s, "Actor.ship", 3));
  assert.equal(updates, 0);
  await mutateTsc(combat, (s) => moveObject(s, "Actor.ship", 4));
  assert.equal(updates, 1);
  assert.equal(getTsc(combat).objects[0].zone, 4);
  await saveTsc(combat, getTsc(combat));
  assert.equal(updates, 1);
});
test("first explicit default-state initialization is not suppressed", async () => {
  installFoundryMock();
  const combat = new MockCombat();
  await saveTsc(combat, defaultSensorState());
  assert.ok(combat.flags["sf2e-tactical-starship-combat"].tsc);
});
