import { MODULE_ID } from "../constants.mjs";
import { isStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { privateContacts } from "./private-contacts.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { isActiveGM, T, fromUuidSafe } from "../utils/foundry.mjs";
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

async function addObjectLocked(combatId, key) {
  let combat = liveCombat(combatId);
  let state = getTsc(combat);
  const matches = state.objects.filter((object) => object.key === key);
  if (matches.length !== 1) return skipped(String(key ?? ""), "missingObject");
  let object = matches[0];
  const name = objectName(object);
  if (object.privateContact || object.tscPrivateProjection || !["observed", "identified"].includes(object.detection?.party))
    return skipped(name, "privateContact");
  if (object.hidden) return skipped(name, "hiddenContact");
  if (object.type !== "starship") return skipped(name, object.actorUuid ? "notNpcShip" : "markerOnly");
  const actorUuid = object.actorUuid;
  if (typeof actorUuid !== "string" || !actorUuid) return skipped(name, "markerOnly");

  const actor = await fromUuidSafe(actorUuid);
  if (!actor || actor.uuid !== actorUuid || actor.documentName !== "Actor")
    return { status: "failed", item: { name, reason: "actorMissing" } };
  if (!isStarship(actor)) return skipped(name, "notNpcShip");
  if (readStarship(actor).role !== "npc") return skipped(name, "playerShip");
  if (sensorInstance(actor)?.privateContact) return skipped(name, "privateContact");

  const existing = combatantForActor(combat, actor);
  if (existing) return { status: "existing", item: { name: actor.name } };

  if (actor.pack || actor.isToken || !independentForCombat(actor, combat.id)) return skipped(name, "noIndependentActor");

  // Resolve the live Combat and current public map entry again immediately before the write.
  combat = liveCombat(combatId);
  state = getTsc(combat);
  const current = state.objects.filter((entry) => entry.key === key);
  if (
    current.length !== 1 ||
    current[0].type !== "starship" ||
    current[0].actorUuid !== object.actorUuid ||
    current[0].privateContact ||
    current[0].tscPrivateProjection ||
    current[0].hidden ||
    !["observed", "identified"].includes(current[0].detection?.party)
  )
    return skipped(name, "privateContact");
  object = current[0];
  const currentActorUuid = object.actorUuid;
  if (currentActorUuid !== actor.uuid || !independentForCombat(actor, combat.id)) return skipped(name, "noIndependentActor");
  if (!isStarship(actor) || readStarship(actor).role !== "npc") return skipped(name, "notNpcShip");

  const duplicate = combatantForActor(combat, actor);
  if (duplicate) return { status: "existing", item: { name: actor.name } };

  const [created] = await combat.createEmbeddedDocuments("Combatant", [
    {
      actorId: actor.id,
      sceneId: combat.scene?.id ?? null,
      tokenId: null,
      hidden: false,
      flags: { [MODULE_ID]: { sensorMapInitiative: { combatId: combat.id, actorUuid: actor.uuid } } }
    }
  ]);
  if (!created) throw new Error("couldNotCreateSensorCombatant");
  return { status: "added", item: { name: actor.name } };
}

function emptyReport() {
  return { added: [], existing: [], skipped: [], failed: [] };
}

function record(report, result) {
  report[result.status].push(result.item);
}

export async function addSensorObjectToInitiative(combatId, key, user = game.user) {
  if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  return serialize(`sensor:${combatId}`, async () => {
    const combat = liveCombat(combatId);
    if (!getTsc(combat).objects.some((object) => object.key === key)) return skipped(String(key ?? ""), "missingObject");
    try {
      return await addObjectLocked(combatId, key);
    } catch (error) {
      return { status: "failed", item: { name: String(key ?? ""), reason: "failed", message: error.message } };
    }
  });
}

export async function addAllNpcShipsToInitiative(combatId, user = game.user) {
  if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  return serialize(`sensor:${combatId}`, async () => {
    const combat = liveCombat(combatId);
    const privateEntries = privateContacts(combat.id);
    const report = emptyReport();
    const privateKeys = new Set(privateEntries.map((contact) => contact.key));
    const keys = getTsc(combat)
      .objects.filter((object) => !object.tscPrivateProjection || !privateKeys.has(object.key))
      .map((object) => object.key);
    for (const key of keys) {
      const current = liveCombat(combatId);
      const object = getTsc(current).objects.find((entry) => entry.key === key);
      if (!object) {
        record(report, skipped(String(key), "missingObject"));
        continue;
      }
      try {
        record(report, await addObjectLocked(combatId, key));
      } catch (error) {
        report.failed.push({ name: objectName(object), reason: "failed", message: error.message });
      }
    }
    for (const contact of privateEntries) {
      report.skipped.push({ name: objectName(contact), reason: "privateContact" });
    }
    return report;
  });
}
