/**
 * Общий путь добавления объектов на Sensor Map для GM (dev.13). Развивает приватную карту dev.10–dev.12 и
 * не вводит ни второй карты, ни отдельной механики контактов:
 *
 * - опасность или звездолёт из мира → закрытый журнал приватных контактов (addPrivateContact);
 * - опасность или звездолёт из компендия → приватная копия в мире (владение NONE для игроков), затем тот же путь, чтобы каждая
 *   установка имела собственный документ и состояние; копия удаляется, если размещение не удалось;
 * - пользовательский контакт без Actor → addPrivateCustom;
 * - начальное состояние: undetected/hidden остаются только в закрытом журнале; observed публикует анонимный
 *   маркер, identified публикует личность — оба требуют явного подтверждения (confirmed === true).
 *
 * Правила передачи сведений не меняются; этот модуль только оркестрирует существующие операции. Приватность
 * в настоящем Foundry с несколькими клиентами НЕ проверена (см. docs/MANUAL-TEST-0.17.1-dev.13-ru.md).
 */
import { MODULE_ID, DETECTION_LEVELS } from "../constants.mjs";
import { isActiveGM, T, fromUuidSafe } from "../utils/foundry.mjs";
import { serialize } from "../utils/serial.mjs";
import { getTsc, saveTsc } from "../combat/tsc-state.mjs";
import { addPrivateContact, addPrivateCustom, changePrivateContact, privateContacts } from "./private-contacts.mjs";
import { dropActorOnMap } from "./actor-drop.mjs";
import { createActorCopy } from "../combat/copies.mjs";
import { createSensorActorInstance, deleteSensorActorInstance, ensureSensorActorCombatant } from "./actor-instance.mjs";
import { MINE_FLAG } from "./mine-contact.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";

export const CONTACT_SOURCES = Object.freeze(["world", "compendium", "custom"]);
const NONE = 0;

/** Игрок (не GM) имеет доступ LIMITED и выше: приватное размещение такого Actor невозможно. */
export function actorVisibleToPlayers(actor) {
  return (game.users?.contents ?? []).some((u) => !u.isGM && actor.testUserPermission?.(u, "LIMITED"));
}

function isContactActor(actor) {
  return (actor?.type === "hazard" && !actor.flags?.[MODULE_ID]?.[MINE_FLAG]) || isStarship(actor);
}

function contactChoice(actor, extra = {}) {
  const starship = isStarship(actor);
  return {
    uuid: actor.uuid,
    name: actor.name,
    visible: actorVisibleToPlayers(actor),
    kind: starship ? "starship" : "hazard",
    ...(starship ? { role: readStarship(actor).role } : {}),
    ...extra
  };
}

