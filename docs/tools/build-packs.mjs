// node tools/build-packs.mjs  — builds the LevelDB compendium packs from data/*.json (requires @foundryvtt/foundryvtt-cli)
import { STARSHIP_TAG } from "../scripts/constants.mjs";
import { pf2ePackDocument } from "./pf2e-packs.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadAll } from "./validate-content.mjs";
import { buildShipActorData, buildHazardActorData, STATION_NAME } from "../scripts/content/ship-docs.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "packs-src");
import { buildActionItemData } from "../scripts/content/action-docs.mjs";
import { buildWeaponItemData } from "../scripts/content/weapon-docs.mjs";
import { buildUpgradeItemData } from "../scripts/content/upgrade-docs.mjs";
import { upgradeEntries, UPGRADE_STATIONS } from "../scripts/engine/upgrades.mjs";
const { compilePack } = await import("@foundryvtt/foundryvtt-cli").catch(() => {
  throw new Error("Install the dev dependencies first: npm install (needs @foundryvtt/foundryvtt-cli)");
});

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const stableId = (s) => {
  const h = crypto.createHash("sha1").update(s).digest();
  let n = BigInt("0x" + h.toString("hex").slice(0, 20));
  let out = "";
  while (out.length < 16) {
    out += B62[Number(n % 62n)];
    n /= 62n;
  }
  return out;
};
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const stats = {
  coreVersion: "14.367",
  systemId: "sf2e",
  systemVersion: "1.6.0",
  createdTime: 1760000000000,
  modifiedTime: 1760000000000,
  lastModifiedBy: null,
  compendiumSource: null,
  duplicateSource: null
};

function write(pack, key, id, doc) {
  const dir = path.join(SRC, pack);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${(doc.name ?? id).replace(/[^A-Za-z0-9]+/g, "-")}-${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...doc, _id: id, _key: key.replace("{id}", id) }, null, 1));
}
const actorDoc = (data, folder, id) => ({
  ...data,
  folder,
  sort: 0,
  items: (data.items ?? []).map((it, i) => {
    const iid = stableId(`${id}:item:${i}`);
    return {
      folder: null,
      sort: (i + 1) * 100000,
      effects: [],
      ownership: { default: 0 },
      flags: {},
      ...it,
      _id: iid,
      _key: `!actors.items!${id}.${iid}`,
      _stats: stats
    };
  }),
  effects: [],
  ownership: { default: 0 },
  _stats: stats
});
const journal = (name, pages, id) => ({
  name,
  folder: null,
  sort: 0,
  ownership: { default: 0 },
  flags: {},
  _stats: stats,
  pages: pages.map((p, i) => {
    const pid = stableId(`${id}:${p.name}`);
    return {
      _id: pid,
      _key: `!journal.pages!${stableId(id)}.${pid}`,
      name: p.name,
      type: "text",
      title: { show: true, level: 1 },
      text: { format: 1, content: p.html },
      sort: (i + 1) * 100,
      ownership: { default: -1 },
      flags: {},
      _stats: stats
    };
  })
});

fs.rmSync(SRC, { recursive: true, force: true });
const c = loadAll();

