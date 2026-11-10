/**
 * Turns plain statblock check text ("DC 32 Will save", "DC 18 Computers (trained) or Piloting (trained)",
 * "DC 5 flat check") into sf2e/pf2e inline check enrichers (@Check[will|dc:32]{…}) so they are clickable in
 * sheets, journals and chat. Pure (no Foundry globals); idempotent — text that already contains enrichers is skipped.
 */
import { linkInline, DAMAGE_TOKEN, CONDITION_TOKEN, TOKEN_RE, DAMAGE_TYPES } from "./inline-links.mjs";
import { normalizeNativeChecks } from "./native-checks.mjs";
import { safeDiceFormula } from "./inline-dice.mjs";
export const CHECK_SKILLS = [
  "Acrobatics",
  "Arcana",
  "Athletics",
  "Computers",
  "Crafting",
  "Deception",
  "Diplomacy",
  "Intimidation",
  "Medicine",
  "Nature",
  "Occultism",
  "Performance",
  "Piloting",
  "Religion",
  "Society",
  "Stealth",
  "Survival",
  "Thievery",
  "Perception"
];
const SAVE = "(Fortitude|Reflex|Will)";
const SKILL = `(?:${CHECK_SKILLS.join("|")})`;
const RANK = "(?: \\((?:untrained|trained|expert|master|legendary)\\))?";
const SKILL_LIST = `${SKILL}${RANK}(?:(?:,| or| and|, or|, and) ${SKILL}${RANK})*`;

const SAVE_RE = new RegExp(`DC (\\d+) (basic )?${SAVE}( save)?`, "g");
const SKILL_RE = new RegExp(`DC (\\d+) (${SKILL_LIST})( checks?)?`, "g");
const SKILL_AFTER_RE = new RegExp(`\\b(${SKILL})${RANK.replace("(?:", "(")} \\(DC (\\d+)\\)`, "g");
const FLAT_RE = /DC (\d+) flat check/g;

