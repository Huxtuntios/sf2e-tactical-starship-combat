import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, loadLang, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";

function installConditionFixture() {
  const definitions = new Map([
    ["frightened", { name: "Frightened", valued: true }],
    ["off-guard", { name: "Off-Guard", valued: false }],
    ["clumsy", { name: "Clumsy", valued: true }]
  ]);
  game.pf2e.ConditionManager = {
    conditionsSlugs: [...definitions.keys()],
    getCondition(slug) {
      const definition = definitions.get(slug);
      if (!definition) return null;
      return {
        name: definition.name,
        system: { value: { isValued: definition.valued, value: definition.valued ? 1 : null } },
        toObject() {
          return {
            type: "condition",
            name: definition.name,
            img: "icons/svg/condition.svg",
            system: {
              slug,
              rules: [],
              value: { isValued: definition.valued, value: definition.valued ? 1 : null }
            }
          };
        }
      };
    }
  };
  CONFIG.PF2E = { ...(CONFIG.PF2E ?? {}), skills: { piloting: { attribute: "dex" }, computers: { attribute: "int" } } };
  return (actor) => {
    const create = actor.createEmbeddedDocuments.bind(actor);
    actor.createEmbeddedDocuments = async (type, sources, options) => {
      const items = await create(type, sources, options);
      for (const item of items) {
        item.parent = actor;
        item.actor = actor;
        item.uuid = `${actor.uuid}.Item.${item.id}`;
        item.slug = item.system.slug;
        item.active = true;
      }
      return items;
    };
    actor.increaseCondition = async (slug, { value = 1 } = {}) => {
      const existing = [...actor.items.values()].find((item) => item.slug === slug && item.active);
      if (existing) {
        if (existing.system.value.isValued) existing.system.value.value += value;
        return existing;
      }
      const source = game.pf2e.ConditionManager.getCondition(slug).toObject();
      if (source.system.value.isValued) source.system.value.value = value;
      return (await actor.createEmbeddedDocuments("Item", [source]))[0] ?? null;
    };
    actor.decreaseCondition = async (condition) => actor.deleteEmbeddedDocuments("Item", [condition.id]);
    actor.hasCondition = (slug) => [...actor.items.values()].some((item) => item.slug === slug && item.active);
    return actor;
  };
}

async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
  const nativeActor = installConditionFixture();
  const socket = await import("../../scripts/socket.mjs");
  (await import("../../scripts/starship/effect-service.mjs")).registerEffectHandlers();
  const emitted = [];
  let requestNumber = 0;
  const send = async (userId, type, payload) => {
    const requestId = `r${requestNumber++}`;
    await socket.dispatchSocketMessage({ kind: "request", type, requestId, payload }, userId, {
      users: game.users,
      selfId: "gm",
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (message) => emitted.push(message)
    });
    return emitted.find((message) => message.requestId === requestId);
  };
  return { nativeActor, send };
}

function render(source, context) {
  const handlebars = Handlebars.create();
  handlebars.registerHelper("localize", (key) => game.i18n.localize(key));
  handlebars.registerHelper("eq", (a, b) => a === b);
  return handlebars.compile(source)(context);
}

test("GM can open the effect manager and a player cannot render or manage it", async () => {
  const { nativeActor } = await setup();
  const ship = nativeActor(makeShip({ id: "manager-ship", name: "Aurora" }));
  const manager = await import("../../scripts/ui/effect-manager.mjs").catch(() => ({}));
  assert.equal(typeof manager.openEffectManager, "function");
  assert.equal(typeof manager.EffectManager, "function");
  game.user = game.users.get("p1");
  assert.equal(manager.openEffectManager(ship), null);
  assert.equal(new manager.EffectManager(ship)._canRender(), false);
  game.user = game.users.get("gm");
  let rendered = 0;
  let raised = 0;
  const renderDescriptor = Object.getOwnPropertyDescriptor(manager.EffectManager.prototype, "render");
  const raiseDescriptor = Object.getOwnPropertyDescriptor(manager.EffectManager.prototype, "bringToFront");
  manager.EffectManager.prototype.render = function () {
    rendered++;
    return Promise.resolve(this);
  };
  manager.EffectManager.prototype.bringToFront = function () {
    raised++;
  };
  try {
    const app = manager.openEffectManager(ship);
    assert.ok(app instanceof manager.EffectManager);
    assert.equal(rendered, 1);
    assert.equal(raised, 0);
    await Promise.resolve();
    assert.equal(raised, 1);
  } finally {
    if (renderDescriptor) Object.defineProperty(manager.EffectManager.prototype, "render", renderDescriptor);
    else delete manager.EffectManager.prototype.render;
    if (raiseDescriptor) Object.defineProperty(manager.EffectManager.prototype, "bringToFront", raiseDescriptor);
    else delete manager.EffectManager.prototype.bringToFront;
  }
});

