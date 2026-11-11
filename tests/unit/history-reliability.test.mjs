import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { MODULE_ID as M } from "../../scripts/constants.mjs";
import { readStarship, patchStarship, writeStarship } from "../../scripts/starship/starship-state.mjs";
import {
  changedFields,
  combatGuard,
  equalState,
  historyEntries,
  recordChange,
  reversible,
  snapshot,
  undoChange
} from "../../scripts/history/history.mjs";

const state = (actor) => snapshot(readStarship(actor));
const records = (doc) => doc.flags[M].historyStore.records;
const receipt = (actor) => actor.flags[M].historyUndoReceipt;
const reorder = (value) => {
  if (Array.isArray(value)) return value.map(reorder);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reorder(item)])
  );
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function failOnce(doc, matches = () => true, { committed = false } = {}) {
  const update = doc.update.bind(doc);
  let armed = true;
  doc.update = async (changes, ...args) => {
    if (!armed || !matches(changes)) return update(changes, ...args);
    armed = false;
    if (committed) await update(changes, ...args);
    throw new Error("injected write failure");
  };
}
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
const finalizing = (changes) =>
  Object.values(changes).some((value) => value === true || (Array.isArray(value) && value.some((r) => r.undone)));
const actorWrites = (actor) => globalThis.__writes.filter((write) => write.doc === actor.uuid).length;

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

for (const legacy of [false, true]) {
  const label = legacy ? "legacy whisper" : "journal";
  test(`${label}: intent write failure leaves Actor untouched and retry succeeds`, async () => {
    const { actor, entry, doc, after, record } = await setup({ legacy });
    const writes = actorWrites(actor);
    failOnce(doc);
    await assert.rejects(undoChange(entry.id), /injected/);
    assert.deepEqual(state(actor), after);
    assert.equal(actorWrites(actor), writes);
    assert.equal(record().undoIntent, undefined);
    await undoChange(entry.id);
    assert.equal(record().undone, true);
    assert.equal(readStarship(actor).heading, "right");
  });
  test(`${label}: lost intent acknowledgment is recoverable without restoring early`, async () => {
    const { actor, entry, doc, after, record } = await setup({ legacy });
    failOnce(doc, () => true, { committed: true });
    await assert.rejects(undoChange(entry.id), /injected/);
    assert.deepEqual(state(actor), after);
    assert.ok(record().undoIntent);
    const intent = structuredClone(record().undoIntent);
    await undoChange(entry.id);
    assert.deepEqual(record().undoIntent, intent);
    assert.equal(record().undone, true);
  });
  test(`${label}: Actor restore failure retains intent but not a receipt`, async () => {
    const { actor, entry, after, record } = await setup({ legacy });
    failOnce(actor);
    await assert.rejects(undoChange(entry.id), /injected/);
    assert.deepEqual(state(actor), after);
    assert.ok(record().undoIntent);
    assert.equal(receipt(actor), undefined);
    assert.equal(record().undone, false);
    await undoChange(entry.id);
    assert.equal(record().undone, true);
  });
  test(`${label}: Actor persisted then threw; retry finalizes without another Actor write`, async () => {
    const { actor, entry, before, record } = await setup({ legacy });
    failOnce(actor, () => true, { committed: true });
    await assert.rejects(undoChange(entry.id), /injected/);
    assert.deepEqual(state(actor), before);
    assert.deepEqual(receipt(actor), record().undoIntent);
    assert.equal(record().undone, false);
    const writes = actorWrites(actor);
    await undoChange(entry.id);
    assert.equal(actorWrites(actor), writes);
    assert.equal(record().undone, true);
  });
  test(`${label}: failed finalization retries with matching durable receipt, even after module reload`, async () => {
    const { actor, entry, doc, before, record } = await setup({ legacy });
    actor.system.details = { biography: "untouched" };
    failOnce(doc, finalizing);
    await assert.rejects(undoChange(entry.id), /injected/);
    assert.deepEqual(state(actor), before);
    assert.deepEqual(receipt(actor), record().undoIntent);
    const writes = actorWrites(actor);
    const reloaded = await import(`../../scripts/history/history.mjs?reliability=${legacy}`);
    await reloaded.undoChange(entry.id);
    assert.equal(actorWrites(actor), writes);
    assert.equal(actor.system.details.biography, "untouched");
    assert.equal(record().undone, true);
    assert.equal(record().undoable, false);
    await assert.rejects(undoChange(entry.id)); // Existing completed-Undo contract.
  });
  test(`${label}: persisted finalization with lost acknowledgment is recognized idempotently`, async () => {
    const { actor, entry, doc, record } = await setup({ legacy });
    failOnce(doc, finalizing, { committed: true });
    assert.equal(await undoChange(entry.id), true);
    assert.equal(record().undone, true);
    assert.equal(actorWrites(actor), 2);
  });
}

