import { MODULE_ID } from "../constants.mjs";
import { createActorCopy, copyName } from "../combat/copies.mjs";
import { hazardNeedsCombatant } from "../engine/hazard-rules.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { fromUuidSafe } from "../utils/foundry.mjs";

const NONE = 0;
const instanceFlag = (actor) => actor?.flags?.[MODULE_ID]?.sensorContactInstance;

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
export async function ensureSensorActorCombatant(combat, actor) {
  const instance = instanceFlag(actor);
  if (!instance || instance.privateContact || instance.combatId !== combat?.id) return null;
  const needsTurn =
    (isStarship(actor) && readStarship(actor).role === "npc") || (actor.type === "hazard" && hazardNeedsCombatant(actor.system?.details));
  if (!needsTurn) return null;
  const existing = combat.combatants?.find(
    (combatant) => combatant.actorId === actor.id && combatant.flags?.[MODULE_ID]?.sensorContactInstance?.combatId === combat.id
  );
  if (existing) return existing;
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [
    {
      actorId: actor.id,
      sceneId: combat.scene?.id ?? null,
      tokenId: null,
      hidden: false,
      flags: { [MODULE_ID]: { sensorContactInstance: { combatId: combat.id, actorUuid: actor.uuid } } }
    }
  ]);
  if (!combatant) throw new Error("couldNotCreateSensorCombatant");
  return combatant;
}

/** Remove only the initiative entry owned by this Sensor Map instance. */
export async function deleteSensorActorCombatant(combat, actorUuid) {
  const combatants = [...(combat?.combatants ?? [])].filter((combatant) => {
    const ref = combatant.flags?.[MODULE_ID]?.sensorContactInstance;
    return ref?.combatId === combat?.id && ref.actorUuid === actorUuid;
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
