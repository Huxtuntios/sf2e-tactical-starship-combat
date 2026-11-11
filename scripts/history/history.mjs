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
export const equalState = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function changedFields(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !equalState(before[k], after[k]));
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
    await doc.update({ [`flags.${MODULE_ID}.historyStore.records`]: [...recordsOf(doc), record].slice(-80) });
    const mode = game.settings.get(MODULE_ID, "chatAnnouncements") ?? "important";
    const important = fields.some((field) => ["destroyed", "inoperable", "compromised", "wrecked"].includes(field));
    if (announce && (mode === "all" || (mode === "important" && important))) {
      const text = T("SF2eTSC.qol.changeAnnouncement", { name: actor.name });
      await ChatMessage.create({ content: `<p>${foundry.utils.escapeHTML(text)}</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
    }
    return journalEntry(doc, record.id);
  });
}

export async function undoChange(messageId) {
  if (!game.user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const journal = String(messageId).startsWith("j:") ? historyStore() : null;
  const recordId = journal ? String(messageId).slice(2) : null;
  const message = recordId ? journalEntry(journal, recordId) : game.messages.get(messageId);
  const r = message?.flags?.[MODULE_ID]?.history;
  if ((!journal && !trustedRecord(message)) || !r?.undoable || r.undone || !r.before || !r.after || !equalState(r.guard, combatGuard()))
    throw new Error(T("SF2eTSC.qol.undoConflict"));
  if (!reversible(r.before, r.after)) throw new Error(T("SF2eTSC.qol.undoUnsafe"));
  const { loadStarship, readStarship, writeStarship } = await import("../starship/starship-state.mjs");
  const actor = await loadStarship(r.shipUuid);
  if (!equalState(snapshot(readStarship(actor)), r.after)) throw new Error(T("SF2eTSC.qol.undoConflict"));
  // Не удерживаем очередь истории при ожидании очереди Actor: так исключается взаимная блокировка.
  await writeStarship(actor, r.before, { history: false, expected: r.after, expectedCombat: r.guard });
  if (journal) {
    await serialize("tsc-history-store", async () => {
      const current = historyStore();
      if (current?.id !== journal.id) throw new Error(T("SF2eTSC.qol.historyStoreInvalid"));
      const records = recordsOf(current).map((item) => (item.id === recordId ? { ...item, undone: true, undoable: false } : item));
      await current.update({ [`flags.${MODULE_ID}.historyStore.records`]: records });
    });
  } else {
    await message.update({ [`flags.${MODULE_ID}.history.undone`]: true, [`flags.${MODULE_ID}.history.undoable`]: false });
  }
  return true;
}

export function registerHistoryHandlers() {
  registerHandler("undoHistory", async ({ user, payload }) => {
    if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    return undoChange(payload.messageId);
  });
}
