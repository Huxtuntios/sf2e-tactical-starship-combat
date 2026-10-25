/** Native SF2e damage instances preserve damage types in chat and on drag/apply. No automatic application. */
import { DAMAGE_TOKEN } from "../content/inline-links.mjs";
import { T } from "../utils/foundry.mjs";
import { MODULE_ID } from "../constants.mjs";
export function typedDamageFormula(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new Error(T("SF2eTSC.rolls.noSuchWeapon"));
  return `{${parts
    .map(({ formula, type = "untyped" }) => {
      if (!/^[a-z][a-z0-9-]*$/.test(type)) throw new Error(T("SF2eTSC.rolls.invalidDamage"));
      return `(${formula})[${type}]`;
    })
    .join(",")}}`;
}
export function inlineDamageFormula(inline) {
  const match = new RegExp(`^${DAMAGE_TOKEN.source}$`).exec(String(inline));
  return match ? `{${match[1]}}` : null;
}
export async function rollTypedDamage(formula, { actor = null, speaker = null, flavor = "", attackCardId = "" } = {}) {
  const DamageRoll = globalThis.CONFIG?.Dice?.rolls?.find((Ctor) => Ctor.name === "DamageRoll");
  if (!DamageRoll) throw new Error(T("SF2eTSC.rolls.nativeDamageUnavailable"));
  if (DamageRoll.validate && !DamageRoll.validate(formula)) throw new Error(T("SF2eTSC.rolls.invalidDamage"));
  const roll = await new DamageRoll(formula, {}, { rollerId: game.user.id }).evaluate();
  await roll.toMessage({
    speaker: speaker ?? ChatMessage.getSpeaker({ actor }),
    flavor,
    flags: {
      sf2e: { context: { type: "damage-roll" }, ...(attackCardId ? { suppressDamageButtons: true } : {}) },
      ...(attackCardId ? { [MODULE_ID]: { attackCardDamage: attackCardId } } : {})
    }
  });
  return roll;
}
