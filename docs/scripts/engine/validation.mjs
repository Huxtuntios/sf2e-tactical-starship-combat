import { normalizeCrewAssignments } from "./crew-assignments.mjs";
import { DATA_VERSION, GRADES, HEADINGS, STARSHIP_ROLES, STATION_TYPES } from "../constants.mjs";

/** Immunities shared by all "starship immunities" (Tech Core p.172). */
export const STARSHIP_IMMUNITIES = Object.freeze([
  "bleed",
  "death-effects",
  "disease",
  "drained",
  "fatigued",
  "paralyzed",
  "poison",
  "sickened",
  "spirit",
  "vitality",
  "void",
  "doomed",
  "unconscious"
]);

export function defaultStarship() {
  return {
    dataVersion: DATA_VERSION,
    isStarship: true,
    role: "player",
    level: 1,
    frame: "explorer",
    size: "medium",
    sensorRange: 6,
    speed: 3,
    hp: { value: 24, max: 24 },
    sp: { value: 11, max: 11 },
    ac: 15,
    fort: 8,
    reflex: 6,
    will: 9,
    perception: 0,
    compromised: 0,
    wrecked: 0,
    inoperable: false,
    offKilter: false,
    destroyed: false,
    heading: "right",
    immunities: [],
    resistances: {},
    weaknesses: {},
    traits: [],
    stations: [],
    crew: [],
    weapons: [],
    upgrades: [],
    expansionBays: [],
    effects: [],
    knownStations: [],
    frequencyUsed: {},
    notes: "",
    gmNotes: "",
    source: null
  };
}

const isInt = (v) => Number.isInteger(v);

/**
 * Normalize starship data: fill defaults, coerce types.
 * @returns {{data:object, errors:string[], warnings:string[]}}
 */
export function normalizeStarship(input) {
  const base = defaultStarship();
  const d = { ...base, ...(input ?? {}) };
  d.hp = { ...base.hp, ...(input?.hp ?? {}) };
  d.sp = { ...base.sp, ...(input?.sp ?? {}) };
  const errors = [],
    warnings = [];
  if (!d.name && input?.name === "") warnings.push("name is empty");
  if (!isInt(d.level) || d.level < -1 || d.level > 25) errors.push("level must be an integer between -1 and 25");
  if (!isInt(d.hp.max) || d.hp.max < 1) errors.push("hp.max must be a positive integer");
  if (!isInt(d.hp.value)) d.hp.value = d.hp.max;
  d.hp.value = Math.min(Math.max(0, d.hp.value), d.hp.max);
  if (!isInt(d.sp.max) || d.sp.max < 0) {
    warnings.push("sp.max invalid, reset to 0");
    d.sp.max = 0;
  }
  if (!isInt(d.sp.value)) d.sp.value = d.sp.max;
  d.sp.value = Math.min(Math.max(0, d.sp.value), d.sp.max);
  if (!isInt(d.speed) || d.speed < 0) errors.push("speed must be a non-negative integer");
  if (!isInt(d.sensorRange) || d.sensorRange < 0) errors.push("sensorRange must be a non-negative integer");
  if (!HEADINGS.includes(d.heading)) {
    warnings.push(`heading "${d.heading}" invalid, using right`);
    d.heading = "right";
  }
  if (!STARSHIP_ROLES.includes(d.role)) {
    warnings.push(`role "${d.role}" invalid, using npc`);
    d.role = "npc";
  }
  d.compromised = Math.max(0, Math.min(10, Math.floor(d.compromised) || 0));
  d.wrecked = Math.max(0, Math.floor(d.wrecked) || 0);
  for (const k of ["stations", "crew", "weapons", "upgrades", "expansionBays", "effects", "knownStations"])
    if (!Array.isArray(d[k])) {
      d[k] = [];
      warnings.push(`${k} reset to empty array`);
    }
  d.stations = d.stations.map((s, i) => normalizeStation(s, i));
  d.crew = d.crew.map((c) => ({ ...c }));
  const { repairs } = normalizeCrewAssignments(d);
  if (repairs.length) warnings.push(...repairs.map((r) => `crew/station repaired: ${r}`));
  return { data: d, errors, warnings };
}

