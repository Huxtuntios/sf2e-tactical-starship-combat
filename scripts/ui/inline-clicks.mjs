/** Delegated links in module windows: actual typed damage, chat checks, draggable valued conditions. */
import { openCondition, findCondition, conditionDragData } from "../content/condition-enricher.mjs";
import { checkChatContent } from "../content/inline-checks.mjs";
import { rollTypedDamage, inlineDamageFormula } from "../rolls/typed-damage.mjs";
import { notifyError } from "../utils/logging.mjs";
export function wireInlineClicks(root) {
  if (!root) return;
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
        } else if (link.dataset.inline) {
          const formula = inlineDamageFormula(link.dataset.inline);
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
