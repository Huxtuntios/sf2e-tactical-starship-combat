import test from "node:test";
import assert from "node:assert/strict";
import { makeShip, makeCharacter, loadContentFromDisk, installFoundryMock } from "../helpers/foundry-mock.mjs";
import { registerApplicationService } from "../../scripts/starship/application-service.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import fs from "node:fs";
import Handlebars from "handlebars";

function installNativeEffectsFixture() {
  installFoundryMock();
  const definitions = new Map([
    ["frightened", { valued: true, rules: [{ key: "FlatModifier", selector: "all", type: "status", value: "-@item.badge.value" }] }],
    ["clumsy", { valued: true, rules: [{ key: "FlatModifier", selector: "dex-based", type: "status", value: "-@item.badge.value" }] }],
    ["off-guard", { valued: false, rules: [{ key: "FlatModifier", selector: "ac", type: "circumstance", value: -2 }] }],
    ["unconscious", { valued: false, rules: [{ key: "ActiveEffectLike", path: "system.foo", value: true }] }],
    ["persistent-damage", { valued: false, rules: [] }]
  ]);
  class NativeItem {
    constructor(source, { parent = null } = {}) {
      this._source = structuredClone(source);
      Object.assign(this, structuredClone(source));
      this.parent = parent;
      this.actor = parent;
      this.id = source._id;
      this.slug = source.system.slug;
      this.active = true;
    }
    get badge() {
      return { value: this.system.value.value };
    }
    isOfType(...types) {
      return types.includes(this.type);
    }
    toObject() {
      return structuredClone(this._source);
    }
    clone(changes = {}) {
      return new NativeItem({ ...this.toObject(), ...changes });
    }
    getRollOptions() {
      return [`item:type:${this.type}`, `item:slug:${this.slug}`];
    }
  }
  class FlatModifier {
    constructor(source, { parent }) {
      this.source = source;
      this.item = parent;
      this.actor = parent.actor;
    }
    beforePrepareData() {
      for (const selector of [this.source.selector].flat()) {
        (this.actor.synthetics.modifiers[selector] ??= []).push(({ test = [] } = {}) => {
          const modifier = typeof this.source.value === "number" ? this.source.value : -this.item.badge.value;
          const enabled = (this.source.predicate ?? []).every((option) => test.includes(option));
          return {
            modifier,
            slug: this.source.slug,
            type: this.source.type,
            label: this.item.name,
            predicate: this.source.predicate ?? [],
            enabled,
            ignored: !enabled
          };
        });
      }
    }
  }
  game.pf2e.RuleElements = { builtin: { FlatModifier } };
  game.pf2e.ConditionManager = {
    conditionsSlugs: [...definitions.keys()],
    getCondition(slug) {
      const def = definitions.get(slug);
      return def
        ? new NativeItem({
            type: "condition",
            name: slug,
            system: {
              slug,
              rules: structuredClone(def.rules),
              value: { isValued: def.valued, value: def.valued ? 1 : null },
              traits: { value: [] },
              references: { children: [], overrides: [], overriddenBy: [] }
            }
          })
        : null;
    }
  };
  CONFIG.Item = { documentClass: NativeItem };
  CONFIG.PF2E = {
    Item: { documentClasses: { condition: NativeItem, effect: NativeItem } },
    damageTypes: { fire: "Fire", bleed: "Bleed", void: "Void", vitality: "Vitality" },
    skills: { piloting: { attribute: "dex" }, arcana: { attribute: "int" } }
  };
  return { definitions, NativeItem };
}

