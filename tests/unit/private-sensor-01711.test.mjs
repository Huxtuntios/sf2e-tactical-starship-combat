import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import { addPrivateContact, addPrivateCustom, changePrivateContact, privateContacts } from "../../scripts/sensor/private-contacts.mjs";
import * as privateSensor from "../../scripts/sensor/private-contacts.mjs";
import { getTsc, mutateTsc } from "../../scripts/combat/tsc-state.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { viewFor, setHeading } from "../../scripts/engine/sensor-ops.mjs";
import { applySensorOp } from "../../scripts/sensor/map-model.mjs";
import { placeHazard } from "../../scripts/hazards/hazard-engine.mjs";
import { saveInstallMinePlan } from "../../scripts/actions/install-mine-plan.mjs";
import { loadContentFromDisk, makeCharacter, dice } from "../helpers/foundry-mock.mjs";
import { evaluateTarget } from "../../scripts/engine/target-rules.mjs";
import { executeAction, registerActionHandlers } from "../../scripts/actions/action-engine.mjs";
import { previewNativeAttack, executeNativeAttack } from "../../scripts/chat/native-attack.mjs";
import { declareAttack, resolveAttackCard, rollAttackCardDamage, applyAttackCardDamage } from "../../scripts/chat/attack-card/service.mjs";
import { dispatchSocketMessage } from "../../scripts/socket.mjs";

const M = "sf2e-tactical-starship-combat";

let attackId = 0;
async function targetingScenario() {
  const s = setup();
  await loadContentFromDisk();
  const crew = makeCharacter({ id: "gunner", owners: ["p1"] });
  const attacker = makeShip({
    id: "attacker",
    stations: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: crew.uuid, weaponId: "w" }],
    weapons: [{ id: "w", weaponRef: "coilgun", name: "Coilgun" }],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "g" }]
  });
  await s.combat.update({
    [`flags.sf2e-tactical-starship-combat.tsc.objects`]: [{ key: attacker.uuid, type: "starship", zone: 2, alwaysVisible: true }]
  });
  s.ship.img = "secret-portrait.webp";
  await addPrivateContact(s.combat, s.ship, 3);
  const key = privateContacts(s.combat.id)[0].key;
  await changePrivateContact(s.combat, key, "detect", "observed");
  return {
    ...s,
    attacker,
    crew,
    key,
    user: game.users.get("p1"),
    gm: game.users.get("gm"),
    payload: {
      shipUuid: attacker.uuid,
      crewUuid: crew.uuid,
      actionId: "strike",
      stationId: "g",
      combatId: s.combat.id,
      eventId: `private_attack_${++attackId}`,
      options: { targetKey: key, sheetRoll: true, weaponId: "w", skipDialog: true }
    }
  };
}
function assertNoIdentity(s, value) {
  const text = JSON.stringify(value);
  for (const secret of [s.ship.uuid, s.ship.name]) assert.equal(text.includes(secret), false, secret);
}

test("ordinary targeting allows every detected state but never undetected overrides", () => {
  const tsc = { objects: [{ key: "attacker", type: "starship", zone: 2 }] };
  for (const level of ["undetected", "hidden", "observed", "identified"]) {
    const obj = { key: "target", type: "starship", zone: 3, detection: { party: level } };
    for (const options of [{}, { override: true }, { soft: true }, { enforceDetection: false }])
      assert.equal(evaluateTarget({ tsc, shipKey: "attacker", obj, range: 3, ...options }).available, level !== "undetected");
  }
  for (const objectType of ["starship", "hazard", "custom"])
    assert.equal(
      evaluateTarget({
        tsc,
        shipKey: "attacker",
        range: 3,
        obj: { key: "private-target", type: "contact", objectType, tscPrivateProjection: true, zone: 3, detection: { party: "hidden" } }
      }).available,
      objectType === "starship" || objectType === "hazard"
    );
});

test("existing private detection projections refresh without changing contacts or rewriting an unchanged map", async () => {
  assert.equal(typeof privateSensor.syncPrivateProjections, "function");
  const s = await targetingScenario();
  const hidden = await addPrivateCustom(s.combat, "Hidden anomaly", 4);
  await changePrivateContact(s.combat, hidden, "detect", "hidden");
  const before = structuredClone(game.journal.contents[0].flags);
  const objects = s.combat.flags["sf2e-tactical-starship-combat"].tsc.objects;
  const observed = objects.find((o) => o.key === s.key);
  delete observed.objectType;
  delete observed.art;
  observed.heading = null;
  s.combat.flags["sf2e-tactical-starship-combat"].tsc.objects = objects.filter((o) => o.key !== hidden);
  await privateSensor.syncPrivateProjections(s.combat);
  assert.deepEqual(game.journal.contents[0].flags, before);
  assert.equal(getTsc(s.combat).objects.find((o) => o.key === s.key).art, s.ship.img);
  assert.equal(getTsc(s.combat).objects.find((o) => o.key === hidden).detection.party, "hidden");
  const writes = globalThis.__writes.length;
  await privateSensor.syncPrivateProjections(s.combat);
  assert.equal(globalThis.__writes.length, writes);
  game.user = s.user;
  await assert.rejects(privateSensor.syncPrivateProjections(s.combat));
});

