/** Skin only this module's native action items. Other SF2e sheets retain their normal theme. */
import { MODULE_ID } from "../constants.mjs";
import { T } from "../utils/foundry.mjs";
import { wireSheetTheme, paintSheetTheme, sheetThemeOptions } from "./sheet/sheet-theme.mjs";
export function isThemedStationAction(item) {
  const flags = item?.flags?.[MODULE_ID];
  return item?.type === "action" && !!(flags?.stationAction || flags?.packAction);
}
export function skinActionSheet(app, html) {
  if (!isThemedStationAction(app.item ?? app.document ?? app.object)) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
  if (!root?.querySelector) return;
  root.classList.add("sf2e-tsc", "tsc-action-sheet");
  const header = root.querySelector(".sheet-header, .window-content");
  if (header && !root.querySelector("[data-sheet-theme-select]")) {
    const label = document.createElement("label");
    label.className = "tsc-action-theme-picker";
    label.append(document.createTextNode(`${T("SF2eTSC.settings.starshipSheetTheme.name")} `));
    const select = document.createElement("select");
    select.dataset.sheetThemeSelect = "";
    for (const option of sheetThemeOptions()) select.add(new Option(option.label, option.id, false, option.selected));
    label.append(select);
    header.append(label);
  }
  wireSheetTheme({ element: root });
}
export function refreshActionThemes() {
  globalThis.document?.querySelectorAll(".tsc-action-sheet").forEach((root) => paintSheetTheme(root));
}
export function registerActionSheetThemes() {
  Hooks.on("renderApplicationV2", skinActionSheet);
  Hooks.on("renderItemSheet", skinActionSheet);
}
