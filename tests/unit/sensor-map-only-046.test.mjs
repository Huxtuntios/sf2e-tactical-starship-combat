import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  installFoundryMock,
  loadContentFromDisk,
  makeCharacter,
  makeShip,
  makeStarshipCombat,
  MockActor,
  dice
} from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { addSensorContact } from "../../scripts/sensor/contact-service.mjs";
import { privateContacts, changePrivateContact, pendingPrivateReveals } from "../../scripts/sensor/private-contacts.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { loadStarship, patchStarship, readStarship, replaceStarshipMap } from "../../scripts/starship/starship-state.mjs";
import { executeAction } from "../../scripts/actions/action-engine.mjs";
import { addSensorObjectToInitiative } from "../../scripts/sensor/initiative.mjs";
import { sensorUpdate } from "../../scripts/sensor/map-handlers.mjs";
import { HazardEngine, placeHazard } from "../../scripts/hazards/hazard-engine.mjs";
import {
  deleteMapObjectSource,
  mapObjectSources,
  resolveSensorActorForAction,
  resolveSensorActorSync
} from "../../scripts/sensor/map-object.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { observerKeys } from "../../scripts/sensor/map-model.mjs";
import { targetingState } from "../../scripts/engine/target-rules.mjs";
import { ensurePrivateStore } from "../../scripts/sensor/private-store.mjs";
import { addNativeCondition, removeNativeCondition } from "../../scripts/starship/native-condition-adapter.mjs";
import { installNativeEffectsFixture } from "../helpers/native-effect-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const setup = () => {
  installFoundryMock();
  return makeStarshipCombat();
};
const ship = (id, { role = "npc", owners = [], name = id } = {}) => makeShip({ id, name, role, owners, sp: 12, hp: 24 });
const hazard = (id, extra = {}) => {
  const actor = new MockActor({
    id,
    name: id,
    type: "hazard",
    system: { details: { isComplex: true }, attributes: { hp: { value: 20, max: 20 }, hasHealth: true } },
    ...extra
  });
  game.actors.set(actor.id, actor);
  return actor;
};

class FoundryForcedDeletion {}
class FoundryForcedReplacement {
  constructor(value) {
    this.value = value;
  }
  static get(operator) {
    return operator.value;
  }
}
const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function mergeDocumentObject(current, patch) {
  const merged = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof FoundryForcedDeletion) delete merged[key];
    else if (value instanceof FoundryForcedReplacement) merged[key] = structuredClone(FoundryForcedReplacement.get(value));
    else if (isPlainObject(value)) merged[key] = mergeDocumentObject(isPlainObject(merged[key]) ? merged[key] : {}, value);
    else merged[key] = structuredClone(value);
  }
  return merged;
}
function installFoundryJournalUpdateMock(journal, { injectGMOwner = false, dropUndefined = false } = {}) {
  foundry.data = {
    ...foundry.data,
    operators: { ...foundry.data?.operators, ForcedDeletion: FoundryForcedDeletion, ForcedReplacement: FoundryForcedReplacement }
  };
  journal.update = async (changes) => {
    const expanded = {};
    for (const [path, value] of Object.entries(changes)) {
      const parts = path.split(".");
      let target = expanded;
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = value;
    }
    const merged = mergeDocumentObject({ flags: journal.flags }, expanded);
    if (injectGMOwner) {
      const gm = game.users.activeGM;
      const sources = merged.flags?.[MODULE_ID]?.privateSensor?.mapObjects ?? {};
      for (const record of Object.values(sources)) if (record?.data?.ownership) record.data.ownership[gm.id] = 3;
    }
    journal.flags = dropUndefined ? JSON.parse(JSON.stringify(merged.flags)) : merged.flags;
    globalThis.__writes.push({ doc: `JournalEntry.${journal.id}`, changes: structuredClone(changes) });
    Hooks.callAll("updateJournalEntry", journal, changes);
    return journal;
  };
}

async function dropHandler(combat, source, { confirm = async () => true } = {}) {
  const { wireSensorMapDragDrop } = await import("../../scripts/ui/sensor-drop-ui.mjs");
  const handlers = {};
  const warnings = [];
  const zone = {
    dataset: { zone: "2" },
    classList: { add() {}, remove() {} },
    addEventListener: (name, handler) => (handlers[name] = handler)
  };
  const element = { querySelectorAll: (selector) => (selector.startsWith(".tsc-zone") ? [zone] : []) };
  wireSensorMapDragDrop(
    element,
    { combatId: combat.id, movableKeys: getTsc(combat).objects.map((object) => object.key) },
    {
      resolve: async () => source,
      confirm,
      send: async () => {},
      warn: (key, data) => warnings.push({ key, data }),
      info: () => {}
    }
  );
  return {
    warnings,
    zone,
    drop: (payload = { type: "Actor", uuid: source.uuid }) =>
      handlers.drop({ preventDefault() {}, dataTransfer: { getData: () => JSON.stringify(payload) } })
  };
}

test("repeated visible world drops create independent map-only records without Actor documents", async () => {
  const combat = setup();
  const source = ship("visible-source", { owners: ["p1"] });
  const before = source.toObject();

  const first = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });
  const second = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 5,
    detection: "identified"
  });

  assert.notEqual(first.key, second.key);
  assert.equal(first.actorUuid, first.key);
  assert.equal(second.actorUuid, second.key);
  assert.deepEqual(
    getTsc(combat).objects.map((object) => [object.key, object.actorUuid, object.mapOnly, object.zone]),
    [
      [first.key, first.key, true, 2],
      [second.key, second.key, true, 5]
    ]
  );
  assert.equal(game.actors.size, 1);
  assert.deepEqual(
    globalThis.__writes.filter((write) => write.doc.startsWith("Actor.")),
    []
  );
  assert.deepEqual(source.toObject(), before);
  const publicMap = JSON.stringify(getTsc(combat));
  assert.equal(publicMap.includes(source.uuid), false);
  assert.equal(publicMap.includes("sourceUuid"), false);
  assert.equal(publicMap.includes("sensorContactInstance"), false);
});

test("publication cleanup attempts both operations and preserves the original error", async () => {
  const combat = setup();
  const source = ship("publication-cleanup", { role: "npc" });
  const create = combat.createEmbeddedDocuments.bind(combat);
  const update = combat.update.bind(combat);
  let failUpdate = false;
  let deleteAttempted = false;
  let stateAttempted = false;
  combat.createEmbeddedDocuments = async (...args) => {
    await create(...args);
    failUpdate = true;
    throw new Error("publication failed");
  };
  combat.deleteEmbeddedDocuments = async (...args) => {
    deleteAttempted = true;
    throw new Error("combatant cleanup failed");
  };
  combat.update = async (...args) => {
    if (failUpdate) {
      stateAttempted = true;
      throw new Error("state cleanup failed");
    }
    return update(...args);
  };
  await assert.rejects(
    addSensorContact(combat, {
      source: "world",
      uuid: source.uuid,
      zone: 3,
      detection: "identified",
      publicActor: true
    }),
    /publication failed/
  );
  assert.equal(deleteAttempted, true);
  assert.equal(stateAttempted, true);
});

test("snapshot deletion failure does not replace the Combat publication error", async () => {
  const combat = setup();
  const source = ship("publication-cleanup-delete-failure", { role: "npc" });
  let journalDeleteAttempted = false;
  combat.createEmbeddedDocuments = async () => {
    const store = await ensurePrivateStore(combat.id);
    store.update = async () => {
      journalDeleteAttempted = true;
      throw new Error("journal deletion failed");
    };
    throw new Error("publication failed");
  };
  await assert.rejects(
    addSensorContact(combat, {
      source: "world",
      uuid: source.uuid,
      zone: 3,
      detection: "identified",
      publicActor: true
    }),
    /publication failed/
  );
  assert.equal(journalDeleteAttempted, true);
});

test("repeated private world drops retain separate GM-private map snapshots", async () => {
  const combat = setup();
  const source = ship("private-source");
  const before = source.toObject();
  const spec = { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" };

  const first = await addSensorContact(combat, spec);
  const second = await addSensorContact(combat, { ...spec, zone: 6 });

  assert.notEqual(first.key, second.key);
  const contacts = privateContacts(combat.id);
  assert.equal(contacts.length, 2);
  assert.deepEqual(
    contacts.map((contact) => [contact.key, contact.actorUuid, contact.mapOnly, contact.zone]),
    [
      [first.key, first.key, true, 3],
      [second.key, second.key, true, 6]
    ]
  );
  assert.equal(game.actors.size, 1);
  assert.deepEqual(source.toObject(), before);
  assert.equal(JSON.stringify(getTsc(combat)).includes(source.name), false);
  assert.equal(JSON.stringify(getTsc(combat)).includes(source.uuid), false);
  assert.equal((await loadStarship(first.key)).uuid, first.key);
  assert.equal((await loadStarship(second.key)).uuid, second.key);
});

test("hidden map-only contacts keep GM private controls and quick vitals", async () => {
  const combat = setup();
  const source = ship("hidden-gm-controls");
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "hidden"
  });
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const app = new SensorMapApplication();
  app.selected = placement.key;
  try {
    const context = await app._prepareContext({ parts: ["bar", "zones", "detail"] });
    assert.equal(
      context.zones.flatMap((zone) => zone.objects).some((object) => object.tscPrivateProjection),
      false
    );
    assert.equal(
      app._privateObjects.some((contact) => contact.key === placement.key),
      true
    );
    assert.equal(context.detail.privateContact, true);
    assert.deepEqual(context.detail.vitals, {
      shipUuid: placement.key,
      hp: 24,
      hpMax: 24,
      sp: 12,
      spMax: 12
    });
  } finally {
    app._cleanup();
  }
});

test("explicit public placement permits a player-role ship without player ownership", async () => {
  const combat = setup();
  const source = ship("public-player-role", { role: "player", owners: [] });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 4,
    detection: "identified",
    publicActor: true
  });

  assert.equal(placement.result, "added");
  assert.equal(getTsc(combat).objects[0].type, "starship");
  assert.equal(privateContacts(combat.id).length, 0);
});

test("confirmed public drag/drop passes the public placement contract", async () => {
  const combat = setup();
  const source = ship("public-drag-player", { role: "player", owners: [] });
  const handler = await dropHandler(combat, source, { confirm: async () => true });
  await handler.drop();

  assert.deepEqual(handler.warnings, []);
  assert.equal(getTsc(combat).objects[0].type, "starship");
  assert.equal(privateContacts(combat.id).length, 0);
});

