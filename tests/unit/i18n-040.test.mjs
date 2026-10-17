import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";
import { setContentTranslations, ct, ctPlain, ctList } from "../../scripts/content/content-i18n.mjs";
import { collectStrings } from "../../tools/i18n/content-strings.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const flat = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object") flat(v, key, out);
    else out[key] = v;
  }
  return out;
};
const lang = (l) => flat(JSON.parse(fs.readFileSync(path.join(ROOT, "lang", `${l}.json`), "utf8")));
const en = lang("en"),
  ru = lang("ru");
const placeholders = (s) =>
  [...String(s).matchAll(/\{[a-zA-Z0-9_]+\}/g)]
    .map((m) => m[0])
    .sort()
    .join(",");
const walk = (dir, ext) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name), ext) : d.name.endsWith(ext) ? [path.join(dir, d.name)] : []));

test("i18n: en.json and ru.json have exactly the same keys", () => {
  assert.deepEqual(
    Object.keys(ru).filter((k) => !(k in en)),
    [],
    "keys only in ru"
  );
  assert.deepEqual(
    Object.keys(en).filter((k) => !(k in ru)),
    [],
    "keys only in en"
  );
});

test("i18n: placeholders are identical in both languages and no value is empty", () => {
  const bad = Object.keys(en).filter((k) => placeholders(en[k]) !== placeholders(ru[k]));
  assert.deepEqual(bad, []);
  assert.deepEqual(
    Object.keys(ru).filter((k) => !String(ru[k]).trim()),
    []
  );
  // broken placeholders such as "{name" or "name}" or doubled braces
  assert.deepEqual(
    Object.keys(ru).filter((k) => /\{[^}]*$|\{\{|\}\}/.test(String(ru[k]))),
    []
  );
});

/** Latin words allowed inside Russian strings: product / module names, file formats, rules-data examples. */
const ALLOWED_LATIN = new Set([
  "SF2e",
  "Foundry",
  "VTT",
  "HoloDock",
  "Causodes",
  "Ship",
  "Combat",
  "Tactical",
  "Starship",
  "Aztec's",
  "Engines",
  "of",
  "War",
  "JSON",
  "Tech",
  "Core",
  "d20",
  "UUID",
  "ID",
  "HUD"
]);
const SLUG_EXAMPLE_KEYS = /^SF2eTSC\.edit\.(ph\.|damagePlaceholder|traitsPlaceholder|rawJsonHint)/;
test("i18n: Russian strings contain no stray English fragments", () => {
  const offenders = [];
  for (const [k, v] of Object.entries(ru)) {
    // The starship trait is intentionally English in every client language.
    if (k === "SF2eTSC.traits.starship") {
      assert.equal(v, "starship");
      continue;
    }
    if (SLUG_EXAMPLE_KEYS.test(k)) continue;
    const text = String(v)
      .replace(/\{[^}]+\}/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/«[^»]*»/g, (m) => (/[А-Яа-яЁё]/.test(m) ? m : ""));
    const words = (text.match(/[A-Za-z][A-Za-z0-9'’-]*/g) ?? []).filter((w) => !ALLOWED_LATIN.has(w));
    if (words.length) offenders.push(`${k}: ${words.join(" ")}`);
  }
  assert.deepEqual(offenders, []);
});

test("i18n: every static SF2eTSC key used in code and templates exists", () => {
  const files = [...walk(path.join(ROOT, "scripts"), ".mjs"), ...walk(path.join(ROOT, "templates"), ".hbs")];
  const missing = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/SF2eTSC\.[A-Za-z0-9_.-]*[A-Za-z0-9_-]/g)) {
      const key = m[0];
      const next = src.slice(m.index + key.length, m.index + key.length + 2);
      if (
        next.startsWith("${") ||
        next.startsWith(".$") ||
        next.startsWith(".<") ||
        next.startsWith(".*") ||
        next === ".`" ||
        next.startsWith('."') ||
        next.startsWith(".'")
      )
        continue; // dynamic suffix
      if (/^SF2eTSC\.(Starship|Npc)Sheet$/.test(key)) continue;
      if (!(key in en)) missing.add(`${key} (${path.relative(ROOT, f)})`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("i18n: module.json declares both languages and the content dictionaries exist", () => {
  const mod = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
  assert.deepEqual(mod.languages.map((l) => l.lang).sort(), ["en", "ru"]);
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "content", "ru.json"), "utf8")).strings;
  for (const [k, v] of Object.entries(dict)) {
    assert.ok(v && typeof v === "string", k);
    assert.ok(!/⟦\d+⟧/.test(v), `unreplaced check token in ${k.slice(0, 60)}`);
    assert.ok(!/@Check\[[^\]]*$/.test(v), `broken enricher in ${k.slice(0, 60)}`);
  }
});

test("content i18n: all shipped content (stations, actions, weapons, frames, upgrades, drones, factions, hazards, NPC ships) is fully translated", () => {
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "content", "ru.json"), "utf8")).strings;
  const missing = [];
  for (const [s, kinds] of collectStrings()) {
    if (kinds.size && !dict[s]) missing.push(s);
  }
  assert.deepEqual(missing, []);
});

test("content i18n: display-time lookup keeps the English source for the engine and unknown text", () => {
  setContentTranslations("ru", {
    "Boost Thrusters": "Форсаж двигателей",
    "Attempt a DC 20 Will save.": "Совершите @Check[will|dc:20]{КС 20 спасбросок Воли}.",
    biocannon: "Биопушка"
  });
  assert.equal(ct("Boost Thrusters"), "Форсаж двигателей");
  assert.equal(ct("boost   thrusters"), "форсаж двигателей", "case/whitespace-insensitive, keeps lower-case start");
  assert.equal(ct("Biocannon"), "Биопушка");
  assert.equal(ct("GM homebrew text"), "GM homebrew text");
  assert.equal(ctPlain("Attempt a DC 20 Will save."), "Совершите КС 20 спасбросок Воли.");
  assert.equal(ctList(["Boost Thrusters", "Evade"]), "Форсаж двигателей, Evade");
  setContentTranslations("en", {});
  assert.equal(ct("Boost Thrusters"), "Boost Thrusters");
});

test("labels: traits, damage types and zones are localized without touching slugs", async () => {
  installFoundryMock({ lang: "ru" });
  const { traitLabel, traitsText, damageText, strikeLine } = await import("../../scripts/utils/labels.mjs");
  assert.equal(traitLabel("agile"), "Быстрое");
  assert.equal(traitLabel("range increment 2 zones"), "Шаг дистанции 2 зон");
  assert.equal(traitsText(["tech", "unwieldy"]), "Технологическое, Громоздкое");
  assert.equal(damageText("1d10+4 piercing"), "1d10+4 колющий");
  assert.equal(
    strikeLine({ kind: "melee", attack: 11, traits: ["unarmed"], damage: "1d10+4 piercing" }),
    "Ближний бой +11 (Безоружное), 1d10+4 колющий"
  );
  installFoundryMock({ lang: "en" });
  assert.equal(traitLabel("agile"), "Agile");
});

test("designations are stored neutral and displayed in the client language", async () => {
  installFoundryMock({ lang: "ru" });
  const { displayDesignation } = await import("../../scripts/utils/designations.mjs");
  assert.match(displayDesignation("Contact Alpha"), /^Контакт Альфа$/);
  assert.match(displayDesignation("Contact 03"), /^Контакт 03$/);
  assert.equal(displayDesignation("Raider"), "Raider");
});
