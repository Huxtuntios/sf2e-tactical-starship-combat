import { safeImagePath } from "../sensor/appearance.mjs";
import { objectType } from "../sensor/object-types.mjs";
import { normalizeDetection } from "./presets.mjs";
import { ct } from "../content/content-i18n.mjs";
import { advanceEffects } from "../starship/effect-timing.mjs";
import { MODULE_ID, FLAGS, HOOK_EVENTS } from "../constants.mjs";
import { defaultSensorState, addObject } from "../engine/sensor-ops.mjs";
import { activeStarshipCombat, getTsc, saveTsc, isStarshipCombat, mutateTsc } from "./tsc-state.mjs";
import { readStarship, patchStarship, isStarship } from "../starship/starship-state.mjs";
import { turnKey } from "../engine/cost.mjs";
import { pruneExpired } from "../starship/effects.mjs";
import { runHullIntegrityCheck } from "./hull-integrity.mjs";
import { HazardEngine, isStarshipHazard, hazardFlags } from "../hazards/hazard-engine.mjs";
import { Initiative } from "./initiative.mjs";
import { expandEntries, actorForCopy } from "./copies.mjs";
import { hazardStealthDC } from "../hazards/hazard-stealth.mjs";
import { syncCrewCombatants } from "./crew-sync.mjs";
import { registerHandler, emitClientEvent } from "../socket.mjs";
import { moduleSetting, isActiveGM, T, fromUuidSafe } from "../utils/foundry.mjs";
import { notifyInfo, notifyWarn, log } from "../utils/logging.mjs";

/** Start Tactical Starship Combat: create/reuse the Combat, seed the sensor map and add combatants. */
export async function startStarshipCombat(config) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  let combat = game.combat;
  if (!combat) combat = await Combat.create({ scene: canvas.scene?.id ?? null, active: true });
  const zones = config.zones ?? moduleSetting("sensorMapSize");
  let state = defaultSensorState({ enabled: true, zones, orientation: "horizontal" });
  const docs = [];
  const sceneTokens = canvas.scene?.tokens ?? [];
  const addCombatant = (actor, extra = {}) => {
    if (!actor || combat.combatants.some((c) => c.actorId === actor.id) || docs.some((d) => d.actorId === actor.id)) return;
    const tok = sceneTokens.find?.((t) => t.actorId === actor.id);
    docs.push({ actorId: actor.id, tokenId: tok?.id ?? null, sceneId: tok ? canvas.scene.id : null, ...extra });
  };
  let i = 0;
  for (const uuid of config.playerShips ?? []) {
    const ship = await fromUuidSafe(uuid);
    if (!ship) continue;
    const d = readStarship(ship);
    state = addObject(state, {
      key: ship.uuid,
      actorUuid: ship.uuid,
      type: "starship",
      name: ship.name,
      zone: config.positions?.[uuid] ?? 2 + i * 2,
      heading: d.heading ?? "right",
      level: d.level,
      detection: { party: normalizeDetection(config.detections?.[uuid], "identified") }
    });
    await patchStarship(ship, (x) => {
      x.heading = x.heading ?? "right";
      x.effects = [];
      for (const st of x.stations) {
        st.malfunctioning = false;
      }
      if (x.stations.some((s) => s.type === "generator")) x.sp.value = x.sp.max;
    });
    i++;
  }
  let e = 0;
  for (const entry of expandEntries(config.enemies)) {
    const ship = await actorForCopy(await fromUuidSafe(entry.uuid), entry);
    if (!ship) continue;
    const d = readStarship(ship);
    state = addObject(state, {
      key: ship.uuid,
      actorUuid: ship.uuid,
      type: "starship",
      name: ship.name,
      zone: entry.zone ?? Math.max(1, zones - 1 - e * 2),
      heading: entry.heading ?? "left",
      level: d.level,
      detection: { party: entry.detection ?? "observed" }
    });
    addCombatant(ship);
    e++;
  }
  let h = 0;
  for (const entry of expandEntries(config.hazards)) {
    const hz = await actorForCopy(await fromUuidSafe(entry.uuid), entry);
    if (!hz) continue;
    const stealth = hazardStealthDC(hz);
    state = addObject(state, {
      key: hz.uuid,
      actorUuid: hz.uuid,
      type: "hazard",
      name: hz.name,
      zone: entry.zone ?? Math.ceil(zones / 2) + h,
      level: hz.system?.details?.level?.value ?? 0,
      stealthDC: stealth,
      icon: "⚠",
      detection: { party: stealth ? "undetected" : "observed" }
    });
    state.hazardState[hz.uuid] = { disabled: false, placement: entry.map ?? "sensor" };
    if (hz.system?.details?.isComplex) addCombatant(hz);
    h++;
  }
  for (const o of config.objects ?? []) {
    if (!o?.name) continue;
    state = addObject(state, {
      key: foundry.utils.randomID(10),
      name: String(o.name),
      type: objectType(o.type),
      art: safeImagePath(o.art),
      zone: Math.min(Math.max(1, Number(o.zone) || 1), zones),
      heading: null,
      span: 1,
      detection: { party: "observed" }
    });
  }
  if (docs.length) await combat.createEmbeddedDocuments("Combatant", docs);
  await saveTsc(combat, state);
  // crew of the selected player ships joins automatically (wizard deselections arrive as excludeCrew; extra
  // characters picked in the wizard / API arrive as crew). Idempotent: existing combatants keep their initiative.
  const crewSync = await syncCrewCombatants(combat, config.playerShips ?? [], {
    exclude: config.excludeCrew ?? [],
    extra: config.crew ?? [],
    notify: true
  });
  log.info("crew sync at combat start", crewSync);
  for (const uuid of config.playerShips ?? []) {
    const ship = await fromUuidSafe(uuid);
    if (ship) await Initiative.addPlayerShipCombatant(combat, ship);
  }
  if (moduleSetting("smallCrewWarning")) {
    for (const uuid of config.playerShips ?? []) {
      const ship = await fromUuidSafe(uuid);
      const n = ship ? readStarship(ship).crew.filter((c) => c.role !== "observer").length : 0;
      if (ship && n < 4) notifyWarn("SF2eTSC.ui.smallCrew", { ship: ship.name, count: n });
    }
  }
  Hooks.callAll(HOOK_EVENTS.combatStarted, combat, state);
  emitClientEvent("openSensorMap", { combatId: combat.id });
  return combat;
}