test("players resolve public player-owned map placements without private snapshot access", async () => {
  const combat = setup();
  const source = ship("public-player-source", { role: "player", owners: ["p1"] });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 5,
    detection: "identified"
  });
  assert.equal(getTsc(combat).objects[0].sourceUuid, source.uuid);
  assert.equal(
    targetingState(getTsc(combat), source.uuid, []).objects.some((object) => object.key === source.uuid),
    true
  );
  game.user = game.users.get("p1");

  const actor = resolveSensorActorSync(combat, placement.key);
  assert.equal(actor?.uuid, placement.key);
  assert.equal(actor?.mapOnly, true);
  assert.equal(actor?.testUserPermission(game.user, "OBSERVER"), true);
  assert.equal(readStarship(actor).role, "player");
  assert.deepEqual(observerKeys(getTsc(combat), game.user), [placement.key]);
  assert.deepEqual(mapObjectSources(combat.id), {});

  game.user = game.users.get("gm");
  await patchStarship(actor, (data) => {
    data.hp.value = 7;
  });
  game.user = game.users.get("p1");
  assert.equal(readStarship(resolveSensorActorSync(combat, placement.key)).hp.value, 7);
});

test("source Actor UUID aliases resolve to the independently edited placed copy", async () => {
  const combat = setup();
  const source = ship("alias-source", { role: "player", owners: ["p1"], speed: 3 });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 4,
    detection: "identified"
  });
  const placed = await loadStarship(placement.key);
  await patchStarship(placed, (data) => {
    data.speed = 9;
  });
  const alias = await resolveSensorActorForAction(combat, source.uuid);
  assert.equal(alias.mapOnly, true);
  assert.equal(alias.uuid, placement.key);
  const draft = new Draft(combat, { actionAliases: true });
  const entry = await draft.ship(source.uuid);
  assert.equal(entry.actor.uuid, placement.key);
  assert.equal(entry.data.speed, 9);
  assert.equal(readStarship(source).speed, 3);
});

test("non-action drafts keep the exact source Actor identity", async () => {
  const combat = setup();
  const source = ship("exact-draft-source", { role: "player", owners: ["p1"], speed: 3 });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 4,
    detection: "identified"
  });
  const placed = await loadStarship(placement.key);
  await patchStarship(placed, (data) => {
    data.speed = 9;
  });
  const draft = new Draft(combat);
  const entry = await draft.ship(source.uuid);
  assert.equal(entry.actor.uuid, source.uuid);
  assert.equal(entry.data.speed, 3);
});

test("a direct source placement takes precedence over a map-only source alias", async () => {
  const combat = setup();
  const source = ship("direct-alias-source", { role: "player", owners: ["p1"], speed: 3 });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 4,
    detection: "identified"
  });
  combat.flags[MODULE_ID].tsc.objects.push({
    key: source.uuid,
    actorUuid: source.uuid,
    type: "starship",
    name: source.name,
    zone: 7,
    heading: "right"
  });
  const resolved = await resolveSensorActorForAction(combat, source.uuid);
  assert.equal(resolved.uuid, source.uuid);
  assert.equal(resolved.mapOnly, undefined);
  assert.equal((await resolveSensorActorForAction(combat, placement.key)).uuid, placement.key);
});

test("ambiguous source Actor aliases require an explicit placed-copy UUID", async () => {
  const combat = setup();
  const source = ship("ambiguous-alias-source", { role: "player", owners: ["p1"] });
  const first = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 4,
    detection: "identified"
  });
  const second = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 7,
    detection: "identified"
  });
  await assert.rejects(resolveSensorActorForAction(combat, source.uuid), /ambiguousSource|multiple Sensor Map placements/i);
  assert.equal((await resolveSensorActorForAction(combat, first.key)).uuid, first.key);
  assert.equal((await resolveSensorActorForAction(combat, second.key)).uuid, second.key);
});

function installSnapshotSheetMock() {
  const renders = [];
  class TestActorSheet {
    constructor(document) {
      this.document = document;
      this.rendered = false;
    }

    get isEditable() {
      return this.document.testUserPermission(game.user, "OWNER");
    }

    async _prepareContext() {
      return { document: this.document, editable: this.isEditable };
    }

    async render(...args) {
      renders.push({ sheet: this, options: args.at(-1) });
      this.rendered = true;
      return this;
    }

    async close() {
      this.rendered = false;
    }

    async _processSubmitData(_event, _form, submitData) {
      if (!this.isEditable) return {};
      if (!this.document.collection?.has(this.document.id)) throw new Error("Document creation from TestActorSheet is not supported.");
      return { updated: await this.document.update(submitData) };
    }

    async submit(submitData) {
      if (!this.isEditable) return {};
      return this._processSubmitData(null, null, submitData);
    }
  }
  class TestNativeItem {
    constructor(data, parent) {
      this.id = data._id;
      this._source = structuredClone(data);
      this.system = structuredClone(data.system ?? {});
      this.parent = parent;
    }

    async update(changes) {
      const [updated] = await this.constructor.updateDocuments([{ _id: this.id, ...changes }], { parent: this.parent });
      return updated;
    }

    async delete() {
      const [deleted] = await this.constructor.deleteDocuments([this.id], { parent: this.parent });
      return deleted;
    }

    static async updateDocuments() {
      return [];
    }

    static async deleteDocuments() {
      return [];
    }
  }
  class TestActorDocument {
    constructor(data) {
      this.id = typeof data._id === "string" && data._id.length === 16 ? data._id : null;
      this.uuid = this.id ? `Actor.${this.id}` : null;
      this.name = data.name;
      this.type = data.type;
      this._source = structuredClone(data);
      this.data = structuredClone(data);
      this.system = this.data.system;
      this.ownership = this.data.ownership;
      this.items = new Map((data.items ?? []).map((item) => [item._id, new TestNativeItem(item, this)]));
      this.sheet = new TestActorSheet(this);
    }

    testUserPermission(user, level) {
      const granted = this.ownership?.[user?.id] ?? this.ownership?.default ?? 0;
      return granted >= ({ LIMITED: 1, OBSERVER: 2, OWNER: 3 }[level] ?? Infinity);
    }

    updateSource(data) {
      this._source = structuredClone(data);
      this.data = structuredClone(data);
      this.name = this.data.name;
      this.type = this.data.type;
      this.system = this.data.system;
      this.ownership = this.data.ownership;
    }
  }
  CONFIG.Actor = { documentClass: TestActorDocument };
  return { renders, nativeUpdate: TestNativeItem.prototype.update };
}

function installPreparedSnapshotMock() {
  class PreparedSheet {
    constructor(document) {
      this.document = document;
      this.rendered = false;
    }

    async render() {
      this.rendered = true;
      return this;
    }

    async close() {
      this.rendered = false;
    }

    async submit(submitData) {
      return this._processSubmitData(null, null, submitData);
    }
  }
  class PreparedStatistic {
    constructor(actor, slug, mod) {
      this.actor = actor;
      this.slug = slug;
      this.mod = mod;
      this.domains = [slug, "all"];
      this.check = { mod, roll: async () => ({ total: 12, degreeOfSuccess: 0, dice: [{ total: 12 }] }) };
      this.dc = { value: 10 + mod };
    }

    clone(data = {}) {
      return new PreparedStatistic(this.actor, data.slug ?? this.slug, data.mod ?? this.mod);
    }
  }
  class PreparedActor {
    constructor(data) {
      this.id = data._id;
      this.uuid = `Actor.${this.id}`;
      this._source = structuredClone(data);
      this.sheet = new PreparedSheet(this);
      this.updateSource(this._source);
    }

    updateSource(data) {
      this._source = structuredClone(data);
      this.name = this._source.name;
      this.type = this._source.type;
      this.ownership = structuredClone(this._source.ownership ?? { default: 0 });
      this.system = structuredClone(this._source.system ?? {});
      this.flags = structuredClone(this._source.flags ?? {});
      this.flags.sf2e ??= {};
      this.flags.sf2e.rollOptions ??= {};
      this.flags.sf2e.rollOptions.all ??= {};
      this.flags.sf2e.rollOptions.all[`self:type:${this.type}`] = true;
      this.items = new Map();
      this.itemTypes = {};
      this.synthetics = { modifiers: {} };
      for (const source of this._source.items ?? []) {
        const item = {
          ...structuredClone(source),
          _source: structuredClone(source),
          id: source._id,
          uuid: `${this.uuid}.Item.${source._id}`,
          parent: this,
          actor: this,
          active: source.active !== false,
          isOfType: (...types) => types.includes(source.type),
          getRollOptions: () => [`item:type:${source.type}`, `item:slug:${source.system?.slug ?? source.slug}`]
        };
        this.items.set(item.id, item);
        (this.itemTypes[item.type] ??= []).push(item);
        if (item.type !== "condition") continue;
        for (const rule of item.system.rules ?? []) {
          if (rule.key !== "FlatModifier") continue;
          (this.synthetics.modifiers[rule.selector] ??= []).push(() => ({
            modifier: rule.value,
            type: rule.type,
            label: item.name,
            slug: item.slug,
            source: item.uuid
          }));
        }
      }
      const valued = new Map();
      for (const item of this.itemTypes.condition ?? []) {
        if (typeof item.system.value?.value !== "number") continue;
        const values = valued.get(item.slug) ?? [];
        values.push(item);
        valued.set(item.slug, values);
      }
      for (const items of valued.values()) {
        const highest = Math.max(...items.map((item) => item.system.value.value));
        for (const item of items) if (item.system.value.value < highest) item.active = false;
      }
      const reflexMod = 8 + (this.synthetics.modifiers["dex-based"] ?? []).reduce((total, factory) => total + factory().modifier, 0);
      this.saves = {
        fortitude: new PreparedStatistic(this, "fortitude", 8),
        reflex: new PreparedStatistic(this, "reflex", reflexMod),
        will: new PreparedStatistic(this, "will", 8)
      };
      this.skills = {};
      this.perception = new PreparedStatistic(this, "perception", 6);
      this.armorClass = { value: 10, modifiers: [], dc: { value: 10, modifiers: [] } };
      this.attributes = {
        ...this.system.attributes,
        immunities: (this.system.attributes?.immunities ?? []).map((entry) => {
          if (typeof entry === "string") return { test: (options) => options.has(`item:slug:${entry}`) };
          if (typeof entry.test === "function") return entry;
          return { test: (options) => options.has(entry.rollOption) };
        })
      };
    }

    testUserPermission(user, level) {
      if (user?.isGM) return true;
      const granted = this.ownership[user?.id] ?? this.ownership.default ?? 0;
      return granted >= ({ LIMITED: 1, OBSERVER: 2, OWNER: 3 }[level] ?? Infinity);
    }

    isOfType(...types) {
      return types.includes(this.type);
    }

    getRollOptions(domains = []) {
      const included = new Set(["all", ...domains]);
      return Object.entries(this.flags.sf2e.rollOptions.all)
        .filter(
          ([key, enabled]) =>
            enabled && (included.has("all") || [...included].some((domain) => key === domain || key.startsWith(`${domain}:`)))
        )
        .map(([key]) => key);
    }

    isImmuneTo(condition) {
      const options = new Set(
        typeof condition === "string"
          ? [`item:type:condition`, `item:slug:${condition}`]
          : (condition.getRollOptions?.("item") ?? [`item:type:${condition.type}`, `item:slug:${condition.slug}`])
      );
      return this.attributes.immunities.some((immunity) => immunity.test(options));
    }

    hasCondition(...slugs) {
      return [...this.items.values()].some((item) => item.type === "condition" && item.active && slugs.includes(item.slug));
    }

    getStatistic(slug) {
      return this.saves[slug] ?? this.skills[slug] ?? (slug === "perception" ? this.perception : null);
    }
  }
  CONFIG.Actor = { documentClass: PreparedActor };
}

