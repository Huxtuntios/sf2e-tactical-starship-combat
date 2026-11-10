import { safeImagePath } from "../sensor/appearance.mjs";
import { objectType } from "../sensor/object-types.mjs";
import { clampCount, parseZoneList } from "./copies.mjs";
/**
 * starship combat presets (world setting "combatPresets"). Pure helpers + thin Foundry wrappers.
 * A preset stores a complete start-wizard configuration and can be loaded in the "Start tactical starship combat" wizard.
 */
import { MODULE_ID, ZONE_LIMITS } from "../constants.mjs";

export const normalizeDetection = (v, fallback = "observed") =>
  ["identified", "observed", "hidden", "undetected"].includes(v) ? v : fallback;
export const DEFAULT_ZONES = 12;
export const clampZones = (n) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, ZONE_LIMITS.min), ZONE_LIMITS.max) : DEFAULT_ZONES;
};
const num = (n, d = undefined) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? v : d;
};

/** Normalise a start configuration (wizard output / stored preset). */
export function normalizePreset(p = {}) {
  const list = (a, f) => (Array.isArray(a) ? a : []).map(f).filter(Boolean);
  return {
    id: String(p.id ?? ""),
    name: String(p.name ?? "").trim(),
    zones: clampZones(p.zones ?? DEFAULT_ZONES),
    playerShips: list(p.playerShips, (s) =>
      typeof s === "string"
        ? { uuid: s }
        : s?.uuid
          ? { uuid: s.uuid, zone: num(s.zone), detection: normalizeDetection(s.detection, "identified") }
          : null
    ),
    enemies: list(p.enemies, (s) =>
      s?.uuid
        ? {
            uuid: s.uuid,
            zone: num(s.zone),
            detection: normalizeDetection(s.detection),
            count: clampCount(s.count),
            zones: parseZoneList(s.zones)
          }
        : null
    ),
    hazards: list(p.hazards, (s) =>
      s?.uuid ? { uuid: s.uuid, zone: num(s.zone), count: clampCount(s.count), zones: parseZoneList(s.zones) } : null
    ),
    objects: list(p.objects, (o) =>
      o?.name ? { name: String(o.name), type: objectType(o.type), zone: num(o.zone, 1), art: safeImagePath(o.art) } : null
    ),
    enemyDetection: p.enemyDetection ?? "observed"
  };
}

export function listPresets() {
  const raw = globalThis.game?.settings?.get(MODULE_ID, "combatPresets") ?? {};
  return Object.values(raw)
    .map(normalizePreset)
    .filter((p) => p.id && p.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function savePreset(preset) {
  const p = normalizePreset(preset);
  if (!p.name) return null;
  const raw = foundry.utils.deepClone(game.settings.get(MODULE_ID, "combatPresets") ?? {});
  const same = Object.values(raw).find((x) => x?.name === p.name);
  p.id = same?.id ?? foundry.utils.randomID(12);
  raw[p.id] = p;
  await game.settings.set(MODULE_ID, "combatPresets", raw);
  return p;
}
export async function deletePreset(id) {
  const raw = foundry.utils.deepClone(game.settings.get(MODULE_ID, "combatPresets") ?? {});
  delete raw[id];
  await game.settings.set(MODULE_ID, "combatPresets", raw);
}
