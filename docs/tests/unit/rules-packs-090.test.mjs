import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_PACK_SRC = fs.existsSync(path.join(root, "packs-src")) ? false : "packs-src/ not present (release build)";
const docs = (pack) =>
  fs
    .readdirSync(path.join(root, "packs-src", pack))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(root, "packs-src", pack, f), "utf8")));
const ACTIVITIES = [
  "emergency-repairs",
  "fly-the-ship",
  "lock-and-load",
  "power-up",
  "operate-drone",
  "scan-for-magic",
  "scan-surroundings"
];

test("module.json registers the rules journal and the exploration item pack", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
  const rules = m.packs.find((p) => p.name === "starship-combat-rules");
  const expl = m.packs.find((p) => p.name === "starship-exploration");
  assert.equal(rules?.type, "JournalEntry");
  assert.equal(expl?.type, "Item");
  for (const p of [rules, expl]) {
    assert.equal(p.system, "sf2e");
    assert.ok(fs.existsSync(path.join(root, p.path, "CURRENT")), p.path);
    assert.ok(m.packFolders[0].packs.includes(p.name));
  }
});

test("rules journal exists in English and Russian with the same sections", { skip: NO_PACK_SRC }, () => {
  const j = docs("starship-combat-rules");
  assert.equal(j.length, 2);
  const en = j.find((d) => d.name.endsWith("(EN)"));
  const ru = j.find((d) => d.name.endsWith("(RU)"));
  assert.ok(en && ru);
  assert.equal(en.pages.length, ru.pages.length);
  assert.ok(en.pages.length >= 9);
  for (const d of [en, ru]) {
    const html = d.pages.map((p) => p.text.content).join("");
    assert.ok(!html.includes("{{"), "placeholders replaced");
    assert.equal((html.match(/starship-exploration\.Item\./g) ?? []).length, ACTIVITIES.length);
    assert.match(html, /<h3>/);
  }
  assert.match(ru.pages.map((p) => p.text.content).join(""), /критически повреждён/);
});

test("exploration activities are sf2e passive exploration actions in EN and RU", { skip: NO_PACK_SRC }, () => {
  const all = docs("starship-exploration");
  const items = all.filter((d) => d._key.startsWith("!items!"));
  assert.equal(all.filter((d) => d._key.startsWith("!folders!")).length, 2);
  assert.equal(items.length, ACTIVITIES.length * 2);
  const actionIds = new Set(docs("starship-actions").map((d) => d._id));
  for (const it of items) {
    assert.equal(it.type, "action");
    assert.equal(it.system.actionType.value, "passive");
    assert.equal(it.system.actions.value, null);
    assert.ok(it.system.traits.value.includes("exploration"));
    assert.equal(it.img, "systems/sf2e/icons/actions/Passive.webp");
    assert.equal(it.system.publication.license, "ORC");
    assert.ok(ACTIVITIES.includes(it.flags["sf2e-tactical-starship-combat"].explorationActivity.id));
    for (const [, id] of it.system.description.value.matchAll(/starship-actions\.Item\.([A-Za-z0-9]+)/g))
      assert.ok(actionIds.has(id), `${it.name}: ${id}`);
  }
  const repairs = items.filter((i) => i.flags["sf2e-tactical-starship-combat"].explorationActivity.id === "emergency-repairs");
  for (const r of repairs) {
    assert.match(r.system.description.value, /@Check\[crafting\|dc:15\]/);
    assert.match(r.system.description.value, /\[\[\/r 4d8\]\]/);
  }
});