function installSnapshotConditionFixture() {
  const definitions = new Map([
    ["clumsy", { name: "Clumsy", valued: true }],
    ["off-guard", { name: "Off-Guard", valued: false }]
  ]);
  game.pf2e.ConditionManager = {
    conditionsSlugs: [...definitions.keys()],
    getCondition(slug) {
      const definition = definitions.get(slug);
      if (!definition) return null;
      return {
        name: definition.name,
        system: { rules: [], value: { isValued: definition.valued, value: definition.valued ? 1 : null } },
        toObject: () => ({
          _id: `${slug}-template`,
          type: "condition",
          name: definition.name,
          system: { slug, rules: [], value: { isValued: definition.valued, value: definition.valued ? 1 : null } }
        })
      };
    },
    async updateConditionValue(itemId, actor, value) {
      const item = actor.items.get(itemId);
      if (value === 0) await item.delete();
      else if (actor.isOfType("creature")) await item.update({ "system.value.value": value });
    }
  };
}

test("GM can save map-only sheet edits to the snapshot and refresh the open sheet and Sensor Map", async () => {
  const combat = setup();
  const source = makeShip({ id: "sheet-source", name: "sheet-source", role: "player", owners: ["p1"], hp: 31, sp: 14 });
  const before = source.toObject();
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "identified" });
  const { renders } = installSnapshotSheetMock();
  const { registerSnapshotSheetRegistry } = await import("../../scripts/sensor/map-object.mjs");
  registerSnapshotSheetRegistry();
  const actor = resolveSensorActorSync(combat, placement.key);
  const sheet = actor.sheet;

  assert.equal(sheet.isEditable, true);
  assert.deepEqual(await sheet._prepareContext(), { document: sheet.document, editable: true });
  await sheet.render(true);
  await sheet.submit({
    name: "Saved snapshot",
    "system.attributes.hp.value": 7,
    [`flags.${MODULE_ID}.starship.ac`]: 19,
    [`flags.${MODULE_ID}.starship.speed`]: 9
  });

  const stored = mapObjectSources(combat.id)[placement.key].data;
  assert.equal(stored.name, "Saved snapshot");
  assert.equal(stored.system.attributes.hp.value, 7);
  assert.equal(stored.flags[MODULE_ID].starship.ac, 19);
  assert.equal(stored.flags[MODULE_ID].starship.speed, 9);
  const savedSheet = actor.sheet;
  assert.notStrictEqual(savedSheet, sheet);
  assert.equal(savedSheet.document.name, "Saved snapshot");
  assert.equal(savedSheet.document.system.attributes.hp.value, 7);
  assert.equal(sheet.rendered, false);
  assert.equal(savedSheet.rendered, true);
  assert.equal(renders.length, 2);
  assert.equal(renders.at(-1).options, true);
  assert.deepEqual(source.toObject(), before);
  assert.equal(game.actors.size, 1);

  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const app = new SensorMapApplication();
  app.selected = placement.key;
  try {
    const context = await app._prepareContext({ parts: ["bar", "zones", "detail"] });
    assert.equal(context.detail.label, "Saved snapshot");
    assert.equal(context.detail.vitals.hp, 7);
    assert.equal(context.detail.rows.find((row) => row.k === game.i18n.localize("SF2eTSC.ui.ac"))?.v, 19);
  } finally {
    app._cleanup();
  }
});

test("map-only sheet writes reject non-GM users even when they own the public projection", async () => {
  const combat = setup();
  const source = ship("sheet-permission-source", { role: "player", owners: ["p1"] });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified",
    publicActor: true
  });
  installSnapshotSheetMock();
  game.user = game.users.get("p1");
  const actor = resolveSensorActorSync(combat, placement.key);
  const sheet = actor.sheet;

  assert.equal(sheet.isEditable, false);
  assert.deepEqual(await sheet.submit({ "system.attributes.hp.value": 1 }), {});
  assert.equal(typeof sheet.document.update, "function");
  await assert.rejects(sheet.document.update({ "system.attributes.hp.value": 1 }), /active GM|активн.*GM/i);
  game.user = game.users.get("gm");
  assert.equal(mapObjectSources(combat.id)[placement.key].data.system.attributes.hp.value, 24);
});

test("repeated map-only sheet opens reuse one stable per-placement document and window", async () => {
  const combat = setup();
  const source = ship("sheet-registry-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const { renders } = installSnapshotSheetMock();
  const first = resolveSensorActorSync(combat, placement.key);
  const second = resolveSensorActorSync(combat, placement.key);

  assert.strictEqual(first.sheet, second.sheet);
  assert.strictEqual(first.sheet.document, second.sheet.document);
  assert.ok(first.sheet.document.id);
  assert.equal(first.sheet.document.id.length, 16);
  assert.equal(first.sheet.document.uuid, placement.key);
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const open = SensorMapApplication.DEFAULT_OPTIONS.actions.openSheet;
  await open.call({}, {}, { dataset: { key: placement.key } });
  await open.call({}, {}, { dataset: { key: placement.key } });
  assert.equal(new Set(renders.map((entry) => entry.sheet)).size, 1);
  assert.equal(renders.length, 2);
  assert.equal(game.actors.size, 1);
});

test("closed map-only sheets reopen as the same per-placement window", async () => {
  const combat = setup();
  const source = ship("sheet-close-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const { renders } = installSnapshotSheetMock();
  const actor = resolveSensorActorSync(combat, placement.key);
  const sheet = actor.sheet;

  await sheet.render(true);
  await sheet.close();
  assert.equal(sheet.rendered, false);
  const reopened = resolveSensorActorSync(combat, placement.key).sheet;
  assert.strictEqual(reopened, sheet);
  await reopened.render(true);
  assert.equal(new Set(renders.map((entry) => entry.sheet)).size, 1);
});

test("independent placements keep distinct sheets and snapshot values", async () => {
  const combat = setup();
  const source = ship("sheet-independent-source");
  const before = source.toObject();
  const first = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const second = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 5, detection: "hidden" });
  installSnapshotSheetMock();
  const firstSheet = resolveSensorActorSync(combat, first.key).sheet;
  const secondSheet = resolveSensorActorSync(combat, second.key).sheet;

  assert.notStrictEqual(firstSheet, secondSheet);
  assert.notStrictEqual(firstSheet.document, secondSheet.document);
  await firstSheet.submit({ "system.attributes.hp.value": 5 });
  const savedFirstSheet = resolveSensorActorSync(combat, first.key).sheet;
  assert.notStrictEqual(savedFirstSheet, firstSheet);
  assert.equal(savedFirstSheet.document.system.attributes.hp.value, 5);
  assert.equal(secondSheet.document.system.attributes.hp.value, 24);
  assert.equal(mapObjectSources(combat.id)[second.key].data.system.attributes.hp.value, 24);
  assert.deepEqual(source.toObject(), before);
});

