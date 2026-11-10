/**
 * Проекция развёрнутой звёздной мины на Sensor Map (dev.12).
 *
 * Источник истины — запись мины в дроне корабля (drone.mines[]). Hazard Actor и контакт на карте — её проекция:
 * `syncMineContact` идемпотентна, ищет уже созданные документы по флагам и может быть безопасно повторена
 * после сбоя. Проекция не делает запись в Actor корабля, не запускает автоматизацию опасностей и не взрывает мину.
 *
 * Приватность: это мина самой партии (её развернул дрон корабля игроков), поэтому её Actor доступен игрокам
 * на уровне OBSERVER, а контакт публичен (identified). Скрытые объекты противника создаются другим путём
 * (scripts/sensor/private-contacts.mjs) и этим модулем не затрагиваются.
 */
import { MODULE_ID } from "../constants.mjs";
import { isActiveGM, T, fromUuidSafe, escapeHtml } from "../utils/foundry.mjs";
import { serialize } from "../utils/serial.mjs";
import { getTsc, saveTsc } from "../combat/tsc-state.mjs";
import { addObject, updateObject, removeObject } from "../engine/sensor-ops.mjs";
import { readStarship } from "../starship/starship-state.mjs";

export const MINE_FLAG = "starshipMine";
const FOLDER_FLAG = "mineFolder";
const OBSERVER = 2;

export const isMineObject = (o) => !!o?.mineRef;
export const mineRefOf = (shipUuid, droneId, mineId) => ({ shipUuid, droneId, mineId });
export const sameMineRef = (a, b) => !!a && !!b && a.shipUuid === b.shipUuid && a.droneId === b.droneId && a.mineId === b.mineId;

/** Найти единственную запись мины в данных корабля. */
export function findMineRecord(data, droneId, mineId) {
  const drones = (Array.isArray(data?.drones) ? data.drones : []).filter((d) => d?.id === droneId);
  if (drones.length !== 1 || !Array.isArray(drones[0].mines)) throw new Error("mine");
  const matches = drones[0].mines.filter((m) => m?.id === mineId);
  if (matches.length !== 1) throw new Error("mine");
  return { drone: drones[0], mine: matches[0] };
}

export function mineDisplayName(mine) {
  return T("SF2eTSC.mineContact.name", { label: mine.label || mine.id });
}

/** Данные Hazard Actor. Характеристики мины не общие: каждый экземпляр — отдельный документ. */
export function buildMineActorData({ mine, shipName, shipUuid, droneId, folderId = null }) {
  const esc = escapeHtml;
  const mods = (mine.installed?.mods ?? []).map((m) => `<li>${esc(m.label)}</li>`).join("");
  const description =
    `<p>${esc(T("SF2eTSC.mineContact.description", { ship: shipName }))}</p>` +
    `<p>${esc(T("SF2eTSC.mineContact.rule"))}</p>` +
    (mods
      ? `<p><strong>${esc(T("SF2eTSC.mineContact.installed"))}</strong></p><ul>${mods}</ul><p>${esc(T("SF2eTSC.mineContact.manual"))}</p>`
      : "");
  const data = {
    name: mineDisplayName(mine),
    type: "hazard",
    img: `modules/${MODULE_ID}/assets/icons/hazard.svg`,
    system: {
      details: { isComplex: false, description },
      traits: { value: ["mechanical", "starship", "tech", "trap"], rarity: "common" }
    },
    ownership: { default: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? OBSERVER },
    flags: {
      [MODULE_ID]: {
        [MINE_FLAG]: {
          schema: 1,
          shipUuid,
          droneId,
          mineId: mine.id,
          combatId: mine.combatId ?? null,
          operatorUuid: mine.operatorUuid ?? null,
          state: mine.state
        }
      }
    }
  };
  if (folderId) data.folder = folderId;
  return data;
}

export function findMineActors(shipUuid, droneId, mineId) {
  return (game.actors?.contents ?? []).filter((a) => {
    const f = a.flags?.[MODULE_ID]?.[MINE_FLAG];
    return f?.shipUuid === shipUuid && f.droneId === droneId && f.mineId === mineId;
  });
}

async function ensureFolder(deps) {
  try {
    const existing = (game.folders?.contents ?? []).find((f) => f.type === "Actor" && f.flags?.[MODULE_ID]?.[FOLDER_FLAG] === true);
    if (existing) return existing.id;
    const create = deps.createFolder ?? ((d) => globalThis.Folder?.create?.(d));
    const folder = await create({ name: T("SF2eTSC.mineContact.folder"), type: "Actor", flags: { [MODULE_ID]: { [FOLDER_FLAG]: true } } });
    return folder?.id ?? null;
  } catch {
    return null; // папка только организационная; без неё мина всё равно создаётся
  }
}

