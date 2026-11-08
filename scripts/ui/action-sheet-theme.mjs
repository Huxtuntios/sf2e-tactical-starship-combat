/** Skin only this module's native action items. Other SF2e sheets retain their normal theme. */
import { MODULE_ID } from "../constants.mjs";
import { wireSheetTheme, paintSheetTheme } from "./sheet/sheet-theme.mjs";
export function isThemedStationAction(item) {
  const flags = item?.flags?.[MODULE_ID];
  return item?.type === "action" && !!(flags?.stationAction || flags?.packAction);
}
export function skinActionSheet(app, html) {
  if (!isThemedStationAction(app.item ?? app.document ?? app.object)) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
  if (!root?.querySelector) return;
  root.classList.add("sf2e-tsc", "tsc-action-sheet");
  wireSheetTheme({ element: root });
}
export function refreshActionThemes() {
  globalThis.document?.querySelectorAll(".tsc-action-sheet").forEach((root) => paintSheetTheme(root));
}
export function registerActionSheetThemes() {
  Hooks.on("renderApplicationV2", skinActionSheet);
  Hooks.on("renderItemSheet", skinActionSheet);
}