export async function setStarshipCombatEnabled(combat, enabled) {
  if (!game.user.isGM) return;
  // never update a stale/deleted Combat object (would throw "does not exist in the CombatEncounters collection")
  combat = combat?.id ? game.combats.get(combat.id) : null;
  if (!combat) return notifyWarn("SF2eTSC.errors.combatMissing");
  await mutateTsc(combat, (s) => ({ ...s, enabled }));
  if (!enabled) {
    await cleanupEndedCombat(combat);
    closeTacticalApps();
    Hooks.callAll(HOOK_EVENTS.combatEnded, combat);
  } else Hooks.callAll(HOOK_EVENTS.combatStarted, combat, getTsc(combat));
}

/** Per-turn processing (active GM only). */
async function onTurnChange(combat) {
  const state = foundry.utils.deepClone(getTsc(combat));
  const cb = combat.combatant;
  // Turn-index corrections (e.g. after a compromised ship is inserted before the current combatant) also fire
  // updateCombat with a "turn" change. Only a genuinely new turn (round + combatant) may reset budgets/effects.
  const key = turnKey(combat);
  if (key && state.lastTurnKey === key) return;
  const previous = state.lastEffectTurn ?? null;
  state.lastEffectTurn = { id: cb?.id ?? null, round: combat.round, turn: combat.turn };
  state.lastTurnKey = key;
  // expire effects / timed malfunctions / repair lockouts
  for (const o of state.objects) {
    if (o.type !== "starship") continue;
    const ship = await fromUuidSafe(o.actorUuid ?? o.key);
    if (!ship || !isStarship(ship)) continue;
    const data = readStarship(ship);
    const expired = pruneExpired(data.effects, combat, previous);
    const { keep, reminders } = advanceEffects(expired.keep, combat, previous);
    let changed = expired.removed.length > 0 || reminders.length > 0;
    for (const effect of reminders) {
      const esc = foundry.utils.escapeHTML;
      await ChatMessage.create({
        whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
        content: `<p>${esc(ship.name)}: ${esc(T("SF2eTSC.qol.sustainReminder"))} — ${esc(ct(effect.label))}</p>`
      });
    }
    for (const st of data.stations) {
      if (cb?.actor && st.malfunctionUntilTurnOf === cb.actor.uuid) {
        st.malfunctioning = false;
        st.malfunctionUntilTurnOf = null;
        changed = true;
      }
      if (cb?.actor && st.repairLockedUntilTurnOf === cb.actor.uuid) {
        st.repairLockedUntilTurnOf = null;
        changed = true;
      }
    }
    if (changed)
      await patchStarship(
        ship,
        (d) => {
          d.effects = keep;
          d.stations = data.stations;
        },
        { reason: T("SF2eTSC.qol.turnTiming"), undoable: false }
      );
  }
  await saveTsc(combat, state);
  await HazardEngine.processResets(combat);
  if (!cb) return;
  const mark = cb.flags?.[MODULE_ID];
  if (mark?.compromisedEntry) {
    const ship = await fromUuidSafe(mark.shipUuid);
    if (ship) await runHullIntegrityCheck(ship, combat);
    if (combat.combatant?.id === cb.id) await combat.nextTurn();
    return;
  }
  if (cb.actor && isStarshipHazard(cb.actor) && hazardFlags(cb.actor)?.isComplex !== false) await HazardEngine.onHazardTurn(cb);
}

