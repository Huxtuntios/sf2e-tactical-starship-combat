import { MODULE_ID, FLAGS } from "../constants.mjs";
import { normalizeSensorState } from "../engine/sensor-ops.mjs";
import { findCombatantFor } from "../engine/crew-initiative.mjs";
import { serialize } from "../utils/serial.mjs";

const view = (c) => ({
  id: c.id,
  actorId: c.actorId ?? null,
  actorUuid: c.actor?.uuid ?? null,
  tokenIsSynthetic: !!c.actor?.isToken,
  special: !!c.flags?.[MODULE_ID]?.compromisedEntry,
  doc: c
});

/** Combat-scoped tactical starship state (flags.<module>.tsc on the Combat document). Source of truth for the sensor map. */
export function getTsc(combat) {
  return normalizeSensorState(combat?.flags?.[MODULE_ID]?.[FLAGS.COMBAT]);
}
export const isStarshipCombat = (combat) => !!combat?.flags?.[MODULE_ID]?.[FLAGS.COMBAT]?.enabled;
export function activeStarshipCombat() {
  const c = game.combat;
  return isStarshipCombat(c) ? c : (game.combats?.find((x) => x.active && isStarshipCombat(x)) ?? null);
}

/** GM-only write. Replaces arrays wholesale (objects, log) and merges maps. */
async function performSave(combat, state, { expected } = {}) {
  if (!game.user.isGM) throw new Error("saveTsc must run on a GM client");
  if (expected !== undefined) {
    const { equalState } = await import("../history/history.mjs");
    if (!equalState(getTsc(combat), expected)) throw new Error(game.i18n.localize("SF2eTSC.qol.undoConflict"));
  }
  const existing = combat?.flags?.[MODULE_ID]?.[FLAGS.COMBAT];
  // Do not suppress the first initialization; compare normalized existing states only.
  if (existing && JSON.stringify(normalizeSensorState(existing)) === JSON.stringify(normalizeSensorState(state))) return combat;
  return combat.update({ [`flags.${MODULE_ID}.${FLAGS.COMBAT}`]: state });
}
export function saveTsc(combat, state, options = {}) {
  return serialize(`tsc:${combat.id}`, () => performSave(combat, state, options));
}
export function mutateTsc(combat, fn) {
  return serialize(`tsc:${combat.id}`, async () => {
    const next = await fn(foundry.utils.deepClone(getTsc(combat)));
    await performSave(combat, next);
    return next;
  });
}

/**
 * The Combatant whose turn belongs to an actor. Exact UUID first (token actors), then linked actor id.
 * The compromised-ship entry never stands in for the ship itself (0.4.0 fix).
 */
export function combatantForActor(combat, actor) {
  if (!combat || !actor) return null;
  const list = [...combat.combatants].map(view);
  return findCombatantFor(list, actor)?.doc ?? null;
}
export function currentCombatant(combat) {
  return combat?.combatant ?? null;
}
export function isActorsTurn(combat, actor) {
  const cur = currentCombatant(combat);
  if (!cur || cur.flags?.[MODULE_ID]?.compromisedEntry) return false;
  return !!findCombatantFor([view(cur)], actor);
}
export function turnIndexOf(combat, combatantId) {
  return combat.turns?.findIndex((t) => t.id === combatantId) ?? -1;
}
