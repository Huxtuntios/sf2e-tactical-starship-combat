import { registerHandler } from "../socket.mjs";
import { loadStarship, patchStarship } from "./starship-state.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { sanitizeTiming } from "./effect-timing.mjs";
import { T } from "../utils/foundry.mjs";

export function registerEffectHandlers() {
  registerHandler("effectTiming", async ({ user, payload }) => {
    if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const actor = await loadStarship(payload.shipUuid),
      combat = activeStarshipCombat();
    await patchStarship(
      actor,
      (data) => {
        const effect = data.effects.find((e) => e.id === payload.effectId);
        if (!effect) throw new Error(T("SF2eTSC.errors.invalidData"));
        if (payload.op === "complete") data.effects = data.effects.filter((e) => e.id !== effect.id);
        else if (payload.op === "sustain") {
          if (!effect.timing?.sustain || !combat || effect.timing.combatId !== combat.id) throw new Error(T("SF2eTSC.errors.invalidData"));
          effect.timing.lastSustainedRound = combat.round;
        } else if (payload.op === "set") {
          effect.timing = sanitizeTiming(payload.timing, combat);
          effect.expire = null;
        } else throw new Error(T("SF2eTSC.errors.invalidData"));
      },
      { reason: T("SF2eTSC.qol.effectTiming"), undoable: false }
    );
    return true;
  });
}
