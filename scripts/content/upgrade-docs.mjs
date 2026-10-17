/**
 * pure builders (no Foundry globals) for starship upgrades: the rules text shown in the "Starship Upgrades"
 * compendium items AND in the expandable details of the sheets' "Installed Upgrades" sections (one renderer, so the
 * two can never drift apart). All wording comes from the caller:
 *   tr(text)        content translation of an English catalog string (ct() at runtime, the RU dictionary in the build)
 *   L(key, data)    UI label SF2eTSC.upgrades.<key> (game.i18n at runtime, lang/<lang>.json in the build)
 *   render(text)    translated plain text → HTML (enrichers for compendium items, clickable links in module windows)
 * Upgrade effects are never automated; the text is reference only.
 */
import { MODULE_ID, STARSHIP_TAG } from "../constants.mjs";
import { schemaStamp } from "./action-docs.mjs";
import { linkInline } from "./inline-links.mjs";

export const UPGRADE_ITEM_FLAG = "upgrade";
export const UPGRADE_IMG = "icons/svg/upgrade.svg";
/** sf2e trait keys an upgrade item may carry (the AoN "Starship" trait has no system trait; it stays in the flag). */
export const SYSTEM_UPGRADE_TRAITS = new Set(["starship", "tech", "magical", "primal", "arcane", "divine", "occult", "analog"]);
const GLYPH = { 1: "1", 2: "2", 3: "3", free: "F", reaction: "R" };

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const id = (x) => x;
const defaults = { tr: id, L: (k) => k, render: (s) => linkInline(esc(s)), traitLabel: id, stationLabel: id, classLabel: id };

export const actionGlyph = (cost) => (GLYPH[cost] ? `<span class="action-glyph">${GLYPH[cost]}</span>` : "");

function activationHTML(a, o) {
  const traits = (a.traits ?? []).map(o.traitLabel).join(", ");
  const parts = [
    `<strong>${esc(o.L("activate"))}</strong> ${actionGlyph(a.cost)}${traits ? ` (${esc(traits)})` : ""} ${esc(o.tr(a.name))}`
  ];
  for (const k of ["frequency", "trigger", "requirements", "effect"])
    if (a[k]) parts.push(`<strong>${esc(o.L(k))}</strong> ${o.render(o.tr(a[k]))}`);
  const details = (a.details ?? [])
    .map((d) => (typeof d === "string" ? { label: "", text: d } : d))
    .map((d) => `<p class="tsc-upgrade-detail">${d.label ? `<strong>${esc(o.tr(d.label))}</strong> ` : ""}${o.render(o.tr(d.text))}</p>`)
    .join("");
  return `<p class="tsc-upgrade-activation">${parts.join("; ")}</p>${details}`;
}
const paragraphs = (list, o) => (list ?? []).map((t) => `<p>${o.render(o.tr(t))}</p>`).join("");

/** Statistic line shown above the rules: usage, station, item level, traits, source. */
export function upgradeMeta(entry, opts = {}) {
  const o = { ...defaults, ...opts };
  const rows = [
    ["usage", esc(o.tr(entry.usage))],
    ["station", esc(entry.slot === "escape-pods" ? o.L("escapePods") : o.stationLabel(entry.station))],
    ["level", esc(entry.level)],
    entry.traits?.length && [
      "traits",
      esc(
        [...entry.traits.map(o.traitLabel), entry.rarity && entry.rarity !== "common" ? o.traitLabel(entry.rarity) : null]
          .filter(Boolean)
          .join(", ")
      )
    ],
    // some upgrades only make sense for one class (mechanic, mystic, solarian...): the requirement is part of the description
    entry.classes?.length && ["requirements", esc(entry.classes.map(o.classLabel).join(" / "))],
    [
      "source",
      esc(o.L("sourceLine", { book: entry.source?.book ?? "Starfinder Tech Core", page: entry.page ?? entry.source?.page ?? "—" }))
    ]
  ].filter(Boolean);
  return rows.map(([k, v]) => ({ key: k, label: o.L(k), value: v }));
}

/**
 * Full rules HTML of one installable entry (base text + the chosen variant). `price:true` adds the localized
 * "the GM determines the price" note (compendium items); `meta:false` omits the statistic line.
 */
export function upgradeDescriptionHTML(entry, opts = {}) {
  const o = { ...defaults, ...opts };
  const out = [];
  if (o.meta !== false)
    out.push(
      `<p class="tsc-upgrade-meta">${upgradeMeta(entry, o)
        .map((r) => `<strong>${esc(r.label)}</strong> ${r.value}`)
        .join("; ")}</p>`
    );
  if (o.price) out.push(`<p class="tsc-upgrade-price"><strong>${esc(o.L("price"))}</strong> ${esc(o.L("priceNote"))}</p>`);
  out.push("<hr>", paragraphs(entry.text, o), ...(entry.activations ?? []).map((a) => activationHTML(a, o)));
  if (entry.variant) {
    out.push(
      `<h3 class="tsc-upgrade-variant">${esc(o.tr(entry.name))}</h3>`,
      paragraphs(entry.variantText, o),
      ...(entry.variantActivations ?? []).map((a) => activationHTML(a, o))
    );
  }
  if (entry.reviewNote)
    out.push(`<p class="tsc-upgrade-review"><em><strong>${esc(o.L("reviewNote"))}</strong> ${esc(o.tr(entry.reviewNote))}</em></p>`);
  out.push(`<p class="tsc-upgrade-noauto"><em>${esc(o.L("noAutomation"))}</em></p>`);
  return out.join("");
}

export const upgradeSlug = (entry, lang = "en") =>
  `tsc-upgrade-${entry.ref}${entry.variant ? `-${entry.variant}` : ""}${lang === "en" ? "" : `-${lang}`}`;

/** Native sf2e "equipment" item for the compendium (price 0 as a placeholder; editable after import). */
export function buildUpgradeItemData(entry, opts = {}) {
  const o = { ...defaults, lang: "en", ...opts };
  return {
    name: o.tr(entry.name),
    type: "equipment",
    img: UPGRADE_IMG,
    system: {
      baseItem: null,
      bulk: { value: 0 },
      containerId: null,
      description: { value: upgradeDescriptionHTML(entry, { ...o, price: true }), gm: "" },
      hardness: 0,
      hp: { max: 0, value: 0 },
      level: { value: Number(entry.level) || 0 },
      material: { grade: null, type: null },
      price: { value: { sp: 0 } },
      publication: { title: entry.source?.book ?? "Starfinder Tech Core", authors: "", license: "ORC", remaster: true },
      quantity: 1,
      rules: [],
      size: "med",
      slug: upgradeSlug(entry, o.lang),
      traits: {
        value: [...new Set([STARSHIP_TAG, ...(entry.traits ?? []).filter((t) => SYSTEM_UPGRADE_TRAITS.has(t))])],
        rarity: entry.rarity ?? "common",
        otherTags: [STARSHIP_TAG]
      },
      usage: { value: entry.usageKey ?? "other" },
      equipped: { carryType: "worn" },
      _migration: schemaStamp()
    },
    flags: {
      [MODULE_ID]: {
        [UPGRADE_ITEM_FLAG]: {
          key: entry.key,
          ref: entry.ref,
          variant: entry.variant ?? null,
          station: entry.station ?? null,
          slot: entry.slot,
          lang: o.lang,
          traits: entry.traits ?? []
        }
      }
    }
  };
}
