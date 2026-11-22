import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { readStarship } from "../starship/starship-state.mjs";
import { request } from "../socket.mjs";
import { T, fromUuidSync_ } from "../utils/foundry.mjs";
import { ct } from "../content/content-i18n.mjs";
import { getConditionOptions } from "../starship/native-effect-adapter.mjs";

export function effectCaption(e) {
  const chunks = [];
  if (e.slug === "boost-battle-station" && e.operatorUuid)
    chunks.push(T("SF2eTSC.boost.source", { name: fromUuidSync_(e.operatorUuid)?.name ?? "—" }));
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
    classes: ["sf2e-tsc"],
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

export function effectDetails(effect) {
  const details =
    effect.kind === "condition"
      ? effect.conditionValue
      : effect.kind === "persistent-damage"
        ? `${effect.persistent.formula} ${T(CONFIG.PF2E?.damageTypes?.[effect.persistent.damageType] ?? effect.persistent.damageType)} · ${T("SF2eTSC.effects.recoveryDC")} ${effect.persistent.dc}${effect.persistent.criticalHit ? ` · ${T("SF2eTSC.effects.criticalHit")}` : ""}`
        : (effect.modifiers ?? [])
            .map(
              (modifier) =>
                `${T(game.i18n.has(`SF2eTSC.effects.selectors.${modifier.selector}`) ? `SF2eTSC.effects.selectors.${modifier.selector}` : `SF2eTSC.skills.${modifier.selector}`)} ${modifier.value > 0 ? "+" : ""}${modifier.value} ${T(`SF2eTSC.effects.modifierTypes.${modifier.type}`)}`
            )
            .join(", ");
  return [details, effect.statistic ? T(`SF2eTSC.effects.statistic.${effect.statistic}`) : null]
    .filter((value) => value != null && value !== "")
    .join(" · ");
}

export function readEffectInput(form) {
  const fields = form.elements;
  const kind = fields.kind.value;
  const input = { kind, ignoreImmunities: ["condition", "persistent-damage"].includes(kind) && fields.ignoreImmunities.checked };
  const label = fields.label?.value.trim();
  if (label) input.label = label;
  if (kind === "condition") {
    input.slug = fields.slug.value;
    const condition = getConditionOptions().find((option) => option.slug === input.slug);
    input.label ??= condition?.label;
    input.conditionValue = condition?.valued ? Number(fields.conditionValue.value) : null;
  } else if (kind === "persistent-damage") {
    input.persistent = {
      formula: fields.formula.value.trim(),
      damageType: fields.damageType.value,
      dc: Number(fields.dc.value),
      criticalHit: fields.criticalHit.checked
    };
  } else {
    input.label ??= T(`SF2eTSC.effects.kind.${kind}`);
    input.modifiers = [{ selector: fields.selector.value, type: fields.modifierType.value, value: Number(fields.modifierValue.value) }];
    input.statistic = fields.statistic.value;
  }
  return input;
}

export async function configureEffect() {
  if (!game.user.isGM) return null;
  const esc = foundry.utils.escapeHTML;
  const uid = `tsc-effect-${foundry.utils.randomID(16)}`;
  const options = getConditionOptions().filter(
    (option) => option.slug !== "persistent-damage" && (option.shipSupported || option.nativeCrew)
  );
  const select = (name, label, entries) =>
    `<div class="form-group"><label for="${uid}-${name}">${esc(label)}</label><select id="${uid}-${name}" name="${name}">${entries.map(([value, caption]) => `<option value="${esc(value)}">${esc(caption)}</option>`).join("")}</select></div>`;
  const number = (name, label, value, min, max) =>
    `<div class="form-group"><label for="${uid}-${name}">${esc(label)}</label><input id="${uid}-${name}" name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="1" required></div>`;
  const check = (name, label) =>
    `<div class="tsc-effect-choice"><input id="${uid}-${name}" name="${name}" type="checkbox"><label for="${uid}-${name}">${esc(label)}</label></div>`;
  const selectors = [
    "all",
    "ac",
    "saving-throw",
    "attack",
    "skill-check",
    "ability-check",
    "station-check",
    "station-damage",
    "area-dc",
    "ac-against-strikes",
    "reflex-against-area",
    "str-based",
    "dex-based",
    "con-based",
    "int-based",
    "wis-based",
    "cha-based",
    "fortitude",
    "reflex",
    "will",
    "perception",
    ...Object.keys(CONFIG.PF2E?.skills ?? {})
  ];
  const content = document.createElement("div");
  content.innerHTML = `<div class="tsc-effect-config">${select(
    "kind",
    T("SF2eTSC.effects.kindLabel"),
    ["condition", "bonus", "penalty", "persistent-damage"].map((kind) => [kind, T(`SF2eTSC.effects.kind.${kind}`)])
  )}
    <div class="form-group"><label for="${uid}-label">${esc(T("SF2eTSC.effects.customLabel"))}</label><input id="${uid}-label" name="label" maxlength="240"></div>
    <fieldset data-effect-kind="condition"><legend>${esc(T("SF2eTSC.effects.kind.condition"))}</legend>
      ${select(
        "slug",
        T("SF2eTSC.effects.conditionLabel"),
        options.map((option) => [option.slug, option.label])
      )}
      ${number("conditionValue", T("SF2eTSC.effects.value"), 1, 1, 100)}
      <p class="hint">${esc(T("SF2eTSC.effects.conditionHint"))}</p>
    </fieldset>
    <fieldset data-effect-kind="bonus penalty" hidden><legend>${esc(T("SF2eTSC.effects.modifier"))}</legend>
      ${select(
        "selector",
        T("SF2eTSC.effects.selector"),
        [...new Set(selectors)].map((selector) => [
          selector,
          game.i18n.has(`SF2eTSC.effects.selectors.${selector}`)
            ? T(`SF2eTSC.effects.selectors.${selector}`)
            : T(`SF2eTSC.skills.${selector}`)
        ])
      )}
      ${select(
        "modifierType",
        T("SF2eTSC.effects.modifierType"),
        ["status", "circumstance", "item", "untyped"].map((type) => [type, T(`SF2eTSC.effects.modifierTypes.${type}`)])
      )}
      ${number("modifierValue", T("SF2eTSC.effects.value"), 1, 1, 100)}
      ${select(
        "statistic",
        T("SF2eTSC.effects.statisticLabel"),
        ["both", "check", "dc"].map((statistic) => [statistic, T(`SF2eTSC.effects.statistic.${statistic}`)])
      )}
    </fieldset>
    <fieldset data-effect-kind="persistent-damage" hidden><legend>${esc(T("SF2eTSC.persistent.label"))}</legend>
      <div class="form-group"><label for="${uid}-formula">${esc(T("SF2eTSC.effects.formula"))}</label><input id="${uid}-formula" name="formula" value="1d6" maxlength="120" required spellcheck="false" autocapitalize="none"></div>
      ${select(
        "damageType",
        T("SF2eTSC.effects.damageType"),
        Object.entries(CONFIG.PF2E?.damageTypes ?? {}).map(([type, label]) => [type, T(label)])
      )}
      ${number("dc", T("SF2eTSC.effects.recoveryDC"), 15, 1, 50)}
      ${check("criticalHit", T("SF2eTSC.effects.criticalHit"))}
    </fieldset>
    <fieldset data-effect-kind="condition persistent-damage"><legend>${esc(T("SF2eTSC.effects.immunity"))}</legend>
      ${check("ignoreImmunities", T("SF2eTSC.effects.ignoreImmunities"))}
      <p class="hint">${esc(T("SF2eTSC.effects.immunityHint"))}</p>
    </fieldset></div>`;
  const sync = (content) => {
    const kind = content.querySelector('[name="kind"]').value;
    content.querySelectorAll("[data-effect-kind]").forEach((panel) => {
      panel.hidden = !panel.dataset.effectKind.split(" ").includes(kind);
      panel.querySelectorAll("input, select").forEach((input) => {
        input.disabled = panel.hidden;
      });
    });
    const valued = kind === "condition" && options.find((option) => option.slug === content.querySelector('[name="slug"]').value)?.valued;
    const value = content.querySelector('[name="conditionValue"]');
    value.disabled = !valued;
    value.closest(".form-group").hidden = !valued;
    if (["bonus", "penalty"].includes(kind)) {
      const modifier = content.querySelector('[name="modifierValue"]');
      modifier.min = kind === "bonus" ? "1" : "-100";
      modifier.max = kind === "bonus" ? "100" : "-1";
      if ((kind === "bonus" && Number(modifier.value) <= 0) || (kind === "penalty" && Number(modifier.value) >= 0))
        modifier.value = kind === "bonus" ? "1" : "-1";
    }
  };
  return foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.effects.configure") },
    content,
    render: (_event, dialog) => {
      const config = dialog.element.querySelector(".tsc-effect-config");
      config.addEventListener("change", () => sync(config));
      sync(config);
    },
    ok: { label: T("SF2eTSC.effects.chooseTargets"), callback: (_event, button) => readEffectInput(button.form) },
    rejectClose: false
  });
}