function nativeActor(actor, { immune = [], unaffected = [] } = {}) {
  actor.isImmuneTo = function (item) {
    return immune.includes(typeof item === "string" ? item : item.slug);
  };
  actor.isAffectedBy = function (item) {
    return !unaffected.includes(item.slug);
  };
  actor.clone = function () {
    return { uuid: this.uuid, type: this.type, synthetics: { modifiers: {} }, getRollOptions: () => [], canHostRuleElements: true };
  };
  const create = actor.createEmbeddedDocuments.bind(actor);
  actor.createEmbeddedDocuments = async function (type, sources, options) {
    const allowed = sources.filter((source) => {
      const item = new CONFIG.Item.documentClass(source, { parent: actor });
      return this.isAffectedBy(item) && !this.isImmuneTo(item);
    });
    for (const source of allowed.filter((item) => item.type === "effect")) {
      const sourceId = source._stats?.duplicateSource ?? source._stats?.compendiumSource;
      const expired = [...this.items.values()].filter(
        (item) =>
          item.type === "effect" && item.system?.expired && (item._stats?.duplicateSource ?? item._stats?.compendiumSource) === sourceId
      );
      if (expired.length)
        await this.deleteEmbeddedDocuments(
          "Item",
          expired.map((item) => item.id)
        );
    }
    const docs = await create(type, allowed, options);
    if (options?.keepId)
      for (let index = 0; index < docs.length; index++) {
        this.items.delete(docs[index].id);
        docs[index].id = allowed[index]._id;
        this.items.set(docs[index].id, docs[index]);
      }
    return docs;
  };
  return actor;
}

async function setup() {
  installNativeEffectsFixture();
  await loadContentFromDisk();
  (await import("../../scripts/starship/effect-service.mjs")).registerEffectHandlers();
  registerApplicationService();
  const pc = nativeActor(makeCharacter({ id: "pilot", name: "Pilot" }));
  const ship = nativeActor(
    makeShip({
      id: "ship",
      crew: [{ actorUuid: pc.uuid, role: "crew", stationId: "pilot" }],
      stations: [{ id: "pilot", type: "pilot", grade: "commercial", helmedBy: pc.uuid }]
    })
  );
  const editor = await import("../../scripts/ui/effect-editor.mjs");
  const targets = await import("../../scripts/ui/effect-target-dialog.mjs").catch(() => ({}));
  const manager = await import("../../scripts/ui/effect-manager.mjs").catch(() => ({}));
  return { pc, ship, editor, targets, manager };
}
function form(values = {}, selected = {}) {
  return {
    elements: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        {
          value: String(value),
          checked: value === true,
          setCustomValidity() {},
          reportValidity() {
            return true;
          }
        }
      ])
    ),
    querySelectorAll: (selector) => (selected[/name="([^"]+)"/.exec(selector)?.[1]] ?? []).map((value) => ({ value })),
    reportValidity: () => true,
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null
  };
}

test("effect configuration respects valued conditions and ignores unused numeric fields", async () => {
  const { editor } = await setup();
  assert.equal(typeof editor.readEffectInput, "function");
  const input = editor.readEffectInput(form({ kind: "condition", slug: "frightened", conditionValue: 2, ignoreImmunities: false }));
  assert.equal(input.conditionValue, 2);
  assert.equal(input.ignoreImmunities, false);
  const unvalued = editor.readEffectInput(form({ kind: "condition", slug: "off-guard", conditionValue: 99, ignoreImmunities: true }));
  assert.equal(unvalued.conditionValue, null);
});

test("numeric configuration preserves explicit DC-only scope and cannot enable immunity override", async () => {
  const { editor } = await setup();
  assert.equal(typeof editor.readEffectInput, "function");
  const input = editor.readEffectInput(
    form({
      kind: "penalty",
      selector: "all",
      modifierType: "status",
      modifierValue: -2,
      statistic: "dc",
      label: "Penalty",
      ignoreImmunities: true
    })
  );
  assert.deepEqual(input.modifiers, [{ selector: "all", type: "status", value: -2 }]);
  assert.equal(input.statistic, "dc");
  assert.equal(input.ignoreImmunities, false);
});

test("target form keeps Entire Starship default and independent scope union", async () => {
  const { targets, pc } = await setup();
  assert.equal(typeof targets.readEffectTargets, "function");
  const selected = targets.readEffectTargets(
    form(
      { entire: true, weaponAttacks: false, allCrew: true },
      { mechanics: ["skills"], actions: [JSON.stringify({ stationId: "pilot", actionId: "evade" })], crew: [pc.uuid, pc.uuid] }
    )
  );
  assert.equal(selected.entire, true);
  assert.equal(selected.allCrew, true);
  assert.deepEqual(selected.crew, [pc.uuid]);
  assert.deepEqual(selected.actions, [{ stationId: "pilot", actionId: "evade" }]);
});

