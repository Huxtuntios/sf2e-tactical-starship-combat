/** Weapon attack without a module chat declaration. All execution remains on the active GM. */
import { MODULE_ID } from "../constants.mjs";
import { executeAction, sanitizeActionRequest, targetRuleInput } from "../actions/action-engine.mjs";
import { isCardAttack } from "./attack-card/model.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { ct } from "../content/content-i18n.mjs";
import { T } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";
import { validateManualModifiers } from "../actions/manual-modifiers.mjs";
import { computeAttackModifiers } from "../actions/strike.mjs";
import { escapeHtml } from "../utils/foundry.mjs";

const pending = new Map();
const completed = new Map();
const validWeaponAttack = (action) => isCardAttack(action) && ["strike", "npc-strike"].includes(action.builtin);

/** Validate the declaration without creating a message, rolling, writing or disclosing hidden targets. */
export async function previewNativeAttack({ user, payload }) {
  const req = sanitizeActionRequest(payload, user);
  const dry = await executeAction({ ...req, user, userId: user.id, dryRun: true, validateTarget: !!req.options.targetKey });
  const ctx = dry.ctx;
  if (!validWeaponAttack(ctx.action)) throw new Error(T("SF2eTSC.attackCard.notAnAttack"));
  const rules = targetRuleInput(ctx);
  return {
    shipUuid: ctx.ship.uuid,
    label: ct(ctx.weapon?.name ?? ctx.action.name),
    range: rules.range,
    rangeIncrement: rules.rangeIncrement,
    enforceDetection: ctx.data.role === "player",
    combatId: ctx.combat?.id ?? null,
    warnings: ctx.warnings ?? [],
    knownModifiers: ctx.target
      ? computeAttackModifiers(ctx, ctx.weapon, ctx.target).mods.map(({ label, value, type }) => ({ label, value, type }))
      : []
  };
}

/** Duplicate event IDs by the same user share one in-flight/completed request; independent attacks need new IDs. */
export function executeNativeAttack({ user, payload }) {
  const eventId = payload?.eventId;
  if (typeof eventId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(eventId))
    return Promise.reject(new Error(T("SF2eTSC.errors.invalidData")));
  const key = `${user.id}:${eventId}`;
  if (pending.has(key)) return pending.get(key);
  if (completed.has(key)) return completed.get(key);
  const task = resolveOnce(user, payload, eventId);
  pending.set(key, task);
  task.then(
    () => {
      pending.delete(key);
      completed.set(key, task);
      if (completed.size > 1000) completed.delete(completed.keys().next().value);
    },
    () => {
      // Do not repeat a partially resolved operation in this GM session.
      pending.delete(key);
      completed.set(key, task);
      if (completed.size > 1000) completed.delete(completed.keys().next().value);
    }
  );
  return task;
}

async function resolveOnce(user, payload, eventId) {
  const old = game.messages.contents.find((m) => {
    const receipt = m.flags?.[MODULE_ID]?.nativeAttackReceipt;
    const author = typeof m.author === "string" ? game.users.get(m.author) : m.author;
    return author?.isGM && receipt?.userId === user.id && receipt?.eventId === eventId;
  });
  if (old) {
    if (old.flags[MODULE_ID].nativeAttackReceipt.status !== "resolved") throw new Error(T("SF2eTSC.attackCard.nativeIncomplete"));
    return { ok: true, duplicate: true, messageId: old.id };
  }
  if (payload.combatId && activeStarshipCombat()?.id !== payload.combatId) throw new Error(T("SF2eTSC.attackCard.stale"));
  const req = sanitizeActionRequest(payload, user);
  // Re-validate type on the GM before resolving; client never supplies the action definition.
  const dry = await executeAction({ ...req, user, userId: user.id, dryRun: true, validateTarget: !!req.options.targetKey });
  if (!validWeaponAttack(dry.ctx.action)) throw new Error(T("SF2eTSC.attackCard.notAnAttack"));
  let manual;
  try {
    manual = validateManualModifiers(payload.manualModifiers);
  } catch {
    throw new Error(T("SF2eTSC.modifiers.invalid"));
  }
  // NPC/mixed-damage integration is not yet reliable; don't silently discard submitted damage modifiers.
  if (dry.ctx.weapon?.npc && manual.some((m) => m.scope !== "attack")) throw new Error(T("SF2eTSC.modifiers.npcDamage"));
  if (manual.length && !user.isGM) {
    const list = manual
      .map(
        (m) =>
          `<li>${escapeHtml(m.name)}${m.source ? ` (${escapeHtml(m.source)})` : ""}: ${m.value > 0 ? "+" : ""}${m.value} — ${escapeHtml(T(`SF2eTSC.modifiers.type.${m.type}`))}, ${escapeHtml(T(`SF2eTSC.modifiers.scope.${m.scope}`))}</li>`
      )
      .join("");
    const approved = await foundry.applications.api.DialogV2.confirm({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.modifiers.approval") },
      content: `<p>${escapeHtml(T("SF2eTSC.modifiers.approvalHint", { name: user.name }))}</p><ul>${list}</ul>`,
      rejectClose: false
    }).catch(() => false);
    if (!approved) throw new Error(T("SF2eTSC.modifiers.denied"));
  }
  let message = null;
  const res = await executeAction({
    ...req,
    user,
    userId: user.id,
    cardMode: true,
    approvedModifiers: manual,
    strikeId: eventId,
    onAttackMessage: async (m) => {
      if (!m?.id) return;
      message = m;
      // Persist the receipt before applying effects: a failover must not roll the same event again.
      await m.update({ [`flags.${MODULE_ID}.nativeAttackReceipt`]: { eventId, userId: user.id, status: "rolled" } });
    }
  });
  if (message) {
    const patch = { [`flags.${MODULE_ID}.nativeAttackReceipt`]: { eventId, userId: user.id, status: "resolved" } };
    if (res.summary?.pendingDamage) {
      patch[`flags.${MODULE_ID}.attackCard`] = {
        native: true,
        status: "resolved",
        createdBy: user.id,
        request: req,
        ship: { name: dry.ctx.ship.name },
        weapon: { name: dry.ctx.weapon?.name ?? "" },
        result: { pendingDamage: res.summary.pendingDamage }
      };
    }
    try {
      await message.update(patch);
    } catch (err) {
      log.error("Native attack succeeded; could not attach receipt/damage controls", err);
      ui.notifications?.warn?.(T("SF2eTSC.attackCard.nativeAttachFailed"));
    }
  } else if (res.summary?.pendingDamage) {
    log.error("Native attack succeeded, but the system did not provide its chat message for damage controls");
    ui.notifications?.warn?.(T("SF2eTSC.attackCard.nativeAttachFailed"));
  }
  return {
    ok: true,
    degree: res.degree,
    messageId: message?.id ?? null,
    warnings: (res.reports ?? []).filter((r) => String(r).startsWith("⚠"))
  };
}
