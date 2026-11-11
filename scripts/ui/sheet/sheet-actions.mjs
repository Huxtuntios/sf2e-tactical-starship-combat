import * as mineStockActions from "./mine-stock-actions.mjs";
import { mineResolutionPlan } from "../../actions/mine-resolution.mjs";
import { activeStarshipCombat } from "../../combat/tsc-state.mjs";
import { mappedMineTargets, targetSnapshots } from "../../actions/mine-targets.mjs";
import { guidedMineResolution } from "./mine-guided.mjs";
import { prepareHarrySensors as runHarrySensors } from "./harry-assist.mjs";
import { computeShipStats } from "../../starship/stats.mjs";
import { fromUuidSafe } from "../../utils/foundry.mjs";
import { beginNativeWeaponAttack } from "../native-attack.mjs";
import { saveUiState } from "../client-ui.mjs";
/** Starship sheet: click actions (called with `this` = the sheet). */
import { STATION_TYPES, MODULE_ID, FLAGS } from "../../constants.mjs";
import { Content } from "../../content/loader.mjs";
import { readStarship } from "../../starship/starship-state.mjs";
import { stationGradeForLevel } from "../../engine/advancement.mjs";
import { Crew } from "../../crew/crew-service.mjs";
import { Ship } from "../../starship/ship-service.mjs";
import { runAction } from "../action-runner.mjs";
import { Importer } from "../../content/importer.mjs";
import { request } from "../../socket.mjs";
import { T } from "../../utils/foundry.mjs";
import { notifyError, notifyWarn, notifyInfo } from "../../utils/logging.mjs";
import { openHolodock } from "../../integrations/holodock.mjs";
import { slugify, randomId } from "../../utils/ids.mjs";
import { STATION_NAME } from "../../content/ship-docs.mjs";
import { SensorMapApplication } from "../sensor-map-app.mjs";
import { pickActorImage } from "../image-edit.mjs";
import { ct } from "../../content/content-i18n.mjs";
import { stationTypeLabel } from "../../utils/labels.mjs";
import { weaponEntry } from "../../content/weapon-docs.mjs";
import { buildNpcAction } from "../../actions/npc-inline.mjs";
import { sheetAttackRows, sheetAttackRequest, rollShipCheck, rollSheetDamage, postPilotingSave } from "../../rolls/ship-rolls.mjs";
import { sheetPartsFor, escHTML } from "./sheet-model.mjs";
import { upgradeCatalog } from "../../content/loader.mjs";
import { stationUpgradeStatus } from "../../engine/upgrades.mjs";
import { SHIP_TARGET } from "./sheet-upgrades.mjs";
import { modulePackId } from "../../utils/system.mjs";

