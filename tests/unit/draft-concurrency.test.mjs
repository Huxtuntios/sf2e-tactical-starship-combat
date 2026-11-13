import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { Draft, rebaseTsc } from "../../scripts/actions/draft.mjs";
import { readStarship, patchStarship } from "../../scripts/starship/starship-state.mjs";
import { getTsc, saveTsc, mutateTsc } from "../../scripts/combat/tsc-state.mjs";

function setup() {
  installFoundryMock();
  const actor = makeShip({ id: "draft-ship", hp: 100, sp: 20 });
  const combat = makeStarshipCombat({
    objects: [
      { key: actor.uuid, zone: 1 },
      { key: "marker", zone: 3 }
    ]
  });
  return { actor, combat };
}

function blockUpdate(doc) {
  const update = doc.update.bind(doc);
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  let blocked = false;
  doc.update = async (...args) => {
    if (!blocked) {
      blocked = true;
      started();
      await gate;
    }
    return update(...args);
  };
  return { release, entered };
}

test("stale ship draft refuses to overwrite a saved unrelated edit", async () => {
  const { actor } = setup();
  const draft = new Draft(null);
  (await draft.ship(actor.uuid)).data.sp.value = 10;
  await patchStarship(actor, (data) => {
    data.notes = "saved notes";
  });
  await assert.rejects(draft.commit());
  assert.equal(readStarship(actor).notes, "saved notes");
  assert.equal(readStarship(actor).sp.value, 20);
});

test("stale map draft rebases a disjoint concurrent movement and still saves ship changes", async () => {
  const { actor, combat } = setup();
  const draft = new Draft(combat);
  (await draft.ship(actor.uuid)).data.sp.value = 10;
  draft.tsc.objects[0].zone = 2;
  await mutateTsc(combat, (state) => {
    state.objects[1].zone = 4;
    return state;
  });
  await draft.commit();
  assert.equal(readStarship(actor).sp.value, 10);
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.zone),
    [2, 4]
  );
});

test("concurrent edit of the same map object refuses commit before ship writes", async () => {
  const { actor, combat } = setup();
  const draft = new Draft(combat);
  (await draft.ship(actor.uuid)).data.sp.value = 10;
  draft.tsc.objects[0].zone = 2;
  let callbacks = 0;
  draft.afterCommit(() => {
    callbacks++;
  });
  await mutateTsc(combat, (state) => {
    state.objects[0].zone = 9;
    return state;
  });
  await assert.rejects(draft.commit());
  assert.equal(readStarship(actor).sp.value, 20);
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.zone),
    [9, 3]
  );
  assert.equal(callbacks, 0);
});

test("unchanged draft map does not overwrite a newer movement", async () => {
  const { actor, combat } = setup();
  const draft = new Draft(combat);
  (await draft.ship(actor.uuid)).data.sp.value = 10;
  await mutateTsc(combat, (state) => {
    state.objects[1].zone = 4;
    return state;
  });
  await draft.commit();
  assert.equal(readStarship(actor).sp.value, 10);
  assert.equal(getTsc(combat).objects[1].zone, 4);
});

test("queued ship write rechecks draft snapshot after preflight", async () => {
  const { actor } = setup();
  const draft = new Draft(null);
  (await draft.ship(actor.uuid)).data.sp.value = 10;
  const gate = blockUpdate(actor);
  const earlier = patchStarship(actor, (data) => {
    data.notes = "queued notes";
  });
  await gate.entered;
  const commit = draft.commit();
  const rejected = assert.rejects(commit);
  gate.release();
  await earlier;
  await rejected;
  assert.equal(readStarship(actor).notes, "queued notes");
  assert.equal(readStarship(actor).sp.value, 20);
});

test("queued map write merges a disjoint concurrent movement and runs success callbacks", async () => {
  const { combat } = setup();
  const draft = new Draft(combat);
  draft.tsc.objects[0].zone = 2;
  let callbacks = 0;
  draft.afterCommit(() => {
    callbacks++;
  });
  const gate = blockUpdate(combat);
  const earlier = mutateTsc(combat, (state) => {
    state.objects[1].zone = 4;
    return state;
  });
  await gate.entered;
  const commit = draft.commit();
  gate.release();
  await earlier;
  await commit;
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.zone),
    [2, 4]
  );
  assert.equal(callbacks, 1);
});

