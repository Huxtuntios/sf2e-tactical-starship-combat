import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  dice,
  installFoundryMock,
  loadContentFromDisk,
  makeCharacter,
  makeShip,
  makeStarshipCombat,
  MockActor
} from "../helpers/foundry-mock.mjs";
const M = "sf2e-tactical-starship-combat";
let cardRequest;
let cardTargetKeys;
let resolutionTargetUUIDs;
let Targeting;
let registerNativeTargeting;
let SensorMapApplication;
let runAction;
let registerHandler;
let declareAttack;
let resolveAttackCard;
let cardResolutionPayload;

async function loadModules() {
  if (Targeting) return;
  ({ cardRequest, cardTargetKeys, resolutionTargetUUIDs } = await import("../../scripts/chat/attack-card/model.mjs"));
  ({ Targeting, registerNativeTargeting } = await import("../../scripts/ui/targeting.mjs"));
  ({ SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs"));
  ({ runAction } = await import("../../scripts/ui/action-runner.mjs"));
  ({ registerHandler } = await import("../../scripts/socket.mjs"));
  ({ declareAttack, resolveAttackCard } = await import("../../scripts/chat/attack-card/service.mjs"));
  ({ cardResolutionPayload } = await import("../../scripts/chat/attack-card/client.mjs"));
}

function nativeToken(actor, id, { visible = true } = {}) {
  return {
    id,
    actor,
    visible,
    document: { actorUuid: actor?.uuid ?? null, uuid: `Scene.test.Token.${id}` },
    setTarget(targeted, { releaseOthers = true } = {}) {
      if (targeted) {
        if (releaseOthers) game.user.targets.clear();
        game.user.targets.add(this);
      } else game.user.targets.delete(this);
    }
  };
}

async function mapScenario({ isGM = false } = {}) {
  installFoundryMock();
  await loadModules();
  await loadContentFromDisk();
  game.user = game.users.get(isGM ? "gm" : "p1");
  Targeting.end();
  const ship = makeShip({ id: "ui-ship", name: "UI Ship", owners: ["p1"] });
  const target = makeShip({ id: "ui-target", name: "UI Target", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 1, alwaysVisible: true, detection: { party: "identified" } },
      { key: target.uuid, zone: 2, detection: { party: "identified" } },
      { key: "Contact.ui-map-only", type: "starship", zone: 3, detection: { party: "identified" } }
    ]
  });
  const token = nativeToken(target, "ui-token");
  game.user.targets = new Set();
  canvas.ready = true;
  canvas.scene = { id: "ui-scene" };
  canvas.tokens.placeables = [token];
  Targeting.begin({ shipUuid: ship.uuid, range: 99, enforceDetection: true, allowSelf: false, gm: isGM });
  return { ship, target, combat, token, app: new SensorMapApplication() };
}

test("native targetToken hook refreshes module UI and removes a newly invalid player target", async () => {
  const { target, combat, token } = await mapScenario();
  registerNativeTargeting();
  registerNativeTargeting();
  assert.equal(Hooks._hooks.get("targetToken").length, 1);

  game.user.targets.add(token);
  Hooks.callAll("targetToken", game.user, token, true);
  assert.equal(game.user.targets.has(token), true);

  combat.flags[M].tsc.objects.find((o) => o.key === target.uuid).detection = { party: "undetected" };
  game.user.targets.add(token);
  Hooks.callAll("targetToken", game.user, token, true);
  assert.equal(game.user.targets.has(token), false);
});

test("English KeyT targets hovered Sensor Map starships and hazards with additive Shift", async () => {
  const { target, combat, token, app } = await mapScenario();
  const hazard = new MockActor({ id: "ui-hazard", name: "Hazard", type: "hazard" });
  game.actors.set(hazard.id, hazard);
  combat.flags[M].tsc.objects.push({
    key: hazard.uuid,
    actorUuid: hazard.uuid,
    type: "hazard",
    zone: 3,
    detection: { party: "identified" }
  });
  const second = makeShip({ id: "ui-second", name: "Second", role: "npc" });
  combat.flags[M].tsc.objects.push({
    key: second.uuid,
    actorUuid: second.uuid,
    type: "starship",
    zone: 4,
    detection: { party: "identified" }
  });
  const secondToken = nativeToken(second, "ui-second-token");
  const hazardToken = nativeToken(hazard, "ui-hazard-token");
  canvas.tokens.placeables.push(secondToken, hazardToken);
  const actions = [];
  game.keybindings = {
    register(namespace, action, config) {
      actions.push({ namespace, action, config });
    }
  };
  globalThis.CONST = { KEYBINDING_PRECEDENCE: { PRIORITY: 0, NORMAL: 1, DEFERRED: 2 } };
  registerNativeTargeting();

  const binding = actions.find((entry) => entry.namespace === M && entry.action === "targetSensorMap");
  assert.ok(binding, "the module registers an English KeyT Sensor Map target binding");
  assert.deepEqual(binding.config.editable, [{ key: "KeyT" }]);
  assert.ok(binding.config.reservedModifiers.includes("Shift"));
  assert.equal(binding.config.precedence, 0);

  Targeting.hoverKey = target.uuid;
  assert.equal(binding.config.onDown({ isShift: false }), true);
  Targeting.hoverKey = second.uuid;
  assert.equal(binding.config.onDown({ isShift: true }), true);
  assert.deepEqual(Targeting.targetUUIDs(), [target.uuid, second.uuid]);
  assert.deepEqual([...game.user.targets], [token, secondToken]);

  Targeting.hoverKey = hazard.uuid;
  assert.equal(binding.config.onDown({ isShift: true }), true);
  assert.deepEqual(Targeting.targetUUIDs(), [target.uuid, second.uuid, hazard.uuid]);
  assert.deepEqual([...game.user.targets], [token, secondToken, hazardToken]);

  Targeting.hoverKey = null;
  assert.equal(binding.config.onDown({ isShift: false }), false, "core canvas targeting remains available outside Sensor Map objects");
  app._cleanup();
});