test("projection Actor lookup cannot overwrite a concurrently completed action commit", async () => {
  const s = await targetingScenario();
  const original = globalThis.fromUuid;
  let release, entered;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const lookup = new Promise((resolve) => {
    entered = resolve;
  });
  globalThis.fromUuid = async (uuid) => {
    if (uuid === s.ship.uuid) {
      entered();
      await wait;
    }
    return original(uuid);
  };
  try {
    const moving = changePrivateContact(s.combat, s.key, "move", 6);
    await lookup;
    const action = new Draft(s.combat);
    action.tsc = setHeading(action.tsc, s.attacker.uuid, "left");
    action.tsc.objects.find((o) => o.key === s.attacker.uuid).detection = { party: "identified" };
    await action.commit();
    release();
    await moving;
    const source = getTsc(s.combat).objects.find((o) => o.key === s.attacker.uuid);
    assert.equal(source.heading, "left");
    assert.equal(source.detection.party, "identified");
    assert.equal(getTsc(s.combat).objects.find((o) => o.key === s.key).zone, 6);
    assert.equal(privateContacts(s.combat.id)[0].zone, 6);
  } finally {
    release();
    globalThis.fromUuid = original;
  }
});

test("projection queued behind a map mutation reads its completed current state", async () => {
  const s = await targetingScenario();
  let release, entered, resolved;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const mutationStarted = new Promise((resolve) => {
    entered = resolve;
  });
  const actorLookup = new Promise((resolve) => {
    resolved = resolve;
  });
  const original = globalThis.fromUuid;
  const mutation = mutateTsc(s.combat, async (state) => {
    entered();
    await wait;
    return setHeading(state, s.attacker.uuid, "left");
  });
  await mutationStarted;
  globalThis.fromUuid = async (uuid) => {
    if (uuid === s.ship.uuid) resolved();
    return original(uuid);
  };
  try {
    const moving = changePrivateContact(s.combat, s.key, "move", 6);
    await actorLookup;
    release();
    await Promise.all([mutation, moving]);
    assert.equal(getTsc(s.combat).objects.find((o) => o.key === s.attacker.uuid).heading, "left");
    assert.equal(getTsc(s.combat).objects.find((o) => o.key === s.key).zone, 6);
  } finally {
    release();
    globalThis.fromUuid = original;
  }
});

test("private hidden and observed projections publish only the approved visual fields", async () => {
  const s = await targetingScenario();
  for (const level of ["hidden", "observed"]) {
    await changePrivateContact(s.combat, s.key, "detect", level);
    const projection = getTsc(s.combat).objects.find((o) => o.key === s.key);
    assert.ok(projection, `${level} must publish a position`);
    assert.equal(projection.objectType, "starship");
    assert.equal(projection.detection.party, level);
    assert.equal(projection.heading, level === "hidden" ? null : "right");
    assert.equal(projection.art, level === "hidden" ? undefined : s.ship.img);
    assert.equal(JSON.stringify(projection).includes(s.ship.uuid), false);
    assert.equal(JSON.stringify(projection).includes(s.ship.name), false);
    for (const user of [s.user, s.gm]) assert.ok(await previewNativeAttack({ user, payload: s.payload }));
  }
  await changePrivateContact(s.combat, s.key, "detect", "undetected");
  assert.equal(
    getTsc(s.combat).objects.some((o) => o.key === s.key),
    false
  );
});

test("Seek advances hidden private contacts durably without breaking subsequent targeting", async () => {
  const s = await targetingScenario();
  await changePrivateContact(s.combat, s.key, "detect", "hidden");
  const custom = await addPrivateCustom(s.combat, "Secret anomaly", 4);
  await changePrivateContact(s.combat, custom, "detect", "hidden");
  const publicShip = makeShip({ id: "public-seek-target", role: "npc" });
  s.combat.flags["sf2e-tactical-starship-combat"].tsc.objects.push({
    key: publicShip.uuid,
    actorUuid: publicShip.uuid,
    type: "starship",
    zone: 5,
    detection: { party: "hidden" }
  });
  const station = s.attacker.flags["sf2e-tactical-starship-combat"].starship.stations[0];
  station.type = "scanners";
  s.crew.skills = { computers: { mod: 30 } };
  dice(20);
  const result = await executeAction({
    ...s.payload,
    actionId: "seek-starships",
    user: s.user,
    options: { skill: "computers", skipDialog: true }
  });
  assert.equal(result.ok, true);
  for (const key of [s.key, custom]) {
    assert.equal(privateContacts(s.combat.id).find((o) => o.key === key).detection.party, "observed");
    assert.equal(getTsc(s.combat).objects.find((o) => o.key === key).detection.party, "observed");
  }
  const ordinary = getTsc(s.combat).objects.find((o) => o.key === publicShip.uuid);
  assert.equal(ordinary.detection.party, "observed");
  assert.equal(ordinary.detection[s.attacker.uuid], "observed");
  assert.ok(ordinary.designation);
  await privateSensor.syncPrivateProjections(s.combat);
  assert.equal(getTsc(s.combat).objects.find((o) => o.key === s.key).detection.party, "observed");
  station.type = "gunnery";
  assert.ok(await previewNativeAttack({ user: s.user, payload: s.payload }));
  assertNoIdentity(s, getTsc(s.combat));
});