test("direct snapshot store updates refresh an open sheet and deletion closes it", async () => {
  const combat = setup();
  const source = ship("sheet-external-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const { renders } = installSnapshotSheetMock();
  const { registerSnapshotSheetRegistry } = await import("../../scripts/sensor/map-object.mjs");
  registerSnapshotSheetRegistry();
  const sheet = resolveSensorActorSync(combat, placement.key).sheet;
  await sheet.render(true);
  const journal = game.journal.contents[0];
  installFoundryJournalUpdateMock(journal);
  const record = mapObjectSources(combat.id)[placement.key];
  record.data.system.attributes.hp.value = 6;
  await journal.update({
    [`flags.${MODULE_ID}.privateSensor.mapObjects.${placement.key}`]: new foundry.data.operators.ForcedReplacement(record)
  });

  let refreshed = sheet;
  for (let attempt = 0; attempt < 20 && refreshed === sheet; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    refreshed = resolveSensorActorSync(combat, placement.key).sheet;
  }
  assert.notStrictEqual(refreshed, sheet);
  assert.equal(refreshed.document.system.attributes.hp.value, 6);
  assert.equal(sheet.rendered, false);
  assert.equal(renders.length, 2);
  await deleteMapObjectSource(combat.id, placement.key);
  assert.equal(refreshed.rendered, false);
  assert.equal(resolveSensorActorSync(combat, placement.key), null);
});

test("private contact removal finishes when its snapshot sheet close fails", async () => {
  const combat = setup();
  const source = ship("sheet-close-failure-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  installSnapshotSheetMock();
  const sheet = resolveSensorActorSync(combat, placement.key).sheet;
  await sheet.render(true);
  sheet.close = async () => {
    sheet.rendered = false;
    throw new Error("injected sheet close failure");
  };

  await changePrivateContact(combat, placement.key, "remove");

  assert.equal(privateContacts(combat.id).length, 0);
  assert.deepEqual(getTsc(combat).objects, []);
  assert.equal(mapObjectSources(combat.id)[placement.key], undefined);
  assert.equal(resolveSensorActorSync(combat, placement.key), null);
});

test("a snapshot refresh does not reopen a sheet removed while close was pending", async () => {
  const combat = setup();
  const source = ship("sheet-refresh-race-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const { renders } = installSnapshotSheetMock();
  const { registerSnapshotSheetRegistry } = await import("../../scripts/sensor/map-object.mjs");
  registerSnapshotSheetRegistry();
  const sheet = resolveSensorActorSync(combat, placement.key).sheet;
  await sheet.render(true);
  let releaseClose;
  let closeStarted;
  const blocked = new Promise((resolve) => (releaseClose = resolve));
  const entered = new Promise((resolve) => (closeStarted = resolve));
  const close = sheet.close.bind(sheet);
  let first = true;
  sheet.close = async () => {
    if (first) {
      first = false;
      closeStarted();
      await blocked;
    }
    return close();
  };
  const journal = game.journal.contents[0];
  installFoundryJournalUpdateMock(journal);
  const record = mapObjectSources(combat.id)[placement.key];
  record.data.system.attributes.hp.value = 6;
  await journal.update({
    [`flags.${MODULE_ID}.privateSensor.mapObjects.${placement.key}`]: new foundry.data.operators.ForcedReplacement(record)
  });
  await entered;

  await Hooks.callAll("deleteCombat", combat);
  releaseClose();
  await new Promise(setImmediate);

  assert.equal(renders.length, 1);
  assert.equal(sheet.rendered, false);
});

test("deleting a combat unregisters its sheets before any close can race a refresh", async () => {
  const combat = setup();
  const source = ship("sheet-delete-order-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const { renders } = installSnapshotSheetMock();
  const { registerSnapshotSheetRegistry } = await import("../../scripts/sensor/map-object.mjs");
  registerSnapshotSheetRegistry();
  const sheet = resolveSensorActorSync(combat, placement.key).sheet;
  await sheet.render(true);
  let releaseClose;
  let closeStarted;
  const blocked = new Promise((resolve) => (releaseClose = resolve));
  const entered = new Promise((resolve) => (closeStarted = resolve));
  const close = sheet.close.bind(sheet);
  let first = true;
  sheet.close = async () => {
    if (first) {
      first = false;
      closeStarted();
      await blocked;
    }
    return close();
  };
  const journal = game.journal.contents[0];
  installFoundryJournalUpdateMock(journal);
  const record = mapObjectSources(combat.id)[placement.key];
  record.data.system.attributes.hp.value = 6;

  const deleting = Hooks.callAll("deleteCombat", combat);
  await entered;
  await journal.update({
    [`flags.${MODULE_ID}.privateSensor.mapObjects.${placement.key}`]: new foundry.data.operators.ForcedReplacement(record)
  });
  await new Promise(setImmediate);
  releaseClose();
  await deleting;
  await new Promise(setImmediate);

  assert.equal(renders.length, 1);
  assert.equal(sheet.rendered, false);
});

test("a public snapshot sheet closes when its projected record disappears", async () => {
  const combat = setup();
  const source = ship("sheet-missing-record-source", { role: "player", owners: ["p1"] });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified",
    publicActor: true
  });
  const { renders } = installSnapshotSheetMock();
  const { registerSnapshotSheetRegistry } = await import("../../scripts/sensor/map-object.mjs");
  registerSnapshotSheetRegistry();
  game.user = game.users.get("p1");
  const sheet = resolveSensorActorSync(combat, placement.key).sheet;
  await sheet.render(true);
  combat.flags[MODULE_ID].tsc.objects = [];

  await Hooks.callAll("updateCombat", combat);
  await new Promise(setImmediate);

  assert.equal(sheet.rendered, false);
  assert.equal(renders.length, 1);
  assert.equal(resolveSensorActorSync(combat, placement.key), null);
});

test("overlapping snapshot refreshes close replaced windows and keep the latest record", async () => {
  const combat = setup();
  const source = ship("sheet-overlap-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const { renders } = installSnapshotSheetMock();
  const { registerSnapshotSheetRegistry } = await import("../../scripts/sensor/map-object.mjs");
  registerSnapshotSheetRegistry();
  const sheet = resolveSensorActorSync(combat, placement.key).sheet;
  await sheet.render(true);
  let releaseClose;
  let closeStarted;
  const blocked = new Promise((resolve) => (releaseClose = resolve));
  const entered = new Promise((resolve) => (closeStarted = resolve));
  const close = sheet.close.bind(sheet);
  let first = true;
  sheet.close = async () => {
    if (first) {
      first = false;
      closeStarted();
      await blocked;
    }
    return close();
  };
  const journal = game.journal.contents[0];
  const refreshHook = Hooks._hooks.get("updateJournalEntry")[0];
  const record = journal.flags[MODULE_ID].privateSensor.mapObjects[placement.key];
  record.data.system.attributes.hp.value = 6;
  const firstRefresh = refreshHook(journal);
  await entered;
  record.data.system.attributes.hp.value = 7;
  const secondRefresh = refreshHook(journal);
  releaseClose();
  await Promise.all([firstRefresh, secondRefresh]);

  assert.equal(resolveSensorActorSync(combat, placement.key).sheet.document.system.attributes.hp.value, 7);
  assert.equal(renders.at(-1).sheet.rendered, true);
  assert.equal(
    renders.slice(0, -1).every((entry) => !entry.sheet.rendered),
    true
  );
});

test("one snapshot refresh failure does not prevent another sheet from closing", async () => {
  const combat = setup();
  const firstSource = ship("sheet-failure-first");
  const secondSource = ship("sheet-failure-second");
  const first = await addSensorContact(combat, { source: "world", uuid: firstSource.uuid, zone: 2, detection: "hidden" });
  const second = await addSensorContact(combat, { source: "world", uuid: secondSource.uuid, zone: 4, detection: "hidden" });
  installSnapshotSheetMock();
  const { registerSnapshotSheetRegistry } = await import("../../scripts/sensor/map-object.mjs");
  registerSnapshotSheetRegistry();
  const firstSheet = resolveSensorActorSync(combat, first.key).sheet;
  const secondSheet = resolveSensorActorSync(combat, second.key).sheet;
  await firstSheet.render(true);
  await secondSheet.render(true);
  firstSheet.close = async () => {
    firstSheet.rendered = false;
    throw new Error("injected first sheet refresh failure");
  };
  const journal = game.journal.contents[0];
  const sources = journal.flags[MODULE_ID].privateSensor.mapObjects;
  sources[first.key].data.system.attributes.hp.value = 6;
  delete sources[second.key];

  await Hooks._hooks.get("updateJournalEntry")[0](journal);

  assert.equal(secondSheet.rendered, false);
  assert.equal(resolveSensorActorSync(combat, second.key), null);
});

test("an unchanged combat update preserves unsaved snapshot sheet input", async () => {
  const combat = setup();
  const source = ship("sheet-unchanged-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const { renders } = installSnapshotSheetMock();
  const { registerSnapshotSheetRegistry } = await import("../../scripts/sensor/map-object.mjs");
  registerSnapshotSheetRegistry();
  const sheet = resolveSensorActorSync(combat, placement.key).sheet;
  await sheet.render(true);
  sheet.document.name = "Unsaved name";

  await Hooks.callAll("updateCombat", combat);
  await new Promise(setImmediate);

  assert.strictEqual(resolveSensorActorSync(combat, placement.key).sheet, sheet);
  assert.equal(sheet.document.name, "Unsaved name");
  assert.equal(renders.length, 1);
});

test("a rejected stale write cannot replace the actor used by an in-flight sheet refresh", async () => {
  const combat = setup();
  const source = ship("sheet-write-race-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  installSnapshotSheetMock();
  const first = await loadStarship(placement.key);
  const second = await loadStarship(placement.key);
  const sheet = first.sheet;
  await sheet.render(true);
  let releaseClose;
  let closeStarted;
  const blocked = new Promise((resolve) => (releaseClose = resolve));
  const entered = new Promise((resolve) => (closeStarted = resolve));
  const close = sheet.close.bind(sheet);
  let firstClose = true;
  sheet.close = async () => {
    if (firstClose) {
      firstClose = false;
      closeStarted();
      await blocked;
    }
    return close();
  };

  const saving = first.update({ "system.attributes.hp.value": 5 });
  await entered;
  const rejected = assert.rejects(
    second.update({ [`flags.${MODULE_ID}.starship.sp.value`]: 2 }, { expectedSource: structuredClone(second._source) }),
    /undoConflict|конфликт|Undo refused/i
  );
  releaseClose();
  await saving;
  await rejected;

  assert.equal(first.sheet.document.system.attributes.hp.value, 5);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.system.attributes.hp.value, 5);
});

test("map-only actors delegate prepared statistics, roll options and immunity without persisting derived data", async () => {
  const combat = setup();
  installPreparedSnapshotMock();
  const source = ship("prepared-snapshot-source");
  source.system.saves = { fortitude: { value: 8 }, reflex: { value: 8 }, will: { value: 8 } };
  source.system.attributes.immunities = ["clumsy"];
  source.flags.sf2e = { rollOptions: { all: { "self:test:snapshot": true } } };
  source.items.set("clumsy", {
    _id: "clumsy",
    type: "condition",
    slug: "clumsy",
    name: "Clumsy",
    active: true,
    system: { value: { isValued: true, value: 2 }, rules: [{ key: "FlatModifier", selector: "dex-based", type: "status", value: -4 }] }
  });
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const actor = resolveSensorActorSync(combat, placement.key);
  const prepared = actor.sheet.document;
  const { computeShipStats, rollNativeCheck, shipStatistic } = await import("../../scripts/starship/stats.mjs");
  const { nativeConditionModifiers } = await import("../../scripts/starship/native-condition-adapter.mjs");

  assert.strictEqual(actor.sheet.document, prepared);
  assert.ok(actor.getRollOptions().includes("self:test:snapshot"));
  assert.equal(actor.isImmuneTo("clumsy"), true);
  assert.deepEqual(nativeConditionModifiers(actor, "reflex"), [
    { selector: "reflex", type: "status", value: -4, label: "Clumsy", slug: "clumsy" }
  ]);
  assert.equal(computeShipStats(actor).reflex, 4);
  const statistic = shipStatistic(actor, "reflex");
  assert.equal(typeof statistic.check.roll, "function");
  const result = await rollNativeCheck({ statistic, dc: 15, createMessage: false });
  assert.equal(result.native, true);

  prepared.flags.sf2e.rollOptions.all["self:prepared:only"] = true;
  assert.equal(mapObjectSources(combat.id)[placement.key].data.flags.sf2e.rollOptions.all["self:prepared:only"], undefined);
});

test("snapshot saves replace the prepared ActorClass so native statistics recalculate", async () => {
  const combat = setup();
  installPreparedSnapshotMock();
  const source = ship("prepared-refresh-source");
  source.system.saves = { fortitude: { value: 8 }, reflex: { value: 8 }, will: { value: 8 } };
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const actor = resolveSensorActorSync(combat, placement.key);
  const prepared = actor.sheet.document;
  const { computeShipStats } = await import("../../scripts/starship/stats.mjs");
  assert.equal(computeShipStats(actor).reflex, 8);

  await actor.sheet.submit({
    "system.attributes.hp.value": 7,
    name: "Prepared refresh",
    items: [
      {
        _id: "refresh-clumsy",
        type: "condition",
        slug: "clumsy",
        name: "Clumsy",
        active: true,
        system: { value: { isValued: true, value: 2 }, rules: [{ key: "FlatModifier", selector: "dex-based", type: "status", value: -4 }] }
      }
    ]
  });
  const refreshed = actor.sheet.document;
  assert.notStrictEqual(refreshed, prepared);
  assert.equal(refreshed.system.attributes.hp.value, 7);
  assert.equal(refreshed.name, "Prepared refresh");
  assert.equal(computeShipStats(actor).reflex, 4);
  assert.equal(actor.getRollOptions().includes("self:type:npc"), true);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.system.attributes.hp.value, 7);
});

test("map-only sheet actor basics save through the snapshot and reject non-GM writers", async () => {
  const combat = setup();
  const source = ship("sheet-basics-source");
  const before = source.toObject();
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const socket = await import("../../scripts/socket.mjs");
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const emitted = [];
  let requestNumber = 0;
  const send = async (senderId, payload) => {
    const requestId = `basics-${requestNumber++}`;
    await socket.dispatchSocketMessage({ kind: "request", type: "actorBasics", requestId, payload }, senderId, {
      users: game.users,
      selfId: "gm",
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (message) => emitted.push(message)
    });
    return emitted.find((message) => message.requestId === requestId);
  };

  const saved = await send("gm", { actorUuid: placement.key, name: "Renamed snapshot" });
  assert.equal(saved.ok, true);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.name, "Renamed snapshot");
  const denied = await send("p1", { actorUuid: placement.key, name: "Player rename" });
  assert.equal(denied.ok, false);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.name, "Renamed snapshot");
  assert.deepEqual(source.toObject(), before);
});

test("map-only native conditions add, increment, persist and remove through embedded Items", async () => {
  const combat = setup();
  installSnapshotConditionFixture();
  const source = ship("snapshot-condition-source");
  const before = source.toObject();
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const actor = resolveSensorActorSync(combat, placement.key);

  assert.equal(typeof actor.increaseCondition, "function");
  const clumsy = await addNativeCondition(actor, "clumsy", 2);
  assert.notEqual(clumsy.id, "clumsy-template");
  assert.equal(clumsy.system.value.value, 2);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.items.find((item) => item._id === clumsy.id).system.value.value, 2);

  const increased = await addNativeCondition(actor, "clumsy", 3);
  assert.equal(increased.id, clumsy.id);
  assert.equal(actor.items.get(clumsy.id).system.value.value, 5);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.items.find((item) => item._id === clumsy.id).system.value.value, 5);

  const offGuard = await addNativeCondition(actor, "off-guard", 99);
  assert.equal(offGuard.system.value.value, null);
  assert.notEqual(offGuard.id, "off-guard-template");
  assert.equal(await removeNativeCondition(actor, clumsy.id), true);
  assert.equal(actor.items.has(clumsy.id), false);
  assert.equal(actor.items.has(offGuard.id), true);
  assert.deepEqual(
    mapObjectSources(combat.id)[placement.key].data.items.map((item) => item.system.slug),
    ["off-guard"]
  );
  assert.deepEqual(source.toObject(), before);
  assert.equal(game.actors.size, 1);
});

