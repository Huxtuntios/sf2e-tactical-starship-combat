/** Attack card view bound to Foundry i18n (each client renders the card in its own language). */
import { makeCardRenderer } from "./view.mjs";
import { T, escapeHtml } from "../../utils/foundry.mjs";
import { actionLabel } from "../../actions/action-engine.mjs";
import { ct } from "../../content/content-i18n.mjs";
import { displayDesignation } from "../../utils/designations.mjs";

export const foundryLabels = () => ({
  t: T,
  has: (k) => game.i18n.has(k),
  actionLabel,
  ct,
  designation: displayDesignation,
  esc: escapeHtml
});
export function renderAttackCard(message) {
  return makeCardRenderer(foundryLabels()).renderAttackCard(message);
}
export function renderDiag(diag) {
  return makeCardRenderer(foundryLabels()).renderDiag(diag);
}
