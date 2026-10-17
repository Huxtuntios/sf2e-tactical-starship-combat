/** Starship sheet: pure constants and the partial-render plan (unit-tested without Foundry). */
/** Sheet tabs (0.9.2: five instead of eight; crew lives with the stations, weapons and upgrades with the equipment, effects and log with the overview). */
export const TABS = ["overview", "stations", "equipment", "notes", "config"];
export const NPC_TABS = ["overview", "actions", "stations", "equipment", "notes", "config"];
export const escHTML = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Parts of the sheet: header (name, image, HP/SP), tabs (nav + warnings), body (active tab). */
export const SHEET_PART_IDS = ["header", "tabs", "body"];
/**
 * Which parts a refresh needs (null = all). Combat/targeting/crew changes never change the tab list,
 * a tab switch never changes the header.
 */
export const SHEET_PARTS = { combat: ["header", "body"], targeting: ["body"], crew: ["header", "body"], tab: ["tabs", "body"] };
export const sheetPartsFor = (channel) => SHEET_PARTS[channel] ?? null;

/** Tab buttons. `t` = localize. */
export function tabRows(tabs, active, canConfigure, t = (k) => k) {
  return tabs.map((id) => ({ id, label: t(`SF2eTSC.tabs.${id}`), active: id === active, visible: id !== "config" || !!canConfigure }));
}

/** Localized warning for a data problem found in an NPC statblock entry. `t` = format(key, data). */
export function npcIssueText(issue, name, t) {
  const value = issue.value === undefined ? "—" : typeof issue.value === "string" ? issue.value : JSON.stringify(issue.value);
  return t(`SF2eTSC.ui.npcIssue.${issue.code}`, { name: String(name ?? "?"), field: issue.field ?? "", value: String(value ?? "—") });
}

/** Mark an element as wired for a given listener kind; false if it already was (partial renders keep untouched parts). */
export function wireOnce(el, kind) {
  const k = `tscWired${kind}`;
  if (el.dataset[k]) return false;
  el.dataset[k] = "1";
  return true;
}
