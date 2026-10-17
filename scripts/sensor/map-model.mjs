/**
 * Sensor map: pure rules (permissions, observer keys, the edit reducer, partial-render plan).
 * Foundry lookups are injected through `resolve` (defaults to fromUuidSync at call time).
 */
import {
  findObject,
  resizeZones,
  moveObject,
  setHeading,
  setDetection,
  removeObject,
  assignDesignation,
  updateObject
} from "../engine/sensor-ops.mjs";
import { OBJECT_TYPES } from "./object-types.mjs";
import { normalizeMapAppearance, safeImagePath } from "./appearance.mjs";
import { readStarship, isStarship } from "../starship/starship-state.mjs";

export const ICONS = {
  starship: "🚀",
  hazard: "⚠",
  contact: "○",
  unknown: "?",
  asteroid: "☄",
  station: "⌂",
  debris: "✦",
  beacon: "◈",
  planet: "◐",
  custom: "◆"
};
const defaultResolve = (u) => (u ? globalThis.fromUuidSync?.(u) : null);

/** Sensor-map ops a player may request for a ship they control. */
export const PLAYER_SENSOR_OPS = ["move", "shift"];

/** True when `user` owns the player/ally starship or one of its crew members. */
export function userControlsShip(user, actor, resolve = defaultResolve) {
  if (!actor || !isStarship(actor)) return false;
  const d = readStarship(actor);
  if (!["player", "ally"].includes(d.role)) return false;
  if (actor.testUserPermission?.(user, "OWNER")) return true;
  return d.crew.some((c) => resolve(c.actorUuid)?.testUserPermission?.(user, "OWNER"));
}

/** May `user` move the sensor-map object `key`? GM: always; players: only their own ship. */
export function canMoveKey(user, tsc, key, resolve = defaultResolve) {
  if (user?.isGM) return true;
  const o = tsc?.objects?.find((x) => x.key === key);
  if (!o || o.type !== "starship") return false;
  return userControlsShip(user, resolve(o.actorUuid ?? o.key), resolve);
}

/** Keys of the player/ally ships `user` observes (own ship or own crew member). */
export function observerKeys(tsc, user, resolve = defaultResolve) {
  const keys = [];
  for (const o of tsc.objects) {
    if (o.type !== "starship") continue;
    const a = resolve(o.actorUuid ?? o.key);
    if (!a || !isStarship(a)) continue;
    const d = readStarship(a);
    if (d.role !== "player" && d.role !== "ally") continue;
    if (a.testUserPermission?.(user, "OBSERVER") || d.crew.some((c) => resolve(c.actorUuid)?.testUserPermission?.(user, "OWNER")))
      keys.push(o.key);
  }
  return keys;
}

/** Players may only move/shift their own ship by one zone; returns the sanitized payload or throws. */
export function sanitizeSensorPayload(user, tsc, payload, resolve = defaultResolve) {
  if (user?.isGM) return payload;
  if (!PLAYER_SENSOR_OPS.includes(payload.op) || !canMoveKey(user, tsc, payload.key, resolve)) return null;
  return payload.op === "shift" ? { ...payload, by: Math.sign(Number(payload.by) || 0) } : payload;
}

/** Pure reducer of one sensor-map edit. `opts.designation` = contact designation mode. */
export function applySensorOp(s, payload, opts = {}) {
  switch (payload.op) {
    case "type":
      return OBJECT_TYPES.includes(findObject(s, payload.key)?.type) && OBJECT_TYPES.includes(payload.type)
        ? updateObject(s, payload.key, { type: payload.type })
        : s;
    case "appearance":
      return { ...s, appearance: normalizeMapAppearance(payload.appearance) };
    case "art":
      return updateObject(s, payload.key, { art: safeImagePath(payload.art) });
    case "resize":
      return resizeZones(s, payload.zones);
    case "add":
      return { ...s, objects: [...s.objects, { span: 1, ...payload.object, zone: Math.min(Math.max(1, payload.object.zone), s.zones) }] };
    case "remove":
      return removeObject(s, payload.key);
    case "flip": {
      const o = findObject(s, payload.key);
      return o?.heading ? setHeading(s, payload.key, o.heading === "left" ? "right" : "left") : s;
    }
    case "move": {
      const z = Math.round(Number(payload.zone));
      return Number.isFinite(z) && findObject(s, payload.key) ? moveObject(s, payload.key, Math.min(Math.max(1, z), s.zones)) : s;
    }
    case "shift": {
      const o = findObject(s, payload.key);
      return o ? moveObject(s, payload.key, Math.min(Math.max(1, o.zone + Number(payload.by || 0)), s.zones)) : s;
    }
    case "detect": {
      let n = setDetection(s, payload.key, "party", payload.level);
      if (payload.level === "observed") n = assignDesignation(n, payload.key, opts.designation);
      return n;
    }
    case "hidden": {
      const o = findObject(s, payload.key);
      return updateObject(s, payload.key, { hidden: !o.hidden });
    }
    case "zoneInfo":
      return {
        ...s,
        zoneInfo: {
          ...s.zoneInfo,
          [payload.zone]: {
            cover: !!payload.info.cover,
            concealment: !!payload.info.concealment,
            special: payload.info.special ?? "",
            publicNotes: payload.info.publicNotes ?? "",
            gmNotes: payload.info.gmNotes ?? ""
          }
        }
      };
    default:
      return s;
  }
}

/**
 * Which parts of the Sensor Map a refresh needs (null = everything).
 * targeting: banner + target classes on objects; actor/crew: object stats + detail; selection: zones + detail.
 */
export const SENSOR_PARTS = {
  targeting: ["bar", "zones"],
  actor: ["zones", "detail", "dock"],
  crew: ["zones", "detail", "dock"],
  select: ["zones", "detail"]
};
export const sensorPartsFor = (channel) => SENSOR_PARTS[channel] ?? null;
