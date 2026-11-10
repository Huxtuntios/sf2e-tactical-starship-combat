import { droneInventory } from "./drone-inventory.mjs";

/** Отдельные записи новой версии не преобразуют старые пользовательские данные. */
export function changeDrone(data, op, input, { definition, droneTypes, worldTime, combat = null }) {
  const stations = (data.stations ?? []).filter((s) => s?.id === input.stationId);
  if (stations.length !== 1 || stations[0].type !== "drone-console") throw new Error("station");
  const st = stations[0];
  if (data.drones === undefined) data.drones = [];
  if (!Array.isArray(data.drones)) throw new Error("legacy");
  const list = data.drones;
  if (op === "add") {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.id ?? "") || !droneTypes.some((t) => t.id === input.ref)) throw new Error("invalid");
    const matches = list.filter((d) => d?.id === input.id);
    if (matches.length > 1) throw new Error("legacy");
    const existing = matches[0];
    if (existing) {
      if (existing.tscVersion === 1 && existing.stationId === st.id && existing.ref === input.ref) return false;
      throw new Error("invalid");
    }
    const inv = droneInventory(data, st, definition);
    if (inv.capacity === null || inv.unassigned || inv.count >= inv.capacity) throw new Error("capacity");
    list.push({ id: input.id, ref: input.ref, stationId: st.id, tscVersion: 1, deployed: false });
    return true;
  }
  if (!["deploy", "retrieve"].includes(op)) throw new Error("invalid");
  const matches = list.filter((row) => row?.id === input.id);
  if (matches.length !== 1) throw new Error("legacy");
  const d = matches[0];
  if (d.stationId !== st.id || d.tscVersion !== 1) throw new Error("legacy");
  if (!d || typeof d.deployed !== "boolean" || !droneTypes.some((t) => t.id === d.ref)) throw new Error("legacy");
  if (op === "deploy") {
    if (d.deployed) return false;
    const inv = droneInventory(data, st, definition);
    if (inv.capacity === null || inv.unassigned || inv.over) throw new Error("capacity");
    if (d.availableAt != null && (!Number.isFinite(d.availableAt) || !Number.isFinite(worldTime) || worldTime < d.availableAt))
      throw new Error("cooldown");
    if (d.tscProtocolCooldown != null) {
      const lock = d.tscProtocolCooldown,
        turns = combat?.turns;
      if (
        !lock ||
        typeof lock !== "object" ||
        typeof lock.combatId !== "string" ||
        !Number.isInteger(lock.untilRound) ||
        typeof lock.combatantId !== "string" ||
        !Array.isArray(lock.turnOrder) ||
        !Array.isArray(turns) ||
        combat?.id !== lock.combatId ||
        !Number.isInteger(combat.round) ||
        !Number.isInteger(combat.turn) ||
        JSON.stringify(turns.map((c) => c.id)) !== JSON.stringify(lock.turnOrder) ||
        !lock.turnOrder.includes(lock.combatantId) ||
        combat.round < lock.untilRound ||
        (combat.round === lock.untilRound && combat.turn < lock.turnOrder.indexOf(lock.combatantId))
      )
        throw new Error("cooldown");
    }
    d.deployed = true;
  } else {
    if (!d.deployed) return false;
    d.deployed = false;
    // Только Retrieve снимает подтверждённое использование Intercept Munitions.
    if (d.ref === "scramble-drone" && d.tscInterceptUsed === true) d.tscInterceptUsed = false;
    if (d.tscProtocolFetchPending === true) {
      d.tscProtocolFetchPending = false;
      delete d.tscProtocolPendingTurn;
    }
  }
  return true;
}

/** Preview the same state transition without writing or guessing which ambiguous record to use. */
export function eligibleDroneMovements(data, stationId, op, env) {
  if (!["deploy", "retrieve"].includes(op) || !Array.isArray(data?.drones)) return [];
  return data.drones.filter((drone) => {
    if (!drone?.id || drone.stationId !== stationId) return false;
    try {
      return changeDrone(structuredClone(data), op, { stationId, id: drone.id }, env) === true;
    } catch {
      return false;
    }
  });
}
