import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
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

test("stale map draft fails preflight before writing ship changes", async () => {
  const { actor, combat } = setup();
  const draft = new Draft(combat);
  (await draft.ship(actor.uuid)).data.sp.value = 10;
  draft.tsc.objects[0].zone = 2;
  await mutateTsc(combat, (state) => {
    state.objects[1].zone = 4;
    return state;
  });
  await assert.rejects(draft.commit());
  assert.equal(readStarship(actor).sp.value, 20);
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.zone),
    [1, 4]
  );
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

test("queued map write rechecks draft snapshot and suppresses success callbacks", async () => {
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
  const rejected = assert.rejects(draft.commit());
  gate.release();
  await earlier;
  await rejected;
  assert.deepEqual(
    getTsc(combat).objects.map((object) => object.zone),
    [1, 4]
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