export function switchTab(e, t) {
  this.tab = t.dataset.tab;
  saveUiState(this);
  this.render({ parts: sheetPartsFor("tab") });
}
export function editImage(e, t) {
  pickActorImage(this.document, t.dataset.target ?? "img");
}
export async function addListItem(e, t) {
  const list = t.dataset.list;
  const item =
    list === "strikes"
      ? {
          name: T("SF2eTSC.edit.newStrike"),
          kind: "ranged",
          attack: this.document.system?.details?.level?.value + 7 || 7,
          damage: "2d6 piercing",
          traits: ["range increment 4 zones", "tech"]
        }
      : list === "npcActions"
        ? { name: T("SF2eTSC.edit.newAbility"), cost: "one-action", traits: [], text: "" }
        : list === "expansionBays"
          ? { id: randomId("bay"), name: null }
          : null;
  if (item) await Ship.equipment(this.document.uuid, list, "add", { item });
}
export async function removeListItem(e, t) {
  await Ship.equipment(this.document.uuid, t.dataset.list, "remove", { index: Number(t.dataset.index) });
}
export async function editJson() {
  const raw = foundry.utils.deepClone(readStarship(this.document));
  delete raw._errors;
  delete raw._warnings;
  delete raw.name;
  const json = JSON.stringify(raw, null, 2);
  const r = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.edit.rawJson"), resizable: true },
    position: { width: 720, height: 640 },
    content: `<p class="tsc-dim">${T("SF2eTSC.edit.rawJsonHint")}</p><textarea name="json" style="width:100%;height:480px;font-family:monospace">${foundry.utils.escapeHTML(json)}</textarea>`,
    ok: { label: T("SF2eTSC.ui.save"), callback: (ev, b) => b.form.elements.json.value },
    rejectClose: false
  }).catch(() => null);
  if (!r) return;
  let data;
  try {
    data = JSON.parse(r);
  } catch (err) {
    return notifyError("SF2eTSC.errors.generic", { message: err.message });
  }
  await request("replaceShip", { shipUuid: this.document.uuid, data });
}
export async function claim(e, t) {
  const crewUuid = t.dataset.crewUuid || myCrewActor(this.document)?.uuid;
  if (!crewUuid) return notifyWarn("SF2eTSC.errors.noCrewActor");
  await Crew.claim(this.document.uuid, t.dataset.stationId, crewUuid, false);
}
export async function forceClaim(e, t) {
  const crewUuid = t.dataset.crewUuid || myCrewActor(this.document)?.uuid;
  if (!crewUuid) {
    const crewList = readStarship(this.document).crew;
    const pick = await foundry.applications.api.DialogV2.prompt({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.crew.forceHelm") },
      content: `<div class="form-group"><label>${T("SF2eTSC.crew.character")}</label><select name="c">${crewList.map((c) => `<option value="${c.actorUuid}">${foundry.utils.escapeHTML(c.name)}</option>`).join("")}</select></div>`,
      ok: { callback: (ev, b) => new foundry.applications.ux.FormDataExtended(b.form).object.c },
      rejectClose: false
    }).catch(() => null);
    if (!pick) return;
    return Crew.claim(this.document.uuid, t.dataset.stationId, pick, true);
  }
  await Crew.claim(this.document.uuid, t.dataset.stationId, crewUuid, true);
}
export async function unhelm(e, t) {
  await Crew.release(this.document.uuid, t.dataset.stationId, t.dataset.crewUuid);
}
export async function removeCrew(e, t) {
  await Crew.remove(this.document.uuid, t.dataset.crewUuid);
}
export async function setRole(e, t) {
  await Crew.setRole(this.document.uuid, t.dataset.crewUuid, t.value ?? t.dataset.role);
}
export async function ready(e, t) {
  await Crew.setReady(this.document.uuid, t.dataset.crewUuid, t.dataset.ready !== "true");
}
export function myCrewActor(doc) {
  const d = readStarship(doc);
  const ids = d.crew.map((c) => c.actorUuid);
  const ctrl = canvas.tokens?.controlled
    ?.map((tk) => tk.actor)
    .find((a) => a && (ids.includes(a.uuid) || (a.isOwner && a.type === "character")));
  return (
    ctrl ??
    d.crew.map((c) => fromUuidSync(c.actorUuid)).find((a) => a?.testUserPermission?.(game.user, "OWNER")) ??
    game.user.character ??
    null
  );
}
export async function toggleMalf(e, t) {
  await Ship.setStation(this.document.uuid, t.dataset.stationId, { malfunctioning: t.dataset.value !== "true" });
}
export async function addStation() {
  const types = STATION_TYPES.map((x) => `<option value="${x}">${stationTypeLabel(x)}</option>`).join("");
  const r = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.ui.addStation") },
    content: `<div class="form-group"><label>${T("SF2eTSC.ui.type")}</label><select name="type">${types}</select></div><div class="form-group"><label>${T("SF2eTSC.ui.name")}</label><input name="name" type="text"></div>`,
    ok: { callback: (ev, b) => new foundry.applications.ux.FormDataExtended(b.form).object },
    rejectClose: false
  }).catch(() => null);
  if (!r) return;
  const data = readStarship(this.document);
  await request("addStation", {
    shipUuid: this.document.uuid,
    station: {
      id: randomId(r.type),
      type: r.type,
      name: r.name || STATION_NAME[r.type] || r.type,
      grade: stationGradeForLevel(r.type, data.level),
      helmedBy: null,
      malfunctioning: false,
      location: null,
      upgrades: [],
      actions: []
    }
  });
}
export async function removeStation(e, t) {
  await Ship.removeStation(this.document.uuid, t.dataset.stationId);
}
/** Учёт не расходует действие: его фиксирует оператор или GM. */
export async function addDrone(e, t) {
  const ref = t.closest("article")?.querySelector("select[name=droneType]")?.value;
  if (!ref) return;
  return request("droneState", { shipUuid: this.document.uuid, stationId: t.dataset.stationId, op: "add", ref, id: randomId("drone") });
}
/** Фиксация уже обработанного вручную Drone Block или немедленный Fetch and Fix. */
export async function protocolDroneManual(_e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const data = readStarship(this.document),
    combat = activeStarshipCombat();
  const st = data.stations.filter((s) => s.id === t.dataset.stationId);
  if (st.length !== 1 || !combat?.id || !st[0].helmedBy) throw new Error(T("SF2eTSC.protocolAssist.invalid"));
  const op = t.dataset.op;
  const operator = await fromUuidSafe(st[0].helmedBy);
  const level = operator?.system?.details?.level?.value ?? operator?.level;
  if (!Number.isInteger(level) || level < 1) throw new Error(T("SF2eTSC.protocolAssist.invalid"));
  const answer = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.protocolAssist.title") },
    content: `<p>${escHTML(T(op === "block" ? "SF2eTSC.protocolAssist.blockHint" : "SF2eTSC.protocolAssist.fetchHint", { resistance: Math.floor(level / 2) }))}</p>${op === "block" ? `<p><label>${escHTML(T("SF2eTSC.protocolAssist.strike"))} <input name="strikeRef" maxlength="128" required /></label></p>` : ""}<p><label><input type="checkbox" name="confirmed" /> ${escHTML(T("SF2eTSC.protocolAssist.confirm"))}</label></p>`,
    ok: {
      label: T("SF2eTSC.protocolAssist.save"),
      callback: (_e, b) => ({ confirmed: b.form.elements.confirmed.checked, strikeRef: b.form.elements.strikeRef?.value.trim() ?? "" })
    },
    rejectClose: false
  }).catch(() => null);
  if (!answer?.confirmed) return;
  return request("protocolDroneManual", {
    shipUuid: this.document.uuid,
    stationId: st[0].id,
    droneId: t.dataset.droneId,
    operatorUuid: st[0].helmedBy,
    combatId: combat.id,
    op,
    operationId: randomId("protocol"),
    ...answer
  });
}

