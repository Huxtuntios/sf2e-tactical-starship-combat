/**
 * plain statblock text -> sf2e inline enrichers, EN + RU.
 *  - checks:     "DC 32 Will save"            -> @Check[...] (inline-checks.mjs)
 *  - damage:     "2d8+7 fire damage", "1d10 урона огнём", "2d6 колющего урона", "1d6 persistent acid"
 *                                              -> @Damage[(2d8+7)[fire]]{2d8+7 fire damage}
 *  - conditions: "frightened 2", "off-guard", "напугано 2", "застигнут врасплох"
 *                                              -> @TscCondition[frightened|value:2]{frightened 2}
 *    (@TscCondition is resolved at render time to the system's condition item, see condition-enricher.mjs).
 * Pure (no Foundry globals) and idempotent. Existing damage/condition enrichers and HTML tags are preserved;
 * check labels and their redundant outer parentheses are normalized for native SF2e rendering.
 */
import { linkChecks } from "./inline-checks.mjs";
import { normalizeNativeChecks } from "./native-checks.mjs";

export const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "electricity",
  "fire",
  "force",
  "mental",
  "piercing",
  "poison",
  "slashing",
  "sonic",
  "spirit",
  "vitality",
  "void",
  "bleed",
  "untyped"
];
const RU_INSTR = {
  огнём: "fire",
  огнем: "fire",
  огня: "fire",
  кислотой: "acid",
  холодом: "cold",
  электричеством: "electricity",
  "силовым полем": "force",
  силой: "force",
  звуком: "sonic",
  ядом: "poison",
  пустотой: "void",
  "жизненной энергией": "vitality",
  духом: "spirit"
};
const RU_ADJ = {
  дробящ: "bludgeoning",
  колющ: "piercing",
  рубящ: "slashing",
  ментальн: "mental",
  духовн: "spirit",
  кислотн: "acid",
  огненн: "fire",
  электрическ: "electricity",
  звуков: "sonic",
  ядовит: "poison",
  силов: "force",
  холодн: "cold",
  пустотн: "void",
  жизненн: "vitality",
  кровоточащ: "bleed"
};
const ADJ_END = "(?:его|ий|ый|ой|ая|ое|ие|ые|ым|им|ого)";

const NL = "(?![\\p{L}\\p{N}])"; // unicode-aware word end
const DICE = "(\\d+d\\d+(?:\\s*[+\\-\u2212]\\s*\\d+)?)";
const alt = (o) =>
  Object.keys(o)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/ /g, "\\s+"))
    .join("|");

const EN_DMG = new RegExp(`(?<![\\p{L}\\p{N}])${DICE}\\s+(persistent\\s+)?(${DAMAGE_TYPES.join("|")})(\\s+damage)?${NL}`, "giu");
const RU_DMG_INSTR = new RegExp(
  `(?<![\\p{L}\\p{N}])${DICE}\\s+(?:(продолжительн\\p{L}*)\\s+)?(?:урона\\s+)?(${alt(RU_INSTR)})${NL}`,
  "giu"
);
const RU_DMG_ADJ = new RegExp(
  `(?<![\\p{L}\\p{N}])${DICE}\\s+(?:(продолжительн\\p{L}*)\\s+)?(${Object.keys(RU_ADJ).join("|")})${ADJ_END}(\\s+урона)?${NL}`,
  "giu"
);

const formula = (dice, type, persistent) => {
  const d = dice.replace(/\u2212/g, "-").replace(/\s+/g, "");
  const f = /[+-]/.test(d) ? `(${d})` : d;
  return `@Damage[${f}[${persistent ? "persistent," : ""}${type}]]`;
};
const labelOf = (m) => m.replace(/[{}]/g, "");

/** Damage only, on a plain text segment. */
function damageSegment(s) {
  s = s.replace(EN_DMG, (m, dice, pers, type) => `${formula(dice, type.toLowerCase(), !!pers)}{${labelOf(m)}}`);
  s = s.replace(RU_DMG_INSTR, (m, dice, pers, w) => {
    const type = RU_INSTR[w.toLowerCase().replace(/\s+/g, " ")];
    return type ? `${formula(dice, type, !!pers)}{${labelOf(m)}}` : m;
  });
  s = s.replace(RU_DMG_ADJ, (m, dice, pers, stem) => `${formula(dice, RU_ADJ[stem.toLowerCase()], !!pers)}{${labelOf(m)}}`);
  return s;
}