for (const [op, value] of [
  ["move", 9],
  ["detect", "undetected"]
]) {
  test(`Seek rejects a later private contact's queued ${op} instead of revealing stale sensor data`, async () => {
    const s = await targetingScenario();
    await changePrivateContact(s.combat, s.key, "detect", "hidden");
    const laterShip = makeShip({ id: "later-seek-target", role: "npc" });
    await addPrivateContact(s.combat, laterShip, 4);
    const later = privateContacts(s.combat.id).find((o) => o.key !== s.key);
    await changePrivateContact(s.combat, later.key, "detect", "hidden");
    s.attacker.flags["sf2e-tactical-starship-combat"].starship.stations[0].type = "scanners";
    s.crew.skills = { computers: { mod: 30 } };
    dice(20);
    const original = globalThis.fromUuid;
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let lookups = 0;
    globalThis.fromUuid = async (uuid) => {
      if (uuid === s.ship.uuid && ++lookups === 2) {
        entered.resolve();
        await release.promise;
      }
      return original(uuid);
    };
    try {
      const seeking = executeAction({
        ...s.payload,
        actionId: "seek-starships",
        user: s.user,
        options: { skill: "computers", skipDialog: true }
      });
      const settled = seeking.then(
        () => null,
        (error) => error
      );
      await entered.promise;
      const changing = changePrivateContact(s.combat, later.key, op, value);
      release.resolve();
      await changing;
      const error = await settled;
      const current = privateContacts(s.combat.id).find((o) => o.key === later.key);
      assert.equal(current.zone, op === "move" ? 9 : 4);
      assert.equal(current.detection.party, op === "move" ? "hidden" : "undetected");
      const marker = getTsc(s.combat).objects.find((o) => o.key === later.key);
      if (op === "move") {
        assert.equal(marker.zone, 9);
        assert.equal(marker.detection.party, "hidden");
        assert.equal(marker.heading, null);
        assert.equal(marker.art, undefined);
      } else assert.equal(marker, undefined);
      assert.ok(error);
      assert.equal(error.message, game.i18n.localize("SF2eTSC.qol.undoConflict"));
      assert.equal(privateContacts(s.combat.id).find((o) => o.key === s.key).detection.party, "observed");
    } finally {
      release.resolve();
      globalThis.fromUuid = original;
    }
  });
}

test("private detection expectations are checked after earlier queued GM changes complete", async () => {
  const s = await targetingScenario();
  const later = await addPrivateCustom(s.combat, "Later hidden contact", 4);
  await changePrivateContact(s.combat, later, "detect", "hidden");
  const original = globalThis.fromUuid;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  globalThis.fromUuid = async (uuid) => {
    if (uuid === s.ship.uuid) {
      entered.resolve();
      await release.promise;
    }
    return original(uuid);
  };
  try {
    const moving = changePrivateContact(s.combat, s.key, "move", 5);
    await entered.promise;
    const changing = changePrivateContact(s.combat, later, "move", 9);
    const stale = changePrivateContact(s.combat, later, "detect", "observed", { expected: { zone: 4, detection: "hidden" } });
    const finished = Promise.all([moving, changing, assert.rejects(stale, { message: game.i18n.localize("SF2eTSC.qol.undoConflict") })]);
    release.resolve();
    await finished;
    const contact = privateContacts(s.combat.id).find((o) => o.key === later);
    assert.equal(contact.zone, 9);
    assert.equal(contact.detection.party, "hidden");
    assert.equal(getTsc(s.combat).objects.find((o) => o.key === later).detection.party, "hidden");
  } finally {
    release.resolve();
    globalThis.fromUuid = original;
  }
});

test("Seek uses a hidden private ship's actual Stealth DC without publishing its identity", async () => {
  const s = await targetingScenario();
  await changePrivateContact(s.combat, s.key, "detect", "hidden");
  s.ship.flags["sf2e-tactical-starship-combat"].starship.skills = { stealth: 100 };
  s.attacker.flags["sf2e-tactical-starship-combat"].starship.stations[0].type = "scanners";
  s.crew.skills = { computers: { mod: 30 } };
  dice(20);
  await executeAction({ ...s.payload, actionId: "seek-starships", user: s.user, options: { skill: "computers", skipDialog: true } });
  assert.equal(privateContacts(s.combat.id)[0].detection.party, "hidden");
  assert.equal(getTsc(s.combat).objects.find((o) => o.key === s.key).detection.party, "hidden");
  assertNoIdentity(s, getTsc(s.combat));
});

test("hidden starship attack uses ordinary AC resolution without identifying the contact", async () => {
  const s = await targetingScenario();
  await changePrivateContact(s.combat, s.key, "detect", "hidden");
  dice(20);
  const attack = await executeNativeAttack({ user: s.user, payload: s.payload });
  assert.ok(attack.messageId);
  assert.equal(privateContacts(s.combat.id)[0].detection.party, "hidden");
  const declaration = await declareAttack({ user: s.user, payload: s.payload });
  const card = game.messages.get(declaration.messageId).flags["sf2e-tactical-starship-combat"].attackCard;
  assert.equal(card.targets.find((o) => o.key === s.key)?.available, true);
});

