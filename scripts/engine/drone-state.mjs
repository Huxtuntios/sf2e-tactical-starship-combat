import { droneInventory } from "./drone-inventory.mjs";

/** Отдельные записи новой версии не преобразуют старые пользовательские данные. */
export function changeDrone(data, op, input, { definition, droneTypes, worldTime }) {
  const st = (data.stations ?? []).find((s) => s.id === input.stationId && s.type === "drone-console");
  if (!st) throw new Error("station");
  if (data.drones === undefined) data.drones = [];
  if (!Array.isArray(data.drones)) throw new Error("legacy");
  const list = data.drones;
  if (op === "add") {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.id ?? "") || !droneTypes.some((t) => t.id === input.ref)) throw new Error("invalid");
    const existing = list.find((d) => d?.id === input.id);
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
  const d = list.find((row) => row?.id === input.id && row?.stationId === st.id && row?.tscVersion === 1);
  if (!d || typeof d.deployed !== "boolean" || !droneTypes.some((t) => t.id === d.ref)) throw new Error("legacy");
  if (op === "deploy") {
    if (d.deployed) return false;
    if (d.availableAt != null && (!Number.isFinite(d.availableAt) || !Number.isFinite(worldTime) || worldTime < d.availableAt))
      throw new Error("cooldown");
    d.deployed = true;
  } else {
    if (!d.deployed) return false;
    d.deployed = false;
  }
  return true;
}