for (const change of ["heading-ABA", "hp", "round", "turn", "budget", "receipt-key", "receipt-token", "missing-receipt"]) {
  test(`pending recovery rejects changed ${change} without another restore/finalization`, async () => {
    const { actor, entry, doc, encounter, record } = await setup({ combat: true });
    failOnce(doc, finalizing);
    await assert.rejects(undoChange(entry.id), /injected/);
    if (change === "heading-ABA")
      await patchStarship(
        actor,
        (data) => {
          data.heading = "left";
        },
        { history: false }
      );
    if (change === "hp") await actor.update({ "system.attributes.hp.value": 99 });
    if (change === "round") encounter.round++;
    if (change === "turn") encounter.turn++;
    if (change === "budget") encounter.flags[M].tsc.budget.crew = { actions: 0 };
    if (change === "receipt-key") receipt(actor).key = "j:untrusted:other";
    if (change === "receipt-token") receipt(actor).id = "mismatching-token";
    if (change === "missing-receipt") delete actor.flags[M].historyUndoReceipt;
    const writes = actorWrites(actor);
    await assert.rejects(undoChange(entry.id));
    assert.equal(actorWrites(actor), writes);
    assert.equal(record().undone, false);
  });
}

test("actor-before alone is never recovery proof, including intent whose Actor write failed", async () => {
  const { actor, entry, before, record } = await setup();
  failOnce(actor);
  await assert.rejects(undoChange(entry.id), /injected/);
  await writeStarship(actor, before, { history: false });
  const writes = actorWrites(actor);
  await assert.rejects(undoChange(entry.id));
  assert.equal(actorWrites(actor), writes);
  assert.equal(record().undone, false);
});

test("same-record concurrent Undo calls share one restoration and finalization", async () => {
  const { actor, entry, record } = await setup();
  const results = await Promise.all(Array.from({ length: 5 }, () => undoChange(entry.id)));
  assert.deepEqual(results, [true, true, true, true, true]);
  assert.equal(actorWrites(actor), 2);
  assert.equal(record().undone, true);
});

test("Undo never holds the history queue while awaiting an Actor write that records history", { timeout: 3000 }, async () => {
  const { actor, entry, doc, record } = await setup();
  const blocked = deferred(),
    release = deferred(),
    intentSaved = deferred();
  const updateActor = actor.update.bind(actor);
  actor.update = async (changes) => {
    blocked.resolve();
    await release.promise;
    return updateActor(changes);
  };
  const updateJournal = doc.update.bind(doc);
  doc.update = async (changes) => {
    const result = await updateJournal(changes);
    if (record().undoIntent) intentSaved.resolve();
    return result;
  };
  const writing = patchStarship(actor, (data) => {
    data.offKilter = true;
  });
  await blocked.promise;
  const undoing = undoChange(entry.id);
  const rejected = assert.rejects(undoing);
  await intentSaved.promise;
  release.resolve();
  await Promise.all([writing, rejected]);
  assert.equal(record().undone, false);
  assert.equal(historyEntries().length, 2);
});

test("one bounded Actor receipt cannot overwrite another record's unfinished recovery proof", async () => {
  const { actor, entry, doc, record } = await setup();
  failOnce(doc, finalizing);
  await assert.rejects(undoChange(entry.id), /injected/);
  const proof = structuredClone(receipt(actor));
  await patchStarship(actor, (data) => {
    data.offKilter = true;
  });
  const next = historyEntries()[0];
  await assert.rejects(undoChange(next.id));
  assert.deepEqual(receipt(actor), proof);
  assert.equal(record().undone, false);
  assert.equal(next.flags[M].history.undone, false);
});

