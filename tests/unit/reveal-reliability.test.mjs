import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { addSensorContact } from "../../scripts/sensor/contact-service.mjs";
import { addSensorObjectToInitiative, addAllNpcShipsToInitiative } from "../../scripts/sensor/initiative.mjs";
import { registerSensorHandlers } from "../../scripts/sensor/map-handlers.mjs";
import { dispatchSocketMessage } from "../../scripts/socket.mjs";
import { T } from "../../scripts/utils/foundry.mjs";
import {
  addPrivateContact,
  addPrivateCustom,
  privateContacts,
  changePrivateContact,
  recoverPrivateReveals,
  pendingPrivateReveals
} from "../../scripts/sensor/private-contacts.mjs";

// Foundry document mocks only: server filtering, network ordering and live failover are not proven.
const contactsPath = `flags.${MODULE_ID}.privateSensor.contacts`;
const completedPath = `flags.${MODULE_ID}.privateSensor.completedReveals`;
async function setup({ anonymous = true, custom = false, direct = false, hazard = false } = {}) {
  const ctx = installFoundryMock(),
    combat = makeStarshipCombat();
  const source = hazard
    ? new MockActor({ id: "secret-hazard", name: "Secret hazard", type: "hazard", system: { details: { isComplex: false } } })
    : makeShip({ id: "secret-source", name: "Secret raider", role: "npc" });
  game.actors.set(source.id, source);
  let key, actor;
  if (custom) key = await addPrivateCustom(combat, "Secret anomaly", 4);
  else if (direct) {
    actor = source;
    await addPrivateContact(combat, actor, 4);
    key = privateContacts(combat.id)[0].key;
  } else {
    const result = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 4, detection: "undetected" });
    key = result.key;
    actor = fromUuidSync(result.actorUuid);
  }
  await changePrivateContact(combat, key, "detect", "observed");
  if (anonymous && actor && !direct && !hazard) {
    await addSensorObjectToInitiative(combat.id, key);
    const entry = combat.combatants.find((entry) => entry.actorId === actor.id);
    entry.initiative = 17;
  }
  return { ctx, combat, source, actor, key, journal: game.journal.contents[0] };
}

// Inject before-write rejection, applied-but-rejected acknowledgements, and authority loss
// at every external document write. A rejected operation must never initiate another write.
function inject(env, target, mode) {
  const restores = [],
    events = [];
  let faultAt = null;
  function wrap(doc, method, classify) {
    const original = doc[method].bind(doc);
    doc[method] = async (...args) => {
      const kind = classify(args);
      events.push(kind);
      const fault = faultAt === null && kind === target;
      if (fault && mode === "before") {
        faultAt = events.length;
        throw new Error(`injected ${target}`);
      }
      if (fault && mode === "noop") {
        faultAt = events.length;
        return method === "createEmbeddedDocuments" ? [] : doc;
      }
      const result = await original(...args);
      if (fault) {
        faultAt = events.length;
        if (mode === "lostGM") game.user.active = false;
        else throw new Error(`injected ${target}`);
      }
      return result;
    };
    restores.push(() => (doc[method] = original));
  }
  wrap(env.journal, "update", ([changes]) =>
    Object.hasOwn(changes, completedPath)
      ? "finalize"
      : `stage:${changes[contactsPath]?.find((entry) => entry.key === env.key)?.reveal?.stage}`
  );
  wrap(env.combat, "update", () => "publish");
  wrap(env.combat, "createEmbeddedDocuments", () => "create");
  if (env.actor) wrap(env.actor, "update", () => "actor");
  for (const entry of env.combat.combatants) wrap(entry, "update", () => "disclose");
  return {
    events,
    assertStopped() {
      assert.notEqual(faultAt, null, `fault ${target} was exercised`);
      assert.equal(events.length, faultAt, "no rollback or next write after rejection/authority loss");
    },
    restore() {
      for (const restore of restores) restore();
      game.user.active = true;
    }
  };
}
function assertFinished(env, originalId, originalActorCount) {
  const { combat, actor, key, source } = env;
  assert.deepEqual(privateContacts(combat.id), []);
  assert.deepEqual(pendingPrivateReveals(combat.id), []);
  const objects = getTsc(combat).objects.filter((object) => object.key === (actor?.uuid ?? key));
  assert.equal(objects.length, 1);
  assert.equal(objects[0].detection.party, "identified");
  assert.equal(objects[0].tscPrivateProjection, undefined);
  assert.equal(game.actors.size, originalActorCount);
  assert.equal(game.actors.get(source.id), source);
  if (actor) {
    assert.equal(game.actors.get(actor.id), actor);
    const entries = combat.combatants.filter((entry) => entry.actorId === actor.id);
    if (originalId || (actor.flags[MODULE_ID]?.sensorContactInstance && actor.type !== "hazard")) {
      assert.equal(entries.length, 1);
      const [entry] = entries;
      if (originalId) {
        assert.equal(entry.id, originalId);
        assert.equal(entry.initiative, 17);
      }
      assert.equal(entry.hidden, false);
      assert.equal(entry.name, actor.name);
      assert.equal(entry.img, actor.img);
    } else assert.equal(entries.length, 0);
    if (actor.flags[MODULE_ID]?.sensorContactInstance) assert.equal(actor.flags[MODULE_ID].sensorContactInstance.privateContact, false);
    else assert.equal(actor.flags[MODULE_ID]?.sensorContactInstance, undefined);
  }
  const publicText = JSON.stringify(combat.flags);
  for (const secretField of ["pendingReveal", "completedReveals", '"reveal"', '"stage"', "sourceUuid"])
    assert.equal(publicText.includes(secretField), false);
  assert.deepEqual(globalThis.__socket, []);
}

