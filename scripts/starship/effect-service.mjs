import { registerHandler } from "../socket.mjs";
import { loadStarship, patchStarship } from "./starship-state.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { sanitizeTiming } from "./effect-timing.mjs";
import { addNativeCondition, removeNativeCondition } from "./native-condition-adapter.mjs";
import { T } from "../utils/foundry.mjs";

const requireGM = (user) => {
  if (!user?.isGM || !game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
};

export function registerEffectHandlers() {
  registerHandler("setStarshipOperationalState", async ({ user, payload }) => {
    requireGM(user);
    if (!["operational", "destroyed"].includes(payload.state)) throw new Error(T("SF2eTSC.errors.invalidData"));
    const actor = await loadStarship(payload.shipUuid);
    await patchStarship(
      actor,
      (data) => {
        if (payload.state === "destroyed") data.destroyed = true;
        else {
          data.destroyed = false;
          data.inoperable = false;
          data.compromised = 0;
          data.wrecked = 0;
          data.offKilter = false;
        }
      },
      { history: false, announce: false, undoable: false }
    );
    return true;
  });
  registerHandler("addStarshipCondition", async ({ user, payload }) => {
    requireGM(user);
    const actor = await loadStarship(payload.shipUuid);
    const condition = await addNativeCondition(actor, payload.slug, payload.value);
    return { id: condition.id, slug: condition.slug };
  });
  registerHandler("removeStarshipCondition", async ({ user, payload }) => {
    requireGM(user);
    const actor = await loadStarship(payload.shipUuid);
    return removeNativeCondition(actor, payload.itemId);
  });
  registerHandler("effectTiming", async ({ user, payload }) => {
    requireGM(user);
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
