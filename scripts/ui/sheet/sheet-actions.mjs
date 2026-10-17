import { saveUiState } from "../client-ui.mjs";
/** Starship sheet: click actions (called with `this` = the sheet). */
import { STATION_TYPES } from "../../constants.mjs";
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
  await request("declareAttack", sheetAttackRequest(this.document, row, t.dataset.map ?? "0"));
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
  const pack = game.packs.get("sf2e-tactical-starship-combat.starship-upgrades");
  if (!pack) return;
  const index = await pack.getIndex({
    fields: ["flags.sf2e-tactical-starship-combat.upgrade.key", "flags.sf2e-tactical-starship-combat.upgrade.lang"]
  });
  const matches = index.filter((item) => item.flags?.["sf2e-tactical-starship-combat"]?.upgrade?.key === target.dataset.key);
  const lang = game.i18n.lang?.startsWith("ru") ? "ru" : "en";
  const row = matches.find((item) => item.flags?.["sf2e-tactical-starship-combat"]?.upgrade?.lang === lang) ?? matches[0];
  if (row) (await pack.getDocument(row._id))?.sheet?.render(true);
}