const stages = [
  "stage:intent",
  "publish",
  "stage:map",
  "disclose",
  "stage:combatant",
  "actor",
  "stage:actor",
  "stage:consistent",
  "finalize"
];
for (const mode of ["before", "applied", "lostGM", "noop"]) {
  for (const stage of [...stages, "create"]) {
    test(`REVEAL ${stage}: ${mode} failure is durable, stops writes and recovers without duplication`, async () => {
      const env = await setup({ anonymous: stage !== "create" });
      const { combat, actor, key } = env;
      const actorCount = game.actors.size;
      const originalId = combat.combatants.find((entry) => entry.actorId === actor.id)?.id;
      const failure = inject(env, stage, mode);
      await assert.rejects(changePrivateContact(combat, key, "reveal"));
      failure.assertStopped();
      failure.restore();
      const pending = pendingPrivateReveals(combat.id);
      if (stage === "stage:intent" && ["before", "noop"].includes(mode)) {
        assert.deepEqual(pending, []);
        assert.equal(getTsc(combat).objects[0].tscPrivateProjection, true);
        assert.equal(actor.flags[MODULE_ID].sensorContactInstance.privateContact, true);
      } else if (stage === "finalize" && ["applied", "lostGM"].includes(mode)) {
        assert.deepEqual(pending, []);
        assert.equal(privateContacts(combat.id).length, 0);
      } else {
        assert.equal(pending.length, 1);
        assert.equal(privateContacts(combat.id)[0].pendingReveal, true);
        assert.equal(pending[0].actorUuid, actor.uuid);
      }
      // A different GM/manual map edit between attempts must survive finish-forward recovery.
      const unrelated = { key: "unrelated", type: "custom", name: "Manual beacon", zone: 3 };
      combat.flags[MODULE_ID].tsc.objects.push(unrelated);
      combat.flags[MODULE_ID].tsc.zoneInfo[2] = { notes: "new note" };
      combat.flags[MODULE_ID].tsc.knowledge.manual = { value: 1 };
      combat.flags[MODULE_ID].otherFlag = { retained: true };
      const report = await recoverPrivateReveals(combat);
      assert.deepEqual(report.failed, []);
      assert.deepEqual(report.pending, []);
      assert.deepEqual(report.completed, pending.length ? [key] : []);
      if (privateContacts(combat.id).length) await changePrivateContact(combat, key, "reveal");
      assertFinished(env, originalId, actorCount);
      assert.deepEqual(
        getTsc(combat).objects.find((object) => object.key === "unrelated"),
        unrelated
      );
      assert.deepEqual(getTsc(combat).zoneInfo[2], { notes: "new note" });
      assert.deepEqual(getTsc(combat).knowledge.manual, { value: 1 });
      assert.deepEqual(combat.flags[MODULE_ID].otherFlag, { retained: true });
      const state = structuredClone(combat.flags);
      assert.equal(await changePrivateContact(combat, key, "reveal"), false);
      assert.equal(await changePrivateContact(combat, key, "reveal"), false);
      assert.deepEqual(await recoverPrivateReveals(combat), { pending: [], completed: [], failed: [] });
      assert.deepEqual(combat.flags, state);
      assertFinished(env, originalId, actorCount);
    });
  }
}

