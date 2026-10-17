/**
 * "Update from compendium" for starships and hazards already imported into the world.
 * Pure helpers (no Foundry globals) so the merge rules can be unit-tested.
 *
 * Kept from the world actor: crew and station assignments, damage (HP/SP lost), compromised/wrecked and other
 * runtime state, effects, GM notes, a custom name, image and token. The actor document itself is updated in
 * place, so its UUID (and therefore its position on the sensor map and in the combat tracker) does not change.
 */
import { remapUpgradeStations } from "../engine/upgrades.mjs";

export const KEEP_STARSHIP_FIELDS = [
  "crew",
  "compromised",
  "wrecked",
  "inoperable",
  "offKilter",
  "destroyed",
  "heading",
  "effects",
  "knownStations",
  "frequencyUsed",
  "drones",
  "notes",
  "gmNotes",
  "weapons",
  "upgrades",
  "expansionBays"
];

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
export const stripLevelSuffix = (name) =>
  String(name ?? "")
    .replace(/\s*\((?:Lv|ур\.)\s*-?\d+\)\s*$/i, "")
    .trim();

/** Damage taken is preserved: new value = new max − (old max − old value), clamped to [0, new max]. */
export function keepDamage(oldValue, oldMax, newMax) {
  const max = Number(newMax) || 0;
  if (!Number.isFinite(Number(oldValue)) || !Number.isFinite(Number(oldMax))) return max;
  const lost = Math.max(0, Number(oldMax) - Number(oldValue));
  return Math.max(0, Math.min(max, max - lost));
}

/** Merge the freshly built starship flag with the runtime state of the world actor. */
export function mergeStarshipFlag(oldFlag = {}, fresh = {}) {
  const out = clone(fresh);
  for (const k of KEEP_STARSHIP_FIELDS) if (oldFlag[k] !== undefined) out[k] = clone(oldFlag[k]);
  const spMax = Number(fresh.sp?.max ?? 0);
  out.sp = { value: keepDamage(oldFlag.sp?.value, oldFlag.sp?.max, spMax), max: spMax };
  const old = [...(oldFlag.stations ?? [])];
  const used = new Set();
  const stationIds = new Map();
  out.stations = (fresh.stations ?? []).map((st) => {
    let o = old.find((x) => x.id === st.id && !used.has(x));
    if (!o) o = old.find((x) => x.type === st.type && !used.has(x));
    if (!o) return st;
    used.add(o);
    if (o.id !== st.id) stationIds.set(o.id, st.id);
    return {
      ...st,
      helmedBy: o.helmedBy ?? null,
      malfunctioning: !!o.malfunctioning,
      upgrades: o.upgrades?.length ? clone(o.upgrades) : st.upgrades
    };
  });
  // installed upgrades follow their station when its id changed
  if (Array.isArray(out.upgrades)) out.upgrades = remapUpgradeStations(out.upgrades, stationIds);
  // crew[].stationId mirrors station.helmedBy: re-point it at the matching new station id, clear it otherwise
  const idMap = new Map();
  out.stations.forEach((st) => {
    if (st.helmedBy) idMap.set(st.helmedBy, st.id);
  });
  out.crew = (out.crew ?? []).map((c) => ({ ...c, stationId: idMap.get(c.actorUuid) ?? null }));
  return out;
}

/** The GM renamed the actor if its name (without level suffix) matches neither the English nor the translated content name. */
export function chooseName(currentName, freshName, contentNames = []) {
  const base = stripLevelSuffix(currentName).toLowerCase();
  const known = [freshName, ...contentNames].map((n) => stripLevelSuffix(n).toLowerCase());
  return known.includes(base) ? freshName : currentName;
}

/**
 * Build an Actor#update payload for a starship.
 * @param actor  plain snapshot { name, img, hp:{value,max}, flag, tokenImg }
 * @param fresh  result of buildShipActorData(...)
 */
export function planStarshipUpdate(actor, fresh, { moduleId, contentNames = [], defaultImg = null } = {}) {
  const f = fresh.flags[moduleId];
  const hpMax = fresh.system.attributes.hp.max;
  const update = {
    name: chooseName(actor.name, fresh.name, contentNames),
    "system.details.level.value": fresh.system.details.level.value,
    "system.details.publicNotes": fresh.system.details.publicNotes,
    "system.details.blurb": fresh.system.details.blurb,
    "system.attributes.hp.max": hpMax,
    "system.attributes.hp.value": keepDamage(actor.hp?.value, actor.hp?.max, hpMax),
    "system.attributes.hp.details": fresh.system.attributes.hp.details,
    "system.attributes.ac.value": fresh.system.attributes.ac.value,
    "system.saves": fresh.system.saves,
    "system.perception.mod": fresh.system.perception.mod,
    "system.skills": fresh.system.skills,
    "system.traits.value": fresh.system.traits.value,
    "system.traits.size.value": fresh.system.traits.size.value,
    [`flags.${moduleId}.starship`]: mergeStarshipFlag(actor.flag ?? {}, f.starship),
    [`flags.${moduleId}.content`]: f.content
  };
  if (fresh.system.abilities) update["system.abilities"] = fresh.system.abilities;
  if (!actor.img || actor.img === defaultImg) update.img = fresh.img;
  if (update.name !== actor.name && (!actor.tokenName || stripLevelSuffix(actor.tokenName) === stripLevelSuffix(actor.name)))
    update["prototypeToken.name"] = fresh.prototypeToken?.name ?? stripLevelSuffix(update.name);
  return update;
}

/** Hazards: statistics and description are refreshed; HP damage and a custom name are kept. */
export function planHazardUpdate(actor, fresh, { moduleId, contentNames = [] } = {}) {
  const update = {
    name: chooseName(actor.name, fresh.name, contentNames),
    system: clone(fresh.system),
    [`flags.${moduleId}.content`]: fresh.flags?.[moduleId]?.content
  };
  const hp = fresh.system?.attributes?.hp;
  if (hp && Number.isFinite(Number(hp.max))) update.system.attributes.hp.value = keepDamage(actor.hp?.value, actor.hp?.max, hp.max);
  for (const [k, v] of Object.entries(fresh.flags?.[moduleId] ?? {}))
    if (k !== "content" && actor.flags?.[k] === undefined) update[`flags.${moduleId}.${k}`] = clone(v);
  return update;
}