test("observed anonymous projection is selectable before identification", async () => {
  const s = await targetingScenario();
  const tsc = getTsc(s.combat),
    obj = tsc.objects.find((o) => o.key === s.key);
  assert.equal(evaluateTarget({ tsc, shipKey: s.attacker.uuid, obj, range: 3 }).available, true);
  assertNoIdentity(s, tsc);
});
test("GM resolves anonymous ship identity privately, including private NPC attacker", async () => {
  const s = await targetingScenario();
  const before = structuredClone(s.combat.flags);
  const req = { ...s.payload, user: s.gm, dryRun: true, validateTarget: true };
  const result = await executeAction(req);
  assert.equal(result.ctx.target.actor, s.ship);
  assert.equal(result.ctx.target.key, s.key);
  assert.deepEqual(s.combat.flags, before);
  const npc = makeShip({
    id: "npc-attacker",
    role: "npc",
    extra: { strikes: [{ name: "Laser", kind: "ranged", attack: 10, damage: "1d6 fire", traits: ["range 3 zones"] }] }
  });
  await addPrivateContact(s.combat, npc, 2);
  const second = await executeAction({ ...req, shipUuid: npc.uuid, crewUuid: null, actionId: "npc-strike:laser" });
  assert.equal(second.ctx.target.actor, s.ship);
  assertNoIdentity(s, getTsc(s.combat));
});
test("native player attack resolves the private target without publishing binding or stats", async () => {
  const s = await targetingScenario();
  assertNoIdentity(s, await previewNativeAttack({ user: s.user, payload: s.payload }));
  dice(20);
  const result = await executeNativeAttack({ user: s.user, payload: s.payload });
  assertNoIdentity(s, result);
  assertNoIdentity(s, getTsc(s.combat));
  assert.equal(privateContacts(s.combat.id)[0].detection.party, "observed");
  const message = game.messages.get(result.messageId);
  assert.equal(message.flags["sf2e-tactical-starship-combat"].attackCard.boundDamage.targetUuid, s.ship.uuid);
  assert.ok(message.whisper.includes(s.gm.id));
  for (const msg of game.messages.contents.filter((m) => !m.whisper.length)) assertNoIdentity(s, msg.toObject ? msg.toObject() : msg);
  dice(2);
  await rollAttackCardDamage({ user: s.gm, payload: { messageId: result.messageId } });
  const sp = s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value;
  await applyAttackCardDamage({ user: s.gm, payload: { messageId: result.messageId } });
  assert.ok(s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value < sp);
  assertNoIdentity(s, getTsc(s.combat));
});
test("declaration candidates and resolved public card omit private actor metadata", async () => {
  const s = await targetingScenario();
  const declaration = await declareAttack({ user: s.user, payload: s.payload });
  const card = game.messages.get(declaration.messageId).flags["sf2e-tactical-starship-combat"].attackCard;
  const target = card.targets.find((o) => o.key === s.key);
  assert.equal(target.available, true);
  assert.equal(target.known, false);
  for (const field of ["actorUuid", "gmName", "ac", "baseAC", "acMods", "behind"]) assert.equal(field in target, false, field);
  assertNoIdentity(s, card);
  dice(20, 2);
  await resolveAttackCard({ user: s.user, payload: { messageId: declaration.messageId, targetKey: s.key, skipDialog: true } });
  assertNoIdentity(s, game.messages.get(declaration.messageId).flags);
  assertNoIdentity(s, getTsc(s.combat));
});
for (const scenario of [
  { name: "private hit", roll: 20, privateTarget: true, gmOnly: false, copies: 1, damage: 8 },
  { name: "private miss", roll: 1, privateTarget: true, gmOnly: false, copies: 1, damage: 0 },
  { name: "GM-only private hit", roll: 20, privateTarget: true, gmOnly: true, copies: 0, damage: 8 },
  { name: "public hit", roll: 20, privateTarget: false, gmOnly: false, copies: 0, damage: 8 }
]) {
  test(`Cosmic Cannon preserves a complete result for ${scenario.name}`, async () => {
    const s = await targetingScenario();
    s.attacker.flags["sf2e-tactical-starship-combat"].starship.stations[0].type = "magic-conduit";
    if (!scenario.privateTarget) await changePrivateContact(s.combat, s.key, "reveal");
    const targetKey = scenario.privateTarget ? s.key : s.ship.uuid;
    const declaration = await declareAttack({ user: s.user, payload: { ...s.payload, actionId: "cosmic-cannon" } });
    const publicMessage = game.messages.get(declaration.messageId);
    if (scenario.gmOnly) await publicMessage.update({ whisper: [s.gm.id] });
    const before = s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value;
    dice(scenario.roll, 2, 2);
    await resolveAttackCard({ user: s.user, payload: { messageId: declaration.messageId, targetKey, skipDialog: true } });
    const copies = game.messages.contents.filter(
      (message) => message.flags["sf2e-tactical-starship-combat"]?.attackCard?.applicationId === declaration.messageId
    );
    assert.equal(copies.length, scenario.copies);
    const resultMessage = copies[0] ?? publicMessage;
    const result = resultMessage.flags["sf2e-tactical-starship-combat"].attackCard.result;
    assert.ok(Number.isFinite(result.attack.total));
    assert.ok(Number.isFinite(result.attack.ac));
    assert.equal(
      result.damage.reduce((sum, damage) => sum + damage.shield, 0),
      scenario.damage
    );
    assert.equal(before - s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value, scenario.damage);
    if (scenario.privateTarget) {
      assert.ok(resultMessage.whisper.length && resultMessage.whisper.every((id) => game.users.get(id)?.isGM));
      for (const message of game.messages.contents.filter((m) => !m.whisper.length)) assertNoIdentity(s, message);
      assertNoIdentity(s, getTsc(s.combat));
      assert.equal(privateContacts(s.combat.id)[0].detection.party, "observed");
    }
  });
}

