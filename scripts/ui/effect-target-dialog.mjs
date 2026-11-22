import { TscApp, tpl } from "./base-app.mjs";
import { applyManualEffect, getEffectTargetCatalog } from "../starship/application-service.mjs";
import { normalizeEffectTargets } from "../starship/effect-scopes.mjs";
import { T } from "../utils/foundry.mjs";
import { ct } from "../content/content-i18n.mjs";
import { getConditionOptions } from "../starship/native-effect-adapter.mjs";
import { effectDetails } from "./effect-editor.mjs";

export function readEffectTargets(form) {
  const selected = (name) => [...form.querySelectorAll(`[name="${name}"]:checked`)].map((input) => input.value);
  return normalizeEffectTargets({
    entire: form.elements.entire.checked,
    mechanics: selected("mechanics"),
    stations: selected("stations"),
    actions: selected("actions").map((value) => JSON.parse(value)),
    weaponAttacks: form.elements.weaponAttacks?.checked ?? false,
    weaponDefenses: false,
    weapons: selected("weapons"),
    allCrew: form.elements.allCrew?.checked ?? false,
    crew: selected("crew")
  });
}

export function effectTargetSummary(selection, catalog) {
  const targets = normalizeEffectTargets(selection);
  const labels = [];
  if (targets.entire) labels.push(T("SF2eTSC.effects.targets.entire"));
  labels.push(...targets.mechanics.map((mechanic) => T(`SF2eTSC.effects.mechanics.${mechanic}`)));
  labels.push(...targets.stations.map((id) => ct(catalog.stations?.find((station) => station.id === id)?.label ?? id)));
  labels.push(
    ...targets.actions.map((selected) => {
      const captured = catalog.actions?.find((action) => action.stationId === selected.stationId && action.actionId === selected.actionId);
      const station = catalog.stations?.find((station) => station.id === selected.stationId);
      return `${ct(station?.label ?? selected.stationId)}: ${ct(captured?.label ?? station?.actions?.find((action) => action.id === selected.actionId)?.label ?? selected.actionId)}`;
    })
  );
  if (targets.weaponAttacks) labels.push(T("SF2eTSC.effects.targets.weaponAttacks"));
  labels.push(...targets.weapons.map((id) => ct(catalog.weapons?.find((weapon) => weapon.id === id)?.label ?? id)));
  const crew = targets.allCrew ? (catalog.crew ?? []).map((member) => member.uuid) : targets.crew;
  labels.push(
    ...[...new Set([...crew, ...targets.crew])].map((uuid) => catalog.crew?.find((member) => member.uuid === uuid)?.label ?? uuid)
  );
  return labels.join(" · ") || T("SF2eTSC.effects.errors.noTargets");
}

export class EffectTargetDialog extends TscApp {
  static DEFAULT_OPTIONS = {
    classes: ["tsc-effect-targets"],
    tag: "form",
    position: { width: 600, height: 620 },
    window: { icon: "fa-solid fa-bullseye" },
    form: {
      closeOnSubmit: false,
      submitOnChange: false,
      handler: async function (_event, form) {
        await this.submitSelection(form);
      }
    },
    actions: {
      cancel: function () {
        return this.close();
      }
    }
  };
  static PARTS = { body: { template: tpl("effect-targets"), scrollable: [".tsc-effect-target-groups"] } };
  constructor(actor, input, { onApplied = null } = {}) {
    super();
    this.actor = actor;
    this.input = { ...input, operationId: input.operationId ?? foundry.utils.randomID(16) };
    this.catalog = getEffectTargetCatalog(actor);
    this.onApplied = onApplied;
    this.busy = false;
  }
  channels = [];
  get title() {
    return T("SF2eTSC.effects.chooseTargets");
  }
  _canRender() {
    return game.user.isGM;
  }
  async _prepareContext() {
    const input = this.input;
    const label =
      input.label ??
      (input.kind === "condition"
        ? getConditionOptions().find((condition) => condition.slug === input.slug)?.label
        : T(`SF2eTSC.effects.kind.${input.kind}`));
    const caption = [label, effectDetails(input)].filter((value) => value != null && value !== "").join(" · ");
    const groups = [
      {
        name: "mechanics",
        label: T("SF2eTSC.effects.targets.mechanics"),
        choices: this.catalog.mechanics.map((value) => ({ value, label: T(`SF2eTSC.effects.mechanics.${value}`) }))
      },
      {
        name: "stations",
        label: T("SF2eTSC.effects.targets.stations"),
        choices: this.catalog.stations.map((station) => ({ value: station.id, label: ct(station.label) }))
      },
      {
        name: "actions",
        label: T("SF2eTSC.effects.targets.actions"),
        choices: this.catalog.stations.flatMap((station) =>
          station.actions.map((action) => ({
            value: JSON.stringify({ stationId: station.id, actionId: action.id }),
            label: `${ct(station.label)}: ${ct(action.label)}`
          }))
        )
      },
      {
        name: "weapons",
        label: T("SF2eTSC.effects.targets.weapons"),
        choices: this.catalog.weapons.map((weapon) => ({ value: weapon.id, label: ct(weapon.label) }))
      },
      {
        name: "crew",
        label: T("SF2eTSC.effects.targets.crew"),
        choices: this.catalog.crew.map((member) => ({ value: member.uuid, label: member.label }))
      }
    ];
    for (const group of groups) {
      group.isCrew = group.name === "crew";
      group.isWeapons = group.name === "weapons";
      group.choices.forEach((choice, index) => {
        choice.id = `${this.id}-${group.name}-${index}`;
      });
    }
    return {
      uid: this.id,
      groups,
      hasWeapons: this.catalog.weapons.length > 0,
      hasCrew: this.catalog.crew.length > 0,
      caption,
      summary: effectTargetSummary({ entire: true }, this.catalog),
      ignoreImmunities: this.input.ignoreImmunities
    };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    if (this._targetRoot === this.element) return;
    this._targetRoot = this.element;
    this.element.addEventListener("change", () => {
      this.element.elements.entire.setCustomValidity("");
      this.element.querySelector("[data-target-summary]").textContent = effectTargetSummary(readEffectTargets(this.element), this.catalog);
      this.element.querySelector("[data-effect-error]").textContent = "";
    });
    this.element.elements.entire.focus();
  }
  async submitSelection(form) {
    if (this.busy) return;
    const error = form.querySelector("[data-effect-error]");
    if (!game.user.isGM) {
      if (error) error.textContent = T("SF2eTSC.effects.errors.gmOnly");
      return;
    }
    if (!form.reportValidity()) return;
    const targets = readEffectTargets(form);
    if (
      !targets.entire &&
      !targets.mechanics.length &&
      !targets.stations.length &&
      !targets.actions.length &&
      !targets.weaponAttacks &&
      !targets.weapons.length &&
      !targets.allCrew &&
      !targets.crew.length
    ) {
      const message = T("SF2eTSC.effects.errors.noTargets");
      form.elements.entire.setCustomValidity(message);
      form.elements.entire.reportValidity();
      if (error) error.textContent = message;
      return;
    }
    this.busy = true;
    form.setAttribute("aria-busy", "true");
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const result = await applyManualEffect(this.actor.uuid, { ...this.input, targets });
      ui.notifications.info(T(result.status === "partial" ? "SF2eTSC.effects.partial" : "SF2eTSC.effects.applied"));
      await this.close();
      await this.onApplied?.(result);
      return result;
    } catch (err) {
      if (error) {
        error.textContent = err.message;
        error.focus();
      }
      ui.notifications.error(err.message);
    } finally {
      this.busy = false;
      form.removeAttribute("aria-busy");
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }
}