for (const spec of [{ custom: true }, { direct: true }, { hazard: true }]) {
  test(`custom/non-instance/simple-hazard recovery preserves original documents: ${JSON.stringify(spec)}`, async () => {
    const env = await setup(spec),
      count = game.actors.size;
    const failure = inject(env, "stage:map", "applied");
    await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
    failure.restore();
    const report = await recoverPrivateReveals(env.combat);
    assert.deepEqual(report.completed, [env.key]);
    assert.deepEqual(report.failed, []);
    assertFinished(env, null, count);
    assert.equal(await changePrivateContact(env.combat, env.key, "reveal"), false);
  });
}

test("pending intents block contact move/remove/detect/rename and repeat-add, and reads/render hooks never write", async () => {
  const env = await setup({ custom: true });
  const failure = inject(env, "publish", "before");
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
  failure.restore();
  const before = structuredClone(env.journal.flags);
  for (const [op, value] of [["move", 6], ["remove"], ["detect", "hidden"], ["rename", "Other"]])
    await assert.rejects(changePrivateContact(env.combat, env.key, op, value), /pending recovery/);
  privateContacts(env.combat.id);
  pendingPrivateReveals(env.combat.id);
  Hooks.callAll("renderCombatTracker", {});
  Hooks.callAll("updateCombat", env.combat, {}, {});
  assert.deepEqual(env.journal.flags, before);
  assert.equal(getTsc(env.combat).objects[0].tscPrivateProjection, true);
  const actorEnv = await setup();
  const actorFailure = inject(actorEnv, "publish", "before");
  await assert.rejects(changePrivateContact(actorEnv.combat, actorEnv.key, "reveal"));
  actorFailure.restore();
  await assert.rejects(addPrivateContact(actorEnv.combat, actorEnv.actor, 8), /pending recovery/);
});

const conflicts = {
  "Actor missing": (env) => game.actors.delete(env.actor.id),
  "Actor permission changed": (env) => env.actor.owners.push("p1"),
  "Actor foreign instance": (env) => (env.actor.flags[MODULE_ID].sensorContactInstance.combatId = "foreign"),
  "duplicate public object": (env) => env.combat.flags[MODULE_ID].tsc.objects.push(structuredClone(getTsc(env.combat).objects[0])),
  "conflicting public object": (env) => (env.combat.flags[MODULE_ID].tsc.objects[0].name = "Manual edit"),
  "foreign Combatant flag": (env) => (env.combat.combatants.contents[0].flags[MODULE_ID].sensorMapInitiative.combatId = "foreign"),
  "changed initiative": (env) => (env.combat.combatants.contents[0].initiative = 19),
  "missing original Combatant": (env) => env.combat.combatants.clear(),
  "duplicate Actor Combatant": async (env) => env.combat.createEmbeddedDocuments("Combatant", [{ actorId: env.actor.id }])
};
for (const [name, conflict] of Object.entries(conflicts)) {
  test(`recovery fails closed on ${name} and leaves unrelated documents untouched`, async () => {
    const env = await setup();
    const failure = inject(env, "stage:map", "before");
    await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
    failure.restore();
    await conflict(env);
    const before = structuredClone(env.combat.flags),
      journalBefore = structuredClone(env.journal.flags);
    const entries = env.combat.combatants.contents.map((entry) => ({
      id: entry.id,
      hidden: entry.hidden,
      flags: structuredClone(entry.flags)
    }));
    const report = await recoverPrivateReveals(env.combat);
    assert.equal(report.failed.length, 1);
    assert.equal(report.failed[0].key, env.key);
    assert.match(report.failed[0].error, /Private contact REVEAL/);
    assert.equal(report.pending.length, 1);
    assert.deepEqual(report.completed, []);
    assert.deepEqual(env.combat.flags, before);
    assert.deepEqual(env.journal.flags, journalBefore);
    assert.deepEqual(
      env.combat.combatants.contents.map((entry) => ({ id: entry.id, hidden: entry.hidden, flags: entry.flags })),
      entries
    );
    assert.equal(game.actors.get(env.source.id), env.source);
  });
}

