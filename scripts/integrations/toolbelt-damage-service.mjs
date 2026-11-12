import { MODULE_ID } from "../constants.mjs";
import { registerHandler } from "../socket.mjs";
import { T, fromUuidSafe, moduleActive } from "../utils/foundry.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { can } from "../crew/permissions.mjs";
import { Draft } from "../actions/draft.mjs";
import { applyDamageInDraft } from "../damage/damage-service.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { equalState, snapshot } from "../history/history.mjs";
import { nativeSystemId } from "../utils/system.mjs";

const queues = new Map();
export const CHAT_DAMAGE_FLAG = "chatDamageApplications";
export const damageApplicationKey = (messageId, rollIndex) => `${messageId}:${rollIndex}`;
export const damageReceiptKey = (actorUuid, rollIndex) => `${actorUuid.replace(/\./g, "_")}_${rollIndex}`;
const rejectDamage = (key) => {
  throw new Error(T(`SF2eTSC.toolbelt.${key}`));
};
const vitalsOf = (d) => ({
  hp: d.hp.value,
  sp: d.sp.value,
  compromised: d.compromised,
  wrecked: d.wrecked,
  inoperable: d.inoperable,
  destroyed: d.destroyed
});
const combatGuardOf = () => {
  const c = activeStarshipCombat();
  return c ? { id: c.id, round: c.round, turn: c.turn } : null;
};
// Отмена допустима только если применение не перевело корабль в критическое состояние.
const damageUndoable = (result) =>
  !result.becameCompromised &&
  !result.becameInoperable &&
  !result.destroyed &&
  !result.stationsMalfunctioned &&
  !(result.compromisedIncrease > 0);

/** Только реальные типизированные экземпляры броска; клиент не присылает готовое число урона. */
export function damagePartsFromMessage(message, rollIndex, multiplier, addend = 0) {
  // Better Chat создаёт новые ID или меняет состав броска; исходные квитанции нельзя надёжно сопоставить.
  const betterChat = message?.flags?.["pf2e-toolbelt"]?.betterChat;
  if (betterChat?.mergeDamage || betterChat?.injected || betterChat?.splitted) rejectDamage("mergedUnsupported");
  if (!message?.isDamageRoll || message.flags?.[MODULE_ID]?.attackCardDamage || message.flags?.[MODULE_ID]?.autoAppliedDamage)
    rejectDamage("unsupported");
  if (message.rolls?.some((roll) => roll.options?.splashOnly)) rejectDamage("unsupported");
  const roll = message.rolls?.[rollIndex];
  if (!roll || ![0, 0.5, 1, 2, 3].includes(multiplier) || !Number.isInteger(addend) || Math.abs(addend) > 100000) rejectDamage("invalid");
  if (!roll.instances?.length || roll.instances.some((part) => part.persistent && !part.options?.evaluatePersistent))
    rejectDamage("unsupported");
  const altered = multiplier === 1 && addend === 0 ? roll : roll.alter?.(multiplier, addend);
  if (!altered?.instances?.length) rejectDamage("unsupported");
  return altered.instances.map((part) => {
    if (part.kinds?.has("healing") && !part.kinds.has("damage")) rejectDamage("unsupported");
    if (!Number.isFinite(part.total) || part.total < 0 || part.total > 1e9 || !/^[a-z][a-z-]*$/.test(part.type ?? ""))
      rejectDamage("invalid");
    return { amount: Math.floor(part.total), type: part.type };
  });
}