export function linkChecks(html) {
  let s = String(html ?? "");
  if (!s || s.includes("@Check[")) return s;
  s = s.replace(
    SAVE_RE,
    (m, dc, basic, save, word) =>
      `@Check[${save.toLowerCase()}|dc:${dc}${basic ? "|basic" : ""}]{DC ${dc} ${basic ?? ""}${save}${word ?? ""}}`
  );
  s = s.replace(FLAT_RE, (m, dc) => `@Check[flat|dc:${dc}]{DC ${dc} flat check}`);
  // Explicit numeric Russian DCs only; contextual or missing DCs stay text until resolved separately.
  s = s.replace(/КС\s+(\d+)\s+(прост\p{L}*\s+)?спасброс\p{L}*\s+(Стойкости|Рефлекса|Воли)/giu, (m, dc, basic, save) => {
    const slug = { стойкости: "fortitude", рефлекса: "reflex", воли: "will" }[save.toLowerCase()];
    return `@Check[${slug}|dc:${dc}${basic ? "|basic" : ""}]{${m}}`;
  });
  s = s.replace(/КС\s+(\d+)\s+плоск\p{L}*\s+проверк\p{L}*/giu, (m, dc) => `@Check[flat|dc:${dc}]{${m}}`);
  s = s.replace(/КС\s+(\d+)\s+проверк\p{L}*\s+(Ремесла|Пилотирования|Компьютеров)/giu, (m, dc, skill) => {
    const slug = { ремесла: "crafting", пилотирования: "piloting", компьютеров: "computers" }[skill.toLowerCase()];
    return `@Check[${slug}|dc:${dc}]{${m}}`;
  });
  s = s.replace(SKILL_RE, (m, dc, list, word) => {
    let first = true;
    const linked = list.replace(new RegExp(SKILL, "g"), (sk) => {
      const label = first ? `DC ${dc} ${sk}` : sk;
      first = false;
      return `@Check[${sk.toLowerCase()}|dc:${dc}]{${label}}`;
    });
    return linked + (word ?? "");
  });
  // "Computers (trained) (DC 18)" style
  s = s.replace(SKILL_AFTER_RE, (m, sk, rank, dc) => `@Check[${sk.toLowerCase()}|dc:${dc}]{${sk}${rank ?? ""} (DC ${dc})}`);
  return s;
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
/**
 * Render plain text for the module's own windows: escaped, with every check turned into a clickable
 * <a class="tsc-check"> (the click posts the @Check enricher to chat, where sf2e makes it rollable).
 */
/** Only literal, bounded dice and a known type are sent to the native damage roller. */
export function safeInlineDamage(inline) {
  const m = /^@Damage\[(\(?\d+d\d+(?:[+-]\d+)?\)?)\[((?:persistent,)?)([a-z-]+)\]\]$/i.exec(String(inline ?? ""));
  if (!m || !DAMAGE_TYPES.includes(m[3].toLowerCase())) return null;
  const dice = safeDiceFormula(m[1].replace(/^\(|\)$/g, ""));
  if (!dice) return null;
  return `@Damage[${/[+-]/.test(dice) ? `(${dice})` : dice}[${m[2].toLowerCase()}${m[3].toLowerCase()}]]`;
}
export function checkLinksHTML(text, options = {}) {
  const linked = linkInline(esc(text), { ...options, nativeChecks: false });
  return linked
    .split(TOKEN_RE)
    .map((part, i) => {
      if (!(i % 2)) return part;
      let m = /^@Check\[([^\]]+)\](?:\{([^}]*)\})?$/.exec(part);
      if (m)
        return `<span class="tsc-native-enricher" data-tsc-native="${part}"><a role="button" tabindex="0" class="tsc-check" data-check="${m[1]}" data-label="${m[2] ?? ""}"><i class="fa-solid fa-dice-d20"></i> ${m[2] ?? m[1]}</a></span>`;
      m = new RegExp(`^${DAMAGE_TOKEN.source}$`).exec(part);
      if (m) {
        const safe = safeInlineDamage(`@Damage[${m[1]}]`);
        return safe
          ? `<a role="button" tabindex="0" class="tsc-check tsc-damage" data-inline="${safe}" data-label="${m[2] ?? ""}"><i class="fa-solid fa-burst"></i> ${m[2] ?? m[1]}</a>`
          : part;
      }
      m = new RegExp(`^${CONDITION_TOKEN.source}$`).exec(part);
      if (m)
        return `<a role="button" tabindex="0" class="tsc-cond" data-condition="${m[1]}"${m[2] ? ` data-value="${m[2]}"` : ""}><i class="fa-solid fa-circle-info"></i> ${m[3] ?? m[1]}</a>`;
      m = /^\[\[\/r\s+([^\]]+)\]\](?:\{([^}]*)\})?$/i.exec(part);
      if (m) {
        const dice = safeDiceFormula(m[1]);
        return dice
          ? `<a role="button" tabindex="0" class="tsc-check tsc-dice" data-dice="${dice}" data-label="${m[2] ?? dice}"><i class="fa-solid fa-dice"></i> ${m[2] ?? dice}</a>`
          : part;
      }
      if (/^@(?:UUID|Template|Localize|act)\[/.test(part))
        return `<span class="tsc-native-enricher" data-tsc-native="${part}">${part}</span>`;
      return part;
    })
    .join("");
}

/**
 * `dataset.*` values are HTML-decoded by the browser, so everything taken from a clicked link is escaped
 * again before it is put into chat HTML. Enricher delimiters are stripped from labels so a label cannot close the
 * `{…}` block early, and from check params so they cannot close `[…]`.
 */
const enricherLabel = (s) => esc(String(s ?? "").replace(/[{}]/g, ""));
const enricherParams = (s) => esc(String(s ?? "").replace(/[[\]{}]/g, ""));
/** Chat content for a clicked module check link. */
export function checkChatContent(params, label, sourceName = "") {
  const head = sourceName ? `<p><strong>${esc(sourceName)}</strong></p>` : "";
  const l = enricherLabel(label);
  return normalizeNativeChecks(`${head}<p>@Check[${enricherParams(params)}]${l ? `{${l}}` : ""}</p>`);
}
/** Chat content for a clicked inline damage link (data-inline="@Damage[…]"). Anything else is refused. */
export function inlineChatContent(inline, label, sourceName = "") {
  const s = String(inline ?? "");
  if (!new RegExp(`^${DAMAGE_TOKEN.source}$`).test(s)) return null;
  const head = sourceName ? `<p><strong>${esc(sourceName)}</strong></p>` : "";
  const l = enricherLabel(label);
  return `${head}<p>${esc(s)}${l ? `{${l}}` : ""}</p>`;
}