test("operational action clears only operational damage flags and preserves ship data", async () => {
  const { nativeActor, send } = await setup();
  const ship = nativeActor(
    makeShip({
      id: "operational-ship",
      name: "Aurora",
      hp: 30,
      sp: 10,
      stations: [{ id: "pilot-1", type: "pilot", helmedBy: "Actor.pilot" }],
      weapons: [{ id: "laser", name: "Laser", die: "2d6", range: 5 }],
      crew: [{ actorUuid: "Actor.pilot", name: "Pilot", role: "crew", stationId: "pilot-1" }],
      effects: [{ id: "boost", slug: "boost", label: "Boost", modifiers: [] }],
      extra: {
        destroyed: true,
        inoperable: true,
        compromised: 3,
        wrecked: 2,
        offKilter: true,
        upgrades: [{ id: "upgrade-1", ref: "communications-overlay", stationId: null }],
        customFlag: { keep: true }
      }
    })
  );
  ship.system.attributes.hp.value = 17;
  const { readStarship } = await import("../../scripts/starship/starship-state.mjs");
  const normalized = readStarship(ship);
  const before = structuredClone({
    crew: normalized.crew,
    stations: normalized.stations,
    weapons: normalized.weapons,
    upgrades: normalized.upgrades,
    effects: normalized.effects,
    customFlag: normalized.customFlag,
    hp: ship.system.attributes.hp,
    sp: normalized.sp
  });
  const result = await send("gm", "setStarshipOperationalState", { shipUuid: ship.uuid, state: "operational" });
  assert.equal(result.ok, true);
  const data = ship.flags[M].starship;
  assert.equal(data.destroyed, false);
  assert.equal(data.inoperable, false);
  assert.equal(data.compromised, 0);
  assert.equal(data.wrecked, 0);
  assert.equal(data.offKilter, false);
  assert.deepEqual(data.crew, before.crew);
  assert.deepEqual(data.stations, before.stations);
  assert.deepEqual(data.weapons, before.weapons);
  assert.deepEqual(data.upgrades, before.upgrades);
  assert.deepEqual(data.effects, before.effects);
  assert.deepEqual(data.customFlag, before.customFlag);
  assert.deepEqual(ship.system.attributes.hp, before.hp);
  assert.deepEqual(data.sp, before.sp);
});

test("destroyed action only marks the actor destroyed and preserves vitals and other state", async () => {
  const { nativeActor, send } = await setup();
  const ship = nativeActor(
    makeShip({
      id: "destroyed-ship",
      name: "Aurora",
      extra: { destroyed: false, inoperable: true, compromised: 2, wrecked: 1, offKilter: true, customFlag: "keep" }
    })
  );
  ship.system.attributes.hp.value = 9;
  const result = await send("gm", "setStarshipOperationalState", { shipUuid: ship.uuid, state: "destroyed" });
  assert.equal(result.ok, true);
  const data = ship.flags[M].starship;
  assert.equal(data.destroyed, true);
  assert.equal(data.inoperable, true);
  assert.equal(data.compromised, 2);
  assert.equal(data.wrecked, 1);
  assert.equal(data.offKilter, true);
  assert.equal(data.customFlag, "keep");
  assert.equal(ship.system.attributes.hp.value, 9);
  assert.deepEqual(data.sp, { value: 10, max: 10 });
});

