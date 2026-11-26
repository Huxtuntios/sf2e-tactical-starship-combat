import { MODULE_ID } from "../constants.mjs";
import { registerHandler, request } from "../socket.mjs";
import { serialize } from "../utils/serial.mjs";
import { T, isActiveGM, fromUuidSafe } from "../utils/foundry.mjs";
import { nativeSystemId } from "../utils/system.mjs";
import { loadStarship, readStarship, patchStarship, isStarship } from "./starship-state.mjs";
import { normalizeEffectTargets } from "./effect-scopes.mjs";
import { safeDiceFormula } from "../content/inline-dice.mjs";
import { Draft } from "../actions/draft.mjs";
import { applyDamageInDraft } from "../damage/damage-service.mjs";
import { activeStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { privateContacts } from "../sensor/private-contacts.mjs";
import { resolveSensorActor } from "../sensor/map-object.mjs";

const fallbackText = {
  en: {
    label: "Persistent damage",
    applyHint:
      "The GM must apply this packet to the ship before attempting recovery. Damage-type immunities, resistances and weaknesses still apply.",
    apply: "Apply persistent damage",
    recover: "Recovery flat check",
    errors: {
      gmOnly: "Only the active GM can process persistent damage.",
      invalidPersistentDamage: "Invalid persistent damage formula, type or native roll.",
      nativeUnavailable: "The native persistent damage or flat-check API is unavailable.",
      operationConflict: "This persistent-damage operation was already used with different data.",
      invalidInterval: "Invalid persistent-damage interval.",
      staleReceipt: "This damage packet is stale or its effects have changed. It cannot be applied.",
      alreadyApplied: "This persistent-damage packet has already been applied.",
      invalidRecipient: "This recipient is not active on the selected application.",
      applyFirst: "Apply the ship's persistent damage before attempting recovery."
    }
  },
  ru: {
    label: "Продолжительный урон",
    applyHint:
      "Перед проверкой прекращения Мастер должен применить этот урон к кораблю. Иммунитеты, сопротивления и слабости к типам урона продолжают действовать.",
    apply: "Применить продолжительный урон",
    recover: "Чистая проверка прекращения",
    errors: {
      gmOnly: "Только активный Мастер может обрабатывать продолжительный урон.",
      invalidPersistentDamage: "Некорректная формула, тип или системный бросок продолжительного урона.",
      nativeUnavailable: "Системный программный интерфейс продолжительного урона или чистых проверок недоступен.",
      operationConflict: "Эта операция продолжительного урона уже использована с другими данными.",
      invalidInterval: "Некорректный интервал продолжительного урона.",
      staleReceipt: "Этот пакет урона устарел или его эффекты изменились. Применить его нельзя.",
      alreadyApplied: "Этот пакет продолжительного урона уже применён.",
      invalidRecipient: "Выбранная цель больше не активна в этом применении.",
      applyFirst: "Перед проверкой прекращения примените продолжительный урон кораблю."
    }
  }
};
const text = (key) => {
  const translationKey = `SF2eTSC.persistent.${key}`;
  const localized = game.i18n.localize(translationKey);
  if (localized !== translationKey) return localized;
  return key.split(".").reduce((value, part) => value?.[part], fallbackText[game.i18n.lang === "ru" ? "ru" : "en"]);
};
const error = (key) => new Error(text(`errors.${key}`));
const clone = (value) => foundry.utils.deepClone(value);
const patchOptions = { history: false, announce: false, undoable: false };
const shipRecipient = (effect) =>
  effect.kind === "persistent-damage" && effect.status === "active" && effect.targets?.entire && !effect.shipRecovered;
const fingerprint = (effect) =>
  JSON.stringify([effect.id, effect.operationId, effect.persistent, effect.targets?.entire, effect.shipRecovered ?? false]);
const requireGM = (user) => {
  if (!user?.isGM || !isActiveGM()) throw error("gmOnly");
};
const queue = (uuid, operation) => serialize(`tsc-action:${uuid}`, operation);
const receipts = (data) => (data.persistentDamageReceipts ??= []);

function nativeRoll(persistent) {
  const { formula, damageType, criticalHit = false } = persistent ?? {};
  if (!safeDiceFormula(formula) || !Object.hasOwn(CONFIG.PF2E?.damageTypes ?? {}, damageType)) throw error("invalidPersistentDamage");
  const Ctor = CONFIG.Dice?.rolls?.find((ctor) => ctor.name === "DamageRoll");
  if (!Ctor) throw error("nativeUnavailable");
  const roll = new Ctor(
    `(${safeDiceFormula(formula)})[persistent,${damageType}]`,
    {},
    {
      evaluatePersistent: true,
      critRule: game.settings.get(nativeSystemId(), "critRule") === "doubledamage" ? "double-damage" : "double-dice",
      degreeOfSuccess: criticalHit ? 3 : null,
      rollerId: game.user.id
    }
  );
  if (!Number.isFinite(roll.expectedValue)) throw error("invalidPersistentDamage");
  return roll;
}

export async function stagePersistentDamage(draft, entry, context = {}) {
  if (!entry || !Array.isArray(entry.parts) || entry.parts.length > 32) throw error("invalidPersistentDamage");
  const prepared = entry.parts.map((part) => {
    if (part.category !== "persistent") throw error("invalidPersistentDamage");
    const persistent = { formula: safeDiceFormula(part.formula), damageType: part.type, dc: 15, criticalHit: entry.criticalHit === true };
    nativeRoll(persistent);
    return persistent;
  });
  const target = await draft.ship(entry.targetUuid);
  const operationId = String(context.operationId ?? entry.source?.strikeId ?? foundry.utils.randomID(16));
  const source = clone(entry.source ?? null);
  const operationKey = JSON.stringify([operationId, entry.targetUuid]);
  const configuration = JSON.stringify([prepared, source]);
  const previous = (target.data.persistentStrikeOperations ?? []).find((op) => op.key === operationKey);
  if (previous) {
    if (previous.configuration !== configuration) throw error("operationConflict");
    return [...previous.applicationIds];
  }
  const condition = game.pf2e?.ConditionManager?.getCondition("persistent-damage");
  if (!condition) throw error("nativeUnavailable");
  const blocked =
    target.actor.isAffectedBy?.(condition) === false ||
    target.actor.isImmuneTo?.(condition) === true ||
    target.data.immunities?.includes("persistent-damage");
  const records = blocked
    ? []
    : prepared.map((persistent) => ({
        id: `persistent-${foundry.utils.randomID(16)}`,
        operationId,
        shipUuid: entry.targetUuid,
        manual: true,
        kind: "persistent-damage",
        slug: "persistent-damage",
        label: text("label"),
        modifiers: [],
        conditions: [],
        targets: normalizeEffectTargets({ entire: true }),
        persistent,
        source,
        sourceUuid: entry.source?.shipUuid ?? null,
        timing: null,
        status: "active",
        nativeTargets: [],
        targetSnapshot: { mechanics: [], stations: [], actions: [], weapons: [], crew: [] }
      }));
  target.data.effects.push(...records);
  (target.data.persistentStrikeOperations ??= []).push({ key: operationKey, configuration, applicationIds: records.map((r) => r.id) });
  return records.map((r) => r.id);
}

export function persistentIntervalForShip(combat, shipUuid, previous) {
  if (!combat || !previous || combat.round < previous.round) return null;
  const currentId = combat.combatant?.id ?? combat.turns?.[combat.turn]?.id;
  const forward =
    combat.round > previous.round || (combat.round === previous.round && combat.turn > previous.turn && currentId !== previous.id);
  if (!forward) return null;
  const ordinary = (combat.turns ?? []).filter((cb) => cb.actor?.uuid === shipUuid && !cb.flags?.[MODULE_ID]?.compromisedEntry);
  if (ordinary.length) return ordinary.some((cb) => cb.id === previous.id) ? `combat:${combat.id}:round:${previous.round}` : null;
  return combat.round > previous.round ? `combat:${combat.id}:round:${previous.round}` : null;
}

export function combatShipUuids(combat) {
  return [
    ...new Set(
      [
        ...(getTsc(combat).objects ?? []).filter((o) => o.type === "starship").map((o) => o.actorUuid ?? o.key),
        ...privateContacts(combat.id).map((o) => o.actorUuid)
      ].filter(Boolean)
    )
  ];
}

async function processAsGM({ user, payload }) {
  requireGM(user);
  const actor = await loadStarship(payload.shipUuid);
  const combat = payload.combatId ? game.combats.get(payload.combatId) : activeStarshipCombat();
  if (payload.combatId && !combat) throw error("staleReceipt");
  const intervalKey = payload.intervalKey ?? (combat ? `combat:${combat.id}:round:${combat.round}` : `manual:${game.time.worldTime}`);
  if (typeof intervalKey !== "string" || !intervalKey || intervalKey.length > 512) throw error("invalidInterval");
  return queue(actor.uuid, async () => {
    let receipt;
    const rolls = [];
    let fresh = false;
    await patchStarship(
      actor,
      async (data) => {
        await synchronizeNative(data);
        receipt = receipts(data).find((r) => r.intervalKey === intervalKey);
        if (receipt) return;
        const active = data.effects.filter(shipRecipient);
        const strongest = new Map();
        for (const effect of active) {
          const roll = nativeRoll(effect.persistent);
          const prior = strongest.get(effect.persistent.damageType);
          if (!prior || roll.expectedValue >= prior.roll.expectedValue) strongest.set(effect.persistent.damageType, { effect, roll });
        }
        if (!strongest.size) {
          receipt = { shipUuid: actor.uuid, status: "inactive", intervalKey, components: [] };
          return;
        }
        receipt = {
          id: foundry.utils.randomID(16),
          shipUuid: actor.uuid,
          combatId: combat?.id ?? null,
          intervalKey,
          sequence: (data.persistentDamageSequence ?? 0) + 1,
          status: "rolling",
          components: []
        };
        data.persistentDamageSequence = receipt.sequence;
        for (const effect of active) {
          const winner = strongest.get(effect.persistent.damageType);
          const lifecycle = (effect.shipPersistent ??= {});
          lifecycle.suppressedBy = winner.effect.id === effect.id ? null : winner.effect.id;
          lifecycle.intervalKey = intervalKey;
          lifecycle.receiptId = receipt.id;
        }
        for (const { effect, roll } of strongest.values()) {
          receipt.components.push({
            applicationId: effect.id,
            fingerprint: fingerprint(effect),
            type: effect.persistent.damageType,
            persistent: clone(effect.persistent),
            source: clone(effect.source ?? effect.sourceUuid ?? null)
          });
          rolls.push(roll);
        }
        receipts(data).push(receipt);
        fresh = true;
      },
      patchOptions
    );
    if (!fresh) return clone(receipt);
    try {
      for (let index = 0; index < rolls.length; index++) {
        const roll = await rolls[index].evaluate();
        const instance = roll.instances?.[0];
        if (
          roll.instances?.length !== 1 ||
          instance.type !== receipt.components[index].type ||
          !Number.isFinite(instance.total) ||
          instance.total < 0 ||
          instance.total > 1e9
        )
          throw error("invalidPersistentDamage");
        receipt.components[index].amount = Math.floor(instance.total);
        receipt.components[index].roll = roll.toJSON();
      }
      await patchStarship(
        actor,
        (data) => {
          const stored = receipts(data).find((r) => r.id === receipt.id);
          if (!stored || stored.status !== "rolling") throw error("staleReceipt");
          Object.assign(stored, { components: clone(receipt.components), status: "pending" });
          receipt = stored;
        },
        patchOptions
      );
    } catch (err) {
      await patchStarship(
        actor,
        (data) => {
          const stored = receipts(data).find((r) => r.id === receipt.id);
          if (stored?.status === "rolling") stored.status = "failed";
        },
        patchOptions
      );
      throw err;
    }
    try {
      await postPersistentCard(actor, receipt, rolls);
    } catch (err) {
      ui.notifications?.warn?.(err.message);
    }
    return clone(receipt);
  });
}

async function postPersistentCard(actor, receipt, rolls) {
  const esc = foundry.utils.escapeHTML;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
    rolls,
    flavor: `${esc(actor.name)} — ${esc(text("label"))}`,
    content:
      `<p>${esc(text("applyHint"))}</p><button type="button" data-tsc-persistent-apply>${esc(text("apply"))}</button>` +
      receipt.components
        .map(
          (c) =>
            `<button type="button" data-tsc-persistent-recover="${esc(c.applicationId)}">${esc(text("recover"))} — ${esc(T(CONFIG.PF2E.damageTypes[c.type]))}</button>`
        )
        .join(""),
    flags: {
      [MODULE_ID]: { persistentDamage: { shipUuid: actor.uuid, receiptId: receipt.id } },
      [nativeSystemId()]: { context: { type: "damage-roll" }, suppressDamageButtons: true }
    }
  });
}

