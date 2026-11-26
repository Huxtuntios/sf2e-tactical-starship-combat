import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import { addSensorContact } from "../../scripts/sensor/contact-service.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { executeAction } from "../../scripts/actions/action-engine.mjs";
import { registerHandler } from "../../scripts/socket.mjs";

const M = "sf2e-tactical-starship-combat";
const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function hazard(id, { complex = false } = {}) {
  const actor = new MockActor({
    id,
    name: id,
    type: "hazard",
    flags: {
      [M]: {
        starshipHazard: {
          isStarshipHazard: true,
          isComplex: complex,
          ...(complex
            ? { routine: { cost: "2 actions", text: "The hazard performs its routine." } }
            : { effectText: "The hazard triggers its effect." })
        }
      }
    }
  });
  game.actors.set(actor.id, actor);
  return actor;
}

async function scenario({ isGM = true } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const { Targeting } = await import("../../scripts/ui/targeting.mjs");
  game.user = game.users.get("gm");
  Targeting.end();
  const player = makeShip({ id: "gm-player", name: "Player Ship", role: "player", owners: ["p1"] });
  const nativeTarget = makeShip({ id: "gm-native-target", name: "Native Target", role: "npc" });
  const npcSource = makeShip({
    id: "gm-npc-source",
    name: "Map-only NPC",
    role: "npc",
    stations: [{ id: "scanner", name: "Scanners", type: "scanners", grade: "commercial", actions: ["Inline Ram"] }],
    extra: { npcActions: [{ name: "Inline Ram", cost: "one-action", text: "Ram the selected target manually." }] }
  });
  const simpleSource = hazard("gm-simple-source");
  const complexSource = hazard("gm-complex-source", { complex: true });
  const combat = makeStarshipCombat({
    objects: [
      { key: player.uuid, zone: 2, detection: { party: "identified" } },
      { key: nativeTarget.uuid, zone: 4, detection: { party: "identified" } },
      { key: "gm-custom", type: "custom", name: "Custom Object", zone: 3, detection: { party: "identified" } }
    ]
  });
  const npc = await addSensorContact(combat, {
    source: "world",
    uuid: npcSource.uuid,
    zone: 3,
    detection: "identified",
    publicActor: true
  });
  const simple = await addSensorContact(combat, {
    source: "world",
    uuid: simpleSource.uuid,
    zone: 3,
    detection: "identified",
    publicActor: true
  });
  const complex = await addSensorContact(combat, {
    source: "world",
    uuid: complexSource.uuid,
    zone: 3,
    detection: "identified",
    publicActor: true
  });
  const app = new SensorMapApplication();
  app.autoActionSelection = false;
  if (!isGM) game.user = game.users.get("p1");
  return { app, combat, player, nativeTarget, npcSource, npc, simpleSource, simple, complexSource, complex, Targeting };
}

function nativeToken(actor) {
  return {
    id: `token-${actor.id}`,
    actor,
    visible: true,
    document: { actorUuid: actor.uuid, uuid: `Scene.test.Token.${actor.id}` },
    setTarget(targeted, { releaseOthers = true } = {}) {
      if (targeted) {
        if (releaseOthers) game.user.targets.clear();
        game.user.targets.add(this);
      } else game.user.targets.delete(this);
    }
  };
}

function templates() {
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => game.i18n.localize(key));
  return {
    bar: h.compile(read("templates/sensor-map-bar.hbs")),
    zones: h.compile(read("templates/sensor-map-zones.hbs")),
    dock: h.compile(read("templates/sensor-map-dock.hbs"))
  };
}

test("GM selector lists player and map-only starships/hazards with zone and within-zone order", async (t) => {
  const { app, player, nativeTarget, npc, simple, complex } = await scenario();
  t.after(() => app._cleanup());
  app.actionObjectKey = npc.key;

  const context = await app._prepareContext({ parts: ["bar", "zones", "dock"] });

  assert.deepEqual(
    context.actionObjects.map((object) => [object.key, object.type, object.zone, object.order]),
    [
      [player.uuid, "starship", 2, 1],
      [nativeTarget.uuid, "starship", 4, 1],
      [npc.key, "starship", 3, 2],
      [simple.key, "hazard", 3, 3],
      [complex.key, "hazard", 3, 4]
    ]
  );
  assert.equal(game.actors.has(npc.key), false);
  assert.equal(game.actors.has(simple.key), false);
  assert.equal(context.actionSelection.key, npc.key);
  assert.equal(context.actionSelection.zone, 3);
  assert.equal(context.actionSelection.order, 2);
  assert.equal(context.actionSelection.positionLabel, game.i18n.format("SF2eTSC.ui.mapPosition", { zone: 3, position: 2 }));
  assert.equal(context.dock.gm, true);
  assert.equal(context.dock.objectKey, npc.key);
  assert.ok(context.dock.actions.some((action) => action.id === "inline:inline-ram"));
});

