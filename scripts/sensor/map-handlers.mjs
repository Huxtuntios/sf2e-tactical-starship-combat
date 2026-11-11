import { mineReactionHints } from "./mine-reaction-hint.mjs";
/** Sensor map: GM authority for every edit (socket "sensorUpdate"). */
import { getTsc, mutateTsc } from "../combat/tsc-state.mjs";
import { findObject } from "../engine/sensor-ops.mjs";
import { isStarship } from "../starship/starship-state.mjs";
import { registerHandler } from "../socket.mjs";
import { T, moduleSetting, fromUuidSafe, isActiveGM } from "../utils/foundry.mjs";
import { sanitizeSensorPayload, applySensorOp, MINE_LOCKED_OPS } from "./map-model.mjs";
import { serialize } from "../utils/serial.mjs";
import { dropActorOnMap } from "./actor-drop.mjs";
import { createSensorActorInstance, deleteSensorActorInstance, ensureSensorActorCombatant } from "./actor-instance.mjs";
import { addAllNpcShipsToInitiative, addSensorObjectToInitiative } from "./initiative.mjs";
<<<<<<< Updated upstream
=======
import { pendingPrivateReveals } from "./private-contacts.mjs";
>>>>>>> Stashed changes

export function registerSensorHandlers() {
  registerHandler("sensorAddInitiative", async ({ user, payload }) => addSensorObjectToInitiative(payload?.combatId, payload?.key, user));
  registerHandler("sensorAddAllNpcInitiative", async ({ user, payload }) => addAllNpcShipsToInitiative(payload?.combatId, user));
  registerHandler("sensorUpdate", async ({ user, payload: raw }) =>
    serialize(`sensor:${String(raw?.combatId ?? "")}`, async () => {
      const combat = game.combats.get(raw.combatId);
      if (!combat) throw new Error(T("SF2eTSC.errors.noCombat"));
      // players: only "move"/"shift" of their own ship — canMoveKey(user, getTsc(combat), payload.key)
      const payload = sanitizeSensorPayload(user, getTsc(combat), raw);
      if (!payload) throw new Error(T("SF2eTSC.errors.gmOnly"));
      if (!isActiveGM()) throw new Error(T("SF2eTSC.errors.gmOnly"));
      // Non-Actor markers cannot collide with private- contact keys or document UUIDs.
      const independentMarker =
        payload.op === "add" &&
        !payload.key &&
        !payload.object?.actorUuid &&
        typeof payload.object?.key === "string" &&
        !payload.object.key.startsWith("private-") &&
        !payload.object.key.includes(".");
      let pending = [];
      if (!independentMarker) {
        try {
          pending = pendingPrivateReveals(combat.id);
        } catch {
          throw new Error(T("SF2eTSC.privateMap.recoveryRequired"));
        }
      }
      const targets = [payload.key, findObject(getTsc(combat), payload.key)?.actorUuid];
      if (payload.op === "dropActor") targets.push(payload.actorUuid);
      if (payload.op === "add") targets.push(payload.object?.key, payload.object?.actorUuid);
      if (
        (payload.op === "resize" && pending.length) ||
        pending.some((entry) => targets.some((target) => target && (target === entry.key || target === entry.actorUuid)))
      )
        throw new Error(T("SF2eTSC.privateMap.recoveryRequired"));
      if (payload.op === "zoneInfo" && Object.hasOwn(payload.info ?? {}, "gmNotes"))
        throw new Error(T("SF2eTSC.privateMap.legacyNotesWarning"));
      if (payload.key && findObject(getTsc(combat), payload.key)?.tscPrivateProjection)
        throw new Error(T("SF2eTSC.privateMap.invalidStore"));
      if (payload.key && MINE_LOCKED_OPS.includes(payload.op) && findObject(getTsc(combat), payload.key)?.mineRef)
        throw new Error(T("SF2eTSC.mineContact.managed"));
      if (payload.op === "dropActor") {
        if (typeof payload.actorUuid !== "string" || !payload.actorUuid || payload.actorUuid.length > 1024)
          throw new Error(T("SF2eTSC.mapDrop.invalidActor"));
        const actor = await fromUuidSafe(payload.actorUuid);
        if (!actor || actor.uuid !== payload.actorUuid || actor.documentName !== "Actor")
          throw new Error(T("SF2eTSC.mapDrop.invalidActor"));
        const known = ["invalidActor", "invalidZone", "unsupportedActor", "duplicateActors", "disclosureRequired", "managedMine"];
        if (getTsc(combat).objects.some((o) => o.actorUuid === actor.uuid || o.key === actor.uuid)) {
          let result;
          try {
            await mutateTsc(combat, (state) => {
              const change = dropActorOnMap(state, actor, payload.zone, { publicActor: payload.publicActor === true });
              result = change.result;
              return change.state;
            });
          } catch (error) {
            if (known.includes(error.message)) throw new Error(T(`SF2eTSC.mapDrop.${error.message}`), { cause: error });
            throw error;
          }
          return result;
        }
        const instance = await createSensorActorInstance(actor, combat);
        const previous = getTsc(combat);
        let result;
        try {
          await mutateTsc(combat, (state) => {
            const change = dropActorOnMap(state, instance, payload.zone, { publicActor: payload.publicActor === true });
            result = change.result;
            return change.state;
          });
          await ensureSensorActorCombatant(combat, instance);
        } catch (error) {
          if (getTsc(combat).objects.some((o) => o.actorUuid === instance.uuid || o.key === instance.uuid))
            await mutateTsc(combat, () => previous);
          await deleteSensorActorInstance(combat, instance.uuid);
          if (known.includes(error.message)) throw new Error(T(`SF2eTSC.mapDrop.${error.message}`), { cause: error });
          throw error;
        }
        return result;
      }
      if (payload.op === "setHeading") {
        const o = findObject(getTsc(combat), payload.key);
        if (o?.type !== "starship" || o.heading || !["left", "right"].includes(payload.heading)) return true;
        const a = await fromUuidSafe(o.actorUuid ?? o.key);
        if (!a || !isStarship(a)) throw new Error(T("SF2eTSC.mapDrop.invalidActor"));
        if (!a.pack) {
          const { patchStarship } = await import("../starship/starship-state.mjs");
          await patchStarship(a, (d) => {
            d.heading = payload.heading;
          });
        }
      }
      if (payload.op === "flip") {
        const o = findObject(getTsc(combat), payload.key);
        const a = o ? await fromUuidSafe(o.actorUuid ?? o.key) : null;
        if (o?.heading && a && isStarship(a) && !a.pack) {
          const { patchStarship } = await import("../starship/starship-state.mjs");
          await patchStarship(a, (d) => {
            d.heading = o.heading === "left" ? "right" : "left";
          });
        }
      }
      const designation = moduleSetting("contactDesignation");
      const before = ["move", "shift"].includes(payload.op) ? findObject(getTsc(combat), payload.key)?.zone : null;
      const removing = payload.op === "remove" ? findObject(getTsc(combat), payload.key) : null;
      await mutateTsc(combat, (s) => applySensorOp(s, payload, { designation }));
      if (removing?.actorUuid) await deleteSensorActorInstance(combat, removing.actorUuid);
      if (before != null) {
        try {
          const state = getTsc(combat),
            after = findObject(state, payload.key)?.zone;
          const hints = await mineReactionHints({ state, combat, key: payload.key, oldZone: before, newZone: after });
          for (const hint of hints.slice(0, 10)) ui.notifications?.info?.(T("SF2eTSC.mineReaction.hint", hint));
          if (hints.length > 10) ui.notifications?.warn?.(T("SF2eTSC.mineReaction.more"));
        } catch {
          /* Перемещение уже сохранено; отказ подсказки не откатывает его. */
        }
      }
      return true;
    })
  );
}