test("reserved ID and manual Actor Combatants cannot be adopted or duplicated on creation recovery", async () => {
  for (const collision of ["id", "actor"]) {
    const env = await setup({ anonymous: false });
    const failure = inject(env, "create", "before");
    await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
    failure.restore();
    const intent = privateContacts(env.combat.id)[0].reveal;
    const [manual] = await env.combat.createEmbeddedDocuments("Combatant", [
      {
        _id: collision === "id" ? intent.combatant.id : "manual",
        actorId: collision === "id" ? env.source.id : env.actor.id,
        name: "Manual entry",
        initiative: 21
      }
    ]);
    const report = await recoverPrivateReveals(env.combat);
    assert.equal(report.failed.length, 1);
    assert.equal(env.combat.combatants.size, 1);
    assert.equal(env.combat.combatants.get(manual.id), manual);
    assert.equal(manual.name, "Manual entry");
    assert.equal(manual.initiative, 21);
  }
});

test("players cannot read intents or receive recovery reports; inactive GMs cannot write", async () => {
  const env = await setup();
  const failure = inject(env, "publish", "before");
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
  failure.restore();
  const before = structuredClone(env.journal.flags);
  env.ctx.setUser("p1");
  assert.deepEqual(pendingPrivateReveals(env.combat.id), []);
  await assert.rejects(recoverPrivateReveals(env.combat));
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
  env.ctx.setUser("gm");
  game.user.active = false;
  await assert.rejects(recoverPrivateReveals(env.combat));
  assert.deepEqual(env.journal.flags, before);
});

test("journal stage is advisory: a forged final stage cannot bypass actual document checks", async () => {
  const env = await setup();
  const failure = inject(env, "publish", "before");
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
  failure.restore();
  env.journal.flags[MODULE_ID].privateSensor.contacts[0].reveal.stage = "consistent";
  const report = await recoverPrivateReveals(env.combat);
  assert.deepEqual(report.failed, []);
  assertFinished(env, env.combat.combatants.contents[0].id, game.actors.size);
});

test("finalization revalidates actual Actor/Combatant/map after the consistent stage acknowledgement", async () => {
  for (const change of ["actor", "combatant", "map"]) {
    const env = await setup(),
      update = env.journal.update.bind(env.journal);
    env.journal.update = async (changes) => {
      const result = await update(changes);
      if (changes[contactsPath]?.[0]?.reveal?.stage === "consistent") {
        if (change === "actor") env.actor.flags[MODULE_ID].sensorContactInstance.privateContact = true;
        else if (change === "map") env.combat.flags[MODULE_ID].tsc.objects = [];
        else {
          const entry = env.combat.combatants.contents[0];
          entry.hidden = true;
          entry.customName = "Contact";
          entry.img = "icons/svg/mystery-man.svg";
          entry.flags[MODULE_ID].sensorMapInitiative.contactDesignation = true;
        }
      }
      return result;
    };
    await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"), /Private contact REVEAL/);
    assert.equal(privateContacts(env.combat.id)[0].pendingReveal, true);
    assert.equal(env.journal.flags[MODULE_ID].privateSensor.completedReveals, undefined);
  }
});

test("lost authority while resolving the original Actor stops before intent or document writes", async () => {
  const env = await setup(),
    resolve = globalThis.fromUuid;
  const before = structuredClone(env.journal.flags),
    writes = globalThis.__writes.length;
  globalThis.fromUuid = async (uuid) => {
    const result = await resolve(uuid);
    game.user.active = false;
    return result;
  };
  try {
    await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
    assert.deepEqual(env.journal.flags, before);
    assert.equal(globalThis.__writes.length, writes);
  } finally {
    globalThis.fromUuid = resolve;
    game.user.active = true;
  }
});

