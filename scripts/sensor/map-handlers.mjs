/** Sensor map: GM authority for every edit (socket "sensorUpdate"). */
import { getTsc, mutateTsc } from "../combat/tsc-state.mjs";
import { findObject } from "../engine/sensor-ops.mjs";
import { isStarship } from "../starship/starship-state.mjs";
import { registerHandler } from "../socket.mjs";
import { T, moduleSetting, fromUuidSafe } from "../utils/foundry.mjs";
import { sanitizeSensorPayload, applySensorOp } from "./map-model.mjs";

export function registerSensorHandlers() {
  registerHandler("sensorUpdate", async ({ user, payload: raw }) => {
    const combat = game.combats.get(raw.combatId);
    if (!combat) throw new Error(T("SF2eTSC.errors.noCombat"));
    // players: only "move"/"shift" of their own ship — canMoveKey(user, getTsc(combat), payload.key)
    const payload = sanitizeSensorPayload(user, getTsc(combat), raw);
    if (!payload) throw new Error(T("SF2eTSC.errors.gmOnly"));
    if (payload.op === "flip") {
      const o = findObject(getTsc(combat), payload.key);
      const a = o ? await fromUuidSafe(o.actorUuid ?? o.key) : null;
      if (a && isStarship(a)) {
        const { patchStarship } = await import("../starship/starship-state.mjs");
        await patchStarship(a, (d) => {
          d.heading = o.heading === "left" ? "right" : "left";
        });
      }
    }
    const designation = moduleSetting("contactDesignation");
    await mutateTsc(combat, (s) => applySensorOp(s, payload, { designation }));
    return true;
  });
}
