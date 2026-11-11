import { MODULE_ID } from "../constants.mjs";
import { isStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { privateContacts } from "./private-contacts.mjs";
import { SENSOR_CONTACT_COMBATANT_IMAGE, SENSOR_CONTACT_COMBATANT_NAME } from "./actor-instance.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { isActiveGM, T, fromUuidSafe, escapeHtml } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";
import { serialize } from "../utils/serial.mjs";

const sensorInstance = (actor) => actor?.flags?.[MODULE_ID]?.sensorContactInstance;

function liveCombat(combatId) {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const combat = typeof combatId === "string" ? game.combats?.get(combatId) : null;
  if (!combat || !combat.active || !isStarshipCombat(combat)) throw new Error(T("SF2eTSC.errors.noCombat"));
  return combat;
}

function combatants(combat) {
  return combat?.combatants?.contents ?? [...(combat?.combatants ?? [])];
}

function combatantForActor(combat, actor) {
  return combatants(combat).find((entry) => entry.actorId === actor.id || entry.actor?.uuid === actor.uuid) ?? null;
}

function skipped(name, reason) {
  return { status: "skipped", item: { name, reason } };
}

function objectName(object) {
  return String(object?.name ?? object?.label ?? object?.key ?? T("SF2eTSC.initiative.unnamed"));
}

function independentForCombat(actor, combatId) {
  const instance = sensorInstance(actor);
  if (instance) return instance.combatId === combatId && instance.privateContact !== true;
  const sourceUuid = actor?.flags?.[MODULE_ID]?.tacticalCopyOf;
  return typeof sourceUuid === "string" && sourceUuid.length > 0 && sourceUuid !== actor.uuid;
}

function independentPrivateActor(actor, combatId) {
  const instance = sensorInstance(actor);
  return instance?.combatId === combatId && instance.privateContact === true;
}

function hiddenOnTracker(object) {
  return !!object.hidden || ["hidden", "undetected"].includes(object.detection?.party);
}

function trackerName(object, isPrivate) {
  return isPrivate || hiddenOnTracker(object) ? SENSOR_CONTACT_COMBATANT_NAME : object.name;
}

async function createWhisper(report) {
  const recipients = ChatMessage.getWhisperRecipients("GM").map((user) => user.id);
  if (!recipients.includes(game.user.id)) throw new Error("No GM whisper recipient");
  const sections = ["added", "existing", "skipped", "failed"]
    .map((key) => {
      const items = report[key]
        .map((item) => {
          const reason =
            item.reason && key !== "added" && key !== "existing" ? ` — ${escapeHtml(T(`SF2eTSC.initiative.reasons.${item.reason}`))}` : "";
          const visibility = item.hidden ? ` — ${escapeHtml(T("SF2eTSC.initiative.hiddenTrackerEntry"))}` : "";
          const message = item.message ? ` — ${escapeHtml(item.message)}` : "";
          return `<li>${escapeHtml(item.name)}${reason}${visibility}${message}</li>`;
        })
        .join("");
      const heading = escapeHtml(T(`SF2eTSC.initiative.sections.${key}`, { count: report[key].length }));
      return `<h3>${heading}</h3>${items ? `<ul>${items}</ul>` : `<p>${escapeHtml(T("SF2eTSC.initiative.none"))}</p>`}`;
    })
    .join("");
  await ChatMessage.create({
    content: `<h2>${escapeHtml(T("SF2eTSC.initiative.bulkTitle"))}</h2>${sections}`,
    whisper: recipients
  });
}

function reportCounts(report) {
  return {
    added: report.added.length,
    existing: report.existing.length,
    skipped: report.skipped.length,
    failed: report.failed.length
  };
}

async function addActorLocked(combatId, input) {
  const { actorUuid, isPrivate, validateCurrent } = input;
  let { name, displayName, hidden } = input;
  let combat = liveCombat(combatId);
  const actor = await fromUuidSafe(actorUuid);
  if (!actor || actor.uuid !== actorUuid || actor.documentName !== "Actor")
    return { status: "failed", item: { name, reason: "actorMissing" } };
  if (!isStarship(actor)) return skipped(name, "notNpcShip");
  if (readStarship(actor).role !== "npc") return skipped(name, "playerShip");

  let currentRecord = await validateCurrent(combat);
  if (!currentRecord) return skipped(name, "missingObject");
  if (!isPrivate) {
    name = objectName(currentRecord);
    hidden = hiddenOnTracker(currentRecord);
    displayName = trackerName(currentRecord, false);
  }

  const existing = combatantForActor(combat, actor);
  if (existing) {
    if (hidden && (!existing.hidden || existing.name !== displayName || existing.img !== SENSOR_CONTACT_COMBATANT_IMAGE))
      await existing.update({ hidden: true, name: displayName, img: SENSOR_CONTACT_COMBATANT_IMAGE });
    return { status: "existing", item: { name, hidden } };
  }

  const independent = isPrivate ? independentPrivateActor(actor, combat.id) : independentForCombat(actor, combat.id);
  if (actor.pack || actor.isToken || !independent) return skipped(name, "noIndependentActor");

  // Re-resolve the map/private record and duplicate state immediately before writing.
  combat = liveCombat(combatId);
  currentRecord = await validateCurrent(combat);
  if (!currentRecord) return skipped(name, "missingObject");
  if (!isPrivate) {
    name = objectName(currentRecord);
    hidden = hiddenOnTracker(currentRecord);
    displayName = trackerName(currentRecord, false);
  }
  const currentIndependent = isPrivate ? independentPrivateActor(actor, combat.id) : independentForCombat(actor, combat.id);
  if (!currentIndependent) return skipped(name, "noIndependentActor");
  if (!isStarship(actor) || readStarship(actor).role !== "npc") return skipped(name, "notNpcShip");

  const duplicate = combatantForActor(combat, actor);
  if (duplicate) {
    if (hidden && (!duplicate.hidden || duplicate.name !== displayName || duplicate.img !== SENSOR_CONTACT_COMBATANT_IMAGE))
      await duplicate.update({ hidden: true, name: displayName, img: SENSOR_CONTACT_COMBATANT_IMAGE });
    return { status: "existing", item: { name, hidden } };
  }

  const [created] = await combat.createEmbeddedDocuments("Combatant", [
    {
      actorId: actor.id,
      sceneId: combat.scene?.id ?? null,
      tokenId: null,
      name: displayName,
      img: hidden ? SENSOR_CONTACT_COMBATANT_IMAGE : undefined,
      hidden,
      flags: { [MODULE_ID]: { sensorMapInitiative: { combatId: combat.id, contactDesignation: hidden } } }
    }
  ]);
  if (!created) throw new Error("couldNotCreateSensorCombatant");
  return { status: "added", item: { name, hidden } };
}

function emptyReport() {
  return { added: [], existing: [], skipped: [], failed: [] };
}

function record(report, result) {
  report[result.status].push(result.item);
}

function safeInitiativeResult(result) {
  const reason = result.item?.reason;
  return reason ? { status: result.status, reason } : { status: result.status };
}

async function addPrivateContactResult(combatId, key, contact) {
  if (contact.type !== "starship") return { status: "skipped", reason: "notNpcShip" };
  if (!contact.actorUuid) return { status: "skipped", reason: "markerOnly" };
  try {
    const result = await addActorLocked(combatId, {
      actorUuid: contact.actorUuid,
      name: objectName(contact),
      displayName: SENSOR_CONTACT_COMBATANT_NAME,
      hidden: true,
      isPrivate: true,
      validateCurrent: (currentCombat) => {
        const current = privateContacts(currentCombat.id).filter((entry) => entry.key === key);
        return current.length === 1 && current[0].actorUuid === contact.actorUuid && current[0].type === "starship" ? current[0] : null;
      }
    });
    return safeInitiativeResult(result);
  } catch (error) {
    log.error("private sensor initiative add failed", error);
    return { status: "failed", reason: "failed" };
  }
}

export async function addSensorObjectToInitiative(combatId, key, user = game.user) {
  if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  return serialize(`sensor:${combatId}`, async () => {
    const combat = liveCombat(combatId);
    const matches = getTsc(combat).objects.filter((object) => object.key === key);
    if (matches.length === 1) {
      const object = matches[0];
      if (object.tscPrivateProjection) {
        const privateMatches = privateContacts(combat.id).filter((contact) => contact.key === key);
        if (privateMatches.length === 1) return addPrivateContactResult(combat.id, key, privateMatches[0]);
        return { status: "skipped", reason: "privateContact" };
      }
      const name = objectName(object);
      if (object.type !== "starship") return { status: "skipped", reason: object.actorUuid ? "notNpcShip" : "markerOnly" };
      if (!object.actorUuid) return { status: "skipped", reason: "markerOnly" };
      const hidden = hiddenOnTracker(object);
      try {
        const result = await addActorLocked(combatId, {
          actorUuid: object.actorUuid,
          name,
          displayName: trackerName(object, false),
          hidden,
          isPrivate: false,
          validateCurrent: (currentCombat) => {
            const current = getTsc(currentCombat).objects.filter((entry) => entry.key === key);
            return current.length === 1 && current[0].type === "starship" && current[0].actorUuid === object.actorUuid ? current[0] : null;
          }
        });
        return safeInitiativeResult(result);
      } catch (error) {
        log.error("sensor initiative add failed", error);
        return { status: "failed", reason: "failed" };
      }
    }

    const privateMatches = privateContacts(combat.id).filter((contact) => contact.key === key);
    if (privateMatches.length !== 1) return { status: "skipped", reason: "missingObject" };
    return addPrivateContactResult(combat.id, key, privateMatches[0]);
  });
}

export async function addAllNpcShipsToInitiative(combatId, user = game.user) {
  if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  return serialize(`sensor:${combatId}`, async () => {
    const combat = liveCombat(combatId);
    const privateEntries = privateContacts(combat.id);
    const report = emptyReport();
    const keys = getTsc(combat)
      .objects.filter((object) => !object.tscPrivateProjection)
      .map((object) => object.key);
    for (const key of keys) {
      const current = liveCombat(combatId);
      const object = getTsc(current).objects.find((entry) => entry.key === key);
      if (!object) {
        record(report, skipped(String(key), "missingObject"));
        continue;
      }
      try {
        const result = await addSensorObjectToInitiativeLocked(combatId, key);
        record(report, result);
      } catch (error) {
        report.failed.push({ name: objectName(object), reason: "failed", message: error.message });
      }
    }
    for (const contact of privateEntries) {
      try {
        record(report, await addPrivateContactLocked(combatId, contact));
      } catch (error) {
        report.failed.push({ name: objectName(contact), reason: "failed", message: error.message });
      }
    }
    let reportCreated = true;
    try {
      await createWhisper(report);
    } catch (error) {
      reportCreated = false;
      log.error("initiative report whisper failed", error);
    }
    return { ...reportCounts(report), reportCreated };
  });
}

async function addSensorObjectToInitiativeLocked(combatId, key) {
  const matches = getTsc(liveCombat(combatId)).objects.filter((object) => object.key === key);
  if (matches.length !== 1) return skipped(String(key ?? ""), "missingObject");
  const object = matches[0];
  const name = objectName(object);
  if (object.tscPrivateProjection) return skipped(name, "privateContact");
  if (object.type !== "starship") return skipped(name, object.actorUuid ? "notNpcShip" : "markerOnly");
  if (!object.actorUuid) return skipped(name, "markerOnly");
  const hidden = hiddenOnTracker(object);
  return addActorLocked(combatId, {
    actorUuid: object.actorUuid,
    name,
    displayName: trackerName(object, false),
    hidden,
    isPrivate: false,
    validateCurrent: (currentCombat) => {
      const current = getTsc(currentCombat).objects.filter((entry) => entry.key === key);
      return current.length === 1 && current[0].type === "starship" && current[0].actorUuid === object.actorUuid ? current[0] : null;
    }
  });
}

async function addPrivateContactLocked(combatId, contact) {
  if (contact.type !== "starship") return skipped(objectName(contact), "notNpcShip");
  if (!contact.actorUuid) return skipped(objectName(contact), "markerOnly");
  return addActorLocked(combatId, {
    actorUuid: contact.actorUuid,
    name: objectName(contact),
    displayName: SENSOR_CONTACT_COMBATANT_NAME,
    hidden: true,
    isPrivate: true,
    validateCurrent: (currentCombat) => {
      const matches = privateContacts(currentCombat.id).filter((entry) => entry.key === contact.key);
      return matches.length === 1 && matches[0].actorUuid === contact.actorUuid && matches[0].type === "starship" ? matches[0] : null;
    }
  });
}