export function normalizeStation(s, i = 0) {
  const type = STATION_TYPES.includes(s?.type) ? s.type : "custom";
  // unknown extra keys (repairLockedUntilTurnOf, drones, …) are preserved: they were silently dropped before 0.4.0
  return {
    ...(s && typeof s === "object" ? s : {}),
    id: s?.id ?? `${type}-${i + 1}`,
    type,
    name: s?.name ?? type,
    grade: GRADES.includes(s?.grade) ? s.grade : "commercial",
    helmedBy: s?.helmedBy ?? null,
    malfunctioning: !!s?.malfunctioning,
    malfunctionImmuneUntil: s?.malfunctionImmuneUntil ?? null,
    location: s?.location ?? null,
    upgrades: Array.isArray(s?.upgrades) ? s.upgrades : [],
    actions: Array.isArray(s?.actions) ? s.actions : [],
    weaponId: s?.weaponId ?? null,
    passive: s?.passive ?? {},
    ready: !!s?.ready,
    autoHelmed: !!s?.autoHelmed
  };
}

/** Generic content validators used by tools/validate-content.mjs and the in-app validator. */
function dupes(list, key = "id") {
  const seen = new Set(),
    d = [];
  for (const e of list) {
    if (seen.has(e[key])) d.push(e[key]);
    seen.add(e[key]);
  }
  return d;
}
export function validateStarships(list, { stations = [], actions = [] } = {}) {
  const errors = [],
    warnings = [];
  for (const id of dupes(list)) errors.push(`duplicate starship id: ${id}`);
  for (const s of list) {
    if (!s.name) errors.push(`${s.id}: missing name`);
    if (!isInt(s.level) || s.level < -1 || s.level > 25) errors.push(`${s.id}: invalid level ${s.level}`);
    if (!isInt(s.hp) || s.hp < 1) errors.push(`${s.id}: invalid hp ${s.hp}`);
    if (!isInt(s.ac)) warnings.push(`${s.id}: missing AC (needs review)`);
    if (!isInt(s.speed)) warnings.push(`${s.id}: missing speed (needs review)`);
    if (!s.source?.page) warnings.push(`${s.id}: missing source page`);
    for (const st of s.stations ?? [])
      if (
        !STATION_TYPES.includes(
          String(st.type)
            .replace(/pilot's console|pilot’s console/, "pilot")
            .replace(/ /g, "-")
            .replace("magic-conduit", "magic-conduit")
        )
      )
        warnings.push(`${s.id}: unknown station type "${st.type}"`);
  }
  return { errors, warnings };
}
export function validateHazards(list) {
  const errors = [],
    warnings = [];
  for (const id of dupes(list)) errors.push(`duplicate hazard id: ${id}`);
  for (const h of list) {
    if (!h.name) errors.push(`${h.id}: missing name`);
    if (!isInt(h.level) || h.level < -1 || h.level > 25) errors.push(`${h.id}: invalid level`);
    if (h.isComplex && !h.routine && !h.actions?.length) warnings.push(`${h.id}: complex hazard without routine/actions (needs review)`);
    if (!h.source?.page) warnings.push(`${h.id}: missing source page`);
  }
  return { errors, warnings };
}
export function validateStations(list) {
  const errors = [],
    warnings = [];
  for (const id of dupes(list)) errors.push(`duplicate station id: ${id}`);
  for (const s of list) {
    if (!s.name) errors.push(`${s.id}: missing name`);
    if (!STATION_TYPES.includes(s.id)) warnings.push(`${s.id}: not a built-in station type`);
    for (const row of s.advancement ?? []) if (!GRADES.includes(row.grade)) errors.push(`${s.id}: invalid grade ${row.grade}`);
  }
  return { errors, warnings };
}
export function validateActions(list, stationIds = []) {
  const errors = [],
    warnings = [];
  for (const id of dupes(list)) errors.push(`duplicate action id: ${id}`);
  for (const a of list) {
    if (!a.name) errors.push(`${a.id}: missing name`);
    if (a.station && stationIds.length && !stationIds.includes(a.station) && a.station !== "any")
      errors.push(`${a.id}: unknown station ${a.station}`);
    if (a.minGrade && !GRADES.includes(a.minGrade)) errors.push(`${a.id}: invalid minGrade`);
    if (a.cost === undefined) errors.push(`${a.id}: missing cost`);
    for (const k of ["criticalSuccess", "success", "failure", "criticalFailure"])
      if (a.outcomes?.[k] && !Array.isArray(a.outcomes[k])) errors.push(`${a.id}: outcomes.${k} must be an array`);
  }
  return { errors, warnings };
}
export function validateWeapons(list) {
  const errors = [],
    warnings = [];
  for (const id of dupes(list)) errors.push(`duplicate weapon id: ${id}`);
  for (const w of list) {
    if (!w.name) errors.push(`${w.id}: missing name`);
    if (!/^\d+d\d+$/.test(w.die ?? "")) errors.push(`${w.id}: invalid damage die`);
    if (!isInt(w.range) || w.range < 0) errors.push(`${w.id}: invalid range`);
  }
  return { errors, warnings };
}

/* ------------------------------------------------------------------ 0.9.1: write-path validation
 * Every non-GM-JSON edit (patchShip, setStation, equipment, addStation, applyFrame) goes through these helpers so a
 * request can never store a value of the wrong type. Each helper returns the cleaned value or throws a
 * `ValidationError` naming the field. Numeric strings from form inputs ("15") are accepted and coerced.
 */
export class ValidationError extends Error {
  constructor(field, reason) {
    super(`${field}: ${reason}`);
    this.name = "ValidationError";
    this.field = field;
    this.reason = reason;
  }
}
export const SHIP_SIZES = Object.freeze(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
const MAX_TEXT = 20000,
  MAX_SHORT = 200,
  MAX_LIST = 200;

const reject = (field, reason) => {
  throw new ValidationError(field, reason);
};
function toInt(field, v, { min = -Infinity, max = Infinity, nullable = false } = {}) {
  if (v === null || v === undefined || v === "") {
    if (nullable) return null;
    reject(field, "must be an integer");
  }
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) reject(field, "must be an integer");
  if (n < min || n > max) reject(field, `must be between ${min} and ${max}`);
  return n;
}
function toBool(field, v) {
  if (typeof v !== "boolean") reject(field, "must be true or false");
  return v;
}
function toStr(field, v, { max = MAX_SHORT, nullable = false } = {}) {
  if (v === null || v === undefined) {
    if (nullable) return null;
    reject(field, "must be text");
  }
  if (typeof v !== "string") reject(field, "must be text");
  if (v.length > max) reject(field, `must be at most ${max} characters`);
  return v;
}
function toEnum(field, v, allowed) {
  if (!allowed.includes(v)) reject(field, `must be one of ${allowed.join(", ")}`);
  return v;
}
function toStrList(field, v) {
  if (!Array.isArray(v) || v.length > MAX_LIST) reject(field, "must be a list of text values");
  return v.map((x, i) => toStr(`${field}[${i}]`, x));
}
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function toIntMap(field, v) {
  if (!isPlainObject(v)) reject(field, "must be a map of name → integer");
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (BAD_KEYS.has(k) || k.length > MAX_SHORT) reject(field, `invalid key "${k}"`);
    out[k] = toInt(`${field}.${k}`, x);
  }
  return out;
}
/** JSON-safe plain data (objects/arrays/strings/finite numbers/booleans/null), bounded depth and size. */
export function plainData(field, v, depth = 0) {
  if (depth > 8) reject(field, "is nested too deeply");
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) reject(field, "must be a finite number");
    return v;
  }
  if (typeof v === "string") {
    if (v.length > MAX_TEXT) reject(field, "is too long");
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length > MAX_LIST) reject(field, "has too many entries");
    return v.map((x, i) => plainData(`${field}[${i}]`, x, depth + 1));
  }
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (BAD_KEYS.has(k)) reject(field, `invalid key "${k}"`);
      if (x !== undefined) out[k] = plainData(`${field}.${k}`, x, depth + 1);
    }
    return out;
  }
  return reject(field, "must be plain data");
}
function toModifierList(field, v) {
  if (!Array.isArray(v) || v.length > MAX_LIST) reject(field, "must be a list of modifiers");
  return v.map((m, i) => {
    const f = `${field}[${i}]`;
    if (!isPlainObject(m)) reject(f, "must be an object");
    const out = plainData(f, m);
    if ("selector" in out) toStr(`${f}.selector`, out.selector);
    if ("modifier" in out) out.modifier = toInt(`${f}.modifier`, out.modifier);
    if ("value" in out && typeof out.value !== "boolean") out.value = toInt(`${f}.value`, out.value);
    return out;
  });
}