test("a finalized receipt can be replaced by the next Undo without growing Actor evidence", async () => {
  const { actor, entry } = await setup();
  await undoChange(entry.id);
  const first = structuredClone(receipt(actor));
  await patchStarship(actor, (data) => {
    data.offKilter = true;
  });
  const next = historyEntries()[0];
  await undoChange(next.id);
  assert.notDeepEqual(receipt(actor), first);
  assert.deepEqual(receipt(actor), next.flags[M].history.undoIntent);
  assert.equal(readStarship(actor).offKilter, false);
});

test("80-record bound rejects append rather than pruning pending intent; completed intent may prune", async () => {
  const { actor, entry, doc, before, after, record } = await setup();
  failOnce(actor);
  await assert.rejects(undoChange(entry.id), /injected/);
  for (let i = 1; i < 80; i++) await recordChange(actor, before, after, { announce: false });
  assert.equal(records(doc).length, 80);
  const intent = structuredClone(record().undoIntent);
  await assert.rejects(recordChange(actor, before, after, { announce: false }));
  assert.equal(records(doc).length, 80);
  assert.deepEqual(record().undoIntent, intent);
  await undoChange(entry.id);
  await recordChange(actor, before, after, { announce: false });
  assert.equal(records(doc).length, 80);
  assert.equal(
    records(doc).some((r) => `j:${r.id}` === entry.id),
    false
  );
});

test("new appends cannot evict a paused Undo intent between intent persistence and Actor restore", { timeout: 3000 }, async () => {
  const { actor, entry, doc, before, after, record } = await setup();
  for (let i = 1; i < 80; i++) await recordChange(actor, before, after, { announce: false });
  const paused = deferred(),
    release = deferred();
  const update = actor.update.bind(actor);
  actor.update = async (changes) => {
    paused.resolve();
    await release.promise;
    return update(changes);
  };
  const undoing = undoChange(entry.id);
  await paused.promise;
  assert.ok(record().undoIntent);
  await assert.rejects(recordChange(actor, before, after, { announce: false }));
  assert.equal(records(doc).length, 80);
  release.resolve();
  await undoing;
  assert.equal(record().undone, true);
});

test("pending recovery still enforces GM-only journal ownership and legacy author/whisper trust", async () => {
  for (const legacy of [false, true]) {
    const { actor, entry, doc, setUser, record } = await setup({ legacy });
    failOnce(doc, finalizing);
    await assert.rejects(undoChange(entry.id), /injected/);
    const writes = actorWrites(actor);
    setUser("p1");
    assert.deepEqual(historyEntries(), []);
    await assert.rejects(undoChange(entry.id));
    setUser("gm");
    if (legacy) doc.author = "p1";
    else doc.ownership.p1 = 2;
    assert.deepEqual(historyEntries(), []);
    await assert.rejects(undoChange(entry.id));
    assert.equal(actorWrites(actor), writes);
    assert.equal(record().undone, false);
    if (legacy) {
      doc.author = "gm";
      doc.whisper = ["gm", "p1"];
      await assert.rejects(undoChange(entry.id));
    }
  }
});

test("receipt from a completed, subsequently pruned journal record can safely be replaced", async () => {
  const { actor, entry, before, after } = await setup();
  await undoChange(entry.id);
  for (let i = 0; i < 80; i++) await recordChange(actor, before, after, { announce: false });
  assert.equal(
    historyEntries().some((item) => item.id === entry.id),
    false
  );
  await patchStarship(actor, (data) => {
    data.offKilter = true;
  });
  const next = historyEntries()[0];
  await undoChange(next.id);
  assert.deepEqual(receipt(actor), next.flags[M].history.undoIntent);
});

test("different-record Undos do not block behind another Actor's queued restore", { timeout: 3000 }, async (t) => {
  const { actor, entry } = await setup();
  const other = makeShip({ id: "independent", name: "Independent" });
  await patchStarship(other, (data) => {
    data.offKilter = true;
  });
  const next = historyEntries(other.uuid)[0];
  const paused = deferred(),
    release = deferred();
  t.after(() => release.resolve());
  const update = actor.update.bind(actor);
  actor.update = async (changes) => {
    paused.resolve();
    await release.promise;
    return update(changes);
  };
  const first = undoChange(entry.id);
  await paused.promise;
  await undoChange(next.id);
  assert.equal(readStarship(other).offKilter, false);
  release.resolve();
  await first;
});

