// 0.9.1: actor/item compendiums ship an "English" and a "Русский" root folder; RU copies keep the English rules flags.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildActionItemData } from "../../scripts/content/action-docs.mjs";
import { buildWeaponItemData } from "../../scripts/content/weapon-docs.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(root, "packs-src");
const NO_PACK_SRC = !fs.existsSync(SRC);
const docs = (p) => fs.readdirSync(path.join(SRC, p)).map((f) => JSON.parse(fs.readFileSync(path.join(SRC, p, f), "utf8")));
const CYR = /[А-Яа-яЁё]/;

for (const [pack, kind, flag] of [
  ["starships", "actors", (d) => d.flags["sf2e-tactical-starship-combat"].starship.sourceId],
  ["starship-hazards", "actors", (d) => d.name && d.system.details.level.value + ":" + d.img],
  ["starship-actions", "items", (d) => d.flags["sf2e-tactical-starship-combat"].packAction.actionId],
  ["starship-weapons", "items", (d) => d.flags["sf2e-tactical-starship-combat"].packWeapon.weaponRef]
]) {
  test(`0.9.1: ${pack} has English + Русский root folders with matching documents`, { skip: NO_PACK_SRC }, () => {
    const all = docs(pack);
    const folders = new Map(all.filter((d) => d._key.startsWith("!folders!")).map((d) => [d._id, d]));
    const roots = [...folders.values()]
      .filter((f) => !f.folder)
      .map((f) => f.name)
      .sort();
    assert.deepEqual(roots, ["English", "Русский"]);
    const top = (d) => {
      let f = folders.get(d.folder);
      while (f?.folder) f = folders.get(f.folder);
      return f?.name;
    };
    const items = all.filter((d) => d._key.startsWith(`!${kind}!`));
    const en = items.filter((d) => top(d) === "English"),
      ru = items.filter((d) => top(d) === "Русский");
    assert.ok(en.length > 10);
    assert.equal(en.length, ru.length);
    assert.equal(en.length + ru.length, items.length);
    for (const d of ru) assert.match(d.name, CYR, d.name);
    for (const d of en) assert.ok(!CYR.test(d.name), d.name);
    assert.deepEqual(en.map(flag).sort(), ru.map(flag).sort());
    assert.equal(new Set(items.map((d) => d._id)).size, items.length);
  });
}

test("0.9.1: action/weapon builders stay English by default and accept translators", () => {
  const a = {
    id: "x",
    name: "Fire",
    text: "Shoot it.",
    cost: [1, 2],
    minGrade: "commercial",
    station: "gunnery",
    source: { book: "B", page: 3 }
  };
  const en = buildActionItemData(a, { stationName: "Gunnery" });
  assert.equal(en.name, "Fire");
  assert.match(en.system.description.value, /min\. grade: commercial/);
  assert.match(en.system.description.value, /1–2 actions/);
  const ru = buildActionItemData(a, {
    stationName: "Артиллерия",
    tr: (x) => ({ Fire: "Огонь", "Shoot it.": "Стреляй." })[x] ?? x,
    gradeLabel: () => "коммерческий",
    labels: { actions: "действия", minGrade: "мин. класс", page: "с." }
  });
  assert.equal(ru.name, "Огонь");
  assert.match(ru.system.description.value, /мин\. класс: коммерческий/);
  assert.match(ru.system.description.value, /Стреляй\./);
  assert.deepEqual(ru.flags, en.flags);
  const w = {
    id: "laser",
    name: "Laser",
    die: "2d6",
    damageType: "fire",
    range: 3,
    upgradeSlots: 1,
    traits: ["tech", "volley"],
    category: "simple",
    group: "laser"
  };
  const wen = buildWeaponItemData(w),
    wru = buildWeaponItemData(w, { tr: () => "Лазер", damageLabel: () => "огонь", labels: { damage: "Урон" } });
  assert.equal(wen.name, "Laser");
  assert.match(wen.system.description.value, /Damage/);
  assert.equal(wru.name, "Лазер");
  assert.match(wru.system.description.value, /Урон.*2d6 огонь/);
  assert.deepEqual(wru.flags, wen.flags);
  assert.deepEqual(wru.system.damage, wen.system.damage);
});
