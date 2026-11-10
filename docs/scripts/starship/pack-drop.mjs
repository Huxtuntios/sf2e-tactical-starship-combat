/**
 * Compendium drops on a starship: weapons join the ship's weapon list (weapon-drop.mjs), upgrades are installed in a
 * suitable battle station (upgrade-drop.mjs). Works for the module's sheets and for any other sheet, because the Item
 * creation itself is intercepted; nothing is ever embedded as a real Item on a ship.
 */
import { isStarship } from "./starship-state.mjs";
import { packWeaponRef, addWeaponToShip } from "./weapon-drop.mjs";
import { packUpgradeKey, addUpgradeToShip } from "./upgrade-drop.mjs";

/** Handle one dropped/created Item for a ship; true when it was a module pack item (and has been dealt with). */
function dispatch(actor, itemLike) {
  const wref = packWeaponRef(itemLike);
  if (wref) {
    addWeaponToShip(actor, wref);
    return true;
  }
  const ukey = packUpgradeKey(itemLike);
  if (ukey) {
    addUpgradeToShip(actor, ukey);
    return true;
  }
  return false;
}

/** Sheet-level drop listener (wired once per sheet element). */
export function wirePackDrop(sheet) {
  const el = sheet.element;
  if (!el || el.dataset.tscPackDrop) return;
  el.dataset.tscPackDrop = "1";
  el.addEventListener("dragover", (ev) => ev.preventDefault());
  el.addEventListener(
    "drop",
    async (ev) => {
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      const data = TE?.getDragEventData?.(ev);
      if (data?.type !== "Item" || !data.uuid) return;
      const item = await fromUuid(data.uuid);
      if (!packWeaponRef(item) && !packUpgradeKey(item)) return;
      ev.preventDefault();
      ev.stopPropagation();
      dispatch(sheet.document, item);
    },
    true
  );
}

export function registerPackDrop() {
  Hooks.on("preCreateItem", (item, data, options, userId) => {
    if (userId !== game.user.id) return;
    const actor = item.parent;
    if (!actor || !isStarship(actor)) return;
    if (dispatch(actor, packWeaponRef(data) ? data : item)) return false;
    if (packUpgradeKey(data) && dispatch(actor, data)) return false;
  });
}
