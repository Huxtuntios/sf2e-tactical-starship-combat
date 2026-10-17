import { findObject, objectsInZone } from "../engine/sensor-ops.mjs";
import { stationOf } from "../starship/starship-state.mjs";

/**
 * Requirement checks. Each returns { ok, soft?, key }. "soft" requirements are only enforced when the
 * "Strict station requirements" setting is on (they depend on information the module cannot always verify).
 */
export function checkRequirement(req, ctx) {
  const { data, stats, station, tsc, options, target } = ctx;
  switch (req.type) {
    case "notOffKilter":
      return { ok: !stats.offKilter, key: "offKilter" };
    case "notInoperable":
      return { ok: !stats.inoperable && !data.destroyed, key: "inoperable" };
    case "notImmobilized":
      return { ok: !data.destroyed, key: "destroyed" };
    case "hasShields":
      return { ok: data.sp.value > 0, key: "noShields" };
    case "inoperable":
      return { ok: !!data.inoperable || data.compromised > 0, key: "notInoperable" };
    case "helmingAny":
      return { ok: !!station && req.stations.includes(station.type), key: "wrongStation" };
    case "helmingMalfunctioning":
      return { ok: !!station && station.malfunctioning, key: "notMalfunctioning" };
    case "npcFortify":
      return { ok: (data.fortify ?? 0) > 0, key: "noFortify" };
    case "weaponTrait": {
      const w = ctx.weapon;
      return { ok: !!w && (w.traits ?? []).some((t) => String(t).toLowerCase().startsWith(req.trait)), key: "weaponTrait" };
    }
    case "sameZoneLargerObject": {
      const me = findObject(tsc, ctx.shipUuid);
      if (!me) return { ok: false, key: "notPlaced" };
      return { ok: objectsInZone(tsc, me.zone).some((o) => o.key !== me.key), soft: true, key: "noCover" };
    }
    case "otherStarshipInZone": {
      const me = findObject(tsc, ctx.shipUuid);
      if (!me) return { ok: false, key: "notPlaced" };
      return { ok: objectsInZone(tsc, me.zone).some((o) => o.key !== me.key && o.type === "starship"), key: "noOtherShip" };
    }
    case "identifiedStation": {
      if (!target) return { ok: true, soft: true, key: "unidentified" };
      const known = tsc.knowledge?.[ctx.target.modelKey]?.stations ?? [];
      return { ok: !!options.targetStationId && known.includes(options.targetStationId), soft: true, key: "unidentified" };
    }
    case "techTarget":
      return { ok: !target || (target.data.traits ?? []).includes("tech"), soft: true, key: "notTech" };
    case "drone":
      return { ok: (data.drones ?? []).some((d) => d.deployed) || !(data.drones ?? []).length, soft: true, key: "noDrone" };
    default:
      return { ok: true, key: "unknown" };
  }
}

export function evaluateRequirements(action, ctx, strict) {
  const failed = [];
  for (const req of action.requirements ?? []) {
    const r = checkRequirement(req, ctx);
    if (!r.ok && (!r.soft || strict)) failed.push(r.key);
  }
  return failed;
}
export { stationOf };
