import { moduleActive, moduleSetting, T } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";

export const CAUSODES_IDS = ["causodes-shipcombat-sf2e", "causodes-shipcombat-core"];

/**
 * Causodes Ship Combat registers its own actor sub-types (ship / npcShip) and its own combat model (simultaneous crew turn).
 * Our starships are marked only through flags.<module>.starship on vehicle/npc actors, so the data never overlaps;
 * the only risk is a GM running two ship engines in one encounter. We warn instead of intercepting anything.
 */
export function isCausodesActor(actor) {
  return String(actor?.type ?? "").startsWith("causodes-shipcombat");
}

export function checkCausodesConflict() {
  const active = CAUSODES_IDS.filter(moduleActive);
  if (!active.length) return false;
  log.warn("Causodes Ship Combat is active alongside this module", active);
  if (game.user.isGM && moduleSetting("causodesConflict") === "warn") {
    ui.notifications.warn(T("SF2eTSC.integrations.causodesWarning"), { permanent: true });
  }
  return true;
}
/** Never treat a Causodes ship as a tactical starship, and vice versa. */
export function canConvert(actor) {
  return !isCausodesActor(actor);
}
