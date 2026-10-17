import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { readStarship } from "../starship/starship-state.mjs";
import { request } from "../socket.mjs";
import { T } from "../utils/foundry.mjs";
import { ct } from "../content/content-i18n.mjs";

export function effectCaption(e) {
  const chunks = [];
  if (e.slug === "evade") {
    const spent = e.actionsSpent ?? e.modifiers?.find((m) => m.selector === "ac")?.value;
    if (spent) chunks.push(T("SF2eTSC.qol.actionsSpent", { count: spent }));
  }
  if (e.timing) {
    const t = e.timing,
      combat = activeStarshipCombat();
    const cb = combat?.turns?.find((c) => c.id === t.combatantId);
    chunks.push(t.mode === "condition" ? t.condition : T(`SF2eTSC.qol.${t.mode}`, { round: t.round, name: cb?.name ?? "—" }));
    if (t.sustain) chunks.push(T("SF2eTSC.qol.sustainStatus", { round: t.lastSustainedRound ?? "—" }));
  } else if (e.until) chunks.push(T("SF2eTSC.qol.manualCondition", { condition: T(`SF2eTSC.qol.conditionNames.${e.until}`) }));
  return chunks.join(" · ");
}
export async function editEffect(actor, effectId) {
  if (!game.user.isGM) return;
  const effect = readStarship(actor).effects.find((e) => e.id === effectId),
    combat = activeStarshipCombat();
  if (!effect || !combat) return ui.notifications.warn(T("SF2eTSC.errors.noCombat"));
  const esc = foundry.utils.escapeHTML,
    t = effect.timing ?? {};
  const modes = ["rounds", "turn-start", "turn-end", "condition"]
    .map((id) => `<option value="${id}" ${id === t.mode ? "selected" : ""}>${T(`SF2eTSC.qol.mode.${id}`)}</option>`)
    .join("");
  const turns = (combat.turns ?? [])
    .map(
      (c) => `<option value="${esc(c.id)}" ${c.id === (t.combatantId ?? combat.combatant?.id) ? "selected" : ""}>${esc(c.name)}</option>`
    )
    .join("");
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${T("SF2eTSC.qol.effectTiming")}: ${ct(effect.label)}` },
    content: `<p>${esc(T("SF2eTSC.qol.timingHint"))}</p><div class="form-group"><label>${T("SF2eTSC.qol.modeLabel")}</label><select name="mode">${modes}</select></div>
      <div class="form-group"><label>${T("SF2eTSC.qol.anchor")}</label><select name="combatantId">${turns}</select></div>
      <div class="form-group"><label>${T("SF2eTSC.qol.rounds")}</label><input type="number" min="0" max="100" name="rounds" value="${Math.max(0, (t.round ?? combat.round + 1) - combat.round)}"></div>
      <div class="form-group"><label>${T("SF2eTSC.qol.condition")}</label><input name="condition" maxlength="240" value="${esc(t.condition ?? "")}"></div>
      <div class="form-group"><label>${T("SF2eTSC.qol.remindSustain")}</label><input name="sustain" type="checkbox" ${t.sustain ? "checked" : ""}></div>`,
    ok: {
      callback: (ev, button) => {
        const f = button.form.elements;
        return {
          mode: f.mode.value,
          combatantId: f.combatantId.value,
          rounds: Number(f.rounds.value),
          condition: f.condition.value,
          sustain: f.sustain.checked
        };
      }
    },
    rejectClose: false
  }).catch(() => null);
  if (result) await request("effectTiming", { shipUuid: actor.uuid, effectId, op: "set", timing: result });
}