test("destroying a private target never publishes a history announcement", async () => {
  const s = await targetingScenario();
  await game.settings.set("sf2e-tactical-starship-combat", "chatAnnouncements", "important");
  s.ship.system.attributes.hp.value = 1;
  s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value = 0;
  dice(20, 6);
  await executeNativeAttack({ user: s.user, payload: { ...s.payload, options: { ...s.payload.options, sheetRoll: false } } });
  for (const msg of game.messages.contents.filter((m) => !m.whisper.length)) assertNoIdentity(s, msg);
});
test("private deferred damage refuses another combat without writes", async () => {
  const s = await targetingScenario();
  dice(20);
  const attack = await executeNativeAttack({ user: s.user, payload: s.payload });
  dice(2);
  await rollAttackCardDamage({ user: s.gm, payload: { messageId: attack.messageId } });
  const other = makeStarshipCombat({ objects: [{ key: s.attacker.uuid, zone: 2 }] });
  assert.notEqual(other.id, s.combat.id);
  const before = structuredClone(s.ship.flags);
  await assert.rejects(applyAttackCardDamage({ user: s.gm, payload: { messageId: attack.messageId } }));
  assert.deepEqual(s.ship.flags, before);
});
test("private result stays anonymous when the projection disappears during a roll", async () => {
  const s = await targetingScenario();
  const declaration = await declareAttack({ user: s.user, payload: s.payload });
  const evaluate = Roll.prototype.evaluate;
  let changed = false;
  Roll.prototype.evaluate = async function () {
    const result = await evaluate.call(this);
    if (!changed) {
      changed = true;
      await changePrivateContact(s.combat, s.key, "detect", "hidden");
    }
    return result;
  };
  try {
    dice(20);
    await resolveAttackCard({ user: s.user, payload: { messageId: declaration.messageId, targetKey: s.key, skipDialog: true } });
    assertNoIdentity(s, game.messages.get(declaration.messageId).flags);
  } finally {
    Roll.prototype.evaluate = evaluate;
  }
});
test("GM-whisper private sheet attack keeps its bound damage controls", async () => {
  const s = await targetingScenario();
  const npc = makeShip({
    id: "private-shooter",
    role: "npc",
    extra: { strikes: [{ name: "Laser", kind: "ranged", attack: 10, damage: "1d6 fire", traits: ["range 3 zones"] }] }
  });
  await addPrivateContact(s.combat, npc, 2);
  const declaration = await declareAttack({
    user: s.gm,
    payload: { ...s.payload, shipUuid: npc.uuid, crewUuid: null, actionId: "npc-strike:laser" }
  });
  dice(20);
  await resolveAttackCard({ user: s.gm, payload: { messageId: declaration.messageId, targetKey: s.key, skipDialog: true } });
  assert.ok(game.messages.get(declaration.messageId).flags["sf2e-tactical-starship-combat"].attackCard.result.pendingDamage);
});
test("Area Fire damages a hazard in the burst with its native Reflex save", async () => {
  const s = await targetingScenario();
  const hazard = new MockActor({
    id: "area-hazard",
    name: "Area Hazard",
    type: "hazard",
    system: {
      attributes: { hp: { value: 20, max: 20 }, ac: { value: 14 }, hardness: 0, hasHealth: true },
      saves: { fortitude: { value: 5 }, reflex: { value: 0 }, will: { value: 4 } }
    }
  });
  game.actors.set(hazard.id, hazard);
  const objects = s.combat.flags["sf2e-tactical-starship-combat"].tsc.objects;
  objects.push({ key: hazard.uuid, actorUuid: hazard.uuid, type: "hazard", zone: 3, detection: { party: "identified" } });
  await s.combat.update({ [`flags.${M}.tsc.objects`]: objects });
  Object.assign(s.attacker.flags[M].starship.weapons[0], {
    traits: ["area (burst 1 zone)"],
    range: 3,
    die: "1d6",
    damageType: "fire"
  });
  dice(6, 1, 1);

  await executeAction({ ...s.payload, actionId: "area-fire", user: s.user, options: { ...s.payload.options, areaOrigin: 3 } });

  assert.equal(hazard.system.attributes.hp.value, 8, "failed basic Reflex doubles the 6 damage");
  assert.equal(hazard.flags[M]?.starship, undefined);
});