async function applyAsGM({ user, payload }) {
  requireGM(user);
  const actor = await loadStarship(payload.shipUuid);
  return queue(actor.uuid, async () => {
    const draft = new Draft(activeStarshipCombat(), { trackCombat: false });
    const entry = await draft.ship(actor.uuid);
    const receipt = receipts(entry.data).find((r) => r.id === payload.receiptId && r.shipUuid === actor.uuid);
    if (!receipt) throw error("staleReceipt");
    if (receipt.status === "applied") throw error("alreadyApplied");
    if (receipt.status !== "pending") throw error("staleReceipt");
    const strongest = new Map();
    for (const effect of entry.data.effects.filter(shipRecipient)) {
      const expected = nativeRoll(effect.persistent).expectedValue;
      const previous = strongest.get(effect.persistent.damageType);
      if (!previous || expected >= previous.expected) strongest.set(effect.persistent.damageType, { id: effect.id, expected });
    }
    const components = receipt.components.filter((c) => {
      const effect = entry.data.effects.find((e) => e.id === c.applicationId && shipRecipient(e));
      return (
        effect &&
        strongest.get(c.type)?.id === effect.id &&
        fingerprint(effect) === c.fingerprint &&
        (effect.shipPersistent?.lastAppliedSequence ?? 0) < receipt.sequence
      );
    });
    if (!components.length) throw error("staleReceipt");
    const result = await applyDamageInDraft(draft, actor.uuid, {
      parts: components.map((c) => ({ type: c.type, amount: c.amount })),
      criticalHit: false,
      source: text("label"),
      silent: true
    });
    receipt.status = "applied";
    receipt.result = clone(result);
    receipt.appliedBy = user.id;
    receipt.appliedApplicationIds = components.map((c) => c.applicationId);
    for (const component of components) {
      const effect = entry.data.effects.find((e) => e.id === component.applicationId);
      Object.assign((effect.shipPersistent ??= {}), { lastAppliedReceiptId: receipt.id, lastAppliedSequence: receipt.sequence });
    }
    entry.writeOptions = patchOptions;
    await draft.commit();
    return clone(receipt);
  });
}

