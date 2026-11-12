import { MODULE_ID } from "../constants.mjs";
import { request } from "../socket.mjs";
import { T, moduleActive, fromUuidSync_ } from "../utils/foundry.mjs";
import { isStarship } from "../starship/starship-state.mjs";
import { can } from "../crew/permissions.mjs";
import {
  registerToolbeltDamageService,
  CHAT_DAMAGE_FLAG,
  damageApplicationKey,
  damageReceiptKey,
  damageReceiptOf
} from "./toolbelt-damage-service.mjs";

const roots = new Map();
const selectedTokens = () => (globalThis.canvas?.tokens?.controlled ?? []).map((token) => token.document ?? token);
const actorOf = (target) => target?.actor ?? target;
const rowIndex = (row) => Number(row.dataset.targetRollIndex ?? row.dataset.rollIndex ?? 0);

export function hasDamageReceipt(message, actor, index) {
  const key = damageApplicationKey(message.id, index);
  return (
    !!message.flags?.[MODULE_ID]?.damageReceipts?.[damageReceiptKey(actor.uuid, index)] ||
    !!actor.flags?.[MODULE_ID]?.[CHAT_DAMAGE_FLAG]?.some((record) => record.key === key)
  );
}

/** Захват события нужен до обработчика Toolbelt: исходная applyDamage не должна списать ОЗ второй раз. */
export function wireToolbeltDamage(message, root, { send = request, selected = selectedTokens, resolve = fromUuidSync_ } = {}) {
  if (root.dataset.tscDamageWired) return null;
  root.dataset.tscDamageWired = "1";
  const targetsFor = (row) => (row.dataset.targetUuid ? [resolve(row.dataset.targetUuid)].filter(Boolean) : selected());
  const busy = new Set();
  // Ранее распознанную цель нельзя тихо передать нативной обработке при потере UUID.
  const knownShipRows = new WeakMap();
  const refresh = () => {
    for (const row of root.querySelectorAll(".damage-application")) {
      const targets = targetsFor(row);
      const shipsOnly = targets.length > 0 && targets.every((target) => isStarship(actorOf(target)));
      if (row.dataset.targetUuid && shipsOnly) knownShipRows.set(row, row.dataset.targetUuid);
      else if (row.dataset.targetUuid && targets.length) knownShipRows.delete(row);
      let controls = row.querySelector(".tsc-ship-damage-controls");
      if (!shipsOnly) {
        controls?.remove();
        continue;
      }
      if (!controls) {
        controls = document.createElement("div");
        controls.className = "tsc-ship-damage-controls";
        const select = document.createElement("select");
        select.className = "tsc-ship-damage-multiplier";
        select.title = T("SF2eTSC.toolbelt.multiplier");
        for (const value of [1, 0.5, 2, 3, 0]) {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = `×${value}`;
          select.append(option);
        }
        controls.append(select);
        for (const mode of ["shields", "hull"]) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.tscShipDamage = mode;
          button.textContent = T(`SF2eTSC.toolbelt.${mode}`);
          button.title = T(`SF2eTSC.toolbelt.${mode}Hint`);
          controls.append(button);
        }
        row.append(controls);
      }
      const applied = targets.every((target) => hasDamageReceipt(message, actorOf(target), rowIndex(row)));
      row.classList.toggle("tsc-ship-damage-applied", applied);
      const locked =
        applied || row.classList.contains("applied") || targets.some((target) => !can(game.user, actorOf(target), "adjustVitals"));
      controls.querySelectorAll("button,select").forEach((control) => {
        control.disabled = locked;
      });
    }
  };
  const onClick = async (event) => {
    const button = event.target.closest?.(
      "[data-tsc-ship-damage], [data-action='target-applyDamage'], [data-action='applyDamage'], [data-action='target-shieldBlock'], [data-action='shieldBlock']"
    );
    const row = button?.closest(".damage-application");
    if (!row || !root.contains(row)) return;
    const targets = targetsFor(row);
    const ships = targets.filter((target) => isStarship(actorOf(target)));
    if (!targets.length && row.dataset.targetUuid && knownShipRows.get(row) === row.dataset.targetUuid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      ui.notifications.warn(T("SF2eTSC.toolbelt.targetUnavailable"));
      return;
    }
    if (!ships.length) return;
    const healing = Number(button.dataset.multiplier) < 0;
    if (healing && !button.dataset.tscShipDamage) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      if (ships.length !== targets.length) throw new Error(T("SF2eTSC.toolbelt.mixedTargets"));
      if (button.dataset.action?.endsWith("shieldBlock")) throw new Error(T("SF2eTSC.toolbelt.useShipShields"));
      if (row.classList.contains("applied")) throw new Error(T("SF2eTSC.toolbelt.alreadyApplied"));
      const index = rowIndex(row);
      const mode = button.dataset.tscShipDamage ?? "shields";
      const multiplier = button.dataset.tscShipDamage
        ? Number(row.querySelector(".tsc-ship-damage-multiplier")?.value ?? 1)
        : Number(button.dataset.multiplier ?? 1);
      let addend = 0;
      if (event.shiftKey) {
        addend = await foundry.applications.api.DialogV2.prompt({
          classes: ["sf2e-tsc"],
          window: { title: T("SF2eTSC.toolbelt.adjustment") },
          content: `<input type="number" name="addend" value="0" step="1" min="-100000" max="100000">`,
          ok: { callback: (e, b) => Number(new foundry.applications.ux.FormDataExtended(b.form).object.addend) },
          rejectClose: false
        }).catch(() => null);
        if (addend === null) return;
      }
      for (const target of ships) {
        const actor = actorOf(target);
        const key = `${actor.uuid}:${index}`;
        if (busy.has(key)) continue;
        busy.add(key);
        try {
          await send("toolbeltDamage", { messageId: message.id, targetUuid: target.uuid, rollIndex: index, multiplier, addend, mode });
          ui.notifications.info(T("SF2eTSC.toolbelt.applied"));
        } finally {
          busy.delete(key);
        }
      }
      refresh();
    } catch (error) {
      ui.notifications.warn(error.message);
    }
  };
  root.addEventListener("click", onClick, true);
  const observer = new MutationObserver(refresh);
  observer.observe(root, { childList: true, subtree: true });
  refresh();
  return {
    refresh,
    close() {
      observer.disconnect();
      root.removeEventListener("click", onClick, true);
      delete root.dataset.tscDamageWired;
    }
  };
}

