/**
 * Native reroll support for module chat rolls.
 *
 * The game system (sf2e / pf2e) already offers its reroll context menu on any chat message whose first roll is a
 * system CheckRoll with a valid check context flag. Module attacks / checks / saves / skills go through the native
 * Statistic.check.roll pipeline, so those messages are eligible without a module-owned menu.
 *
 * The system's reroll deletes the original message and re-posts a new one carrying only `flags.core` and its own
 * system flags — every module flag (deferred-damage controls, attack receipts) is dropped. This adapter restores the
 * module flags on the rerolled message through public document hooks, so the existing damage workflow and duplicate
 * protection survive a reroll. It never replaces the system mechanism, adds no context menu, and patches no system
 * internals; when the system does not produce a reroll message it does nothing.
 */
import { MODULE_ID } from "../constants.mjs";
import { CARD_FLAG, reconcileRerolledCard } from "./attack-card/model.mjs";
import { nativeSystemId } from "../utils/system.mjs";
import { log } from "../utils/logging.mjs";

const EXPIRY_MS = 30_000;
const MAX_PER_SIGNATURE = 8;
/** signature -> FIFO of stashed module flags awaiting the matching reroll message. */
const pending = new Map();
let registeredHooks = null;

/** Mirrors the system's isCheckContextFlag: a context that is not a damage roll or spell cast. */
export function isNativeCheckContext(context) {
  return !!context && !["damage-roll", "spell-cast"].includes(context.type);
}

/**
 * Stable identity of a check message across the system's delete -> re-create reroll. The system clones the context
 * and speaker verbatim, so type / identifier / statistic / origin / target / speaker survive; only isReroll, options
 * and outcome change.
 */
function signatureOf(message) {
  const system = nativeSystemId();
  const flags = message.flags?.[system];
  const context = flags?.context;
  if (!isNativeCheckContext(context)) return null;
  const speaker = message.speaker ?? {};
  return JSON.stringify([
    system,
    context.type,
    context.identifier ?? "",
    flags.modifierName ?? "",
    context.origin?.actor ?? "",
    context.target?.actor ?? "",
    speaker.actor ?? "",
    speaker.token ?? ""
  ]);
}

function prune(now) {
  for (const [key, queue] of pending) {
    const fresh = queue.filter((entry) => now - entry.ts < EXPIRY_MS);
    if (fresh.length) pending.set(key, fresh);
    else pending.delete(key);
  }
}

/** Stash the module flags of a deleted check message so a following reroll can restore them. */
export function onRerollSourceDeleted(message) {
  const flags = message.flags?.[MODULE_ID];
  if (!flags || !Object.keys(flags).length) return;
  const signature = signatureOf(message);
  if (!signature) return;
  const now = Date.now();
  prune(now);
  const queue = pending.get(signature) ?? [];
  queue.push({ flags: structuredClone(flags), ts: now });
  while (queue.length > MAX_PER_SIGNATURE) queue.shift();
  pending.set(signature, queue);
}

/** Restore module flags on the rerolled message; only the rerolling client writes, so no multi-client race. */
export async function onRerollMessageCreated(message) {
  const context = message.flags?.[nativeSystemId()]?.context;
  if (context?.isReroll !== true) return;
  const signature = signatureOf(message);
  const queue = signature ? pending.get(signature) : null;
  if (!queue?.length) return;
  const entry = queue.shift();
  if (!queue.length) pending.delete(signature);
  const authorId = message.author?.id ?? message.author;
  if (authorId !== game.user.id) return;
  let flags = entry.flags;
  const card = flags[CARD_FLAG];
  if (card) {
    const reconciled = reconcileRerolledCard(card, context.outcome ?? null);
    if (reconciled !== card) flags = { ...flags, [CARD_FLAG]: reconciled };
  }
  const merged = { ...(message.flags?.[MODULE_ID] ?? {}), ...flags };
  try {
    await message.update({ [`flags.${MODULE_ID}`]: merged });
  } catch (err) {
    log.warn("could not restore module flags on a rerolled roll", err);
  }
}

/** Idempotent per Hooks instance (a fresh test mock installs a new Hooks object). */
export function registerRerollSupport() {
  if (registeredHooks === globalThis.Hooks) return;
  registeredHooks = globalThis.Hooks;
  pending.clear();
  Hooks.on("deleteChatMessage", onRerollSourceDeleted);
  Hooks.on("createChatMessage", (message) => {
    onRerollMessageCreated(message).catch((err) => log.warn("reroll flag restore failed", err));
  });
}

/** Test seam: drop stashed state without re-registering hooks. */
export function _resetRerollSupport() {
  pending.clear();
}