test("operational and condition socket operations reject players and non-starship actors", async () => {
  const { nativeActor, send } = await setup();
  const ship = nativeActor(makeShip({ id: "secure-ship", name: "Aurora", extra: { destroyed: true } }));
  const pc = nativeActor(makeCharacter({ id: "plain-pc", name: "Not a ship" }));
  for (const [userId, type, payload] of [
    ["p1", "setStarshipOperationalState", { shipUuid: ship.uuid, state: "operational" }],
    ["p1", "addStarshipCondition", { shipUuid: ship.uuid, slug: "frightened", value: 2 }],
    ["gm", "setStarshipOperationalState", { shipUuid: pc.uuid, state: "destroyed" }],
    ["gm", "addStarshipCondition", { shipUuid: pc.uuid, slug: "frightened", value: 2 }]
  ]) {
    const result = await send(userId, type, payload);
    assert.equal(result.ok, false, `${userId}:${type}`);
  }
  assert.equal(ship.flags[M].starship.destroyed, true);
  assert.equal(ship.items.size, 0);
  assert.equal(pc.flags[M], undefined);
});

test("native conditions add, persist valued values, ignore unvalued input and remove through native items", async () => {
  const { nativeActor, send } = await setup();
  const ship = nativeActor(makeShip({ id: "condition-ship", name: "Aurora" }));
  const valued = await send("gm", "addStarshipCondition", { shipUuid: ship.uuid, slug: "frightened", value: 3 });
  assert.equal(valued.ok, true);
  const frightened = [...ship.items.values()].find((item) => item.slug === "frightened");
  assert.ok(frightened);
  assert.equal(frightened.system.value.value, 3);
  const unvalued = await send("gm", "addStarshipCondition", { shipUuid: ship.uuid, slug: "off-guard", value: 99 });
  assert.equal(unvalued.ok, true);
  const offGuard = [...ship.items.values()].find((item) => item.slug === "off-guard");
  assert.ok(offGuard);
  assert.equal(offGuard.system.value.value, null);
  const removed = await send("gm", "removeStarshipCondition", { shipUuid: ship.uuid, itemId: frightened.id });
  assert.equal(removed.ok, true);
  assert.equal(ship.items.has(frightened.id), false);
  assert.equal(ship.items.has(offGuard.id), true);
  assert.equal((await send("gm", "addStarshipCondition", { shipUuid: ship.uuid, slug: "missing", value: 1 })).ok, false);
  assert.equal((await send("gm", "addStarshipCondition", { shipUuid: ship.uuid, slug: "clumsy", value: 0 })).ok, false);
});

test("manager lists native conditions and existing module effects without history controls", async () => {
  const { nativeActor, send } = await setup();
  const ship = nativeActor(
    makeShip({
      id: "manager-context-ship",
      name: "Aurora",
      effects: [{ id: "existing-effect", slug: "boost", label: "Boost", modifiers: [], conditions: [] }]
    })
  );
  await send("gm", "addStarshipCondition", { shipUuid: ship.uuid, slug: "frightened", value: 2 });
  const manager = await import("../../scripts/ui/effect-manager.mjs").catch(() => ({}));
  assert.equal(typeof manager.EffectManager, "function");
  const context = await new manager.EffectManager(ship)._prepareContext();
  assert.equal(context.history, undefined);
  assert.equal(context.conditions.find((condition) => condition.slug === "frightened").value, 2);
  assert.equal(context.effects[0].id, "existing-effect");
  const source = fs.readFileSync(new URL("../../templates/effect-manager.hbs", import.meta.url), "utf8");
  const html = render(source, context);
  assert.match(html, /Frightened/);
  assert.match(html, /Boost/);
  assert.match(html, /data-action="setOperational"/);
  assert.match(html, /data-action="addCondition"/);
  assert.doesNotMatch(html, /data-action="[^"]*history|SF2eTSC\.history/);
  game.user = game.users.get("p1");
  const playerContext = await new manager.EffectManager(ship)._prepareContext();
  const playerHtml = render(source, playerContext);
  assert.doesNotMatch(playerHtml, /data-action="(?:addCondition|removeCondition|removeEffect|setOperational)"/);
});

test("manager can remove an existing module effect through the current effect service", async () => {
  const { nativeActor, send } = await setup();
  const ship = nativeActor(
    makeShip({ id: "remove-effect-ship", name: "Aurora", effects: [{ id: "effect-1", slug: "boost", label: "Boost" }] })
  );
  const result = await send("gm", "effectTiming", { shipUuid: ship.uuid, effectId: "effect-1", op: "complete" });
  assert.equal(result.ok, true);
  assert.deepEqual(ship.flags[M].starship.effects, []);
});