test("concurrent explicit reveal/recovery requests coalesce without duplicate objects or Combatants", async () => {
  const env = await setup(),
    id = env.combat.combatants.contents[0].id,
    count = game.actors.size;
  const failure = inject(env, "actor", "applied");
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
  failure.restore();
  await Promise.all([
    recoverPrivateReveals(env.combat),
    changePrivateContact(env.combat, env.key, "reveal"),
    changePrivateContact(env.combat, env.key, "reveal"),
    recoverPrivateReveals(env.combat)
  ]);
  assertFinished(env, id, count);
});

test("recovery reports a failed pending contact while completing independent intents", async () => {
  const env = await setup();
  const first = inject(env, "publish", "before");
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
  first.restore();
  const customKey = await addPrivateCustom(env.combat, "Independent anomaly", 7);
  const second = inject({ ...env, key: customKey, actor: null }, "publish", "before");
  await assert.rejects(changePrivateContact(env.combat, customKey, "reveal"));
  second.restore();
  game.actors.delete(env.actor.id);
  const report = await recoverPrivateReveals(env.combat);
  assert.deepEqual(report.completed, [customKey]);
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].key, env.key);
  assert.deepEqual(
    report.pending.map((entry) => entry.key),
    [env.key]
  );
  assert.equal(getTsc(env.combat).objects.filter((object) => object.key === customKey).length, 1);
  assert.equal(game.actors.get(env.source.id), env.source);
});

test("existing anonymous Combatant retains a zero initiative through reveal and repeated retry", async () => {
  const env = await setup(),
    entry = env.combat.combatants.contents[0];
  entry.initiative = 0;
  const failure = inject(env, "disclose", "applied");
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
  failure.restore();
  assert.deepEqual((await recoverPrivateReveals(env.combat)).failed, []);
  assert.equal(await changePrivateContact(env.combat, env.key, "reveal"), false);
  assert.equal(env.combat.combatants.size, 1);
  assert.equal(env.combat.combatants.get(entry.id), entry);
  assert.equal(entry.initiative, 0);
});

test("completed journal receipts are bounded and an evicted key cannot duplicate a finished contact", async () => {
  installFoundryMock();
  const combat = makeStarshipCombat(),
    keys = [];
  for (let i = 0; i < 66; i++) {
    const key = await addPrivateCustom(combat, `Anomaly ${i}`, 4);
    keys.push(key);
    await changePrivateContact(combat, key, "reveal");
  }
  const receipts = game.journal.contents[0].flags[MODULE_ID].privateSensor.completedReveals;
  assert.equal(receipts.length, 64);
  assert.equal(receipts[0].key, keys[2]);
  await assert.rejects(changePrivateContact(combat, keys[0], "reveal"));
  assert.equal(await changePrivateContact(combat, keys[65], "reveal"), false);
  assert.equal(getTsc(combat).objects.length, 66);
  assert.deepEqual(privateContacts(combat.id), []);
});

test("a malformed/leaking anonymous projection is not adopted by a reveal intent", async () => {
  const env = await setup();
  env.combat.flags[MODULE_ID].tsc.objects[0].actorUuid = env.source.uuid;
  const before = structuredClone(env.combat.flags);
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"), /conflicting/);
  assert.deepEqual(pendingPrivateReveals(env.combat.id), []);
  assert.deepEqual(env.combat.flags, before);
});

test("unsafe private journal permissions prevent recovery before public writes", async () => {
  const env = await setup();
  const failure = inject(env, "publish", "before");
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
  failure.restore();
  env.journal.ownership.p1 = 1;
  const before = structuredClone(env.combat.flags);
  assert.throws(() => pendingPrivateReveals(env.combat.id));
  await assert.rejects(recoverPrivateReveals(env.combat));
  assert.deepEqual(env.combat.flags, before);
});

