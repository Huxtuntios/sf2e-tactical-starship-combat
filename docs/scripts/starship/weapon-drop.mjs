/**
 * a weapon from the "Starship Weapons" compendium dropped on a starship is added to the ship's weapon list
 * (flag data) instead of becoming an embedded Item. The drop listener / Item interception lives in pack-drop.mjs.
 */
import { MODULE_ID } from "../constants.mjs";
import { Content } from "../content/loader.mjs";
import { PACK_WEAPON_FLAG, weaponEntry } from "../content/weapon-docs.mjs";
import { Ship } from "./ship-service.mjs";
import { randomId } from "../utils/ids.mjs";

const recent = new Map();

/** Catalogue id of a pack weapon (item document or plain data), or null. */
export function packWeaponRef(item) {
  const f = item?.flags?.[MODULE_ID]?.[PACK_WEAPON_FLAG] ?? item?.getFlag?.(MODULE_ID, PACK_WEAPON_FLAG);
  return f?.weaponRef ?? null;
}

export async function addWeaponToShip(actor, ref) {
  const w = Content.weapons.get(ref);
  if (!w) {
    ui.notifications.warn(game.i18n.format("SF2eTSC.weapons.unknown", { id: ref }));
    return false;
  }
  const key = `${actor.uuid}:${ref}`;
  const now = Date.now();
  if (now - (recent.get(key) ?? 0) < 1500) return false; // one drop may reach both the sheet and the hook
  recent.set(key, now);
  await Ship.equipment(actor.uuid, "weapons", "add", { item: weaponEntry(w, randomId("wpn")) });
  ui.notifications.info(game.i18n.format("SF2eTSC.weapons.added", { name: w.name, ship: actor.name }));
  return true;
}