test("starship sheet exposes the manager action only to the GM", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  foundry.applications.sheets = { ActorSheetV2: class {} };
  const sheet = await import("../../scripts/ui/starship-sheet.mjs");
  assert.equal(typeof sheet.StarshipSheet.DEFAULT_OPTIONS.actions.manageEffects, "function");
  const ship = makeShip({ id: "sheet-manager-ship", name: "Aurora" });
  const manager = await import("../../scripts/ui/effect-manager.mjs");
  let rendered = 0;
  const renderDescriptor = Object.getOwnPropertyDescriptor(manager.EffectManager.prototype, "render");
  const raiseDescriptor = Object.getOwnPropertyDescriptor(manager.EffectManager.prototype, "bringToFront");
  manager.EffectManager.prototype.render = function () {
    rendered++;
    return Promise.resolve(this);
  };
  manager.EffectManager.prototype.bringToFront = function () {};
  try {
    sheet.StarshipSheet.DEFAULT_OPTIONS.actions.manageEffects.call({ document: ship });
    await Promise.resolve();
    assert.equal(rendered, 1);
  } finally {
    if (renderDescriptor) Object.defineProperty(manager.EffectManager.prototype, "render", renderDescriptor);
    else delete manager.EffectManager.prototype.render;
    if (raiseDescriptor) Object.defineProperty(manager.EffectManager.prototype, "bringToFront", raiseDescriptor);
    else delete manager.EffectManager.prototype.bringToFront;
  }
  const source = fs.readFileSync(new URL("../../templates/starship-sheet.hbs", import.meta.url), "utf8");
  const context = { isGM: true, tab: "overview", effects: [], ship: {}, stats: {}, perms: {} };
  assert.match(render(source, context), /data-action="manageEffects"/);
  assert.doesNotMatch(render(source, { ...context, isGM: false }), /data-action="manageEffects"/);
});

test("public API exposes additive effect operations without removing current entry points", async () => {
  await setup();
  const { buildApi } = await import("../../scripts/api.mjs");
  const { applyManualEffect, removeManualEffect, getEffectTargetCatalog } = await import("../../scripts/starship/application-service.mjs");
  const { processPersistentDamage, applyPersistentDamage, recoverPersistentDamage } =
    await import("../../scripts/starship/persistent-damage.mjs");
  const { openEffectManager } = await import("../../scripts/ui/effect-manager.mjs");
  const api = buildApi();
  for (const [name, implementation] of Object.entries({
    applyManualEffect,
    removeManualEffect,
    getEffectTargetCatalog,
    processPersistentDamage,
    applyPersistentDamage,
    recoverPersistentDamage,
    openEffectManager
  })) {
    assert.equal(api[name], implementation, name);
  }
  for (const name of ["openSensorMap", "openStarshipSheet", "executeStarshipAction", "applyStarshipDamage", "getStarshipState"]) {
    assert.equal(typeof api[name], "function", name);
  }
});

test("Sensor Map detail opens the same GM-only effect manager", async () => {
  const { nativeActor } = await setup();
  const ship = nativeActor(makeShip({ id: "sensor-manager-ship", name: "Aurora" }));
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const manager = await import("../../scripts/ui/effect-manager.mjs");
  const action = SensorMapApplication.DEFAULT_OPTIONS.actions.manageEffects;
  assert.equal(typeof action, "function");
  const renderDescriptor = Object.getOwnPropertyDescriptor(manager.EffectManager.prototype, "render");
  const raiseDescriptor = Object.getOwnPropertyDescriptor(manager.EffectManager.prototype, "bringToFront");
  let rendered = 0;
  manager.EffectManager.prototype.render = function () {
    rendered++;
    return Promise.resolve(this);
  };
  manager.EffectManager.prototype.bringToFront = function () {};
  try {
    await action.call({}, {}, { dataset: { shipUuid: ship.uuid } });
    await Promise.resolve();
    assert.equal(rendered, 1);
    game.user = game.users.get("p1");
    await action.call({}, {}, { dataset: { shipUuid: ship.uuid } });
    await Promise.resolve();
    assert.equal(rendered, 1);
  } finally {
    game.user = game.users.get("gm");
    if (renderDescriptor) Object.defineProperty(manager.EffectManager.prototype, "render", renderDescriptor);
    else delete manager.EffectManager.prototype.render;
    if (raiseDescriptor) Object.defineProperty(manager.EffectManager.prototype, "bringToFront", raiseDescriptor);
    else delete manager.EffectManager.prototype.bringToFront;
  }
});

