import { MODULE_ID } from "../constants.mjs";
import { isActiveGM, T, fromUuidSafe } from "../utils/foundry.mjs";
import { serialize } from "../utils/serial.mjs";
import { getTsc, saveTsc } from "../combat/tsc-state.mjs";
import { dropActorOnMap } from "./actor-drop.mjs";
import { addObject } from "../engine/sensor-ops.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { hazardNeedsCombatant } from "../engine/hazard-rules.mjs";
import {
  deleteSensorActorInstance,
  ensureSensorActorCombatant,
  privateSensorActorCombatant,
  revealSensorActorCombatant,
  SENSOR_CONTACT_COMBATANT_NAME,
  SENSOR_CONTACT_COMBATANT_IMAGE
} from "./actor-instance.mjs";

// Отдельный JournalEntry без родительской папки и наследуемых прав; в Combat сохраняется только проекция карты.
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
  const users = game.users?.contents;
  if (
    doc.folder ||
    ownership.default !== 0 ||
    marker?.schema !== 1 ||
    !Array.isArray(marker.contacts) ||
    (marker.completedReveals !== undefined &&
      (!Array.isArray(marker.completedReveals) ||
        marker.completedReveals.length > COMPLETED_REVEAL_LIMIT ||
        marker.completedReveals.some((intent) => !validIntent(intent, combatId, intent) || intent.stage !== "consistent") ||
        new Set(marker.completedReveals.map((intent) => intent.key)).size !== marker.completedReveals.length)) ||
    typeof doc.testUserPermission !== "function" ||
    !Array.isArray(users) ||
    users.some((user) => !user.isGM && doc.testUserPermission(user, "LIMITED")) ||
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
        !["undetected", "hidden", "observed"].includes(o.detection?.party) ||
        (o.reveal && !validIntent(o.reveal, combatId, o))
    ) ||
    new Set(entries.map((o) => o.key)).size !== entries.length ||
    new Set(entries.filter((o) => o.actorUuid).map((o) => o.actorUuid)).size !== entries.filter((o) => o.actorUuid).length
  )
    throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  return structuredClone(entries).map((contact) => (contact.reveal ? { ...contact, pendingReveal: true } : contact));
}
async function ensureStore(combatId) {
  const old = storeFor(combatId);
  if (old) return old;
  requireGM();
  await JournalEntry.create({
    name: T("SF2eTSC.privateMap.storeName"),
    folder: null,
    ownership: { default: 0 },
    flags: { [MODULE_ID]: { privateSensor: { schema: 1, combatId, contacts: [] } } }
  });
  requireGM();
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
  const actorCombatants = [...(combat.combatants ?? [])].filter((c) => c.actor?.uuid === actor.uuid || c.actorId === actor.id);
  const privateInitiative = privateSensorActorCombatant(combat, actor);
  if (
    game.users.contents.some((u) => !u.isGM && actor.testUserPermission(u, "LIMITED")) ||
    (actorCombatants.length > 0 && (actorCombatants.length !== 1 || actorCombatants[0] !== privateInitiative))
  )
    throw new Error(T("SF2eTSC.privateMap.actorExposed"));
}
export async function addPrivateContact(combat, actor, zone) {
  requireGM();
  return serialize(`sensor:${combat.id}`, async () => {
    requireGM();
    if (!validZone(combat, zone)) throw new Error(T("SF2eTSC.mapDrop.invalidZone"));
    const pending = privateContacts(combat.id).find((contact) => contact.actorUuid === actor?.uuid);
    if (pending) assertNotPending(pending);
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
  requireGM();
}

const REVEAL_STAGES = ["intent", "map", "combatant", "actor", "consistent"];
const COMPLETED_REVEAL_LIMIT = 64;
const instanceOf = (actor) => actor?.flags?.[MODULE_ID]?.sensorContactInstance;
const actorEntries = (combat, actor) =>
  [...(combat.combatants ?? [])].filter((entry) => entry.actorId === actor.id || entry.actor?.uuid === actor.uuid);

// All intent and receipts live only in the permission-checked JournalEntry, never on Combat.
function revealError(message) {
  throw new Error(`Private contact REVEAL: ${message}. Resolve the conflict as GM before explicit recovery.`);
}
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
}
function validIntent(intent, combatId, contact) {
  return (
    intent?.schema === 1 &&
    intent.combatId === combatId &&
    intent.key === contact.key &&
    typeof intent.key === "string" &&
    intent.key.startsWith("private-") &&
    intent.actorUuid === contact.actorUuid &&
    (typeof intent.actorUuid === "string" || intent.actorUuid === null) &&
    typeof intent.turnRequired === "boolean" &&
    REVEAL_STAGES.includes(intent.stage) &&
    intent.object?.key === (contact.actorUuid ?? contact.key) &&
    intent.object?.detection?.party === "identified" &&
    (intent.actorUuid ? intent.object.actorUuid === intent.actorUuid : intent.object.type === "custom" && intent.instance === null) &&
    ["none", "anonymous", "create"].includes(intent.combatant?.mode) &&
    (intent.combatant.mode === "none" ? !intent.turnRequired : intent.turnRequired) &&
    (intent.combatant.mode === "none" ? intent.combatant.id === null : typeof intent.combatant.id === "string")
  );
}
function completedReveals(combatId) {
  return structuredClone(storeFor(combatId)?.flags?.[MODULE_ID]?.privateSensor?.completedReveals ?? []);
}

/** Read-only, GM-only diagnostics for an explicit recovery control. No hook/render writes. */
export function pendingPrivateReveals(combatId) {
  return privateContacts(combatId)
    .filter((contact) => contact.reveal)
    .map((contact) => ({ key: contact.key, actorUuid: contact.actorUuid, stage: contact.reveal.stage }));
}
function assertNotPending(contact) {
  if (contact.reveal) revealError("this contact has pending recovery; move/remove/detect/rename is blocked");
}
function assertRevealActor(combat, contact, actor, intent) {
  if (!contact.actorUuid) return;
  if (!actor || actor.uuid !== contact.actorUuid || game.actors?.get(actor.id) !== actor)
    revealError("the original world Actor is missing or replaced");
  if (
    actor.documentName !== "Actor" ||
    actor.pack ||
    actor.isToken ||
    !(actor.type === "hazard" || (isStarship(actor) && readStarship(actor).role === "npc"))
  )
    revealError("the original Actor type or ownership is incompatible");
  if (
    typeof actor.testUserPermission !== "function" ||
    !Array.isArray(game.users?.contents) ||
    game.users.contents.some((user) => !user.isGM && actor.testUserPermission(user, "LIMITED")) ||
    Object.entries(actor.ownership ?? {}).some(([id, level]) => Number(level) > 0 && (id === "default" || !game.users.get(id)?.isGM))
  )
    revealError("Actor permissions now expose the private contact");
  const instance = instanceOf(actor);
  if (intent) {
    if (
      !same(instance ? { combatId: instance.combatId, sourceUuid: instance.sourceUuid } : null, intent.instance) ||
      (instance && ![true, false].includes(instance.privateContact)) ||
      (actor.flags?.[MODULE_ID]?.tacticalCopyOf ?? null) !== intent.copyOf ||
      actor.name !== intent.actorName ||
      actor.img !== intent.actorImage ||
      actor.type !== intent.actorType ||
      intent.turnRequired !==
        Boolean(
          instance &&
          ((isStarship(actor) && readStarship(actor).role === "npc") ||
            (actor.type === "hazard" && hazardNeedsCombatant(actor.system?.details)))
        )
    )
      revealError("Actor identity or instance ownership changed");
  } else if (instance && (instance.combatId !== combat.id || instance.privateContact !== true))
    revealError("Actor instance is owned by another Combat or is already public");
}
function inspectRevealMap(combat, intent) {
  const state = getTsc(combat);
  const related = state.objects.filter(
    (object) => object.key === intent.key || object.key === intent.object.key || (intent.actorUuid && object.actorUuid === intent.actorUuid)
  );
  const projections = related.filter((object) => object.key === intent.key && object.tscPrivateProjection === true);
  const publicObjects = related.filter((object) => !projections.includes(object));
  if (
    projections.length > 1 ||
    publicObjects.length > 1 ||
    projections.some((object) => !same(object, intent.projection)) ||
    publicObjects.some((object) => !same(object, intent.object))
  )
    revealError("conflicting or duplicate public object/projection");
  return { state, published: publicObjects.length === 1 && projections.length === 0 };
}
function inspectRevealCombatant(combat, actor, intent) {
  if (!actor) return { entry: null, revealed: true };
  const expected = intent.combatant;
  const entries = actorEntries(combat, actor);
  const byId = expected.id ? combat.combatants.get(expected.id) : null;
  if (entries.length > 1 || (byId && !entries.includes(byId)))
    revealError("duplicate Actor Combatants or reserved Combatant ID belongs to another Actor");
  if (expected.mode === "none") {
    if (entries.length) revealError("unexpected manual Combatant for an Actor without a turn");
    return { entry: null, revealed: true };
  }
  const [entry] = entries;
  if (!entry) {
    if (expected.mode === "anonymous") revealError("the original anonymous Combatant is missing");
    return { entry: null, revealed: false };
  }
  const flags = entry.flags?.[MODULE_ID] ?? {};
  const ref = flags.sensorMapInitiative;
  const instance = flags.sensorContactInstance;
  if (
    entry.id !== expected.id ||
    entry.actorId !== actor.id ||
    entry.combat?.id !== combat.id ||
    entry.tokenId ||
    (entry.initiative ?? null) !== expected.initiative ||
    (instance && (instance.combatId !== combat.id || instance.actorUuid !== actor.uuid)) ||
    (ref && ref.combatId !== combat.id && Object.hasOwn(ref, "combatId")) ||
    flags.compromisedEntry ||
    flags.starshipMine ||
    (expected.mode === "anonymous" ? !ref || instance : !instance || ref)
  )
    revealError("Combatant identity, initiative or module ownership conflicts");
  const revealed =
    entry.hidden === false &&
    entry.name === intent.actorName &&
    entry.img === intent.actorImage &&
    (expected.mode === "create" || (ref.contactDesignation === false && ref.combatId === combat.id));
  const anonymous =
    expected.mode === "anonymous" &&
    entry.hidden === true &&
    entry.name === SENSOR_CONTACT_COMBATANT_NAME &&
    entry.img === SENSOR_CONTACT_COMBATANT_IMAGE &&
    ref.contactDesignation === true;
  if (!revealed && !anonymous) revealError("Combatant is not the expected anonymous or revealed entry");
  return { entry, revealed };
}
async function writeRevealStage(combat, key, intent, stage) {
  requireGM();
  const doc = storeFor(combat.id);
  const contacts = privateContacts(combat.id);
  const contact = contacts.find((entry) => entry.key === key);
  if (!doc || !contact || !same(contact.reveal, intent)) revealError("journal intent changed during recovery");
  if (REVEAL_STAGES.indexOf(intent.stage) >= REVEAL_STAGES.indexOf(stage)) return intent;
  const next = { ...intent, stage };
  contact.reveal = next;
  delete contact.pendingReveal;
  await doc.update({ [`flags.${MODULE_ID}.privateSensor.contacts`]: contacts });
  requireGM();
  if (!same(privateContacts(combat.id).find((entry) => entry.key === key)?.reveal, next))
    revealError("journal stage acknowledgement did not match the stored intent");
  return next;
}
async function beginReveal(combat, contact, actor) {
  assertRevealActor(combat, contact, actor);
  if (actor) assertHiddenActor(actor, combat);
  const state = getTsc(combat);
  const projection =
    contact.detection.party === "observed"
      ? {
          key: contact.key,
          zone: contact.zone,
          type: "contact",
          span: 1,
          name: "Contact",
          heading: null,
          detection: { party: "observed" },
          tscPrivateProjection: true
        }
      : null;
  const next = actor
    ? dropActorOnMap({ ...state, objects: [] }, actor, contact.zone, { publicActor: true }).state
    : addObject(
        { ...state, objects: [] },
        {
          key: contact.key,
          type: "custom",
          name: contact.name,
          zone: contact.zone,
          heading: null,
          detection: { party: "identified" }
        }
      );
  const anonymous = actor ? privateSensorActorCombatant(combat, actor) : null;
  const instance = instanceOf(actor);
  const needsTurn =
    instance &&
    ((isStarship(actor) && readStarship(actor).role === "npc") || (actor.type === "hazard" && hazardNeedsCombatant(actor.system?.details)));
  const intent = {
    schema: 1,
    combatId: combat.id,
    key: contact.key,
    actorUuid: contact.actorUuid,
    stage: "intent",
    instance: instance ? { combatId: instance.combatId, sourceUuid: instance.sourceUuid } : null,
    copyOf: actor?.flags?.[MODULE_ID]?.tacticalCopyOf ?? null,
    actorName: actor?.name ?? null,
    actorImage: actor?.img ?? null,
    actorType: actor?.type ?? null,
    turnRequired: Boolean(needsTurn),
    object: structuredClone(next.objects[0]),
    projection: structuredClone(projection),
    combatant: {
      mode: anonymous ? "anonymous" : needsTurn ? "create" : "none",
      id: anonymous?.id ?? (needsTurn ? foundry.utils.randomID(16) : null),
      initiative: anonymous?.initiative ?? null
    }
  };
  if (!validIntent(intent, combat.id, contact)) revealError("cannot record an incompatible reveal intent");
  const map = inspectRevealMap(combat, intent);
  // An existing public identity before intent cannot be attributed to this reveal.
  if (map.state.objects.some((object) => object.key === intent.object.key && !object.tscPrivateProjection))
    revealError("contact is already public without a durable reveal intent");
  inspectRevealCombatant(combat, actor, intent);
  requireGM();
  const doc = storeFor(combat.id),
    contacts = privateContacts(combat.id);
  const current = contacts.find((entry) => entry.key === contact.key);
  if (!doc || !same(current, contact)) revealError("contact changed before recording intent");
  current.reveal = intent;
  await doc.update({ [`flags.${MODULE_ID}.privateSensor.contacts`]: contacts });
  requireGM();
  if (!same(privateContacts(combat.id).find((entry) => entry.key === contact.key)?.reveal, intent))
    revealError("journal did not persist reveal intent");
  return intent;
}
async function finishReveal(combat, contact, actor, initialIntent) {
  let intent = initialIntent;
  let publicationRequired = false;
  const inspect = () => {
    requireGM();
    if (!same(privateContacts(combat.id).find((entry) => entry.key === contact.key)?.reveal, intent))
      revealError("journal intent changed during recovery");
    assertRevealActor(combat, contact, actor, intent);
    const map = inspectRevealMap(combat, intent);
    if (publicationRequired && !map.published) revealError("public object disappeared after publication");
    return { map, tracker: inspectRevealCombatant(combat, actor, intent) };
  };
  let actual = inspect();
  if (!actual.map.published) {
    const state = actual.map.state;
    const objects = state.objects.filter((object) => object.key !== intent.key && object.key !== intent.object.key);
    objects.push(structuredClone(intent.object));
    const next = { ...state, objects };
    if (actor?.type === "hazard")
      next.hazardState = {
        ...state.hazardState,
        [actor.uuid]: { disabled: false, placement: "sensor", ...(state.hazardState?.[actor.uuid] ?? {}) }
      };
    await saveTsc(combat, next);
    actual = inspect();
    if (!actual.map.published) revealError("map publication did not persist");
  }
  publicationRequired = true;
  intent = await writeRevealStage(combat, contact.key, intent, "map");
  actual = inspect();
  if (!actual.tracker.revealed && actual.tracker.entry) {
    await revealSensorActorCombatant(combat, actor, actual.tracker.entry);
    actual = inspect();
    if (!actual.tracker.revealed) revealError("Combatant disclosure did not persist");
  }
  // Preserve existing anonymous conversion before releasing the Actor's private-instance flag.
  intent = await writeRevealStage(combat, contact.key, intent, "combatant");
  inspect();
  if (intent.instance && instanceOf(actor).privateContact !== false) {
    await actor.update({ [`flags.${MODULE_ID}.sensorContactInstance.privateContact`]: false });
    inspect();
    if (instanceOf(actor).privateContact !== false) revealError("Actor disclosure did not persist");
  }
  intent = await writeRevealStage(combat, contact.key, intent, "actor");
  actual = inspect();
  if (intent.combatant.mode === "create" && !actual.tracker.entry) {
    await ensureSensorActorCombatant(combat, actor, { combatantId: intent.combatant.id });
    actual = inspect();
    if (!actual.tracker.revealed) revealError("reserved Combatant creation did not persist");
  }
  actual = inspect();
  if (!actual.map.published || !actual.tracker.revealed || (intent.instance && instanceOf(actor).privateContact !== false))
    revealError("documents are not consistent; private journal retained");
  intent = await writeRevealStage(combat, contact.key, intent, "consistent");
  actual = inspect();
  if (!actual.map.published || !actual.tracker.revealed || (intent.instance && instanceOf(actor).privateContact !== false))
    revealError("documents changed before journal finalization; private journal retained");
  const doc = storeFor(combat.id),
    contacts = privateContacts(combat.id);
  const receipts = completedReveals(combat.id).filter((receipt) => receipt.key !== contact.key);
  receipts.push(intent);
  await doc.update({
    [`flags.${MODULE_ID}.privateSensor.contacts`]: contacts.filter((entry) => entry.key !== contact.key),
    [`flags.${MODULE_ID}.privateSensor.completedReveals`]: receipts.slice(-COMPLETED_REVEAL_LIMIT)
  });
  requireGM();
  if (
    privateContacts(combat.id).some((entry) => entry.key === contact.key) ||
    !same(
      completedReveals(combat.id).find((receipt) => receipt.key === contact.key),
      intent
    )
  )
    revealError("journal finalization did not persist");
  assertRevealActor(combat, contact, actor, intent);
  if (
    !inspectRevealMap(combat, intent).published ||
    !inspectRevealCombatant(combat, actor, intent).revealed ||
    (intent.instance && instanceOf(actor).privateContact !== false)
  )
    revealError("documents changed during journal finalization");
  return true;
}
async function revealLocked(combat, key) {
  requireGM();
  const contact = privateContacts(combat.id).find((entry) => entry.key === key);
  const receipt = contact ? null : completedReveals(combat.id).find((entry) => entry.key === key);
  if (!contact && !receipt) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  const record = contact ?? receipt;
  const actor = record.actorUuid ? await fromUuidSafe(record.actorUuid) : null;
  requireGM();
  if (receipt) {
    assertRevealActor(combat, receipt, actor, receipt);
    if (
      !inspectRevealMap(combat, receipt).published ||
      !inspectRevealCombatant(combat, actor, receipt).revealed ||
      (receipt.instance && instanceOf(actor).privateContact !== false)
    )
      revealError("completed reveal no longer matches actual documents");
    return false;
  }
  const intent = contact.reveal ?? (await beginReveal(combat, contact, actor));
  requireGM();
  return finishReveal(combat, contact, actor, intent);
}

/** Explicit active-GM finish-forward recovery; failures remain pending, never rolled back. */
export async function recoverPrivateReveals(combat) {
  requireGM();
  return serialize(`sensor:${combat.id}`, async () => {
    requireGM();
    const report = { pending: [], completed: [], failed: [] };
    for (const entry of pendingPrivateReveals(combat.id)) {
      try {
        requireGM();
        await revealLocked(combat, entry.key);
        requireGM();
        report.completed.push(entry.key);
      } catch (error) {
        if (!game.user?.isGM) throw new Error(T("SF2eTSC.privateMap.activeGM"), { cause: error });
        const current = pendingPrivateReveals(combat.id).find((pending) => pending.key === entry.key);
        report.failed.push({ key: entry.key, stage: current?.stage ?? entry.stage, error: error.message });
      }
    }
    report.pending = pendingPrivateReveals(combat.id);
    return report;
  });
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
    if (op === "reveal") return revealLocked(combat, key);
    const doc = storeFor(combat.id),
      contacts = privateContacts(combat.id);
    const matching = contacts.filter((o) => o.key === key);
    if (!doc || matching.length !== 1) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    const contact = matching[0];
    assertNotPending(contact);
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
    } else throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    requireGM();
    if (storeFor(combat.id)?.id !== doc.id) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
    await doc.update({ [`flags.${MODULE_ID}.privateSensor.contacts`]: contacts });
    requireGM();
    if (op === "remove" && contact.actorUuid) await deleteSensorActorInstance(combat, contact.actorUuid);
    return true;
  });
}
