/** Starship sheet: Install Mine and the mine stock (each function takes the sheet explicitly). GM only; the active GM re-validates every request. */
import { readStarship } from "../../starship/starship-state.mjs";
import { operatorClassStatus, knownMods, MAX_INSTALL_PER_ACTION } from "../../engine/mine-stock.mjs";
import { request } from "../../socket.mjs";
import { T, fromUuidSafe } from "../../utils/foundry.mjs";
import { randomId } from "../../utils/ids.mjs";
import { escHTML } from "./sheet-model.mjs";

function consoleContext(sheet, stationId, droneId = null) {
  const data = readStarship(sheet.document);
  const stations = data.stations.filter((s) => s.id === stationId);
  if (stations.length !== 1 || !stations[0].helmedBy) throw new Error(T("SF2eTSC.mineStock.errors.invalid"));
  const drones = droneId ? data.drones.filter((d) => d.id === droneId) : [];
  if (droneId && drones.length !== 1) throw new Error(T("SF2eTSC.mineStock.errors.invalid"));
  return { data, station: stations[0], drone: drones[0] ?? null };
}

/** Install Mine: до четырёх мин в неразвёрнутом дроне получают подтверждённые модификации. */
export async function installMineStock(sheet, _e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const { station, drone } = consoleContext(sheet, t.dataset.stationId, t.dataset.droneId);
  const operator = await fromUuidSafe(station.helmedBy);
  if (!operator) throw new Error(T("SF2eTSC.mineStock.errors.invalid"));
  const mods = knownMods(station, operator.uuid);
  if (!mods.length) return addKnownMineMod(sheet, _e, t);
  const stored = (Array.isArray(drone.mineStock) ? drone.mineStock : []).filter((m) => !m.installed);
  const klass = operatorClassStatus(operator);
  const modOptions = `<option value="">—</option>${mods.map((m) => `<option value="${escHTML(m.id)}">${escHTML(m.label)}</option>`).join("")}`;
  const mineOptions = `<option value="">${escHTML(T("SF2eTSC.mineStock.newMine"))}</option>${stored.map((m) => `<option value="${escHTML(m.id)}">${escHTML(m.label)}</option>`).join("")}`;
  const rows = Array.from(
    { length: MAX_INSTALL_PER_ACTION },
    (_, i) =>
      `<p><label>${escHTML(T("SF2eTSC.mineStock.mine"))} ${i + 1} <select name="stock${i}">${mineOptions}</select></label> <label>${escHTML(T("SF2eTSC.mineStock.label"))} <input name="label${i}" maxlength="80"></label> <label>${escHTML(T("SF2eTSC.mineStock.mod"))} <select name="mod${i}">${modOptions}</select></label></p>`
  ).join("");
  const override =
    klass === "other"
      ? `<p><label><input type="checkbox" name="override"> ${escHTML(T("SF2eTSC.mineStock.classOverride"))}</label></p>`
      : `<p class="hint">${escHTML(T(klass === "mechanic" ? "SF2eTSC.mineStock.classOk" : "SF2eTSC.mineStock.classUnknown"))}</p>`;
  const answer = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.mineStock.installTitle") },
    content: `<p>${escHTML(T("SF2eTSC.mineStock.installHint", { operator: operator.name }))}</p>${rows}${override}<p><label><input type="checkbox" name="confirmed"> ${escHTML(T("SF2eTSC.mineStock.confirm"))}</label></p>`,
    ok: {
      label: T("SF2eTSC.mineStock.install"),
      callback: (_ev, b) => {
        const f = b.form.elements;
        const entries = [];
        for (let i = 0; i < MAX_INSTALL_PER_ACTION; i++) {
          const modId = f[`mod${i}`].value;
          if (!modId) continue;
          const stockId = f[`stock${i}`].value;
          entries.push(stockId ? { stockId, modId } : { label: f[`label${i}`].value.trim(), modId });
        }
        return { confirmed: f.confirmed.checked, gmOverride: !!f.override?.checked, entries };
      }
    },
    rejectClose: false
  }).catch(() => null);
  if (!answer?.confirmed || !answer.entries.length) return;
  return request("installMineStock", {
    ...answer,
    shipUuid: sheet.document.uuid,
    stationId: station.id,
    droneId: drone.id,
    operatorUuid: operator.uuid,
    operationId: randomId("install")
  });
}

/** Ведущий подтверждает, что оператор знает модификацию минного экзокортекса (непрозрачная запись, не эффект). */
export async function addKnownMineMod(sheet, _e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const { station } = consoleContext(sheet, t.dataset.stationId);
  const operator = await fromUuidSafe(station.helmedBy);
  if (!operator) throw new Error(T("SF2eTSC.mineStock.errors.invalid"));
  const answer = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.mineStock.knownTitle") },
    content: `<p>${escHTML(T("SF2eTSC.mineStock.knownHint", { operator: operator.name }))}</p><p><label>${escHTML(T("SF2eTSC.mineStock.mod"))} <input name="label" maxlength="80" required></label></p><p><label><input type="checkbox" name="confirmed"> ${escHTML(T("SF2eTSC.mineStock.knownConfirm"))}</label></p>`,
    ok: {
      label: T("SF2eTSC.ui.save"),
      callback: (_ev, b) => ({ label: b.form.elements.label.value.trim(), confirmed: b.form.elements.confirmed.checked })
    },
    rejectClose: false
  }).catch(() => null);
  if (!answer?.confirmed || !answer.label) return;
  return request("mineKnownMod", {
    op: "add",
    modId: randomId("mod"),
    label: answer.label,
    confirmed: true,
    shipUuid: sheet.document.uuid,
    stationId: station.id,
    operatorUuid: operator.uuid
  });
}

export async function removeKnownMineMod(sheet, _e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const { station } = consoleContext(sheet, t.dataset.stationId);
  return request("mineKnownMod", {
    op: "remove",
    modId: t.dataset.modId,
    shipUuid: sheet.document.uuid,
    stationId: station.id,
    operatorUuid: station.helmedBy
  });
}

export async function discardStoredMine(sheet, _e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const ok = await foundry.applications.api.DialogV2.confirm({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.mineStock.discard") },
    content: `<p>${escHTML(T("SF2eTSC.mineStock.discardConfirm"))}</p>`,
    rejectClose: false
  }).catch(() => false);
  if (!ok) return;
  return request("discardStoredMine", {
    shipUuid: sheet.document.uuid,
    stationId: t.dataset.stationId,
    droneId: t.dataset.droneId,
    stockId: t.dataset.stockId
  });
}

export async function syncMineContactNow(sheet, _e, t) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const result = await request("syncMineContact", { shipUuid: sheet.document.uuid, droneId: t.dataset.droneId, mineId: t.dataset.mineId });
  ui.notifications?.info?.(T(`SF2eTSC.mineContact.sync.${result?.action ?? "unchanged"}`));
  return result;
}