test("Sensor Map marks targeted starships, hazards and tokenless contacts", async () => {
  const { ship, target, combat, token, app } = await mapScenario();
  const hazard = new MockActor({ id: "marked-hazard", name: "Marked Hazard", type: "hazard" });
  game.actors.set(hazard.id, hazard);
  combat.flags[M].tsc.objects.push({
    key: hazard.uuid,
    actorUuid: hazard.uuid,
    type: "hazard",
    zone: 4,
    detection: { party: "identified" }
  });
  const hazardToken = nativeToken(hazard, "marked-hazard-token");
  canvas.tokens.placeables.push(hazardToken);
  token.setTarget(true);
  Targeting.pick("Contact.ui-map-only", combat.flags[M].tsc, { additive: true });
  Targeting.pick(hazard.uuid, combat.flags[M].tsc, { additive: true });
  app.selected = ship.uuid;

  const context = await app._prepareContext({ parts: ["zones"] });
  const objects = new Map(context.zones.flatMap((zone) => zone.objects).map((object) => [object.key, object]));
  assert.equal(objects.get(ship.uuid).selected, true);
  assert.equal(objects.get(ship.uuid).targeted, false, "ordinary detail selection is not a target");
  for (const key of [target.uuid, hazard.uuid, "Contact.ui-map-only"]) {
    assert.equal(objects.get(key).selected, true);
    assert.equal(objects.get(key).targeted, true, `${key} has an explicit target marker`);
  }

  const template = fs.readFileSync(new URL("../../templates/sensor-map-zones.hbs", import.meta.url), "utf8");
  assert.match(template, /data-object-key="\{\{key\}\}"[\s\S]*?tsc-obj-target-marker/);
  app._cleanup();
});

test("Sensor Map context reflects native Token targets and survives rerender without resetting them", async () => {
  const { target, token, app } = await mapScenario();
  token.setTarget(true);

  const first = await app._prepareContext({ parts: ["zones"] });
  const second = await app._prepareContext({ parts: ["zones"] });

  assert.equal(first.zones.flatMap((zone) => zone.objects).find((o) => o.key === target.uuid).selected, true);
  assert.equal(second.zones.flatMap((zone) => zone.objects).find((o) => o.key === target.uuid).selected, true);
  assert.deepEqual([...game.user.targets], [token]);
  app._cleanup();
});

test("Sensor Map context reflects tokenless contact selection without creating a Token", async () => {
  const { combat, app } = await mapScenario();
  const tokenCount = canvas.tokens.placeables.length;

  Targeting.pick("Contact.ui-map-only", combat.flags[M].tsc, { additive: true });
  const context = await app._prepareContext({ parts: ["zones"] });

  assert.equal(context.zones.flatMap((zone) => zone.objects).find((o) => o.key === "Contact.ui-map-only").selected, true);
  assert.equal(canvas.tokens.placeables.length, tokenCount);
  app._cleanup();
});

test("target execution resolves the current native list at click time, not the list captured by a window", async () => {
  const { ship, target, token } = await mapScenario();
  const other = makeShip({ id: "ui-other", name: "Other", role: "npc" });
  const otherToken = nativeToken(other, "ui-other-token");
  canvas.tokens.placeables.push(otherToken);
  token.setTarget(true);
  let received;
  Targeting.begin({ shipUuid: ship.uuid, onExecute: (keys) => (received = keys) });
  otherToken.setTarget(true, { releaseOthers: false });

  await Targeting.execute();

  assert.deepEqual(received, [target.uuid, other.uuid]);
});

