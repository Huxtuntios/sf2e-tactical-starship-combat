/** AreaEffectEngine: Burst, Cone, Emanation and Line over sensor zones (1-indexed). */
import { direction, clampZone } from "./heading.mjs";

const clampList = (list, count) => [...new Set(list.map((z) => z))].filter((z) => z >= 1 && z <= count).sort((a, b) => a - b);

/** Cone: extends from the origin in one direction for `value` zones, including the origin zone. */
export function calculateConeZones(originZone, heading, value, zoneCount) {
  const dir = direction(heading);
  return clampList(
    Array.from({ length: value + 1 }, (_, i) => originZone + dir * i),
    zoneCount
  );
}

/** Line: same footprint as a cone, but at most one target per zone (enforced when picking targets). */
export function calculateLineZones(originZone, heading, value, zoneCount) {
  return calculateConeZones(originZone, heading, value, zoneCount);
}

/** Emanation: origin zone and `radius` zones to either side. Radius 0 = origin zone only. */
export function calculateEmanationZones(originZone, radius, zoneCount) {
  return clampList(
    Array.from({ length: radius * 2 + 1 }, (_, i) => originZone - radius + i),
    zoneCount
  );
}

/**
 * Burst: originates from the border between two zones. `border` is the zone number of the left-hand zone
 * (border between `border` and `border + 1`). A burst of N covers N zones in each direction.
 * A 0-zone burst affects the single zone `border`.
 */
export function calculateBurstZones(border, value, zoneCount) {
  if (value <= 0) return clampList([border], zoneCount);
  const lo = border - value + 1;
  const hi = border + value;
  return clampList(
    Array.from({ length: hi - lo + 1 }, (_, i) => lo + i),
    zoneCount
  );
}

/** Dispatch by area type. `area` = { type, value, heading?, border? }. */
export function calculateAreaZones(area, originZone, heading, zoneCount) {
  switch (area.type) {
    case "cone":
      return calculateConeZones(originZone, area.heading ?? heading, area.value, zoneCount);
    case "line":
      return calculateLineZones(originZone, area.heading ?? heading, area.value, zoneCount);
    case "emanation":
      return calculateEmanationZones(originZone, area.value, zoneCount);
    case "burst":
      return calculateBurstZones(area.border ?? originZone, area.value, zoneCount);
    default:
      return [clampZone(originZone, zoneCount)];
  }
}

/** Parse an area trait string such as "cone", "area (burst 1 zone)", "line" (value comes from the weapon). */
export function parseAreaTrait(text, fallbackValue = 1) {
  const m = /(burst|cone|line|emanation)\s*(\d+)?/i.exec(String(text ?? ""));
  if (!m) return null;
  return { type: m[1].toLowerCase(), value: m[2] ? Number(m[2]) : fallbackValue };
}

/**
 * Starships hit by an area: every starship in the area zones except the attacker and the explicitly excluded keys.
 * @returns {{ hit: object[], excluded: object[] }}
 */
export function areaTargets(objects, zones, selfKey, exclude = []) {
  const ex = new Set(exclude ?? []);
  const hit = [];
  const excluded = [];
  for (const o of objects ?? []) {
    if (o.type !== "starship" || o.key === selfKey || !zones.includes(o.zone)) continue;
    (ex.has(o.key) ? excluded : hit).push(o);
  }
  return { hit, excluded };
}
