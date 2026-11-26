import { MODULE_ID } from "../constants.mjs";
import { getTsc, mutateTsc, saveTsc } from "../combat/tsc-state.mjs";
import { activeGM, fromUuidSafe, fromUuidSync_, isActiveGM, T } from "../utils/foundry.mjs";
import { serialize } from "../utils/serial.mjs";
import { ensurePrivateStore, privateStoreFor, requirePrivateGM } from "./private-store.mjs";

const MAP_OBJECT_SOURCE = "mapObjects";
const clone = (value) => structuredClone(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const isForcedDeletion = (value) => {
  const Operator = globalThis.foundry?.data?.operators?.ForcedDeletion;
  return !!Operator && value instanceof Operator;
};
const isForcedReplacement = (value) => {
  const Operator = globalThis.foundry?.data?.operators?.ForcedReplacement;
  return !!Operator && value instanceof Operator;
};
const replacementValue = (value) => globalThis.foundry.data.operators.ForcedReplacement.get(value);

function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => same(value === undefined ? null : value, b[index] === undefined ? null : b[index]));
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aKeys = Object.keys(a).filter((key) => a[key] !== undefined);
  const bKeys = Object.keys(b).filter((key) => b[key] !== undefined);
  return aKeys.length === bKeys.length && aKeys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
}

function validRecord(record, combatId, key) {
  return (
    record?.schema === 1 &&
    record.combatId === combatId &&
    typeof key === "string" &&
    key.length > 0 &&
    !key.includes(".") &&
    record.key === key &&
    typeof record.sourceUuid === "string" &&
    record.sourceUuid.length > 0 &&
    !!record.data &&
    typeof record.data === "object" &&
    typeof record.data.name === "string" &&
    typeof record.data.type === "string"
  );
}

function publicEmbeddedData(entry) {
  if (Number(entry?.ownership?.default) <= 0) return null;
  const value = clone(entry);
  delete value._stats;
  if (value.system?.details) {
    delete value.system.details.privateNotes;
    delete value.system.details.gmNotes;
  }
  value.flags = value.flags?.[MODULE_ID] ? { [MODULE_ID]: clone(value.flags[MODULE_ID]) } : {};
  return value;
}

export function publicMapActorData(data) {
  const role = data?.flags?.[MODULE_ID]?.starship?.role;
  const ownership = data?.ownership ?? {};
  const visible =
    Number(ownership.default) > 0 ||
    Object.entries(ownership).some(([id, level]) => id !== "default" && Number(level) > 0 && !game.users?.get(id)?.isGM);
  if (!["player", "ally"].includes(role) || !visible) return null;
  const system = clone(data.system ?? {});
  if (system.details) {
    delete system.details.privateNotes;
    delete system.details.gmNotes;
  }
  const starship = clone(data.flags?.[MODULE_ID]?.starship ?? {});
  delete starship.gmNotes;
  const prototypeToken = data.prototypeToken ? clone(data.prototypeToken) : null;
  if (prototypeToken) delete prototypeToken.flags;
  const projection = {
    _id: data._id,
    name: data.name,
    type: data.type,
    img: data.img,
    ownership: clone(ownership),
    system,
    prototypeToken,
    flags: { [MODULE_ID]: { starship } },
    items: (data.items ?? []).map(publicEmbeddedData).filter(Boolean),
    effects: (data.effects ?? []).map(publicEmbeddedData).filter(Boolean),
    folder: data.folder ?? null,
    sort: data.sort ?? null
  };
  return projection;
}

function publicMapObjectRecord(combatId, key) {
  if (typeof combatId !== "string" || typeof key !== "string") return null;
  const combat = game.combats?.get(combatId) ?? globalThis.game?.combat;
  if (!combat) return null;
  const object = getTsc(combat).objects.find((entry) => entry.key === key && !entry.tscPrivateProjection);
  const data = publicMapActorData(object?.publicActor);
  if (!data || data.flags?.[MODULE_ID]?.starship?.isStarship !== true) return null;
  return { schema: 1, combatId, key, sourceUuid: `public:${key}`, data };
}

