/** Только потенциальная возможность: до броска нельзя установить, попадёт ли Strike. */
export function eligibleInterceptHints(data) {
  if (!data || data.destroyed || !Array.isArray(data.stations) || !Array.isArray(data.drones)) return [];
  return data.drones
    .filter((drone) => {
      if (
        !drone ||
        typeof drone.id !== "string" ||
        !drone.id ||
        drone.ref !== "scramble-drone" ||
        drone.tscVersion !== 1 ||
        drone.deployed !== true ||
        (drone.tscInterceptUsed != null && drone.tscInterceptUsed !== false) ||
        data.drones.filter((d) => d?.id === drone.id).length !== 1
      )
        return false;
      const stations = data.stations.filter((s) => s?.id === drone.stationId);
      return stations.length === 1 && stations[0].type === "drone-console" && !stations[0].malfunctioning && !!stations[0].helmedBy;
    })
    .map((d) => d.id);
}
