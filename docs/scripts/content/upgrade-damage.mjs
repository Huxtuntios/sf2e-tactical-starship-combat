/** Display-time bindings for variant damage. Source rules stay unchanged in data and actors. */
const DICE = /\b\d+d\d+(?:\s*[+\-−]\s*\d+)?\b/gi;
const BINDINGS = {
  "ramming-prow": { action: "Ram", sources: [{ type: "bludgeoning", field: "effect" }] },
  "thasteron-afterburner": { action: "Thasteron Burst", variantType: "fire", sources: [{ type: "fire", field: "effect" }] },
  "nova-prow": {
    action: "Nova Ram",
    sources: [
      { type: "bludgeoning", label: "Graviton-Attuned" },
      { type: "fire", label: "Photon-Attuned" }
    ]
  }
};
const validDice = (s) => /^\d+d\d+(?:[+-]\d+)?$/i.test(s);
const cleanDice = (s) => String(s).replace(/\s+/g, "").replace(/−/g, "-");
const token = (dice, type, label) => `@Damage[${/[+-]/.test(dice) ? `(${dice})` : dice}[${type}]]{${String(label).replace(/[{}]/g, "")}}`;

/** Explicit catalog bindings are resolved against original English action text and the selected variant.
 * Never inherit from another action, a custom override, an unknown type, or an ambiguous variant. */
export function upgradeDamagePresentation(entry, tr = (s) => s) {
  const binding = !entry?.custom && entry?.variant && BINDINGS[entry.ref];
  if (!binding) return { base: new Map(), variant: new Map() };
  const action = (entry.activations ?? []).filter((a) => a.name === binding.action);
  if (action.length !== 1 || (entry.variantText ?? []).length !== 1) return { base: new Map(), variant: new Map() };
  const variantSource = entry.variantText[0];
  const variantPattern = binding.variantType
    ? new RegExp(`\\bdeals (\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?) ${binding.variantType} damage\\b`, "i")
    : /\bdeals (\d+d\d+(?:\s*[+-]\s*\d+)?) damage\b/i;
  const v = variantPattern.exec(variantSource);
  if (!v || [...variantSource.matchAll(DICE)].length !== 1 || !validDice(cleanDice(v[1]))) return { base: new Map(), variant: new Map() };
  const dice = cleanDice(v[1]);
  const sources = [];
  for (const spec of binding.sources) {
    const candidates = spec.field
      ? [action[0][spec.field]]
      : (action[0].details ?? []).filter((d) => d.label === spec.label).map((d) => d.text);
    if (candidates.length !== 1 || typeof candidates[0] !== "string") return { base: new Map(), variant: new Map() };
    const source = candidates[0];
    const match = new RegExp(`\\b(\\d+d\\d+(?:\\s*[+\\-]\\s*\\d+)?)\\s+${spec.type}\\s+damage\\b`, "i").exec(source);
    if (!match) return { base: new Map(), variant: new Map() };
    const baseDice = cleanDice(match[1]);
    const translated = tr(source);
    // Only replace an unambiguous occurrence, not a second unrelated expression.
    const re = new RegExp(`\\b${baseDice.replace(/[+-]/g, "\\$&")}\\b`, "gi");
    if ([...translated.matchAll(re)].length !== 1) return { base: new Map(), variant: new Map() };
    sources.push({ ...spec, source, translated: translated.replace(re, dice) });
  }
  const translatedVariant = tr(variantSource);
  if (binding.variantType) {
    // The variant already specifies its type and the standard renderer links it independently.
    if (![...translatedVariant.matchAll(new RegExp(`\\b${dice.replace(/[+-]/g, "\\$&")}\\b`, "gi"))].length)
      return { base: new Map(), variant: new Map() };
    return { base: new Map(sources.map((s) => [s.source, s.translated])), variant: new Map() };
  }
  const re = new RegExp(`\\b${dice.replace(/[+-]/g, "\\$&")}\\s+(?:damage|урона)(?![\\p{L}\\p{N}])`, "giu");
  const hits = [...translatedVariant.matchAll(re)];
  if (hits.length !== 1) return { base: new Map(), variant: new Map() };
  const base = new Map(sources.map((s) => [s.source, s.translated]));
  const shown = hits[0][0];
  const replacement =
    sources.length === 1
      ? token(dice, sources[0].type, shown)
      : `${shown} (${sources.map((s) => token(dice, s.type, tr(s.label))).join(" / ")})`;
  return { base, variant: new Map([[variantSource, translatedVariant.replace(re, replacement)]]) };
}