test("runAction sends current targetUUIDs without requiring another map pick", async () => {
  installFoundryMock();
  await loadModules();
  await loadContentFromDisk();
  game.user = game.users.get("gm");
  Targeting.end();
  const crew = makeCharacter({ id: "ui-crew", name: "UI Crew", owners: ["p1"] });
  const ship = makeShip({
    id: "run-action-ship",
    name: "Run Action Ship",
    role: "player",
    stations: [{ id: "science", name: "Science", type: "science", grade: "commercial", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, name: crew.name, role: "crew", stationId: "science", userId: "p1" }]
  });
  const target = makeShip({ id: "run-action-target", name: "Run Action Target", role: "npc" });
  makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 1, alwaysVisible: true, detection: { party: "identified" } },
      { key: target.uuid, zone: 2, detection: { party: "identified" } }
    ]
  });
  const token = nativeToken(target, "run-action-token");
  game.user.targets = new Set([token]);
  canvas.tokens.placeables = [token];
  let captured;
  registerHandler("executeAction", async ({ payload }) => {
    captured = payload;
    return { ok: true };
  });

  await runAction(
    { id: "lock-on", name: "Lock On", station: "science", targeting: { type: "starship", range: "sensor" } },
    { ship, crew, station: ship.flags[M].starship.stations[0] }
  );

  assert.deepEqual(captured.options.targetUUIDs, [target.uuid]);
  assert.equal(Targeting.current, null);
});

test("attack card request keeps targets mutable and resolution accepts a deduplicated current list", async () => {
  installFoundryMock();
  await loadModules();
  assert.deepEqual(
    cardRequest({
      shipUuid: "Actor.ship",
      actionId: "strike",
      options: { targetKey: "Actor.old", targetUUIDs: ["Actor.old"], gmOverride: true }
    }),
    { shipUuid: "Actor.ship", actionId: "strike", crewUuid: undefined, stationId: undefined, options: {} }
  );
  assert.deepEqual(resolutionTargetUUIDs({ targetUUIDs: ["Actor.one", "Actor.one", 3, "Actor.two"] }), ["Actor.one", "Actor.two"]);
  assert.deepEqual(resolutionTargetUUIDs({ targetKey: "Actor.legacy" }), ["Actor.legacy"]);
  assert.deepEqual(cardTargetKeys([{ key: "Actor.one" }, { key: "Actor.two" }], ["Actor.two"]), ["Actor.two"]);
  assert.deepEqual(cardResolutionPayload("message", ["Actor.one"], "2", { event: ["quick"] }), {
    messageId: "message",
    targetKey: "Actor.one",
    targetUUIDs: ["Actor.one"],
    mapChoice: "2",
    event: ["quick"]
  });
});

test("attack card service consumes targetUUIDs, drops stale duplicates, and records the resolved target list", async () => {
  installFoundryMock();
  await loadModules();
  await loadContentFromDisk();
  Targeting.end();
  const crew = makeCharacter({ id: "card-crew", name: "Card Crew", owners: ["p1"] });
  const ship = makeShip({
    id: "card-ship",
    name: "Card Ship",
    role: "player",
    stations: [{ id: "gun", name: "Gunnery", type: "gunnery", grade: "commercial", helmedBy: crew.uuid, weaponId: "w1" }],
    weapons: [{ id: "w1", weaponRef: "coilgun", name: "Coilgun" }],
    crew: [{ actorUuid: crew.uuid, name: crew.name, role: "crew", stationId: "gun", userId: "p1" }]
  });
  const target = makeShip({ id: "card-target", name: "Card Target", role: "npc", sp: 10, hp: 20 });
  const stale = makeShip({ id: "card-stale", name: "Card Stale", role: "npc" });
  makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 2, alwaysVisible: true, detection: { party: "identified" } },
      { key: target.uuid, zone: 3, detection: { party: "identified" } },
      { key: stale.uuid, zone: 3, detection: { party: "identified" } }
    ]
  });
  const user = game.users.get("p1");
  const { messageId } = await declareAttack({
    user,
    payload: { shipUuid: ship.uuid, actionId: "strike", crewUuid: crew.uuid, stationId: "gun", options: {} }
  });
  game.actors.delete(stale.id);
  dice(19, 5);

  await resolveAttackCard({ user, payload: { messageId, targetUUIDs: [stale.uuid, target.uuid, target.uuid] } });

  const card = game.messages.get(messageId).flags[M].attackCard;
  assert.equal(card.status, "resolved");
  assert.deepEqual(card.result.targetUUIDs, [target.uuid]);
  assert.equal(card.result.targetKey, target.uuid);
  assert.equal(target.flags[M].starship.sp.value, 5);
});

test("Sensor Map click forwards Shift as additive native selection", async () => {
  const { target, token, combat, app } = await mapScenario();
  const other = makeShip({ id: "ui-shift-target", name: "Shift Target", role: "npc" });
  const otherToken = nativeToken(other, "ui-shift-token");
  combat.flags[M].tsc.objects.push({
    key: other.uuid,
    actorUuid: other.uuid,
    type: "starship",
    zone: 3,
    detection: { party: "identified" }
  });
  canvas.tokens.placeables.push(otherToken);
  const select = SensorMapApplication.DEFAULT_OPTIONS.actions.selectObject;

  await select.call(app, { shiftKey: false }, { dataset: { objectKey: target.uuid } });
  await select.call(app, { shiftKey: true }, { dataset: { objectKey: other.uuid } });

  assert.deepEqual(
    [...game.user.targets].map((entry) => entry.id),
    [token.id, otherToken.id]
  );
  app._cleanup();
});
