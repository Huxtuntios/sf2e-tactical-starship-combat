import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import { addPrivateContact, addPrivateCustom, changePrivateContact, privateContacts } from "../../scripts/sensor/private-contacts.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { viewFor } from "../../scripts/engine/sensor-ops.mjs";
import { applySensorOp } from "../../scripts/sensor/map-model.mjs";
import { placeHazard } from "../../scripts/hazards/hazard-engine.mjs";
import { saveInstallMinePlan } from "../../scripts/actions/install-mine-plan.mjs";
import { loadContentFromDisk, makeCharacter, dice } from "../helpers/foundry-mock.mjs";
import { evaluateTarget } from "../../scripts/engine/target-rules.mjs";
import { executeAction, registerActionHandlers } from "../../scripts/actions/action-engine.mjs";
import { previewNativeAttack, executeNativeAttack } from "../../scripts/chat/native-attack.mjs";
import { declareAttack, resolveAttackCard, rollAttackCardDamage, applyAttackCardDamage } from "../../scripts/chat/attack-card/service.mjs";
import { dispatchSocketMessage } from "../../scripts/socket.mjs";

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
  for (const secret of [s.ship.uuid, s.ship.name, s.ship.img]) assert.equal(text.includes(secret), false, secret);
}

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

test("private targets are revalidated after selection and never bypass hidden restrictions", async () => {
  for (const level of ["hidden", "undetected"]) {
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
test("intermediate detection projects only anonymous position; move, hide, reveal and remove", async () => {
  const { combat, ship } = setup();
  await addPrivateContact(combat, ship, 4);
  const { key } = privateContacts(combat.id)[0];
  await changePrivateContact(combat, key, "detect", "hidden");
  assert.equal(getTsc(combat).objects.length, 0);
  await changePrivateContact(combat, key, "detect", "observed");
  const text = JSON.stringify(combat.flags);
  for (const secret of [ship.name, ship.uuid, ship.img]) assert.equal(text.includes(secret), false);
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
