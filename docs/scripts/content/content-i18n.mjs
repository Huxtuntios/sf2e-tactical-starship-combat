import { MODULE_ID } from "../constants.mjs";

/**
 * Display-time translation of shipped game data (station/action/weapon/upgrade/frame/hazard/starship texts).
 *
 * The data files stay English on purpose: the rules engine parses them (DCs, saves, damage, frequencies,
 * station action names) and slugs/ids must never change. Every client translates what it shows through a
 * dictionary "English source string → translated string" (lang/content/<lang>.json, built by
 * tools/i18n/build-content-i18n.mjs). Unknown strings (GM-edited or custom content) are shown as written.
 * Translated strings may contain sf2e @Check enrichers with localized labels; use ctPlain() for tooltips.
 */
const dict = new Map();
const lower = new Map();

export const normKey = (s) =>
  String(s ?? "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

export function setContentTranslations(lang, strings = {}) {
  dict.clear();
  lower.clear();
  for (const [k, v] of Object.entries(strings ?? {})) {
    if (typeof v !== "string" || !v) continue;
    const key = normKey(k);
    dict.set(key, v);
    if (!lower.has(key.toLowerCase())) lower.set(key.toLowerCase(), v);
  }
}
/**
 * Fetch lang/content/<lang>.json (English needs no dictionary). 0.9.1: the URL carries the module version and the
 * request bypasses the HTTP cache — after an update browsers kept serving the previous dictionary, so new texts
 * (e.g. the upgrade catalog) stayed English. "ru-RU" style codes fall back to "ru". Failures are logged, not hidden.
 */
export const versionedUrl = (url) => {
  const v = globalThis.game?.modules?.get?.(MODULE_ID)?.version;
  return v ? `${url}?v=${encodeURIComponent(v)}` : url;
};
export async function loadContentTranslations(lang = globalThis.game?.i18n?.lang ?? "en") {
  const code = String(lang ?? "en")
    .toLowerCase()
    .split(/[-_]/)[0];
  if (!code || code === "en") {
    setContentTranslations("en", {});
    return 0;
  }
  try {
    const res = await fetch(versionedUrl(`modules/${MODULE_ID}/lang/content/${code}.json`), { cache: "no-cache" });
    if (!res.ok) {
      setContentTranslations(code, {});
      if (res.status !== 404) console.warn(`${MODULE_ID} | content translations ${code}: HTTP ${res.status}`);
      return 0;
    }
    const json = await res.json();
    setContentTranslations(code, json.strings ?? {});
  } catch (err) {
    console.warn(`${MODULE_ID} | content translations ${code} could not be loaded`, err);
    setContentTranslations(code, {});
  }
  console.info(`${MODULE_ID} | content translations ${code}: ${dict.size} strings`);
  return dict.size;
}

/** Translate one content string (exact match, then case-insensitive with the source's capitalisation). */
export function ct(text) {
  if (typeof text !== "string" || !text || !dict.size) return text;
  const key = normKey(text);
  const hit = dict.get(key);
  if (hit) return hit;
  const ci = lower.get(key.toLowerCase());
  if (!ci) return text;
  return /^[a-z]/.test(key) ? ci.charAt(0).toLowerCase() + ci.slice(1) : ci;
}
/** Plain-text variant (inline @Check enrichers reduced to their labels) for title attributes and logs. */
export const stripChecks = (s) => String(s ?? "").replace(/@Check\[([^\]]+)\](?:\{([^}]*)\})?/g, (m, p, label) => label ?? p);
export const ctPlain = (text) => (typeof text === "string" ? stripChecks(ct(text)) : text);
/** Comma separated list ("Boost Thrusters, Evade") translated item by item. */
export const ctList = (list) =>
  (Array.isArray(list) ? list : String(list ?? "").split(/,\s*/))
    .filter(Boolean)
    .map((x) => ct(String(x)))
    .join(", ");
