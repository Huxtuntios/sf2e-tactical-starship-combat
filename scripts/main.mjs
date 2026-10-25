import { registerActionSheetThemes } from "./ui/action-sheet-theme.mjs";
import { registerHistoryHandlers } from "./history/history.mjs";
import { registerEffectHandlers } from "./starship/effect-service.mjs";
import { registerStarshipStatistics } from "./starship/statistics-bridge.mjs";
import { registerToolbeltDamage } from "./integrations/toolbelt-damage.mjs";
import { MODULE_ID, MODULE_TITLE, DATA_VERSION, HOOK_EVENTS } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { loadContent } from "./content/loader.mjs";
import { loadContentTranslations } from "./content/content-i18n.mjs";
import { initSocket, onClientEvent } from "./socket.mjs";
import { registerCrewHandlers } from "./crew/crew-service.mjs";
import { registerActionHandlers } from "./actions/action-engine.mjs";
import { registerReactionHandlers } from "./actions/reactions.mjs";
import { registerShipHandlers } from "./starship/ship-service.mjs";
import { registerSensorHandlers } from "./ui/sensor-map-app.mjs";
import { registerCombatHooks } from "./combat/starship-combat.mjs";
import { registerCrewSyncHooks } from "./combat/crew-sync.mjs";
import { registerAttackCards } from "./chat/attack-card.mjs";
import { registerStationItems } from "./crew/station-items.mjs";
import { decorateTracker } from "./combat/tracker.mjs";
import { registerControls } from "./ui/controls.mjs";
import { StarshipSheet, NPCStarshipSheet } from "./ui/starship-sheet.mjs";
import { refreshApps } from "./ui/base-app.mjs";
import { openSensorMap } from "./ui/launchers.mjs";
import { isStarship, readStarship } from "./starship/starship-state.mjs";
import { needsMigration, migrate } from "./engine/migration.mjs";
import { checkCausodesConflict } from "./integrations/causodes.mjs";
import { buildApi } from "./api.mjs";
import { registerActorCreation } from "./ui/actor-create.mjs";
import { registerPackDrop } from "./starship/pack-drop.mjs";
import { repairWorld, registerItemTagging } from "./content/world-maintenance.mjs";
import { registerConditionEnricher } from "./content/condition-enricher.mjs";
import { log, guarded } from "./utils/logging.mjs";
import { UPGRADE_USAGE } from "./engine/upgrades.mjs";
import { registerUpgradePartials } from "./ui/sheet/sheet-upgrades.mjs";
import { OCCUPANT_PARTIAL, isCrewMember, invalidateCrewIndex } from "./crew/occupant.mjs";
import { moduleSetting, isActiveGM, T } from "./utils/foundry.mjs";
import { systemSupport, missingStarfinderSkills } from "./utils/system.mjs";

let enabled = false;

const TEMPLATES = [
  "sensor-map-bar",
  "sensor-map-zones",
  "sensor-map-detail",
  "map-appearance",
  "sensor-map-dock",
  "starship-sheet",
  "starship-sheet-header",
  "starship-sheet-tabs",
  "station-hud",
  "crew-panel",
  "crew-ship",
  "hazard-browser",
  "start-wizard",
  "starship-builder",
  "encounter-builder",
  "ship-editor"
].map((n) => `modules/${MODULE_ID}/templates/${n}.hbs`);

Hooks.once("init", () => {
  const support = systemSupport();
  if (!support.supported) {
    log.warn(`Unsupported environment (${game.system.id}): ${support.key}. Module stays inactive.`);
    return;
  }
  enabled = true;
  registerSettings();
  Handlebars.registerPartial("tscOccupant", OCCUPANT_PARTIAL);
  registerUpgradePartials(Handlebars);
  Handlebars.registerHelper("dotsafe", (s) => String(s ?? "").replace(/\./g, "__DOT__"));
  const DSC = foundry.applications.apps.DocumentSheetConfig;
  DSC.registerSheet(Actor, MODULE_ID, StarshipSheet, { types: ["vehicle"], makeDefault: false, label: "SF2eTSC.ui.starshipSheet" });
  DSC.registerSheet(Actor, MODULE_ID, NPCStarshipSheet, { types: ["npc"], makeDefault: false, label: "SF2eTSC.ui.npcStarshipSheet" });
  foundry.applications.handlebars.loadTemplates(TEMPLATES);
  game.modules.get(MODULE_ID).api = buildApi();
  registerActorCreation();
  registerConditionEnricher();
  registerUpgradeUsages();
  registerItemTagging();
  registerActionSheetThemes();
  log.info(`${MODULE_TITLE} initialized`);
});