const LANG = Object.fromEntries(
  ["en", "ru"].map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, "lang", `${l}.json`), "utf8")).SF2eTSC])
);
const ruStrings = JSON.parse(fs.readFileSync(path.join(root, "lang", "content", "ru.json"), "utf8")).strings ?? {};
const nk = (x) =>
  String(x ?? "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const ruMap = new Map(Object.entries(ruStrings).map(([k, v]) => [nk(k), v]));
const ruLower = new Map(Object.entries(ruStrings).map(([k, v]) => [nk(k).toLowerCase(), v]));
const ru = (x) => ruMap.get(nk(x)) ?? ruLower.get(nk(x).toLowerCase()) ?? x;
const GLOSSARY = JSON.parse(fs.readFileSync(new URL("../lang/content/glossary.json", import.meta.url), "utf8"));
const RU_GRADE = GLOSSARY.grades;
const RU_ADV = GLOSSARY.advancement;
/** English column headers of the station advancement tables (the data keys are camelCase). */
const EN_ADV = {
  helmedAC: "AC (helmed)",
  helmedReflex: "Reflex (helmed)",
  helmedFortitude: "Fortitude (helmed)",
  helmedWill: "Will (helmed)",
  sensorIncrease: "Sensor range +",
  damageDice: "Damage dice",
  tracking: "Tracking",
  drones: "Drones"
};
const RU_COST = GLOSSARY.costs;
const RU_DMG = GLOSSARY.damageTypes;
const RU_CAT = GLOSSARY.categories;
const RU_GROUP = GLOSSARY.groups;
const RU_TRAIT = GLOSSARY.traits;
const ruTrait = (t) => {
  const d = ru(t);
  return d !== t ? d : String(t).replace(/[A-Za-z]+/g, (w) => RU_TRAIT[w.toLowerCase()] ?? w);
};
const ruCost = (c) => (Array.isArray(c) ? c : [c]).map((x) => RU_COST[x] ?? x).join(" / ");

// --- 0.9.1: language root folders for the actor/item packs ("English" / "Русский"). EN documents keep their ids
// (links, flags and imports stay valid); RU copies get ids derived from "<key>:ru" and the same rules flags.
const LANGS = { en: "English", ru: "Русский" };
const langRoot = (pack, lang) => stableId(`folder:${pack}:lang:${lang}`);
const langRoots = (pack, type) =>
  Object.entries(LANGS).forEach(([lang, name], i) =>
    write(pack, "!folders!{id}", langRoot(pack, lang), {
      name,
      type,
      folder: null,
      sorting: "m",
      sort: (i + 1) * 100000,
      color: null,
      flags: {},
      description: "",
      _stats: stats
    })
  );
const sub = (pack, type, lang, key, name, sorting = "a") => {
  const fid = stableId(lang === "en" ? key : `${key}:ru`);
  write(pack, "!folders!{id}", fid, {
    name,
    type,
    folder: langRoot(pack, lang),
    sorting,
    sort: 0,
    color: null,
    flags: {},
    description: "",
    _stats: stats
  });
  return fid;
};
const docId = (key, lang) => stableId(lang === "en" ? key : `${key}:ru`);
const RU_LANG = LANG.ru;
const ruDamage = (x) =>
  String(x ?? "")
    .replace(/\(([^()]*[A-Za-z]{3}[^()]*)\)/g, (m, t) => `(${ru(t)})`)
    .replace(
      /\b(acid|bludgeoning|cold|electricity|fire|force|piercing|slashing|void|sonic|mental|poison|spirit|vitality|bleed|persistent|untyped)\b/g,
      (w) => RU_LANG.damageTypes?.[w] ?? w
    )
    .replace(/\bplus\b/g, RU_LANG.ui.plus)
    .replace(/\bdamage\b/g, RU_LANG.ui.damageWord);
const ruZones = (x) =>
  String(x ?? "").replace(/\b(\d+)[ -]zones?\b/g, (m, n) => `${n} ${(Number(n) === 1 ? RU_LANG.ui.zone : RU_LANG.ui.zones).toLowerCase()}`);
const ruTraitDoc = (t) => ruZones(ruTrait(t));
const DOC_I18N = {
  en: null,
  ru: {
    levelShort: RU_LANG.ui.levelShort,
    tr: ru,
    trait: ruTraitDoc,
    damage: ruDamage,
    cost: (x) => RU_LANG.edit?.cost?.[x] ?? RU_COST[x] ?? x,
    label: (k, data = {}) => {
      const v = RU_LANG.docs?.[k];
      return typeof v === "string" ? v.replace(/\{(\w+)\}/g, (m, x) => (x in data ? String(data[x]) : m)) : null;
    }
  }
};

// --- Starships (folders per faction, manual sort = by level)
langRoots("starships", "Actor");
for (const lang of Object.keys(LANGS)) {
  let shipSort = 0;
  const folders = new Map();
  for (const s of c.ships) {
    if (!folders.has(s.faction))
      folders.set(s.faction, sub("starships", "Actor", lang, `folder:ships:${s.faction}`, lang === "en" ? s.faction : ru(s.faction), "m"));
    const id = docId(`ship:${s.id}`, lang);
    const d = actorDoc(buildShipActorData(s, { levelInName: true, i18n: DOC_I18N[lang] }), folders.get(s.faction), id);
    d.sort = (Number(s.level) + 2) * 100000 + ++shipSort;
    write("starships", "!actors!{id}", id, d);
  }
}
// --- Hazards
langRoots("starship-hazards", "Actor");
const HZ_KIND = { en: { Simple: "Simple", Complex: "Complex" }, ru: { Simple: "Простые", Complex: "Сложные" } };
for (const lang of Object.keys(LANGS)) {
  const kf = Object.fromEntries(
    ["Simple", "Complex"].map((kind) => [kind, sub("starship-hazards", "Actor", lang, `folder:hz:${kind}`, HZ_KIND[lang][kind])])
  );
  for (const h of c.hazards) {
    const id = docId(`hazard:${h.id}`, lang);
    write(
      "starship-hazards",
      "!actors!{id}",
      id,
      actorDoc(buildHazardActorData(h, { levelInName: true, i18n: DOC_I18N[lang] }), kf[h.isComplex ? "Complex" : "Simple"], id)
    );
  }
}
// --- Starship actions (Item pack, folder per battle station + NPC starships)
langRoots("starship-actions", "Item");
const ACT_FOLDER = { any: "Any station", npc: "NPC starships" };
const ACT_FOLDER_RU = { any: "Любая станция", npc: "NPC-звездолёты" };
const ACT_I18N = {
  en: {},
  ru: {
    tr: ru,
    gradeLabel: (g) => RU_GRADE[g] ?? g,
    labels: { actions: "действия", minGrade: "мин. класс", page: "с." },
    runLabel: "Выполнить на корабле"
  }
};
for (const lang of Object.keys(LANGS)) {
  const actFolders = new Map();
  for (const a of c.actions) {
    const st = a.station ?? "any";
    const enName = ACT_FOLDER[st] ?? STATION_NAME[st] ?? st;
    const fname = lang === "en" ? enName : (ACT_FOLDER_RU[st] ?? RU_LANG.stations?.[st] ?? ru(enName));
    if (!actFolders.has(enName)) actFolders.set(enName, sub("starship-actions", "Item", lang, `folder:actions:${enName}`, fname));
    const id = docId(`action:${a.id}`, lang);
    write("starship-actions", "!items!{id}", id, {
      ...buildActionItemData(a, { stationName: fname, ...ACT_I18N[lang] }),
      folder: actFolders.get(enName),
      sort: 0,
      effects: [],
      ownership: { default: 0 },
      _stats: stats
    });
  }
}
// --- Starship weapons (Item pack, folder per weapon group)
langRoots("starship-weapons", "Item");
const WPN_I18N = {
  en: {},
  ru: {
    tr: ru,
    hint: "Перетащите на лист корабля",
    damageLabel: (t) => RU_DMG[t] ?? t,
    traitLabel: ruTraitDoc,
    labels: {
      damage: "Урон",
      range: "Дальность",
      zones: RU_LANG.ui.zones.toLowerCase(),
      upgradeSlots: "Слоты улучшений",
      starshipTraits: "Признаки звездолёта",
      source: "Источник",
      page: "с."
    }
  }
};
for (const lang of Object.keys(LANGS)) {
  const wFolders = new Map();
  for (const w of c.weapons) {
    const g = (w.group ?? "other").replace(/^./, (x) => x.toUpperCase());
    if (!wFolders.has(g))
      wFolders.set(
        g,
        sub(
          "starship-weapons",
          "Item",
          lang,
          `folder:weapons:${g}`,
          lang === "en" ? g : String(RU_GROUP[w.group ?? "other"] ?? g).replace(/^./, (x) => x.toUpperCase())
        )
      );
    const id = docId(`weapon:${w.id}`, lang);
    write("starship-weapons", "!items!{id}", id, {
      ...buildWeaponItemData(w, WPN_I18N[lang]),
      folder: wFolders.get(g),
      sort: 0,
      effects: [],
      ownership: { default: 0 },
      _stats: stats
    });
  }
}
// --- 0.9.1: Starship upgrades (Item pack: one sf2e "equipment" item per upgrade variant, EN + RU folders)
const MID = "sf2e-tactical-starship-combat";
const langGet = (lang, key, data = {}) => {
  const v = key.split(".").reduce((o, k) => o?.[k], LANG[lang]) ?? key.split(".").reduce((o, k) => o?.[k], LANG.en);
  if (typeof v !== "string") throw new Error(`missing i18n SF2eTSC.${key}`);
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));
};
const UPG = upgradeEntries(c.upgrades);
const upgradeItemId = (e, lang) => stableId(`upgrade:${e.key}:${lang}`);
const UPG_FOLDERS = { en: "English", ru: "Русский" };
let ruUpgrade = null; // set below once the RU dictionary is loaded
const upgradeCtx = (lang) => ({
  lang,
  tr: lang === "en" ? (x) => x : ruUpgrade,
  L: (k, d) => langGet(lang, `upgrades.${k}`, d),
  traitLabel: (t) => langGet(lang, `traits.${t}`),
  stationLabel: (st) => langGet(lang, `stations.${st}`),
  classLabel: (c) => langGet(lang, `classes.${c}`)
});
const upgradeIndexHTML = (lang) => {
  const ctx = upgradeCtx(lang);
  const groups = [...UPGRADE_STATIONS, null]
    .map((st) => ({ st, list: UPG.filter((e) => (e.station ?? null) === st) }))
    .filter((g) => g.list.length);
  return (
    `<p><em>${esc(ctx.L("journalIntro", { book: "Starfinder Tech Core" }))}</em></p>` +
    groups
      .map(
        (g) =>
          `<h3>${esc(g.st ? ctx.stationLabel(g.st) : ctx.L("escapePods"))}</h3><ul>${g.list.map((e) => `<li>@UUID[Compendium.${MID}.starship-upgrades.Item.${upgradeItemId(e, lang)}]{${ctx.tr(e.name)}} — ${esc(ctx.L("level"))} ${e.level}</li>`).join("")}</ul>`
      )
      .join("")
  );
};
function writeUpgradePack() {
  for (const [lang, fname] of Object.entries(UPG_FOLDERS)) {
    const ctx = upgradeCtx(lang);
    const root = stableId(`folder:upgrades:${lang}`);
    write("starship-upgrades", "!folders!{id}", root, {
      name: fname,
      type: "Item",
      folder: null,
      sorting: "m",
      sort: lang === "en" ? 100000 : 200000,
      color: null,
      flags: {},
      description: "",
      _stats: stats
    });
    [...UPGRADE_STATIONS, "escape-pods"].forEach((st, i) =>
      write("starship-upgrades", "!folders!{id}", stableId(`folder:upgrades:${lang}:${st}`), {
        name: st === "escape-pods" ? ctx.L("escapePods") : ctx.stationLabel(st),
        type: "Item",
        folder: root,
        sorting: "m",
        sort: (i + 1) * 100000,
        color: null,
        flags: {},
        description: "",
        _stats: stats
      })
    );
    UPG.forEach((e, i) =>
      write("starship-upgrades", "!items!{id}", upgradeItemId(e, lang), {
        ...buildUpgradeItemData(e, ctx),
        folder: stableId(`folder:upgrades:${lang}:${e.station ?? "escape-pods"}`),
        sort: (e.level + 1) * 1000 + i,
        effects: [],
        ownership: { default: 0 },
        _stats: stats
      })
    );
  }
}

