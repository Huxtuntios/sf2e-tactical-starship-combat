import { MODULE_ID } from "../constants.mjs";
import { isActiveGM, T } from "../utils/foundry.mjs";

export function requirePrivateGM() {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.privateMap.activeGM"));
}

export function privateStoreFor(combatId) {
  if (typeof combatId !== "string" || !combatId || !game.user?.isGM) return null;
  if (!Array.isArray(game.journal?.contents)) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  const docs = game.journal.contents.filter((doc) => doc.flags?.[MODULE_ID]?.privateSensor?.combatId === combatId);
  if (docs.length > 1) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  const doc = docs[0];
  if (!doc) return null;
  const ownership = doc.ownership ?? {};
  const marker = doc.flags?.[MODULE_ID]?.privateSensor;
  const users = game.users?.contents;
  if (
    doc.folder ||
    ownership.default !== 0 ||
    marker?.schema !== 1 ||
    !Array.isArray(marker.contacts) ||
    (marker.completedReveals !== undefined && !Array.isArray(marker.completedReveals)) ||
    typeof doc.testUserPermission !== "function" ||
    !Array.isArray(users) ||
    users.some((user) => !user.isGM && doc.testUserPermission(user, "LIMITED")) ||
    Object.entries(ownership).some(([id, level]) => id !== "default" && Number(level) > 0 && !game.users.get(id)?.isGM)
  )
    throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  return doc;
}

export async function ensurePrivateStore(combatId) {
  const old = privateStoreFor(combatId);
  if (old) return old;
  requirePrivateGM();
  await JournalEntry.create({
    name: T("SF2eTSC.privateMap.storeName"),
    folder: null,
    ownership: { default: 0 },
    flags: { [MODULE_ID]: { privateSensor: { schema: 1, combatId, contacts: [] } } }
  });
  requirePrivateGM();
  const created = privateStoreFor(combatId);
  if (!created) throw new Error(T("SF2eTSC.privateMap.invalidStore"));
  return created;
}
