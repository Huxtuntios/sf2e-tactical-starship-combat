import { normalizeCost } from "./cost.mjs";

/** Routine "(1 action)" / "(2 actions)" -> number of actions. */
export function parseRoutineActions(text) {
  const m = /(\d+)\s*actions?/i.exec(String(text ?? ""));
  if (m) return Number(m[1]);
  const w = /(one|two|three)\s*actions?/i.exec(String(text ?? ""));
  return w ? { one: 1, two: 2, three: 3 }[w[1].toLowerCase()] : 1;
}

/** Parse reset text into { type: immediate|rounds|seconds|never|custom, value }. */
export function parseReset(text) {
  const t = String(text ?? "").toLowerCase();
  if (!t) return { type: "custom", value: null };
  if (/immediately/.test(t)) return { type: "immediate", value: 0 };
  if (/doesn[’']t reset|does not reset|never/.test(t)) return { type: "never", value: null };
  let m = /(\d+)\s*rounds?/.exec(t) ?? (/\b(?:a|1|one) round\b/.test(t) ? [0, "1"] : null);
  if (m) return { type: "rounds", value: Number(m[1]) };
  m = /(\d+)\s*minutes?/.exec(t);
  if (m) return { type: "seconds", value: Number(m[1]) * 60 };
  m = /(\d+)\s*hours?/.exec(t);
  if (m) return { type: "seconds", value: Number(m[1]) * 3600 };
  if (/\b(?:an|1|one) hour\b/.test(t)) return { type: "seconds", value: 3600 };
  if (/\b(?:a|1|one) minute\b/.test(t)) return { type: "seconds", value: 60 };
  if (/24 hours|\bday\b/.test(t)) return { type: "seconds", value: 86400 };
  return { type: "custom", value: null };
}

/** Is a disabled hazard ready to trigger again? */
export function isResetReady(reset, disabledAt, now) {
  if (!disabledAt) return true;
  switch (reset?.type) {
    case "immediate":
      return true;
    case "never":
      return false;
    case "rounds":
      return now.round - disabledAt.round >= reset.value;
    case "seconds":
      return now.time - disabledAt.time >= reset.value;
    default:
      return false;
  }
}

export { normalizeCost };

/** A hazard rolls initiative only when complex. */
export function hazardNeedsCombatant(hazard) {
  return !!hazard?.isComplex;
}

/** Extract automatable parts of hazard effect text: damage formula/type, save DC/type. Everything else stays manual. */
export function parseHazardEffect(text) {
  const t = String(text ?? "");
  const out = { damage: null, damageType: null, save: null, dc: null, area: null };
  const d =
    /(\d+d\d+(?:\s*\+\s*\d+)?)\s+(acid|bludgeoning|cold|electricity|fire|force|piercing|slashing|sonic|mental|poison|spirit|vitality|void|untyped)?\s*damage/i.exec(
      t
    );
  if (d) {
    out.damage = d[1].replace(/\s+/g, "");
    out.damageType = (d[2] ?? "untyped").toLowerCase();
  }
  const s = /DC (\d+) (?:basic )?(Reflex|Fortitude|Will)/i.exec(t);
  if (s) {
    out.dc = Number(s[1]);
    out.save = s[2].toLowerCase() === "reflex" ? "reflex" : s[2].toLowerCase() === "will" ? "will" : "fortitude";
  }
  const z = /(\d+)\s*zones?/i.exec(t);
  if (z) out.area = Number(z[1]);
  out.basic = /basic/i.test(t);
  return out;
}