// --- Reference journals
const actionsByStation = (st) =>
  c.actions
    .filter((a) => a.station === st)
    .map(
      (a) =>
        `<li><strong>${esc(a.name)}</strong> [${esc(Array.isArray(a.cost) ? a.cost.join("/") : a.cost)}] — ${esc(a.minGrade)}<br>${esc(a.text)}</li>`
    )
    .join("");
const stationPages = c.stations
  .filter((s) => s.id !== "custom")
  .map((s) => ({
    name: s.name,
    html: `<p>${esc(s.passive)}</p><table><thead><tr><th>Grade</th><th>Level</th><th>Upgrades</th>${Object.keys(s.advancement[0])
      .filter((k) => !["grade", "level", "upgrades"].includes(k))
      .map((k) => `<th>${esc(EN_ADV[k] ?? k)}</th>`)
      .join("")}</tr></thead><tbody>${s.advancement
      .map(
        (r) =>
          `<tr>${Object.values(r)
            .map((v) => `<td>${esc(v)}</td>`)
            .join("")}</tr>`
      )
      .join("")}</tbody></table><ul>${actionsByStation(s.id)}</ul><p><em>Starfinder Tech Core p.${s.source?.page ?? "—"}</em></p>`
  }));
stationPages.push({ name: "Other station actions", html: `<ul>${actionsByStation("any")}</ul>` });
write("battle-stations", "!journal!{id}", stableId("j:stations"), journal("Battle Stations", stationPages, "j:stations"));
const framePages = c.frames.map((f) => ({
  name: f.name,
  html: `<p>${esc(f.description)}</p><p>Sensor range ${f.sensorRange} zones · ${f.expansionBays} expansion bays · ${f.stationSlots} customizable battle stations.</p><table><thead><tr><th>Lvl</th><th>HP</th><th>SP</th><th>AC</th><th>Fort</th><th>Ref</th><th>Will</th><th>Speed</th></tr></thead><tbody>${f.table.map((r) => `<tr><td>${r.level}</td><td>${r.hp}</td><td>${r.sp}</td><td>${r.ac}</td><td>+${r.fort}</td><td>+${r.ref}</td><td>+${r.will}</td><td>${r.speed}</td></tr>`).join("")}</tbody></table>`
}));
write("starship-frames", "!journal!{id}", stableId("j:frames"), journal("Starship Frames", framePages, "j:frames"));
const eq = [
  {
    name: "Starship weapons",
    html: `<table><thead><tr><th>Weapon</th><th>Cat.</th><th>Die</th><th>Type</th><th>Range</th><th>Slots</th><th>Group</th><th>Traits</th></tr></thead><tbody>${c.weapons.map((w) => `<tr><td>${esc(w.name)}</td><td>${w.category}</td><td>${w.die}</td><td>${w.damageType}</td><td>${w.range}</td><td>${w.upgradeSlots}</td><td>${w.group}</td><td>${esc(w.traits.join(", "))}</td></tr>`).join("")}</tbody></table>`
  },
  { name: "Station upgrades", html: upgradeIndexHTML("en") }
];
write("starship-equipment", "!journal!{id}", stableId("j:equipment"), journal("Starship Equipment", eq, "j:equipment"));