test("player ship dock does not invent an operator for an unhelmed station", async (t) => {
  const { app, player } = await scenario();
  t.after(() => app._cleanup());
  player.flags[M].starship.stations = [{ id: "gun", name: "Gunnery", type: "gunnery", grade: "commercial" }];
  app.actionObjectKey = player.uuid;

  const context = await app._prepareContext({ parts: ["dock"] });

  assert.deepEqual(context.dock.actions, []);
});

test("GM action selection, detail selection and native targeting remain independent", async (t) => {
  const { app, combat, player, nativeTarget, complex, Targeting } = await scenario();
  t.after(() => {
    Targeting.end();
    app._cleanup();
  });
  const token = nativeToken(nativeTarget);
  game.user.targets = new Set([token]);
  canvas.tokens.placeables = [token];
  Targeting.begin({ shipUuid: player.uuid, range: 99, gm: true });
  app.selected = player.uuid;
  app.actionObjectKey = complex.key;
  const beforeTargets = [...game.user.targets];
  const beforeSession = Targeting.current;

  const context = await app._prepareContext({ parts: ["zones"] });
  const objects = new Map(context.zones.flatMap((zone) => zone.objects).map((object) => [object.key, object]));

  assert.equal(objects.get(player.uuid).selected, true);
  assert.equal(objects.get(player.uuid).actionSelected, false);
  assert.equal(objects.get(player.uuid).targeted, false);
  assert.equal(objects.get(nativeTarget.uuid).selected, false);
  assert.equal(objects.get(nativeTarget.uuid).actionSelected, false);
  assert.equal(objects.get(nativeTarget.uuid).targeted, true);
  assert.equal(objects.get(complex.key).selected, false);
  assert.equal(objects.get(complex.key).actionSelected, true);
  assert.equal(objects.get(complex.key).targeted, false);
  assert.deepEqual([...game.user.targets], beforeTargets);
  assert.equal(Targeting.current, beforeSession);
  assert.equal(getTsc(combat).objects.find((object) => object.key === complex.key).zone, 3);
});

test("GM action controls render only for GM and use a distinct action-selection class", async () => {
  const { bar, zones, dock } = templates();
  const gmBar = bar({
    isGM: true,
    combat: { round: 1, turn: "Player Ship" },
    zoneCount: 3,
    actionObjects: [{ key: "map-ship", label: "Map Ship", typeLabel: "Starship", positionLabel: "Zone 3 · position 1", selected: true }],
    actionSelection: { positionLabel: "Zone 3 · position 1" }
  });
  assert.match(gmBar, /data-tsc-action-object/);
  assert.match(gmBar, /Zone 3 · position 1/);
  const playerBar = bar({ isGM: false, combat: { round: 1, turn: "Player Ship" }, zoneCount: 3 });
  assert.doesNotMatch(playerBar, /data-tsc-action-object/);

  const zoneHtml = zones({
    isGM: true,
    zoneCount: 1,
    showRanges: false,
    zones: [
      {
        zone: 1,
        label: "01",
        objects: [
          { key: "detail", label: "Detail", type: "starship", selected: true, actionSelected: false, targeted: false },
          { key: "action", label: "Action", type: "starship", selected: false, actionSelected: true, targeted: false },
          { key: "target", label: "Target", type: "starship", selected: false, actionSelected: false, targeted: true }
        ]
      }
    ]
  });
  const objectButton = (key) => zoneHtml.match(new RegExp(`<button[^>]*data-object-key="${key}"[^>]*>`))[0];
  const hasClass = (key, name) =>
    objectButton(key)
      .match(/class="([^"]*)"/)[1]
      .split(/\s+/)
      .includes(name);
  assert.equal(hasClass("detail", "selected"), true);
  assert.equal(hasClass("action", "action-selected"), true);
  assert.equal(hasClass("action", "selected"), false);
  assert.equal(hasClass("target", "selected"), false);
  assert.match(zoneHtml, /data-object-key="target"[^>]*[\s\S]*?tsc-obj-target-marker/);

  const dockHtml = dock({
    isGM: true,
    dock: {
      none: false,
      gm: true,
      label: "Map-only NPC",
      positionLabel: "Zone 3 · position 1",
      canManageEffects: true,
      effectShipUuid: "map-npc",
      actions: []
    }
  });
  assert.match(dockHtml, /data-action="manageEffects"[^>]*data-ship-uuid="map-npc"/);
});

