import { MODULE_ID, FLAGS, DATA_VERSION } from "../constants.mjs";
import { foldStationUpgrades } from "../engine/upgrades.mjs";
import { upgradeCatalog } from "../content/loader.mjs";
import { normalizeStarship } from "../engine/validation.mjs";
import { normalizeCrewAssignments } from "../engine/crew-assignments.mjs";
import { migrate, needsMigration } from "../engine/migration.mjs";
import { log } from "../utils/logging.mjs";

/** Only actors carrying the explicit marker are starships. Ordinary vehicles/NPCs are never touched. */
export function isStarship(actor) {
  return !!actor?.flags?.[MODULE_ID]?.[FLAGS.STARSHIP]?.isStarship;
}
/**
 * load an actor by UUID for a starship write. Rejects anything that is not a starship so ship/crew handlers can
 * never write starship data onto an ordinary PC, NPC or vehicle. `notFound`/`notStarship` are i18n keys.
 */
export async function loadStarship(uuid, { resolve = null } = {}) {
  let actor = null;
  if (typeof uuid === "string" && uuid) {
    const fn = resolve ?? globalThis.fromUuid;
    try {
      actor = await fn(uuid);
    } catch {
      actor = null;
    }
  }
  const t = (k) => globalThis.game?.i18n?.localize?.(k) ?? k;
  if (!actor) throw new Error(t("SF2eTSC.errors.shipNotFound"));
  if (!isStarship(actor)) throw new Error(t("SF2eTSC.errors.notStarship"));
  return actor;
}
export function isStarshipHazard(actor) {
  return !!actor?.flags?.[MODULE_ID]?.[FLAGS.HAZARD]?.isStarshipHazard;
}
export const isPlayerStarship = (actor) => isStarship(actor) && ["player"].includes(readStarship(actor).role);
/** Hull Points are owned by the system (system.attributes.hp) so tokens, bars and XP automation keep working. */
export function hullOf(actor) {
  const hp = actor?.system?.attributes?.hp;
  return { value: hp?.value ?? 0, max: hp?.max ?? 0 };
}

/** Read normalized starship data (HP overlaid from the system). Never throws; invalid data is repaired with defaults. */
export function readStarship(actor) {
  let raw = actor?.flags?.[MODULE_ID]?.[FLAGS.STARSHIP] ?? {};
  if (needsMigration(raw)) {
    try {
      raw = migrate(raw).data;
    } catch (err) {
      log.warn("migration failed in memory", err);
    }
  }
  raw = foldStationUpgrades(raw, upgradeCatalog()); // idempotent: one source of truth for installed upgrades (0.9.1)
  const { data, errors, warnings } = normalizeStarship({ ...raw, hp: hullOf(actor), name: actor?.name });
  if (errors.length) log.debug(`${actor?.name}: starship data errors`, errors);
  if (warnings.length) log.debug(`${actor?.name}: starship data warnings`, warnings);
  data._errors = errors;
  data._warnings = warnings;
  return data;
}

/** Strip derived keys before persisting. */
function persistable(data) {
  const { hp, _errors, _warnings, name, ...rest } = data;
  normalizeCrewAssignments(rest); // every write leaves helmedBy ↔ crew.stationId consistent
  return { ...rest, dataVersion: DATA_VERSION, isStarship: true };
}

const writeQueues = new Map();

/** Authoritative write (GM only). Mirrors Hull Points to the system. */
async function performWrite(
  actor,
  data,
  { hullPatch = null, extra = {}, history = true, reason = "", undoable = true, expected = null, expectedCombat = undefined } = {}
) {
  if (!game.user.isGM) throw new Error("writeStarship must be called by a GM client");
  const before = readStarship(actor);
  const audit = await import("../history/history.mjs");
  if (expected && !audit.equalState(audit.snapshot(before), expected)) throw new Error(game.i18n.localize("SF2eTSC.qol.undoConflict"));
  if (expectedCombat !== undefined && !audit.equalState(audit.combatGuard(), expectedCombat))
    throw new Error(game.i18n.localize("SF2eTSC.qol.undoConflict"));
  const updates = { [`flags.${MODULE_ID}.${FLAGS.STARSHIP}`]: persistable(data), ...extra };
  const hull = hullPatch ?? data.hp;
  if (hull) {
    if (Number.isInteger(hull.value)) updates["system.attributes.hp.value"] = hull.value;
    if (Number.isInteger(hull.max) && hull.max !== actor.system?.attributes?.hp?.max) updates["system.attributes.hp.max"] = hull.max;
  }
  const result = await actor.update(updates);
  if (history) {
    try {
      await audit.recordChange(actor, before, readStarship(actor), { reason, undoable });
    } catch (err) {
      log.error("history recording failed (state was saved)", err);
      ui.notifications?.warn?.(game.i18n.localize("SF2eTSC.qol.historyFailed"));
    }
  }
  return result;
}

export function writeStarship(actor, data, options = {}) {
  const previous = writeQueues.get(actor.uuid) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(() => performWrite(actor, data, options));
  writeQueues.set(actor.uuid, task);
  task
    .finally(() => {
      if (writeQueues.get(actor.uuid) === task) writeQueues.delete(actor.uuid);
    })
    .catch(() => {});
  return task;
}

/** Read-modify-write helper. `mutator(data)` edits a clone and may return a hull patch. */
export async function patchStarship(actor, mutator, options = {}) {
  const data = foundry.utils.deepClone(readStarship(actor));
  const result = await mutator(data);
  await writeStarship(actor, data, { hullPatch: data.hp, ...options });
  return result;
}

export function stationOf(data, stationId) {
  return data.stations.find((s) => s.id === stationId) ?? null;
}
export function activeCrew(data) {
  return data.crew.filter((c) => c.role !== "observer");
}

export function statusOf(data) {
  if (data.destroyed) return "destroyed";
  if (data.compromised > 0) return "compromised";
  if (data.inoperable) return "inoperable";
  if (data.wrecked > 0) return "wrecked";
  if (data.offKilter) return "off-kilter";
  return "operational";
}

/** All starship actors in the world (for browsers / pickers). */
export function allStarships() {
  return game.actors.filter((a) => isStarship(a));
}
