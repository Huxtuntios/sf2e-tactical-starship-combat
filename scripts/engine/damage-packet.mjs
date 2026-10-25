import { computeStarshipDamage, normalizeDamageType } from "./damage.mjs";

/** Типы обрабатываются раздельно; Твёрдость и переход критических состояний — один раз за попадание. */
export function computeStarshipDamagePacket({ state, parts, traits = [], criticalHit = false, nonlethal = false }) {
  const grouped = new Map();
  for (const part of parts) {
    const type = normalizeDamageType(part.type);
    grouped.set(type, (grouped.get(type) ?? 0) + Math.max(0, Math.floor(part.amount)));
  }
  if (grouped.size === 1) {
    const [[damageType, amount]] = grouped;
    return computeStarshipDamage({ state, amount, damageType, traits, criticalHit, nonlethal });
  }
  const components = [...grouped].map(([type, amount]) => ({
    type,
    ...computeStarshipDamage({
      state: { ...state, hardness: 0, hp: Number.MAX_SAFE_INTEGER, sp: 0, compromised: 0, destroyed: false },
      amount,
      damageType: type,
      traits
    })
  }));
  const result = computeStarshipDamage({
    state: { ...state, immunities: [], resistances: {}, weaknesses: {} },
    amount: components.reduce((sum, part) => sum + part.mitigatedDamage, 0),
    damageType: "untyped",
    traits,
    criticalHit,
    nonlethal
  });
  result.originalDamage = components.reduce((sum, part) => sum + part.originalDamage, 0);
  result.resistanceReduction = components.reduce((sum, part) => sum + part.resistanceReduction, 0);
  result.weaknessIncrease = components.reduce((sum, part) => sum + part.weaknessIncrease, 0);
  result.immune = components.length > 0 && components.every((part) => part.immune);
  result.components = components.map(({ type, originalDamage, mitigatedDamage, immune }) => ({
    type,
    originalDamage,
    mitigatedDamage,
    immune
  }));
  return result;
}
