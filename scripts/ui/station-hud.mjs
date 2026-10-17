import { wireSheetTheme, sheetThemeOptions } from "./sheet/sheet-theme.mjs";
import { TscApp, tpl } from "./base-app.mjs";
import { buildHudContext, runHudAction } from "./hud-model.mjs";
import { Crew } from "../crew/crew-service.mjs";
import { notifyError } from "../utils/logging.mjs";

/** Floating window with the actions of the station(s) the user helms. The Sensor Map embeds the same model as a dock. */
export class StationHUD extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-station-hud",
    classes: ["sf2e-tsc", "tsc-hud"],
    window: { title: "SF2eTSC.ui.stationHud", icon: "fa-solid fa-gamepad", resizable: true, minimizable: true },
    position: { width: 320, height: "auto", top: 80, left: 120 },
    actions: {
      act: StationHUD.#act,
      repair: StationHUD.#act,
      release: StationHUD.#release,
      ready: StationHUD.#ready,
      pick: StationHUD.#pick
    }
  };
  static PARTS = { main: { template: tpl("station-hud") } };
  channels = ["combat", "actor", "crew", "sheetTheme"];
  index = 0;

  async _prepareContext() {
    return { ...buildHudContext(this.index), sheetThemes: sheetThemeOptions() };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    wireSheetTheme(this);
  }
  static async #act(event, target) {
    await runHudAction(this.index, target.dataset.actionId);
  }
  static async #release(event, target) {
    try {
      await Crew.release(target.dataset.shipUuid, target.dataset.stationId, target.dataset.crewUuid);
    } catch (e) {
      notifyError("SF2eTSC.errors.generic", { message: e.message });
    }
  }
  static async #ready(event, target) {
    try {
      await Crew.setReady(target.dataset.shipUuid, target.dataset.crewUuid, target.dataset.value === "true");
    } catch (e) {
      notifyError("SF2eTSC.errors.generic", { message: e.message });
    }
  }
  static #pick(event, target) {
    this.index = Number(target.dataset.index);
    this.render();
  }
}