/** Hazards and Starship Actors from the world; drone mines use their own contact lifecycle. */
export function worldHazardChoices() {
  return (game.actors?.contents ?? [])
    .filter((a) => isContactActor(a) && !a.pack && !a.isToken)
    .map((a) => contactChoice(a))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Hazards and Starship Actors from accessible Actor compendiums. */
export async function compendiumHazardChoices() {
  const out = [];
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Actor") continue;
    try {
      const index = await pack.getIndex({
        fields: ["type", `flags.${MODULE_ID}.starship.isStarship`, `flags.${MODULE_ID}.starship.role`]
      });
      for (const e of index)
        if (e.type === "hazard" || e.flags?.[MODULE_ID]?.starship?.isStarship) {
          out.push({
            uuid: e.uuid ?? `Compendium.${pack.collection}.Actor.${e._id}`,
            name: e.name,
            kind: e.flags?.[MODULE_ID]?.starship?.isStarship ? "starship" : "hazard",
            ...(e.flags?.[MODULE_ID]?.starship?.isStarship ? { role: e.flags[MODULE_ID].starship.role } : {}),
            pack: pack.metadata?.label ?? pack.collection
          });
        }
    } catch {
      /* An unavailable compendium does not prevent browsing the others. */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Creates an independent world copy of a hazard or Starship Actor from a compendium. */
export async function importHazardCopy(sourceUuid, deps = {}) {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.privateMap.activeGM"));
  const source = await (deps.resolve ?? fromUuidSafe)(sourceUuid);
  if (!source || source.documentName !== "Actor" || !isContactActor(source) || !source.pack)
    throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
  const actor = await createActorCopy(
    source,
    {
      folder: false,
      removeSort: true,
      ownership: { default: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? NONE },
      flags: { contactImport: { sourceUuid } }
    },
    deps
  );
  if (!actor?.uuid) throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
  return actor;
}

function validateSpec(combat, spec) {
  if (!CONTACT_SOURCES.includes(spec?.source)) throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
  if (!DETECTION_LEVELS.includes(spec.detection)) throw new Error(T("SF2eTSC.contactEditor.invalidDetection"));
  if (!Number.isInteger(spec.zone) || spec.zone < 1 || spec.zone > getTsc(combat).zones) throw new Error(T("SF2eTSC.mapDrop.invalidZone"));
  // Публикация информации — всегда явное решение ведущего.
  if ((spec.detection === "observed" || spec.detection === "identified") && spec.confirmed !== true)
    throw new Error(T("SF2eTSC.privateMap.disclosureRequired"));
}

async function applyDetection(combat, key, detection) {
  if (detection === "undetected") return;
  if (detection === "identified") await changePrivateContact(combat, key, "reveal");
  else await changePrivateContact(combat, key, "detect", detection);
}

async function publishActorContact(combat, actor, zone) {
  return serialize(`sensor:${combat.id}`, async () => {
    const previous = getTsc(combat);
    const change = dropActorOnMap(previous, actor, zone, { publicActor: true });
    await saveTsc(combat, change.state);
    try {
      await ensureSensorActorCombatant(combat, actor);
    } catch (error) {
      await saveTsc(combat, previous);
      throw error;
    }
    return change.result;
  });
}

/**
 * Добавляет контакт. spec: { source, uuid?, name?, zone, detection, confirmed }.
 * Возвращает { key?, actorUuid?, result }.
 */
export async function addSensorContact(combat, spec, deps = {}) {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.privateMap.activeGM"));
  validateSpec(combat, spec);
  if (spec.source === "custom") {
    const key = await addPrivateCustom(combat, spec.name, spec.zone);
    await applyDetection(combat, key, spec.detection);
    return { key, actorUuid: null, result: "added" };
  }
  const source = await (deps.resolve ?? fromUuidSafe)(spec.uuid);
  if (
    !source ||
    source.documentName !== "Actor" ||
    source.uuid !== spec.uuid ||
    !isContactActor(source) ||
    (spec.source === "compendium" ? !source.pack : source.pack || source.isToken)
  )
    throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
  const visible = actorVisibleToPlayers(source);
  if (isStarship(source) && readStarship(source).role === "player" && !visible) throw new Error(T("SF2eTSC.privateMap.actorExposed"));
  if (visible && (spec.detection !== "identified" || spec.confirmed !== true)) throw new Error(T("SF2eTSC.privateMap.actorExposed"));
  const actor = await createSensorActorInstance(source, combat, {
    privateContact: !visible,
    createActor: deps.createActor
  });
  try {
    // Actor доступный игрокам нельзя скрыть: допустимо только открытое размещение с подтверждением.
    if (visible) {
      const result = await publishActorContact(combat, actor, spec.zone);
      return { key: actor.uuid, actorUuid: actor.uuid, result };
    }
    const result = await addPrivateContact(combat, actor, spec.zone);
    const contact = privateContacts(combat.id).find((o) => o.actorUuid === actor.uuid);
    if (contact) await applyDetection(combat, contact.key, spec.detection);
    return { key: contact?.key ?? actor.uuid, actorUuid: actor.uuid, result };
  } catch (err) {
    const referenced =
      privateContacts(combat.id).some((o) => o.actorUuid === actor.uuid) ||
      getTsc(combat).objects.some((o) => o.actorUuid === actor.uuid || o.key === actor.uuid);
    if (!referenced) await deleteSensorActorInstance(combat, actor.uuid);
    throw err;
  }
}

/** Абсолютное перемещение приватного контакта в выбранную зону (в дополнение к ◀ ▶ и перетаскиванию). */
export async function setPrivateContactZone(combat, key, zone) {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.privateMap.activeGM"));
  if (!Number.isInteger(zone)) throw new Error(T("SF2eTSC.mapDrop.invalidZone"));
  return changePrivateContact(combat, key, "move", zone);
}