async function synchronizeNative(data) {
  for (const effect of data.effects.filter((e) => e.kind === "persistent-damage")) {
    for (const handle of effect.nativeTargets ?? []) {
      const member = await fromUuidSafe(handle.actorUuid);
      const item = member?.items.get(handle.itemId);
      handle.status = item?.flags?.[MODULE_ID]?.applicationId === effect.id ? (item.active === false ? "suppressed" : "active") : "ended";
    }
  }
}

async function recoverAsGM({ user, payload }) {
  requireGM(user);
  const actor = await loadStarship(payload.shipUuid);
  return queue(actor.uuid, async () => {
    let data = readStarship(actor);
    const effect = data.effects.find((e) => e.id === payload.applicationId && e.kind === "persistent-damage" && e.status === "active");
    if (!effect) throw error("staleReceipt");
    if (payload.actorUuid) {
      if (payload.actorUuid === actor.uuid) throw error("invalidRecipient");
      const handle = effect.nativeTargets?.find((h) => h.actorUuid === payload.actorUuid);
      const member = handle && (await fromUuidSafe(handle.actorUuid));
      const item = member?.items.get(handle.itemId);
      if (!item || item.flags?.[MODULE_ID]?.applicationId !== effect.id || typeof item.rollRecovery !== "function" || isStarship(member))
        throw error("invalidRecipient");
      await item.rollRecovery();
      await patchStarship(
        actor,
        async (current) => {
          await synchronizeNative(current);
        },
        patchOptions
      );
      return { applicationId: effect.id, actorUuid: member.uuid, status: member.items.has(handle.itemId) ? "active" : "recovered" };
    }
    if (!shipRecipient(effect)) throw error("invalidRecipient");
    const last = effect.shipPersistent?.lastAppliedReceiptId;
    const latest = receipts(data)
      .filter((receipt) => receipt.components.some((component) => component.type === effect.persistent.damageType))
      .reduce((previous, receipt) => (!previous || receipt.sequence > previous.sequence ? receipt : previous), null);
    if (!last || latest?.id !== last || latest.status !== "applied" || !latest.appliedApplicationIds?.includes(effect.id))
      throw error("applyFirst");
    const sameType = data.effects.filter((e) => shipRecipient(e) && e.persistent.damageType === effect.persistent.damageType);
    if (sameType.some((e) => e.shipPersistent?.recovery?.receiptId === last))
      return clone(sameType.find((e) => e.shipPersistent?.recovery?.receiptId === last).shipPersistent.recovery);
    const { Check, CheckModifier } = game.pf2e ?? {};
    if (!Check || !CheckModifier) throw error("nativeUnavailable");
    await patchStarship(
      actor,
      (current) => {
        const selected = current.effects.find((e) => e.id === effect.id && shipRecipient(e));
        if (!selected || selected.shipPersistent?.lastAppliedReceiptId !== last) throw error("staleReceipt");
        selected.shipPersistent.recovery = { receiptId: last, status: "rolling" };
      },
      patchOptions
    );
    const roll = await Check.roll(new CheckModifier(text("recover"), { modifiers: [] }), {
      actor,
      type: "flat-check",
      domains: [],
      options: new Set(),
      dc: { value: effect.persistent.dc ?? 15 },
      skipDialog: true,
      messageMode: "gm"
    });
    const result = {
      applicationId: effect.id,
      receiptId: last,
      status: (roll?.degreeOfSuccess ?? 0) >= 2 ? "recovered" : "active",
      degreeOfSuccess: roll?.degreeOfSuccess ?? null
    };
    await patchStarship(
      actor,
      async (current) => {
        const selected = current.effects.find((e) => e.id === effect.id && shipRecipient(e));
        if (!selected || fingerprint(selected) !== fingerprint(effect) || selected.shipPersistent?.lastAppliedReceiptId !== last)
          throw error("staleReceipt");
        await synchronizeNative(current);
        for (const other of current.effects.filter((e) => shipRecipient(e) && e.persistent.damageType === effect.persistent.damageType)) {
          (other.shipPersistent ??= {}).recovery = clone(result);
          if (result.status === "recovered") other.shipRecovered = true;
        }
        current.effects = current.effects.filter((e) => !(e.shipRecovered && !(e.nativeTargets ?? []).some((h) => h.status !== "ended")));
        data = current;
      },
      patchOptions
    );
    return result;
  });
}

