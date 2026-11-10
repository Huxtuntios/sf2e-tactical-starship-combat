import { readStarship, isStarship } from "../starship/starship-state.mjs";
import { computeShipStats } from "../starship/stats.mjs";
import { mineResolutionPlan } from "../actions/mine-resolution.mjs";
import { fromUuidSafe } from "../utils/foundry.mjs";

/** Только перемещение конечных точек; путь через промежуточные зоны не восстанавливается. */
export const mineZoneCrossing = (oldZone, newZone, mineZone) =>
  Number.isInteger(oldZone) &&
  Number.isInteger(newZone) &&
  Number.isInteger(mineZone) &&
  oldZone !== newZone &&
  (oldZone === mineZone || newZone === mineZone);

/** Данные остаются у активного GM: это не реакция, не сообщение игрокам и не детонация. */
export async function mineReactionHints({ state, combat, key, oldZone, newZone }) {
  if (!state || !combat?.id || !mineZoneCrossing(oldZone, newZone, oldZone)) return [];
  const moved = state.objects.filter((o) => o.key === key && o.type === "starship");
  if (moved.length !== 1) return [];
  const hints = [];
  for (const object of state.objects.filter((o) => o.type === "starship")) {
    if (state.objects.filter((o) => o.key === object.key).length !== 1) continue;
    const ship = await fromUuidSafe(object.actorUuid ?? object.key);
    if (!ship || !isStarship(ship) || ship.uuid !== object.key) continue;
    const data = readStarship(ship);
    for (const drone of Array.isArray(data.drones) ? data.drones : []) {
      if (!Array.isArray(drone?.mines)) continue;
      for (const mine of drone.mines) {
        if (!mineZoneCrossing(oldZone, newZone, mine?.zone)) continue;
        try {
          const station = data.stations.find((s) => s.id === drone.stationId);
          const operator = await fromUuidSafe(station?.helmedBy);
          mineResolutionPlan({
            data,
            shipUuid: ship.uuid,
            stationId: drone.stationId,
            droneId: drone.id,
            mineId: mine.id,
            combatId: combat.id,
            shipZone: object.zone,
            sensorRange: computeShipStats(ship).sensorRange,
            operator,
            combat
          });
          hints.push({ ship: ship.name, mine: mine.id });
        } catch {
          /* Не выводим догадки о невалидной или недоступной мине. */
        }
      }
    }
  }
  return hints;
}
