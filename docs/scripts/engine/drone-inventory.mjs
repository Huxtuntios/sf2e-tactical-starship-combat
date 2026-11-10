/** Read-only inventory check; never changes old drone records or invents a station assignment. */
export function droneInventory(data, station, definition) {
  if (station?.type !== "drone-console") return null;
  const row = definition?.advancement?.find((item) => item.grade === station.grade);
  const capacity = Number.isInteger(row?.drones) && row.drones >= 0 ? row.drones : null;
  const drones = Array.isArray(data?.drones) ? data.drones : [];
  const consoles = (data?.stations ?? []).filter((item) => item.type === "drone-console");
  const unassigned = drones.filter((drone) => !drone || typeof drone !== "object" || !drone.stationId);
  const consoleIds = new Set(consoles.map((console) => console.id));
  const orphaned = drones.filter((drone) => drone && typeof drone === "object" && drone.stationId && !consoleIds.has(drone.stationId));
  const assigned = drones.filter((drone) => drone && typeof drone === "object" && drone.stationId === station.id);
  // Legacy records are attributable only when there is exactly one console.
  const count = assigned.length + (consoles.length === 1 ? unassigned.length : 0);
  return {
    capacity,
    count,
    unassigned: orphaned.length + (consoles.length > 1 ? unassigned.length : 0),
    over: capacity !== null && count > capacity
  };
}
