import { TscApp, tpl, openApps } from "./base-app.mjs";
import { readStarship, isStarship } from "../starship/starship-state.mjs";
import { getEffectTargetCatalog, removeManualEffect } from "../starship/application-service.mjs";
import { processPersistentDamage, applyPersistentDamage, recoverPersistentDamage } from "../starship/persistent-damage.mjs";
import { getConditionOptions } from "../starship/native-condition-adapter.mjs";
import { request } from "../socket.mjs";
import { T, fromUuidSync_ } from "../utils/foundry.mjs";
import { ct } from "../content/content-i18n.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { configureEffect, editEffect, effectCaption, effectDetails } from "./effect-editor.mjs";
import { EffectTargetDialog, effectTargetSummary } from "./effect-target-dialog.mjs";

export class EffectManager extends TscApp {
  static DEFAULT_OPTIONS = {
    classes: ["tsc-effect-manager"],
    position: { width: 620, height: 550 },
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
      add: async function () {
        if (this.busy || !game.user.isGM) return;
        this.busy = true;
        try {
          const input = await configureEffect();
          if (input) await new EffectTargetDialog(this.actor, input, { onApplied: () => this.render() }).render({ force: true });
        } catch (err) {
          ui.notifications.error(err.message);
        } finally {
          this.busy = false;
        }
      },
      remove: function (_event, button) {
        return this.perform(() => {
          const effect = readStarship(this.actor).effects.find((entry) => entry.id === button.dataset.effectId);
          if (effect?.manual) return removeManualEffect(this.actor.uuid, effect.id);
          return request("effectTiming", { shipUuid: this.actor.uuid, effectId: button.dataset.effectId, op: "complete" });
        });
      },
      timing: function (_event, button) {
        return this.perform(() => editEffect(this.actor, button.dataset.effectId));
      },
      process: function () {
        return this.perform(() => processPersistentDamage(this.actor.uuid));
      },
      apply: function (_event, button) {
        return this.perform(() => applyPersistentDamage(this.actor.uuid, button.dataset.receiptId));
      },
      recover: function (_event, button) {
        return this.perform(() =>
          recoverPersistentDamage(this.actor.uuid, button.dataset.effectId, { actorUuid: button.dataset.actorUuid || undefined })
        );
      }
    }
  };
  static PARTS = {
    body: { template: tpl("effect-manager"), scrollable: [".tsc-effect-applications", ".tsc-effect-manager-list"] }
  };
  constructor(actor) {
    super();
    this.actor = actor;
    this.busy = false;
    this.error = "";
  }
  channels = ["actor", "crew", "combat", "settings"];
  get title() {
    return `${T("SF2eTSC.effects.title")} — ${this.actor.name}`;
  }
  _canRender() {
    return game.user.isGM;
  }
  wants(channel, document) {
    if (!this.channels.includes(channel)) return false;
    if (!document || ["combat", "settings"].includes(channel) || document.uuid === this.actor.uuid) return true;
    return readStarship(this.actor).effects.some((effect) => effect.nativeTargets?.some((target) => target.actorUuid === document.uuid));
  }
  async _prepareContext() {
    const data = readStarship(this.actor);
    const catalog = getEffectTargetCatalog(this.actor);
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
    const effects = data.effects.map((effect) => {
      const snapshot = effect.targetSnapshot ?? catalog;
      const persistent = effect.kind === "persistent-damage";
      const defaultPersistentLabel = T("SF2eTSC.damageTypes.persistent");
      const defaultLabel = persistent && (!effect.label || [effect.slug, effect.kind, defaultPersistentLabel].includes(effect.label));
      const status = effect.shipPersistent?.suppressedBy
        ? "suppressed"
        : effect.rejectedTargets?.length
          ? "partial"
          : (effect.status ?? "active");
      return {
        id: effect.id,
        label: defaultLabel ? T("SF2eTSC.persistent.label") : ct(effect.label ?? effect.slug),
        caption: effectCaption(effect),
        details: persistent ? null : effectDetails(effect),
        statusLabel: T(`SF2eTSC.effects.status.${status}`),
        summary: effectTargetSummary(
          effect.targets ?? (effect.station ? { entire: false, stations: [effect.station] } : { entire: true }),
          snapshot
        ),
        ignoreImmunities: effect.ignoreImmunities,
        foreignSource: !!effect.shipUuid && effect.shipUuid !== this.actor.uuid,
        rejected: effect.rejectedTargets ?? [],
        persistent: persistent ? effectDetails(effect) : null,
        shipRecipient: persistent && effect.targets?.entire,
        shipRecovered: effect.shipRecovered,
        canRecoverShip:
          persistent &&
          effect.targets?.entire &&
          !effect.shipRecovered &&
          !effect.shipPersistent?.suppressedBy &&
          !!effect.shipPersistent?.lastAppliedReceiptId,
        recipients: (effect.nativeTargets ?? []).map((target) => {
          const item = fromUuidSync_(target.actorUuid)?.items?.get(target.itemId);
          const ended = target.status === "ended" || !item;
          const suppressed = !ended && (target.status === "suppressed" || item.active === false);
          return {
            actorUuid: target.actorUuid,
            effectId: effect.id,
            itemId: target.itemId,
            label:
              snapshot.crew?.find((member) => member.uuid === target.actorUuid)?.label ??
              fromUuidSync_(target.actorUuid)?.name ??
              target.actorUuid,
            ended,
            statusLabel: T(`SF2eTSC.effects.status.${ended ? "ended" : suppressed ? "suppressed" : "active"}`),
            canRecover: persistent && !ended && !suppressed && effect.shipUuid === this.actor.uuid
          };
        })
      };
    });
    const combat = activeStarshipCombat();
    return {
      isGM: game.user.isGM,
      operational: !data.destroyed,
      destroyed: data.destroyed,
      conditionOptions: getConditionOptions(),
      conditions,
      effects,
      error: this.error,
      hasCombat: !!combat,
      canProcess:
        !combat &&
        data.effects.some(
          (effect) => effect.kind === "persistent-damage" && effect.targets?.entire && effect.status === "active" && !effect.shipRecovered
        ),
      receipts: (data.persistentDamageReceipts ?? [])
        .filter((receipt) => ["pending", "rolling", "failed"].includes(receipt.status))
        .map((receipt) => ({
          id: receipt.id,
          label: receipt.intervalKey,
          statusLabel: T(`SF2eTSC.effects.status.${receipt.status}`),
          amount: receipt.components?.reduce((total, component) => total + (component.amount ?? 0), 0) ?? 0,
          canApply: receipt.status === "pending"
        }))
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
