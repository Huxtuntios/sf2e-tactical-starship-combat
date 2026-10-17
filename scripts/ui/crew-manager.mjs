import { wireSheetTheme, sheetThemeOptions } from "./sheet/sheet-theme.mjs";
import { TscApp, tpl } from "./base-app.mjs";
import { allStarships, readStarship } from "../starship/starship-state.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { Crew } from "../crew/crew-service.mjs";
import { notifyError } from "../utils/logging.mjs";
import { crewShipView, wireCrewSelects } from "../crew/crew-view.mjs";

const guard = (fn) =>
  async function (...a) {
    try {
      return await fn.apply(this, a);
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  };

/** Crew Manager: Character | Player | Role | Station | Ready, for every player ship. Same card as the starship sheet "Crew" tab. */
export class CrewManager extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-crew-manager",
    classes: ["sf2e-tsc", "tsc-crew-manager"],
    window: { title: "SF2eTSC.ui.crewManager", icon: "fa-solid fa-users" },
    position: { width: 760, height: 460 },
    actions: {
      claim: guard(CrewManager.#claim),
      force: guard(CrewManager.#force),
      unhelm: guard(CrewManager.#unhelm),
      ready: guard(CrewManager.#ready),
      remove: guard(CrewManager.#remove)
    }
  };
  static PARTS = { main: { template: tpl("crew-panel") } };
  channels = ["combat", "actor", "crew", "sheetTheme"];
  async _prepareContext() {
    const combat = activeStarshipCombat();
    const isGM = game.user.isGM;
    const ships = allStarships()
      .filter((s) => ["player", "ally"].includes(readStarship(s).role))
      .map((ship) => crewShipView(ship, { combat, isGM }))
      .filter(Boolean);
    return { ships, isGM, empty: !ships.length, sheetThemes: sheetThemeOptions() };
  }
  _onRender(context, options) {
    super._onRender?.(context, options);
    wireSheetTheme(this);
    wireCrewSelects(this.element, () => this.render());
  }
  static async #claim(e, t) {
    await Crew.claim(t.dataset.shipUuid, t.dataset.stationId, t.dataset.crewUuid, false);
    this.render();
  }
  static async #force(e, t) {
    await Crew.claim(t.dataset.shipUuid, t.dataset.stationId, t.dataset.crewUuid, true);
  }
  static async #unhelm(e, t) {
    await Crew.release(t.dataset.shipUuid, t.dataset.stationId, t.dataset.crewUuid);
  }
  static async #ready(e, t) {
    await Crew.setReady(t.dataset.shipUuid, t.dataset.crewUuid, t.dataset.ready !== "true");
  }
  static async #remove(e, t) {
    await Crew.remove(t.dataset.shipUuid, t.dataset.crewUuid);
  }
}
