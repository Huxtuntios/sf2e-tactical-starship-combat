import { DATA_VERSION, DETECTION_LEVELS, ZONE_LIMITS } from "../constants.mjs";
import { contactName } from "./detection.mjs";
import { moveAlongHeading, clampZone } from "./heading.mjs";

/** Pure operations over the combat-scoped sensor state. All functions return NEW state objects. */
export function defaultSensorState(overrides = {}) {
  return {
    dataVersion: DATA_VERSION,
    enabled: false,
    zones: ZONE_LIMITS.default,
    orientation: "horizontal",
    objects: [],
    zoneInfo: {},
    knowledge: {},
    contactCounter: 0,
    hazardState: {},
    compromisedEntries: {},
    log: [],
    ...overrides
  };
}
export function normalizeSensorState(s) {
  const d = { ...defaultSensorState(), ...(s ?? {}) };
  d.zones = Math.min(ZONE_LIMITS.max, Math.max(ZONE_LIMITS.min, Math.floor(d.zones) || ZONE_LIMITS.default));
  if (!["horizontal", "vertical"].includes(d.orientation)) d.orientation = "horizontal";
  d.objects = Array.isArray(d.objects) ? d.objects.map((o) => ({ ...o, zone: clampZone(o.zone ?? 1, d.zones) })) : [];
  d.log = Array.isArray(d.log) ? d.log.slice(-80) : [];
  return d;
}
export const findObject = (s, key) => s.objects.find((o) => o.key === key) ?? null;
export const objectsInZone = (s, zone) => s.objects.filter((o) => o.zone === zone);

export function addObject(state, obj) {
  if (findObject(state, obj.key)) return state;
  const o = {
    type: "starship",
    span: 1,
    heading: "right",
    hidden: false,
    detection: { party: "observed" },
    designation: null,
    notes: "",
    ...obj,
    zone: clampZone(obj.zone ?? 1, state.zones)
  };
  return { ...state, objects: [...state.objects, o] };
}
export function removeObject(state, key) {
  return { ...state, objects: state.objects.filter((o) => o.key !== key) };
}
export function updateObject(state, key, patch) {
  return {
    ...state,
    objects: state.objects.map((o) => (o.key === key ? { ...o, ...patch, zone: clampZone(patch.zone ?? o.zone, state.zones) } : o))
  };
}
export function moveObject(state, key, zone) {
  return updateObject(state, key, { zone });
}
export function moveObjectAlongHeading(state, key, zones) {
  const o = findObject(state, key);
  if (!o) return state;
  return updateObject(state, key, { zone: moveAlongHeading(o.zone, o.heading, zones, state.zones) });
}
export function setHeading(state, key, heading) {
  return updateObject(state, key, { heading });
}
export function setDetection(state, key, observer, level) {
  if (!DETECTION_LEVELS.includes(level)) return state;
  const o = findObject(state, key);
  if (!o) return state;
  return updateObject(state, key, { detection: { ...o.detection, [observer]: level } });
}
export function assignDesignation(state, key, style, custom) {
  const o = findObject(state, key);
  if (!o || o.designation) return state;
  const designation = contactName(state.contactCounter, style, custom);
  return { ...updateObject(state, key, { designation }), contactCounter: state.contactCounter + 1 };
}
export function resizeZones(state, zones) {
  const n = Math.min(ZONE_LIMITS.max, Math.max(ZONE_LIMITS.min, zones));
  return { ...state, zones: n, objects: state.objects.map((o) => ({ ...o, zone: clampZone(o.zone, n) })) };
}
const RANK = Object.fromEntries(DETECTION_LEVELS.map((l, i) => [l, i]));
/** Highest detection level across the observers a user belongs to (player ships they crew + "party"). */
export function effectiveDetection(obj, observerKeys = ["party"]) {
  let best = "undetected";
  for (const k of ["party", ...observerKeys]) {
    const l = obj.detection?.[k];
    if (l && RANK[l] > RANK[best]) best = l;
  }
  return best;
}
/**
 * Redacted view of the sensor map for a viewer. GM sees everything. Players never receive hidden identity.
 * @returns {object[]} display objects { key, zone, heading, label, icon, level, known, hidden, type }
 */
export function viewFor(state, { isGM = false, observerKeys = [], ownKeys = [], showUnknown = true } = {}) {
  const out = [];
  for (const o of state.objects) {
    if (isGM) {
      out.push({ ...o, label: o.name, level: "identified", known: true, visible: !o.hidden });
      continue;
    }
    if (o.hidden && !ownKeys.includes(o.key)) continue;
    if (ownKeys.includes(o.key) || o.alwaysVisible) {
      out.push({ ...o, label: o.name, level: "identified", known: true, visible: true });
      continue;
    }
    const level = effectiveDetection(o, observerKeys);
    if (level === "undetected") continue;
    if (level === "hidden") {
      if (showUnknown)
        out.push({
          key: o.key,
          type: "unknown",
          zone: o.zone,
          heading: null,
          label: "?",
          level,
          known: false,
          visible: true,
          icon: null,
          span: o.span
        });
      continue;
    }
    const known = level === "identified";
    out.push({
      key: o.key,
      type: known ? o.type : "contact",
      zone: o.zone,
      heading: o.heading,
      label: known ? o.name : (o.designation ?? "Contact"),
      level,
      known,
      visible: true,
      icon: known ? o.icon : null,
      art: known ? o.art : undefined,
      actorUuid: known ? o.actorUuid : undefined,
      span: o.span
    });
  }
  return out;
}