async function publishedPending(options = {}, stage = "stage:map") {
  const env = await setup(options);
  const failure = inject(env, stage, "before");
  await assert.rejects(changePrivateContact(env.combat, env.key, "reveal"));
  failure.restore();
  assert.equal(pendingPrivateReveals(env.combat.id).length, 1);
  assert.equal(getTsc(env.combat).objects[0].tscPrivateProjection, undefined);
  return env;
}

function watchGuardWrites(env) {
  const writes = [];
  function watch(doc, method) {
    const original = doc[method].bind(doc);
    doc[method] = async (...args) => {
      writes.push(method);
      return original(...args);
    };
  }
  for (const method of ["update", "createEmbeddedDocuments", "deleteEmbeddedDocuments"]) watch(env.combat, method);
  watch(env.journal, "update");
  watch(Actor, "create");
  for (const actor of game.actors) for (const method of ["update", "delete"]) watch(actor, method);
  for (const entry of env.combat.combatants) watch(entry, "update");
  return writes;
}

async function guardSocket(env, type, payload, senderId = "gm") {
  registerSensorHandlers();
  const responses = [];
  await dispatchSocketMessage(
    { kind: "request", type, requestId: "guard-request", payload: { combatId: env.combat.id, ...payload } },
    senderId,
    { users: game.users, selfId: game.user.id, isActiveGM: true, clientEvents: new Map(), emit: (response) => responses.push(response) }
  );
  assert.equal(responses.length, 1);
  return responses[0];
}

const publicPendingOps = [
  { op: "move", zone: 8 },
  { op: "shift", by: 1 },
  { op: "remove" },
  { op: "type", type: "asteroid" },
  { op: "detect", level: "hidden" },
  { op: "art", art: "icons/svg/star.svg" },
  { op: "flip" },
  { op: "setHeading", heading: "left" },
  { op: "hidden" },
  { op: "objectVisual", visual: { transform: { flipX: true }, art: "icons/svg/star.svg" } }
];
for (const spec of [{}, { custom: true }, { alias: true }]) {
  test(`public sensor edits refuse published pending key/Actor targets without writes: ${JSON.stringify(spec)}`, async () => {
    const env = await publishedPending(spec);
    const object = env.combat.flags[MODULE_ID].tsc.objects[0];
    if (spec.alias) object.key = "public-alias";
    const writes = watchGuardWrites(env);
    const before = structuredClone(env.combat.flags),
      journalBefore = structuredClone(env.journal.flags),
      actorBefore = env.actor?.toObject();
    const ops = [...publicPendingOps, { op: "resize", zones: 2 }];
    if (env.actor) ops.push({ op: "dropActor", actorUuid: env.actor.uuid, zone: 8 });
    ops.push({ op: "add", object: { key: env.key, actorUuid: env.actor?.uuid, type: "custom", zone: 8 } });
    if (env.actor) ops.push({ op: "add", object: { key: "other-key", actorUuid: env.actor.uuid, type: "starship", zone: 8 } });
    for (const op of ops) {
      const keyed = ["add", "dropActor", "resize"].includes(op.op) ? {} : { key: object.key };
      const response = await guardSocket(env, "sensorUpdate", { ...keyed, ...op });
      assert.equal(response.ok, false, op.op);
      assert.equal(response.error, T("SF2eTSC.privateMap.recoveryRequired"));
      for (const secret of [env.key, env.actor?.uuid, env.source.name].filter(Boolean))
        assert.equal(JSON.stringify(response).includes(secret), false);
      assert.deepEqual(writes, [], op.op);
    }
    assert.deepEqual(env.combat.flags, before);
    assert.deepEqual(env.journal.flags, journalBefore);
    assert.deepEqual(env.actor?.toObject(), actorBefore);
  });
}