export async function sanitizePublicMapActors(combat) {
  requirePrivateGM();
  return serialize(`sensor:${combat.id}`, async () => {
    requirePrivateGM();
    const current = getTsc(combat);
    let changed = false;
    const objects = current.objects.map((object) => {
      if (!object.publicActor) return object;
      const data = publicMapActorData(object.publicActor);
      if (!data) {
        changed = true;
        const { publicActor: _unsafe, ...rest } = object;
        return rest;
      }
      if (same(data, object.publicActor)) return object;
      changed = true;
      return { ...object, publicActor: data };
    });
    if (changed) await saveTsc(combat, { ...current, objects }, { expected: current });
  });
}

async function syncPublicMapActor(record) {
  const combat = game.combats?.get(record.combatId);
  if (!combat) return;
  const current = getTsc(combat).objects.find((object) => object.key === record.key && !object.tscPrivateProjection);
  if (!current) return;
  const publicActor = publicMapActorData(record.data);
  await mutateTsc(combat, (state) => ({
    ...state,
    objects: state.objects.map((object) => {
      if (object.key !== record.key) return object;
      const { publicActor: _previous, ...rest } = object;
      return publicActor ? { ...rest, publicActor } : rest;
    })
  }));
}

function withActiveGMOwner(record) {
  const gm = activeGM();
  if (!gm?.id) return record;
  const data = clone(record.data);
  const ownership = clone(data.ownership ?? { default: 0 });
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  ownership[gm.id] = Math.max(Number(ownership[gm.id]) || 0, ownerLevel);
  data.ownership = ownership;
  return { ...record, data };
}

