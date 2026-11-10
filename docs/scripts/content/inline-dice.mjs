/** Conservative, fixed-number dice only: no actor references, functions or executable text. */
export function safeDiceFormula(input) {
  const s = String(input ?? "")
    .replace(/\s+/g, "")
    .replace(/−/g, "-");
  const m = /^(\d{1,3})d(\d{1,4})(?:([+-])(\d{1,5}))?$/i.exec(s);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 100 || Number(m[2]) < 2 || Number(m[2]) > 1000) return null;
  return `${Number(m[1])}d${Number(m[2])}${m[3] ? m[3] + Number(m[4]) : ""}`;
}

/** Make specific non-damage rolls from source text interactive without interpreting arbitrary numbers as rolls. */
export function upgradeDicePresentation(entry, source, text) {
  if (entry?.custom) return text;
  let pattern;
  if (entry?.ref === "solar-generator-crystal" && source.startsWith("You manifest your solar shield around the hull"))
    pattern = /\b1d8(?=\s+(?:Shield Points|очков щитов))/i;
  if (entry?.ref === "telepod" && source.startsWith("Telepods can translocate up to three times"))
    pattern = /\b1d4(?=\s+(?:days|дня|дней))/i;
  return pattern ? String(text).replace(pattern, (dice) => `[[/r ${dice}]]{${dice}}`) : text;
}