test("condition increments select the active prepared value instead of a lower raw duplicate", async () => {
  const combat = setup();
  installPreparedSnapshotMock();
  installSnapshotConditionFixture();
  const source = ship("prepared-condition-selection", { role: "player" });
  source.items.set("clumsy-low", {
    _id: "clumsy-low",
    type: "condition",
    slug: "clumsy",
    name: "Clumsy 1",
    active: true,
    system: { value: { isValued: true, value: 1 }, rules: [] }
  });
  source.items.set("clumsy-high", {
    _id: "clumsy-high",
    type: "condition",
    slug: "clumsy",
    name: "Clumsy 3",
    active: true,
    system: { value: { isValued: true, value: 3 }, rules: [] }
  });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified",
    publicActor: true
  });
  const actor = resolveSensorActorSync(combat, placement.key);

  const increased = await actor.increaseCondition("clumsy");

  assert.equal(increased.id, "clumsy-high");
  assert.equal(actor.items.get("clumsy-high").system.value.value, 4);
  assert.equal(actor.items.get("clumsy-low").system.value.value, 1);
});

test("vehicle snapshot conditions persist computed valued changes", async () => {
  const combat = setup();
  installSnapshotConditionFixture();
  const source = ship("vehicle-condition-source", { role: "player", owners: ["p1"] });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified",
    publicActor: true
  });
  const actor = resolveSensorActorSync(combat, placement.key);
  const clumsy = await actor.increaseCondition("clumsy", { value: 2 });

  const increased = await actor.increaseCondition("clumsy", { value: 3 });

  assert.equal(increased.id, clumsy.id);
  assert.equal(increased.system.value.value, 5);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.items[0].system.value.value, 5);

  await actor.decreaseCondition("clumsy");
  assert.equal(actor.items.get(clumsy.id).system.value.value, 4);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.items[0].system.value.value, 4);
});

test("persistent damage recovery removes only the selected damage type", async () => {
  const combat = setup();
  const source = ship("persistent-type-source");
  for (const [id, damageType] of [
    ["pd-fire", "fire"],
    ["pd-bleed", "bleed"]
  ]) {
    source.items.set(id, {
      _id: id,
      type: "condition",
      slug: "persistent-damage",
      name: `Persistent ${damageType}`,
      active: true,
      system: { persistent: { damageType }, value: { isValued: false, value: null } }
    });
  }
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const actor = resolveSensorActorSync(combat, placement.key);

  await actor.decreaseCondition("persistent-damage-fire");

  assert.equal(actor.items.has("pd-fire"), false);
  assert.equal(actor.items.has("pd-bleed"), true);
  assert.deepEqual(
    mapObjectSources(combat.id)[placement.key].data.items.map((item) => item.system.persistent.damageType),
    ["bleed"]
  );
});

test("candidate persistent damage immunity uses native damage-type roll options", async () => {
  const combat = setup();
  installPreparedSnapshotMock();
  class NativeCondition {
    constructor(data, { parent } = {}) {
      this._source = structuredClone(data);
      this.type = data.type;
      this.slug = data.system.slug;
      this.system = structuredClone(data.system);
      this.parent = parent;
    }

    getRollOptions(domain) {
      const options = [`item:type:${this.type}`, `item:slug:${this.slug}`];
      if (this.system.persistent) {
        options.push(`damage:type:${this.system.persistent.damageType}`, `${domain}:damage:type:${this.system.persistent.damageType}`);
      }
      return options;
    }

    toObject() {
      return structuredClone(this._source);
    }
  }
  CONFIG.PF2E ??= {};
  CONFIG.PF2E.Item = { documentClasses: { condition: NativeCondition } };
  const source = ship("candidate-immunity-source", { role: "player" });
  source.system.attributes.immunities = [{ rollOption: "damage:type:fire" }];
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified",
    publicActor: true
  });
  const actor = resolveSensorActorSync(combat, placement.key);

  const created = await actor.createEmbeddedDocuments("Item", [
    {
      type: "condition",
      slug: "persistent-damage",
      name: "Persistent Fire",
      system: { persistent: { damageType: "fire" }, value: { isValued: false, value: null } }
    }
  ]);

  assert.deepEqual(created, []);
  assert.deepEqual(mapObjectSources(combat.id)[placement.key].data.items ?? [], []);
});