const SHIP_FIELD_RULES = {
  level: (v) => toInt("level", v, { min: -1, max: 25 }),
  frame: (v) => toStr("frame", v, { nullable: true }),
  size: (v) => toEnum("size", v, SHIP_SIZES),
  role: (v) => toEnum("role", v, STARSHIP_ROLES),
  sensorRange: (v) => toInt("sensorRange", v, { min: 0, max: 100 }),
  speed: (v) => toInt("speed", v, { min: 0, max: 100 }),
  ac: (v) => toInt("ac", v, { min: -10, max: 100 }),
  fort: (v) => toInt("fort", v, { min: -50, max: 100 }),
  reflex: (v) => toInt("reflex", v, { min: -50, max: 100 }),
  will: (v) => toInt("will", v, { min: -50, max: 100 }),
  perception: (v) => toInt("perception", v, { min: -50, max: 100 }),
  hardness: (v) => toInt("hardness", v, { min: 0, max: 1000, nullable: true }),
  fortify: (v) => toInt("fortify", v, { min: 0, max: 100, nullable: true }),
  notes: (v) => toStr("notes", v, { max: MAX_TEXT }),
  gmNotes: (v) => toStr("gmNotes", v, { max: MAX_TEXT }),
  faction: (v) => toStr("faction", v, { nullable: true }),
  traits: (v) => toStrList("traits", v),
  immunities: (v) => toStrList("immunities", v),
  resistances: (v) => toIntMap("resistances", v),
  weaknesses: (v) => toIntMap("weaknesses", v),
  skills: (v) => toIntMap("skills", v),
  customModifiers: (v) => toModifierList("customModifiers", v),
  compromised: (v) => toInt("compromised", v, { min: 0, max: 10 }),
  wrecked: (v) => toInt("wrecked", v, { min: 0, max: 100 }),
  inoperable: (v) => toBool("inoperable", v),
  offKilter: (v) => toBool("offKilter", v),
  destroyed: (v) => toBool("destroyed", v),
  heading: (v) => toEnum("heading", v, HEADINGS)
};
/** Validate one top-level starship field from a patchShip request. */
export function sanitizeShipField(key, value) {
  const rule = SHIP_FIELD_RULES[key];
  if (!rule) reject(key, "is not an editable field");
  return rule(value);
}
/** Validate a partial Hull/Shield pool ({ value?, max? }). */
export function sanitizePool(field, value) {
  if (!isPlainObject(value)) reject(field, "must be an object with value/max");
  const out = {};
  for (const [k, x] of Object.entries(value)) {
    if (k !== "value" && k !== "max") reject(`${field}.${k}`, "is not an editable field");
    out[k] = toInt(`${field}.${k}`, x, { min: k === "max" && field === "hp" ? 1 : 0, max: 100000 });
  }
  return out;
}