function validatedMapObjectSources(combatId) {
  if (!game.user?.isGM || !Array.isArray(game.journal?.contents)) return {};
  const sources = privateStoreFor(combatId)?.flags?.[MODULE_ID]?.privateSensor?.[MAP_OBJECT_SOURCE] ?? {};
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  for (const [key, record] of Object.entries(sources))
    if (!validRecord(record, combatId, key)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  return sources;
}

export function mapObjectSources(combatId) {
  return clone(validatedMapObjectSources(combatId));
}

export function mapObjectSource(combatId, key) {
  const record = validatedMapObjectSources(combatId)[key];
  return record ? clone(record) : null;
}

async function writeMapObjectSource(combatId, key, record, { create = false } = {}) {
  return serialize(`sensor-source:${combatId}`, async () => {
    requirePrivateGM();
    if (!validRecord(record, combatId, key)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    record = withActiveGMOwner(record);
    const doc = await ensurePrivateStore(combatId);
    const current = mapObjectSource(combatId, key);
    if (create && current) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    if (!create && !current) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    requirePrivateGM();
    if (privateStoreFor(combatId)?.id !== doc.id) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    await doc.update({
      [`flags.${MODULE_ID}.privateSensor.${MAP_OBJECT_SOURCE}.${key}`]: new foundry.data.operators.ForcedReplacement(record)
    });
    requirePrivateGM();
    if (!same(mapObjectSource(combatId, key), record)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    return record;
  });
}

async function updateMapObjectSource(combatId, key, changes, { expectedSource = null } = {}) {
  return serialize(`sensor-source:${combatId}`, async () => {
    requirePrivateGM();
    const current = mapObjectSource(combatId, key);
    if (!current) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    if (expectedSource && !same(current.data, expectedSource)) throw new Error(game.i18n.localize("SF2eTSC.qol.undoConflict"));
    const data = clone(current.data);
    applyUpdate(data, changes);
    const record = withActiveGMOwner({ ...current, data });
    const doc = privateStoreFor(combatId);
    if (!doc) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    requirePrivateGM();
    if (privateStoreFor(combatId)?.id !== doc.id) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    await doc.update({
      [`flags.${MODULE_ID}.privateSensor.${MAP_OBJECT_SOURCE}.${key}`]: new foundry.data.operators.ForcedReplacement(record)
    });
    requirePrivateGM();
    if (!same(mapObjectSource(combatId, key), record)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    return record;
  });
}

export async function markMapObjectCleanup(combatId, key, { deleteActor = true } = {}) {
  return serialize(`sensor-source:${combatId}`, async () => {
    requirePrivateGM();
    const current = mapObjectSource(combatId, key);
    if (!current) return false;
    const record = withActiveGMOwner({ ...current, pendingCleanup: { deleteActor: deleteActor !== false } });
    const doc = privateStoreFor(combatId);
    if (!doc) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    await doc.update({
      [`flags.${MODULE_ID}.privateSensor.${MAP_OBJECT_SOURCE}.${key}`]: new foundry.data.operators.ForcedReplacement(record)
    });
    requirePrivateGM();
    if (!same(mapObjectSource(combatId, key), record)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    return true;
  });
}

export function pendingMapObjectCleanups(combat) {
  if (!game.user?.isGM || !combat) return [];
  let sources;
  try {
    sources = validatedMapObjectSources(combat.id);
  } catch {
    return [];
  }
  return Object.values(sources)
    .filter((record) => record.pendingCleanup && !referencedMapObject(combat, record.key))
    .map((record) => ({ key: record.key, deleteActor: record.pendingCleanup.deleteActor !== false }));
}

export async function deleteMapObjectSource(combatId, key) {
  return serialize(`sensor-source:${combatId}`, async () => {
    requirePrivateGM();
    const doc = privateStoreFor(combatId);
    if (!doc) return false;
    if (!mapObjectSource(combatId, key)) return false;
    await doc.update({
      [`flags.${MODULE_ID}.privateSensor.${MAP_OBJECT_SOURCE}.${key}`]: new foundry.data.operators.ForcedDeletion()
    });
    requirePrivateGM();
    if (mapObjectSource(combatId, key)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    const registryKey = snapshotSheetKey(combatId, key);
    const entry = snapshotSheetRegistry.get(registryKey);
    if (entry) {
      await closeSnapshotSheet(entry);
      snapshotSheetRegistry.delete(registryKey);
    }
    return true;
  });
}

class SnapshotItems extends Map {
  get contents() {
    return [...this.values()];
  }
}

class SnapshotItem {
  #actor;
  #source;

  constructor(actor, source) {
    this.#actor = actor;
    this.#source = clone(source);
    this.id = this.#source._id;
    this.documentName = "Item";
    this.isEmbedded = true;
    this.pack = null;
  }

  get _id() {
    return this.id;
  }

  get _source() {
    return this.#source;
  }

  get _stats() {
    return this.#source._stats ?? {};
  }

  get type() {
    return this.#source.type;
  }

  get name() {
    return this.#source.name;
  }

  get img() {
    return this.#source.img;
  }

  get system() {
    return (this.#source.system ??= {});
  }

  get flags() {
    return (this.#source.flags ??= {});
  }

  get slug() {
    return this.system.slug ?? this.#source.slug;
  }

  get active() {
    return this.#source.active !== false;
  }

  set active(value) {
    this.#source.active = value !== false;
  }

  get isLocked() {
    return this.#source.isLocked === true || this.system.references?.parent != null;
  }

  get parent() {
    return this.#actor;
  }

  get actor() {
    return this.#actor;
  }

  get uuid() {
    return `${this.#actor.uuid}.Item.${this.id}`;
  }

  isOfType(...types) {
    return types.includes(this.type);
  }

  toObject() {
    return clone(this.#source);
  }

  clone(changes = {}) {
    return new SnapshotItem(this.#actor, { ...this.toObject(), ...clone(changes) });
  }

  async update(changes) {
    const [updated] = await this.#actor.updateEmbeddedDocuments("Item", [{ _id: this.id, ...changes }]);
    return updated ?? null;
  }

  async delete() {
    const [deleted] = await this.#actor.deleteEmbeddedDocuments("Item", [this.id]);
    return deleted ?? null;
  }
}

const snapshotSheetRegistry = new Map();
let snapshotRegistryHooks = null;

function snapshotSheetKey(combatId, key) {
  return `${combatId}:${key}`;
}

function syncSnapshotDocument(entry) {
  const data = entry.actor.toObject();
  data._id = entry.document.id;
  entry.document.updateSource(data, { recursive: false, clean: false });
}

async function refreshSnapshotSheet(entry) {
  syncSnapshotDocument(entry);
  if (entry.sheet.rendered) await entry.sheet.render(true);
}

async function closeSnapshotSheet(entry) {
  if (entry.sheet.rendered) await entry.sheet.close();
}

export function registerSnapshotSheetRegistry() {
  if (snapshotRegistryHooks === Hooks) return;
  snapshotRegistryHooks = Hooks;
  const refresh = async (combatId) => {
    for (const entry of snapshotSheetRegistry.values()) {
      if (entry.actor.combatId !== combatId || entry.pending) continue;
      const record = game.user.isGM ? mapObjectSource(combatId, entry.actor.id) : publicMapObjectRecord(combatId, entry.actor.id);
      if (record) {
        entry.actor = new MapObjectActor(record);
        await refreshSnapshotSheet(entry);
      }
    }
  };
  Hooks.on("updateJournalEntry", (doc) => {
    const combatId = doc.flags?.[MODULE_ID]?.privateSensor?.combatId;
    if (combatId) return refresh(combatId);
  });
  Hooks.on("updateCombat", (combat) => refresh(combat.id));
  Hooks.on("deleteCombat", async (combat) => {
    for (const [key, entry] of snapshotSheetRegistry) {
      if (entry.actor.combatId !== combat.id) continue;
      await closeSnapshotSheet(entry);
      snapshotSheetRegistry.delete(key);
    }
  });
}

function applyUpdate(target, changes) {
  for (const [key, value] of Object.entries(changes)) {
    const parts = key.split(".");
    let current = target;
    for (const part of parts.slice(0, -1)) current = current[part] ??= {};
    const leaf = parts.at(-1);
    if (isForcedDeletion(value)) delete current[leaf];
    else if (isForcedReplacement(value)) current[leaf] = clone(replacementValue(value));
    else if (isPlainObject(current[leaf]) && isPlainObject(value)) applyUpdate(current[leaf], value);
    else current[leaf] = clone(value);
  }
}

export class MapObjectActor {
  #sheet = null;
  #persist = true;

  constructor(record, { persist = true } = {}) {
    this._record = clone(record);
    this._data = clone(record.data);
    this.#persist = persist !== false;
    this.id = record.key;
    this.uuid = record.key;
    this.documentName = "Actor";
    this.mapOnly = true;
    this.isMapObject = true;
    this.pack = null;
    this.isToken = false;
    this.synthetics = { modifiers: {}, modifierAdjustments: {}, rollTwice: {}, rollSubstitutions: {}, degreeOfSuccessAdjustments: {} };
    this.#syncItems();
  }

  get combatId() {
    return this._record.combatId;
  }

  get sourceUuid() {
    return this._record.sourceUuid;
  }

  get name() {
    return this._data.name;
  }

  get type() {
    return this._data.type;
  }

  get img() {
    return this._data.img;
  }

  get flags() {
    return this._data.flags ?? {};
  }

  get system() {
    return this._data.system ?? {};
  }

  get ownership() {
    return this._data.ownership ?? { default: 0 };
  }

  get folder() {
    return this._data.folder ?? null;
  }

  get prototypeToken() {
    return this._data.prototypeToken ?? null;
  }

  get sheet() {
    if (this.#sheet) return this.#sheet;
    const registryKey = snapshotSheetKey(this.combatId, this.id);
    const existing = snapshotSheetRegistry.get(registryKey);
    if (existing) {
      existing.actor = this;
      syncSnapshotDocument(existing);
      this.#sheet = existing.sheet;
      return this.#sheet;
    }
    const ActorClass = globalThis.CONFIG?.Actor?.documentClass;
    if (!ActorClass) return null;
    const data = clone(this._data);
    data._id = this.id;
    const document = new ActorClass(data, { strict: false });
    const sheet = document.sheet;
    if (!sheet) return null;
    const entry = { actor: this, document, sheet, pending: false };
    snapshotSheetRegistry.set(registryKey, entry);
    document.update = async (changes, options = {}) => {
      await entry.actor.update(changes, options);
      return document;
    };
    document.setFlag = (scope, key, value) => entry.actor.setFlag(scope, key, value);
    document.createEmbeddedDocuments = (type, sources, options) => entry.actor.createEmbeddedDocuments(type, sources, options);
    document.updateEmbeddedDocuments = (type, updates, options) => entry.actor.updateEmbeddedDocuments(type, updates, options);
    document.deleteEmbeddedDocuments = (type, ids, options) => entry.actor.deleteEmbeddedDocuments(type, ids, options);
    document.increaseCondition = (condition, options) => entry.actor.increaseCondition(condition, options);
    document.decreaseCondition = (condition, options) => entry.actor.decreaseCondition(condition, options);
    document.toggleCondition = (condition, options) => entry.actor.toggleCondition(condition, options);
    Object.defineProperty(sheet, "isEditable", { configurable: true, get: () => isActiveGM() && entry.actor.isOwner });
    sheet._processSubmitData = async (_event, _form, submitData, options = {}) => {
      if (!sheet.isEditable) return {};
      requirePrivateGM();
      await entry.actor.update(submitData, options);
      return { updated: document };
    };
    this.#sheet = sheet;
    return sheet;
  }

  get _source() {
    return this._data;
  }

  get hasPlayerOwner() {
    return Object.entries(this.ownership).some(([id, level]) => id !== "default" && Number(level) > 0);
  }

  get isOwner() {
    return this.testUserPermission(game.user, "OWNER");
  }

  #syncItems() {
    this.items = new SnapshotItems();
    for (const item of this._data.items ?? []) {
      const id = item._id ?? item.id;
      if (id) this.items.set(id, new SnapshotItem(this, { ...clone(item), _id: id }));
    }
  }

  #requireWritable() {
    requirePrivateGM();
    if (!this.#persist) throw new Error(T("SF2eTSC.effects.errors.nativeUnavailable"));
  }

  get canHostRuleElements() {
    return true;
  }

  isOfType(...types) {
    return types.includes(this.type);
  }

  get itemTypes() {
    const types = {};
    for (const item of this.items.values()) (types[item.type] ??= []).push(item);
    return types;
  }

  testUserPermission(user, level) {
    if (user?.isGM) return true;
    const granted = this.ownership?.[user?.id] ?? this.ownership?.default ?? 0;
    return granted >= ({ LIMITED: 1, OBSERVER: 2, OWNER: 3 }[level] ?? Infinity);
  }

  getRollOptions() {
    return [];
  }

  getCondition(slug, { all = false } = {}) {
    const conditions = [...this.items.values()].filter(
      (item) => item.type === "condition" && (all || item.active) && (item.slug === slug || item.id === slug)
    );
    if (all)
      conditions.sort((a, b) => {
        const aValue = a.system.value?.value ?? 0;
        const bValue = b.system.value?.value ?? 0;
        return aValue > bValue ? -1 : +(aValue < bValue);
      });
    return conditions[0] ?? null;
  }

  hasCondition(...slugs) {
    return slugs.some((slug) => !!this.getCondition(slug));
  }

  isAffectedBy(condition) {
    const slug = typeof condition === "string" ? condition : condition?.slug;
    return slug ? this.hasCondition(slug) : false;
  }

  isImmuneTo() {
    return false;
  }

  async increaseCondition(condition, { max = Number.MAX_SAFE_INTEGER, value } = {}) {
    this.#requireWritable();
    if (condition === "persistent-damage") return null;
    const existing =
      typeof condition === "string"
        ? (this.itemTypes.condition ?? []).find((item) =>
            value ? item.slug === condition && !item.isLocked : item.slug === condition && item.active
          )
        : condition;
    if (existing) {
      const current = existing._source.system?.value?.value;
      if (current === null) return null;
      const next = clamp(current + (value ?? 1), 1, max);
      await game.pf2e.ConditionManager.updateConditionValue(existing.id, this, next);
      return this.items.get(existing.id) ?? existing;
    }
    if (typeof condition !== "string") return null;
    const template = game.pf2e.ConditionManager.getCondition(condition);
    if (!template) return null;
    const source = template.toObject();
    const initial = typeof source.system.value.value === "number" && max ? clamp(source.system.value.value, value ?? 1, max) : null;
    source.system.value.value = initial;
    return (await this.createEmbeddedDocuments("Item", [source])).shift() ?? null;
  }

  async decreaseCondition(condition, { forceRemove = false } = {}) {
    this.#requireWritable();
    const item = typeof condition === "string" ? this.getCondition(condition) : condition;
    if (!item) return;
    if (item.slug === "persistent-damage") {
      const ids = [...this.items.values()].filter((entry) => entry.slug === item.slug).map((entry) => entry.id);
      await this.deleteEmbeddedDocuments("Item", ids);
      return;
    }
    const current = item._source.system?.value?.value;
    const next = typeof current === "number" ? Math.max(current - 1, 0) : null;
    if (next !== null && !forceRemove) await game.pf2e.ConditionManager.updateConditionValue(item.id, this, next);
    else await this.deleteEmbeddedDocuments("Item", [item.id]);
  }

  async toggleCondition(condition, { active } = {}) {
    const enabled = active ?? !this.hasCondition(condition);
    if (enabled && !this.hasCondition(condition)) await this.increaseCondition(condition);
    else if (enabled) return true;
    else if (!enabled && this.hasCondition(condition)) {
      await this.decreaseCondition(condition, { forceRemove: true });
      return false;
    }
  }

  clone(changes = {}) {
    const data = clone(this._data);
    applyUpdate(data, changes);
    return new MapObjectActor({ ...this._record, data }, { persist: false });
  }

  toObject() {
    return { ...clone(this._data), _id: this.id };
  }

  async update(changes, { expectedSource = null } = {}) {
    this.#requireWritable();
    const entry = snapshotSheetRegistry.get(snapshotSheetKey(this.combatId, this.id));
    if (entry) {
      entry.actor = this;
      entry.pending = true;
    }
    try {
      const stored = await updateMapObjectSource(this.combatId, this.id, changes, { expectedSource });
      this._data = clone(stored.data);
      this._record = stored;
      this.#syncItems();
      await syncPublicMapActor(stored);
      Hooks.callAll("sf2e-tactical-starship-combat.invalidateSensorMapActors", this);
      if (entry) await refreshSnapshotSheet(entry);
      return this;
    } finally {
      if (entry) entry.pending = false;
    }
  }

  async createEmbeddedDocuments(type, sources = [], { keepId = false } = {}) {
    this.#requireWritable();
    if (type !== "Item" || !Array.isArray(sources)) throw new Error(T("SF2eTSC.effects.errors.nativeUnavailable"));
    const items = clone(this._data.items ?? []);
    const created = [];
    for (const source of sources) {
      const id = keepId && source._id ? source._id : foundry.utils.randomID(16);
      if (items.some((item) => (item._id ?? item.id) === id)) throw new Error(T("SF2eTSC.effects.errors.nativeRejected"));
      const data = { ...clone(source), _id: id };
      const item = new SnapshotItem(this, data);
      if (this.isImmuneTo(item)) continue;
      items.push(data);
      created.push(item);
    }
    if (!created.length) return [];
    await this.update({ items: new foundry.data.operators.ForcedReplacement(items) }, { expectedSource: clone(this._source) });
    return created.map((item) => this.items.get(item.id)).filter(Boolean);
  }

  async updateEmbeddedDocuments(type, updates = []) {
    this.#requireWritable();
    if (type !== "Item" || !Array.isArray(updates)) throw new Error(T("SF2eTSC.effects.errors.nativeUnavailable"));
    const items = clone(this._data.items ?? []);
    const changed = [];
    for (const update of updates) {
      const id = update._id;
      const index = items.findIndex((item) => (item._id ?? item.id) === id);
      if (index < 0) throw new Error(T("SF2eTSC.effects.errors.nativeRejected"));
      const { _id: _ignored, ...changes } = update;
      applyUpdate(items[index], changes);
      changed.push(id);
    }
    if (!changed.length) return [];
    await this.update({ items: new foundry.data.operators.ForcedReplacement(items) }, { expectedSource: clone(this._source) });
    return changed.map((id) => this.items.get(id)).filter(Boolean);
  }

  async deleteEmbeddedDocuments(type, ids = []) {
    this.#requireWritable();
    if (type !== "Item" || !Array.isArray(ids)) throw new Error(T("SF2eTSC.effects.errors.nativeUnavailable"));
    const removed = new Set(ids);
    const items = clone(this._data.items ?? []);
    const deleted = items
      .filter((item) => removed.has(item._id ?? item.id))
      .map((item) => this.items.get(item._id ?? item.id))
      .filter(Boolean);
    const next = items.filter((item) => !removed.has(item._id ?? item.id));
    if (deleted.length)
      await this.update({ items: new foundry.data.operators.ForcedReplacement(next) }, { expectedSource: clone(this._source) });
    return deleted;
  }

  async setFlag(scope, key, value) {
    return this.update({ [`flags.${scope}.${key}`]: value });
  }

  async delete() {
    throw new Error("Sensor Map objects must be removed through the Sensor Map");
  }
}

export function isMapObjectActor(actor) {
  return actor?.isMapObject === true && actor.mapOnly === true;
}

export function mapObjectActorFromStore(combatId, key) {
  const record = mapObjectSource(combatId, key);
  return record ? new MapObjectActor(record) : null;
}

export async function createMapObjectActor(source, combat, { privateContact = false } = {}) {
  requirePrivateGM();
  if (
    !source ||
    source.documentName !== "Actor" ||
    typeof source.uuid !== "string" ||
    !source.uuid ||
    !source.name ||
    typeof source.toObject !== "function"
  )
    throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
  const data = source.toObject();
  if (!data || typeof data !== "object") throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
  delete data._id;
  data.name = source.name;
  data.type = source.type;
  data.img = source.img;
  data.ownership = clone(privateContact ? { default: 0 } : (source.ownership ?? data.ownership ?? { default: 0 }));
  data.flags = {
    ...(data.flags ?? {}),
    [MODULE_ID]: {
      ...(data.flags?.[MODULE_ID] ?? {}),
      tacticalCopyOf: source.uuid,
      sensorContactInstance: { combatId: combat.id, sourceUuid: source.uuid, privateContact }
    }
  };
  delete data.flags[MODULE_ID].historyUndoReceipt;
  delete data.flags[MODULE_ID].chatDamageApplications;
  const store = privateStoreFor(combat.id);
  const occupied = new Set([
    ...getTsc(combat).objects.flatMap((object) => [object.key, object.actorUuid]),
    ...(store?.flags?.[MODULE_ID]?.privateSensor?.contacts ?? []).flatMap((contact) => [contact.key, contact.actorUuid]),
    ...Object.keys(mapObjectSources(combat.id))
  ]);
  let key;
  do key = `map-${foundry.utils.randomID(16)}`;
  while (occupied.has(key));
  const record = { schema: 1, combatId: combat.id, key, sourceUuid: source.uuid, data };
  await writeMapObjectSource(combat.id, key, record, { create: true });
  return new MapObjectActor(mapObjectSources(combat.id)[key]);
}

function referencedMapObject(combat, key) {
  if (!combat || typeof key !== "string") return false;
  const stateObject = getTsc(combat).objects.some((object) => object.key === key || object.actorUuid === key);
  const contact = privateStoreFor(combat.id)?.flags?.[MODULE_ID]?.privateSensor?.contacts?.some(
    (entry) => entry.key === key || entry.actorUuid === key
  );
  return stateObject || contact;
}

function mapOnlyKeyForSource(combat, uuid) {
  if (!combat || typeof uuid !== "string" || !uuid || uuid.startsWith("map-")) return null;
  const objects = getTsc(combat).objects;
  if (objects.some((object) => !object.mapOnly && (object.key === uuid || object.actorUuid === uuid))) return null;
  const matches = objects.filter((object) => object.mapOnly && object.sourceUuid === uuid && !object.tscPrivateProjection);
  if (matches.length > 1) throw new Error(game.i18n.localize("SF2eTSC.errors.ambiguousSource"));
  return matches[0]?.key ?? null;
}

export function resolveSensorActorSync(combat, uuid, { resolve = fromUuidSync_ } = {}) {
  if (typeof uuid !== "string" || !uuid) return null;
  if (uuid.startsWith("map-")) {
    const record = mapObjectSource(combat?.id, uuid);
    if (record && referencedMapObject(combat, uuid)) return new MapObjectActor(record);
    const publicRecord = publicMapObjectRecord(combat?.id, uuid);
    if (publicRecord) return new MapObjectActor(publicRecord);
  }
  return resolve(uuid);
}

export async function resolveSensorActor(combat, uuid, { resolve = fromUuidSafe } = {}) {
  if (typeof uuid !== "string" || !uuid) return null;
  if (uuid.startsWith("map-")) {
    const record = mapObjectSource(combat?.id, uuid);
    if (record && referencedMapObject(combat, uuid)) return new MapObjectActor(record);
    const publicRecord = publicMapObjectRecord(combat?.id, uuid);
    if (publicRecord) return new MapObjectActor(publicRecord);
  }
  return resolve(uuid);
}

export function resolveSensorActorForActionSync(combat, uuid, { resolve = fromUuidSync_ } = {}) {
  const sourceKey = mapOnlyKeyForSource(combat, uuid);
  return resolveSensorActorSync(combat, sourceKey ?? uuid, { resolve });
}

export async function resolveSensorActorForAction(combat, uuid, { resolve = fromUuidSafe } = {}) {
  const sourceKey = mapOnlyKeyForSource(combat, uuid);
  return resolveSensorActor(combat, sourceKey ?? uuid, { resolve });
}
