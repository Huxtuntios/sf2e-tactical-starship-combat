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
import { CARD_FLAG } from "./model.mjs";
import { renderAttackCard, renderDiag } from "./render.mjs";
import { declareAttack, resolveAttackCard, rollAttackCardDamage, applyAttackCardDamage } from "./service.mjs";

/** Mark the chosen MAP button (DOM only). */
export function setMapChoice(card, choice) {
  card?.querySelectorAll("[data-tsc-map-choice]").forEach((x) => {
    const on = x.dataset.tscMapChoice === choice;
    x.classList.toggle("active", on);
    x.setAttribute("aria-pressed", String(on));
  });
}

/* ----------------------------------------------------------------------------------------- client */
/** Client-side MAP choice per open attack card (survives the card re-render). */
export const cardMapChoice = new Map();
async function clientResolve(messageId, targetKey, mapChoice = "0") {
  try {
    await request("resolveAttackCard", { messageId, targetKey, mapChoice });
  } catch (err) {
    if (game.user.isGM && !/already|уже|stale|устарел/i.test(err.message)) {
      const go = await foundry.applications.api.DialogV2.confirm({
        window: { title: T("SF2eTSC.ui.gmOverride") },
        content: `<p>${escapeHtml(err.message)}</p><p>${T("SF2eTSC.ui.overrideAsk")}</p>`,
        rejectClose: false
      }).catch(() => false);
      if (go) {
        try {
          await request("resolveAttackCard", { messageId, targetKey, mapChoice, gmOverride: true });
        } catch (e2) {
          notifyError("SF2eTSC.errors.generic", { message: e2.message });
        }
      }
    } else notifyError("SF2eTSC.errors.generic", { message: err.message });
  }
}

/** Start a Sensor Map targeting session that resolves the card (same handler as the card buttons). */
export async function beginCardTargeting(messageId, mapChoice = cardMapChoice.get(messageId) ?? "0") {
  const message = game.messages.get(messageId);
  const c = message?.flags?.[MODULE_ID]?.[CARD_FLAG];
  if (!c || c.status !== "open") return;
  const [{ Targeting }, { openSensorMap }] = await Promise.all([import("../../ui/targeting.mjs"), import("../../ui/launchers.mjs")]);
  cardMapChoice.set(messageId, mapChoice);
  Targeting.begin({
    shipUuid: c.ship.uuid,
    label: `${actionLabel(c.action)} · ${ct(c.weapon.name)}`,
    range: c.range.zones ?? 99,
    rangeIncrement: c.range.increment,
    enforceDetection: c.ship.role === "player",
    allowSelf: false,
    gm: false,
    messageId,
    onPick: (key) => clientResolve(messageId, key, cardMapChoice.get(messageId) ?? mapChoice)
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
  registerHandler("declareAttack", declareAttack);
  registerHandler("resolveAttackCard", resolveAttackCard);
  registerHandler("rollAttackCardDamage", rollAttackCardDamage);
  registerHandler("applyAttackCardDamage", applyAttackCardDamage);
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const c = message.flags?.[MODULE_ID]?.[CARD_FLAG];
    const diag = message.flags?.[MODULE_ID]?.attackDiag;
    const el = html instanceof HTMLElement ? html : html?.[0];
    if (!el || (!c && !diag)) return;
    const slot = el.querySelector(".tsc-attack-card");
    if (slot) {
      const tmp = document.createElement("div");
      tmp.innerHTML = c ? renderAttackCard(message) : renderDiag(diag); // re-render in this client's language
      slot.replaceWith(tmp.firstElementChild);
    }
    if (!c) return;
    const card = el.querySelector(".tsc-attack-card");
    if (!game.user.isGM) card?.querySelectorAll("[data-gm-only]").forEach((b) => b.remove());
    if (!canAct(c)) {
      card?.querySelectorAll("[data-tsc-attack]").forEach((b) => b.remove());
      return;
    }
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
      if (b.dataset.tscAttack === "resolve") clientResolve(message.id, b.dataset.targetKey, chosenMap()).finally(done);
      else if (b.dataset.tscAttack === "map") {
        done();
        beginCardTargeting(message.id, chosenMap());
      } else if (b.dataset.tscAttack === "damage")
        request("rollAttackCardDamage", { messageId: message.id })
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
