/**
 * Starship upgrades: catalog, station assignments and capacity (pure, no Foundry globals).
 *
 * Single source of truth: the ship-wide list `data.upgrades[]`. Every record is one installed upgrade:
 *   { id, ref, variant, stationId, name, station, level, override }
 *   - ref       stable catalog id of the upgrade (English slug from data/equipment/upgrades.json, never a localized name)
 *   - variant   grade key of the variant ("commercial", "tactical", …) or null for upgrades without variants
 *   - stationId id of the battle station it is installed in; null = ship level (escape pods) or not assigned yet
 *   - override  true when the GM installed it although it is incompatible or exceeds the station's capacity
 * The old per-station `station.upgrades` array (catalog ids, never written by the UI) is folded into this list by
 * the 1 → 2 data migration and on every read (`foldStationUpgrades`), so there is never a second list to keep in sync.
 * Upgrade effects are NOT applied automatically: installed upgrades are reference data shown with their full rules.
 */
import { GRADE_UPGRADE_SLOTS } from "../constants.mjs";

export const UPGRADE_STATIONS = Object.freeze(["pilot", "generator", "gunnery", "scanners", "magic-conduit", "drone-console"]);
/** Native sf2e usage keys used by the upgrade items (installed-* keys are parsed by the system as "installed"). */
export const UPGRADE_USAGE = Object.freeze({
  pilot: "installed-in-a-pilots-console",
  generator: "installed-in-a-generator",
  gunnery: "installed-in-a-gunnery",
  scanners: "installed-in-scanners",
  "magic-conduit": "installed-in-a-magic-conduit",
  "drone-console": "installed-in-a-drone-console"
});
/** How many escape pod sets a ship can carry (escape pod upgrades replace the default escape pods). */
export const ESCAPE_POD_SETS = 1;

export const upgradeKey = (ref, variant = null) => (variant ? `${ref}:${variant}` : String(ref));
export function parseUpgradeKey(key) {
  const [ref, variant = null] = String(key ?? "").split(":");
  return { ref, variant: variant || null };
}

/**
 * Installable catalog entries: one per variant (Tangle Ward (Commercial), Tangle Ward (Tactical) …), or one for an
 * upgrade without variants. Each entry carries the base rules text plus the variant's own text and actions.
 */
export function upgradeEntries(defs) {
  const out = [];
  for (const d of defs ?? []) {
    if (!d?.id) continue;
    const base = {
      ref: d.id,
      baseName: d.name,
      station: d.station ?? null,
      slot: d.slot ?? (d.station ? "station" : "escape-pods"),
      usage: d.usage ?? "",
      usageKey: d.usageKey ?? UPGRADE_USAGE[d.station] ?? "other",
      traits: d.traits ?? [],
      classes: Array.isArray(d.classes) ? d.classes : [],
      rarity: d.rarity ?? "common",
      source: d.source ?? null,
      text: toList(d.text),
      activations: d.activations ?? [],
      custom: !!d.custom
    };
    if (Array.isArray(d.variants) && d.variants.length) {
      for (const v of d.variants)
        out.push({
          ...base,
          key: upgradeKey(d.id, v.grade),
          variant: v.grade,
          name: v.name ?? `${d.name} (${v.grade})`,
          level: Number(v.level ?? d.level ?? 0),
          page: v.page ?? d.source?.page ?? null,
          variantText: toList(v.text),
          variantActivations: v.activations ?? [],
          reviewNote: v.reviewNote ?? d.reviewNote ?? null,
          variants: d.variants.map((x) => x.grade)
        });
    } else
      out.push({
        ...base,
        key: upgradeKey(d.id),
        variant: null,
        name: d.name,
        level: Number(d.level ?? 0),
        page: d.source?.page ?? null,
        variantText: [],
        variantActivations: [],
        reviewNote: d.reviewNote ?? null,
        variants: []
      });
  }
  return out;
}
const toList = (t) => (Array.isArray(t) ? t.filter((x) => typeof x === "string" && x) : typeof t === "string" && t ? [t] : []);

/** Catalog lookup by key; a legacy record without variant resolves to the lowest variant of that upgrade. */
export function resolveUpgrade(entries, ref, variant = null) {
  const list = Array.isArray(entries) ? entries : [...(entries?.values?.() ?? [])];
  if (variant) return list.find((e) => e.ref === ref && e.variant === variant) ?? null;
  return list.find((e) => e.ref === ref && !e.variant) ?? list.filter((e) => e.ref === ref).sort((a, b) => a.level - b.level)[0] ?? null;
}

