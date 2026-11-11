import { registerHandler } from "../socket.mjs";
/** GM-only bounded audit records; legacy GM-whisper records remain readable. */
import { MODULE_ID } from "../constants.mjs";
import { T } from "../utils/foundry.mjs";
import { getTsc, activeStarshipCombat } from "../combat/tsc-state.mjs";
import { serialize } from "../utils/serial.mjs";

export function snapshot(data) {
  const { _errors, _warnings, name, ...rest } = data;
  return structuredClone(rest);
}
/** Structural comparison of snapshot data: object key order is irrelevant, array order and presence are not. */
export function equalState(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== b.length) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equalState(a[key], b[key]));
}
export function changedFields(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => Object.hasOwn(before, k) !== Object.hasOwn(after, k) || !equalState(before[k], after[k])
  );
}
/** Только изменение deployed у одного существующего дрона, без скрытых побочных эффектов. */
function reversibleDroneMovement(before, after) {
  if (!Array.isArray(before.drones) || !Array.isArray(after.drones) || before.drones.length !== after.drones.length) return false;
  let changed = 0;
  for (let i = 0; i < before.drones.length; i++) {
    const a = before.drones[i],
      b = after.drones[i];
    if (equalState(a, b)) continue;
    if (
      !a ||
      !b ||
      a.tscVersion !== 1 ||
      b.tscVersion !== 1 ||
      typeof a.deployed !== "boolean" ||
      typeof b.deployed !== "boolean" ||
      a.deployed === b.deployed
    )
      return false;
    const { deployed: _a, ...restA } = a;
    const { deployed: _b, ...restB } = b;
    if (!equalState(restA, restB)) return false;
    changed++;
  }
  return changed === 1;
}
/** Deliberately narrow: never reverse crew assignments, configuration, initiative or critical damage transitions. */
export function reversible(before, after) {
  const keys = changedFields(before, after);
  if (keys.length === 1 && keys[0] === "drones") return reversibleDroneMovement(before, after);
  // Старые записи не различают ручную правку HP/SP и последствия урона, чата или боя.
  return keys.length > 0 && keys.every((k) => ["effects", "heading", "offKilter"].includes(k));
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
// Идентификатор хранилища задаёт только настройка мира, изменяемая ведущим.
function historyStore() {
  const id = game.settings.get(MODULE_ID, "historyStoreId");
  if (!id) return null;
  const doc = game.journal?.get(id);
  if (!doc || doc.flags?.[MODULE_ID]?.historyStore?.schema !== 1) throw new Error(T("SF2eTSC.qol.historyStoreInvalid"));
  const ownership = doc.ownership ?? {};
  if (
    ownership.default !== 0 ||
    Object.entries(ownership).some(([id, level]) => id !== "default" && level > 0 && !game.users.get(id)?.isGM)
  )
    throw new Error(T("SF2eTSC.qol.historyStoreInvalid"));
  return doc;
}
async function ensureHistoryStore() {
  const current = historyStore();
  if (current) return current;
  const doc = await JournalEntry.create({
    name: T("SF2eTSC.qol.historyStoreName"),
    ownership: { default: 0 },
    flags: { [MODULE_ID]: { historyStore: { schema: 1, records: [] } } }
  });
  await game.settings.set(MODULE_ID, "historyStoreId", doc.id);
  return historyStore();
}
const recordsOf = (doc) => doc?.flags?.[MODULE_ID]?.historyStore?.records ?? [];
function journalEntry(doc, id) {
  return {
    id: `j:${id}`,
    get flags() {
      return { [MODULE_ID]: { history: recordsOf(doc).find((r) => r.id === id) } };
    }
  };
}
export function historyEntries(shipUuid = null) {
  if (!game.user?.isGM) return [];
  let doc;
  try {
    doc = historyStore();
  } catch {
    doc = null;
  }
  const current = recordsOf(doc)
    .filter((r) => !shipUuid || r.shipUuid === shipUuid)
    .map((r) => journalEntry(doc, r.id))
    .reverse();
  const legacy = [...(game.messages?.contents ?? [])].filter(
    (m) => trustedRecord(m) && (!shipUuid || m.flags[MODULE_ID].history.shipUuid === shipUuid)
  );
  return [...current, ...legacy].sort((a, b) => b.flags[MODULE_ID].history.at - a.flags[MODULE_ID].history.at).slice(0, 80);
}
export function historySummary(before, after) {
  const pool = (k) => (before[k]?.value === after[k]?.value ? T("SF2eTSC.qol.unchanged") : `${before[k]?.value} → ${after[k]?.value}`);
  return `${T("SF2eTSC.qol.shields")}: ${pool("sp")}. ${T("SF2eTSC.qol.hull")}: ${pool("hp")}.`;
}
export async function recordChange(actor, beforeData, afterData, { reason = "", undoable = true, announce = true } = {}) {
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
  return serialize("tsc-history-store", async () => {
    const doc = await ensureHistoryStore();
    record.id = foundry.utils.randomID(16);
    const next = [...recordsOf(doc), record];
    // Pending intent is recovery evidence, even when the Actor write failed or has not started yet.
    if (next.slice(0, -80).some((item) => item.undoIntent && !item.undone)) throw new Error(T("SF2eTSC.qol.historyFailed"));
    await doc.update({ [`flags.${MODULE_ID}.historyStore.records`]: next.slice(-80) });
    const mode = game.settings.get(MODULE_ID, "chatAnnouncements") ?? "important";
    const important = fields.some((field) => ["destroyed", "inoperable", "compromised", "wrecked"].includes(field));
    if (announce && (mode === "all" || (mode === "important" && important))) {
      const text = T("SF2eTSC.qol.changeAnnouncement", { name: actor.name });
      await ChatMessage.create({ content: `<p>${foundry.utils.escapeHTML(text)}</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
    }
    return journalEntry(doc, record.id);
  });
}

const undoConflict = () => new Error(T("SF2eTSC.qol.undoConflict"));
/** Resolve only the GM-configured private Journal or a trusted legacy whisper, never caller-supplied record data. */
function undoTarget(messageId) {
  const id = String(messageId);
  const journal = id.startsWith("j:") ? historyStore() : null;
  if (id.startsWith("j:") && !journal) throw undoConflict();
  const recordId = journal ? id.slice(2) : null;
  const key = JSON.stringify(journal ? ["journal", journal.id, recordId] : ["message", id]);
  const read = () => {
    if (journal) {
      const current = historyStore();
      if (current?.id !== journal.id) throw new Error(T("SF2eTSC.qol.historyStoreInvalid"));
      const matches = recordsOf(current).filter((item) => item.id === recordId);
      if (matches.length > 1 || (matches.length && matches[0].schema !== 1)) throw undoConflict();
      return matches[0];
    }
    const message = game.messages.get(id);
    if (!message) return undefined;
    if (!trustedRecord(message)) throw undoConflict();
    return message.flags[MODULE_ID].history;
  };
  return { key, journal, recordId, id, read };
}
function validIntent(intent, target, shipUuid) {
  return (
    intent?.schema === 1 &&
    typeof intent.id === "string" &&
    /^[a-zA-Z0-9]{16}$/.test(intent.id) &&
    intent.key === target.key &&
    intent.shipUuid === shipUuid
  );
}
function finalizedRecord(current, expected) {
  return current?.undone === true && current.undoable === false && equalState(current, { ...expected, undone: true, undoable: false });
}
async function updateUndoRecord(target, expected, patch, validate = () => {}) {
  const update = async () => {
    if (!game.user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const current = target.read();
    validate();
    if (patch.undone && finalizedRecord(current, expected)) return;
    if (!equalState(current, expected)) throw undoConflict();
    if (target.journal) {
      const doc = historyStore();
      const next = recordsOf(doc).map((item) => (item.id === target.recordId ? { ...item, ...patch } : item));
      await doc.update({ [`flags.${MODULE_ID}.historyStore.records`]: next });
    } else {
      await game.messages
        .get(target.id)
        .update(Object.fromEntries(Object.entries(patch).map(([k, value]) => [`flags.${MODULE_ID}.history.${k}`, value])));
    }
  };
  // Only the short Journal read-modify-write owns this queue. It never waits for an Actor queue.
  return target.journal ? serialize("tsc-history-store", update) : update();
}
/** One bounded receipt per Actor: never replace proof while its trusted record still has an unfinished intent. */
function replaceableReceipt(receipt, shipUuid) {
  try {
    const parts = JSON.parse(receipt.key);
    if (!Array.isArray(parts)) return false;
    const target = undoTarget(
      parts[0] === "journal" && parts.length === 3 ? `j:${parts[2]}` : parts[0] === "message" && parts.length === 2 ? parts[1] : ""
    );
    if (!validIntent(receipt, target, shipUuid)) return false;
    const record = target.read();
    // Module retention never removes a pending intent. A missing record has no remaining recovery operation.
    return !record || (record.undone === true && record.undoable === false && equalState(record.undoIntent, receipt));
  } catch {
    return false;
  }
}
async function performUndo(messageId) {
  const target = undoTarget(messageId);
  let r = target.read();
  if (!r?.undoable || r.undone || !r.before || !r.after || !equalState(r.guard, combatGuard())) throw undoConflict();
  if (!reversible(r.before, r.after)) throw new Error(T("SF2eTSC.qol.undoUnsafe"));
  r = structuredClone(r);
  if (r.undoIntent && !validIntent(r.undoIntent, target, r.shipUuid)) throw undoConflict();
  const { loadStarship, readStarship, patchStarship } = await import("../starship/starship-state.mjs");
  const actor = await loadStarship(r.shipUuid);
  if (!r.undoIntent) {
    if (!equalState(snapshot(readStarship(actor)), r.after) || !equalState(r.guard, combatGuard())) throw undoConflict();
    const intent = { schema: 1, id: foundry.utils.randomID(16), key: target.key, shipUuid: actor.uuid };
    await updateUndoRecord(target, r, { undoIntent: intent });
    r = { ...r, undoIntent: intent };
  }
  const options = { history: false, expectedCombat: r.guard, extra: {} };
  await patchStarship(
    actor,
    (data) => {
      if (!equalState(target.read(), r)) throw undoConflict();
      const receipt = actor.flags?.[MODULE_ID]?.historyUndoReceipt;
      const recovered = equalState(receipt, r.undoIntent);
      const expected = recovered ? r.before : r.after;
      if (!equalState(snapshot(data), expected)) throw undoConflict();
      if (!recovered && receipt && !replaceableReceipt(receipt, actor.uuid)) throw undoConflict();
      // patchStarship reads these options after its mutator, within the Actor queue; performWrite rechecks both guards.
      options.expected = expected;
      if (!recovered) {
        Object.assign(data, structuredClone(r.before));
        options.extra = { [`flags.${MODULE_ID}.historyUndoReceipt`]: r.undoIntent };
      }
      // A matching receipt with actor-before is a guarded no-op; actor-before alone (including ABA) is never proof.
    },
    options
  );
  const validate = () => {
    if (
      !equalState(actor.flags?.[MODULE_ID]?.historyUndoReceipt, r.undoIntent) ||
      !equalState(snapshot(readStarship(actor)), r.before) ||
      !equalState(combatGuard(), r.guard)
    )
      throw undoConflict();
  };
  try {
    await updateUndoRecord(target, r, { undone: true, undoable: false }, validate);
  } catch (err) {
    // A lost finalization acknowledgment is already complete, not a reason to restore a second time.
    if (!finalizedRecord(target.read(), r)) throw err;
    validate();
  }
  return true;
}
const undoQueues = new Map();
export async function undoChange(messageId) {
  if (!game.user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const id = String(messageId);
  // Same-record requests share one operation independently of the Journal queue. Sequential completed Undo still conflicts.
  const existing = undoQueues.get(id);
  if (existing) return existing;
  const task = performUndo(id);
  undoQueues.set(id, task);
  try {
    return await task;
  } finally {
    if (undoQueues.get(id) === task) undoQueues.delete(id);
  }
}

export function registerHistoryHandlers() {
  registerHandler("undoHistory", async ({ user, payload }) => {
    if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    return undoChange(payload.messageId);
  });
}