/** Кнопка отмены на карточке урона, появившейся после применения; ссылается на квитанцию исходного броска. */
function wireCardUndo(root, { send = request, resolve = fromUuidSync_ } = {}) {
  if (root.dataset.tscCardUndoWired) return null;
  root.dataset.tscCardUndoWired = "1";
  const button = root.querySelector("[data-tsc-undo-damage]");
  const refresh = () => {
    const source = game.messages.get(button.dataset.messageId);
    const target = resolve(button.dataset.targetUuid);
    const actor = target?.actor ?? target;
    const rec = source && actor ? damageReceiptOf(source, actor, Number(button.dataset.rollIndex)) : null;
    button.disabled = !game.user.isGM || !rec || rec.undone || !rec.undoable || rec.shipUuid !== actor?.uuid;
  };
  const onClick = async (event) => {
    if (!event.target.closest?.("[data-tsc-undo-damage]")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await send("undoToolbeltDamage", {
        messageId: button.dataset.messageId,
        targetUuid: button.dataset.targetUuid,
        rollIndex: Number(button.dataset.rollIndex)
      });
      ui.notifications.info(T("SF2eTSC.toolbelt.damageUndone"));
    } catch (error) {
      ui.notifications.warn(error.message);
    }
    refresh();
  };
  root.addEventListener("click", onClick, true);
  refresh();
  return {
    refresh,
    close() {
      root.removeEventListener("click", onClick, true);
      delete root.dataset.tscCardUndoWired;
    }
  };
}

export function registerToolbeltDamage() {
  registerToolbeltDamageService();
  if (!moduleActive("pf2e-toolbelt")) return;
  const sweep = () => {
    for (const [root, entry] of roots)
      if (!root.isConnected) {
        entry.binding.close();
        roots.delete(root);
      }
  };
  Hooks.on("renderChatMessageHTML", (message, html) => {
    sweep();
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    if (root.querySelector("[data-tsc-undo-damage]")) {
      const cardBinding = wireCardUndo(root);
      if (cardBinding) roots.set(root, { binding: cardBinding, messageId: message.id });
      return;
    }
    if (!message.isDamageRoll || message.flags?.[MODULE_ID]?.attackCardDamage || message.flags?.[MODULE_ID]?.autoAppliedDamage) return;
    const binding = wireToolbeltDamage(message, root);
    if (binding) roots.set(root, { binding, messageId: message.id });
  });
  for (const hook of ["controlToken", "updateActor", "updateChatMessage"])
    Hooks.on(hook, () => {
      sweep();
      for (const entry of roots.values()) entry.binding.refresh();
    });
  Hooks.on("deleteChatMessage", (message) => {
    for (const [root, entry] of roots)
      if (entry.messageId === message.id) {
        entry.binding.close();
        roots.delete(root);
      }
  });
  for (const hook of ["renderChatLog", "closeChatPopout"]) Hooks.on(hook, sweep);
}