test("open map-only effect manager reads conditions saved through another handle", async () => {
  const combat = setup();
  installSnapshotConditionFixture();
  const source = ship("effect-manager-refresh-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const actor = resolveSensorActorSync(combat, placement.key);
  const { EffectManager } = await import("../../scripts/ui/effect-manager.mjs");
  const manager = new EffectManager(actor);
  assert.deepEqual((await manager._prepareContext()).conditions, []);

  await resolveSensorActorSync(combat, placement.key).increaseCondition("off-guard");
  const conditions = (await manager._prepareContext()).conditions;
  assert.deepEqual(
    conditions.map((condition) => condition.slug),
    ["off-guard"]
  );
});

test("map-only embedded Item create, update and delete persist exact snapshot data", async () => {
  const combat = setup();
  const source = ship("snapshot-item-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const actor = resolveSensorActorSync(combat, placement.key);

  assert.equal(typeof actor.createEmbeddedDocuments, "function");
  const [created] = await actor.createEmbeddedDocuments(
    "Item",
    [{ _id: "snapshot-effect", type: "effect", name: "Snapshot effect", system: { slug: "snapshot-effect", value: 1 } }],
    { keepId: true }
  );
  assert.equal(created.id, "snapshot-effect");
  assert.equal(created.parent, actor);
  assert.equal(created.isOfType("effect"), true);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.items[0].system.value, 1);

  const [updated] = await actor.updateEmbeddedDocuments("Item", [{ _id: created.id, system: { value: 4 } }]);
  assert.equal(updated.system.value, 4);
  assert.equal(mapObjectSources(combat.id)[placement.key].data.items[0].system.value, 4);

  const [deleted] = await actor.deleteEmbeddedDocuments("Item", [created.id]);
  assert.equal(deleted.id, created.id);
  assert.equal(actor.items.has(created.id), false);
  assert.deepEqual(mapObjectSources(combat.id)[placement.key].data.items, []);
});

test("native Item controls on the snapshot clone persist through the snapshot store", async () => {
  const combat = setup();
  const source = ship("snapshot-native-item-source");
  source.items.set("native-effect", {
    _id: "native-effect",
    type: "effect",
    name: "Native effect",
    system: { value: 1 }
  });
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const { nativeUpdate } = installSnapshotSheetMock();
  const actor = resolveSensorActorSync(combat, placement.key);
  const sheet = actor.sheet;

  assert.equal(actor.items.has("native-effect"), true);
  assert.equal(sheet.document.items.get("native-effect").id, "native-effect");
  assert.equal(Object.hasOwn(sheet.document.items.get("native-effect"), "update"), true);
  assert.notStrictEqual(sheet.document.items.get("native-effect").update, nativeUpdate);
  await sheet.document.items.get("native-effect").update({ system: { value: 4 } });
  assert.equal(mapObjectSources(combat.id)[placement.key].data.items[0].system.value, 4);

  await actor.sheet.document.items.get("native-effect").delete();
  assert.deepEqual(mapObjectSources(combat.id)[placement.key].data.items, []);
});

test("snapshot counter effects delete when a native update falls below the minimum", async () => {
  const combat = setup();
  const source = ship("snapshot-counter-source");
  source.items.set("counter-effect", {
    _id: "counter-effect",
    type: "effect",
    name: "Counter",
    system: { badge: { type: "counter", min: 1, max: 3, value: 1 } }
  });
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  installSnapshotSheetMock();
  const actor = resolveSensorActorSync(combat, placement.key);

  await actor.sheet.document.items.get("counter-effect").update({ system: { badge: { value: 0 } } });

  assert.equal(actor.items.has("counter-effect"), false);
  assert.deepEqual(mapObjectSources(combat.id)[placement.key].data.items, []);
});

test("new timed effects start at the current world time and initiative", async () => {
  const combat = setup();
  const source = ship("snapshot-effect-start-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const actor = resolveSensorActorSync(combat, placement.key);
  game.time.worldTime = 3600;
  game.combat = { combatant: { initiative: 11 } };

  await actor.createEmbeddedDocuments("Item", [
    {
      type: "effect",
      name: "One minute",
      system: { start: { value: 0, initiative: null }, duration: { unit: "minutes", value: 1, expiry: "turn-start" } }
    },
    {
      type: "effect",
      name: "Unlimited",
      system: { start: { value: 0, initiative: null }, duration: { unit: "unlimited", value: -1, expiry: null } }
    }
  ]);

  const [timed, unlimited] = mapObjectSources(combat.id)[placement.key].data.items;
  assert.deepEqual(timed.system.start, { value: 3600, initiative: 11 });
  assert.deepEqual(timed.system.duration, { unit: "minutes", value: 1, expiry: "turn-start" });
  assert.deepEqual(unlimited.system.start, { value: 3600, initiative: 11 });
  assert.deepEqual(unlimited.system.duration, { unit: "unlimited", value: -1, expiry: null });
});

test("new timed effects prefer their origin combatant initiative", async () => {
  const combat = setup();
  const origin = ship("effect-origin-source");
  origin.combatant = { initiative: 10 };
  const source = ship("snapshot-effect-origin-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const actor = resolveSensorActorSync(combat, placement.key);
  game.time.worldTime = 3600;
  game.combat = { combatant: { initiative: 20 } };

  await actor.createEmbeddedDocuments("Item", [
    {
      type: "effect",
      name: "Origin timed",
      system: {
        context: { origin: { actor: origin.uuid } },
        start: { value: 0, initiative: null },
        duration: { unit: "minutes", value: 1, expiry: "turn-start" }
      }
    }
  ]);

  assert.deepEqual(mapObjectSources(combat.id)[placement.key].data.items[0].system.start, { value: 3600, initiative: 10 });
});

test("map-only native modifier derivation uses a detached clone and never persists prepared data", async () => {
  installNativeEffectsFixture();
  const combat = makeStarshipCombat();
  const source = makeShip({ id: "snapshot-modifier-source", name: "Snapshot modifier source", role: "npc" });
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const actor = resolveSensorActorSync(combat, placement.key);
  const { deriveConditionModifiers } = await import("../../scripts/starship/native-effect-adapter.mjs");

  assert.equal(typeof actor.clone, "function");
  const modifiers = deriveConditionModifiers("clumsy", 4, { actor, selector: "ac" });
  assert.equal(modifiers[0].value, -4);
  assert.deepEqual(mapObjectSources(combat.id)[placement.key].data.items ?? [], []);
  const clone = actor.clone({ items: [] });
  clone.synthetics.modifiers.ac = [];
  await assert.rejects(clone.update({ "system.attributes.hp.value": 1 }), {
    message: game.i18n.localize("SF2eTSC.effects.errors.nativeUnavailable")
  });
  assert.equal(mapObjectSources(combat.id)[placement.key].data.system.attributes.hp.value, 30);
});

test("concurrent map-only handles apply partial updates to the latest record", async () => {
  const combat = setup();
  const source = ship("concurrent-handles");
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });
  const first = await loadStarship(placement.key);
  const second = await loadStarship(placement.key);

  await first.update({ "system.attributes.hp.value": 5 });
  await second.update({ "flags.sf2e-tactical-starship-combat.starship.sp.value": 2 });

  const stored = mapObjectSources(combat.id)[placement.key].data;
  assert.equal(stored.system.attributes.hp.value, 5);
  assert.equal(stored.flags[MODULE_ID].starship.sp.value, 2);
});

test("queued map-only patches read fresh state inside the write queue", async () => {
  const combat = setup();
  const source = ship("queued-patches");
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });
  const first = await loadStarship(placement.key);
  const second = await loadStarship(placement.key);

  await Promise.all([
    patchStarship(first, (data) => {
      data.notes = "updated notes";
    }),
    patchStarship(second, (data) => {
      data.speed = 9;
    })
  ]);

  const data = readStarship(await loadStarship(placement.key));
  assert.equal(data.notes, "updated notes");
  assert.equal(data.speed, 9);
});

test("mixed direct updates and patches reject conflicts instead of overwriting newer map-only data", async () => {
  const combat = setup();
  const source = ship("mixed-write-queues");
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });
  const actor = await loadStarship(placement.key);
  let enter;
  let release;
  const entered = new Promise((resolve) => (enter = resolve));
  const blocked = new Promise((resolve) => (release = resolve));
  const patch = patchStarship(actor, async (data) => {
    data.notes = "patched notes";
    enter();
    await blocked;
  });
  await entered;
  await actor.update({ "flags.sf2e-tactical-starship-combat.starship.speed": 9 });
  release();
  await assert.rejects(patch, /undoConflict|конфликт|Undo refused/i);
  const data = readStarship(await loadStarship(placement.key));
  assert.equal(data.speed, 9);
  assert.notEqual(data.notes, "patched notes");
});

test("map-only defense replacement rejects source changes made after capture", async () => {
  const combat = setup();
  const source = ship("replace-map-conflict");
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });
  const actor = await loadStarship(placement.key);
  const pending = replaceStarshipMap(actor, "resistances", { fire: 5 });
  await Promise.resolve();
  await actor.update({ "flags.sf2e-tactical-starship-combat.starship.speed": 9 });
  await assert.rejects(pending, /undoConflict|конфликт|Undo refused/i);
  const data = readStarship(await loadStarship(placement.key));
  assert.equal(data.speed, 9);
  assert.equal(data.resistances.fire, undefined);
});

test("failed post-removal map cleanup completes on a later sensor update", async () => {
  const combat = setup();
  const source = ship("cleanup-retry", { role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified",
    publicActor: true
  });
  const journal = game.journal.contents[0];
  const update = journal.update.bind(journal);
  let fail = true;
  journal.update = async (changes) => {
    const deletion = Object.entries(changes).some(
      ([key, value]) => key.includes(`mapObjects.${placement.key}`) && value instanceof foundry.data.operators.ForcedDeletion
    );
    if (fail && deletion) {
      fail = false;
      throw new Error("injected snapshot cleanup failure");
    }
    return update(changes);
  };

  await assert.rejects(
    sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: placement.key } }),
    /injected snapshot cleanup failure/
  );
  assert.deepEqual(getTsc(combat).objects, []);
  assert.ok(mapObjectSources(combat.id)[placement.key]);

  journal.update = update;
  await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: placement.key } });
  assert.equal(mapObjectSources(combat.id)[placement.key], undefined);
  assert.equal(combat.combatants.size, 0);
});

test("keyed map snapshot reads do not clone unrelated records", async () => {
  const combat = setup();
  const firstSource = ship("keyed-first");
  const secondSource = ship("keyed-second");
  const first = await addSensorContact(combat, { source: "world", uuid: firstSource.uuid, zone: 2, detection: "hidden" });
  const second = await addSensorContact(combat, { source: "world", uuid: secondSource.uuid, zone: 3, detection: "hidden" });
  const raw = game.journal.contents[0].flags[MODULE_ID].privateSensor.mapObjects[second.key];
  Object.defineProperty(raw.data.system, "uncloneable", {
    enumerable: true,
    get() {
      throw new Error("unrelated record cloned");
    }
  });
  const { mapObjectSource } = await import("../../scripts/sensor/map-object.mjs");

  assert.equal(typeof mapObjectSource, "function");
  assert.equal(mapObjectSource(combat.id, first.key).key, first.key);
  assert.throws(() => mapObjectSources(combat.id), /unrelated record cloned/);
});

test("map-only current combatants highlight their placement", async () => {
  const combat = setup();
  const source = ship("current-map-only", { role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified",
    publicActor: true
  });
  combat.turn = 0;
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const app = new SensorMapApplication();
  try {
    const context = await app._prepareContext({ parts: ["zones"] });
    const object = context.zones.flatMap((zone) => zone.objects).find((entry) => entry.key === placement.key);
    assert.equal(object.current, true);
  } finally {
    app._cleanup();
  }
});

test("map-only configuration, heading and vitals edits stay isolated per record and from the source", async () => {
  const combat = setup();
  const source = ship("edit-source", { owners: ["p1"] });
  const before = source.toObject();
  const first = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });
  const second = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 4,
    detection: "identified"
  });

  await sensorUpdate({
    user: game.user,
    payload: {
      combatId: combat.id,
      op: "objectVisual",
      key: first.key,
      visual: { transform: { rotation: 37, flipX: true }, art: "first.webp", autoMirrorOverride: true }
    }
  });
  await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "flip", key: first.key } });
  const firstActor = await loadStarship(first.key);
  await patchStarship(firstActor, (data) => {
    data.hp.value = 5;
    data.sp.value = 2;
  });

  const [firstObject, secondObject] = getTsc(combat).objects;
  assert.equal(firstObject.mapTransform.rotation, 37);
  assert.equal(firstObject.mapTransform.flipX, true);
  assert.equal(firstObject.art, "first.webp");
  assert.equal(firstObject.autoMirrorOverride, true);
  assert.equal(firstObject.heading, "left");
  assert.equal(secondObject.heading, "right");
  assert.notEqual(secondObject.mapTransform.rotation, 37);
  assert.equal(secondObject.art, undefined);
  assert.equal(readStarship(await loadStarship(second.key)).hp.value, 24);
  assert.equal(readStarship(await loadStarship(second.key)).sp.value, 12);
  assert.equal(readStarship(await loadStarship(first.key)).hp.value, 5);
  assert.equal(readStarship(await loadStarship(first.key)).sp.value, 2);
  assert.deepEqual(source.toObject(), before);
});

