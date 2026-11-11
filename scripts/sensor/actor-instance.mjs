import { MODULE_ID } from "../constants.mjs";
import { createActorCopy, copyName } from "../combat/copies.mjs";
import { hazardNeedsCombatant } from "../engine/hazard-rules.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { fromUuidSafe, isActiveGM } from "../utils/foundry.mjs";

const NONE = 0;
const instanceFlag = (actor) => actor?.flags?.[MODULE_ID]?.sensorContactInstance;
export const SENSOR_CONTACT_COMBATANT_NAME = "Contact";
export const SENSOR_CONTACT_COMBATANT_IMAGE = "icons/svg/mystery-man.svg";

/** Create a persistent Actor document for one placement, retaining its template UUID. */
export async function createSensorActorInstance(source, combat, { privateContact = false, createActor } = {}) {
  const sourceUuid = source?.uuid;
  if (!source || source.documentName !== "Actor" || !sourceUuid) throw new Error("invalidActor");
  const number = 1 + (game.actors?.contents ?? []).filter((actor) => instanceFlag(actor)?.sourceUuid === sourceUuid).length;
  return createActorCopy(
    source,
    {
      name: copyName(source.name, number),
      ownership: privateContact ? { default: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? NONE } : undefined,
      flags: {
        ...(source.pack ? { contactImport: { sourceUuid } } : {}),
        sensorContactInstance: { combatId: combat.id, sourceUuid, privateContact }
      }
    },
    { createActor }
  );
}

/** Add an initiative entry only when this Actor type normally takes its own turn. */
export async function ensureSensorActorCombatant(combat, actor, { combatantId } = {}) {
  const instance = instanceFlag(actor);
  if (!instance || instance.privateContact || instance.combatId !== combat?.id) return null;
  const needsTurn =
    (isStarship(actor) && readStarship(actor).role === "npc") || (actor.type === "hazard" && hazardNeedsCombatant(actor.system?.details));
  if (!needsTurn) return null;
  const combatants = combat?.combatants?.contents ?? [...(combat?.combatants ?? [])];
  const matches = combatants.filter((entry) => entry.actorId === actor.id || entry.actor?.uuid === actor.uuid);
  if (matches.length > 1) throw new Error("duplicateSensorActorCombatants");
  const [existing] = matches;
  if (existing) {
    if (combatantId && existing.id !== combatantId) throw new Error("conflictingSensorActorCombatant");
    return existing; // Never duplicate or overwrite a manual Actor entry.
  }
  if (combatantId && combatants.some((entry) => entry.id === combatantId)) throw new Error("conflictingSensorCombatantId");
  if (!isActiveGM()) throw new Error("Sensor Combatant creation requires the active GM");
  const [combatant] = await combat.createEmbeddedDocuments(
    "Combatant",
    [
      {
        ...(combatantId ? { _id: combatantId } : {}),
        actorId: actor.id,
        sceneId: combat.scene?.id ?? null,
        tokenId: null,
        name: actor.name,
        img: actor.img,
        hidden: false,
        flags: { [MODULE_ID]: { sensorContactInstance: { combatId: combat.id, actorUuid: actor.uuid } } }
      }
    ],
    combatantId ? { keepId: true } : {}
  );
  if (!combatant) throw new Error("couldNotCreateSensorCombatant");
  return combatant;
}

/** Find the exact anonymous initiative entry that is safe to disclose with a private contact. */
export function privateSensorActorCombatant(combat, actor) {
  const instance = instanceFlag(actor);
  if (!instance?.privateContact || instance.combatId !== combat?.id) return null;
  const combatants = combat?.combatants?.contents ?? [...(combat?.combatants ?? [])];
  const matches = combatants.filter((combatant) => {
    const ref = combatant.flags?.[MODULE_ID]?.sensorMapInitiative;
    return (
      combatant.actorId === actor.id &&
      combatant.combat?.id === combat.id &&
      ref?.contactDesignation === true &&
      (ref.combatId === combat.id || !Object.hasOwn(ref, "combatId"))
    );
  });
  if (matches.length !== 1) return null;
  const [combatant] = matches;
  return combatant.hidden === true && combatant.name === SENSOR_CONTACT_COMBATANT_NAME && combatant.img === SENSOR_CONTACT_COMBATANT_IMAGE
    ? combatant
    : null;
}