// alter() marks manually doubled/tripled terms as crit; only the original degree or confirmed outcome is evidence.
function criticalHitFromMessage(message, rollIndex) {
  const degree = message.rolls?.[rollIndex]?.options?.degreeOfSuccess;
  const context = message.flags?.[nativeSystemId()]?.context;
  // Message-wide context labels only one roll; save/check critical success is not a critical hit.
  const associated = rollIndex === 0 && message.rolls?.length === 1 && context != null;
  if (associated && (context.type !== "damage-roll" || context.sourceType !== "attack")) return false;
  const outcome = associated ? context.outcome : null;
  const outcomes = ["criticalFailure", "failure", "success", "criticalSuccess"];
  if (degree != null && (!Number.isInteger(degree) || degree < 0 || degree > 3)) return false;
  if (outcome != null && !outcomes.includes(outcome)) return false;
  if (degree != null && outcome != null && outcomes[degree] !== outcome) return false;
  return degree === 3 || outcome === "criticalSuccess";
}

function mayRead(user, message) {
  if (user.isGM) return true;
  if (message.blind) return false;
  const author = typeof message.author === "string" ? message.author : message.author?.id;
  return !message.whisper?.length || message.whisper.includes(user.id) || author === user.id;
}

/** Авторитетная очередь активного ГМа; разные режимы одного броска не считаются разными попаданиями. */
export async function applyToolbeltDamage({ user, payload }) {
  if (!moduleActive("pf2e-toolbelt")) rejectDamage("inactive");
  if (!["shields", "hull"].includes(payload.mode) || !Number.isInteger(payload.rollIndex) || payload.rollIndex < 0) rejectDamage("invalid");
  const target = await fromUuidSafe(payload.targetUuid);
  const actor = target?.actor ?? target;
  if (!isStarship(actor)) rejectDamage("shipOnly");
  if (!can(user, actor, "adjustVitals")) throw new Error(T("SF2eTSC.errors.noPermission"));
  const message = game.messages.get(payload.messageId);
  if (!message || !mayRead(user, message)) throw new Error(T("SF2eTSC.errors.noPermission"));
  const previous = queues.get(actor.uuid) ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const key = damageApplicationKey(message.id, payload.rollIndex);
      const receiptKey = damageReceiptKey(actor.uuid, payload.rollIndex);
      const records = actor.flags?.[MODULE_ID]?.[CHAT_DAMAGE_FLAG] ?? [];
      if (records.some((record) => record.key === key) || message.flags?.[MODULE_ID]?.damageReceipts?.[receiptKey])
        rejectDamage("alreadyApplied");
      const criticalHit = criticalHitFromMessage(message, payload.rollIndex);
      const parts = damagePartsFromMessage(message, payload.rollIndex, payload.multiplier, payload.addend ?? 0);
      const item = message.item;
      const options = message.flags?.[nativeSystemId()]?.context?.options ?? [];
      const traits = [
        ...new Set([
          ...(item?.system?.traits?.value ?? []),
          ...(item?.system?.traits?.otherTags ?? []),
          ...(item?.flags?.[MODULE_ID]?.packWeapon?.starshipTraits ?? []),
          ...options.filter((option) => option.startsWith("item:trait:")).map((option) => option.slice(11)),
          ...(payload.mode === "hull" ? ["bypassing"] : [])
        ])
      ];
      // История урона хранится у корабля. Не перезаписываем общий снимок боя при независимых кликах целей.
      const draft = new Draft(activeStarshipCombat(), { trackCombat: false });
      draft.allowUndo = true;
      const entry = await draft.ship(actor.uuid);
      entry.writeOptions = { expected: snapshot(entry.data) };
      const result = await applyDamageInDraft(draft, actor.uuid, {
        parts,
        traits,
        criticalHit,
        nonlethal: traits.includes("nonlethal"),
        source: `${T("SF2eTSC.toolbelt.source")}: ${message.id} (${parts.map((part) => `${part.amount} ${part.type}`).join(" + ")})`
      });
      const receipt = {
        key,
        mode: payload.mode,
        by: user.id,
        shield: result.shieldDamage,
        hull: result.hullDamage,
        undoable: damageUndoable(result),
        undone: false,
        after: vitalsOf(entry.data),
        guard: combatGuardOf()
      };
      entry.writeOptions.extra = { [`flags.${MODULE_ID}.${CHAT_DAMAGE_FLAG}`]: [...records, receipt].slice(-100) };
      await draft.commit();
      // Метка в акторе уже сохранена атомарно с уроном. Ошибка обновления чата не разрешает повторное списание.
      try {
        await message.update({ [`flags.${MODULE_ID}.damageReceipts.${receiptKey}`]: receipt });
      } catch (error) {
        console.warn(`${MODULE_ID} | Damage receipt was saved on the actor, but not on the message`, error);
      }
      return { shield: result.shieldDamage, hull: result.hullDamage, mode: payload.mode };
    });
  queues.set(actor.uuid, task);
  task
    .finally(() => {
      if (queues.get(actor.uuid) === task) queues.delete(actor.uuid);
    })
    .catch(() => {});
  return task;
}