const STATION_FIELD_RULES = {
  grade: (v) => toEnum("grade", v, GRADES),
  type: (v) => toEnum("type", v, STATION_TYPES),
  name: (v) => toStr("name", v),
  location: (v) => toStr("location", v, { nullable: true }),
  weaponId: (v) => (v === "" ? null : toStr("weaponId", v, { nullable: true })),
  upgrades: (v) => toStrList("upgrades", v),
  actions: (v) => toStrList("actions", v),
  malfunctioning: (v) => toBool("malfunctioning", v)
};
/** Validate one station field from a setStation request. */
export function sanitizeStationField(key, value) {
  const rule = STATION_FIELD_RULES[key];
  if (!rule) reject(`station.${key}`, "is not an editable field");
  return rule(value);
}
/**
 * Validate a new station from an addStation request. Only configuration keys are accepted; runtime state
 * (helmedBy, malfunctioning, ready, …) always starts clean so a request cannot seat a crew member directly.
 */
export function sanitizeNewStation(input, fallbackId) {
  if (!isPlainObject(input)) reject("station", "must be an object");
  const out = { id: input.id == null ? fallbackId : toStr("station.id", input.id, { max: 64 }) };
  if (!/^[\w-]+$/.test(out.id)) reject("station.id", "may only contain letters, digits, - and _");
  out.type = input.type == null ? "custom" : sanitizeStationField("type", input.type);
  out.name = input.name == null ? out.type : sanitizeStationField("name", input.name);
  if (input.grade != null) out.grade = sanitizeStationField("grade", input.grade);
  for (const k of ["location", "weaponId", "upgrades", "actions"]) if (input[k] !== undefined) out[k] = sanitizeStationField(k, input[k]);
  if (input.passive !== undefined) {
    if (!isPlainObject(input.passive)) reject("station.passive", "must be an object");
    out.passive = plainData("station.passive", input.passive);
  }
  return normalizeStation(out);
}