test("pending public guards preserve unrelated moves, additions, zone and appearance edits and allow recovery", async () => {
  const env = await publishedPending();
  env.combat.flags[MODULE_ID].tsc.objects.push({ key: "unrelated", type: "custom", name: "Beacon", zone: 3 });
  const writes = watchGuardWrites(env);
  for (const op of [
    { op: "move", key: "unrelated", zone: 6 },
    { op: "add", object: { key: "another", type: "custom", name: "Other", zone: 2 } },
    { op: "zoneInfo", zone: 2, info: { publicNotes: "Manual note" } },
    { op: "appearancePatch", appearance: { textColor: "#123456" } }
  ])
    assert.equal((await guardSocket(env, "sensorUpdate", op)).ok, true);
  assert.equal(writes.filter((method) => method === "update").length >= 3, true);
  assert.equal(getTsc(env.combat).objects.find((object) => object.key === "unrelated").zone, 6);
  assert.equal(getTsc(env.combat).zoneInfo[2].publicNotes, "Manual note");
  assert.equal(getTsc(env.combat).appearance.textColor, "#123456");
  assert.deepEqual((await recoverPrivateReveals(env.combat)).failed, []);
  assert.equal(getTsc(env.combat).objects.find((object) => object.key === "unrelated").zone, 6);
  assert.equal(
    getTsc(env.combat).objects.some((object) => object.key === "another"),
    true
  );
  assert.deepEqual(pendingPrivateReveals(env.combat.id), []);
  assert.equal((await guardSocket(env, "sensorUpdate", { op: "move", key: env.actor.uuid, zone: 8 })).ok, true);
});

test("invalid private journal permits independent public markers but protects reserved reveal identities", async () => {
  const env = await publishedPending();
  env.journal.folder = { id: "moved-folder" };
  const before = structuredClone(env.journal.flags);
  const writes = watchGuardWrites(env);
  const added = await guardSocket(env, "sensorUpdate", {
    op: "add",
    object: { key: "independent-marker", type: "asteroid", name: "Asteroid", zone: 2 }
  });
  assert.equal(added.ok, true);
  assert.ok(getTsc(env.combat).objects.some((object) => object.key === "independent-marker"));
  const written = writes.length;
  for (const object of [
    { key: env.key, type: "asteroid", zone: 2 },
    { key: env.actor.uuid, type: "asteroid", zone: 2 },
    { key: "other", actorUuid: env.actor.uuid, type: "asteroid", zone: 2 }
  ]) {
    const refused = await guardSocket(env, "sensorUpdate", { op: "add", object });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, T("SF2eTSC.privateMap.recoveryRequired"));
  }
  assert.equal(writes.length, written);
  assert.deepEqual(env.journal.flags, before);
});

for (const mode of ["legacy-update", "public-update", "create", "alias"]) {
  test(`individual and bulk initiative skip pending before Combatant ${mode}`, async () => {
    const env = await publishedPending({}, mode === "legacy-update" ? "stage:map" : "finalize");
    const object = env.combat.flags[MODULE_ID].tsc.objects[0];
    if (mode === "legacy-update") delete env.combat.combatants.contents[0].flags[MODULE_ID].sensorMapInitiative.combatId;
    if (mode === "public-update") object.hidden = true;
    if (mode === "create") env.combat.combatants.clear();
    if (mode === "alias") object.key = "initiative-alias";
    const writes = watchGuardWrites(env);
    const before = structuredClone(env.combat.flags),
      journalBefore = structuredClone(env.journal.flags),
      actorBefore = env.actor.toObject();
    for (const key of [env.key, env.actor.uuid, object.key])
      assert.deepEqual(await addSensorObjectToInitiative(env.combat.id, key), { status: "skipped", reason: "recoveryRequired" });
    const single = await guardSocket(env, "sensorAddInitiative", { key: object.key });
    assert.deepEqual(single.result, { status: "skipped", reason: "recoveryRequired" });
    const bulk = await guardSocket(env, "sensorAddAllNpcInitiative", {});
    assert.deepEqual(bulk.result, { added: 0, existing: 0, skipped: 2, failed: 0, reportCreated: true });
    assert.deepEqual(writes, []);
    assert.deepEqual(env.combat.flags, before);
    assert.deepEqual(env.journal.flags, journalBefore);
    assert.deepEqual(env.actor.toObject(), actorBefore);
    for (const response of [single, bulk])
      for (const secret of [env.key, env.actor.uuid, env.actor.name]) assert.equal(JSON.stringify(response).includes(secret), false);
    assert.ok(game.messages.contents[0].content.includes(T("SF2eTSC.privateMap.recoveryRequired")));
  });
}

