/** A GM-assisted resolution aid, not an automatic detonation or damage application. */
export function mineResolutionPlan({ data, shipUuid, stationId, droneId, mineId, combatId, shipZone, sensorRange, operator }) {
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId && s.type === "drone-console");
  if (stations.length !== 1 || stations[0].malfunctioning || data.destroyed) throw new Error("station");
  const station = stations[0];
  const drones = Array.isArray(data.drones) ? data.drones : [];
  const ownerDrones = drones.filter(
    (d) => d?.id === droneId && d.stationId === stationId && d.tscVersion === 1 && d.ref === "pyrotechnics-drone"
  );
  if (ownerDrones.length !== 1 || !Array.isArray(ownerDrones[0].mines)) throw new Error("mine");
  const mines = ownerDrones[0].mines.filter((m) => m?.id === mineId && m.droneId === droneId && m.shipUuid === shipUuid);
  if (mines.length !== 1 || mines[0].state !== "armed" || mines[0].combatId !== combatId) throw new Error("mine");
  const mine = mines[0];
  if (!operator || station.helmedBy !== operator.uuid || mine.operatorUuid !== operator.uuid) throw new Error("operator");
  if (!drones.some((d) => d?.stationId === stationId && d.tscVersion === 1 && d.ref === "pyrotechnics-drone" && d.deployed === true))
    throw new Error("drone");
  if (
    !Number.isInteger(shipZone) ||
    !Number.isInteger(mine.zone) ||
    !Number.isFinite(sensorRange) ||
    sensorRange < 0 ||
    Math.abs(shipZone - mine.zone) > sensorRange
  )
    throw new Error("range");
  // Do not silently discard a future/legacy modification whose rules or duration we cannot resolve.
  if ((Array.isArray(mine.modifications) ? mine.modifications.length : mine.modifications != null) || mine.modification != null)
    throw new Error("modified");
  const level = operator.system?.details?.level?.value ?? operator.level;
  const dc = operator.classDC?.dc?.value ?? operator.getStatistic?.("class-dc")?.dc?.value ?? operator.getStatistic?.("class")?.dc?.value;
  if (!Number.isInteger(level) || level < 1 || level > 20 || !Number.isInteger(dc) || dc < 1 || dc > 100) throw new Error("statistics");
  return { zone: mine.zone, dc, dice: 2 + Math.floor((level - 1) / 2) };
}

/** GM must explicitly adjudicate Mobile Exocortex before invoking this operation. */
export function moveOwnedMine({
  data,
  shipUuid,
  stationId,
  droneId,
  mineId,
  combatId,
  shipZone,
  sensorRange,
  zones,
  destination,
  origin,
  moveId,
  operatorUuid
}) {
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId && s.type === "drone-console" && s.helmedBy === operatorUuid);
  if (stations.length !== 1 || stations[0].malfunctioning || data.destroyed) throw new Error("station");
  const drones = Array.isArray(data.drones) ? data.drones : [];
  const owners = drones.filter(
    (d) => d?.id === droneId && d.stationId === stationId && d.tscVersion === 1 && d.ref === "pyrotechnics-drone"
  );
  if (owners.length !== 1 || !Array.isArray(owners[0].mines)) throw new Error("mine");
  const mines = owners[0].mines.filter(
    (m) => m?.id === mineId && m.droneId === droneId && m.shipUuid === shipUuid && m.operatorUuid === operatorUuid
  );
  if (mines.length !== 1 || mines[0].state !== "armed" || mines[0].combatId !== combatId) throw new Error("mine");
  if (!drones.some((d) => d?.stationId === stationId && d.tscVersion === 1 && d.ref === "pyrotechnics-drone" && d.deployed === true))
    throw new Error("drone");
  const mine = mines[0];
  if (
    !Number.isInteger(shipZone) ||
    !Number.isInteger(mine.zone) ||
    !Number.isFinite(sensorRange) ||
    sensorRange < 0 ||
    Math.abs(shipZone - mine.zone) > sensorRange
  )
    throw new Error("range");
  if (!Number.isInteger(zones) || !Number.isInteger(destination) || destination < 1 || destination > zones) throw new Error("zone");
  if (!Number.isInteger(origin) || origin < 1 || origin > zones || !/^[a-zA-Z0-9_-]{1,64}$/.test(moveId ?? "")) throw new Error("zone");
  if (mine.moveReceipts != null && (!Array.isArray(mine.moveReceipts) || mine.moveReceipts.some((r) => typeof r !== "string")))
    throw new Error("mine");
  if ((mine.moveReceipts ?? []).includes(moveId) || destination === origin) return false;
  if (mine.zone !== origin || Math.abs(origin - destination) !== 1) throw new Error("zone");
  if ((mine.moveReceipts?.length ?? 0) >= 512) throw new Error("mine");
  mine.zone = destination;
  mine.moveReceipts = [...(mine.moveReceipts ?? []), moveId];
  return true;
}
