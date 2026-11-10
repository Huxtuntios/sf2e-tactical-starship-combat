import { classifyRange } from "./range.mjs";
import { effectiveDetection, findObject } from "./sensor-ops.mjs";
import { detectionTargetability } from "./detection.mjs";

/**
 * Single source of truth for "can this starship target that object right now" (pure).
 * Used by the GM-side validation (executeAction → resolveTarget), the attack declaration card and the Sensor Map
 * targeting overlay, so the three can never disagree.
 *
 * Reason codes: notPlaced | self | notStarship | destroyed | undetected | hidden | outOfRange | tooFar
 */
export const TARGET_REASON_ERRORS = Object.freeze({
  notPlaced: "notPlaced",
  self: "badTarget",
  notStarship: "badTarget",
  destroyed: "badTarget",
  undetected: "targetUndetected",
  hidden: "targetHidden",
  outOfRange: "outOfRange",
  tooFar: "outOfRange"
});

/**
 * @param {object} p
 * @param {object} p.tsc            sensor state
 * @param {string} p.shipKey        attacker key on the sensor map
 * @param {object} p.obj            candidate sensor object
 * @param {number} p.range          maximum range in zones
 * @param {number|null} [p.rangeIncrement]  zones per increment (max 6 increments)
 * @param {boolean} [p.allowSelf]
 * @param {boolean} [p.enforceDetection]   player ships: hidden/undetected objects can't be targeted
 * @param {boolean} [p.override]           GM override: range and detection are not enforced
 * @param {boolean} [p.soft]               warn mode: range / detection problems stay available and come back as `warning`
 * @param {(key:string)=>boolean} [p.isDestroyed]
 */
export function evaluateTarget({
  tsc,
  shipKey,
  obj,
  range,
  rangeIncrement = null,
  allowSelf = false,
  enforceDetection = true,
  override = false,
  soft = false,
  isDestroyed = () => false
}) {
  const me = findObject(tsc, shipKey);
  const level = effectiveDetection(obj, [shipKey]);
  const base = { key: obj.key, zone: obj.zone, distance: null, range, level, available: false, reason: null };
  if (!me) return { ...base, reason: "notPlaced" };
  const cls = classifyRange(me.zone, obj.zone, range ?? 99);
  const out = { ...base, distance: cls.distance, inRange: cls.inRange };
  if (obj.key === shipKey && !allowSelf) return { ...out, reason: "self" };
  if (obj.type !== "starship") return { ...out, reason: "notStarship" };
  if (isDestroyed(obj.key)) return { ...out, reason: "destroyed" };
  if (enforceDetection && !override && obj.key !== shipKey) {
    const tg = detectionTargetability(level);
    if (tg === "no") return softOr(out, "undetected", soft);
    if (tg === "flat-check") return softOr(out, "hidden", soft);
  }
  if (!override) {
    if (!cls.inRange) return softOr(out, "outOfRange", soft);
    if (rangeIncrement && Math.ceil(cls.distance / rangeIncrement) > 6) return softOr(out, "tooFar", soft);
  }
  return { ...out, available: true };
}

/** Range / detection problems: blocked in strict mode, an available target with a `warning` in warn mode. */
const softOr = (out, reason, soft) => (soft ? { ...out, available: true, warning: reason } : { ...out, reason });

/** All candidate objects (every sensor object except the attacker), nearest first. */
export function evaluateTargets(p) {
  const list = (p.tsc.objects ?? [])
    .filter((o) => o.key !== p.shipKey || p.allowSelf)
    .map((obj) => ({ obj, ev: evaluateTarget({ ...p, obj }) }));
  return list.sort((a, b) => (a.ev.distance ?? 99) - (b.ev.distance ?? 99));
}

/**
 * May a player (non-GM) even learn that this candidate exists? Players never see hidden/undetected objects
 * or objects the GM hid from the map; the GM gets those in a whispered diagnostic instead.
 */
export function visibleToPlayers(obj, shipKey) {
  if (obj.hidden) return false;
  if (obj.alwaysVisible || obj.key === shipKey) return true;
  const level = effectiveDetection(obj, [shipKey]);
  return level === "observed" || level === "identified";
}
