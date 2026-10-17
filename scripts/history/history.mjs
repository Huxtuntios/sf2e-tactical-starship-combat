import { registerHandler } from "../socket.mjs";
/** GM-whispered, bounded audit records. No snapshots in player-readable combat flags. */
import { MODULE_ID } from "../constants.mjs";
import { T } from "../utils/foundry.mjs";
import { getTsc, activeStarshipCombat } from "../combat/tsc-state.mjs";

export function snapshot(data) {
  const { _errors, _warnings, name, ...rest } = data;
  return structuredClone(rest);
}
export const equalState = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function changedFields(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !equalState(before[k], after[k]));
}
/** Deliberately narrow: never reverse crew assignments, configuration, initiative or critical damage transitions. */
export function reversible(before, after) {
  const keys = changedFields(before, after);
  return keys.length > 0 && keys.every((k) => ["hp", "sp", "effects", "heading", "offKilter"].includes(k));
}
export function combatGuard(combat = activeStarshipCombat()) {
  if (!combat) return null;
  const { log, ...state } = getTsc(combat);
  return { id: combat.id, round: combat.round, turn: combat.turn, state };
}
function trustedRecord(message) {
  const author = typeof message?.author === "string" ? game.users.get(message.author) : message?.author;
  return (
    author?.isGM === true &&
    message.whisper?.length > 0 &&
    message.whisper.every((id) => game.users.get(id)?.isGM) &&
    message.flags?.[MODULE_ID]?.history?.schema === 1
  );
}
export function historyEntries(shipUuid = null) {
  if (!game.user?.isGM) return [];
  return [...(game.messages?.contents ?? [])]
    .filter((m) => trustedRecord(m) && (!shipUuid || m.flags[MODULE_ID].history.shipUuid === shipUuid))
    .slice(-80)
    .reverse();
}
export function historySummary(before, after) {
  const pool = (k) => (before[k]?.value === after[k]?.value ? T("SF2eTSC.qol.unchanged") : `${before[k]?.value} → ${after[k]?.value}`);
  return `${T("SF2eTSC.qol.shields")}: ${pool("sp")}. ${T("SF2eTSC.qol.hull")}: ${pool("hp")}.`;
}
export async function recordChange(actor, beforeData, afterData, { reason = "", undoable = true } = {}) {
  const before = snapshot(beforeData),
    after = snapshot(afterData);
  const fields = changedFields(before, after);
  if (!fields.length || !game.user?.isGM) return null;
  const record = {
    schema: 1,
    shipUuid: actor.uuid,
    shipName: actor.name,
    before,
    after,
    fields,
    reason: String(reason || T("SF2eTSC.qol.moduleChange")).slice(0, 500),
    undoable: undoable && reversible(before, after),
    guard: combatGuard(),
    at: Date.now(),
    undone: false
  };
  const esc = foundry.utils.escapeHTML;
  const message = await ChatMessage.create({
    whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
    content: `<p><strong>${esc(actor.name)}</strong>: ${esc(historySummary(before, after))} ${esc(T("SF2eTSC.qol.reason"))}: ${esc(record.reason)}</p>`,
    flags: { [MODULE_ID]: { history: record } }
  });
  const all = [...(game.messages?.contents ?? [])].filter(trustedRecord);
  for (const old of all.slice(0, Math.max(0, all.length - 80))) await old.delete?.();
  return message;
}
export async function undoChange(messageId) {
  if (!game.user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const message = game.messages.get(messageId),
    r = message?.flags?.[MODULE_ID]?.history;
  if (!trustedRecord(message) || !r?.undoable || r.undone || !equalState(r.guard, combatGuard()))
    throw new Error(T("SF2eTSC.qol.undoConflict"));
  const { loadStarship, readStarship, writeStarship } = await import("../starship/starship-state.mjs");
  const actor = await loadStarship(r.shipUuid);
  if (!equalState(snapshot(readStarship(actor)), r.after)) throw new Error(T("SF2eTSC.qol.undoConflict"));
  // Actor queue checks again immediately before the write; preserve all unrelated document/system fields.
  await writeStarship(actor, r.before, { history: false, expected: r.after, expectedCombat: r.guard });
  await message.update({ [`flags.${MODULE_ID}.history.undone`]: true, [`flags.${MODULE_ID}.history.undoable`]: false });
  return true;
}

export function registerHistoryHandlers() {
  registerHandler("undoHistory", async ({ user, payload }) => {
    if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    return undoChange(payload.messageId);
  });
}
