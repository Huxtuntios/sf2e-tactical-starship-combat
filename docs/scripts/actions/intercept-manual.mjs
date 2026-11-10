/** Ведущий вручную подтверждает уже учтённый штраф; функция не меняет системный бросок. */
export function markManualIntercept(data, { stationId, droneId, operatorUuid, combatId, interceptId, strikeRef }) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(interceptId ?? "") || !/^[a-zA-Z0-9._:-]{1,128}$/.test(strikeRef ?? "") || !combatId || !operatorUuid)
    throw new Error("invalid");
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId);
  const drones = (data.drones ?? []).filter((d) => d?.id === droneId);
  if (
    stations.length !== 1 ||
    stations[0].type !== "drone-console" ||
    stations[0].malfunctioning ||
    stations[0].helmedBy !== operatorUuid ||
    data.destroyed ||
    drones.length !== 1
  )
    throw new Error("invalid");
  const drone = drones[0];
  if (drone.stationId !== stationId || drone.ref !== "scramble-drone" || drone.tscVersion !== 1) throw new Error("invalid");
  const store = drone.tscInterceptReceipts;
  if (store != null && (typeof store !== "object" || Array.isArray(store))) throw new Error("invalid");
  const receipts = store ?? {};
  if (Object.values(receipts).some((v) => typeof v !== "string")) throw new Error("invalid");
  const fingerprint = JSON.stringify({ stationId, droneId, operatorUuid, combatId, strikeRef });
  if (Object.hasOwn(receipts, interceptId)) {
    if (receipts[interceptId] !== fingerprint) throw new Error("duplicate");
    return false;
  }
  // Один и тот же подтверждённый Strike нельзя записать повторно и после Retrieve.
  if (Object.values(receipts).includes(fingerprint)) return false;
  if (Object.keys(receipts).length >= 512 || (drone.tscInterceptUsed != null && typeof drone.tscInterceptUsed !== "boolean"))
    throw new Error("invalid");
  if (drone.deployed !== true || drone.tscInterceptUsed === true) throw new Error("used");
  drone.tscInterceptUsed = true;
  drone.tscInterceptReceipts = { ...receipts, [interceptId]: fingerprint };
  return true;
}