test("Combat is rechecked after intent persistence, inside the authoritative Actor queue", async () => {
  const { actor, entry, doc, encounter, record, after } = await setup({ combat: true });
  const update = doc.update.bind(doc);
  doc.update = async (changes) => {
    const result = await update(changes);
    if (record().undoIntent) encounter.turn++;
    return result;
  };
  const writes = actorWrites(actor);
  await assert.rejects(undoChange(entry.id));
  assert.deepEqual(state(actor), after);
  assert.equal(actorWrites(actor), writes);
  assert.ok(record().undoIntent);
  assert.equal(receipt(actor), undefined);
});

test("record edits or relaxed Journal ownership after intent persistence fail closed before restore", async () => {
  for (const edit of ["record", "ownership", "store"]) {
    const { actor, entry, doc, record, settings, after } = await setup();
    const update = doc.update.bind(doc);
    doc.update = async (changes) => {
      const result = await update(changes);
      if (record().undoIntent) {
        if (edit === "record") record().after.heading = "right";
        if (edit === "ownership") doc.ownership.default = 1;
        if (edit === "store") settings.set("historyStoreId", null);
      }
      return result;
    };
    const writes = actorWrites(actor);
    await assert.rejects(undoChange(entry.id));
    assert.deepEqual(state(actor), after);
    assert.equal(actorWrites(actor), writes);
    assert.equal(receipt(actor), undefined);
  }
});

test("finalization validates restored state again after waiting for the history queue", { timeout: 3000 }, async (t) => {
  const { actor, entry, doc, record, before, after } = await setup();
  const paused = deferred(),
    release = deferred(),
    restored = deferred();
  t.after(() => release.resolve());
  const updateJournal = doc.update.bind(doc);
  const updateActor = actor.update.bind(actor);
  doc.update = async (changes) => {
    if (Object.values(changes).some((value) => Array.isArray(value) && value.length === 2)) {
      paused.resolve();
      await release.promise;
    }
    return updateJournal(changes);
  };
  actor.update = async (changes) => {
    const result = await updateActor(changes);
    if (changes[`flags.${M}.historyUndoReceipt`]) restored.resolve();
    return result;
  };
  // Persist an intent by failing its first Actor write, then enqueue an append ahead of retry finalization.
  const realUpdate = actor.update;
  failOnce(actor);
  await assert.rejects(undoChange(entry.id));
  actor.update = realUpdate;
  const appending = recordChange(actor, before, after, { announce: false });
  await paused.promise;
  const undoing = undoChange(entry.id);
  const rejected = assert.rejects(undoing);
  await restored.promise;
  await actor.update({ "system.attributes.hp.value": 99 });
  release.resolve();
  await Promise.all([appending, rejected]);
  assert.equal(record().undone, false);
  assert.deepEqual(receipt(actor), record().undoIntent);
});

test("restore and receipt share exactly one narrow Actor update with no recovery data in starship snapshots", async () => {
  const { actor, entry, before } = await setup();
  await undoChange(entry.id);
  const write = globalThis.__writes.filter((item) => item.doc === actor.uuid).at(-1).changes;
  assert.ok(write[`flags.${M}.starship`]);
  assert.deepEqual(write[`flags.${M}.historyUndoReceipt`], entry.flags[M].history.undoIntent);
  assert.equal(write["system.attributes.hp.value"], before.hp.value);
  assert.equal(
    Object.keys(write).some((key) => key === "flags" || key === "system"),
    false
  );
  assert.equal(Object.hasOwn(state(actor), "historyUndoReceipt"), false);
  assert.equal(historyEntries().length, 1);
});

test("forged legacy intent/receipt and absent journal IDs never authorize Undo", async () => {
  const { actor, entry, setUser, before, after } = await setup();
  setUser("p1");
  const forged = await ChatMessage.create({
    whisper: ["gm"],
    flags: {
      [M]: {
        history: {
          schema: 1,
          shipUuid: actor.uuid,
          before,
          after,
          guard: null,
          undoable: true,
          undoIntent: { schema: 1, id: "forged", key: entry.id, shipUuid: actor.uuid }
        }
      }
    }
  });
  actor.flags[M].historyUndoReceipt = forged.flags[M].history.undoIntent;
  setUser("gm");
  const writes = actorWrites(actor);
  await assert.rejects(undoChange(forged.id));
  await assert.rejects(undoChange("j:missing"));
  assert.equal(actorWrites(actor), writes);
});
