import { moduleActive, T } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";

export const HOLODOCK_ID = "holodock";
export const holodockActive = () => moduleActive(HOLODOCK_ID);

function api() {
  return game.holodock ?? game.modules.get(HOLODOCK_ID)?.api ?? null;
}

/** HoloDock 1.0.1 exposes only open(); tactical ship data remains owned by this module. */
export function openHolodock() {
  const a = api();
  if (!a) return ui.notifications.warn(T("SF2eTSC.integrations.holodockMissing"));
  if (typeof a.open !== "function") {
    ui.notifications.info(T("SF2eTSC.integrations.holodockNoApi"));
    return;
  }
  try {
    return a.open();
  } catch (err) {
    log.warn("holodock.open failed", err);
  }
  ui.notifications.info(T("SF2eTSC.integrations.holodockNoApi"));
}
