import { MODULE_ID } from "../constants.mjs";
import { T } from "../utils/foundry.mjs";
import { modulePackId } from "../utils/system.mjs";
import { Content } from "../content/loader.mjs";
import { buildActionItemData } from "../content/action-docs.mjs";
import { buildNpcAction } from "../actions/npc-inline.mjs";
import { readStarship } from "../starship/starship-state.mjs";

export function actionCostLabel(cost) {
  if (Array.isArray(cost)) return `${Math.min(...cost)}–${Math.max(...cost)} ${T("SF2eTSC.ui.actions")}`;
  const key =
    { 1: "one-action", 2: "two-actions", 3: "three-actions", free: "free-action", reaction: "reaction", passive: "passive" }[cost] ??
    "one-action";
  return T(`SF2eTSC.edit.cost.${key}`);
}

export function showActionWarning(event, target) {
  event.preventDefault();
  event.stopPropagation();
  game.tooltip.activate(target);
}

export async function showActionDescription(event, target) {
  event.preventDefault();
  event.stopPropagation();
  const id = target.dataset.actionId;
  const pack = game.packs.get(modulePackId("starship-actions"));
  if (pack) {
    const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.packAction`, "folder"] });
    const matches = index.filter((row) => row.flags?.[MODULE_ID]?.packAction?.actionId === id);
    const language = game.i18n.lang?.startsWith("ru") ? "Русский" : "English";
    const row =
      matches.find((entry) => {
        let folder = pack.folders.get(entry.folder);
        while (folder?.folder) folder = folder.folder;
        return folder?.name === language;
      }) ?? matches[0];
    if (row) return (await pack.getDocument(row._id)).sheet.render(true);
  }
  const action = Content.actions.get(id) ?? (this?.document ? buildNpcAction(readStarship(this.document), id) : null);
  const data = buildActionItemData(action ?? { id, name: target.textContent.trim() });
  data._id = foundry.utils.randomID();
  data.name = target.textContent.trim();
  data.system.description.value = target.closest(".tsc-action-row").querySelector(".tsc-description-content").innerHTML;
  if (action?.passive) {
    data.system.actionType.value = "passive";
    data.system.actions.value = null;
  }
  // Ship-specific NPC abilities have no catalogue Item; viewing must not create world documents.
  return new CONFIG.Item.documentClass(data).sheet.render(true);
}
