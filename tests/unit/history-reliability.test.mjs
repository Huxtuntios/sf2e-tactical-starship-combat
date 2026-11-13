import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { MODULE_ID as M } from "../../scripts/constants.mjs";
import { readStarship, patchStarship, writeStarship } from "../../scripts/starship/starship-state.mjs";
import { changedFields, combatGuard, equalState, historyEntries, reversible, snapshot } from "../../scripts/history/history.mjs";

const state = (actor) => snapshot(readStarship(actor));
const reorder = (value) => {
  if (Array.isArray(value)) return value.map(reorder);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reorder(item)])
  );
};
let actorId = 0;
async function setup({ legacy = false, combat = false } = {}) {
  const env = installFoundryMock();
  const actor = makeShip({ id: `reliable-${++actorId}`, name: "Reliable", hp: 100, sp: 20 });
  const encounter = combat ? makeStarshipCombat() : null;
  const before = state(actor);
  await patchStarship(
    actor,
    (data) => {
      data.heading = "left";
    },
    { history: !legacy }
  );
  const after = state(actor);
  let entry;
  if (legacy) {
    entry = await ChatMessage.create({
      whisper: [game.user.id],
      flags: {
        [M]: {
          history: { schema: 1, shipUuid: actor.uuid, before, after, guard: combatGuard(), undoable: true, undone: false, at: Date.now() }
        }
      }
    });
  } else entry = historyEntries(actor.uuid)[0];
  const doc = legacy ? entry : game.journal.get(env.settings.get("historyStoreId"));
  const record = () => entry.flags[M].history;
  return { ...env, actor, encounter, before, after, entry, doc, record };
}

test("structural equality ignores nested object key order, not array order or missing/null/zero", () => {
  const data = { a: { b: 0, c: null }, list: [{ x: 1, y: 2 }, 3] };
  assert.equal(equalState(data, reorder(data)), true);
  assert.equal(equalState({ list: [1, 2] }, { list: [2, 1] }), false);
  for (const [a, b] of [
    [null, 0],
    [null, undefined],
    [{}, { x: null }],
    [{}, { x: 0 }],
    [{}, { x: undefined }],
    [[], {}],
    [[undefined], [null]]
  ])
    assert.equal(equalState(a, b), false);
  assert.deepEqual(changedFields({}, { heading: undefined }), ["heading"]);
});

test("changedFields and reversible do not treat key order as a hidden side effect", () => {
  const before = { heading: "right", hp: { value: 10, max: 20 }, effects: [{ id: "e", modifiers: [{ selector: "ac", value: 1 }] }] };
  const after = reorder({ ...before, heading: "left" });
  assert.deepEqual(changedFields(before, after), ["heading"]);
  assert.equal(reversible(before, after), true);
  assert.equal(reversible(before, reorder(before)), false);
  const drone = { id: "d", tscVersion: 1, deployed: false, custom: { x: 1, y: 2 } };
  assert.equal(reversible({ drones: [drone] }, { drones: [reorder({ ...drone, deployed: true })] }), true);
  assert.equal(reversible({ drones: [drone] }, { drones: [{ ...drone, deployed: true, availableAt: 100 }] }), false);
  assert.equal(reversible({ drones: [drone] }, { drones: [{ ...drone, deployed: true }, drone] }), false);
  assert.equal(
    reversible(
      { drones: [drone, { ...drone, id: "other" }] },
      {
        drones: [
          { ...drone, deployed: true },
          { ...drone, id: "other", deployed: true }
        ]
      }
    ),
    false
  );
  for (const field of [
    "hp",
    "sp",
    "destroyed",
    "compromised",
    "wrecked",
    "inoperable",
    "crew",
    "stations",
    "ac",
    "criticalDamage",
    "damageReceipts"
  ])
    assert.equal(reversible(before, { ...after, [field]: field === "hp" ? { value: 9, max: 20 } : true }), false, field);
  for (const field of ["effects", "heading", "offKilter"]) assert.equal(reversible({ [field]: null }, { [field]: 0 }), true, field);
});

test("shared writer expected snapshots and Combat guards accept key reordering but reject real changes", async () => {
  const { actor } = await setup();
  const encounter = makeStarshipCombat();
  const expected = reorder(state(actor));
  const guard = reorder(combatGuard());
  await writeStarship(actor, { ...state(actor), offKilter: true }, { history: false, expected, expectedCombat: guard });
  await assert.rejects(writeStarship(actor, expected, { history: false, expected, expectedCombat: guard }), /Undo|undo|changed/i);
  const current = state(actor);
  encounter.flags[M].tsc.budget["Actor.crew"] = { actions: 1 };
  await assert.rejects(writeStarship(actor, current, { history: false, expected: current, expectedCombat: guard }));
});
