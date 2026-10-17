/**
 * drag a starship upgrade from the "Starship Upgrades" compendium onto a starship: it is installed in a
 * suitable battle station (right type, a free upgrade slot) instead of becoming an embedded Item. When nothing fits,
 * nothing is installed and the reason is posted to the chat (whispered to the player and the GM).
 * when several stations can take it, a dialog asks which one (closing it installs nothing).
 * `planUpgradeDrop` is pure; `addUpgradeToShip` performs the install through the normal GM-checked service.
 */
import { MODULE_ID } from "../constants.mjs";
import { Content, upgradeCatalog } from "../content/loader.mjs";
import { UPGRADE_ITEM_FLAG } from "../content/upgrade-docs.mjs";
import { compatibleWith, stationUpgradeStatus, resolveUpgrade, parseUpgradeKey } from "../engine/upgrades.mjs";
import { readStarship } from "./starship-state.mjs";
import { Ship } from "./ship-service.mjs";
import { T, escapeHtml } from "../utils/foundry.mjs";
import { ct } from "../content/content-i18n.mjs";

const recent = new Map();

/** Catalog key of a pack upgrade (item document or plain data), or null. */
export function packUpgradeKey(item) {
  const f = item?.flags?.[MODULE_ID]?.[UPGRADE_ITEM_FLAG] ?? item?.getFlag?.(MODULE_ID, UPGRADE_ITEM_FLAG);
  return f?.key ?? null;
}

/**
 * Where does this upgrade go? Pure.
 * @returns {{ok:true, stationId:string|null, station:object|null, options:{id:string, station:object, used:number, capacity:number}[]}|{ok:false, code:string, data:object}}
 *   `options` lists EVERY compatible station with a free slot (the first one is `stationId`); empty for ship-level upgrades.
 *   codes: unknown | noStation (the ship has no station of the needed type) | allFull (every such station is full) | escapePodsFull
 */
export function planUpgradeDrop(data, entry, { entries = [], stationDefs = new Map() } = {}) {
  if (!entry) return { ok: false, code: "unknown", data: {} };
  if (entry.slot === "escape-pods") {
    const pods = (data?.upgrades ?? []).some(
      (u) => (u.stationId ?? null) === null && resolveUpgrade(entries, u.ref, u.variant ?? null)?.slot === "escape-pods"
    );
    return pods ? { ok: false, code: "escapePodsFull", data: {} } : { ok: true, stationId: null, station: null, options: [] };
  }
  const candidates = (data?.stations ?? []).filter((st) => compatibleWith(entry, st));
  if (!candidates.length) return { ok: false, code: "noStation", data: { type: entry.station } };
  const options = [];
  for (const st of candidates) {
    const status = stationUpgradeStatus(data, st, { entries, stationDef: stationDefs.get?.(st.type) ?? null });
    if (status.free > 0) options.push({ id: st.id, station: st, used: status.used, capacity: status.capacity });
  }
  if (!options.length) return { ok: false, code: "allFull", data: { type: entry.station } };
  return { ok: true, stationId: options[0].id, station: options[0].station, options };
}

const stationLabel = (type) => (game.i18n.has(`SF2eTSC.stations.${type}`) ? T(`SF2eTSC.stations.${type}`) : String(type ?? ""));

/** Error message in the chat, visible to the user who dropped and to the GMs only. */
export async function postDropError(actor, name, reason) {
  const gms = game.users?.filter?.((u) => u.isGM)?.map((u) => u.id) ?? [];
  const whisper = [...new Set([game.user.id, ...gms])];
  const text = T("SF2eTSC.upgrades.drop.failed", { name, ship: actor.name, reason });
  return ChatMessage.create({
    content: `<div class="sf2e-tsc tsc-drop-error"><p><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(text)}</p></div>`,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor })
  });
}

/** Option label of the picker: "Gunnery 2 (Advanced) — 1/2 slots used". Pure apart from localization. */
export function stationOptionLabel(opt) {
  const grade =
    opt.station.grade && game.i18n.has(`SF2eTSC.grades.${opt.station.grade}`) ? ` (${T(`SF2eTSC.grades.${opt.station.grade}`)})` : "";
  return `${ct(opt.station.name ?? stationLabel(opt.station.type))}${grade} — ${T("SF2eTSC.upgrades.drop.slotsUsed", { used: opt.used, capacity: opt.capacity })}`;
}

/** Ask which station gets the upgrade. Resolves to a station id, or null when the dialog is closed. */
export async function chooseUpgradeStation(options, { name, ship }) {
  const esc = (v) => escapeHtml(String(v));
  const select = options
    .map((o, i) => `<option value="${esc(o.id)}"${i === 0 ? " selected" : ""}>${esc(stationOptionLabel(o))}</option>`)
    .join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: T("SF2eTSC.upgrades.drop.chooseTitle", { name }), icon: "fa-solid fa-screwdriver-wrench" },
    classes: ["sf2e-tsc"],
    position: { width: 420 },
    rejectClose: false,
    content: `<p>${esc(T("SF2eTSC.upgrades.drop.chooseHint", { name, ship }))}</p><div class="form-group"><label>${esc(T("SF2eTSC.upgrades.station"))}</label><select name="stationId" autofocus>${select}</select></div>`,
    ok: {
      label: T("SF2eTSC.upgrades.install"),
      icon: "fa-solid fa-check",
      callback: (event, button) => button.form.elements.stationId.value
    }
  });
}

export async function addUpgradeToShip(actor, key, { choose = chooseUpgradeStation } = {}) {
  const entries = upgradeCatalog();
  const { ref, variant } = parseUpgradeKey(key);
  const entry = resolveUpgrade(entries, ref, variant);
  const name = entry ? ct(entry.name) : String(key);
  const stamp = `${actor.uuid}:${key}`;
  const now = Date.now();
  if (now - (recent.get(stamp) ?? 0) < 1500) return false; // one drop may reach both the sheet and the hook
  recent.set(stamp, now);
  const plan = planUpgradeDrop(readStarship(actor), entry, { entries, stationDefs: Content.stations });
  if (!plan.ok) {
    const reason =
      plan.code === "noStation"
        ? T("SF2eTSC.upgrades.drop.noStation", { station: stationLabel(plan.data.type), ship: actor.name })
        : plan.code === "allFull"
          ? T("SF2eTSC.upgrades.drop.allFull", { station: stationLabel(plan.data.type) })
          : T(`SF2eTSC.upgrades.errors.${plan.code}`);
    await postDropError(actor, name, reason);
    return false;
  }
  // several stations could take it: the player decides (closing the dialog installs nothing and says nothing)
  let target = plan.options[0] ?? null;
  if (plan.options.length > 1) {
    const picked = await choose(plan.options, { name, ship: actor.name });
    target = plan.options.find((o) => o.id === picked) ?? null;
    if (!target) return false;
  }
  try {
    await Ship.stationUpgrade(actor.uuid, "add", { key: entry.key, stationId: target?.id ?? null });
  } catch (err) {
    await postDropError(actor, name, err?.message ?? String(err));
    return false;
  }
  ui.notifications.info(
    T("SF2eTSC.upgrades.drop.added", {
      name,
      station: target ? ct(target.station.name ?? stationLabel(target.station.type)) : T("SF2eTSC.upgrades.shipLevel"),
      ship: actor.name
    })
  );
  return true;
}
