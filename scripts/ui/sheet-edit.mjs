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

const BAD_EDITOR_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const editorError = (key, data = {}) => Object.assign(new Error(key), { i18nKey: key, errorData: data });

function resolveEditorKey(value, knownKeys, existingKeys = []) {
  const raw = String(value ?? "").trim();
  if (!raw) throw editorError("SF2eTSC.errors.defenseTypeRequired");
  if (BAD_EDITOR_KEYS.has(raw)) throw editorError("SF2eTSC.errors.defenseTypeUnknown", { type: raw });
  const known = new Set(knownKeys);
  const existing = new Set(existingKeys);
  if (known.has(raw)) return raw;
  const slug = raw.toLowerCase().replace(/\s+/g, "-");
  if (known.has(slug)) return slug;
  // Legacy custom keys keep their exact spelling; only newly entered keys are slugified.
  if (existing.has(raw)) return raw;
  if (existing.has(slug)) return slug;
  throw editorError("SF2eTSC.errors.defenseTypeUnknown", { type: raw });
}

function editorInteger(value, type) {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw editorError("SF2eTSC.errors.defenseValueInvalid", { type });
  }
  return numeric;
}

export function numericMapFromRows(rows, { knownKeys = [], existingKeys = [] } = {}) {
  if (!Array.isArray(rows)) throw editorError("SF2eTSC.errors.defenseRowsInvalid");
  const out = {};
  for (const row of rows) {
    const key = resolveEditorKey(row?.key, knownKeys, existingKeys);
    if (Object.hasOwn(out, key)) throw editorError("SF2eTSC.errors.defenseDuplicate", { type: key });
    out[key] = editorInteger(row?.value, key);
  }
  return out;
}

export function addMapValue(map, key, value, { knownKeys = [] } = {}) {
  const current = map && typeof map === "object" && !Array.isArray(map) ? map : {};
  const resolved = resolveEditorKey(key, knownKeys, Object.keys(current));
  if (Object.hasOwn(current, resolved)) throw editorError("SF2eTSC.errors.defenseDuplicate", { type: resolved });
  return { ...current, [resolved]: editorInteger(value, resolved) };
}

export function removeMapValue(map, key) {
  const current = map && typeof map === "object" && !Array.isArray(map) ? map : {};
  const out = { ...current };
  delete out[key];
  return out;
}

export function addListValue(list, value, { knownKeys = [] } = {}) {
  const current = Array.isArray(list) ? list : [];
  const resolved = resolveEditorKey(value, knownKeys);
  if (current.includes(resolved)) throw editorError("SF2eTSC.errors.defenseDuplicate", { type: resolved });
  return [...current, resolved];
}

export function removeListValueAt(list, index) {
  if (!Array.isArray(list) || !Number.isInteger(index) || index < 0 || index >= list.length) {
    throw editorError("SF2eTSC.errors.defenseIndexInvalid");
  }
  return list.filter((_, position) => position !== index);
}

function selectableCatalog(catalog) {
  return Object.entries(catalog ?? {}).filter(([key]) => key !== "custom");
}

function catalogLabel(catalog, key, localize) {
  const value = catalog?.[key];
  const label = typeof value === "string" ? value : value?.label;
  return label ? localize(label) || key : key;
}

function editorOptions(catalog, localize, { selected = null, disabledKeys = [] } = {}) {
  const rows = selectableCatalog(catalog).map(([key]) => ({ key, label: catalogLabel(catalog, key, localize) }));
  if (selected && !rows.some((row) => row.key === selected)) rows.push({ key: selected, label: selected });
  const disabled = new Set(disabledKeys);
  return rows
    .map((row) => ({ ...row, selected: row.key === selected, disabled: row.key !== selected && disabled.has(row.key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function buildDefenseEditorContext(data, catalogs, localize = (key) => key) {
  const immunitiesCatalog = catalogs?.immunities ?? {};
  const immunities = Array.isArray(data.immunities) ? data.immunities : [];
  const usedImmunities = new Set(immunities);
  const numeric = [
    ["resistances", "SF2eTSC.docs.resistances", "SF2eTSC.edit.value"],
    ["weaknesses", "SF2eTSC.docs.weaknesses", "SF2eTSC.edit.value"],
    ["skills", "SF2eTSC.edit.skills", "SF2eTSC.edit.modifier"]
  ].map(([kind, labelKey, valueLabelKey]) => {
    const catalog = catalogs?.[kind] ?? {};
    const map = data[kind] && typeof data[kind] === "object" && !Array.isArray(data[kind]) ? data[kind] : {};
    const entries = Object.entries(map);
    const used = new Set(entries.map(([key]) => key));
    return {
      kind,
      label: localize(labelKey),
      typeLabel: localize("SF2eTSC.ui.type"),
      valueLabel: localize(valueLabelKey),
      rows: entries.map(([key, value]) => ({
        key,
        value,
        label: catalogLabel(catalog, key, localize),
        known: Object.hasOwn(catalog, key) && key !== "custom",
        options: editorOptions(catalog, localize, {
          selected: key,
          disabledKeys: entries.filter(([other]) => other !== key).map(([other]) => other)
        })
      })),
      addOptions: editorOptions(catalog, localize).filter((option) => !used.has(option.key))
    };
  });
  return {
    immunities: {
      entries: immunities.map((key) => ({
        key,
        label: catalogLabel(immunitiesCatalog, key, localize),
        known: Object.hasOwn(immunitiesCatalog, key)
      })),
      addOptions: editorOptions(immunitiesCatalog, localize).filter((option) => !usedImmunities.has(option.key))
    },
    numeric
  };
}