test("dragging a selected map-only record moves only that record", async () => {
  const combat = setup();
  const source = ship("drag-source", { owners: ["p1"] });
  const first = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "identified" });
  const second = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 4, detection: "identified" });
  const { wireSensorMapDragDrop } = await import("../../scripts/ui/sensor-drop-ui.mjs");
  const handlers = {};
  const zone = {
    dataset: { zone: "7" },
    classList: { add() {}, remove() {} },
    addEventListener: (name, handler) => (handlers[name] = handler)
  };
  const element = { querySelectorAll: (selector) => (selector.startsWith(".tsc-zone") ? [zone] : []) };
  wireSensorMapDragDrop(
    element,
    { combatId: combat.id, movableKeys: [first.key, second.key] },
    {
      send: (_type, payload) => sensorUpdate({ user: game.user, payload })
    }
  );

  await handlers.drop({
    preventDefault() {},
    dataTransfer: { getData: () => JSON.stringify({ tscKey: second.key }) }
  });

  assert.deepEqual(
    getTsc(combat).objects.map((object) => [object.key, object.zone]),
    [
      [first.key, 2],
      [second.key, 7]
    ]
  );
  assert.equal(game.actors.size, 1);
});

test("pending reveal pins snapshot name and portrait against direct sheet writes", async () => {
  const combat = setup();
  const source = ship("pending-reveal-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 3, detection: "hidden" });
  const update = combat.update.bind(combat);
  let fail = true;
  combat.update = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error("injected reveal publication failure");
    }
    return update(...args);
  };
  await assert.rejects(changePrivateContact(combat, placement.key, "reveal"), /injected reveal publication failure/);
  combat.update = update;
  assert.equal(pendingPrivateReveals(combat.id).length, 1);
  const actor = await loadStarship(placement.key);
  const before = mapObjectSources(combat.id)[placement.key].data;

  await assert.rejects(actor.update({ name: "Changed while pending" }), /unfinished identification|recoveryRequired/i);
  await assert.rejects(actor.update({ img: "changed.webp" }), /unfinished identification|recoveryRequired/i);

  const after = mapObjectSources(combat.id)[placement.key].data;
  assert.equal(after.name, before.name);
  assert.equal(after.img, before.img);
});

test("private map-only initiative and reveal preserve the map identity without an Actor", async () => {
  const combat = setup();
  const source = ship("reveal-source");
  const before = source.toObject();
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "undetected"
  });

  assert.equal((await addSensorObjectToInitiative(combat.id, placement.key)).status, "added");
  const [combatant] = combat.combatants.contents;
  assert.equal(combatant.actorId, null);
  assert.equal(combatant.flags[MODULE_ID].sensorMapObject.key, placement.key);
  assert.equal(combatant.hidden, true);

  await changePrivateContact(combat, placement.key, "reveal");

  const [object] = getTsc(combat).objects;
  assert.equal(object.key, placement.key);
  assert.equal(object.actorUuid, placement.key);
  assert.equal(object.mapOnly, true);
  assert.equal(object.detection.party, "identified");
  assert.equal(privateContacts(combat.id).length, 0);
  assert.equal(combat.combatants.size, 1);
  assert.equal(combat.combatants.contents[0].id, combatant.id);
  assert.equal(combatant.hidden, false);
  assert.equal(game.actors.size, 1);
  assert.deepEqual(source.toObject(), before);
  assert.equal(JSON.stringify(getTsc(combat)).includes(source.uuid), false);
});

test("a non-first document from the real starship LevelDB pack drops through the UI as an independent map object", async () => {
  const combat = setup();
  const { extractPack } = await import("@foundryvtt/foundryvtt-cli");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tsc-map-only-046-"));
  try {
    const out = path.join(temp, "starships");
    await extractPack(path.join(root, "packs/starships"), out, { log: false });
    const actors = fs
      .readdirSync(out, { recursive: true })
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(fs.readFileSync(path.join(out, file), "utf8")))
      .filter((doc) => doc._key?.startsWith("!actors!") && doc.flags?.[MODULE_ID]?.starship?.isStarship);
    assert.ok(actors.length > 1, "the real pack must contain multiple starship Actors");
    const data = actors[1];
    const uuid = `Compendium.${MODULE_ID}.starships.Actor.${data._id}`;
    const source = {
      ...structuredClone(data),
      documentName: "Actor",
      uuid,
      pack: `${MODULE_ID}.starships`,
      isToken: false,
      toObject: () => structuredClone(data),
      testUserPermission: (user, level) => {
        if (user?.isGM) return true;
        const granted = data.ownership?.[user?.id] ?? data.ownership?.default ?? 0;
        return granted >= ({ LIMITED: 1, OBSERVER: 2, OWNER: 3 }[level] ?? 0);
      }
    };
    globalThis.__extraUuids.set(uuid, source);
    const original = JSON.stringify(data);
    const handler = await dropHandler(combat, source, {
      confirm: async () => {
        throw new Error("a private compendium NPC must not request public disclosure");
      }
    });

    await handler.drop();
    handler.zone.dataset.zone = "6";
    await handler.drop();

    assert.deepEqual(handler.warnings, []);
    const contacts = privateContacts(combat.id);
    assert.equal(contacts.length, 2);
    assert.equal(new Set(contacts.map((contact) => contact.key)).size, 2);
    assert.equal(
      contacts.every((contact) => contact.mapOnly && contact.actorUuid === contact.key),
      true
    );
    assert.equal(game.actors.size, 0);
    assert.equal(globalThis.__writes.filter((write) => write.doc.startsWith("Actor.") && write.create).length, 0);
    assert.equal(JSON.stringify(data), original);
    assert.equal(JSON.stringify(getTsc(combat)).includes(uuid), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("legacy Actor-backed map records keep resolving while new placements remain map-only", async () => {
  installFoundryMock();
  const source = ship("legacy-source", { owners: ["p1"] });
  const combat = makeStarshipCombat({
    objects: [{ key: source.uuid, actorUuid: source.uuid, type: "starship", name: source.name, zone: 2 }]
  });
  const before = source.toObject();

  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 5,
    detection: "identified"
  });

  assert.equal(await loadStarship(source.uuid), source);
  const objects = getTsc(combat).objects;
  assert.equal(objects.length, 2);
  assert.equal(objects[0].actorUuid, source.uuid);
  assert.equal(objects[0].mapOnly, undefined);
  assert.equal(objects[1].key, placement.key);
  assert.equal(objects[1].mapOnly, true);
  assert.deepEqual(source.toObject(), before);
});

test("missing and non-GM sources are rejected, while a placed snapshot survives source deletion", async () => {
  const combat = setup();
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: "Actor.missing", zone: 2, detection: "hidden" }));
  assert.equal(game.journal.size, 0);
  const source = ship("deleted-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const journalBefore = structuredClone(game.journal.contents[0].flags);
  game.user = game.users.get("p1");
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 4, detection: "hidden" }));
  assert.deepEqual(game.journal.contents[0].flags, journalBefore);
  game.user = game.users.get("gm");

  await source.delete();
  const snapshot = await loadStarship(placement.key);
  assert.equal(snapshot.mapOnly, true);
  await patchStarship(snapshot, (data) => {
    data.hp.value = 7;
  });
  assert.equal(readStarship(await loadStarship(placement.key)).hp.value, 7);
  assert.equal(game.actors.size, 0);
});

test("an unsafe private store blocks map snapshots but not unrelated world Actors", async () => {
  const combat = setup();
  const source = ship("store-boundary-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  game.journal.contents[0].ownership.p1 = 1;

  assert.equal(await loadStarship(source.uuid), source);
  await assert.rejects(loadStarship(placement.key), /invalid|unsafe|permissions/i);
  assert.equal(game.actors.get(source.id), source);
});

test("a stale map snapshot cannot recreate its deleted private source", async () => {
  const combat = setup();
  const source = ship("stale-snapshot-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const stale = await loadStarship(placement.key);
  await changePrivateContact(combat, placement.key, "remove");

  await assert.rejects(stale.update({ "system.attributes.hp.value": 1 }), /invalid|store|missing/i);
  assert.equal(mapObjectSources(combat.id)[placement.key], undefined);
  await assert.rejects(loadStarship(placement.key));
  assert.equal(game.actors.get(source.id), source);
});

test("Foundry GM ownership normalization permits public snapshot persistence without losing player ownership", async () => {
  const combat = setup();
  const source = ship("gm-owner-public-source", { owners: ["p1"] });
  await ensurePrivateStore(combat.id);
  installFoundryJournalUpdateMock(game.journal.contents[0], { injectGMOwner: true });
  const gmId = game.users.activeGM.id;

  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified"
  });

  const stored = mapObjectSources(combat.id)[placement.key];
  assert.equal(stored.data.ownership.default, 0);
  assert.equal(stored.data.ownership.p1, 3);
  assert.equal(stored.data.ownership[gmId], 3);
  assert.equal(game.actors.size, 1);
  assert.equal(getTsc(combat).objects[0].mapOnly, true);
  const actor = await loadStarship(placement.key);
  await actor.update({ "system.attributes.hp.value": 7 });
  const updated = mapObjectSources(combat.id)[placement.key];
  assert.equal(updated.data.system.attributes.hp.value, 7);
  assert.equal(updated.data.ownership.p1, 3);
  assert.equal(updated.data.ownership[gmId], 3);
});

test("Foundry GM ownership normalization permits private hazard snapshot persistence without player access", async () => {
  const combat = setup();
  const source = hazard("gm-owner-private-hazard", { ownership: { default: 0 } });
  await ensurePrivateStore(combat.id);
  installFoundryJournalUpdateMock(game.journal.contents[0], { injectGMOwner: true });
  const gmId = game.users.activeGM.id;

  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "hidden"
  });

  const stored = mapObjectSources(combat.id)[placement.key];
  assert.equal(stored.data.ownership.default, 0);
  assert.equal(stored.data.ownership[gmId], 3);
  assert.equal(stored.data.ownership.p1, undefined);
  assert.equal(privateContacts(combat.id)[0].mapOnly, true);
  assert.equal(game.actors.size, 1);
  const [projection] = getTsc(combat).objects;
  assert.equal(projection.tscPrivateProjection, true);
  assert.equal(JSON.stringify(projection).includes(source.uuid), false);
  assert.equal(JSON.stringify(projection).includes(source.name), false);
});

