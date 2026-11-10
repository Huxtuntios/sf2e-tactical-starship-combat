/** Состояние кабины определяется из фактических данных; окончание не удаляет чужое состояние quickened. */
export function petOnboardStatus(data, station, pet, now) {
  const p = station?.tscPetOnboard;
  if (
    !p ||
    typeof p !== "object" ||
    p.ended === true ||
    !Number.isFinite(p.start) ||
    !Number.isFinite(p.end) ||
    p.end !== p.start + 60 ||
    !Number.isFinite(now) ||
    now < p.start ||
    now >= p.end ||
    station.helmedBy !== p.operatorUuid ||
    pet?.uuid !== p.petUuid ||
    !Number.isFinite(pet?.system?.attributes?.hp?.value) ||
    pet.system.attributes.hp.value <= 0 ||
    (data.upgrades ?? []).filter((u) => u.ref === "pet-drone-shell" && u.stationId === station.id).length !== 1
  )
    return false;
  return true;
}
export function updatePetCabin(data, { stationId, pet, operatorUuid, op, operationId, sessionId, now, confirmed }) {
  if (!["start", "end"].includes(op) || !/^[a-zA-Z0-9_-]{8,80}$/.test(operationId ?? "") || !Number.isFinite(now))
    throw new Error("invalid");
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId);
  if (stations.length !== 1 || stations[0].type !== "drone-console") throw new Error("invalid");
  const station = stations[0];
  const receipts = station.tscPetReceipts;
  if (receipts != null && (!Array.isArray(receipts) || receipts.some((x) => typeof x !== "string"))) throw new Error("invalid");
  const fingerprint = JSON.stringify([operationId, op, operatorUuid, pet?.uuid ?? null, sessionId ?? null]);
  if ((receipts ?? []).includes(fingerprint)) return false;
  if (
    (receipts ?? []).some((r) => {
      try {
        return JSON.parse(r)?.[0] === operationId;
      } catch {
        return true;
      }
    })
  )
    throw new Error("invalid");
  if ((receipts?.length ?? 0) >= 512) throw new Error("full");
  if (op === "start") {
    if (
      confirmed !== true ||
      !operatorUuid ||
      station.helmedBy !== operatorUuid ||
      data.destroyed ||
      station.malfunctioning ||
      (data.upgrades ?? []).filter((u) => u.ref === "pet-drone-shell" && u.stationId === stationId).length !== 1 ||
      !pet ||
      pet.pack ||
      pet.documentName !== "Actor" ||
      pet.system?.traits?.size?.value !== "tiny" ||
      !Number.isFinite(pet.system?.attributes?.hp?.value) ||
      pet.system.attributes.hp.value <= 0 ||
      petOnboardStatus(data, station, pet, now)
    )
      throw new Error("invalid");
    // Завершённую запись сначала явно очищает GM: старый quickened мог остаться в системе.
    if (station.tscPetOnboard) throw new Error("occupied");
    station.tscPetOnboard = { sessionId: operationId, petUuid: pet.uuid, operatorUuid, start: now, end: now + 60 };
  } else {
    if (!station.tscPetOnboard || station.tscPetOnboard.sessionId !== sessionId) throw new Error("invalid");
    delete station.tscPetOnboard;
  }
  station.tscPetReceipts = [...(receipts ?? []), fingerprint];
  return true;
}
