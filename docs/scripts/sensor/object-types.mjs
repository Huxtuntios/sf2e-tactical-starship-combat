export const OBJECT_TYPES = ["asteroid", "station", "debris", "beacon", "planet", "custom"];
export const objectType = (value) => (OBJECT_TYPES.includes(value) ? value : "custom");