export function damageReceiptOf(message, actor, index) {
  const key = damageApplicationKey(message.id, index);
  return (
    (actor.flags?.[MODULE_ID]?.[CHAT_DAMAGE_FLAG] ?? []).find((r) => r.key === key) ??
    message.flags?.[MODULE_ID]?.damageReceipts?.[damageReceiptKey(actor.uuid, index)] ??
    null
  );
}

/** Точечная отмена одного применения урона: только суммы квитанции, без критических состояний. */
export async function undoToolbeltDamage({ user, payload }) {
  if (!moduleActive("pf2e-toolbelt")) rejectDamage("inactive");
  if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  if (!Number.isInteger(payload.rollIndex) || payload.rollIndex < 0) rejectDamage("invalid");
  const target = await fromUuidSafe(payload.targetUuid);
  const actor = target?.actor ?? target;
  if (!isStarship(actor)) rejectDamage("shipOnly");
  if (!can(user, actor, "adjustVitals")) throw new Error(T("SF2eTSC.errors.noPermission"));
  const message = game.messages.get(payload.messageId);
  if (!message || !mayRead(user, message)) throw new Error(T("SF2eTSC.errors.noPermission"));
  const previous = queues.get(actor.uuid) ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const key = damageApplicationKey(message.id, payload.rollIndex);
      const receiptKey = damageReceiptKey(actor.uuid, payload.rollIndex);
      const records = actor.flags?.[MODULE_ID]?.[CHAT_DAMAGE_FLAG] ?? [];
      const rec = records.find((r) => r.key === key);
      if (!rec) rejectDamage("unsupported");
      if (rec.undone) rejectDamage("alreadyUndone");
      if (!rec.undoable) rejectDamage("undoUnsafe");
      if (!equalState(vitalsOf(readStarship(actor)), rec.after) || !equalState(combatGuardOf(), rec.guard)) rejectDamage("undoConflict");
      const draft = new Draft(activeStarshipCombat(), { trackCombat: false });
      const entry = await draft.ship(actor.uuid);
      entry.writeOptions = {
        expected: snapshot(entry.data),
        extra: { [`flags.${MODULE_ID}.${CHAT_DAMAGE_FLAG}`]: records.map((r) => (r.key === key ? { ...r, undone: true } : r)) }
      };
      entry.data.sp.value = Math.min(entry.data.sp.max, entry.data.sp.value + rec.shield);
      entry.data.hp.value = Math.min(entry.data.hp.max, entry.data.hp.value + rec.hull);
      await draft.commit();
      try {
        await message.update({ [`flags.${MODULE_ID}.damageReceipts.${receiptKey}.undone`]: true });
      } catch (error) {
        console.warn(`${MODULE_ID} | Damage undo receipt was saved on the actor, but not on the message`, error);
      }
      return { shield: rec.shield, hull: rec.hull };
    });
  queues.set(actor.uuid, task);
  task
    .finally(() => {
      if (queues.get(actor.uuid) === task) queues.delete(actor.uuid);
    })
    .catch(() => {});
  return task;
}

export function registerToolbeltDamageService() {
  registerHandler("toolbeltDamage", applyToolbeltDamage);
  registerHandler("undoToolbeltDamage", undoToolbeltDamage);
}
