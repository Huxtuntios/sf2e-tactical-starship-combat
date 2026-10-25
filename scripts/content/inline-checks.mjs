/**
 * Turns plain statblock check text ("DC 32 Will save", "DC 18 Computers (trained) or Piloting (trained)",
 * "DC 5 flat check") into sf2e/pf2e inline check enrichers (@Check[will|dc:32]{…}) so they are clickable in
 * sheets, journals and chat. Pure (no Foundry globals); idempotent — text that already contains enrichers is skipped.
 */
import { linkInline, DAMAGE_TOKEN, CONDITION_TOKEN } from "./inline-links.mjs";
import { normalizeNativeChecks } from "./native-checks.mjs";
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
export function checkLinksHTML(text) {
  return linkInline(esc(text), { nativeChecks: false })
    .replace(
      /@Check\[([^\]]+)\](?:\{([^}]*)\})?/g,
      (m, params, label) =>
        `<a class="tsc-check" data-check="${params}" data-label="${label ?? ""}"><i class="fa-solid fa-dice-d20"></i> ${label ?? params}</a>`
    )
    .replace(
      new RegExp(DAMAGE_TOKEN.source, "g"),
      (m, params, label) =>
        `<a class="tsc-check tsc-damage" data-inline="@Damage[${params}]" data-label="${label ?? ""}"><i class="fa-solid fa-burst"></i> ${label ?? params}</a>`
    )
    .replace(
      new RegExp(CONDITION_TOKEN.source, "g"),
      (m, slug, value, label) =>
        `<a class="tsc-cond" data-condition="${slug}"${value ? ` data-value="${value}"` : ""}><i class="fa-solid fa-circle-info"></i> ${label ?? slug}</a>`
    );
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
