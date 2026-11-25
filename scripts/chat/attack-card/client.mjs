/**
 * Attack card: client side. Buttons on the chat card and the Sensor Map pick call the same GM handler.
 * The MAP choice is updated in place (no message re-render); only GM writes re-render the card.
 */
import { MODULE_ID } from "../../constants.mjs";
import { actionLabel } from "../../actions/action-engine.mjs";
import { registerHandler, request } from "../../socket.mjs";
import { escapeHtml, T, fromUuidSync_ } from "../../utils/foundry.mjs";
import { notifyError } from "../../utils/logging.mjs";
import { ct } from "../../content/content-i18n.mjs";
import { CARD_FLAG, attackCardSave, attackCardSavesComplete, cardTargetKeys, isPlasmaAttackCard } from "./model.mjs";
import { renderAttackCard, renderDiag } from "./render.mjs";
import { declareAttack, resolveAttackCard, rollAttackCardDamage, rollAttackCardSaves, applyAttackCardDamage } from "./service.mjs";
import { previewNativeAttack, executeNativeAttack } from "../native-attack.mjs";
import { rollEventOptions } from "../../starship/stats.mjs";
import { registerCardRendering } from "../card.mjs";

/** Mark the chosen MAP button (DOM only). */
export function setMapChoice(card, choice) {
  let penalty = 0;
  card?.querySelectorAll("[data-tsc-map-choice]").forEach((x) => {
    const on = x.dataset.tscMapChoice === choice;
    x.classList.toggle("active", on);
    x.setAttribute("aria-pressed", String(on));
    if (on) penalty = Number(x.dataset.tscMapPenalty ?? 0);
  });
  card?.querySelectorAll("[data-tsc-effective-bonus]").forEach((value) => {
    const bonus = Number(value.dataset.tscEffectiveBonus) + penalty;
    value.textContent = bonus > 0 ? `+${bonus}` : String(bonus);
  });
}

/* ----------------------------------------------------------------------------------------- client */
/** Client-side MAP choice per open attack card (survives the card re-render). */
export const cardMapChoice = new Map();
function currentTargetUUIDs() {
  return [
    ...new Set(
      [...(game.user?.targets ?? [])]
        .map((token) => token?.actor?.uuid ?? token?.document?.actorUuid)
        .filter((uuid) => typeof uuid === "string" && uuid)
    )
  ];
}
export function cardResolutionPayload(messageId, targetUUIDs, mapChoice = "0", rollOptions = {}) {
  const keys = [...new Set(targetUUIDs.filter((key) => typeof key === "string" && key))];
  return { messageId, targetKey: keys[0], targetUUIDs: keys, mapChoice, ...rollOptions };
}

async function clientResolveTargets(messageId, targetUUIDs, mapChoice = "0", rollOptions = {}) {
  const payload = cardResolutionPayload(messageId, targetUUIDs, mapChoice, rollOptions);
  try {
    await request("resolveAttackCard", payload);
  } catch (err) {
    if (game.user.isGM && !/already|уже|stale|устарел/i.test(err.message)) {
      const go = await foundry.applications.api.DialogV2.confirm({
        classes: ["sf2e-tsc"],
        window: { title: T("SF2eTSC.ui.gmOverride") },
        content: `<p>${escapeHtml(err.message)}</p><p>${T("SF2eTSC.ui.overrideAsk")}</p>`,
        rejectClose: false
      }).catch(() => false);
      if (go) {
        try {
          await request("resolveAttackCard", { ...payload, gmOverride: true });
        } catch (e2) {
          notifyError("SF2eTSC.errors.generic", { message: e2.message });
        }
      }
    } else notifyError("SF2eTSC.errors.generic", { message: err.message });
  }
}