test("bulk initiative skips pending while adding an unrelated independent NPC", async () => {
  const env = await publishedPending();
  const source = makeShip({ id: "unrelated-npc", name: "Other NPC", role: "npc" });
  const placement = await addSensorContact(env.combat, { source: "world", uuid: source.uuid, zone: 7, detection: "identified" });
  // Public placement already creates its Combatant; remove only that entry to exercise bulk creation.
  const entry = env.combat.combatants.find((entry) => entry.actor?.uuid === placement.actorUuid);
  await env.combat.deleteEmbeddedDocuments("Combatant", [entry.id]);
  const writes = watchGuardWrites(env);
  assert.deepEqual(await addAllNpcShipsToInitiative(env.combat.id), {
    added: 1,
    existing: 0,
    skipped: 2,
    failed: 0,
    reportCreated: true
  });
  assert.deepEqual(writes, ["createEmbeddedDocuments"]);
  assert.equal(
    env.combat.combatants.find((entry) => entry.actor?.uuid === placement.actorUuid).name,
    fromUuidSync(placement.actorUuid).name
  );
});

test("pending marker initiative skips before marker-only validation without writes", async () => {
  const env = await publishedPending({ custom: true });
  const writes = watchGuardWrites(env);
  assert.deepEqual(await addSensorObjectToInitiative(env.combat.id, env.key), { status: "skipped", reason: "recoveryRequired" });
  assert.deepEqual(await addAllNpcShipsToInitiative(env.combat.id), {
    added: 0,
    existing: 0,
    skipped: 2,
    failed: 0,
    reportCreated: true
  });
  assert.deepEqual(writes, []);
});

for (const existing of [true, false]) {
  test(`initiative rechecks an intent appearing during Actor resolution before ${existing ? "update" : "creation"}`, async () => {
    const env = await publishedPending({}, "finalize");
    const contact = env.journal.flags[MODULE_ID].privateSensor.contacts[0],
      intent = contact.reveal;
    delete contact.reveal;
    env.combat.flags[MODULE_ID].tsc.objects[0].hidden = true;
    if (!existing) env.combat.combatants.clear();
    const writes = watchGuardWrites(env),
      resolve = globalThis.fromUuid;
    globalThis.fromUuid = async (uuid) => {
      const actor = await resolve(uuid);
      if (uuid === env.actor.uuid) contact.reveal = intent;
      return actor;
    };
    try {
      assert.deepEqual(await addSensorObjectToInitiative(env.combat.id, env.actor.uuid), { status: "skipped", reason: "recoveryRequired" });
      assert.deepEqual(writes, []);
    } finally {
      globalThis.fromUuid = resolve;
    }
  });
}

test("guard journal diagnostics run only on active GM and errors remain generic over sockets", async () => {
  const env = await publishedPending();
  const writes = watchGuardWrites(env);
  let reads = 0;
  Object.defineProperty(game.journal, "contents", {
    get() {
      reads++;
      throw new Error(`secret ${env.key} ${env.actor.uuid}`);
    }
  });
  env.ctx.setUser("p1");
  const player = await guardSocket(env, "sensorUpdate", { op: "resize", zones: 2 });
  assert.equal(player.ok, false);
  await assert.rejects(addSensorObjectToInitiative(env.combat.id, env.key));
  await assert.rejects(addAllNpcShipsToInitiative(env.combat.id));
  env.ctx.setUser("gm");
  game.user.active = false;
  assert.equal((await guardSocket(env, "sensorUpdate", { op: "resize", zones: 2 })).ok, false);
  await assert.rejects(addSensorObjectToInitiative(env.combat.id, env.key));
  await assert.rejects(addAllNpcShipsToInitiative(env.combat.id));
  assert.equal(reads, 0);
  game.user.active = true;
  for (const type of ["sensorUpdate", "sensorAddInitiative", "sensorAddAllNpcInitiative"]) {
    const response = await guardSocket(env, type, { op: "resize", zones: 2, key: env.actor.uuid });
    assert.equal(response.ok, false);
    assert.equal(response.error, T("SF2eTSC.privateMap.recoveryRequired"));
  }
  assert.deepEqual(writes, []);
});