for (const choice of ["include", "exclude", "cancel"]) {
  test(`Area Fire ${choice}s an undetected private ship only through the GM dialog`, async () => {
    const s = await targetingScenario();
    await changePrivateContact(s.combat, s.key, "detect", "undetected");
    Object.assign(s.attacker.flags["sf2e-tactical-starship-combat"].starship.weapons[0], {
      traits: ["area (burst 1 zone)"],
      range: 3,
      die: "1d6",
      damageType: "fire"
    });
    let prompted = 0;
    foundry.applications.api.DialogV2.prompt = async (options) => {
      prompted++;
      assert.ok(options.content.includes(s.ship.name));
      return choice === "cancel" ? null : choice === "include" ? [s.key] : [];
    };
    const before = structuredClone(s.ship.flags);
    dice(6, 1);
    const result = await executeAction({
      ...s.payload,
      actionId: "area-fire",
      user: s.user,
      options: { ...s.payload.options, areaOrigin: 3, areaIncludeKeys: [s.key] }
    });
    assert.equal(prompted, 1);
    assert.equal(result.cancelled === true, choice === "cancel");
    if (choice === "include")
      assert.ok(
        s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value < before["sf2e-tactical-starship-combat"].starship.sp.value
      );
    else assert.deepEqual(s.ship.flags, before);
    assert.equal(privateContacts(s.combat.id)[0].detection.party, "undetected");
    assert.equal(
      getTsc(s.combat).objects.some((o) => o.key === s.key),
      false
    );
  });
}

test("area exclusion UI offers anonymous hidden and observed private starships", async () => {
  const s = await targetingScenario();
  const { runAction } = await import("../../scripts/ui/action-runner.mjs");
  for (const level of ["hidden", "observed"]) {
    await changePrivateContact(s.combat, s.key, "detect", level);
    game.user = s.user;
    let displayed = "";
    foundry.applications.api.DialogV2.prompt = async (options) => {
      displayed = options.content;
      return null;
    };
    await runAction(
      { id: "area-fire", builtin: "area-fire" },
      {
        ship: s.attacker,
        crew: s.crew,
        station: s.attacker.flags["sf2e-tactical-starship-combat"].starship.stations[0]
      }
    );
    assert.match(displayed, /name="areaExclude\.0"/);
    assert.match(displayed, /Contact/);
    assertNoIdentity(s, displayed);
    game.user = s.gm;
  }
});

test("Area Fire automatically resolves hidden private ships without publishing their Actor identity", async () => {
  const s = await targetingScenario();
  await changePrivateContact(s.combat, s.key, "detect", "hidden");
  Object.assign(s.attacker.flags["sf2e-tactical-starship-combat"].starship.weapons[0], {
    traits: ["area (burst 1 zone)"],
    range: 3,
    die: "1d6",
    damageType: "fire"
  });
  const before = s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value;
  dice(6, 1);
  await executeAction({ ...s.payload, actionId: "area-fire", user: s.user, options: { ...s.payload.options, areaOrigin: 3 } });
  assert.ok(s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value < before);
  assert.equal(privateContacts(s.combat.id)[0].detection.party, "hidden");
  for (const message of game.messages.contents.filter((m) => !m.whisper.length)) assertNoIdentity(s, message);
});

for (const actionId of ["area-fire", "auto-fire"]) {
  test(`${actionId} requires GM selection for public undetected ships too`, async () => {
    const s = await targetingScenario();
    await changePrivateContact(s.combat, s.key, "reveal");
    const target = s.combat.flags["sf2e-tactical-starship-combat"].tsc.objects.find((o) => o.actorUuid === s.ship.uuid);
    target.detection.party = "undetected";
    Object.assign(s.attacker.flags["sf2e-tactical-starship-combat"].starship.weapons[0], {
      traits: ["area (burst 1 zone)"],
      range: 3,
      die: "1d6",
      damageType: "fire"
    });
    if (actionId === "auto-fire") s.attacker.flags["sf2e-tactical-starship-combat"].starship.weapons[0].traits.push("automatic");
    for (const include of [false, true]) {
      let prompts = 0;
      foundry.applications.api.DialogV2.prompt = async () => {
        prompts++;
        return include ? [target.key] : [];
      };
      const before = s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value;
      dice(6, 1);
      await executeAction({ ...s.payload, actionId, user: s.user, options: { ...s.payload.options, areaOrigin: 3 } });
      assert.equal(prompts, 1);
      assert.equal(s.ship.flags["sf2e-tactical-starship-combat"].starship.sp.value < before, include);
      assert.equal(getTsc(s.combat).objects.find((o) => o.key === target.key).detection.party, "undetected");
    }
  });
}

test("undetected area choice is revalidated after the GM dialog before any damage", async () => {
  const s = await targetingScenario();
  await changePrivateContact(s.combat, s.key, "detect", "undetected");
  Object.assign(s.attacker.flags["sf2e-tactical-starship-combat"].starship.weapons[0], {
    traits: ["area (burst 1 zone)"],
    range: 3,
    die: "1d6",
    damageType: "fire"
  });
  foundry.applications.api.DialogV2.prompt = async () => {
    await changePrivateContact(s.combat, s.key, "move", 9);
    return [s.key];
  };
  const before = structuredClone(s.ship.flags);
  await assert.rejects(
    executeAction({ ...s.payload, actionId: "area-fire", user: s.user, options: { ...s.payload.options, areaOrigin: 3 } }),
    /stale|changed/i
  );
  assert.deepEqual(s.ship.flags, before);
  assert.equal(game.messages.size, 0);
});

