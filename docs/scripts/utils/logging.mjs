import { LOG_PREFIX, MODULE_ID } from "../constants.mjs";
const debugEnabled = () => {
  try {
    return !!game.settings.get(MODULE_ID, "debugLogging");
  } catch {
    return false;
  }
};
export const log = {
  debug: (...a) => {
    if (debugEnabled()) console.debug(LOG_PREFIX, ...a);
  },
  info: (...a) => console.info(LOG_PREFIX, ...a),
  warn: (...a) => console.warn(LOG_PREFIX, ...a),
  error: (...a) => console.error(LOG_PREFIX, ...a)
};
export function notifyWarn(key, data) {
  ui.notifications.warn(data ? game.i18n.format(key, data) : game.i18n.localize(key));
}
export function notifyError(key, data) {
  ui.notifications.error(data ? game.i18n.format(key, data) : game.i18n.localize(key));
}
export function notifyInfo(key, data) {
  ui.notifications.info(data ? game.i18n.format(key, data) : game.i18n.localize(key));
}
/** Run a feature safely: failures disable only that feature and never break the core system. */
export async function guarded(label, fn, fallback = null) {
  try {
    return await fn();
  } catch (err) {
    log.error(`${label} failed`, err);
    try {
      const i18n = globalThis.game?.i18n;
      ui.notifications.error(
        i18n?.has?.("SF2eTSC.errors.subsystemFailed")
          ? `${LOG_PREFIX} ${i18n.format("SF2eTSC.errors.subsystemFailed", { label, message: err.message })}`
          : `${LOG_PREFIX} ${label}: ${err.message}`
      );
    } catch {
      /* ignore */
    }
    return fallback;
  }
}
