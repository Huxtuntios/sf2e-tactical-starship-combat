/** Local presentation only: never update an actor, combat, flags or the GM socket. */
import { MODULE_ID } from "../../constants.mjs";
import { MAP_PALETTES } from "../../sensor/appearance.mjs";
import { T } from "../../utils/foundry.mjs";
import { notifyError } from "../../utils/logging.mjs";
import { wireOnce } from "./sheet-model.mjs";

export const normalizeSheetTheme = (value) => (value === "light" ? "light" : "dark");
export const clientSheetTheme = () => normalizeSheetTheme(game.settings.get(MODULE_ID, "starshipSheetTheme"));
export function sheetThemeOptions() {
  const current = clientSheetTheme();
  return ["dark", "light"].map((id) => ({ id, label: T(`SF2eTSC.settings.starshipSheetTheme.${id}`), selected: id === current }));
}

/** Root variables survive partial renders; refreshing the header cannot change the active tab or form draft. */
export function paintSheetTheme(element, value = clientSheetTheme()) {
  const theme = normalizeSheetTheme(value);
  element.dataset.sheetTheme = theme;
  for (const [key, color] of Object.entries(MAP_PALETTES[theme])) element.style.setProperty(`--tsc-${key}`, color);
  element.querySelectorAll("[data-sheet-theme-select]").forEach((select) => {
    select.value = theme;
  });
}

export function wireSheetTheme(sheet) {
  paintSheetTheme(sheet.element);
  sheet.element.querySelectorAll("[data-sheet-theme-select]").forEach((select) => {
    // ActorSheetV2 may disable form controls for observers. This selector changes only the local client setting.
    select.disabled = false;
    if (!wireOnce(select, "SheetTheme")) return;
    select.addEventListener("change", async () => {
      try {
        await game.settings.set(MODULE_ID, "starshipSheetTheme", normalizeSheetTheme(select.value));
        // Do not wait for the debounced refresh: the selector may still have focus.
        paintSheetTheme(sheet.element);
      } catch (err) {
        paintSheetTheme(sheet.element);
        notifyError("SF2eTSC.errors.generic", { message: err.message });
      }
    });
  });
}
