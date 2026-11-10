/** Delegated links in module windows: actual typed damage, chat checks, draggable valued conditions. */
import { openCondition, findCondition, conditionDragData } from "../content/condition-enricher.mjs";
import { checkChatContent, safeInlineDamage } from "../content/inline-checks.mjs";
import { rollTypedDamage, inlineDamageFormula } from "../rolls/typed-damage.mjs";
import { notifyError } from "../utils/logging.mjs";
import { safeDiceFormula } from "../content/inline-dice.mjs";
export function wireInlineClicks(root) {
  if (!root) return;
  // The native editor resolves explicit system links; unresolved expressions remain visible as text.
  const editor = globalThis.foundry?.applications?.ux?.TextEditor?.implementation;
  if (editor?.enrichHTML)
    root.querySelectorAll?.("[data-tsc-native]").forEach((node) => {
      if (node.dataset.tscNativePending) return;
      node.dataset.tscNativePending = "1";
      const source = node.dataset.tscNative;
      const escaped = String(source).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      Promise.resolve()
        .then(() => editor.enrichHTML(escaped))
        .then((html) => {
          if (node.isConnected && typeof html === "string" && html !== escaped && !html.includes(escaped)) node.outerHTML = html;
        })
        .catch((err) => console.warn("sf2e-tsc | native description enricher failed", err));
    });
  // Partial renders insert fresh anchors. Resolve ahead of dragstart: the browser requires synchronous setData.
  root.querySelectorAll?.("a.tsc-cond").forEach((link) => {
    link.draggable = true;
    findCondition(link.dataset.condition)
      .then((found) => {
        if (found) link.dataset.uuid = found.uuid;
      })
      .catch(() => {});
  });
  if (root.dataset?.tscInlineClicks) return;
  root.dataset.tscInlineClicks = "1";
  root.addEventListener(
    "dragstart",
    (event) => {
      const link = event.target?.closest?.("a.tsc-cond");
      if (!link) return;
      event.stopPropagation();
      if (!link.dataset.uuid) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData("text/plain", JSON.stringify(conditionDragData(link.dataset.uuid, link.dataset.value)));
    },
    true
  );
  root.addEventListener("keydown", (event) => {
    const link = event.target?.closest?.("a.tsc-cond, a.tsc-check");
    if (!link || !["Enter", " "].includes(event.key) || event.repeat) return;
    event.preventDefault();
    link.click();
  });
  root.addEventListener("contextmenu", (event) => {
    const link = event.target?.closest?.("a.tsc-cond");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    openCondition(link.dataset.condition);
  });
  root.addEventListener(
    "click",
    async (event) => {
      const link = event.target?.closest?.("a.tsc-cond, a.tsc-check");
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        if (link.classList.contains("tsc-cond")) {
          const slug = link.dataset.condition;
          if (!/^[a-z-]+$/.test(slug ?? "")) return;
          const value = Number(link.dataset.value);
          await ChatMessage.create({
            content: `@TscCondition[${slug}${Number.isInteger(value) && value > 0 ? `|value:${value}` : ""}]`,
            speaker: ChatMessage.getSpeaker()
          });
        } else if (link.dataset.dice) {
          const formula = safeDiceFormula(link.dataset.dice);
          if (!formula || !globalThis.Roll || (Roll.validate && !Roll.validate(formula))) return;
          const roll = await new Roll(formula).evaluate();
          await roll.toMessage({ speaker: ChatMessage.getSpeaker(), flavor: foundry.utils.escapeHTML(link.dataset.label ?? "") });
        } else if (link.dataset.inline) {
          const formula = inlineDamageFormula(safeInlineDamage(link.dataset.inline));
          if (formula) await rollTypedDamage(formula, { flavor: foundry.utils.escapeHTML(link.dataset.label ?? "") });
        } else {
          const title = root.querySelector(".window-title")?.textContent?.trim() ?? "";
          await ChatMessage.create({
            content: checkChatContent(link.dataset.check, link.dataset.label, title),
            speaker: ChatMessage.getSpeaker()
          });
        }
      } catch (err) {
        notifyError("SF2eTSC.errors.generic", { message: err.message });
      }
    },
    true
  );
}
