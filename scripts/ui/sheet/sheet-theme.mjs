/** Client-only presentation. Never updates game documents or the Foundry-wide theme. */
import { MODULE_ID } from "../../constants.mjs";
import { MAP_PALETTES } from "../../sensor/appearance.mjs";

export const normalizeSheetTheme = (value) => (["light", "dark"].includes(value) ? value : "foundry");
export function clientSheetTheme() {
  return normalizeSheetTheme(globalThis.game?.settings?.get(MODULE_ID, "starshipSheetTheme"));
}
/** Foundry v14 stores the application colour scheme in core.uiConfig. Empty means app default. */
export function activeModuleTheme(value = clientSheetTheme(), root = null) {
  if (value === "light" || value === "dark") return value;
  let scheme;
  try {
    scheme = game.settings.get("core", "uiConfig")?.colorScheme?.applications;
  } catch {
    /* core unavailable during early init */
  }
  if (scheme === "light" || scheme === "dark") return scheme;
  // With no global override, use the application's native Foundry theme class, when provided.
  if (root?.classList?.contains("theme-light")) return "light";
  if (root?.classList?.contains("theme-dark")) return "dark";
  return "dark";
}
export function paintSheetTheme(element, value = clientSheetTheme()) {
  if (!element?.dataset || !element?.style) return;
  const theme = activeModuleTheme(normalizeSheetTheme(value), element);
  element.dataset.sheetTheme = theme;
  if (element.classList?.contains("tsc-sensor-map")) element.dataset.mapTheme = theme;
  const palette = { ...MAP_PALETTES[theme] };
  if (element.classList?.contains("tsc-sensor-map")) {
    if (element.dataset.tscTextColor) palette.text = element.dataset.tscTextColor;
    if (element.dataset.tscMutedColor) palette.dim = element.dataset.tscMutedColor;
    if (element.dataset.tscAccentColor) palette.accent = element.dataset.tscAccentColor;
  }
  for (const [key, color] of Object.entries(palette)) element.style.setProperty(`--tsc-${key}`, color);
}
export function wireSheetTheme(app) {
  paintSheetTheme(app.element);
}
export function refreshModuleThemes() {
  globalThis.document?.querySelectorAll(".sf2e-tsc[data-sheet-theme]").forEach((root) => paintSheetTheme(root));
}
export function registerModuleThemeHooks() {
  Hooks.on("clientSettingChanged", (key) => {
    if (key === "core.uiConfig" && clientSheetTheme() === "foundry") refreshModuleThemes();
  });
  Hooks.on("renderApplicationV2", (app, element) => {
    const root = app.element?.classList?.contains("sf2e-tsc") ? app.element : element;
    if (root?.classList?.contains("sf2e-tsc")) paintSheetTheme(root);
  });
}
