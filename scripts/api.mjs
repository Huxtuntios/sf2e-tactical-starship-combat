import { MODULE_ID, HOOK_EVENTS } from "./constants.mjs";
import { isStarship, readStarship } from "./starship/starship-state.mjs";
import { isStarshipCombat, getTsc, activeStarshipCombat } from "./combat/tsc-state.mjs";
import { startStarshipCombat } from "./combat/starship-combat.mjs";
import { executeAction } from "./actions/action-engine.mjs";
import { request } from "./socket.mjs";
import { HazardEngine, isStarshipHazard, placeHazard } from "./hazards/hazard-engine.mjs";
import { Content } from "./content/loader.mjs";
import { Importer } from "./content/importer.mjs";
import { Ship } from "./starship/ship-service.mjs";
import { Crew } from "./crew/crew-service.mjs";
import { openSensorMap, openStarshipSheet, openNPCStarshipSheet, openBrowser, openBuilder, openDashboard } from "./ui/launchers.mjs";
import { calculateZoneDistance } from "./engine/range.mjs";
import { convertToStarship } from "./ui/controls.mjs";
import { syncCrewCombatants } from "./combat/crew-sync.mjs";
import { repairAllCrewAssignments } from "./crew/crew-service.mjs";

/** game.modules.get("sf2e-tactical-starship-combat").api */
export function buildApi() {
  return {
    version: game.modules.get(MODULE_ID)?.version ?? "0.1.0",
    events: HOOK_EVENTS,
    openSensorMap,
    openStarshipSheet,
    openNPCStarshipSheet,
    openHazardBrowser: () => openBrowser("hazards"),
    openStarshipBuilder: openBuilder,
    openDashboard,
    startStarshipCombat: (config) => startStarshipCombat(config),
    isStarship: (actor) => isStarship(actor),
    isStarshipHazard: (actor) => isStarshipHazard(actor),
    isStarshipCombat: (combat = game.combat) => isStarshipCombat(combat),
    getStarshipState: (actor) => readStarship(actor),
    getSensorState: (combat = activeStarshipCombat()) => getTsc(combat),
    moveStarship: (actor, zone) => Ship.setZone(actor.uuid, zone),
    changeHeading: (actor) => request("sensorUpdate", { op: "flip", combatId: activeStarshipCombat().id, key: actor.uuid }),
    executeStarshipAction: (params) => request("executeAction", params),
    executeStarshipActionAsGM: (params) => executeAction({ userId: game.user.id, user: game.user, ...params }),
    /** Idempotent crew → Combatant sync (GM). shipUuids=null: every player ship on the sensor map. */
    syncCrewCombatants: (combat = activeStarshipCombat(), shipUuids = null, opts = {}) => syncCrewCombatants(combat, shipUuids, opts),
    /** GM repair of station.helmedBy ↔ crew.stationId on every starship. */
    repairCrewAssignments: () => repairAllCrewAssignments(),
    /** Post an attack declaration card (no roll, nothing spent). */
    declareAttack: (params) => request("declareAttack", params),
    applyStarshipDamage: ({ actor, amount, ...opts }) => Ship.damage(actor.uuid, amount, opts),
    triggerHazard: (uuid, opts) => HazardEngine.trigger(uuid, opts),
    disableHazard: (uuid, mode = "disable") => HazardEngine.disable(uuid, mode),
    placeHazard: (actor, opts) => placeHazard(actor, opts),
    distance: calculateZoneDistance,
    convertToStarship,
    crew: Crew,
    ship: Ship,
    content: Content,
    importer: Importer
  };
}