test("private map-only contacts are selectable by GM but absent from player action context", async (t) => {
  const { app, combat } = await scenario();
  t.after(() => app._cleanup());
  const source = makeShip({ id: "private-action-source", name: "Private Action Ship", role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 5,
    detection: "undetected"
  });
  app.actionObjectKey = placement.key;

  const gmContext = await app._prepareContext({ parts: ["bar", "dock"] });
  assert.ok(gmContext.actionObjects.some((object) => object.key === placement.key));
  assert.equal(gmContext.actionSelection.key, placement.key);

  game.user = game.users.get("p1");
  const playerContext = await app._prepareContext({ parts: ["bar", "zones", "dock"] });
  assert.equal(playerContext.actionObjects, undefined);
  assert.equal(playerContext.actionSelection, null);
  assert.equal(
    playerContext.zones.flatMap((zone) => zone.objects).some((object) => object.key === placement.key),
    false
  );
  assert.equal(JSON.stringify(playerContext).includes(source.name), false);
});

test("non-GM context and handlers cannot expose or execute the GM action selector", async (t) => {
  const { app, npc, player, Targeting } = await scenario({ isGM: false });
  t.after(() => {
    Targeting.end();
    app._cleanup();
  });
  const playerBefore = structuredClone(player.ownership);
  const writesBefore = globalThis.__writes.length;
  app.actionObjectKey = npc.key;
  let renders = 0;
  app.render = async () => {
    renders++;
  };

  const context = await app._prepareContext({ parts: ["bar", "dock"] });
  assert.equal(context.actionObjects, undefined);
  assert.equal(context.actionSelection, null);
  assert.equal(app.actionObjectKey, null);
  assert.equal(context.dock.gm, undefined);

  const actions = (await import("../../scripts/ui/sensor-map-app.mjs")).SensorMapApplication.DEFAULT_OPTIONS.actions;
  await actions.selectActionObject.call(app, {}, { dataset: { objectKey: npc.key } });
  const hud = await import("../../scripts/ui/hud-model.mjs");
  assert.equal(typeof hud.runGmHudAction, "function");
  assert.equal(await hud.runGmHudAction(npc.key, "inline:inline-ram"), null);
  assert.equal(renders, 0);
  assert.equal(app.actionObjectKey, null);
  assert.deepEqual(player.ownership, playerBefore);
  assert.deepEqual(globalThis.__writes.slice(writesBefore), []);
});

test("GM dock runs a map-only NPC action with its real station, no invented crew and GM override", async (t) => {
  const { app, combat, player, nativeTarget, npc, Targeting } = await scenario();
  t.after(() => {
    Targeting.end();
    app._cleanup();
  });
  const token = nativeToken(nativeTarget);
  game.user.targets = new Set([token]);
  canvas.tokens.placeables = [token];
  Targeting.begin({ shipUuid: player.uuid, range: 99, gm: true });
  const beforeTargets = [...game.user.targets];
  const beforeSession = Targeting.current;
  app.actionObjectKey = npc.key;
  const context = await app._prepareContext({ parts: ["dock"] });
  const row = context.dock.actions.find((action) => action.id === "inline:inline-ram");
  assert.ok(row, "the NPC station ability is offered in the GM action dock");
  const requests = [];
  let authoritative;
  registerHandler("executeAction", async ({ payload }) => {
    requests.push(payload);
    if (requests.length === 1) throw new Error("injected restriction");
    authoritative = await executeAction({ userId: game.user.id, user: game.user, ...payload, dryRun: true });
    return authoritative;
  });
  const actions = (await import("../../scripts/ui/sensor-map-app.mjs")).SensorMapApplication.DEFAULT_OPTIONS.actions;

  await actions.dockAct.call(app, {}, { dataset: { actionId: row.id, actionKey: row.key } });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].shipUuid, npc.key);
  assert.equal(requests[0].crewUuid, null);
  assert.equal(requests[0].stationId, "scanner");
  assert.equal(requests[1].options.gmOverride, true);
  assert.equal(authoritative.ctx.ship.mapOnly, true);
  assert.equal(authoritative.ctx.ship.uuid, npc.key);
  assert.equal(authoritative.ctx.station.id, "scanner");
  assert.equal(authoritative.ctx.crew, null);
  assert.deepEqual([...game.user.targets], beforeTargets);
  assert.equal(Targeting.current, beforeSession);
  assert.equal(getTsc(combat).objects.find((object) => object.key === npc.key).zone, 3);
});

