import { ct } from "../content/content-i18n.mjs";

/** Shared localized labels for game terms used by sheets, HUD and chat cards (no slug is ever translated). */
const i18n = () => globalThis.game?.i18n;
const has = (k) => !!i18n()?.has?.(k);
const loc = (k) => i18n()?.localize?.(k) ?? k;

/** "range increment 2 zones" → "Шаг дистанции 2 зон"; "agile" → "Быстрое"; unknown traits are shown as written. */
export function traitLabel(t) {
  const raw = String(t ?? "").trim();
  if (!raw) return "";
  if (raw.toLowerCase() === "starship") return "starship";
  const m = /^([a-z][a-z -]*?)(?:\s+(\(.*\)|\d.*|[A-Z])\s*)?$/.exec(raw);
  const base = (m?.[1] ?? raw).trim().replace(/\s+/g, "-").toLowerCase();
  const rest = m?.[2] ?? "";
  const cfg = globalThis.CONFIG?.PF2E;
  const sys =
    cfg &&
    ["weaponTraits", "actionTraits", "featTraits", "equipmentTraits", "creatureTraits", "vehicleTraits"]
      .map((d) => cfg[d]?.[base])
      .find(Boolean);
  if (sys) return rest ? `${loc(sys)} ${zonesText(rest)}` : loc(sys);
  const key = `SF2eTSC.traits.${base}`;
  if (!has(key)) return ct(raw);
  return rest ? `${loc(key)} ${zonesText(rest)}` : loc(key);
}
export const traitsText = (list) => (list ?? []).map(traitLabel).filter(Boolean).join(", ");

/** "4 zones" → localized; "1 zone" → localized; leaves other text alone. */
export function zonesText(s) {
  return String(s ?? "").replace(
    /\b(\d+)[ -]zones?\b/g,
    (m, n) => `${n} ${loc(Number(n) === 1 ? "SF2eTSC.ui.zone" : "SF2eTSC.ui.zones").toLowerCase()}`
  );
}

/** Damage type slug → localized adjective/noun (falls back to the slug). */
export function damageTypeLabel(t) {
  const sys = globalThis.CONFIG?.PF2E?.damageTypes?.[String(t ?? "").toLowerCase()];
  if (sys) return loc(sys);
  const k = `SF2eTSC.damageTypes.${String(t ?? "").toLowerCase()}`;
  return t && has(k) ? loc(k) : String(t ?? "");
}
/** "1d10+4 piercing" / "2d6 fire plus 1d4 persistent acid" → localized damage words, dice untouched. */
export function damageText(s) {
  return String(s ?? "")
    .replace(
      /\b(acid|bludgeoning|cold|electricity|fire|force|piercing|slashing|void|sonic|mental|poison|spirit|vitality|bleed|persistent|untyped)\b/g,
      (w) => damageTypeLabel(w)
    )
    .replace(/\bplus\b/g, loc("SF2eTSC.ui.plus"))
    .replace(/\bdamage\b/g, loc("SF2eTSC.ui.damageWord"));
}

/** Battle station type label (SF2eTSC.stations.<type>). */
export const stationTypeLabel = (type) => (has(`SF2eTSC.stations.${type}`) ? loc(`SF2eTSC.stations.${type}`) : String(type ?? ""));

/** One statblock strike line: "Melee +11 (Unarmed), 1d10+4 piercing". */
export function strikeLine(x) {
  // Callers pass Strikes validated by normalizeNpcStrike (actions/npc-rows.mjs); anything else is a programming error
  // that must surface with a clear message instead of "Cannot read properties of undefined (reading 'kind')".
  if (!x || typeof x !== "object") throw new TypeError(`strikeLine: expected an NPC Strike object, got ${x === null ? "null" : typeof x}`);
  if (x.kind !== "melee" && x.kind !== "ranged")
    throw new TypeError(`strikeLine: invalid Strike kind ${JSON.stringify(x.kind)} for "${x.name}"`);
  const kind = loc(x.kind === "melee" ? "SF2eTSC.ui.melee" : "SF2eTSC.ui.ranged");
  const traits = x.traits?.length ? ` (${traitsText(x.traits)})` : "";
  return `${kind} +${x.attack}${traits}, ${damageText(x.damage)}`;
}
