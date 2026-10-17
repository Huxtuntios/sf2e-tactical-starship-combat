import { DETECTION_LEVELS, DEGREE, GREEK, NAVAL } from "../constants.mjs";

/** Only observed / identified objects can be targeted normally; hidden needs a flat check, undetected can't be targeted. */
export function detectionTargetability(level) {
  return level === "observed" || level === "identified" ? "ok" : level === "hidden" ? "flat-check" : "no";
}
/** Result of Seek Starships against a single target (rules text, Tech Core p.182). */
export function resolveSeek(current, degree) {
  const idx = DETECTION_LEVELS.indexOf(current);
  if (degree === DEGREE.CRITICAL_SUCCESS && (current === "undetected" || current === "hidden")) return "observed";
  if (degree === DEGREE.SUCCESS) {
    if (current === "undetected") return "hidden";
    if (current === "hidden") return "observed";
  }
  return DETECTION_LEVELS[Math.max(0, idx)];
}
/** Contact designations: Greek ("Contact Alpha"), numeric ("Contact 01"), naval ("Contact Bravo"), custom prefix. */
export function contactName(index, style = "greek", custom = "Contact") {
  const n = index;
  switch (style) {
    case "numeric":
      return `Contact ${String(n + 1).padStart(2, "0")}`;
    case "naval":
      return `Contact ${NAVAL[n % NAVAL.length]}${n >= NAVAL.length ? ` ${Math.floor(n / NAVAL.length) + 1}` : ""}`;
    case "custom":
      return `${custom} ${n + 1}`;
    default:
      return `Contact ${GREEK[n % GREEK.length]}${n >= GREEK.length ? ` ${Math.floor(n / GREEK.length) + 1}` : ""}`;
  }
}

const SEEK_DC_BY_LEVEL = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
/**
 * Stealth DC a Seek Starships check is compared to: an explicit DC wins, then 10 + Stealth modifier,
 * otherwise (no Stealth skill on the sheet) the level-based DC. Never 0.
 */
export function seekDC({ stealthDC = null, stealthMod = null, level = 0 } = {}) {
  const dc = Number(stealthDC);
  if (stealthDC != null && Number.isFinite(dc) && dc > 0) return dc;
  const mod = Number(stealthMod);
  if (stealthMod != null && stealthMod !== "" && Number.isFinite(mod)) return 10 + mod;
  const l = Math.min(Math.max(0, Math.floor(Number(level) || 0)), SEEK_DC_BY_LEVEL.length - 1);
  return SEEK_DC_BY_LEVEL[l];
}
