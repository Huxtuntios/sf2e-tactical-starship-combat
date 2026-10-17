import { initialCompromised, COMPROMISED_DESTROYED_AT } from "./compromised.mjs";

/**
 * StarshipDamageEngine core (pure). Order of operations:
 * immunity -> weakness -> resistance -> hardness -> shields (unless bypassing) -> hull -> compromised/destruction.
 *
 * @param {object} p
 * @param {object} p.state  { hp, sp, isPlayer, compromised, wrecked, inoperable, destroyed, hardness, immunities[], resistances{}, weaknesses{} }
 * @param {number} p.amount
 * @param {string} [p.damageType]
 * @param {string[]} [p.traits]
 * @param {boolean} [p.criticalHit]  attacker crit or target critical save failure
 * @param {boolean} [p.nonlethal]
 */
/** pf2e/sf2e damage categories used by IWR ("physical", "energy", "all-damage"). */
export const DAMAGE_GROUPS = Object.freeze({
  physical: ["bludgeoning", "piercing", "slashing"],
  energy: ["acid", "cold", "electricity", "fire", "force", "sonic", "vitality", "void"],
  "non-physical": ["acid", "cold", "electricity", "fire", "force", "sonic", "vitality", "void", "mental", "poison", "spirit", "bleed"]
});
const ALIASES = {
  electric: "electricity",
  electrical: "electricity",
  lightning: "electricity",
  negative: "void",
  positive: "vitality",
  all: "all-damage",
  "": "untyped"
};
export const normalizeDamageType = (t) => {
  const s = String(t ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return ALIASES[s] ?? s;
};
/** Normalise IWR from a module map/list or the system's [{type, value}] arrays. */
export function normalizeIwr(v, withValue = true) {
  if (!withValue)
    return [...new Set((Array.isArray(v) ? v : Object.keys(v ?? {})).map((x) => normalizeDamageType(x?.type ?? x)).filter(Boolean))];
  const out = {};
  const put = (k, n) => {
    const key = normalizeDamageType(k);
    const val = Number(n) || 0;
    if (key && val) out[key] = Math.max(out[key] ?? 0, val);
  };
  if (Array.isArray(v)) for (const x of v) put(x?.type, x?.value);
  else for (const [k, n] of Object.entries(v ?? {})) put(k, n);
  return out;
}
/** Does an IWR entry apply to this damage type / attack traits? */
export function iwrMatches(key, damageType, traits = []) {
  const t = normalizeDamageType(damageType);
  const k = normalizeDamageType(key);
  if (k === t || k === "all-damage") return true;
  if (DAMAGE_GROUPS[k]?.includes(t)) return true;
  return traits.some((x) => normalizeDamageType(x) === k);
}
const bestIwr = (map, damageType, traits) =>
  Math.max(
    0,
    ...Object.entries(map)
      .filter(([k]) => iwrMatches(k, damageType, traits))
      .map(([, v]) => v)
  );

export function computeStarshipDamage({ state, amount, damageType = "untyped", traits = [], criticalHit = false, nonlethal = false }) {
  const s = {
    compromised: 0,
    wrecked: 0,
    inoperable: false,
    destroyed: false,
    hardness: 0,
    immunities: [],
    resistances: {},
    weaknesses: {},
    isPlayer: true,
    ...state
  };
  const bypassing = traits.includes("bypassing");
  const res = {
    originalDamage: amount,
    mitigatedDamage: 0,
    shieldDamage: 0,
    hullDamage: 0,
    bypassedShields: bypassing,
    hardnessReduction: 0,
    resistanceReduction: 0,
    weaknessIncrease: 0,
    immune: false,
    compromisedIncrease: 0,
    becameCompromised: false,
    becameInoperable: false,
    stationsMalfunctioned: false,
    destroyed: false,
    newState: null
  };
  let dmg = Math.max(0, Math.floor(amount));
  damageType = normalizeDamageType(damageType);
  const immList = normalizeIwr(s.immunities, false);
  const weakMap = normalizeIwr(s.weaknesses);
  const resMap = normalizeIwr(s.resistances);
  if (damageType !== "untyped" && immList.some((k) => iwrMatches(k, damageType, [...traits]))) {
    res.immune = true;
    dmg = 0;
  }
  if (dmg > 0) {
    const weak = bestIwr(weakMap, damageType, [...traits]);
    if (weak) {
      dmg += weak;
      res.weaknessIncrease = weak;
    }
    const resist = bestIwr(resMap, damageType, [...traits]);
    if (resist) {
      const r = Math.min(dmg, resist);
      dmg -= r;
      res.resistanceReduction = r;
    }
    if (s.hardness > 0) {
      const h = Math.min(dmg, s.hardness);
      dmg -= h;
      res.hardnessReduction = h;
    }
  }
  res.mitigatedDamage = dmg;
  let sp = s.sp,
    hp = s.hp,
    remaining = dmg;
  if (!bypassing && sp > 0 && remaining > 0) {
    const absorbed = Math.min(sp, remaining);
    sp -= absorbed;
    remaining -= absorbed;
    res.shieldDamage = absorbed;
  }
  const hullDamage = Math.min(hp, remaining);
  hp -= hullDamage;
  res.hullDamage = hullDamage;

  let { compromised, wrecked, inoperable, destroyed } = s;
  const wasCompromised = compromised > 0;
  const unmitigated = remaining > 0; // damage that shields did not completely absorb
  if (unmitigated) {
    if (wasCompromised) {
      const inc = criticalHit ? 2 : 1;
      compromised += inc;
      res.compromisedIncrease = inc;
      res.stationsMalfunctioned = true;
    } else if (hp === 0 && hullDamage > 0) {
      if (s.isPlayer) {
        if (nonlethal) {
          inoperable = true;
          res.becameInoperable = true;
          res.stationsMalfunctioned = true;
        } else {
          compromised = initialCompromised({ wrecked, criticalHit });
          res.compromisedIncrease = compromised;
          res.becameCompromised = true;
          res.becameInoperable = true;
          inoperable = true;
          res.stationsMalfunctioned = true;
        }
      } else if (nonlethal) {
        inoperable = true;
        res.becameInoperable = true;
      } else {
        destroyed = true;
      }
    }
  }
  if (compromised >= COMPROMISED_DESTROYED_AT) {
    compromised = COMPROMISED_DESTROYED_AT;
    destroyed = true;
  }
  res.destroyed = destroyed && !s.destroyed;
  res.newState = { hp, sp, compromised, wrecked, inoperable, destroyed };
  return res;
}
