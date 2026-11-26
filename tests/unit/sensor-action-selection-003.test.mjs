import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, loadLang, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

const MODULE_ID = "sf2e-tactical-starship-combat";
const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

async function setup(t) {
  installFoundryMock();
  await loadContentFromDisk();
  const gmUi = await import("../../scripts/ui/sensor-gm-ui.mjs");
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const { Targeting } = await import("../../scripts/ui/targeting.mjs");
  Targeting.end();
  const world = makeShip({ id: "auto-world", name: "World Ship", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [
      { key: world.uuid, name: world.name, zone: 1 },
      { key: "map-one", actorUuid: "map-one", name: "Map One", zone: 2, mapOnly: true },
      { key: "map-two", actorUuid: "map-two", name: "Map Two", zone: 2, mapOnly: true },
      { key: "shared-a", actorUuid: "Actor.shared", name: "Shared A", zone: 3 },
      { key: "shared-b", actorUuid: "Actor.shared", name: "Shared B", zone: 3 },
      { key: "custom", actorUuid: null, name: "Custom", type: "custom", zone: 4 }
    ]
  });
  const app = new SensorMapApplication();
  app.showRanges = false;
  app.render = async (options = {}) => {
    app.lastContext = await app._prepareContext(options);
    return app;
  };
  t.after(() => {
    Targeting.end();
    app._cleanup();
  });
  return { app, combat, gmUi, world, Targeting };
}

function view(combat) {
  return [
    { key: "Actor.auto-world", actorUuid: "Actor.auto-world", type: "starship", zone: 1, name: "World Ship" },
    { key: "map-one", actorUuid: "map-one", type: "starship", zone: 2, name: "Map One", mapOnly: true },
    { key: "map-two", actorUuid: "map-two", type: "starship", zone: 2, name: "Map Two", mapOnly: true },
    { key: "shared-a", actorUuid: "Actor.shared", type: "starship", zone: 3, name: "Shared A" },
    { key: "shared-b", actorUuid: "Actor.shared", type: "starship", zone: 3, name: "Shared B" },
    { key: "custom", actorUuid: null, type: "custom", zone: 4, name: "Custom" }
  ];
}

async function addCombatant(combat, data) {
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [data]);
  return combatant;
}

async function currentWorldTurn(t) {
  const fixture = await setup(t);
  await addCombatant(fixture.combat, {
    _id: "world-turn",
    actorId: fixture.world.id,
    initiative: 30,
    flags: { [MODULE_ID]: { sensorMapInitiative: { combatId: fixture.combat.id } } }
  });
  await addCombatant(fixture.combat, {
    _id: "map-turn",
    actorId: null,
    initiative: 20,
    flags: {
      [MODULE_ID]: {
        sensorMapObject: { combatId: fixture.combat.id, key: "map-one" },
        sensorContactInstance: { combatId: fixture.combat.id, actorUuid: "map-one" }
      }
    }
  });
  fixture.combat.turn = 0;
  return fixture;
}

test("resolver prefers an exact placement key over duplicate actor UUID matches", async (t) => {
  const { combat, gmUi } = await setup(t);
  const combatant = {
    actorId: null,
    flags: { [MODULE_ID]: { sensorMapObject: { combatId: combat.id, key: "shared-b" } } }
  };
  assert.equal(gmUi.resolveGmActionObjectKey(view(combat), combatant, combat), "shared-b");
});

test("resolver maps a World Actor combatant to its unique Sensor Map object", async (t) => {
  const { combat, gmUi, world } = await setup(t);
  assert.equal(gmUi.resolveGmActionObjectKey(view(combat), { actorId: world.id, actor: world }, combat), world.uuid);
});

test("resolver maps a map-only actorId null combatant through its instance UUID", async (t) => {
  const { combat, gmUi } = await setup(t);
  const combatant = {
    actorId: null,
    flags: { [MODULE_ID]: { sensorContactInstance: { combatId: combat.id, actorUuid: "map-two" } } }
  };
  assert.equal(gmUi.resolveGmActionObjectKey(view(combat), combatant, combat), "map-two");
});

test("resolver refuses repeated placements when only a shared actor UUID is known", async (t) => {
  const { combat, gmUi } = await setup(t);
  const combatant = {
    actorId: null,
    flags: { [MODULE_ID]: { sensorContactInstance: { combatId: combat.id, actorUuid: "Actor.shared" } } }
  };
  assert.equal(gmUi.resolveGmActionObjectKey(view(combat), combatant, combat), null);
});