/** Ведущий сверяет личные моды механика, их сроки и фактические мины самостоятельно. */
export async function installMinePlan(_e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const stations = readStarship(this.document).stations.filter((s) => s.id === t.dataset.stationId);
  if (stations.length !== 1 || !stations[0].helmedBy) throw new Error(T("SF2eTSC.installMine.invalid"));
  const operator = await fromUuidSafe(stations[0].helmedBy);
  if (!operator) throw new Error(T("SF2eTSC.installMine.invalid"));
  const droneMatches = readStarship(this.document).drones.filter((d) => d.id === t.dataset.droneId);
  if (droneMatches.length !== 1) throw new Error(T("SF2eTSC.installMine.invalid"));
  const prior = droneMatches[0].tscInstallMinePlan;
  const rows = Array.from(
    { length: 4 },
    (_, i) =>
      `<p><label>${escHTML(T("SF2eTSC.installMine.mine"))} ${i + 1} <input name="mine${i}" maxlength="80" value="${escHTML(prior?.entries?.[i]?.mine ?? "")}"></label> <label>${escHTML(T("SF2eTSC.installMine.mod"))} <input name="mod${i}" maxlength="120" value="${escHTML(prior?.entries?.[i]?.mod ?? "")}"></label></p>`
  ).join("");
  const answer = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.installMine.title") },
    content: `<p>${escHTML(T("SF2eTSC.installMine.hint", { operator: operator.name }))}</p>${rows}<p><label><input type="checkbox" name="confirmed"> ${escHTML(T("SF2eTSC.installMine.confirm"))}</label></p>`,
    ok: {
      label: T("SF2eTSC.ui.save"),
      callback: (_e, b) => ({
        confirmed: b.form.elements.confirmed.checked,
        entries: Array.from({ length: 4 }, (_, i) => ({
          mine: b.form.elements[`mine${i}`].value.trim(),
          mod: b.form.elements[`mod${i}`].value.trim()
        })).filter((e) => e.mine || e.mod)
      })
    },
    rejectClose: false
  }).catch(() => null);
  if (!answer?.confirmed) return;
  return request("installMinePlan", {
    ...answer,
    shipUuid: this.document.uuid,
    stationId: stations[0].id,
    droneId: t.dataset.droneId,
    operatorUuid: operator.uuid,
    expectedPlanFingerprint: prior?.fingerprint ?? null,
    operationId: randomId("install")
  });
}

/** GM проверяет компаньона и близость; эффект quickened системой автоматически не создаётся. */
export async function petCabin(_e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const stationId = t.dataset.stationId;
  const station = readStarship(this.document).stations.filter((s) => s.id === stationId);
  if (station.length !== 1) throw new Error(T("SF2eTSC.petCabin.invalid"));
  if (t.dataset.op === "end") {
    const accepted = await foundry.applications.api.DialogV2.confirm({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.petCabin.title") },
      content: `<p>${escHTML(T("SF2eTSC.petCabin.endConfirm"))}</p>`,
      rejectClose: false
    }).catch(() => false);
    if (!accepted) return;
    return request("petCabin", {
      shipUuid: this.document.uuid,
      stationId,
      op: "end",
      sessionId: station[0].tscPetOnboard?.sessionId,
      operationId: randomId("petEnd"),
      operatorUuid: station[0].tscPetOnboard?.operatorUuid
    });
  }
  const candidates = game.actors.filter((a) => !a.pack && a.system?.traits?.size?.value === "tiny" && a.system?.attributes?.hp?.value > 0);
  if (!candidates.length) throw new Error(T("SF2eTSC.petCabin.none"));
  const answer = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.petCabin.title") },
    content: `<p>${escHTML(T("SF2eTSC.petCabin.check"))}</p><select name="pet">${candidates.map((a) => `<option value="${escHTML(a.uuid)}">${escHTML(a.name)}</option>`).join("")}</select><p><label><input type="checkbox" name="confirmed" /> ${escHTML(T("SF2eTSC.petCabin.confirm"))}</label></p>`,
    ok: {
      label: T("SF2eTSC.petCabin.start"),
      callback: (_e, b) => ({ petUuid: b.form.elements.pet.value, confirmed: b.form.elements.confirmed.checked })
    },
    rejectClose: false
  }).catch(() => null);
  if (!answer?.confirmed) return;
  return request("petCabin", {
    shipUuid: this.document.uuid,
    stationId,
    op: "start",
    petUuid: answer.petUuid,
    confirmed: true,
    operatorUuid: station[0].helmedBy,
    operationId: randomId("petStart")
  });
}

