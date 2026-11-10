import { MODULE_ID, STARSHIP_TAG } from "../constants.mjs";
import { ICONS, LEGACY_ICONS } from "./ship-docs.mjs";
import { linkInline } from "./inline-links.mjs";
import { log } from "../utils/logging.mjs";

export const WORLD_FIX_VERSION = 6;
const HAZARD_HTML = ["description", "disable", "routine", "reset"];

/** Item types whose data has `system.traits.otherTags` ("Other tags" on the item sheet). */
const TAGGABLE = new Set([
  "action",
  "melee",
  "weapon",
  "equipment",
  "consumable",
  "armor",
  "shield",
  "treasure",
  "backpack",
  "ammo",
  "feat",
  "spell"
]);
const tagsOf = (it) => it?.system?.traits?.otherTags ?? [];

/**
 * Pure: does this item belong to the module? Its own flags, a source in the module's compendiums, or an owner that is a
 * starship / starship hazard (hazard abilities and strikes live on such actors).
 */
export function isModuleItem(item, parent = item?.parent ?? null) {
  const own = item?.flags?.[MODULE_ID];
  if (own && typeof own === "object" && Object.keys(own).length) return true;
  const src = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? "";
  if (String(src).startsWith(`Compendium.${MODULE_ID}.`)) return true;
  const pf = parent?.flags?.[MODULE_ID];
  return !!(pf?.starship || pf?.starshipHazard);
}

/** Pure: the update that adds the `starship` tag (null when the item is not ours, cannot carry tags or has it). */
export function itemTagFix(item, parent = item?.parent ?? null) {
  if (!item || !TAGGABLE.has(item.type) || !isModuleItem(item, parent)) return null;
  const values = item.system?.traits?.value ?? [];
  if (tagsOf(item).includes(STARSHIP_TAG) && values.includes(STARSHIP_TAG)) return null;
  return {
    _id: item.id ?? item._id,
    "system.traits.otherTags": [...new Set([...tagsOf(item), STARSHIP_TAG])],
    "system.traits.value": [...new Set([...values, STARSHIP_TAG])]
  };
}

/** Items created from now on (compendium drops, imports, anything carrying module flags) get the tag at creation. */
export function registerItemTagging() {
  // Runtime labels only: preserve the English tag even when SF2e already supplies a localized label.
  // Cover existing native dictionaries (including creature/vehicle traits), then extend supported item dictionaries.
  for (const cfg of new Set([CONFIG.PF2E, CONFIG.SF2E].filter(Boolean))) {
    for (const [key, table] of Object.entries(cfg)) {
      if (!/(?:Traits|Tags)$/.test(key)) continue;
      if (table && typeof table === "object" && Object.hasOwn(table, STARSHIP_TAG) && typeof table[STARSHIP_TAG] === "string")
        table[STARSHIP_TAG] = STARSHIP_TAG;
    }
    for (const key of [
      "actionTraits",
      "featTraits",
      "weaponTraits",
      "npcAttackTraits",
      "equipmentTraits",
      "consumableTraits",
      "armorTraits",
      "shieldTraits",
      "spellTraits"
    ]) {
      if (cfg[key]) cfg[key][STARSHIP_TAG] = STARSHIP_TAG;
    }
  }
  Hooks.on("preCreateItem", (item, data, options, userId) => {
    if (userId !== game.user.id) return;
    const fix = itemTagFix(item, item.parent);
    if (fix)
      item.updateSource({ "system.traits.otherTags": fix["system.traits.otherTags"], "system.traits.value": fix["system.traits.value"] });
  });
}

/** Pure: the update for one actor (missing core icon → module icon; plain hazard check text → @Check links). */
export function actorFix(a) {
  const upd = {};
  const isShip = !!a.flags?.[MODULE_ID]?.starship;
  const isHz = !!a.flags?.[MODULE_ID]?.starshipHazard;
  if (!isShip && !isHz) return upd;
  const icon = isHz ? ICONS.hazard : a.type === "vehicle" ? ICONS.player : ICONS.npc;
  if (LEGACY_ICONS.includes(a.img)) upd.img = icon;
  const tok = a.prototypeToken?.texture?.src;
  if (!tok || LEGACY_ICONS.includes(tok)) upd["prototypeToken.texture.src"] = upd.img ?? a.img ?? icon;
  if (isHz)
    for (const k of HAZARD_HTML) {
      const v = a.system?.details?.[k];
      if (typeof v === "string" && v) {
        const n = linkInline(v);
        if (n !== v) upd[`system.details.${k}`] = n;
      }
    }
  if (isShip) {
    const v = a.system?.details?.publicNotes;
    if (typeof v === "string" && v) {
      const n = linkInline(v);
      if (n !== v) upd["system.details.publicNotes"] = n;
    }
  }
  return upd;
}

/** One-time world repair (active GM). Also fixes placed tokens that still point at the missing icon. */
export async function repairWorld() {
  if ((game.settings.get(MODULE_ID, "worldFixVersion") ?? 0) >= WORLD_FIX_VERSION) return 0;
  let n = 0;
  const updates = game.actors.map((a) => ({ _id: a.id, ...actorFix(a) })).filter((u) => Object.keys(u).length > 1);
  if (updates.length) {
    await Actor.updateDocuments(updates);
    n += updates.length;
  }
  for (const scene of game.scenes) {
    const tk = scene.tokens
      .filter((t) => LEGACY_ICONS.includes(t.texture?.src))
      .map((t) => ({
        _id: t.id,
        "texture.src":
          t.actor?.prototypeToken?.texture?.src && !LEGACY_ICONS.includes(t.actor.prototypeToken.texture.src)
            ? t.actor.prototypeToken.texture.src
            : ICONS.npc
      }));
    if (tk.length) {
      await scene.updateEmbeddedDocuments("Token", tk);
      n += tk.length;
    }
  }
  // items made by older versions (world items, station actions on characters, hazard abilities) get the starship tag
  const worldItems = [...(game.items ?? [])].map((it) => itemTagFix(it, null)).filter(Boolean);
  if (worldItems.length) {
    await Item.updateDocuments(worldItems);
    n += worldItems.length;
  }
  const owners = [...game.actors];
  for (const scene of game.scenes) for (const t of scene.tokens) if (!t.actorLink && t.actor) owners.push(t.actor);
  for (const actor of owners) {
    const ups = [...actor.items].map((it) => itemTagFix(it, actor)).filter(Boolean);
    if (ups.length) {
      await actor.updateEmbeddedDocuments("Item", ups);
      n += ups.length;
    }
  }
  await game.settings.set(MODULE_ID, "worldFixVersion", WORLD_FIX_VERSION);
  if (n) log.info(`repaired ${n} actors/tokens (icons, inline checks, starship tag)`);
  return n;
}
