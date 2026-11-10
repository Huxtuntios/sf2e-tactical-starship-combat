import { TscApp, tpl } from "./base-app.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { crewStationsView } from "../crew/crew-stations-view.mjs";
import { Crew } from "../crew/crew-service.mjs";
import { notifyError } from "../utils/logging.mjs";

const guard = (fn) =>
  async function (...args) {
    try {
      return await fn.apply(this, args);
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  };

/** Character-sheet companion for claiming or releasing a station during active starship combat. */
export class CrewStationsApplication extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-crew-stations",
    classes: ["sf2e-tsc", "tsc-crew-stations"],
    position: { width: 520, height: "auto" },
    window: { title: "SF2eTSC.crewStations.title", icon: "fa-solid fa-users" },
    actions: {
      claim: guard(CrewStationsApplication.#claim),
      release: guard(CrewStationsApplication.#release)
    }
  };
  static PARTS = { main: { template: tpl("crew-stations-panel") } };
  channels = ["combat", "actor", "crew"];

  constructor(actor, options = {}) {
    super({ ...options, id: `sf2e-tsc-crew-stations-${actor.id}` });
    this.actor = actor;
  }

  _prepareContext() {
    const combat = activeStarshipCombat();
    return combat ? crewStationsView(combat, this.actor) : { actorName: this.actor.name, ships: [], empty: true };
  }

  static async #claim(event, target) {
    const row = target.closest("[data-ship-row]");
    const stationId = row?.querySelector("[data-station-choice]")?.value;
    if (!stationId) return;
    await Crew.claim(target.dataset.shipUuid, stationId, this.actor.uuid);
    this.render();
  }

  static async #release(event, target) {
    await Crew.release(target.dataset.shipUuid, target.dataset.stationId, this.actor.uuid);
    this.render();
  }
}
