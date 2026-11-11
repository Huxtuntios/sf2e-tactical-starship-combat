import { MODULE_ID } from "../constants.mjs";
import { isActiveGM, T, fromUuidSafe } from "../utils/foundry.mjs";
import { serialize } from "../utils/serial.mjs";
import { getTsc, saveTsc } from "../combat/tsc-state.mjs";
import { dropActorOnMap } from "./actor-drop.mjs";
import { addObject } from "../engine/sensor-ops.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { deleteSensorActorInstance, ensureSensorActorCombatant, isSensorActorInstance } from "./actor-instance.mjs";

// Отдельный документ без родительской папки и наследуемых прав; секреты не входят в Combat и module socket.
function requireGM() {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.privateMap.activeGM"));
}
function storeFor(combatId) {
  if (!game.user?.isGM) return null;
  if (!Array.isArray(game.journal?.contents)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  const docs = game.journal.contents.filter((d) => d.flags?.[MODULE_ID]?.privateSensor?.combatId === combatId);
  if (docs.length > 1) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  const doc = docs[0];
  if (!doc) return null;
  const ownership = doc.ownership ?? {};
  const marker = doc.flags?.[MODULE_ID]?.privateSensor;
  if (
    doc.folder ||
    ownership.default !== 0 ||
    marker?.schema !== 1 ||
    !Array.isArray(marker.contacts) ||
    Object.entries(ownership).some(([id, level]) => id !== "default" && Number(level) > 0 && !game.users.get(id)?.isGM)
  )
    throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  return doc;
}
export function privateContacts(combatId) {
  if (!game.user?.isGM) return [];
  const entries = storeFor(combatId)?.flags?.[MODULE_ID]?.privateSensor?.contacts ?? [];
  if (
    entries.some(
      (o) =>
        !o ||
        typeof o.key !== "string" ||
        !o.key.startsWith("private-") ||
        !(typeof o.actorUuid === "string" || (o.type === "custom" && o.actorUuid === null)) ||
        !Number.isInteger(o.zone) ||
        !["undetected", "hidden", "observed"].includes(o.detection?.party)
    ) ||
    new Set(entries.map((o) => o.key)).size !== entries.length ||
    new Set(entries.filter((o) => o.actorUuid).map((o) => o.actorUuid)).size !== entries.filter((o) => o.actorUuid).length
  )
    throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  return structuredClone(entries);
}
async function ensureStore(combatId) {
  const old = storeFor(combatId);
  if (old) return old;
  await JournalEntry.create({
    name: T("SF2eTSC.privateMap.storeName"),
    folder: null,
    ownership: { default: 0 },
    flags: { [MODULE_ID]: { privateSensor: { schema: 1, combatId, contacts: [] } } }
  });
  const created = storeFor(combatId);
  if (!created) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  return created;
}
function validZone(combat, zone) {
  return Number.isInteger(zone) && zone >= 1 && zone <= getTsc(combat).zones;
}
function assertHiddenActor(actor, combat) {
  if (
    !actor ||
    actor.documentName !== "Actor" ||
    actor.pack ||
    actor.isToken ||
    !(actor.type === "hazard" || (isStarship(actor) && readStarship(actor).role === "npc"))
  )
    throw new Error(T("SF2eTSC.privateMap.invalidActor"));
  // Прямой доступ к Actor или Combatant не устраняется скрытием карты.
  if (typeof actor.testUserPermission !== "function" || !Array.isArray(game.users?.contents))
    throw new Error(T("SF2eTSC.privateMap.invalidActor"));
  if (
    game.users.contents.some((u) => !u.isGM && actor.testUserPermission(u, "LIMITED")) ||
    [...(combat.combatants ?? [])].some((c) => c.actor?.uuid === actor.uuid || c.actorId === actor.id)
  )
    throw new Error(T("SF2eTSC.privateMap.actorExposed"));
}
export async function addPrivateContact(combat, actor, zone) {
  requireGM();
  return serialize(`sensor:${combat.id}`, async () => {
    requireGM();
    if (!validZone(combat, zone)) throw new Error(T("SF2eTSC.mapDrop.invalidZone"));
    assertHiddenActor(actor, combat);
    const pub = getTsc(combat).objects.filter((o) => o.actorUuid === actor.uuid || o.key === actor.uuid);
    if (pub.length) throw new Error(T("SF2eTSC.privateMap.alreadyPublic"));
    const doc = await ensureStore(combat.id);
    const contacts = privateContacts(combat.id);
    const existing = contacts.find((o) => o.actorUuid === actor.uuid);
    if (existing) {
      if (existing.zone === zone) {
        await saveProjection(combat, existing);
        return "unchanged";
      }
      await saveProjection(combat, { ...existing, zone });
      existing.zone = zone;
    } else {
      const key = `private-${foundry.utils.randomID(16)}`;
      if (contacts.some((o) => o.key === key) || getTsc(combat).objects.some((o) => o.key === key))
        throw new Error(T("SF2eTSC.privateMap.invalidStore"));
      contacts.push({
        key,
        actorUuid: actor.uuid,
        name: actor.name,
        type: actor.type === "hazard" ? "hazard" : "starship",
        zone,
        heading: actor.type === "hazard" ? null : (readStarship(actor).heading ?? null),
        detection: { party: "undetected" },
        privateContact: true
      });
    }
    requireGM();
    if (storeFor(combat.id)?.id !== doc.id) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    await doc.update({ [`flags.${MODULE_ID}.privateSensor.contacts`]: contacts });
    return existing ? "moved" : "added";
  });
}
// Публикуется только анонимный маркер наблюдаемого контакта. Hidden и Unnoticed
// остаются исключительно в закрытом журнале, независимо от настройки старой карты.
async function saveProjection(combat, contact, remove = false) {
  const state = getTsc(combat);
  const matches = state.objects.filter((o) => o.key === contact.key);
  if (matches.length > 1 || matches.some((o) => o.tscPrivateProjection !== true)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  const objects = state.objects.filter((o) => o.key !== contact.key);
  if (!remove && contact.detection.party === "observed") {
    objects.push({
      key: contact.key,
      zone: contact.zone,
      type: "contact",
      span: 1,
      name: "Contact",
      heading: null,
      detection: { party: "observed" },
      tscPrivateProjection: true
    });
  }
  requireGM();
  await saveTsc(combat, { ...state, objects });
}

export async function addPrivateCustom(combat, name, zone) {
  requireGM();
  return serialize(`sensor:${combat.id}`, async () => {
    requireGM();
    if (!validZone(combat, zone) || typeof name !== "string" || !name.trim() || name.trim().length > 120)
      throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    const doc = await ensureStore(combat.id),
      contacts = privateContacts(combat.id);
    const key = `private-${foundry.utils.randomID(16)}`;
    if (contacts.some((o) => o.key === key) || getTsc(combat).objects.some((o) => o.key === key))
      throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    contacts.push({
      key,
      actorUuid: null,
      name: name.trim(),
      type: "custom",
      zone,
      heading: null,
      detection: { party: "undetected" },
      privateContact: true
    });
    requireGM();
    if (storeFor(combat.id)?.id !== doc.id) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    await doc.update({ [`flags.${MODULE_ID}.privateSensor.contacts`]: contacts });
    return key;
  });
}
export async function changePrivateContact(combat, key, op, zone) {
  requireGM();
  return serialize(`sensor:${combat.id}`, async () => {
    requireGM();
    const doc = storeFor(combat.id),
      contacts = privateContacts(combat.id);
    const matching = contacts.filter((o) => o.key === key);
    if (!doc || matching.length !== 1) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    const contact = matching[0];
    if (op === "move") {
      if (!validZone(combat, zone)) throw new Error(T("SF2eTSC.mapDrop.invalidZone"));
      if (contact.zone === zone) {
        await saveProjection(combat, contact);
        return false;
      }
      await saveProjection(combat, { ...contact, zone });
      contact.zone = zone;
    } else if (op === "detect") {
      if (!["undetected", "hidden", "observed"].includes(zone)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
      if (contact.detection.party === zone) {
        await saveProjection(combat, contact);
        return false;
      }
      await saveProjection(combat, { ...contact, detection: { party: zone } });
      contact.detection = { party: zone };
    } else if (op === "rename") {
      if (contact.type !== "custom" || typeof zone !== "string" || !zone.trim() || zone.trim().length > 120)
        throw new Error(T("SF2eTSC.privateMap.invalidStore"));
      if (contact.name === zone.trim()) return false;
      contact.name = zone.trim();
    } else if (op === "remove") {
      await saveProjection(combat, contact, true);
      contacts.splice(contacts.indexOf(contact), 1);
    } else if (op === "reveal") {
      const actor = contact.actorUuid ? await fromUuidSafe(contact.actorUuid) : null;
      if (contact.actorUuid) assertHiddenActor(actor, combat);
      // Сначала публикуем, затем очищаем приватную запись: повтор не создаёт вторую публичную запись.
      const state = getTsc(combat);
      const existing = state.objects.filter((o) =>
        contact.actorUuid
          ? o.actorUuid === contact.actorUuid || o.key === contact.actorUuid
          : o.key === contact.key && o.tscPrivateProjection !== true
      );
      const proxy = state.objects.filter((o) => o.key === contact.key && o.tscPrivateProjection === true);
      if (proxy.length > 1 || proxy.some((o) => o.tscPrivateProjection !== true)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
      if (existing.length > 1) throw new Error(T("SF2eTSC.privateMap.alreadyPublic"));
      if (!existing.length || proxy.length) {
        requireGM();
        let next = { ...state, objects: state.objects.filter((o) => o.key !== contact.key) };
        if (!existing.length) {
          next = actor
            ? dropActorOnMap(next, actor, contact.zone, { publicActor: true }).state
            : addObject(next, {
                key: contact.key,
                type: "custom",
                name: contact.name,
                zone: contact.zone,
                heading: null,
                detection: { party: "identified" }
              });
        }
        await saveTsc(combat, next);
        if (actor && isSensorActorInstance(actor, combat.id)) {
          try {
            await actor.update({ [`flags.${MODULE_ID}.sensorContactInstance.privateContact`]: false });
            await ensureSensorActorCombatant(combat, actor);
          } catch (error) {
            await saveTsc(combat, state);
            await actor.update({ [`flags.${MODULE_ID}.sensorContactInstance.privateContact`]: true });
            throw error;
          }
        }
      }
      contacts.splice(contacts.indexOf(contact), 1);
    } else throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    requireGM();
    if (storeFor(combat.id)?.id !== doc.id) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    await doc.update({ [`flags.${MODULE_ID}.privateSensor.contacts`]: contacts });
    if (op === "remove" && contact.actorUuid) await deleteSensorActorInstance(combat, contact.actorUuid);
    return true;
  });
}