/**
 * usage keys of the "Starship Upgrades" items ("installed-in-a-generator" …). sf2e parses any installed-in-* key
 * as an installed item; registering the labels lets the item sheet show and keep the value. Existing keys are kept.
 */
function registerUpgradeUsages() {
  const usages = CONFIG.PF2E?.usages;
  if (!usages || typeof usages !== "object") return;
  for (const [station, key] of Object.entries(UPGRADE_USAGE)) if (!(key in usages)) usages[key] = `SF2eTSC.upgrades.usageKey.${station}`;
}

Hooks.once("ready", async () => {
  const support = systemSupport();
  if (!enabled || !support.supported) {
    if (!support.supported) ui.notifications.error(T(`SF2eTSC.compatibility.${support.key}`));
    return;
  }
  const missing = missingStarfinderSkills();
  if (missing.length) {
    ui.notifications.error(T("SF2eTSC.compatibility.skillsMissing", { skills: missing.join(", ") }));
    return;
  }
  await guarded("content", () => loadContent());
  await guarded("content-i18n", () => loadContentTranslations(game.i18n.lang));
  await guarded("starship statistics", () => registerStarshipStatistics());
  initSocket();
  for (const fn of [
    registerCrewHandlers,
    registerActionHandlers,
    registerReactionHandlers,
    registerShipHandlers,
    registerEffectHandlers,
    registerHistoryHandlers,
    registerSensorHandlers
  ])
    fn();
  registerAttackCards();
  registerToolbeltDamage();
  registerStationItems();
  registerCombatHooks();
  registerCrewSyncHooks();
  registerControls();
  checkCausodesConflict();
  registerRefreshHooks();
  onClientEvent("openSensorMap", () => {
    if (moduleSetting("autoOpenSensorMap")) openSensorMap();
  });
  if (isActiveGM()) {
    await guarded("migration", migrateAll);
    await guarded("world repair", repairWorld);
    await guarded("schema stamp", stampSystemSchema);
  }
  ui.combat?.render();
});

/**
 * starships/hazards created by older module versions had no `system._migration.version`, so sf2e 1.6.0 treated
 * them as "older schema" on every world load. They were always built against the current schema, so we only stamp the
 * version (never lower an existing one). Only documents owned by this module are touched.
 */
async function stampSystemSchema() {
  const { schemaStamp } = await import("./content/action-docs.mjs");
  const stamp = schemaStamp();
  const ours = (a) => isStarship(a) || !!a.flags?.[MODULE_ID]?.starshipHazard;
  const updates = game.actors
    .filter((a) => ours(a) && !(Number(a._source?.system?._migration?.version) > 0))
    .map((a) => ({ _id: a.id, "system._migration": stamp }));
  if (updates.length) {
    await Actor.updateDocuments(updates);
    log.info(`stamped ${game.system.id} schema ${stamp.version} on ${updates.length} module actors`);
  }
}

/** Migrate legacy/unversioned starship flags (active GM only, once per world version). */
async function migrateAll() {
  const done = game.settings.get(MODULE_ID, "dataVersion");
  if (done >= DATA_VERSION) return;
  let n = 0;
  for (const actor of game.actors.filter(isStarship)) {
    const raw = actor.flags[MODULE_ID].starship;
    if (needsMigration(raw)) {
      const { data } = migrate(raw);
      await actor.update({ [`flags.${MODULE_ID}.starship`]: data });
      n++;
    }
  }
  await game.settings.set(MODULE_ID, "dataVersion", DATA_VERSION);
  if (n) log.info(`migrated ${n} starships to dataVersion ${DATA_VERSION}`);
}

