/** Native SF2e damage instances preserve damage types in chat and on drag/apply. No automatic application. */
import { DAMAGE_TOKEN } from "../content/inline-links.mjs";
import { T } from "../utils/foundry.mjs";
import { secretVisibility } from "../starship/stats.mjs";
import { MODULE_ID } from "../constants.mjs";
import { nativeSystemId } from "../utils/system.mjs";
export function typedDamageFormula(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new Error(T("SF2eTSC.rolls.noSuchWeapon"));
  return `{${parts
    .map(({ formula, type = "untyped" }) => {
      if (!/^[a-z][a-z0-9-]*$/.test(type)) throw new Error(T("SF2eTSC.rolls.invalidDamage"));
      return `(${formula})[${type}]`;
    })
    .join(",")}}`;
}
/** Evaluated native instances use type/total (as in the Toolbelt consumer), never formula proportions. */
export function damagePartsFromRoll(roll, singleType = null) {
  const instances = roll?.instances;
  const parts = Array.isArray(instances) && instances.length ? instances : singleType ? [{ type: singleType, total: roll?.total }] : [];
  if (
    !parts.length ||
    parts.some(
      (part) =>
        !/^[a-z][a-z0-9-]*$/.test(part.type ?? "") ||
        !Number.isFinite(part.total) ||
        part.total < 0 ||
        part.total > 1e9 ||
        (part.persistent && !part.options?.evaluatePersistent) ||
        (part.kinds?.has("healing") && !part.kinds.has("damage"))
    )
  )
    throw new Error(T("SF2eTSC.rolls.invalidDamage"));
  return parts.map((part) => ({ type: part.type, amount: Math.floor(part.total) }));
}
export function inlineDamageFormula(inline) {
  const match = new RegExp(`^${DAMAGE_TOKEN.source}$`).exec(String(inline));
  return match ? `{${match[1]}}` : null;
}
export async function rollTypedDamage(
  formula,
  { actor = null, speaker = null, flavor = "", attackCardId = "", suppressApply = false, secret = false } = {}
) {
  const DamageRoll = globalThis.CONFIG?.Dice?.rolls?.find((Ctor) => Ctor.name === "DamageRoll");
  if (!DamageRoll) throw new Error(T("SF2eTSC.rolls.nativeDamageUnavailable"));
  if (DamageRoll.validate && !DamageRoll.validate(formula)) throw new Error(T("SF2eTSC.rolls.invalidDamage"));
  const roll = await new DamageRoll(formula, {}, { rollerId: game.user.id }).evaluate();
  await roll.toMessage(
    {
      speaker: speaker ?? ChatMessage.getSpeaker({ actor }),
      flavor,
      flags: {
        [nativeSystemId()]: { context: { type: "damage-roll" }, ...(attackCardId || suppressApply ? { suppressDamageButtons: true } : {}) },
        ...(attackCardId || suppressApply
          ? {
              [MODULE_ID]: {
                ...(attackCardId ? { attackCardDamage: attackCardId } : {}),
                ...(suppressApply ? { autoAppliedDamage: true } : {})
              }
            }
          : {})
      }
    },
    secretVisibility(secret)
  );
  return roll;
}