/* ------------------------------------------------------------------ conditions */
export const VALUED_CONDITIONS = new Set([
  "clumsy",
  "doomed",
  "drained",
  "dying",
  "enfeebled",
  "frightened",
  "sickened",
  "slowed",
  "stunned",
  "stupefied",
  "wounded",
  "glitching"
]);
/** [slug, EN words, needs a cue ("becomes …", a value or "… condition")]. */
const EN_CONDITIONS = [
  ["off-guard", "off-guard|flat-footed", false],
  ["frightened", "frightened", false],
  ["dazzled", "dazzled", false],
  ["sickened", "sickened", false],
  ["stupefied", "stupefied", false],
  ["paralyzed", "paralyzed", false],
  ["stunned", "stunned", false],
  ["clumsy", "clumsy", false],
  ["enfeebled", "enfeebled", false],
  ["fatigued", "fatigued", false],
  ["immobilized", "immobilized", false],
  ["blinded", "blinded", false],
  ["deafened", "deafened", false],
  ["glitching", "glitching", false],
  ["untethered", "untethered", false],
  ["quickened", "quickened", false],
  ["petrified", "petrified", false],
  ["restrained", "restrained", false],
  ["grabbed", "grabbed", false],
  ["unconscious", "unconscious", false],
  ["doomed", "doomed", false],
  ["fascinated", "fascinated", false],
  ["slowed", "slowed", true],
  ["drained", "drained", true],
  ["hidden", "hidden", true],
  ["concealed", "concealed", true],
  ["invisible", "invisible", true],
  ["undetected", "undetected", true],
  ["prone", "prone", true],
  ["broken", "broken", true],
  ["controlled", "controlled", true],
  ["confused", "confused", true],
  ["fleeing", "fleeing", true],
  ["wounded", "wounded", true],
  ["dying", "dying", true]
];
const EN_CUE = "(?:becomes?|is|are|be|being|remains?|left|knocked|falls?|considered|turns?|gains?\\s+the)\\s+(?:also\\s+)?";
/** [slug, RU stem regex, needs a value]. */
const RU_CONDITIONS = [
  ["off-guard", "(?:застигнут\\p{L}*\\s+|застан\\p{L}*\\s+)?врасплох", false],
  ["frightened", "напуган\\p{L}*", false],
  ["dazzled", "ослепл[её]н\\p{L}*", false],
  ["clumsy", "неуклюж\\p{L}*", false],
  ["stunned", "ошеломл[её]н\\p{L}*", false],
  ["stupefied", "одурманен\\p{L}*", false],
  ["slowed", "замедлен(?:а|о|ы|ный|ным|ными|ной|ная|ное|ные)?", true],
  ["quickened", "ускорен(?:а|о|ы|ный|ным|ными|ной|ная|ное|ные)?", false],
  ["immobilized", "обездвижен\\p{L}*", false],
  ["invisible", "невидим(?:ый|ым|ыми|ы|а|о|ая|ое|ые|ой|ого|ую)?", false],
  ["sickened", "тошнот\\p{L}*", true],
  ["drained", "истощ\\p{L}*", true],
  ["enfeebled", "ослаблен\\p{L}*", true],
  ["glitching", "сбо(?:й|я|е|ю|и)", true],
  ["fatigued", "утомл[её]н\\p{L}*", false],
  ["paralyzed", "парализован\\p{L}*", false],
  ["controlled", "подконтрольн\\p{L}*", false],
  ["fascinated", "очарован\\p{L}*", false],
  ["prone", "сбит\\p{L}*\\s+с\\s+ног", false],
  ["unconscious", "без\\s+сознания", false]
];
const VAL = "(?:\\s+(\\d+))?";
const EN_COND_RE = EN_CONDITIONS.map(([slug, words, cue]) => [
  slug,
  cue,
  new RegExp(`(?<![\\p{L}\\p{N}-])(${EN_CUE})?(${words})${VAL}(\\s+condition)?${NL}`, "giu")
]);
const RU_COND_RE = RU_CONDITIONS.map(([slug, stem, needValue]) => [
  slug,
  needValue,
  new RegExp(`(?<![\\p{L}\\p{N}])(${stem})${VAL}${NL}`, "giu")
]);
const condToken = (slug, value, label) =>
  `@TscCondition[${slug}${value && VALUED_CONDITIONS.has(slug) ? `|value:${value}` : ""}]{${labelOf(label)}}`;

/** Conditions only, on a plain text segment (already split around enrichers by linkInline). */
function conditionSegment(s) {
  for (const [slug, cue, re] of EN_COND_RE) {
    s = splitApply(s, (t) =>
      t.replace(re, (m, pre, word, value, cond) => {
        if (cue && !pre && !value && !cond) return m;
        const v = value && VALUED_CONDITIONS.has(slug) ? value : undefined;
        const sp = (x) => (x ? (m.match(new RegExp(`\\s+${x}`))?.[0] ?? ` ${x}`) : "");
        return `${pre ?? ""}${condToken(slug, v, word + (v ? sp(v) : ""))}${v ? "" : sp(value)}${cond ?? ""}`;
      })
    );
  }
  for (const [slug, needValue, re] of RU_COND_RE) {
    s = splitApply(s, (t) =>
      t.replace(re, (m, word, value) => {
        if (needValue && !value) return m;
        const v = value && VALUED_CONDITIONS.has(slug) ? value : undefined;
        return v ? condToken(slug, v, m) : condToken(slug, undefined, word) + m.slice(word.length);
      })
    );
  }
  return s;
}

/** Enrichers (one bracket level, as in @Damage[(2d6)[fire]]) and HTML tags are protected. */
export const TOKEN_RE = /(@\w+\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|<[^>]*>)/g;
function splitApply(s, fn) {
  return String(s)
    .split(TOKEN_RE)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

/** Damage + condition links only (no checks). */
export function linkDamageAndConditions(html) {
  const s = String(html ?? "");
  if (!s) return s;
  return conditionSegment(splitApply(s, damageSegment));
}

/** Full pipeline; module-only anchors opt out of native DC-label normalization. Idempotent. */
export function linkInline(html, { nativeChecks = true } = {}) {
  let s = String(html ?? "");
  if (!s) return s;
  if (!s.includes("@Check[")) s = linkChecks(s);
  s = linkDamageAndConditions(s);
  return nativeChecks ? normalizeNativeChecks(s) : s;
}

export const DAMAGE_TOKEN = /@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/g;
export const CONDITION_TOKEN = /@TscCondition\[([a-z-]+)(?:\|value:(\d+))?\](?:\{([^}]*)\})?/g;