/** Only marks a mine after the GM has handled its effects; never rolls or applies damage. */
export async function closeDroneMine(e, t) {
  const detonate = t.dataset.resolution === "detonated";
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    classes: ["sf2e-tsc"],
    window: { title: T(detonate ? "SF2eTSC.droneBlock.mineDetonated" : "SF2eTSC.droneBlock.mineRemove") },
    content: `<p>${escHTML(T(detonate ? "SF2eTSC.droneBlock.mineDetonateConfirm" : "SF2eTSC.droneBlock.mineRemoveConfirm"))}</p>`,
    rejectClose: false
  }).catch(() => false);
  if (confirmed)
    return request("closeDroneMine", {
      shipUuid: this.document.uuid,
      stationId: t.dataset.stationId,
      droneId: t.dataset.droneId,
      mineId: t.dataset.mineId,
      resolution: t.dataset.resolution
    });
}
/** GM-only explicit adjudication of the Mobile Exocortex prerequisite. */
export async function moveDroneMine(e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const result = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.mineAssist.move") },
    content: `<p>${escHTML(T("SF2eTSC.mineAssist.moveHint"))}</p><label>${escHTML(T("SF2eTSC.mineAssist.destination"))} <input type="number" name="destination" min="1" step="1" required /></label><p><label><input type="checkbox" name="confirmed" /> ${escHTML(T("SF2eTSC.mineAssist.confirmFeature"))}</label></p>`,
    ok: {
      label: T("SF2eTSC.mineAssist.move"),
      callback: (_e, b) => ({ destination: Number(b.form.elements.destination.value), confirmed: b.form.elements.confirmed.checked })
    },
    rejectClose: false
  }).catch(() => null);
  if (!result?.confirmed) return;
  return request("moveDroneMine", {
    shipUuid: this.document.uuid,
    stationId: t.dataset.stationId,
    droneId: t.dataset.droneId,
    mineId: t.dataset.mineId,
    destination: result.destination,
    origin: Number(t.dataset.zone),
    moveId: randomId("mineMove"),
    confirmPrerequisite: true
  });
}
/** GM вручную подтверждает наличие class feature Modify. */
export async function modifyDroneMine(e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const result = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.mineModify.title") },
    content: `<p>${escHTML(T("SF2eTSC.mineModify.hint"))}</p><label>${escHTML(T("SF2eTSC.mineModify.kind"))} <select name="kind"><option value="smart">${escHTML(T("SF2eTSC.mineModify.smart"))}</option><option value="targeting">${escHTML(T("SF2eTSC.mineModify.targeting"))}</option></select></label><p><label><input type="checkbox" name="confirmed" /> ${escHTML(T("SF2eTSC.mineModify.confirm"))}</label></p>`,
    ok: {
      label: T("SF2eTSC.mineModify.title"),
      callback: (_e, b) => ({ type: b.form.elements.kind.value, confirmed: b.form.elements.confirmed.checked })
    },
    rejectClose: false
  }).catch(() => null);
  if (!result?.confirmed || !["smart", "targeting"].includes(result.type)) return;
  return request("modifyDroneMine", {
    shipUuid: this.document.uuid,
    stationId: t.dataset.stationId,
    droneId: t.dataset.droneId,
    mineId: t.dataset.mineId,
    origin: Number(t.dataset.zone),
    type: result.type,
    modificationId: randomId("mineMod"),
    confirmPrerequisite: true
  });
}
export async function prepareHarrySensors(_e, t) {
  return runHarrySensors(this.document, t);
}
/** Записывает только ручное решение ведущего, не изменяя завершённый бросок. */
export async function markInterceptManually(_e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const data = readStarship(this.document);
  const stations = data.stations.filter((s) => s.id === t.dataset.stationId);
  const combat = activeStarshipCombat();
  if (stations.length !== 1 || !stations[0].helmedBy || !combat?.id) throw new Error(T("SF2eTSC.interceptAssist.invalid"));
  const answer = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.interceptAssist.title") },
    content: `<p>${escHTML(T("SF2eTSC.interceptAssist.manual"))}</p><p><label>${escHTML(T("SF2eTSC.interceptAssist.strike"))} <input name="strikeRef" maxlength="128" required /></label></p><p><label><input type="checkbox" name="confirmed" /> ${escHTML(T("SF2eTSC.interceptAssist.confirm"))}</label></p>`,
    ok: {
      label: T("SF2eTSC.interceptAssist.save"),
      callback: (_e, b) => ({ strikeRef: b.form.elements.strikeRef.value.trim(), confirmed: b.form.elements.confirmed.checked })
    },
    rejectClose: false
  }).catch(() => null);
  if (!answer?.confirmed) return;
  return request("markManualIntercept", {
    shipUuid: this.document.uuid,
    stationId: t.dataset.stationId,
    droneId: t.dataset.droneId,
    operatorUuid: stations[0].helmedBy,
    combatId: combat.id,
    strikeRef: answer.strikeRef,
    interceptId: randomId("intercept"),
    confirmManual: true
  });
}
// Защита только от параллельного открытия одного диалога в данном клиенте; не распределённая блокировка.
const mineDialogs = new Set();
/** Список карты помогает GM; ни спасброски, ни урон, ни закрытие мины не выполняются автоматически. */
export async function prepareMineDetonation(e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const key = JSON.stringify([this.document.uuid, t.dataset.stationId, t.dataset.droneId, t.dataset.mineId]);
  if (mineDialogs.has(key)) return;
  mineDialogs.add(key);
  try {
    const plan = async () => {
      const data = readStarship(this.document);
      const station = data.stations.find((s) => s.id === t.dataset.stationId);
      const operator = station?.helmedBy ? await fromUuidSafe(station.helmedBy) : null;
      const combat = activeStarshipCombat();
      if (!combat?.id) throw new Error(T("SF2eTSC.mineAssist.invalid"));
      try {
        const rawMap = combat.flags?.[MODULE_ID]?.[FLAGS.COMBAT];
        // Определение зоны мины не подменяет проверки mineResolutionPlan.
        const matches = data.drones.flatMap((d) => d.mines ?? []).filter((m) => m?.id === t.dataset.mineId);
        if (matches.length !== 1) throw new Error("mine");
        const mapped = await mappedMineTargets(rawMap, matches[0].zone, this.document.uuid, fromUuidSafe);
        const targetState = await targetSnapshots(mapped.targets, fromUuidSafe);
        const result = mineResolutionPlan({
          data,
          shipUuid: this.document.uuid,
          stationId: t.dataset.stationId,
          droneId: t.dataset.droneId,
          mineId: t.dataset.mineId,
          combatId: combat.id,
          shipZone: mapped.shipZone,
          sensorRange: computeShipStats(this.document).sensorRange,
          operator,
          combat
        });
        return {
          result,
          targets: mapped.targets,
          operator: { uuid: operator.uuid, name: operator.name },
          snapshot: JSON.stringify({
            data,
            rawMap,
            combatId: combat.id,
            round: combat.round,
            turn: combat.turn,
            result,
            operator: { uuid: operator.uuid, name: operator.name },
            targets: mapped.targets,
            targetState
          })
        };
      } catch (err) {
        throw new Error(T("SF2eTSC.mineAssist.invalidTargets"), { cause: err });
      }
    };
    const initial = await plan();
    const targetList = initial.targets.map((x) => `<li>${escHTML(x.name)} (${escHTML(x.key)})</li>`).join("");
    const smart = initial.result.modification === "smart";
    const select = smart
      ? `<label>${escHTML(T("SF2eTSC.mineAssist.exclude"))} <select name="excludedTarget"><option value="">${escHTML(T("SF2eTSC.mineAssist.excludeNone"))}</option>${initial.targets.map((x) => `<option value="${escHTML(x.key)}">${escHTML(x.name)} (${escHTML(x.key)})</option>`).join("")}</select></label>`
      : "";
    const choice = await foundry.applications.api.DialogV2.prompt({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.mineAssist.title") },
      content: `<p>${escHTML(T("SF2eTSC.mineAssist.explain"))}</p><p>${escHTML(T("SF2eTSC.mineAssist.mapWarning"))}</p><ul>${targetList}</ul>${select}<p>${escHTML(T("SF2eTSC.mineGuided.preview", { dc: initial.result.dc, formula: `${initial.result.dice}d8${initial.result.bonus ? ` + ${initial.result.bonus}` : ""}` }))}</p><p><label><input type="checkbox" name="guided" /> ${escHTML(T("SF2eTSC.mineGuided.enable"))}</label></p><p><label>${escHTML(T("SF2eTSC.mineAssist.type"))} <select name="damageType"><option value="fire">${escHTML(T("SF2eTSC.mineAssist.fire"))}</option><option value="piercing">${escHTML(T("SF2eTSC.mineAssist.piercing"))}</option></select></label></p><p><label><input type="checkbox" name="reaction" /> ${escHTML(T("SF2eTSC.mineAssist.reaction"))}</label></p>`,
      ok: {
        label: T("SF2eTSC.mineGuided.continue"),
        callback: (_e, b) => ({
          type: b.form.elements.damageType.value,
          reaction: b.form.elements.reaction.checked,
          guided: b.form.elements.guided?.checked ?? false,
          excludedTarget: b.form.elements.excludedTarget?.value ?? ""
        })
      },
      rejectClose: false
    }).catch(() => null);
    if (!choice || !["fire", "piercing"].includes(choice.type)) return;
    if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const fresh = await plan();
    if (initial.snapshot !== fresh.snapshot) throw new Error(T("SF2eTSC.mineAssist.changed"));
    const result = fresh.result;
    const excluded = choice.excludedTarget ?? "";
    if (excluded && (!smart || !fresh.targets.some((x) => x.key === excluded))) throw new Error(T("SF2eTSC.mineAssist.invalidTargets"));
    const recipients = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
    if (!recipients.length) throw new Error(T("SF2eTSC.errors.gmOnly"));
    if (choice.guided)
      return await guidedMineResolution({
        ship: this.document,
        fresh,
        choice,
        excluded,
        recipients,
        plan,
        mineId: t.dataset.mineId,
        droneId: t.dataset.droneId,
        stationId: t.dataset.stationId
      });
    const title = escHTML(T("SF2eTSC.mineAssist.title"));
    const hint = escHTML(T("SF2eTSC.mineAssist.chatHint", { zone: result.zone }));
    const mode = escHTML(T(choice.reaction ? "SF2eTSC.mineAssist.reactionLabel" : "SF2eTSC.mineAssist.actionLabel"));
    const modHint = result.modification
      ? `<p>${escHTML(T(`SF2eTSC.mineModify.${result.modification}Note`, { bonus: result.bonus }))}</p>`
      : "";
    const damage =
      result.modification === "targeting"
        ? `<p>${escHTML(T("SF2eTSC.mineModify.manualDamage", { formula: `${result.dice}d8 + ${result.bonus}`, type: T(`SF2eTSC.mineAssist.${choice.type}`) }))}</p>`
        : `<p>@Damage[${result.dice}d8[${choice.type}]]</p>`;
    const names = fresh.targets
      .map(
        (x) =>
          `<li>${escHTML(x.name)} (${escHTML(x.key)})${x.key === excluded ? ` — ${escHTML(T("SF2eTSC.mineAssist.excluded"))}` : ""}</li>`
      )
      .join("");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      whisper: recipients,
      content: `<p><strong>${title}</strong> — ${mode}</p><p>${hint}</p><p>${escHTML(T("SF2eTSC.mineAssist.mapWarning"))}</p><ul>${names}</ul>${modHint}${damage}<p>@Check[reflex|dc:${result.dc}|basic]</p>`
    });
  } finally {
    mineDialogs.delete(key);
  }
}
export async function addWeapon() {
  const sel = this.element.querySelector("[name=weaponCatalog]");
  const w = Content.weapons.get(sel?.value);
  if (!w) return;
  await Ship.equipment(this.document.uuid, "weapons", "add", { item: weaponEntry(w, randomId("wpn")) });
}
export async function removeWeapon(e, t) {
  await Ship.equipment(this.document.uuid, "weapons", "remove", { id: t.dataset.id });
}
/* starship upgrades (station sections + ship level). The GM side re-checks capacity and compatibility. */
const confirmOverride = async (name) =>
  foundry.applications.api.DialogV2.confirm({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.upgrades.overrideConfirmTitle") },
    content: `<p>${escHTML(T("SF2eTSC.upgrades.overrideConfirm", { name }))}</p>`
  });