test("target summary keeps captured labels after crew reassignment", async () => {
  const { targets, pc } = await setup();
  assert.equal(typeof targets.effectTargetSummary, "function");
  const summary = targets.effectTargetSummary(
    { entire: false, crew: [pc.uuid] },
    { crew: [{ uuid: pc.uuid, label: "Original Pilot" }], stations: [], weapons: [], mechanics: [] }
  );
  assert.match(summary, /Original Pilot/);
});

test("target confirmation shows configured modifier value and DC scope", async () => {
  const { targets, ship } = await setup();
  const dialog = new targets.EffectTargetDialog(ship, {
    kind: "penalty",
    label: "Penalty",
    modifiers: [{ selector: "ac", type: "status", value: -2 }],
    statistic: "dc"
  });
  const context = await dialog._prepareContext();
  assert.match(context.caption, /-2/);
  assert.match(context.caption, /DCs only/);
});

test("manager renders configured condition values and numeric modifiers with DC scope", async () => {
  const { manager, ship } = await setup();
  ship.flags[MODULE_ID].starship.effects.push(
    {
      id: "manual-value",
      manual: true,
      kind: "condition",
      label: "Frightened",
      slug: "frightened",
      conditionValue: 2,
      targets: { entire: true }
    },
    {
      id: "manual-bonus",
      manual: true,
      kind: "bonus",
      label: "Shield",
      modifiers: [{ selector: "ac", value: 2, type: "status" }],
      statistic: "dc",
      targets: { entire: true }
    }
  );
  const context = await new manager.EffectManager(ship)._prepareContext();
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => game.i18n.localize(key));
  const html = h.compile(fs.readFileSync(new URL("../../templates/effect-manager.hbs", import.meta.url), "utf8"))(context);
  assert.match(html, /Frightened · 2/);
  assert.match(html, /\+2/);
  assert.match(html, /DCs only/);
});

test("persistent applications without a custom label display a localized manager name", async () => {
  const { manager, ship } = await setup();
  const { applyManualEffect } = await import("../../scripts/starship/application-service.mjs");
  await applyManualEffect(ship.uuid, { kind: "persistent-damage", persistent: { formula: "1d6", damageType: "fire", dc: 15 } });
  const context = await new manager.EffectManager(ship)._prepareContext();
  assert.equal(context.effects[0].label, game.i18n.localize("SF2eTSC.persistent.label"));
});

test("target confirmation applies through the real GM service once and closes only after success", async () => {
  const { targets, ship } = await setup();
  assert.equal(typeof targets.EffectTargetDialog, "function");
  const dialog = new targets.EffectTargetDialog(ship, { kind: "condition", slug: "frightened", conditionValue: 2 });
  let closed = 0;
  dialog.close = async () => {
    closed++;
  };
  const selected = form({ entire: true, weaponAttacks: false, allCrew: false });
  await dialog.submitSelection(selected);
  assert.equal(readStarship(ship).effects.length, 1);
  assert.equal(closed, 1);
});

test("manager removal cleans native recipients for manual applications", async () => {
  const { manager, ship, pc } = await setup();
  const { applyManualEffect } = await import("../../scripts/starship/application-service.mjs");
  await applyManualEffect(ship.uuid, {
    kind: "condition",
    slug: "frightened",
    conditionValue: 2,
    targets: { entire: false, crew: [pc.uuid] }
  });
  const effect = readStarship(ship).effects[0];
  const itemId = effect.nativeTargets[0].itemId;
  assert.equal(pc.items.has(itemId), true);
  const app = new manager.EffectManager(ship);
  app.render = async () => app;
  await manager.EffectManager.DEFAULT_OPTIONS.actions.remove.call(app, {}, { dataset: { effectId: effect.id } });
  assert.equal(app.error, "");
  assert.equal(readStarship(ship).effects.length, 0);
  assert.equal(pc.items.has(itemId), false);
});