/** Typed keys per equipment list; everything else must still be plain JSON data. */
const LIST_FIELD_RULES = {
  weapons: {
    range: (f, v) => toInt(f, v, { min: 0, max: 100 }),
    die: (f, v) => {
      toStr(f, v, { max: 32 });
      if (!/^\d*d\d+$/i.test(v)) reject(f, "must look like 2d6");
      return v;
    }
  },
  strikes: { attack: (f, v) => toInt(f, v, { min: -50, max: 100 }), damage: (f, v) => toStr(f, v) },
  npcActions: { cost: (f, v) => toStr(f, v, { max: 32 }), text: (f, v) => toStr(f, v, { max: MAX_TEXT }) },
  upgrades: {
    level: (f, v) => toInt(f, v, { min: -1, max: 25, nullable: true }),
    ref: (f, v) => toStr(f, v, { max: 64 }),
    variant: (f, v) => toStr(f, v, { max: 32, nullable: true }),
    stationId: (f, v) => toStr(f, v, { max: 64, nullable: true }),
    override: (f, v) => {
      if (typeof v !== "boolean") reject(f, "must be true or false");
      return v;
    }
  }
};
const COMMON_LIST_RULES = {
  id: (f, v) => toStr(f, v, { max: 64 }),
  name: (f, v) => toStr(f, v, { nullable: true }),
  traits: (f, v) => toStrList(f, v)
};
/** Validate an equipment list item (add / update). Items are plain objects; ids, names and per-list numeric fields are typed. */
export function sanitizeListItem(list, item) {
  if (!isPlainObject(item)) reject(list, "item must be an object");
  const out = plainData(list, item);
  const rules = { ...COMMON_LIST_RULES, ...(LIST_FIELD_RULES[list] ?? {}) };
  for (const [k, rule] of Object.entries(rules)) if (k in out) out[k] = rule(`${list}.${k}`, out[k]);
  return out;
}
