import { MODULE_ID } from "../constants.mjs";
import { getTsc } from "../combat/tsc-state.mjs";
import { activeGM, fromUuidSafe, fromUuidSync_, T } from "../utils/foundry.mjs";
import { serialize } from "../utils/serial.mjs";
import { ensurePrivateStore, privateStoreFor, requirePrivateGM } from "./private-store.mjs";

const MAP_OBJECT_SOURCE = "mapObjects";
const clone = (value) => structuredClone(value);
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

export function mapObjectSources(combatId) {
  if (!game.user?.isGM || !Array.isArray(game.journal?.contents)) return {};
  const sources = privateStoreFor(combatId)?.flags?.[MODULE_ID]?.privateSensor?.[MAP_OBJECT_SOURCE] ?? {};
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  for (const [key, record] of Object.entries(sources))
    if (!validRecord(record, combatId, key)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  return clone(sources);
}

async function writeMapObjectSource(combatId, key, record, { create = false } = {}) {
  return serialize(`sensor-source:${combatId}`, async () => {
    requirePrivateGM();
    if (!validRecord(record, combatId, key)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    record = withActiveGMOwner(record);
    const doc = await ensurePrivateStore(combatId);
    const sources = mapObjectSources(combatId);
    if (create && sources[key]) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    if (!create && !sources[key]) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    requirePrivateGM();
    if (privateStoreFor(combatId)?.id !== doc.id) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    await doc.update({
      [`flags.${MODULE_ID}.privateSensor.${MAP_OBJECT_SOURCE}.${key}`]: new foundry.data.operators.ForcedReplacement(record)
    });
    requirePrivateGM();
    if (!same(mapObjectSources(combatId)[key], record)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    return record;
  });
}

export async function deleteMapObjectSource(combatId, key) {
  return serialize(`sensor-source:${combatId}`, async () => {
    requirePrivateGM();
    const doc = privateStoreFor(combatId);
    if (!doc) return false;
    const sources = mapObjectSources(combatId);
    if (!sources[key]) return false;
    await doc.update({
      [`flags.${MODULE_ID}.privateSensor.${MAP_OBJECT_SOURCE}.${key}`]: new foundry.data.operators.ForcedDeletion()
    });
    requirePrivateGM();
    if (mapObjectSources(combatId)[key]) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    return true;
  });
}

class SnapshotItems extends Map {
  get contents() {
    return [...this.values()];
  }
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
  constructor(record) {
    this._record = clone(record);
    this._data = clone(record.data);
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
      if (id) this.items.set(id, item);
    }
  }

  testUserPermission(user, level) {
    if (user?.isGM) return true;
    const granted = this.ownership?.[user?.id] ?? this.ownership?.default ?? 0;
    return granted >= ({ LIMITED: 1, OBSERVER: 2, OWNER: 3 }[level] ?? Infinity);
  }

  getRollOptions() {
    return [];
  }

  hasCondition(slug) {
    return [...this.items.values()].some((item) => item.active !== false && item.type === "condition" && item.slug === slug);
  }

  isAffectedBy(condition) {
    const slug = typeof condition === "string" ? condition : condition?.slug;
    return slug ? this.hasCondition(slug) : false;
  }

  isImmuneTo() {
    return false;
  }

  toObject() {
    return { ...clone(this._data), _id: this.id };
  }

  async update(changes) {
    requirePrivateGM();
    const data = clone(this._data);
    applyUpdate(data, changes);
    const record = { ...this._record, data };
    const stored = await writeMapObjectSource(this.combatId, this.id, record);
    this._data = clone(stored.data);
    this._record = stored;
    this.#syncItems();
    Hooks.callAll("sf2e-tactical-starship-combat.invalidateSensorMapActors", this);
    return this;
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
  const record = mapObjectSources(combatId)?.[key];
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

export function resolveSensorActorSync(combat, uuid, { resolve = fromUuidSync_ } = {}) {
  if (typeof uuid !== "string" || !uuid) return null;
  if (uuid.startsWith("map-")) {
    const record = mapObjectSources(combat?.id)?.[uuid];
    if (record && referencedMapObject(combat, uuid)) return new MapObjectActor(record);
  }
  return resolve(uuid);
}

export async function resolveSensorActor(combat, uuid, { resolve = fromUuidSafe } = {}) {
  if (typeof uuid !== "string" || !uuid) return null;
  if (uuid.startsWith("map-")) {
    const record = mapObjectSources(combat?.id)?.[uuid];
    if (record && referencedMapObject(combat, uuid)) return new MapObjectActor(record);
  }
  return resolve(uuid);
}