test("a target entering the area during the GM dialog invalidates the attack before damage", async () => {
  const s = await targetingScenario();
  await changePrivateContact(s.combat, s.key, "detect", "undetected");
  Object.assign(s.attacker.flags["sf2e-tactical-starship-combat"].starship.weapons[0], {
    traits: ["area (burst 1 zone)"],
    range: 3,
    die: "1d6",
    damageType: "fire"
  });
  const incoming = makeShip({ id: "incoming", role: "npc" });
  s.combat.flags["sf2e-tactical-starship-combat"].tsc.objects.push({
    key: incoming.uuid,
    actorUuid: incoming.uuid,
    type: "starship",
    zone: 9,
    detection: { party: "observed" }
  });
  foundry.applications.api.DialogV2.prompt = async () => {
    const state = getTsc(s.combat);
    state.objects.find((o) => o.key === incoming.uuid).zone = 3;
    await s.combat.update({ "flags.sf2e-tactical-starship-combat.tsc": state });
    return [s.key];
  };
  const before = structuredClone([s.ship.flags, incoming.flags]);
  await assert.rejects(
    executeAction({ ...s.payload, actionId: "area-fire", user: s.user, options: { ...s.payload.options, areaOrigin: 3 } }),
    /stale|changed/i
  );
  assert.deepEqual([s.ship.flags, incoming.flags], before);
  assert.equal(game.messages.size, 0);
});

test("Area Fire does not consume the GM-only targeting identity overlay", async () => {
  const s = await targetingScenario();
  const result = await executeAction({
    ...s.payload,
    actionId: "area-fire",
    user: s.gm,
    dryRun: true,
    options: { ...s.payload.options, gmOverride: true }
  });
  assert.equal(result.ctx.tsc.objects.find((o) => o.key === s.key).type, "contact");
});

test("Target Lock applies effects without identifying or exposing a private target", async () => {
  const s = await targetingScenario();
  const data = s.attacker.flags["sf2e-tactical-starship-combat"].starship;
  data.stations[0].type = "scanners";
  dice(1);
  await executeAction({ ...s.payload, actionId: "target-lock", user: s.user });
  assert.ok(s.ship.flags["sf2e-tactical-starship-combat"].starship.effects.length);
  assert.equal(privateContacts(s.combat.id)[0].detection.party, "observed");
  assertNoIdentity(s, getTsc(s.combat));
  for (const msg of game.messages.contents) assert.ok(msg.whisper.includes(s.gm.id));
});
test("Scan Target uses the existing private reveal path only after identification", async () => {
  const s = await targetingScenario();
  Object.assign(s.attacker.flags["sf2e-tactical-starship-combat"].starship.stations[0], { type: "scanners", grade: "tactical" });
  s.crew.skills = { computers: { mod: 30 } };
  dice(20);
  await executeAction({ ...s.payload, actionId: "scan-target", user: s.user });
  assert.equal(privateContacts(s.combat.id).length, 0);
  assert.equal(getTsc(s.combat).objects.find((o) => o.actorUuid === s.ship.uuid)?.detection.party, "identified");
  assert.equal(viewFor(getTsc(s.combat)).find((o) => o.key === s.ship.uuid)?.known, true);
});

test("private undetected targets are revalidated and cannot use a direct-target override", async () => {
  for (const level of ["undetected"]) {
    const s = await targetingScenario();
    await changePrivateContact(s.combat, s.key, "detect", level);
    for (const user of [s.user, s.gm])
      await assert.rejects(previewNativeAttack({ user, payload: { ...s.payload, options: { ...s.payload.options, gmOverride: true } } }));
    assert.equal(game.messages.size, 0);
  }
});
test("anonymous custom markers and hazards do not resolve as starships", async () => {
  const s = await targetingScenario();
  const marker = await addPrivateCustom(s.combat, "Secret marker", 3);
  await changePrivateContact(s.combat, marker, "detect", "observed");
  for (const key of [marker, s.ship.uuid, "private-forged"])
    await assert.rejects(
      previewNativeAttack({ user: s.user, payload: { ...s.payload, options: { ...s.payload.options, targetKey: key } } })
    );
  assert.equal(game.messages.size, 0);
});
test("executeAction socket replies redact private target reports and summaries", async () => {
  const s = await targetingScenario();
  registerActionHandlers();
  const replies = [];
  dice(20);
  await dispatchSocketMessage(
    { kind: "request", type: "executeAction", requestId: "private-action", userId: s.user.id, payload: s.payload },
    s.user.id,
    { users: game.users, selfId: s.gm.id, isActiveGM: true, clientEvents: new Map(), emit: (msg) => replies.push(msg) }
  );
  assert.equal(replies.at(-1).ok, true);
  assertNoIdentity(s, replies);
  assertNoIdentity(s, getTsc(s.combat));
});

