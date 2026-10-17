/**
 * Content translation tooling (Node only).
 * Game data stays English (the rules engine parses it: DCs, damage, frequencies). Display text is translated through
 * lang/content/<lang>.json — a dictionary "English source string → translated string" built from
 * tools/i18n/content-<lang>.src.json by `node tools/i18n/build-content-i18n.mjs`.
 * In the source file every inline check of the English text is masked as ⟦n⟧ so translators never touch
 * @Check syntax; the build step re-inserts sf2e @Check enrichers with localized labels.
 */
import fs from "node:fs";
import path from "node:path";
import { linkChecks } from "../../scripts/content/inline-checks.mjs";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", p), "utf8"));

/** Fields holding display text, per content kind. Ids, slugs, traits (SF2eTSC.traits.*), dice and numbers are excluded. */
const TEXT_KEYS = new Set([
  "name",
  "text",
  "description",
  "passive",
  "disable",
  "reset",
  "immunities",
  "resistances",
  "weaknesses",
  "usage",
  "familyText",
  "label",
  "notes",
  "family",
  "hpNote",
  "trigger",
  "requirements",
  "effect",
  "frequency",
  "summary",
  "flavor",
  "special"
]);
const SKIP_PARENTS = new Set(["source", "review", "targeting", "requirementsData"]);

export function collectStrings() {
  const index = read("index.json");
  const out = new Map(); // string → Set(kind)
  const add = (kind, s) => {
    if (typeof s !== "string") return;
    const v = s.trim();
    if (!v || !/[A-Za-z]{2}/.test(v)) return;
    if (!out.has(v)) out.set(v, new Set());
    out.get(v).add(kind);
  };
  const walk = (kind, o, parent = "") => {
    if (Array.isArray(o)) {
      for (const v of o) walk(kind, v, parent);
      return;
    }
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (SKIP_PARENTS.has(k)) continue;
      if (typeof v === "string") {
        if (TEXT_KEYS.has(k) && !(parent === "effects" && k === "type")) add(kind, v);
      } else walk(kind, v, k);
    }
  };
  walk("stations", read(index.stations).stations);
  walk("actions", read(index.actions).actions);
  walk("frames", read(index.frames).frames);
  walk("weapons", read(index.weapons).weapons);
  // 0.9.1: upgrades — names, usage line, rules paragraphs, activations (+ outcome/attunement details), variants, review notes
  const upAct = (a) => {
    add("upgrades", a.name);
    for (const k of ["frequency", "trigger", "requirements", "effect"]) add("upgrades", a[k]);
    for (const d of a.details ?? []) {
      if (typeof d === "string") add("upgrades", d);
      else {
        add("upgrades", d.label);
        add("upgrades", d.text);
      }
    }
  };
  for (const u of read(index.upgrades).upgrades) {
    for (const s of [u.name, u.usage, u.reviewNote, ...[].concat(u.text ?? [])]) add("upgrades", s);
    (u.activations ?? []).forEach(upAct);
    for (const v of u.variants ?? []) {
      for (const s of [v.name, v.reviewNote, ...[].concat(v.text ?? [])]) add("upgrades", s);
      (v.activations ?? []).forEach(upAct);
    }
  }
  const misc = read(index.misc);
  walk("misc", misc.drones ?? []);
  walk("misc", misc.expansionBays ?? []);
  walk("hazards", read(index.hazards).hazards);
  for (const f of index.starships) {
    const d = read(f);
    add("factions", d.faction);
    walk("ships", d.ships);
  }
  return out;
}

export const CHECK_TOKEN = /@Check\[([^\]]+)\](?:\{([^}]*)\})?/g;
/** "DC 13 Nature (trained; …)" → { masked: "⟦0⟧ (trained; …)", checks: [{params,label}] } */
export function maskChecks(en) {
  const linked = linkChecks(en);
  const checks = [];
  const masked = linked.replace(CHECK_TOKEN, (m, params, label) => {
    checks.push({ params, label: label ?? "" });
    return `⟦${checks.length - 1}⟧`;
  });
  return { masked, checks };
}

const RU = {
  skills: {
    acrobatics: "Акробатика",
    arcana: "Аркана",
    athletics: "Атлетика",
    computers: "Компьютеры",
    crafting: "Ремесло",
    deception: "Обман",
    diplomacy: "Дипломатия",
    intimidation: "Запугивание",
    medicine: "Медицина",
    nature: "Природа",
    occultism: "Оккультизм",
    performance: "Выступление",
    piloting: "Пилотирование",
    religion: "Религия",
    society: "Общество",
    stealth: "Скрытность",
    survival: "Выживание",
    thievery: "Воровство",
    perception: "Восприятие"
  },
  saves: { fortitude: "Стойкости", reflex: "Рефлекса", will: "Воли" },
  ranks: { untrained: "нетренирован", trained: "обучен", expert: "эксперт", master: "мастер", legendary: "легенда" }
};
/** Localized label for a masked check (Russian). */
export function checkLabelRu({ params, label }) {
  const [type, ...rest] = params.split("|");
  const dc = rest.find((p) => p.startsWith("dc:"))?.slice(3);
  const basic = rest.includes("basic");
  const showDC = /^DC /.test(label);
  const rank = /\((untrained|trained|expert|master|legendary)\)/.exec(label)?.[1];
  const rk = rank ? ` (${RU.ranks[rank]})` : "";
  const pre = showDC && dc ? `КС ${dc} ` : "";
  if (type === "flat") return `${pre}чистая проверка`;
  if (RU.saves[type]) return `${pre}${basic ? "простой " : ""}спасбросок ${RU.saves[type]}`;
  const skill = RU.skills[type] ?? type;
  const after = /\(DC \d+\)\s*$/.test(label) && dc ? ` (КС ${dc})` : "";
  return `${pre}${skill}${rk}${after}`;
}
export function unmask(translated, checks, labelFn = checkLabelRu) {
  return translated.replace(/⟦(\d+)⟧/g, (m, i) => {
    const c = checks[Number(i)];
    return c ? `@Check[${c.params}]{${labelFn(c)}}` : m;
  });
}
