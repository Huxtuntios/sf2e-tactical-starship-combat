import { GREEK, NAVAL } from "../constants.mjs";

/**
 * Contact designations are stored language-neutral in the sensor state ("Contact Alpha", "Contact 03",
 * "Contact Bravo 2"); every client translates them at display time.
 */
const has = (k) => !!globalThis.game?.i18n?.has?.(k);
const loc = (k) => globalThis.game?.i18n?.localize?.(k) ?? k;
export function displayDesignation(label) {
  const s = String(label ?? "");
  const m = /^Contact(?:\s+(.+))?$/.exec(s);
  if (!m) return s;
  const prefix = has("SF2eTSC.detection.contact") ? loc("SF2eTSC.detection.contact") : "Contact";
  if (!m[1]) return prefix;
  const [word, ...rest] = m[1].split(/\s+/);
  let w = word;
  if (GREEK.includes(word) && has(`SF2eTSC.greek.${word}`)) w = loc(`SF2eTSC.greek.${word}`);
  else if (NAVAL.includes(word) && has(`SF2eTSC.naval.${word}`)) w = loc(`SF2eTSC.naval.${word}`);
  return [prefix, w, ...rest].join(" ");
}