test("manager is raised only after asynchronous rendering completes", async () => {
  const { manager, ship } = await setup();
  const proto = manager.EffectManager.prototype;
  const renderDescriptor = Object.getOwnPropertyDescriptor(proto, "render");
  const raiseDescriptor = Object.getOwnPropertyDescriptor(proto, "bringToFront");
  let finishRender,
    ready = false,
    raised = 0;
  proto.render = function () {
    return new Promise((resolve) => {
      finishRender = () => {
        ready = true;
        resolve(this);
      };
    });
  };
  proto.bringToFront = function () {
    assert.equal(ready, true);
    raised++;
  };
  try {
    assert.doesNotThrow(() => manager.openEffectManager(ship));
    assert.equal(raised, 0);
    finishRender();
    await Promise.resolve();
    assert.equal(raised, 1);
  } finally {
    if (renderDescriptor) Object.defineProperty(proto, "render", renderDescriptor);
    else delete proto.render;
    if (raiseDescriptor) Object.defineProperty(proto, "bringToFront", raiseDescriptor);
    else delete proto.bringToFront;
  }
});

test("empty target selection and player permissions never create applications", async () => {
  const { targets, manager, ship } = await setup();
  assert.equal(typeof targets.EffectTargetDialog, "function");
  assert.equal(typeof manager.openEffectManager, "function");
  const dialog = new targets.EffectTargetDialog(ship, { kind: "condition", slug: "frightened", conditionValue: 1 });
  await dialog.submitSelection(form({ entire: false, weaponAttacks: false, allCrew: false }));
  assert.equal(readStarship(ship).effects.length, 0);
  game.user = game.users.get("p1");
  assert.equal(manager.openEffectManager(ship), null);
  await dialog.submitSelection(form({ entire: true, weaponAttacks: false, allCrew: false }));
  assert.equal(readStarship(ship).effects.length, 0);
});

test("sheet and both public/private map detail offer the same GM-only manager entry", async () => {
  const { ship } = await setup();
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => game.i18n.localize(key));
  h.registerHelper("eq", (a, b) => a === b);
  const renderSheet = h.compile(fs.readFileSync(new URL("../../templates/starship-sheet.hbs", import.meta.url), "utf8"));
  assert.match(renderSheet({ isGM: true, tab: "overview", effects: [] }), /data-action="manageEffects"/);
  assert.doesNotMatch(renderSheet({ isGM: false, tab: "overview", effects: [] }), /data-action="manageEffects"/);
  const renderDetail = h.compile(fs.readFileSync(new URL("../../templates/sensor-map-detail.hbs", import.meta.url), "utf8"));
  for (const privateContact of [false, true]) {
    const detail = { key: ship.uuid, privateContact, effectShipUuid: ship.uuid, canManageEffects: true };
    assert.match(renderDetail({ isGM: true, detail }), /data-action="manageEffects"/);
    assert.doesNotMatch(renderDetail({ isGM: false, detail }), /data-action="manageEffects"/);
  }
});

test("manager shows exact native recipients and saved status without requiring current assignment", async () => {
  const { manager, ship, pc } = await setup();
  assert.equal(typeof manager.EffectManager, "function");
  ship.flags[MODULE_ID].starship.effects.push({
    id: "manual-old",
    manual: true,
    status: "active",
    kind: "condition",
    label: "Frightened",
    targets: { entire: false, crew: [pc.uuid] },
    nativeTargets: [{ actorUuid: pc.uuid, itemId: "gone", status: "ended" }],
    targetSnapshot: { crew: [{ uuid: pc.uuid, label: "Original Pilot" }], stations: [], actions: [], weapons: [], mechanics: [] }
  });
  ship.flags[MODULE_ID].starship.crew = [];
  ship.flags[MODULE_ID].starship.stations = [];
  const context = await new manager.EffectManager(ship)._prepareContext();
  assert.equal(context.effects.length, 1);
  assert.match(context.effects[0].summary, /Original Pilot/);
  assert.equal(context.effects[0].recipients[0].ended, true);
});
