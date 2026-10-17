/**
 * pure builders (no Foundry globals) for the "Starship Weapons" Item compendium.
 * Every catalogue starship weapon becomes a native sf2e Item of type "weapon" whose traits use the system's own
 * weapon-trait slugs (CONFIG.PF2E.weaponTraits). Module-only starship traits (area, ordnance, volley, boost…) stay on
 * the ship entry and are listed in the description. Dropping a pack weapon onto a starship sheet adds it to the ship's
 * weapon list instead of creating an embedded Item (see scripts/starship/weapon-drop.mjs).
 */
import { MODULE_ID, STARSHIP_TAG } from "../constants.mjs";
import { schemaStamp } from "./action-docs.mjs";

export const PACK_WEAPON_FLAG = "packWeapon";

/** sf2e 1.6.0 CONFIG.PF2E.weaponTraits keys (used offline when CONFIG is unavailable). */
export const SYSTEM_WEAPON_TRAITS = new Set(
  "starship adjusted aeon agile alchemical analog apex arc archaic artifact attached attuned auditory automatic backstabber backswing biotech bomb brace breakdown brutal caster climbing clockwork cobbled combination concealable concussive consumable cursed death delayed disarm disease emotion extradimensional fear finesse forceful fortune fungus grapple grenade hampering healing illusion infused inhaled injection intelligent invested kickback light magical mental modular monk mythic nonlethal olfactory parry plant poison powered propulsive razing reach recovery relic repeating resonant saggorak scrying shadow shove solarian spirit splash staff sweep tearing tech teleportation tethered thought thrown time training trip twin unarmed unwieldy upgrade vehicular venomous visual wand".split(
    " "
  )
);
/** sf2e 1.6.0 CONFIG.PF2E.weaponGroups used by starship weapons. */
export const SYSTEM_WEAPON_GROUPS = new Set([
  "corrosive",
  "laser",
  "projectile",
  "shock",
  "flame",
  "cryo",
  "sniper",
  "plasma",
  "sonic",
  "dart",
  "bomb"
]);
const CATEGORIES = new Set(["simple", "martial", "advanced"]);
const FIX = { ordinance: "ordnance" };

export const normalizeTrait = (t) => {
  const s = String(t ?? "")
    .trim()
    .toLowerCase();
  return FIX[s] ?? s;
};

/** Split catalogue traits into system slugs and module-only starship traits. */
export function splitWeaponTraits(traits, systemKeys = SYSTEM_WEAPON_TRAITS) {
  const system = [],
    other = [];
  for (const raw of traits ?? []) {
    const t = normalizeTrait(raw);
    if (!t) continue;
    (systemKeys.has(t) ? system : other).push(t);
  }
  return { system: [...new Set(system)], other: [...new Set(other)] };
}

/** The ship weapon entry stored in the starship flag (same shape as the sheet's "Add weapon"). */
export function weaponEntry(w, id, stationId = null) {
  return {
    id,
    weaponRef: w.id,
    name: w.name,
    die: w.die,
    damageType: w.damageType,
    range: w.range,
    traits: (w.traits ?? []).map(normalizeTrait),
    category: w.category,
    group: w.group,
    stationId
  };
}

import { linkInline } from "./inline-links.mjs";
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function parseDie(die) {
  const m = /^(\d+)?d(\d+)/i.exec(String(die ?? ""));
  return m ? { dice: Number(m[1] ?? 1), die: `d${m[2]}` } : { dice: 1, die: "d6" };
}

/** Optional localisation (0.9.1, RU pack copies): tr(name), damageLabel(type), traitLabel(trait), labels. Flags stay English. */
export function buildWeaponItemData(
  w,
  {
    systemKeys = SYSTEM_WEAPON_TRAITS,
    hint = "Перетащите на лист корабля / Drag onto a starship sheet",
    tr = (x) => x,
    damageLabel = (x) => x,
    traitLabel = (x) => x,
    labels = {}
  } = {}
) {
  const L = {
    damage: "Damage",
    range: "Range",
    zones: "zones",
    upgradeSlots: "Upgrade slots",
    starshipTraits: "Starship traits",
    source: "Source",
    page: "p.",
    ...labels
  };
  const { system, other } = splitWeaponTraits(w.traits, systemKeys);
  const dmg = parseDie(w.die);
  const rows = [
    [L.damage, linkInline(`${esc(w.die)} ${esc(damageLabel(w.damageType))}`)],
    [L.range, `${esc(w.range)} ${esc(L.zones)}`],
    [L.upgradeSlots, esc(w.upgradeSlots ?? 0)],
    other.length && [L.starshipTraits, esc(other.map(traitLabel).join(", "))],
    w.source?.book && [L.source, `${esc(w.source.book)}${w.source.page ? ` ${esc(L.page)} ${esc(w.source.page)}` : ""}`]
  ]
    .filter(Boolean)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`)
    .join("");
  return {
    name: w.name ? tr(w.name) : w.id,
    type: "weapon",
    img: "icons/svg/target.svg",
    system: {
      description: { value: `<p><em>${esc(hint)}</em></p><table>${rows}</table>`, gm: "" },
      rules: [],
      slug: w.id,
      _migration: schemaStamp(),
      traits: { value: [...new Set([...system, STARSHIP_TAG])], rarity: "common", otherTags: [STARSHIP_TAG] },
      publication: { title: w.source?.book ?? "", authors: "", license: "ORC", remaster: true },
      level: { value: Number(w.itemLevel ?? 0) },
      quantity: 1,
      baseItem: null,
      bulk: { value: 0 },
      hp: { value: 0, max: 0 },
      hardness: 0,
      price: { value: {} },
      equipped: { carryType: "worn", handsHeld: 0 },
      containerId: null,
      size: "med",
      material: { type: null, grade: null },
      identification: { status: "identified", unidentified: { name: "", img: "", data: { description: { value: "" } } } },
      usage: { value: "held-in-one-hand" },
      category: CATEGORIES.has(w.category) ? w.category : "simple",
      group: SYSTEM_WEAPON_GROUPS.has(w.group) ? w.group : null,
      bonus: { value: 0 },
      damage: { dice: dmg.dice, die: dmg.die, damageType: w.damageType ?? "untyped", persistent: null },
      splashDamage: { value: 0 },
      range: null,
      expend: null,
      ammo: null,
      reload: { value: null },
      grade: null,
      runes: { potency: 0, striking: 0, property: [] },
      specific: null,
      subitems: []
    },
    flags: { [MODULE_ID]: { [PACK_WEAPON_FLAG]: { weaponRef: w.id, zones: w.range, starshipTraits: other } } }
  };
}