/** Auto-detect starship combat when a starship/hazard actor joins an encounter (explicit toggle always available). */
async function onCreateCombatant(combatant) {
  if (!isActiveGM()) return;
  const combat = combatant.combat;
  const actor = combatant.actor;
  if (!combat || isStarshipCombat(combat) || combat.flags?.[MODULE_ID]?.[FLAGS.COMBAT]?.autoDetectDisabled) return;
  if (combatant.flags?.[MODULE_ID]?.compromisedEntry) return;
  if (isStarship(actor) || isStarshipHazard(actor)) {
    const zones = moduleSetting("sensorMapSize");
    await saveTsc(combat, defaultSensorState({ enabled: true, zones, orientation: "horizontal" }));
    notifyInfo("SF2eTSC.ui.autoEnabled");
  }
}

export const TACTICAL_APP_IDS = ["sf2e-tsc-sensor-map", "sf2e-tsc-station-hud", "sf2e-tsc-crew-manager"];
/** Close sensor map / station HUD / crew manager when no tactical combat remains. */
export function closeTacticalApps() {
  setTimeout(() => {
    if (activeStarshipCombat()) return;
    for (const id of TACTICAL_APP_IDS)
      foundry.applications.instances
        .get(id)
        ?.close()
        .catch(() => null);
  }, 50);
}
/** Reset combat-only ship state (temporary effects, malfunctions, headings) after the encounter ends. */
async function cleanupEndedCombat(combat) {
  const tsc = getTsc(combat);
  for (const o of tsc.objects ?? []) {
    if (o.type !== "starship") continue;
    const ship = await fromUuidSafe(o.actorUuid ?? o.key);
    if (!ship || !isStarship(ship)) continue;
    await patchStarship(ship, (d) => {
      d.effects = [];
      for (const st of d.stations) {
        st.malfunctioning = false;
        st.malfunctionUntilTurnOf = null;
        st.repairLockedUntilTurnOf = null;
      }
    });
  }
}

export function registerCombatHooks() {
  Hooks.on("updateCombat", (combat, changes) => {
    if (!isActiveGM() || !isStarshipCombat(combat)) return;
    if ("turn" in changes || "round" in changes) onTurnChange(combat).catch((err) => log.error("turn processing failed", err));
  });
  Hooks.on("createCombatant", (c) => onCreateCombatant(c).catch((err) => log.error("auto-detect failed", err)));
  Hooks.on("deleteCombat", (combat) => {
    if (!isStarshipCombat(combat)) return;
    closeTacticalApps();
    if (isActiveGM()) {
      cleanupEndedCombat(combat).catch((err) => log.error("combat cleanup failed", err));
      Hooks.callAll(HOOK_EVENTS.combatEnded, combat);
    }
  });
  Hooks.on("updateCombat", (combat, changes) => {
    // "End tactical combat" (flag disabled) also closes the tactical windows everywhere
    if (changes.flags?.[MODULE_ID]?.[FLAGS.COMBAT]?.enabled === false) closeTacticalApps();
  });
  registerHandler("setReadyDone", async ({ payload }) => payload);
}