export async function addStationUpgrade(e, t) {
  const stationId = t.dataset.stationId || null;
  const sel = this.element.querySelector(`[data-upgrade-select="${CSS.escape(stationId ?? "ship")}"]`);
  const opt = sel?.selectedOptions?.[0];
  if (!opt?.value) return notifyWarn("SF2eTSC.upgrades.choose");
  let override = false;
  if (game.user.isGM && stationId) {
    const data = readStarship(this.document);
    const st = data.stations.find((s) => s.id === stationId);
    const entry = upgradeCatalog().find((x) => x.key === opt.value);
    const status = st
      ? stationUpgradeStatus(data, st, { entries: upgradeCatalog(), stationDef: Content.stations.get(st.type) ?? null })
      : null;
    if (opt.dataset.override === "1" || (status && status.used >= status.capacity)) {
      if (!(await confirmOverride(entry ? ct(entry.name) : opt.value))) return;
      override = true;
    }
  }
  await Ship.stationUpgrade(this.document.uuid, "add", { key: opt.value, stationId, override });
}
export async function removeStationUpgrade(e, t) {
  await Ship.stationUpgrade(this.document.uuid, "remove", { id: t.dataset.id });
  this._openUpgrades?.delete(t.dataset.id);
}
export async function toggleUpgradeOverride(e, t) {
  if (!game.user.isGM) return;
  await Ship.stationUpgrade(this.document.uuid, "override", { id: t.dataset.id, value: t.dataset.value !== "true" });
}
export async function assignUpgrade(e, t) {
  const sel = this.element.querySelector(`[data-upgrade-assign="${CSS.escape(t.dataset.id)}"]`);
  const opt = sel?.selectedOptions?.[0];
  if (!opt?.value) return notifyWarn("SF2eTSC.upgrades.assignTo");
  const stationId = opt.value === SHIP_TARGET ? null : opt.value;
  const current = readStarship(this.document).upgrades.find((u) => u.id === t.dataset.id);
  if (current && (current.stationId ?? null) === stationId) return;
  let override = false;
  if (game.user.isGM && opt.dataset.override === "1") {
    if (!(await confirmOverride(opt.textContent.trim()))) return;
    override = true;
  } else if (game.user.isGM && stationId) {
    const data = readStarship(this.document);
    const st = data.stations.find((s) => s.id === stationId);
    const status = st
      ? stationUpgradeStatus(data, st, { entries: upgradeCatalog(), stationDef: Content.stations.get(st.type) ?? null })
      : null;
    if (status && status.used >= status.capacity) {
      if (!(await confirmOverride(opt.textContent.trim()))) return;
      override = true;
    }
  }
  await Ship.stationUpgrade(this.document.uuid, "assign", { id: t.dataset.id, stationId, override });
}
export async function updateFromContent() {
  if (!game.user.isGM) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.update.button") },
    content: `<p>${T("SF2eTSC.update.confirm")}</p>`
  });
  if (!ok) return;
  const r = await Importer.updateFromContent(this.document);
  notifyInfo("SF2eTSC.update.done", { name: r.name });
}
export function openMap() {
  const app = new SensorMapApplication();
  app.render(true);
}
export async function gmDamage() {
  const r = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.ui.gmDamage") },
    content: `<div class="form-group"><label>${T("SF2eTSC.qol.reason")}</label><input type="text" name="reason" maxlength="240"></div><div class="form-group"><label>${T("SF2eTSC.chat.damage")}</label><input type="number" name="amount" value="10" min="0"></div><div class="form-group"><label>${T("SF2eTSC.ui.damageType")}</label><input type="text" name="damageType" value="untyped"></div><div class="form-group"><label>${T("SF2eTSC.traits.bypassing")}</label><input type="checkbox" name="bypassing"></div><div class="form-group"><label>${T("SF2eTSC.ui.crit")}</label><input type="checkbox" name="crit"></div><div class="form-group"><label>${T("SF2eTSC.ui.nonlethal")}</label><input type="checkbox" name="nonlethal"></div>`,
    ok: { callback: (ev, b) => new foundry.applications.ux.FormDataExtended(b.form).object },
    rejectClose: false
  }).catch(() => null);
  if (r)
    await Ship.damage(this.document.uuid, Number(r.amount), {
      reason: r.reason,
      damageType: r.damageType,
      traits: r.bypassing ? ["bypassing"] : [],
      crit: !!r.crit,
      nonlethal: !!r.nonlethal
    });
}
export async function gmRepair() {
  const r = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.ui.repair") },
    content: `<div class="form-group"><label>${T("SF2eTSC.ui.hullPoints")}</label><input type="number" name="hp" value="0" min="0"></div><div class="form-group"><label>${T("SF2eTSC.ui.shieldPoints")}</label><input type="number" name="sp" value="0" min="0"></div><div class="form-group"><label>${T("SF2eTSC.ui.clearMalfunctions")}</label><input type="checkbox" name="clearMalfunctions"></div>`,
    ok: { callback: (ev, b) => new foundry.applications.ux.FormDataExtended(b.form).object },
    rejectClose: false
  }).catch(() => null);
  if (r) await Ship.repair(this.document.uuid, { hp: Number(r.hp), sp: Number(r.sp), clearMalfunctions: !!r.clearMalfunctions });
}
export async function hullCheck() {
  const d = readStarship(this.document);
  if (d.destroyed) return notifyWarn("SF2eTSC.errors.shipDestroyed");
  if (d.compromised <= 0) return notifyWarn("SF2eTSC.errors.notCompromised");
  await Ship.hullIntegrity(this.document.uuid);
}
export async function applyFrame() {
  const frameId = this.element.querySelector("[name=frameSelect]").value;
  const level = Number(this.element.querySelector("[name=frameLevel]").value) || 1;
  await Ship.applyFrame(this.document.uuid, frameId, level, this.element.querySelector("[name=autoGrades]")?.checked ?? true);
}
export function exportJson() {
  foundry.utils.saveDataToFile(Importer.exportShipJSON(this.document), "application/json", `${slugify(this.document.name)}.starship.json`);
}
export async function importJson() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      await Importer.importShipJSON(await f.text(), this.document);
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  };
  input.click();
}
export async function runShipAction(e, t) {
  const data = readStarship(this.document);
  const id = t.dataset.actionId;
  let action = Content.actions.get(id);
  if (!action) action = buildNpcAction(data, id);
  if (!action) return;
  const station =
    data.stations.find((s) => s.id === t.dataset.stationId) ??
    (this.isNpc ? data.stations.find((s) => s.type === action.station || (s.actions ?? []).includes(action.name)) : null) ??
    null;
  const crew = station?.helmedBy ? fromUuidSync(station.helmedBy) : null;
  await runAction(action, { ship: this.document, crew, station });
}
/** Sheet rolls never spend, count or block actions / reactions (§9). */
export async function rollCheck(e, t) {
  const raw = this.element.querySelector("[name=tscRollDC]")?.value ?? "";
  await rollShipCheck(this.document, t.dataset.slug, { dc: raw === "" ? null : Number(raw) });
}
/** Post a Fortitude / Reflex / Will save against the ship's Piloting DC to the chat. */
export async function pilotingSave(e, t) {
  await postPilotingSave(this.document, t.dataset.save);
}
export async function sheetAttack(e, t) {
  const row = sheetAttackRows(this.document).find((r) => r.key === t.dataset.key);
  if (!row) return;
  if (!row.enabled) return notifyWarn("SF2eTSC.errors.generic", { message: row.reason });
  await beginNativeWeaponAttack(sheetAttackRequest(this.document, row, t.dataset.map ?? "0"));
}
export async function sheetDamage(e, t) {
  await rollSheetDamage(this.document, t.dataset.key, { crit: t.dataset.crit === "true" });
}
export async function removeEffect(e, t) {
  const d = readStarship(this.document);
  await Ship.patch(this.document.uuid, { customModifiers: d.customModifiers ?? [] });
  await request("equipment", { shipUuid: this.document.uuid, list: "effects", op: "remove", id: t.dataset.id });
}
export function holodock() {
  openHolodock(this.document);
}
export async function saveNotes() {
  const g = (n) => this.element.querySelector(`[name=${n}]`)?.value;
  await Ship.patch(this.document.uuid, { notes: g("notes"), ...(game.user.isGM ? { gmNotes: g("gmNotes") } : {}) });
}
export async function manualResolve() {
  const text = this.element.querySelector("[name=manualText]")?.value;
  if (text) await Ship.manualCard(this.document.uuid, T("SF2eTSC.ui.manualResolution"), text);
}

