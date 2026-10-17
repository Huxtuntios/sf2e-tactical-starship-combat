/** Shared constants. No Foundry globals are touched here so the file can be imported by unit tests. */
export const MODULE_ID = "sf2e-tactical-starship-combat";
export const MODULE_TITLE = "SF2e Tactical Starship Combat";
export const LOG_PREFIX = "[SF2e Tactical Starship Combat]";
export const DATA_VERSION = 2; // 2 (0.9.1): station.upgrades folded into the ship-wide upgrades list (stationId)
/** Tag ("Other tags" on the item sheet) carried by every item and action this module creates or ships. */
export const STARSHIP_TAG = "starship";
export const SOCKET_EVENT = `module.${MODULE_ID}`;

/** Flag keys (all module data lives under flags.<MODULE_ID>.<key>). */
export const FLAGS = Object.freeze({
  STARSHIP: "starship",
  HAZARD: "starshipHazard",
  COMBAT: "tsc"
});

export const GRADES = Object.freeze(["commercial", "tactical", "advanced", "superior", "elite", "ultimate", "paragon"]);
export const GRADE_UPGRADE_SLOTS = Object.freeze({
  commercial: 0,
  tactical: 1,
  advanced: 2,
  superior: 2,
  elite: 3,
  ultimate: 3,
  paragon: 4
});

export const STATION_TYPES = Object.freeze(["pilot", "generator", "gunnery", "scanners", "magic-conduit", "drone-console", "custom"]);
export const STARSHIP_ROLES = Object.freeze(["player", "npc", "ally", "neutral", "autonomous", "living"]);
export const HEADINGS = Object.freeze(["left", "right"]);
export const DETECTION_LEVELS = Object.freeze(["undetected", "hidden", "observed", "identified"]);
export const STATUS_STATES = Object.freeze(["operational", "off-kilter", "compromised", "inoperable", "wrecked", "destroyed"]);
export const CREW_ROLES = Object.freeze(["captain", "crew", "observer"]);
export const CONTACT_STYLES = Object.freeze(["greek", "numeric", "naval", "custom"]);
export const ZONE_LIMITS = Object.freeze({ min: 3, max: 50, default: 12 });

export const GREEK = Object.freeze([
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Epsilon",
  "Zeta",
  "Eta",
  "Theta",
  "Iota",
  "Kappa",
  "Lambda",
  "Mu",
  "Nu",
  "Xi",
  "Omicron",
  "Pi",
  "Rho",
  "Sigma",
  "Tau",
  "Upsilon",
  "Phi",
  "Chi",
  "Psi",
  "Omega"
]);
export const NAVAL = Object.freeze([
  "Alfa",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliett",
  "Kilo",
  "Lima",
  "Mike",
  "November",
  "Oscar",
  "Papa",
  "Quebec",
  "Romeo",
  "Sierra",
  "Tango",
  "Uniform",
  "Victor",
  "Whiskey",
  "Xray",
  "Yankee",
  "Zulu"
]);

export const HOOK_EVENTS = Object.freeze({
  combatStarted: "sf2eTsc.starshipCombatStarted",
  combatEnded: "sf2eTsc.starshipCombatEnded",
  moved: "sf2eTsc.starshipMoved",
  headingChanged: "sf2eTsc.starshipHeadingChanged",
  actionExecuted: "sf2eTsc.starshipActionExecuted",
  damaged: "sf2eTsc.starshipDamaged",
  destroyed: "sf2eTsc.starshipDestroyed",
  compromised: "sf2eTsc.starshipCompromised",
  stationMalfunctioned: "sf2eTsc.stationMalfunctioned",
  hazardTriggered: "sf2eTsc.hazardTriggered",
  hazardDisabled: "sf2eTsc.hazardDisabled",
  targetIdentified: "sf2eTsc.targetIdentified",
  crewChanged: "sf2eTsc.crewChanged",
  stationClaimed: "sf2eTsc.stationClaimed"
});

/** Degree of success numeric values (same ordering as the system's DegreeOfSuccess enum). */
export const DEGREE = Object.freeze({ CRITICAL_FAILURE: 0, FAILURE: 1, SUCCESS: 2, CRITICAL_SUCCESS: 3 });
export const DEGREE_KEYS = Object.freeze(["criticalFailure", "failure", "success", "criticalSuccess"]);
