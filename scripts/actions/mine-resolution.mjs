import { mineModificationStatus } from "./mine-modification-timing.mjs";

/**
 * ID записи должен быть однозначным во всём корабле, а не только в выбранной станции.
 * Функция не меняет старые данные и не пытается исправить дубликаты.
 */
export function uniqueOwnedMine(data, { stationId, droneId, mineId, shipUuid }) {
  if (![stationId, droneId, mineId, shipUuid].every((id) => typeof id === "string" && id.length > 0)) throw new Error("mine");
  if ((data.stations ?? []).filter((s) => s?.id === stationId).length > 1) throw new Error("station");
  const drones = Array.isArray(data?.drones) ? data.drones : [];
  const owners = drones.filter((d) => d?.id === droneId);
  if (owners.length !== 1 || owners[0].stationId !== stationId || owners[0].tscVersion !== 1 || !Array.isArray(owners[0].mines))
    throw new Error("mine");
  const matches = drones.flatMap((d) => (Array.isArray(d?.mines) ? d.mines : [])).filter((m) => m?.id === mineId);
  if (matches.length !== 1 || matches[0].droneId !== droneId || matches[0].shipUuid !== shipUuid || !owners[0].mines.includes(matches[0]))
    throw new Error("mine");
  return { drone: owners[0], mine: matches[0] };
}

function uniqueConsole(data, stationId) {
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId);
  if (stations.length !== 1 || stations[0].type !== "drone-console" || stations[0].malfunctioning || data.destroyed)
    throw new Error("station");
  return stations[0];
}

function hasDeployedPyrotechnics(data, stationId) {
  const drones = Array.isArray(data.drones) ? data.drones : [];
  return drones.some(
    (d) =>
      typeof d?.id === "string" &&
      d.id.length > 0 &&
      drones.filter((other) => other?.id === d.id).length === 1 &&
      d.stationId === stationId &&
      d.tscVersion === 1 &&
      d.ref === "pyrotechnics-drone" &&
      d.deployed === true
  );
}

/** A GM-assisted resolution aid, not an automatic detonation or damage application. */
export function mineResolutionPlan({
  data,
  shipUuid,
  stationId,
  droneId,
  mineId,
  combatId,
  shipZone,
  sensorRange,
  operator,
  combat = null
}) {
  const station = uniqueConsole(data, stationId);
  const { drone, mine } = uniqueOwnedMine(data, { stationId, droneId, mineId, shipUuid });
  if (drone.ref !== "pyrotechnics-drone" || mine.state !== "armed" || mine.combatId !== combatId) throw new Error("mine");
  if (!operator || station.helmedBy !== operator.uuid || mine.operatorUuid !== operator.uuid) throw new Error("operator");
  if (!hasDeployedPyrotechnics(data, stationId)) throw new Error("drone");
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
  const modification = mineModificationStatus(mine, combat, operator.uuid);
  if (!modification) return { zone: mine.zone, dc, dice: 2 + Math.floor((level - 1) / 2) };
  let bonus = 0;
  if (modification === "targeting") {
    const intelligence = operator.system?.abilities?.int?.mod;
    if (!Number.isInteger(intelligence)) throw new Error("statistics");
    bonus = Math.max(1, intelligence);
  }
  return { zone: mine.zone, dc, dice: 2 + Math.floor((level - 1) / 2), modification, bonus };
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
  const station = uniqueConsole(data, stationId);
  if (!operatorUuid || station.helmedBy !== operatorUuid) throw new Error("station");
  const { drone, mine } = uniqueOwnedMine(data, { stationId, droneId, mineId, shipUuid });
  if (drone.ref !== "pyrotechnics-drone" || mine.operatorUuid !== operatorUuid || mine.state !== "armed" || mine.combatId !== combatId)
    throw new Error("mine");
  if (!hasDeployedPyrotechnics(data, stationId)) throw new Error("drone");
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
