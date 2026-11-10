/**
 * Collects the actions shown on an NPC starship sheet from every source and classifies them *before* any rendering:
 *   - catalogue actions (data/actions) listed under a battle station or added for every NPC ship;
 *   - statblock Strikes (`strikes[]`), listed under a station or not;
 *   - statblock abilities (`npcActions[]`), listed under a station or not → manual inline actions;
 *   - catalogue actions with `builtin: "npc-strike"` (Engaged Strike) — these are *templates* that carry no Strike of
 *     their own and must be bound to one of the ship's Strikes ("Engaged Strike: claw") before they can be shown or run.
 * Every Strike goes through `normalizeNpcStrike`, so a row that reaches `strikeLine()` always has kind/attack/damage.
 * Records that cannot be shown correctly become entries with `issues` (warning + disabled row) instead of throwing.
 * Pure module (no Foundry globals); source data is never modified.
 */
import { npcStrikeAction, npcInlineAction, slugifyName } from "./npc-inline.mjs";

export const STRIKE_KINDS = ["melee", "ranged"];
const DICE = /\d+d\d+/i;
const RANGE_TRAIT = /^range(?: increment)? \d+ zones?/i;
const str = (v) => (typeof v === "string" ? v.trim() : "");
const lower = (v) => str(v).toLowerCase();

/** Generic NPC catalogue actions (Tech Core p.208). Engaged Strike is only added when the ship's statblock lists it. */
export const NPC_GENERIC_ACTIONS = ["repair-self", "seek-starships-npc", "fortify-shield-points"];

/**
 * Validate one statblock Strike. Returns `{ strike, issues, fatal }`:
 *  - `strike`: a normalized *copy* ({name, kind, attack:number, damage, traits:string[]}) or null when fatal;
 *  - `issues`: [{ code, field, value }] — codes: notObject, noName, noAttack, noDamage, badKind, kindInferred, badTraits;
 *  - `fatal`: the Strike cannot be rolled/shown correctly (missing name, attack modifier, damage dice, or undecidable kind).
 * The only default applied is `kind: "ranged"` when the kind is missing/invalid but a range trait proves it (reported as kindInferred).
 */
export function normalizeNpcStrike(raw) {
  const issues = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { strike: null, issues: [{ code: "notObject", field: null, value: raw }], fatal: true };
  const name = str(raw.name);
  if (!name) issues.push({ code: "noName", field: "name", value: raw.name });
  let traits = raw.traits;
  if (traits == null) traits = [];
  else if (!Array.isArray(traits)) {
    issues.push({ code: "badTraits", field: "traits", value: traits });
    traits = [];
  }
  traits = traits.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim());
  const attack =
    typeof raw.attack === "number"
      ? raw.attack
      : /^\s*[+]?-?\d+\s*$/.test(String(raw.attack ?? ""))
        ? Number(String(raw.attack).replace("+", ""))
        : NaN;
  if (!Number.isFinite(attack)) issues.push({ code: "noAttack", field: "attack", value: raw.attack });
  const damage = str(raw.damage);
  if (!DICE.test(damage)) issues.push({ code: "noDamage", field: "damage", value: raw.damage });
  let kind = lower(raw.kind);
  if (!STRIKE_KINDS.includes(kind)) {
    if (traits.some((t) => RANGE_TRAIT.test(t))) {
      issues.push({ code: "kindInferred", field: "kind", value: raw.kind });
      kind = "ranged";
    } else {
      issues.push({ code: "badKind", field: "kind", value: raw.kind });
      kind = null;
    }
  }
  const fatal = issues.some((i) => i.code !== "kindInferred" && i.code !== "badTraits");
  return { strike: fatal ? null : { ...raw, name, kind, attack, damage, traits }, issues, fatal };
}

/** The ship's statblock entry for a catalogue Strike template (e.g. the "Engaged Strike" ability with text "claw (page 208)"). */
function abilityFor(template, data) {
  const keys = new Set([template.slug, template.id, slugifyName(template.name)].filter(Boolean));
  return (Array.isArray(data.npcActions) ? data.npcActions : []).find((a) => a && keys.has(slugifyName(a.name))) ?? null;
}
/**
 * Bind a catalogue `builtin: "npc-strike"` template to one of the ship's valid Strikes.
 * Choice: the Strike named in the ship's ability text (longest name match), else the ship's only melee Strike
 * (Engaged Strike targets a ship in the same zone). Returns `{ action, strike }` or `{ action: null, reason }`.
 */
