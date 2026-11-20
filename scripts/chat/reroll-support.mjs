/**
 * Native reroll support for module chat rolls.
 *
 * The game system (sf2e / pf2e) already offers its reroll context menu on any chat message whose first roll is a
 * system CheckRoll with a valid check context flag. Module attacks / checks / saves / skills go through the native
 * Statistic.check.roll pipeline, so those messages are eligible without a module-owned menu.
 *
 * The system's reroll deletes the original message and re-posts a new one carrying only `flags.core` and its own
 * system flags — every module flag (deferred-damage controls, attack receipts) is dropped. This adapter restores the
 * module flags on the rerolled message so the existing damage workflow and duplicate protection survive a reroll.
 *
 * Correlation is exact, not heuristic: both systems fire the public `pf2e.reroll(oldRoll, newRoll, resource, keep)`
 * hook while the source message still exists. The source is located by its roll, and its module flags are stashed
 * under the roll keys the reroll can post (the new roll, or the old roll when keep-higher/lower keeps it). The created
 * reroll message is matched by its own roll. Ordinary message deletions never enter the queue, so a reroll can never
 * inherit a different attack's flags. No system internals are patched and no context menu is added; without the hook
 * the adapter simply does nothing.
 */
import { MODULE_ID } from "../constants.mjs";
import { CARD_FLAG, reconcileRerolledCard } from "./attack-card/model.mjs";
import { nativeSystemId } from "../utils/system.mjs";
import { log } from "../utils/logging.mjs";

const EXPIRY_MS = 30_000;
const MAX_KEYS = 64;
/** rollKey -> { flags, ts, otherKey } awaiting the matching reroll message. */
const pending = new Map();
let registeredHooks = null;

/** Mirrors the system's isCheckContextFlag: a context that is not a damage roll or spell cast. */
export function isNativeCheckContext(context) {
  return !!context && !["damage-roll", "spell-cast"].includes(context.type);
}

/**
 * Stable identity of an evaluated roll. The system flips `options.isReroll` on the source roll and recomputes
 * `options.degreeOfSuccess` on the posted roll around the reroll hook, so both volatile fields are excluded —
 * otherwise the source lookup and the created-message match would each compare against a key that has already changed.
 */
function rollKey(roll) {
  try {
    const json = typeof roll?.toJSON === "function" ? roll.toJSON() : null;
    if (!json) return null;
    if (json.options) {
      delete json.options.isReroll;
      delete json.options.degreeOfSuccess;
    }
    return JSON.stringify(json);
  } catch {
    return null;
  }
}

function prune(now) {
  for (const [key, entry] of pending) if (now - entry.ts >= EXPIRY_MS) pending.delete(key);
  while (pending.size > MAX_KEYS) pending.delete(pending.keys().next().value);
}

/**
 * Capture the source message's module flags at the system reroll hook. `oldRoll` identifies the source uniquely; the
 * flags are stashed under both rolls the reroll may post so keep-higher/lower is covered.
 */
export function onSystemReroll(oldRoll, newRoll) {
  const oldKey = rollKey(oldRoll);
  if (!oldKey) return;
  const source = game.messages.find((m) => m.flags?.[MODULE_ID] && m.rolls?.[0] && rollKey(m.rolls[0]) === oldKey);
  const flags = source?.flags?.[MODULE_ID];
  if (!flags || !Object.keys(flags).length) return;
  const now = Date.now();
  prune(now);
  const snapshot = structuredClone(flags);
  const newKey = rollKey(newRoll) ?? oldKey;
  pending.set(oldKey, { flags: snapshot, ts: now, otherKey: newKey });
  pending.set(newKey, { flags: snapshot, ts: now, otherKey: oldKey });
}

/** Restore module flags on the rerolled message; only the rerolling client writes, so no multi-client race. */
export async function onRerollMessageCreated(message) {
  const context = message.flags?.[nativeSystemId()]?.context;
  if (!isNativeCheckContext(context) || context.isReroll !== true) return;
  const key = rollKey(message.rolls?.[0]);
  const entry = key ? pending.get(key) : null;
  if (!entry) return;
  pending.delete(key);
  if (entry.otherKey) pending.delete(entry.otherKey);
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
  // Both supported systems fire this public hook (sf2e keeps the pf2e.* hook name); verified in sf2e 1.7.1 / pf2e 8.7.1.
  Hooks.on("pf2e.reroll", (oldRoll, newRoll) => onSystemReroll(oldRoll, newRoll));
  Hooks.on("createChatMessage", (message) => {
    onRerollMessageCreated(message).catch((err) => log.warn("reroll flag restore failed", err));
  });
}

/** Test seam: drop stashed state without re-registering hooks. */
export function _resetRerollSupport() {
  pending.clear();
}