test("hazard dock offers only the verified routine or trigger and executes the selected snapshot", async (t) => {
  const { app, combat, simple, simpleSource, complex, complexSource, Targeting } = await scenario();
  t.after(() => {
    Targeting.end();
    app._cleanup();
  });
  const actions = (await import("../../scripts/ui/sensor-map-app.mjs")).SensorMapApplication.DEFAULT_OPTIONS.actions;
  app.actionObjectKey = complex.key;
  let context = await app._prepareContext({ parts: ["dock"] });
  assert.deepEqual(
    context.dock.actions.map((action) => action.id),
    ["hazard-routine"]
  );
  const routine = context.dock.actions[0];
  await actions.dockAct.call(app, {}, { dataset: { actionId: routine.id, actionKey: routine.key } });
  assert.ok(getTsc(combat).log.some((entry) => entry.text.includes(complexSource.name) && entry.text.includes("Routine")));

  app.actionObjectKey = simple.key;
  context = await app._prepareContext({ parts: ["dock"] });
  assert.deepEqual(
    context.dock.actions.map((action) => action.id),
    ["hazard-trigger"]
  );
  const trigger = context.dock.actions[0];
  await actions.dockAct.call(app, {}, { dataset: { actionId: trigger.id, actionKey: trigger.key } });
  assert.ok(getTsc(combat).log.some((entry) => entry.text.includes(simpleSource.name)));
});

test("disabled hazards expose a disabled routine and cannot execute it through the dock", async (t) => {
  const { app, combat, complex } = await scenario();
  t.after(() => app._cleanup());
  getTsc(combat).hazardState[complex.key] = { disabled: true };
  app.actionObjectKey = complex.key;
  const context = await app._prepareContext({ parts: ["dock"] });
  assert.equal(context.dock.actions[0].enabled, false);
  const before = structuredClone(getTsc(combat).log);
  const actions = (await import("../../scripts/ui/sensor-map-app.mjs")).SensorMapApplication.DEFAULT_OPTIONS.actions;
  await actions.dockAct.call(app, {}, { dataset: { actionId: "hazard-routine", actionKey: context.dock.actions[0].key } });
  assert.deepEqual(getTsc(combat).log, before);
});

test("effects entry opens the selected map-only starship snapshot, never its source Actor", async (t) => {
  const { app, npc, npcSource } = await scenario();
  t.after(() => app._cleanup());
  app.actionObjectKey = npc.key;
  const context = await app._prepareContext({ parts: ["dock"] });
  assert.equal(context.dock.canManageEffects, true);
  assert.equal(context.dock.effectShipUuid, npc.key);
  const { EffectManager } = await import("../../scripts/ui/effect-manager.mjs");
  EffectManager.prototype.render = async function () {
    return this;
  };
  EffectManager.prototype.bringToFront = function () {};
  const actions = (await import("../../scripts/ui/sensor-map-app.mjs")).SensorMapApplication.DEFAULT_OPTIONS.actions;

  const manager = await actions.manageEffects.call(app, {}, { dataset: { shipUuid: npc.key } });

  assert.ok(manager instanceof EffectManager);
  assert.equal(manager.actor.uuid, npc.key);
  assert.equal(manager.actor.mapOnly, true);
  assert.notEqual(manager.actor, npcSource);
});
