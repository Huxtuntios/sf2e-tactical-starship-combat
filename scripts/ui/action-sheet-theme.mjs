/** Skin only this module's native action items. Other SF2e sheets retain their normal theme. */
import { MODULE_ID } from "../constants.mjs";
import { wireSheetTheme, paintSheetTheme } from "./sheet/sheet-theme.mjs";
import { wireInlineClicks } from "./inline-clicks.mjs";
import { linkContextDCs } from "../rolls/context-dc.mjs";
import { normalizeNativeChecks } from "../content/native-checks.mjs";

const descriptionContexts = new WeakMap();
export function setActionSheetContext(app, context) {
  if (context.crew || context.ship) descriptionContexts.set(app, context);
  else descriptionContexts.delete(app);
}

export function isThemedStationAction(item) {
  const flags = item?.flags?.[MODULE_ID];
  return item?.type === "action" && !!(flags?.stationAction || flags?.packAction);
}
export async function skinActionSheet(app, html) {
  const item = app.item ?? app.document ?? app.object;
  if (!isThemedStationAction(item)) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
  if (!root?.querySelector) return;
  root.classList.add("sf2e-tsc", "tsc-action-sheet");
  wireSheetTheme({ element: root });
  const context = descriptionContexts.get(app);
  const content = root.querySelector('[data-tab="description"] .main.editor-container .editor-content');
  if (context && content && !content.isContentEditable) {
    const source = item.system.description.value;
    const description = normalizeNativeChecks(linkContextDCs(source, context));
    if (description !== source) {
      const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(description, {
        secrets: item.isOwner,
        rollData: item.getRollData()
      });
      if (content.isConnected && descriptionContexts.get(app) === context) content.innerHTML = enriched;
    }
  }
  wireInlineClicks(root);
}
export function refreshActionThemes() {
  globalThis.document?.querySelectorAll(".tsc-action-sheet").forEach((root) => paintSheetTheme(root));
}
export function registerActionSheetThemes() {
  Hooks.on("renderApplicationV2", skinActionSheet);
  Hooks.on("renderItemSheet", skinActionSheet);
  Hooks.on("closeItemSheet", (app) => descriptionContexts.delete(app));
  Hooks.on("closeApplicationV2", (app) => descriptionContexts.delete(app));
}