/** Создаёт (при необходимости) Hazard Actor и контакт мины либо снимает их с карты по состоянию мины. */
export async function syncMineContact({ shipUuid, droneId, mineId }, deps = {}) {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.privateMap.activeGM"));
  return serialize(`mine-contact:${shipUuid}:${mineId}`, async () => {
    const ship = await (deps.resolve ?? fromUuidSafe)(shipUuid);
    if (!ship) throw new Error(T("SF2eTSC.mineContact.invalid"));
    const { mine } = findMineRecord(readStarship(ship), droneId, mineId);
    const combat = game.combats?.get(mine.combatId);
    if (!combat) return { action: "skipped", reason: "combat" };
    const actors = findMineActors(shipUuid, droneId, mineId);
    if (actors.length > 1) throw new Error(T("SF2eTSC.mineContact.duplicate"));
    let actor = actors[0] ?? null;
    if (mine.state !== "armed") return finishMine(combat, actor, mine, shipUuid, droneId);
    let created = false;
    if (!actor) {
      const folderId = await ensureFolder(deps);
      const create = deps.createActor ?? ((d) => (globalThis.Actor?.implementation ?? globalThis.Actor).create(d));
      actor = await create(buildMineActorData({ mine, shipName: ship.name, shipUuid, droneId, folderId }));
      if (!actor?.uuid) throw new Error(T("SF2eTSC.mineContact.invalid"));
      created = true;
    }
    try {
      const action = await serialize(`sensor:${combat.id}`, async () => {
        const state = getTsc(combat);
        const matches = state.objects.filter((o) => o.key === actor.uuid);
        if (matches.length > 1) throw new Error(T("SF2eTSC.mineContact.duplicate"));
        const ref = mineRefOf(shipUuid, droneId, mine.id);
        const found = matches[0];
        if (found) {
          if (!sameMineRef(found.mineRef, ref)) throw new Error(T("SF2eTSC.mineContact.duplicate"));
          if (found.zone === mine.zone && found.name === actor.name) return "unchanged";
          await saveTsc(combat, updateObject(state, found.key, { zone: mine.zone, name: actor.name }));
          return "updated";
        }
        const next = addObject(state, {
          key: actor.uuid,
          actorUuid: actor.uuid,
          type: "hazard",
          name: actor.name,
          zone: mine.zone,
          span: 1,
          heading: null,
          icon: "✹",
          detection: { party: "identified" },
          mineRef: ref
        });
        await saveTsc(combat, next);
        return "added";
      });
      return { action, actorUuid: actor.uuid, created };
    } catch (err) {
      // Только что созданный и ни на что не ссылающийся Actor не оставляем сиротой; прежний повторно используется.
      if (created) await actor.delete?.().catch(() => {});
      throw err;
    }
  });
}

async function finishMine(combat, actor, mine, shipUuid, droneId) {
  let removed = false;
  await serialize(`sensor:${combat.id}`, async () => {
    const state = getTsc(combat);
    const ref = mineRefOf(shipUuid, droneId, mine.id);
    const targets = state.objects.filter((o) => sameMineRef(o.mineRef, ref));
    if (!targets.length) return;
    let next = state;
    for (const o of targets) next = removeObject(next, o.key);
    await saveTsc(combat, next);
    removed = true;
  });
  let marked = false;
  if (actor && actor.flags?.[MODULE_ID]?.[MINE_FLAG]?.state !== mine.state) {
    const label = T(`SF2eTSC.mineContact.${mine.state === "detonated" ? "detonated" : "removed"}`);
    await actor.update({
      name: `${mineDisplayName(mine)} — ${label}`,
      [`flags.${MODULE_ID}.${MINE_FLAG}.state`]: mine.state
    });
    marked = true;
  }
  return { action: removed ? "removed" : marked ? "marked" : "unchanged", actorUuid: actor?.uuid ?? null };
}

/** Безопасная обёртка для действий: перенос мины уже сохранён, сбой проекции не откатывает его. */
export async function syncMineContactSafe(ref, deps) {
  try {
    return await syncMineContact(ref, deps);
  } catch (err) {
    globalThis.ui?.notifications?.warn?.(T("SF2eTSC.mineContact.syncFailed", { message: err.message }));
    return { action: "failed", error: err.message };
  }
}

/** Контакт мины находится на карте в пределах числа зон (после уменьшения карты положение проверяет GM). */
export function mineObjectFor(state, ref) {
  return state.objects.find((o) => sameMineRef(o.mineRef, ref)) ?? null;
}
