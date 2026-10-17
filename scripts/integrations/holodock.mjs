import { moduleActive, T } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";

export const HOLODOCK_ID = "holodock";
export const holodockActive = () => moduleActive(HOLODOCK_ID);

function api() {
  return game.holodock ?? game.modules.get(HOLODOCK_ID)?.api ?? null;
}

/**
 * Open the HoloDock profile of a ship when the (optional) module exposes a way to do it.
 * Combat-critical fields (hp, sp, ac, speed, compromised, stations...) stay owned by this module: nothing is ever
 * written from HoloDock data, the bridge is one-way and read-only.
 */
export function openHolodock(actor) {
  const a = api();
  if (!a) return ui.notifications.warn(T("SF2eTSC.integrations.holodockMissing"));
  for (const fn of ["openDashboard", "open", "openProfile", "openShip"]) {
    if (typeof a[fn] === "function") {
      try {
        return a[fn](actor);
      } catch (err) {
        log.warn(`holodock.${fn} failed`, err);
      }
    }
  }
  ui.notifications.info(T("SF2eTSC.integrations.holodockNoApi"));
}