/** Resolve by stable catalog key, not translated names or guessed document ids. */
export async function openUpgrade(e, target) {
  const pack = game.packs.get(modulePackId("starship-upgrades"));
  if (!pack) return;
  const index = await pack.getIndex({
    fields: ["flags.sf2e-tactical-starship-combat.upgrade.key", "flags.sf2e-tactical-starship-combat.upgrade.lang"]
  });
  const matches = index.filter((item) => item.flags?.["sf2e-tactical-starship-combat"]?.upgrade?.key === target.dataset.key);
  const lang = game.i18n.lang?.startsWith("ru") ? "ru" : "en";
  const row = matches.find((item) => item.flags?.["sf2e-tactical-starship-combat"]?.upgrade?.lang === lang) ?? matches[0];
  if (row) (await pack.getDocument(row._id))?.sheet?.render(true);
}

/** Склад мин: логика в mine-stock-actions.mjs, здесь только привязка к листу. */
export const installMineStock = function (e, t) {
  return mineStockActions.installMineStock(this, e, t);
};
export const addKnownMineMod = function (e, t) {
  return mineStockActions.addKnownMineMod(this, e, t);
};
export const removeKnownMineMod = function (e, t) {
  return mineStockActions.removeKnownMineMod(this, e, t);
};
export const discardStoredMine = function (e, t) {
  return mineStockActions.discardStoredMine(this, e, t);
};
export const syncMineContactNow = function (e, t) {
  return mineStockActions.syncMineContactNow(this, e, t);
};
