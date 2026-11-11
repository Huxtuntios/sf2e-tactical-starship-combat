import { safeImagePath } from "../sensor/appearance.mjs";
import { objectType } from "../sensor/object-types.mjs";
import { normalizeDetection, normalizePreset } from "./presets.mjs";
import { assignStation, normalizeCrewAssignments } from "../engine/crew-assignments.mjs";
import {
  createSensorActorInstance,
  ensureSensorActorCombatant,
  SENSOR_CONTACT_COMBATANT_NAME,
  SENSOR_CONTACT_COMBATANT_IMAGE
} from "../sensor/actor-instance.mjs";
import { addPrivateContact, addPrivateCustom, changePrivateContact, privateContacts } from "../sensor/private-contacts.mjs";
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
import { expandEntries } from "./copies.mjs";
import { hazardStealthDC } from "../hazards/hazard-stealth.mjs";
import { syncCrewCombatants, combatantViews } from "./crew-sync.mjs";
import { planCrewCombatants } from "../engine/crew-initiative.mjs";
import { registerHandler, emitClientEvent } from "../socket.mjs";
import { moduleSetting, isActiveGM, T, fromUuidSafe, fromUuidSync_ } from "../utils/foundry.mjs";
import { notifyInfo, notifyWarn, log } from "../utils/logging.mjs";

let startingCombat = false;

function requireSetupGM() {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.privateMap.activeGM"));
}
const sameSetupValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function prepareCombatRoster(config) {
  const input = {
    ...config,
    playerShips: (config.playerShips ?? []).map((s) => {
      const entry = typeof s === "string" ? { uuid: s } : s;
      return {
        ...entry,
        zone: entry.zone ?? config.positions?.[entry.uuid],
        detection: entry.detection ?? config.detections?.[entry.uuid] ?? "identified"
      };
    })
  };
  input.enemies = (config.enemies ?? []).map((s) => (typeof s === "string" ? { uuid: s } : s));
  input.hazards = (config.hazards ?? []).map((s) => (typeof s === "string" ? { uuid: s } : s));
  const cfg = normalizePreset({ ...input, zones: config.zones ?? moduleSetting("sensorMapSize") });
  for (const entry of [...input.playerShips, ...input.enemies, ...input.hazards]) {
    if (typeof entry?.uuid !== "string" || !entry.uuid) throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
    if (entry.zone != null && (!Number.isInteger(Number(entry.zone)) || Number(entry.zone) < 1 || Number(entry.zone) > cfg.zones))
      throw new Error(T("SF2eTSC.mapDrop.invalidZone"));
    if (entry.stationAssignments?.some((a) => typeof a?.stationId !== "string" || !a.stationId))
      throw new Error(T("SF2eTSC.wizard.setupStations"));
  }
  const specs = [
    ...cfg.playerShips.map((s, i) => ({ ...s, kind: "player", zone: s.zone ?? Math.min(cfg.zones, 2 + i * 2) })),
    ...expandEntries(cfg.enemies).map((s, i) => ({ ...s, kind: "npc", zone: s.zone ?? Math.max(1, cfg.zones - 1 - i * 2) })),
    ...expandEntries(cfg.hazards).map((s, i) => ({
      ...s,
      kind: "hazard",
      zone: s.zone ?? Math.min(cfg.zones, Math.ceil(cfg.zones / 2) + i)
    }))
  ];
  if (!specs.length && !cfg.objects.length) throw new Error(T("SF2eTSC.wizard.setupEmpty"));
  const resolved = new Map();
  const reused = new Set();
  for (const spec of specs) {
    if (!Number.isInteger(spec.zone) || spec.zone < 1 || spec.zone > cfg.zones) throw new Error(T("SF2eTSC.mapDrop.invalidZone"));
    if (!resolved.has(spec.uuid)) resolved.set(spec.uuid, await fromUuidSafe(spec.uuid));
    const actor = resolved.get(spec.uuid);
    if (
      !actor ||
      actor.documentName !== "Actor" ||
      actor.uuid !== spec.uuid ||
      (spec.kind === "hazard" ? actor.type !== "hazard" || actor.flags?.[MODULE_ID]?.starshipMine : !isStarship(actor))
    )
      throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
    spec.source = actor;
    spec.detection ??= hazardStealthDC(actor) ? "undetected" : "observed";
    spec.heading ??= spec.kind === "npc" ? "left" : (readStarship(actor).heading ?? "right");
    const originalPlayer = spec.kind === "player" && !actor.pack && !actor.isToken && readStarship(actor).role === "player";
    if (
      spec.reuse &&
      (actor.pack ||
        actor.isToken ||
        (spec.count ?? 1) !== 1 ||
        spec.detection !== "identified" ||
        (spec.kind !== "hazard" && readStarship(actor).role !== spec.kind))
    )
      throw new Error(T("SF2eTSC.wizard.setupReuse"));
    spec.copy = !originalPlayer && !spec.reuse;
    if (!spec.copy) {
      if (reused.has(actor.uuid)) throw new Error(T("SF2eTSC.wizard.setupDuplicate"));
      reused.add(actor.uuid);
    }
    validateStationAssignments(actor, spec.stationAssignments ?? []);
    if (spec.kind === "player" && moduleSetting("crewInitiativeScope") !== "off") {
      for (const member of readStarship(actor).crew) {
        if (member.role === "observer" || (cfg.excludeCrew ?? []).includes(member.actorUuid)) continue;
        const assignment = spec.stationAssignments?.find((a) => a.actorUuid === member.actorUuid);
        if (moduleSetting("crewInitiativeScope") === "stationed" && !member.stationId && !assignment) continue;
        await requireCrewActor(member.actorUuid);
      }
    }
  }
  for (const object of cfg.objects) {
    if (object.zone > cfg.zones) throw new Error(T("SF2eTSC.mapDrop.invalidZone"));
  }
  for (const uuid of cfg.crew ?? []) await requireCrewActor(uuid);
  requireSetupGM();
  return { cfg, specs };
}