export function processPersistentDamage(shipUuid, options = {}) {
  return request("processPersistentDamage", { shipUuid, combatId: options.combat?.id ?? null, intervalKey: options.intervalKey });
}
export function applyPersistentDamage(shipUuid, receiptId) {
  return request("applyPersistentDamage", { shipUuid, receiptId });
}
export function recoverPersistentDamage(shipUuid, applicationId, options = {}) {
  return request("recoverPersistentDamage", { shipUuid, applicationId, actorUuid: options.actorUuid });
}

export function wirePersistentDamage(message, root, { send = request } = {}) {
  const flag = message.flags?.[MODULE_ID]?.persistentDamage;
  if (!flag || root.dataset.tscPersistentWired) return null;
  root.dataset.tscPersistentWired = "1";
  const refresh = async () => {
    const actor = await resolveSensorActor(activeStarshipCombat(), flag.shipUuid);
    const receipt = actor && readStarship(actor).persistentDamageReceipts?.find((r) => r.id === flag.receiptId);
    for (const button of root.querySelectorAll("[data-tsc-persistent-apply]"))
      button.disabled = !game.user.isGM || receipt?.status !== "pending";
    for (const button of root.querySelectorAll("[data-tsc-persistent-recover]"))
      button.disabled = !game.user.isGM || receipt?.status !== "applied";
  };
  const onClick = async (event) => {
    const button = event.target.closest?.(
      "[data-tsc-persistent-apply], [data-tsc-persistent-recover], [data-tsc-ship-damage], [data-action='target-applyDamage'], [data-action='applyDamage'], [data-action='target-shieldBlock'], [data-action='shieldBlock']"
    );
    if (!button || !root.contains(button)) return;
    if (Number(button.dataset.multiplier) < 0 && !button.dataset.tscShipDamage) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      if (button.dataset.tscPersistentRecover)
        await send("recoverPersistentDamage", { shipUuid: flag.shipUuid, applicationId: button.dataset.tscPersistentRecover });
      else await send("applyPersistentDamage", { shipUuid: flag.shipUuid, receiptId: flag.receiptId });
    } catch (err) {
      ui.notifications.warn(err.message);
    }
    await refresh();
  };
  root.addEventListener("click", onClick, true);
  refresh().catch((err) => ui.notifications.warn(err.message));
  return {
    refresh,
    close() {
      root.removeEventListener("click", onClick, true);
      delete root.dataset.tscPersistentWired;
    }
  };
}

export function registerPersistentDamageService() {
  registerHandler("processPersistentDamage", processAsGM);
  registerHandler("applyPersistentDamage", applyAsGM);
  registerHandler("recoverPersistentDamage", recoverAsGM);
  for (const hook of ["createItem", "deleteItem", "updateItem"])
    Hooks.on(hook, async (item) => {
      const link = item.flags?.[MODULE_ID];
      if (!isActiveGM() || !link?.shipUuid || !link.applicationId) return;
      const ship = await fromUuidSafe(link.shipUuid);
      if (!ship || !isStarship(ship)) return;
      try {
        await patchStarship(
          ship,
          async (data) => {
            await synchronizeNative(data);
          },
          patchOptions
        );
      } catch (err) {
        ui.notifications.warn(err.message);
      }
    });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (root && message.flags?.[MODULE_ID]?.persistentDamage) wirePersistentDamage(message, root);
  });
}
