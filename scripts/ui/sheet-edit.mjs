/** Pure parsing helpers for the starship editor (unit-tested). */
export const NPC_COSTS = ["one-action", "two-actions", "three-actions", "reaction", "free-action", "passive"];
export const parseCsv = (s) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
/** "fire 5, cold 10" / "computers +12" → { fire: 5, cold: 10 } (keys lower-cased, spaces → hyphens). */
export function parseKv(s) {
  const out = {};
  for (const part of parseCsv(s)) {
    const m = /^(.*?)[\s:=]+([+-]?\d+)$/.exec(part);
    if (m) out[m[1].trim().toLowerCase().replace(/\s+/g, "-")] = Number(m[2]);
  }
  return out;
}
export function formatKv(obj) {
  if (!obj || typeof obj !== "object") return typeof obj === "string" ? obj : "";
  return Object.entries(obj)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}
