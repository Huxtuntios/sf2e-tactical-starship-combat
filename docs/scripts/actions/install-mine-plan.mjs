/** Заметки GM о Mine Exocortex; не являются модификацией развёрнутой мины. */
export function saveInstallMinePlan(data, { stationId, droneId, operatorUuid, entries, operationId, confirmed, expectedPlanFingerprint }) {
  if (
    confirmed !== true ||
    !/^install-[a-zA-Z0-9]{8,40}$/.test(operationId ?? "") ||
    !Array.isArray(entries) ||
    entries.length < 1 ||
    entries.length > 4
  )
    throw new Error("invalid");
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId);
  const drones = (data.drones ?? []).filter((d) => d?.id === droneId);
  if (
    stations.length !== 1 ||
    stations[0].type !== "drone-console" ||
    stations[0].helmedBy !== operatorUuid ||
    !operatorUuid ||
    stations[0].malfunctioning ||
    data.destroyed ||
    drones.length !== 1 ||
    drones[0].tscVersion !== 1 ||
    drones[0].stationId !== stationId ||
    drones[0].ref !== "pyrotechnics-drone" ||
    drones[0].deployed !== false ||
    (data.upgrades ?? []).filter((u) => u.ref === "mine-deployment-shell" && u.stationId === stationId).length !== 1
  )
    throw new Error("invalid");
  const normalized = entries.map((e) => ({
    mine: typeof e?.mine === "string" ? e.mine.trim() : "",
    mod: typeof e?.mod === "string" ? e.mod.trim() : ""
  }));
  if (
    normalized.some((e) => !e.mine || e.mine.length > 80 || !e.mod || e.mod.length > 120) ||
    new Set(normalized.map((e) => e.mine.toLocaleLowerCase())).size !== normalized.length
  )
    throw new Error("invalid");
  const drone = drones[0];
  const previous = drone.tscInstallMinePlan;
  if (
    previous != null &&
    (typeof previous !== "object" ||
      Array.isArray(previous) ||
      typeof previous.operationId !== "string" ||
      !Array.isArray(previous.entries))
  )
    throw new Error("invalid");
  const fingerprint = JSON.stringify({ stationId, droneId, operatorUuid, entries: normalized });
  const receipts = drone.tscInstallMineReceipts ?? {};
  if (!receipts || typeof receipts !== "object" || Array.isArray(receipts) || Object.values(receipts).some((v) => typeof v !== "string"))
    throw new Error("invalid");
  if (Object.hasOwn(receipts, operationId)) {
    if (receipts[operationId] !== fingerprint) throw new Error("invalid");
    return false;
  }
  if (expectedPlanFingerprint !== undefined && expectedPlanFingerprint !== (previous?.fingerprint ?? null)) throw new Error("stale");
  if (Object.keys(receipts).length >= 512) throw new Error("invalid");
  // Во избежание повторного применения заменять запись может только GM после явного подтверждения.
  drone.tscInstallMinePlan = { operationId, fingerprint, operatorUuid, entries: normalized };
  drone.tscInstallMineReceipts = { ...receipts, [operationId]: fingerprint };
  return true;
}
