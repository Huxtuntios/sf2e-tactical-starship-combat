/** Starship sheet: input listeners. Each element is wired once, so partial re-renders never duplicate handlers. */
import { Crew } from "../../crew/crew-service.mjs";
import { Ship } from "../../starship/ship-service.mjs";
import { request } from "../../socket.mjs";
import { notifyError } from "../../utils/logging.mjs";
import { parseKv, parseCsv } from "../sheet-edit.mjs";
import { wireOnce } from "./sheet-model.mjs";

const guard = (fn) =>
  async function (...a) {
    try {
      return await fn.apply(this, a);
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  };

export function wireSheetInputs(sheet) {
  const el = sheet.element;
  el.querySelectorAll("[data-field]").forEach(
    (i) =>
      wireOnce(i, "Field") &&
      i.addEventListener(
        "change",
        guard(async (ev) => {
          const t = ev.currentTarget;
          const key = t.dataset.field;
          let v = t.type === "checkbox" ? t.checked : t.type === "number" ? Number(t.value) : t.value;
          if (t.dataset.type === "csv") v = parseCsv(v);
          else if (t.dataset.type === "kv") v = parseKv(v);
          if (key.startsWith("hp.") || key.startsWith("sp.")) {
            const [k, sub] = key.split(".");
            return Ship.patch(sheet.document.uuid, { [k]: { [sub]: v } });
          }
          return Ship.patch(sheet.document.uuid, { [key]: v });
        })
      )
  );
  el.querySelectorAll("[data-station-field]").forEach(
    (i) =>
      wireOnce(i, "Station") &&
      i.addEventListener(
        "change",
        guard(async (ev) => {
          const t = ev.currentTarget;
          await Ship.setStation(sheet.document.uuid, t.dataset.stationId, {
            [t.dataset.stationField]: t.dataset.type === "csv" ? parseCsv(t.value) : t.value
          });
        })
      )
  );
  el.querySelectorAll("[data-list][data-key]").forEach(
    (i) =>
      wireOnce(i, "List") &&
      i.addEventListener(
        "change",
        guard(async (ev) => {
          const t = ev.currentTarget;
          let v = t.value;
          if (t.dataset.type === "number") v = Number(v) || 0;
          else if (t.dataset.type === "csv") v = parseCsv(v);
          await Ship.equipment(sheet.document.uuid, t.dataset.list, "update", {
            index: Number(t.dataset.index),
            item: { [t.dataset.key]: v }
          });
        })
      )
  );
  el.querySelectorAll("[data-actor-field]").forEach(
    (i) =>
      wireOnce(i, "Actor") &&
      i.addEventListener(
        "change",
        guard(async (ev) => {
          const v = ev.currentTarget.value.trim();
          if (!v) return;
          await request("actorBasics", { actorUuid: sheet.document.uuid, name: v });
        })
      )
  );
  el.querySelectorAll("[data-role-select]").forEach(
    (i) =>
      wireOnce(i, "Role") &&
      i.addEventListener(
        "change",
        guard(async (ev) => Crew.setRole(sheet.document.uuid, ev.currentTarget.dataset.crewUuid, ev.currentTarget.value))
      )
  );
  el.querySelectorAll("[data-bay-id]").forEach(
    (i) =>
      wireOnce(i, "Bay") &&
      i.addEventListener(
        "change",
        guard(async (ev) =>
          Ship.equipment(sheet.document.uuid, "expansionBays", "update", {
            id: ev.currentTarget.dataset.bayId,
            item: { name: ev.currentTarget.value }
          })
        )
      )
  );
  // upgrade selector search (hides non-matching options) and remembered open/closed rules details
  el.querySelectorAll("[data-upgrade-filter]").forEach(
    (i) =>
      wireOnce(i, "UpgFilter") &&
      i.addEventListener("input", (ev) => {
        const q = ev.currentTarget.value.trim().toLowerCase();
        const sel = el.querySelector(`[data-upgrade-select="${CSS.escape(ev.currentTarget.dataset.upgradeFilter)}"]`);
        if (!sel) return;
        for (const o of sel.querySelectorAll("option[data-search]")) {
          const hit = !q || o.dataset.search.includes(q);
          o.hidden = !hit;
          o.disabled = !hit;
        }
        const first = [...sel.querySelectorAll("option[data-search]")].find((o) => !o.hidden);
        if (!sel.selectedOptions[0] || sel.selectedOptions[0].hidden || !sel.value) sel.value = q && first ? first.value : "";
      })
  );
  sheet._openUpgrades ??= new Set();
  el.querySelectorAll("[data-upgrade-details]").forEach(
    (d) =>
      wireOnce(d, "UpgDetails") &&
      d.addEventListener("toggle", () => {
        if (d.open) sheet._openUpgrades.add(d.dataset.upgradeDetails);
        else sheet._openUpgrades.delete(d.dataset.upgradeDetails);
      })
  );
  // the root element survives re-renders: register root listeners once (0.4.x added a new drop handler on every
  // render, so one drop added the crew member N times)
  // guard on the element itself (a reopened sheet gets a new root element); capture phase so the core
  // ActorSheetV2 drop handling cannot swallow actor drops first.
  if (el.dataset.tscCrewDrop) return;
  el.dataset.tscCrewDrop = "1";
  el.addEventListener("dragover", (ev) => ev.preventDefault());
  el.addEventListener(
    "drop",
    guard(async (ev) => {
      const d = dragData(ev);
      if (d?.type !== "Actor") return;
      ev.preventDefault();
      ev.stopPropagation();
      const a = d.uuid ? await fromUuid(d.uuid) : game.actors?.get(d.id);
      if (!a || a.uuid === sheet.document.uuid) return;
      await Crew.add(sheet.document.uuid, a.uuid, "crew");
    }),
    true
  );
}

export function dragData(ev) {
  try {
    const TE = foundry.applications?.ux?.TextEditor?.implementation;
    return TE?.getDragEventData?.(ev) ?? JSON.parse(ev.dataTransfer?.getData("text/plain") || "null");
  } catch {
    return null;
  }
}
