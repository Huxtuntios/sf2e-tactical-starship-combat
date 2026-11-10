import { MODULE_ID } from "../constants.mjs";

export const MAX_COPIES = 10;
/** Clamp a requested copy count to 1..MAX_COPIES. */
export function clampCount(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_COPIES, Math.max(1, v)) : 1;
}
/** "Corsair (Lv 3)" + 2 -> "Corsair #2 (Lv 3)"; names without a trailing "(...)" get the suffix at the end. */
export function copyName(base, n) {
  const m = /^(.*?)(\s*\([^()]*\))?$/.exec(String(base ?? ""));
  return `${m[1].trimEnd()} #${n}${m[2] ?? ""}`;
}
/** "6, 7 8" -> [6, 7, 8]: zones for copy #1, #2, ... (positive integers only). */
export function parseZoneList(text) {
  if (Array.isArray(text))
    return text
      .map((z) => Math.round(Number(z)))
      .filter((z) => Number.isFinite(z) && z > 0)
      .slice(0, MAX_COPIES);
  return String(text ?? "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
    .filter((z) => z > 0)
    .slice(0, MAX_COPIES);
}
/** Expand wizard entries with a count into one entry per copy (copyIndex 1 = the original actor). */
export function expandEntries(entries) {
  const out = [];
  for (const e of entries ?? []) {
    const entry = typeof e === "string" ? { uuid: e } : e;
    const count = clampCount(entry.count ?? 1);
    const zones = Array.isArray(entry.zones) ? entry.zones : [];
    for (let i = 1; i <= count; i++) out.push({ ...entry, count, copyIndex: i, zone: zones[i - 1] ?? entry.zone });
  }
  return out;
}

async function copiesFolder() {
  const name = game.i18n.localize("SF2eTSC.wizard.copiesFolder");
  return game.folders.find((f) => f.type === "Actor" && f.name === name) ?? (await Folder.create({ name, type: "Actor" }));
}
/**
 * Resolve an expanded entry to an actor: copyIndex 1 is the source actor, every further copy is a separate world
 * actor (own HP / SP / status / hazard state), so the combat engine handles each copy independently.
 */
export async function actorForCopy(src, entry) {
  if (!src || (entry.copyIndex ?? 1) <= 1) return src;
  const data = src.toObject();
  delete data._id;
  data.name = copyName(src.name, entry.copyIndex);
  data.folder = (await copiesFolder())?.id ?? null;
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), tacticalCopyOf: src.uuid } };
  if (data.prototypeToken) data.prototypeToken.name = data.name;
  return Actor.create(data);
}
