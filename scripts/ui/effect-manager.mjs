import { TscApp, tpl, openApps } from "./base-app.mjs";
import { readStarship, isStarship } from "../starship/starship-state.mjs";
import { getConditionOptions } from "../starship/native-condition-adapter.mjs";
import { request } from "../socket.mjs";
import { T, fromUuidSync_ } from "../utils/foundry.mjs";
import { ct } from "../content/content-i18n.mjs";
import { effectCaption } from "./effect-editor.mjs";

export class EffectManager extends TscApp {
  static DEFAULT_OPTIONS = {
    classes: ["tsc-effect-manager"],
    position: { width: 620, height: 620 },
    window: { icon: "fa-solid fa-sliders" },
    actions: {
      setOperational: function (_event, button) {
        return this.perform(() => request("setStarshipOperationalState", { shipUuid: this.actor.uuid, state: button.dataset.state }));
      },
      addCondition: function (_event, button) {
        return this.perform(() => {
          const fields = button.form.elements;
          return request("addStarshipCondition", {
            shipUuid: this.actor.uuid,
            slug: fields.conditionSlug.value,
            value: Number(fields.conditionValue.value)
          });
        });
      },
      removeCondition: function (_event, button) {
        return this.perform(() => request("removeStarshipCondition", { shipUuid: this.actor.uuid, itemId: button.dataset.itemId }));
      },
      removeEffect: function (_event, button) {
        return this.perform(() =>
          request("effectTiming", { shipUuid: this.actor.uuid, effectId: button.dataset.effectId, op: "complete" })
        );
      }
    }
  };
  static PARTS = { body: { template: tpl("effect-manager"), scrollable: [".tsc-effect-manager-list"] } };

  constructor(actor) {
    super();
    this.actor = actor;
    this.busy = false;
    this.error = "";
  }

  channels = ["actor"];

  get title() {
    return `${T("SF2eTSC.effects.title")} — ${this.actor.name}`;
  }

  _canRender() {
    return game.user.isGM;
  }

  wants(channel, document) {
    return channel === "actor" && (!document || document.uuid === this.actor.uuid);
  }

  async _prepareContext() {
    const data = readStarship(this.actor);
    const conditions = [...(this.actor.items?.values?.() ?? [])]
      .filter((item) => (typeof item.isOfType === "function" ? item.isOfType("condition") : item.type === "condition"))
      .map((item) => ({
        id: item.id,
        slug: item.slug,
        label: item.name,
        valued: item.system?.value?.isValued === true,
        value: item.system?.value?.value ?? null,
        active: item.active !== false
      }));
    return {
      isGM: game.user.isGM,
      operational: !data.destroyed,
      destroyed: data.destroyed,
      conditionOptions: getConditionOptions(),
      conditions,
      effects: (data.effects ?? []).map((effect) => ({
        id: effect.id,
        label: ct(effect.label ?? effect.slug),
        details: effectCaption(effect)
      })),
      error: this.error
    };
  }

  async perform(operation) {
    if (this.busy || !game.user.isGM) return;
    this.busy = true;
    this.error = "";
    this.element?.setAttribute("aria-busy", "true");
    try {
      return await operation();
    } catch (err) {
      this.error = err.message;
      ui.notifications.error(err.message);
    } finally {
      this.busy = false;
      this.element?.removeAttribute("aria-busy");
      await this.render();
    }
  }
}

export function openEffectManager(actor) {
  if (!game.user.isGM) return null;
  if (typeof actor === "string") actor = fromUuidSync_(actor);
  if (!isStarship(actor)) {
    ui.notifications.warn(T("SF2eTSC.errors.notStarship"));
    return null;
  }
  const app = openApps(EffectManager).find((manager) => manager.actor.uuid === actor.uuid) ?? new EffectManager(actor);
  Promise.resolve(app.render({ force: true }))
    .then(() => app.bringToFront())
    .catch((err) => ui.notifications.error(err.message));
  return app;
}