test("resolver returns no selection for missing stale or non-actionable placement identity", async (t) => {
  const { combat, gmUi } = await setup(t);
  const missing = {
    actorId: null,
    flags: {
      [MODULE_ID]: {
        sensorMapObject: { combatId: combat.id, key: "map-missing" },
        sensorContactInstance: { combatId: combat.id, actorUuid: "Actor.missing" }
      }
    }
  };
  const stale = {
    actorId: null,
    flags: { [MODULE_ID]: { sensorMapObject: { combatId: "another-combat", key: "shared-a" } } }
  };
  const custom = {
    actorId: null,
    flags: { [MODULE_ID]: { sensorMapObject: { combatId: combat.id, key: "custom" } } }
  };
  const anonymous = { actorId: null, flags: {} };
  assert.equal(gmUi.resolveGmActionObjectKey(view(combat), missing, combat), null);
  assert.equal(gmUi.resolveGmActionObjectKey(view(combat), stale, combat), null);
  assert.equal(gmUi.resolveGmActionObjectKey(view(combat), custom, combat), null);
  assert.equal(gmUi.resolveGmActionObjectKey(view(combat), anonymous, combat), null);
});

test("resolver can select a hidden GM contact but never a contact absent from the GM view", async (t) => {
  const { combat, gmUi } = await setup(t);
  const combatant = {
    actorId: null,
    flags: { [MODULE_ID]: { sensorMapObject: { combatId: combat.id, key: "map-one" } } }
  };
  const hidden = view(combat).map((object) => (object.key === "map-one" ? { ...object, privateContact: true, hidden: true } : object));
  assert.equal(gmUi.resolveGmActionObjectKey(hidden, combatant, combat), "map-one");
  assert.equal(
    gmUi.resolveGmActionObjectKey(
      hidden.filter((object) => object.key !== "map-one"),
      combatant,
      combat
    ),
    null
  );
});

test("automatic action selection is on by default and synchronizes immediately", async (t) => {
  const { app, world } = await currentWorldTurn(t);
  const context = await app._prepareContext({ parts: ["bar"] });
  assert.equal(context.autoActionSelection, true);
  assert.equal(app.actionObjectKey, world.uuid);
  assert.equal(context.actionSelection.key, world.uuid);
});

test("enabling automatic selection clears a manual override and synchronizes immediately", async (t) => {
  const { app, combat, gmUi, world } = await currentWorldTurn(t);
  await gmUi.setGmAutoActionSelection(app, false);
  app.actionObjectKey = "map-two";
  await gmUi.setGmAutoActionSelection(app, true);
  const context = await app._prepareContext({ parts: ["bar"] });
  assert.equal(context.autoActionSelection, true);
  assert.equal(app.actionObjectKey, world.uuid);
  assert.equal(app.gmActionOverride, null);
  assert.equal(combat.combatant.id, "world-turn");
});

test("disabled automatic selection survives initiative and round changes", async (t) => {
  const { app, combat, gmUi } = await currentWorldTurn(t);
  await gmUi.setGmAutoActionSelection(app, false);
  app.actionObjectKey = "map-two";
  combat.turn = 1;
  let context = await app._prepareContext({ parts: ["bar"] });
  assert.equal(context.autoActionSelection, false);
  assert.equal(app.actionObjectKey, "map-two");
  combat.round = 2;
  context = await app._prepareContext({ parts: ["bar"] });
  assert.equal(context.autoActionSelection, false);
  assert.equal(app.actionObjectKey, "map-two");
});

test("RMB assignment temporarily overrides automatic selection and resumes on the next initiative turn", async (t) => {
  const { app, combat, gmUi } = await currentWorldTurn(t);
  await app._prepareContext({ parts: ["bar"] });
  await gmUi.selectGmActionObjectKey(app, "map-two");
  let context = await app._prepareContext({ parts: ["bar"] });
  assert.equal(context.autoActionSelection, true);
  assert.equal(app.actionObjectKey, "map-two");
  assert.equal(app.gmActionOverride.objectKey, "map-two");
  combat.turn = 1;
  context = await app._prepareContext({ parts: ["bar"] });
  assert.equal(context.autoActionSelection, true);
  assert.equal(app.actionObjectKey, "map-one");
  assert.equal(app.gmActionOverride, null);
});

test("round changes also resume automatic selection after an RMB override", async (t) => {
  const { app, combat, gmUi, world } = await currentWorldTurn(t);
  await app._prepareContext({ parts: ["bar"] });
  await gmUi.selectGmActionObjectKey(app, "map-two");
  combat.round = 2;
  await app._prepareContext({ parts: ["bar"] });
  assert.equal(app.actionObjectKey, world.uuid);
  assert.equal(app.gmActionOverride, null);
});

