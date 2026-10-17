import { MODULE_ID, CONTACT_STYLES } from "./constants.mjs";

const reg = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...data });
const L = (k) => `SF2eTSC.settings.${k}`;

export function registerSettings() {
  reg("starshipSheetTheme", {
    name: L("starshipSheetTheme.name"),
    hint: L("starshipSheetTheme.hint"),
    scope: "client",
    type: String,
    default: "dark",
    choices: { dark: L("starshipSheetTheme.dark"), light: L("starshipSheetTheme.light") },
    onChange: async () => {
      const { refreshApps } = await import("./ui/base-app.mjs");
      refreshApps("sheetTheme");
      const { refreshActionThemes } = await import("./ui/action-sheet-theme.mjs");
      refreshActionThemes();
    }
  });
  reg("sensorMapSize", { name: L("sensorMapSize.name"), hint: L("sensorMapSize.hint"), type: Number, default: 12 });
  reg("combatPresets", { config: false, type: Object, default: {} });
  reg("ruleEnforcement", {
    name: L("ruleEnforcement.name"),
    hint: L("ruleEnforcement.hint"),
    type: String,
    default: "warn",
    choices: { warn: L("ruleEnforcement.warn"), strict: L("ruleEnforcement.strict") }
  });
  reg("attackCards", { name: L("attackCards.name"), hint: L("attackCards.hint"), type: Boolean, default: true });
  reg("autoOpenSensorMap", {
    name: L("autoOpenSensorMap.name"),
    hint: L("autoOpenSensorMap.hint"),
    type: Boolean,
    default: true,
    scope: "client"
  });
  reg("autoRoutine", {
    name: L("autoRoutine.name"),
    hint: L("autoRoutine.hint"),
    type: String,
    default: "prompt",
    choices: { off: L("autoRoutine.off"), prompt: L("autoRoutine.prompt"), automatic: L("autoRoutine.automatic") }
  });
  reg("contactDesignation", {
    name: L("contactDesignation.name"),
    type: String,
    default: "greek",
    choices: Object.fromEntries(CONTACT_STYLES.map((s) => [s, L(`contactDesignation.${s}`)]))
  });
  reg("showUnknownContacts", { name: L("showUnknownContacts.name"), hint: L("showUnknownContacts.hint"), type: Boolean, default: true });
  reg("playerShipInitiative", {
    name: L("playerShipInitiative.name"),
    hint: L("playerShipInitiative.hint"),
    type: String,
    default: "disabled",
    choices: {
      disabled: L("playerShipInitiative.disabled"),
      beforeCrew: L("playerShipInitiative.beforeCrew"),
      afterCrew: L("playerShipInitiative.afterCrew"),
      manual: L("playerShipInitiative.manual")
    }
  });
  reg("crewInitiativeScope", {
    name: L("crewInitiativeScope.name"),
    hint: L("crewInitiativeScope.hint"),
    type: String,
    default: "crew",
    choices: { crew: L("crewInitiativeScope.crew"), stationed: L("crewInitiativeScope.stationed"), off: L("crewInitiativeScope.off") }
  });
  reg("movementMode", {
    name: L("movementMode.name"),
    hint: L("movementMode.hint"),
    type: String,
    default: "clamp",
    choices: { clamp: L("movementMode.clamp"), strict: L("movementMode.strict") }
  });
  reg("autoFireConeZones", {
    name: L("autoFireConeZones.name"),
    hint: L("autoFireConeZones.hint"),
    type: Number,
    default: 0,
    range: { min: 0, max: 10, step: 1 }
  });
  reg("areaWeaponZones", {
    name: L("areaWeaponZones.name"),
    hint: L("areaWeaponZones.hint"),
    type: Number,
    default: 0,
    range: { min: 0, max: 10, step: 1 }
  });
  reg("smallCrewWarning", { name: L("smallCrewWarning.name"), type: Boolean, default: true });
  reg("causodesConflict", {
    name: L("causodesConflict.name"),
    hint: L("causodesConflict.hint"),
    type: String,
    default: "warn",
    choices: { warn: L("causodesConflict.warn"), ignore: L("causodesConflict.ignore") }
  });
  reg("debugLogging", { name: L("debugLogging.name"), type: Boolean, default: false });
  // hidden world data
  game.settings.register(MODULE_ID, "worldFixVersion", { scope: "world", config: false, type: Number, default: 0 });
  game.settings.register(MODULE_ID, "dataVersion", { scope: "world", config: false, type: Number, default: 0 });
  game.settings.register(MODULE_ID, "customContent", {
    scope: "world",
    config: false,
    type: Object,
    default: { actions: [], weapons: [], stations: [], upgrades: [], ships: [], hazards: [] }
  });
  game.settings.register(MODULE_ID, "uiState", { scope: "client", config: false, type: Object, default: {} });
}