test("JSON persistence drops undefined embedded Item fields without failing exact snapshot readback", async () => {
  const combat = setup();
  const source = hazard("undefined-item-hazard");
  source.items.set("toggle-item", {
    _id: "toggle-item",
    name: "Toggle item",
    type: "item",
    system: {
      toggles: undefined,
      deathNote: undefined,
      frequency: undefined,
      selfEffect: undefined,
      enabled: true,
      nested: { value: 1, absent: undefined }
    }
  });
  await ensurePrivateStore(combat.id);
  installFoundryJournalUpdateMock(game.journal.contents[0], { injectGMOwner: true, dropUndefined: true });

  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "hidden"
  });

  const stored = mapObjectSources(combat.id)[placement.key];
  const item = stored.data.items.find((entry) => entry._id === "toggle-item");
  assert.equal(Object.hasOwn(item.system, "toggles"), false);
  assert.equal(Object.hasOwn(item.system, "deathNote"), false);
  assert.equal(Object.hasOwn(item.system, "frequency"), false);
  assert.equal(Object.hasOwn(item.system, "selfEffect"), false);
  assert.equal(item.system.enabled, true);
  assert.deepEqual(item.system.nested, { value: 1 });
  assert.equal(Object.keys(mapObjectSources(combat.id)).length, 1);
  assert.equal(game.actors.size, 1);
});

test("Foundry merge semantics delete exactly one mapObjects key and preserve the other snapshots", async () => {
  const combat = setup();
  const source = ship("merge-delete-source");
  const first = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const second = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 4, detection: "hidden" });
  const journal = game.journal.contents[0];
  installFoundryJournalUpdateMock(journal, { injectGMOwner: true });

  await deleteMapObjectSource(combat.id, first.key);

  const sources = mapObjectSources(combat.id);
  assert.equal(sources[first.key], undefined);
  assert.equal(sources[second.key].key, second.key);
  assert.deepEqual(Object.keys(journal.flags[MODULE_ID].privateSensor.mapObjects), [second.key]);
});

test("Foundry merge semantics replace one snapshot record exactly without retaining removed nested fields", async () => {
  const combat = setup();
  const source = ship("merge-replace-source");
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const actor = await loadStarship(placement.key);
  await actor.update({ "system.attributes.obsolete": { nested: true } });
  installFoundryJournalUpdateMock(game.journal.contents[0], { injectGMOwner: true });
  const replacement = { attributes: { hp: { value: 9, max: 9 } } };

  await actor.update({ system: new FoundryForcedReplacement(replacement) });

  const stored = mapObjectSources(combat.id)[placement.key].data.system;
  assert.deepEqual(stored, replacement);
  assert.equal(Object.hasOwn(stored, "value"), false);
  assert.equal(Object.hasOwn(stored.attributes, "obsolete"), false);
});

test("MapObjectActor honors dotted ForcedDeletion and ForcedReplacement without storing operator objects", async () => {
  const combat = setup();
  const source = ship("operator-source");
  source.flags[MODULE_ID].starship.resistances = { fire: 5, cold: 7 };
  source.flags[MODULE_ID].starship.skills = { old: { base: 2 }, computers: { base: 3 } };
  const placement = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "hidden" });
  const actor = await loadStarship(placement.key);
  installFoundryJournalUpdateMock(game.journal.contents[0]);
  const prefix = `flags.${MODULE_ID}.starship`;

  await actor.update({ [`${prefix}.resistances.fire`]: new FoundryForcedDeletion() });
  await actor.update({ [`${prefix}.skills`]: new FoundryForcedReplacement({ computers: { base: 4 } }) });

  const stored = mapObjectSources(combat.id)[placement.key].data.flags[MODULE_ID].starship;
  assert.deepEqual(stored.resistances, { cold: 7 });
  assert.deepEqual(stored.skills, { computers: { base: 4 } });
  assert.equal(Object.hasOwn(stored.resistances, "value"), false);
  assert.equal(Object.hasOwn(stored.skills, "value"), false);
});

test("failed map-only removal retains a retryable map record, snapshot and Combatant", async () => {
  const combat = setup();
  const source = ship("retry-remove-source");
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 2,
    detection: "identified",
    publicActor: true
  });
  const before = structuredClone(getTsc(combat));
  const update = combat.update.bind(combat);
  combat.update = async () => {
    throw new Error("injected map removal failure");
  };

  await assert.rejects(
    sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: placement.key } }),
    /injected map removal failure/
  );

  assert.deepEqual(getTsc(combat), before);
  assert.equal((await loadStarship(placement.key)).mapOnly, true);
  assert.equal(
    combat.combatants.contents.some((entry) => entry.flags[MODULE_ID].sensorMapObject?.key === placement.key),
    true
  );
  combat.update = update;
  await sensorUpdate({ user: game.user, payload: { combatId: combat.id, op: "remove", key: placement.key } });
  assert.deepEqual(getTsc(combat).objects, []);
  assert.equal(combat.combatants.size, 0);
  await assert.rejects(loadStarship(placement.key));
  assert.equal(game.actors.get(source.id), source);
});

test("map-only starship targets participate in action validation and damage without mutating the source", async () => {
  const combat = setup();
  await loadContentFromDisk();
  const crew = makeCharacter({ id: "map-gunner", owners: ["p1"] });
  const attacker = makeShip({
    id: "map-attacker",
    role: "player",
    owners: ["p1"],
    stations: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: crew.uuid, weaponId: "w" }],
    weapons: [{ id: "w", weaponRef: "coilgun", name: "Coilgun" }],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "g" }]
  });
  const attackerPlacement = await addSensorContact(combat, {
    source: "world",
    uuid: attacker.uuid,
    zone: 2,
    detection: "identified"
  });
  const source = ship("map-target", { owners: ["p1"] });
  const sourceBefore = source.toObject();
  const target = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "identified"
  });
  const request = {
    shipUuid: attacker.uuid,
    crewUuid: crew.uuid,
    actionId: "strike",
    stationId: "g",
    user: game.users.get("p1"),
    options: { targetKey: target.key, weaponId: "w", skipDialog: true }
  };

  const dry = await executeAction({ ...request, dryRun: true, validateTarget: true });
  assert.equal(dry.ctx.ship.uuid, attackerPlacement.key);
  assert.equal(dry.ctx.target.key, target.key);
  assert.equal(dry.ctx.target.actor.mapOnly, true);
  const { declareAttack } = await import("../../scripts/chat/attack-card/service.mjs");
  const { messageId } = await declareAttack({
    user: request.user,
    payload: {
      shipUuid: request.shipUuid,
      crewUuid: request.crewUuid,
      actionId: request.actionId,
      stationId: request.stationId,
      options: { ...request.options, sheetRoll: true }
    }
  });
  assert.equal(game.messages.get(messageId).flags[MODULE_ID].attackCard.request.shipUuid, attackerPlacement.key);
  const before = readStarship(await loadStarship(target.key)).sp.value;
  dice(20, 6);
  const result = await executeAction(request);
  assert.equal(result.ok, true);
  assert.ok(readStarship(await loadStarship(target.key)).sp.value < before);
  assert.deepEqual(source.toObject(), sourceBefore);
});

test("private map-only NPC action cards stay in the GM whisper", async () => {
  const combat = setup();
  await loadContentFromDisk();
  const source = makeShip({
    id: "private-npc-card",
    name: "Private NPC",
    role: "npc",
    extra: { npcActions: [{ name: "Secret Orders", cost: "one-action", text: "Whisper only." }] }
  });
  game.actors.set(source.id, source);
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "hidden"
  });
  const before = game.messages.contents.length;
  assert.equal(privateContacts(combat.id).length, 1);
  assert.equal(getTsc(combat).objects[0].tscPrivateProjection, true);
  const dry = await executeAction({
    shipUuid: placement.key,
    actionId: "inline:secret-orders",
    user: game.users.get("gm"),
    options: { skipDialog: true },
    dryRun: true
  });
  assert.equal(dry.ctx.privateAction, true);

  const result = await executeAction({
    shipUuid: placement.key,
    actionId: "inline:secret-orders",
    user: game.users.get("gm"),
    options: { skipDialog: true }
  });

  assert.equal(result.ok, true);
  const message = game.messages.contents.at(-1);
  assert.ok(game.messages.contents.length > before);
  assert.deepEqual(message.whisper, [game.users.activeGM.id]);
  assert.equal(message.flags[MODULE_ID].cardData.initiator, source.name);
});

test("map-only complex hazards use their own snapshot state and zone during automation", async () => {
  const combat = setup();
  const source = hazard("map-hazard", {
    flags: {
      [MODULE_ID]: {
        starshipHazard: {
          isStarshipHazard: true,
          isComplex: true,
          effectText: "1d6 fire damage",
          routine: { cost: "1 action", text: "1d6 fire damage" }
        }
      }
    }
  });
  const target = ship("hazard-target", { role: "player", owners: ["p1"] });
  combat.flags[MODULE_ID].tsc.objects.push({
    key: target.uuid,
    actorUuid: target.uuid,
    type: "starship",
    name: target.name,
    zone: 3,
    heading: "right",
    detection: { party: "identified" }
  });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "identified",
    publicActor: true
  });
  const before = target.flags[MODULE_ID].starship.sp.value;
  dice(6, 1);

  const result = await HazardEngine.trigger(placement.key);

  assert.equal(result.applied, true);
  assert.equal(result.targets, 1);
  assert.ok(target.flags[MODULE_ID].starship.sp.value < before);
  assert.equal(source.system.attributes.hp.value, 20);
  assert.equal(game.actors.size, 2);
});

test("map-only hazard placement preserves span, level, stealth, icon and hazard placement metadata", async () => {
  const combat = setup();
  const source = hazard("placed-hazard", {
    system: { details: { level: { value: 4 }, isComplex: false } },
    flags: { [MODULE_ID]: { starshipHazard: { stealthDC: 13 } } }
  });
  const before = source.toObject();

  await placeHazard(source, { zone: 3, span: 2, map: "both", detection: "identified", publicActor: true });

  const [object] = getTsc(combat).objects;
  assert.equal(object.mapOnly, true);
  assert.equal(object.span, 2);
  assert.equal(object.level, 4);
  assert.equal(object.stealthDC, 13);
  assert.equal(object.icon, "⚠");
  assert.deepEqual(getTsc(combat).hazardState[object.key], { disabled: false, placement: "both" });
  assert.deepEqual(source.toObject(), before);
  assert.equal(game.actors.size, 1);
});
