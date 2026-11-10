/**
 * Общий путь добавления объектов на Sensor Map для GM (dev.12). Развивает приватную карту dev.10–dev.11 и
 * не вводит ни второй карты, ни отдельной механики контактов:
 *
 * - опасность мира → закрытый журнал приватных контактов (addPrivateContact);
 * - опасность компендия → приватная копия в мире (владение NONE для игроков), затем тот же путь, чтобы каждая
 *   установка имела собственный документ и состояние; копия удаляется, если размещение не удалось;
 * - пользовательский контакт без Actor → addPrivateCustom;
 * - начальное состояние: undetected/hidden остаются только в закрытом журнале; observed публикует анонимный
 *   маркер, identified публикует личность — оба требуют явного подтверждения (confirmed === true).
 *
 * Правила передачи сведений не меняются; этот модуль только оркестрирует существующие операции. Приватность
 * в настоящем Foundry с несколькими клиентами НЕ проверена (см. MANUAL-TEST-0.17.1-dev.12-ru.md).
 */
import { MODULE_ID, DETECTION_LEVELS } from "../constants.mjs";
import { isActiveGM, T, fromUuidSafe } from "../utils/foundry.mjs";
import { serialize } from "../utils/serial.mjs";
import { getTsc, saveTsc } from "../combat/tsc-state.mjs";
import { addPrivateContact, addPrivateCustom, changePrivateContact, privateContacts } from "./private-contacts.mjs";
import { dropActorOnMap } from "./actor-drop.mjs";
import { MINE_FLAG } from "./mine-contact.mjs";

export const CONTACT_SOURCES = Object.freeze(["world", "compendium", "custom"]);
const NONE = 0;

/** Игрок (не GM) имеет доступ LIMITED и выше: приватное размещение такого Actor невозможно. */
export function actorVisibleToPlayers(actor) {
  return (game.users?.contents ?? []).some((u) => !u.isGM && actor.testUserPermission?.(u, "LIMITED"));
}

/** Опасности мира, пригодные как контакты (мины дронов управляются собственным циклом и не предлагаются). */
export function worldHazardChoices() {
  return (game.actors?.contents ?? [])
    .filter((a) => a.type === "hazard" && !a.pack && !a.isToken && !a.flags?.[MODULE_ID]?.[MINE_FLAG])
    .map((a) => ({ uuid: a.uuid, name: a.name, visible: actorVisibleToPlayers(a) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Опасности из доступных GM компендиев Actor. Индекс загружается по требованию. */
export async function compendiumHazardChoices() {
  const out = [];
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Actor") continue;
    try {
      const index = await pack.getIndex({ fields: ["type"] });
      for (const e of index)
        if (e.type === "hazard")
          out.push({
            uuid: e.uuid ?? `Compendium.${pack.collection}.Actor.${e._id}`,
            name: e.name,
            pack: pack.metadata?.label ?? pack.collection
          });
    } catch {
      /* недоступный компендий пропускается, остальные остаются доступными */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Приватная мировая копия опасности из компендия. Возвращает созданный документ. */
export async function importHazardCopy(sourceUuid, deps = {}) {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.privateMap.activeGM"));
  const source = await (deps.resolve ?? fromUuidSafe)(sourceUuid);
  if (!source || source.documentName !== "Actor" || source.type !== "hazard" || !source.pack)
    throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
  const data = source.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  data.ownership = { default: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? NONE };
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), contactImport: { sourceUuid } } };
  const create = deps.createActor ?? ((d) => (globalThis.Actor?.implementation ?? globalThis.Actor).create(d, { keepId: false }));
  const actor = await create(data);
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
  let actor = null;
  let imported = false;
  if (spec.source === "compendium") {
    actor = await importHazardCopy(spec.uuid, deps);
    imported = true;
  } else {
    actor = await (deps.resolve ?? fromUuidSafe)(spec.uuid);
    if (!actor || actor.documentName !== "Actor" || actor.uuid !== spec.uuid || actor.type !== "hazard" || actor.pack || actor.isToken)
      throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
    if (actor.flags?.[MODULE_ID]?.[MINE_FLAG]) throw new Error(T("SF2eTSC.mineContact.managed"));
  }
  try {
    // Actor, уже доступный игрокам, нельзя скрыть: допустимо только открытое размещение с подтверждением.
    if (actorVisibleToPlayers(actor)) {
      if (spec.detection !== "identified" || spec.confirmed !== true) throw new Error(T("SF2eTSC.privateMap.actorExposed"));
      const result = await serialize(`sensor:${combat.id}`, async () => {
        let outcome;
        await saveTsc(
          combat,
          (() => {
            const change = dropActorOnMap(getTsc(combat), actor, spec.zone, { publicActor: true });
            outcome = change.result;
            return change.state;
          })()
        );
        return outcome;
      });
      return { key: actor.uuid, actorUuid: actor.uuid, result };
    }
    const result = await addPrivateContact(combat, actor, spec.zone);
    const contact = privateContacts(combat.id).find((o) => o.actorUuid === actor.uuid);
    if (contact) await applyDetection(combat, contact.key, spec.detection);
    return { key: contact?.key ?? actor.uuid, actorUuid: actor.uuid, result };
  } catch (err) {
    // Только что созданная копия, которая ни на что не ссылается, не остаётся сиротой.
    if (imported && !privateContacts(combat.id).some((o) => o.actorUuid === actor.uuid)) await actor.delete?.().catch(() => {});
    throw err;
  }
}

/** Абсолютное перемещение приватного контакта в выбранную зону (в дополнение к ◀ ▶ и перетаскиванию). */
export async function setPrivateContactZone(combat, key, zone) {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.privateMap.activeGM"));
  if (!Number.isInteger(zone)) throw new Error(T("SF2eTSC.mapDrop.invalidZone"));
  return changePrivateContact(combat, key, "move", zone);
}