function setup() {
  const ctx = installFoundryMock();
  return { ctx, combat: makeStarshipCombat(), ship: makeShip({ id: "secret", name: "Secret Dreadnought", role: "npc" }) };
}
test("intermediate detection projects approved anonymous metadata; move, hide, reveal and remove", async () => {
  const { combat, ship } = setup();
  await addPrivateContact(combat, ship, 4);
  const { key } = privateContacts(combat.id)[0];
  await changePrivateContact(combat, key, "detect", "hidden");
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(getTsc(combat).objects[0].art, undefined);
  assert.equal(getTsc(combat).objects[0].heading, null);
  await changePrivateContact(combat, key, "detect", "observed");
  const text = JSON.stringify(combat.flags);
  for (const secret of [ship.name, ship.uuid]) assert.equal(text.includes(secret), false);
  assert.equal(getTsc(combat).objects[0].art, ship.img);
  assert.equal(viewFor(getTsc(combat))[0].known, false);
  await changePrivateContact(combat, key, "move", 6);
  assert.equal(getTsc(combat).objects[0].zone, 6);
  await changePrivateContact(combat, key, "detect", "undetected");
  assert.equal(getTsc(combat).objects.length, 0);
  await changePrivateContact(combat, key, "detect", "observed");
  await changePrivateContact(combat, key, "reveal");
  assert.equal(getTsc(combat).objects.length, 1);
  assert.equal(getTsc(combat).objects[0].actorUuid, ship.uuid);
  assert.equal(privateContacts(combat.id).length, 0);
  assert.deepEqual(globalThis.__socket, []);
});
test("custom private contacts can be renamed, detected and removed without publishing identity", async () => {
  const { combat } = setup();
  const key = await addPrivateCustom(combat, "Secret mine", 2);
  await changePrivateContact(combat, key, "rename", "Secret anomaly");
  await changePrivateContact(combat, key, "detect", "observed");
  assert.equal(JSON.stringify(combat.flags).includes("Secret"), false);
  await changePrivateContact(combat, key, "remove");
  assert.deepEqual(getTsc(combat).objects, []);
  assert.deepEqual(privateContacts(combat.id), []);
});
test("hazard API places unopened Actor privately; unsafe public modes fail", async () => {
  const { combat } = setup();
  const hazard = new MockActor({ id: "h", type: "hazard", name: "Secret hazard" });
  game.actors.set(hazard.id, hazard);
  await placeHazard(hazard, { zone: 3 });
  assert.equal(privateContacts(combat.id)[0].actorUuid, hazard.uuid);
  assert.equal(JSON.stringify(combat.flags).includes(hazard.uuid), false);
  await assert.rejects(placeHazard(hazard, { map: "both" }));
  await assert.rejects(placeHazard(hazard, { detection: "observed", publicActor: true }));
});
test("partial projection failure can be reconciled without exposing an Actor", async () => {
  const { combat, ship } = setup();
  await addPrivateContact(combat, ship, 4);
  const key = privateContacts(combat.id)[0].key,
    doc = game.journal.contents[0],
    update = doc.update.bind(doc);
  doc.update = async () => {
    throw new Error("failed");
  };
  await assert.rejects(changePrivateContact(combat, key, "detect", "observed"));
  assert.equal(getTsc(combat).objects.length, 1);
  doc.update = update;
  await changePrivateContact(combat, key, "detect", "undetected");
  assert.equal(getTsc(combat).objects.length, 0);
  assert.equal(JSON.stringify(combat.flags).includes(ship.uuid), false);
});
test("private contact store follows Foundry JournalEntry permissions", async () => {
  const { combat, ship } = setup();
  await addPrivateContact(combat, ship, 2);
  const journal = game.journal.contents[0];
  assert.equal(journal.ownership.default, 0);
  assert.equal(journal.testUserPermission(game.users.get("p1"), "LIMITED"), false);
  journal.ownership.p1 = 2;
  assert.throws(() => privateContacts(combat.id));
});
test("legacy GM zone notes are retained, not overwritten from a socket payload", () => {
  const before = { zoneInfo: { 1: { gmNotes: "old", oldField: 1 } } };
  const after = applySensorOp(before, { op: "zoneInfo", zone: 1, info: { gmNotes: "new" } });
  assert.equal(after.zoneInfo[1].gmNotes, "old");
  assert.equal(after.zoneInfo[1].oldField, 1);
});
test("Install Mine rejects stale plan replacement while replay remains idempotent", () => {
  const data = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op" }],
    upgrades: [{ ref: "mine-deployment-shell", stationId: "s" }],
    drones: [{ id: "d", stationId: "s", ref: "pyrotechnics-drone", deployed: false, tscVersion: 1 }]
  };
  const req = {
    stationId: "s",
    droneId: "d",
    operatorUuid: "Actor.op",
    entries: [{ mine: "A", mod: "Big Boom" }],
    operationId: "install-12345678",
    expectedPlanFingerprint: null,
    confirmed: true
  };
  assert.equal(saveInstallMinePlan(data, req), true);
  const before = structuredClone(data);
  assert.equal(saveInstallMinePlan(data, req), false);
  assert.throws(() => saveInstallMinePlan(data, { ...req, operationId: "install-87654321" }), /stale/);
  assert.deepEqual(data, before);
});