/** Upgrade slots of a station: station advancement row for its grade, else the generic grade table. */
export function stationCapacity(station, stationDef = null) {
  const row = stationDef?.advancement?.find((r) => r.grade === station?.grade);
  const n = Number(row?.upgrades ?? GRADE_UPGRADE_SLOTS[station?.grade] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Can this catalog entry be installed in this station (by its Usage line)? */
export const compatibleWith = (entry, station) => !!entry && !!station && entry.slot === "station" && entry.station === station.type;

/** Upgrade records installed in a station / at ship level / pointing at a station that no longer exists. */
export function upgradesOf(data, stationId) {
  return (data?.upgrades ?? []).filter((u) => (u?.stationId ?? null) === stationId);
}
/**
 * Status of one station: installed records with their catalog entry and issues, used / capacity.
 * Issues never remove anything: "unknown" (not in the catalog), "incompatible", "level" (above the ship level),
 * "capacity" (beyond the available slots). GM overrides are reported as such instead of as problems.
 */
export function stationUpgradeStatus(data, station, { entries = [], stationDef = null } = {}) {
  const capacity = stationCapacity(station, stationDef);
  const records = upgradesOf(data, station.id);
  const installed = records.map((rec, i) => {
    const entry = resolveUpgrade(entries, rec.ref, rec.variant ?? null);
    const issues = [];
    if (!entry) issues.push("unknown");
    else {
      if (!compatibleWith(entry, station)) issues.push("incompatible");
      if (Number.isFinite(Number(data?.level)) && entry.level > Number(data.level)) issues.push("level");
    }
    if (i >= capacity) issues.push("capacity");
    return { record: rec, entry, issues, overridden: !!rec.override && issues.some((x) => x !== "level") };
  });
  return { capacity, used: records.length, free: Math.max(0, capacity - records.length), over: records.length > capacity, installed };
}

/** Catalog entries offered by a station's selector: compatible ones first; incompatible ones only for GM overrides. */
export function stationOptions(entries, station, { isGM = false } = {}) {
  const sorted = [...entries].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return {
    compatible: sorted.filter((e) => compatibleWith(e, station)),
    override: isGM ? sorted.filter((e) => e.slot === "station" && !compatibleWith(e, station)) : []
  };
}
export const shipLevelOptions = (entries) =>
  [...entries].filter((e) => e.slot === "escape-pods").sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

/** Plain record stored in data.upgrades (English name kept only as a readable fallback; display uses the catalog). */
export function upgradeRecord(entry, { id, stationId = null, override = false }) {
  return {
    id,
    ref: entry.ref,
    variant: entry.variant ?? null,
    stationId,
    name: entry.name,
    station: entry.station,
    level: entry.level,
    override: !!override
  };
}

export class UpgradeError extends Error {
  constructor(code, data = {}) {
    super(code);
    this.code = code;
    this.data = data;
  }
}

/**
 * Authoritative change planning (GM side). Returns the new upgrades array; throws UpgradeError with a code that the
 * caller localizes (SF2eTSC.upgrades.errors.<code>). Non-GM users can never exceed capacity or install incompatible
 * upgrades; a GM must pass override:true, which is stored on the record so the choice survives reloads.
 *   op "add"      { key, stationId|null, override }
 *   op "remove"   { id }
 *   op "assign"   { id, stationId|null, override }   (move / assign an unassigned or orphaned record)
 *   op "override" { id, value }                      (GM only)
 */
export function planUpgradeChange(
  data,
  op,
  payload,
  { entries = [], stationDefs = new Map(), isGM = false, newId = () => "upg-new" } = {}
) {
  const list = (data?.upgrades ?? []).map((u) => ({ ...u }));
  const stationOf = (id) => (data?.stations ?? []).find((s) => s.id === id) ?? null;
  const check = (entry, stationId, override, ignoreId = null) => {
    const ok = isGM && override === true;
    if (stationId == null) {
      if (entry.slot !== "escape-pods" && !ok) throw new UpgradeError("needsStation");
      if (
        entry.slot === "escape-pods" &&
        list.filter(
          (u) => u.id !== ignoreId && (u.stationId ?? null) === null && resolveUpgrade(entries, u.ref, u.variant)?.slot === "escape-pods"
        ).length >= ESCAPE_POD_SETS &&
        !ok
      )
        throw new UpgradeError("escapePodsFull");
      return ok;
    }
    const st = stationOf(stationId);
    if (!st) throw new UpgradeError("noStation");
    if (!compatibleWith(entry, st) && !ok) throw new UpgradeError("incompatible", { station: st.type });
    const used = list.filter((u) => u.id !== ignoreId && u.stationId === stationId).length;
    if (used >= stationCapacity(st, stationDefs.get?.(st.type) ?? null) && !ok)
      throw new UpgradeError("capacity", { used, capacity: stationCapacity(st, stationDefs.get?.(st.type) ?? null) });
    return ok;
  };
  if (op === "add") {
    const { ref, variant } = parseUpgradeKey(payload?.key);
    const entry = resolveUpgrade(entries, ref, variant);
    if (!entry || (variant ?? null) !== (entry.variant ?? null)) throw new UpgradeError("unknown");
    if (list.length >= 200) throw new UpgradeError("tooMany");
    const stationId = payload?.stationId ?? null;
    const override = check(entry, stationId, payload?.override);
    list.push(upgradeRecord(entry, { id: newId(), stationId, override }));
    return list;
  }
  const idx = list.findIndex((u) => u.id === payload?.id);
  if (idx < 0) throw new UpgradeError("notInstalled");
  if (op === "remove") {
    list.splice(idx, 1);
    return list;
  }
  if (op === "assign") {
    const rec = list[idx];
    const entry = resolveUpgrade(entries, rec.ref, rec.variant ?? null);
    if (!entry) throw new UpgradeError("unknown");
    const stationId = payload?.stationId ?? null;
    const override = check(entry, stationId, payload?.override, rec.id);
    list[idx] = { ...rec, stationId, override, variant: rec.variant ?? entry.variant ?? null };
    return list;
  }
  if (op === "override") {
    if (!isGM) throw new UpgradeError("gmOnly");
    list[idx] = { ...list[idx], override: !!payload?.value };
    return list;
  }
  throw new UpgradeError("invalidOp");
}

/**
 * Idempotent fold of legacy data (pure, returns a new object):
 *  - station.upgrades (catalog ids) → data.upgrades records installed in that station; station.upgrades emptied;
 *  - ship-wide records without stationId are assigned when exactly one station of their station type exists
 *    (escape pods and ambiguous records stay at ship level / unassigned — nothing is deleted).
 */
export function foldStationUpgrades(data, entries = null) {
  if (!data || typeof data !== "object") return data;
  const stations = Array.isArray(data.stations) ? data.stations : [];
  const upgrades = Array.isArray(data.upgrades) ? data.upgrades.map((u) => (u && typeof u === "object" ? { ...u } : u)) : [];
  let changed = !Array.isArray(data.upgrades);
  const outStations = stations.map((st) => {
    if (!Array.isArray(st?.upgrades) || !st.upgrades.length) return st;
    changed = true;
    st.upgrades.forEach((ref, i) => {
      if (typeof ref !== "string" || !ref) return;
      const { ref: r, variant } = parseUpgradeKey(ref);
      let id = `upg-${st.id}-${i + 1}`.slice(0, 60);
      while (upgrades.some((u) => u?.id === id)) id = `${id}x`.slice(-64);
      upgrades.push({ id, ref: r, variant, stationId: st.id, name: r, station: st.type, level: null, override: false });
    });
    return { ...st, upgrades: [] };
  });
  for (const u of upgrades) {
    if (!u || typeof u !== "object") continue;
    if (u.stationId === undefined) {
      changed = true;
      // the catalog's Usage line wins over the station stored by older versions (Gravity Toggle → generator …)
      const type = (entries && resolveUpgrade(entries, u.ref ?? u.id, u.variant ?? null)?.station) || u.station;
      const same = stations.filter((s) => s.type === type);
      u.stationId = UPGRADE_STATIONS.includes(type) && same.length === 1 ? same[0].id : null;
      if (type && type !== u.station) u.station = type;
    }
    if (u.variant === undefined) {
      u.variant = null;
      changed = true;
    }
    if (!u.ref && u.id) {
      u.ref = u.id;
      changed = true;
    }
  }
  return changed ? { ...data, stations: outStations, upgrades } : data;
}

/** After stations were replaced (update from compendium, frame change): re-point records at the new station ids. */
export function remapUpgradeStations(upgrades, idMap) {
  return (upgrades ?? []).map((u) => (u?.stationId && idMap.has(u.stationId) ? { ...u, stationId: idMap.get(u.stationId) } : u));
}
