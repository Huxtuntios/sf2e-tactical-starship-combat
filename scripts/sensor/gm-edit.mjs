const RESET = Object.freeze({ destroyed: false, compromised: 0, inoperable: false, wrecked: 0, offKilter: false });

/** Ship state patches (applied in order) that make statusOf() return `status`. */
export function statusPatches(status) {
  switch (status) {
    case "operational":
      return [{ ...RESET }];
    case "off-kilter":
      return [{ ...RESET, offKilter: true }];
    case "compromised":
      return [{ ...RESET, compromised: 1 }];
    case "wrecked":
      return [{ ...RESET, wrecked: 1 }];
    case "destroyed":
      return [{ ...RESET, destroyed: true }];
    // the server clears `inoperable` when compromised is set to 0, so it goes in a second patch
    case "inoperable":
      return [{ ...RESET }, { inoperable: true }];
    default:
      return [];
  }
}

export function clampPool(value, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Number.isFinite(Number(max)) ? Math.min(Number(max), n) : n);
}

/**
 * Requests for one GM edit. Returns [{ name, payload }].
 * Heading is the sensor-map object heading (flip op), HP/SP/status are ship state (patchShip).
 */
export function gmEditRequests({ field, value, shipUuid, key, current, max, combatId }) {
  if (field === "hp" || field === "sp") {
    const v = clampPool(value, max);
    if (v === null) return [];
    return [{ name: "patchShip", payload: { shipUuid, patch: { [field]: { value: v } } } }];
  }
  if (field === "heading") return value && value !== current ? [{ name: "sensorUpdate", payload: { op: "flip", combatId, key } }] : [];
  if (field === "status") return statusPatches(value).map((patch) => ({ name: "patchShip", payload: { shipUuid, patch } }));
  return [];
}
