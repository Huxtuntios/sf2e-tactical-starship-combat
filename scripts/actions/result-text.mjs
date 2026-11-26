import { DEGREE_KEYS } from "../constants.mjs";

const text = (value) => String(value ?? "").trim();
const identity = (value) => value;
const keyOnly = (key) => key;
const OUTCOME_ORDER = Object.freeze(["criticalSuccess", "success", "failure", "criticalFailure"]);
const OUTCOME_TYPES = new Set(["manual", "text"]);

export function actionOutcomeSections(outcomes, { translate = identity } = {}) {
  if (!outcomes || typeof outcomes !== "object") return [];
  return OUTCOME_ORDER.flatMap((key) => {
    const entries = Array.isArray(outcomes[key]) ? outcomes[key] : [];
    const texts = entries
      .filter((entry) => entry && OUTCOME_TYPES.has(entry.type))
      .map((entry) => text(translate(entry.text)))
      .filter(Boolean);
    return texts.length ? [{ key, degree: DEGREE_KEYS.indexOf(key), texts }] : [];
  });
}

export function isCompletedActionResult(result) {
  return !!result && result.ok === true && !result.cancelled && !result.dryRun;
}

export function formatActionResultText(result, { localize = keyOnly, translate = identity } = {}) {
  if (!result || result.ok === false || result.cancelled || result.dryRun) return "";
  const data = result.summary && typeof result.summary === "object" ? { ...result, ...result.summary } : result;
  const degreeKey = Number.isInteger(data.degree) ? DEGREE_KEYS[data.degree] : null;
  const degree = text(data.degreeLabel) || (degreeKey ? text(localize(`SF2eTSC.degree.${degreeKey}`)) : "");
  const lines = (Array.isArray(data.lines) ? data.lines : [])
    .filter((line) => line && text(line.label) && line.value != null)
    .map((line) => `${text(line.label)}: ${text(line.value)}`);
  const reports = (Array.isArray(data.reports) ? data.reports : []).map(text).filter(Boolean);
  const manual = (Array.isArray(data.manual) ? data.manual : []).map(text).filter(Boolean);
  const sections = [];
  const outcome = [...(degree ? [`${text(localize("SF2eTSC.chat.result"))}: ${degree}`] : []), ...lines];
  if (outcome.length) sections.push(outcome.join("\n"));
  if (degreeKey) {
    const legend = actionOutcomeSections(data.outcomes, { translate }).map(
      (entry) => `${text(localize(`SF2eTSC.degree.${entry.key}`))}: ${entry.texts.join(" ")}`
    );
    if (legend.length) sections.push(legend.join("\n"));
  }
  if (reports.length) sections.push([`${text(localize("SF2eTSC.attackCard.consequences"))}:`, ...reports].join("\n"));
  if (manual.length) sections.push([`${text(localize("SF2eTSC.chat.manualResolve"))}`, ...manual].join("\n"));
  return sections.join("\n\n");
}

export function formatActionDescription(action, result, { localize = keyOnly, translate = identity } = {}) {
  return {
    sourceText: String(translate(action?.text ?? "")),
    resultText: isCompletedActionResult(result) ? formatActionResultText(result, { localize, translate }) : ""
  };
}