// --- Russian rules reference (0.7.1): same tables, texts from the content dictionary lang/content/ru.json
ruUpgrade = (x) => {
  const v = ruMap.get(nk(x));
  if (v == null && /[A-Za-z]{2}/.test(String(x ?? "")))
    throw new Error(`missing RU translation for upgrade text: ${String(x).slice(0, 80)}`);
  return v ?? x;
};
writeUpgradePack();
const ruActs = (st) =>
  c.actions
    .filter((a) => a.station === st)
    .map(
      (a) =>
        `<li><strong>${esc(ru(a.name))}</strong> [${esc(ruCost(a.cost))}] — ${esc(RU_GRADE[a.minGrade] ?? a.minGrade ?? "")}<br>${esc(ru(a.text))}</li>`
    )
    .join("");
const ruStationPages = c.stations
  .filter((s) => s.id !== "custom")
  .map((s) => {
    const keys = Object.keys(s.advancement[0]);
    return {
      name: ru(s.name),
      html: `<p>${esc(ru(s.passive))}</p><table><thead><tr>${keys.map((k) => `<th>${esc(RU_ADV[k] ?? k)}</th>`).join("")}</tr></thead><tbody>${s.advancement.map((r) => `<tr>${keys.map((k) => `<td>${esc(k === "grade" ? (RU_GRADE[r[k]] ?? r[k]) : r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table><ul>${ruActs(s.id)}</ul><p><em>Starfinder Tech Core, с. ${s.source?.page ?? "—"}</em></p>`
    };
  });
ruStationPages.push({ name: "Другие действия станций", html: `<ul>${ruActs("any")}</ul>` });
write("battle-stations", "!journal!{id}", stableId("j:stations:ru"), journal("Боевые станции (RU)", ruStationPages, "j:stations:ru"));
const ruFramePages = c.frames.map((f) => ({
  name: ru(f.name),
  html: `<p>${esc(ru(f.description))}</p><p>Дальность сенсоров: ${f.sensorRange} зон · отсеков расширения: ${f.expansionBays} · настраиваемых боевых станций: ${f.stationSlots}.</p><table><thead><tr><th>Ур.</th><th>ОК</th><th>ОЩ</th><th>КД</th><th>Стойк.</th><th>Рефл.</th><th>Воля</th><th>Скорость</th></tr></thead><tbody>${f.table.map((r) => `<tr><td>${r.level}</td><td>${r.hp}</td><td>${r.sp}</td><td>${r.ac}</td><td>+${r.fort}</td><td>+${r.ref}</td><td>+${r.will}</td><td>${r.speed}</td></tr>`).join("")}</tbody></table>`
}));
write("starship-frames", "!journal!{id}", stableId("j:frames:ru"), journal("Каркасы звездолётов (RU)", ruFramePages, "j:frames:ru"));
const ruEq = [
  {
    name: "Орудия звездолётов",
    html: `<table><thead><tr><th>Орудие</th><th>Категория</th><th>Кость</th><th>Тип урона</th><th>Дальность</th><th>Слоты</th><th>Группа</th><th>Признаки</th></tr></thead><tbody>${c.weapons.map((w) => `<tr><td>${esc(ru(w.name))}</td><td>${RU_CAT[w.category] ?? w.category}</td><td>${w.die}</td><td>${RU_DMG[w.damageType] ?? w.damageType}</td><td>${w.range}</td><td>${w.upgradeSlots}</td><td>${RU_GROUP[w.group] ?? w.group}</td><td>${esc(w.traits.map(ruTrait).join(", "))}</td></tr>`).join("")}</tbody></table>`
  },
  { name: "Улучшения станций", html: upgradeIndexHTML("ru") }
];
write("starship-equipment", "!journal!{id}", stableId("j:equipment:ru"), journal("Снаряжение звездолётов (RU)", ruEq, "j:equipment:ru"));

// --- User guide (docs/guide-*.md → journal, one page per "## " section)
const md = (src) => {
  const inl = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  const out = [];
  let list = null;
  for (const line of src.split("\n")) {
    const m = /^(\s*)(-|\d+\.) (.*)$/.exec(line);
    if (m) {
      const tag = m[2] === "-" ? "ul" : "ol";
      if (list !== tag) {
        if (list) out.push(`</${list}>`);
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${inl(m[3])}</li>`);
      continue;
    }
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
    const h = /^### (.*)$/.exec(line);
    if (h) {
      out.push(`<h3>${inl(h[1])}</h3>`);
      continue;
    }
    if (line.trim()) out.push(`<p>${inl(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join("");
};
for (const [lang, title] of [
  ["ru", "Руководство (RU)"],
  ["en", "User Guide (EN)"]
]) {
  const src = fs
    .readFileSync(path.join(root, "docs", `guide-${lang}.md`), "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("# "))
    .join("\n");
  const pages = src
    .split(/^## /m)
    .filter((x) => x.trim())
    .map((sec) => {
      const [head, ...rest] = sec.split("\n");
      return { name: head.trim(), html: md(rest.join("\n")) };
    });
  write("guide", "!journal!{id}", stableId(`j:guide:${lang}`), journal(title, pages, `j:guide:${lang}`));
}

// --- 0.9.0: Starship exploration activities (Item pack, sf2e "action" items like the system's exploration activities)
const actionLink = (id, label) => {
  if (!c.actions.some((a) => a.id === id)) throw new Error(`unknown action ${id}`);
  return `@UUID[Compendium.${MID}.starship-actions.Item.${stableId(`action:${id}`)}]{${label}}`;
};
const withLinks = (html) => html.replace(/\{\{action:([a-z0-9-]+)\|([^}]+)\}\}/g, (_, id, label) => actionLink(id, label));
const EXPL = JSON.parse(fs.readFileSync(path.join(root, "data", "exploration", "activities.json"), "utf8")).activities;
const explId = (a, lang) => stableId(`exploration:${a.id}:${lang}`);
const EXPL_FOLDERS = { en: "English", ru: "Русский" };
for (const [lang, fname] of Object.entries(EXPL_FOLDERS)) {
  const fid = stableId(`folder:exploration:${lang}`);
  write("starship-exploration", "!folders!{id}", fid, {
    name: fname,
    type: "Item",
    folder: null,
    sorting: "a",
    sort: lang === "en" ? 100000 : 200000,
    color: null,
    flags: {},
    description: "",
    _stats: stats
  });
  for (const a of EXPL) {
    const t = a[lang];
    write("starship-exploration", "!items!{id}", explId(a, lang), {
      name: t.name,
      type: "action",
      img: "systems/sf2e/icons/actions/Passive.webp",
      folder: fid,
      sort: 0,
      effects: [],
      ownership: { default: 0 },
      _stats: stats,
      system: {
        actionType: { value: "passive" },
        actions: { value: null },
        category: "interaction",
        description: { value: withLinks(t.description), gm: "" },
        traits: { value: [...new Set([STARSHIP_TAG, ...(a.traits ?? [])])], rarity: "common", otherTags: [STARSHIP_TAG] },
        slug: `tsc-exploration-${a.id}${lang === "en" ? "" : `-${lang}`}`,
        rules: [],
        publication: { title: "Starfinder Tech Core", authors: "", license: "ORC", remaster: true },
        _migration: { version: 0.959, previous: null }
      },
      flags: { [MID]: { explorationActivity: { id: a.id, lang } } }
    });
  }
}

// --- 0.9.0: Tactical starship combat rules (data/rules/*.md → journal, one page per "## " section)
for (const [lang, title] of [
  ["en", "Tactical Starship Combat (EN)"],
  ["ru", "Тактический космический бой (RU)"]
]) {
  const src = fs
    .readFileSync(path.join(root, "data", "rules", `tactical-starship-combat.${lang}.md`), "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("# "))
    .join("\n");
  const list = EXPL.map((a) => `@UUID[Compendium.${MID}.starship-exploration.Item.${explId(a, lang)}]{${a[lang].name}}`).join("\n- ");
  const pages = src
    .split(/^## /m)
    .filter((x) => x.trim())
    .map((sec) => {
      const [head, ...rest] = sec.split("\n");
      return { name: head.trim(), html: md(rest.join("\n")).replace("{{exploration}}", list.replace(/\n- /g, "</li><li>")) };
    });
  write("starship-combat-rules", "!journal!{id}", stableId(`j:rules:${lang}`), journal(title, pages, `j:rules:${lang}`));
}

const BASE_PACKS = [
  "starships",
  "starship-hazards",
  "starship-actions",
  "starship-weapons",
  "battle-stations",
  "starship-frames",
  "starship-equipment",
  "guide",
  "starship-combat-rules",
  "starship-exploration",
  "starship-upgrades"
];
for (const pack of BASE_PACKS) {
  const dest = path.join(root, "packs", pack);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  await compilePack(path.join(SRC, pack), dest, { log: false, recursive: false });
  console.log("built", pack, fs.readdirSync(path.join(SRC, pack)).length, "source docs");
}

// PF2e-копии сохраняют ID и игровые данные; ссылки ведут только в PF2e-варианты паков.
for (const pack of BASE_PACKS) {
  const name = `${pack}-pf2e`;
  const source = path.join(SRC, name);
  const dest = path.join(root, "packs", name);
  fs.rmSync(source, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(path.join(SRC, pack)).filter((name) => name.endsWith(".json"))) {
    const doc = JSON.parse(fs.readFileSync(path.join(SRC, pack, file), "utf8"));
    fs.writeFileSync(path.join(source, file), JSON.stringify(pf2ePackDocument(doc, BASE_PACKS), null, 1));
  }
  await compilePack(source, dest, { log: false, recursive: false });
  console.log("built", name, fs.readdirSync(source).length, "derived source docs");
}
