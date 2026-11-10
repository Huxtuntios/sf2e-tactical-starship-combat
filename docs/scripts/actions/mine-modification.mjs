import { uniqueOwnedMine } from "./mine-resolution.mjs";

import { mineModificationStatus } from "./mine-modification-timing.mjs";

/** GM подтверждает наличие Modify; обработчик вызывается только внутри очереди Actor. */
export function modifyOwnedMine({ data, shipUuid, stationId, droneId, mineId, operator, combat, shipZone, origin, type, modificationId }) {
  if (!["smart", "targeting"].includes(type) || !/^mineMod-[a-zA-Z0-9]{8,40}$/.test(modificationId ?? "")) throw new Error("invalid");
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId);
  const st = stations.length === 1 ? stations[0] : null;
  if (!st || st.type !== "drone-console" || st.malfunctioning || data.destroyed || !operator?.uuid || st.helmedBy !== operator.uuid)
    throw new Error("station");
  const { drone, mine } = uniqueOwnedMine(data, { stationId, droneId, mineId, shipUuid });
  if (drone.ref !== "pyrotechnics-drone" || mine.operatorUuid !== operator.uuid || mine.state !== "armed" || mine.combatId !== combat?.id)
    throw new Error("mine");
  const drones = data.drones ?? [];
  if (
    !drones.some(
      (d) =>
        d?.tscVersion === 1 &&
        d.stationId === stationId &&
        d.ref === "pyrotechnics-drone" &&
        d.deployed === true &&
        typeof d.id === "string" &&
        d.id &&
        drones.filter((other) => other?.id === d.id).length === 1
    )
  )
    throw new Error("drone");
  if (!Number.isInteger(shipZone) || !Number.isInteger(origin) || mine.zone !== origin || origin !== shipZone) throw new Error("zone");
  if ((Array.isArray(mine.modifications) ? mine.modifications.length : mine.modifications != null) || mine.modification != null)
    throw new Error("modified");
  const receipts = mine.tscModificationReceipts;
  if (
    receipts != null &&
    (typeof receipts !== "object" || Array.isArray(receipts) || Object.values(receipts).some((x) => typeof x !== "string"))
  )
    throw new Error("receipts");
  const fingerprint = JSON.stringify({ stationId, droneId, mineId, operatorUuid: operator.uuid, combatId: combat.id, origin, type });
  if (Object.hasOwn(receipts ?? {}, modificationId)) {
    if (receipts[modificationId] !== fingerprint) throw new Error("duplicate");
    return false;
  }
  if (Object.keys(receipts ?? {}).length >= 512) throw new Error("receipts");
  const turns = combat?.turns;
  if (
    !Number.isInteger(combat.round) ||
    combat.round < 1 ||
    !Number.isInteger(combat.turn) ||
    !Array.isArray(turns) ||
    combat.turn < 0 ||
    combat.turn >= turns.length ||
    turns.some((c) => !c?.id) ||
    new Set(turns.map((c) => c.id)).size !== turns.length ||
    turns.filter((c) => c.actor?.uuid === operator.uuid).length !== 1 ||
    turns[combat.turn]?.actor?.uuid !== operator.uuid
  )
    throw new Error("turn");
  if (mineModificationStatus(mine, combat, operator.uuid)) throw new Error("modified");
  mine.tscMineModification = {
    type,
    operatorUuid: operator.uuid,
    combatId: combat.id,
    combatantId: turns[combat.turn].id,
    createdRound: combat.round,
    expiresRound: combat.round + 1,
    turnOrder: turns.map((c) => c.id)
  };
  mine.tscModificationReceipts = { ...(receipts ?? {}), [modificationId]: fingerprint };
  return true;
}