test("effect manager localization keys exist with EN/RU parity", () => {
  const en = loadLang("en");
  const ru = loadLang("ru");
  const keys = [
    "SF2eTSC.effects.title",
    "SF2eTSC.effects.manage",
    "SF2eTSC.effects.operationalHint",
    "SF2eTSC.effects.destroyedHint",
    "SF2eTSC.effects.addCondition",
    "SF2eTSC.effects.conditionLabel",
    "SF2eTSC.effects.conditionValue",
    "SF2eTSC.effects.conditionValueHint",
    "SF2eTSC.effects.nativeConditions",
    "SF2eTSC.effects.moduleEffects",
    "SF2eTSC.effects.empty",
    "SF2eTSC.effects.remove",
    "SF2eTSC.effects.readOnly",
    "SF2eTSC.effects.inactive",
    "SF2eTSC.effects.add",
    "SF2eTSC.effects.apply",
    "SF2eTSC.effects.applied",
    "SF2eTSC.effects.partial",
    "SF2eTSC.effects.configure",
    "SF2eTSC.effects.chooseTargets",
    "SF2eTSC.effects.kindLabel",
    "SF2eTSC.effects.kind.condition",
    "SF2eTSC.effects.kind.bonus",
    "SF2eTSC.effects.kind.penalty",
    "SF2eTSC.effects.kind.persistent-damage",
    "SF2eTSC.effects.customLabel",
    "SF2eTSC.effects.conditionHint",
    "SF2eTSC.effects.value",
    "SF2eTSC.effects.modifier",
    "SF2eTSC.effects.selector",
    "SF2eTSC.effects.modifierType",
    "SF2eTSC.effects.modifierTypes.status",
    "SF2eTSC.effects.modifierTypes.circumstance",
    "SF2eTSC.effects.modifierTypes.item",
    "SF2eTSC.effects.modifierTypes.untyped",
    "SF2eTSC.effects.statisticLabel",
    "SF2eTSC.effects.statistic.both",
    "SF2eTSC.effects.statistic.check",
    "SF2eTSC.effects.statistic.dc",
    "SF2eTSC.effects.formula",
    "SF2eTSC.effects.damageType",
    "SF2eTSC.effects.recoveryDC",
    "SF2eTSC.effects.criticalHit",
    "SF2eTSC.effects.immunity",
    "SF2eTSC.effects.ignoreImmunities",
    "SF2eTSC.effects.immunityHint",
    "SF2eTSC.effects.targetHint",
    "SF2eTSC.effects.summary",
    "SF2eTSC.effects.noScopeTargets",
    "SF2eTSC.effects.process",
    "SF2eTSC.effects.processHint",
    "SF2eTSC.effects.copiedSourceHint",
    "SF2eTSC.effects.targets.ship",
    "SF2eTSC.effects.targets.entire",
    "SF2eTSC.effects.targets.mechanics",
    "SF2eTSC.effects.targets.stations",
    "SF2eTSC.effects.targets.actions",
    "SF2eTSC.effects.targets.weapons",
    "SF2eTSC.effects.targets.weaponAttacks",
    "SF2eTSC.effects.targets.crew",
    "SF2eTSC.effects.targets.allCrew",
    "SF2eTSC.effects.mechanics.abilities",
    "SF2eTSC.effects.mechanics.skills",
    "SF2eTSC.effects.mechanics.attacks",
    "SF2eTSC.effects.mechanics.saves",
    "SF2eTSC.effects.mechanics.ac",
    "SF2eTSC.effects.mechanics.defenses",
    "SF2eTSC.effects.selectors.all",
    "SF2eTSC.effects.selectors.ac",
    "SF2eTSC.effects.selectors.saving-throw",
    "SF2eTSC.effects.selectors.attack",
    "SF2eTSC.effects.selectors.skill-check",
    "SF2eTSC.effects.selectors.ability-check",
    "SF2eTSC.effects.selectors.station-check",
    "SF2eTSC.effects.selectors.station-damage",
    "SF2eTSC.effects.selectors.area-dc",
    "SF2eTSC.effects.selectors.ac-against-strikes",
    "SF2eTSC.effects.selectors.reflex-against-area",
    "SF2eTSC.effects.selectors.str-based",
    "SF2eTSC.effects.selectors.dex-based",
    "SF2eTSC.effects.selectors.con-based",
    "SF2eTSC.effects.selectors.int-based",
    "SF2eTSC.effects.selectors.wis-based",
    "SF2eTSC.effects.selectors.cha-based",
    "SF2eTSC.effects.selectors.fortitude",
    "SF2eTSC.effects.selectors.reflex",
    "SF2eTSC.effects.selectors.will",
    "SF2eTSC.effects.selectors.perception",
    "SF2eTSC.effects.status.active",
    "SF2eTSC.effects.status.pending",
    "SF2eTSC.effects.status.rolling",
    "SF2eTSC.effects.status.failed",
    "SF2eTSC.effects.status.partial",
    "SF2eTSC.effects.status.suppressed",
    "SF2eTSC.effects.status.ended",
    "SF2eTSC.effects.status.recovered",
    "SF2eTSC.effects.errors.gmOnly",
    "SF2eTSC.effects.errors.invalidCondition",
    "SF2eTSC.effects.errors.invalidConditionValue",
    "SF2eTSC.effects.errors.conditionNotFound",
    "SF2eTSC.effects.errors.nativeUnavailable",
    "SF2eTSC.effects.errors.nativeRejected",
    "SF2eTSC.effects.errors.nativeRemovalFailed",
    "SF2eTSC.effects.errors.invalidTargets",
    "SF2eTSC.effects.errors.staleTargets",
    "SF2eTSC.effects.errors.unsupportedWeaponDefenses",
    "SF2eTSC.effects.errors.noTargets",
    "SF2eTSC.effects.errors.invalidInput",
    "SF2eTSC.effects.errors.incompatibleStateTargets",
    "SF2eTSC.effects.errors.incompatibleShipCondition",
    "SF2eTSC.effects.errors.shipImmune",
    "SF2eTSC.effects.errors.incompatibleCrewCondition",
    "SF2eTSC.effects.errors.invalidPersistentDamage",
    "SF2eTSC.effects.errors.incompatiblePersistentTargets",
    "SF2eTSC.effects.errors.invalidModifier",
    "SF2eTSC.effects.errors.incompatibleCrewModifier",
    "SF2eTSC.effects.errors.incompatibleCrewStatistic",
    "SF2eTSC.effects.errors.operationConflict",
    "SF2eTSC.effects.errors.incompleteApplication",
    "SF2eTSC.effects.errors.nativeIdentityMismatch",
    "SF2eTSC.effects.errors.applicationNotFound",
    "SF2eTSC.effects.errors.foreignItem",
    "SF2eTSC.persistent.label",
    "SF2eTSC.persistent.applyHint",
    "SF2eTSC.persistent.apply",
    "SF2eTSC.persistent.recover",
    "SF2eTSC.persistent.errors.gmOnly",
    "SF2eTSC.persistent.errors.invalidPersistentDamage",
    "SF2eTSC.persistent.errors.nativeUnavailable",
    "SF2eTSC.persistent.errors.operationConflict",
    "SF2eTSC.persistent.errors.invalidInterval",
    "SF2eTSC.persistent.errors.staleReceipt",
    "SF2eTSC.persistent.errors.alreadyApplied",
    "SF2eTSC.persistent.errors.invalidRecipient",
    "SF2eTSC.persistent.errors.applyFirst",
    "SF2eTSC.status.operational",
    "SF2eTSC.status.destroyed"
  ];
  for (const key of keys) {
    assert.ok(en[key], `en: ${key}`);
    assert.ok(ru[key], `ru: ${key}`);
  }
  for (const key of Object.keys(en).filter((key) => /^SF2eTSC\.(?:effects|persistent)\./.test(key))) {
    assert.ok(ru[key], `ru parity: ${key}`);
  }
  for (const key of Object.keys(ru).filter((key) => /^SF2eTSC\.(?:effects|persistent)\./.test(key))) {
    assert.ok(en[key], `en parity: ${key}`);
  }
  assert.equal(en["SF2eTSC.effects.title"], "Starship Conditions & Effects");
  assert.equal(ru["SF2eTSC.effects.title"], "Состояния и эффекты звездолёта");
  assert.equal(ru["SF2eTSC.status.operational"], "Исправен");
  assert.equal(ru["SF2eTSC.status.destroyed"], "Уничтожен");
});