export function bindNpcStrikeTemplate(template, data) {
  const valid = (Array.isArray(data.strikes) ? data.strikes : [])
    .map(normalizeNpcStrike)
    .filter((r) => !r.fatal)
    .map((r) => r.strike);
  if (!valid.length) return { action: null, reason: "noStrikes" };
  const text = lower(abilityFor(template, data)?.text);
  let strike = null;
  if (text)
    strike =
      valid
        .filter((s) => new RegExp(`\\b${s.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text))
        .sort((a, b) => b.name.length - a.name.length)[0] ?? null;
  if (!strike) {
    const melee = valid.filter((s) => s.kind === "melee");
    if (melee.length === 1) strike = melee[0];
  }
  if (!strike) return { action: null, reason: "ambiguous" };
  return { action: { ...template, strike, inline: true, boundStrike: strike.name }, strike };
}

/** Station action list entries are names (sheet data) or {name} objects (raw statblock content). */
export function stationActionName(n) {
  return typeof n === "string" ? n.trim() : str(n?.name);
}

/**
 * Ordered, de-duplicated NPC sheet entries.
 * @param data   readStarship() data (may be partial)
 * @param catalog { actions: Iterable<action>, get(id) } — the shared catalogue
 * @returns Array<{ id, action|null, station|null, source, issues: [], name }>
 *   source: catalog | strike | ability | station-ability | bound-strike ; action=null ⇒ cannot be shown/run, see issues.
 */
export function collectNpcActions(data = {}, catalog) {
  const entries = [];
  const seen = new Set();
  const stations = Array.isArray(data.stations) ? data.stations.filter((s) => s && typeof s === "object") : [];
  const strikes = Array.isArray(data.strikes) ? data.strikes : [];
  const abilities = Array.isArray(data.npcActions) ? data.npcActions : [];
  const catActions = [...(catalog?.actions ?? [])];
  const findKnown = (name) => catActions.find((a) => a.slug === slugifyName(name) || lower(a.name) === name.toLowerCase()) ?? null;
  const add = (e) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    entries.push({ issues: [], ...e });
  };

  const addStrike = (raw, station, index) => {
    const r = normalizeNpcStrike(raw);
    const label = str(raw?.name) || `#${index + 1}`;
    if (r.fatal) return add({ id: `npc-strike-invalid:${index}`, name: label, action: null, station, source: "strike", issues: r.issues });
    return add({
      id: `npc-strike:${slugifyName(r.strike.name)}`,
      name: r.strike.name,
      action: npcStrikeAction(r.strike),
      station,
      source: "strike",
      issues: r.issues
    });
  };
  const addTemplate = (template, station) => {
    const b = bindNpcStrikeTemplate(template, data);
    if (!b.action)
      return add({
        id: template.id,
        name: template.name,
        action: null,
        station,
        source: "bound-strike",
        issues: [{ code: "unboundStrike", field: "strike", value: b.reason }]
      });
    return add({ id: template.id, name: template.name, action: b.action, station, source: "bound-strike", issues: [] });
  };
  const addKnown = (a, station) =>
    a.builtin === "npc-strike" && !a.strike
      ? addTemplate(a, station)
      : add({ id: a.id, name: a.name, action: a, station, source: "catalog" });
  const strikeIndex = (name) => strikes.findIndex((s) => lower(s?.name) === name.toLowerCase());

  stations.forEach((st) => {
    (Array.isArray(st.actions) ? st.actions : []).forEach((raw) => {
      const name = stationActionName(raw);
      if (!name) {
        entries.push({
          id: `station-invalid:${st.id ?? st.type}`,
          name: st.name ?? st.type ?? "?",
          action: null,
          station: st,
          source: "station-ability",
          issues: [{ code: "badStationAction", field: "actions", value: raw }]
        });
        return;
      }
      const known = findKnown(name);
      if (known) return addKnown(known, st);
      const i = strikeIndex(name);
      if (i >= 0) return addStrike(strikes[i], st, i);
      const own = abilities.find((a) => lower(a?.name) === name.toLowerCase()) ?? null;
      const a = npcInlineAction(name, own, st);
      add({ id: a.id, name, action: a, station: st, source: "station-ability" });
    });
  });
  // Strikes not listed under a battle station (e.g. melee rams): they are fired from the gunnery station if there is one
  const gunnery = stations.find((x) => x.type === "gunnery") ?? null;
  strikes.forEach((s, i) => addStrike(s, gunnery, i));
  // Abilities outside the station list (passive ones are statblock text, shown in the description, not as buttons)
  abilities.forEach((a, i) => {
    if (!a || typeof a !== "object" || !str(a.name)) {
      entries.push({
        id: `ability-invalid:${i}`,
        name: `#${i + 1}`,
        action: null,
        station: null,
        source: "ability",
        issues: [{ code: "noName", field: "name", value: a?.name }]
      });
      return;
    }
    if (a.cost === "passive") return;
    const known = findKnown(a.name);
    if (known?.builtin === "npc-strike") return addTemplate(known, null);
    const act = npcInlineAction(a.name, a, null);
    add({ id: act.id, name: a.name, action: act, station: null, source: "ability" });
  });
  for (const id of NPC_GENERIC_ACTIONS) {
    const a = catalog?.get?.(id);
    if (!a || (id === "fortify-shield-points" && !data.fortify)) continue;
    addKnown(a, stations.find((s) => s.type === a.station) ?? null);
  }
  return entries;
}
