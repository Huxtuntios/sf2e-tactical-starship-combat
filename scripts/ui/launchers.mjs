/** Lazy window launchers (avoid import cycles between combat code and UI). */
export async function openSensorMap() {
  const { SensorMapApplication } = await import("./sensor-map-app.mjs");
  const { openApps } = await import("./base-app.mjs");
  const ex = openApps(SensorMapApplication)[0];
  return ex ? ex.bringToFront() : new SensorMapApplication().render(true);
}
export async function openStartWizard() {
  const { StartCombatWizard } = await import("./start-wizard.mjs");
  return new StartCombatWizard().render(true);
}
export async function openCrewManager() {
  const { CrewManager } = await import("./crew-manager.mjs");
  const { openApps } = await import("./base-app.mjs");
  const ex = openApps(CrewManager)[0];
  if (ex) {
    ex.bringToFront();
    return ex.render();
  }
  return new CrewManager().render(true);
}
export async function openStationHUD() {
  const { StationHUD } = await import("./station-hud.mjs");
  const { openApps } = await import("./base-app.mjs");
  const ex = openApps(StationHUD)[0];
  return ex ? ex.bringToFront() : new StationHUD().render(true);
}
export async function openBrowser(mode = "hazards") {
  const { ContentBrowser } = await import("./hazard-browser.mjs");
  const b = new ContentBrowser();
  b.mode = mode;
  return b.render(true);
}
export async function openBuilder() {
  const { StarshipBuilder } = await import("./starship-builder.mjs");
  return new StarshipBuilder().render(true);
}
export async function openEncounterBuilder() {
  const { EncounterBuilder } = await import("./encounter-builder.mjs");
  return new EncounterBuilder().render(true);
}
/** Dashboard: the sensor map (its dock holds the station actions) and, for the GM, the crew manager. */
export async function openDashboard() {
  await openSensorMap();
  if (game.user.isGM) await openCrewManager();
}
export async function openDiagnostics() {
  const m = await import("./diagnostics.mjs");
  return m.openDiagnostics();
}
/** GM toolbox: the rarely used windows in one place instead of one scene button each. */
export async function openToolbox() {
  const T = (k) => game.i18n.localize(k);
  const tools = [
    [
      "history",
      "fa-solid fa-clock-rotate-left",
      "SF2eTSC.qol.history",
      async () => {
        const { openHistory } = await import("./history-app.mjs");
        openHistory();
      }
    ],
    ["crew", "fa-solid fa-users", "SF2eTSC.ui.crewManager", openCrewManager],
    ["hazards", "fa-solid fa-triangle-exclamation", "SF2eTSC.ui.hazardBrowser", () => openBrowser("hazards")],
    ["builder", "fa-solid fa-screwdriver-wrench", "SF2eTSC.ui.starshipBuilder", openBuilder],
    ["encounter", "fa-solid fa-scale-balanced", "SF2eTSC.ui.encounterBuilder", openEncounterBuilder],
    ["diag", "fa-solid fa-stethoscope", "SF2eTSC.ui.diagnostics", openDiagnostics]
  ];
  return foundry.applications.api.DialogV2.wait({
    window: { title: T("SF2eTSC.ui.toolbox"), icon: "fa-solid fa-toolbox" },
    classes: ["sf2e-tsc", "tsc-toolbox-dialog"],
    position: { width: 420 },
    rejectClose: false,
    content: `<p class="tsc-hint">${T("SF2eTSC.ui.toolboxHint")}</p>`,
    buttons: tools.map(([action, icon, key, fn]) => ({
      action,
      icon,
      label: T(key),
      callback: () => {
        fn();
        return action;
      }
    }))
  });
}
export async function openStarshipSheet(actor) {
  const { StarshipSheet } = await import("./starship-sheet.mjs");
  return new StarshipSheet({ document: actor }).render(true);
}
export async function openNPCStarshipSheet(actor) {
  const { NPCStarshipSheet } = await import("./starship-sheet.mjs");
  return new NPCStarshipSheet({ document: actor }).render(true);
}