test("queued map write conflicting on the same object rejects and suppresses success callbacks", async () => {
  const { combat } = setup();
  const draft = new Draft(combat);
  draft.tsc.objects[0].zone = 2;
  let callbacks = 0;
  draft.afterCommit(() => {
    callbacks++;
  });
  const gate = blockUpdate(combat);
  const earlier = mutateTsc(combat, (state) => {
    state.objects[0].zone = 9;
    return state;
  });
  await gate.entered;
  const rejected = assert.rejects(draft.commit());
  gate.release();
  await earlier;
  await rejected;
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.zone),
    [9, 3]
  );
  assert.equal(callbacks, 0);
});

test("concurrent tactical mutators read the latest queued state", async () => {
  const { combat } = setup();
  const gate = blockUpdate(combat);
  const first = mutateTsc(combat, (state) => ({ ...state, contactCounter: state.contactCounter + 1 }));
  await gate.entered;
  const second = mutateTsc(combat, (state) => ({ ...state, contactCounter: state.contactCounter + 1 }));
  gate.release();
  await Promise.all([first, second]);
  assert.equal(getTsc(combat).contactCounter, 2);
});

test("guarded tactical save rejects a stale expected state", async () => {
  const { combat } = setup();
  const before = structuredClone(getTsc(combat));
  await mutateTsc(combat, (state) => ({ ...state, contactCounter: 1 }));
  await assert.rejects(saveTsc(combat, { ...before, contactCounter: 2 }, { expected: before }));
  assert.equal(getTsc(combat).contactCounter, 1);
});

test("fresh draft saves ship and map changes once", async () => {
  const { actor, combat } = setup();
  const draft = new Draft(combat);
  (await draft.ship(actor.uuid)).data.sp.value = 10;
  draft.tsc.objects[0].zone = 2;
  let callbacks = 0;
  draft.afterCommit(() => {
    callbacks++;
  });
  await draft.commit();
  assert.equal(readStarship(actor).sp.value, 10);
  assert.equal(getTsc(combat).objects[0].zone, 2);
  assert.equal(callbacks, 1);
});

test("afterCommit callback may commit another draft without deadlocking", { timeout: 5000 }, async () => {
  const { actor, combat } = setup();
  const draft = new Draft(combat);
  draft.tsc.objects[0].zone = 2;
  draft.afterCommit(async () => {
    const nested = new Draft(null);
    (await nested.ship(actor.uuid)).data.notes = "nested";
    await nested.commit();
  });
  await draft.commit();
  assert.equal(getTsc(combat).objects[0].zone, 2);
  assert.equal(readStarship(actor).notes, "nested");
});

test("rebase refuses to resurrect an object deleted concurrently", () => {
  installFoundryMock();
  const base = { objects: [{ key: "marker", zone: 3 }] };
  const mine = { objects: [{ key: "marker", zone: 5 }] };
  const current = { objects: [] };
  assert.throws(() => rebaseTsc(base, mine, current));
});

test("rebase refuses to restore a knowledge entry deleted concurrently", () => {
  installFoundryMock();
  const base = { knowledge: { "ship-1": { zone: 1 } } };
  const mine = { knowledge: { "ship-1": { zone: 2 } } };
  const current = { knowledge: {} };
  assert.throws(() => rebaseTsc(base, mine, current));
});

test("draft editing a concurrently deleted map object refuses commit before ship writes", async () => {
  const { actor, combat } = setup();
  const draft = new Draft(combat);
  (await draft.ship(actor.uuid)).data.sp.value = 10;
  draft.tsc.objects[1].zone = 5;
  await mutateTsc(combat, (state) => {
    state.objects = state.objects.filter((object) => object.key !== "marker");
    return state;
  });
  await assert.rejects(draft.commit());
  assert.equal(readStarship(actor).sp.value, 20);
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.key),
    [actor.uuid]
  );
});

test("draft keeps a concurrent object deletion when it did not edit that object", async () => {
  const { actor, combat } = setup();
  const draft = new Draft(combat);
  draft.tsc.objects[0].zone = 2;
  await mutateTsc(combat, (state) => {
    state.objects = state.objects.filter((object) => object.key !== "marker");
    return state;
  });
  await draft.commit();
  assert.deepEqual(
    getTsc(combat).objects.map((object) => [object.key, object.zone]),
    [[actor.uuid, 2]]
  );
});
