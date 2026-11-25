import { STARSHIP_ROLES } from "../constants.mjs";

const NPC_SIZE_RANGES = Object.freeze({ tiny: 3, small: 4, medium: 4, large: 5, huge: 6, gargantuan: 7 });
const validRange = (value) => Number.isInteger(value) && value >= 0;
const unresolved = () => ({
  value: null,
  source: "unresolved",
  warning: "sensorRange has no verified statblock, player frame or NPC size source"
});

/** Resolve the persistent base range only; scanner advancement is applied by computeShipStats. */
export function resolveBaseSensorRange(data, frame = null) {
  const explicit = data?.sensorRange;
  if (explicit !== undefined && explicit !== null) {
    return validRange(explicit)
      ? { value: explicit, source: "explicit", warning: null }
      : { value: null, source: "invalid", warning: "sensorRange must be a non-negative integer" };
  }
  if (data?.role === "player") {
    return validRange(frame?.sensorRange) ? { value: frame.sensorRange, source: "frame", warning: null } : unresolved();
  }
  if (STARSHIP_ROLES.includes(data?.role) && data.role !== "player") {
    const size = String(data.size ?? "").toLowerCase();
    if (Object.hasOwn(NPC_SIZE_RANGES, size)) return { value: NPC_SIZE_RANGES[size], source: `size:${size}`, warning: null };
  }
  return unresolved();
}
