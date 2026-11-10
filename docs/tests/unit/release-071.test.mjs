import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
// packs-src/ is the editable compendium source; it is not part of the release zip, so these checks skip there
const NO_PACK_SRC = existsSync(new URL("../../packs-src/", import.meta.url)) ? false : "packs-src/ not present (release build)";
const rd = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("0.7.1: shipNameWithLevel", async () => {
  const { shipNameWithLevel } = await import("../../scripts/content/ship-docs.mjs");
  assert.equal(shipNameWithLevel("Corpse Ship", 5), "Corpse Ship (Lv 5)");
  assert.equal(shipNameWithLevel("Корабль", 3, "ур."), "Корабль (ур. 3)");
  assert.equal(shipNameWithLevel("Corpse Ship (Lv 5)", 6), "Corpse Ship (Lv 6)");
  assert.equal(shipNameWithLevel("X", -1), "X (Lv -1)");
});

test("0.7.1: compendium starships carry the level in their name, token names do not", { skip: NO_PACK_SRC }, () => {
  const dir = new URL("../../packs-src/starships/", import.meta.url);
  const actors = readdirSync(dir)
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")))
    .filter((d) => d._key?.startsWith("!actors!"));
  assert.ok(actors.length > 50);
  for (const a of actors) {
    const short = /[А-Яа-яЁё]/.test(a.name) ? "ур." : "Lv"; // 0.9.1: RU copies use "ур."
    assert.ok(a.name.endsWith(`(${short} ${a.system.details.level.value})`), a.name);
    assert.ok(!/\((Lv|ур\.)/.test(a.prototypeToken.name), a.prototypeToken.name);
  }
});

test("0.7.1: Russian rules reference journals exist", { skip: NO_PACK_SRC }, () => {
  for (const [pack, name] of [
    ["battle-stations", "Боевые станции (RU)"],
    ["starship-frames", "Каркасы звездолётов (RU)"],
    ["starship-equipment", "Снаряжение звездолётов (RU)"]
  ]) {
    const dir = new URL(`../../packs-src/${pack}/`, import.meta.url);
    const docs = readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    const j = docs.find((d) => d.name === name);
    assert.ok(j, name);
    assert.ok(j.pages.length > 0 && j.pages.every((p) => /[А-Яа-яЁё]/.test(p.name)), name);
  }
  assert.equal(JSON.parse(rd("lang/ru.json")).SF2eTSC.ui.levelShort, "ур.");
  assert.equal(JSON.parse(rd("lang/en.json")).SF2eTSC.ui.levelShort, "Lv");
});
