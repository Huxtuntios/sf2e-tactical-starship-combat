/** GM вручную применяет сопротивление к конкретному Strike и подтверждает его, затем может немедленно выполнить Fetch. */
export function updateProtocolDrone(data, { stationId, droneId, operatorUuid, operationId, op, strikeRef, combat, confirmed }) {
  if (
    confirmed !== true ||
    !["block", "fetch"].includes(op) ||
    !/^[a-zA-Z0-9_-]{8,80}$/.test(operationId ?? "") ||
    !combat?.id ||
    !Number.isInteger(combat.round) ||
    combat.round < 1
  )
    throw new Error("invalid");
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId);
  const drones = (data.drones ?? []).filter((d) => d?.id === droneId);
  if (
    stations.length !== 1 ||
    stations[0].type !== "drone-console" ||
    stations[0].helmedBy !== operatorUuid ||
    stations[0].malfunctioning ||
    data.destroyed ||
    drones.length !== 1 ||
    drones[0].stationId !== stationId ||
    drones[0].tscVersion !== 1 ||
    drones[0].deployed !== true ||
    (data.upgrades ?? []).filter((u) => u.ref === "drone-shield-protocol" && u.stationId === stationId).length !== 1
  )
    throw new Error("invalid");
  const drone = drones[0],
    receipts = drone.tscProtocolReceipts;
  if (receipts != null && (!Array.isArray(receipts) || receipts.some((x) => typeof x !== "string"))) throw new Error("invalid");
  const fingerprint = JSON.stringify([operationId, op, combat.id, operatorUuid, strikeRef ?? null]);
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
  const blocks = drone.tscProtocolBlocks ?? 0;
  if (
    !Number.isInteger(blocks) ||
    blocks < 0 ||
    blocks > 2 ||
    (drone.tscProtocolFetchPending != null && typeof drone.tscProtocolFetchPending !== "boolean")
  )
    throw new Error("invalid");
  if (op === "block") {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(strikeRef ?? "") || blocks >= 2) throw new Error("invalid");
    if (
      (data.drones ?? []).some(
        (d) =>
          Array.isArray(d?.tscProtocolReceipts) &&
          d.tscProtocolReceipts.some((r) => {
            try {
              const p = JSON.parse(r);
              return p[1] === "block" && p[2] === combat.id && p[4] === strikeRef;
            } catch {
              return false;
            }
          })
      )
    )
      return false;
    const turns = combat.turns;
    if (!Array.isArray(turns) || !Number.isInteger(combat.turn) || !turns[combat.turn]?.id) throw new Error("invalid");
    drone.tscProtocolBlocks = blocks + 1;
    drone.tscProtocolFetchPending = true;
    drone.tscProtocolPendingTurn = { combatId: combat.id, round: combat.round, combatantId: turns[combat.turn].id };
  } else {
    const pending = drone.tscProtocolPendingTurn;
    if (
      drone.tscProtocolFetchPending !== true ||
      blocks < 1 ||
      pending?.combatId !== combat.id ||
      pending.round !== combat.round ||
      pending.combatantId !== combat.turns?.[combat.turn]?.id
    )
      throw new Error("invalid");
    const turns = combat.turns;
    if (
      !Array.isArray(turns) ||
      !Number.isInteger(combat.turn) ||
      combat.turn < 0 ||
      combat.turn >= turns.length ||
      turns.some((c) => !c?.id) ||
      new Set(turns.map((c) => c.id)).size !== turns.length
    )
      throw new Error("invalid");
    drone.deployed = false;
    drone.tscProtocolBlocks = 0;
    drone.tscProtocolFetchPending = false;
    delete drone.tscProtocolPendingTurn;
    drone.tscProtocolCooldown = {
      combatId: combat.id,
      untilRound: combat.round + 2,
      combatantId: turns[combat.turn].id,
      turnOrder: turns.map((c) => c.id)
    };
  }
  drone.tscProtocolReceipts = [...(receipts ?? []), fingerprint];
  return true;
}
