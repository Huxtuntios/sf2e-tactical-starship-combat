import { MODULE_ID } from "../constants.mjs";
import { T, escapeHtml, fromUuidSafe } from "../utils/foundry.mjs";
import { setActionSheetContext } from "./action-sheet-theme.mjs";
import { modulePackId } from "../utils/system.mjs";
import { Content } from "../content/loader.mjs";
import { buildActionItemData } from "../content/action-docs.mjs";
import { buildNpcAction, npcActionDescription, slugifyName } from "../actions/npc-inline.mjs";
import { readStarship } from "../starship/starship-state.mjs";
import { ct } from "../content/content-i18n.mjs";
import { linkContextDCs } from "../rolls/context-dc.mjs";
import { linkInline } from "../content/inline-links.mjs";
import { formatActionDescription } from "../actions/result-text.mjs";
import { isPrivateSensorActor } from "../sensor/private-contacts.mjs";

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

export async function sendActionDescriptionToChat({
  action = null,
  ship = null,
  crew = null,
  station = null,
  result = null,
  sourceText = action?.inline ? npcActionDescription(action, ct) : (action?.text ?? ""),
  name = action?.name ?? ""
}) {
  const id = action?.id ?? "";
  const description = formatActionDescription({ text: sourceText }, result, { localize: T, translate: ct });
  const linked = linkContextDCs(description.sourceText, { crew, ship });
  const source = String(linked);
  const sourceHtml = source.trim().startsWith("<") ? linkInline(source) : `<p>${linkInline(escapeHtml(source))}</p>`;
  const label = game.i18n.has(`SF2eTSC.actions.${id}`) ? T(`SF2eTSC.actions.${id}`) : ct(name);
  const info = [
    actionCostLabel(action?.cost ?? 1),
    station ? `${T("SF2eTSC.crew.station")}: ${escapeHtml(ct(station.name))}` : "",
    crew ? `${T("SF2eTSC.chat.crew")}: ${escapeHtml(crew.name)}` : "",
    ship ? `${T("SF2eTSC.encounter.ship")}: ${escapeHtml(ship.name)}` : ""
  ].filter(Boolean);
  const resultHtml = description.resultText
    ? `<div class="tsc-action-result-text">${escapeHtml(description.resultText).replace(/\n/g, "<br>")}</div>`
    : "";
  return ChatMessage.create({
    content: `<div class="tsc-action-description-message"><header><h3>${escapeHtml(label)}</h3></header><p class="tsc-dim">${info.join(" · ")}</p><div class="tsc-action-source-text">${sourceHtml}</div>${resultHtml}</div>`,
    speaker: ChatMessage.getSpeaker({ actor: ship ?? crew }),
    ...(isPrivateSensorActor(ship) ? { whisper: ChatMessage.getWhisperRecipients("GM").map((user) => user.id) } : {}),
    flags: {
      [MODULE_ID]: {
        actionDescription: {
          actionId: id,
          shipUuid: ship?.uuid ?? null,
          crewUuid: crew?.uuid ?? null,
          stationId: station?.id ?? null,
          sourceText: description.sourceText,
          resultText: description.resultText
        }
      }
    }
  });
}

export async function sendActionDescription(event, target, { result = null } = {}) {
  event.preventDefault();
  event.stopPropagation();
  const id = target.dataset.actionId;
  const ship = this?.document ?? (await fromUuidSafe(target.dataset.shipUuid));
  const shipData = ship ? readStarship(ship) : null;
  const action = Content.actions.get(id) ?? (shipData ? buildNpcAction(shipData, id) : null);
  const crew = await fromUuidSafe(target.dataset.crewUuid);
  const station =
    shipData?.stations.find((entry) => entry.id === target.dataset.stationId) ??
    shipData?.stations.find((entry) => entry.type === action?.station) ??
    null;
  const fallback = target.closest(".tsc-action-row")?.querySelector(".tsc-description-content")?.innerHTML ?? "";
  return sendActionDescriptionToChat({
    action,
    ship,
    crew,
    station,
    result,
    sourceText: action?.inline ? npcActionDescription(action, ct) : (action?.text ?? fallback),
    name: action?.name ?? target.textContent.trim()
  });
}

export async function showActionDescription(event, target) {
  event.preventDefault();
  event.stopPropagation();
  const id = target.dataset.actionId;
  const ship = this?.document ?? (await fromUuidSafe(target.dataset.shipUuid));
  const shipData = ship ? readStarship(ship) : null;
  const action = Content.actions.get(id) ?? (shipData ? buildNpcAction(shipData, id) : null);
  const shipSpecific =
    shipData?.role === "npc" &&
    shipData.npcActions?.some(
      (a) =>
        slugifyName(a.name) === slugifyName(action?.name) || (id === "fortify-shield-points" && slugifyName(a.name) === "fortify-shields")
    );
  const pack = game.packs.get(modulePackId("starship-actions"));
  if (pack && !shipSpecific) {
    const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.packAction`, "folder"] });
    const matches = index.filter((row) => row.flags?.[MODULE_ID]?.packAction?.actionId === id);
    const language = game.i18n.lang?.startsWith("ru") ? "Русский" : "English";
    const row =
      matches.find((entry) => {
        let folder = pack.folders.get(entry.folder);
        while (folder?.folder) folder = folder.folder;
        return folder?.name === language;
      }) ?? matches[0];
    if (row) {
      const item = await pack.getDocument(row._id);
      setActionSheetContext(item.sheet, {
        crew: await fromUuidSafe(target.dataset.crewUuid),
        ship
      });
      return item.sheet.render(true);
    }
  }
  const data = buildActionItemData(action ?? { id, name: target.textContent.trim() });
  data._id = foundry.utils.randomID();
  data.name = target.textContent.trim();
  data.system.description.value = target.closest(".tsc-action-row").querySelector(".tsc-description-content").innerHTML;
  if (action?.passive) {
    data.system.actionType.value = "passive";
    data.system.actions.value = null;
  }
  // Ship-specific NPC abilities have no catalogue Item; viewing must not create world documents.
  return new CONFIG.Item.documentClass(data).sheet.render(true, { editable: false });
}