async function requireCrewActor(uuid) {
  const actor = await fromUuidSafe(uuid);
  if (!actor || actor.documentName !== "Actor" || actor.type !== "character" || actor.pack || actor.isToken)
    throw new Error(T("SF2eTSC.crew.missingActor"));
  return actor;
}
function validateStationAssignments(actor, assignments) {
  const data = readStarship(actor);
  const stations = new Set();
  const occupants = new Set();
  for (const assignment of assignments) {
    if (
      !data.stations.some((s) => s.id === assignment.stationId) ||
      stations.has(assignment.stationId) ||
      (assignment.actorUuid && occupants.has(assignment.actorUuid)) ||
      data.crew.some((c) => c.actorUuid === assignment.actorUuid && c.role === "observer")
    )
      throw new Error(T("SF2eTSC.wizard.setupStations"));
    stations.add(assignment.stationId);
    if (assignment.actorUuid) occupants.add(assignment.actorUuid);
  }
}

export async function startStarshipCombat(config = {}) {
  requireSetupGM();
  if (startingCombat) throw new Error(T("SF2eTSC.wizard.setupBusy"));
  startingCombat = true;
  let combat,
    createdCombat = false,
    previousState,
    previousSetup,
    previousActiveCombat,
    reservedCombatId,
    activationAttempted = false;
  const actors = [],
    actorChanges = [],
    createdEntries = new Set();
  const previousJournals = new Set((game.journal?.contents ?? []).map((d) => d.id));
  const previousActors = new Set((game.actors?.contents ?? []).map((a) => a.id));
  let lastState;
  const trackEntries = async (operation, actorIds) => {
    const before = new Set([...combat.combatants].map((c) => c.id));
    try {
      return await operation();
    } finally {
      for (const entry of combat.combatants) {
        const flags = entry.flags?.[MODULE_ID] ?? {};
        const owned =
          flags.sensorContactInstance?.combatId === combat.id ||
          flags.sensorMapInitiative?.combatId === combat.id ||
          flags.playerShip === true ||
          Object.hasOwn(flags, "crewOf");
        if (!before.has(entry.id) && actorIds.includes(entry.actorId) && owned) createdEntries.add(entry.id);
      }
    }
  };
  try {
    const { cfg, specs } = await prepareCombatRoster(config);
    for (const spec of specs) {
      for (const assignment of spec.stationAssignments ?? []) if (assignment.actorUuid) await requireCrewActor(assignment.actorUuid);
    }
    const current = game.combat;
    previousActiveCombat = current?.active ? current : null;
    if (current?.flags?.[MODULE_ID]?.combatSetup) throw new Error(T("SF2eTSC.wizard.setupBusy"));
    const hasPrivateStore = (game.journal?.contents ?? []).some((d) => d.flags?.[MODULE_ID]?.privateSensor?.combatId === current?.id);
    if (current && !getTsc(current).objects.length && !current.combatants.size && !hasPrivateStore) {
      combat = current;
      previousState = structuredClone(combat.flags?.[MODULE_ID]?.[FLAGS.COMBAT]);
      previousSetup = combat.flags?.[MODULE_ID]?.combatSetup;
      await combat.update({ [`flags.${MODULE_ID}.combatSetup`]: true });
    } else {
      reservedCombatId = foundry.utils.randomID(16);
      combat = await Combat.create(
        {
          _id: reservedCombatId,
          scene: canvas.scene?.id ?? null,
          active: false,
          flags: { [MODULE_ID]: { combatSetup: true } }
        },
        { keepId: true }
      );
      if (!combat?.id) throw new Error(T("SF2eTSC.errors.combatMissing"));
      createdCombat = true;
    }
    if (combat.flags?.[MODULE_ID]?.combatSetup !== true) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
    let state = defaultSensorState({ enabled: true, zones: cfg.zones, orientation: "horizontal" });
    lastState = getTsc(combat);
    const players = [];
    const hidden = [];
    for (const spec of specs) {
      requireSetupGM();
      const actor = spec.copy
        ? await createSensorActorInstance(spec.source, combat, {
            privateContact: spec.kind !== "player" && spec.detection !== "identified"
          })
        : spec.source;
      if (!actor?.uuid || actor.pack || (spec.copy && actor.uuid === spec.source.uuid))
        throw new Error(T("SF2eTSC.contactEditor.invalidSource"));
      if (spec.copy) actors.push(actor);
      spec.actor = actor;
      if (spec.copy && spec.kind !== "hazard") {
        await patchStarship(
          actor,
          (d) => {
            d.role = spec.kind;
            d.heading = spec.heading;
          },
          { history: false, undoable: false }
        );
        if (readStarship(actor).role !== spec.kind || readStarship(actor).heading !== spec.heading)
          throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
      }
      if (spec.kind === "player") {
        players.push(actor);
        const assignments = (spec.stationAssignments ?? []).filter(
          (a) => (readStarship(actor).stations.find((s) => s.id === a.stationId)?.helmedBy ?? null) !== a.actorUuid
        );
        if (assignments.length) {
          validateStationAssignments(actor, assignments);
          const before = structuredClone({
            crew: actor.flags[MODULE_ID].starship.crew,
            stations: actor.flags[MODULE_ID].starship.stations
          });
          const data = structuredClone({ crew: before.crew ?? [], stations: before.stations ?? [] });
          for (const assignment of assignments) {
            const station = data.stations.find((s) => s.id === assignment.stationId);
            station.helmedBy = null;
            station.autoHelmed = false;
          }
          for (const assignment of assignments) {
            if (!assignment.actorUuid) continue;
            const member = await requireCrewActor(assignment.actorUuid);
            if (!data.crew.some((c) => c.actorUuid === member.uuid))
              data.crew.push({ actorUuid: member.uuid, name: member.name, userId: null, role: "crew", stationId: null, ready: false });
            assignStation(data, member.uuid, assignment.stationId);
          }
          normalizeCrewAssignments(data);
          const current = actor.flags[MODULE_ID].starship;
          if (!sameSetupValue({ crew: current.crew, stations: current.stations }, before))
            throw new Error(T("SF2eTSC.wizard.setupConflict"));
          requireSetupGM();
          const after = { crew: data.crew, stations: data.stations };
          if (!sameSetupValue(before, after)) {
            actorChanges.push({ actor, before, after });
            await actor.update({
              [`flags.${MODULE_ID}.starship.crew`]: after.crew,
              [`flags.${MODULE_ID}.starship.stations`]: after.stations
            });
            const stored = actor.flags[MODULE_ID].starship;
            if (!sameSetupValue({ crew: stored.crew, stations: stored.stations }, after))
              throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
          }
        }
      }
      if (spec.kind !== "player" && spec.detection !== "identified") {
        hidden.push({ actor, spec });
        continue;
      }
      state = addObject(state, {
        key: actor.uuid,
        actorUuid: actor.uuid,
        name: actor.name,
        type: spec.kind === "hazard" ? "hazard" : "starship",
        zone: spec.zone,
        heading: spec.kind === "hazard" ? null : spec.heading,
        level: spec.kind === "hazard" ? (actor.system?.details?.level?.value ?? 0) : readStarship(actor).level,
        detection: { party: normalizeDetection(spec.detection, "identified") },
        ...(spec.kind === "hazard" ? { icon: "⚠", stealthDC: hazardStealthDC(actor) } : { mapTransform: { baseDirection: "unknown" } })
      });
      if (spec.kind === "hazard") state.hazardState[actor.uuid] = { disabled: false, placement: "sensor" };
    }
    for (const object of cfg.objects) {
      if (object.detection && object.detection !== "identified") continue;
      state = addObject(state, {
        key: foundry.utils.randomID(10),
        name: object.name,
        type: objectType(object.type),
        art: safeImagePath(object.art),
        zone: object.zone,
        heading: null,
        detection: { party: object.detection ?? "observed" }
      });
    }
    try {
      await saveTsc(combat, state);
    } finally {
      lastState = getTsc(combat);
    }
    if (!getTsc(combat).enabled || getTsc(combat).zones !== cfg.zones || !sameSetupValue(getTsc(combat).objects, state.objects))
      throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
    for (const { actor, spec } of hidden) {
      try {
        await addPrivateContact(combat, actor, spec.zone);
        const contact = privateContacts(combat.id).find((c) => c.actorUuid === actor.uuid);
        if (!contact) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
        if (spec.detection !== "undetected") await changePrivateContact(combat, contact.key, "detect", spec.detection);
        if (privateContacts(combat.id).find((c) => c.key === contact.key)?.detection.party !== spec.detection)
          throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
        if (spec.kind === "npc" || actor.system?.details?.isComplex) {
          await trackEntries(async () => {
            const entries = await combat.createEmbeddedDocuments("Combatant", [
              {
                actorId: actor.id,
                tokenId: null,
                sceneId: combat.scene?.id ?? null,
                name: SENSOR_CONTACT_COMBATANT_NAME,
                img: SENSOR_CONTACT_COMBATANT_IMAGE,
                hidden: true,
                flags: { [MODULE_ID]: { sensorMapInitiative: { combatId: combat.id, contactDesignation: true } } }
              }
            ]);
            if (entries.length !== 1) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
          }, [actor.id]);
        }
      } finally {
        lastState = getTsc(combat);
      }
    }
    for (const object of cfg.objects) {
      if (!object.detection || object.detection === "identified") continue;
      try {
        const key = await addPrivateCustom(combat, object.name, object.zone, { type: object.type, art: object.art });
        if (object.detection !== "undetected") await changePrivateContact(combat, key, "detect", object.detection);
        if (privateContacts(combat.id).find((c) => c.key === key)?.detection.party !== object.detection)
          throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
      } finally {
        lastState = getTsc(combat);
      }
    }
    for (const spec of specs.filter((s) => s.kind !== "player" && s.detection === "identified")) {
      const actor = spec.actor;
      await trackEntries(async () => {
        if (spec.copy) await ensureSensorActorCombatant(combat, actor);
        else if ((spec.kind === "npc" || actor.system?.details?.isComplex) && ![...combat.combatants].some((c) => c.actorId === actor.id)) {
          const entries = await combat.createEmbeddedDocuments("Combatant", [
            {
              actorId: actor.id,
              tokenId: null,
              sceneId: combat.scene?.id ?? null,
              flags: { [MODULE_ID]: { sensorMapInitiative: { combatId: combat.id, contactDesignation: false } } }
            }
          ]);
          if (entries.length !== 1) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
        }
      }, [actor.id]);
    }
    const crewPlan = planCrewCombatants({
      ships: players.map((s) => ({ uuid: s.uuid, name: s.name, crew: readStarship(s).crew })),
      combatants: combatantViews(combat),
      resolve: fromUuidSync_,
      scope: moduleSetting("crewInitiativeScope"),
      exclude: cfg.excludeCrew ?? [],
      extra: cfg.crew ?? []
    });
    if (crewPlan.missing.length) throw new Error(T("SF2eTSC.crew.missingActor"));
    await trackEntries(
      () =>
        syncCrewCombatants(
          combat,
          players.map((s) => s.uuid),
          { exclude: cfg.excludeCrew ?? [], extra: cfg.crew ?? [], notify: true }
        ),
      crewPlan.create.map((p) => p.actorId)
    );
    if (crewPlan.create.some((p) => ![...combat.combatants].some((c) => c.actorId === p.actorId)))
      throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
    for (const player of players) {
      if ([...combat.combatants].some((c) => c.actorId === player.id)) continue;
      const entry = await trackEntries(() => Initiative.addPlayerShipCombatant(combat, player), [player.id]);
      if (moduleSetting("playerShipInitiative") !== "disabled" && !entry) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
    }
    requireSetupGM();
    if (createdCombat) {
      activationAttempted = true;
      await combat.activate();
      if (!combat.active) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
    }
    requireSetupGM();
    await combat.update({ [`flags.${MODULE_ID}.-=combatSetup`]: null });
    if (combat.flags?.[MODULE_ID]?.combatSetup) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
    if (moduleSetting("smallCrewWarning")) {
      for (const ship of players) {
        const count = readStarship(ship).crew.filter((c) => c.role !== "observer").length;
        if (count < 4) notifyWarn("SF2eTSC.ui.smallCrew", { ship: ship.name, count });
      }
    }
    Hooks.callAll(HOOK_EVENTS.combatStarted, combat, getTsc(combat));
    emitClientEvent("openSensorMap", { combatId: combat.id });
    return combat;
  } catch (error) {
    if (!combat && reservedCombatId) {
      const saved = game.combats.get(reservedCombatId);
      if (saved?.flags?.[MODULE_ID]?.combatSetup) {
        combat = saved;
        createdCombat = true;
      }
    }
    if (combat) {
      for (const actor of game.actors?.contents ?? []) {
        if (
          !previousActors.has(actor.id) &&
          actor.flags?.[MODULE_ID]?.sensorContactInstance?.combatId === combat.id &&
          !actors.includes(actor)
        )
          actors.push(actor);
      }
    }
    const failures = [];
    const cleanup = async (operation) => {
      try {
        await operation();
      } catch (failure) {
        failures.push(failure);
      }
    };
    if (combat) {
      await cleanup(async () => {
        await combat.deleteEmbeddedDocuments("Combatant", [...createdEntries]);
        if ([...createdEntries].some((id) => combat.combatants.get(id))) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
      });
      await cleanup(async () => {
        if (lastState && !sameSetupValue(getTsc(combat), lastState)) throw new Error(T("SF2eTSC.wizard.setupConflict"));
        await combat.update({ [`flags.${MODULE_ID}.-=${FLAGS.COMBAT}`]: null });
        if (combat.flags?.[MODULE_ID]?.[FLAGS.COMBAT] !== undefined) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
        if (previousState !== undefined) await saveTsc(combat, previousState);
        if (!sameSetupValue(combat.flags?.[MODULE_ID]?.[FLAGS.COMBAT], previousState)) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
      });
      for (const journal of game.journal?.contents ?? []) {
        if (!previousJournals.has(journal.id) && journal.flags?.[MODULE_ID]?.privateSensor?.combatId === combat.id)
          await cleanup(async () => {
            await journal.delete();
            if (game.journal.get(journal.id)) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
          });
      }
    }
    for (const change of actorChanges.reverse()) {
      if (actors.includes(change.actor)) continue;
      await cleanup(async () => {
        const data = change.actor.flags[MODULE_ID].starship;
        if (sameSetupValue({ crew: data.crew, stations: data.stations }, change.before)) return;
        if (!sameSetupValue({ crew: data.crew, stations: data.stations }, change.after)) throw new Error(T("SF2eTSC.wizard.setupConflict"));
        await change.actor.update({
          [`flags.${MODULE_ID}.starship.crew`]: change.before.crew,
          [`flags.${MODULE_ID}.starship.stations`]: change.before.stations
        });
        const stored = change.actor.flags[MODULE_ID].starship;
        if (!sameSetupValue({ crew: stored.crew, stations: stored.stations }, change.before))
          throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
      });
    }
    if (combat && !failures.length) {
      if (createdCombat)
        await cleanup(async () => {
          await combat.delete();
          if (game.combats.get(combat.id)) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
        });
      else
        await cleanup(async () => {
          await combat.update(
            previousSetup === undefined
              ? { [`flags.${MODULE_ID}.-=combatSetup`]: null }
              : { [`flags.${MODULE_ID}.combatSetup`]: previousSetup }
          );
          if (!sameSetupValue(combat.flags?.[MODULE_ID]?.combatSetup, previousSetup)) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
        });
    }
    if (activationAttempted && previousActiveCombat && game.combats.get(previousActiveCombat.id))
      await cleanup(async () => {
        await previousActiveCombat.activate();
        if (!previousActiveCombat.active) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
      });
    if (!failures.length) {
      for (const actor of actors.reverse())
        await cleanup(async () => {
          await actor.delete();
          if (game.actors.get(actor.id)) throw new Error(T("SF2eTSC.wizard.setupIncomplete"));
        });
    }
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        T("SF2eTSC.wizard.setupRollback", { combat: combat?.id ?? "", message: error.message }),
        { cause: error }
      );
    throw error;
  } finally {
    startingCombat = false;
  }
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
  if (
    !combat ||
    combat.flags?.[MODULE_ID]?.combatSetup ||
    isStarshipCombat(combat) ||
    combat.flags?.[MODULE_ID]?.[FLAGS.COMBAT]?.autoDetectDisabled
  )
    return;
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
    if (!isActiveGM() || !isStarshipCombat(combat) || combat.flags?.[MODULE_ID]?.combatSetup) return;
    if ("turn" in changes || "round" in changes) onTurnChange(combat).catch((err) => log.error("turn processing failed", err));
  });
  Hooks.on("createCombatant", (c) => onCreateCombatant(c).catch((err) => log.error("auto-detect failed", err)));
  Hooks.on("deleteCombat", (combat) => {
    if (!isStarshipCombat(combat) || combat.flags?.[MODULE_ID]?.combatSetup) return;
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