test("automatic toggle state and manual selection persist across repeated renders", async (t) => {
  const { app, gmUi } = await currentWorldTurn(t);
  await gmUi.setGmAutoActionSelection(app, false);
  app.actionObjectKey = "map-two";
  const first = await app._prepareContext({ parts: ["bar"] });
  const second = await app._prepareContext({ parts: ["bar"] });
  assert.equal(first.autoActionSelection, false);
  assert.equal(second.autoActionSelection, false);
  assert.equal(second.actionSelection.key, "map-two");
});

test("automatic mode clears a stale selection when the current combatant has no safe mapping", async (t) => {
  const { app, combat, gmUi } = await setup(t);
  await addCombatant(combat, {
    _id: "ambiguous-turn",
    actorId: null,
    initiative: 10,
    flags: { [MODULE_ID]: { sensorContactInstance: { combatId: combat.id, actorUuid: "Actor.shared" } } }
  });
  app.actionObjectKey = "map-two";
  const context = await app._prepareContext({ parts: ["bar"] });
  assert.equal(context.autoActionSelection, true);
  assert.equal(context.actionSelection, null);
  assert.equal(app.actionObjectKey, null);
  assert.equal(typeof gmUi.resolveGmActionObjectKey, "function");
});

test("RMB assignment leaves native targets ordinary selection documents and actions untouched", async (t) => {
  const { app, combat, gmUi, Targeting } = await currentWorldTurn(t);
  await app._prepareContext({ parts: ["bar"] });
  const token = { id: "native-target", setTarget() {} };
  game.user.targets = new Set([token]);
  canvas.tokens.controlled = [];
  app.selected = "custom";
  Targeting.begin({ shipUuid: "Actor.auto-world", range: 99, gm: true });
  const beforeTargets = [...game.user.targets];
  const beforeSession = Targeting.current;
  const beforeWrites = globalThis.__writes.length;
  const beforeLog = structuredClone(combat.flags[MODULE_ID].tsc.log);
  await gmUi.selectGmActionObjectKey(app, "map-two");
  assert.deepEqual([...game.user.targets], beforeTargets);
  assert.equal(Targeting.current, beforeSession);
  assert.equal(app.selected, "custom");
  assert.equal(globalThis.__writes.length, beforeWrites);
  assert.deepEqual(combat.flags[MODULE_ID].tsc.log, beforeLog);
});

test("contextmenu is consumed only for a valid GM action object", async (t) => {
  const { app, gmUi } = await currentWorldTurn(t);
  await app._prepareContext({ parts: ["bar"] });
  const object = {
    dataset: { objectKey: "map-two" },
    clicks: 0,
    closest(selector) {
      return selector === ".tsc-obj[data-object-key]" ? this : null;
    },
    click() {
      this.clicks++;
    }
  };
  app.element = { contains: () => true };
  const event = {
    button: 2,
    target: object,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    }
  };
  assert.equal(gmUi.handleGmActionContextMenu(app, event), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.equal(object.clicks, 0);
  assert.equal(app.actionObjectKey, "map-two");
  const invalidEvent = {
    ...event,
    target: { ...object, dataset: { objectKey: "custom" } },
    defaultPrevented: false,
    propagationStopped: false
  };
  assert.equal(gmUi.handleGmActionContextMenu(app, invalidEvent), false);
  assert.equal(invalidEvent.defaultPrevented, false);
  game.user = game.users.get("p1");
  const playerEvent = { ...event, defaultPrevented: false, propagationStopped: false };
  assert.equal(gmUi.handleGmActionContextMenu(app, playerEvent), false);
  assert.equal(playerEvent.defaultPrevented, false);
});

test("GM action bar renders a localized accessible default-on switch beside the selector", () => {
  const template = Handlebars.create();
  const bar = template.compile(read("templates/sensor-map-bar.hbs"));
  for (const [lang, label] of [
    ["en", "Auto-select"],
    ["ru", "Автовыбор"]
  ]) {
    const labels = loadLang(lang);
    template.registerHelper("localize", (key) => labels[key] ?? key);
    const html = bar({
      noCombat: false,
      isGM: true,
      combat: { round: 1, turn: "World Ship" },
      zoneCount: 3,
      autoActionSelection: true,
      actionObjects: [{ key: "map-one", label: "Map One", typeLabel: "Starship", selected: true }],
      actionSelection: { key: "map-one" }
    });
    assert.match(html, /data-tsc-auto-action-object/);
    assert.match(html, /type="checkbox"[^>]*role="switch"[^>]*checked/);
    assert.match(html, /aria-checked="true"/);
    assert.ok(html.includes(label));
    assert.ok(html.indexOf("data-tsc-action-object") < html.indexOf("data-tsc-auto-action-object"));
  }
  const playerHtml = bar({ noCombat: false, isGM: false, combat: { round: 1, turn: "World Ship" }, zoneCount: 3 });
  assert.doesNotMatch(playerHtml, /data-tsc-auto-action-object/);
});