export async function backfillPrivateSensorActorCombatant(combat, actor, combatant) {
  if (privateSensorActorCombatant(combat, actor) !== combatant) throw new Error("invalidPrivateSensorCombatant");
  if (!isActiveGM()) throw new Error("Private Combatant update requires the active GM");
  await combatant.update({
    hidden: true,
    name: SENSOR_CONTACT_COMBATANT_NAME,
    img: SENSOR_CONTACT_COMBATANT_IMAGE,
    [`flags.${MODULE_ID}.sensorMapInitiative.combatId`]: combat.id
  });
}

export async function revealSensorActorCombatant(combat, actor, combatant) {
  if (privateSensorActorCombatant(combat, actor) !== combatant) throw new Error("invalidPrivateSensorCombatant");
  if (!isActiveGM()) throw new Error("Private Combatant update requires the active GM");
  await combatant.update({
    hidden: false,
    name: actor.name,
    img: actor.img,
    [`flags.${MODULE_ID}.sensorMapInitiative.combatId`]: combat.id,
    [`flags.${MODULE_ID}.sensorMapInitiative.contactDesignation`]: false
  });
}

export async function restorePrivateSensorActorCombatant(combat, actor, combatant) {
  const ref = combatant?.flags?.[MODULE_ID]?.sensorMapInitiative;
  const instance = instanceFlag(actor);
  const legacyEntry =
    !Object.hasOwn(ref ?? {}, "combatId") &&
    instance?.combatId === combat?.id &&
    instance.privateContact === true &&
    combatant?.combat?.id === combat?.id &&
    ref?.contactDesignation === true &&
    combatant.hidden === true &&
    combatant.name === SENSOR_CONTACT_COMBATANT_NAME &&
    combatant.img === SENSOR_CONTACT_COMBATANT_IMAGE;
  if (combatant?.actorId !== actor?.id || (ref?.combatId !== combat?.id && !legacyEntry)) throw new Error("invalidPrivateSensorCombatant");
  await combatant.update({
    hidden: true,
    name: SENSOR_CONTACT_COMBATANT_NAME,
    img: SENSOR_CONTACT_COMBATANT_IMAGE,
    [`flags.${MODULE_ID}.sensorMapInitiative.combatId`]: combat.id,
    [`flags.${MODULE_ID}.sensorMapInitiative.contactDesignation`]: true
  });
}

/** Remove only the initiative entry owned by this Sensor Map instance. */
export async function deleteSensorActorCombatant(combat, actorUuid) {
  const combatants = [...(combat?.combatants ?? [])].filter((combatant) => {
    const instanceRef = combatant.flags?.[MODULE_ID]?.sensorContactInstance;
    const initiativeRef = combatant.flags?.[MODULE_ID]?.sensorMapInitiative;
    return (
      (instanceRef?.combatId === combat?.id && instanceRef.actorUuid === actorUuid) ||
      (initiativeRef?.combatId === combat?.id && combatant.actor?.uuid === actorUuid)
    );
  });
  if (combatants.length)
    await combat.deleteEmbeddedDocuments(
      "Combatant",
      combatants.map((combatant) => combatant.id)
    );
}

/** Remove only the combatant and Actor document owned by this Sensor Map instance. */
export async function deleteSensorActorInstance(combat, actorUuid) {
  const actor = await fromUuidSafe(actorUuid);
  const instance = instanceFlag(actor);
  await deleteSensorActorCombatant(combat, actorUuid);
  if (instance?.combatId === combat?.id) await actor.delete();
}

export function isSensorActorInstance(actor, combatId) {
  return instanceFlag(actor)?.combatId === combatId;
}