/** Document updates / hooks drive every refresh (no polling). */
function registerRefreshHooks() {
  const tracker = foundry.utils.debounce(() => ui.combat?.render(), 120);
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if (!isStarship(actor)) return;
    options.tscOld = { hp: actor.system.attributes.hp.value, sp: readStarship(actor).sp.value };
  });
  // crew portraits / names / skills / saves / proficiencies / equipment / effects feed the ship (attack bonus, check
  // modifiers, DCs, AC from the pilot): any change of a crew member refreshes the windows that show it
  for (const hook of ["createChatMessage", "updateChatMessage", "deleteChatMessage"])
    Hooks.on(hook, (message) => {
      if (game.user.isGM && message.flags?.[MODULE_ID]?.history) refreshApps("history");
    });
  const crewChanged = (actor) => {
    if (actor instanceof Actor && !isStarship(actor) && isCrewMember(actor)) refreshApps("crew", actor);
  };
  Hooks.on("updateActor", (actor, changes, options) => {
    if (isStarship(actor)) {
      if (changes?.flags?.[MODULE_ID]) invalidateCrewIndex();
    } else crewChanged(actor);
    const relevant = isStarship(actor) || actor.flags?.[MODULE_ID]?.starshipHazard;
    if (!relevant && !game.combat?.combatants.some((c) => c.actorId === actor.id)) return;
    refreshApps("actor", actor);
    if (relevant) {
      tracker();
      floatingText(actor, options);
    }
  });
  for (const h of ["createActor", "deleteActor"])
    Hooks.on(h, (actor) => {
      invalidateCrewIndex();
      if (h === "deleteActor") crewChanged(actor);
    });
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, (item) => crewChanged(item?.parent));
  for (const h of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"])
    Hooks.on(h, (fx) => crewChanged(fx?.parent instanceof Actor ? fx.parent : fx?.parent?.parent));
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (changes.texture || "name" in changes) crewChanged(tokenDoc.actor);
  });
  for (const h of ["updateCombat", "createCombat", "deleteCombat", "updateCombatant", "createCombatant", "deleteCombatant"])
    Hooks.on(h, () => {
      refreshApps("combat");
    });
  registerPackDrop();
  Hooks.on("renderCombatTracker", (app, html) => decorateTracker(app, html));
  Hooks.on("updateSetting", (s) => {
    if (s.key?.startsWith(MODULE_ID)) refreshApps("settings");
  });
  Hooks.on(HOOK_EVENTS.damaged, (actor, result) => log.debug("damaged", actor.name, result));
}

/** Floating damage numbers on the ship's tokens (purely local, never source of truth). */
function floatingText(actor, options) {
  try {
    const old = options?.tscOld;
    if (!old || !canvas?.ready) return;
    const hp = actor.system.attributes.hp.value,
      sp = readStarship(actor).sp.value;
    const lines = [];
    if (hp !== old.hp)
      lines.push({ t: `${hp - old.hp > 0 ? "+" : ""}${hp - old.hp} ${T("SF2eTSC.ui.hp")}`, fill: hp < old.hp ? 0xf87171 : 0x34d399 });
    if (sp !== old.sp) lines.push({ t: `${sp - old.sp > 0 ? "+" : ""}${sp - old.sp} ${T("SF2eTSC.ui.sp")}`, fill: 0x38bdf8 });
    for (const token of canvas.tokens.placeables.filter((t) => t.actor === actor))
      lines.forEach((l, i) =>
        setTimeout(
          () =>
            canvas.interface.createScrollingText(token.center, l.t, {
              anchor: CONST.TEXT_ANCHOR_POINTS.TOP,
              fill: l.fill,
              stroke: 0x000000,
              strokeThickness: 4,
              jitter: 0.25
            }),
          i * 350
        )
      );
  } catch (err) {
    log.debug("floating text failed", err);
  }
}