export function setCardTargetSelection(card, selectedKeys) {
  const selected = new Set(selectedKeys);
  card?.querySelectorAll("[data-tsc-attack='resolve'][data-target-key]").forEach((button) => {
    const active = selected.has(button.dataset.targetKey);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

/** Start a Sensor Map targeting session that resolves the card (same handler as the card buttons). */
export async function beginCardTargeting(messageId, mapChoice = cardMapChoice.get(messageId) ?? "0", rollOptions = {}) {
  const message = game.messages.get(messageId);
  const c = message?.flags?.[MODULE_ID]?.[CARD_FLAG];
  if (!c || c.status !== "open") return;
  const plasma = isPlasmaAttackCard(c);
  const [{ Targeting }, { openSensorMap }] = await Promise.all([import("../../ui/targeting.mjs"), import("../../ui/launchers.mjs")]);
  cardMapChoice.set(messageId, mapChoice);
  Targeting.begin({
    shipUuid: c.ship.uuid,
    label: `${actionLabel(c.action)} · ${ct(c.weapon.name)}`,
    range: c.range.zones ?? 99,
    rangeIncrement: c.range.increment,
    enforceDetection: c.ship.role === "player",
    allowSelf: false,
    gm: game.user.isGM,
    singleTarget: !plasma,
    messageId,
    onExecute: (keys) => {
      if (!plasma && keys.length !== 1) return false;
      return clientResolveTargets(messageId, plasma ? keys : [keys[0]], cardMapChoice.get(messageId) ?? mapChoice, rollOptions);
    }
  });
  openSensorMap();
}

function canAct(c) {
  if (game.user.isGM) return true;
  if (c.createdBy === game.user.id) return true;
  const crew = c.crew?.uuid ? fromUuidSync_(c.crew.uuid) : null;
  return !!crew?.testUserPermission?.(game.user, "OWNER");
}

export function registerAttackCards() {
  registerCardRendering();
  registerHandler("declareAttack", declareAttack);
  registerHandler("previewNativeAttack", previewNativeAttack);
  registerHandler("executeNativeAttack", executeNativeAttack);
  registerHandler("resolveAttackCard", resolveAttackCard);
  registerHandler("rollAttackCardDamage", rollAttackCardDamage);
  registerHandler("rollAttackCardSaves", rollAttackCardSaves);
  registerHandler("applyAttackCardDamage", applyAttackCardDamage);
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const c = message.flags?.[MODULE_ID]?.[CARD_FLAG];
    const diag = message.flags?.[MODULE_ID]?.attackDiag;
    const el = html instanceof HTMLElement ? html : html?.[0];
    if (!el || (!c && !diag)) return;
    if (c?.native) {
      // Append only the controls needed for deferred damage; preserve the system's own result HTML.
      el.querySelector(".tsc-native-attack-controls")?.remove();
      if (c.result?.pendingDamage) el.querySelectorAll('.message-content [data-action$="-damage"]').forEach((button) => button.remove());
      const host = el.querySelector(".message-content") ?? el;
      const controls = document.createElement("div");
      controls.className = "tsc-native-attack-controls";
      if (c.damageResult?.manual) {
        const note = document.createElement("p");
        note.className = "tsc-hint";
        const messages = [
          T("SF2eTSC.droneBlock.manualResult", {
            amount: c.damageResult.amount,
            resistance: c.damageResult.resistance
          })
        ];
        if (c.damageResult.protocolManual)
          messages.push(T("SF2eTSC.droneBlock.protocolManualResult", { resistance: c.damageResult.resistance }));
        note.textContent = messages.join(" ");
        controls.append(note);
      }
      const plasma = isPlasmaAttackCard(c);
      const save = attackCardSave(c);
      if (plasma && c.result?.pendingDamage?.profile?.shape) {
        const shape = document.createElement("p");
        shape.className = "tsc-hint";
        const value = c.result.pendingDamage.profile.shape.value;
        shape.textContent = `${T("SF2eTSC.attackCard.attackShape")}: ${T(`SF2eTSC.attackCard.shape.${c.result.pendingDamage.profile.shape.type}`)}${value != null ? ` ${value} ${T("SF2eTSC.attackCard.zones")}` : ""}`;
        controls.append(shape);
      }
      if (c.result?.pendingDamage && !c.damageApplied) {
        const damage = document.createElement("button");
        damage.type = "button";
        damage.dataset.tscAttack = "damage";
        damage.textContent = plasma
          ? T("SF2eTSC.attackCard.damage")
          : T(c.damageRoll ? "SF2eTSC.rolls.rerollDamage" : "SF2eTSC.rolls.rollDamage");
        controls.append(damage);
        if (plasma && save) {
          const saveButton = document.createElement("button");
          saveButton.type = "button";
          saveButton.dataset.tscAttack = "save";
          saveButton.textContent = T("SF2eTSC.attackCard.save");
          controls.append(saveButton);
        }
        if (c.damageRoll && (!save || attackCardSavesComplete(c)) && game.user.isGM) {
          const apply = document.createElement("button");
          apply.type = "button";
          apply.dataset.tscAttack = "apply";
          apply.textContent = T("SF2eTSC.rolls.applyDamage");
          controls.append(apply);
        }
      }
      if (!canAct(c)) controls.querySelectorAll("button").forEach((b) => b.remove());
      host.append(controls);
      controls.addEventListener("click", (ev) => {
        const button = ev.target.closest?.("[data-tsc-attack]");
        if (!button || button.disabled) return;
        ev.preventDefault();
        ev.stopPropagation();
        controls.querySelectorAll("button").forEach((b) => {
          b.disabled = true;
        });
        const type =
          button.dataset.tscAttack === "damage"
            ? "rollAttackCardDamage"
            : button.dataset.tscAttack === "save"
              ? "rollAttackCardSaves"
              : "applyAttackCardDamage";
        request(type, { messageId: message.id })
          .catch((err) => notifyError("SF2eTSC.errors.generic", { message: err.message }))
          .finally(() =>
            controls.querySelectorAll("button").forEach((b) => {
              b.disabled = false;
            })
          );
      });
      return;
    }
    const slot = el.querySelector(".tsc-attack-card");
    if (slot) {
      const tmp = document.createElement("div");
      tmp.innerHTML = c ? renderAttackCard(message) : renderDiag(diag); // re-render in this client's language
      slot.replaceWith(tmp.firstElementChild);
    }
    if (!c) return;
    const plasma = isPlasmaAttackCard(c);
    const card = el.querySelector(".tsc-attack-card");
    if (!game.user.isGM) card?.querySelectorAll("[data-gm-only]").forEach((b) => b.remove());
    if (!canAct(c)) {
      card?.querySelectorAll("[data-tsc-attack]").forEach((b) => b.remove());
      return;
    }
    if (c.targets?.length) setCardTargetSelection(card, cardTargetKeys(c.targets, currentTargetUUIDs()));
    const stored = cardMapChoice.get(message.id);
    if (stored) setMapChoice(card, stored);
    const chosenMap = () => card.querySelector("[data-tsc-map-choice].active")?.dataset.tscMapChoice ?? "0";
    card?.addEventListener("click", (ev) => {
      const m = ev.target.closest?.("[data-tsc-map-choice]");
      if (m) {
        ev.preventDefault();
        ev.stopPropagation();
        cardMapChoice.set(message.id, m.dataset.tscMapChoice);
        setMapChoice(card, m.dataset.tscMapChoice);
        return;
      }
      const b = ev.target.closest?.("[data-tsc-attack]");
      if (!b) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (b.dataset.busy) return;
      b.dataset.busy = "1";
      card.querySelectorAll("[data-tsc-attack]").forEach((x) => {
        x.disabled = true;
      });
      const done = () => {
        delete b.dataset.busy;
        card.querySelectorAll("[data-tsc-attack]").forEach((x) => {
          x.disabled = false;
        });
      };
      if (b.dataset.tscAttack === "resolve") {
        const selected = plasma ? currentTargetUUIDs() : [];
        const targets = selected.length ? selected : [b.dataset.targetKey];
        clientResolveTargets(message.id, targets, chosenMap(), rollEventOptions(ev)).finally(done);
      } else if (b.dataset.tscAttack === "map") {
        done();
        const opts = rollEventOptions(ev);
        beginCardTargeting(message.id, chosenMap(), opts);
      } else if (b.dataset.tscAttack === "damage")
        request("rollAttackCardDamage", { messageId: message.id })
          .catch((err) => notifyError("SF2eTSC.errors.generic", { message: err.message }))
          .finally(done);
      else if (b.dataset.tscAttack === "save")
        request("rollAttackCardSaves", { messageId: message.id })
          .catch((err) => notifyError("SF2eTSC.errors.generic", { message: err.message }))
          .finally(done);
      else if (b.dataset.tscAttack === "apply")
        request("applyAttackCardDamage", { messageId: message.id })
          .catch((err) => notifyError("SF2eTSC.errors.generic", { message: err.message }))
          .finally(done);
      else if (b.dataset.tscAttack === "cancel")
        request("resolveAttackCard", { messageId: message.id, cancel: true })
          .catch((err) => notifyError("SF2eTSC.errors.generic", { message: err.message }))
          .finally(done);
    });
  });
}
